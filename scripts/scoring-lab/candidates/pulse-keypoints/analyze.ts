/**
 * Motion-only TypeScript port of Codex's pulse chart generator
 * (C:/Users/jink/groovy/experiments/pulse-party/analyze.py: motion() + chart() with NO audio,
 * i.e. what analyze.py does with a muted track: no onsets, audio strength 0, no snapping).
 * Used by the pulse-keypoints candidate for references without a precomputed analysis (e.g. the
 * looped 60 s performance scenario). numpy / scipy behaviour reproduced:
 *   np.unwrap, scipy.ndimage.gaussian_filter1d (mode 'reflect', truncate 4), np.gradient
 *   (edge_order 1), np.percentile (linear), scipy.signal.find_peaks (height -> distance ->
 *   prominence, plateau midpoints), Python round() (half to even).
 * Validate against the Python curves with scripts/scoring-lab/sanity-baselines.ts.
 */

/** Bones used for motion (start, end) — analyze.py BONES */
export const MOTION_BONES: [string, string][] = [
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
]

export interface AnalyzeFrame {
  time: number
  keypoints: { x: number; y: number; score: number; name: string }[]
}

/** Python round(): half to even. */
export function pyRound(x: number, digits = 0): number {
  const m = 10 ** digits
  const v = x * m
  const f = Math.floor(v)
  const diff = v - f
  let r: number
  if (Math.abs(diff - 0.5) < 1e-12) r = f % 2 === 0 ? f : f + 1
  else r = Math.round(v)
  return r / m
}

/** np.unwrap of one series (discont = pi). */
export function unwrap(p: number[]): number[] {
  const out = p.slice()
  let correction = 0
  for (let i = 1; i < p.length; i++) {
    const dd = p[i] - p[i - 1]
    let ddmod = (((dd + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
    if (ddmod === -Math.PI && dd > 0) ddmod = Math.PI
    let phCorrect = ddmod - dd
    if (Math.abs(dd) < Math.PI) phCorrect = 0
    correction += phCorrect
    out[i] = p[i] + correction
  }
  return out
}

/** scipy.ndimage.gaussian_filter1d(x, sigma) with mode 'reflect' (half-sample symmetric), truncate 4. */
export function gaussianFilter1d(x: number[], sigma: number, truncate = 4): number[] {
  const n = x.length
  if (n === 0) return []
  const radius = Math.floor(truncate * sigma + 0.5)
  const w: number[] = []
  let sum = 0
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-0.5 * (k * k) / (sigma * sigma))
    w.push(v)
    sum += v
  }
  for (let k = 0; k < w.length; k++) w[k] /= sum
  const reflect = (k: number) => {
    const period = 2 * n
    let m = k % period
    if (m < 0) m += period
    return m < n ? m : period - m - 1
  }
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let k = -radius; k <= radius; k++) acc += w[k + radius] * x[reflect(i + k)]
    out[i] = acc
  }
  return out
}

/** np.gradient(x, h) with edge_order 1. */
export function gradient(x: number[], h: number): number[] {
  const n = x.length
  if (n < 2) return x.map(() => 0)
  const out = new Array<number>(n)
  out[0] = (x[1] - x[0]) / h
  out[n - 1] = (x[n - 1] - x[n - 2]) / h
  for (let i = 1; i < n - 1; i++) out[i] = (x[i + 1] - x[i - 1]) / (2 * h)
  return out
}

/** np.percentile(x, q) with linear interpolation. */
export function percentile(x: number[], q: number): number {
  if (x.length === 0) return NaN
  const s = [...x].sort((a, b) => a - b)
  const idx = (q / 100) * (s.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return s[lo] + (s[hi] - s[lo]) * (idx - lo)
}

/** scipy.signal.find_peaks(x, height, prominence, distance) (wlen None, no threshold/width). */
export function findPeaks(x: number[], opts: { height?: number; prominence?: number; distance?: number }): number[] {
  // _local_maxima_1d (plateau midpoints, edges excluded)
  let peaks: number[] = []
  let i = 1
  const iMax = x.length - 1
  while (i < iMax) {
    if (x[i - 1] < x[i]) {
      let ahead = i + 1
      while (ahead < iMax && x[ahead] === x[i]) ahead++
      if (x[ahead] < x[i]) {
        peaks.push(Math.floor((i + ahead - 1) / 2))
        i = ahead
      }
    }
    i++
  }
  if (opts.height !== undefined) peaks = peaks.filter((p) => x[p] >= opts.height!)
  if (opts.distance !== undefined) {
    const distance = Math.ceil(opts.distance)
    const keep = peaks.map(() => true)
    // highest priority first (stable for ties: later index = higher priority, like argsort + reverse scan)
    const order = peaks.map((_, k) => k).sort((a, b) => x[peaks[a]] - x[peaks[b]] || a - b)
    for (let r = order.length - 1; r >= 0; r--) {
      const j = order[r]
      if (!keep[j]) continue
      for (let k = j - 1; k >= 0 && peaks[j] - peaks[k] < distance; k--) keep[k] = false
      for (let k = j + 1; k < peaks.length && peaks[k] - peaks[j] < distance; k++) keep[k] = false
    }
    peaks = peaks.filter((_, k) => keep[k])
  }
  if (opts.prominence !== undefined) {
    peaks = peaks.filter((p) => {
      let leftMin = x[p]
      for (let k = p; k >= 0 && x[k] <= x[p]; k--) if (x[k] < leftMin) leftMin = x[k]
      let rightMin = x[p]
      for (let k = p; k < x.length && x[k] <= x[p]; k++) if (x[k] < rightMin) rightMin = x[k]
      return x[p] - Math.max(leftMin, rightMin) >= opts.prominence!
    })
  }
  return peaks
}

export interface MotionCurves {
  speed: number[]
  salience: number[]
  coverage: number[]
  eligible: boolean[]
  motionDelta: number[]
}

/** analyze.py motion(): bone-direction angular speed, braking, 0.3 s motion delta, eligibility. */
export function motion(frames: AnalyzeFrame[], width: number, height: number, fps: number): MotionCurves {
  const n = frames.length
  const nb = MOTION_BONES.length
  const angles: number[][] = MOTION_BONES.map(() => new Array<number>(n))
  const valid: boolean[][] = frames.map(() => new Array<boolean>(nb))
  frames.forEach((f, i) => {
    const p = new Map(f.keypoints.map((k) => [k.name, k]))
    MOTION_BONES.forEach(([a, b], j) => {
      const x = p.get(a)
      const y = p.get(b)
      if (!x || !y) {
        angles[j][i] = 0
        valid[i][j] = false
        return
      }
      angles[j][i] = Math.atan2((y.y - x.y) * height, (y.x - x.x) * width)
      valid[i][j] = Math.min(x.score, y.score) >= 0.5
    })
  })
  const smooth = angles.map((col) => gaussianFilter1d(unwrap(col), 1.2))
  const velocity = smooth.map((col) => gradient(col, 1 / fps))
  const coverage = valid.map((row) => row.filter(Boolean).length / nb)
  let speed = frames.map((_, i) => {
    let s = 0
    let c = 0
    for (let j = 0; j < nb; j++) {
      if (!valid[i][j]) continue
      s += Math.abs(velocity[j][i])
      c++
    }
    return s / Math.max(c, 1)
  })
  speed = gaussianFilter1d(speed, 1)
  let braking = gradient(speed, 1 / fps).map((v) => Math.max(0, -v))
  braking = gaussianFilter1d(braking, 1)
  const norm = (x: number[]) => {
    const d = Math.max(percentile(x, 90), 0.001)
    return x.map((v) => v / d)
  }
  const ns = norm(speed)
  const nbk = norm(braking)
  const salience = ns.map((v, i) => 0.55 * Math.min(v, 2) + 0.45 * Math.min(nbk[i], 2))
  const motionDelta = new Array<number>(n).fill(0)
  const step = Math.max(1, pyRound(0.3 * fps))
  for (let i = step; i < n; i++) {
    let s = 0
    for (let j = 0; j < nb; j++) s += Math.abs(smooth[j][i] - smooth[j][i - step]) * (valid[i][j] ? 1 : 0)
    motionDelta[i] = s / nb
  }
  const eligible = frames.map((_, i) => coverage[i] >= 0.75 && speed[i] >= 0.35 && motionDelta[i] >= 0.12)
  return { speed, salience, coverage, eligible, motionDelta }
}

export interface ChartEvent {
  time: number
  frame: number
  motionPeak: number
  audioAligned: boolean
  salience: number
  audioStrength: number
  confidence: number
  weight: number
}

/** analyze.py chart() without audio (muted: no onsets -> no snapping, audio strength 0). */
export function chartMotionOnly(frames: AnalyzeFrame[], width: number, height: number, fps: number): { events: ChartEvent[]; curves: MotionCurves } {
  const curves = motion(frames, width, height, fps)
  const { salience, coverage, eligible } = curves
  const peaks = findPeaks(salience, { height: 0.4, prominence: 0.12, distance: Math.max(1, pyRound(0.22 * fps)) })
  const candidates: ChartEvent[] = []
  const lastTime = frames[frames.length - 1]?.time ?? 0
  for (const i of peaks) {
    if (!eligible[i]) continue
    const j = i
    const t = frames[j].time
    if (t < 0.4 || t > lastTime - 0.25) continue
    const strength = 0
    candidates.push({
      time: pyRound(t, 6), frame: j, motionPeak: pyRound(frames[i].time, 6), audioAligned: false,
      salience: pyRound(salience[i], 4), audioStrength: pyRound(strength, 4), confidence: pyRound(coverage[j], 4),
      weight: salience[i] + 0.2 * Math.min(strength, 2),
    })
  }
  const selected: ChartEvent[] = []
  for (const e of [...candidates].sort((a, b) => b.weight - a.weight)) {
    if (selected.every((s) => Math.abs(e.time - s.time) >= 0.4)) selected.push(e)
  }
  selected.sort((a, b) => a.time - b.time)
  return { events: selected, curves }
}

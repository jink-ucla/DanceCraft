/**
 * dynamics-correlation — per-frame features on a uniform time grid.
 *
 * A pose becomes a small set of CHANNELS:
 * - angle channels: signed image-plane direction of a body segment (atan2 of the bone vector,
 *   isotropic pixels). Directions are scale / position invariant, keep genuine torso lean, and are
 *   signed (unlike unsigned joint angles, two different poses cannot collapse to one value).
 * - position channels: mid-shoulder x / y in torso lengths (whole-body travel: steps, bounces).
 *   Only their VELOCITY is used (absolute position depends on where the user stands).
 *
 * Sequences are resampled on a uniform grid (index j <-> time j * dt, absolute recording /
 * video clock), smoothed with a normalized Gaussian (missing samples do not count), and
 * differentiated with a central difference. Missing data is explicit: every channel sample has a
 * validity flag, every grid sample a `present` flag (a user frame with both shoulders tracked
 * exists close enough in time).
 */
import type { Keypoint } from '../../../../src/scoring/types'
import type { TimestampedPose } from '../../../../src/scoring/dtw'
import { KEYPOINT_NAMES } from '../../../../src/scoring/types'

export const NUM_KP = 33

export type Part = 'arms' | 'legs' | 'torso' | 'head' | 'root'

export interface ChannelDef {
  name: string
  kind: 'angle' | 'pos'
  /** Segment start = mean of these keypoints (angle channels) */
  from: number[]
  /** Segment end = mean of these keypoints (angle channels); position channels use `from` only */
  to: number[]
  /** Position channels: 0 = x, 1 = y */
  axis?: 0 | 1
  part: Part
}

const I = Object.fromEntries(KEYPOINT_NAMES.map((n, i) => [n, i])) as Record<string, number>

export const CHANNELS: ChannelDef[] = [
  { name: 'left_upper_arm', kind: 'angle', from: [I.left_shoulder], to: [I.left_elbow], part: 'arms' },
  { name: 'right_upper_arm', kind: 'angle', from: [I.right_shoulder], to: [I.right_elbow], part: 'arms' },
  { name: 'left_forearm', kind: 'angle', from: [I.left_elbow], to: [I.left_wrist], part: 'arms' },
  { name: 'right_forearm', kind: 'angle', from: [I.right_elbow], to: [I.right_wrist], part: 'arms' },
  { name: 'left_hand', kind: 'angle', from: [I.left_wrist], to: [I.left_index], part: 'arms' },
  { name: 'right_hand', kind: 'angle', from: [I.right_wrist], to: [I.right_index], part: 'arms' },
  { name: 'left_thigh', kind: 'angle', from: [I.left_hip], to: [I.left_knee], part: 'legs' },
  { name: 'right_thigh', kind: 'angle', from: [I.right_hip], to: [I.right_knee], part: 'legs' },
  { name: 'left_shin', kind: 'angle', from: [I.left_knee], to: [I.left_ankle], part: 'legs' },
  { name: 'right_shin', kind: 'angle', from: [I.right_knee], to: [I.right_ankle], part: 'legs' },
  { name: 'torso', kind: 'angle', from: [I.left_hip, I.right_hip], to: [I.left_shoulder, I.right_shoulder], part: 'torso' },
  { name: 'shoulder_line', kind: 'angle', from: [I.right_shoulder], to: [I.left_shoulder], part: 'torso' },
  { name: 'head', kind: 'angle', from: [I.left_shoulder, I.right_shoulder], to: [I.nose], part: 'head' },
  { name: 'body_x', kind: 'pos', from: [I.left_shoulder, I.right_shoulder], to: [], axis: 0, part: 'root' },
  { name: 'body_y', kind: 'pos', from: [I.left_shoulder, I.right_shoulder], to: [], axis: 1, part: 'root' },
]

export const NC = CHANNELS.length

/** Keypoint index permutation swapping left/right (mirror-style dancing). */
export const LR_SWAP: number[] = KEYPOINT_NAMES.map((name, i) => {
  let other: string = name
  if (name.startsWith('left_')) other = 'right_' + name.slice(5)
  else if (name.startsWith('right_')) other = 'left_' + name.slice(6)
  else if (name === 'mouth_left') other = 'mouth_right'
  else if (name === 'mouth_right') other = 'mouth_left'
  const j = I[other]
  return j === undefined ? i : j
})

/**
 * Canonical 33-keypoint arrays [x, y, confidence] (by index when names match MediaPipe order, else
 * by name). Coordinates are scaled by (sx, sy); mirror = flip x and swap left/right labels.
 */
function toArrays(kps: Keypoint[], sx: number, sy: number, mirror: boolean): [Float64Array, Float64Array, Float64Array] {
  const x = new Float64Array(NUM_KP)
  const y = new Float64Array(NUM_KP)
  const c = new Float64Array(NUM_KP)
  const ordered = kps.length >= NUM_KP && kps.every((k, i) => i >= NUM_KP || k.name === KEYPOINT_NAMES[i])
  const place = (k: Keypoint, i: number) => {
    const dst = mirror ? LR_SWAP[i] : i
    x[dst] = (mirror ? -k.x : k.x) * sx
    y[dst] = k.y * sy
    c[dst] = Number.isFinite(k.score) ? k.score : 0
  }
  if (ordered) {
    for (let i = 0; i < NUM_KP; i++) place(kps[i], i)
  } else {
    for (const k of kps) {
      const i = I[k.name]
      if (i !== undefined) place(k, i)
    }
  }
  return [x, y, c]
}

export interface FrameFeatures {
  t: number
  /** angle (rad) for angle channels, raw pixel coordinate for position channels */
  value: Float64Array
  valid: Uint8Array
  /** Segment length in pixels (angle channels) */
  length: Float64Array
  /** Both shoulders tracked */
  present: boolean
  /** Mid-shoulder to mid-hip distance (pixels), 0 if unavailable */
  torso: number
}

function mean(ix: number[], a: Float64Array): number {
  let s = 0
  for (const i of ix) s += a[i]
  return s / ix.length
}

function minConf(ix: number[], c: Float64Array): number {
  let m = Infinity
  for (const i of ix) m = Math.min(m, c[i])
  return m
}

export function frameFeatures(
  frame: TimestampedPose, sx: number, sy: number, mirror: boolean, visConf: number,
): FrameFeatures | null {
  const kps = frame.pose?.keypoints
  // Optional per-frame video clock (DanceMode may store pose.videoTime); falls back to the recording clock
  const vt = (frame.pose as { videoTime?: unknown } | undefined)?.videoTime
  const t = typeof vt === 'number' && Number.isFinite(vt) ? vt : frame.time
  if (!kps || kps.length === 0 || !Number.isFinite(t)) return null
  const [x, y, c] = toArrays(kps, sx, sy, mirror)
  const value = new Float64Array(NC)
  const valid = new Uint8Array(NC)
  const length = new Float64Array(NC)
  CHANNELS.forEach((ch, d) => {
    const ix = ch.kind === 'angle' ? [...ch.from, ...ch.to] : ch.from
    if (minConf(ix, c) < visConf) return
    if (ch.kind === 'angle') {
      const dx = mean(ch.to, x) - mean(ch.from, x)
      const dy = mean(ch.to, y) - mean(ch.from, y)
      const len = Math.hypot(dx, dy)
      if (!(len > 1e-9)) return
      value[d] = Math.atan2(dy, dx)
      length[d] = len
    } else {
      value[d] = ch.axis === 0 ? mean(ch.from, x) : mean(ch.from, y)
    }
    valid[d] = 1
  })
  const sh = [I.left_shoulder, I.right_shoulder]
  const hp = [I.left_hip, I.right_hip]
  const present = minConf(sh, c) >= visConf
  let torso = 0
  if (present && minConf(hp, c) >= visConf) {
    torso = Math.hypot(mean(sh, x) - mean(hp, x), mean(sh, y) - mean(hp, y))
  }
  return { t, value, valid, length, present, torso }
}

/** Pose sequence -> per-frame features (time sorted, frames without keypoints dropped). */
export function sequenceFeatures(
  seq: TimestampedPose[], sx: number, sy: number, mirror: boolean, visConf: number,
): FrameFeatures[] {
  const out: FrameFeatures[] = []
  for (const f of seq) {
    const ff = frameFeatures(f, sx, sy, mirror, visConf)
    if (ff) out.push(ff)
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

export function wrap(a: number): number {
  let r = a % (2 * Math.PI)
  if (r > Math.PI) r -= 2 * Math.PI
  else if (r < -Math.PI) r += 2 * Math.PI
  return r
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Uniform-grid stream. Sample k (0..n-1) is at time (start + k) * dt. Arrays are sample-major (k * NC + d). */
export interface Stream {
  dt: number
  start: number
  n: number
  /** Smoothed angle (rad) / position (torso lengths) */
  value: Float64Array
  valid: Uint8Array
  /** Velocity (rad/s or torso lengths/s), already multiplied by the foreshortening weight */
  vel: Float64Array
  vvalid: Uint8Array
  present: Uint8Array
  /** Session torso length in pixels (median), used to scale position channels */
  torso: number
}

export interface StreamOptions {
  dt: number
  /** Max time between two frames that may be interpolated (s) */
  maxGap: number
  /** One-sided hold: a frame may represent grid times this close (s) */
  hold: number
  /** Gaussian smoothing sigma (s) */
  smooth: number
  /** Central-difference half-span (s) */
  diffHalf: number
  /** Segments shorter than this fraction of their median length get proportionally less velocity weight */
  foreshorten: number
  /** Soft velocity compression v / sqrt(1 + (v / v0)^2): v0 for angle channels (rad/s), 0 = off */
  compressAngle: number
  /** Same for position channels (torso lengths / s) */
  compressPos: number
}

/**
 * Resample per-frame features on the grid [startIdx, endIdx) (indices of time / dt), smooth, differentiate.
 */
export function buildStream(frames: FrameFeatures[], startIdx: number, endIdx: number, o: StreamOptions): Stream {
  const n = Math.max(0, endIdx - startIdx)
  const { dt } = o
  // Session scales
  const torsos = frames.filter((f) => f.torso > 0).map((f) => f.torso)
  let torso = median(torsos)
  if (!(torso > 0)) {
    // fall back to 1.3 x shoulder width
    const sw: number[] = []
    for (const f of frames) {
      const d = CHANNELS.findIndex((c) => c.name === 'shoulder_line')
      if (f.valid[d]) sw.push(f.length[d])
    }
    torso = median(sw) * 1.3 || 1
  }
  const medLen = new Float64Array(NC)
  CHANNELS.forEach((ch, d) => {
    if (ch.kind !== 'angle') return
    const ls: number[] = []
    for (const f of frames) if (f.valid[d]) ls.push(f.length[d])
    medLen[d] = median(ls)
  })

  // 1) resample: unit vectors for angles (wrap-safe), values for positions, plus a length weight
  const cx = new Float64Array(n * NC)
  const cy = new Float64Array(n * NC)
  const lw = new Float64Array(n * NC)
  const has = new Uint8Array(n * NC)
  const present = new Uint8Array(n)
  let fi = 0
  for (let k = 0; k < n; k++) {
    const t = (startIdx + k) * dt
    while (fi < frames.length && frames[fi].t <= t) fi++
    const a = fi > 0 ? frames[fi - 1] : undefined // last frame <= t
    const b = fi < frames.length ? frames[fi] : undefined // first frame > t
    const span = a && b ? b.t - a.t : Infinity
    const useA = a && t - a.t <= o.hold
    const useB = b && b.t - t <= o.hold
    const interp = !!(a && b && span <= o.maxGap)
    if (!interp && !useA && !useB) continue
    // presence
    if (interp) present[k] = a!.present || b!.present ? 1 : 0
    else present[k] = (useA && a!.present) || (useB && b!.present) ? 1 : 0
    const alpha = interp ? (t - a!.t) / Math.max(1e-9, span) : 0
    for (let d = 0; d < NC; d++) {
      const ch = CHANNELS[d]
      const va = !!a && a.valid[d] === 1
      const vb = !!b && b.valid[d] === 1
      let val: number
      let len: number
      if (interp && va && vb) {
        if (ch.kind === 'angle') {
          val = a!.value[d] + alpha * wrap(b!.value[d] - a!.value[d])
        } else {
          val = a!.value[d] + alpha * (b!.value[d] - a!.value[d])
        }
        len = a!.length[d] + alpha * (b!.length[d] - a!.length[d])
      } else if (va && (useA || (interp && alpha <= 0.5 && t - a!.t <= o.hold))) {
        val = a!.value[d]
        len = a!.length[d]
      } else if (vb && (useB || (interp && alpha > 0.5 && b!.t - t <= o.hold))) {
        val = b!.value[d]
        len = b!.length[d]
      } else {
        continue
      }
      const idx = k * NC + d
      has[idx] = 1
      if (ch.kind === 'angle') {
        cx[idx] = Math.cos(val)
        cy[idx] = Math.sin(val)
        lw[idx] = medLen[d] > 0 ? Math.min(1, len / (o.foreshorten * medLen[d])) : 1
      } else {
        cx[idx] = val / torso
        lw[idx] = 1
      }
    }
  }

  // 2) normalized Gaussian smoothing (only valid samples count; output only where the centre is valid)
  const sig = o.smooth / dt
  const rad = Math.max(0, Math.ceil(2.5 * sig))
  const kern = new Float64Array(2 * rad + 1)
  for (let i = -rad; i <= rad; i++) kern[i + rad] = sig > 0 ? Math.exp(-(i * i) / (2 * sig * sig)) : i === 0 ? 1 : 0
  const value = new Float64Array(n * NC)
  const valid = new Uint8Array(n * NC)
  const wsm = new Float64Array(n * NC)
  for (let d = 0; d < NC; d++) {
    const isAngle = CHANNELS[d].kind === 'angle'
    for (let k = 0; k < n; k++) {
      const idx = k * NC + d
      if (!has[idx]) continue
      let sx = 0
      let sy = 0
      let sl = 0
      let sw = 0
      const lo = Math.max(0, k - rad)
      const hi = Math.min(n - 1, k + rad)
      for (let m = lo; m <= hi; m++) {
        const j = m * NC + d
        if (!has[j]) continue
        const w = kern[m - k + rad]
        sx += w * cx[j]
        sy += w * cy[j]
        sl += w * lw[j]
        sw += w
      }
      if (sw <= 0) continue
      valid[idx] = 1
      value[idx] = isAngle ? Math.atan2(sy, sx) : sx / sw
      wsm[idx] = sl / sw
    }
  }

  // 3) central-difference velocity
  const h = Math.max(1, Math.round(o.diffHalf / dt))
  const vel = new Float64Array(n * NC)
  const vvalid = new Uint8Array(n * NC)
  for (let d = 0; d < NC; d++) {
    const isAngle = CHANNELS[d].kind === 'angle'
    for (let k = h; k < n - h; k++) {
      const i0 = (k - h) * NC + d
      const i1 = (k + h) * NC + d
      const ic = k * NC + d
      if (!valid[i0] || !valid[i1] || !valid[ic]) continue
      const diff = isAngle ? wrap(value[i1] - value[i0]) : value[i1] - value[i0]
      let v = (diff / (2 * h * dt)) * wsm[ic]
      const v0 = isAngle ? o.compressAngle : o.compressPos
      if (v0 > 0) v = v / Math.sqrt(1 + (v / v0) * (v / v0))
      vel[ic] = v
      vvalid[ic] = 1
    }
  }
  return { dt, start: startIdx, n, value, valid, vel, vvalid, present, torso }
}

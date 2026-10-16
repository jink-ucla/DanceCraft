/**
 * Faithful TypeScript port of the scoring parts of Codex's pulse-party prototype
 * (C:/Users/jink/groovy/experiments/pulse-party/core.mjs): shared canonical skeleton
 * (canonicalize), mirrorPose, key-point Euclidean distance (keypointDistance), nearest-frame
 * sample(), prepareReference(), bone-direction motion and the bounded-time PulseJudge
 * (feed / advance / summary). Constants, thresholds and control flow are unchanged; only types
 * were added. Replay-only helpers (BodyCalibration, fitReference, corrections) are not ported.
 *
 * Input coordinates must be isotropic pixels, never independent normalized x/y.
 */
import type { JointAngle, Pose } from '../../baseline/scoring/types'
import type { CompareOptions } from '../../baseline/scoring/comparison'

export interface Kp {
  x: number
  y: number
  score: number
  name: string
}

export interface PosePx {
  keypoints: Kp[]
}

/** [start, end, canonical length in torso units] */
export const BONES: [string, string, number][] = [
  ['left_shoulder', 'left_elbow', 0.8], ['left_elbow', 'left_wrist', 0.7],
  ['right_shoulder', 'right_elbow', 0.8], ['right_elbow', 'right_wrist', 0.7],
  ['left_hip', 'left_knee', 1], ['left_knee', 'left_ankle', 0.95],
  ['right_hip', 'right_knee', 1], ['right_knee', 'right_ankle', 0.95],
  ['left_wrist', 'left_index', 0.18], ['right_wrist', 'right_index', 0.18],
  ['left_ankle', 'left_foot_index', 0.3], ['right_ankle', 'right_foot_index', 0.3],
]

export function pixelPose(frame: { keypoints: Kp[] }, width: number, height: number): PosePx {
  return { keypoints: frame.keypoints.map((k) => ({ ...k, x: k.x * width, y: k.y * height })) }
}

export function canonicalize(pose: PosePx | null | undefined): PosePx | null {
  if (!pose?.keypoints?.length) return null
  const src = new Map(pose.keypoints.map((k) => [k.name, k]))
  const ls = src.get('left_shoulder')
  const rs = src.get('right_shoulder')
  const lh = src.get('left_hip')
  const rh = src.get('right_hip')
  if ([ls, rs, lh, rh].some((p) => !p || p.score < 0.5 || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null
  const LS = ls!
  const RS = rs!
  const LH = lh!
  const RH = rh!
  const root = { x: (LH.x + RH.x) / 2, y: (LH.y + RH.y) / 2 }
  const sx = (LS.x + RS.x) / 2 - root.x
  const sy = (LS.y + RS.y) / 2 - root.y
  const scale = Math.hypot(sx, sy)
  if (scale < 1e-6) return null
  const out = new Map<string, Kp>(pose.keypoints.map((k) => [k.name, { ...k, x: (k.x - root.x) / scale, y: (k.y - root.y) / scale }]))
  function base(a: Kp, b: Kp, cx: number, cy: number, width: number): boolean {
    const dx = a.x - b.x
    const dy = a.y - b.y
    const mag = Math.hypot(dx, dy)
    if (mag < 1e-6) return false
    out.set(a.name, { ...a, x: cx + (dx / mag) * width / 2, y: cy + (dy / mag) * width / 2 })
    out.set(b.name, { ...b, x: cx - (dx / mag) * width / 2, y: cy - (dy / mag) * width / 2 })
    return true
  }
  if (!base(LS, RS, sx / scale, sy / scale, 0.75) || !base(LH, RH, 0, 0, 0.55)) return null
  const nose = src.get('nose')
  if (nose) {
    const dx = nose.x - (LS.x + RS.x) / 2
    const dy = nose.y - (LS.y + RS.y) / 2
    const mag = Math.hypot(dx, dy)
    out.set('nose', {
      ...nose,
      x: sx / scale + (mag > 1e-6 ? (dx / mag) * 0.5 : 0),
      y: sy / scale + (mag > 1e-6 ? (dy / mag) * 0.5 : 0),
      score: mag > 1e-6 ? nose.score : 0,
    })
  }
  for (const [a, b, len] of BONES) {
    const pa = src.get(a)
    const pb = src.get(b)
    const anchor = out.get(a)
    if (!pa || !pb || !anchor) continue
    const dx = pb.x - pa.x
    const dy = pb.y - pa.y
    const mag = Math.hypot(dx, dy)
    const valid = mag > 1e-6 && Number.isFinite(mag)
    out.set(b, {
      ...pb,
      x: anchor.x + (valid ? (dx / mag) * len : 0),
      y: anchor.y + (valid ? (dy / mag) * len : 0),
      score: valid ? Math.min(anchor.score, pa.score, pb.score) : 0,
    })
  }
  return { keypoints: [...out.values()] }
}

export function mirrorPose(pose: PosePx, width: number): PosePx {
  return {
    keypoints: pose.keypoints.map((k) => ({
      ...k,
      x: width - k.x,
      name: k.name.startsWith('left_') ? k.name.replace('left_', 'right_') : k.name.startsWith('right_') ? k.name.replace('right_', 'left_') : k.name,
    })),
  }
}

/** [name, base weight]: hand tips 2.5, foot tips 2, elbows / knees 1, head centre 0.75 */
export const KEY_POINTS: [string, number][] = [
  ['left_index', 2.5], ['right_index', 2.5], ['left_foot_index', 2], ['right_foot_index', 2],
  ['left_elbow', 1], ['right_elbow', 1], ['left_knee', 1], ['right_knee', 1], ['nose', 0.75],
]

export interface DistanceRow {
  name: string
  distance: number
  weight: number
  similarity: number
}

export interface DistanceResult {
  score: number
  coverage: number
  rms: number | null
  points: DistanceRow[]
}

export function keypointDistance(reference: PosePx, user: PosePx, focus: string[] = []): DistanceResult {
  const a = new Map(reference.keypoints.map((k) => [k.name, k]))
  const b = new Map(user.keypoints.map((k) => [k.name, k]))
  const rows: DistanceRow[] = []
  for (const [name, weight] of KEY_POINTS) {
    const x = a.get(name)
    const y = b.get(name)
    if (!x || !y || Math.min(x.score, y.score) < 0.5) continue
    const focused = focus.some((j) => name.startsWith(j.split('_')[0] + '_') && (/hip|knee|ankle/.test(j) ? /knee|foot/.test(name) : /index|elbow/.test(name)))
    const d = Math.hypot(x.x - y.x, x.y - y.y)
    const w = weight * (focused ? 2 : 1)
    const similarity = Math.max(0, 1 - Math.pow(Math.max(0, d - 0.06) / 0.7, 2))
    rows.push({ name, distance: d, weight: w, similarity })
  }
  const total = rows.reduce((n, r) => n + r.weight, 0)
  const mean = total ? rows.reduce((n, r) => n + r.weight * r.similarity, 0) / total : 0
  const worst = [...rows].sort((p, q) => p.similarity - q.similarity).slice(0, 3)
  return {
    score: 0.65 * mean + 0.35 * (worst.length ? worst.reduce((n, r) => n + r.similarity, 0) / worst.length : 0),
    coverage: rows.length / KEY_POINTS.length,
    rms: total ? Math.sqrt(rows.reduce((n, r) => n + r.weight * r.distance * r.distance, 0) / total) : null,
    points: rows,
  }
}

export interface TimedPose {
  time: number
  pose: PosePx | null
}

export function sample<T extends { time: number }>(frames: T[], time: number): T | null {
  if (!frames.length) return null
  const dt = frames.length > 1 ? frames[1].time - frames[0].time : 1 / 30
  let i = Math.max(0, Math.min(frames.length - 1, Math.round(time / dt)))
  // Imported timelines start at zero and are uniform, but handle other inputs too.
  while (i > 0 && Math.abs(frames[i - 1].time - time) < Math.abs(frames[i].time - time)) i--
  while (i + 1 < frames.length && Math.abs(frames[i + 1].time - time) < Math.abs(frames[i].time - time)) i++
  return frames[i]
}

export interface PulseEventInput {
  time: number
  [key: string]: unknown
}

export interface PulseEvent extends PulseEventInput {
  index: number
  pose: PosePx
  before: PosePx
  velocity: Record<string, number>
  boneChange: Record<string, number>
  focus: string[]
  motionWindow: number
}

export interface PulseData {
  width: number
  height: number
  frames: { time: number; keypoints: Kp[] }[]
  events: PulseEventInput[]
}

export type ExtractAngles = (pose: Pose) => JointAngle[]

export function prepareReference(data: PulseData, extractAngles: ExtractAngles): { frames: TimedPose[]; events: PulseEvent[] } {
  const frames: TimedPose[] = data.frames.map((f) => ({ time: f.time, pose: canonicalize(pixelPose(f, data.width, data.height)) }))
  const events = data.events.filter((e) => sample(frames, e.time)?.pose && sample(frames, e.time - 0.3)?.pose).map((e, i) => {
    const end = sample(frames, e.time)!
    const before = sample(frames, e.time - 0.3)!
    const starts = extractAngles(before.pose as Pose)
    const ends = extractAngles(end.pose as Pose)
    const velocity = Object.fromEntries(ends.map((a) => [a.name, a.angle - (starts.find((b) => b.name === a.name)?.angle ?? a.angle)]))
    const focus = Object.entries(velocity).filter(([, v]) => Math.abs(v) >= 0.15).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 4).map(([k]) => k)
    return {
      ...e, index: i, pose: end.pose!, before: before.pose!, velocity, boneChange: boneChanges(before.pose!, end.pose!), focus,
      motionWindow: end.time - before.time,
    }
  })
  return { frames, events }
}

function boneChanges(before: PosePx, after: PosePx): Record<string, number> {
  const a = new Map(before.keypoints.map((k) => [k.name, k]))
  const b = new Map(after.keypoints.map((k) => [k.name, k]))
  const changes: Record<string, number> = {}
  for (const [start, end] of BONES.slice(0, 8)) {
    const points = [a.get(start), a.get(end), b.get(start), b.get(end)]
    if (points.some((p) => !p || p.score < 0.5)) continue
    const [as, ae, bs, be] = points as Kp[]
    const diff = Math.atan2(be.y - bs.y, be.x - bs.x) - Math.atan2(ae.y - as.y, ae.x - as.x)
    changes[end] = Math.atan2(Math.sin(diff), Math.cos(diff))
  }
  return changes
}

function boneMotion(expected: Record<string, number>, before: PosePx, after: PosePx): number | null {
  const actual = boneChanges(before, after)
  let total = 0
  let n = 0
  for (const [name, e] of Object.entries(expected)) {
    if (Math.abs(e) < 0.12) continue
    n++
    const v = actual[name]
    if (v === undefined || e * v <= 0) continue
    total += Math.min(Math.abs(e), Math.abs(v)) / Math.max(Math.abs(e), Math.abs(v))
  }
  return n ? total / n : null
}

function interpolateHistory(history: TimedPose[], time: number): PosePx | null {
  let before: TimedPose | null = null
  let after: TimedPose | null = null
  for (const f of history) {
    if (f.time <= time) before = f
    if (f.time >= time) {
      after = f
      break
    }
  }
  if (before && Math.abs(before.time - time) < 1e-6) return before.pose
  if (!before || !after || !before.pose || !after.pose || after.time - before.time > 0.12) return null
  const alpha = (time - before.time) / (after.time - before.time)
  const other = new Map(after.pose.keypoints.map((k) => [k.name, k]))
  return {
    keypoints: before.pose.keypoints.map((a) => {
      const b = other.get(a.name)
      return b ? { ...a, x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, score: Math.min(a.score, b.score) } : { ...a, score: 0 }
    }),
  }
}

export interface PulseApi {
  comparePoses: (reference: Pose, user: Pose, options?: CompareOptions) => { overallScore: number }
  compareMoveVelocity: (expected: Record<string, number>, before: Pose, after: Pose, focusJoints?: string[]) => number
  checkPresence: (pose: Pose | null) => { present: boolean }
}

export interface PulseJudgeOptions {
  window?: number
  perfect?: number
  good?: number
}

export type PulseRating = 'PERFECT' | 'GOOD' | 'MISS' | 'TRACKING LOST'

interface EventState {
  best: number
  seen: number
  samples: number
  done: boolean
  bestTime?: number
  shape?: number
  motion?: number
}

export interface PulseResult {
  index: number
  time: number
  referenceTimestamp: number
  rating: PulseRating
  points: number
  similarity: number
  tracked: boolean
  bestTime: number | null
  shape: number
  motion: number
}

export interface PulseSummary {
  points: number
  maximum: number
  combo: number
  bestCombo: number
  judged: number
  total: number
  tracking: number
  ratings: Record<PulseRating, number>
}

export class PulseJudge {
  events: PulseEvent[]
  api: PulseApi
  window: number
  perfect: number
  good: number
  states: EventState[]
  history: TimedPose[]
  results: PulseResult[]
  lastTime: number

  constructor(events: PulseEvent[], { comparePoses, compareMoveVelocity, checkPresence }: PulseApi, options: PulseJudgeOptions = {}) {
    this.events = events
    this.api = { comparePoses, compareMoveVelocity, checkPresence }
    this.window = options.window ?? 0.16
    this.perfect = options.perfect ?? 0.86
    this.good = options.good ?? 0.62
    this.states = events.map(() => ({ best: 0, seen: 0, samples: 0, done: false }))
    this.history = []
    this.results = []
    this.lastTime = -Infinity
  }

  feed(time: number, pose: PosePx | null): PulseResult[] {
    if (!Number.isFinite(time) || time < this.lastTime) return []
    this.lastTime = time
    const valid = this.api.checkPresence(pose as Pose | null).present
    this.history.push({ time, pose: valid ? pose : null })
    this.history = this.history.filter((f) => f.time >= time - 1.1)
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i]
      const s = this.states[i]
      if (s.done || Math.abs(time - event.time) > this.window) continue
      s.samples++
      if (!valid) continue
      // Reconstruct the pulse instant between close, valid frames. This keeps the
      // same dance stable at 15-30Hz without bridging a camera tracking dropout.
      const candidates: { time: number; pose: PosePx }[] = [{ time, pose: pose! }]
      if (time >= event.time) {
        const exact = interpolateHistory(this.history, event.time)
        if (exact) candidates.push({ time: event.time, pose: exact })
      }
      for (const candidate of candidates) {
        const distance = keypointDistance(event.pose, candidate.pose, event.focus)
        if (distance.coverage < 0.6) continue
        s.seen++
        const before = interpolateHistory(this.history, candidate.time - event.motionWindow)
        const angular = Object.values(event.velocity).some((v) => Math.abs(v) >= 0.15)
        const directional = Object.values(event.boneChange ?? {}).some((v) => Math.abs(v) >= 0.12)
        const hasMotion = angular || directional
        let motion = hasMotion ? 0 : 1
        if (hasMotion && before) {
          const angleScore = angular ? this.api.compareMoveVelocity(event.velocity, before as Pose, candidate.pose as Pose, event.focus) : null
          const directionScore = directional ? boneMotion(event.boneChange, before, candidate.pose) : null
          motion = angleScore === null ? (directionScore ?? 0) : directionScore === null ? angleScore : 0.35 * angleScore + 0.65 * directionScore
        }
        const angles = this.api.comparePoses(event.pose as Pose, candidate.pose as Pose, { focusJoints: event.focus }).overallScore
        const shape = 0.7 * distance.score + 0.3 * angles
        const score = shape * (hasMotion ? 0.25 + 0.75 * motion : 1)
        if (score > s.best) {
          s.best = score
          s.bestTime = candidate.time
          s.shape = shape
          s.motion = motion
        }
      }
    }
    return this.advance(time)
  }

  advance(time: number): PulseResult[] {
    const fresh: PulseResult[] = []
    this.events.forEach((e, i) => {
      const s = this.states[i]
      if (s.done || time <= e.time + this.window) return
      s.done = true
      const rating: PulseRating = s.seen === 0 ? 'TRACKING LOST' : s.best >= this.perfect ? 'PERFECT' : s.best >= this.good ? 'GOOD' : 'MISS'
      const result: PulseResult = {
        index: i, time: e.time, referenceTimestamp: e.time, rating,
        points: rating === 'PERFECT' ? 100 : rating === 'GOOD' ? 60 : 0,
        similarity: s.best, tracked: s.seen > 0, bestTime: s.bestTime ?? null, shape: s.shape ?? 0, motion: s.motion ?? 0,
      }
      this.results.push(result)
      fresh.push(result)
    })
    return fresh
  }

  summary(): PulseSummary {
    let combo = 0
    let bestCombo = 0
    for (const r of this.results) {
      combo = r.points ? combo + 1 : 0
      bestCombo = Math.max(bestCombo, combo)
    }
    const ratings = Object.fromEntries((['PERFECT', 'GOOD', 'MISS', 'TRACKING LOST'] as PulseRating[]).map((k) => [k, this.results.filter((r) => r.rating === k).length])) as Record<PulseRating, number>
    return {
      points: this.results.reduce((n, r) => n + r.points, 0),
      maximum: this.events.length * 100,
      combo,
      bestCombo,
      judged: this.results.length,
      total: this.events.length,
      tracking: this.results.filter((r) => r.tracked).length,
      ratings,
    }
  }
}

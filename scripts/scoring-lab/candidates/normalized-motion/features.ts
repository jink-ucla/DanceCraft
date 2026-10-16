/**
 * normalized-motion — per-frame features.
 *
 * Every frame becomes a set of BONE DIRECTIONS (unit vectors in isotropic pixels): torso lean,
 * shoulder line, head, upper arms, forearms, hands, thighs, shins, feet. Directions are invariant
 * to position, scale and body proportions (the "canonical skeleton": bone lengths equalized),
 * keep genuine torso lean, and need no torso frame — so arms are still scored when the hips are
 * out of frame. Reference coordinates are 0-1 per axis and must be multiplied by the reference
 * video geometry first (x * width, y * height); user coordinates are webcam pixels.
 *
 * Per frame we also store a MOTION vector: the signed rotation of every bone over the preceding
 * MOTION window (seconds), so "is the user moving like the dancer right now" is one vector
 * comparison.
 */
import type { Pose } from '../../../../src/scoring/types'
import { KEYPOINT_NAMES } from '../../../../src/scoring/types'

export interface Geometry {
  width: number
  height: number
}

export type BodyPart = 'torso' | 'arms' | 'legs'

export interface BoneDef {
  name: string
  part: BodyPart
  /** Relative importance in the pose score */
  weight: number
  /** Keypoint indices averaged for the start / end of the bone (all must be visible) */
  from: number[]
  to: number[]
  /** Direction of this bone in a neutral standing pose (image coords, y down) */
  nx: number
  ny: number
  /** True for the main limb bones used to decide whether a body part is tracked */
  main: boolean
}

const K = Object.fromEntries(KEYPOINT_NAMES.map((n, i) => [n, i])) as Record<string, number>

/** Keypoint index permutation that swaps left/right labels (mirror-style dancers). */
export const SWAP_LR: number[] = KEYPOINT_NAMES.map((name, i) => {
  const other = name.includes('left') ? name.replace('left', 'right') : name.includes('right') ? name.replace('right', 'left') : name
  return K[other] ?? i
})

const DOWN = { nx: 0, ny: 1 }
const UP = { nx: 0, ny: -1 }

/** Bone list. Weights: arms carry most of a dance's information, legs next, torso/head little. */
export const BONES: BoneDef[] = [
  { name: 'torso', part: 'torso', weight: 0.6, from: [K.left_hip, K.right_hip], to: [K.left_shoulder, K.right_shoulder], ...UP, main: false },
  { name: 'shoulders', part: 'torso', weight: 0.3, from: [K.right_shoulder], to: [K.left_shoulder], nx: 1, ny: 0, main: false },
  { name: 'head', part: 'torso', weight: 0.3, from: [K.left_shoulder, K.right_shoulder], to: [K.nose], ...UP, main: false },
  { name: 'left_upper_arm', part: 'arms', weight: 1, from: [K.left_shoulder], to: [K.left_elbow], ...DOWN, main: true },
  { name: 'right_upper_arm', part: 'arms', weight: 1, from: [K.right_shoulder], to: [K.right_elbow], ...DOWN, main: true },
  { name: 'left_forearm', part: 'arms', weight: 1, from: [K.left_elbow], to: [K.left_wrist], ...DOWN, main: true },
  { name: 'right_forearm', part: 'arms', weight: 1, from: [K.right_elbow], to: [K.right_wrist], ...DOWN, main: true },
  { name: 'left_hand', part: 'arms', weight: 0.3, from: [K.left_wrist], to: [K.left_index], ...DOWN, main: false },
  { name: 'right_hand', part: 'arms', weight: 0.3, from: [K.right_wrist], to: [K.right_index], ...DOWN, main: false },
  { name: 'left_thigh', part: 'legs', weight: 0.8, from: [K.left_hip], to: [K.left_knee], ...DOWN, main: true },
  { name: 'right_thigh', part: 'legs', weight: 0.8, from: [K.right_hip], to: [K.right_knee], ...DOWN, main: true },
  { name: 'left_shin', part: 'legs', weight: 0.8, from: [K.left_knee], to: [K.left_ankle], ...DOWN, main: true },
  { name: 'right_shin', part: 'legs', weight: 0.8, from: [K.right_knee], to: [K.right_ankle], ...DOWN, main: true },
  { name: 'left_foot', part: 'legs', weight: 0.2, from: [K.left_ankle], to: [K.left_foot_index], ...DOWN, main: false },
  { name: 'right_foot', part: 'legs', weight: 0.2, from: [K.right_ankle], to: [K.right_foot_index], ...DOWN, main: false },
]

export const NB = BONES.length
export const BONE_WEIGHTS = Float64Array.from(BONES.map((b) => b.weight))

/** Flat per-frame feature arrays (frame f, bone b at index f * NB + b). */
export interface FeatureSet {
  n: number
  times: Float64Array
  /** Unit bone direction */
  dx: Float64Array
  dy: Float64Array
  vis: Uint8Array
  /** Index of the frame in the caller's array */
  src: Int32Array
  /** Signed bone rotation (rad) over the preceding motion window */
  mot: Float64Array
  motVis: Uint8Array
  /** 1 when a frame ~MOTION window earlier exists */
  hasMot: Uint8Array
}

export interface ExtractOptions {
  /** Multiply x / y by these (reference geometry restore); default 1 */
  sx?: number
  sy?: number
  /** Mirror-style: flip x and swap left/right labels */
  mirror?: boolean
  /** Minimum keypoint confidence for a bone endpoint */
  minConfidence: number
  /** Motion window (s) and how far the earlier frame may be from its ideal time (s) */
  motionWindow: number
  motionTolerance: number
}

interface RawFrame {
  time: number
  src: number
  x: Float64Array
  y: Float64Array
  c: Float64Array
}

function rawFrame(pose: Pose | undefined | null, time: number, src: number, o: ExtractOptions): RawFrame | null {
  const kps = pose?.keypoints
  if (!kps || kps.length === 0 || !Number.isFinite(time)) return null
  const x = new Float64Array(33)
  const y = new Float64Array(33)
  const c = new Float64Array(33)
  const sx = o.sx ?? 1
  const sy = o.sy ?? 1
  for (let k = 0; k < kps.length; k++) {
    const kp = kps[k]
    const idx = kp.name === KEYPOINT_NAMES[k] ? k : K[kp.name]
    if (idx === undefined) continue
    if (!Number.isFinite(kp.x) || !Number.isFinite(kp.y) || !Number.isFinite(kp.score)) continue
    const dst = o.mirror ? SWAP_LR[idx] : idx
    x[dst] = (o.mirror ? -kp.x : kp.x) * sx
    y[dst] = kp.y * sy
    c[dst] = kp.score
  }
  return { time, src, x, y, c }
}

/** Build features for a pose sequence. Frames without a single visible bone are dropped. */
export function extractFeatures(seq: { time: number; pose: Pose }[], o: ExtractOptions): FeatureSet {
  const raws: RawFrame[] = []
  for (let i = 0; i < seq.length; i++) {
    const r = rawFrame(seq[i]?.pose, seq[i]?.time, i, o)
    if (r) raws.push(r)
  }
  raws.sort((a, b) => a.time - b.time || a.src - b.src)

  const dxs: number[] = []
  const dys: number[] = []
  const viss: number[] = []
  const kept: RawFrame[] = []
  const bdx = new Float64Array(NB)
  const bdy = new Float64Array(NB)
  const bvis = new Uint8Array(NB)
  for (const r of raws) {
    let any = 0
    for (let b = 0; b < NB; b++) {
      const bone = BONES[b]
      bvis[b] = 0
      bdx[b] = 0
      bdy[b] = 0
      let ok = true
      let ax = 0
      let ay = 0
      for (const k of bone.from) {
        if (r.c[k] < o.minConfidence) ok = false
        ax += r.x[k]
        ay += r.y[k]
      }
      let ex = 0
      let ey = 0
      for (const k of bone.to) {
        if (r.c[k] < o.minConfidence) ok = false
        ex += r.x[k]
        ey += r.y[k]
      }
      if (!ok) continue
      const vx = ex / bone.to.length - ax / bone.from.length
      const vy = ey / bone.to.length - ay / bone.from.length
      const mag = Math.hypot(vx, vy)
      if (!(mag > 1e-9)) continue
      bdx[b] = vx / mag
      bdy[b] = vy / mag
      bvis[b] = 1
      any++
    }
    if (any === 0) continue
    kept.push(r)
    for (let b = 0; b < NB; b++) {
      dxs.push(bdx[b])
      dys.push(bdy[b])
      viss.push(bvis[b])
    }
  }

  const n = kept.length
  const fs: FeatureSet = {
    n,
    times: Float64Array.from(kept.map((r) => r.time)),
    dx: Float64Array.from(dxs),
    dy: Float64Array.from(dys),
    vis: Uint8Array.from(viss),
    src: Int32Array.from(kept.map((r) => r.src)),
    mot: new Float64Array(n * NB),
    motVis: new Uint8Array(n * NB),
    hasMot: new Uint8Array(n),
  }
  computeMotion(fs, o.motionWindow, o.motionTolerance)
  return fs
}

/** Signed bone rotations over the preceding window (nearest earlier frame within tolerance). */
function computeMotion(fs: FeatureSet, window: number, tolerance: number): void {
  let p = 0
  for (let f = 0; f < fs.n; f++) {
    const target = fs.times[f] - window
    while (p + 1 < f && fs.times[p + 1] <= target) p++
    let best = -1
    let gap = Infinity
    for (const q of [p, p + 1]) {
      if (q < 0 || q >= f) continue
      const d = Math.abs(fs.times[q] - target)
      if (d < gap) {
        gap = d
        best = q
      }
    }
    if (best < 0 || gap > tolerance) continue
    fs.hasMot[f] = 1
    for (let b = 0; b < NB; b++) {
      const i1 = f * NB + b
      const i0 = best * NB + b
      if (!fs.vis[i1] || !fs.vis[i0]) continue
      const cross = fs.dx[i0] * fs.dy[i1] - fs.dy[i0] * fs.dx[i1]
      const dot = fs.dx[i0] * fs.dx[i1] + fs.dy[i0] * fs.dy[i1]
      fs.mot[i1] = Math.atan2(cross, dot)
      fs.motVis[i1] = 1
    }
  }
}

/** First index with times[idx] >= t. */
export function lowerBound(times: Float64Array, t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First index with times[idx] > t. */
export function upperBound(times: Float64Array, t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

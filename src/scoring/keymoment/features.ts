/**
 * keymoment-hits â€” per-frame pose features.
 *
 * Every frame is reduced to the image-plane DIRECTIONS of 10 body segments (unit vectors in
 * isotropic pixels). Directions do not depend on where the person stands, how large they are in
 * the frame or how long their limbs are (bone lengths are implicitly equalized), but they keep
 * genuine torso lean. Signed directions (not unsigned joint angles) avoid the acos ambiguity of
 * the legacy joint-angle score.
 *
 * Geometry: reference keypoints are normalized per axis (x / videoWidth, y / videoHeight), so
 * they are first restored to pixels (x * width, y * height). User keypoints are webcam pixels.
 */
import type { Keypoint } from '../types'
import type { TimestampedPose } from '../dtw'
import { KEYPOINT_NAMES } from '../types'

export type Part = 'arms' | 'legs' | 'torso'
export const PARTS: Part[] = ['arms', 'legs', 'torso']

export interface BoneDef {
  name: string
  /** Keypoint index (33 = mid-hip, 34 = mid-shoulder) */
  a: number
  b: number
  weight: number
  part: Part
}

const MID_HIP = 33
const MID_SHOULDER = 34

/**
 * Scored body segments and their weights. Hands (wrist -> index) and feet are left out: they are
 * the noisiest landmarks and the legacy wrist joint was almost free (91% for random pairs).
 * Part shares follow from the weights: arms 4.0 (51%), legs 2.8 (36%), torso 1.0 (13%).
 */
export const BONES: BoneDef[] = [
  { name: 'left_upper_arm', a: 11, b: 13, weight: 1, part: 'arms' },
  { name: 'left_forearm', a: 13, b: 15, weight: 1, part: 'arms' },
  { name: 'right_upper_arm', a: 12, b: 14, weight: 1, part: 'arms' },
  { name: 'right_forearm', a: 14, b: 16, weight: 1, part: 'arms' },
  { name: 'left_thigh', a: 23, b: 25, weight: 0.7, part: 'legs' },
  { name: 'left_shin', a: 25, b: 27, weight: 0.7, part: 'legs' },
  { name: 'right_thigh', a: 24, b: 26, weight: 0.7, part: 'legs' },
  { name: 'right_shin', a: 26, b: 28, weight: 0.7, part: 'legs' },
  { name: 'torso', a: MID_HIP, b: MID_SHOULDER, weight: 0.6, part: 'torso' },
  { name: 'shoulders', a: 11, b: 12, weight: 0.4, part: 'torso' },
]
export const NB = BONES.length
export const BONE_PART: number[] = BONES.map((b) => PARTS.indexOf(b.part))
export const BONE_WEIGHT: Float64Array = Float64Array.from(BONES.map((b) => b.weight))
export const NP = PARTS.length

/** Keypoint confidence below which a landmark counts as not tracked (same as extractJointAngles). */
export const MIN_CONFIDENCE = 0.3

const KP_INDEX = new Map<string, number>(KEYPOINT_NAMES.map((n, i) => [n, i]))

/** Index permutation swapping left/right landmarks (mirror-style performance). */
const LR_SWAP: number[] = KEYPOINT_NAMES.map((name, i) => {
  const other = name.startsWith('left_')
    ? 'right_' + name.slice(5)
    : name.startsWith('right_')
      ? 'left_' + name.slice(6)
      : name === 'mouth_left' ? 'mouth_right' : name === 'mouth_right' ? 'mouth_left' : name
  return KP_INDEX.get(other) ?? i
})

/** Feature arrays of one pose sequence (structure of arrays, frame-major). */
export interface SeqFeatures {
  n: number
  times: Float64Array
  /** Unit direction per frame and bone: index f * NB + b */
  ux: Float64Array
  uy: Float64Array
  /** 1 = both endpoints tracked */
  vis: Uint8Array
  /** Weighted share of visible bones per frame (0-1) */
  visShare: Float64Array
  /** Index of each frame in the input sequence */
  orig: Int32Array
}

export interface FeatureOptions {
  /** Multiply x by this (reference width for normalized coords, 1 for pixels) */
  scaleX: number
  scaleY: number
  /** Flip x and swap left/right labels (mirror-style dancer) */
  mirror: boolean
}

const TOTAL_WEIGHT = BONE_WEIGHT.reduce((a, b) => a + b, 0)

/**
 * Build features for a sequence. Frames are sorted by time; frames without any tracked bone are
 * dropped (absent time simply has no frames, so it cannot earn points).
 */
export function buildFeatures(seq: TimestampedPose[], opts: FeatureOptions): SeqFeatures {
  const usable = seq
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => Number.isFinite(f.time) && (f.pose?.keypoints?.length ?? 0) > 0)
    .sort((p, q) => p.f.time - q.f.time || p.i - q.i)

  const px = new Float64Array(35)
  const py = new Float64Array(35)
  const pc = new Float64Array(35)
  const times: number[] = []
  const ux: number[] = []
  const uy: number[] = []
  const vis: number[] = []
  const share: number[] = []
  const orig: number[] = []

  for (const { f, i: srcIndex } of usable) {
    pc.fill(0)
    for (const k of f.pose.keypoints as Keypoint[]) {
      let idx = KP_INDEX.get(k.name)
      if (idx === undefined || !Number.isFinite(k.x) || !Number.isFinite(k.y)) continue
      if (opts.mirror) idx = LR_SWAP[idx]
      px[idx] = (opts.mirror ? -k.x : k.x) * opts.scaleX
      py[idx] = k.y * opts.scaleY
      pc[idx] = Number.isFinite(k.score) ? k.score : 0
    }
    // virtual mid points
    pc[MID_HIP] = Math.min(pc[23], pc[24])
    px[MID_HIP] = (px[23] + px[24]) / 2
    py[MID_HIP] = (py[23] + py[24]) / 2
    pc[MID_SHOULDER] = Math.min(pc[11], pc[12])
    px[MID_SHOULDER] = (px[11] + px[12]) / 2
    py[MID_SHOULDER] = (py[11] + py[12]) / 2

    let visW = 0
    const base = ux.length
    for (let b = 0; b < NB; b++) {
      const { a, b: e } = BONES[b]
      let x = 0
      let y = 0
      let v = 0
      if (pc[a] >= MIN_CONFIDENCE && pc[e] >= MIN_CONFIDENCE) {
        const dx = px[e] - px[a]
        const dy = py[e] - py[a]
        const m = Math.hypot(dx, dy)
        if (m > 1e-9) {
          x = dx / m
          y = dy / m
          v = 1
          visW += BONE_WEIGHT[b]
        }
      }
      ux.push(x)
      uy.push(y)
      vis.push(v)
    }
    if (visW === 0) {
      ux.length = base
      uy.length = base
      vis.length = base
      continue
    }
    times.push(f.time)
    share.push(visW / TOTAL_WEIGHT)
    orig.push(srcIndex)
  }

  return {
    n: times.length,
    times: Float64Array.from(times),
    ux: Float64Array.from(ux),
    uy: Float64Array.from(uy),
    vis: Uint8Array.from(vis),
    visShare: Float64Array.from(share),
    orig: Int32Array.from(orig),
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

/** Index of the frame nearest to t, or -1 when none lies within `tolerance` seconds. */
export function nearestIndex(times: Float64Array, t: number, tolerance: number): number {
  const i = lowerBound(times, t)
  let best = -1
  let gap = tolerance
  if (i < times.length && Math.abs(times[i] - t) <= gap) {
    best = i
    gap = Math.abs(times[i] - t)
  }
  if (i > 0 && Math.abs(times[i - 1] - t) <= gap) best = i - 1
  return best
}

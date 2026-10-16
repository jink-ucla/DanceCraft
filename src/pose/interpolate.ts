import type { Keypoint, Pose } from '../scoring/types'

/** One timestamped frame, same shape as PoseTimeline.keyframes entries. */
export interface PoseKeyframe {
  time: number
  keypoints: Keypoint[]
}

function copyFrame(frame: PoseKeyframe): Pose {
  return { keypoints: frame.keypoints.map((kp) => ({ ...kp })) }
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Index of the last keyframe whose time is <= t (keyframes sorted by time).
 * Returns -1 when t is before the first keyframe.
 */
export function findKeyframeIndex(keyframes: readonly PoseKeyframe[], t: number): number {
  let lo = 0
  let hi = keyframes.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (keyframes[mid].time <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/**
 * Pose at time `t` (seconds) from a time-sorted keyframe list.
 *
 * - Linear interpolation of x, y and score per keypoint between the two
 *   surrounding keyframes; the keypoint name is kept.
 * - Clamped outside the keyframe range (returns a copy of the first/last frame).
 * - Returns null for an empty list.
 * - Keypoint-count mismatch between neighbours: the common prefix is
 *   interpolated, and the result has the length of the nearer frame (extra
 *   keypoints are taken from it unchanged).
 *
 * Always returns fresh objects; the input keyframes are never mutated.
 */
export function poseAtTime(keyframes: readonly PoseKeyframe[], t: number): Pose | null {
  const n = keyframes.length
  if (n === 0) return null

  if (Number.isNaN(t) || t <= keyframes[0].time) return copyFrame(keyframes[0])
  if (t >= keyframes[n - 1].time) return copyFrame(keyframes[n - 1])

  const i = findKeyframeIndex(keyframes, t)
  if (i < 0) return copyFrame(keyframes[0])
  if (i >= n - 1) return copyFrame(keyframes[n - 1])

  const a = keyframes[i]
  const b = keyframes[i + 1]
  const span = b.time - a.time
  const alpha = span > 0 ? Math.min(1, Math.max(0, (t - a.time) / span)) : 0

  const ka = a.keypoints ?? []
  const kb = b.keypoints ?? []
  const nearest = alpha < 0.5 ? ka : kb
  const common = Math.min(ka.length, kb.length)

  const keypoints: Keypoint[] = new Array(nearest.length)
  for (let k = 0; k < nearest.length; k++) {
    const pa = ka[k]
    const pb = kb[k]
    if (k >= common || !pa || !pb) {
      const src = nearest[k] ?? pa ?? pb
      keypoints[k] = { ...src }
      continue
    }
    keypoints[k] = {
      x: lerp(num(pa.x), num(pb.x), alpha),
      y: lerp(num(pa.y), num(pb.y), alpha),
      score: lerp(num(pa.score), num(pb.score), alpha),
      name: pa.name ?? pb.name,
    }
  }

  return { keypoints }
}

import type { Keypoint, Pose } from '../scoring/types'

/**
 * Normalizes keypoint coordinates to [0, 1] range based on
 * the bounding box of all confident keypoints.
 * This makes pose data resolution-independent.
 */
export function normalizePose(
  pose: Pose,
  minConfidence = 0.3
): Pose {
  const confident = pose.keypoints.filter((kp) => kp.score >= minConfidence)

  if (confident.length < 2) {
    return pose
  }

  const xs = confident.map((kp) => kp.x)
  const ys = confident.map((kp) => kp.y)

  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const rangeX = maxX - minX
  const rangeY = maxY - minY

  // Use the larger range to maintain aspect ratio
  const range = Math.max(rangeX, rangeY)

  if (range === 0) return pose

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  const keypoints: Keypoint[] = pose.keypoints.map((kp) => ({
    ...kp,
    x: (kp.x - centerX) / range + 0.5,
    y: (kp.y - centerY) / range + 0.5,
  }))

  return { keypoints }
}

/**
 * Converts pixel-space keypoints to normalized [0, 1] space
 * based on video dimensions.
 */
export function normalizeToVideoDimensions(
  pose: Pose,
  width: number,
  height: number
): Pose {
  if (width === 0 || height === 0) return pose

  const keypoints: Keypoint[] = pose.keypoints.map((kp) => ({
    ...kp,
    x: kp.x / width,
    y: kp.y / height,
  }))

  return { keypoints }
}

/**
 * Filters out keypoints below a confidence threshold,
 * setting their score to 0 (preserving array structure).
 */
export function filterLowConfidence(
  pose: Pose,
  minConfidence = 0.3
): Pose {
  const keypoints: Keypoint[] = pose.keypoints.map((kp) => ({
    ...kp,
    score: kp.score >= minConfidence ? kp.score : 0,
  }))

  return { keypoints }
}

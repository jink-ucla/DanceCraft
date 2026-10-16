import type { Pose, KeypointName } from './types'

/** Core keypoints that must be visible for a user to be considered "present" */
const CORE_KEYPOINTS: KeypointName[] = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
]

/** Minimum confidence for a core keypoint to count as visible */
const PRESENCE_CONFIDENCE = 0.5

/** Minimum number of visible core keypoints to be "present" */
const MIN_VISIBLE_CORE = 6

export interface PresenceResult {
  present: boolean
  confidence: number
  visibleCount: number
}

/**
 * Check whether the user is sufficiently visible in the frame.
 * Returns present=false when pose is null or too few core keypoints are detected.
 */
export function checkPresence(pose: Pose | null): PresenceResult {
  if (!pose || pose.keypoints.length === 0) {
    return { present: false, confidence: 0, visibleCount: 0 }
  }

  let visibleCount = 0
  let totalConfidence = 0

  for (const name of CORE_KEYPOINTS) {
    const kp = pose.keypoints.find((k) => k.name === name)
    if (kp && kp.score >= PRESENCE_CONFIDENCE) {
      visibleCount++
      totalConfidence += kp.score
    }
  }

  const confidence = visibleCount > 0 ? totalConfidence / visibleCount : 0
  const present = visibleCount >= MIN_VISIBLE_CORE

  return { present, confidence, visibleCount }
}

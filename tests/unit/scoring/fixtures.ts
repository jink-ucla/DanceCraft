import type { Pose } from '../../../src/scoring/types'
import { KEYPOINT_NAMES } from '../../../src/scoring/types'

/**
 * Helper to create a full 33-keypoint BlazePose pose from partial data.
 * Missing keypoints get default values at origin with score 0.
 */
function makePose(partialKeypoints: Record<string, { x: number; y: number; score?: number }>): Pose {
  return {
    keypoints: KEYPOINT_NAMES.map((name) => ({
      name,
      x: partialKeypoints[name]?.x ?? 0,
      y: partialKeypoints[name]?.y ?? 0,
      score: partialKeypoints[name]?.score ?? 0,
    })),
  }
}

/** Common body keypoints used across most test poses */
const BODY_BASE = {
  nose: { x: 0.5, y: 0.1, score: 0.9 },
  left_eye_inner: { x: 0.48, y: 0.08, score: 0.9 },
  left_eye: { x: 0.47, y: 0.08, score: 0.9 },
  left_eye_outer: { x: 0.46, y: 0.08, score: 0.9 },
  right_eye_inner: { x: 0.52, y: 0.08, score: 0.9 },
  right_eye: { x: 0.53, y: 0.08, score: 0.9 },
  right_eye_outer: { x: 0.54, y: 0.08, score: 0.9 },
  left_ear: { x: 0.44, y: 0.1, score: 0.9 },
  right_ear: { x: 0.56, y: 0.1, score: 0.9 },
  mouth_left: { x: 0.48, y: 0.13, score: 0.9 },
  mouth_right: { x: 0.52, y: 0.13, score: 0.9 },
}

// Standing pose: arms down, legs straight
export const STANDING_POSE: Pose = makePose({
  ...BODY_BASE,
  left_shoulder: { x: 0.4, y: 0.3, score: 0.9 },
  right_shoulder: { x: 0.6, y: 0.3, score: 0.9 },
  left_elbow: { x: 0.35, y: 0.5, score: 0.9 },
  right_elbow: { x: 0.65, y: 0.5, score: 0.9 },
  left_wrist: { x: 0.33, y: 0.7, score: 0.9 },
  right_wrist: { x: 0.67, y: 0.7, score: 0.9 },
  left_pinky: { x: 0.32, y: 0.72, score: 0.8 },
  right_pinky: { x: 0.68, y: 0.72, score: 0.8 },
  left_index: { x: 0.33, y: 0.73, score: 0.8 },
  right_index: { x: 0.67, y: 0.73, score: 0.8 },
  left_thumb: { x: 0.34, y: 0.71, score: 0.8 },
  right_thumb: { x: 0.66, y: 0.71, score: 0.8 },
  left_hip: { x: 0.45, y: 0.6, score: 0.9 },
  right_hip: { x: 0.55, y: 0.6, score: 0.9 },
  left_knee: { x: 0.44, y: 0.8, score: 0.9 },
  right_knee: { x: 0.56, y: 0.8, score: 0.9 },
  left_ankle: { x: 0.43, y: 1.0, score: 0.9 },
  right_ankle: { x: 0.57, y: 1.0, score: 0.9 },
  left_heel: { x: 0.42, y: 1.02, score: 0.8 },
  right_heel: { x: 0.58, y: 1.02, score: 0.8 },
  left_foot_index: { x: 0.44, y: 1.04, score: 0.8 },
  right_foot_index: { x: 0.56, y: 1.04, score: 0.8 },
})

// Same standing pose but translated and scaled (should produce same angles)
export const STANDING_POSE_TRANSLATED: Pose = makePose({
  nose: { x: 1.0, y: 0.2, score: 0.9 },
  left_eye_inner: { x: 0.96, y: 0.16, score: 0.9 },
  left_eye: { x: 0.94, y: 0.16, score: 0.9 },
  left_eye_outer: { x: 0.92, y: 0.16, score: 0.9 },
  right_eye_inner: { x: 1.04, y: 0.16, score: 0.9 },
  right_eye: { x: 1.06, y: 0.16, score: 0.9 },
  right_eye_outer: { x: 1.08, y: 0.16, score: 0.9 },
  left_ear: { x: 0.88, y: 0.2, score: 0.9 },
  right_ear: { x: 1.12, y: 0.2, score: 0.9 },
  mouth_left: { x: 0.96, y: 0.26, score: 0.9 },
  mouth_right: { x: 1.04, y: 0.26, score: 0.9 },
  left_shoulder: { x: 0.8, y: 0.6, score: 0.9 },
  right_shoulder: { x: 1.2, y: 0.6, score: 0.9 },
  left_elbow: { x: 0.7, y: 1.0, score: 0.9 },
  right_elbow: { x: 1.3, y: 1.0, score: 0.9 },
  left_wrist: { x: 0.66, y: 1.4, score: 0.9 },
  right_wrist: { x: 1.34, y: 1.4, score: 0.9 },
  left_pinky: { x: 0.64, y: 1.44, score: 0.8 },
  right_pinky: { x: 1.36, y: 1.44, score: 0.8 },
  left_index: { x: 0.66, y: 1.46, score: 0.8 },
  right_index: { x: 1.34, y: 1.46, score: 0.8 },
  left_thumb: { x: 0.68, y: 1.42, score: 0.8 },
  right_thumb: { x: 1.32, y: 1.42, score: 0.8 },
  left_hip: { x: 0.9, y: 1.2, score: 0.9 },
  right_hip: { x: 1.1, y: 1.2, score: 0.9 },
  left_knee: { x: 0.88, y: 1.6, score: 0.9 },
  right_knee: { x: 1.12, y: 1.6, score: 0.9 },
  left_ankle: { x: 0.86, y: 2.0, score: 0.9 },
  right_ankle: { x: 1.14, y: 2.0, score: 0.9 },
  left_heel: { x: 0.84, y: 2.04, score: 0.8 },
  right_heel: { x: 1.16, y: 2.04, score: 0.8 },
  left_foot_index: { x: 0.88, y: 2.08, score: 0.8 },
  right_foot_index: { x: 1.12, y: 2.08, score: 0.8 },
})

// Arms-up T-pose: arms straight out horizontally
export const T_POSE: Pose = makePose({
  ...BODY_BASE,
  left_shoulder: { x: 0.4, y: 0.3, score: 0.9 },
  right_shoulder: { x: 0.6, y: 0.3, score: 0.9 },
  left_elbow: { x: 0.2, y: 0.3, score: 0.9 },
  right_elbow: { x: 0.8, y: 0.3, score: 0.9 },
  left_wrist: { x: 0.0, y: 0.3, score: 0.9 },
  right_wrist: { x: 1.0, y: 0.3, score: 0.9 },
  left_pinky: { x: -0.02, y: 0.3, score: 0.8 },
  right_pinky: { x: 1.02, y: 0.3, score: 0.8 },
  left_index: { x: -0.03, y: 0.3, score: 0.8 },
  right_index: { x: 1.03, y: 0.3, score: 0.8 },
  left_thumb: { x: -0.01, y: 0.29, score: 0.8 },
  right_thumb: { x: 1.01, y: 0.29, score: 0.8 },
  left_hip: { x: 0.45, y: 0.6, score: 0.9 },
  right_hip: { x: 0.55, y: 0.6, score: 0.9 },
  left_knee: { x: 0.44, y: 0.8, score: 0.9 },
  right_knee: { x: 0.56, y: 0.8, score: 0.9 },
  left_ankle: { x: 0.43, y: 1.0, score: 0.9 },
  right_ankle: { x: 0.57, y: 1.0, score: 0.9 },
  left_heel: { x: 0.42, y: 1.02, score: 0.8 },
  right_heel: { x: 0.58, y: 1.02, score: 0.8 },
  left_foot_index: { x: 0.44, y: 1.04, score: 0.8 },
  right_foot_index: { x: 0.56, y: 1.04, score: 0.8 },
})

// Completely different pose: arms up, legs bent (squat)
export const ARMS_UP_SQUAT: Pose = makePose({
  ...BODY_BASE,
  nose: { x: 0.5, y: 0.2, score: 0.9 },
  left_shoulder: { x: 0.4, y: 0.4, score: 0.9 },
  right_shoulder: { x: 0.6, y: 0.4, score: 0.9 },
  left_elbow: { x: 0.35, y: 0.2, score: 0.9 },
  right_elbow: { x: 0.65, y: 0.2, score: 0.9 },
  left_wrist: { x: 0.3, y: 0.05, score: 0.9 },
  right_wrist: { x: 0.7, y: 0.05, score: 0.9 },
  left_pinky: { x: 0.29, y: 0.03, score: 0.8 },
  right_pinky: { x: 0.71, y: 0.03, score: 0.8 },
  left_index: { x: 0.3, y: 0.02, score: 0.8 },
  right_index: { x: 0.7, y: 0.02, score: 0.8 },
  left_thumb: { x: 0.31, y: 0.04, score: 0.8 },
  right_thumb: { x: 0.69, y: 0.04, score: 0.8 },
  left_hip: { x: 0.45, y: 0.6, score: 0.9 },
  right_hip: { x: 0.55, y: 0.6, score: 0.9 },
  left_knee: { x: 0.3, y: 0.7, score: 0.9 },
  right_knee: { x: 0.7, y: 0.7, score: 0.9 },
  left_ankle: { x: 0.35, y: 0.9, score: 0.9 },
  right_ankle: { x: 0.65, y: 0.9, score: 0.9 },
  left_heel: { x: 0.34, y: 0.92, score: 0.8 },
  right_heel: { x: 0.66, y: 0.92, score: 0.8 },
  left_foot_index: { x: 0.36, y: 0.94, score: 0.8 },
  right_foot_index: { x: 0.64, y: 0.94, score: 0.8 },
})

// Pose with some low-confidence keypoints (wrists and ankles)
export const LOW_CONFIDENCE_POSE: Pose = makePose({
  ...BODY_BASE,
  left_shoulder: { x: 0.4, y: 0.3, score: 0.9 },
  right_shoulder: { x: 0.6, y: 0.3, score: 0.9 },
  left_elbow: { x: 0.35, y: 0.5, score: 0.9 },
  right_elbow: { x: 0.65, y: 0.5, score: 0.9 },
  left_wrist: { x: 0.33, y: 0.7, score: 0.1 }, // low confidence
  right_wrist: { x: 0.67, y: 0.7, score: 0.1 }, // low confidence
  left_pinky: { x: 0.32, y: 0.72, score: 0.05 },
  right_pinky: { x: 0.68, y: 0.72, score: 0.05 },
  left_index: { x: 0.33, y: 0.73, score: 0.05 },
  right_index: { x: 0.67, y: 0.73, score: 0.05 },
  left_thumb: { x: 0.34, y: 0.71, score: 0.05 },
  right_thumb: { x: 0.66, y: 0.71, score: 0.05 },
  left_hip: { x: 0.45, y: 0.6, score: 0.9 },
  right_hip: { x: 0.55, y: 0.6, score: 0.9 },
  left_knee: { x: 0.44, y: 0.8, score: 0.9 },
  right_knee: { x: 0.56, y: 0.8, score: 0.9 },
  left_ankle: { x: 0.43, y: 1.0, score: 0.15 }, // low confidence
  right_ankle: { x: 0.57, y: 1.0, score: 0.15 }, // low confidence
  left_heel: { x: 0.42, y: 1.02, score: 0.1 },
  right_heel: { x: 0.58, y: 1.02, score: 0.1 },
  left_foot_index: { x: 0.44, y: 1.04, score: 0.1 },
  right_foot_index: { x: 0.56, y: 1.04, score: 0.1 },
})

// Pose with missing keypoints (empty pose)
export const EMPTY_POSE: Pose = { keypoints: [] }

// --- New fixtures for scoring overhaul ---

/** Pose where user is absent — null represents no detection */
export const ABSENT_POSE: Pose | null = null

/** Pose with very few visible keypoints (partial occlusion — too few for presence) */
export const BARELY_VISIBLE_POSE: Pose = makePose({
  left_shoulder: { x: 0.4, y: 0.3, score: 0.6 },
  right_shoulder: { x: 0.6, y: 0.3, score: 0.6 },
  // Only 2 core keypoints visible — below the 6-of-8 threshold
})

/** Pose with exactly 6 core keypoints visible (minimum for presence) */
export const MINIMAL_PRESENCE_POSE: Pose = makePose({
  ...BODY_BASE,
  left_shoulder: { x: 0.4, y: 0.3, score: 0.7 },
  right_shoulder: { x: 0.6, y: 0.3, score: 0.7 },
  left_elbow: { x: 0.35, y: 0.5, score: 0.7 },
  right_elbow: { x: 0.65, y: 0.5, score: 0.7 },
  left_hip: { x: 0.45, y: 0.6, score: 0.7 },
  right_hip: { x: 0.55, y: 0.6, score: 0.7 },
  // elbows above 0.5, hips above 0.5, shoulders above 0.5 = 6 core keypoints
  left_wrist: { x: 0.33, y: 0.7, score: 0.3 },
  right_wrist: { x: 0.67, y: 0.7, score: 0.3 },
  left_knee: { x: 0.44, y: 0.8, score: 0.3 }, // below presence threshold
  right_knee: { x: 0.56, y: 0.8, score: 0.3 }, // below presence threshold
  left_ankle: { x: 0.43, y: 1.0, score: 0.3 },
  right_ankle: { x: 0.57, y: 1.0, score: 0.3 },
})

/**
 * A standing-still sequence: same pose repeated over 1.5s at 30fps (45 frames).
 * Used to test movement energy gate — should produce ~0 energy.
 */
export function makeStandingStillSequence(): { pose: Pose; time: number }[] {
  const frames: { pose: Pose; time: number }[] = []
  for (let i = 0; i < 45; i++) {
    frames.push({ pose: STANDING_POSE, time: i / 30 })
  }
  return frames
}

/**
 * A dancing sequence: poses that transition between standing, T-pose, and squat over 1.5s.
 * Used to test movement energy gate — should produce high energy.
 */
export function makeDancingSequence(): { pose: Pose; time: number }[] {
  const poses = [STANDING_POSE, T_POSE, ARMS_UP_SQUAT, T_POSE, STANDING_POSE]
  const frames: { pose: Pose; time: number }[] = []
  // 45 frames over 1.5s, cycling through poses
  for (let i = 0; i < 45; i++) {
    const poseIdx = Math.floor((i / 45) * poses.length) % poses.length
    frames.push({ pose: poses[poseIdx], time: i / 30 })
  }
  return frames
}

/** Arms reaching forward (different spatial config from arms-at-sides but similar elbow angles) */
export const ARMS_FORWARD_POSE: Pose = makePose({
  ...BODY_BASE,
  left_shoulder: { x: 0.4, y: 0.3, score: 0.9 },
  right_shoulder: { x: 0.6, y: 0.3, score: 0.9 },
  // Elbows in front of body — nearly straight arms, similar elbow angle to standing
  left_elbow: { x: 0.38, y: 0.35, score: 0.9 },
  right_elbow: { x: 0.62, y: 0.35, score: 0.9 },
  left_wrist: { x: 0.36, y: 0.4, score: 0.9 },
  right_wrist: { x: 0.64, y: 0.4, score: 0.9 },
  left_pinky: { x: 0.35, y: 0.42, score: 0.8 },
  right_pinky: { x: 0.65, y: 0.42, score: 0.8 },
  left_index: { x: 0.36, y: 0.43, score: 0.8 },
  right_index: { x: 0.64, y: 0.43, score: 0.8 },
  left_thumb: { x: 0.37, y: 0.41, score: 0.8 },
  right_thumb: { x: 0.63, y: 0.41, score: 0.8 },
  left_hip: { x: 0.45, y: 0.6, score: 0.9 },
  right_hip: { x: 0.55, y: 0.6, score: 0.9 },
  left_knee: { x: 0.44, y: 0.8, score: 0.9 },
  right_knee: { x: 0.56, y: 0.8, score: 0.9 },
  left_ankle: { x: 0.43, y: 1.0, score: 0.9 },
  right_ankle: { x: 0.57, y: 1.0, score: 0.9 },
  left_heel: { x: 0.42, y: 1.02, score: 0.8 },
  right_heel: { x: 0.58, y: 1.02, score: 0.8 },
  left_foot_index: { x: 0.44, y: 1.04, score: 0.8 },
  right_foot_index: { x: 0.56, y: 1.04, score: 0.8 },
})

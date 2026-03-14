import type { Pose } from '../../../src/scoring/types'

/**
 * Helper to create a full 17-keypoint MoveNet pose from partial data.
 * Missing keypoints get default values at origin with score 0.
 */
function makePose(partialKeypoints: Record<string, { x: number; y: number; score?: number }>): Pose {
  const names = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  ]
  return {
    keypoints: names.map((name) => ({
      name,
      x: partialKeypoints[name]?.x ?? 0,
      y: partialKeypoints[name]?.y ?? 0,
      score: partialKeypoints[name]?.score ?? 0,
    })),
  }
}

// Standing pose: arms down, legs straight
export const STANDING_POSE: Pose = makePose({
  nose: { x: 0.5, y: 0.1, score: 0.9 },
  left_shoulder: { x: 0.4, y: 0.3, score: 0.9 },
  right_shoulder: { x: 0.6, y: 0.3, score: 0.9 },
  left_elbow: { x: 0.35, y: 0.5, score: 0.9 },
  right_elbow: { x: 0.65, y: 0.5, score: 0.9 },
  left_wrist: { x: 0.33, y: 0.7, score: 0.9 },
  right_wrist: { x: 0.67, y: 0.7, score: 0.9 },
  left_hip: { x: 0.45, y: 0.6, score: 0.9 },
  right_hip: { x: 0.55, y: 0.6, score: 0.9 },
  left_knee: { x: 0.44, y: 0.8, score: 0.9 },
  right_knee: { x: 0.56, y: 0.8, score: 0.9 },
  left_ankle: { x: 0.43, y: 1.0, score: 0.9 },
  right_ankle: { x: 0.57, y: 1.0, score: 0.9 },
})

// Same standing pose but translated and scaled (should produce same angles)
export const STANDING_POSE_TRANSLATED: Pose = makePose({
  nose: { x: 1.0, y: 0.2, score: 0.9 },
  left_shoulder: { x: 0.8, y: 0.6, score: 0.9 },
  right_shoulder: { x: 1.2, y: 0.6, score: 0.9 },
  left_elbow: { x: 0.7, y: 1.0, score: 0.9 },
  right_elbow: { x: 1.3, y: 1.0, score: 0.9 },
  left_wrist: { x: 0.66, y: 1.4, score: 0.9 },
  right_wrist: { x: 1.34, y: 1.4, score: 0.9 },
  left_hip: { x: 0.9, y: 1.2, score: 0.9 },
  right_hip: { x: 1.1, y: 1.2, score: 0.9 },
  left_knee: { x: 0.88, y: 1.6, score: 0.9 },
  right_knee: { x: 1.12, y: 1.6, score: 0.9 },
  left_ankle: { x: 0.86, y: 2.0, score: 0.9 },
  right_ankle: { x: 1.14, y: 2.0, score: 0.9 },
})

// Arms-up T-pose: arms straight out horizontally
export const T_POSE: Pose = makePose({
  nose: { x: 0.5, y: 0.1, score: 0.9 },
  left_shoulder: { x: 0.4, y: 0.3, score: 0.9 },
  right_shoulder: { x: 0.6, y: 0.3, score: 0.9 },
  left_elbow: { x: 0.2, y: 0.3, score: 0.9 },
  right_elbow: { x: 0.8, y: 0.3, score: 0.9 },
  left_wrist: { x: 0.0, y: 0.3, score: 0.9 },
  right_wrist: { x: 1.0, y: 0.3, score: 0.9 },
  left_hip: { x: 0.45, y: 0.6, score: 0.9 },
  right_hip: { x: 0.55, y: 0.6, score: 0.9 },
  left_knee: { x: 0.44, y: 0.8, score: 0.9 },
  right_knee: { x: 0.56, y: 0.8, score: 0.9 },
  left_ankle: { x: 0.43, y: 1.0, score: 0.9 },
  right_ankle: { x: 0.57, y: 1.0, score: 0.9 },
})

// Completely different pose: arms up, legs bent
export const ARMS_UP_SQUAT: Pose = makePose({
  nose: { x: 0.5, y: 0.2, score: 0.9 },
  left_shoulder: { x: 0.4, y: 0.4, score: 0.9 },
  right_shoulder: { x: 0.6, y: 0.4, score: 0.9 },
  left_elbow: { x: 0.35, y: 0.2, score: 0.9 },
  right_elbow: { x: 0.65, y: 0.2, score: 0.9 },
  left_wrist: { x: 0.3, y: 0.05, score: 0.9 },
  right_wrist: { x: 0.7, y: 0.05, score: 0.9 },
  left_hip: { x: 0.45, y: 0.6, score: 0.9 },
  right_hip: { x: 0.55, y: 0.6, score: 0.9 },
  left_knee: { x: 0.3, y: 0.7, score: 0.9 },
  right_knee: { x: 0.7, y: 0.7, score: 0.9 },
  left_ankle: { x: 0.35, y: 0.9, score: 0.9 },
  right_ankle: { x: 0.65, y: 0.9, score: 0.9 },
})

// Pose with some low-confidence keypoints (wrists and ankles)
export const LOW_CONFIDENCE_POSE: Pose = makePose({
  nose: { x: 0.5, y: 0.1, score: 0.9 },
  left_shoulder: { x: 0.4, y: 0.3, score: 0.9 },
  right_shoulder: { x: 0.6, y: 0.3, score: 0.9 },
  left_elbow: { x: 0.35, y: 0.5, score: 0.9 },
  right_elbow: { x: 0.65, y: 0.5, score: 0.9 },
  left_wrist: { x: 0.33, y: 0.7, score: 0.1 }, // low confidence
  right_wrist: { x: 0.67, y: 0.7, score: 0.1 }, // low confidence
  left_hip: { x: 0.45, y: 0.6, score: 0.9 },
  right_hip: { x: 0.55, y: 0.6, score: 0.9 },
  left_knee: { x: 0.44, y: 0.8, score: 0.9 },
  right_knee: { x: 0.56, y: 0.8, score: 0.9 },
  left_ankle: { x: 0.43, y: 1.0, score: 0.15 }, // low confidence
  right_ankle: { x: 0.57, y: 1.0, score: 0.15 }, // low confidence
})

// Pose with missing keypoints (empty pose)
export const EMPTY_POSE: Pose = { keypoints: [] }

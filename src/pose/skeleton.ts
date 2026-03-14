/**
 * Skeleton connection pairs for MoveNet keypoints.
 * Each pair is [keypointIndexA, keypointIndexB].
 */
export const SKELETON_CONNECTIONS: [number, number][] = [
  // Torso
  [5, 6],   // left_shoulder - right_shoulder
  [5, 11],  // left_shoulder - left_hip
  [6, 12],  // right_shoulder - right_hip
  [11, 12], // left_hip - right_hip

  // Left arm
  [5, 7],   // left_shoulder - left_elbow
  [7, 9],   // left_elbow - left_wrist

  // Right arm
  [6, 8],   // right_shoulder - right_elbow
  [8, 10],  // right_elbow - right_wrist

  // Left leg
  [11, 13], // left_hip - left_knee
  [13, 15], // left_knee - left_ankle

  // Right leg
  [12, 14], // right_hip - right_knee
  [14, 16], // right_knee - right_ankle
]

/** Colors for different body regions */
export const KEYPOINT_COLOR = '#00ff88'
export const SKELETON_COLOR = 'rgba(0, 255, 136, 0.6)'
export const KEYPOINT_RADIUS = 5

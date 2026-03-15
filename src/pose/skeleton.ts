/**
 * Skeleton connection pairs for MediaPipe BlazePose 33 landmarks.
 * Each pair is [keypointIndexA, keypointIndexB].
 */
export const SKELETON_CONNECTIONS: [number, number][] = [
  // Torso
  [11, 12], // left_shoulder - right_shoulder
  [11, 23], // left_shoulder - left_hip
  [12, 24], // right_shoulder - right_hip
  [23, 24], // left_hip - right_hip

  // Left arm
  [11, 13], // left_shoulder - left_elbow
  [13, 15], // left_elbow - left_wrist

  // Right arm
  [12, 14], // right_shoulder - right_elbow
  [14, 16], // right_elbow - right_wrist

  // Left hand
  [15, 17], // left_wrist - left_pinky
  [15, 19], // left_wrist - left_index
  [15, 21], // left_wrist - left_thumb

  // Right hand
  [16, 18], // right_wrist - right_pinky
  [16, 20], // right_wrist - right_index
  [16, 22], // right_wrist - right_thumb

  // Left leg
  [23, 25], // left_hip - left_knee
  [25, 27], // left_knee - left_ankle

  // Right leg
  [24, 26], // right_hip - right_knee
  [26, 28], // right_knee - right_ankle

  // Left foot
  [27, 29], // left_ankle - left_heel
  [27, 31], // left_ankle - left_foot_index
  [29, 31], // left_heel - left_foot_index

  // Right foot
  [28, 30], // right_ankle - right_heel
  [28, 32], // right_ankle - right_foot_index
  [30, 32], // right_heel - right_foot_index
]

/** Colors for different body regions */
export const KEYPOINT_COLOR = '#00ff88'
export const SKELETON_COLOR = 'rgba(0, 255, 136, 0.6)'
export const KEYPOINT_RADIUS = 5

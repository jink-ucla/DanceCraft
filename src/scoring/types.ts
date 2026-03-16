export interface Keypoint {
  x: number
  y: number
  score: number
  name: string
}

export interface Pose {
  keypoints: Keypoint[]
}

export interface JointAngle {
  name: string
  angle: number // radians
  confidence: number
}

export interface JointScore {
  name: string
  similarity: number // 0-1
}

export interface PoseComparisonResult {
  jointScores: JointScore[]
  overallScore: number // 0-1
  angleScore: number // 0-1, angle-only similarity
  spatialScore: number // 0-1, torso-relative bone direction similarity
}

// Full MediaPipe BlazePose 33 landmarks
export const KEYPOINT_NAMES = [
  'nose',              // 0
  'left_eye_inner',    // 1
  'left_eye',          // 2
  'left_eye_outer',    // 3
  'right_eye_inner',   // 4
  'right_eye',         // 5
  'right_eye_outer',   // 6
  'left_ear',          // 7
  'right_ear',         // 8
  'mouth_left',        // 9
  'mouth_right',       // 10
  'left_shoulder',     // 11
  'right_shoulder',    // 12
  'left_elbow',        // 13
  'right_elbow',       // 14
  'left_wrist',        // 15
  'right_wrist',       // 16
  'left_pinky',        // 17
  'right_pinky',       // 18
  'left_index',        // 19
  'right_index',       // 20
  'left_thumb',        // 21
  'right_thumb',       // 22
  'left_hip',          // 23
  'right_hip',         // 24
  'left_knee',         // 25
  'right_knee',        // 26
  'left_ankle',        // 27
  'right_ankle',       // 28
  'left_heel',         // 29
  'right_heel',        // 30
  'left_foot_index',   // 31
  'right_foot_index',  // 32
] as const

export type KeypointName = (typeof KEYPOINT_NAMES)[number]

// Joint definitions: [pointA, vertex, pointB] — angle is measured at the vertex
export interface JointDefinition {
  name: string
  pointA: KeypointName
  vertex: KeypointName
  pointB: KeypointName
  weight: number
}

export const JOINT_DEFINITIONS: JointDefinition[] = [
  // Arms (weighted higher for dance)
  { name: 'left_elbow', pointA: 'left_shoulder', vertex: 'left_elbow', pointB: 'left_wrist', weight: 1.5 },
  { name: 'right_elbow', pointA: 'right_shoulder', vertex: 'right_elbow', pointB: 'right_wrist', weight: 1.5 },
  { name: 'left_shoulder', pointA: 'left_hip', vertex: 'left_shoulder', pointB: 'left_elbow', weight: 1.2 },
  { name: 'right_shoulder', pointA: 'right_hip', vertex: 'right_shoulder', pointB: 'right_elbow', weight: 1.2 },
  // Wrist angle (hand direction — important for dance hand positions)
  { name: 'left_wrist', pointA: 'left_elbow', vertex: 'left_wrist', pointB: 'left_index', weight: 0.8 },
  { name: 'right_wrist', pointA: 'right_elbow', vertex: 'right_wrist', pointB: 'right_index', weight: 0.8 },
  // Legs
  { name: 'left_hip', pointA: 'left_shoulder', vertex: 'left_hip', pointB: 'left_knee', weight: 1.0 },
  { name: 'right_hip', pointA: 'right_shoulder', vertex: 'right_hip', pointB: 'right_knee', weight: 1.0 },
  { name: 'left_knee', pointA: 'left_hip', vertex: 'left_knee', pointB: 'left_ankle', weight: 0.8 },
  { name: 'right_knee', pointA: 'right_hip', vertex: 'right_knee', pointB: 'right_ankle', weight: 0.8 },
  // Ankle angle (foot direction — footwork)
  { name: 'left_ankle', pointA: 'left_knee', vertex: 'left_ankle', pointB: 'left_foot_index', weight: 0.5 },
  { name: 'right_ankle', pointA: 'right_knee', vertex: 'right_ankle', pointB: 'right_foot_index', weight: 0.5 },
]

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
}

// MoveNet keypoint indices
export const KEYPOINT_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
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
  // Legs
  { name: 'left_hip', pointA: 'left_shoulder', vertex: 'left_hip', pointB: 'left_knee', weight: 1.0 },
  { name: 'right_hip', pointA: 'right_shoulder', vertex: 'right_hip', pointB: 'right_knee', weight: 1.0 },
  { name: 'left_knee', pointA: 'left_hip', vertex: 'left_knee', pointB: 'left_ankle', weight: 0.8 },
  { name: 'right_knee', pointA: 'right_hip', vertex: 'right_knee', pointB: 'right_ankle', weight: 0.8 },
]

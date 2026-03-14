export { calculateAngle, extractJointAngles } from './angles'
export { comparePoses } from './comparison'
export {
  detectKeyPoses,
  computeAngularVelocity,
  computeDistinctiveness,
} from './keyPoseDetection'
export type {
  Keypoint,
  Pose,
  JointAngle,
  JointScore,
  PoseComparisonResult,
  JointDefinition,
  KeypointName,
} from './types'
export type { PoseTimeline, KeyPose, KeyPoseConfig } from './keyPoseDetection'
export { KEYPOINT_NAMES, JOINT_DEFINITIONS } from './types'

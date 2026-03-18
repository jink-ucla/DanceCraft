export { calculateAngle, extractJointAngles } from './angles'
export { comparePoses, computeSpatialSimilarity, compareMoveVelocity } from './comparison'
export type { CompareOptions } from './comparison'
export {
  detectKeyPoses,
  computeAngularVelocity,
  computeDistinctiveness,
  computeContextDistinctiveness,
  computeFocusJoints,
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
export { KEYPOINT_NAMES, JOINT_DEFINITIONS, BODY_PART_JOINTS, BODY_PART_BONES } from './types'
export {
  computeDTW,
  computeAlignmentScore,
  computeSectionScores,
  computeBodyPartScores,
  computeRank,
  computePostDanceScore,
} from './dtw'
export type { TimestampedPose, DTWResult, SectionScore, BodyPartScore } from './dtw'
export { checkPresence } from './presence'
export type { PresenceResult } from './presence'
export { MovementTracker } from './movement'

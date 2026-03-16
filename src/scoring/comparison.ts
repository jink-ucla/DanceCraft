import type { Pose, Keypoint, JointScore, PoseComparisonResult, JointDefinition, KeypointName } from './types'
import { JOINT_DEFINITIONS } from './types'
import { extractJointAngles } from './angles'

/** Blend weights for angle vs spatial similarity */
const ANGLE_WEIGHT = 0.6
const SPATIAL_WEIGHT = 0.4

/**
 * Compare the angle similarity of a single joint between two poses.
 * Returns a value between 0 (completely different) and 1 (identical).
 *
 * Uses cosine-based similarity: 1 - |angleDiff| / PI
 * This is position-invariant and scale-invariant since we only compare angles.
 */
function angleSimilarity(angleA: number, angleB: number): number {
  const diff = Math.abs(angleA - angleB)
  return 1 - diff / Math.PI
}

/**
 * Bone segment definitions for spatial comparison.
 * Each segment is defined by a start and end keypoint.
 */
const BONE_SEGMENTS: { name: string; start: KeypointName; end: KeypointName }[] = [
  { name: 'left_upper_arm', start: 'left_shoulder', end: 'left_elbow' },
  { name: 'right_upper_arm', start: 'right_shoulder', end: 'right_elbow' },
  { name: 'left_lower_arm', start: 'left_elbow', end: 'left_wrist' },
  { name: 'right_lower_arm', start: 'right_elbow', end: 'right_wrist' },
  { name: 'left_upper_leg', start: 'left_hip', end: 'left_knee' },
  { name: 'right_upper_leg', start: 'right_hip', end: 'right_knee' },
  { name: 'left_lower_leg', start: 'left_knee', end: 'left_ankle' },
  { name: 'right_lower_leg', start: 'right_knee', end: 'right_ankle' },
]

function findKp(pose: Pose, name: KeypointName): Keypoint | undefined {
  return pose.keypoints.find((k) => k.name === name)
}

/**
 * Compute torso-relative spatial similarity between two poses.
 * Compares bone segment direction vectors relative to a torso-centered coordinate frame.
 *
 * Returns 0-1 where 1 = identical spatial configuration.
 */
export function computeSpatialSimilarity(reference: Pose, user: Pose): number {
  // Compute torso frames
  const refTorso = computeTorsoFrame(reference)
  const userTorso = computeTorsoFrame(user)
  if (!refTorso || !userTorso) return 0

  let totalSimilarity = 0
  let count = 0

  for (const segment of BONE_SEGMENTS) {
    const refDir = computeRelativeBoneDirection(reference, segment.start, segment.end, refTorso)
    const userDir = computeRelativeBoneDirection(user, segment.start, segment.end, userTorso)
    if (!refDir || !userDir) continue

    // Cosine similarity of direction vectors: (dot + 1) / 2 maps [-1,1] to [0,1]
    const dot = refDir.x * userDir.x + refDir.y * userDir.y
    const similarity = (dot + 1) / 2
    totalSimilarity += similarity
    count++
  }

  return count > 0 ? totalSimilarity / count : 0
}

interface TorsoFrame {
  originX: number
  originY: number
  scale: number // torso height for normalization
}

function computeTorsoFrame(pose: Pose): TorsoFrame | null {
  const ls = findKp(pose, 'left_shoulder')
  const rs = findKp(pose, 'right_shoulder')
  const lh = findKp(pose, 'left_hip')
  const rh = findKp(pose, 'right_hip')

  if (!ls || !rs || !lh || !rh) return null
  if (ls.score < 0.3 || rs.score < 0.3 || lh.score < 0.3 || rh.score < 0.3) return null

  const midShoulderX = (ls.x + rs.x) / 2
  const midShoulderY = (ls.y + rs.y) / 2
  const midHipX = (lh.x + rh.x) / 2
  const midHipY = (lh.y + rh.y) / 2

  const originX = (midShoulderX + midHipX) / 2
  const originY = (midShoulderY + midHipY) / 2

  const dx = midHipX - midShoulderX
  const dy = midHipY - midShoulderY
  const scale = Math.sqrt(dx * dx + dy * dy)

  if (scale < 0.001) return null

  return { originX, originY, scale }
}

function computeRelativeBoneDirection(
  pose: Pose,
  startName: KeypointName,
  endName: KeypointName,
  torso: TorsoFrame,
): { x: number; y: number } | null {
  const start = findKp(pose, startName)
  const end = findKp(pose, endName)
  if (!start || !end || start.score < 0.3 || end.score < 0.3) return null

  // Compute direction relative to torso origin, normalized by torso scale
  const dx = (end.x - start.x) / torso.scale
  const dy = (end.y - start.y) / torso.scale

  // Normalize to unit vector
  const mag = Math.sqrt(dx * dx + dy * dy)
  if (mag < 0.001) return null

  return { x: dx / mag, y: dy / mag }
}

/**
 * Compare two poses and return per-joint and overall similarity scores.
 * Blends angle similarity (60%) with spatial similarity (40%).
 *
 * @param reference - The reference pose (from the dance video)
 * @param user - The user's pose (from webcam)
 * @param jointWeights - Optional custom joint definitions with weights
 * @returns PoseComparisonResult with per-joint and weighted overall scores
 */
export function comparePoses(
  reference: Pose,
  user: Pose,
  jointWeights?: JointDefinition[],
): PoseComparisonResult {
  const definitions = jointWeights ?? JOINT_DEFINITIONS
  const refAngles = extractJointAngles(reference)
  const userAngles = extractJointAngles(user)

  const jointScores: JointScore[] = []
  let weightedSum = 0
  let totalWeight = 0

  for (const def of definitions) {
    const refAngle = refAngles.find((a) => a.name === def.name)
    const userAngle = userAngles.find((a) => a.name === def.name)

    if (!refAngle || !userAngle) continue

    const similarity = angleSimilarity(refAngle.angle, userAngle.angle)
    jointScores.push({ name: def.name, similarity })

    weightedSum += similarity * def.weight
    totalWeight += def.weight
  }

  const angleScore = totalWeight > 0 ? weightedSum / totalWeight : 0
  const spatialScore = computeSpatialSimilarity(reference, user)

  // Blend angle and spatial scores
  const overallScore = totalWeight > 0
    ? ANGLE_WEIGHT * angleScore + SPATIAL_WEIGHT * spatialScore
    : 0

  return { jointScores, overallScore, angleScore, spatialScore }
}

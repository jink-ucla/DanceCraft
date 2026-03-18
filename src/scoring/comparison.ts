import type { Pose, Keypoint, JointScore, JointDeduction, PoseComparisonResult, JointDefinition, KeypointName } from './types'
import { JOINT_DEFINITIONS, BODY_PART_JOINTS, BODY_PART_BONES } from './types'
import { extractJointAngles } from './angles'

/** Blend weights for angle vs spatial similarity */
const ANGLE_WEIGHT = 0.6
const SPATIAL_WEIGHT = 0.4

/** Focus joint weight multiplier (vs non-focus joints) */
const FOCUS_WEIGHT = 3.0
const NON_FOCUS_WEIGHT = 0.5

/** Options for pose comparison */
export interface CompareOptions {
  /** Custom joint definitions with weights */
  jointWeights?: JointDefinition[]
  /** Joints to score with higher weight (from key pose focus detection) */
  focusJoints?: string[]
  /** Weight multiplier for focus joints (default: 3.0) */
  focusWeight?: number
  /** Weight multiplier for non-focus joints (default: 0.5) */
  nonFocusWeight?: number
}

/**
 * Compare the angle similarity of a single joint between two poses.
 * Uses a steeper quadratic curve that penalizes differences more aggressively
 * than the old linear formula, eliminating the ~0.7 "free baseline".
 *
 * With threshold PI/3 (~60°):
 *   0° → 1.0, 30° → 0.75, 60° → 0.0, >60° → 0.0
 */
function angleSimilarity(angleA: number, angleB: number): number {
  const diff = Math.abs(angleA - angleB)
  const threshold = Math.PI / 3 // 60 degrees
  const normalized = diff / threshold
  return Math.max(0, 1 - normalized * normalized)
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
 * When focusJoints are provided, focus-area bones get higher weight.
 *
 * Returns 0-1 where 1 = identical spatial configuration.
 */
export function computeSpatialSimilarity(reference: Pose, user: Pose, focusJoints?: string[]): number {
  // Compute torso frames
  const refTorso = computeTorsoFrame(reference)
  const userTorso = computeTorsoFrame(user)
  if (!refTorso || !userTorso) return 0

  // Determine which bone groups are "focus" based on focus joints
  const focusBones = new Set<string>()
  if (focusJoints && focusJoints.length > 0) {
    for (const [part, joints] of Object.entries(BODY_PART_JOINTS)) {
      if (focusJoints.some((fj) => joints.includes(fj))) {
        for (const bone of BODY_PART_BONES[part] ?? []) {
          focusBones.add(bone)
        }
      }
    }
  }
  const hasFocus = focusBones.size > 0

  let weightedSum = 0
  let totalWeight = 0

  for (const segment of BONE_SEGMENTS) {
    const refDir = computeRelativeBoneDirection(reference, segment.start, segment.end, refTorso)
    const userDir = computeRelativeBoneDirection(user, segment.start, segment.end, userTorso)
    if (!refDir || !userDir) continue

    // Cosine similarity → steeper curve: square the raw similarity
    const dot = refDir.x * userDir.x + refDir.y * userDir.y
    const rawSim = (dot + 1) / 2
    const similarity = rawSim * rawSim // steeper: small differences penalized more

    const weight = hasFocus
      ? (focusBones.has(segment.name) ? FOCUS_WEIGHT : NON_FOCUS_WEIGHT)
      : 1.0
    weightedSum += similarity * weight
    totalWeight += weight
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0
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
 * Compare a user's movement (angular change over a window) against expected velocity.
 * Scores based on: right joints moving, right direction, right magnitude.
 *
 * @param expectedVelocity - Per-joint expected angle change (signed, in radians)
 * @param userBefore - User's pose at the start of the movement window
 * @param userAfter - User's pose at the end of the movement window
 * @param focusJoints - Joints involved in the move (optional, for weighting)
 * @returns 0-1 similarity score (1 = perfect velocity match)
 */
export function compareMoveVelocity(
  expectedVelocity: Record<string, number>,
  userBefore: Pose,
  userAfter: Pose,
  focusJoints?: string[],
): number {
  const userStartAngles = extractJointAngles(userBefore)
  const userEndAngles = extractJointAngles(userAfter)

  const hasFocus = focusJoints && focusJoints.length > 0
  let weightedSum = 0
  let totalWeight = 0

  for (const [jointName, expectedChange] of Object.entries(expectedVelocity)) {
    const expectedMag = Math.abs(expectedChange)
    if (expectedMag < 0.15) continue // Skip joints with negligible expected movement

    const userStart = userStartAngles.find((a) => a.name === jointName)
    const userEnd = userEndAngles.find((a) => a.name === jointName)
    if (!userStart || !userEnd) continue

    const userChange = userEnd.angle - userStart.angle
    const userMag = Math.abs(userChange)

    // Direction check: same sign = correct direction
    const sameDirection =
      (expectedChange > 0 && userChange > 0) || (expectedChange < 0 && userChange < 0)

    let jointScore: number
    if (!sameDirection && userMag > 0.1) {
      // Wrong direction with meaningful movement = 0
      jointScore = 0
    } else if (userMag < 0.1) {
      // User barely moved = low score proportional to how much was expected
      jointScore = 0.1
    } else {
      // Same direction: score by magnitude ratio (1.0 = same magnitude)
      const ratio = Math.min(userMag, expectedMag) / Math.max(userMag, expectedMag)
      jointScore = ratio
    }

    const weight = hasFocus && focusJoints!.includes(jointName) ? 3.0 : 1.0
    weightedSum += jointScore * weight
    totalWeight += weight
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0
}

/**
 * Compare two poses and return per-joint and overall similarity scores.
 * Blends angle similarity (60%) with spatial similarity (40%).
 * When focusJoints are provided, those joints get 3x weight and others get 0.5x.
 *
 * @param reference - The reference pose (from the dance video)
 * @param user - The user's pose (from webcam)
 * @param options - Optional: custom joint weights and/or focus joints
 * @returns PoseComparisonResult with per-joint and weighted overall scores
 */
export function comparePoses(
  reference: Pose,
  user: Pose,
  options?: JointDefinition[] | CompareOptions,
): PoseComparisonResult {
  // Support both old API (JointDefinition[]) and new API (CompareOptions)
  let definitions: JointDefinition[]
  let focusJoints: string[] | undefined
  let cfgFocusWeight = FOCUS_WEIGHT
  let cfgNonFocusWeight = NON_FOCUS_WEIGHT
  if (Array.isArray(options)) {
    definitions = options
  } else if (options) {
    definitions = options.jointWeights ?? JOINT_DEFINITIONS
    focusJoints = options.focusJoints
    if (options.focusWeight !== undefined) cfgFocusWeight = options.focusWeight
    if (options.nonFocusWeight !== undefined) cfgNonFocusWeight = options.nonFocusWeight
  } else {
    definitions = JOINT_DEFINITIONS
  }

  const hasFocus = focusJoints && focusJoints.length > 0
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

    // Apply focus weighting: focus joints get higher weight, others get lower
    const focusMultiplier = hasFocus
      ? (focusJoints!.includes(def.name) ? cfgFocusWeight : cfgNonFocusWeight)
      : 1.0
    const effectiveWeight = def.weight * focusMultiplier
    weightedSum += similarity * effectiveWeight
    totalWeight += effectiveWeight
  }

  const angleScore = totalWeight > 0 ? weightedSum / totalWeight : 0
  const spatialScore = computeSpatialSimilarity(reference, user, focusJoints)

  // Blend angle and spatial scores
  const overallScore = totalWeight > 0
    ? ANGLE_WEIGHT * angleScore + SPATIAL_WEIGHT * spatialScore
    : 0

  // Compute deduction-based score: start at 100, subtract per-joint penalties.
  // Each joint that's below perfect contributes a penalty proportional to how
  // far off it is, scaled by whether it's a focus joint.
  // Max penalty per focus joint: ~15 pts. Max per non-focus: ~5 pts.
  const FOCUS_MAX_PENALTY = 15
  const OTHER_MAX_PENALTY = 5
  const deductions: JointDeduction[] = []
  let totalPenalty = 0

  for (const js of jointScores) {
    const isFocus = hasFocus ? focusJoints!.includes(js.name) : true
    const maxPenalty = isFocus ? FOCUS_MAX_PENALTY : OTHER_MAX_PENALTY
    // Penalty = maxPenalty × (1 - similarity). Perfect match = 0 penalty.
    const penalty = Math.round(maxPenalty * (1 - js.similarity))
    if (penalty > 0) {
      deductions.push({ name: js.name, penalty, isFocus, similarity: js.similarity })
      totalPenalty += penalty
    }
  }

  // Sort: biggest penalties first
  deductions.sort((a, b) => b.penalty - a.penalty)
  const deductionScore = Math.max(0, 100 - totalPenalty)

  return { jointScores, overallScore, angleScore, spatialScore, deductions, deductionScore }
}

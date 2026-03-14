import type { Pose, JointScore, PoseComparisonResult, JointDefinition } from './types'
import { JOINT_DEFINITIONS } from './types'
import { extractJointAngles } from './angles'

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
 * Compare two poses and return per-joint and overall similarity scores.
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

  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0

  return { jointScores, overallScore }
}

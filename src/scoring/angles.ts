import type { Keypoint, Pose, JointAngle, KeypointName } from './types'
import { JOINT_DEFINITIONS } from './types'

const MIN_CONFIDENCE = 0.3

function findKeypoint(pose: Pose, name: KeypointName): Keypoint | undefined {
  return pose.keypoints.find((kp) => kp.name === name)
}

/**
 * Calculate the angle at vertex formed by pointA-vertex-pointB, in radians [0, PI].
 */
export function calculateAngle(
  pointA: { x: number; y: number },
  vertex: { x: number; y: number },
  pointB: { x: number; y: number },
): number {
  const vA = { x: pointA.x - vertex.x, y: pointA.y - vertex.y }
  const vB = { x: pointB.x - vertex.x, y: pointB.y - vertex.y }

  const dot = vA.x * vB.x + vA.y * vB.y
  const magA = Math.sqrt(vA.x * vA.x + vA.y * vA.y)
  const magB = Math.sqrt(vB.x * vB.x + vB.y * vB.y)

  if (magA === 0 || magB === 0) return 0

  const cosAngle = Math.max(-1, Math.min(1, dot / (magA * magB)))
  return Math.acos(cosAngle)
}

/**
 * Extract joint angles from a pose. Returns angles for all joints where
 * all three keypoints have sufficient confidence.
 */
export function extractJointAngles(pose: Pose): JointAngle[] {
  const angles: JointAngle[] = []

  for (const joint of JOINT_DEFINITIONS) {
    const a = findKeypoint(pose, joint.pointA)
    const v = findKeypoint(pose, joint.vertex)
    const b = findKeypoint(pose, joint.pointB)

    if (!a || !v || !b) continue

    const minScore = Math.min(a.score, v.score, b.score)
    if (minScore < MIN_CONFIDENCE) continue

    const angle = calculateAngle(a, v, b)
    angles.push({
      name: joint.name,
      angle,
      confidence: minScore,
    })
  }

  return angles
}

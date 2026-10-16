import type { Pose, KeypointName } from './types'
import { extractJointAngles } from './angles'

/** Torso keypoints used for positional velocity */
const TORSO_KEYPOINTS: KeypointName[] = [
  'left_shoulder',
  'right_shoulder',
  'left_hip',
  'right_hip',
]

/** Rolling window duration in seconds */
const WINDOW_DURATION = 1.5

/** Energy threshold — below this, the user is considered still */
const ENERGY_THRESHOLD = 0.02

/** Blend weights for angular vs positional velocity */
const ANGULAR_WEIGHT = 0.6
const POSITIONAL_WEIGHT = 0.4

interface FrameEntry {
  pose: Pose
  time: number
}

/**
 * Tracks movement energy over a rolling window.
 * Blends angular velocity (joint angle changes) with positional velocity
 * (torso keypoint displacement normalized by torso size).
 */
export class MovementTracker {
  private frames: FrameEntry[] = []

  addFrame(pose: Pose, time: number): void {
    this.frames.push({ pose, time })

    // Prune old frames outside the window
    const cutoff = time - WINDOW_DURATION
    while (this.frames.length > 0 && this.frames[0].time < cutoff) {
      this.frames.shift()
    }
  }

  /**
   * Compute movement energy: a blend of angular velocity and positional velocity.
   * Returns 0 when standing still, higher values when dancing.
   */
  getMovementEnergy(): number {
    if (this.frames.length < 2) return 0

    let totalAngularVelocity = 0
    let totalPositionalVelocity = 0
    let pairCount = 0

    for (let i = 1; i < this.frames.length; i++) {
      const prev = this.frames[i - 1]
      const curr = this.frames[i]
      const dt = curr.time - prev.time
      if (dt <= 0) continue

      // Angular velocity
      const angVel = computeAngularVelocityBetween(prev.pose, curr.pose)

      // Positional velocity (torso-normalized)
      const posVel = computePositionalVelocity(prev.pose, curr.pose, dt)

      totalAngularVelocity += angVel
      totalPositionalVelocity += posVel
      pairCount++
    }

    if (pairCount === 0) return 0

    const avgAngular = totalAngularVelocity / pairCount
    const avgPositional = totalPositionalVelocity / pairCount

    return ANGULAR_WEIGHT * avgAngular + POSITIONAL_WEIGHT * avgPositional
  }

  /**
   * Get a movement factor (0 to 1) to multiply with pose similarity scores.
   * Smooth falloff: still → 0, dancing → 1.
   */
  getMovementFactor(): number {
    const energy = this.getMovementEnergy()
    return Math.min(1, energy / ENERGY_THRESHOLD)
  }

  isMoving(): boolean {
    return this.getMovementEnergy() >= ENERGY_THRESHOLD
  }

  /** Get the pose from approximately `secondsAgo` before the latest frame */
  getRecentPose(secondsAgo: number): Pose | null {
    if (this.frames.length === 0) return null
    const latest = this.frames[this.frames.length - 1]
    const targetTime = latest.time - secondsAgo

    let closest: FrameEntry | null = null
    let closestDiff = Infinity
    for (const f of this.frames) {
      const diff = Math.abs(f.time - targetTime)
      if (diff < closestDiff) {
        closestDiff = diff
        closest = f
      }
    }
    return closest && closestDiff < 0.2 ? closest.pose : null
  }

  reset(): void {
    this.frames = []
  }
}

/** Average absolute joint angle change between two poses (rad/frame) */
function computeAngularVelocityBetween(poseA: Pose, poseB: Pose): number {
  const anglesA = extractJointAngles(poseA)
  const anglesB = extractJointAngles(poseB)

  let totalDiff = 0
  let count = 0

  for (const aAngle of anglesA) {
    const bAngle = anglesB.find((b) => b.name === aAngle.name)
    if (!bAngle) continue
    totalDiff += Math.abs(aAngle.angle - bAngle.angle)
    count++
  }

  return count > 0 ? totalDiff / count : 0
}

/** Positional velocity of torso keypoints, normalized by torso size */
function computePositionalVelocity(poseA: Pose, poseB: Pose, dt: number): number {
  const torsoSize = computeTorsoSize(poseB)
  if (torsoSize <= 0) return 0

  let totalDisplacement = 0
  let count = 0

  for (const name of TORSO_KEYPOINTS) {
    const kpA = poseA.keypoints.find((k) => k.name === name)
    const kpB = poseB.keypoints.find((k) => k.name === name)
    if (!kpA || !kpB || kpA.score < 0.3 || kpB.score < 0.3) continue

    const dx = kpB.x - kpA.x
    const dy = kpB.y - kpA.y
    totalDisplacement += Math.sqrt(dx * dx + dy * dy)
    count++
  }

  if (count === 0) return 0

  // Normalize by torso size and time delta
  return (totalDisplacement / count) / torsoSize / dt
}

/** Compute torso height as distance from mid-shoulder to mid-hip */
function computeTorsoSize(pose: Pose): number {
  const ls = pose.keypoints.find((k) => k.name === 'left_shoulder')
  const rs = pose.keypoints.find((k) => k.name === 'right_shoulder')
  const lh = pose.keypoints.find((k) => k.name === 'left_hip')
  const rh = pose.keypoints.find((k) => k.name === 'right_hip')

  if (!ls || !rs || !lh || !rh) return 0

  const midShoulderX = (ls.x + rs.x) / 2
  const midShoulderY = (ls.y + rs.y) / 2
  const midHipX = (lh.x + rh.x) / 2
  const midHipY = (lh.y + rh.y) / 2

  const dx = midHipX - midShoulderX
  const dy = midHipY - midShoulderY
  return Math.sqrt(dx * dx + dy * dy)
}

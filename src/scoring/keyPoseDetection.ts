import type { Pose, Keypoint } from './types'
import { extractJointAngles } from './angles'

export interface PoseTimeline {
  fps: number
  duration: number
  keyframes: { time: number; keypoints: Keypoint[] }[]
}

export interface KeyPose {
  timestamp: number
  pose: Pose
  type: 'held' | 'transition' | 'distinctive'
  tolerance: number // how generous the matching threshold should be
}

export interface KeyPoseConfig {
  /** Minimum frames a pose must be held to count as "held" (default: 10) */
  heldFrameCount: number
  /** Maximum angular velocity (rad/frame) to consider a pose "held" (default: 0.05) */
  heldVelocityThreshold: number
  /** Minimum angular velocity to detect a sharp transition (default: 0.3) */
  transitionVelocityThreshold: number
  /** Frames after high velocity to check for sudden stop (default: 5) */
  transitionStopWindow: number
  /** Minimum angle deviation from neutral to be "distinctive" (default: 0.8 rad) */
  distinctiveThreshold: number
  /** Minimum time gap between key poses in seconds (default: 1.5) */
  minGapSeconds: number
  /** Tolerance multiplier: higher = more generous matching (default: 1.0) */
  toleranceMultiplier: number
}

const DEFAULT_CONFIG: KeyPoseConfig = {
  heldFrameCount: 10,
  heldVelocityThreshold: 0.05,
  transitionVelocityThreshold: 0.3,
  transitionStopWindow: 5,
  distinctiveThreshold: 0.8,
  minGapSeconds: 1.5,
  toleranceMultiplier: 1.0,
}

/** Neutral standing angles (approximate, in radians) */
const NEUTRAL_ANGLES: Record<string, number> = {
  left_elbow: Math.PI,      // straight arm
  right_elbow: Math.PI,
  left_shoulder: Math.PI * 0.1, // arms at sides
  right_shoulder: Math.PI * 0.1,
  left_hip: Math.PI,        // straight leg
  right_hip: Math.PI,
  left_knee: Math.PI,
  right_knee: Math.PI,
}

/**
 * Compute angular velocity between two frames as average absolute angle change.
 */
export function computeAngularVelocity(poseA: Pose, poseB: Pose): number {
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

/**
 * Compute how "distinctive" a pose is — how far its angles deviate from neutral standing.
 */
export function computeDistinctiveness(pose: Pose): number {
  const angles = extractJointAngles(pose)
  if (angles.length === 0) return 0

  let totalDeviation = 0

  for (const angle of angles) {
    const neutral = NEUTRAL_ANGLES[angle.name]
    if (neutral !== undefined) {
      totalDeviation += Math.abs(angle.angle - neutral)
    }
  }

  return totalDeviation / angles.length
}

/**
 * Detect key/dramatic poses in a pose timeline.
 *
 * Three types of key poses are detected:
 * 1. Held positions: low angular velocity for N consecutive frames
 * 2. Sharp transitions: high velocity followed by sudden stop
 * 3. Distinctive poses: poses with high deviation from neutral standing
 */
export function detectKeyPoses(
  timeline: PoseTimeline,
  configOverrides?: Partial<KeyPoseConfig>,
): KeyPose[] {
  const config = { ...DEFAULT_CONFIG, ...configOverrides }
  const frames = timeline.keyframes

  if (frames.length < 2) return []

  // Step 1: Compute per-frame angular velocities
  const velocities: number[] = [0]
  for (let i = 1; i < frames.length; i++) {
    const poseA: Pose = { keypoints: frames[i - 1].keypoints }
    const poseB: Pose = { keypoints: frames[i].keypoints }
    velocities.push(computeAngularVelocity(poseA, poseB))
  }

  // Step 2: Find candidate key poses
  const candidates: KeyPose[] = []

  // Detect held positions
  let heldCount = 0
  for (let i = 0; i < frames.length; i++) {
    if (velocities[i] < config.heldVelocityThreshold) {
      heldCount++
      if (heldCount === config.heldFrameCount) {
        // Mark the middle of the held section
        const midIdx = i - Math.floor(config.heldFrameCount / 2)
        candidates.push({
          timestamp: frames[midIdx].time,
          pose: { keypoints: frames[midIdx].keypoints },
          type: 'held',
          tolerance: 0.25 * config.toleranceMultiplier,
        })
      }
    } else {
      heldCount = 0
    }
  }

  // Detect sharp transitions (high velocity → sudden stop)
  for (let i = 1; i < frames.length - config.transitionStopWindow; i++) {
    if (velocities[i] >= config.transitionVelocityThreshold) {
      // Check if velocity drops within the stop window
      let stopped = false
      for (let j = 1; j <= config.transitionStopWindow; j++) {
        if (i + j < velocities.length && velocities[i + j] < config.heldVelocityThreshold) {
          stopped = true
          const stopIdx = i + j
          candidates.push({
            timestamp: frames[stopIdx].time,
            pose: { keypoints: frames[stopIdx].keypoints },
            type: 'transition',
            tolerance: 0.3 * config.toleranceMultiplier,
          })
          break
        }
      }
      if (stopped) {
        // Skip ahead past the stop window
        i += config.transitionStopWindow
      }
    }
  }

  // Detect distinctive poses (sample every N frames)
  const sampleInterval = Math.max(1, Math.floor(timeline.fps / 2))
  for (let i = 0; i < frames.length; i += sampleInterval) {
    const pose: Pose = { keypoints: frames[i].keypoints }
    const distinctiveness = computeDistinctiveness(pose)
    if (distinctiveness >= config.distinctiveThreshold) {
      candidates.push({
        timestamp: frames[i].time,
        pose,
        type: 'distinctive',
        tolerance: 0.2 * config.toleranceMultiplier,
      })
    }
  }

  // Step 3: Sort by timestamp and deduplicate (enforce minimum gap)
  candidates.sort((a, b) => a.timestamp - b.timestamp)

  const result: KeyPose[] = []
  let lastTimestamp = -Infinity

  for (const candidate of candidates) {
    if (candidate.timestamp - lastTimestamp >= config.minGapSeconds) {
      result.push(candidate)
      lastTimestamp = candidate.timestamp
    }
  }

  return result
}

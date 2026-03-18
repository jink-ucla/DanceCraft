import type { Pose, Keypoint } from './types'
import { BODY_PART_JOINTS } from './types'
import { extractJointAngles } from './angles'

export interface PoseTimeline {
  fps: number
  duration: number
  keyframes: { time: number; keypoints: Keypoint[] }[]
}

export interface KeyPose {
  timestamp: number
  pose: Pose
  type: 'held' | 'transition' | 'distinctive' | 'move'
  tolerance: number // how generous the matching threshold should be
  /** Joints that changed most vs surrounding context — scored with higher weight */
  focusJoints?: string[]
  /** Which body part dominates: 'arms', 'legs', or 'full' */
  focusArea?: 'arms' | 'legs' | 'full'
  /** For 'move' type: expected signed angle change per joint over the move window */
  expectedVelocity?: Record<string, number>
  /** For 'move' type: duration of the movement window in seconds */
  moveWindow?: number
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
  left_wrist: Math.PI,      // straight wrist
  right_wrist: Math.PI,
  left_hip: Math.PI,        // straight leg
  right_hip: Math.PI,
  left_knee: Math.PI,
  right_knee: Math.PI,
  left_ankle: Math.PI * 0.5, // foot at ~90 degrees
  right_ankle: Math.PI * 0.5,
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
 * Compute how different a pose is from its surrounding context.
 * Unlike computeDistinctiveness (which compares to neutral standing),
 * this measures how much the pose stands out from what came before and after.
 * Returns average per-joint angular deviation from neighbors.
 */
export function computeContextDistinctiveness(
  frames: { time: number; keypoints: Keypoint[] }[],
  frameIdx: number,
  fps: number,
): number {
  const windowFrames = Math.floor(fps * 1.0) // 1 second window
  const pose: Pose = { keypoints: frames[frameIdx].keypoints }
  const poseAngles = extractJointAngles(pose)
  if (poseAngles.length === 0) return 0

  // Sample neighbors: 1s before and 1s after
  const neighborIndices = [
    Math.max(0, frameIdx - windowFrames),
    Math.max(0, frameIdx - Math.floor(windowFrames / 2)),
    Math.min(frames.length - 1, frameIdx + Math.floor(windowFrames / 2)),
    Math.min(frames.length - 1, frameIdx + windowFrames),
  ]

  let maxDeviation = 0
  for (const ni of neighborIndices) {
    if (ni === frameIdx) continue
    const neighborAngles = extractJointAngles({ keypoints: frames[ni].keypoints })
    let totalDiff = 0
    let count = 0
    for (const pa of poseAngles) {
      const na = neighborAngles.find((a) => a.name === pa.name)
      if (!na) continue
      totalDiff += Math.abs(pa.angle - na.angle)
      count++
    }
    if (count > 0) {
      maxDeviation = Math.max(maxDeviation, totalDiff / count)
    }
  }

  return maxDeviation
}

/**
 * Compute focus joints for a key pose: which joints deviated most
 * from the surrounding context. Returns joint names sorted by deviation.
 */
export function computeFocusJoints(
  frames: { time: number; keypoints: Keypoint[] }[],
  frameIdx: number,
  fps: number,
): { focusJoints: string[]; focusArea: 'arms' | 'legs' | 'full' } {
  const windowFrames = Math.floor(fps * 1.0)
  const pose: Pose = { keypoints: frames[frameIdx].keypoints }
  const poseAngles = extractJointAngles(pose)

  // Compute per-joint max deviation from neighbors
  const neighborIndices = [
    Math.max(0, frameIdx - windowFrames),
    Math.max(0, frameIdx - Math.floor(windowFrames / 2)),
    Math.min(frames.length - 1, frameIdx + Math.floor(windowFrames / 2)),
    Math.min(frames.length - 1, frameIdx + windowFrames),
  ].filter((ni) => ni !== frameIdx)

  const jointDeviations: Record<string, number> = {}
  for (const pa of poseAngles) {
    let maxDev = 0
    for (const ni of neighborIndices) {
      const neighborAngles = extractJointAngles({ keypoints: frames[ni].keypoints })
      const na = neighborAngles.find((a) => a.name === pa.name)
      if (na) {
        maxDev = Math.max(maxDev, Math.abs(pa.angle - na.angle))
      }
    }
    jointDeviations[pa.name] = maxDev
  }

  // Threshold: joints with deviation > 0.3 rad (~17°) are "focus"
  const FOCUS_THRESHOLD = 0.3
  const focusJoints = Object.entries(jointDeviations)
    .filter(([, dev]) => dev > FOCUS_THRESHOLD)
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name)

  // Classify focus area
  const armJoints = BODY_PART_JOINTS.arms
  const legJoints = BODY_PART_JOINTS.legs
  const armFocusCount = focusJoints.filter((j) => armJoints.includes(j)).length
  const legFocusCount = focusJoints.filter((j) => legJoints.includes(j)).length

  let focusArea: 'arms' | 'legs' | 'full'
  if (armFocusCount > 0 && legFocusCount === 0) {
    focusArea = 'arms'
  } else if (legFocusCount > 0 && armFocusCount === 0) {
    focusArea = 'legs'
  } else {
    focusArea = 'full'
  }

  return { focusJoints, focusArea }
}

/**
 * Detect key/dramatic poses in a pose timeline.
 *
 * Three types of key poses are detected:
 * 1. Held positions: low angular velocity for N consecutive frames
 * 2. Sharp transitions: high velocity followed by sudden stop
 * 3. Distinctive poses: poses with high deviation from surrounding context
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

  // Detect distinctive poses using CONTEXT-RELATIVE distinctiveness
  // (how different from neighbors, not from neutral standing)
  const sampleInterval = Math.max(1, Math.floor(timeline.fps / 2))
  for (let i = 0; i < frames.length; i += sampleInterval) {
    const contextDist = computeContextDistinctiveness(frames, i, timeline.fps)
    // Also check neutral distinctiveness as a secondary filter
    const pose: Pose = { keypoints: frames[i].keypoints }
    const neutralDist = computeDistinctiveness(pose)
    // Must be distinctive from BOTH context and neutral
    if (contextDist >= config.distinctiveThreshold * 0.5 && neutralDist >= config.distinctiveThreshold * 0.7) {
      candidates.push({
        timestamp: frames[i].time,
        pose,
        type: 'distinctive',
        tolerance: 0.2 * config.toleranceMultiplier,
      })
    }
  }

  // Detect big movements with ADAPTIVE duration.
  // Instead of fixed windows, find contiguous "movement regions" where velocity
  // is notably above the dance's baseline, then measure per-joint angle change
  // across each region. This naturally produces short windows for quick flicks
  // and long windows for sweeping arcs.

  // Compute adaptive velocity threshold from the dance's own distribution
  const sortedVelocities = [...velocities].sort((a, b) => a - b)
  const medianVelocity = sortedVelocities[Math.floor(sortedVelocities.length / 2)] || 0.04
  const MOVE_REGION_THRESHOLD = Math.max(0.03, medianVelocity * 1.5)

  // Smooth velocities (3-frame moving average) to reduce noise
  const smoothedVel = velocities.map((_, i) => {
    const lo = Math.max(0, i - 1)
    const hi = Math.min(velocities.length - 1, i + 1)
    let sum = 0
    let count = 0
    for (let j = lo; j <= hi; j++) { sum += velocities[j]; count++ }
    return sum / count
  })

  // Find contiguous movement regions
  interface MoveRegion { start: number; end: number; peak: number; peakVel: number }
  const moveRegions: MoveRegion[] = []
  let regionStart = -1
  let peakIdx = 0
  let peakVel = 0

  for (let i = 1; i < smoothedVel.length; i++) {
    if (smoothedVel[i] >= MOVE_REGION_THRESHOLD) {
      if (regionStart < 0) { regionStart = i; peakIdx = i; peakVel = smoothedVel[i] }
      if (smoothedVel[i] > peakVel) { peakVel = smoothedVel[i]; peakIdx = i }
    } else if (regionStart >= 0) {
      moveRegions.push({ start: regionStart, end: i - 1, peak: peakIdx, peakVel })
      regionStart = -1; peakVel = 0
    }
  }
  if (regionStart >= 0) {
    moveRegions.push({ start: regionStart, end: smoothedVel.length - 1, peak: peakIdx, peakVel })
  }

  // Process each region into a move candidate
  const MIN_REGION_SECONDS = 0.2
  const MAX_MOVE_HALF_WINDOW = 1.25 // max 2.5s total play duration
  const MIN_MOVE_ANGLE_CHANGE = 0.6
  const MIN_MOVE_JOINTS = 2
  const MOVE_JOINT_THRESHOLD = 0.3

  for (const region of moveRegions) {
    const regionDuration = (region.end - region.start) / timeline.fps
    if (regionDuration < MIN_REGION_SECONDS) continue

    // Compute per-joint angle change across the full region
    const rStart = Math.max(0, region.start)
    const rEnd = Math.min(frames.length - 1, region.end)
    const startAngles = extractJointAngles({ keypoints: frames[rStart].keypoints })
    const endAngles = extractJointAngles({ keypoints: frames[rEnd].keypoints })

    const expectedVelocity: Record<string, number> = {}
    let maxChange = 0
    const moveJoints: string[] = []

    for (const sa of startAngles) {
      const ea = endAngles.find((a) => a.name === sa.name)
      if (!ea) continue
      const change = ea.angle - sa.angle
      expectedVelocity[sa.name] = change
      if (Math.abs(change) > MOVE_JOINT_THRESHOLD) moveJoints.push(sa.name)
      maxChange = Math.max(maxChange, Math.abs(change))
    }

    if (maxChange < MIN_MOVE_ANGLE_CHANGE || moveJoints.length < MIN_MOVE_JOINTS) continue

    // Adaptive half-window: distance from peak to the farther region edge, clamped
    const peakFrame = Math.min(region.peak, frames.length - 1)
    const halfBefore = (peakFrame - region.start) / timeline.fps
    const halfAfter = (region.end - peakFrame) / timeline.fps
    const moveWindow = Math.min(MAX_MOVE_HALF_WINDOW, Math.max(halfBefore, halfAfter, 0.15))

    const totalMoveSize = moveJoints.reduce((sum, j) => sum + Math.abs(expectedVelocity[j] ?? 0), 0)

    candidates.push({
      timestamp: frames[peakFrame].time,
      pose: { keypoints: frames[peakFrame].keypoints },
      type: 'move',
      tolerance: 0.3 * config.toleranceMultiplier,
      expectedVelocity,
      moveWindow,
      focusJoints: moveJoints,
      _moveSize: totalMoveSize,
    } as KeyPose & { _moveSize: number })
  }

  // Step 3: Prioritize held/transition poses, then fill gaps with distinctive/moves
  const typePriority: Record<string, number> = { held: 0, transition: 1, move: 2, distinctive: 3 }
  candidates.sort((a, b) => {
    // Primary: priority (held first, then transition, then distinctive)
    const pa = typePriority[a.type] ?? 2
    const pb = typePriority[b.type] ?? 2
    if (pa !== pb) return pa - pb
    // Secondary: timestamp
    return a.timestamp - b.timestamp
  })

  // First pass: place held and transition poses
  const result: KeyPose[] = []
  const usedTimestamps: number[] = []

  for (const candidate of candidates) {
    if (candidate.type === 'distinctive' || candidate.type === 'move') continue
    const tooClose = usedTimestamps.some(
      (t) => Math.abs(candidate.timestamp - t) < config.minGapSeconds
    )
    if (!tooClose) {
      result.push(candidate)
      usedTimestamps.push(candidate.timestamp)
    }
  }

  // Second pass: fill gaps with moves — use a SHORTER gap than static poses
  // because moves represent dynamic actions that can meaningfully coexist
  // near static pose snapshots (e.g., arm swing 1.5s before a held pose).
  // Sort by movement magnitude (biggest moves first) so we pick the best ones.
  const moveGap = Math.max(1.5, config.minGapSeconds * 0.5)
  const moveCandidates = candidates
    .filter((c) => c.type === 'move')
    .sort((a, b) => ((b as any)._moveSize ?? 0) - ((a as any)._moveSize ?? 0))
  for (const candidate of moveCandidates) {
    const tooClose = usedTimestamps.some(
      (t) => Math.abs(candidate.timestamp - t) < moveGap
    )
    if (!tooClose) {
      result.push(candidate)
      usedTimestamps.push(candidate.timestamp)
    }
  }

  // Third pass: fill remaining gaps with distinctive poses
  for (const candidate of candidates) {
    if (candidate.type !== 'distinctive') continue
    const tooClose = usedTimestamps.some(
      (t) => Math.abs(candidate.timestamp - t) < config.minGapSeconds
    )
    if (!tooClose) {
      result.push(candidate)
      usedTimestamps.push(candidate.timestamp)
    }
  }

  // Sort final result by timestamp
  result.sort((a, b) => a.timestamp - b.timestamp)

  // Compute focus joints for each selected key pose
  for (const kp of result) {
    const frameIdx = frames.findIndex((f) => f.time === kp.timestamp)
    if (frameIdx >= 0) {
      const { focusJoints, focusArea } = computeFocusJoints(frames, frameIdx, timeline.fps)
      kp.focusJoints = focusJoints
      kp.focusArea = focusArea
    }
  }

  return result
}

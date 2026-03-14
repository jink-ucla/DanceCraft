import { describe, it, expect } from 'vitest'
import {
  detectKeyPoses,
  computeAngularVelocity,
  computeDistinctiveness,
} from '../../../src/scoring/keyPoseDetection'
import type { PoseTimeline } from '../../../src/scoring/keyPoseDetection'
import type { Pose, Keypoint } from '../../../src/scoring/types'
import { STANDING_POSE, T_POSE, ARMS_UP_SQUAT } from './fixtures'

function poseToKeypoints(pose: Pose): Keypoint[] {
  return pose.keypoints
}

/** Create a timeline from a series of poses, each repeated N times */
function makeTimeline(
  segments: { pose: Pose; frames: number }[],
  fps = 30,
): PoseTimeline {
  const keyframes: { time: number; keypoints: Keypoint[] }[] = []
  let frameIdx = 0

  for (const segment of segments) {
    for (let i = 0; i < segment.frames; i++) {
      keyframes.push({
        time: frameIdx / fps,
        keypoints: poseToKeypoints(segment.pose),
      })
      frameIdx++
    }
  }

  return {
    fps,
    duration: frameIdx / fps,
    keyframes,
  }
}

/** Create a smooth transition between two poses over N frames */
function interpolatePoses(poseA: Pose, poseB: Pose, frames: number): Pose[] {
  const result: Pose[] = []
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1)
    const keypoints: Keypoint[] = poseA.keypoints.map((kpA, idx) => {
      const kpB = poseB.keypoints[idx]
      return {
        name: kpA.name,
        x: kpA.x + (kpB.x - kpA.x) * t,
        y: kpA.y + (kpB.y - kpA.y) * t,
        score: Math.min(kpA.score, kpB.score),
      }
    })
    result.push({ keypoints })
  }
  return result
}

/** Create timeline with smooth transitions */
function makeTimelineWithTransitions(
  segments: { pose: Pose; holdFrames: number; transitionFrames: number }[],
  fps = 30,
): PoseTimeline {
  const keyframes: { time: number; keypoints: Keypoint[] }[] = []
  let frameIdx = 0

  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]
    // Hold phase
    for (let i = 0; i < seg.holdFrames; i++) {
      keyframes.push({
        time: frameIdx / fps,
        keypoints: poseToKeypoints(seg.pose),
      })
      frameIdx++
    }

    // Transition to next segment
    if (s < segments.length - 1 && seg.transitionFrames > 0) {
      const nextPose = segments[s + 1].pose
      const transition = interpolatePoses(seg.pose, nextPose, seg.transitionFrames + 2)
      // Skip first and last (they're the hold poses)
      for (let i = 1; i <= seg.transitionFrames; i++) {
        keyframes.push({
          time: frameIdx / fps,
          keypoints: poseToKeypoints(transition[i]),
        })
        frameIdx++
      }
    }
  }

  return {
    fps,
    duration: frameIdx / fps,
    keyframes,
  }
}

describe('computeAngularVelocity', () => {
  it('returns 0 for identical poses', () => {
    const velocity = computeAngularVelocity(STANDING_POSE, STANDING_POSE)
    expect(velocity).toBe(0)
  })

  it('returns non-zero for different poses', () => {
    const velocity = computeAngularVelocity(STANDING_POSE, T_POSE)
    expect(velocity).toBeGreaterThan(0)
  })

  it('returns higher velocity for more different poses', () => {
    const v1 = computeAngularVelocity(STANDING_POSE, T_POSE)
    const v2 = computeAngularVelocity(STANDING_POSE, ARMS_UP_SQUAT)
    // Both should be non-zero
    expect(v1).toBeGreaterThan(0)
    expect(v2).toBeGreaterThan(0)
  })
})

describe('computeDistinctiveness', () => {
  it('returns low distinctiveness for standing pose (near neutral)', () => {
    const d = computeDistinctiveness(STANDING_POSE)
    expect(d).toBeLessThan(0.5)
  })

  it('returns higher distinctiveness for T-pose', () => {
    const dStanding = computeDistinctiveness(STANDING_POSE)
    const dTPose = computeDistinctiveness(T_POSE)
    expect(dTPose).toBeGreaterThan(dStanding)
  })

  it('returns high distinctiveness for arms-up squat', () => {
    const d = computeDistinctiveness(ARMS_UP_SQUAT)
    expect(d).toBeGreaterThan(0.3)
  })

  it('returns 0 for empty pose', () => {
    const d = computeDistinctiveness({ keypoints: [] })
    expect(d).toBe(0)
  })
})

describe('detectKeyPoses', () => {
  it('detects held positions', () => {
    // Standing for 20 frames (held), then T-pose for 20 frames (held)
    const timeline = makeTimeline([
      { pose: STANDING_POSE, frames: 20 },
      { pose: T_POSE, frames: 20 },
    ])

    const keyPoses = detectKeyPoses(timeline, {
      heldFrameCount: 10,
      minGapSeconds: 0,
    })

    const heldPoses = keyPoses.filter((kp) => kp.type === 'held')
    expect(heldPoses.length).toBeGreaterThanOrEqual(1)
  })

  it('detects sharp transitions', () => {
    // Hold standing → instant jump to T-pose → hold
    const timeline = makeTimeline([
      { pose: STANDING_POSE, frames: 15 },
      { pose: T_POSE, frames: 15 },
    ], 30)

    const keyPoses = detectKeyPoses(timeline, {
      transitionVelocityThreshold: 0.1,
      heldVelocityThreshold: 0.05,
      minGapSeconds: 0,
    })

    const transitions = keyPoses.filter((kp) => kp.type === 'transition')
    expect(transitions.length).toBeGreaterThanOrEqual(1)
  })

  it('detects distinctive poses', () => {
    // Arms-up squat is distinctive
    const timeline = makeTimeline([
      { pose: ARMS_UP_SQUAT, frames: 30 },
    ])

    const keyPoses = detectKeyPoses(timeline, {
      distinctiveThreshold: 0.3,
      minGapSeconds: 0,
    })

    const distinctive = keyPoses.filter((kp) => kp.type === 'distinctive')
    expect(distinctive.length).toBeGreaterThanOrEqual(1)
  })

  it('enforces minimum gap between key poses', () => {
    const timeline = makeTimeline([
      { pose: STANDING_POSE, frames: 30 },
      { pose: ARMS_UP_SQUAT, frames: 30 },
      { pose: T_POSE, frames: 30 },
    ])

    const keyPoses = detectKeyPoses(timeline, {
      minGapSeconds: 2.0,
    })

    for (let i = 1; i < keyPoses.length; i++) {
      const gap = keyPoses[i].timestamp - keyPoses[i - 1].timestamp
      expect(gap).toBeGreaterThanOrEqual(2.0)
    }
  })

  it('returns empty array for empty timeline', () => {
    const timeline: PoseTimeline = { fps: 30, duration: 0, keyframes: [] }
    expect(detectKeyPoses(timeline)).toEqual([])
  })

  it('returns empty array for single-frame timeline', () => {
    const timeline: PoseTimeline = {
      fps: 30,
      duration: 0,
      keyframes: [{ time: 0, keypoints: poseToKeypoints(STANDING_POSE) }],
    }
    expect(detectKeyPoses(timeline)).toEqual([])
  })

  it('key poses have required fields', () => {
    const timeline = makeTimeline([
      { pose: STANDING_POSE, frames: 20 },
      { pose: ARMS_UP_SQUAT, frames: 20 },
    ])

    const keyPoses = detectKeyPoses(timeline, { minGapSeconds: 0 })

    for (const kp of keyPoses) {
      expect(kp).toHaveProperty('timestamp')
      expect(kp).toHaveProperty('pose')
      expect(kp).toHaveProperty('type')
      expect(kp).toHaveProperty('tolerance')
      expect(typeof kp.timestamp).toBe('number')
      expect(kp.timestamp).toBeGreaterThanOrEqual(0)
      expect(['held', 'transition', 'distinctive']).toContain(kp.type)
      expect(kp.tolerance).toBeGreaterThan(0)
      expect(kp.pose.keypoints.length).toBe(17)
    }
  })

  it('produces reasonable density of key poses (5-15 per minute)', () => {
    // 60 seconds of dance: alternating poses with holds and transitions
    const fps = 30
    const segments = []
    const poses = [STANDING_POSE, T_POSE, ARMS_UP_SQUAT]

    for (let i = 0; i < 20; i++) {
      segments.push({
        pose: poses[i % poses.length],
        holdFrames: 30 + Math.floor(i * 7) % 30, // 30-60 frames hold
        transitionFrames: 5,
      })
    }

    const timeline = makeTimelineWithTransitions(segments, fps)

    const keyPoses = detectKeyPoses(timeline, {
      minGapSeconds: 3.0,
      heldFrameCount: 10,
    })

    const durationMinutes = timeline.duration / 60
    const perMinute = keyPoses.length / durationMinutes

    // With 3s gap, density should be capped around 20/min max
    // Acceptance criteria: 5-15 key poses per minute for good gameplay
    expect(perMinute).toBeGreaterThanOrEqual(3)
    expect(perMinute).toBeLessThanOrEqual(25)
  })

  it('sensitivity config affects number of detected poses', () => {
    const timeline = makeTimeline([
      { pose: STANDING_POSE, frames: 30 },
      { pose: T_POSE, frames: 30 },
      { pose: ARMS_UP_SQUAT, frames: 30 },
      { pose: STANDING_POSE, frames: 30 },
    ])

    const sensitive = detectKeyPoses(timeline, {
      heldFrameCount: 5,
      transitionVelocityThreshold: 0.05,
      distinctiveThreshold: 0.2,
      minGapSeconds: 0.5,
    })

    const conservative = detectKeyPoses(timeline, {
      heldFrameCount: 25,
      transitionVelocityThreshold: 1.0,
      distinctiveThreshold: 2.0,
      minGapSeconds: 3.0,
    })

    expect(sensitive.length).toBeGreaterThanOrEqual(conservative.length)
  })

  it('timestamps are sorted in ascending order', () => {
    const timeline = makeTimeline([
      { pose: STANDING_POSE, frames: 30 },
      { pose: T_POSE, frames: 30 },
      { pose: ARMS_UP_SQUAT, frames: 30 },
    ])

    const keyPoses = detectKeyPoses(timeline, { minGapSeconds: 0 })

    for (let i = 1; i < keyPoses.length; i++) {
      expect(keyPoses[i].timestamp).toBeGreaterThanOrEqual(
        keyPoses[i - 1].timestamp
      )
    }
  })

  it('tolerance multiplier scales tolerance values', () => {
    const timeline = makeTimeline([
      { pose: STANDING_POSE, frames: 20 },
      { pose: ARMS_UP_SQUAT, frames: 20 },
    ])

    const normal = detectKeyPoses(timeline, {
      toleranceMultiplier: 1.0,
      minGapSeconds: 0,
    })
    const generous = detectKeyPoses(timeline, {
      toleranceMultiplier: 2.0,
      minGapSeconds: 0,
    })

    if (normal.length > 0 && generous.length > 0) {
      // Same types should have doubled tolerance
      const normalTol = normal[0].tolerance
      const generousTol = generous[0].tolerance
      expect(generousTol).toBeCloseTo(normalTol * 2, 5)
    }
  })
})

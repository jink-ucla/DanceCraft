import { describe, it, expect } from 'vitest'
import {
  normalizePose,
  normalizeToVideoDimensions,
  filterLowConfidence,
} from '../../../src/pose/normalization'
import type { Pose } from '../../../src/scoring/types'
import {
  STANDING_POSE,
  LOW_CONFIDENCE_POSE,
  EMPTY_POSE,
} from '../scoring/fixtures'

function makePose(
  partialKeypoints: Record<string, { x: number; y: number; score?: number }>
): Pose {
  const names = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  ]
  return {
    keypoints: names.map((name) => ({
      name,
      x: partialKeypoints[name]?.x ?? 0,
      y: partialKeypoints[name]?.y ?? 0,
      score: partialKeypoints[name]?.score ?? 0,
    })),
  }
}

describe('normalizePose', () => {
  it('normalizes keypoints to center around 0.5', () => {
    const result = normalizePose(STANDING_POSE)
    const confident = result.keypoints.filter((kp) => kp.score >= 0.3)

    // All confident keypoints should be roughly centered
    const avgX =
      confident.reduce((sum, kp) => sum + kp.x, 0) / confident.length
    const avgY =
      confident.reduce((sum, kp) => sum + kp.y, 0) / confident.length

    // Center should be near 0.5 (not exact due to bounding box vs centroid difference)
    expect(avgX).toBeCloseTo(0.5, 0)
    expect(avgY).toBeCloseTo(0.5, 0)
  })

  it('maintains aspect ratio (uses max range)', () => {
    // Pose that is wider than tall
    const widePose = makePose({
      left_shoulder: { x: 0, y: 5, score: 0.9 },
      right_shoulder: { x: 10, y: 5, score: 0.9 },
      left_hip: { x: 2, y: 7, score: 0.9 },
      right_hip: { x: 8, y: 7, score: 0.9 },
    })

    const result = normalizePose(widePose)
    const confident = result.keypoints.filter((kp) => kp.score >= 0.3)

    // Width range (10) > height range (2), so width maps to [0, 1]
    // Height range should be smaller than [0, 1]
    const xs = confident.map((kp) => kp.x)
    const ys = confident.map((kp) => kp.y)

    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.0, 1)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1.0)
  })

  it('returns original pose when fewer than 2 confident keypoints', () => {
    const singlePoint = makePose({
      nose: { x: 100, y: 200, score: 0.9 },
    })
    const result = normalizePose(singlePoint)
    expect(result).toBe(singlePoint)
  })

  it('returns original pose when range is zero (all points same location)', () => {
    const samePoint = makePose({
      nose: { x: 5, y: 5, score: 0.9 },
      left_shoulder: { x: 5, y: 5, score: 0.9 },
    })
    const result = normalizePose(samePoint)
    expect(result).toBe(samePoint)
  })

  it('handles empty pose', () => {
    const result = normalizePose(EMPTY_POSE)
    expect(result).toBe(EMPTY_POSE)
  })

  it('produces same normalized output for translated poses', () => {
    const pose1 = makePose({
      left_shoulder: { x: 0, y: 0, score: 0.9 },
      right_shoulder: { x: 1, y: 0, score: 0.9 },
      left_hip: { x: 0, y: 1, score: 0.9 },
      right_hip: { x: 1, y: 1, score: 0.9 },
    })
    const pose2 = makePose({
      left_shoulder: { x: 100, y: 200, score: 0.9 },
      right_shoulder: { x: 101, y: 200, score: 0.9 },
      left_hip: { x: 100, y: 201, score: 0.9 },
      right_hip: { x: 101, y: 201, score: 0.9 },
    })

    const norm1 = normalizePose(pose1)
    const norm2 = normalizePose(pose2)

    // Confident keypoints should have same relative positions
    const confident1 = norm1.keypoints.filter((kp) => kp.score >= 0.3)
    const confident2 = norm2.keypoints.filter((kp) => kp.score >= 0.3)

    for (let i = 0; i < confident1.length; i++) {
      expect(confident1[i].x).toBeCloseTo(confident2[i].x, 3)
      expect(confident1[i].y).toBeCloseTo(confident2[i].y, 3)
    }
  })
})

describe('normalizeToVideoDimensions', () => {
  it('converts pixel coordinates to [0, 1] range', () => {
    const pixelPose = makePose({
      nose: { x: 320, y: 120, score: 0.9 },
      left_shoulder: { x: 250, y: 200, score: 0.9 },
    })

    const result = normalizeToVideoDimensions(pixelPose, 640, 480)

    const nose = result.keypoints.find((kp) => kp.name === 'nose')!
    expect(nose.x).toBeCloseTo(0.5, 5)
    expect(nose.y).toBeCloseTo(0.25, 5)

    const shoulder = result.keypoints.find(
      (kp) => kp.name === 'left_shoulder'
    )!
    expect(shoulder.x).toBeCloseTo(250 / 640, 5)
    expect(shoulder.y).toBeCloseTo(200 / 480, 5)
  })

  it('returns original pose when dimensions are zero', () => {
    const result = normalizeToVideoDimensions(STANDING_POSE, 0, 0)
    expect(result).toBe(STANDING_POSE)
  })

  it('preserves confidence scores', () => {
    const result = normalizeToVideoDimensions(STANDING_POSE, 640, 480)
    for (let i = 0; i < result.keypoints.length; i++) {
      expect(result.keypoints[i].score).toBe(STANDING_POSE.keypoints[i].score)
    }
  })
})

describe('filterLowConfidence', () => {
  it('zeros out scores below threshold', () => {
    const result = filterLowConfidence(LOW_CONFIDENCE_POSE, 0.3)

    const wristL = result.keypoints.find((kp) => kp.name === 'left_wrist')!
    const wristR = result.keypoints.find((kp) => kp.name === 'right_wrist')!
    const ankleL = result.keypoints.find((kp) => kp.name === 'left_ankle')!
    const ankleR = result.keypoints.find((kp) => kp.name === 'right_ankle')!

    expect(wristL.score).toBe(0)
    expect(wristR.score).toBe(0)
    expect(ankleL.score).toBe(0)
    expect(ankleR.score).toBe(0)
  })

  it('preserves scores at or above threshold', () => {
    const result = filterLowConfidence(LOW_CONFIDENCE_POSE, 0.3)

    const shoulder = result.keypoints.find(
      (kp) => kp.name === 'left_shoulder'
    )!
    expect(shoulder.score).toBe(0.9)
  })

  it('preserves coordinates regardless of confidence', () => {
    const result = filterLowConfidence(LOW_CONFIDENCE_POSE, 0.3)

    for (let i = 0; i < result.keypoints.length; i++) {
      expect(result.keypoints[i].x).toBe(LOW_CONFIDENCE_POSE.keypoints[i].x)
      expect(result.keypoints[i].y).toBe(LOW_CONFIDENCE_POSE.keypoints[i].y)
    }
  })

  it('uses default threshold of 0.3', () => {
    const result = filterLowConfidence(LOW_CONFIDENCE_POSE)

    const wristL = result.keypoints.find((kp) => kp.name === 'left_wrist')!
    expect(wristL.score).toBe(0) // 0.1 < 0.3
  })
})

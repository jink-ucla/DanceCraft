import { describe, it, expect } from 'vitest'
import { comparePoses } from '../../../src/scoring/comparison'
import {
  STANDING_POSE,
  STANDING_POSE_TRANSLATED,
  T_POSE,
  ARMS_UP_SQUAT,
  LOW_CONFIDENCE_POSE,
  EMPTY_POSE,
} from './fixtures'

describe('comparePoses', () => {
  it('returns score ~1.0 for identical poses', () => {
    const result = comparePoses(STANDING_POSE, STANDING_POSE)
    expect(result.overallScore).toBeCloseTo(1.0, 2)
    for (const js of result.jointScores) {
      expect(js.similarity).toBeCloseTo(1.0, 2)
    }
  })

  it('is position-invariant (translated pose scores ~1.0)', () => {
    const result = comparePoses(STANDING_POSE, STANDING_POSE_TRANSLATED)
    expect(result.overallScore).toBeGreaterThan(0.95)
  })

  it('is scale-invariant (scaled pose produces same angles)', () => {
    // STANDING_POSE_TRANSLATED is also 2x scaled — angles remain the same
    const result = comparePoses(STANDING_POSE, STANDING_POSE_TRANSLATED)
    expect(result.overallScore).toBeGreaterThan(0.95)
  })

  it('returns lower score for partially matching poses (standing vs T-pose)', () => {
    const result = comparePoses(STANDING_POSE, T_POSE)
    // Legs are similar but arms are very different
    expect(result.overallScore).toBeGreaterThan(0.3)
    expect(result.overallScore).toBeLessThan(0.95)
  })

  it('returns low score for completely different poses', () => {
    const result = comparePoses(STANDING_POSE, ARMS_UP_SQUAT)
    expect(result.overallScore).toBeLessThan(0.8)
  })

  it('returns per-joint scores', () => {
    const result = comparePoses(STANDING_POSE, T_POSE)
    expect(result.jointScores.length).toBeGreaterThan(0)
    for (const js of result.jointScores) {
      expect(js.similarity).toBeGreaterThanOrEqual(0)
      expect(js.similarity).toBeLessThanOrEqual(1)
    }
  })

  it('handles low-confidence keypoints gracefully (fewer joints scored)', () => {
    const result = comparePoses(STANDING_POSE, LOW_CONFIDENCE_POSE)
    // Low-confidence pose should still produce a valid result but with fewer joints
    expect(result.jointScores.length).toBeLessThan(8)
    expect(result.jointScores.length).toBeGreaterThan(0)
    expect(result.overallScore).toBeGreaterThanOrEqual(0)
    expect(result.overallScore).toBeLessThanOrEqual(1)
  })

  it('returns score 0 when comparing with empty pose', () => {
    const result = comparePoses(STANDING_POSE, EMPTY_POSE)
    expect(result.overallScore).toBe(0)
    expect(result.jointScores.length).toBe(0)
  })

  it('returns score 0 when both poses are empty', () => {
    const result = comparePoses(EMPTY_POSE, EMPTY_POSE)
    expect(result.overallScore).toBe(0)
  })

  it('supports custom joint weights', () => {
    const armsOnlyWeights = [
      { name: 'left_elbow', pointA: 'left_shoulder' as const, vertex: 'left_elbow' as const, pointB: 'left_wrist' as const, weight: 1.0 },
      { name: 'right_elbow', pointA: 'right_shoulder' as const, vertex: 'right_elbow' as const, pointB: 'right_wrist' as const, weight: 1.0 },
    ]
    const result = comparePoses(STANDING_POSE, T_POSE, armsOnlyWeights)
    // Only arm joints are considered — verifies custom weights are applied
    expect(result.jointScores.length).toBe(2)
    // Score differs from default (which includes all 8 joints)
    const defaultResult = comparePoses(STANDING_POSE, T_POSE)
    expect(result.overallScore).not.toBeCloseTo(defaultResult.overallScore, 2)
  })
})

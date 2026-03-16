import { describe, it, expect } from 'vitest'
import { checkPresence } from '../../../src/scoring/presence'
import {
  STANDING_POSE,
  EMPTY_POSE,
  BARELY_VISIBLE_POSE,
  MINIMAL_PRESENCE_POSE,
  LOW_CONFIDENCE_POSE,
} from './fixtures'

describe('checkPresence', () => {
  it('returns not present for null pose', () => {
    const result = checkPresence(null)
    expect(result.present).toBe(false)
    expect(result.visibleCount).toBe(0)
    expect(result.confidence).toBe(0)
  })

  it('returns not present for empty pose', () => {
    const result = checkPresence(EMPTY_POSE)
    expect(result.present).toBe(false)
    expect(result.visibleCount).toBe(0)
  })

  it('returns present for a fully visible standing pose', () => {
    const result = checkPresence(STANDING_POSE)
    expect(result.present).toBe(true)
    expect(result.visibleCount).toBe(8) // all 8 core keypoints
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('returns not present when too few core keypoints are visible', () => {
    const result = checkPresence(BARELY_VISIBLE_POSE)
    expect(result.present).toBe(false)
    expect(result.visibleCount).toBeLessThan(6)
  })

  it('returns present at the minimum threshold (6 of 8 core keypoints)', () => {
    const result = checkPresence(MINIMAL_PRESENCE_POSE)
    expect(result.present).toBe(true)
    expect(result.visibleCount).toBeGreaterThanOrEqual(6)
  })

  it('handles low-confidence pose (core keypoints below 0.5 threshold)', () => {
    // LOW_CONFIDENCE_POSE has wrists and ankles at low confidence
    // but shoulders, elbows, hips, knees at 0.9 — all 8 core keypoints pass
    const result = checkPresence(LOW_CONFIDENCE_POSE)
    expect(result.present).toBe(true)
    expect(result.visibleCount).toBe(8)
  })
})

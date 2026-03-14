import { describe, it, expect } from 'vitest'
import { calculateAngle, extractJointAngles } from '../../../src/scoring/angles'
import { STANDING_POSE, T_POSE, LOW_CONFIDENCE_POSE, EMPTY_POSE } from './fixtures'

describe('calculateAngle', () => {
  it('returns 0 for zero-length vectors', () => {
    const point = { x: 1, y: 1 }
    expect(calculateAngle(point, point, { x: 2, y: 2 })).toBe(0)
  })

  it('returns PI for a straight line (180 degrees)', () => {
    const angle = calculateAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })
    expect(angle).toBeCloseTo(Math.PI, 5)
  })

  it('returns PI/2 for a right angle (90 degrees)', () => {
    const angle = calculateAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })
    expect(angle).toBeCloseTo(Math.PI / 2, 5)
  })

  it('returns 0 for overlapping vectors', () => {
    const angle = calculateAngle({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 })
    expect(angle).toBeCloseTo(0, 5)
  })

  it('is symmetric (order of pointA and pointB does not matter)', () => {
    const a = { x: 1, y: 0 }
    const v = { x: 0, y: 0 }
    const b = { x: 0, y: 1 }
    expect(calculateAngle(a, v, b)).toBeCloseTo(calculateAngle(b, v, a), 5)
  })
})

describe('extractJointAngles', () => {
  it('extracts 8 joint angles from a full-confidence standing pose', () => {
    const angles = extractJointAngles(STANDING_POSE)
    expect(angles.length).toBe(8)
    const names = angles.map((a) => a.name)
    expect(names).toContain('left_elbow')
    expect(names).toContain('right_elbow')
    expect(names).toContain('left_shoulder')
    expect(names).toContain('right_shoulder')
    expect(names).toContain('left_hip')
    expect(names).toContain('right_hip')
    expect(names).toContain('left_knee')
    expect(names).toContain('right_knee')
  })

  it('extracts angles from T-pose with different arm positions', () => {
    const angles = extractJointAngles(T_POSE)
    const leftElbow = angles.find((a) => a.name === 'left_elbow')
    // T-pose: arms straight out, elbow angle should be close to PI (straight)
    expect(leftElbow).toBeDefined()
    expect(leftElbow!.angle).toBeCloseTo(Math.PI, 0)
  })

  it('skips joints with low-confidence keypoints', () => {
    const angles = extractJointAngles(LOW_CONFIDENCE_POSE)
    // Wrists have low confidence, so elbow angles (which need wrists) should be excluded
    const names = angles.map((a) => a.name)
    expect(names).not.toContain('left_elbow')
    expect(names).not.toContain('right_elbow')
    // Ankles have low confidence, so knee angles should be excluded
    expect(names).not.toContain('left_knee')
    expect(names).not.toContain('right_knee')
    // Shoulders and hips should still be present
    expect(names).toContain('left_shoulder')
    expect(names).toContain('right_shoulder')
    expect(names).toContain('left_hip')
    expect(names).toContain('right_hip')
  })

  it('returns empty array for empty pose', () => {
    const angles = extractJointAngles(EMPTY_POSE)
    expect(angles).toEqual([])
  })

  it('all angles are between 0 and PI', () => {
    const angles = extractJointAngles(STANDING_POSE)
    for (const a of angles) {
      expect(a.angle).toBeGreaterThanOrEqual(0)
      expect(a.angle).toBeLessThanOrEqual(Math.PI)
    }
  })

  it('confidence reflects the minimum keypoint score', () => {
    const angles = extractJointAngles(STANDING_POSE)
    for (const a of angles) {
      expect(a.confidence).toBe(0.9)
    }
  })
})

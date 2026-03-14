import { describe, it, expect } from 'vitest'
import {
  computeDTW,
  computeAlignmentScore,
  computeSectionScores,
  computeBodyPartScores,
  computeRank,
  computePostDanceScore,
} from '../../../src/scoring/dtw'
import type { TimestampedPose } from '../../../src/scoring/dtw'
import { STANDING_POSE, T_POSE, ARMS_UP_SQUAT } from './fixtures'

function makeSequence(poses: { pose: typeof STANDING_POSE; frames: number }[], fps = 30): TimestampedPose[] {
  const result: TimestampedPose[] = []
  let frameIdx = 0
  for (const { pose, frames } of poses) {
    for (let i = 0; i < frames; i++) {
      result.push({ time: frameIdx / fps, pose })
      frameIdx++
    }
  }
  return result
}

describe('computeDTW', () => {
  it('returns empty alignment for empty sequences', () => {
    const result = computeDTW([], [])
    expect(result.alignment).toEqual([])
    expect(result.cost).toBe(0)
  })

  it('aligns identical sequences with low cost', () => {
    const seq = makeSequence([{ pose: STANDING_POSE, frames: 5 }])
    const result = computeDTW(seq, seq)
    expect(result.cost).toBeCloseTo(0, 1)
    expect(result.alignment.length).toBe(5)
  })

  it('aligns different sequences with higher cost', () => {
    const ref = makeSequence([{ pose: STANDING_POSE, frames: 5 }])
    const user = makeSequence([{ pose: ARMS_UP_SQUAT, frames: 5 }])
    const result = computeDTW(ref, user)
    expect(result.cost).toBeGreaterThan(0)
  })

  it('handles sequences of different lengths', () => {
    const ref = makeSequence([{ pose: STANDING_POSE, frames: 10 }])
    const user = makeSequence([{ pose: STANDING_POSE, frames: 5 }])
    const result = computeDTW(ref, user)
    // Should still produce alignment
    expect(result.alignment.length).toBeGreaterThan(0)
  })

  it('alignment indices are valid', () => {
    const ref = makeSequence([
      { pose: STANDING_POSE, frames: 5 },
      { pose: T_POSE, frames: 5 },
    ])
    const user = makeSequence([
      { pose: STANDING_POSE, frames: 3 },
      { pose: T_POSE, frames: 7 },
    ])
    const result = computeDTW(ref, user)

    for (const [refIdx, userIdx] of result.alignment) {
      expect(refIdx).toBeGreaterThanOrEqual(0)
      expect(refIdx).toBeLessThan(ref.length)
      expect(userIdx).toBeGreaterThanOrEqual(0)
      expect(userIdx).toBeLessThan(user.length)
    }
  })
})

describe('computeAlignmentScore', () => {
  it('returns 0 for empty alignment', () => {
    const score = computeAlignmentScore([], [], [])
    expect(score).toBe(0)
  })

  it('returns high score for identical poses', () => {
    const seq = makeSequence([{ pose: STANDING_POSE, frames: 5 }])
    const { alignment } = computeDTW(seq, seq)
    const score = computeAlignmentScore(seq, seq, alignment)
    expect(score).toBeGreaterThan(0.9)
  })

  it('returns lower score for different poses', () => {
    const ref = makeSequence([{ pose: STANDING_POSE, frames: 5 }])
    const user = makeSequence([{ pose: ARMS_UP_SQUAT, frames: 5 }])
    const { alignment } = computeDTW(ref, user)
    const score = computeAlignmentScore(ref, user, alignment)
    expect(score).toBeLessThan(0.9)
    expect(score).toBeGreaterThan(0) // not completely dissimilar
  })
})

describe('computeSectionScores', () => {
  it('returns empty for empty alignment', () => {
    expect(computeSectionScores([], [], [])).toEqual([])
  })

  it('creates sections of specified duration', () => {
    const ref = makeSequence([{ pose: STANDING_POSE, frames: 300 }]) // 10s at 30fps
    const user = makeSequence([{ pose: STANDING_POSE, frames: 300 }])
    const { alignment } = computeDTW(ref, user)
    const sections = computeSectionScores(ref, user, alignment, 5) // 5s sections

    expect(sections.length).toBe(2) // 10s / 5s = 2 sections
    expect(sections[0].startTime).toBe(0)
    expect(sections[0].endTime).toBe(5)
    expect(sections[1].startTime).toBe(5)
  })

  it('section scores are between 0 and 1', () => {
    const ref = makeSequence([
      { pose: STANDING_POSE, frames: 150 },
      { pose: T_POSE, frames: 150 },
    ])
    const user = makeSequence([
      { pose: STANDING_POSE, frames: 150 },
      { pose: ARMS_UP_SQUAT, frames: 150 },
    ])
    const { alignment } = computeDTW(ref, user)
    const sections = computeSectionScores(ref, user, alignment, 5)

    for (const section of sections) {
      expect(section.score).toBeGreaterThanOrEqual(0)
      expect(section.score).toBeLessThanOrEqual(1)
    }
  })
})

describe('computeBodyPartScores', () => {
  it('returns empty for empty alignment', () => {
    expect(computeBodyPartScores([], [], [])).toEqual([])
  })

  it('returns scores for Arms and Legs', () => {
    const seq = makeSequence([{ pose: STANDING_POSE, frames: 5 }])
    const { alignment } = computeDTW(seq, seq)
    const parts = computeBodyPartScores(seq, seq, alignment)

    const partNames = parts.map((p) => p.name)
    expect(partNames).toContain('Arms')
    expect(partNames).toContain('Legs')
  })

  it('body part scores are between 0 and 1', () => {
    const ref = makeSequence([{ pose: STANDING_POSE, frames: 5 }])
    const user = makeSequence([{ pose: T_POSE, frames: 5 }])
    const { alignment } = computeDTW(ref, user)
    const parts = computeBodyPartScores(ref, user, alignment)

    for (const part of parts) {
      expect(part.score).toBeGreaterThanOrEqual(0)
      expect(part.score).toBeLessThanOrEqual(1)
    }
  })
})

describe('computeRank', () => {
  it('S rank for 80%+', () => {
    expect(computeRank(0.80)).toBe('S')
    expect(computeRank(0.95)).toBe('S')
    expect(computeRank(1.0)).toBe('S')
  })

  it('A rank for 60-79%', () => {
    expect(computeRank(0.60)).toBe('A')
    expect(computeRank(0.79)).toBe('A')
  })

  it('B rank for 40-59%', () => {
    expect(computeRank(0.40)).toBe('B')
    expect(computeRank(0.59)).toBe('B')
  })

  it('C rank for below 40%', () => {
    expect(computeRank(0.39)).toBe('C')
    expect(computeRank(0.0)).toBe('C')
  })
})

describe('computePostDanceScore', () => {
  it('returns complete result for identical sequences', () => {
    const seq = makeSequence([{ pose: STANDING_POSE, frames: 30 }])
    const result = computePostDanceScore(seq, seq)

    expect(result.overallScore).toBeGreaterThan(0.9)
    expect(result.rank).toBe('S')
    expect(result.sectionScores.length).toBeGreaterThan(0)
    expect(result.bodyPartScores.length).toBeGreaterThan(0)
    expect(result.alignment.length).toBeGreaterThan(0)
  })

  it('returns lower score for different sequences', () => {
    const ref = makeSequence([{ pose: STANDING_POSE, frames: 30 }])
    const user = makeSequence([{ pose: ARMS_UP_SQUAT, frames: 30 }])
    const result = computePostDanceScore(ref, user)

    expect(result.overallScore).toBeLessThan(0.9)
  })

  it('overall score is between 0 and 1', () => {
    const ref = makeSequence([
      { pose: STANDING_POSE, frames: 15 },
      { pose: T_POSE, frames: 15 },
    ])
    const user = makeSequence([
      { pose: T_POSE, frames: 15 },
      { pose: STANDING_POSE, frames: 15 },
    ])
    const result = computePostDanceScore(ref, user)

    expect(result.overallScore).toBeGreaterThanOrEqual(0)
    expect(result.overallScore).toBeLessThanOrEqual(1)
  })
})

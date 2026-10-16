import { describe, it, expect } from 'vitest'
import {
  MAX_EVIDENCE_NOTES,
  MAX_EVIDENCE_NOTE_CHARS,
  describeEvidence,
  extractEvidence,
  isOutOfFrame,
  toCoachAttempt,
} from '../../../src/components/scoreEvidence'
import type { ScoredResult } from '../../../src/components/scoreEvidence'
import type { AttemptSummary } from '../../../src/coach/types'
import { parseCoachRequest } from '../../../server/coach/schemas'

function honestLike(overrides: Partial<ScoredResult> = {}): ScoredResult {
  return {
    overallScore: 0.31,
    rank: 'C',
    sectionScores: [{ startTime: 0, endTime: 10, score: 0.31 }],
    bodyPartScores: [
      { name: 'Arms', score: 0.42, tracked: true },
      { name: 'Legs', score: 0, tracked: false },
    ],
    alignment: [[0, 0], [1, 1]],
    coverage: 0.37,
    motionMatch: 0.1,
    latencyMs: 200,
    mirrored: true,
    notes: ['We could only track you for 37% of the dance — stay in frame from start to finish.'],
    ...overrides,
  }
}

describe('extractEvidence', () => {
  it('returns nothing for a legacy result without evidence', () => {
    expect(extractEvidence({
      overallScore: 0.6,
      rank: 'B',
      sectionScores: [],
      bodyPartScores: [{ name: 'Arms', score: 0.6 }],
    })).toEqual({})
  })

  it('keeps every honest-scoring field and derives untracked parts from tracked === false', () => {
    expect(extractEvidence(honestLike())).toEqual({
      coverage: 0.37,
      motionMatch: 0.1,
      latencyMs: 200,
      mirrored: true,
      untrackedBodyParts: ['Legs'],
      notes: ['We could only track you for 37% of the dance — stay in frame from start to finish.'],
    })
  })

  it('merges an explicit untrackedBodyParts list without duplicates', () => {
    const e = extractEvidence(honestLike({ untrackedBodyParts: ['legs', 'Arms', 42 as unknown as string] }))
    expect(e.untrackedBodyParts).toEqual(['Legs', 'Arms'])
  })

  it('clamps and drops invalid values', () => {
    const e = extractEvidence(honestLike({
      coverage: 1.7,
      motionMatch: -0.2,
      latencyMs: Number.NaN,
      mirrored: 'yes' as unknown as boolean,
      notes: ['  ', 7 as unknown as string],
    }))
    expect(e.coverage).toBe(1)
    expect(e.motionMatch).toBe(0)
    expect(e).not.toHaveProperty('latencyMs')
    expect(e).not.toHaveProperty('mirrored')
    expect(e).not.toHaveProperty('notes')
  })

  it(`caps notes at ${MAX_EVIDENCE_NOTES} x ${MAX_EVIDENCE_NOTE_CHARS} chars`, () => {
    const notes = Array.from({ length: 9 }, (_, i) => `${i} ${'x'.repeat(400)}`)
    const e = extractEvidence(honestLike({ notes }))
    expect(e.notes).toHaveLength(MAX_EVIDENCE_NOTES)
    for (const note of e.notes ?? []) expect(note.length).toBeLessThanOrEqual(MAX_EVIDENCE_NOTE_CHARS)
    expect(e.notes?.[0].startsWith('0 ')).toBe(true)
    expect(e.notes?.[0].endsWith('…')).toBe(true)
  })
})

describe('toCoachAttempt', () => {
  it('strips alignment and per-part tracked flags but keeps evidence', () => {
    const attempt = toCoachAttempt(honestLike())
    expect(attempt).not.toHaveProperty('alignment')
    expect(attempt.bodyPartScores).toEqual([{ name: 'Arms', score: 0.42 }, { name: 'Legs', score: 0 }])
    expect(attempt).toMatchObject({
      overallScore: 0.31,
      rank: 'C',
      coverage: 0.37,
      motionMatch: 0.1,
      latencyMs: 200,
      mirrored: true,
      untrackedBodyParts: ['Legs'],
    })
    expect(JSON.parse(JSON.stringify(attempt))).toEqual(attempt)
  })

  it('passes a stored previous attempt (AttemptSummary) through with its evidence', () => {
    const previous: AttemptSummary = {
      overallScore: 0.51,
      rank: 'B',
      sectionScores: [{ startTime: 0, endTime: 10, score: 0.5 }],
      bodyPartScores: [{ name: 'Legs', score: 0.1 }],
      coverage: 0.61,
      untrackedBodyParts: ['Legs'],
      notes: ['Step back.'],
    }
    expect(toCoachAttempt(previous)).toEqual(previous)
  })

  it('keeps legacy attempts free of evidence keys', () => {
    expect(Object.keys(toCoachAttempt({
      overallScore: 0.5,
      rank: 'B',
      sectionScores: [],
      bodyPartScores: [],
    })).sort()).toEqual(['bodyPartScores', 'overallScore', 'rank', 'sectionScores'])
  })

  it('never produces evidence the server would reject with a 400', () => {
    const attempt = toCoachAttempt(honestLike({
      coverage: 3,
      motionMatch: -1,
      latencyMs: 99_999,
      bodyPartScores: Array.from({ length: 8 }, (_, i) => ({
        name: `Very long body part name ${i}`,
        score: 0,
        tracked: false,
      })),
      notes: Array.from({ length: 12 }, () => 'n'.repeat(500)),
    }))
    const parsed = parseCoachRequest({
      danceTitle: 'Test',
      durationSeconds: 30,
      attempt,
      previousAttempt: attempt,
    })
    expect(parsed).toMatchObject({ ok: true })
  })
})

describe('describeEvidence', () => {
  it('builds the "Why this score?" lines', () => {
    const view = describeEvidence(extractEvidence(honestLike()))
    expect(view.meters.map((m) => m.label)).toEqual([
      'Tracked 37% of the song',
      'Moving with the dance: 10%',
    ])
    expect(view.meters.map((m) => m.tone)).toEqual(['bad', 'bad'])
    expect(view.chips.map((c) => c.label)).toEqual([
      'Latency compensated: 200 ms',
      'Mirror-style detected',
    ])
    expect(view.tips).toHaveLength(1)
  })

  it('says so when no latency compensation was needed and hides mirror when not mirrored', () => {
    const view = describeEvidence({ latencyMs: 0, mirrored: false, coverage: 0.95, motionMatch: 0.7 })
    expect(view.chips.map((c) => c.label)).toEqual(['No latency compensation needed'])
    expect(view.meters.map((m) => m.tone)).toEqual(['good', 'good'])
  })

  it('is empty without evidence', () => {
    expect(describeEvidence({})).toEqual({ meters: [], chips: [], tips: [] })
  })
})

describe('isOutOfFrame', () => {
  it('uses the per-part flag or the untracked list (case-insensitive)', () => {
    expect(isOutOfFrame({ name: 'Legs', score: 0, tracked: false }, {})).toBe(true)
    expect(isOutOfFrame({ name: 'Legs', score: 0 }, { untrackedBodyParts: ['legs'] })).toBe(true)
    expect(isOutOfFrame({ name: 'Arms', score: 0 }, { untrackedBodyParts: ['Legs'] })).toBe(false)
    expect(isOutOfFrame({ name: 'Arms', score: 0, tracked: true }, {})).toBe(false)
  })
})

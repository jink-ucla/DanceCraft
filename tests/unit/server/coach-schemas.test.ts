import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MAX_LATENCY_MS,
  MAX_NOTE,
  MAX_NOTES,
  MAX_PART_NAME,
  MAX_UNTRACKED_PARTS,
  parseBattleRequest,
  parseCoachRequest,
} from '../../../server/coach/schemas.ts'
import type { AttemptSummary, BattleRequest, CoachRequest } from '../../../src/coach/types.ts'

const attempt: AttemptSummary = {
  overallScore: 0.21,
  rank: 'C',
  sectionScores: [
    { startTime: 0, endTime: 10, score: 0.28 },
    { startTime: 10, endTime: 20, score: 0.16 },
  ],
  bodyPartScores: [{ name: 'Arms', score: 0.31 }, { name: 'Legs', score: 0.08 }],
}

const evidence = {
  coverage: 0.3,
  motionMatch: 0.05,
  latencyMs: 300,
  mirrored: true,
  untrackedBodyParts: ['Legs'],
  notes: ['Your legs were out of frame — step back so your full body is visible.'],
}

const base: CoachRequest = { danceTitle: 'I NEED U', durationSeconds: 20, attempt }

function withAttempt(extra: Record<string, unknown>) {
  return { ...base, attempt: { ...attempt, ...extra } }
}

describe('coach request schema — honest-scoring evidence', () => {
  beforeEach(() => {
    // Nothing here calls Claude, but never let a real key from .env leak into tests.
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts evidence on attempt and previousAttempt and keeps every field', () => {
    const result = parseCoachRequest({ ...withAttempt(evidence), previousAttempt: { ...attempt, coverage: 0.9, motionMatch: 0.6 } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.attempt).toEqual({ ...attempt, ...evidence })
    expect(result.value.previousAttempt).toEqual({ ...attempt, coverage: 0.9, motionMatch: 0.6 })
  })

  it('accepts the exact bounds', () => {
    const result = parseCoachRequest(withAttempt({
      coverage: 0,
      motionMatch: 1,
      latencyMs: MAX_LATENCY_MS,
      mirrored: false,
      untrackedBodyParts: Array.from({ length: MAX_UNTRACKED_PARTS }, () => 'p'.repeat(MAX_PART_NAME)),
      notes: Array.from({ length: MAX_NOTES }, () => 'n'.repeat(MAX_NOTE)),
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.attempt.latencyMs).toBe(2000)
    expect(result.value.attempt.mirrored).toBe(false)
    expect(result.value.attempt.untrackedBodyParts).toHaveLength(4)
    expect(result.value.attempt.notes).toHaveLength(8)
  })

  it('trims strings and drops empty ones', () => {
    const result = parseCoachRequest(withAttempt({ untrackedBodyParts: ['  Legs  ', '   '], notes: ['', ' Stay in frame. '] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.attempt.untrackedBodyParts).toEqual(['Legs'])
    expect(result.value.attempt.notes).toEqual(['Stay in frame.'])
  })

  it('treats null evidence as absent and still accepts attempts without evidence', () => {
    const nulls = parseCoachRequest(withAttempt({
      coverage: null, motionMatch: null, latencyMs: null, mirrored: null, untrackedBodyParts: null, notes: null,
    }))
    expect(nulls.ok).toBe(true)
    if (nulls.ok) expect(nulls.value.attempt).toEqual(attempt)

    const legacy = parseCoachRequest(base)
    expect(legacy.ok).toBe(true)
    if (legacy.ok) expect(Object.keys(legacy.value.attempt).sort()).toEqual(['bodyPartScores', 'overallScore', 'rank', 'sectionScores'])
  })

  it.each([
    ['coverage above 1', { coverage: 1.2 }, 'attempt.coverage'],
    ['negative coverage', { coverage: -0.1 }, 'attempt.coverage'],
    ['coverage as a percentage', { coverage: 30 }, 'attempt.coverage'],
    ['motionMatch above 1', { motionMatch: 1.01 }, 'attempt.motionMatch'],
    ['negative motionMatch', { motionMatch: -0.5 }, 'attempt.motionMatch'],
    ['latency over 2000 ms', { latencyMs: 2001 }, 'attempt.latencyMs'],
    ['negative latency', { latencyMs: -1 }, 'attempt.latencyMs'],
    ['string latency', { latencyMs: '300' }, 'attempt.latencyMs'],
    ['non-boolean mirrored', { mirrored: 'yes' }, 'attempt.mirrored'],
    ['too many untracked parts', { untrackedBodyParts: ['a', 'b', 'c', 'd', 'e'] }, 'attempt.untrackedBodyParts'],
    ['untracked part over 20 chars', { untrackedBodyParts: ['x'.repeat(21)] }, 'attempt.untrackedBodyParts.0'],
    ['untracked parts not an array', { untrackedBodyParts: 'Legs' }, 'attempt.untrackedBodyParts'],
    ['non-string untracked part', { untrackedBodyParts: [3] }, 'attempt.untrackedBodyParts.0'],
    ['too many notes', { notes: Array.from({ length: 9 }, () => 'note') }, 'attempt.notes'],
    ['note over 240 chars', { notes: ['x'.repeat(241)] }, 'attempt.notes.0'],
  ])('rejects %s', (_name, extra, path) => {
    const result = parseCoachRequest(withAttempt(extra))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(path)
  })

  it('validates previousAttempt evidence too', () => {
    const result = parseCoachRequest({ ...base, previousAttempt: { ...attempt, coverage: 2 } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('previousAttempt.coverage')
  })
})

describe('battle request schema — contender evidence', () => {
  const battle: BattleRequest = {
    danceTitle: 'I NEED U',
    host: { name: 'Wasil', score: 0.78 },
    challenger: { name: 'Jin', score: 0.21 },
  }

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps coverage, motionMatch and untrackedBodyParts on contenders', () => {
    const result = parseBattleRequest({
      ...battle,
      challenger: { ...battle.challenger, coverage: 0.3, motionMatch: 0.05, untrackedBodyParts: ['Legs'] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.challenger).toEqual({ name: 'Jin', score: 0.21, coverage: 0.3, motionMatch: 0.05, untrackedBodyParts: ['Legs'] })
    expect(result.value.host).toEqual({ name: 'Wasil', score: 0.78 })
  })

  it('rejects out-of-range contender evidence', () => {
    expect(parseBattleRequest({ ...battle, challenger: { ...battle.challenger, coverage: 1.5 } }).ok).toBe(false)
    expect(parseBattleRequest({ ...battle, host: { ...battle.host, motionMatch: -1 } }).ok).toBe(false)
    expect(parseBattleRequest({ ...battle, challenger: { ...battle.challenger, untrackedBodyParts: ['a', 'b', 'c', 'd', 'e'] } }).ok).toBe(false)
  })
})

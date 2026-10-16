import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BATTLE_SYSTEM_PROMPT,
  COACH_SYSTEM_PROMPT,
  buildBattleUserContent,
  buildCoachUserContent,
} from '../../../server/coach/prompts.ts'
import { decideBattle } from '../../../src/coach/plan.ts'
import type { BattleRequest, CoachRequest } from '../../../src/coach/types.ts'

const req: CoachRequest = {
  danceTitle: 'Wasil Shuffle',
  durationSeconds: 29.97,
  playerName: 'Jin',
  attempt: {
    overallScore: 0.6251,
    rank: 'B',
    sectionScores: [
      { startTime: 0, endTime: 10, score: 0.5 },
      { startTime: 10, endTime: 20, score: 0.333 },
      { startTime: 20, endTime: 29.97, score: 0.333 },
    ],
    bodyPartScores: [{ name: 'Arms', score: 0.71 }, { name: 'Legs', score: 0.44 }],
  },
}

function payloadOf(content: string): Record<string, unknown> {
  const line = content.split('\n').find((l) => l.startsWith('{'))
  return JSON.parse(line ?? '{}')
}

describe('coach prompts', () => {
  beforeEach(() => {
    // Pure string builders, but never let a real key from .env leak into tests.
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends compact JSON with whole percentages and the precomputed weakest spots', () => {
    const payload = payloadOf(buildCoachUserContent(req))
    expect(payload.durationSeconds).toBe(30)
    expect(payload.player).toBe('Jin')
    expect(payload.attempt).toEqual({
      overallPct: 63,
      rank: 'B',
      sections: [
        { start: 0, end: 10, pct: 50 },
        { start: 10, end: 20, pct: 33 },
        { start: 20, end: 30, pct: 33 },
      ],
      bodyParts: [{ name: 'Arms', pct: 71 }, { name: 'Legs', pct: 44 }],
    })
    // ties -> earliest section
    expect(payload.weakest).toEqual({ section: { start: 10, end: 20, pct: 33 }, bodyPart: 'Legs' })
    expect(payload).not.toHaveProperty('previousAttempt')
    expect(payload).not.toHaveProperty('host')
  })

  it('includes the previous attempt and the host only when given', () => {
    const payload = payloadOf(buildCoachUserContent({
      ...req,
      previousAttempt: { ...req.attempt, overallScore: 0.5 },
      hostName: 'Wasil',
      hostScore: 0.884,
    }))
    expect((payload.previousAttempt as { overallPct: number }).overallPct).toBe(50)
    expect(payload.host).toEqual({ name: 'Wasil', overallPct: 88 })
  })

  it('states the server-decided winner and margin as facts in the battle prompt', () => {
    const battle: BattleRequest = {
      danceTitle: 'Wasil Shuffle',
      host: { name: 'Wasil', score: 0.81 },
      challenger: { name: 'Jin', score: 0.79, bodyPartScores: [{ name: 'Arms', score: 0.9 }] },
      leaderboard: Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, score: 0.9 - i / 100 })),
    }
    const payload = payloadOf(buildBattleUserContent(battle, decideBattle(battle.host, battle.challenger)))
    expect(payload.winner).toBe('host')
    expect(payload.marginPoints).toBe(-2)
    expect(payload.challenger).toEqual({ name: 'Jin', pct: 79, bodyParts: [{ name: 'Arms', pct: 90 }] })
    expect((payload.leaderboard as unknown[]).length).toBe(5)
  })

  it('system prompts carry the key grounding rules', () => {
    expect(COACH_SYSTEM_PROMPT).toMatch(/whole percentage/i)
    expect(COACH_SYSTEM_PROMPT).toMatch(/Never mention other joints/i)
    expect(COACH_SYSTEM_PROMPT).toMatch(/0\.5 if that section is below 50%/)
    expect(COACH_SYSTEM_PROMPT).toMatch(/2 to 5/)
    expect(BATTLE_SYSTEM_PROMPT).toMatch(/Never contradict them/)
    expect(BATTLE_SYSTEM_PROMPT).toMatch(/80 characters/)
    expect(BATTLE_SYSTEM_PROMPT).toMatch(/300 characters/)
  })
  it('sends the honest-scoring evidence as rounded whole numbers', () => {
    const payload = payloadOf(buildCoachUserContent({
      ...req,
      attempt: {
        ...req.attempt,
        coverage: 0.304,
        motionMatch: 0.051,
        latencyMs: 123.4,
        mirrored: true,
        untrackedBodyParts: ['Legs'],
        notes: ['Your legs were out of frame — step back so your full body is visible.'],
      },
    }))
    const attempt = payload.attempt as Record<string, unknown>
    expect(attempt.coveragePct).toBe(30)
    expect(attempt.motionMatchPct).toBe(5)
    expect(attempt.latencyMs).toBe(123)
    expect(attempt.mirrored).toBe(true)
    expect(attempt.untrackedBodyParts).toEqual(['Legs'])
    expect(attempt.notes).toEqual(['Your legs were out of frame — step back so your full body is visible.'])
    expect(attempt.bodyParts).toEqual([{ name: 'Arms', pct: 71 }, { name: 'Legs', pct: 44, tracked: false }])
    expect(attempt).not.toHaveProperty('coverage')
    expect(attempt).not.toHaveProperty('motionMatch')
    // Legs score lower but were out of frame: the hint points at the weakest TRACKED part.
    expect(payload.weakest).toEqual({ section: { start: 10, end: 20, pct: 33 }, bodyPart: 'Arms' })
    expect(payload.primaryProblem).toBe('coverage+motion')
  })

  it('omits uninformative evidence and the diagnosis when no evidence was sent', () => {
    const quiet = payloadOf(buildCoachUserContent({ ...req, attempt: { ...req.attempt, mirrored: false, latencyMs: 0, notes: [], untrackedBodyParts: [] } }))
    const attempt = quiet.attempt as Record<string, unknown>
    for (const key of ['mirrored', 'latencyMs', 'notes', 'untrackedBodyParts', 'coveragePct', 'motionMatchPct']) {
      expect(attempt).not.toHaveProperty(key)
    }
    expect(quiet).not.toHaveProperty('primaryProblem')
  })

  it.each([
    [{ coverage: 0.59, motionMatch: 0.9 }, 'coverage'],
    [{ coverage: 0.95, motionMatch: 0.34 }, 'motion'],
    [{ coverage: 0.2, motionMatch: 0.1 }, 'coverage+motion'],
    [{ coverage: 0.6, motionMatch: 0.35 }, 'technique'],
    [{ motionMatch: 0.2 }, 'motion'],
  ])('diagnoses %o as %s', (evidence, problem) => {
    const payload = payloadOf(buildCoachUserContent({ ...req, attempt: { ...req.attempt, ...evidence } }))
    expect(payload.primaryProblem).toBe(problem)
  })

  it('includes the evidence of the previous attempt for the improvement line', () => {
    const payload = payloadOf(buildCoachUserContent({
      ...req,
      previousAttempt: { ...req.attempt, overallScore: 0.2, coverage: 0.4, motionMatch: 0.08 },
    }))
    expect(payload.previousAttempt).toMatchObject({ overallPct: 20, coveragePct: 40, motionMatchPct: 8 })
  })

  it('coach system prompt puts movement and framing before technique', () => {
    expect(COACH_SYSTEM_PROMPT).toMatch(/coveragePct is below 60%/)
    expect(COACH_SYSTEM_PROMPT).toMatch(/motionMatchPct is below 35%/)
    expect(COACH_SYSTEM_PROMPT).toMatch(/stay in frame for the whole song/)
    expect(COACH_SYSTEM_PROMPT).toMatch(/barely moving/)
    expect(COACH_SYSTEM_PROMPT).toMatch(/busiest stretch\) at playbackSpeed 0\.5/)
    expect(COACH_SYSTEM_PROMPT).toMatch(/Never blame an untracked body part/)
    expect(COACH_SYSTEM_PROMPT).toMatch(/The summary must tell them to step back/)
    expect(COACH_SYSTEM_PROMPT).toMatch(/weakest tracked body part/)
    expect(COACH_SYSTEM_PROMPT).toMatch(/Mention mirror-style only if it is relevant/)
    expect(COACH_SYSTEM_PROMPT.indexOf('Movement first')).toBeLessThan(COACH_SYSTEM_PROMPT.indexOf('Technique.'))
  })

  it('battle prompt and payload carry contender evidence', () => {
    expect(BATTLE_SYSTEM_PROMPT).toMatch(/kindly/)
    expect(BATTLE_SYSTEM_PROMPT).toMatch(/Never judge an untracked body part/)
    const battle = {
      danceTitle: 'Wasil Shuffle',
      host: { name: 'Wasil', score: 0.81 },
      challenger: {
        name: 'Jin',
        score: 0.21,
        bodyPartScores: [{ name: 'Arms', score: 0.31 }, { name: 'Legs', score: 0.08 }],
        coverage: 0.304,
        motionMatch: 0.05,
        untrackedBodyParts: ['Legs'],
      },
    }
    const payload = payloadOf(buildBattleUserContent(battle, decideBattle(battle.host, battle.challenger)))
    expect(payload.challenger).toEqual({
      name: 'Jin',
      pct: 21,
      bodyParts: [{ name: 'Arms', pct: 31 }, { name: 'Legs', pct: 8, tracked: false }],
      coveragePct: 30,
      motionMatchPct: 5,
      untrackedBodyParts: ['Legs'],
    })
    expect(payload.host).toEqual({ name: 'Wasil', pct: 81 })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

// The Anthropic SDK is fully mocked: these tests must NEVER reach the real API,
// even when a developer has a real key in .env. The real error classes are
// kept so the route's instanceof checks behave exactly as in production.
const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  ctor: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>()
  const Real = actual.default
  class MockAnthropic {
    static AnthropicError = Real.AnthropicError
    static APIError = Real.APIError
    static APIConnectionError = Real.APIConnectionError
    static APIConnectionTimeoutError = Real.APIConnectionTimeoutError
    static APIUserAbortError = Real.APIUserAbortError
    static AuthenticationError = Real.AuthenticationError
    static BadRequestError = Real.BadRequestError
    static InternalServerError = Real.InternalServerError
    static RateLimitError = Real.RateLimitError
    beta = { messages: { parse: mocks.parse } }
    constructor(options: unknown) {
      mocks.ctor(options)
    }
  }
  return { ...actual, default: MockAnthropic }
})

import Anthropic from '@anthropic-ai/sdk'
import app from '../../../server/app.ts'
import { resetCoachClient } from '../../../server/coach/claude.ts'
import { buildFallbackPlan, buildFallbackVerdict } from '../../../src/coach/plan.ts'
import type { BattleRequest, CoachRequest } from '../../../src/coach/types.ts'

const FAKE_KEY = 'sk-ant-test-not-a-real-key'

const coachReq: CoachRequest = {
  danceTitle: 'Wasil Shuffle',
  durationSeconds: 30,
  playerName: 'Jin',
  attempt: {
    overallScore: 0.6234,
    rank: 'B',
    sectionScores: [
      { startTime: 0, endTime: 10, score: 0.82 },
      { startTime: 10, endTime: 20, score: 0.4137 },
      { startTime: 20, endTime: 30, score: 0.66 },
    ],
    bodyPartScores: [
      { name: 'Arms', score: 0.55 },
      { name: 'Legs', score: 0.71 },
    ],
  },
  hostName: 'Wasil',
  hostScore: 0.81,
}

/** Honest scorer output for someone who stood still, half out of frame, legs hidden. */
const stillReq: CoachRequest = {
  danceTitle: 'BTS Jung Kook - I NEED U (fancam) (0:50–1:25)',
  durationSeconds: 35,
  playerName: 'Jin',
  attempt: {
    overallScore: 0.21,
    rank: 'C',
    sectionScores: [
      { startTime: 0, endTime: 10, score: 0.28 },
      { startTime: 10, endTime: 20, score: 0.16 },
      { startTime: 20, endTime: 30, score: 0.22 },
      { startTime: 30, endTime: 35, score: 0.19 },
    ],
    bodyPartScores: [{ name: 'Arms', score: 0.31 }, { name: 'Legs', score: 0.08 }],
    coverage: 0.3,
    motionMatch: 0.05,
    latencyMs: 100,
    mirrored: false,
    untrackedBodyParts: ['Legs'],
    notes: [
      'We could only track you for 30% of the dance — stay in frame from start to finish.',
      'Your legs were out of frame — step back so your full body is visible.',
    ],
  },
  hostName: 'Wasil',
  hostScore: 0.78,
}

const battleReq: BattleRequest = {
  danceTitle: 'Wasil Shuffle',
  host: { name: 'Wasil', score: 0.78, rank: 'A' },
  challenger: {
    name: 'Jin',
    score: 0.82,
    rank: 'A',
    bodyPartScores: [{ name: 'Arms', score: 0.9 }, { name: 'Legs', score: 0.6 }],
  },
  leaderboard: [{ name: 'Jin', score: 0.82 }, { name: 'Wasil', score: 0.78 }],
}

function claudeReply(parsed: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text: JSON.stringify(parsed) }],
    stop_reason: 'end_turn',
    stop_details: null,
    parsed_output: parsed,
    ...extra,
  }
}

function headers() {
  return new Headers({ 'content-type': 'application/json' })
}

describe('Coach API', () => {
  beforeEach(() => {
    mocks.parse.mockReset()
    mocks.ctor.mockReset()
    resetCoachClient()
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '')
    vi.stubEnv('COACH_OFFLINE', '')
    vi.stubEnv('COACH_MODEL', '')
    vi.stubEnv('CLAUDE_MODEL', '')
    vi.stubEnv('COACH_EFFORT', '')
    // Claude Code exports CLAUDE_EFFORT to child processes; it must be ignored.
    vi.stubEnv('CLAUDE_EFFORT', 'xhigh')
    // Belt and braces: any real HTTP call from the SDK would go through fetch.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Network disabled in coach tests')
    }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('GET /api/coach/status', () => {
    it('reports disabled without credentials', async () => {
      const res = await request(app).get('/api/coach/status')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ claudeEnabled: false, model: 'claude-sonnet-5-5' })
    })

    it('reports enabled with an API key (without leaking it)', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      const res = await request(app).get('/api/coach/status')
      expect(res.body.claudeEnabled).toBe(true)
      expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY)
    })

    it('accepts ANTHROPIC_AUTH_TOKEN and a custom model', async () => {
      vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token-123')
      vi.stubEnv('CLAUDE_MODEL', 'claude-opus-5-5')
      const res = await request(app).get('/api/coach/status')
      expect(res.body).toEqual({ claudeEnabled: true, model: 'claude-opus-5-5' })
    })

    it('reports disabled when COACH_OFFLINE=1', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      vi.stubEnv('COACH_OFFLINE', '1')
      const res = await request(app).get('/api/coach/status')
      expect(res.body.claudeEnabled).toBe(false)
    })
  })

  describe('POST /api/coach', () => {
    it('falls back to the built-in coach when no key is configured', async () => {
      const res = await request(app).post('/api/coach').send(coachReq)
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('fallback')
      expect(res.body.warning).toMatch(/not configured/i)
      expect(res.body.plan).toEqual(buildFallbackPlan(coachReq))
      expect(res.body.model).toBeUndefined()
      expect(mocks.parse).not.toHaveBeenCalled()
      expect(mocks.ctor).not.toHaveBeenCalled()
    })

    it('falls back when COACH_OFFLINE=1 even with a key', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      vi.stubEnv('COACH_OFFLINE', '1')
      const res = await request(app).post('/api/coach').send(coachReq)
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('fallback')
      expect(res.body.warning).toMatch(/offline/i)
      expect(mocks.parse).not.toHaveBeenCalled()
    })

    it('returns a sanitized Claude plan and sends the expected request', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockResolvedValue(claudeReply({
        summary: '  You hit 62% — the 10s–20s stretch (41%) held you back.  ',
        focus: 'Arms · 10s–20s',
        startTime: -4,
        endTime: 999,
        playbackSpeed: 0.6,
        repeats: 99,
        cue: 'Lock your elbows on every hit.',
        improvement: 'There was no previous attempt, so this must be dropped.',
        encouragement: 'Wasil is 19 points ahead — go get him!',
      }))

      const res = await request(app).post('/api/coach').send(coachReq)
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('claude')
      expect(res.body.model).toBe('claude-sonnet-5-5')
      expect(res.body.warning).toBeUndefined()
      expect(res.body.plan).toEqual({
        summary: 'You hit 62% — the 10s–20s stretch (41%) held you back.',
        focus: 'Arms · 10s–20s',
        startTime: 0,
        endTime: 30,
        playbackSpeed: 0.5,
        repeats: 8,
        cue: 'Lock your elbows on every hit.',
        encouragement: 'Wasil is 19 points ahead — go get him!',
      })

      expect(mocks.ctor).toHaveBeenCalledTimes(1)
      expect(mocks.ctor.mock.calls[0][0]).toMatchObject({ apiKey: FAKE_KEY })

      expect(mocks.parse).toHaveBeenCalledTimes(1)
      const [params, options] = mocks.parse.mock.calls[0]
      expect(params.model).toBe('claude-sonnet-5-5')
      expect(params.max_tokens).toBe(4000)
      expect(params.betas).toEqual(['server-side-fallback-2026-07-01'])
      expect(params.fallbacks).toBe('default')
      expect(params.output_config.effort).toBe('low')
      expect(params.output_config.format.type).toBe('json_schema')
      expect(params.output_config.format.schema.properties).toHaveProperty('startTime')
      expect(params).not.toHaveProperty('thinking')
      expect(params).not.toHaveProperty('temperature')
      expect(params).not.toHaveProperty('top_p')
      expect(typeof params.system).toBe('string')
      expect(params.messages).toHaveLength(1)
      expect(params.messages[0].role).toBe('user')
      // Whole percentages, never raw 0-1 floats
      expect(params.messages[0].content).toContain('"overallPct":62')
      expect(params.messages[0].content).toContain('"pct":41')
      expect(params.messages[0].content).not.toContain('0.4137')
      expect(params.messages[0].content).toContain('"durationSeconds":30')
      expect(params.messages[0].content).not.toContain(FAKE_KEY)
      expect(options).toMatchObject({ timeout: 20_000, maxRetries: 1 })
      expect(options.signal).toBeInstanceOf(AbortSignal)
    })

    it('honours COACH_MODEL and COACH_EFFORT (invalid effort -> low)', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      vi.stubEnv('COACH_MODEL', 'claude-opus-5-5')
      vi.stubEnv('COACH_EFFORT', 'medium')
      mocks.parse.mockResolvedValue(claudeReply({}, { model: 'claude-opus-5-5' }))
      const res = await request(app).post('/api/coach').send(coachReq)
      expect(res.body.source).toBe('claude')
      expect(res.body.model).toBe('claude-opus-5-5')
      expect(mocks.parse.mock.calls[0][0].model).toBe('claude-opus-5-5')
      expect(mocks.parse.mock.calls[0][0].output_config.effort).toBe('medium')

      vi.stubEnv('COACH_EFFORT', 'max')
      await request(app).post('/api/coach').send(coachReq)
      expect(mocks.parse.mock.calls[1][0].output_config.effort).toBe('low')
    })

    it('ignores CLAUDE_EFFORT and accepts CLAUDE_MODEL as an alias', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      vi.stubEnv('CLAUDE_MODEL', 'claude-opus-5-5')
      vi.stubEnv('CLAUDE_EFFORT', 'high')
      mocks.parse.mockResolvedValue(claudeReply({}, { model: 'claude-opus-5-5' }))
      await request(app).post('/api/coach').send(coachReq)
      expect(mocks.parse.mock.calls[0][0].model).toBe('claude-opus-5-5')
      expect(mocks.parse.mock.calls[0][0].output_config.effort).toBe('low')
    })

    it('reuses the cached client across requests', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockResolvedValue(claudeReply({}))
      await request(app).post('/api/coach').send(coachReq)
      await request(app).post('/api/coach').send(coachReq)
      expect(mocks.ctor).toHaveBeenCalledTimes(1)
      expect(mocks.parse).toHaveBeenCalledTimes(2)
    })

    it('keeps improvement when a previous attempt was sent, filling it in if Claude omitted it', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      const withPrev: CoachRequest = { ...coachReq, previousAttempt: { ...coachReq.attempt, overallScore: 0.5 } }

      mocks.parse.mockResolvedValueOnce(claudeReply({ ...buildFallbackPlan(coachReq), improvement: 'Up 12 points!' }))
      const first = await request(app).post('/api/coach').send(withPrev)
      expect(first.body.plan.improvement).toBe('Up 12 points!')

      mocks.parse.mockResolvedValueOnce(claudeReply({ ...buildFallbackPlan(coachReq) }))
      const second = await request(app).post('/api/coach').send(withPrev)
      expect(second.body.source).toBe('claude')
      expect(second.body.plan.improvement).toContain('Up 12 points')
    })

    it.each([
      ['AuthenticationError', () => new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', headers()), /rejected the API key/],
      ['RateLimitError', () => new Anthropic.RateLimitError(429, { type: 'error' }, 'rate limited', headers()), /rate limited/],
      ['APIConnectionTimeoutError', () => new Anthropic.APIConnectionTimeoutError(), /too long/],
      ['APIConnectionError', () => new Anthropic.APIConnectionError({ message: 'ECONNRESET' }), /could not reach/i],
      ['InternalServerError', () => new Anthropic.InternalServerError(529, { type: 'error' }, 'overloaded', headers()), /\(529\)/],
      ['AnthropicError (bad structured output)', () => new Anthropic.AnthropicError('Failed to parse structured output'), /unexpected response/],
      ['plain Error', () => new Error('boom'), /built-in coach/],
    ])('falls back when the SDK throws %s', async (_name, makeError, warning) => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockRejectedValue(makeError())
      const res = await request(app).post('/api/coach').send(coachReq)
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('fallback')
      expect(res.body.warning).toMatch(warning)
      expect(res.body.warning).toMatch(/built-in coach/)
      expect(res.body.plan).toEqual(buildFallbackPlan(coachReq))
      expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY)
    })

    it('falls back on a refusal', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockResolvedValue(claudeReply(null, {
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
      }))
      const res = await request(app).post('/api/coach').send(coachReq)
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('fallback')
      expect(res.body.warning).toMatch(/declined/)
      expect(res.body.plan).toEqual(buildFallbackPlan(coachReq))
    })

    it('falls back when there is no parsed output', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockResolvedValue(claudeReply(null, { stop_reason: 'max_tokens' }))
      const res = await request(app).post('/api/coach').send(coachReq)
      expect(res.body.source).toBe('fallback')
      expect(res.body.warning).toMatch(/no usable answer/)
    })

    it.each([
      ['missing attempt', { ...coachReq, attempt: undefined }],
      ['score above 1', { ...coachReq, attempt: { ...coachReq.attempt, overallScore: 1.5 } }],
      ['negative section score', { ...coachReq, attempt: { ...coachReq.attempt, sectionScores: [{ startTime: 0, endTime: 10, score: -0.1 }] } }],
      ['zero duration', { ...coachReq, durationSeconds: 0 }],
      ['duration over an hour', { ...coachReq, durationSeconds: 3601 }],
      ['string duration', { ...coachReq, durationSeconds: '30' }],
      ['bad rank', { ...coachReq, attempt: { ...coachReq.attempt, rank: 'Z' } }],
      ['too many sections', {
        ...coachReq,
        attempt: { ...coachReq.attempt, sectionScores: Array.from({ length: 201 }, (_, i) => ({ startTime: i, endTime: i + 1, score: 0.5 })) },
      }],
      ['player name over 40 chars', { ...coachReq, playerName: 'x'.repeat(41) }],
      ['title over 200 chars', { ...coachReq, danceTitle: 'x'.repeat(201) }],
      ['host score above 1', { ...coachReq, hostScore: 81 }],
    ])('rejects an invalid body (%s) with 400', async (_name, body) => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      const res = await request(app).post('/api/coach').send(body)
      expect(res.status).toBe(400)
      expect(typeof res.body.error).toBe('string')
      expect(res.body.error.length).toBeGreaterThan(0)
      expect(mocks.parse).not.toHaveBeenCalled()
    })

    it('rejects a non-JSON body with 400', async () => {
      const res = await request(app).post('/api/coach').set('Content-Type', 'text/plain').send('hello')
      expect(res.status).toBe(400)
      expect(typeof res.body.error).toBe('string')
    })

    it('treats null optionals as absent', async () => {
      const res = await request(app).post('/api/coach').send({ ...coachReq, previousAttempt: null, hostName: null, hostScore: null })
      expect(res.status).toBe(200)
      expect(res.body.plan.improvement).toBeUndefined()
    })

    it('gives a still, half-framed player a movement-first built-in plan', async () => {
      const res = await request(app).post('/api/coach').send(stillReq)
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('fallback')
      expect(res.body.plan).toEqual(buildFallbackPlan(stillReq))
      const { plan } = res.body
      expect(plan.summary).toMatch(/barely moving/)
      expect(plan.summary).toContain('30%')
      expect(plan.summary).toMatch(/stay in frame/)
      expect(plan.summary).toMatch(/step back/)
      expect(plan.focus).toBe('Arms · 10s–20s')
      expect(plan.playbackSpeed).toBe(0.5)
      expect(plan.cue).toMatch(/arm/i)
      // Never blames leg technique when the legs were out of frame.
      expect(`${plan.summary} ${plan.focus} ${plan.cue}`).not.toMatch(/knee|plant every step|Legs \(\d+%\)/)
    })

    it('sends the evidence to Claude and drills movement at half speed', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockResolvedValue(claudeReply({
        summary: 'You scored 21%: the camera saw you for only 30% of the song and you were barely moving (5%).',
        focus: 'Arms · 10s–20s',
        startTime: 10,
        endTime: 20,
        playbackSpeed: 0.75,
        repeats: 4,
        cue: 'Copy every arm move big on the beat.',
      }))
      const res = await request(app).post('/api/coach').send(stillReq)
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('claude')
      // Movement problems are always drilled at 0.5x, whatever the model chose.
      expect(res.body.plan.playbackSpeed).toBe(0.5)

      const content: string = mocks.parse.mock.calls[0][0].messages[0].content
      expect(content).toContain('"coveragePct":30')
      expect(content).toContain('"motionMatchPct":5')
      expect(content).toContain('"untrackedBodyParts":["Legs"]')
      expect(content).toContain('{"name":"Legs","pct":8,"tracked":false}')
      expect(content).toContain('"latencyMs":100')
      expect(content).toContain('"bodyPart":"Arms"')
      expect(content).toContain('"primaryProblem":"coverage+motion"')
      expect(content).toContain('step back so your full body is visible')
      expect(content).not.toContain('"mirrored"')
      expect(content).not.toContain('0.05')
      expect(mocks.parse.mock.calls[0][0].system).toMatch(/Never blame an untracked body part/)
    })

    it('keeps the model speed when technique is the problem', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockResolvedValue(claudeReply({ playbackSpeed: 1 }))
      const healthy = { ...coachReq, attempt: { ...coachReq.attempt, coverage: 0.97, motionMatch: 0.7 } }
      const res = await request(app).post('/api/coach').send(healthy)
      expect(res.body.source).toBe('claude')
      expect(res.body.plan.playbackSpeed).toBe(1)
      expect(mocks.parse.mock.calls[0][0].messages[0].content).toContain('"primaryProblem":"technique"')
    })

    it.each([
      ['coverage above 1', { coverage: 1.2 }],
      ['negative motionMatch', { motionMatch: -0.1 }],
      ['latency over 2000 ms', { latencyMs: 2001 }],
      ['non-boolean mirrored', { mirrored: 'yes' }],
      ['five untracked parts', { untrackedBodyParts: ['a', 'b', 'c', 'd', 'e'] }],
      ['untracked part over 20 chars', { untrackedBodyParts: ['L'.repeat(21)] }],
      ['nine notes', { notes: Array.from({ length: 9 }, () => 'n') }],
      ['note over 240 chars', { notes: ['n'.repeat(241)] }],
    ])('rejects out-of-range evidence (%s) with 400', async (_name, extra) => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      const res = await request(app).post('/api/coach').send({ ...stillReq, attempt: { ...stillReq.attempt, ...extra } })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/attempt\./)
      const prev = await request(app).post('/api/coach').send({ ...coachReq, previousAttempt: { ...stillReq.attempt, ...extra } })
      expect(prev.status).toBe(400)
      expect(prev.body.error).toMatch(/previousAttempt\./)
      expect(mocks.parse).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/coach/battle', () => {
    it('falls back to the built-in announcer when no key is configured', async () => {
      const res = await request(app).post('/api/coach/battle').send(battleReq)
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('fallback')
      expect(res.body.warning).toMatch(/not configured/i)
      expect(res.body.verdict).toEqual(buildFallbackVerdict(battleReq))
      expect(mocks.parse).not.toHaveBeenCalled()
    })

    it('decides the winner on the server even if the model says otherwise', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockResolvedValue(claudeReply({
        winner: 'host',
        marginPoints: -12,
        headline: '  Jin dethrones Wasil!  ',
        commentary: 'Jin edges it 82% to 78% with those Arms at 90%. Rematch!',
      }))
      const res = await request(app).post('/api/coach/battle').send(battleReq)
      expect(res.status).toBe(200)
      expect(res.body.source).toBe('claude')
      expect(res.body.model).toBe('claude-sonnet-5-5')
      expect(res.body.verdict).toEqual({
        winner: 'challenger',
        marginPoints: 4,
        headline: 'Jin dethrones Wasil!',
        commentary: 'Jin edges it 82% to 78% with those Arms at 90%. Rematch!',
      })

      const [params] = mocks.parse.mock.calls[0]
      expect(params.fallbacks).toBe('default')
      expect(params.output_config.format.schema.properties).not.toHaveProperty('winner')
      expect(params.messages[0].content).toContain('"winner":"challenger"')
      expect(params.messages[0].content).toContain('"marginPoints":4')
    })

    it('caps model text and fills gaps from the built-in announcer', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockResolvedValue(claudeReply({ headline: 'H'.repeat(200), commentary: '' }))
      const res = await request(app).post('/api/coach/battle').send(battleReq)
      expect(res.body.verdict.headline.length).toBeLessThanOrEqual(80)
      expect(res.body.verdict.commentary).toBe(buildFallbackVerdict(battleReq).commentary)
    })

    it('falls back on refusal and on SDK errors', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockResolvedValueOnce(claudeReply(null, { stop_reason: 'refusal' }))
      const refused = await request(app).post('/api/coach/battle').send(battleReq)
      expect(refused.body.source).toBe('fallback')
      expect(refused.body.verdict).toEqual(buildFallbackVerdict(battleReq))

      mocks.parse.mockRejectedValueOnce(new Anthropic.RateLimitError(429, { type: 'error' }, 'slow down', headers()))
      const limited = await request(app).post('/api/coach/battle').send(battleReq)
      expect(limited.body.source).toBe('fallback')
      expect(limited.body.warning).toMatch(/rate limited/)
    })

    it('passes contender evidence to the battle prompt', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY)
      mocks.parse.mockResolvedValue(claudeReply({ headline: 'Wasil holds the crown!', commentary: 'Step into frame next time, Jin!' }))
      const res = await request(app).post('/api/coach/battle').send({
        ...battleReq,
        challenger: { ...battleReq.challenger, score: 0.21, coverage: 0.3, motionMatch: 0.05, untrackedBodyParts: ['Legs'] },
      })
      expect(res.status).toBe(200)
      expect(res.body.verdict.winner).toBe('host')
      const content: string = mocks.parse.mock.calls[0][0].messages[0].content
      expect(content).toContain('"coveragePct":30')
      expect(content).toContain('"motionMatchPct":5')
      expect(content).toContain('"untrackedBodyParts":["Legs"]')
    })

    it.each([
      ['missing challenger', { ...battleReq, challenger: undefined }],
      ['score above 1', { ...battleReq, host: { name: 'Wasil', score: 78 } }],
      ['name over 40 chars', { ...battleReq, host: { name: 'W'.repeat(41), score: 0.7 } }],
      ['leaderboard over 200 entries', { ...battleReq, leaderboard: Array.from({ length: 201 }, () => ({ name: 'a', score: 0.5 })) }],
      ['challenger coverage above 1', { ...battleReq, challenger: { ...battleReq.challenger, coverage: 1.5 } }],
    ])('rejects an invalid body (%s) with 400', async (_name, body) => {
      const res = await request(app).post('/api/coach/battle').send(body)
      expect(res.status).toBe(400)
      expect(typeof res.body.error).toBe('string')
    })
  })
})

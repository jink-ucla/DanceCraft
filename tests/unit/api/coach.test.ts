import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  API_BASE,
  COACH_FALLBACK_WARNING,
  fetchCoachStatus,
  requestBattleVerdict,
  requestCoachPlan,
} from '../../../src/api/coach'
import { buildFallbackPlan, sanitizeCoachPlan } from '../../../src/coach/plan'
import {
  COACH_SPEEDS,
  MAX_DRILL_REPEATS,
  MIN_DRILL_REPEATS,
  MIN_DRILL_SECONDS,
} from '../../../src/coach/types'
import type { BattleRequest, CoachPlan, CoachRequest } from '../../../src/coach/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DURATION = 30

const coachReq: CoachRequest = {
  danceTitle: 'Wasil Shuffle',
  durationSeconds: DURATION,
  playerName: 'Jin',
  attempt: {
    overallScore: 0.64,
    rank: 'B',
    sectionScores: [
      { startTime: 0, endTime: 10, score: 0.8 },
      { startTime: 10, endTime: 20, score: 0.45 },
      { startTime: 20, endTime: 30, score: 0.7 },
    ],
    bodyPartScores: [
      { name: 'Arms', score: 0.52 },
      { name: 'Legs', score: 0.76 },
    ],
  },
  hostName: 'Wasil',
  hostScore: 0.78,
}

const battleReq: BattleRequest = {
  danceTitle: 'Wasil Shuffle',
  host: { name: 'Wasil', score: 0.7 },
  challenger: { name: 'Jin', score: 0.82, rank: 'S' },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** fetch mock that hangs until its signal aborts, then rejects like real fetch. */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('This operation was aborted', 'AbortError'))
    })
  }))
}

function expectValidPlan(plan: CoachPlan) {
  expect(plan.startTime).toBeGreaterThanOrEqual(0)
  expect(plan.endTime).toBeLessThanOrEqual(DURATION)
  expect(plan.endTime - plan.startTime).toBeGreaterThanOrEqual(MIN_DRILL_SECONDS)
  expect(COACH_SPEEDS).toContain(plan.playbackSpeed)
  expect(plan.repeats).toBeGreaterThanOrEqual(MIN_DRILL_REPEATS)
  expect(plan.repeats).toBeLessThanOrEqual(MAX_DRILL_REPEATS)
  expect(Number.isInteger(plan.repeats)).toBe(true)
  expect(plan.summary.length).toBeGreaterThan(0)
  expect(plan.focus.length).toBeGreaterThan(0)
  expect(plan.cue.length).toBeGreaterThan(0)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// requestCoachPlan
// ---------------------------------------------------------------------------

describe('requestCoachPlan', () => {
  it('POSTs the request to /api/coach and sanitizes the server plan', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      source: 'claude',
      model: 'claude-test-model',
      plan: {
        summary: '  Arms dropped in the middle section.  ',
        focus: 'Arms · 10s–20s',
        startTime: -5,
        endTime: 999,
        playbackSpeed: 0.6,
        repeats: 50,
        cue: 'Snap the elbows to shoulder height.',
        encouragement: 'Wasil is beatable!',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await requestCoachPlan(coachReq)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${API_BASE}/api/coach`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(coachReq)

    expect(res.source).toBe('claude')
    expect(res.model).toBe('claude-test-model')
    expect(res.warning).toBeUndefined()
    expectValidPlan(res.plan)
    expect(res.plan.summary).toBe('Arms dropped in the middle section.')
    expect(res.plan.cue).toBe('Snap the elbows to shoulder height.')
  })

  it('matches sanitizeCoachPlan output exactly for the server plan', async () => {
    const serverPlan = {
      summary: 'Solid start.',
      focus: 'Legs · 20s–30s',
      startTime: 20,
      endTime: 30,
      playbackSpeed: 0.75,
      repeats: 3,
      cue: 'Bend the knees.',
    }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ source: 'claude', plan: serverPlan })))

    const res = await requestCoachPlan(coachReq)

    expect(res.plan).toEqual(sanitizeCoachPlan(serverPlan, DURATION, coachReq.attempt.sectionScores))
  })

  it('falls back to the built-in coach on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)))

    const res = await requestCoachPlan(coachReq)

    expect(res.source).toBe('fallback')
    expect(res.warning).toBe(COACH_FALLBACK_WARNING)
    expect(res.model).toBeUndefined()
    expectValidPlan(res.plan)
    expect(res.plan).toEqual(
      sanitizeCoachPlan(buildFallbackPlan(coachReq), DURATION, coachReq.attempt.sectionScores),
    )
  })

  it('falls back on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    const res = await requestCoachPlan(coachReq)

    expect(res.source).toBe('fallback')
    expect(res.warning).toBe(COACH_FALLBACK_WARNING)
    expectValidPlan(res.plan)
  })

  it('falls back on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 200 })))

    const res = await requestCoachPlan(coachReq)

    expect(res.source).toBe('fallback')
    expect(res.warning).toBe(COACH_FALLBACK_WARNING)
    expectValidPlan(res.plan)
  })

  it('falls back when the JSON has no plan object', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ source: 'claude', plan: 'nope' })))

    const res = await requestCoachPlan(coachReq)

    expect(res.source).toBe('fallback')
    expectValidPlan(res.plan)
  })

  it('keeps a server-side fallback warning', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      source: 'fallback',
      warning: 'ANTHROPIC_API_KEY not set',
      plan: buildFallbackPlan(coachReq),
    })))

    const res = await requestCoachPlan(coachReq)

    expect(res.source).toBe('fallback')
    expect(res.warning).toBe('ANTHROPIC_API_KEY not set')
  })

  it('re-throws AbortError when the caller aborts mid-request', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const controller = new AbortController()

    const pending = requestCoachPlan(coachReq, controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('re-throws AbortError without fetching when the signal is already aborted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()

    await expect(requestCoachPlan(coachReq, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back (not abort) when the server hangs past the client timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())

    const pending = requestCoachPlan(coachReq)
    await vi.advanceTimersByTimeAsync(60_000)
    const res = await pending

    expect(res.source).toBe('fallback')
    expect(res.warning).toBe(COACH_FALLBACK_WARNING)
  })
})

// ---------------------------------------------------------------------------
// requestBattleVerdict
// ---------------------------------------------------------------------------

describe('requestBattleVerdict', () => {
  it('recomputes winner and margin client-side, keeping the server words', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      source: 'claude',
      model: 'claude-test-model',
      verdict: {
        winner: 'host', // wrong on purpose: challenger scored higher
        marginPoints: -50,
        headline: 'Jin dethrones Wasil!',
        commentary: 'Twelve points clear. The crowd goes wild.',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await requestBattleVerdict(battleReq)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${API_BASE}/api/coach/battle`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(battleReq)

    expect(res.source).toBe('claude')
    expect(res.model).toBe('claude-test-model')
    expect(res.verdict.winner).toBe('challenger')
    expect(res.verdict.marginPoints).toBeCloseTo(12, 0)
    expect(res.verdict.headline).toBe('Jin dethrones Wasil!')
    expect(res.verdict.commentary).toBe('Twelve points clear. The crowd goes wild.')
  })

  it('declares the host the winner when the host scored higher, whatever the server says', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      source: 'claude',
      verdict: { winner: 'challenger', marginPoints: 99, headline: 'x', commentary: 'y' },
    })))

    const res = await requestBattleVerdict({
      ...battleReq,
      host: { name: 'Wasil', score: 0.9 },
      challenger: { name: 'Jin', score: 0.6 },
    })

    expect(res.verdict.winner).toBe('host')
    expect(res.verdict.marginPoints).toBeLessThan(0)
  })

  it('fills missing headline/commentary from the built-in verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ source: 'claude', verdict: { headline: '   ' } })))

    const res = await requestBattleVerdict(battleReq)

    expect(res.verdict.winner).toBe('challenger')
    expect(res.verdict.headline.length).toBeGreaterThan(0)
    expect(res.verdict.commentary.length).toBeGreaterThan(0)
  })

  it('falls back on non-2xx with a client-decided winner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 503)))

    const res = await requestBattleVerdict(battleReq)

    expect(res.source).toBe('fallback')
    expect(res.warning).toBe(COACH_FALLBACK_WARNING)
    expect(res.verdict.winner).toBe('challenger')
    expect(res.verdict.marginPoints).toBeCloseTo(12, 0)
    expect(res.verdict.headline.length).toBeGreaterThan(0)
    expect(res.verdict.commentary.length).toBeGreaterThan(0)
  })

  it('falls back on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    const res = await requestBattleVerdict(battleReq)

    expect(res.source).toBe('fallback')
    expect(res.verdict.winner).toBe('challenger')
  })

  it('re-throws AbortError', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const controller = new AbortController()

    const pending = requestBattleVerdict(battleReq, controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

// ---------------------------------------------------------------------------
// fetchCoachStatus
// ---------------------------------------------------------------------------

describe('fetchCoachStatus', () => {
  it('returns the status from GET /api/coach/status', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ claudeEnabled: true, model: 'claude-test-model' }))
    vi.stubGlobal('fetch', fetchMock)

    const status = await fetchCoachStatus()

    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`${API_BASE}/api/coach/status`)
    expect(status).toEqual({ claudeEnabled: true, model: 'claude-test-model' })
  })

  it('returns null when the server is unreachable or replies with junk', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await fetchCoachStatus()).toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ hello: 'world' })))
    expect(await fetchCoachStatus()).toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ claudeEnabled: true }, 500)))
    expect(await fetchCoachStatus()).toBeNull()
  })

  it('re-throws AbortError', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const controller = new AbortController()

    const pending = fetchCoachStatus(controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

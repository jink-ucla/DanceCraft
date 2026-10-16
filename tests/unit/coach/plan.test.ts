import { describe, it, expect } from 'vitest'
import {
  COACH_TEXT_LIMITS,
  LOW_COVERAGE,
  LOW_MOTION_MATCH,
  buildFallbackPlan,
  buildFallbackVerdict,
  decideBattle,
  diagnoseAttempt,
  findWeakestTrackedBodyPart,
  sanitizeBattleVerdict,
  sanitizeCoachPlan,
} from '../../../src/coach/plan'
import {
  COACH_SPEEDS,
  MAX_DRILL_REPEATS,
  MIN_DRILL_REPEATS,
  MIN_DRILL_SECONDS,
} from '../../../src/coach/types'
import type {
  AttemptSummary,
  BattleRequest,
  CoachPlan,
  CoachRequest,
  CoachSectionScore,
} from '../../../src/coach/types'

const SECTIONS: CoachSectionScore[] = [
  { startTime: 0, endTime: 10, score: 0.82 },
  { startTime: 10, endTime: 20, score: 0.41 },
  { startTime: 20, endTime: 30, score: 0.66 },
]

const ATTEMPT: AttemptSummary = {
  overallScore: 0.63,
  rank: 'B',
  sectionScores: SECTIONS,
  bodyPartScores: [
    { name: 'Arms', score: 0.55 },
    { name: 'Legs', score: 0.71 },
  ],
}

/** Honest scorer output for someone who stood still, half out of frame, legs hidden. */
const STILL_ATTEMPT: AttemptSummary = {
  ...ATTEMPT,
  overallScore: 0.21,
  rank: 'C',
  bodyPartScores: [{ name: 'Arms', score: 0.31 }, { name: 'Legs', score: 0.08 }],
  coverage: 0.3,
  motionMatch: 0.05,
  latencyMs: 100,
  mirrored: true,
  untrackedBodyParts: ['Legs'],
  notes: ['Your legs were out of frame — step back so your full body is visible.'],
}

const REQ: CoachRequest = {
  danceTitle: 'Wasil Shuffle',
  durationSeconds: 30,
  playerName: 'Jin',
  attempt: ATTEMPT,
}

const VALID_PLAN: CoachPlan = {
  summary: 'Solid run.',
  focus: 'Arms · 10s–20s',
  startTime: 10,
  endTime: 20,
  playbackSpeed: 0.75,
  repeats: 3,
  cue: 'Snap the arms.',
}

/** Invariants every sanitized plan must satisfy. */
function expectValidPlan(plan: CoachPlan, duration: number) {
  expect(Number.isFinite(plan.startTime)).toBe(true)
  expect(Number.isFinite(plan.endTime)).toBe(true)
  expect(plan.startTime).toBeGreaterThanOrEqual(0)
  expect(plan.endTime).toBeLessThanOrEqual(duration)
  if (duration >= MIN_DRILL_SECONDS) {
    // Same check PracticeMode's KeyB handler performs.
    expect(plan.endTime - plan.startTime >= MIN_DRILL_SECONDS).toBe(true)
  } else {
    expect(plan.startTime).toBe(0)
    expect(plan.endTime).toBe(duration)
  }
  expect(COACH_SPEEDS).toContain(plan.playbackSpeed)
  expect(Number.isInteger(plan.repeats)).toBe(true)
  expect(plan.repeats).toBeGreaterThanOrEqual(MIN_DRILL_REPEATS)
  expect(plan.repeats).toBeLessThanOrEqual(MAX_DRILL_REPEATS)
  expect(plan.summary.length).toBeGreaterThan(0)
  expect(plan.summary.length).toBeLessThanOrEqual(COACH_TEXT_LIMITS.summary)
  expect(plan.focus.length).toBeGreaterThan(0)
  expect(plan.focus.length).toBeLessThanOrEqual(COACH_TEXT_LIMITS.focus)
  expect(plan.cue.length).toBeGreaterThan(0)
  expect(plan.cue.length).toBeLessThanOrEqual(COACH_TEXT_LIMITS.cue)
  if ('improvement' in plan) expect(typeof plan.improvement).toBe('string')
  if ('encouragement' in plan) expect(typeof plan.encouragement).toBe('string')
}

describe('sanitizeCoachPlan', () => {
  it('returns an already-valid plan unchanged', () => {
    expect(sanitizeCoachPlan(VALID_PLAN, 30, SECTIONS)).toEqual(VALID_PLAN)
  })

  it('repairs non-object input into a valid plan built from the weakest section', () => {
    for (const raw of [null, undefined, 'plan', 42, [], [VALID_PLAN]]) {
      const plan = sanitizeCoachPlan(raw, 30, SECTIONS)
      expectValidPlan(plan, 30)
      expect(plan.startTime).toBe(10)
      expect(plan.endTime).toBe(20)
      // weakest section is 41% -> 0.5x, 3 reps
      expect(plan.playbackSpeed).toBe(0.5)
      expect(plan.repeats).toBe(3)
    }
  })

  it('derives NaN / undefined / non-numeric fields from the weakest section', () => {
    const plan = sanitizeCoachPlan({
      startTime: Number.NaN,
      endTime: undefined,
      playbackSpeed: 'fast',
      repeats: Number.POSITIVE_INFINITY,
      summary: 12,
      cue: null,
    }, 30, SECTIONS)
    expectValidPlan(plan, 30)
    expect(plan.startTime).toBe(10)
    expect(plan.endTime).toBe(20)
    expect(plan.playbackSpeed).toBe(0.5)
    expect(plan.repeats).toBe(3)
  })

  it('uses 4 reps by default when the weakest section is below 40%', () => {
    const sections = [{ startTime: 0, endTime: 10, score: 0.3 }, { startTime: 10, endTime: 20, score: 0.9 }]
    const plan = sanitizeCoachPlan({}, 20, sections)
    expect(plan.repeats).toBe(4)
    expect(plan.playbackSpeed).toBe(0.5)
  })

  it('uses 1x speed by default when every section is strong', () => {
    const plan = sanitizeCoachPlan({}, 20, [{ startTime: 0, endTime: 20, score: 0.9 }])
    expect(plan.playbackSpeed).toBe(1)
  })

  it.each([
    [0.6, 0.5],
    [0.625, 0.5],
    [0.7, 0.75],
    [0.8, 0.75],
    [0.9, 1],
    [1, 1],
    [2, 1],
    [0, 0.5],
    [-3, 0.5],
  ])('snaps playbackSpeed %s to %s', (input, expected) => {
    expect(sanitizeCoachPlan({ ...VALID_PLAN, playbackSpeed: input }, 30, SECTIONS).playbackSpeed).toBe(expected)
  })

  it.each([
    [99, MAX_DRILL_REPEATS],
    [8.4, 8],
    [2.6, 3],
    [0, MIN_DRILL_REPEATS],
    [-5, MIN_DRILL_REPEATS],
  ])('rounds + clamps repeats %s to %s', (input, expected) => {
    expect(sanitizeCoachPlan({ ...VALID_PLAN, repeats: input }, 30, SECTIONS).repeats).toBe(expected)
  })

  it('uses [0, duration] when the clip is shorter than MIN_DRILL_SECONDS', () => {
    const plan = sanitizeCoachPlan({ ...VALID_PLAN, startTime: 1, endTime: 2 }, 2.5, [])
    expect(plan.startTime).toBe(0)
    expect(plan.endTime).toBe(2.5)
    expectValidPlan(plan, 2.5)
  })

  it('clamps a start beyond the duration to the last MIN_DRILL_SECONDS', () => {
    const plan = sanitizeCoachPlan({ ...VALID_PLAN, startTime: 45, endTime: 50 }, 30, SECTIONS)
    expect(plan.startTime).toBe(30 - MIN_DRILL_SECONDS)
    expect(plan.endTime).toBe(30)
    expectValidPlan(plan, 30)
  })

  it('clamps negative starts and ends past the duration', () => {
    const plan = sanitizeCoachPlan({ ...VALID_PLAN, startTime: -5, endTime: 999 }, 30, SECTIONS)
    expect(plan.startTime).toBe(0)
    expect(plan.endTime).toBe(30)
  })

  it('extends a too-short window to MIN_DRILL_SECONDS', () => {
    const plan = sanitizeCoachPlan({ ...VALID_PLAN, startTime: 12, endTime: 13 }, 30, SECTIONS)
    expect(plan.startTime).toBe(12)
    expect(plan.endTime).toBe(12 + MIN_DRILL_SECONDS)
  })

  it('shifts the start back when the window cannot be extended past the end', () => {
    const plan = sanitizeCoachPlan({ ...VALID_PLAN, startTime: 29, endTime: 30 }, 30, SECTIONS)
    expect(plan.startTime).toBe(27)
    expect(plan.endTime).toBe(30)
  })

  it('swaps a reversed window', () => {
    const plan = sanitizeCoachPlan({ ...VALID_PLAN, startTime: 20, endTime: 10 }, 30, SECTIONS)
    expect(plan.startTime).toBe(10)
    expect(plan.endTime).toBe(20)
  })

  it('keeps the default drill length when only one end of the window is given', () => {
    const onlyStart = sanitizeCoachPlan({ ...VALID_PLAN, startTime: 5, endTime: undefined }, 30, SECTIONS)
    expect([onlyStart.startTime, onlyStart.endTime]).toEqual([5, 15])
    const onlyEnd = sanitizeCoachPlan({ ...VALID_PLAN, startTime: undefined, endTime: 25 }, 30, SECTIONS)
    expect([onlyEnd.startTime, onlyEnd.endTime]).toEqual([15, 25])
  })

  it('handles empty sections (defaults to the opening seconds)', () => {
    const plan = sanitizeCoachPlan({}, 60, [])
    expectValidPlan(plan, 60)
    expect(plan.startTime).toBe(0)
    expect(plan.endTime).toBe(10)
    expect(plan.playbackSpeed).toBe(1)
  })

  it('falls back to the last section end when duration is NaN, 0 or negative', () => {
    for (const duration of [Number.NaN, 0, -4, Number.POSITIVE_INFINITY]) {
      const plan = sanitizeCoachPlan({ ...VALID_PLAN, endTime: 100 }, duration, SECTIONS)
      expect(plan.endTime).toBe(30)
      expectValidPlan(plan, 30)
    }
  })

  it('falls back to a 10s duration when neither duration nor sections are usable', () => {
    const plan = sanitizeCoachPlan({ startTime: 50, endTime: 60 }, Number.NaN, [])
    expect(plan.startTime).toBe(7)
    expect(plan.endTime).toBe(10)
    expectValidPlan(plan, 10)
  })

  it('ignores malformed sections', () => {
    const sections = [
      { startTime: Number.NaN, endTime: 10, score: 0 },
      { startTime: 10, endTime: 20, score: 0.7 },
    ] as CoachSectionScore[]
    const plan = sanitizeCoachPlan({}, 20, sections)
    expect(plan.startTime).toBe(10)
    expect(plan.endTime).toBe(20)
    expect(plan.playbackSpeed).toBe(0.75)
  })

  it('trims, collapses whitespace and caps strings', () => {
    const plan = sanitizeCoachPlan({
      ...VALID_PLAN,
      summary: `  ${'a'.repeat(400)}  `,
      focus: '  Arms \n\n · 10s–20s  ',
      cue: 'c'.repeat(500),
      improvement: 'i'.repeat(500),
      encouragement: 'e'.repeat(500),
    }, 30, SECTIONS)
    expect(plan.summary.length).toBe(COACH_TEXT_LIMITS.summary)
    expect(plan.summary.endsWith('…')).toBe(true)
    expect(plan.focus).toBe('Arms · 10s–20s')
    expect(plan.cue.length).toBe(COACH_TEXT_LIMITS.cue)
    expect(plan.improvement?.length).toBe(COACH_TEXT_LIMITS.improvement)
    expect(plan.encouragement?.length).toBe(COACH_TEXT_LIMITS.encouragement)
  })

  it('does not split an emoji when capping', () => {
    const plan = sanitizeCoachPlan({ ...VALID_PLAN, focus: `${'x'.repeat(46)}🔥🔥🔥` }, 30, SECTIONS)
    expect(plan.focus.length).toBeLessThanOrEqual(COACH_TEXT_LIMITS.focus)
    expect(plan.focus).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  it('fills sensible defaults for empty strings', () => {
    const plan = sanitizeCoachPlan({ ...VALID_PLAN, summary: '   ', focus: '', cue: '' }, 30, SECTIONS)
    expect(plan.summary).toMatch(/10s–20s/)
    expect(plan.summary).toMatch(/41%/)
    expect(plan.focus).toBe('Drill · 10s–20s')
    expect(plan.cue.length).toBeGreaterThan(10)
  })

  it('drops non-string or empty optional fields', () => {
    const plan = sanitizeCoachPlan({ ...VALID_PLAN, improvement: 5, encouragement: '  ' }, 30, SECTIONS)
    expect('improvement' in plan).toBe(false)
    expect('encouragement' in plan).toBe(false)
  })

  it('never copies unknown fields through', () => {
    const plan = sanitizeCoachPlan({ ...VALID_PLAN, winner: 'host', __proto__x: 1 }, 30, SECTIONS)
    expect(Object.keys(plan).sort()).toEqual(
      ['cue', 'endTime', 'focus', 'playbackSpeed', 'repeats', 'startTime', 'summary'],
    )
  })

  it('keeps the window >= MIN_DRILL_SECONDS under floating point for random inputs, and is idempotent', () => {
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let i = 0; i < 3000; i++) {
      const duration = rand() < 0.1 ? rand() * 4 : rand() * 600
      const raw = {
        startTime: (rand() - 0.1) * duration * 1.2,
        endTime: (rand() - 0.1) * duration * 1.2,
        playbackSpeed: rand() * 2,
        repeats: rand() * 20 - 5,
      }
      const plan = sanitizeCoachPlan(raw, duration, SECTIONS)
      expectValidPlan(plan, duration)
      expect(sanitizeCoachPlan(plan, duration, SECTIONS)).toEqual(plan)
    }
  })
})

describe('buildFallbackPlan', () => {
  it('drills the weakest section with the weakest body part', () => {
    const plan = buildFallbackPlan(REQ)
    expect(plan.startTime).toBe(10)
    expect(plan.endTime).toBe(20)
    expect(plan.playbackSpeed).toBe(0.5)
    expect(plan.repeats).toBe(3)
    expect(plan.focus).toBe('Arms · 10s–20s')
    expect(plan.summary).toContain('Jin')
    expect(plan.summary).toContain('63%')
    expect(plan.summary).toContain('41%')
    expect(plan.cue.toLowerCase()).toContain('arm')
    expect(plan.improvement).toBeUndefined()
    expectValidPlan(plan, 30)
  })

  it('breaks ties toward the earliest section', () => {
    const plan = buildFallbackPlan({
      ...REQ,
      attempt: {
        ...ATTEMPT,
        sectionScores: [
          { startTime: 20, endTime: 30, score: 0.6 },
          { startTime: 0, endTime: 10, score: 0.9 },
          { startTime: 10, endTime: 20, score: 0.6 },
        ],
      },
    })
    expect(plan.startTime).toBe(10)
    expect(plan.endTime).toBe(20)
    expect(plan.playbackSpeed).toBe(0.75)
  })

  it.each([
    [0.3, 0.5, 4],
    [0.45, 0.5, 3],
    [0.6, 0.75, 3],
    [0.8, 1, 3],
  ])('section score %s -> speed %s, %s reps', (score, speed, reps) => {
    const plan = buildFallbackPlan({
      ...REQ,
      attempt: { ...ATTEMPT, sectionScores: [{ startTime: 0, endTime: 10, score }] },
    })
    expect(plan.playbackSpeed).toBe(speed)
    expect(plan.repeats).toBe(reps)
  })

  it('gives a legs cue when legs are weakest and a generic cue for unknown parts', () => {
    const legs = buildFallbackPlan({
      ...REQ,
      attempt: { ...ATTEMPT, bodyPartScores: [{ name: 'Arms', score: 0.9 }, { name: 'Legs', score: 0.2 }] },
    })
    expect(legs.cue.toLowerCase()).toMatch(/knee|step/)
    expect(legs.focus.startsWith('Legs')).toBe(true)

    const none = buildFallbackPlan({ ...REQ, attempt: { ...ATTEMPT, bodyPartScores: [] } })
    expect(none.focus.startsWith('Timing')).toBe(true)
    expect(none.cue.toLowerCase()).toContain('beat')
  })

  it('reports the overall delta and the drilled section when a previous attempt is given', () => {
    const plan = buildFallbackPlan({
      ...REQ,
      previousAttempt: {
        ...ATTEMPT,
        overallScore: 0.55,
        sectionScores: [
          { startTime: 0, endTime: 10, score: 0.8 },
          { startTime: 10, endTime: 20, score: 0.3 },
          { startTime: 20, endTime: 30, score: 0.6 },
        ],
      },
    })
    expect(plan.improvement).toContain('Up 8 points')
    expect(plan.improvement).toContain('55% → 63%')
    expect(plan.improvement).toContain('30% → 41%')
  })

  it('reports a drop kindly', () => {
    const plan = buildFallbackPlan({ ...REQ, previousAttempt: { ...ATTEMPT, overallScore: 0.7 } })
    expect(plan.improvement).toContain('Down 7 points')
  })

  it('mentions the gap to the host', () => {
    const behind = buildFallbackPlan({ ...REQ, hostName: 'Wasil', hostScore: 0.81 })
    expect(behind.encouragement).toContain('Wasil')
    expect(behind.encouragement).toContain('18 points')

    const ahead = buildFallbackPlan({ ...REQ, hostName: 'Wasil', hostScore: 0.5 })
    expect(ahead.encouragement).toContain('ahead of Wasil')
  })

  it('handles empty sections, short clips and bad durations', () => {
    const empty = buildFallbackPlan({ ...REQ, attempt: { ...ATTEMPT, sectionScores: [] } })
    expectValidPlan(empty, 30)
    expect([empty.startTime, empty.endTime]).toEqual([0, 10])

    const short = buildFallbackPlan({ ...REQ, durationSeconds: 2, attempt: { ...ATTEMPT, sectionScores: [{ startTime: 0, endTime: 2, score: 0.4 }] } })
    expect([short.startTime, short.endTime]).toEqual([0, 2])

    const nan = buildFallbackPlan({ ...REQ, durationSeconds: Number.NaN })
    expectValidPlan(nan, 30)
  })

  it('extends a short last section to MIN_DRILL_SECONDS', () => {
    const plan = buildFallbackPlan({
      ...REQ,
      durationSeconds: 31.5,
      attempt: {
        ...ATTEMPT,
        sectionScores: [...SECTIONS, { startTime: 30, endTime: 31.5, score: 0.1 }],
      },
    })
    expect(plan.endTime).toBe(31.5)
    expect(plan.startTime).toBe(28.5)
  })

  it('output passes sanitizeCoachPlan unchanged', () => {
    const requests: CoachRequest[] = [
      REQ,
      { ...REQ, hostName: 'Wasil', hostScore: 0.9, previousAttempt: { ...ATTEMPT, overallScore: 0.4 } },
      { ...REQ, playerName: 'x'.repeat(40), attempt: { ...ATTEMPT, bodyPartScores: [{ name: 'y'.repeat(40), score: 0.1 }] } },
      { ...REQ, durationSeconds: 2.2, attempt: { ...ATTEMPT, sectionScores: [] } },
      { ...REQ, durationSeconds: 31.7, attempt: { ...ATTEMPT, sectionScores: [{ startTime: 30.1, endTime: 31.7, score: 0 }] } },
      { ...REQ, durationSeconds: Number.NaN },
      { ...REQ, attempt: STILL_ATTEMPT },
      { ...REQ, playerName: 'x'.repeat(40), hostName: 'y'.repeat(40), hostScore: 0.9, attempt: STILL_ATTEMPT, previousAttempt: STILL_ATTEMPT },
      { ...REQ, attempt: { ...STILL_ATTEMPT, untrackedBodyParts: ['Arms', 'Legs', 'z'.repeat(20)] } },
      { ...REQ, attempt: { ...ATTEMPT, coverage: 0.5 } },
    ]
    for (const req of requests) {
      const plan = buildFallbackPlan(req)
      expect(sanitizeCoachPlan(plan, req.durationSeconds, req.attempt.sectionScores)).toEqual(plan)
    }
  })
})

/** Every player-facing string of a plan. */
function planText(plan: CoachPlan): string {
  return [plan.summary, plan.focus, plan.cue, plan.improvement ?? '', plan.encouragement ?? ''].join(' ')
}

describe('buildFallbackPlan with honest-scoring evidence', () => {
  it('tells a still, half-framed player to move and stay in frame — never blames leg technique', () => {
    const plan = buildFallbackPlan({ ...REQ, attempt: STILL_ATTEMPT })
    expect(plan.summary).toContain('Jin, you scored 21% (rank C).')
    expect(plan.summary).toMatch(/barely moving \(5% motion match\)/)
    expect(plan.summary).toMatch(/only 30% of the song/)
    expect(plan.summary).toMatch(/stay in frame for the whole song/)
    expect(plan.summary).toMatch(/legs were out of frame — step back/)
    // Drill the tracked part on the weakest (busiest-for-a-still-player) section, at half speed.
    expect(plan.focus).toBe('Arms · 10s–20s')
    expect([plan.startTime, plan.endTime]).toEqual([10, 20])
    expect(plan.playbackSpeed).toBe(0.5)
    expect(plan.repeats).toBe(3)
    expect(plan.cue).toMatch(/arm move/)
    expect(plan.cue).toMatch(/whenever the dancer moves, you move/)
    const text = planText(plan)
    expect(text).not.toMatch(/knee|plant every step|room to grow|Legs \(\d+%\)/)
    expect(text).not.toMatch(/mirror/i)
    expectValidPlan(plan, 30)
  })

  it('uses 0.5x for a motion problem even when the section score would allow faster', () => {
    const plan = buildFallbackPlan({
      ...REQ,
      attempt: { ...ATTEMPT, sectionScores: [{ startTime: 0, endTime: 10, score: 0.9 }, { startTime: 10, endTime: 20, score: 0.7 }], coverage: 0.95, motionMatch: 0.2 },
    })
    expect(plan.playbackSpeed).toBe(0.5)
    expect(plan.summary).toMatch(/You were barely moving \(20% motion match\)/)
    expect(plan.summary).not.toMatch(/camera saw you/)
    expect(plan.focus).toBe('Arms · 10s–20s')
    expect(plan.cue).toMatch(/arm move/)
  })

  it('asks a moving but out-of-frame player to stay in frame', () => {
    const plan = buildFallbackPlan({ ...REQ, attempt: { ...ATTEMPT, coverage: 0.45, motionMatch: 0.8 } })
    expect(plan.summary).toMatch(/only 45% of the song — stay in frame for the whole song/)
    expect(plan.summary).not.toMatch(/barely moving/)
    expect(plan.cue).toMatch(/stay inside the frame/)
    expect(plan.playbackSpeed).toBe(0.5)
    expect(plan.encouragement).toMatch(/Big moves first/)
  })

  it('coaches the weakest TRACKED part and adds a step-back tip when technique is the problem', () => {
    const plan = buildFallbackPlan({
      ...REQ,
      attempt: {
        ...ATTEMPT,
        bodyPartScores: [{ name: 'Arms', score: 0.55 }, { name: 'Legs', score: 0.2 }],
        coverage: 0.9,
        motionMatch: 0.6,
        untrackedBodyParts: ['legs'],
      },
    })
    expect(plan.focus).toBe('Arms · 10s–20s')
    expect(plan.summary).toContain('Arms (55%) have the most room to grow.')
    expect(plan.summary).toContain('Your legs were out of frame — step back so the camera can see them.')
    expect(plan.cue.toLowerCase()).toContain('arm')
    expect(planText(plan)).not.toMatch(/knee|Legs \(20%\)/)
    expect(plan.playbackSpeed).toBe(0.5) // weakest section 41%
  })

  it('falls back to a whole-body movement drill when no body part was tracked', () => {
    const plan = buildFallbackPlan({ ...REQ, attempt: { ...STILL_ATTEMPT, untrackedBodyParts: ['Arms', 'Legs'] } })
    expect(plan.focus).toBe('Movement · 10s–20s')
    expect(plan.cue).toMatch(/Keep moving with the dancer/)
    expect(plan.summary).toContain('Your arms and legs were out of frame — step back so the camera can see them.')
  })

  it('matches the pre-evidence plan when the evidence is healthy or absent', () => {
    const before = buildFallbackPlan(REQ)
    expect(buildFallbackPlan({ ...REQ, attempt: { ...ATTEMPT, coverage: 0.95, motionMatch: 0.8, untrackedBodyParts: [], mirrored: true } })).toEqual(before)
    expect(buildFallbackPlan({ ...REQ, attempt: { ...ATTEMPT, coverage: LOW_COVERAGE, motionMatch: LOW_MOTION_MATCH } })).toEqual(before)
  })

  it('reports the motion-match change since the last try', () => {
    const plan = buildFallbackPlan({
      ...REQ,
      attempt: { ...ATTEMPT, coverage: 0.9, motionMatch: 0.5 },
      previousAttempt: { ...STILL_ATTEMPT },
    })
    expect(plan.improvement).toContain('Up 42 points')
    expect(plan.improvement).toContain('Motion match 5% → 50%.')

    const framing = buildFallbackPlan({
      ...REQ,
      attempt: { ...ATTEMPT, coverage: 0.9, motionMatch: 0.6 },
      previousAttempt: { ...ATTEMPT, coverage: 0.4, motionMatch: 0.6 },
    })
    expect(framing.improvement).toContain('In frame for 40% → 90% of the song.')
  })
})

describe('diagnoseAttempt / findWeakestTrackedBodyPart', () => {
  it.each([
    [{}, 'technique'],
    [{ coverage: 0.59 }, 'coverage'],
    [{ coverage: 0.6 }, 'technique'],
    [{ motionMatch: 0.349 }, 'motion'],
    [{ motionMatch: 0.35 }, 'technique'],
    [{ coverage: 0.3, motionMatch: 0.05 }, 'coverage+motion'],
    [{ coverage: Number.NaN, motionMatch: Number.POSITIVE_INFINITY }, 'technique'],
  ])('%o -> %s', (evidence, problem) => {
    expect(diagnoseAttempt({ ...ATTEMPT, ...evidence }).primaryProblem).toBe(problem)
  })

  it('de-duplicates untracked parts and ignores junk', () => {
    const d = diagnoseAttempt({ untrackedBodyParts: [' Legs ', 'legs', '', 7 as unknown as string, 'Arms'] })
    expect(d.untrackedBodyParts).toEqual(['Legs', 'Arms'])
    expect(diagnoseAttempt(undefined)).toEqual({ lowCoverage: false, lowMotion: false, primaryProblem: 'technique', untrackedBodyParts: [] })
  })

  it('skips untracked parts when finding the weakest body part', () => {
    expect(findWeakestTrackedBodyPart(STILL_ATTEMPT)).toEqual({ name: 'Arms', score: 0.31 })
    expect(findWeakestTrackedBodyPart({ ...STILL_ATTEMPT, untrackedBodyParts: ['ARMS', 'legs'] })).toBeNull()
    expect(findWeakestTrackedBodyPart({ ...STILL_ATTEMPT, untrackedBodyParts: undefined })).toEqual({ name: 'Legs', score: 0.08 })
  })
})

describe('decideBattle', () => {
  const host = { name: 'Wasil', score: 0.8 }

  it('declares the challenger when ahead by >= 0.5 points', () => {
    expect(decideBattle(host, { name: 'Jin', score: 0.805 })).toEqual({ winner: 'challenger', marginPoints: 0.5 })
    expect(decideBattle(host, { name: 'Jin', score: 0.842 })).toEqual({ winner: 'challenger', marginPoints: 4.2 })
  })

  it('declares the host when ahead by >= 0.5 points', () => {
    expect(decideBattle(host, { name: 'Jin', score: 0.795 })).toEqual({ winner: 'host', marginPoints: -0.5 })
    expect(decideBattle(host, { name: 'Jin', score: 0.5 })).toEqual({ winner: 'host', marginPoints: -30 })
  })

  it('calls a tie when |margin| < 0.5 points', () => {
    expect(decideBattle(host, { name: 'Jin', score: 0.804 })).toEqual({ winner: 'tie', marginPoints: 0.4 })
    expect(decideBattle(host, { name: 'Jin', score: 0.796 })).toEqual({ winner: 'tie', marginPoints: -0.4 })
    const equal = decideBattle(host, { name: 'Jin', score: 0.8 })
    expect(equal.winner).toBe('tie')
    expect(Object.is(equal.marginPoints, 0)).toBe(true)
  })

  it('rounds the margin to one decimal', () => {
    expect(decideBattle({ name: 'a', score: 0.85 }, { name: 'b', score: 0.873 }).marginPoints).toBe(2.3)
  })

  it('treats non-finite scores as 0', () => {
    expect(decideBattle({ name: 'a', score: Number.NaN }, { name: 'b', score: 0.5 })).toEqual({ winner: 'challenger', marginPoints: 50 })
  })
})

describe('buildFallbackVerdict / sanitizeBattleVerdict', () => {
  const battle: BattleRequest = {
    danceTitle: 'Wasil Shuffle',
    host: { name: 'Wasil', score: 0.78 },
    challenger: {
      name: 'Jin',
      score: 0.82,
      bodyPartScores: [{ name: 'Arms', score: 0.9 }, { name: 'Legs', score: 0.6 }],
    },
  }

  it('builds a challenger-win verdict grounded in the scores', () => {
    const v = buildFallbackVerdict(battle)
    expect(v.winner).toBe('challenger')
    expect(v.marginPoints).toBe(4)
    expect(v.headline).toContain('Jin')
    expect(v.commentary).toContain('82%')
    expect(v.commentary).toContain('78%')
    expect(v.commentary).toContain('Arms')
  })

  it('builds host-win and tie verdicts', () => {
    const hostWin = buildFallbackVerdict({ ...battle, challenger: { ...battle.challenger, score: 0.6 } })
    expect(hostWin.winner).toBe('host')
    expect(hostWin.headline).toContain('Wasil')
    expect(hostWin.commentary).toContain('Legs')

    const tie = buildFallbackVerdict({ ...battle, challenger: { ...battle.challenger, score: 0.781 } })
    expect(tie.winner).toBe('tie')
    expect(tie.headline.toLowerCase()).toContain('dead heat')
  })

  it('keeps text within limits even with long names', () => {
    const v = buildFallbackVerdict({
      ...battle,
      host: { name: 'H'.repeat(40), score: 0.5 },
      challenger: { name: 'C'.repeat(40), score: 0.9 },
    })
    expect(v.headline.length).toBeLessThanOrEqual(COACH_TEXT_LIMITS.headline)
    expect(v.commentary.length).toBeLessThanOrEqual(COACH_TEXT_LIMITS.commentary)
  })

  it('sanitizeBattleVerdict ignores any winner/margin in the raw input', () => {
    const v = sanitizeBattleVerdict({ winner: 'host', marginPoints: -50, headline: '  Wasil wins!  ', commentary: 'x'.repeat(400) }, battle)
    expect(v.winner).toBe('challenger')
    expect(v.marginPoints).toBe(4)
    expect(v.headline).toBe('Wasil wins!')
    expect(v.commentary.length).toBe(COACH_TEXT_LIMITS.commentary)
  })

  it('sanitizeBattleVerdict fills missing text from the built-in announcer', () => {
    const v = sanitizeBattleVerdict(null, battle)
    expect(v).toEqual(buildFallbackVerdict(battle))
  })

  it('never blames or praises an out-of-frame body part', () => {
    const legsHidden = { ...battle.challenger, untrackedBodyParts: ['Legs'] }
    const hostWin = buildFallbackVerdict({ ...battle, challenger: { ...legsHidden, score: 0.6 } })
    expect(hostWin.winner).toBe('host')
    expect(hostWin.commentary).not.toContain('Legs')
    expect(hostWin.commentary).toContain('Arms')

    const armsHidden = { ...battle.challenger, untrackedBodyParts: ['arms'] }
    const challengerWin = buildFallbackVerdict({ ...battle, challenger: armsHidden })
    expect(challengerWin.winner).toBe('challenger')
    expect(challengerWin.commentary).not.toContain('Arms')
  })

  it('puts framing / movement ahead of technique when the challenger lost', () => {
    const lowCoverage = buildFallbackVerdict({ ...battle, challenger: { ...battle.challenger, score: 0.3, coverage: 0.3 } })
    expect(lowCoverage.commentary).toContain('stay in frame')
    expect(lowCoverage.commentary).not.toContain('Legs')

    const lowMotion = buildFallbackVerdict({ ...battle, challenger: { ...battle.challenger, score: 0.3, coverage: 0.9, motionMatch: 0.05 } })
    expect(lowMotion.commentary).toContain('keep moving')
    expect(lowMotion.commentary).not.toContain('Legs')
  })
})

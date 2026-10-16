import { test, expect } from '@playwright/test'
import type { Page, Request } from '@playwright/test'
import { mockApiDances } from './helpers'

/**
 * DanceCraft UI smoke: results screen with the Claude coach + "Beat Wasil"
 * battle (dev-only /?preview=results hook), the coach drill hand-off to
 * PracticeMode, and the arena home screen.
 *
 * Every backend call is mocked; nothing reaches a real API server or Claude.
 * The webcam is Chromium's fake device, so pose detection is NOT exercised:
 * PracticeMode either reaches its drill-ready card or shows its init error.
 */
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
  viewport: { width: 1280, height: 800 },
})

const API_DANCE = {
  id: 1,
  youtubeUrl: 'https://example.com/wasil-dance',
  title: 'Beat Wasil',
  duration: 27,
  channel: 'DanceCraft',
  thumbnailPath: null,
  poseDataPath: '/tmp/poses.json',
  videoPath: '/tmp/video.mp4',
  audioPath: null,
  status: 'complete',
  createdAt: '2026-10-15T00:00:00Z',
}

const COACH_RESPONSE = {
  plan: {
    summary: 'Strong opening at 82%, but 10s–16s dipped to 41%: your arms trail the beat there.',
    focus: 'Arms · 10s–16s',
    startTime: 10,
    endTime: 16,
    playbackSpeed: 0.5,
    repeats: 3,
    cue: 'Snap both elbows up on the one and freeze for half a beat.',
    improvement: 'Up 12 points on your last try: the 10s–20s section climbed from 30% to 41%.',
    encouragement: 'Wasil sits at 78%. Clean this section up and the crown is yours.',
  },
  source: 'claude',
  model: 'claude-sonnet-5-5',
}

const BATTLE_RESPONSE = {
  verdict: {
    winner: 'host',
    marginPoints: -15,
    headline: 'Wasil holds the crown, for now',
    commentary: 'Guest closed in at 63% against Wasil\'s 78%. Fix the 10s–20s arms and this rematch gets spicy.',
  },
  source: 'claude',
  model: 'claude-sonnet-5-5',
}

/** Synthetic 33-keypoint dance (normalized 0-1 coords): arms pump, knees bounce. */
function buildPoseTimeline(duration = 27, fps = 5) {
  const base: [number, number][] = [
    [0.5, 0.18], // 0 nose
    [0.51, 0.165], [0.515, 0.165], [0.52, 0.165], // 1-3 left eye
    [0.49, 0.165], [0.485, 0.165], [0.48, 0.165], // 4-6 right eye
    [0.53, 0.175], [0.47, 0.175], // 7-8 ears
    [0.51, 0.2], [0.49, 0.2], // 9-10 mouth
    [0.56, 0.28], [0.44, 0.28], // 11-12 shoulders
    [0.6, 0.38], [0.4, 0.38], // 13-14 elbows
    [0.62, 0.47], [0.38, 0.47], // 15-16 wrists
    [0.625, 0.49], [0.375, 0.49], // 17-18 pinky
    [0.62, 0.495], [0.38, 0.495], // 19-20 index
    [0.61, 0.485], [0.39, 0.485], // 21-22 thumb
    [0.54, 0.52], [0.46, 0.52], // 23-24 hips
    [0.55, 0.68], [0.45, 0.68], // 25-26 knees
    [0.55, 0.84], [0.45, 0.84], // 27-28 ankles
    [0.545, 0.86], [0.455, 0.86], // 29-30 heels
    [0.57, 0.87], [0.43, 0.87], // 31-32 foot index
  ]
  const keyframes = []
  for (let f = 0; f <= duration * fps; f++) {
    const time = f / fps
    const pump = (Math.sin(time * Math.PI * 2 * 0.8) + 1) / 2 // 0..1
    const bounce = Math.abs(Math.sin(time * Math.PI * 1.6)) * 0.02
    const keypoints = base.map(([x, y], i) => {
      let px = x
      let py = y + (i <= 24 ? bounce : 0)
      if (i >= 13 && i <= 22) {
        // raise forearms/hands towards head height and out to the sides
        const side = i % 2 === 1 ? 1 : -1
        const lift = i >= 15 ? 0.3 : 0.14
        py -= pump * lift
        px += side * pump * (i >= 15 ? 0.08 : 0.05)
      }
      if (i === 25 || i === 26) py += bounce * 0.5
      return { x: Number(px.toFixed(4)), y: Number(py.toFixed(4)), score: 0.95 }
    })
    keyframes.push({ time: Number(time.toFixed(3)), keypoints })
  }
  return { fps, duration, keyframes }
}

interface ApiCounters {
  coach: number
  battle: number
}

/** Mock every backend call (API_BASE = localhost:3001); count coach/battle POSTs. */
async function mockBackend(page: Page): Promise<ApiCounters> {
  const counters: ApiCounters = { coach: 0, battle: 0 }

  // Catch-all first (Playwright tries the most recently added route first), so no
  // request can reach a real server on :3001 (another checkout may be running there).
  await page.route('http://localhost:3001/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not mocked"}' }))

  await mockApiDances(page, [API_DANCE])

  const timeline = buildPoseTimeline()
  await page.route('**/api/dances/1/poses', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(timeline) }))

  await page.route('**/api/coach/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ claudeEnabled: true, model: 'claude-sonnet-5-5' }),
    }))

  await page.route('**/api/coach', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    counters.coach += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COACH_RESPONSE) })
  })

  await page.route('**/api/coach/battle', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    counters.battle += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BATTLE_RESPONSE) })
  })

  return counters
}

test.describe('DanceCraft coach + arena', () => {
  test('results: Claude coach plan, battle vs host, drill hand-off', async ({ page }) => {
    test.setTimeout(120_000)
    const counters = await mockBackend(page)
    const coachBodies: unknown[] = []
    page.on('request', (req: Request) => {
      if (req.method() === 'POST' && req.url().endsWith('/api/coach')) coachBodies.push(req.postDataJSON())
    })

    await page.goto('/?preview=results')

    // Score column: delta vs the previous attempt (63% vs 51%)
    await expect(page.locator('.results-percentage')).toHaveText('63%')
    const delta = page.locator('.results-delta')
    await expect(delta).toBeVisible()
    await expect(delta).toContainText('+12% vs last try')
    await expect(page.locator('.results-weakest-note')).toContainText('10s–20s')

    // "Why this score?": the honest scorer's evidence from the preview mock
    const why = page.locator('.results-why')
    await expect(why).toBeVisible()
    await expect(why.locator('.results-why-meter-label')).toHaveText([
      'Tracked 74% of the song',
      'Moving with the dance: 52%',
    ])
    await expect(why).toContainText('Latency compensated: 200 ms')
    await expect(why).toContainText('Mirror-style detected')
    await expect(why.locator('.results-why-tips li')).toHaveCount(2)
    // Legs were out of frame: greyed "out of frame" bar, not a red 0%
    const untracked = page.locator('.breakdown-item--untracked')
    await expect(untracked).toHaveCount(1)
    await expect(untracked).toContainText('Legs')
    await expect(untracked).toContainText('out of frame')

    // "Your clip": the preview stands in the reference video (badged) + replay button
    const clip = page.getByTestId('results-clip')
    await expect(clip).toBeVisible()
    await expect(clip.locator('h3')).toHaveText('Your clip')
    await expect(clip.locator('video.results-clip-video')).toHaveAttribute('src', /.+/)
    await expect(clip.locator('.results-clip-badge')).toBeVisible()
    await expect(clip.locator('.results-clip-replay-btn')).toContainText('Watch side-by-side replay')
    await expect(clip.locator('.results-clip-all')).toHaveText('All clips')

    // Coach panel: the mocked Claude plan, rendered verbatim
    const coach = page.locator('.coach-panel')
    await expect(coach.locator('.coach-summary')).toHaveText(COACH_RESPONSE.plan.summary)
    await expect(coach.locator('.coach-cue')).toContainText(COACH_RESPONSE.plan.cue)
    await expect(coach.locator('.coach-focus-value')).toHaveText('Arms · 10s–16s')
    await expect(coach.locator('.coach-source--claude')).toContainText('claude-sonnet-5-5')
    await expect(coach.locator('.coach-improvement')).toBeVisible()
    const drillBtn = coach.locator('.coach-drill-btn')
    await expect(drillBtn).toBeVisible()
    await expect(drillBtn).toContainText('0.5x')
    await expect(drillBtn).toContainText('3 reps')

    // Battle panel: "BEAT WASIL?", host wins 78% vs 63%, mocked commentary, leaderboard
    const battle = page.locator('.battle-panel')
    await expect(battle.locator('.battle-banner')).toContainText('WASIL')
    await expect(battle.locator('.battle-headline')).toHaveText(BATTLE_RESPONSE.verdict.headline)
    await expect(battle.locator('.battle-contender--host')).toHaveClass(/is-winner/)
    await expect(battle.locator('.battle-leaderboard-row')).toHaveCount(4)

    // Characters were drawn (canvas inside every DancingCharacter)
    await expect(page.locator('.battle-panel .dancing-character canvas').first()).toBeVisible()
    await expect(page.locator('.coach-demo .dancing-character')).toBeVisible()

    // StrictMode mounts effects twice in dev: still exactly one request each
    await page.waitForTimeout(500)
    expect(counters.coach).toBe(1)
    expect(counters.battle).toBe(1)
    const body = coachBodies[0] as {
      attempt: Record<string, unknown> & { overallScore: number; bodyPartScores: Record<string, unknown>[] }
      previousAttempt?: Record<string, unknown>
      hostName?: string
    }
    expect(body.attempt.overallScore).toBeCloseTo(0.63)
    expect(body.previousAttempt).toBeTruthy()
    expect(body.hostName).toBe('Wasil')
    // The honest-scoring evidence rides along to the coach (no heavy alignment array)
    expect(body.attempt).toMatchObject({
      coverage: 0.74,
      motionMatch: 0.52,
      latencyMs: 200,
      mirrored: true,
      untrackedBodyParts: ['Legs'],
    })
    expect(body.attempt.notes).toHaveLength(2)
    expect(body.attempt).not.toHaveProperty('alignment')
    for (const part of body.attempt.bodyPartScores) expect(part).not.toHaveProperty('tracked')
    expect(body.previousAttempt).toMatchObject({
      coverage: 0.61,
      motionMatch: 0.41,
      latencyMs: 300,
      mirrored: true,
      untrackedBodyParts: ['Legs'],
    })

    // The action bar stays reachable on a 1280x800 screen
    await expect(page.locator('.results-btn-retry')).toBeInViewport()

    await page.screenshot({ path: 'tests/e2e/screenshots/dancecraft-results.png' })

    // "Practice this" -> PracticeMode driven by the plan. With a fake webcam the
    // detector may or may not initialise: accept the drill-ready card or the error.
    await drillBtn.click()
    await expect(page.locator('.practice-mode')).toBeVisible()
    const ready = page.locator('.drill-ready-overlay')
    const failed = page.locator('.practice-mode .dance-error')
    await expect(ready.or(failed)).toBeVisible({ timeout: 60_000 })
    if (await ready.isVisible()) {
      await expect(ready.locator('.drill-ready-focus')).toHaveText('Arms · 10s–16s')
      await expect(ready.locator('.drill-ready-range')).toHaveText('0:10–0:16')
      await expect(ready.locator('.drill-ready-speed')).toHaveText('0.5x')
      await expect(ready.locator('.drill-ready-reps')).toHaveText('3')
      await expect(ready.locator('.drill-ready-cue')).toHaveText(COACH_RESPONSE.plan.cue)
    } else {
      await expect(failed).not.toBeEmpty()
    }
    await page.screenshot({ path: 'tests/e2e/screenshots/dancecraft-practice.png' })

    // Back from a coach drill returns to the results with the same plan, no re-ask
    await page.locator('.practice-back-btn').click()
    await expect(page.locator('.coach-panel .coach-summary')).toHaveText(COACH_RESPONSE.plan.summary)
    await expect(page.locator('.battle-panel .battle-headline')).toHaveText(BATTLE_RESPONSE.verdict.headline)
    await page.waitForTimeout(500)
    expect(counters.coach).toBe(1)
    expect(counters.battle).toBe(1)
  })

  test('home: DanceCraft header, buddy character, score to beat', async ({ page }) => {
    await page.addInitScript(() => {
      const attempt = {
        overallScore: 0.78,
        rank: 'S',
        sectionScores: [{ startTime: 0, endTime: 10, score: 0.8 }, { startTime: 10, endTime: 20, score: 0.76 }],
        bodyPartScores: [{ name: 'Arms', score: 0.8 }, { name: 'Legs', score: 0.75 }],
      }
      localStorage.setItem('dancecraft_arena_entries', JSON.stringify([
        { danceId: 'api-1', player: 'Wasil', score: 0.78, rank: 'S', date: '2026-10-15T18:00:00.000Z', isHost: true, attempt },
      ]))
      localStorage.setItem('dancecraft_current_player', JSON.stringify({ name: 'Leo', isHost: false }))
    })
    await mockBackend(page)

    await page.goto('/')

    await expect(page.locator('h1')).toHaveText('DanceCraft')
    await expect(page.locator('.home-subtitle')).toContainText('Claude')
    const buddy = page.locator('.home-hero-character .dancing-character[data-character="buddy"]')
    await expect(buddy).toBeVisible()
    await expect(buddy.locator('canvas')).toBeVisible()
    await expect(page.locator('.home-player-chip')).toContainText('Leo')

    // Hero: CTAs on the first ready dance + the host's score to beat
    const hero = page.locator('.hero')
    await expect(hero.locator('.hero-title')).toContainText('Beat the host.')
    const start = hero.getByRole('button', { name: 'Start the challenge' })
    await expect(start).toBeVisible()
    await expect(hero.getByRole('button', { name: 'Practice' })).toBeVisible()
    await expect(hero.getByRole('button', { name: '+ Add Dance' })).toBeVisible()
    await expect(hero.locator('.hero-board-score')).toContainText('78')
    await expect(hero.locator('.hero-board-holder-name')).toHaveText('Wasil')

    const card = page.locator('.dance-card', { hasText: 'Beat Wasil' })
    await expect(card).toBeVisible()
    await expect(card.locator('.dance-card-to-beat')).toContainText('Wasil')
    await expect(card.locator('.dance-card-to-beat')).toContainText('78%')

    await page.screenshot({ path: 'tests/e2e/screenshots/dancecraft-home.png' })

    // "Start the challenge" opens the player/difficulty modal for the hero's dance
    await start.click()
    const modal = page.locator('.difficulty-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.difficulty-title')).toHaveText('Beat Wasil')
    await modal.locator('.difficulty-cancel').click()
    await expect(modal).toHaveCount(0)
  })
})

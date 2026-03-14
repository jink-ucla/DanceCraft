import { test, expect } from '@playwright/test'
import { goToHome, SAMPLE_API_DANCE } from './helpers'

/**
 * Visual regression baseline tests.
 * These capture reference screenshots for each major screen and state.
 * Run `npx playwright test --update-snapshots` to update baselines.
 */
test.describe('Visual regression baselines', () => {
  test.describe('Home screen', () => {
    test('home screen with bundled dances', async ({ page }) => {
      await goToHome(page)
      await page.waitForSelector('.dance-card')
      await expect(page).toHaveScreenshot('home-bundled.png', {
        fullPage: true,
      })
    })

    test('home screen with API dances', async ({ page }) => {
      await goToHome(page, [SAMPLE_API_DANCE])
      await page.waitForSelector('.dance-card')
      await expect(page).toHaveScreenshot('home-with-api.png', {
        fullPage: true,
      })
    })

    test('home screen error state', async ({ page }) => {
      await page.route('**/api/dances', (route) =>
        route.abort('connectionrefused')
      )
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.home-error')).toBeVisible()
      await expect(page).toHaveScreenshot('home-error.png', {
        fullPage: true,
      })
    })
  })

  test.describe('Settings', () => {
    test('settings page', async ({ page }) => {
      await goToHome(page)
      await page.locator('text=Settings').click()
      await expect(page.locator('.settings-screen')).toBeVisible()
      await expect(page).toHaveScreenshot('settings.png', {
        fullPage: true,
      })
    })
  })

  test.describe('History', () => {
    test('history page empty state', async ({ page }) => {
      await goToHome(page)
      await page.locator('text=History').click()
      await expect(page.locator('.history-screen')).toBeVisible()
      await expect(page).toHaveScreenshot('history-empty.png', {
        fullPage: true,
      })
    })
  })

  test.describe('Dance mode', () => {
    test('dance mode loading state', async ({ page }) => {
      await goToHome(page)
      await page.locator('.dance-card').first().click()
      await expect(page.locator('.dance-mode')).toBeVisible()
      await expect(page).toHaveScreenshot('dance-loading.png', {
        fullPage: true,
      })
    })

    test('dance mode countdown', async ({ page }) => {
      await goToHome(page)
      await page.evaluate(() => {
        const app = document.querySelector('.app')!
        app.innerHTML = `
          <div class="dance-mode" style="width: 100vw; height: 100vh; position: relative; background: #000;">
            <div class="dance-countdown-overlay">
              <div class="dance-countdown-number">3</div>
            </div>
          </div>
        `
      })
      await expect(page).toHaveScreenshot('dance-countdown.png', {
        fullPage: true,
      })
    })

    test('dance mode HUD', async ({ page }) => {
      await goToHome(page)
      await page.evaluate(() => {
        const app = document.querySelector('.app')!
        app.innerHTML = `
          <div class="dance-mode" style="width: 100vw; height: 100vh; position: relative; background: #000;">
            <div class="dance-hud">
              <div class="dance-score-container">
                <div class="dance-score-label">SCORE</div>
                <div class="dance-score">1250</div>
              </div>
              <div class="dance-combo">
                <span class="dance-combo-multiplier">5x</span>
                <span class="dance-combo-text">COMBO</span>
              </div>
            </div>
            <div class="dance-feedback dance-feedback-perfect" style="animation: none; opacity: 1;">Perfect!</div>
            <div class="dance-progress-bar">
              <div class="dance-progress-fill" style="width: 60%"></div>
              <div class="dance-progress-time">0:18 / 0:30</div>
            </div>
          </div>
        `
      })
      await expect(page).toHaveScreenshot('dance-hud.png', {
        fullPage: true,
      })
    })

    test('dance mode finished overlay', async ({ page }) => {
      await goToHome(page)
      await page.evaluate(() => {
        const app = document.querySelector('.app')!
        app.innerHTML = `
          <div class="dance-mode" style="width: 100vw; height: 100vh; position: relative; background: #000;">
            <div class="dance-finished-overlay">
              <h2 class="dance-finished-title">Dance Complete!</h2>
              <div class="dance-final-score">1800</div>
              <div class="dance-final-score-label">points</div>
              <div class="dance-final-hits">6 / 10 poses hit</div>
            </div>
          </div>
        `
      })
      await expect(page).toHaveScreenshot('dance-finished.png', {
        fullPage: true,
      })
    })
  })

  test.describe('Results screen', () => {
    test('results screen', async ({ page }) => {
      await goToHome(page)
      await page.evaluate(() => {
        const app = document.querySelector('.app')!
        app.innerHTML = `
          <div class="results-screen" style="margin: 40px auto;">
            <div class="results-header">
              <h2>Dance Complete!</h2>
              <p class="results-dance-name">Sample Dance</p>
            </div>
            <div class="results-score-section">
              <div class="results-rank" style="color: #00ccff">A</div>
              <div class="results-percentage">72%</div>
              <p class="results-message">Great job! Keep it up!</p>
            </div>
            <div class="results-timeline">
              <h3>Performance Timeline</h3>
              <div class="timeline-bar">
                <div class="timeline-segment" style="flex: 10; background-color: #00ff88;"><span class="timeline-segment-label">85%</span></div>
                <div class="timeline-segment" style="flex: 10; background-color: #ffcc00;"><span class="timeline-segment-label">60%</span></div>
                <div class="timeline-segment" style="flex: 10; background-color: #ff6b6b;"><span class="timeline-segment-label">35%</span></div>
              </div>
            </div>
            <div class="results-actions">
              <button class="results-btn results-btn-retry">Try Again</button>
              <button class="results-btn results-btn-replay">Watch Replay</button>
              <button class="results-btn results-btn-home">Home</button>
            </div>
          </div>
        `
      })
      await expect(page).toHaveScreenshot('results-screen.png', {
        fullPage: true,
      })
    })
  })

  test.describe('Replay mode', () => {
    test('replay mode', async ({ page }) => {
      await goToHome(page)
      await page.evaluate(() => {
        const app = document.querySelector('.app')!
        app.innerHTML = `
          <div class="replay-mode" style="margin: 20px auto;">
            <div class="replay-header">
              <button class="replay-back-btn">Back</button>
              <div class="replay-meta">
                <span class="replay-date">3/14/2026</span>
                <span class="replay-score">85%</span>
                <span class="replay-rank" style="color: #00ff88">S</span>
              </div>
            </div>
            <div class="replay-videos">
              <div class="replay-video-panel">
                <div class="replay-video-label">REFERENCE</div>
                <div class="replay-video-placeholder" style="aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center; color: #666;">Reference video</div>
              </div>
              <div class="replay-video-panel">
                <div class="replay-video-label">YOUR PERFORMANCE</div>
                <div class="replay-video-placeholder" style="aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center; color: #666;">Your recording</div>
              </div>
            </div>
            <div class="replay-timeline-container">
              <div class="replay-timeline">
                <div class="replay-timeline-segment" style="flex: 10; background-color: #00ff88"></div>
                <div class="replay-timeline-segment" style="flex: 10; background-color: #ffcc00"></div>
                <div class="replay-timeline-segment" style="flex: 10; background-color: #00ff88"></div>
                <div class="replay-playhead" style="left: 33%"></div>
              </div>
              <div class="replay-time-display">0:10 / 0:30</div>
            </div>
            <div class="replay-controls">
              <button class="replay-play-btn">Play</button>
              <div class="replay-speed-controls">
                <button class="replay-speed-btn">0.5x</button>
                <button class="replay-speed-btn active">1x</button>
                <button class="replay-speed-btn">1.5x</button>
                <button class="replay-speed-btn">2x</button>
              </div>
            </div>
          </div>
        `
      })
      await expect(page).toHaveScreenshot('replay-mode.png', {
        fullPage: true,
      })
    })
  })

  test.describe('Practice mode', () => {
    test('practice mode playing', async ({ page }) => {
      await goToHome(page)
      await page.evaluate(() => {
        const app = document.querySelector('.app')!
        app.innerHTML = `
          <div class="practice-mode" style="width: 100vw; height: 100vh; position: relative; background: #000;">
            <div class="practice-badge">PRACTICE MODE</div>
            <div class="dance-reference" style="width: 100%; height: 70%; background: #111;"></div>
            <div class="practice-scrubber-container">
              <div class="practice-scrubber">
                <div class="practice-scrubber-track">
                  <div class="practice-scrubber-fill" style="width: 45%"></div>
                  <div class="practice-scrubber-marker" style="left: 20%"></div>
                  <div class="practice-scrubber-marker" style="left: 60%"></div>
                  <div class="practice-scrubber-handle" style="left: 45%"></div>
                </div>
              </div>
              <div class="practice-scrubber-time">0:14 / 0:30</div>
            </div>
            <button class="practice-back-btn">Back</button>
            <button class="practice-pause-btn">Pause</button>
            <button class="practice-ghost-toggle active">Ghost ON</button>
          </div>
        `
      })
      await expect(page).toHaveScreenshot('practice-playing.png', {
        fullPage: true,
      })
    })

    test('practice mode paused', async ({ page }) => {
      await goToHome(page)
      await page.evaluate(() => {
        const app = document.querySelector('.app')!
        app.innerHTML = `
          <div class="practice-mode" style="width: 100vw; height: 100vh; position: relative; background: #000;">
            <div class="practice-badge">PRACTICE MODE</div>
            <div class="practice-paused-overlay">
              <div class="practice-paused-text">PAUSED</div>
              <div class="practice-paused-hint">Study the current pose</div>
              <button class="practice-resume-btn">Resume</button>
              <div class="practice-paused-shortcut">or press Space</div>
            </div>
          </div>
        `
      })
      await expect(page).toHaveScreenshot('practice-paused.png', {
        fullPage: true,
      })
    })
  })
})

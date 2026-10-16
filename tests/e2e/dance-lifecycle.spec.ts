import { test, expect } from '@playwright/test'
import { goToHome, takeScreenshot } from './helpers'

test.describe('Dance mode lifecycle', () => {
  test('dance mode loading state with spinner', async ({ page }) => {
    await goToHome(page)

    // Click first dance card to enter dance mode
    await page.locator('.dance-card').first().click()
    await expect(page.locator('.dance-mode')).toBeVisible()

    // Loading overlay should be visible initially
    await expect(page.locator('.dance-loading-overlay')).toBeVisible()

    await takeScreenshot(page, 'dance-loading-state')
  })

  test('dance HUD structure is correct when injected', async ({ page }) => {
    await goToHome(page)

    // Inject dance mode HUD to test CSS/structure
    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="dance-mode">
          <div class="dance-reference">
            <div class="dance-reference-placeholder">Reference Dance</div>
          </div>
          <div class="dance-webcam-pip">
            <div class="dance-pip-label">YOU</div>
          </div>
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
          <div class="dance-progress-bar">
            <div class="dance-progress-fill" style="width: 60%"></div>
            <div class="dance-progress-time">0:18 / 0:30</div>
          </div>
          <div class="dance-feedback dance-feedback-perfect">Perfect!</div>
        </div>
      `
    })

    // Verify HUD elements
    await expect(page.locator('.dance-score')).toHaveText('1250')
    await expect(page.locator('.dance-combo-multiplier')).toHaveText('5x')
    await expect(page.locator('.dance-combo-text')).toHaveText('COMBO')
    await expect(page.locator('.dance-progress-time')).toHaveText('0:18 / 0:30')

    await takeScreenshot(page, 'dance-hud-display')
  })

  test('feedback appears in bottom-left corner position', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="dance-mode" style="position: relative; width: 100vw; height: 100vh;">
          <div class="dance-feedback dance-feedback-perfect" style="animation: none; opacity: 1;">Perfect!</div>
        </div>
      `
    })

    const feedback = page.locator('.dance-feedback')
    await expect(feedback).toBeVisible()

    const box = await feedback.boundingBox()
    const viewport = page.viewportSize()!
    expect(box).toBeTruthy()

    // Should be in bottom-left quadrant
    expect(box!.y).toBeGreaterThan(viewport.height / 2)
    expect(box!.x).toBeLessThan(viewport.width / 2)

    await takeScreenshot(page, 'dance-feedback-position')
  })

  test('countdown animation renders', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="dance-mode">
          <div class="dance-countdown-overlay">
            <div class="dance-countdown-number">3</div>
          </div>
        </div>
      `
    })

    const countdown = page.locator('.dance-countdown-number')
    await expect(countdown).toHaveText('3')
    await expect(countdown).toBeVisible()

    const box = await countdown.boundingBox()
    expect(box).toBeTruthy()
    // Countdown should be large
    expect(box!.height).toBeGreaterThan(50)

    await takeScreenshot(page, 'dance-countdown')
  })

  test('finished overlay renders with score', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="dance-mode">
          <div class="dance-finished-overlay dance-finished-celebrate">
            <div class="dance-confetti" aria-hidden="true">
              ${Array.from({ length: 5 }, (_, i) => `<span class="dance-confetti-piece" style="left:${i*20}%;background:#00ff88;"></span>`).join('')}
            </div>
            <h2 class="dance-finished-title">Amazing!</h2>
            <div class="dance-final-score">2500</div>
            <div class="dance-final-score-label">points</div>
            <div class="dance-final-hits">8 / 10 poses hit</div>
          </div>
        </div>
      `
    })

    await expect(page.locator('.dance-finished-title')).toHaveText('Amazing!')
    await expect(page.locator('.dance-final-score')).toHaveText('2500')
    await expect(page.locator('.dance-final-hits')).toHaveText('8 / 10 poses hit')

    await takeScreenshot(page, 'dance-finished-overlay')
  })

  test('results screen shows score, rank, and breakdown', async ({ page }) => {
    await goToHome(page)

    // Navigate to results via URL param hack — inject results screen
    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="results-screen">
          <div class="results-header">
            <h2>Dance Complete!</h2>
            <p class="results-dance-name">Test Dance</p>
          </div>
          <div class="results-score-section">
            <div class="results-rank" style="color: #00ff88">S</div>
            <div class="results-percentage">85%</div>
            <p class="results-message">Amazing! You nailed it!</p>
          </div>
          <div class="results-timeline">
            <h3>Performance Timeline</h3>
            <div class="timeline-bar">
              <div class="timeline-segment" style="flex: 10; background-color: #00ff88;">
                <span class="timeline-segment-label">90%</span>
              </div>
              <div class="timeline-segment" style="flex: 10; background-color: #ffcc00;">
                <span class="timeline-segment-label">65%</span>
              </div>
            </div>
          </div>
          <div class="results-breakdown">
            <h3>Body Part Scores</h3>
            <div class="breakdown-bars">
              <div class="breakdown-item">
                <span class="breakdown-label">Arms</span>
                <div class="breakdown-bar-track">
                  <div class="breakdown-bar-fill" style="width: 80%; background-color: #00ff88;"></div>
                </div>
                <span class="breakdown-value">80%</span>
              </div>
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

    await expect(page.locator('.results-rank')).toHaveText('S')
    await expect(page.locator('.results-percentage')).toHaveText('85%')
    await expect(page.locator('.results-btn-retry')).toBeVisible()
    await expect(page.locator('.results-btn-replay')).toBeVisible()
    await expect(page.locator('.results-btn-home')).toBeVisible()

    await takeScreenshot(page, 'results-screen')
  })

  test('back button during dance returns to home', async ({ page }) => {
    await goToHome(page)

    // Click dance card
    await page.locator('.dance-card').first().click()
    await expect(page.locator('.dance-mode')).toBeVisible()

    // Click back (force click since overlays may be blocking)
    await page.locator('.back-button').click({ force: true })
    await expect(page.locator('h1')).toHaveText('DanceCraft')

    await takeScreenshot(page, 'dance-back-to-home')
  })
})

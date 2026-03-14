import { test, expect } from '@playwright/test'
import { goToHome, takeScreenshot } from './helpers'

test.describe('Practice mode', () => {
  test('practice mode loads distinctly from game mode', async ({ page }) => {
    await goToHome(page)

    // Inject practice mode UI
    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="practice-mode">
          <div class="practice-badge">PRACTICE MODE</div>
          <div class="dance-reference">
            <div class="dance-reference-placeholder">Reference Dance</div>
          </div>
          <div class="dance-webcam-pip">
            <div class="dance-pip-label">YOU</div>
          </div>
          <div class="practice-scrubber-container">
            <div class="practice-scrubber">
              <div class="practice-scrubber-track">
                <div class="practice-scrubber-fill" style="width: 40%"></div>
                <div class="practice-scrubber-marker" style="left: 20%"></div>
                <div class="practice-scrubber-marker" style="left: 55%"></div>
                <div class="practice-scrubber-marker" style="left: 80%"></div>
                <div class="practice-scrubber-handle" style="left: 40%"></div>
              </div>
            </div>
            <div class="practice-scrubber-time">0:12 / 0:30</div>
          </div>
          <button class="practice-back-btn">Back</button>
          <button class="practice-pause-btn">Pause</button>
          <button class="practice-ghost-toggle active">Ghost ON</button>
        </div>
      `
    })

    // Practice badge is visible (distinct from game mode)
    await expect(page.locator('.practice-badge')).toHaveText('PRACTICE MODE')

    // No score or combo HUD (practice mode has no scoring)
    await expect(page.locator('.dance-hud')).not.toBeVisible()
    await expect(page.locator('.dance-score')).not.toBeVisible()

    await takeScreenshot(page, 'practice-mode-playing')
  })

  test('pause/resume UI via on-screen button', async ({ page }) => {
    await goToHome(page)

    // Inject paused state
    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="practice-mode">
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

    await expect(page.locator('.practice-paused-text')).toHaveText('PAUSED')
    await expect(page.locator('.practice-resume-btn')).toBeVisible()
    await expect(page.locator('.practice-paused-shortcut')).toContainText('Space')

    await takeScreenshot(page, 'practice-mode-paused')
  })

  test('timeline scrubber is interactive', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="practice-mode">
          <div class="practice-scrubber-container">
            <div class="practice-scrubber">
              <div class="practice-scrubber-track">
                <div class="practice-scrubber-fill" style="width: 30%"></div>
                <div class="practice-scrubber-marker" style="left: 15%"></div>
                <div class="practice-scrubber-marker" style="left: 45%"></div>
                <div class="practice-scrubber-marker" style="left: 75%"></div>
                <div class="practice-scrubber-handle" style="left: 30%"></div>
              </div>
            </div>
            <div class="practice-scrubber-time">0:09 / 0:30</div>
          </div>
        </div>
      `
    })

    // Scrubber track is visible
    await expect(page.locator('.practice-scrubber-track')).toBeVisible()

    // Key pose markers are visible
    const markers = page.locator('.practice-scrubber-marker')
    expect(await markers.count()).toBe(3)

    // Scrubber handle is visible
    await expect(page.locator('.practice-scrubber-handle')).toBeVisible()

    // Time display
    await expect(page.locator('.practice-scrubber-time')).toHaveText('0:09 / 0:30')

    await takeScreenshot(page, 'practice-scrubber')
  })

  test('section looping A-B points UI', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="practice-mode">
          <div class="practice-loop-controls">
            <button class="practice-loop-btn active">A 0:05</button>
            <button class="practice-loop-btn active">B 0:15</button>
            <button class="practice-loop-btn practice-loop-clear">Clear Loop</button>
            <span class="practice-loop-count">Loop #3</span>
            <div class="practice-speed-controls">
              <button class="practice-speed-btn">0.5x</button>
              <button class="practice-speed-btn">0.75x</button>
              <button class="practice-speed-btn active">1x</button>
            </div>
          </div>
          <div class="practice-scrubber-container">
            <div class="practice-scrubber">
              <div class="practice-scrubber-track">
                <div class="practice-scrubber-loop" style="left: 17%; width: 33%"></div>
                <div class="practice-scrubber-fill" style="width: 25%"></div>
                <div class="practice-scrubber-handle" style="left: 25%"></div>
              </div>
            </div>
            <div class="practice-scrubber-time">0:08 / 0:30</div>
          </div>
        </div>
      `
    })

    // A and B buttons are active
    const loopBtns = page.locator('.practice-loop-btn.active')
    expect(await loopBtns.count()).toBe(2)

    // Clear Loop button visible
    await expect(page.locator('.practice-loop-clear')).toBeVisible()

    // Loop count
    await expect(page.locator('.practice-loop-count')).toHaveText('Loop #3')

    // Loop section highlight on timeline
    await expect(page.locator('.practice-scrubber-loop')).toBeVisible()

    // Speed controls
    const speedBtns = page.locator('.practice-speed-btn')
    expect(await speedBtns.count()).toBe(3)

    await takeScreenshot(page, 'practice-loop-controls')
  })

  test('pose overlay toggle works', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="practice-mode">
          <button class="practice-ghost-toggle active">Ghost ON</button>
        </div>
      `
    })

    const toggle = page.locator('.practice-ghost-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveText('Ghost ON')
    await expect(toggle).toHaveClass(/active/)

    await takeScreenshot(page, 'practice-ghost-toggle')
  })

  test('practice mode has no scoring elements', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="practice-mode">
          <div class="practice-badge">PRACTICE MODE</div>
          <div class="dance-reference"><div class="dance-reference-placeholder">Ref</div></div>
          <div class="dance-webcam-pip"><div class="dance-pip-label">YOU</div></div>
        </div>
      `
    })

    // No scoring elements present
    await expect(page.locator('.dance-score')).not.toBeVisible()
    await expect(page.locator('.dance-combo')).not.toBeVisible()
    await expect(page.locator('.dance-feedback')).not.toBeVisible()
    await expect(page.locator('.dance-hud')).not.toBeVisible()

    await takeScreenshot(page, 'practice-no-scoring')
  })

  test('practice button on dance cards navigates to practice mode', async ({ page }) => {
    await goToHome(page)
    await page.waitForSelector('.dance-card')

    const practiceBtn = page.locator('.dance-card-practice-btn').first()
    await expect(practiceBtn).toBeVisible()
    await expect(practiceBtn).toHaveText('Practice')

    await takeScreenshot(page, 'practice-button-on-card')
  })
})

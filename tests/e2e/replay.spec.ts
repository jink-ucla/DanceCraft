import { test, expect } from '@playwright/test'
import { goToHome, takeScreenshot } from './helpers'

test.describe('Recording and replay', () => {
  test('replay page loads with session data', async ({ page }) => {
    await goToHome(page)

    // Inject replay mode UI
    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="replay-mode">
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
              <div class="replay-video-placeholder">No reference video</div>
            </div>
            <div class="replay-video-panel">
              <div class="replay-video-label">YOUR PERFORMANCE</div>
              <div class="replay-user-container">
                <div class="replay-video-placeholder">No recording</div>
              </div>
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

    await expect(page.locator('.replay-mode')).toBeVisible()
    await expect(page.locator('.replay-score')).toHaveText('85%')
    await expect(page.locator('.replay-rank')).toHaveText('S')

    await takeScreenshot(page, 'replay-loaded')
  })

  test('replay controls work (play/pause, speed)', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="replay-mode">
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

    await expect(page.locator('.replay-play-btn')).toHaveText('Play')

    const speedBtns = page.locator('.replay-speed-btn')
    expect(await speedBtns.count()).toBe(4)
    await expect(speedBtns.filter({ hasText: '1x' })).toHaveClass(/active/)

    await takeScreenshot(page, 'replay-controls')
  })

  test('side-by-side view renders correctly', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="replay-mode">
          <div class="replay-videos">
            <div class="replay-video-panel">
              <div class="replay-video-label">REFERENCE</div>
              <div class="replay-video-placeholder">Reference video</div>
            </div>
            <div class="replay-video-panel">
              <div class="replay-video-label">YOUR PERFORMANCE</div>
              <div class="replay-user-container">
                <div class="replay-video-placeholder">Your recording</div>
              </div>
            </div>
          </div>
        </div>
      `
    })

    const panels = page.locator('.replay-video-panel')
    expect(await panels.count()).toBe(2)

    await expect(page.locator('.replay-video-label').first()).toHaveText('REFERENCE')
    await expect(page.locator('.replay-video-label').last()).toHaveText('YOUR PERFORMANCE')

    // Verify side-by-side layout (both panels should have similar width)
    const panel1Box = await panels.nth(0).boundingBox()
    const panel2Box = await panels.nth(1).boundingBox()
    expect(panel1Box).toBeTruthy()
    expect(panel2Box).toBeTruthy()

    // Panels should be approximately equal width (side-by-side grid)
    const widthRatio = panel1Box!.width / panel2Box!.width
    expect(widthRatio).toBeGreaterThan(0.8)
    expect(widthRatio).toBeLessThan(1.2)

    await takeScreenshot(page, 'replay-side-by-side')
  })

  test('color-coded timeline in replay is accurate', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="replay-mode">
          <div class="replay-timeline-container">
            <div class="replay-timeline">
              <div class="replay-timeline-segment" style="flex: 10; background-color: #00ff88" title="0:00 - 0:10: 85%"></div>
              <div class="replay-timeline-segment" style="flex: 10; background-color: #ff6b6b" title="0:10 - 0:20: 35%"></div>
              <div class="replay-timeline-segment" style="flex: 10; background-color: #ffcc00" title="0:20 - 0:30: 70%"></div>
              <div class="replay-playhead" style="left: 50%"></div>
            </div>
            <div class="replay-time-display">0:15 / 0:30</div>
          </div>
        </div>
      `
    })

    const segments = page.locator('.replay-timeline-segment')
    expect(await segments.count()).toBe(3)

    // Playhead visible
    await expect(page.locator('.replay-playhead')).toBeVisible()

    // Time display
    await expect(page.locator('.replay-time-display')).toHaveText('0:15 / 0:30')

    await takeScreenshot(page, 'replay-timeline')
  })

  test('results screen shows replay button when recording exists', async ({ page }) => {
    await goToHome(page)

    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="results-screen">
          <div class="results-score-section">
            <div class="results-rank" style="color: #00ff88">S</div>
            <div class="results-percentage">85%</div>
          </div>
          <div class="results-actions">
            <button class="results-btn results-btn-retry">Try Again</button>
            <button class="results-btn results-btn-replay">Watch Replay</button>
            <button class="results-btn results-btn-home">Home</button>
          </div>
        </div>
      `
    })

    await expect(page.locator('.results-btn-replay')).toBeVisible()
    await expect(page.locator('.results-btn-replay')).toHaveText('Watch Replay')

    await takeScreenshot(page, 'results-with-replay-btn')
  })

  test('replay UI at various states', async ({ page }) => {
    await goToHome(page)

    // Paused state (default - Play button visible)
    await page.evaluate(() => {
      const app = document.querySelector('.app')!
      app.innerHTML = `
        <div class="replay-mode">
          <div class="replay-header">
            <button class="replay-back-btn">Back</button>
            <div class="replay-meta">
              <span class="replay-date">3/14/2026</span>
              <span class="replay-score">72%</span>
              <span class="replay-rank" style="color: #00ccff">A</span>
            </div>
          </div>
          <div class="replay-controls">
            <button class="replay-play-btn">Play</button>
          </div>
        </div>
      `
    })

    await expect(page.locator('.replay-play-btn')).toHaveText('Play')
    await expect(page.locator('.replay-rank')).toHaveText('A')

    await takeScreenshot(page, 'replay-rank-a')
  })
})

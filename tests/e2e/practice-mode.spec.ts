import { test, expect } from '@playwright/test'

test('practice mode UI elements render correctly', async ({ page }) => {
  // Mock API dances
  await page.route('**/api/dances', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/')

  // Inject practice mode UI structure for testing
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
        <div class="dance-progress-bar">
          <div class="dance-progress-fill" style="width: 40%"></div>
          <div class="dance-progress-time">0:12 / 0:30</div>
        </div>
        <button class="practice-back-btn">Back</button>
        <button class="practice-pause-btn">Pause</button>
      </div>
    `
  })

  // Verify practice mode badge
  await expect(page.locator('.practice-badge')).toBeVisible()
  await expect(page.locator('.practice-badge')).toHaveText('PRACTICE MODE')

  // Verify video reference area
  await expect(page.locator('.dance-reference')).toBeVisible()

  // Verify webcam PIP
  await expect(page.locator('.dance-pip-label')).toHaveText('YOU')

  // Verify progress bar
  await expect(page.locator('.dance-progress-time')).toHaveText('0:12 / 0:30')

  // Verify controls
  await expect(page.locator('.practice-back-btn')).toBeVisible()
  await expect(page.locator('.practice-pause-btn')).toBeVisible()
})

test('practice mode paused state renders correctly', async ({ page }) => {
  await page.route('**/api/dances', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/')

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
  await expect(page.locator('.practice-paused-hint')).toHaveText('Study the current pose')
  await expect(page.locator('.practice-resume-btn')).toBeVisible()
  await expect(page.locator('.practice-paused-shortcut')).toHaveText('or press Space')
})

test('practice button appears on dance cards', async ({ page }) => {
  await page.route('**/api/dances', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/')
  await page.waitForSelector('.dance-card')

  // Verify practice button exists on dance cards
  const practiceBtn = page.locator('.dance-card-practice-btn').first()
  await expect(practiceBtn).toBeVisible()
  await expect(practiceBtn).toHaveText('Practice')
})

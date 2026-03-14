import { test, expect } from '@playwright/test'

test('feedback displays in bottom-left corner, not center', async ({ page }) => {
  // Mock API to return empty so bundled dances load quickly
  await page.route('**/api/dances', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.goto('/')
  await page.locator('.dance-card').first().click()
  await expect(page.locator('.dance-mode')).toBeVisible()

  // Inject a feedback element to verify positioning via CSS
  await page.evaluate(() => {
    const container = document.querySelector('.dance-mode')!
    const fb = document.createElement('div')
    fb.className = 'dance-feedback dance-feedback-perfect'
    fb.textContent = 'Perfect!'
    container.appendChild(fb)
  })

  const feedback = page.locator('.dance-feedback')
  await expect(feedback).toBeVisible()

  // Verify it's positioned in the bottom-left (not centered)
  const box = await feedback.boundingBox()
  const containerBox = await page.locator('.dance-mode').boundingBox()
  expect(box).not.toBeNull()
  expect(containerBox).not.toBeNull()

  // Feedback should be in the bottom portion (bottom 40%) and left portion (left 40%)
  const relativeBottom = containerBox!.y + containerBox!.height - (box!.y + box!.height)
  const relativeLeft = box!.x - containerBox!.x
  expect(relativeBottom).toBeLessThan(containerBox!.height * 0.4)
  expect(relativeLeft).toBeLessThan(containerBox!.width * 0.4)

  // Take a screenshot for visual verification
  await page.locator('.dance-mode').screenshot({ path: 'tests/e2e/screenshots/feedback-position.png' })
})

test('clicking dance card navigates to dance mode', async ({ page }) => {
  await page.route('**/api/dances', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.goto('/')

  // Click the first dance card
  const danceCard = page.locator('.dance-card').first()
  await expect(danceCard).toBeVisible()
  await danceCard.click()

  // Dance mode container should be visible
  const danceMode = page.locator('.dance-mode')
  await expect(danceMode).toBeVisible()

  // Webcam PIP area should be present
  const pip = page.locator('.dance-webcam-pip')
  await expect(pip).toBeVisible()

  // Back button should work
  const backButton = page.getByText('Back')
  await expect(backButton).toBeVisible()
  await backButton.click()

  // Should be back on home page
  await expect(page.locator('.home-screen')).toBeVisible()
})

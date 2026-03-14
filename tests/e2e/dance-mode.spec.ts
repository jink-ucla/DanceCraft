import { test, expect } from '@playwright/test'

test('dance mode loads with video player and webcam area', async ({ page }) => {
  await page.goto('/')

  // Click start dancing button
  const startButton = page.getByText('Start Dancing')
  await expect(startButton).toBeVisible()
  await startButton.click()

  // Dance mode container should be visible
  const danceMode = page.locator('.dance-mode')
  await expect(danceMode).toBeVisible()

  // Reference area should be present
  const reference = page.locator('.dance-reference')
  await expect(reference).toBeVisible()

  // Webcam PIP area should be present
  const pip = page.locator('.dance-webcam-pip')
  await expect(pip).toBeVisible()

  // Should have a video element for webcam
  const video = page.locator('.dance-webcam-pip video')
  await expect(video).toBeVisible()

  // Back button should work
  const backButton = page.getByText('Back')
  await expect(backButton).toBeVisible()
  await backButton.click()

  // Should be back on home page
  await expect(page.getByText('Groovy')).toBeVisible()
})

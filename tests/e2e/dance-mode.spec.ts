import { test, expect } from '@playwright/test'

test('clicking dance card navigates to dance mode', async ({ page }) => {
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

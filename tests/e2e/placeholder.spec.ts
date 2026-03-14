import { test, expect } from '@playwright/test'

test('homepage loads with dance cards', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Groovy/)

  // Home screen should show
  const homeScreen = page.locator('.home-screen')
  await expect(homeScreen).toBeVisible()

  // Should have at least one dance card
  const danceCard = page.locator('.dance-card').first()
  await expect(danceCard).toBeVisible()

  // Should show the sample dance
  await expect(page.getByText('Sample Dance')).toBeVisible()
})

import { test, expect } from '@playwright/test'

test('homepage loads with dance cards', async ({ page }) => {
  // Mock API to return empty (so bundled dances are shown via fallback)
  await page.route('**/api/dances', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  await page.goto('/')
  await expect(page).toHaveTitle(/Groovy/)

  // Home screen should show
  const homeScreen = page.locator('.home-screen')
  await expect(homeScreen).toBeVisible()

  // Should have at least one dance card (bundled)
  const danceCard = page.locator('.dance-card').first()
  await expect(danceCard).toBeVisible()

  // Should show the sample dance
  await expect(page.getByText('Sample Dance')).toBeVisible()
})

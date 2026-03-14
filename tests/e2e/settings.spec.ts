import { test, expect } from '@playwright/test'

test('settings page loads and webcam dropdown populates', async ({ page }) => {
  await page.route('**/api/dances', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.goto('/')

  // Click settings button from home screen
  const settingsBtn = page.getByText('Settings')
  await expect(settingsBtn).toBeVisible()
  await settingsBtn.click()

  // Settings screen should be visible
  const settingsScreen = page.locator('.settings-screen')
  await expect(settingsScreen).toBeVisible()

  // Should have camera dropdown
  const cameraSelect = page.locator('.settings-select')
  await expect(cameraSelect).toBeVisible()

  // Should have sensitivity radio buttons
  await expect(page.getByText('Easy')).toBeVisible()
  await expect(page.getByText('Normal')).toBeVisible()
  await expect(page.getByText('Hard')).toBeVisible()

  // Should have mirror mode checkbox
  await expect(page.getByText('Mirror mode')).toBeVisible()

  // Back button should work
  const backBtn = page.locator('.settings-back-btn')
  await expect(backBtn).toBeVisible()
  await backBtn.click()

  // Should be back on home page
  await expect(page.locator('.home-screen')).toBeVisible()
})

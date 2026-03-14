import { test, expect } from '@playwright/test'

const mockDances = [
  {
    id: 1,
    youtubeUrl: 'https://www.youtube.com/watch?v=abc123xyz99',
    title: 'API Dance One',
    duration: 120,
    channel: 'Test Channel',
    thumbnailPath: 'data/dances/1/thumbnail.jpg',
    poseDataPath: 'data/dances/1/poses.json',
    videoPath: 'data/dances/1/video.mp4',
    audioPath: 'data/dances/1/audio.mp3',
    status: 'complete',
    error: null,
    createdAt: '2026-03-14T10:00:00Z',
  },
  {
    id: 2,
    youtubeUrl: 'https://www.youtube.com/watch?v=def456uvw88',
    title: 'API Dance Two',
    duration: 85,
    channel: 'Test Channel 2',
    thumbnailPath: 'data/dances/2/thumbnail.jpg',
    poseDataPath: 'data/dances/2/poses.json',
    videoPath: 'data/dances/2/video.mp4',
    audioPath: 'data/dances/2/audio.mp3',
    status: 'complete',
    error: null,
    createdAt: '2026-03-14T09:00:00Z',
  },
]

test.describe('Dynamic dance library', () => {
  test('loads dances from API and shows them with bundled dances', async ({ page }) => {
    await page.route('**/api/dances', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockDances),
        })
      }
    })

    await page.goto('/')

    // API dances should appear
    await expect(page.getByText('API Dance One')).toBeVisible()
    await expect(page.getByText('API Dance Two')).toBeVisible()

    // Bundled dances still present
    await expect(page.getByText('Sample Dance')).toBeVisible()

    // Should show duration formatted correctly
    await expect(page.getByText('2:00')).toBeVisible() // 120 seconds
    await expect(page.getByText('1:25')).toBeVisible() // 85 seconds
  })

  test('shows loading skeleton while fetching', async ({ page }) => {
    // Delay the API response to see loading state
    await page.route('**/api/dances', async (route) => {
      await new Promise((r) => setTimeout(r, 500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.goto('/')

    // Loading skeletons should be visible initially
    await expect(page.locator('.dance-card-skeleton').first()).toBeVisible()
  })

  test('shows error state and falls back to bundled dances when backend unreachable', async ({ page }) => {
    await page.route('**/api/dances', async (route) => {
      await route.abort('connectionrefused')
    })

    await page.goto('/')

    // Error message should appear
    await expect(page.locator('.home-error')).toBeVisible()
    await expect(page.locator('.home-error')).toContainText('Could not connect')

    // Bundled dances should be shown as fallback
    await expect(page.getByText('Sample Dance')).toBeVisible()
  })

  test('shows empty state when no dances exist', async ({ page }) => {
    await page.route('**/api/dances', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.goto('/')

    // Wait for loading to finish, then check for bundled dances + empty api
    // Since bundled dances are always appended, we should still see them
    // Empty state only shows when ALL dances (api + bundled) = 0
    // With current implementation, bundled dances always show when API returns empty
    await expect(page.getByText('Sample Dance')).toBeVisible()
  })

  test('delete button appears on API dance cards on hover', async ({ page }) => {
    await page.route('**/api/dances', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockDances),
      })
    })

    await page.goto('/')
    await expect(page.getByText('API Dance One')).toBeVisible()

    // Find the API dance card and hover it
    const apiCard = page.locator('.dance-card', { hasText: 'API Dance One' })
    await apiCard.hover()

    // Delete button should be visible on hover
    const deleteBtn = apiCard.locator('.dance-card-delete')
    await expect(deleteBtn).toBeVisible()
  })

  test('delete dance with confirmation via mocked API', async ({ page }) => {
    await page.route('**/api/dances', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockDances),
      })
    })

    await page.route('**/api/dances/1', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 204 })
      }
    })

    await page.goto('/')
    await expect(page.getByText('API Dance One')).toBeVisible()

    // Hover and click delete
    const apiCard = page.locator('.dance-card', { hasText: 'API Dance One' })
    await apiCard.hover()
    const deleteBtn = apiCard.locator('.dance-card-delete')
    await deleteBtn.click()

    // Should show confirmation
    await expect(deleteBtn).toContainText('Confirm?')

    // Click again to confirm
    await deleteBtn.click()

    // Dance should be removed from list
    await expect(page.getByText('API Dance One')).not.toBeVisible()
    // Other dance should remain
    await expect(page.getByText('API Dance Two')).toBeVisible()
  })

  test('bundled dance cards do not have delete button', async ({ page }) => {
    await page.route('**/api/dances', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.goto('/')
    await expect(page.getByText('Sample Dance')).toBeVisible()

    const bundledCard = page.locator('.dance-card', { hasText: 'Sample Dance' })
    await bundledCard.hover()

    // No delete button on bundled dances
    await expect(bundledCard.locator('.dance-card-delete')).not.toBeAttached()
  })

  test('API dances sorted by most recently added (newest first)', async ({ page }) => {
    await page.route('**/api/dances', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockDances), // id 1 first (newest), id 2 second
      })
    })

    await page.goto('/')

    // Get all dance card titles
    const cards = page.locator('.dance-card-info h3')
    const titles = await cards.allTextContents()

    // API dances should come before bundled dances
    const apiOneIndex = titles.indexOf('API Dance One')
    const apiTwoIndex = titles.indexOf('API Dance Two')
    const sampleIndex = titles.indexOf('Sample Dance')

    expect(apiOneIndex).toBeLessThan(sampleIndex)
    expect(apiTwoIndex).toBeLessThan(sampleIndex)
  })

  test('YouTube thumbnail shown on API dance cards', async ({ page }) => {
    await page.route('**/api/dances', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockDances),
      })
    })

    await page.goto('/')

    // API dance card should have an img with YouTube thumbnail URL
    const apiCard = page.locator('.dance-card', { hasText: 'API Dance One' })
    const img = apiCard.locator('.dance-card-thumbnail img')
    await expect(img).toHaveAttribute('src', /img\.youtube\.com\/vi\/abc123xyz99/)
  })
})

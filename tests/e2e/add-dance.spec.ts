import { test, expect } from '@playwright/test'

test.describe('Add Dance flow', () => {
  test('opens add dance modal from home screen', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('+ Add Dance')).toBeVisible()

    await page.getByText('+ Add Dance').click()
    await expect(page.locator('.add-dance-modal')).toBeVisible()
    await expect(page.locator('.add-dance-title')).toHaveText('Add Dance')
  })

  test('validates YouTube URL input', async ({ page }) => {
    await page.goto('/')
    await page.getByText('+ Add Dance').click()

    const input = page.locator('.add-dance-input')
    const submitBtn = page.locator('.add-dance-submit')

    // Submit button should be disabled initially
    await expect(submitBtn).toBeDisabled()

    // Invalid URL shows validation message
    await input.fill('not-a-url')
    await expect(page.locator('.add-dance-validation')).toBeVisible()
    await expect(submitBtn).toBeDisabled()

    // Valid YouTube URL enables submit
    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await expect(page.locator('.add-dance-validation')).not.toBeVisible()
    await expect(submitBtn).toBeEnabled()
  })

  test('closes modal via close button', async ({ page }) => {
    await page.goto('/')
    await page.getByText('+ Add Dance').click()
    await expect(page.locator('.add-dance-modal')).toBeVisible()

    await page.locator('.add-dance-close').click()
    await expect(page.locator('.add-dance-modal')).not.toBeVisible()
  })

  test('closes modal via backdrop click', async ({ page }) => {
    await page.goto('/')
    await page.getByText('+ Add Dance').click()
    await expect(page.locator('.add-dance-modal')).toBeVisible()

    // Click the backdrop (outside the modal)
    await page.locator('.add-dance-backdrop').click({ position: { x: 10, y: 10 } })
    await expect(page.locator('.add-dance-modal')).not.toBeVisible()
  })

  test('shows processing state with mocked API', async ({ page }) => {
    // Mock the process endpoint
    await page.route('**/api/dances/process', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          jobId: 'test_job_1',
          status: 'queued',
          message: 'Processing started.',
        }),
      })
    })

    // Mock the job status endpoint - return processing then complete
    let pollCount = 0
    await page.route('**/api/dances/jobs/test_job_1', async (route) => {
      pollCount++
      if (pollCount >= 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'test_job_1',
            status: 'complete',
            metadata: { title: 'Test Dance Video' },
          }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'test_job_1',
            status: 'downloading',
            progress: 'Downloading video...',
          }),
        })
      }
    })

    await page.goto('/')
    await page.getByText('+ Add Dance').click()

    const input = page.locator('.add-dance-input')
    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await page.locator('.add-dance-submit').click()

    // Should show processing state
    await expect(page.locator('.add-dance-spinner')).toBeVisible()
    await expect(page.locator('.add-dance-hint')).toBeVisible()

    // Should eventually show success
    await expect(page.locator('.add-dance-check')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.add-dance-success-text')).toContainText('Test Dance Video')
  })

  test('shows error state with mocked API error', async ({ page }) => {
    await page.route('**/api/dances/process', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Invalid YouTube URL. Please provide a valid youtube.com or youtu.be link.',
        }),
      })
    })

    await page.goto('/')
    await page.getByText('+ Add Dance').click()

    await page.locator('.add-dance-input').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await page.locator('.add-dance-submit').click()

    // Should show error
    await expect(page.locator('.add-dance-error-text')).toBeVisible()

    // Try Again button should go back to input
    await page.getByText('Try Again').click()
    await expect(page.locator('.add-dance-input')).toBeVisible()
  })

  test('shows server connection error', async ({ page }) => {
    // Mock the process endpoint to fail with network error
    await page.route('**/api/dances/process', async (route) => {
      await route.abort('connectionrefused')
    })

    await page.goto('/')
    await page.getByText('+ Add Dance').click()

    await page.locator('.add-dance-input').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    await page.locator('.add-dance-submit').click()

    // Should show connection error
    await expect(page.locator('.add-dance-error-text')).toContainText('Could not connect')
  })
})

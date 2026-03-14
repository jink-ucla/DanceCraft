import { Page } from '@playwright/test'

/**
 * Mock the GET /api/dances endpoint to avoid backend dependency.
 * Call this before navigating to any page that loads the home screen.
 */
export async function mockApiDances(page: Page, dances: object[] = []) {
  await page.route('**/api/dances', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dances),
      })
    } else {
      route.continue()
    }
  })
}

/**
 * Mock the sessions API endpoints.
 */
export async function mockApiSessions(page: Page, sessions: object[] = []) {
  await page.route('**/api/sessions', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sessions),
      })
    } else {
      route.continue()
    }
  })
}

/**
 * Navigate to home screen with API mocks in place.
 */
export async function goToHome(page: Page, dances: object[] = []) {
  await mockApiDances(page, dances)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
}

/**
 * Take a named screenshot and save to organized directory.
 */
export async function takeScreenshot(page: Page, name: string) {
  await page.screenshot({
    path: `tests/e2e/screenshots/${name}.png`,
    fullPage: true,
  })
}

/**
 * Sample API dance data for testing.
 */
export const SAMPLE_API_DANCE = {
  id: 1,
  youtubeUrl: 'https://youtube.com/watch?v=test123',
  title: 'Test Dance',
  duration: 120,
  channel: 'Test Channel',
  thumbnailPath: null,
  poseDataPath: '/tmp/poses.json',
  videoPath: '/tmp/video.mp4',
  audioPath: '/tmp/audio.mp3',
  status: 'complete',
  createdAt: '2026-03-14T00:00:00Z',
}

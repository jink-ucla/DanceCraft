import { defineConfig } from '@playwright/test'

// DanceCraft: e2e runs its own Vite server on a dedicated port (default 5174) so it
// never reuses a dev server from another checkout that may already own 5173/3001.
// API calls are mocked per-test with page.route, so no backend is started here.
const E2E_PORT = Number(process.env.E2E_PORT || 5174)

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/test-results',
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    screenshot: 'on',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: './tests/e2e/html-report', open: 'never' }],
  ],
  webServer: {
    command: `npx vite --port ${E2E_PORT} --strictPort`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})

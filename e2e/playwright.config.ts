import { defineConfig } from '@playwright/test';

// E2E tests connect to the Wails app running in server mode (-tags server)
// on port 34115. Server mode provides a full HTTP server with the Go backend,
// allowing Playwright to test the complete app in a browser.

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:34115',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
  // CI starts the server itself (see .github/workflows/pr.yml). Locally,
  // `task run:server` builds and starts it, or an already running one is reused.
  webServer: process.env.CI ? undefined : {
    command: 'cd .. && task run:server',
    url: 'http://localhost:34115/health',
    timeout: 120_000,
    reuseExistingServer: true,
  },
});

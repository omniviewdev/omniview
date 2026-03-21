import { defineConfig } from '@playwright/test';

// E2E tests connect to the Wails app running in server mode (-tags server)
// on port 34115. Server mode provides a full HTTP server with the Go backend,
// allowing Playwright to test the complete app in a browser.
//
// NOTE: Wails v3 alpha.74 server mode has build tag conflicts on macOS
// (darwin files don't exclude the server tag). Until this is fixed upstream,
// E2E tests can only run in CI on Linux. Track: Taskfile.yml TODO.

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
  // In CI (Linux), build and run in server mode.
  // Locally on macOS, server mode is blocked — run manually if needed.
  webServer: process.env.CI ? undefined : {
    command: 'cd .. && task run:server',
    url: 'http://localhost:34115/health',
    timeout: 120_000,
    reuseExistingServer: true,
  },
});

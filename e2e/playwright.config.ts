import { defineConfig } from '@playwright/test';

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
  // Locally, Playwright manages wails dev lifecycle.
  // In CI, wails dev is started as a background step because xvfb-run +
  // wails dev creates a process tree that doesn't shut down cleanly.
  webServer: process.env.CI ? undefined : {
    command: 'cd .. && task dev',
    url: 'http://localhost:34115',
    timeout: 120_000,
    reuseExistingServer: true,
  },
});

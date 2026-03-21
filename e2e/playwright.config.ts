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
  // Build and run the app in server mode (headless HTTP server at :34115).
  // In CI, the server is started as a background step instead.
  webServer: process.env.CI ? undefined : {
    command: 'cd .. && task run:server',
    url: 'http://localhost:34115/health',
    timeout: 120_000,
    reuseExistingServer: true,
  },
});

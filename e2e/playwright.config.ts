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
  // In CI, wails dev is started as a background step in the workflow.
  // Locally, start wails dev automatically or reuse an existing one.
  webServer: process.env.CI ? undefined : {
    command: 'cd .. && wails dev',
    url: 'http://localhost:34115',
    timeout: 120_000,
    reuseExistingServer: true,
  },
});

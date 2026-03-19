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
  webServer: {
    command: process.env.CI
      ? 'cd .. && xvfb-run wails dev -loglevel Error -tags webkit2_41'
      : 'cd .. && wails dev -loglevel Error',
    url: 'http://localhost:34115',
    // CI runners are slower — give wails dev more time to compile and start
    timeout: process.env.CI ? 300_000 : 120_000,
    reuseExistingServer: !process.env.CI,
  },
});

import { defineConfig } from '@playwright/test';

// No fixed port, /health adoption or reuseExistingServer. The worker fixture
// creates a disposable A16-owned profile, then authenticates its descriptor.
const observational = process.env.OMNIVIEW_E2E_MODE === 'observe';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  testIgnore: observational ? ['**/layout/**', '**/settings/**', '**/plugins/**', '**/panels/**', '**/workspaces/**'] : ['**/observation/**'],
  outputDir: './test-results',
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    // baseURL is resolved by fixtures from the authenticated backend descriptor.
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    // Playwright hides scrollbars in headless Chromium by default. Keep them, so
    // tests can catch stray scrollbars the way a user would see them.
    launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
    trace: 'on-first-retry',
  },
  // Observation has its own read-only fixture; destructive legacy fixtures
  // cannot attach to a human profile, even when environment variables exist.
});

import { defineConfig } from '@playwright/test';

// No fixed port, /health adoption or reuseExistingServer. The worker fixture
// creates a disposable A16-owned profile, then authenticates its descriptor.
const observational = process.env.OMNIVIEW_E2E_MODE === 'observe';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  testMatch: observational ? '**/observation/**/*.spec.ts' : '**/*.spec.ts',
  testIgnore: observational ? [] : ['**/observation/**'],
  outputDir: './test-results',
  retries: 0,
  maxFailures: 1,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    // baseURL is resolved by fixtures from the authenticated backend descriptor.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Playwright hides scrollbars in headless Chromium by default. Keep them, so
    // tests can catch stray scrollbars the way a user would see them.
    launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
    trace: 'retain-on-failure',
  },
  // Observation has its own read-only fixture; destructive legacy fixtures
  // cannot attach to a human profile, even when environment variables exist.
});

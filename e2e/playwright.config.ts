import { defineConfig, type ReporterDescription } from '@playwright/test';

// The invocation owns build artifacts and isolated runtime profiles. Fixtures
// authenticate actual descriptors; they never adopt an ambient listener.
const observational = process.env.OMNIVIEW_E2E_MODE === 'observe';

// Keep canonical runs and direct Playwright invocations on the same reporters.
const reporters: ReporterDescription[] = [
  ['html', { outputFolder: './playwright-report', open: 'never' }],
  ['list'],
  ['./scripts/timing-reporter.mjs'],
];
if (process.env.GITHUB_ACTIONS === 'true') {
  reporters.push(['github']);
}

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  testMatch: observational ? '**/observation/**/*.spec.ts' : '**/*.spec.ts',
  testIgnore: observational ? [] : ['**/observation/**'],
  outputDir: './test-results',
  retries: 0,
  maxFailures: 1,
  workers: 1,
  reporter: reporters,
  use: {
    // baseURL is resolved by fixtures from the authenticated backend descriptor.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Playwright hides scrollbars in headless Chromium by default. Keep them, so
    // tests can catch stray scrollbars the way a user would see them.
    launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
    // Vite HMR URLs contain authentication query tokens: never upload raw traces.
    // First-attempt screenshots/video and redacted browser errors remain enabled.
    trace: 'off',
  },
  // Observation has its own read-only fixture; destructive legacy fixtures
  // cannot attach to a human profile, even when environment variables exist.
});

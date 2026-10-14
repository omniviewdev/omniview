import { test as base, type APIRequestContext, type Page } from '@playwright/test';
import { callBinding, Service } from './wails';

type AppFixtures = {
  appPage: Page;
  /** Restores every setting to its value from before the test. */
  restoreSettings: void;
  /** Closes terminal sessions, which the app reopens as drawer tabs on load. */
  closeTerminals: void;
};

async function closeAllSessions(request: APIRequestContext): Promise<void> {
  const sessions = await callBinding<{ id: string }[] | null>(request, Service.exec, 'ListSessions');
  for (const { id } of sessions ?? []) {
    await callBinding(request, Service.exec, 'CloseSession', id);
  }
}

export const test = base.extend<AppFixtures>({
  // Settings live in the server's state directory and outlive the page, so a
  // test that saves one would leak it into the next. Snapshot and put back.
  restoreSettings: [async ({ request }, use) => {
    const before = await callBinding<Record<string, unknown>>(request, Service.settings, 'Values');
    await use();
    await callBinding(request, Service.settings, 'SetSettings', before);
  }, { auto: true }],

  closeTerminals: [async ({ request }, use) => {
    await closeAllSessions(request);
    await use();
    await closeAllSessions(request);
  }, { auto: true }],

  appPage: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15_000 });
    await use(page);
  },
});

export { expect } from '@playwright/test';

import { test as base } from '@playwright/test';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { callBinding, Service } from './wails';
import { OwnedProfiles } from './workspace';
import type { ProfileOptions, Workspace } from './workspace';

type AppFixtures = {
  appPage: Page;
  /** Restores every setting to its value from before the test. */
  restoreSettings: void;
  /** Closes terminal sessions, which the app reopens as drawer tabs on load. */
  closeTerminals: void;
  workspace: Workspace;
  profiles: { open(name: string, options?: ProfileOptions): Promise<{ workspace: Workspace; page: Page }> };
  captureErrors: void;
};

function collectErrors(page: Page, records: { kind: string; message: string }[]): void {
  const urlPath = (value: string) => { const url = new URL(value); return `${url.origin}${url.pathname}`; };
  page.on('console', message => {
    // Normal settings bootstrap logs contain full values; never capture them.
    if (['warning', 'error'].includes(message.type())) records.push({ kind: `console.${message.type()}`, message: message.text() });
  });
  page.on('pageerror', error => records.push({ kind: 'pageerror', message: error.message }));
  page.on('requestfailed', request => records.push({ kind: 'requestfailed', message: `${request.method()} ${urlPath(request.url())} ${request.failure()?.errorText}` }));
  page.on('response', response => {
    if (response.status() >= 400) records.push({ kind: 'http', message: `${response.status()} ${response.request().method()} ${urlPath(response.url())}` });
  });
}

async function closeAllSessions(request: APIRequestContext): Promise<void> {
  const sessions = await callBinding<{ id: string }[] | null>(request, Service.exec, 'ListSessions');
  for (const { id } of sessions ?? []) {
    await callBinding(request, Service.exec, 'CloseSession', id);
  }
}

export const test = base.extend<AppFixtures, { ownedProfiles: OwnedProfiles }>({
  ownedProfiles: [async ({}, use) => {
    if (process.env.OMNIVIEW_E2E_MODE === 'observe') throw new Error('Destructive app fixtures cannot attach observationally');
    const profiles = await OwnedProfiles.create();
    try { await use(profiles); } finally { await profiles.close(); }
  }, { scope: 'worker', timeout: 30 * 60_000 }],

  workspace: [async ({ ownedProfiles }, use) => {
    const workspace = await ownedProfiles.get('profile-a');
    workspace.assertOwned();
    await workspace.verify();
    await use(workspace);
  }, { timeout: 30 * 60_000 }],

  baseURL: async ({ workspace }, use) => { await use(workspace.browserURL()); },

  profiles: async ({ browser, ownedProfiles }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    const records: { kind: string; message: string }[] = [];
    try {
      await use({
        open: async (name, options) => {
          const workspace = await ownedProfiles.get(name, options);
          const context = await browser.newContext({ baseURL: workspace.browserURL() });
          contexts.push(context);
          context.on('page', additional => collectErrors(additional, records));
          const page = await context.newPage();
          await page.goto('/');
          await page.getByTestId('app-shell').waitFor();
          return { workspace, page };
        },
      });
    } finally {
      await testInfo.attach('additional-profile-browser-errors.json', { body: JSON.stringify(records, null, 2), contentType: 'application/json' });
      await Promise.all(contexts.map(context => context.close()));
    }
  },

  captureErrors: [async ({ page }, use, testInfo) => {
    const records: { kind: string; message: string }[] = [];
    collectErrors(page, records);
    page.context().on('page', additional => collectErrors(additional, records));
    await use();
    await testInfo.attach('browser-errors.json', { body: JSON.stringify(records, null, 2), contentType: 'application/json' });
    if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) await page.screenshot({ path: testInfo.outputPath('browser-failure.png'), fullPage: true });
  }, { auto: true }],
  // Settings live in the server's state directory and outlive the page, so a
  // test that saves one would leak it into the next. Snapshot and put back
  // only what changed: SetSettings validates every value it is given, and some
  // defaults do not validate on every machine (terminal.defaultShell is
  // /bin/zsh, which CI's Linux runners do not have).
  restoreSettings: [async ({ request, workspace }, use) => {
    workspace.assertOwned();
    await workspace.verify();
    const before = await callBinding<Record<string, unknown>>(request, Service.settings, 'Values');
    await use();
    await workspace.verify();
    const after = await callBinding<Record<string, unknown>>(request, Service.settings, 'Values');
    const changed = Object.fromEntries(
      Object.entries(before).filter(([id, value]) => JSON.stringify(after[id]) !== JSON.stringify(value)),
    );
    if (Object.keys(changed).length > 0) {
      await callBinding(request, Service.settings, 'SetSettings', changed);
    }
  }, { auto: true }],

  closeTerminals: [async ({ request, workspace }, use) => {
    workspace.assertOwned();
    await workspace.verify();
    await closeAllSessions(request);
    await use();
    await workspace.verify();
    await closeAllSessions(request);
  }, { auto: true }],

  appPage: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15_000 });
    await use(page);
  },
});

export { expect } from '@playwright/test';

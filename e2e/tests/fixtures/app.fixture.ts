import { writeFile } from 'node:fs/promises';
import { test as base } from '@playwright/test';
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test';
import { bindWindowContext, callBinding, commitHostSettings, hostSettingsValues, Service } from './wails';
import { ApplicationWorkspace } from './application';
import { BrowserErrors } from './browser-errors';

type OpenProfile = { workspace: ApplicationWorkspace; page: Page };
type ProfileOptions = { liveFrontend?: boolean };
type ProfileFixtures = {
  profiles: {
    open(name: string, options?: ProfileOptions): Promise<OpenProfile>;
  };
};
type AppFixtures = {
  liveFrontend: boolean;
  appPage: Page;
  workspace: ApplicationWorkspace;
  restoreSettings: void;
  closeTerminals: void;
  captureErrors: void;
};
function collectErrors(page: Page, records: BrowserErrors): void {
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) {
      records.add(`console.${message.type()}`, message.text());
    } 
  });
  page.on('pageerror', error => {
    records.add('pageerror', error.message); 
  });
  page.on('requestfailed', request => {
    const url = new URL(request.url()); records.add('requestfailed', `${request.method()} ${url.origin}${url.pathname} ${request.failure()?.errorText}`); 
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      const url = new URL(response.url()); records.add('http', `${response.status()} ${response.statusText()} ${response.request().method()} ${url.origin}${url.pathname}`);
    } 
  });
}

async function attachErrors(testInfo: TestInfo, records: BrowserErrors, name = 'browser-errors.json'): Promise<void> {
  const path = testInfo.outputPath(name);
  await writeFile(path, records.serialize());
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function closeSessions(request: APIRequestContext): Promise<void> {
  const sessions = await callBinding<Array<{ id: string }> | null>(request, Service.exec, 'ListSessions');
  for (const { id } of sessions ?? []) {
    await callBinding(request, Service.exec, 'CloseSession', id);
  }
}

async function rememberBaseline(workspace: ApplicationWorkspace): Promise<void> {
  await workspace.rememberSetting({ scope: 'host', id: 'appearance.theme' });
  await workspace.rememberSetting({ scope: 'host', id: 'terminal.fontSize' });
  await workspace.rememberSetting({ scope: 'plugin', pluginID: 'workspace-probe', id: 'probe_counter' });
}

// The parent owns launch handles across worker loss. Test teardown restores real
// providers while healthy and closes contexts; it never parks/rebuilds profiles.
const profileTest = base.extend<ProfileFixtures>({
  profiles: async ({ browser }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    const workspaces: ApplicationWorkspace[] = [];
    const operations: Array<Promise<unknown>> = [];
    const records = new BrowserErrors();
    let closing = false;
    const open = async (name: string, options: ProfileOptions = {}): Promise<OpenProfile> => {
      if (closing) {
        return Promise.reject(new Error('Profile browser fixture is draining'));
      }

      const operation = (async () => {
        const workspace = await new ApplicationWorkspace(name, options.liveFrontend ?? false).open();
        workspaces.push(workspace);
        await rememberBaseline(workspace);
        const context = await browser.newContext({ baseURL: workspace.browserURL() });
        contexts.push(context);
        context.on('page', page => {
          collectErrors(page, records); 
        });
        const page = await context.newPage();
        await bindWindowContext(page, 'main');
        await closeSessions(page.request);
        await page.goto('/');
        await page.getByTestId('app-shell').waitFor();
        await page.getByTestId('app-header').getByRole('button', { name: 'home', exact: true }).click();
        return { workspace, page };
      })();
      operations.push(operation);
      return operation;
    };

    try {
      await use({ open });
    } finally {
      closing = true;
      await Promise.allSettled(operations);
      const failures: unknown[] = [];
      for (const workspace of workspaces) {
        try {
          await workspace.restoreSettings(); 
        } catch (error) {
          failures.push(error); 
        }
      }

      for (const context of contexts) {
        try {
          await closeSessions(context.request); 
        } catch (error) {
          failures.push(error); 
        }

        try {
          await context.close(); 
        } catch (error) {
          failures.push(error); 
        }
      }

      await attachErrors(testInfo, records, 'additional-profile-browser-errors.json');
      if (failures.length) {
        throw new AggregateError(failures, 'Actual profile reset/drain failed; parent retains private ownership');
      }
    }
  },
});

export const test = profileTest.extend<AppFixtures>({
  liveFrontend: [false, { option: true }],
  page: async ({ page }, use) => {
    await bindWindowContext(page, 'main');
    await use(page);
  },
  workspace: async ({ liveFrontend }, use) => {
    const workspace = await new ApplicationWorkspace('profile-a', liveFrontend).open();
    workspace.assertOwned();
    await use(workspace);
  },
  baseURL: async ({ workspace }, use) => {
    await use(workspace.browserURL()); 
  },
  captureErrors: [async ({ page }, use, testInfo) => {
    const records = new BrowserErrors();
    collectErrors(page, records);
    page.context().on('page', additional => {
      collectErrors(additional, records); 
    });
    try {
      await use(); 
    } finally {
      await attachErrors(testInfo, records);
      if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
        await page.screenshot({ path: testInfo.outputPath('browser-failure.png'), fullPage: true });
      }
    }
  }, { auto: true }],
  restoreSettings: [async ({ request, workspace }, use) => {
    await workspace.verify();
    await rememberBaseline(workspace);
    const before = await hostSettingsValues(request);
    try {
      await use(); 
    } finally {
      await workspace.verify();
      const after = await hostSettingsValues(request);
      const changed = Object.fromEntries(Object.entries(before).filter(([id, value]) => JSON.stringify(after[id]) !== JSON.stringify(value)));
      if (Object.keys(changed).length) {
        await commitHostSettings(request, changed);
        const restored = await hostSettingsValues(request);
        if (Object.entries(changed).some(([id, value]) => JSON.stringify(restored[id]) !== JSON.stringify(value))) {
          throw new Error('Actual host settings reset did not complete');
        }
      }

      await workspace.restoreSettings();
    }
  }, { auto: true }],
  closeTerminals: [async ({ request, workspace }, use) => {
    await workspace.verify();
    await closeSessions(request);
    try {
      await use(); 
    } finally {
      await workspace.verify(); await closeSessions(request); 
    }
  }, { auto: true }],
  appPage: async ({ page }, use) => {
    await page.goto('/');
    await page.getByTestId('app-shell').waitFor();
    await page.getByTestId('app-header').getByRole('button', { name: 'home', exact: true }).click();
    await use(page);
  },
});
export { expect } from '@playwright/test';

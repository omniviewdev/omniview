import { expect, test, type BrowserContext } from '@playwright/test';
import { existsSync } from 'node:fs';
import { publishedRuntime, publishedStyles } from '../../fixtures/published-consumers/fixture';

function expectRetired(root: string, pid: number) {
  expect(existsSync(root)).toBe(false);
  try {
    process.kill(-pid, 0);
  } catch (error) {
    expect(error).toHaveProperty('code', 'ESRCH');
    return;
  }

  throw new Error('Published-consumer producer group survived fixture teardown');
}

async function retireFixture(context: BrowserContext, fixture: {
  root: string; pid: number; close: () => Promise<void>;
}, primaryFailure: unknown) {
  try {
    try {
      await Promise.all(context.pages().map(async page => page.close()));
    } finally {
      await fixture.close();
      expectRetired(fixture.root, fixture.pid);
    }
  } catch (cleanupError) {
    if (primaryFailure !== undefined) {
      throw new AggregateError([primaryFailure, cleanupError],
        'Consumer contract and fixture cleanup both failed',
        { cause: primaryFailure });
    }

    throw cleanupError;
  }
}

// These are tooling contracts, not application profiles. A lost shim export,
// bundled duplicate runtime, or publication that never reaches paint must fail.
test.describe('published consumers', () => {
  test('a new built runtime export executes through served shims and production externals', async ({ context }) => {
    const fixture = await publishedRuntime();
    let primaryFailure: unknown;
    try {
      expect(fixture.pid).not.toBe(process.pid);
      expect(new Set(fixture.ports).size).toBe(4);
      const a = await context.newPage();
      const b = await context.newPage();
      await Promise.all([a.goto(fixture.a.url), b.goto(fixture.b.url)]);
      for (const page of [a, b]) {
        await expect(page.locator('#host')).toHaveText('baseline:host');
        await expect(page.locator('#served')).toHaveText('baseline:served');
        await expect(page.locator('#production')).toHaveText('baseline:production');
        await expect(page.locator('#identity')).toHaveText('shared functions');
        await expect(page.locator('#new-export')).toHaveText('absent');
      }

      // Runtime publication replaces Vite endpoints; use a fresh document so
      // the old client's automatic reconnect cannot compete with navigation.
      await a.close();
      await fixture.a.publishNewExport();
      const revised = await context.newPage();
      await revised.goto(fixture.a.url);
      await expect(revised.locator('#host')).toHaveText('revised:host:fresh');
      await expect(revised.locator('#served')).toHaveText('revised:served:fresh');
      await expect(revised.locator('#production')).toHaveText('revised:production:fresh');
      await expect(revised.locator('#identity')).toHaveText('shared functions');
      await expect(revised.locator('#new-export')).toHaveText('present');
      await expect(b.locator('#host')).toHaveText('baseline:host');
      await expect(b.locator('#served')).toHaveText('baseline:served');
      await expect(b.locator('#production')).toHaveText('baseline:production');
      await expect(b.locator('#new-export')).toHaveText('absent');
      // Re-execute B, rather than only inspecting its previously rendered DOM.
      await b.reload();
      await expect(b.locator('#production')).toHaveText('baseline:production');
      await expect(b.locator('#new-export')).toHaveText('absent');
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      await retireFixture(context, fixture, primaryFailure);
    }
  });

  for (const delivery of ['stylesheet-link', 'live-import'] as const) {
    test(`published CSS paints host and plugin through ${delivery} refresh without navigation`, async ({ context }) => {
      const fixture = await publishedStyles(delivery);
      let primaryFailure: unknown;
      try {
        expect(fixture.pid).not.toBe(process.pid);
        expect(new Set(fixture.ports).size).toBe(4);
        const a = await context.newPage();
        const b = await context.newPage();
        const feedback: Record<'a' | 'b', string[]> = { a: [], b: [] };
        for (const [label, page] of [['a', a], ['b', b]] as const) {
          page.on('websocket', socket => socket.on('framereceived',
            ({ payload }) => feedback[label].push(String(payload))));
        }

        await Promise.all([a.goto(fixture.a.url), b.goto(fixture.b.url)]);
        for (const page of [a, b]) {
          await expect(page.locator('#host')).toHaveCSS('background-color', 'rgb(31, 72, 113)');
          await expect(page.locator('#plugin')).toHaveCSS('background-color', 'rgb(31, 72, 113)');
        }

        for (const label of ['a', 'b'] as const) {
          await expect.poll(() => feedback[label].some(frame => frame.includes('"type":"connected"'))).toBe(true);
        }

        const documentID = await a.evaluate(() => document.documentElement.dataset.documentId);
        const bDocumentID = await b.evaluate(() => document.documentElement.dataset.documentId);
        let navigations = 0;
        a.on('framenavigated', frame => {
          if (frame === a.mainFrame()) {
            navigations++;
          } 
        });
        let bNavigations = 0;
        b.on('framenavigated', frame => {
          if (frame === b.mainFrame()) {
            bNavigations++;
          } 
        });
        await fixture.a.publishCSS('rgb(116, 52, 93)');
        await expect(a.locator('#host')).toHaveCSS('background-color', 'rgb(116, 52, 93)');
        await expect(a.locator('#plugin')).toHaveCSS('background-color', 'rgb(116, 52, 93)');
        await expect.poll(() => feedback.a.some(frame => frame.includes('css-update') || frame.includes('js-update'))).toBe(true);
        expect(navigations).toBe(0);
        expect(await a.evaluate(() => document.documentElement.dataset.documentId)).toBe(documentID);
        await expect(b.locator('#host')).toHaveCSS('background-color', 'rgb(31, 72, 113)');
        await expect(b.locator('#plugin')).toHaveCSS('background-color', 'rgb(31, 72, 113)');
        expect(bNavigations).toBe(0);
        expect(await b.evaluate(() => document.documentElement.dataset.documentId)).toBe(bDocumentID);
        // A fresh B document must still consume B's unchanged published bytes.
        await b.reload();
        await expect(b.locator('#plugin')).toHaveCSS('background-color', 'rgb(31, 72, 113)');
      } catch (error) {
        primaryFailure = error;
        throw error;
      } finally {
        await retireFixture(context, fixture, primaryFailure);
      }
    });
  }
});

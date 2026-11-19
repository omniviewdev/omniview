// The seam check: the real Go host in server mode, built from `OMNIVIEW_UI=next`, loading plugin bundles that were built OUTSIDE the host's tree
// (ui-next/plugins/fixture/build.mjs), in WebKit and Chromium. What it proves (docs/ui-next/slices/n19-plugin-seam.md, 1.4):
//
//   a  a bundle built by its own Vite config is fetched from `/_/plugins/<id>/assets/entry.js`, linked to the host's React and kit, and contributes a sidebar
//      entry and a page to the shell; the window opens it with no route (no URL parameter and no hash: the default screen is the plugins')
//   b  ONE React and ONE kit: the bundle's imports are the registry's instances, and `useTheme()` in the plugin reads the host's provider
//   c  the negative control: the same plugin with its own copy of the kit fails that read, and the check sees it fail
//   d  a page that throws is contained: the frame, the sidebar and the other pages stay; Retry tries again
//   e  a bundle of the old shell is refused before it runs (the global it sets is never set); a plugin with no bundle is a named state
//   g  the rail (S2a): one entry for each plugin that contributes (the healthy plugin and its copy; the refused ones have none), in the order each declares; choosing the other entry shows its
//      sidebar and closes no tab, activating a tab makes its plugin current; closing the last tab leaves the empty window (decision A17), which opens nothing by itself and offers the plugins to open
//   h  the bottom panel (P1a): the tool each plugin that contributes brings, "Streams" and "Streams copy", is drawn by the host's strip over the plugin's own body; the status bar's toggle opens the panel,
//      the tool's `+` opens its three streams (running, ended, failed), a hidden stream keeps running while another is on screen and while the panel is hidden, and the card of a stream links to its item,
//      which opens in a tab of the window
//
//   node ui-next/plugins/e2e/seam.check.mjs        needs bin/Omniview-server (OMNIVIEW_UI=next task build:server) and Playwright's browsers
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { SHARED_SPECIFIERS_V1 } from '../loader/specifiers.ts';
import { writeAll } from '../fixture/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const server = path.join(root, 'bin/Omniview-server');
const OK = 'fixture-a-ok';
const DUP = 'fixture-b-dup';
const OLD = 'fixture-c-old';
const MISSING = 'fixture-d-missing';

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => {
        resolve(port);
      });
    });
    probe.on('error', reject);
  });
}

async function startHost(work, port) {
  const home = path.join(work, 'home');
  const plugins = path.join(home, '.omniview-feature-ui-next', 'plugins');
  await mkdir(plugins, { recursive: true });
  const built = await writeAll(plugins);
  const logFile = path.join(work, 'host.log');
  // A minimal environment, so nothing ambient (a credential, a config path of the developer's machine) reaches the host or a plugin: only the profile the check built.
  const { PATH, TMPDIR, LANG, USER } = process.env;
  const child = spawn(server, [], {
    env: { PATH, TMPDIR, LANG, USER, HOME: home, OMNIVIEW_CHANNEL: 'feature-ui-next', WAILS_SERVER_HOST: '127.0.0.1', WAILS_SERVER_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => lines.push(String(chunk)));
  }

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (exited) {
      throw new Error(`the host exited while starting:\n${lines.join('').slice(-2000)}`);
    }

    try {
      if ((await fetch(`http://127.0.0.1:${String(port)}/`)).ok) {
        return { child, built, base: `http://127.0.0.1:${String(port)}`, tail: () => lines.join('').slice(-3000), logFile };
      }
    } catch {
      // not listening yet
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`the host did not answer in 60 s:\n${lines.join('').slice(-2000)}`);
}

/** The window as the native app opens it: `/`, no `?screen=`, no URL parameter at all; a hash only where a check names a page or a connection. */
async function open(page, base, hash = '') {
  await page.goto(`${base}/${hash}`, { waitUntil: 'load' });
}

async function checkHealthy(page, base, engine) {
  const errors = [];
  const failedRequests = [];
  const failedDetails = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // The browser's own line for a request that answered 4xx is not a script error: the requests are listed below and each must be one the check expects.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(`console: ${message.text()}`);
  });
  // The fixture's `useConnections` swallows a failed call into an empty list, so the rendered count alone cannot tell a failure from an empty answer: the check
  // records how the host answered the Wails runtime calls that carry the fixture's plugin id (generated bindings are called by id, not by name; the only such call is
  // `ListConnections(pluginId)`).
  const connectionCalls = [];
  page.on('response', (response) => {
    const body = response.request().postData() ?? '';
    if (new URL(response.url()).pathname === '/wails/runtime' && body.includes(`"${OK}"`)) connectionCalls.push(response.status());
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    const pathname = new URL(response.url()).pathname;
    failedRequests.push(`${String(response.status())} ${pathname}`);
    // What was asked and what came back, so an unexpected 4xx names its call (the Wails runtime's endpoint carries every call in its body).
    failedDetails.push(
      response.text().then(
        (body) => `${request.method()} ${pathname} -> ${String(response.status())}: asked ${String(request.postData() ?? '').slice(0, 400)} | answered ${body.slice(0, 400)}`,
        () => `${request.method()} ${pathname} -> ${String(response.status())} (no body)`,
      ),
    );
  });

  // a. no route at all: the first plugin that is ready opens its home page.
  await open(page, base);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: 'Items', selected: true }).waitFor();
  for (const name of ['orders-api', 'ledger-sync', 'ghost-service', 'vault-keeper', 'flaky-gateway']) await page.getByRole('link', { name }).waitFor();
  // The sidebar's hook answers 150 ms after it mounts: the skeleton gives way to the entries with their count.
  await page.getByRole('treeitem', { name: 'Items 5' }).waitFor();
  await page.getByRole('navigation', { name: 'Seam Fixture navigation' }).waitFor();
  await page.getByRole('main', { name: 'Seam Fixture workspace' }).waitFor();
  assert.equal(await page.evaluate(() => location.hash), '', `${engine}: the window opened with no hash`);

  // b. one React, one kit: the plugin's own `useTheme()` (a plugin of its own copy throws, c) shows the theme the host's provider holds.
  const theme = (await page.locator('[data-fixture=theme]').first().innerText()).trim();
  const attribute = await page.evaluate(() => document.documentElement.getAttribute('data-ov-theme'));
  assert.ok(theme.length > 0 && attribute !== null, `${engine}: the Theme cell reads the host's provider (${theme} / ${String(attribute)})`);
  const identity = await page.evaluate(async (entry) => {
    const bundle = System.get(entry);
    const kit = System.get('shared://@omniviewdev/kit');
    const react = System.get('shared://react');
    const runtime = System.get('shared://@omniviewdev/runtime/ui/v1');
    return {
      bundleLoaded: bundle !== null,
      sameReact: bundle.imports.useState === react.useState,
      sameKitText: bundle.imports.Text === kit.Text,
      sameKitUseTheme: bundle.imports.useTheme === kit.useTheme,
      sameRuntimeUseConnections: bundle.imports.useConnections === runtime.useConnections,
      registered: [...System.entries()].map(([id]) => id).filter((id) => id.startsWith('shared://')),
    };
  }, `${base}/_/plugins/${OK}/assets/entry.js`);
  assert.deepEqual(
    { ...identity, registered: undefined },
    { bundleLoaded: true, sameReact: true, sameKitText: true, sameKitUseTheme: true, sameRuntimeUseConnections: true, registered: undefined },
    `${engine}: the bundle holds the registry's instances`,
  );

  // The runtime read: the plugin's `useConnections()` is the host's shared one, so it ran in the host's QueryClient and activity provider, asked the real host over
  // the Wails runtime and got its answer back (the fixture has no backend, so the answer is an empty list). Until then the cell says `reading`.
  await page.waitForFunction(() => /^\d+ connections$/.test(document.querySelector('[data-fixture=connections]')?.textContent?.trim() ?? ''), null, { timeout: 20_000 });
  console.log(`${engine}: the fixture read through the shared runtime entry: "${(await page.locator('[data-fixture=connections]').first().innerText()).trim()}"`);
  // The cell cannot tell a failed call from an empty answer (the hook turns a failure into an empty list), so the host's answer to each call is checked too.
  assert.ok(connectionCalls.length > 0 && connectionCalls.every((status) => status === 200), `${engine}: the host answered the plugin's ListConnections call with success (${connectionCalls.join(', ') || 'none seen'})`);

  // The plugin's own CSS arrived inside the kit's plugin layer, and styles its own element.
  const css = await page.evaluate((id) => document.querySelector(`style[data-omniview-plugin-css="${id}"]`)?.textContent ?? '', OK);
  assert.ok(css.startsWith('@layer ov.plugin {'), `${engine}: the plugin's stylesheet is in the plugin layer`);
  assert.equal(await page.locator('[data-fixture=theme]').first().evaluate((element) => getComputedStyle(element).outlineStyle), 'dotted', `${engine}: and it applies`);

  // d. a page that throws is a state of that page only.
  await page.getByRole('treeitem', { name: 'Crash' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Crash[\s\S]*This page failed to display\./);
  // A sidebar entry opens the page through the tab model: the tab on screen is navigated in place (same plugin), so there is still one tab, and the address is not written (it is an input).
  await page.getByRole('tab', { name: 'Crash' }).waitFor();
  assert.equal(await page.getByRole('tab').count(), 1, `${engine}: a sidebar entry navigates the tab on screen in place`);
  assert.equal(await page.evaluate(() => location.hash), '', `${engine}: the window never writes the address`);
  assert.ok(await page.getByRole('navigation', { name: 'Seam Fixture navigation' }).isVisible(), `${engine}: the sidebar stays beside a failed page`);
  assert.equal(await page.getByText('crashed on purpose').count(), 0, `${engine}: the plugin's own words are not drawn`);
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('alert').waitFor();
  await page.getByRole('treeitem', { name: 'Items' }).click();
  await page.getByText('orders-api', { exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, `${engine}: another page of the same plugin draws`);

  // f. a list row opens its detail page (the contract's detail kind, with the object's identity in the route): a plain click is smart open and navigates this tab, the tab is called
  // `{name} · {Kind}`, the page loads and is ready, a command reports to the plugin's callback, and the back path leads to the list.
  await page.getByRole('link', { name: 'orders-api' }).click();
  await page.getByRole('tab', { name: /orders-api · Item/ }).waitFor();
  await page.getByRole('heading', { level: 1, name: 'orders-api' }).waitFor();
  await page.getByRole('heading', { level: 2, name: 'Details' }).waitFor({ timeout: 10_000 });
  assert.equal(await page.getByRole('heading', { name: 'Budget' }).count(), 0, `${engine}: a section with nothing to say is not drawn`);
  assert.equal(await page.getByRole('tab').filter({ hasText: 'Item' }).count(), 1, `${engine}: a plain click navigated the tab on screen`);
  await page.getByText('2 desired · 2 ready · 2 up to date').waitFor();
  await page.getByRole('button', { name: 'Scale' }).click();
  await page.getByText('3 desired · 3 ready · 3 up to date').waitFor();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Items' }).click();
  await page.getByRole('link', { name: 'ghost-service' }).waitFor();
  // Command (Control elsewhere) opens a background tab; each data state has its own words, and a Retry that is the plugin's.
  const key = (await page.evaluate(() => navigator.platform.includes('Mac'))) ? 'Meta' : 'Control';
  for (const name of ['ghost-service', 'vault-keeper', 'flaky-gateway']) await page.getByRole('link', { name }).click({ modifiers: [key] });
  assert.equal(await page.getByRole('tab').filter({ hasText: '· Item' }).count(), 3, `${engine}: three background tabs beside the list`);
  const states = [['ghost-service', /ghost-service was not found/], ['vault-keeper', /Access to vault-keeper is denied/], ['flaky-gateway', /Couldn't load flaky-gateway/]];
  for (const [name, words] of states) {
    await page.getByRole('tab', { name: new RegExp(`${name} · Item`) }).click();
    await page.getByRole('heading', { level: 1, name }).waitFor();
    await page.getByText(words).waitFor({ timeout: 10_000 });
  }
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('heading', { level: 2, name: 'Details' }).waitFor({ timeout: 10_000 });
  // Smart open re-activates: the link of an object that has a tab shows that tab and makes no twin.
  await page.getByRole('tab', { name: /^Items/ }).click();
  await page.getByRole('link', { name: 'vault-keeper' }).click();
  assert.equal(await page.getByRole('tab').filter({ hasText: '· Item' }).count(), 3, `${engine}: smart open showed the tab that had the object`);
  await page.getByRole('heading', { level: 1, name: 'vault-keeper' }).waitFor();

  const unexpected = errors.filter((entry) => !entry.includes('[plugins] fixture-a-ok page crash failed to render') && !entry.includes('crashed on purpose'));
  assert.deepEqual(unexpected, [], `${engine}: the healthy flow wrote no console error`);
  // Every request that failed is one the check expects: the plugin with no bundle, and nothing else of the plugin seam.
  const [missing, rest] = [failedRequests.filter((entry) => entry.includes(MISSING)), failedRequests.filter((entry) => !entry.includes(MISSING))];
  assert.ok(missing.length > 0 && missing.every((entry) => entry.startsWith('400 ')), `${engine}: the plugin with no bundle was answered 400 (${missing.join(', ')})`);
  console.log(`${engine}: other requests that answered 4xx while the page ran: ${rest.length === 0 ? 'none' : [...new Set(rest)].join(', ')}`);
  for (const detail of await Promise.all(failedDetails)) if (!detail.includes(MISSING)) console.log(`  ${engine}: ${detail}`);
}

async function checkRefusals(page, base, engine) {
  const go = async (id) => {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, `#/${id}`);
  };

  // c. the negative control: the copy of the kit has no provider above it.
  await go(DUP);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Items[\s\S]*This page failed to display\./, `${engine}: a plugin with its own kit fails the Theme read`);

  // e. an old-shell bundle is refused before it ran; a plugin with no bundle says so.
  await go(OLD);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Seam Fixture Old[\s\S]*built for another version of the app/, `${engine}: the old bundle is refused by name`);
  assert.equal(await page.evaluate(() => window.__fixtureOldBundleRan), undefined, `${engine}: and it never ran`);
  await go(MISSING);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Seam Fixture Missing[\s\S]*could not be read/, `${engine}: no bundle is a named state`);
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('alert').waitFor();

  // and the healthy plugin is still there after all of it.
  await go(OK);
  await page.getByText('orders-api', { exact: true }).waitFor();
}

/**
 * g. The rail and the empty window, in a page of their own: `fixture-a-ok` declares the first place and `fixture-b-dup` the second, so they are listed in that order; a page of the second
 * fails (it has its own copy of the kit), which is how the check knows whose sidebar and whose page it is looking at, the two plugins being built from one source.
 */
async function checkRail(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, base);
  const chord = `${(await page.evaluate(() => navigator.platform.includes('Mac'))) ? 'Meta' : 'Control'}+KeyW`;
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });

  // One entry for each plugin that contributes, in the declared order; the window opened on the first, and its entry is the current one.
  const entries = page.getByRole('group', { name: 'Plugins' }).getByRole('button');
  assert.deepEqual(await entries.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))), ['Seam Fixture', 'Seam Fixture Copy'], `${engine}: the rail lists the two plugins that contribute, in their declared order`);
  const current = (name) => page.locator(`[data-shell-part="rail"] [aria-label="${name}"][aria-current="true"]`);
  await current('Seam Fixture').waitFor();
  assert.equal(await current('Seam Fixture Copy').count(), 0, `${engine}: one entry is current`);

  // Choosing the other entry shows its sidebar and closes no tab: the page on screen is still the first plugin's.
  await entries.nth(1).click();
  await current('Seam Fixture Copy').waitFor();
  assert.equal(await page.getByRole('tab').count(), 1, `${engine}: choosing an entry closed no tab`);
  await page.getByRole('link', { name: 'orders-api' }).waitFor();
  assert.equal(await page.getByRole('treeitem', { selected: true }).count(), 0, `${engine}: the page on screen is not in the sidebar that is shown`);

  // An entry of that sidebar opens its plugin's page in a tab of its own, beside the first (the plugin's groups start closed: its page is not on screen to reveal).
  await page.getByRole('treeitem', { name: 'Things' }).click();
  await page.getByRole('treeitem', { name: 'Items' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Items[\s\S]*This page failed to display\./, `${engine}: the entry of the second plugin's sidebar opened the second plugin's page`);
  assert.equal(await page.getByRole('tab').count(), 2, `${engine}: the tabs of both plugins are open`);
  await current('Seam Fixture Copy').waitFor();

  // Activating a tab makes its plugin current again.
  await page.getByRole('tab').first().click();
  await page.getByRole('link', { name: 'orders-api' }).waitFor();
  await current('Seam Fixture').waitFor();
  assert.equal(await page.getByRole('tab').count(), 2, `${engine}: activating a tab closed none`);

  // Decision A17: closing the last tab leaves an empty window, and nothing opens a page by itself.
  await page.keyboard.press(chord);
  await page.keyboard.press(chord);
  await page.getByText('No tabs are open.').waitFor();
  assert.equal(await page.getByRole('tab').count(), 0, `${engine}: no tab is left`);
  await page.getByRole('heading', { level: 1, name: 'Home' }).waitFor();
  const home = page.getByRole('region', { name: 'Plugins you can open' });
  // The plugins that did not load are places to go too: their tab says what happened and offers Retry; the row says so in a word after the name.
  assert.deepEqual(await home.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim())), ['Seam Fixture', 'Seam Fixture Copy', 'Seam Fixture MissingDid not load', 'Seam Fixture OldDid not load'], `${engine}: the empty window lists the plugins to open: those that contribute in the order of the rail, then the others by name`);
  assert.equal(await entries.count(), 2, `${engine}: the rail stays beside the empty window`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(await page.getByRole('tab').count(), 0, `${engine}: nothing opened a page by itself`);
  // In a browser tab there is no window of the app's own to close: the close chord has no tab to close and does nothing.
  await page.keyboard.press(chord);
  await page.getByText('No tabs are open.').waitFor();

  // A way forward: a plugin of the list opens in a tab.
  await home.getByRole('button', { name: 'Seam Fixture', exact: true }).click();
  await page.getByRole('tab', { name: 'Items' }).waitFor();
  await page.getByRole('link', { name: 'orders-api' }).waitFor();
  assert.deepEqual(errors, [], `${engine}: the rail and the empty window wrote no page error`);
}

/**
 * h. The bottom panel, in a page of its own: each plugin that contributes brings a tool (`fixture-a-ok`: "Streams", the copy: "Streams copy"), which the host draws as a tab of its strip over the plugin's
 * body, and sessions the plugin opens through the tool's `+`. What is checked is the seam: a tool and its body from a bundle built outside the host, a card the plugin describes, a route the host opens.
 */
async function checkPanel(page, base, engine) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, base);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  const toggle = page.getByRole('button', { name: 'Panel', exact: true });
  const region = page.locator('[data-shell-region="panel"]');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false', `${engine}: the panel starts closed`);
  assert.equal(await region.isVisible(), false, `${engine}: and draws nothing`);
  await toggle.click();
  await region.waitFor({ state: 'visible' });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true', `${engine}: the toggle is pressed once it is open`);
  // One tool for each plugin that contributes, in the plugin's own words, and the plugin that came first is on screen.
  const tools = page.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab');
  assert.deepEqual((await tools.allTextContents()).map((text) => text.trim()), ['Streams', 'Streams copy'], `${engine}: the strip draws the tool of each plugin that contributes`);
  assert.equal(await tools.first().getAttribute('aria-selected'), 'true', `${engine}: the first is on screen`);
  await page.getByText('No sessions').waitFor();
  // The tool's `+` starts a stream; three in turn: running, ended and failed.
  const add = page.getByRole('button', { name: 'New stream' }).first();
  for (let opened = 0; opened < 3; opened += 1) await add.click();
  const sessions = page.getByRole('tablist', { name: 'Streams sessions' }).getByRole('tab');
  await page.waitForFunction(() => document.querySelectorAll('[data-shell-part="sessionTab"]').length === 3);
  assert.deepEqual(await sessions.evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label'))), ['stream-alpha · north-yard', 'stream-beta · north-yard, ended', 'stream-gamma · south-yard, failed'], `${engine}: the three sessions, with the state of each in its name`);
  assert.equal(await sessions.last().getAttribute('aria-selected'), 'true', `${engine}: the last one opened is on screen`);
  await page.locator('[data-fixture="stream"][data-visible="true"]').filter({ hasText: 'stream-gamma · failed' }).waitFor();
  // The plugin's body of the running stream counts lines while it is not on screen: a session body is kept while another is shown, and while the panel is hidden.
  const lines = () => page.evaluate(() => Number(document.querySelector('[data-fixture="stream"][data-session="stream-alpha"]')?.getAttribute('data-lines') ?? -1));
  const first = await lines();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok((await lines()) > first, `${engine}: the running stream kept counting while another was on screen (${first} lines)`);
  assert.equal(await page.locator('[data-fixture="stream"][data-session="stream-alpha"]').evaluate((element) => element.closest('[hidden]') !== null), true, `${engine}: and is not drawn`);
  // The card the plugin describes: its item as a link, the state in its words and the reason of a failure; its link opens the item's page in a tab, as every link of the window does.
  await sessions.last().hover();
  const card = page.locator('[popover]:popover-open');
  await card.waitFor();
  assert.match(await card.innerText(), /Stream[\s\S]*Item ghost-service[\s\S]*Source\s+south-yard[\s\S]*State\s+Failed[\s\S]*The source did not answer\. Check the source, then open the stream again\./, `${engine}: the card says what the plugin says`);
  await card.getByRole('link', { name: 'Item ghost-service' }).click();
  await page.getByRole('tab', { name: /ghost-service · Item/ }).waitFor();
  await page.getByRole('heading', { level: 1, name: 'ghost-service' }).waitFor();
  assert.equal(await region.isVisible(), true, `${engine}: opening an item leaves the panel as it was`);
  // Hiding the panel draws nothing and unmounts nothing: the running stream goes on.
  const hiddenAt = await lines();
  await toggle.click();
  await region.waitFor({ state: 'hidden' });
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok((await lines()) > hiddenAt, `${engine}: the running stream kept counting while the panel was hidden (${hiddenAt} lines)`);
  assert.deepEqual(errors, [], `${engine}: the panel wrote no page error`);
}

const work = await mkdtemp(path.join(os.tmpdir(), 'omniview-seam-'));
let host;
try {
  host = await startHost(work, await freePort());
  // What the build wrote: the healthy bundle imports only what the host serves, the copy lacks the kit, the old one needs the old library.
  const dependencies = Object.fromEntries(host.built.map(({ id, dependencies: names }) => [id, names]));
  for (const name of dependencies[OK]) assert.ok(SHARED_SPECIFIERS_V1.includes(name), `${OK} imports ${name}, which is not on the shared list`);
  assert.ok(dependencies[OK].includes('@omniviewdev/kit') && !dependencies[DUP].includes('@omniviewdev/kit'));
  assert.deepEqual(dependencies[OLD], ['@omniviewdev/base-ui']);
  const bytes = (await readFile(path.join(work, 'home/.omniview-feature-ui-next/plugins', OK, 'assets/entry.js'))).length;

  for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await checkHealthy(page, host.base, name);
      await checkRefusals(page, host.base, name);
      await checkRail(await browser.newPage({ viewport: { width: 1440, height: 900 } }), host.base, name);
      await checkPanel(await browser.newPage({ viewport: { width: 1440, height: 900 } }), host.base, name);
      console.log(`PASS ${name}: contribute (sidebar entry, page, no route), one React and one kit, the control fails, containment, refusal, named states, the rail, the empty window, the bottom panel`);
    } finally {
      await browser.close();
    }
  }

  console.log(`bundle ${OK}/assets/entry.js ${String(bytes)} B, imports [${dependencies[OK].join(', ')}]`);
} catch (error) {
  console.error(String(error?.stack ?? error));
  if (host !== undefined) console.error(`--- host output (tail)\n${host.tail()}`);
  process.exitCode = 1;
} finally {
  host?.child.kill();
  await new Promise((resolve) => {
    if (host === undefined || host.child.exitCode !== null) resolve();
    else host.child.once('exit', resolve);
    setTimeout(resolve, 8000);
  });
  await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

// The seam check: the real Go host in server mode, built from `OMNIVIEW_UI=next`, loading plugin bundles that were built OUTSIDE the host's tree
// (ui-next/plugins/fixture/build.mjs), in WebKit and Chromium. What it proves (docs/ui-next/slices/n19-plugin-seam.md, 1.4):
//
//   a  a bundle built by its own Vite config is fetched from `/_/plugins/<id>/assets/entry.js`, linked to the host's React and kit, and contributes a sidebar
//      entry and a page to the shell; the window opens it with no route (no URL parameter beyond the screen selector)
//   b  ONE React and ONE kit: the bundle's imports are the registry's instances, and `useTheme()` in the plugin reads the host's provider
//   c  the negative control: the same plugin with its own copy of the kit fails that read, and the check sees it fail
//   d  a page that throws is contained: the frame, the sidebar and the other pages stay; Retry tries again
//   e  a bundle of the old shell is refused before it runs (the global it sets is never set); a plugin with no bundle is a named state
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

/** The page's state as a person reads it: the tab, the tree, the notice, the rows. */
async function open(page, base, hash = '') {
  await page.goto(`${base}/?screen=plugins${hash}`, { waitUntil: 'load' });
}

async function checkHealthy(page, base, engine) {
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // The browser's own line for a request that answered 4xx is not a script error: the requests are listed below and each must be one the check expects.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${String(response.status())} ${new URL(response.url()).pathname}`);
  });

  // a. no route at all: the first plugin that is ready opens its home page.
  await open(page, base);
  await page.getByRole('tab', { name: 'Items' }).waitFor({ timeout: 30_000 });
  await page.getByRole('treeitem', { name: 'Items', selected: true }).waitFor();
  for (const name of ['alpha', 'beta', 'gamma']) await page.getByText(name, { exact: true }).waitFor();
  // The sidebar's hook answers 150 ms after it mounts: the skeleton gives way to the entries with their count.
  await page.getByRole('treeitem', { name: 'Items 3' }).waitFor();
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
    return {
      bundleLoaded: bundle !== null,
      sameReact: bundle.imports.useState === react.useState,
      sameKitText: bundle.imports.Text === kit.Text,
      sameKitUseTheme: bundle.imports.useTheme === kit.useTheme,
      registered: [...System.entries()].map(([id]) => id).filter((id) => id.startsWith('shared://')),
    };
  }, `${base}/_/plugins/${OK}/assets/entry.js`);
  assert.deepEqual({ ...identity, registered: undefined }, { bundleLoaded: true, sameReact: true, sameKitText: true, sameKitUseTheme: true, registered: undefined }, `${engine}: the bundle holds the registry's instances`);

  // The plugin's own CSS arrived inside the kit's plugin layer, and styles its own element.
  const css = await page.evaluate((id) => document.querySelector(`style[data-omniview-plugin-css="${id}"]`)?.textContent ?? '', OK);
  assert.ok(css.startsWith('@layer ov.plugin {'), `${engine}: the plugin's stylesheet is in the plugin layer`);
  assert.equal(await page.locator('[data-fixture=theme]').first().evaluate((element) => getComputedStyle(element).outlineStyle), 'dotted', `${engine}: and it applies`);

  // d. a page that throws is a state of that page only.
  await page.getByRole('treeitem', { name: 'Crash' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Couldn't load Crash[\s\S]*This page failed to display\./);
  assert.equal(await page.evaluate(() => location.hash), `#/${OK}/crash`);
  assert.ok(await page.getByRole('navigation', { name: 'Seam Fixture navigation' }).isVisible(), `${engine}: the sidebar stays beside a failed page`);
  assert.equal(await page.getByText('crashed on purpose').count(), 0, `${engine}: the plugin's own words are not drawn`);
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('alert').waitFor();
  await page.getByRole('treeitem', { name: 'Items' }).click();
  await page.getByText('alpha', { exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0, `${engine}: another page of the same plugin draws`);

  const unexpected = errors.filter((entry) => !entry.includes('[plugins] fixture-a-ok page crash failed to render') && !entry.includes('crashed on purpose'));
  assert.deepEqual(unexpected, [], `${engine}: the healthy flow wrote no console error`);
  // Every request that failed is one the check expects: the plugin with no bundle, and nothing else of the plugin seam.
  const [missing, rest] = [failedRequests.filter((entry) => entry.includes(MISSING)), failedRequests.filter((entry) => !entry.includes(MISSING))];
  assert.ok(missing.length > 0 && missing.every((entry) => entry.startsWith('400 ')), `${engine}: the plugin with no bundle was answered 400 (${missing.join(', ')})`);
  console.log(`${engine}: other requests that answered 4xx while the page ran: ${rest.length === 0 ? 'none' : [...new Set(rest)].join(', ')}`);
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
  await page.getByText('alpha', { exact: true }).waitFor();
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
      console.log(`PASS ${name}: contribute (sidebar entry, page, no route), one React and one kit, the control fails, containment, refusal, named states`);
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

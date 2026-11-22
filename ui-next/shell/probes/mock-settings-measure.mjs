// Measures the design mock's Settings page: the REFERENCE the shell's Settings page is compared with (settings-probe.mjs, section `page`).
//
// What it measures, per engine (webkit, chromium), viewport (1440x900, 1280x800) and theme (Void, and Light, `data-theme="light"`), in a FRESH page, with the mock's default context (no text scale, default density) and the UI font
// normalized as mock-strip-measure.mjs does (the shell probes' way): the parts of settings-targets.mjs and their paint in
//   page     the mock's Settings tab on its Terminal page (`Shell.settings.open('terminal')`): the sidebar's tree rows, the page heading and its description, the list of rows, the separator between two rows; the paint of the
//            tree rows in the states rest, hover and focus (a keyboard focus), for the row of another page and for the row of the page on screen
//   loading  the page's loading state, as `pageBody` draws it (`.settings-state` > `.settings-skeleton`, the mock's `H.skeleton`), under the unchanged heading
//   failed   the page's could-not-load state (`.settings-state` > `H.empty` with Retry)
//   none     the page that has nothing to configure (`H.empty` with a button)
// The three states are built with the mock's own helpers (`H.skeleton`, `H.empty`, `H.btn`) inside the page the mock drew, in the box its own `stateBox` makes: the words are not the mock's, which are a plugin's.
//
// Serve the mock first: a CommonJS copy of its server.js with `root` set to the mock directory (see mock-strip-measure.mjs), e.g.
//   sed 's#const root=__dirname#const root="<mock dir>"#' <mock dir>/server.js > /tmp/server.cjs && PORT=49471 node /tmp/server.cjs
// Without MOCK_URL the script serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) on a free port.
// Run:  MOCK_URL=http://127.0.0.1:49471/ node ui-next/shell/probes/mock-settings-measure.mjs
// Writes mock-settings.json: { meta, data: { <engine>: { <viewport>: { <theme>: { parts, styles, navStates, loading, failed, none } } } } }; each state scene is { parts, styles }. Exits non-zero when a part of the page is not there.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';
import { PARTS, readNavStates, readParts, readStyles } from './settings-targets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const THEMES = { void: null, light: 'light' };
const started = Date.now();

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory, on a port the system gives.
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-settings-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  const port = await new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  url = `http://127.0.0.1:${port}/`;
  await sleep(1500);
}

/** The mock's three page states, built with its own helpers inside its page and its `.settings-state` box (`stateBox`, shell-page-settings.js). Evaluated in the page. */
const STATES = {
  loading: `(() => {
    const page = document.querySelector('.settings-page');
    page.querySelectorAll(':scope > .stack, :scope > .settings-state').forEach((node) => node.remove());
    page.insertAdjacentHTML('beforeend', '<div class="settings-state" data-state="loading"><div class="settings-skeleton">' + H.skeleton({ rows: 6, kind: 'lines', label: 'Loading settings' }) + '</div></div>');
  })()`,
  failed: `(() => {
    const page = document.querySelector('.settings-page');
    page.querySelectorAll(':scope > .stack, :scope > .settings-state').forEach((node) => node.remove());
    page.insertAdjacentHTML('beforeend', '<div class="settings-state" data-state="error">' + H.empty('IntUiError', 'Couldn\\u2019t load settings', 'Omniview didn\\u2019t answer. Try again.', H.btn('Retry', 'noop:retry', 'LuRefreshCw')) + '</div>');
  })()`,
  none: `(() => {
    const page = document.querySelector('.settings-page');
    page.querySelectorAll(':scope > .stack, :scope > .settings-state').forEach((node) => node.remove());
    page.insertAdjacentHTML('beforeend', '<div class="settings-state" data-state="none">' + H.empty('LuSlidersHorizontal', 'Nothing to configure', 'This page has no settings.', H.btn('Open Plugins', 'noop:none', 'LuPuzzle')) + '</div>');
  })()`,
};

async function open(browser, viewport) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(url, { waitUntil: 'load' });
  await sleep(3000);
  await page.evaluate(() => Shell.settings.open('terminal'));
  await sleep(2000);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  return page;
}

const data = {};
let failed = false;
for (const [engineName, engine] of Object.entries(ENGINES)) {
  const browser = await engine.launch(engineName === 'chromium' ? { args: ['--font-render-hinting=none'] } : {});
  data[engineName] = {};
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    data[engineName][viewportName] = {};
    for (const [themeName, themeValue] of Object.entries(THEMES)) {
      const page = await open(browser, viewport);
      await page.evaluate((value) => (value === null ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', value)), themeValue);
      await sleep(400);
      const record = {};
      record.parts = await readParts(page, PARTS, 'mock');
      record.styles = await readStyles(page, PARTS, 'mock');
      record.navStates = await readNavStates(page, 'mock');
      for (const name of ['heading', 'title', 'subtitle', 'list', 'row', 'navFirst', 'navSelected']) {
        if (record.parts[name].length === 0) {
          console.log('MISSING', engineName, viewportName, themeName, name);
          failed = true;
        }
      }
      for (const [state, script] of Object.entries(STATES)) {
        await page.evaluate(script);
        await sleep(300);
        record[state] = { parts: await readParts(page, PARTS, 'mock'), styles: await readStyles(page, PARTS, 'mock') };
        if (record[state].parts.stateStack.length === 0 && state !== 'loading') {
          console.log('MISSING', engineName, viewportName, themeName, state);
          failed = true;
        }
      }
      data[engineName][viewportName][themeName] = record;
      console.log(engineName, viewportName, themeName, `${record.parts.row.length} rows`, 'ok');
      await page.context().close();
    }
  }
  await browser.close();
}

const meta = {
  source: `app/OmniviewNativeLab/frontend/mock of omniviewdev/design-lab at tag spec-baseline-2026-11-16 (mock tree ${MOCK_TREE}): the Settings tab (shell-page-settings.js and .css), opened on its Terminal page`,
  note: 'Rectangles [x, y, w, h] in viewport px, to 0.01, of the parts of settings-targets.mjs (`mock` selectors). The UI font is normalized (Helvetica, Arial) as the shell probes do. Themes: Void (no data-theme) and Light (data-theme="light"). The three states are built with the mock\'s own helpers inside the page it drew.',
  themes: { void: 'no data-theme', light: 'data-theme="light"' },
};
writeFileSync(path.join(here, 'mock-settings.json'), `${JSON.stringify({ meta, data })}\n`);
console.log(`wrote mock-settings.json in ${Math.round((Date.now() - started) / 1000)} s`);
server?.kill();
process.exit(failed ? 1 : 0);

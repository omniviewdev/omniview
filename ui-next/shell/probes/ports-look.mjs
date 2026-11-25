// Looks at the Ports tool in a real engine: the fixture (ports-fixture.tsx: the real window and tool, a fake host) is opened in WebKit, the tool is put in each state it has, and what is on screen is photographed beside the mock's own (mock-ports-measure.mjs
// photographs the mock's table and empty state). This is the tool for LOOKING (docs/ui-next/status/PF1.md, "Dev tools"); ports.mjs is the probe that asserts.
//
//   node ui-next/shell/probes/ports-look.mjs        builds the fixture (OMNIVIEW_UI=next) into a temp dir, serves it, photographs every state in WebKit at 1440 x 900 into SHOTS
//
//   FIXTURE_DIST=<dir>   look at an existing build      ENGINES=webkit      VIEWPORT=1280x800      SHOTS=<dir>  where the screenshots go (default: the PF1 assets of the notes)      THEME=<id>  the theme to look in (default: the window's own, void)
//   REAL_FONTS=1         also photograph the table and the states in the faces the window ships (the files of the mock are in the UI face of the probes, Helvetica, so that widths can be put side by side)
//
// Files (for each engine and size `<engine>-<size>`): ports-<state>-<engine>-<size>.png is the whole window; compare-<state>-<engine>-<size>.png has the panel of the mock above and the panel of the tool below, for the states the mock has (table, empty).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENGINES, launch, normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';
import { serve } from '../../../packages/kit/probes/serve.mjs';
import { NAMED_FIVE, SET } from './ports.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const engineNames = (process.env.ENGINES ?? 'webkit').split(',');
const sizeName = process.env.VIEWPORT ?? '1440x900';
const [width, height] = sizeName.split('x').map(Number);
const shots = process.env.SHOTS ?? '/Users/joshuapare/Notes/omniview/ui-migration/status/PF1-assets';
mkdirSync(shots, { recursive: true });
/** The mock's Ports tool as it was measured (mock-ports-measure.mjs): where its panel stands at each size, for the crops of the comparisons. */
const reference = (() => {
  try {
    return JSON.parse(readFileSync(path.join(here, 'mock-ports.json'), 'utf8'));
  } catch {
    return null;
  }
})();

/** The directories this script makes (the fixture it builds, the page of each comparison), taken away when it ends, however it ends: FIXTURE_DIST and the screenshots are the caller's and stay. */
const made = [];
process.on('exit', () => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function build() {
  if (process.env.FIXTURE_DIST !== undefined && process.env.FIXTURE_DIST !== '') return process.env.FIXTURE_DIST;
  const out = mkdtempSync(path.join(os.tmpdir(), 'ports-fixture-'));
  made.push(out);
  execFileSync('node', [path.join(here, 'ports-build.mjs'), out], { cwd: repo, env: { ...process.env, OMNIVIEW_UI: 'next', NODE_ENV: 'production' }, stdio: 'pipe' });
  return out;
}

const NAMES = [
  ['acme', 'conn-1', 'Staging'],
  ['other', 'conn-2', 'Production'],
];
/** The five forwards the mock's own measurement has, in its order: running, stopped, failed, stopping and the long name. */
const MOCK_FIVE = NAMED_FIVE;
/** The same five with no host stated, which is what the SDK's session says: the tool's own words for the Mapping, Open in browser and Copy (and the difference from the mock's). */
const UNSTATED_FIVE = NAMED_FIVE.map((entry) => ({ ...entry, local_host: undefined }));
/** One forward for each way a producer may state where it listens, or not (the section `hosts` of the probe holds the words). */
const HOSTS = [
  ['h-none', {}],
  ['h-v4', { local_host: '127.0.0.1' }],
  ['h-v6', { local_host: '::1' }],
  ['h-name', { local_host: 'localhost' }],
  ['h-all', { local_host: '0.0.0.0' }],
  ['h-all6', { local_host: '::' }],
  ['h-udp', { protocol: 'UDP', remote_port: 53 }],
  ['h-auto', { local_port: 0 }],
  ['h-auto4', { local_host: '127.0.0.1', local_port: 0 }],
  ['h-fail', { state: 'FAILED' }],
  ['h-failb', { state: 'FAILED', local_host: '0.0.0.0' }],
].map(([id, patch], index) => ({
  ...SET[0],
  id,
  created_at: new Date(Date.parse(SET[0].created_at) + index * 1000).toISOString(),
  connection: { ...SET[0].connection, resource_id: id },
  local_host: undefined,
  local_port: 8081 + index,
  remote_port: 8080,
  protocol: 'TCP',
  state: 'ACTIVE',
  ...patch,
}));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dist = build();
const { server, url } = await serve(dist);
const origin = url.replace(/\/$/, '');
try {
  for (const engine of engineNames) {
    const browser = await launch(engine);
    try {
      /** A fresh window of the fixture, with the forwards the state needs listed. `fonts` puts the UI face in the one the mock was photographed in. */
      const open = async ({ sessions, query = '', fonts = true }) => {
        const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US', timezoneId: 'UTC' });
        const page = await context.newPage();
        page.on('pageerror', (error) => console.log('page error:', error.message.slice(0, 200)));
        await page.addInitScript(() => {
          window.__clip = { writes: [] };
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => void window.__clip.writes.push(String(text)), readText: async () => '' } });
        });
        await page.goto(`${origin}/shell/probes/ports-fixture.html${query === '' ? '' : `?${query}`}`, { waitUntil: 'load' });
        await page.waitForSelector('[data-shell-part="window"]');
        if (process.env.THEME) await page.evaluate((id) => document.documentElement.setAttribute('data-ov-theme', id), process.env.THEME);
        if (fonts) await normalizeFont(page, { rootVar: '--ov-font-ui' });
        await page.evaluate(
          ({ given, known }) => {
            window.__ports.set(given);
            for (const [plugin, connection, name] of known) window.__ports.names.set(plugin, connection, name);
          },
          { given: sessions, known: NAMES },
        );
        await page.click('[data-shell-part="panelToggle"]');
        await page.getByRole('tab', { name: 'Ports' }).click();
        await page.waitForSelector('[data-shell-part="portsBody"]');
        return page;
      };

      const settled = async (page, count) => {
        await page.waitForFunction((rows) => document.querySelectorAll('[data-ports-part="row"]').length === rows, count);
        await sleep(300);
      };

      /** The window's own facts: Stop pressed for the worker (the host does not answer) and the plugin of the queue stopped. */
      const facts = async (page, { plugin }) => {
        await page.evaluate(() => {
          window.__ports.closes.mode = 'hold';
        });
        await page.locator('[data-ports-id="worker"]').getByRole('button', { name: 'Stop' }).click();
        if (plugin) {
          await page.evaluate((rest) => {
            window.__ports.set(rest);
            window.__ports.emit('plugin/unloaded', { pluginID: 'other', cause: 'crashed' });
          }, SET.filter((entry) => entry.id !== 'queue'));
          await page.waitForFunction(() => document.querySelector('[data-ports-id="queue"]')?.dataset.portsState === 'stopped');
        }

        await page.mouse.move(1, 1);
        await sleep(300);
      };

      const tall = async (page) => {
        await page.locator('[data-shell-part="panelHandle"]').focus();
        await page.keyboard.press('End');
        await sleep(400);
        await page.evaluate(() => document.activeElement?.blur());
      };

      /** Photographs the window and answers the file and where the tool's panel stood when it was photographed (the crops of the comparisons start there). */
      const photograph = async (page, name) => {
        await page.mouse.move(1, 1).catch(() => undefined);
        await sleep(200);
        const panel = await page.evaluate(() => {
          const box = document.querySelector('[data-shell-part="panel"]')?.getBoundingClientRect();
          return box === undefined ? null : [box.x, box.y, box.width, box.height];
        });
        const file = path.join(shots, `ports-${name}-${engine}-${sizeName}.png`);
        await page.screenshot({ path: file });
        console.log('wrote', file);
        return { file, panel };
      };

      /** The mock's photograph above and the tool's below, each cut from its own panel (where the mock's was measured at this size and where the tool's was when it was photographed), a little above it, to a height that holds both panels whole. */
      const compare = async (name, mockFile, own, as = name) => {
        const file = path.join(shots, `compare-${as}-${engine}-${sizeName}.png`);
        const mockPanel = reference?.data?.[engine]?.[sizeName]?.[name]?.panel ?? null;
        if (!existsSync(mockFile) || mockPanel === null || own.panel === null) {
          // A comparison of an earlier run must not stand where this run made none: it would show a fixture that is not this one (the photograph of this run's own is kept).
          rmSync(file, { force: true });
          console.log('no photograph or no measure of a panel for', name, '(run mock-ports-measure.mjs)');
          return;
        }

        const pad = 8;
        const crop = Math.ceil(Math.max(mockPanel[3], own.panel[3])) + 2 * pad;
        const context = await browser.newContext({ viewport: { width, height: 2 * crop } });
        const dir = mkdtempSync(path.join(os.tmpdir(), 'ports-compare-'));
        made.push(dir);
        try {
          const page = await context.newPage();
          // The page is a file of its own (a page that is not a file may not load the photographs, which are files).
          const html = path.join(dir, 'compare.html');
          const cut = (file, panel) => `<div style="height:${String(crop)}px;overflow:hidden"><img src="${pathToFileURL(file).href}" style="display:block;margin-top:-${String(Math.round(panel[1]) - pad)}px"></div>`;
          writeFileSync(html, `<body style="margin:0;background:#000">${cut(mockFile, mockPanel)}${cut(own.file, own.panel)}</body>`);
          await page.goto(pathToFileURL(html).href);
          await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
          await page.evaluate(async () => Promise.all([...document.images].map(async (image) => image.decode())));
          await sleep(300);
          await page.screenshot({ path: file });
          console.log('wrote', file);
        } finally {
          await context.close().catch(() => undefined);
          rmSync(dir, { recursive: true, force: true });
        }
      };

      const mockShot = (name) => path.join(shots, `mock-ports-${name}-${engine}-${sizeName}.png`);

      // 1. The table with the five forwards of the mock's own photograph, at the panel's default height.
      let page = await open({ sessions: MOCK_FIVE });
      await settled(page, MOCK_FIVE.length);
      await facts(page, { plugin: false });
      await compare('table', mockShot('table'), await photograph(page, 'table'));
      await page.context().close();

      // 1b. The same five with no host stated, as the SDK says them: beside the mock's table, what the tool says for itself shows.
      page = await open({ sessions: UNSTATED_FIVE });
      await settled(page, UNSTATED_FIVE.length);
      await facts(page, { plugin: false });
      await compare('table', mockShot('table'), await photograph(page, 'unstated'), 'unstated');
      await page.context().close();

      // 2. Every state the tool has, with the panel at its largest: running over TCP and over UDP, paused, stopped, failed, stopping, a plugin that stopped, a long name, a static target, a connection with a name and one without.
      page = await open({ sessions: SET });
      await settled(page, SET.length);
      await facts(page, { plugin: true });
      await tall(page);
      await photograph(page, 'states');
      // The same, with a Stop the host would not do, and the glyph that confirms a copy.
      await page.evaluate(() => {
        window.__ports.closes.mode = 'refuse';
      });
      await page.locator('[data-ports-id="cache"]').getByRole('button', { name: 'Stop' }).click();
      await page.waitForSelector('[data-ports-id="cache"] [data-ports-part="reason"]');
      await page.locator('[data-ports-id="api"]').getByRole('button', { name: 'Copy address' }).click();
      await page.waitForFunction(() => document.querySelector('[data-ports-id="api"] [data-ports-action="copy"] svg')?.getAttribute('data-ov-glyph') === 'check');
      await photograph(page, 'refused-and-copied');
      await page.context().close();
      // Every way of stating a host, or not.
      page = await open({ sessions: HOSTS });
      await settled(page, HOSTS.length);
      await tall(page);
      await photograph(page, 'hosts');
      await page.context().close();

      // 3. The states with nothing to show.
      page = await open({ sessions: [] });
      await page.waitForSelector('[data-ports-status="ready"]');
      await sleep(300);
      await compare('empty', mockShot('empty'), await photograph(page, 'empty'));
      await page.context().close();
      page = await open({ sessions: SET, query: 'read=hold' });
      await page.waitForSelector('[data-ports-status="loading"]');
      await sleep(400);
      await photograph(page, 'loading');
      await page.context().close();
      page = await open({ sessions: SET, query: 'read=fail&fails=1' });
      await page.waitForSelector('[data-ports-status="failed"]');
      await sleep(300);
      await photograph(page, 'failed');
      await page.context().close();

      // 4. The row menu, a tip that says why a button cannot be used, and where the keyboard is.
      page = await open({ sessions: SET });
      await settled(page, SET.length);
      await tall(page);
      await page.locator('[data-ports-id="proxy"] [data-column="mapping"]').click({ button: 'right' });
      await page.waitForSelector('[role="menu"]');
      await sleep(300);
      await photograph(page, 'menu');
      await page.keyboard.press('Escape');
      await page.locator('[data-ports-id="proxy"] button[data-ports-action="open"]').hover();
      await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.matches(':popover-open') === true, null, { timeout: 8000 });
      const tip = await page.evaluate(() => document.querySelector('[role="tooltip"]')?.textContent);
      console.log('the tip says', JSON.stringify(tip));
      await sleep(200);
      const hovered = path.join(shots, `ports-tip-${engine}-${sizeName}.png`);
      await page.screenshot({ path: hovered });
      console.log('wrote', hovered);
      await page.mouse.move(1, 1);
      await page.locator('[data-ports-id="jobs"] button[data-ports-action="stop"]').focus();
      await page.keyboard.press('ArrowRight');
      await sleep(300);
      await photograph(page, 'focus');
      const theme = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-ov-theme'), attributes: [...document.documentElement.attributes].map((attribute) => attribute.name) }));
      console.log('the window is in the theme', JSON.stringify(theme));
      // The menu and the tip of a forward that runs and whose host is not stated.
      await page.locator('[data-ports-id="db"] [data-column="mapping"]').click({ button: 'right' });
      await page.waitForSelector('[role="menu"]');
      await sleep(300);
      await photograph(page, 'menu-unstated');
      await page.keyboard.press('Escape');
      await page.locator('[data-ports-id="db"] button[data-ports-action="open"]').hover();
      await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.matches(':popover-open') === true, null, { timeout: 8000 });
      const stated = await page.evaluate(() => document.querySelector('[role="tooltip"]')?.textContent);
      console.log('the tip of an Open in browser whose host is not stated says', JSON.stringify(stated));
      await sleep(200);
      const hoveredUnstated = path.join(shots, `ports-tip-unstated-${engine}-${sizeName}.png`);
      await page.screenshot({ path: hoveredUnstated });
      console.log('wrote', hoveredUnstated);
      await page.context().close();

      // 5. In the faces the window ships.
      if (process.env.REAL_FONTS) {
        page = await open({ sessions: MOCK_FIVE, fonts: false });
        await settled(page, MOCK_FIVE.length);
        await facts(page, { plugin: false });
        await photograph(page, 'table-real-fonts');
        await page.context().close();
        page = await open({ sessions: SET, fonts: false });
        await settled(page, SET.length);
        await facts(page, { plugin: true });
        await tall(page);
        await photograph(page, 'states-real-fonts');
        await page.context().close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}

void ENGINES;

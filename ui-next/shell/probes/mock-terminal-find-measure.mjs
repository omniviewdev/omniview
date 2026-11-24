// Measures the design mock's FIND BAR of the terminal tool: the REFERENCE the host's find bar (step T3a, assertion find.open of terminal-find.mjs) is compared with. The rest of the terminal's body is measured by
// mock-terminal-measure.mjs, whose raw file has no find bar in it (the bar is a reading of its `hints` scenario, not a rectangle in the reference).
//
// What it measures, per engine (webkit, chromium) and viewport (1440x900, 1280x800), in a FRESH page with the mock's default context (no text scale, default density, default theme; the UI font normalized as
// probe-lib's normalizeFont does for the other probes; the page runs in UTC and en-US): the panel on the Terminal tool, one `zsh` session (Shell.panel.terminal.open on the `local/zsh` target of the host's group),
// the toolbar's Find button pressed, and then the rectangles of the bar (`.pterm__find`), the screen it sits on (`.pterm__screen`), its field (`.pterm__find > .search`) and its buttons, and the computed box
// of the bar (its position, padding, border, radius, gap). The bar is read as it opens: the field is empty, no count is written.
//
// Serve the mock first or let the script do it, as mock-terminal-measure.mjs does: without MOCK_URL it serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) on the first free port from 49475,
// and before any measurement or write it verifies the mock the browser will load against the git tree MOCK_TREE, file by file (a different, partial or unverifiable mock stops the run with nothing written). It also hashes, as git
// does, every response the browser then receives from the mock's origin and holds it to the tree's blob for its path: a file that changed after the verification, or one that is not in the tree, fails the measurement, so what is
// measured is the bytes that were verified (the browser is not served from the verified copy: the smaller design, which fails where a copy would hide). The one path with no blob, `/__modules` (the server's list of the files to
// load, made from its directory), is held to the tree by its names.
// Run:  node ui-next/shell/probes/mock-terminal-find-measure.mjs   (ENGINES=chromium or VIEWPORTS=1440x900 narrow a run: then nothing is written to the repo, the JSON goes to the temp directory)
// Writes mock-terminal-find.json (one line of compact JSON), which terminal-find.mjs reads: { mockTree, viewports, note, rules: { gap }, data: { <engine>: { <viewport>: reading } } }
// where a reading is { screen, find, field, input, buttons: [rect], names: [string], role, label, style }. Every rectangle is [x, y, w, h] in viewport px, rounded to 0.01; `rules.gap` is the space between the
// field and the first button and between neighbouring buttons, which the measurement has found to be the same everywhere (a run in which it is not stops with nothing written).
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const NAMES = ['Match case', 'Use regular expression', 'Previous match', 'Next match', 'Close find'];
const names = (key, all) => (process.env[key] ?? all.join(',')).split(',');
const engineNames = names('ENGINES', Object.keys(ENGINES));
const viewportNames = names('VIEWPORTS', Object.keys(VIEWPORTS));
for (const [what, list, known] of [
  ['ENGINES', engineNames, Object.keys(ENGINES)],
  ['VIEWPORTS', viewportNames, Object.keys(VIEWPORTS)],
]) {
  const unknown = list.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`${what} names ${unknown.join(', ')}, which is not one of ${known.join(', ')}`);
}

/** Every known name exactly once: only a run that is complete may write into the repo. */
const eachOnce = (list, known) => list.length === known.length && known.every((name) => list.filter((entry) => entry === name).length === 1);
const partial = !eachOnce(engineNames, Object.keys(ENGINES)) || !eachOnce(viewportNames, Object.keys(VIEWPORTS));
const started = Date.now();
const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
let server = null;
/** The directory that holds the copy of the mock's server.js this script runs (none when the mock is served elsewhere): removed when the script ends. */
let scratch = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory, on the first port that is free (a server that stays up for 1.5 s).
  scratch = mkdtempSync(path.join(tmpdir(), 'mock-terminal-find-'));
  const copy = path.join(scratch, 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  for (let port = 49475; port < 49495 && server === null; port += 1) {
    const child = spawn(process.execPath, [copy], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    await sleep(1500);
    if (child.exitCode === null) {
      server = child;
      url = `http://127.0.0.1:${port}/`;
    } else console.log(`port ${port} is taken`);
  }

  if (server === null) throw new Error('no free port from 49475 to 49494 for the mock server');
  console.log('serving the mock at', url);
}

/**
 * Proves the mock served at `base` is the git tree MOCK_TREE, file by file (the git blob id of each response body against the tree's). The measured numbers are written under that tree's id, so a mock of another
 * revision must never supply them. Throws when the tree cannot be read (unverifiable) or any file is missing or different; lists at most three differences. Answers the number of files and the tree's blob id of each by the
 * path the browser asks for (`/` is the page `index.html`), which `open` holds what the browser receives to.
 */
async function verifyMock(base) {
  let listing;
  try {
    // --full-tree: without it ls-tree lists only the entries under the working directory (MOCK_DIR is a subdirectory of the lab's checkout) and prints nothing.
    listing = execFileSync('git', ['-C', MOCK_DIR, 'ls-tree', '-r', '-z', '--full-tree', MOCK_TREE], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`the mock at ${base} is unverifiable: cannot read the tree ${MOCK_TREE} with git in ${MOCK_DIR} (${String(error.stderr || error.message).trim()})`);
  }

  const files = listing
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const meta = entry.slice(0, entry.indexOf('\t')).split(' ');
      return { mode: meta[0], type: meta[1], id: meta[2], file: entry.slice(entry.indexOf('\t') + 1) };
    });
  if (files.length === 0 || files.some((entry) => entry.type !== 'blob' || entry.mode === '120000')) throw new Error(`the mock at ${base} is unverifiable: the tree ${MOCK_TREE} is empty or holds a symlink or submodule`);
  const differences = [];
  const compare = async ({ id, file }) => {
    let reason;
    try {
      const response = await fetch(new URL(file.split('/').map(encodeURIComponent).join('/'), base));
      if (!response.ok) reason = `HTTP ${String(response.status)}`;
      else {
        const body = Buffer.from(await response.arrayBuffer());
        const got = createHash('sha1').update(`blob ${String(body.length)}\0`).update(body).digest('hex');
        if (got !== id) reason = `differs (blob ${got}, the tree has ${id})`;
      }
    } catch (error) {
      reason = `cannot be fetched (${error.message})`;
    }

    if (reason !== undefined) differences.push(`${file} ${reason}`);
  };

  const queue = [...files];
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) await compare(next);
    }),
  );
  if (differences.length > 0) {
    differences.sort();
    throw new Error(`the mock at ${base} is not the tree ${MOCK_TREE}: ${differences.slice(0, 3).join('; ')}${differences.length > 3 ? ` (and ${String(differences.length - 3)} more)` : ''}`);
  }

  const blobs = new Map(files.map(({ id, file }) => [new URL(file.split('/').map(encodeURIComponent).join('/'), base).pathname, id]));
  const index = files.find((entry) => entry.file === 'index.html');
  if (index !== undefined) blobs.set('/', index.id);
  return { count: files.length, blobs };
}

/** Page side (serialized into the page): one local shell, opened and named, until it runs. Answers its state. */
const OPEN_SESSION = async () => {
  const targets = Shell.panel.targets.list('terminal').find((group) => group.plugin === 'host').targets;
  const id = Shell.panel.terminal.open(targets.find((target) => target.id === 'local/zsh'));
  Shell.panel.sessions.rename(id, 'zsh');
  for (let round = 0; round < 100 && Shell.panel.sessions.get(id)?.state !== 'running'; round += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  return Shell.panel.sessions.get(id)?.state;
};

/** Page side: the bar, the screen it sits on, the field and the buttons. */
const READ_BAR = () => {
  const round = (value) => Math.round(value * 100) / 100;
  const rect = (element) => {
    if (!(element instanceof Element) || element.getClientRects().length === 0) return null;
    const box = element.getBoundingClientRect();
    return [round(box.x), round(box.y), round(box.width), round(box.height)];
  };

  const view = document.querySelector('#panel-body > .panel__view:not([hidden])');
  const find = view?.querySelector('.pterm__find') ?? null;
  const screen = view?.querySelector('.pterm__screen') ?? null;
  if (find === null || screen === null) return null;
  const buttons = [...find.querySelectorAll('button')];
  const style = getComputedStyle(find);
  return {
    screen: rect(screen),
    find: rect(find),
    field: rect(find.querySelector(':scope > .search')),
    input: rect(find.querySelector('input')),
    buttons: buttons.map(rect),
    names: buttons.map((button) => button.getAttribute('aria-label')),
    role: find.getAttribute('role'),
    label: find.getAttribute('aria-label'),
    style: Object.fromEntries(['position', 'top', 'right', 'bottom', 'left', 'display', 'paddingTop', 'paddingRight', 'borderTopWidth', 'borderTopLeftRadius', 'columnGap'].map((property) => [property, style[property]])),
  };
};

/**
 * A page of the mock in a fresh context. What the browser measures must be what `verifyMock` certified, and the server could have answered differently after it did: so every request of the load stays on the mock's own origin (the
 * whole origin is compared, not the start of the address), and every response of that origin is hashed as the tree's files are, by the path it was asked for, against `blobs`. `page.received()` says what was not the tree's.
 * One path has no blob: `/__modules` is made by the server when it is asked (the list of the files to load, in their order, from its directory). It is held to the tree by its names, each of which must be a file of the tree: a file the
 * directory has and the tree has not is a name the list gives and the tree lacks, and what it lists is fetched and hashed like any other (the order is the verified server's own).
 */
async function open(browser, viewport, blobs) {
  const context = await browser.newContext({ viewport, timezoneId: 'UTC', locale: 'en-US' });
  try {
    const page = await context.newPage();
    const origin = new URL(url).origin;
    const foreign = [];
    page.on('request', (request) => {
      if (/^(data|blob|about):/.test(request.url())) return;
      if (new URL(request.url()).origin !== origin) foreign.push(request.url());
    });
    const received = [];
    const unverified = [];
    page.on('response', (response) => {
      const address = new URL(response.url());
      if (address.origin !== origin || response.status() !== 200) return;
      received.push(
        response.body().then(
          (body) => {
            if (address.pathname === '/__modules') {
              let names;
              try {
                names = JSON.parse(body.toString('utf8'));
              } catch {
                names = undefined;
              }

              const strangers = Array.isArray(names) ? names.filter((name) => !blobs.has(`/${String(name).split('/').map(encodeURIComponent).join('/')}`)) : ['(not a list of names)'];
              if (strangers.length > 0) unverified.push(`${address.pathname} lists ${strangers.slice(0, 3).join(', ')}, which ${strangers.length === 1 ? 'is' : 'are'} not in the tree`);
              return;
            }

            const id = createHash('sha1').update(`blob ${String(body.length)}\0`).update(body).digest('hex');
            const want = blobs.get(address.pathname);
            if (want === undefined) unverified.push(`${address.pathname} is not a file of the tree`);
            else if (id !== want) unverified.push(`${address.pathname} reached the browser as blob ${id}, the tree has ${want}`);
          },
          (error) => {
            unverified.push(`${address.pathname} could not be read back (${error.message})`);
          },
        ),
      );
    });
    page.received = async () => {
      await Promise.all(received);
      return unverified;
    };

    await page.goto(url, { waitUntil: 'load' });
    if (new URL(page.url()).origin !== origin) throw new Error(`the mock at ${url} sent the browser to ${page.url()}: that document is not the one verifyMock certified`);
    if (foreign.length > 0) throw new Error(`the mock at ${url} loaded ${foreign.slice(0, 3).join(', ')} from outside its own origin: what is measured is not only the tree verifyMock certified`);
    await page.waitForFunction(() => typeof Shell !== 'undefined' && Shell.panel?.show !== undefined && Shell.panel.terminal !== undefined);
    await sleep(1500);
    await normalizeFont(page, { rootVar: '--int-font-ui' });
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** The bar of the mock at one viewport in one engine. The reading is given only when everything the browser received from the mock was the tree's bytes. */
async function measure(browser, viewport, blobs) {
  const page = await open(browser, viewport, blobs);
  try {
    await page.evaluate(() => {
      Shell.panel.show('terminal');
    });
    await sleep(700);
    const state = await page.evaluate(OPEN_SESSION);
    if (state !== 'running') throw new Error(`the session is ${String(state)}, not running`);
    await sleep(500);
    await page.click('#panel-body > .panel__view:not([hidden]) .panel__tools button[aria-label="Find"]');
    await page.waitForSelector('#panel-body > .panel__view:not([hidden]) .pterm__find');
    await sleep(600);
    const reading = await page.evaluate(READ_BAR);
    const unverified = await page.received();
    if (unverified.length > 0) throw new Error(`what the browser received from the mock is not the tree ${MOCK_TREE}: ${unverified.slice(0, 3).join('; ')}${unverified.length > 3 ? ` (and ${String(unverified.length - 3)} more)` : ''}`);
    return reading;
  } finally {
    await page.context().close();
  }
}

/** What a reading must hold to be the bar: its parts, its five buttons in order, and the same space between its neighbours. Answers a problem, or null. */
function problem(reading) {
  if (reading === null) return 'the bar or the screen is not there';
  if (reading.find === null || reading.screen === null || reading.field === null) return 'the bar, the screen or the field is not laid out';
  if (JSON.stringify(reading.names) !== JSON.stringify(NAMES)) return `the buttons are ${JSON.stringify(reading.names)}, not ${JSON.stringify(NAMES)}`;
  if (reading.buttons.some((rect) => rect === null)) return 'a button is not laid out';
  return null;
}

/** The space between the field and the first button and between neighbouring buttons, left to right. */
const gapsOf = (reading) => {
  const items = [reading.field, ...reading.buttons].sort((a, b) => a[0] - b[0]);
  return items.slice(1).map((rect, index) => Math.round((rect[0] - (items[index][0] + items[index][2])) * 100) / 100);
};

if (process.env.MOCK_VERIFY_ONLY) {
  try {
    console.log(`the mock at ${url} is the tree ${MOCK_TREE} (${String((await verifyMock(url)).count)} files)`);
  } finally {
    server?.kill();
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  }

  process.exit(0);
}

const data = {};
let failed = false;
const everyGap = new Set();
// The server this script started (no MOCK_URL) and every browser it launched are closed whatever happens.
try {
  const { blobs } = await verifyMock(url);
  for (const engineName of engineNames) {
    const browser = await launch(engineName);
    try {
      data[engineName] = {};
      for (const viewportName of viewportNames) {
        const reading = await measure(browser, VIEWPORTS[viewportName], blobs);
        const wrong = problem(reading);
        if (wrong !== null) {
          console.log('MISSING', engineName, viewportName, wrong);
          failed = true;
        } else for (const gap of gapsOf(reading)) everyGap.add(gap);

        data[engineName][viewportName] = reading;
        console.log(engineName, viewportName, wrong === null ? 'ok' : 'FAILED', wrong === null ? JSON.stringify({ find: reading.find, screen: reading.screen, gaps: gapsOf(reading) }) : '', Math.round((Date.now() - started) / 1000), 's');
      }
    } finally {
      await browser.close();
    }
  }

  if (!failed && everyGap.size !== 1) {
    console.log(`FAILED: the space between the bar's parts is not one number: ${JSON.stringify([...everyGap])}`);
    failed = true;
  }

  const text = `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, note: 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. The bar as it opens: the field is empty.', rules: { gap: [...everyGap][0] ?? null }, data })}\n`;
  // The reference is replaced only by a complete measurement (every engine and viewport): a partial run or a run that missed a part writes what it read to the temp directory.
  const file = failed || partial ? path.join(tmpdir(), 'mock-terminal-find.partial.json') : path.join(here, 'mock-terminal-find.json');
  writeFileSync(file, text);
  console.log('wrote', file, String(statSync(file).size), 'bytes', Math.round((Date.now() - started) / 1000), 's');
  if (failed) {
    console.log('FAILED: mock-terminal-find.json is unchanged');
    process.exitCode = 1;
  } else if (partial) console.log('partial run: mock-terminal-find.json is unchanged');
} finally {
  server?.kill();
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
}

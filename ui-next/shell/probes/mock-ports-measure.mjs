// Measures the design mock's PORTS tool of the bottom panel: the REFERENCE the host's Ports tool (step PF1, ports.mjs) is compared with.
//
// What it measures, per engine (webkit, chromium) and viewport (1440x900, 1280x800), in a FRESH page with the mock's default context (no text scale, default density, default theme; the UI font normalized as probe-lib's normalizeFont
// does for the other probes, which leaves the CODE face of the mapping as the mock draws it; the page runs in UTC and en-US). The data is the probe's OWN: a producer (`probe.forwards`, registered through Shell.panel.producers.register) and
// a provider that adds the Connection column, so the rows are exactly what the probe made, as the Logs toolbar's measurement does (mock-logs-toolbar-measure.mjs). Three scenarios:
//   - table:  the panel on Ports at its DEFAULT height with five forwards: running (8081 to 8080), stopped (an exited one), failed (with its cause and next step, which the mock draws as the second line of the Resource cell),
//             stopping (Stop pressed, the producer never answers) and one whose name is longer than the 44 characters the mock keeps whole. The panel, the scroller, the table, the header row and every header cell, every row and every cell
//             of it (rectangle, padding, font, colour), the Resource cell's name and second line, the mapping's text and the width of its text, the state (its icon, its word, the glyph's name from the mock's own role table, the paint of its
//             paths), the row's actions (every button's rectangle, name, tab stop, disabled state, tooltip and glyph box, the gaps between them and the room to the end of the row), and the footer (its text, rectangle and style).
//   - empty:  the same panel with no forward: the empty state's rectangle, its glyph, its title and its hint (words and fonts), and every button the panel draws in it (the mock offers one that the host's tool does not: the difference is
//             recorded in docs/ui-next/status/PF1.md, section 3).
//   - keys:   the keyboard in a row of the table: Tab from the first button, the arrows, Home and End (which button has the focus after each), and whether Tab leaves the row's buttons for the next row's.
//   - bare:   the table again with no connection named (a dash in the Connection column): the mock fits a dash to its header and stretches a name (a text column takes a share of the free room), so the columns stand elsewhere.
//   - copy:   Copy address pressed on the running forward: what reaches the clipboard, what the polite live region is told, and the glyph of the button while the confirmation shows and after it (the mock confirms for two seconds).
// WebKit also writes the screenshots of the three (SHOTS: /Users/joshuapare/Notes/omniview/ui-migration/status/PF1-assets/, SHOTS_DIR overrides): mock-ports-table-webkit-<viewport>.png and mock-ports-empty-webkit-<viewport>.png.
//
// Serve the mock first or let the script do it, as mock-terminal-find-measure.mjs does: without MOCK_URL it serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) on the first free port from 49475, and before any measurement
// or write it verifies the mock the browser will load against the git tree MOCK_TREE, file by file (a different, partial or unverifiable mock stops the run with nothing written). It also hashes, as git does, every response the browser then
// receives from the mock's origin and holds it to the tree's blob for its path: a file that changed after the verification, or one that is not in the tree, fails the measurement, so what is measured is the bytes that were verified (the
// browser is not served from the verified copy: the smaller design, which fails where a copy would hide). The one path with no blob, `/__modules` (the server's list of the files to load, made from its directory), is held to the tree by its names.
// Run:  node ui-next/shell/probes/mock-ports-measure.mjs   (ENGINES=chromium or VIEWPORTS=1440x900 narrow a run: then nothing is written to the repo, the JSON goes to the temp directory; MOCK_VERIFY_ONLY=1 verifies the mock and stops)
// Writes mock-ports.json (one line of compact JSON), which ports.mjs reads: { mockTree, viewports, note, probe, data: { <engine>: { <viewport>: { table, empty, keys, copy, bare } } } } (`bare`: where the columns stand when no connection is named). Every rectangle is [x, y, w, h] in viewport px, rounded to 0.01.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const SHOTS = process.env.SHOTS_DIR ?? '/Users/joshuapare/Notes/omniview/ui-migration/status/PF1-assets';
/** The photographs are taken here and published to SHOTS only when the whole measurement has passed: a run that fails or is cut short leaves the baseline images it found where they were. */
const STAGE = mkdtempSync(path.join(tmpdir(), 'mock-ports-shots-'));
function publishShots() {
  mkdirSync(SHOTS, { recursive: true });
  for (const name of readdirSync(STAGE)) copyFileSync(path.join(STAGE, name), path.join(SHOTS, name));
}
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
/** The directory that holds the copy of the mock's server this script runs (none when the mock is served elsewhere): removed when the script ends. */
let scratch = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server with `root` set to the mock directory, on the first port that is free (a server that stays up for 1.5 s).
  scratch = mkdtempSync(path.join(tmpdir(), 'mock-ports-'));
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
    /** The requests of the mock's own origin that have not ended: from the request until the body of its answer is read or its failure is recorded. */
    const pending = new Set();
    page.on('request', (request) => {
      if (/^(data|blob|about):/.test(request.url())) return;
      if (new URL(request.url()).origin !== origin) foreign.push(request.url());
      else pending.add(request);
    });
    const received = [];
    const unverified = [];
    page.on('response', (response) => {
      const address = new URL(response.url());
      if (address.origin !== origin) return;
      if (response.status() !== 200) {
        // A file of the tree (or the list of them) that the browser did not get is a page drawn without it: a face that fell back, a script that never ran. It is a failure of the verification and not a response to skip.
        if (blobs.has(address.pathname) || address.pathname === '/__modules') unverified.push(`${address.pathname} answered ${String(response.status())}, not 200`);
        pending.delete(response.request());
        return;
      }
      received.push(
        response.body().then(
          (body) => {
            if (address.pathname === '/__modules') {
              let listed;
              try {
                listed = JSON.parse(body.toString('utf8'));
              } catch {
                listed = undefined;
              }

              const strangers = Array.isArray(listed) ? listed.filter((name) => !blobs.has(`/${String(name).split('/').map(encodeURIComponent).join('/')}`)) : ['(not a list of names)'];
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
        ).finally(() => {
          pending.delete(response.request());
        }),
      );
    });
    page.on('requestfailed', (request) => {
      const address = new URL(request.url());
      pending.delete(request);
      if (address.origin === origin && (blobs.has(address.pathname) || address.pathname === '/__modules')) unverified.push(`${address.pathname} could not be loaded (${request.failure()?.errorText ?? 'no reason given'})`);
    });
    // The verdict is read at the end of the scenario: what was asked of another origin while the panel was opened and read counts as much as what was asked at the load.
    page.received = async () => {
      // Every request of the mock's origin has ended before the verdict is read, those that begin while it waits too: a body that is still on its way is not one that matched. One that does not end in 10 s is a failure of the verification.
      const deadline = Date.now() + 10_000;
      for (;;) {
        const count = received.length;
        await Promise.all(received);
        if ((pending.size === 0 && received.length === count) || Date.now() > deadline) break;
        await sleep(50);
      }

      const open = [...pending].map((request) => `${new URL(request.url()).pathname} had not ended when the verdict was read`);
      return [...unverified, ...open, ...foreign.map((address) => `${address} is outside the mock's origin`)];
    };

    await page.goto(url, { waitUntil: 'load' });
    if (new URL(page.url()).origin !== origin) throw new Error(`the mock at ${url} sent the browser to ${page.url()}: that document is not the one verifyMock certified`);
    if (foreign.length > 0) throw new Error(`the mock at ${url} loaded ${foreign.slice(0, 3).join(', ')} from outside its own origin: what is measured is not only the tree verifyMock certified`);
    await page.waitForFunction(() => typeof Shell !== 'undefined' && Shell.panel?.show !== undefined && Shell.ports !== undefined);
    await sleep(1500);
    await normalizeFont(page, { rootVar: '--int-font-ui' });
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** The forwards the probe makes, in this order, and what each does. `cause` and `next` are what a failed forward says. The first is 40 characters shorter than the long one. */
const FORWARDS = [
  { label: 'api-server', local: 8081, remote: 8080, mode: 'running' },
  { label: 'old-gateway', local: 8090, remote: 80, mode: 'exited' },
  { label: 'broken-proxy', local: 8082, remote: 80, mode: 'failed', cause: 'Port 8082 is in use on this computer.', next: 'Use port 8083 instead.' },
  { label: 'batch-worker', local: 9000, remote: 9000, mode: 'stopping' },
  { label: 'payments-service-deployment-7d8c6f49b-f8q4m-with-a-very-long-resource-name-that-must-be-cut', local: 8100, remote: 8100, mode: 'running' },
];

/**
 * Page side (serialized into the page): the probe's producer and provider, and one session for each of `forwards`. The producer answers running at once, or exited, or failed with its cause, as the forward says; a forward that is to stop is
 * stopped, and the producer never answers the stop, so the session says Stopping for as long as the page lives. Answers the session ids by label.
 */
const MAKE = async ({ forwards, named }) => {
  Shell.panel.producers.register({
    id: 'probe.forwards',
    plugin: 'host',
    kinds: ['port-forward'],
    card: (session) => ({ resource: { label: session.target.label } }),
    start: async ({ target, sink }) => {
      if (target.mode === 'failed') sink.state({ state: 'failed', cause: target.cause, next: target.next });
      else {
        sink.state({ state: 'running', endpoint: `http://127.0.0.1:${target.ports[0].local}`, certainty: 'known' });
        if (target.mode === 'exited') sink.state({ state: 'exited', certainty: 'known' });
      }

      return { target };
    },
    reconnect: async () => undefined,
    stop: () => new Promise(() => undefined),
    dispose: () => undefined,
  });
  Shell.ports.registerProvider('probe', { label: 'Probe', launch: () => true, columns: [{ id: 'connection', label: 'Connection', value: (session) => session.target.group }] });
  const ids = {};
  for (const forward of forwards) {
    ids[forward.label] = Shell.panel.open({
      tool: 'ports',
      toolTitle: 'Ports',
      kind: 'port-forward',
      producer: 'probe.forwards',
      focus: false,
      target: {
        provider: 'probe',
        plugin: 'host',
        label: forward.label,
        connection: 'Staging',
        group: named ? 'Staging' : '',
        mode: forward.mode,
        cause: forward.cause,
        next: forward.next,
        ports: [{ local: forward.local, remote: forward.remote, protocol: 'TCP' }],
        options: { protocol: 'TCP', localPort: forward.local, remotePort: forward.remote, bindAddress: '127.0.0.1' },
      },
    });
  }

  for (const forward of forwards) {
    if (forward.mode === 'stopping') {
      for (let round = 0; round < 100 && Shell.panel.sessions.get(ids[forward.label])?.state !== 'running'; round += 1) await new Promise((resolve) => setTimeout(resolve, 50));
      void Shell.panel.sessions.stop(ids[forward.label], { reason: 'user' });
    }
  }

  return ids;
};

/** Page side: the panel opened on Ports with the forwards shown, waited for until every session has the state its forward says (a stopping one says so, a failed one has its cause). */
const SHOW = async (forwards) => {
  Shell.panel.show('ports');
  const want = (forward) => (forward.mode === 'stopping' ? (session) => session.stopping !== '' : forward.mode === 'exited' ? (session) => session.state === 'exited' : forward.mode === 'failed' ? (session) => session.state === 'failed' : (session) => session.state === 'running' && session.stopping === '');
  for (let round = 0; round < 200; round += 1) {
    const sessions = Shell.panel.sessions.list('ports', null);
    if (forwards.every((forward) => sessions.some((session) => session.label === forward.label && want(forward)(session)))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return false;
};

/**
 * Page side: a helper that says which glyphs of the mock's registry a drawing is (`window.__glyphOf(svg)`: the names whose own markup it is, none for a glyph the mock paints from its theme). The mock's buttons draw their glyphs from its
 * registry and keep no name in the document, so the name is found by drawing every glyph of the registry and comparing the markup.
 */
const INSTALL = () => {
  /** A drawing's identity: its elements and their attributes, with the attributes in name order, so that the order a node was made in does not tell two drawings of one glyph apart. */
  const signature = (element) => `<${element.tagName.toLowerCase()} ${[...element.attributes].map((attribute) => `${attribute.name}=${attribute.value}`).sort().join(' ')}>${[...element.children].map(signature).join('')}</>`;
  const holder = document.createElement('div');
  const drawn = new Map(
    Object.keys(window.ICONS ?? {}).map((name) => {
      holder.innerHTML = icon(name, 16);
      const svg = holder.querySelector('svg');
      return [name, svg === null ? '' : signature(svg)];
    }),
  );
  window.__glyphOf = (svg) => (svg === null || svg === undefined ? [] : [...drawn].filter(([, own]) => own === signature(svg)).map(([name]) => name));
};

/** Page side: what the table, its header, its rows, its footer and the panel around them are. */
const READ_TABLE = (roles) => {
  const round = (value) => Math.round(value * 100) / 100;
  const view = document.querySelector('#panel-body > .panel__view:not([hidden])');
  const rect = (element) => {
    if (!(element instanceof Element) || element.getClientRects().length === 0) return null;
    const box = element.getBoundingClientRect();
    return [round(box.x), round(box.y), round(box.width), round(box.height)];
  };

  const css = (element, props) => {
    if (!(element instanceof Element)) return null;
    const computed = getComputedStyle(element);
    return Object.fromEntries(props.map((prop) => [prop, computed.getPropertyValue(prop)]));
  };

  const BOX = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-bottom-width', 'vertical-align'];
  const TEXT = ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'letter-spacing', 'white-space', 'text-overflow'];
  const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** The width of the text itself (its range), which a cell's own width, made of the column's, does not say. */
  const textWidth = (element) => {
    if (!(element instanceof Element)) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    return round(range.getBoundingClientRect().width);
  };

  /** The box of the words in an element (its text nodes, and not a button or a glyph beside them): where the text starts, which is what the padding of a cell is for. */
  const textBox = (element) => {
    if (!(element instanceof Element)) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if ((node.textContent ?? '').trim() === '') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const part of range.getClientRects()) {
        left = Math.min(left, part.left);
        top = Math.min(top, part.top);
        right = Math.max(right, part.right);
        bottom = Math.max(bottom, part.bottom);
      }
    }

    return left === Infinity ? null : [round(left), round(top), round(right - left), round(bottom - top)];
  };

  const paint = (svg) => [...(svg?.querySelectorAll('path, circle, rect') ?? [])].map((shape) => ({ fill: getComputedStyle(shape).fill, stroke: getComputedStyle(shape).stroke }));
  const body = view?.querySelector('.data-view__body') ?? null;
  const table = view?.querySelector('table') ?? null;
  const head = [...(table?.querySelectorAll('thead th') ?? [])];
  const rows = [...(table?.querySelectorAll('tbody tr') ?? [])].map((row) => {
    const cells = [...row.children];
    const [resource, mapping, connection, state, actions] = cells;
    const name = resource?.querySelector('.cell2 > b') ?? null;
    const sub = resource?.querySelector('.cell2 > small') ?? null;
    const word = state?.querySelector('.resource-state') ?? null;
    const glyph = word?.querySelector('.resource-state__icon svg') ?? null;
    const buttons = [...(actions?.querySelectorAll('button') ?? [])];
    return {
      name: text(name),
      rect: rect(row),
      cells: cells.map((cell) => ({ rect: rect(cell), content: textBox(cell), box: css(cell, BOX), text: css(cell, TEXT) })),
      resource: { name: css(name, TEXT), sub: sub === null ? null : { text: text(sub), rect: rect(sub), style: css(sub, TEXT) }, nameWidth: textWidth(name), clipped: resource?.querySelector('.pmid') !== null },
      mapping: { text: text(mapping), width: textWidth(mapping), style: css(mapping, TEXT) },
      connection: { text: text(connection), style: css(connection, TEXT) },
      state: word === null ? null : { role: word.getAttribute('data-state-role'), icon: roles[word.getAttribute('data-state-role')] ?? null, word: text(word), rect: rect(word), glyph: rect(glyph), iconBox: rect(word.querySelector('.resource-state__icon')), label: rect(word.querySelector('.resource-state__label')), labelStyle: css(word.querySelector('.resource-state__label'), TEXT), paint: paint(glyph), iconColor: css(word.querySelector('.resource-state__icon'), ['color']) },
      group: { rect: rect(actions?.querySelector('.rove')), label: actions?.querySelector('.rove')?.getAttribute('aria-label') ?? null },
      buttons: buttons.map((button) => ({
        label: button.getAttribute('aria-label'),
        rect: rect(button),
        svg: rect(button.querySelector('svg')),
        glyph: window.__glyphOf(button.querySelector('svg')),
        tabindex: button.getAttribute('tabindex'),
        disabled: button.getAttribute('aria-disabled') === 'true',
        reason: button.getAttribute('data-tooltip-reason'),
        tip: button.getAttribute('data-tooltip'),
        style: css(button, ['color', 'background-color', 'border-top-width', 'border-top-left-radius']),
      })),
    };
  });
  const footer = view?.querySelector('.data-view__footer') ?? null;
  const panel = document.querySelector('#shell-panel');
  return {
    panel: rect(panel),
    content: rect(view?.querySelector('.panel__content') ?? null),
    body: rect(body),
    scroll: body === null ? null : { client: [body.clientWidth, body.clientHeight], scroll: [body.scrollWidth, body.scrollHeight] },
    table: rect(table),
    // Where each column stands: its left edge, its width and how far its left edge is from the right edge of the table (the width of it and every column after it): the mock fits the columns after Resource to their content, so this is what a column's content and its header make.
    columns: head.map((cell, index) => {
      const box = cell.getBoundingClientRect();
      const tableBox = table.getBoundingClientRect();
      return { column: ['resource', 'mapping', 'connection', 'status', 'actions'][index], x: round(box.x), width: round(box.width), fromRight: round(tableBox.right - box.x) };
    }),
    tableStyle: css(table, ['border-collapse', 'border-spacing', 'table-layout', 'width']),
    head: { rect: rect(table?.querySelector('thead tr')), cells: head.map((cell) => ({ text: text(cell).replace(/Resize .* column.*/, ''), rect: rect(cell), content: textBox(cell), handle: rect(cell.querySelector('.column-resize')), box: css(cell, BOX), style: css(cell, TEXT), border: css(cell, ['border-bottom-width', 'border-bottom-color', 'border-bottom-style', 'background-color', 'position', 'top']) })) },
    rows,
    footer: footer === null ? null : { rect: rect(footer), text: text(footer), count: { text: text(footer.querySelector('.collection-count')), rect: rect(footer.querySelector('.collection-count')), style: css(footer.querySelector('.collection-count'), TEXT) }, box: css(footer, ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'min-height', 'border-top-width', 'border-top-color', 'background-color']) },
    roles,
  };
};

/** Page side: the empty state, its glyph, its words, and every button the panel draws in it. */
const READ_EMPTY = () => {
  const round = (value) => Math.round(value * 100) / 100;
  const view = document.querySelector('#panel-body > .panel__view:not([hidden])');
  const rect = (element) => {
    if (!(element instanceof Element) || element.getClientRects().length === 0) return null;
    const box = element.getBoundingClientRect();
    return [round(box.x), round(box.y), round(box.width), round(box.height)];
  };

  const css = (element, props) => (element instanceof Element ? Object.fromEntries(props.map((prop) => [prop, getComputedStyle(element).getPropertyValue(prop)])) : null);
  const TEXT = ['font-family', 'font-size', 'font-weight', 'line-height', 'color'];
  const empty = view?.querySelector('.empty2') ?? null;
  const parts = [...(empty?.children ?? [])].map((part) => ({ tag: part.tagName.toLowerCase(), cls: part.className, text: (part.textContent ?? '').trim(), rect: rect(part), style: css(part, TEXT) }));
  const footer = view?.querySelector('.data-view__footer') ?? null;
  return {
    panel: rect(document.querySelector('#shell-panel')),
    body: rect(view?.querySelector('.data-view__body') ?? null),
    empty: rect(empty),
    parts,
    buttons: [...(empty?.querySelectorAll('button') ?? [])].map((button) => ({ text: (button.textContent ?? '').trim(), label: button.getAttribute('aria-label'), rect: rect(button) })),
    footer: footer === null ? null : { rect: rect(footer), text: (footer.textContent ?? '').trim() },
    table: view?.querySelector('table') !== null,
  };
};

/** The mock's keyboard in a row of the table, as a person drives it: Tab into the first row's buttons, the arrows, Home and End, and a Tab out. Each reading is the button that has the focus. */
async function readKeys(page) {
  const where = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      const row = active?.closest('tbody tr') ?? null;
      return { label: active?.getAttribute('aria-label') ?? active?.tagName ?? null, row: row === null ? null : (row.querySelector('.cell2 > b')?.textContent ?? '').trim() };
    });
  const stops = await page.evaluate(() => [...document.querySelectorAll('#panel-body > .panel__view:not([hidden]) tbody tr')].map((row) => [...row.querySelectorAll('button')].filter((button) => button.getAttribute('tabindex') === '0').length));
  await page.evaluate(() => document.querySelector('#panel-body > .panel__view:not([hidden]) tbody tr button[aria-label="Stop"]')?.focus());
  const steps = [];
  for (const key of ['ArrowRight', 'ArrowRight', 'End', 'Home', 'ArrowLeft', 'Tab']) {
    await page.keyboard.press(key);
    steps.push({ key, ...(await where()) });
  }

  return { stops, steps };
}

/**
 * Copy address pressed on the first forward, as a person does with the pointer: the clipboard is the page's own stand-in (what it is given is kept), the live region's words are what the mock announces, and the glyph of the button is read
 * while the confirmation shows (after 300 ms) and again once it is over (after 2.6 s).
 */
const COPY = async () => {
  const clip = [];
  const told = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { clip.push(String(text)); }, readText: async () => '' } });
  Shell.on('announce', (event) => told.push(event.text));
  const button = document.querySelector('#panel-body > .panel__view:not([hidden]) tbody tr:first-child button[aria-label="Copy address"]');
  const glyph = () => window.__glyphOf(document.querySelector('#panel-body > .panel__view:not([hidden]) tbody tr:first-child button[aria-label="Copy address"] svg'));
  const before = glyph();
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const during = glyph();
  await new Promise((resolve) => setTimeout(resolve, 2300));
  return { before, during, after: glyph(), clip, told };
};

/** One scenario at one viewport in one engine: a fresh page of the mock, the forwards made (or none), the panel shown, and the reading. The reading is given only when everything the browser received from the mock was the tree's bytes. */
async function measure(browser, viewport, blobs, engineName, viewportName, scenario) {
  const page = await open(browser, viewport, blobs);
  try {
    const forwards = scenario === 'empty' ? [] : FORWARDS;
    const ids = await page.evaluate(MAKE, { forwards, named: scenario !== 'bare' });
    if (forwards.length > 0) {
      const settled = await page.evaluate(SHOW, forwards);
      if (!settled) throw new Error('the sessions did not reach the states the forwards say');
    } else {
      await page.evaluate(() => {
        Shell.panel.show('ports');
      });
    }

    await sleep(900);
    // The mock raises a toast for a forward that failed and for one that is stopping, which cover the table: they are dismissed, so that what is read and photographed is the table.
    await page.evaluate(() => {
      Shell.toasts.dismissAll();
    });
    await page.evaluate(INSTALL);
    await sleep(400);
    await page.mouse.move(1, 1);
    const roles = await page.evaluate(() => Object.fromEntries(['running', 'stopped', 'error', 'progress'].map((role) => [role, H.statusRoles[role].icon])));
    const reading = scenario === 'table' || scenario === 'bare' ? await page.evaluate(READ_TABLE, roles) : scenario === 'empty' ? await page.evaluate(READ_EMPTY) : scenario === 'copy' ? await page.evaluate(COPY) : await readKeys(page);
    const unverified = await page.received();
    if (unverified.length > 0) throw new Error(`what the browser received from the mock is not the tree ${MOCK_TREE}: ${unverified.slice(0, 3).join('; ')}${unverified.length > 3 ? ` (and ${String(unverified.length - 3)} more)` : ''}`);
    if (engineName === 'webkit' && (scenario === 'table' || scenario === 'empty') && !partial) {
      await page.screenshot({ path: path.join(STAGE, `mock-ports-${scenario}-webkit-${viewportName}.png`) });
    }

    return { reading, ids };
  } finally {
    await page.context().close();
  }
}

/** What a reading of the table must hold to be the table: its five columns, one row for each forward with the glyph and the word of its state, and every row's buttons. Answers a problem, or null. */
function problem(table, connection = 'Staging') {
  if (table.rows.length !== FORWARDS.length) return `the table has ${String(table.rows.length)} rows, not ${String(FORWARDS.length)}`;
  const columns = table.head.cells.map((cell) => cell.text);
  if (JSON.stringify(columns) !== JSON.stringify(['Resource', 'Mapping', 'Connection', 'Status', 'Actions'])) return `the columns are ${JSON.stringify(columns)}`;
  const words = Object.fromEntries(table.rows.map((row) => [row.name.slice(0, 12), row.state?.word]));
  if (JSON.stringify(Object.values(words)) !== JSON.stringify(['Running', 'Stopped', 'Failed', 'Stopping', 'Running'])) return `the states are ${JSON.stringify(words)}`;
  if (table.columns.length !== 5 || table.columns.some((column) => column.fromRight <= 0)) return `the columns are not all laid out: ${JSON.stringify(table.columns)}`;
  if (table.rows.some((row) => row.connection.text !== connection)) return `the Connection column does not say ${JSON.stringify(connection)}: ${JSON.stringify(table.rows.map((row) => row.connection.text))}`;
  if (table.rows.some((row) => row.buttons.length < 3 || row.rect === null || row.state?.glyph === null)) return 'a row has no buttons, no rectangle or no glyph';
  if (table.footer === null || table.footer.count.text !== `${String(FORWARDS.length)} forwards`) return `the footer counts ${JSON.stringify(table.footer?.count.text)}`;
  return null;
}

/** What a reading of Copy address must hold: the address on the clipboard once, the words said once, the glyph of the copy first, another while it confirms, and the copy again once the confirmation is over. Answers a problem, or null. */
function copyProblem(reading) {
  if (JSON.stringify(reading.clip) !== JSON.stringify(['127.0.0.1:8081'])) return `the clipboard was given ${JSON.stringify(reading.clip)}, not the address once`;
  if (JSON.stringify(reading.told) !== JSON.stringify(['Address copied'])) return `the live region was told ${JSON.stringify(reading.told)}, not "Address copied" once`;
  const [before] = reading.before;
  const [during] = reading.during;
  const [after] = reading.after;
  if (before === undefined || during === undefined || after === undefined) return `a glyph of the button is not in the mock's registry: ${JSON.stringify([reading.before, reading.during, reading.after])}`;
  // The sequence the probe compares (its mapping of the mock's glyphs has the copy and the check and no other): a glyph of another name that the registry has is a mock the probe cannot read.
  if (before !== 'LuCopy' || during !== 'LuCheck' || after !== 'LuCopy') return `the button draws ${before}, then ${during} while it confirms, then ${after}: not LuCopy, LuCheck, LuCopy`;
  return null;
}

if (process.env.MOCK_VERIFY_ONLY) {
  try {
    console.log(`the mock at ${url} is the tree ${MOCK_TREE} (${String((await verifyMock(url)).count)} files)`);
  } finally {
    server?.kill();
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  rmSync(STAGE, { recursive: true, force: true });
  }

  process.exit(0);
}

const data = {};
let failed = false;
// The server this script started (no MOCK_URL) and every browser it launched are closed whatever happens.
try {
  // The place the photographs go is a directory that can be written, known before the measurement and not after it, for a run that publishes them (a partial run takes none).
  if (!partial) mkdirSync(SHOTS, { recursive: true });
  const { blobs } = await verifyMock(url);
  for (const engineName of engineNames) {
    const browser = await launch(engineName);
    try {
      data[engineName] = {};
      for (const viewportName of viewportNames) {
        const table = await measure(browser, VIEWPORTS[viewportName], blobs, engineName, viewportName, 'table');
        const empty = await measure(browser, VIEWPORTS[viewportName], blobs, engineName, viewportName, 'empty');
        // The same table with no connection named: the Connection column says a dash in every row, which the mock fits to its header and not to a share of the room (a text column with a value stretches, a dash does not), so where Mapping starts differs.
        const bare = await measure(browser, VIEWPORTS[viewportName], blobs, engineName, viewportName, 'bare');
        // A table that is complete (its rows, its five columns laid out) before its Connection cells are read: a reading with no rows has no cell that says more than a dash.
        const bareWrong = problem(bare.reading, '—');
        if (bareWrong !== null) {
          console.log('MISSING', engineName, viewportName, `the table with no connection named: ${bareWrong}`);
          failed = true;
        }

        const keys = await measure(browser, VIEWPORTS[viewportName], blobs, engineName, viewportName, 'keys');
        const copy = await measure(browser, VIEWPORTS[viewportName], blobs, engineName, viewportName, 'copy');
        const wrong = problem(table.reading);
        if (wrong !== null) {
          console.log('MISSING', engineName, viewportName, wrong);
          failed = true;
        }

        if (empty.reading.empty === null || empty.reading.table) {
          console.log('MISSING', engineName, viewportName, 'the empty state is not drawn alone');
          failed = true;
        }

        const copyWrong = copyProblem(copy.reading);
        if (copyWrong !== null) {
          console.log('MISSING', engineName, viewportName, copyWrong);
          failed = true;
        }

        data[engineName][viewportName] = { table: table.reading, empty: empty.reading, keys: keys.reading, copy: copy.reading, bare: { table: bare.reading.table, columns: bare.reading.columns, head: bare.reading.head.cells.map((cell) => ({ text: cell.text, rect: cell.rect, content: cell.content })) } };
        console.log(engineName, viewportName, wrong === null ? 'ok' : 'FAILED', wrong === null ? JSON.stringify({ rows: table.reading.rows.map((row) => row.rect?.[3]), header: table.reading.head.rect?.[3], footer: table.reading.footer?.rect?.[3] }) : '', Math.round((Date.now() - started) / 1000), 's');
      }
    } finally {
      await browser.close();
    }
  }

  const text = `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, probe: FORWARDS, note: 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. The mock default context (no text scale, default density, default theme), the UI font normalized (Helvetica, Arial). The forwards are the probe\'s own (a producer registered through the mock\'s public API), see FORWARDS.', data })}\n`;
  // The reference is replaced only by a complete measurement (every engine and viewport): a partial run or a run that missed a part writes what it read to the temp directory.
  const complete = !failed && !partial;
  const file = complete ? path.join(here, 'mock-ports.json') : path.join(tmpdir(), 'mock-ports.partial.json');
  if (complete) {
    // The photographs are published first, and the reference is put in its place last, from a file of its own beside it by a rename: a place that cannot take the photographs, or a write that fails, leaves the reference that was there as it was.
    publishShots();
    const staged = `${file}.tmp`;
    writeFileSync(staged, text);
    renameSync(staged, file);
  } else writeFileSync(file, text);
  console.log('wrote', file, String(statSync(file).size), 'bytes', Math.round((Date.now() - started) / 1000), 's');
  if (failed) {
    console.log('FAILED: mock-ports.json is unchanged');
    process.exitCode = 1;
  } else if (partial) console.log('partial run: mock-ports.json is unchanged');
} finally {
  server?.kill();
  if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  rmSync(STAGE, { recursive: true, force: true });
}

// What the sections of the Settings probe (settings-probe.mjs) share: the failure sink and the named assertions, the fixture's build and the pages the sections open, the page's side of the measurements (the commit counter, the counts of
// timers, listeners and nodes), the keyboard of an engine, and the numbers the pages are judged by. Every function that is stringified into a page says so and uses nothing of this module.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedBuild } from '../../../packages/kit/probes/build-cache.mjs';
import { normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../..');

/** The nine themes the host persists (the kit's ids). */
export const THEMES = ['void', 'dark', 'light', 'obsidian', 'carbon', 'solarized-dark', 'solarized-light', 'high-contrast-dark', 'high-contrast-light'];

/** The host's pages in the design's order, by id and by the title the sheet shows: the categories of `settings/model/testing.ts`, of which the adapter offers these six (the theme and the native application are pickers, not drawn). */
export const PAGES = [
  { id: 'appearance', title: 'Appearance' },
  { id: 'general', title: 'General' },
  { id: 'editor', title: 'Editor' },
  { id: 'terminal', title: 'Terminal' },
  { id: 'telemetry', title: 'Telemetry' },
  { id: 'developer', title: 'Developer Settings' },
];

/** The sizes of the Settings window the host makes: 1060 x 640 (`backend/window/settings.go`) and the least it may be, 960 x 600 (`backend/window/wails.go`). */
export const WINDOW_SIZES = { '1060x640': { width: 1060, height: 640 }, '960x600': { width: 960, height: 600 } };

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const round = (value) => Math.round(value * 100) / 100;
export const near = (a, b, tolerance = 0.51) => Math.abs(a - b) <= tolerance;
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// ---------------------------------------------------------------------------------------------------------------------------
// The failures. A failure is a line that starts with the name of the assertion that says it (`sheet.trap`, `page.heading.lane`): a control is named for one assertion, and it must trip it and no other.

export const state = { sink: [], checks: 0, off: undefined, notes: {} };

/** Records a failure, unless the assertion that says it is switched off (ASSERTION_OFF: the proof that a control depends on its own assertion and on no other). */
export function fail(where, id, message) {
  const line = `${id} ${where}: ${message}`;
  if (state.off === undefined || !state.off.test(line)) state.sink.push(line);
}

export function check(ok, where, id, message) {
  state.checks += 1;
  if (!ok) fail(where, id, message);
}

/** What a section tells the report: `note('<section>', key, value)`. */
export function note(section, key, value) {
  (state.notes[section] ??= {})[key] = value;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The fixture: built with the repository's own Vite configuration (settings-build.mjs), or read from FIXTURE_DIST, or from BUILD_CACHE (`<dir>/settings-fixture/<mode>`: the shard runner gives every process of a shard the same one, so
// the controls and the probe build it once, packages/kit/probes/build-cache.mjs). The build never sees the control the process runs.

export function buildFixture(mode = 'production') {
  const existing = process.env.FIXTURE_DIST;
  if (existing !== undefined && existing !== '') return existing;
  return sharedBuild({ kind: 'settings-fixture', mode, build: (out, env) => execFileSync('node', [path.join(here, 'settings-build.mjs'), out, mode], { cwd: repo, env: { ...env, OMNIVIEW_UI: 'next', NODE_ENV: mode }, stdio: 'pipe' }) });
}

// ---------------------------------------------------------------------------------------------------------------------------
// The pages the sections open.

/**
 * Opens the fixture in a fresh context at `viewport`: the errors of the page collected (a page error, a console error, a response that is not a 404 of the host's own `/wails/` calls, which a static server does not serve), the init
 * scripts added before the page's own, the first frame waited for. `query` is the fixture's address (`case=sheet&host=ok`), `ready` the selector that says the page is drawn. `fonts`: `normalize` puts the UI font as the shell probes do
 * (the measured pages), `none` leaves the page's own fonts and timers alone (the pages whose timers and frames are counted).
 */
export async function openFixture(env, query, { viewport, init = [], ready, fonts = 'normalize', theme } = {}) {
  const context = await env.browser.newContext({ viewport: viewport ?? env.viewport });
  const page = await context.newPage();
  // Every wait of a section has a deadline of its own: a step that cannot be done is a failure of the section, soon, and not the end of the run.
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text().slice(0, 200));
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico') && !response.url().includes('/wails/')) errors.push(`${response.status()} ${response.url()}`);
  });
  for (const script of init) await page.addInitScript(script);
  const themed = theme === undefined ? '' : `&theme=${theme}`;
  await page.goto(`${env.origin}/shell/probes/settings-fixture.html?${query}${themed}`, { waitUntil: 'load' });
  await page.waitForSelector(ready ?? (query.includes('case=window') ? '[data-settings-part="window"]' : '[data-shell-part="window"]'), { timeout: 10_000 });
  if (fonts === 'normalize') await normalizeFont(page, { rootVar: '--ov-font-ui' });
  return { page, context, errors };
}

/** The chord that opens Settings in this page: Command comma on a Mac, Control comma elsewhere (the page decides by `navigator.platform`, as the shell does). */
export async function chordOf(page) {
  return (await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+Comma' : 'Control+Comma';
}

/** The key that closes a window on this platform: Command W on a Mac, Control W elsewhere. */
export async function closeChordOf(page) {
  return (await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+w' : 'Control+w';
}

/** Opens the sheet with the chord and waits for its rows. Answers when the first page's rows are in the document. */
export async function openSheet(page) {
  await page.keyboard.press(await chordOf(page));
  await page.waitForSelector('dialog[open] [data-settings-row]', { timeout: 10_000 });
}

/** Chooses a page of the open Settings (a sheet or the window) by pressing its button, and waits until the page is the one on screen. */
export async function goToPage(page, id) {
  await page.locator(`[data-settings-part="nav"] [data-settings-page="${id}"]`).click();
  // `attached`, not visible: Playwright's WebKit does not call a page's section visible when it is taller than the pane that scrolls it (its header and rows are).
  await page.waitForSelector(`[data-settings-part="page"][data-settings-page-id="${id}"]`, { state: 'attached', timeout: 5000 });
}

/** The window's own page told to show: the host's `OpenSettings(target)` (a new request id and the target) and the event that reaches the page. Answers when the rows are in. */
export async function showWindow(page, target = '/settings?category=terminal', requestId = 1) {
  await page.evaluate(([to, id]) => window.__windows.emit({ requestId: id, target: to, visible: true }), [target, requestId]);
  await page.waitForSelector('[data-settings-part="window"][data-visible="true"] [data-settings-row]', { timeout: 10_000 });
}

/**
 * The Tab key of an engine on this platform: WebKit on a Mac reaches a button with Option and Tab (the system's "Press Tab to highlight each item" is off), the others with Tab (the native window sets `tabFocusesLinks`, decision A14).
 * Found by trying it, once, in a page of its own.
 */
export async function tabKeys(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent('<button id="a">a</button><button id="b">b</button>');
  await page.focus('#a');
  await page.keyboard.press('Tab');
  const plain = await page.evaluate(() => document.activeElement?.id === 'b');
  await context.close();
  return plain ? { forward: 'Tab', backward: 'Shift+Tab' } : { forward: 'Alt+Tab', backward: 'Alt+Shift+Tab' };
}

/** A short name of what has the focus: an element's accessible name, its label or its text. Runs in the page. */
export const WHO = () => {
  const element = document.activeElement;
  if (element === null || element === document.body) return 'body';
  const labelled = element.getAttribute('aria-label') ?? (element.labels?.[0]?.textContent ?? null);
  const text = (element.textContent ?? '').trim();
  const own = (labelled ?? text).replace(/\s+/g, ' ').slice(0, 48);
  return own === '' ? element.tagName.toLowerCase() : own;
};

// ---------------------------------------------------------------------------------------------------------------------------
// The page's side of the measurements: scripts that run before the page's own (`page.addInitScript`). Each is a function that is stringified: it uses nothing of this module.

/** The text of an init script that runs `fn` in the page. */
export const script = (fn) => `(${fn.toString()})();`;

/**
 * The DevTools hook React calls after every commit, in a production build too (ui-next/page/probes/sort.mjs counts a press the same way): `window.__commits` is a list of `{ at }`, one for each commit. A page that has the hook installed
 * before React starts is counted from its first commit.
 */
export function commitCounter() {
  const commits = (window.__commits = []);
  const noop = () => undefined;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    onCommitFiberRoot: () => {
      commits.push({ at: performance.now() });
    },
    onPostCommitFiberRoot: noop,
    onCommitFiberUnmount: noop,
    onScheduleFiberRoot: noop,
    checkDCE: noop,
  };
}

/**
 * The same hook, and after each commit a walk of the committed tree that says which ROWS of the page rendered in it: a function component renders when its fiber was made again for this commit (it is not the fiber that was there at the
 * commit before) and React marked that it performed work (`PerformedWork`, the flag React DevTools reads); a row is a `data-settings-row` element, and it rendered when the component that draws it (the nearest function component
 * above its element) or any function component under it did. `window.__commits` is `{ at, rows: [ids], components }` for each commit. The first commit and the ones before any row exists say no rows.
 */
export function commitWalker() {
  const commits = (window.__commits = []);
  const noop = () => undefined;
  const COMPONENT = new Set([0, 11, 14, 15]);
  const PERFORMED_WORK = 1;
  let before = new WeakSet();
  const rowId = (fiber) => (fiber.tag === 5 && fiber.memoizedProps !== null && typeof fiber.memoizedProps === 'object' ? fiber.memoizedProps['data-settings-row'] : undefined);
  const rendered = (fiber) => COMPONENT.has(fiber.tag) && !before.has(fiber) && (fiber.flags & PERFORMED_WORK) === PERFORMED_WORK;
  const anyBelow = (fiber) => {
    for (let child = fiber.child; child !== null; child = child.sibling) {
      if (rendered(child) || anyBelow(child)) return true;
    }
    return false;
  };
  const record = (root) => {
    const now = new WeakSet();
    const rows = new Set();
    let components = 0;
    const visit = (fiber) => {
      for (let node = fiber; node !== null; node = node.sibling) {
        now.add(node);
        if (rendered(node)) components += 1;
        const id = rowId(node);
        if (id !== undefined) {
          let owner = node.return;
          while (owner !== null && !COMPONENT.has(owner.tag)) owner = owner.return;
          if ((owner !== null && rendered(owner)) || anyBelow(node)) rows.add(id);
        }
        if (node.child !== null) visit(node.child);
      }
    };
    visit(root.current);
    before = now;
    return { rows: [...rows], components };
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    onCommitFiberRoot: (_id, root) => {
      commits.push({ at: performance.now(), ...record(root) });
    },
    onPostCommitFiberRoot: noop,
    onCommitFiberUnmount: noop,
    onScheduleFiberRoot: noop,
    checkDCE: noop,
  };
}

/**
 * How many timers, intervals, animation frames and idle callbacks the page has STARTED, from the first one: `window.__started` is `{ timeout, interval, frame, idle }`. Wraps the window's own functions before the page's scripts run, so
 * every caller is seen (the watcher of palette-perf.mjs, which says what is outstanding, wraps these in turn).
 */
export function startCounter() {
  const started = (window.__started = { timeout: 0, interval: 0, frame: 0, idle: 0 });
  const wrap = (name, key) => {
    const native = window[name];
    if (typeof native !== 'function') return;
    window[name] = function counted(...args) {
      started[key] += 1;
      return native.apply(this, args);
    };
  };
  wrap('setTimeout', 'timeout');
  wrap('setInterval', 'interval');
  wrap('requestAnimationFrame', 'frame');
  wrap('requestIdleCallback', 'idle');
}

/** The observers a page holds (a MutationObserver, a ResizeObserver, an IntersectionObserver that was made and not disconnected): `window.__observers()` lists their kinds. Runs before the page's scripts. */
export function observerCounter() {
  const live = new Set();
  for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
    const Native = window[name];
    if (typeof Native !== 'function') continue;
    window[name] = class extends Native {
      constructor(...args) {
        super(...args);
        this.__kind = name;
      }

      observe(...args) {
        live.add(this);
        return super.observe(...args);
      }

      disconnect() {
        live.delete(this);
        return super.disconnect();
      }
    };
  }

  window.__observers = () => [...live].map((observer) => observer.__kind).sort();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The controls' side: a perturbation of the page that a section lays over it once it is drawn.

/**
 * Lays the perturbation of the control that is running over the page, when it is for this `stage` (`ready` by default: the page is drawn and showing what the part reads). A perturbation is a stylesheet (`css`), a script run in the page
 * (`js`, with `arg`), or both, and breaks one behaviour of the page in one way: a rule that moves a box, an attribute that goes, a handler that is dropped, a listener that stays.
 */
export async function plant(env, page, stage = 'ready') {
  const perturbation = env.plant;
  if (perturbation === undefined || (perturbation.stage ?? 'ready') !== stage) return;
  if (perturbation.css !== undefined) await page.addStyleTag({ content: perturbation.css });
  if (perturbation.js !== undefined) await page.evaluate(perturbation.js, perturbation.arg);
}

/** Whether a part runs: every part when the run names none, else the parts it names (a control runs the one part it is for). */
export const wants = (env, part) => env.only === undefined || env.only.includes(part);

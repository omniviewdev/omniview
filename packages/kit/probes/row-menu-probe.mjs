// Probes the kit's RowMenu (one action menu for all rows of a table) on the real `ui-next` parts page, in WebKit and Chromium.
//
//   pnpm --filter @omniviewdev/kit run build            # the page imports the BUILT kit
//   node packages/kit/probes/row-menu-probe.mjs         # builds ui-next (OMNIVIEW_UI=next) into a temp dir, serves it, probes it
//
//   DIST=<dir>     probe an existing build instead of building one
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1030x720   (defaults: both of each)
//   REPORT=<file>  write the full report as JSON
//
// It drives the 5,000-row example (`RowMenu/Large`) and the two small ones. Per engine and viewport it opens the menu from a trigger at the top, in
// the middle and at the bottom of the table region, with the mouse and with the keyboard (Enter, Space, ArrowDown, ArrowUp), once with the region
// mid-window and once with the region at the bottom edge of the window (the flip), and reads:
//
//   roots        popup roots in the whole page: 0 closed, 1 open
//   listeners    live listeners on the window and the document (added and not removed, counted from before the page loads): the set that an
//                open menu adds is exactly a press, a scroll and a resize on the window; closed again, the set is what it was
//   observers    MutationObservers made and disconnected, live while open
//   focus        where focus is after opening (the popup for a pointer, the first or last available item for a key) and after Escape (the trigger)
//   placement    inside the window with 4 px margin, 4 px from the trigger, end-aligned to it, above when it does not fit below, not clipped
//                (elementsFromPoint at the corners and the items returns the popup) even where it passes the table region's edge
//   clipping     the popup placed inside the table region with a transform, containment and overflow hidden on the region: in the top layer
//                (as shipped) it is not clipped; as a plain fixed box (the top layer taken away) it is
//   elements     the page's elements do not depend on the rows beyond the mounted window; an open menu adds exactly its own
//   rows         every row is its fixed height with the trigger column (a button taller than its cell would grow the row and drift the window)
//   keys         arrows wrap and skip an unavailable item, Home and End, Escape, Tab, a press outside, a scroll, a resize, a selection
//   writes       nothing is written to the style of <html> or <body>
// Exit code 1 when anything differs from what is stated here.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, VIEWPORTS } from './probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(VIEWPORTS).join(',')).split(',');

const MARGIN = 4;
const GAP = 4;
const OPEN_LISTENERS = ['window:pointerdown:true', 'window:resize:false', 'window:scroll:true'];
const ITEMS = 4;
const SEPARATORS = 1;
const POPUP_ELEMENTS = 1 + ITEMS + SEPARATORS;

const failures = [];
const report = { engines: {}, notes: [] };
const fail = (where, what) => failures.push(`${where}: ${what}`);
const check = (where, condition, what) => {
  if (!condition) fail(where, what);
  return condition;
};

// ---------------------------------------------------------------------------------------------------------------------------
async function build() {
  if (process.env.DIST) return process.env.DIST;
  const out = mkdtempSync(path.join(os.tmpdir(), 'row-menu-probe-'));
  execFileSync('pnpm', ['exec', 'vite', 'build'], { cwd: repo, env: { ...process.env, OMNIVIEW_UI: 'next', OMNIVIEW_BUILD_OUTPUT_DIRECTORY: out }, stdio: 'pipe' });
  return out;
}

function serve(dist) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    try {
      if (!file.startsWith(dist)) throw new Error('outside');
      response.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
      response.end(readFileSync(file));
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

// Runs in every page before its own scripts: what the window and the document hold, and the MutationObservers made.
function instrument() {
  const live = new Map();
  const ids = new WeakMap();
  let next = 0;
  const idOf = (listener) => {
    if (!ids.has(listener)) ids.set(listener, ++next);
    return ids.get(listener);
  };
  const named = (target) => (target === window ? 'window' : target === document ? 'document' : null);
  const capture = (options) => (typeof options === 'boolean' ? options : options?.capture === true);
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  // Playwright adds listeners of its own to the window while it clicks: only what the page's bundle adds is counted.
  const fromPage = () => (new Error().stack ?? '').includes('/assets/');
  EventTarget.prototype.addEventListener = function patched(type, listener, options) {
    const name = named(this);
    if (name !== null && listener && fromPage()) live.set(`${name}:${type}:${capture(options)}:${idOf(listener)}`, 1);
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function patched(type, listener, options) {
    const name = named(this);
    if (name !== null && listener) live.delete(`${name}:${type}:${capture(options)}:${idOf(listener)}`);
    return remove.call(this, type, listener, options);
  };
  const Native = window.MutationObserver;
  const observers = { created: 0, disconnected: 0, live: 0 };
  window.__NativeMutationObserver = Native;
  window.MutationObserver = class Counting extends Native {
    constructor(callback) {
      super(callback);
      observers.created += 1;
      observers.live += 1;
      this.counted = true;
    }

    disconnect() {
      if (this.counted) {
        this.counted = false;
        observers.live -= 1;
        observers.disconnected += 1;
      }
      super.disconnect();
    }
  };
  window.__rootWrites = [];
  new Native((records) => {
    for (const record of records) if (record.target === document.documentElement || record.target === document.body) window.__rootWrites.push(record.attributeName);
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] });
  window.__rowMenu = { listeners: () => [...live.keys()].map((key) => key.split(':').slice(0, 3).join(':')).sort(), observers };
}

async function open(browser, url, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
  page.on('response', (response) => {
    // The Go host serves /wails/*; the static server of this probe does not, and the page does not need it.
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico') && !response.url().includes('/wails/')) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text().slice(0, 200));
  });
  await page.addInitScript(instrument);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-example="RowMenu/Large"] button[aria-haspopup="menu"]');
  await page.waitForSelector('[data-example="RowMenu/Default"] button[aria-haspopup="menu"]');
  await page.waitForSelector('[data-example="RowMenu/DisabledAndDestructive"] button[aria-haspopup="menu"]');
  return { page, context, errors };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// ---- what the page looks like right now, read in the page -------------------------------------------------------------------------
function snapshot() {
  const popups = [...document.querySelectorAll('[role="menu"]')];
  const popup = popups[0] ?? null;
  const active = document.activeElement;
  const describe = (element) => (element === null ? null : element === document.body ? 'body' : element.getAttribute('role') === 'menu' ? 'popup' : element.getAttribute('role') === 'menuitem' ? `item:${element.textContent}` : element.hasAttribute('aria-haspopup') ? `trigger:${element.getAttribute('aria-label')}` : `${element.tagName.toLowerCase()}${element.getAttribute('role') === null ? '' : `[${element.getAttribute('role')}]`}`);
  const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
  let rect = null;
  let hits = null;
  if (popup !== null) {
    const box = popup.getBoundingClientRect();
    rect = { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    const points = [[box.left + 8, box.top + 8], [box.right - 8, box.top + 8], [box.left + 8, box.bottom - 8], [box.right - 8, box.bottom - 8]];
    for (const item of popup.querySelectorAll('[role="menuitem"]')) {
      const at = item.getBoundingClientRect();
      points.push([at.left + at.width / 2, at.top + at.height / 2]);
    }
    hits = points.map(([x, y]) => {
      const top = document.elementsFromPoint(x, y)[0] ?? null;
      return top !== null && popup.contains(top);
    });
  }
  const controlling = popup === null ? [] : [...document.querySelectorAll(`[aria-controls="${popup.id}"]`)];
  return {
    roots: popups.length,
    popup: popup === null ? null : { id: popup.id, side: popup.getAttribute('data-ov-side'), label: popup.getAttribute('aria-label'), popover: popup.getAttribute('popover'), inTopLayer: popup.matches(':popover-open'), items: [...popup.querySelectorAll('[role="menuitem"]')].map((item) => ({ text: item.textContent, disabled: item.getAttribute('aria-disabled') === 'true', destructive: item.hasAttribute('data-ov-destructive') })), separators: popup.querySelectorAll('[role="separator"]').length, style: popup.getAttribute('style'), rect, hits },
    expanded: [...document.querySelectorAll('[aria-expanded="true"]')].map((element) => element.getAttribute('aria-label')),
    controlled: controlling.map((element) => element.getAttribute('aria-label')),
    focus: describe(active),
    viewport,
    elements: document.querySelectorAll('*').length,
    listeners: window.__rowMenu.listeners(),
    observers: { ...window.__rowMenu.observers },
    rootWrites: window.__rootWrites.length,
  };
}

const read = (page) => page.evaluate(snapshot);

/** The triggers of an example, in the document order, with their rectangles and the region's. */
async function triggersOf(page, example) {
  return page.evaluate((name) => {
    const figure = document.querySelector(`[data-example="${name}"]`);
    const region = figure.querySelector('[role="region"]');
    const box = region.getBoundingClientRect();
    const header = region.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const triggers = [...figure.querySelectorAll('button[aria-haspopup="menu"]')].map((button, index) => {
      const at = button.getBoundingClientRect();
      return { index, label: button.getAttribute('aria-label'), top: at.top, bottom: at.bottom, left: at.left, right: at.right, visible: at.top >= box.top + header - 0.5 && at.bottom <= box.bottom + 0.5 };
    });
    return { region: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, header }, triggers };
  }, example);
}

/** The first, the middle and the last trigger that is fully in view in the table region. */
async function positionsOf(page, example) {
  const { region, triggers } = await triggersOf(page, example);
  const visible = triggers.filter((trigger) => trigger.visible);
  const middle = (region.top + region.header + region.bottom) / 2;
  const centre = visible.reduce((best, trigger) => (Math.abs((trigger.top + trigger.bottom) / 2 - middle) < Math.abs((best.top + best.bottom) / 2 - middle) ? trigger : best), visible[0]);
  return { top: visible[0], middle: centre, bottom: visible.at(-1), count: triggers.length, region };
}

const triggerLocator = (page, example, index) => page.locator(`[data-example="${example}"] button[aria-haspopup="menu"]`).nth(index);

// ---- one opening, read and closed -------------------------------------------------------------------------------------------------
async function cycle(page, where, example, trigger, mode, expectation) {
  const locator = triggerLocator(page, example, trigger.index);
  const before = await read(page);
  check(where, before.roots === 0, `${before.roots} popup roots before opening`);
  const rect = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  });
  if (mode === 'mouse') {
    await locator.click();
  } else {
    await locator.focus();
    await page.keyboard.press(mode === 'enter' ? 'Enter' : mode === 'space' ? 'Space' : mode === 'down' ? 'ArrowDown' : 'ArrowUp');
  }
  await settle(page);
  const open = await read(page);
  const label = `${where} ${expectation.name} ${mode}`;
  check(label, open.roots === 1, `${open.roots} popup roots while open (1 expected)`);
  // A multiset difference: other parts of the page hold listeners of the same kind (the tip host listens for `resize` on the window, so a
  // plain "not in the list before" would not see the menu's own), and what the menu adds is counted, not looked up.
  const added = [];
  const remaining = [...before.listeners];
  for (const key of open.listeners) {
    const at = remaining.indexOf(key);
    if (at < 0) added.push(key);
    else remaining.splice(at, 1);
  }
  check(label, JSON.stringify(added) === JSON.stringify(OPEN_LISTENERS), `listeners added while open: ${JSON.stringify(added)}`);
  check(label, open.listeners.length === before.listeners.length + OPEN_LISTENERS.length, `live listeners ${before.listeners.length} -> ${open.listeners.length}`);
  check(label, open.observers.created === before.observers.created + 1 && open.observers.live === before.observers.live + 1, `observers ${JSON.stringify(before.observers)} -> ${JSON.stringify(open.observers)}`);
  check(label, JSON.stringify(open.expanded) === JSON.stringify([trigger.label]) && JSON.stringify(open.controlled) === JSON.stringify([trigger.label]), `aria-expanded on ${JSON.stringify(open.expanded)}, aria-controls on ${JSON.stringify(open.controlled)}`);
  check(label, open.elements - before.elements === POPUP_ELEMENTS, `the popup added ${open.elements - before.elements} elements (${POPUP_ELEMENTS} expected)`);
  const popup = open.popup;
  if (popup !== null) {
    check(label, popup.popover === 'manual' && popup.inTopLayer, `popover ${popup.popover}, in the top layer ${popup.inTopLayer}`);
    const { rect: box, viewport } = { rect: popup.rect, viewport: open.viewport };
    check(label, box.left >= MARGIN - 0.01 && box.top >= MARGIN - 0.01 && box.right <= viewport.width - MARGIN + 0.01 && box.bottom <= viewport.height - MARGIN + 0.01, `popup ${JSON.stringify(box)} is not inside the window ${viewport.width}x${viewport.height} with ${MARGIN} px`);
    check(label, popup.hits.every(Boolean), `popup is covered or clipped at ${popup.hits.map((hit, index) => (hit ? null : index)).filter((index) => index !== null)}`);
    const below = Math.abs(box.top - (rect.bottom + GAP)) <= 1;
    const above = Math.abs(box.bottom - (rect.top - GAP)) <= 1;
    check(label, popup.side === 'bottom' ? below : popup.side === 'top' ? above : false, `side ${popup.side}: popup ${box.top}..${box.bottom}, trigger ${rect.top}..${rect.bottom}`);
    if (expectation.side !== undefined) check(label, popup.side === expectation.side, `side ${popup.side}, ${expectation.side} expected`);
    const aligned = Math.abs(box.right - rect.right) <= 1 || box.left <= MARGIN + 0.01 || box.right >= viewport.width - MARGIN - 0.01;
    check(label, aligned, `popup right ${box.right} is not the trigger's ${rect.right}`);
    check(label, popup.items.length === ITEMS && popup.separators === SEPARATORS, `${popup.items.length} items and ${popup.separators} separators`);
    check(label, popup.style !== null && /^(?:--_[a-z-]+: [^;]+;? ?)+$/.test(popup.style), `popup style is not custom properties only: ${popup.style}`);
  }
  const wanted = mode === 'mouse' ? 'popup' : mode === 'up' ? `item:${popup?.items.filter((item) => !item.disabled).at(-1)?.text}` : `item:${popup?.items.find((item) => !item.disabled)?.text}`;
  check(label, open.focus === wanted, `focus is ${open.focus}, ${wanted} expected`);
  await page.keyboard.press('Escape');
  await settle(page);
  const closed = await read(page);
  check(label, closed.roots === 0, `${closed.roots} popup roots after Escape`);
  check(label, JSON.stringify(closed.listeners) === JSON.stringify(before.listeners), `listeners after close ${JSON.stringify(closed.listeners)} differ from before ${JSON.stringify(before.listeners)}`);
  check(label, closed.observers.live === before.observers.live && closed.observers.disconnected === before.observers.disconnected + 1, `observers after close ${JSON.stringify(closed.observers)}`);
  check(label, closed.focus === `trigger:${trigger.label}`, `focus after Escape is ${closed.focus}`);
  check(label, closed.expanded.length === 0 && closed.elements === before.elements, `aria-expanded ${JSON.stringify(closed.expanded)}, elements ${before.elements} -> ${closed.elements}`);
  return { name: expectation.name, mode, side: popup?.side, focusOpen: open.focus, popup: popup === null ? null : { left: Math.round(popup.rect.left), top: Math.round(popup.rect.top), width: Math.round(popup.rect.width), height: Math.round(popup.rect.height) }, trigger: { right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) }, roots: [before.roots, open.roots, closed.roots], listeners: [before.listeners.length, open.listeners.length, closed.listeners.length], elements: [before.elements, open.elements, closed.elements], focusClosed: closed.focus };
}

// ---- the table region does not clip it ---------------------------------------------------------------------------------------------
async function clipping(page, where, example, trigger) {
  const locator = triggerLocator(page, example, trigger.index);
  await locator.click();
  await settle(page);
  const result = await page.evaluate((name) => {
    const figure = document.querySelector(`[data-example="${name}"]`);
    const region = figure.querySelector('[role="region"]');
    const popup = document.querySelector('[role="menu"]');
    const home = popup.parentElement;
    const after = popup.nextSibling;
    const reach = () => {
      const box = popup.getBoundingClientRect();
      const points = [[box.left + 8, box.top + 8], [box.right - 8, box.bottom - 8], [box.left + box.width / 2, box.top + box.height / 2]];
      return { box: { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) }, reached: points.map(([x, y]) => { const top = document.elementsFromPoint(x, y)[0] ?? null; return top !== null && popup.contains(top); }) };
    };
    const regionBox = region.getBoundingClientRect();
    const out = { regionBottom: Math.round(regionBox.bottom) };
    // As shipped: beside the table; the popup runs past the region's edge when the trigger is near it.
    out.shipped = reach();
    // Inside the table region, with a transform, containment and overflow hidden on the region and on every ancestor: the worst hosts.
    const hostile = [];
    for (let element = region; element !== null && element !== document.documentElement; element = element.parentElement) {
      hostile.push([element, element.getAttribute('style')]);
      element.style.setProperty('transform', 'translateZ(0)');
      element.style.setProperty('contain', 'paint');
      element.style.setProperty('overflow', 'hidden');
    }
    region.append(popup);
    popup.showPopover();
    out.topLayerInRegion = reach();
    // The top layer taken away: a plain fixed box inside the same region.
    popup.removeAttribute('popover');
    out.fixedInRegion = reach();
    // Only overflow, no transform or containment: a fixed box escapes it.
    for (const [element] of hostile) {
      element.style.removeProperty('transform');
      element.style.removeProperty('contain');
    }
    out.fixedInOverflowOnly = reach();
    for (const [element, style] of hostile) {
      if (style === null) element.removeAttribute('style');
      else element.setAttribute('style', style);
    }
    popup.setAttribute('popover', 'manual');
    home.insertBefore(popup, after);
    popup.showPopover();
    return out;
  }, example);
  await page.keyboard.press('Escape');
  await settle(page);
  // The probe styled the region's ancestors itself, <body> among them: those are not the part's writes.
  await page.evaluate(() => { window.__rootWrites.length = 0; });
  const where2 = `${where} clipping`;
  check(where2, result.shipped.reached.every(Boolean), `as shipped the popup is covered or clipped: ${JSON.stringify(result.shipped)}`);
  check(where2, result.topLayerInRegion.reached.every(Boolean), `in the top layer, inside a transformed, contained, clipping region, the popup is clipped: ${JSON.stringify(result.topLayerInRegion)}`);
  check(where2, result.fixedInOverflowOnly.reached.every(Boolean), `a fixed box inside an overflow-only region is clipped: ${JSON.stringify(result.fixedInOverflowOnly)}`);
  // The hazard, stated as a number: without the top layer, a transform on the region makes the fixed box a child of it, clipped by it.
  return { shipped: result.shipped.reached.every(Boolean), topLayerInTransformedRegion: result.topLayerInRegion.reached.every(Boolean), fixedInOverflowOnlyRegion: result.fixedInOverflowOnly.reached.every(Boolean), fixedInTransformedRegion: result.fixedInRegion.reached.every(Boolean), popupPastRegionBottomPx: Math.max(0, result.shipped.box.top + result.shipped.box.height - result.regionBottom) };
}

// ---- keys, in real engines ---------------------------------------------------------------------------------------------------------
async function keys(page, where) {
  const label = `${where} keys`;
  const log = {};
  // Every step leaves the page as it found it: a menu still open here was left by an earlier step, and the keys below would be judged on it.
  check(label, (await read(page)).roots === 0, 'a menu was left open by an earlier step');
  const focus = async () => (await read(page)).focus;
  const example = 'RowMenu/DisabledAndDestructive';
  const all = await triggersOf(page, example);
  // A paused job has "Pause" unavailable, a failed one has both "Pause" and "Resume" unavailable: find them by opening.
  const labels = [];
  for (const trigger of all.triggers.slice(0, 5)) {
    const locator = triggerLocator(page, example, trigger.index);
    await locator.focus();
    await page.keyboard.press('ArrowDown');
    const state = await read(page);
    labels.push({ trigger: trigger.label, items: state.popup?.items ?? [] });
    await page.keyboard.press('Escape');
  }
  const paused = labels.find((entry) => entry.items.some((item) => item.text === 'Pause' && item.disabled) && entry.items.some((item) => item.text === 'Resume' && !item.disabled));
  const failed = labels.find((entry) => entry.items.filter((item) => item.disabled).length === 2);
  check(label, paused !== undefined && failed !== undefined, 'the example has no paused and no failed job in its first rows');
  if (paused === undefined || failed === undefined) return log;
  const pausedTrigger = all.triggers.find((trigger) => trigger.label === paused.trigger);
  const locator = triggerLocator(page, example, pausedTrigger.index);
  await locator.focus();
  await page.keyboard.press('ArrowDown');
  const walk = [await focus()];
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']) {
    await page.keyboard.press(key);
    walk.push(await focus());
  }
  // Inspect, (Pause is unavailable: skipped) Resume, Delete, wraps to Inspect, Resume.
  check(label, JSON.stringify(walk) === JSON.stringify(['item:Inspect', 'item:Resume', 'item:Delete…', 'item:Inspect', 'item:Resume']), `arrow walk with an unavailable item ${JSON.stringify(walk)}`);
  log.walk = walk;
  await page.keyboard.press('End');
  const end = await focus();
  await page.keyboard.press('Home');
  const home = await focus();
  await page.keyboard.press('ArrowUp');
  const wrapUp = await focus();
  check(label, end === 'item:Delete…' && home === 'item:Inspect' && wrapUp === 'item:Delete…', `End ${end}, Home ${home}, ArrowUp from the first ${wrapUp}`);
  const opened = await read(page);
  check(label, opened.popup.items.some((item) => item.text === 'Pause' && item.disabled), 'the unavailable item is not announced as aria-disabled');
  // Tab closes and goes on from the trigger.
  await page.keyboard.press('Tab');
  await settle(page);
  const tabbed = await read(page);
  check(label, tabbed.roots === 0 && tabbed.listeners.length === opened.listeners.length - OPEN_LISTENERS.length, `after Tab: ${tabbed.roots} roots, listeners ${JSON.stringify(tabbed.listeners)}`);
  check(label, tabbed.focus !== 'body' && !tabbed.focus.startsWith('item:') && tabbed.focus !== 'popup', `focus after Tab is ${tabbed.focus}`);
  log.afterTab = tabbed.focus;
  // From a menu a pointer opened (no item is active), Tab and Shift+Tab close it too, and focus goes on from the trigger.
  for (const combo of ['Tab', 'Shift+Tab']) {
    await locator.click();
    await settle(page);
    const before = await read(page);
    check(label, before.roots === 1 && before.focus === 'popup', `before ${combo} from a pointer's menu: ${before.roots} roots, focus ${before.focus}`);
    await page.keyboard.press(combo);
    await settle(page);
    const after = await read(page);
    check(label, after.roots === 0 && after.listeners.length === before.listeners.length - OPEN_LISTENERS.length && after.focus !== 'popup' && !after.focus.startsWith('item:'), `after ${combo} from a pointer's menu: ${after.roots} roots, focus ${after.focus}`);
    log[`after${combo.replace('+', '')}FromPointer`] = after.focus;
  }
  // A selection: the item runs after the menu has closed, and focus is on the trigger.
  await locator.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await settle(page);
  const chosen = await read(page);
  const lastAction = await page.locator(`[data-example="${example}"]`).innerText();
  check(label, chosen.roots === 0 && chosen.focus === `trigger:${paused.trigger}` && lastAction.includes(`Last action: resume ${paused.trigger.replace('Actions for ', '')}`), `after Enter on an item: ${chosen.roots} roots, focus ${chosen.focus}, text ${JSON.stringify(lastAction.split('\n').at(-1))}`);
  log.selected = lastAction.split('\n').at(-1);
  // Space on an item selects too.
  await locator.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await settle(page);
  const space = await read(page);
  check(label, space.roots === 0 && space.focus === `trigger:${paused.trigger}`, `Space on the first item: ${space.roots} roots, focus ${space.focus}`);
  // A click outside: closes it, and the click lands where it went.
  await locator.click();
  await page.mouse.click(2, 2);
  await settle(page);
  const outside = await read(page);
  check(label, outside.roots === 0 && outside.listeners.length === chosen.listeners.length, `after a press outside: ${outside.roots} roots`);
  // A second trigger opens in one click while the first is open.
  const second = all.triggers.find((trigger) => trigger.label !== paused.trigger);
  await locator.click();
  await triggerLocator(page, example, second.index).click();
  await settle(page);
  const switched = await read(page);
  check(label, switched.roots === 1 && JSON.stringify(switched.expanded) === JSON.stringify([second.label]), `second trigger after the first: ${switched.roots} roots, expanded ${JSON.stringify(switched.expanded)}`);
  await page.keyboard.press('Escape');
  // A toggle: the trigger again closes it.
  await locator.click();
  await locator.click();
  await settle(page);
  const toggled = await read(page);
  check(label, toggled.roots === 0 && toggled.focus === `trigger:${paused.trigger}`, `after clicking the open trigger: ${toggled.roots} roots, focus ${toggled.focus}`);
  // A disabled item is not a stop and does nothing when clicked: the menu stays open.
  await locator.click();
  await page.locator('[role="menu"] [aria-disabled="true"]').first().click({ force: true });
  await settle(page);
  const disabled = await read(page);
  check(label, disabled.roots === 1, `a click on an unavailable item left ${disabled.roots} roots`);
  await page.keyboard.press('Escape');
  return log;
}

async function closers(page, where) {
  const label = `${where} closers`;
  const example = 'RowMenu/Large';
  const { top } = await positionsOf(page, example);
  const locator = triggerLocator(page, example, top.index);
  const baseline = await read(page);
  const report = {};
  // A scroll of the table region closes it and returns focus to the trigger.
  await locator.click();
  await page.mouse.move(top.left - 200 > 0 ? top.left - 200 : top.right + 50, top.top + 120);
  const region = page.locator(`[data-example="${example}"] [role="region"]`);
  const box = await region.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await sleep(250);
  const scrolled = await read(page);
  check(label, scrolled.roots === 0 && JSON.stringify(scrolled.listeners) === JSON.stringify(baseline.listeners), `after a scroll of the region: ${scrolled.roots} roots, listeners ${JSON.stringify(scrolled.listeners)}`);
  report.scroll = { roots: scrolled.roots, focus: scrolled.focus };
  await region.evaluate((element) => element.scrollTo({ top: 0 }));
  await settle(page);
  // A resize closes it.
  const fresh = await positionsOf(page, example);
  await triggerLocator(page, example, fresh.top.index).click();
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width - 40, height: size.height });
  await sleep(150);
  const resized = await read(page);
  check(label, resized.roots === 0 && JSON.stringify(resized.listeners) === JSON.stringify(baseline.listeners), `after a resize: ${resized.roots} roots`);
  await page.setViewportSize(size);
  await sleep(150);
  report.resize = { roots: resized.roots };
  // The row leaves the page while its menu is open (what a record deleted, or a row that scrolls out of the window, does): the menu closes
  // and focus goes to the table region.
  const again = await positionsOf(page, example);
  await triggerLocator(page, example, again.middle.index).click();
  await page.evaluate((name) => {
    const button = document.querySelector('[aria-expanded="true"]');
    button.closest('tr').remove();
  }, example);
  await sleep(100);
  const gone = await read(page);
  check(label, gone.roots === 0 && gone.focus === 'div[region]' && JSON.stringify(gone.listeners) === JSON.stringify(baseline.listeners), `after its row was removed: ${gone.roots} roots, focus ${gone.focus}`);
  report.rowRemoved = { roots: gone.roots, focus: gone.focus };
  // Focus lost without a blur: the popup is moved in the document while it has focus. An engine that sends a blur (Chromium) closes the menu; one that
  // sends none (WebKit) leaves focus on the body, and the menu then has to take it back, or no key reaches it and Escape and Tab close nothing. Never
  // open with focus elsewhere; and Escape closes it.
  const last = await positionsOf(page, example);
  await triggerLocator(page, example, last.middle.index).click();
  await page.evaluate(() => {
    const popup = document.querySelector('[role="menu"]');
    const home = popup.parentElement;
    const next = popup.nextSibling;
    document.body.append(popup);
    home.insertBefore(popup, next);
    popup.showPopover?.();
  });
  await settle(page);
  const dropped = await read(page);
  check(label, dropped.roots === 0 || dropped.focus === 'popup', `after the popup was moved while it had focus: ${dropped.roots} roots, focus ${dropped.focus}`);
  await page.keyboard.press('Escape');
  await settle(page);
  const escaped = await read(page);
  check(label, escaped.roots === 0 && JSON.stringify(escaped.listeners) === JSON.stringify(baseline.listeners), `Escape after the popup was moved left ${escaped.roots} roots, listeners ${JSON.stringify(escaped.listeners)}`);
  report.focusDropped = { rootsAfterMove: dropped.roots, focusAfterMove: dropped.focus, rootsAfterEscape: escaped.roots };
  return report;
}

// ---- elements and rows -------------------------------------------------------------------------------------------------------------
async function elements(page, where) {
  const label = `${where} elements`;
  const example = 'RowMenu/Large';
  const region = page.locator(`[data-example="${example}"] [role="region"]`);
  const rows = [];
  for (const position of [0, 0.5, 0.97]) {
    await region.evaluate((element, share) => element.scrollTo({ top: Math.round((element.scrollHeight - element.clientHeight) * share) }), position);
    await settle(page);
    await sleep(80);
    const state = await page.evaluate((name) => {
      const figure = document.querySelector(`[data-example="${name}"]`);
      const tbody = figure.querySelectorAll('tbody > tr:not([aria-hidden])');
      const heights = [...tbody].map((row) => Math.round(row.getBoundingClientRect().height * 100) / 100);
      const first = tbody[0]?.getAttribute('aria-rowindex');
      const last = tbody[tbody.length - 1]?.getAttribute('aria-rowindex');
      const spacers = figure.querySelectorAll('tbody > tr[aria-hidden]').length;
      return { spacers, rows: tbody.length, triggers: figure.querySelectorAll('button[aria-haspopup="menu"]').length, elementsInFigure: figure.querySelectorAll('*').length, elementsInPage: document.querySelectorAll('*').length, minHeight: Math.min(...heights), maxHeight: Math.max(...heights), first, last, rowcount: figure.querySelector('table').getAttribute('aria-rowcount'), perRow: [...new Set([...tbody].map((row) => 1 + row.querySelectorAll('*').length))] };
    }, example);
    rows.push({ at: position, ...state });
  }
  await region.evaluate((element) => element.scrollTo({ top: 0 }));
  await settle(page);
  const [a, b, c] = rows;
  check(label, rows.every((row) => row.rowcount === '5001'), `aria-rowcount ${rows.map((row) => row.rowcount)}`);
  check(label, rows.every((row) => row.triggers === row.rows), `triggers ${rows.map((row) => row.triggers)} against mounted rows ${rows.map((row) => row.rows)}`);
  check(label, rows.every((row) => row.rows < 60), `rows mounted ${rows.map((row) => row.rows)}`);
  // The page is a constant, six elements for each mounted row and two for each spacer row: nothing depends on the rows beyond the window.
  const rest = rows.map((row) => row.elementsInPage - 6 * row.rows - 2 * row.spacers);
  check(label, new Set(rest).size === 1, `page elements minus the mounted rows (6 each) and the spacers (2 each): ${rest} (one constant expected)`);
  check(label, rows.every((row) => row.minHeight === 24 && row.maxHeight === 24), `row heights ${rows.map((row) => `${row.minHeight}..${row.maxHeight}`)} (24 expected with the trigger column)`);
  check(label, rows.every((row) => row.perRow.length === 1 && row.perRow[0] === 6), `elements per row ${rows.map((row) => JSON.stringify(row.perRow))} (6: tr, 2 td, button, svg, path)`);
  const two = await page.evaluate(() => {
    const figure = document.querySelector('[data-example="RowMenu/DisabledAndDestructive"]');
    const heights = [...figure.querySelectorAll('tbody > tr:not([aria-hidden])')].map((row) => Math.round(row.getBoundingClientRect().height * 100) / 100);
    const buttons = [...figure.querySelectorAll('button[aria-haspopup="menu"]')].map((button) => button.getBoundingClientRect());
    return { rows: heights.length, min: Math.min(...heights), max: Math.max(...heights), button: [...new Set(buttons.map((box) => `${box.width}x${box.height}`))] };
  });
  check(label, two.min === 40 && two.max === 40 && two.button.length === 1 && two.button[0] === '24x24', `two-line rows ${two.min}..${two.max}, trigger ${JSON.stringify(two.button)}`);
  const small = await page.evaluate(() => {
    const figure = document.querySelector('[data-example="RowMenu/Default"]');
    return { rows: figure.querySelectorAll('tbody > tr:not([aria-hidden])').length, triggers: figure.querySelectorAll('button[aria-haspopup="menu"]').length, heights: [...new Set([...figure.querySelectorAll('tbody > tr:not([aria-hidden])')].map((row) => Math.round(row.getBoundingClientRect().height * 100) / 100))] };
  });
  check(label, small.rows === 12 && small.triggers === 12 && small.heights.length === 1 && small.heights[0] === 24, `small table ${JSON.stringify(small)}`);
  return { large: rows, twoLine: two, small, windowSizeRange: [Math.min(...rows.map((row) => row.rows)), Math.max(...rows.map((row) => row.rows))], elementsInPageRange: [Math.min(...rows.map((row) => row.elementsInPage)), Math.max(...rows.map((row) => row.elementsInPage))], constant: new Set(rest).size === 1 ? rest[0] : rest, a: a.rows, b: b.rows, c: c.rows };
}

// ---- the trigger as drawn ------------------------------------------------------------------------------------------------------------
async function look(page, where) {
  const label = `${where} look`;
  const example = 'RowMenu/Large';
  const locator = triggerLocator(page, example, 0);
  await locator.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const style = await locator.evaluate((button) => {
    const cs = getComputedStyle(button);
    const svg = button.querySelector('svg');
    const box = button.getBoundingClientRect();
    const svgBox = svg.getBoundingClientRect();
    const circles = [...svg.querySelectorAll('path')].length;
    return { width: box.width, height: box.height, glyph: svg.getAttribute('data-ov-glyph'), glyphBox: `${svgBox.width}x${svgBox.height}`, glyphCentre: [Math.round((svgBox.left + svgBox.width / 2 - box.left) * 10) / 10, Math.round((svgBox.top + svgBox.height / 2 - box.top) * 10) / 10], paths: circles, outlineOffset: cs.outlineOffset, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, focusVisible: button.matches(':focus-visible'), color: cs.color, cursor: cs.cursor, borderTopWidth: cs.borderTopWidth };
  });
  check(label, style.width === 24 && style.height === 24 && style.glyph === 'ellipsis' && style.glyphBox === '16x16' && style.paths === 1, `trigger ${JSON.stringify(style)}`);
  check(label, JSON.stringify(style.glyphCentre) === JSON.stringify([12, 12]), `glyph centre ${JSON.stringify(style.glyphCentre)}`);
  if (style.focusVisible) check(label, style.outlineOffset === '-2px' && style.outlineStyle === 'solid' && style.outlineWidth === '2px', `focus ring ${style.outlineStyle} ${style.outlineWidth} at ${style.outlineOffset}`);
  await locator.evaluate((button) => button.blur());
  // The popup as drawn, open on a trigger of the small table.
  await triggerLocator(page, 'RowMenu/Default', 0).click();
  await settle(page);
  const popup = await page.evaluate(() => {
    const element = document.querySelector('[role="menu"]');
    const cs = getComputedStyle(element);
    const item = element.querySelector('[role="menuitem"]');
    const ics = getComputedStyle(item);
    const box = element.getBoundingClientRect();
    const destructive = element.querySelector('[data-ov-destructive]');
    const separator = element.querySelector('[role="separator"]');
    const first = item.getBoundingClientRect();
    return {
      width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100,
      border: `${cs.borderTopWidth} ${cs.borderTopStyle}`, radius: cs.borderTopLeftRadius, background: cs.backgroundColor, color: cs.color, borderColor: cs.borderTopColor,
      font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`, paddingBlock: `${cs.paddingTop} ${cs.paddingBottom}`, position: cs.position,
      itemHeight: Math.round(first.height * 100) / 100, itemInset: Math.round((first.left - box.left - 1) * 100) / 100, itemRadius: ics.borderTopLeftRadius, itemPadding: ics.paddingLeft, itemBackground: ics.backgroundColor,
      destructiveColor: getComputedStyle(destructive).color, separatorTop: Math.round((separator.getBoundingClientRect().top - separator.previousElementSibling.getBoundingClientRect().bottom) * 100) / 100,
      activeFill: null,
    };
  });
  await page.keyboard.press('ArrowDown');
  popup.activeFill = await page.evaluate(() => getComputedStyle(document.activeElement).backgroundColor);
  await page.keyboard.press('Escape');
  check(label, popup.border === '1px solid' && popup.radius === '8px' && popup.position === 'fixed' && popup.itemHeight === 24 && popup.itemInset === 8 && popup.itemRadius === '4px' && popup.paddingBlock === '8px 8px', `popup ${JSON.stringify(popup)}`);
  check(label, popup.width >= 180 && popup.height === 123, `popup size ${popup.width}x${popup.height} (123 expected: 8 + 4 x 24 + 9 + 8 + 2)`);
  return { trigger: style, popup };
}

// ---------------------------------------------------------------------------------------------------------------------------
const dist = await build();
const { server, url } = await serve(dist);
try {
  for (const engineName of engineNames) {
    const browser = await ENGINES[engineName].launch();
    report.engines[engineName] = {};
    for (const viewportName of viewportNames) {
      const where = `${engineName} ${viewportName}`;
      const { page, context, errors } = await open(browser, url, VIEWPORTS[viewportName]);
      const out = { cycles: [], clipping: {}, keys: {}, closers: {}, elements: {}, look: {} };
      report.engines[engineName][viewportName] = out;
      const start = await read(page);
      check(where, start.roots === 0, `${start.roots} popup roots in the page at rest`);
      out.rest = { roots: start.roots, listeners: start.listeners.length, elements: start.elements, observers: start.observers };

      out.elements = await elements(page, where);
      out.look = await look(page, where);

      // The 5,000-row example, region mid-window: top, middle, bottom, by mouse and by key.
      const example = 'RowMenu/Large';
      await page.locator(`[data-example="${example}"]`).evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await settle(page);
      const mid = await positionsOf(page, example);
      for (const name of ['top', 'middle', 'bottom']) {
        for (const mode of ['mouse', 'enter', 'space', 'down', 'up']) {
          out.cycles.push({ window: 'mid', ...(await cycle(page, where, example, mid[name], mode, { name })) });
        }
      }
      out.clipping.mid = await clipping(page, where, example, mid.bottom);

      // The region at the bottom edge of the window: the bottom triggers are near it, and the menu flips above them.
      await page.locator(`[data-example="${example}"]`).evaluate((element) => element.scrollIntoView({ block: 'end' }));
      await settle(page);
      const low = await positionsOf(page, example);
      for (const name of ['top', 'middle', 'bottom']) {
        for (const mode of ['mouse', 'down', 'up']) {
          const nearEdge = await page.evaluate((top) => window.innerHeight - top, low[name].bottom);
          out.cycles.push({ window: 'low', ...(await cycle(page, where, example, low[name], mode, { name: `${name} (${Math.round(nearEdge)} px above the window's bottom edge)`, side: undefined })) });
        }
      }
      const flipped = out.cycles.filter((entry) => entry.window === 'low' && entry.side === 'top').length;
      check(where, flipped > 0, 'no menu flipped above its trigger with the region at the bottom edge of the window');
      out.flipped = flipped;
      out.clipping.low = await clipping(page, where, example, low.bottom);

      out.keys = await keys(page, where);
      out.closers = await closers(page, where);

      const end = await read(page);
      check(where, end.rootWrites === 0, `${end.rootWrites} writes to the style of <html> or <body>`);
      check(where, end.roots === 0 && JSON.stringify(end.listeners) === JSON.stringify(start.listeners) && end.observers.live === start.observers.live, `at the end: ${end.roots} roots, listeners ${end.listeners.length} (${start.listeners.length} at the start), live observers ${end.observers.live}`);
      if (errors.length) fail(where, `page errors: ${errors.join(' | ')}`);
      await context.close();
    }

    await browser.close();
  }
} finally {
  server.close();
}

const lines = [];
for (const [engineName, viewports] of Object.entries(report.engines)) {
  for (const [viewportName, out] of Object.entries(viewports)) {
    const cycles = out.cycles;
    lines.push(
      `${engineName} ${viewportName}: ${cycles.length} openings (mid-window and bottom edge; top, middle, bottom trigger; mouse and keys), ${out.flipped} flipped above; ` +
        `roots 0/1/0 in all ${cycles.every((entry) => entry.roots.join() === '0,1,0')}; live listeners at rest ${out.rest.listeners}, open +${new Set(cycles.map((entry) => entry.listeners[1] - entry.listeners[0])).size === 1 ? cycles[0].listeners[1] - cycles[0].listeners[0] : '?'}, closed +0; ` +
        `window ${out.elements.windowSizeRange.join('..')} rows, page ${out.elements.elementsInPageRange.join('..')} elements; trigger 3 elements, 24x24, rows ${out.elements.large[0].minHeight}px (two-line ${out.elements.twoLine.min}px); ` +
        `clipping: shipped ${out.clipping.mid.shipped}/${out.clipping.low.shipped}, top layer in a hostile region ${out.clipping.mid.topLayerInTransformedRegion}, plain fixed in a transformed region ${out.clipping.mid.fixedInTransformedRegion}, plain fixed in an overflow-only region ${out.clipping.mid.fixedInOverflowOnlyRegion}`,
    );
  }
}

lines.push(...report.notes);
lines.push(failures.length ? `\nFAILURES (${failures.length}):\n  ${failures.join('\n  ')}` : '\nno failure');
console.log(lines.join('\n'));
if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1));
if (failures.length) process.exitCode = 1;

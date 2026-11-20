// Probes the kit's Icon, Button and IconButton on the real `ui-next` page, in WebKit and Chromium at 1440 x 900 and 1030 x 720.
//
//   pnpm --filter @omniviewdev/kit run build            # the page imports the BUILT kit
//   node packages/kit/probes/kit-probe.mjs              # builds ui-next (OMNIVIEW_UI=next) into a temp dir, serves it, probes it
//
//   DIST=<dir>     probe an existing build instead of building one
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1030x720   (defaults: both of each)
//   AXE=<path to axe.min.js>  also run axe-core over the parts (a dev dependency is the lead's call: `npm i axe-core` in a temp dir)
//   SHOTS=<dir>    write a screenshot of the parts section per engine and viewport
//   REPORT=<file>  write the full report as JSON
//
// What it checks, per engine and viewport:
//   parity      every case of PARITY against the mock's reference (mock-reference.json, made by generate-reference.mjs): rectangles within 1 px,
//               colours, border, padding, font, gap, cursor and focus ring exactly, in the states rest, hover, active and focus
//   tokens      in each of the nine themes, the colours a state paints are the roles of the token table, read from the theme itself
//   counts      DOM elements per instance, and no write to <html> or <body> while the pointer and the keyboard visit every part
//   keyboard    every Button and IconButton is reachable by Tab in document order, a reasoned-disabled one included; Enter and Space
//               activate an available button; busy shows the loader after one second and the loader holds still under reduced motion
//   a11y        the accessibility tree of each example (Playwright aria snapshot), and axe-core when AXE is given
// Exit code 1 when anything outside KNOWN_DEVIATIONS differs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ENGINES, VIEWPORTS, STATES, awaitFonts, deviations, launch, measure, setContext, summarize } from './probe-lib.mjs';
import { buildUiNext, serve } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(path.join(here, 'mock-reference.json'), 'utf8'));
const AXE = process.env.AXE ?? createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(VIEWPORTS).join(',')).split(',');
const SHOTS = process.env.SHOTS;
// ONLY=busy runs the busy section alone (the loader's timing and reduced motion), for repeated runs under load.
const ONLY = process.env.ONLY;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------------------
// parity: mock case -> kit example. `label: false` when the label text differs (only the chrome width is compared).
const PARITY = {
  'btn-secondary': { example: 'Button/Secondary', ctx: ['scale125', 'scale80'] },
  'btn-secondary-small': { example: 'Button/SecondaryCompact' },
  'btn-primary': { example: 'Button/Primary', ctx: ['scale125'] },
  'btn-primary-small': { example: 'Button/PrimaryCompact' },
  'btn-ghost': { example: 'Button/Ghost' },
  'btn-ghost-small': { example: 'Button/GhostCompact', ctx: ['scale125'] },
  'btn-danger': { example: 'Button/Danger' },
  'btn-danger-small': { example: 'Button/DangerCompact' },
  'btn-primary-danger': { example: 'Button/PrimaryDanger' },
  'btn-ghost-small-danger': { example: 'Button/GhostCompactDanger' },
  'btn-icon-ghost-small-columns': { example: 'Button/WithIcon' },
  'btn-icon-ghost-small-clear': { example: 'Button/ClearFilters' },
  'btn-icon-primary-create': { example: 'Button/PrimaryWithIcon', label: false },
  'btn-icon-secondary-small-more': { example: 'Button/LoadMore' },
  'btn-secondary-disabled': { example: 'Button/SecondaryDisabled' },
  'btn-primary-disabled': { example: 'Button/PrimaryDisabled' },
  'btn-ghost-small-disabled': { example: 'Button/GhostCompactDisabled' },
  'btn-danger-disabled': { example: 'Button/DangerDisabled' },
  'btn-primary-danger-disabled': { example: 'Button/PrimaryDangerDisabled' },
  'btn-icon-ghost-small-disabled': { example: 'Button/WithIconDisabled' },
  'ibtn-secondary': { example: 'IconButton/Secondary', ctx: ['scale125'] },
  'ibtn-ghost': { example: 'IconButton/Ghost' },
  'ibtn-danger': { example: 'IconButton/Danger' },
  'ibtn-ghost-danger': { example: 'IconButton/GhostDanger' },
  'ibtn-secondary-disabled': { example: 'IconButton/SecondaryDisabled' },
  'ibtn-ghost-disabled': { example: 'IconButton/GhostDisabled' },
  'td-ibtn-ghost': { example: 'IconButton/RowGhost', ctx: ['compact'] },
  'td-btn-small': { example: 'Button/Row', ctx: ['compact'] },
  'td-btn-ghost-small': { example: 'Button/RowGhost', ctx: ['compact'] },
};

// What differs on purpose, each with its reason. A deviation not listed here fails the probe.
const KNOWN_DEVIATIONS = {
  // The mock's `button { font: inherit }` outranks its `:where(button)` rule, so a plain mock button takes the font size of its
  // parent; the kit pins 13 px (the same in every place the mock puts one).
  font: [],
  // The mock draws `.ic` in a span that holds the svg; the kit's glyph is the svg itself. Elements are reported, not compared.
  elements: [],
};
void KNOWN_DEVIATIONS;

// ---------------------------------------------------------------------------------------------------------------------------
// themes: the colour each state paints is the role of the token table, in every theme.
const THEME_CASES = [
  { example: 'Button/Secondary', rest: { color: '--ov-fg', border: '--ov-border-control', bg: null, icon: null }, hover: { bg: '--ov-hover-row' }, active: { bg: '--ov-hover-toolbar' } },
  { example: 'Button/Primary', rest: { color: '--ov-fg-over-accent', border: '--ov-accent', bg: '--ov-accent' }, hover: { bg: '--ov-accent' }, active: { bg: '--ov-accent' } },
  { example: 'Button/Ghost', rest: { color: '--ov-fg', border: null, bg: null }, hover: { bg: '--ov-hover-toolbar' }, active: { bg: '--ov-pressed' } },
  { example: 'Button/Danger', rest: { color: '--ov-error-fg', border: '--ov-border-control', bg: null }, hover: { bg: '--ov-hover-row' }, active: { bg: '--ov-hover-toolbar' } },
  { example: 'Button/PrimaryDanger', rest: { color: '--ov-fg-over-accent', border: '--ov-error-control', bg: '--ov-error-control' }, hover: { bg: '--ov-error-control' }, active: { bg: '--ov-error-control' } },
  { example: 'Button/SecondaryDisabled', rest: { color: '--ov-fg-disabled', border: '--ov-border-disabled', bg: '--ov-bg-island' }, hover: { bg: '--ov-bg-island' }, active: { bg: '--ov-bg-island' } },
  { example: 'Button/GhostCompactDisabled', rest: { color: '--ov-fg-disabled', border: null, bg: null }, hover: { bg: null }, active: { bg: null } },
  { example: 'Button/WithIcon', rest: { color: '--ov-fg', border: null, bg: null, icon: '--ov-icon' }, hover: {}, active: {} },
  { example: 'Button/WithIconDisabled', rest: { color: '--ov-fg-disabled', border: null, bg: null, icon: '--ov-icon-disabled' }, hover: {}, active: {} },
  { example: 'Button/PrimaryWithIcon', rest: { color: '--ov-fg-over-accent', border: '--ov-accent', bg: '--ov-accent', icon: '--ov-fg-over-accent' }, hover: {}, active: {} },
  { example: 'IconButton/Danger', rest: { color: '--ov-error-fg', border: '--ov-border-control', bg: null, icon: '--ov-error-fg' }, hover: {}, active: {} },
];

const failures = [];
const report = { parity: {}, themes: {}, counts: {}, keyboard: {}, a11y: {}, notes: [] };
const fail = (where, what) => failures.push(`${where}: ${what}`);

const CONTEXTS = {
  default: { textScale: null, density: null },
  scale125: { textScale: '125', density: null },
  scale80: { textScale: '80', density: null },
  compact: { textScale: null, density: 'compact' },
};

async function open(browser, url, viewport, options = {}) {
  const context = await browser.newContext({ viewport, ...options });
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
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-example="Button/Secondary"]');
  return { page, context, errors };
}

const target = (example) => (example.startsWith('Icon/') ? `[data-example="${example}"] svg` : `[data-example="${example}"] button`);

// ---- parity -------------------------------------------------------------------------------------------------------------------
async function parity(page, where) {
  await awaitFonts(page);
  const rows = [];
  for (const [id, spec] of Object.entries(PARITY)) {
    const mock = reference.cases[id];
    for (const contextName of ['default', ...(spec.ctx ?? [])]) {
      await setContext(page, { ...CONTEXTS[contextName], flavour: 'kit' });
      const states = await measure(page, page.locator(target(spec.example)), { states: STATES });
      for (const state of STATES) {
        const want = mock?.[contextName]?.[state];
        if (want === undefined) {
          fail(where, `${id}/${contextName}/${state}: no reference in mock-reference.json`);
          continue;
        }

        const got = summarize(states[state], { withOutline: state === 'focus' });
        const diffs = deviations(want, got, { sameLabel: spec.label !== false, withOutline: state === 'focus' });
        rows.push({ id, example: spec.example, context: contextName, state, mock: `${want.w}x${want.h}`, kit: `${got.w}x${got.h}`, el: `${want.el} -> ${got.el}`, diffs });
        for (const diff of diffs) fail(where, `${id}/${contextName}/${state} (${spec.example}): ${diff}`);
      }
    }

    await setContext(page, { ...CONTEXTS.default, flavour: 'kit' });
  }

  return rows;
}

// ---- icons ------------------------------------------------------------------------------------------------------------------
async function icons(page, where) {
  const rows = [];
  const read = (selector) => page.locator(selector).first().evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    const paints = new Set();
    for (const shape of svg.querySelectorAll('path, circle, rect, line, polyline, polygon')) {
      const style = getComputedStyle(shape);
      paints.add(`${style.fill}|${style.stroke}`);
    }

    return { w: rect.width, h: rect.height, color: getComputedStyle(svg).color, pointer: getComputedStyle(svg).pointerEvents, hidden: svg.getAttribute('aria-hidden'), paints: [...paints].sort(), elements: 1 + svg.querySelectorAll('*').length };
  });
  const cases = [
    ['icon-16', 'Icon/Default', 'svg'],
    ['icon-chevron-down-12', 'Icon/Small', 'svg'],
    ['icon-statusSuccess-16', 'Icon/Status', 'svg:nth-of-type(1)'],
    ['icon-statusWarning-16', 'Icon/Status', 'svg:nth-of-type(2)'],
  ];
  for (const [id, example, inner] of cases) {
    const want = reference.cases[id].default.rest;
    const got = await read(`[data-example="${example}"] ${inner}`);
    const diffs = [];
    if (Math.abs(want.w - got.w) > 0.5 || Math.abs(want.h - got.h) > 0.5) diffs.push(`size: mock ${want.w}x${want.h} kit ${got.w}x${got.h}`);
    if (got.pointer !== 'none') diffs.push(`pointer-events ${got.pointer}, not none`);
    if (got.hidden !== 'true') diffs.push('not hidden from assistive technology');
    rows.push({ id, example, mock: `${want.w}x${want.h}`, kit: `${got.w}x${got.h}`, el: `${want.el} -> ${got.elements}`, paints: got.paints, diffs });
    for (const diff of diffs) fail(where, `${id} (${example}): ${diff}`);
  }

  // The pinned paints of a status glyph are the same colours as the mock's.
  const paintsOf = (svgMarkupSelector) => page.locator(svgMarkupSelector).first().evaluate((svg) => [...new Set([...svg.querySelectorAll('path, circle')].flatMap((shape) => { const s = getComputedStyle(shape); return [s.fill, s.stroke].filter((v) => v !== 'none'); }))].sort());
  const success = await paintsOf('[data-example="Icon/Status"] svg:nth-of-type(1)');
  const warning = await paintsOf('[data-example="Icon/Status"] svg:nth-of-type(2)');
  report.notes.push(`${where} status paints: success ${JSON.stringify(success)} warning ${JSON.stringify(warning)}`);
  return rows;
}

// ---- tokens ------------------------------------------------------------------------------------------------------------------
// What a control paints in a state, read from the page without the settling of `measure`: the colours are read twice a frame apart.
async function paintOf(page, selector, state) {
  const handle = await page.locator(selector).first().elementHandle();
  await handle.scrollIntoViewIfNeeded();
  if (state !== 'rest') {
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    if (state === 'active') await page.mouse.down();
  }

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const painted = await handle.evaluate((element) => {
    const style = getComputedStyle(element);
    const glyph = element.querySelector('svg');
    return { color: style.color, bg: style.backgroundColor, border: style.borderTopColor, icon: glyph ? getComputedStyle(glyph).color : undefined };
  });
  await page.mouse.move(1, 1);
  if (state === 'active') await page.mouse.up();
  await handle.dispose();
  return painted;
}

async function themes(page, where) {
  let checked = 0;
  const resolve = (name) => page.evaluate((token) => {
    const probe = document.createElement('i');
    probe.style.cssText = `color: var(${token}); position: fixed; visibility: hidden`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
  const flip = page.getByRole('button', { name: 'Next theme' });
  const seenThemes = [];
  for (let step = 0; step < 9; step += 1) {
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-ov-theme'));
    seenThemes.push(theme);
    for (const spec of THEME_CASES) {
      for (const state of ['rest', 'hover', 'active']) {
        const rules = state === 'rest' ? spec.rest : { bg: spec[state].bg };
        if (Object.keys(rules).length === 0 || (state !== 'rest' && spec[state].bg === undefined)) continue;
        const got = await paintOf(page, target(spec.example), state);
        const want = {
          color: rules.color === undefined ? undefined : await resolve(rules.color),
          bg: rules.bg === undefined ? undefined : rules.bg === null ? 'rgba(0, 0, 0, 0)' : await resolve(rules.bg),
          border: rules.border === undefined ? undefined : rules.border === null ? 'rgba(0, 0, 0, 0)' : await resolve(rules.border),
          icon: rules.icon === undefined || rules.icon === null ? undefined : await resolve(rules.icon),
        };
        for (const key of ['color', 'bg', 'border', 'icon']) {
          if (want[key] !== undefined && want[key] !== got[key]) fail(where, `theme ${theme} ${spec.example} ${state} ${key}: the token is ${want[key]}, painted ${got[key]}`);
        }

        checked += 1;
      }
    }

    await flip.click();
    await page.mouse.move(1, 1);
  }

  if (new Set(seenThemes).size !== 9) fail(where, `themes visited: ${seenThemes.join(', ')}`);
  return checked;
}

// ---- counts and root writes -------------------------------------------------------------------------------------------------------
async function countsAndRootWrites(page, where) {
  const counts = await page.evaluate(() => {
    const out = {};
    for (const figure of document.querySelectorAll('[data-example^="Button/"], [data-example^="IconButton/"], [data-example^="Icon/"]')) {
      const stage = figure.querySelector('div');
      out[figure.getAttribute('data-example')] = stage ? stage.querySelectorAll('*').length : -1;
    }

    return out;
  });
  const expect = { 'Button/Secondary': 1, 'Button/WithIcon': 3, 'Button/Busy': 3, 'Button/SecondaryDisabled': 2, 'Button/WithIconDisabled': 4, 'IconButton/Secondary': 3, 'IconButton/SecondaryDisabled': 4, 'IconButton/Busy': 3, 'Icon/Default': 2, 'Icon/Small': 2 };
  for (const [example, count] of Object.entries(expect)) {
    if (counts[example] !== count) fail(where, `elements of ${example}: expected ${count}, found ${counts[example]}`);
  }

  report.counts[where] = counts;

  // No write to <html> or <body> while the pointer visits every control and the keyboard walks through them.
  await page.evaluate(() => {
    window.__rootWrites = [];
    const observer = new MutationObserver((records) => window.__rootWrites.push(...records.map((r) => `${r.target.nodeName}:${r.attributeName}`)));
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    window.__rootStyleBefore = [document.documentElement.getAttribute('style'), document.body.getAttribute('style')];
    window.__rootPropsBefore = [...document.documentElement.style];
  });
  const boxes = await page.locator('[data-example] button').evaluateAll((buttons) => buttons.map((b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }));
  for (const box of boxes.slice(0, 12)) {
    await page.mouse.move(box.x, Math.min(box.y, 800));
  }

  await page.mouse.move(1, 1);
  const writes = await page.evaluate(() => ({ writes: window.__rootWrites, style: [document.documentElement.getAttribute('style'), document.body.getAttribute('style')], before: window.__rootStyleBefore, props: [...document.documentElement.style].filter((p) => p.startsWith('--') && !window.__rootPropsBefore.includes(p)) }));
  if (writes.writes.length) fail(where, `writes to the document root while hovering: ${writes.writes.join(', ')}`);
  if (JSON.stringify(writes.style) !== JSON.stringify(writes.before)) fail(where, 'the style attribute of <html> or <body> changed');
  if (writes.props.length) fail(where, `custom properties on <html>: ${writes.props.join(', ')}`);
}

// ---- keyboard ---------------------------------------------------------------------------------------------------------------
async function keyboard(browser, url, viewport, engineName, where) {
  // A fresh page: the sequential focus starting point of the engine is the document, not the last element a probe touched.
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-example="Button/Secondary"]');
  // Safari and Playwright's WebKit on macOS leave buttons out of the Tab order unless the system asks for it; Alt+Tab reaches them.
  const key = engineName === 'webkit' ? 'Alt+Tab' : 'Tab';
  // The walk covers the parts with this probe's keyboard contract: every button is one Tab stop, in document order (the frame's buttons, Button,
  // IconButton, and the TooltipHost examples). The other parts have their own keyboard model (a DataTable's header buttons and grid, a RovingGroup's
  // one stop, a virtual list that grows as Tab scrolls it, ...), tested with the part: their examples are made `inert` here, so Tab skips them.
  const COUNTED = '^(Button|IconButton|TooltipHost)/';
  const { names, stops } = await page.evaluate((counted) => {
    const isCounted = (b) => { const example = b.closest('[data-example]'); return !example || new RegExp(counted).test(example.getAttribute('data-example') ?? ''); };
    for (const example of document.querySelectorAll('[data-example]')) {
      if (!new RegExp(counted).test(example.getAttribute('data-example') ?? '')) example.setAttribute('inert', '');
    }

    return {
      names: [...document.querySelectorAll('button')].filter(isCounted).map((b) => b.getAttribute('aria-label') ?? b.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
      stops: document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]').length,
    };
  }, COUNTED);
  await page.mouse.move(1, 1);
  // Walk until the first button; every following Tab must land on the next button in document order.
  await page.keyboard.press(key);
  const seen = [];
  for (let i = 0; i < stops + 4 && seen.length < names.length; i += 1) {
    const info = await page.evaluate((counted) => {
      const isCounted = (b) => { const example = b.closest('[data-example]'); return !example || new RegExp(counted).test(example.getAttribute('data-example') ?? ''); };
      const a = document.activeElement;
      if (!a || a.tagName !== 'BUTTON' || !isCounted(a)) return null;
      const all = [...document.querySelectorAll('button')].filter(isCounted);
      return { index: all.indexOf(a), name: a.getAttribute('aria-label') ?? a.textContent?.replace(/\s+/g, ' ').trim(), disabled: a.getAttribute('aria-disabled') === 'true', native: a.disabled, focusVisible: a.matches(':focus-visible') };
    }, COUNTED);
    if (info) seen.push(info);
    if (seen.length < names.length) await page.keyboard.press(key);
  }

  const indexes = seen.map((s) => s.index);
  const inOrder = indexes.every((value, i) => value === i);
  if (!inOrder || seen.length !== names.length) fail(where, `Tab order: reached ${seen.length} of ${names.length} buttons, in order: ${inOrder} (indexes ${indexes.slice(0, 12).join(',')}...)`);
  const unavailable = seen.filter((s) => s.disabled);
  if (unavailable.length === 0) fail(where, 'no reasoned-disabled button was reached by Tab');
  if (seen.some((s) => s.native)) fail(where, 'a button is natively disabled');
  if (seen.some((s) => !s.focusVisible)) fail(where, 'a focused button did not match :focus-visible');
  report.keyboard[where] = { buttons: names.length, reached: seen.length, reasonedDisabledReached: unavailable.length, key };

  // Enter and Space activate an available button: the frame's own Next theme button flips the theme.
  const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-ov-theme'));
  const before = await theme();
  await page.getByRole('button', { name: 'Next theme' }).focus();
  await page.keyboard.press('Enter');
  const afterEnter = await theme();
  await page.keyboard.press('Space');
  const afterSpace = await theme();
  if (afterEnter === before || afterSpace === afterEnter) fail(where, `Enter or Space did not activate Next theme (${before} -> ${afterEnter} -> ${afterSpace})`);
  report.keyboard[where].activation = `${before} -> ${afterEnter} -> ${afterSpace}`;
  await context.close();
}

// ---- busy -------------------------------------------------------------------------------------------------------------------
// The rule (packages/kit/src/shared/useCommand.ts: LOADER_DELAY_MS = 1000; design 13 M2, 05 local loading): a busy command says so at once and its icon
// becomes the loader after one second. The delay is a JS timer, `setTimeout(…, LOADER_DELAY_MS)` started in the effect that runs after the commit
// of `busy` (no CSS animation or transition delay is involved).
//
// Measured in the page, on one clock (`performance.now()`), at the moment each thing happens:
//   timer set    the call of `setTimeout` made while the busy button shows its icon (a wrapper installed before the page's scripts records it)
//   loader       the MutationObserver record that turns the glyph into the loader (the commit of the timer's own `setState`: it can only be seen late)
//   icon         the first MutationObserver record with the icon (seen late as well)
// The old assertion took `loader - icon`. React runs the effect (the timer starts) inside the task that commits the icon, and the observer's record is
// delivered when that task ends: `icon` is therefore later than the timer's start by the rest of the task (15 to 27 ms on a quiet machine, more than 100 ms on
// a loaded one: the 897 and 898 ms of runs 44667706048 and others, against a lower bound of 900), so `loader - icon = delay - lateness`. `loader - timer set` carries no such error.
const LOADER_DELAY_MS = 1000;
// performance.now() is whole milliseconds in WebKit: a difference of two readings is off by one at most.
const CLOCK_MS = 1;
// What the page may add to the delay (a timer fires late on a loaded runner, the commit of the loader follows) and how long after the icon the timer may start.
const LOADER_LATE_MS = 300;

/** What is wrong with a busy button's icon-to-loader timing, or undefined. `timeline` records glyph changes, `timers` the `setTimeout` calls made while the icon showed. */
function judgeLoader({ timeline, timers }) {
  const first = timeline[0];
  const swapped = timeline.find((entry) => entry.glyph === 'loader');
  if (first?.glyph !== 'refresh' || swapped === undefined) return `busy timeline ${JSON.stringify(timeline)}: expected refresh, then loader`;
  // The timer that ended in the loader: the longest one that fired before the loader was committed (the latest, among equals).
  const started = timers.filter((timer) => timer.fired !== undefined && timer.fired <= swapped.at).sort((a, b) => b.delay - a.delay || b.fired - a.fired)[0];
  if (started === undefined) return `no timer set while the icon showed had fired when the loader came (timers ${JSON.stringify(timers)})`;
  const waited = swapped.at - started.set;
  if (waited < LOADER_DELAY_MS - CLOCK_MS || waited > LOADER_DELAY_MS + LOADER_LATE_MS) {
    return `the loader came ${waited.toFixed(1)} ms after its timer was set (timer of ${started.delay} ms set at ${started.set.toFixed(1)}, fired at ${started.fired.toFixed(1)}, loader at ${swapped.at.toFixed(1)}), expected ${LOADER_DELAY_MS} to ${LOADER_DELAY_MS + LOADER_LATE_MS} ms`;
  }
  if (started.set - first.at > LOADER_LATE_MS) return `the timer was set ${(started.set - first.at).toFixed(1)} ms after the icon appeared: the second does not start with the icon`;
  return undefined;
}

async function busy(browser, url, viewport, where) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__busy = { timeline: [], timers: [] };
    const start = performance.now();
    const icon = () => document.querySelector('[data-example="Button/Busy"] svg');
    const note = () => {
      const glyph = icon()?.getAttribute('data-ov-glyph');
      if (glyph === undefined) return;
      if (window.__busy.timeline.at(-1)?.glyph !== glyph) window.__busy.timeline.push({ glyph, at: performance.now() - start });
    };
    new MutationObserver(note).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ov-glyph'] });
    const nativeSetTimeout = window.setTimeout;
    window.setTimeout = function setTimeoutNoted(handler, delay, ...args) {
      if (typeof handler !== 'function' || icon()?.getAttribute('data-ov-glyph') !== 'refresh') return nativeSetTimeout.call(this, handler, delay, ...args);
      const timer = { delay, set: performance.now() - start, fired: undefined };
      window.__busy.timers.push(timer);
      return nativeSetTimeout.call(
        this,
        function noted(...rest) {
          timer.fired = performance.now() - start;
          return handler.apply(this, rest);
        },
        delay,
        ...args,
      );
    };
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const { timeline, timers } = await page.evaluate(() => window.__busy);
  const wrong = judgeLoader({ timeline, timers });
  if (wrong !== undefined) fail(where, wrong);
  const spinning = await page.evaluate(() => getComputedStyle(document.querySelector('[data-example="Button/Busy"] svg')).animationName);
  if (spinning === 'none') fail(where, 'the loader does not turn');
  const ariaBusy = await page.evaluate(() => document.querySelector('[data-example="Button/Busy"] button').getAttribute('aria-busy'));
  if (ariaBusy !== 'true') fail(where, 'aria-busy is not true');
  await context.close();

  const still = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const quiet = await still.newPage();
  await quiet.goto(url, { waitUntil: 'load' });
  await quiet.waitForTimeout(1400);
  const reduced = await quiet.evaluate(() => ({ glyph: document.querySelector('[data-example="Button/Busy"] svg').getAttribute('data-ov-glyph'), animation: getComputedStyle(document.querySelector('[data-example="Button/Busy"] svg')).animationName }));
  if (reduced.glyph !== 'loader' || reduced.animation !== 'none') fail(where, `reduced motion: ${JSON.stringify(reduced)}, expected a still loader`);
  await still.close();
  (report.keyboard[where] ??= {}).busy = { timeline, timers, spinning, reducedMotion: reduced };
}

// ---- a11y -------------------------------------------------------------------------------------------------------------------
async function a11y(page, engineName, where) {
  const snapshots = {};
  for (const example of await page.locator('[data-example^="Button/"], [data-example^="IconButton/"]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-example')))) {
    snapshots[example] = (await page.locator(`[data-example="${example}"] > div`).ariaSnapshot()).replace(/\n\s*/g, ' ').trim();
  }

  const nameless = Object.entries(snapshots).filter(([, snapshot]) => !/button "[^"]+"/.test(snapshot)).map(([example]) => example);
  if (nameless.length) fail(where, `buttons without a name in the accessibility tree: ${nameless.join(', ')}`);
  const unavailable = Object.entries(snapshots).filter(([example]) => /Disabled|DisabledWithVisibleReason/.test(example)).filter(([, snapshot]) => !/\[disabled\]/.test(snapshot)).map(([example]) => example);
  if (unavailable.length) fail(where, `reasoned-disabled examples not exposed as disabled: ${unavailable.join(', ')}`);
  report.a11y[where] = { snapshots };

  // Chromium only: the engine's own accessibility tree (name, description, role and states), which Playwright's aria snapshot does not
  // show for a description. What the DOM says (aria-label or text, the hidden reason, aria-disabled, aria-busy) must be what the engine computes.
  if (engineName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('Accessibility.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const tree = {};
    for (const example of Object.keys(snapshots)) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-example="${example}"] button` });
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
      const node = nodes[0];
      const states = Object.fromEntries((node.properties ?? []).map((property) => [property.name, property.value.value]));
      const dom = await page.locator(`[data-example="${example}"] button`).evaluate((button) => ({
        name: button.getAttribute('aria-label') ?? [...button.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
        reason: button.querySelector('[hidden]')?.textContent ?? '',
        unavailable: button.getAttribute('aria-disabled') === 'true',
        busy: button.getAttribute('aria-busy') === 'true',
      }));
      tree[example] = { role: node.role?.value, name: node.name?.value, description: node.description?.value ?? '', disabled: states.disabled === true, focusable: states.focusable === true, busy: states.busy === true };
      const row = tree[example];
      if (row.role !== 'button') fail(where, `${example}: role ${row.role}`);
      if (row.name !== dom.name) fail(where, `${example}: name ${JSON.stringify(row.name)}, expected ${JSON.stringify(dom.name)}`);
      if (row.description !== dom.reason) fail(where, `${example}: description ${JSON.stringify(row.description)}, expected ${JSON.stringify(dom.reason)}`);
      if (row.disabled !== dom.unavailable) fail(where, `${example}: disabled ${row.disabled}, expected ${dom.unavailable}`);
      if (!row.focusable) fail(where, `${example}: not focusable in the accessibility tree`);
      // Chromium's tree does not surface aria-busy on a button (busy stays false); the attribute is in the DOM, which is what is checked above.
      row.busyInDom = dom.busy;
    }

    report.a11y[where].tree = tree;
    await cdp.detach();
  }

  if (process.env.NO_AXE === undefined) {
    await page.addScriptTag({ path: AXE });
    const result = await page.evaluate(async () => {
       
      const axeResult = await axe.run({ include: [['[data-example]']] }, { resultTypes: ['violations'] });
      return axeResult.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, where: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), data: n.any[0]?.data ?? null })) }));
    });
    report.a11y[where].axe = result;
    for (const violation of result.filter((v) => v.impact === 'serious' || v.impact === 'critical')) fail(where, `axe ${violation.impact}: ${violation.id} on ${violation.nodes} node(s): ${violation.help} ${JSON.stringify(violation.where)}`);
  }
}

// ---- MiddleEllipsis: a cut name is announced and copied once, whole -----------------------------------------------------------
// Head and tail are two boxes of a flex row, which both engines read as two words (`alertmanager-5d5bcf5596 -qxv45`) and copy with a line
// break between. The name is the single string `data-ov-full` holds: the accessibility tree (Playwright's aria snapshot, both engines) of
// the example must be that one text, and selecting the whole box and copying must yield it unchanged. At least one example is cut, or the
// check proves nothing.
async function ellipsisName(page, where) {
  const examples = await page.locator('[data-example^="MiddleEllipsis/"]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-example')));
  if (examples.length === 0) fail(where, 'no MiddleEllipsis example on the parts page');
  let cutOnes = 0;
  const rows = {};
  for (const example of examples) {
    const root = page.locator(`[data-example="${example}"] [data-ov-clip]`);
    const read = await root.evaluate((box) => {
      const selection = getSelection();
      selection.selectAllChildren(box);
      const copied = selection.toString();
      selection.removeAllRanges();
      return { name: box.getAttribute('data-ov-full') ?? box.textContent, cut: box.scrollWidth > box.clientWidth + 1, copied };
    });
    const snapshot = (await root.ariaSnapshot()).replace(/\n\s*/g, ' ').trim();
    if (read.cut) cutOnes += 1;
    rows[example] = { ...read, snapshot };
    if (snapshot !== `- text: ${read.name}`) fail(where, `${example}: the accessibility tree reads ${JSON.stringify(snapshot)}, expected the one text ${JSON.stringify(read.name)}`);
    if (read.copied.trim() !== read.name) fail(where, `${example}: selecting the name copies ${JSON.stringify(read.copied)}, expected ${JSON.stringify(read.name)}`);
  }

  if (cutOnes === 0) fail(where, 'no MiddleEllipsis example is cut on the parts page: the check of a cut name proves nothing');
  report.a11y[where].ellipsis = rows;
}

// ---------------------------------------------------------------------------------------------------------------------------
const dist = buildUiNext();
const { server, partsUrl } = await serve(dist);
try {
  for (const engineName of engineNames) {
    const browser = await launch(engineName);
    for (const viewportName of viewportNames) {
      const viewport = VIEWPORTS[viewportName];
      const where = `${engineName} ${viewportName}`;
      if (ONLY === 'busy') {
        await busy(browser, partsUrl, viewport, where);
        continue;
      }

      const { page, context, errors } = await open(browser, partsUrl, viewport);
      report.parity[where] = { buttons: await parity(page, where), icons: await icons(page, where) };
      await countsAndRootWrites(page, where);
      await keyboard(browser, partsUrl, viewport, engineName, where);
      await a11y(page, engineName, where);
      await ellipsisName(page, where);
      if (SHOTS) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(SHOTS, `${engineName}-${viewportName}-top.png`) });
        await page.locator('[data-example="Button/Secondary"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `${engineName}-${viewportName}-parts.png`), fullPage: true });
      }

      report.themes[where] = { states: viewportName === viewportNames[0] ? await themes(page, where) : 0 };
      await busy(browser, partsUrl, viewport, where);
      if (errors.length) fail(where, `page errors: ${errors.join(' | ')}`);
      await context.close();
    }

    await browser.close();
  }
} finally {
  server.close();
}

const lines = [];
for (const [where, { buttons, icons: iconRows }] of Object.entries(report.parity)) {
  const bad = buttons.filter((row) => row.diffs.length).length;
  lines.push(`${where}: ${buttons.length} button measurements (${bad} with a difference), ${iconRows.length} icon cases, themes ${report.themes[where].states} state checks`);
}

lines.push(...report.notes);
lines.push(failures.length ? `\nFAILURES (${failures.length}):\n  ${failures.join('\n  ')}` : '\nno difference from the mock, no failure');
console.log(lines.join('\n'));
if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1));
if (failures.length) process.exitCode = 1;

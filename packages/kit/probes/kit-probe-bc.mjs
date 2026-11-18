// Compares the kit's Chip, Status, MissingValue, KindTile, QuickFilters, RovingGroup (through QuickFilters) and MiddleEllipsis with the
// design mock's own measurements (mock-atoms-bc.json, made by mock-measure-bc.mjs): the sibling of kit-probe.mjs, which does the
// same for Button, IconButton and Icon. It reuses probe-lib.mjs unchanged.
//
//   pnpm --filter @omniviewdev/kit run build            # the page imports the BUILT kit
//   node packages/kit/probes/kit-probe-bc.mjs           # builds ui-next (OMNIVIEW_UI=next) into a temp dir, serves it, probes it
//
//   DIST=<dir>      probe an existing build instead of building one
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1030x720   ONLY=<regexp>: a debug filter on the ids of the parity, strip and ellipsis
//                   cases and on the example names of the counts, a11y and axe sections; ONLY runs do not exit 1 on missing coverage
//   AXE=<path>      axe-core's axe.min.js (default /tmp/ov-axe/node_modules/axe-core/axe.min.js)
//   SHOTS=<dir>     a screenshot of each of the seven parts' sections per engine and viewport (default theme)
//   REPORT=<file>   the full report as JSON (default /tmp/ov-1a4bc/kit-probe-bc-report.json): every check row, the element counts, the
//                   accessibility tree of each example root and the axe violations
//
// Sections, each in WebKit and Chromium: (parity) every element case of the reference in its states and contexts; (strip) the geometry
// of QuickFilters at 1117, 707 and 300 px; (ellipsis) MiddleEllipsis at ten widths; (counts) the DOM element count of each example root;
// (writes) no write to <html> or <body> while the pointer and the keyboard use every example; (a11y) the accessibility tree name and
// axe-core over the seven parts. At 1440 x 900 only: (roving) the three keyboard traces of the reference replayed on QuickFilters/Default,
// (themes) the painted colours of the nine themes, (axe in the nine themes). Exit 1 on any deviation that KNOWN_DEVIATIONS does not name.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, VIEWPORTS, deviations, measure, normalizeFont, setContext, settle, sleep, summarize } from './probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const reference = JSON.parse(readFileSync(path.join(here, 'mock-atoms-bc.json'), 'utf8'));
const EXTRA = reference.meta.extra;
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(VIEWPORTS).join(',')).split(',');
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const REPORT = process.env.REPORT ?? '/tmp/ov-1a4bc/kit-probe-bc-report.json';
const AXE = process.env.AXE ?? '/tmp/ov-axe/node_modules/axe-core/axe.min.js';
const MAIN = '1440x900';
const PARTS = ['Chip', 'Status', 'MissingValue', 'KindTile', 'QuickFilters', 'MiddleEllipsis'];
const wanted = (id) => !only || only.test(id);

// ---------------------------------------------------------------------------------------------------------------------------
// What differs on purpose, each with its reason: { section, id: RegExp on the check id, reason }. A deviation not listed fails the probe.
const KNOWN_DEVIATIONS = [
  { section: 'ellipsis', id: /^ellipsis:\S+ pclip (root\.h|rootScroll|cut)$/, reason: 'the mock\'s plain name wraps at a hyphen in the probe\'s bare block stage; the kit\'s is nowrap (the kit\'s own cut signal is checked against its text width)' },
  { section: 'strip', id: /^quick-zero\/\d+ chip 0 \(All 89\)\.text$/, reason: 'mock-atoms-bc.json measured quick-zero with All 89, the kit example says 85 (the same width)' },
  { section: 'roving', id: /^modifiers step 3 \(Alt\+ArrowRight\) prevented$/, reason: 'in the mock the shell\'s own history shortcut prevents Alt+ArrowRight (the strip\'s roving handler ignores Alt, as rovingKeys does); the kit\'s group ignores Alt too and nothing moves in either: prevented differs by design' },
];

// ---------------------------------------------------------------------------------------------------------------------------
// parity: reference case -> kit example. `label: false`: the example's text differs (only the chrome width is compared).
const CAP = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const TONES = ['success', 'warning', 'error', 'info', 'muted'];
const PARITY = [];
const add = (id, example, o = {}) => PARITY.push({ id, example, ...o });
add('chip-static', 'Chip/Static');
add('chip-static-count', 'Chip/WithCount');
for (const t of TONES) add(`chip-static-${t}`, `Chip/Tone${CAP(t)}`, { label: false });
add('chip-static-count-success', 'Chip/CountWithTone', { label: false, skip: ['chrome width'] });
add('chip-static-count-muted', 'Chip/CountWithMutedTone', { label: false, skip: ['chrome width'], countDiffers: true });
add('chip-button', 'Chip/Toggle');
add('chip-button-selected', 'Chip/TogglePressed');
add('chip-button-nocount', 'Chip/ToggleWithoutCount');
for (const t of TONES) add(`chip-button-${t}`, `Chip/Toggle${CAP(t)}`, { label: t === 'error' });
add('chip-button-selected-success', 'Chip/TogglePressedWithTone', { label: false });
add('chip-button-selected-muted', 'Chip/TogglePressedMuted', { label: false });
add('chip-removable', 'Chip/Removable');
add('chip-removable-warning', 'Chip/RemovableWithTone');
add('chip-removable-remove', 'Chip/Removable', { target: '[data-example="Chip/Removable"] button' });
for (const [id, example] of [['healthy', 'Healthy'], ['running', 'Running'], ['progress', 'InProgress'], ['attention', 'Attention'], ['error', 'Failed'], ['stopped', 'Stopped'], ['info', 'Info']]) add(`status-${id}`, `Status/${example}`);
add('status-progress', 'Status/Queued', { label: false, tag: 'queued', extras: false });
// `block`: the stage is a block while it is measured (the mock's inline text is blockified in the page's flex stage).
add('none-default', 'MissingValue/NotApplicable', { block: true });
add('none-named', 'MissingValue/Named', { block: true });
add('none-reason', 'MissingValue/WithReason', { extras: ['wrapper'], block: true });
add('tile-20', 'KindTile/Blue');
add('tile-16', 'KindTile/Small');
add('tile-neutral', 'KindTile/Neutral');
for (const [hue, nth] of [['orange', 2], ['green', 3], ['purple', 5], ['pink', 6], ['red', 7], ['teal', 8]]) add(`tile-${hue}`, 'KindTile/AllTones', { target: `[data-example="KindTile/AllTones"] > div > :first-child > :nth-child(${nth})` });
const rootOf = (example) => `[data-example="${example}"] > div > :first-child`;
const targetOf = (spec) => spec.target ?? rootOf(spec.example);
const keyOf = (spec) => (spec.tag ? `${spec.id}~${spec.tag}` : spec.id);

// The theme sections reuse the same parity specs.
const specById = Object.fromEntries(PARITY.filter((s) => !s.tag).map((s) => [s.id, s]));

const CONTEXTS = {
  default: { textScale: null, density: null },
  scale125: { textScale: '125', density: null },
  scale80: { textScale: '80', density: null },
};

// ---------------------------------------------------------------------------------------------------------------------------
async function build() {
  if (process.env.DIST) return process.env.DIST;
  const out = mkdtempSync(path.join(os.tmpdir(), 'kit-probe-bc-'));
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
  // `url` is the page under probe: the kit's parts page, which is `?screen=parts` now that the window's default screen is the plugins'.
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/?screen=parts` })));
}

// ---------------------------------------------------------------------------------------------------------------------------
const failures = []; // { section, where, id, msg }
const known = []; // deviations named in KNOWN_DEVIATIONS
const checks = {}; // checks[where][section] = n
const report = { parity: {}, strip: {}, ellipsis: {}, flex: {}, roving: {}, themes: {}, counts: {}, writes: {}, a11y: {}, axe: {}, notes: [] };
const errorsSeen = {};
const tick = (where, section, n = 1) => { ((checks[where] ??= {})[section] ??= 0); checks[where][section] += n; };
function fail(section, where, id, msg) {
  const entry = { section, where, id, msg };
  const k = KNOWN_DEVIATIONS.find((d) => d.section === section && d.id.test(id));
  if (k) known.push({ ...entry, reason: k.reason });
  else failures.push(entry);
}

/** A reference value is one, or { webkit, chromium }, each one or { <viewport>: value }. */
function pick(value, engine, viewport) {
  if (value && typeof value === 'object' && !Array.isArray(value) && !('w' in value) && ('webkit' in value || 'chromium' in value)) {
    const byEngine = value[engine];
    if (byEngine && typeof byEngine === 'object' && !Array.isArray(byEngine) && !('w' in byEngine) && viewport in byEngine) return byEngine[viewport];
    return byEngine;
  }
  return value;
}

const near = (a, b, tolerance = 1) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;

async function open(browser, url, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico') && !response.url().includes('/wails/')) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text().slice(0, 200));
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-example="Chip/Static"]');
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  return { page, context, errors };
}

/** A locator whose measure() records also carry `glyph`, the sorted unique fill|stroke of the svg shapes in the state in effect. */
function withGlyph(locator) {
  return {
    waitFor: (o) => locator.waitFor(o),
    elementHandle: async () => {
      const handle = await locator.elementHandle();
      return new Proxy(handle, {
        get(target, prop) {
          if (prop === 'evaluate') {
            return async (fn, arg) => {
              const r = await target.evaluate(fn, arg);
              if (Array.isArray(arg) && r && r.rect) r.glyph = await target.evaluate((el) => [...new Set([...el.querySelectorAll('svg path, svg circle')].map((n) => { const c = getComputedStyle(n); return `${c.fill}|${c.stroke}`; }))].sort());
              return r;
            };
          }
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
}

// ---- parity -------------------------------------------------------------------------------------------------------------------
function readExtras(el, kinds) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const tb = el.getBoundingClientRect();
  const out = {};
  if (kinds.includes('count')) {
    const b = el.querySelector('b');
    if (b) {
      const bb = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      out.count = { left: r2(bb.left - tb.left), top: r2(bb.top - tb.top), w: r2(bb.width), h: r2(bb.height), color: cs.color, fontWeight: cs.fontWeight };
    } else {
      out.count = null;
    }
  }
  if (kinds.includes('glyph')) {
    const shapes = [...el.querySelectorAll('svg path, svg circle')];
    out.glyph = [...new Set(shapes.map((n) => { const c = getComputedStyle(n); return `${c.fill}|${c.stroke}`; }))].sort();
    out.shapes = shapes.length;
  }
  if (kinds.includes('tile')) {
    const p = el.querySelector('svg path');
    out.color = getComputedStyle(el).color;
    out.stroke = p ? getComputedStyle(p).stroke : null;
  }
  return out;
}

async function parity(page, where, vpName, engineName) {
  const rows = [];
  for (const spec of PARITY) {
    if (!wanted(spec.id)) continue;
    const mock = reference.cases[spec.id];
    for (const contextName of Object.keys(mock).filter((k) => k !== 'markup')) {
      await setContext(page, { ...CONTEXTS[contextName], flavour: 'kit' });
      if (spec.block) await page.evaluate((example) => { document.querySelector(`[data-example="${example}"] > div`).style.display = 'block'; }, spec.example);
      const refCtx = mock[contextName];
      const states = Object.keys(refCtx).filter((k) => k !== 'extras');
      const recs = await measure(page, withGlyph(page.locator(targetOf(spec))), { states });
      for (const state of states) {
        const want = pick(refCtx[state], engineName, vpName);
        const got = summarize(recs[state], { withOutline: state === 'focus', extra: EXTRA });
        const diffs = deviations(want, got, { sameLabel: spec.label !== false, withOutline: state === 'focus', skip: spec.skip ?? [], extra: EXTRA });
        rows.push({ id: keyOf(spec), example: spec.example, context: contextName, state, mock: `${want.w}x${want.h}`, kit: `${got.w}x${got.h}`, el: `${want.el} -> ${got.el}`, diffs });
        tick(where, 'parity');
        for (const diff of diffs) fail('parity', where, `${keyOf(spec)}/${contextName}/${state}`, `(${spec.example}) ${diff}`);
      }

      // The extras are read at rest (measure leaves the pointer away and nothing focused).
      const wantExtras = pick(refCtx.extras, engineName, vpName);
      if (wantExtras && spec.extras !== false) {
        const kinds = ['count', 'glyph', 'tile'].filter((k) => (k === 'count' && 'count' in wantExtras) || (k === 'glyph' && 'glyph' in wantExtras) || (k === 'tile' && 'color' in wantExtras));
        const gotExtras = await page.locator(targetOf(spec)).first().evaluate(readExtras, kinds);
        const where2 = `${keyOf(spec)}/${contextName}`;
        if ('count' in wantExtras) {
          const w = wantExtras.count;
          const g = gotExtras.count;
          tick(where, 'parity');
          if (!g) fail('parity', where, `${where2}/extras.count`, 'the kit chip has no <b> count');
          else {
            const wantW = refCtx.rest.w;
            const gotW = recs.rest.rect.w;
            // The text of the kit's example differs from the mock's: where it does, the count is placed from the chip's right edge,
            // which does not depend on the label; where the count differs too (0 for 80), only its height, top and paint are compared.
            const keys = spec.label === false ? (spec.countDiffers ? ['top', 'h'] : ['top', 'w', 'h', 'right']) : ['left', 'top', 'w', 'h'];
            const place = (c, chipW) => ({ ...c, right: Math.round((chipW - c.left - c.w) * 100) / 100 });
            const a = place(w, wantW);
            const b = place(g, gotW);
            for (const key of keys) if (!near(a[key], b[key])) fail('parity', where, `${where2}/extras.count`, `count.${key}: mock ${a[key]} kit ${b[key]}`);
            for (const key of ['color', 'fontWeight']) if (w[key] !== g[key]) fail('parity', where, `${where2}/extras.count`, `count.${key}: mock ${w[key]} kit ${g[key]}`);
          }
        }

        if ('glyph' in wantExtras) {
          tick(where, 'parity');
          if (JSON.stringify(wantExtras.glyph) !== JSON.stringify(gotExtras.glyph)) fail('parity', where, `${where2}/extras.glyph`, `glyph paints: mock ${JSON.stringify(wantExtras.glyph)} kit ${JSON.stringify(gotExtras.glyph)}`);
          if (wantExtras.shapes !== gotExtras.shapes) report.notes.push(`${where} ${where2}: path/circle count mock ${wantExtras.shapes} kit ${gotExtras.shapes}`);
        }

        if ('color' in wantExtras) {
          tick(where, 'parity');
          if (wantExtras.color !== gotExtras.color) fail('parity', where, `${where2}/extras.tile`, `tile colour: mock ${wantExtras.color} kit ${gotExtras.color}`);
          if (wantExtras.stroke !== gotExtras.stroke) fail('parity', where, `${where2}/extras.tile`, `glyph stroke: mock ${wantExtras.stroke} kit ${gotExtras.stroke}`);
        }
      }
    }

    if (spec.block) await page.evaluate((example) => { document.querySelector(`[data-example="${example}"] > div`).style.display = ''; }, spec.example);
    await setContext(page, { ...CONTEXTS.default, flavour: 'kit' });
  }

  report.parity[where] = rows;
}

// ---- strip --------------------------------------------------------------------------------------------------------------------
const QUICK = { 'quick-all': 'QuickFilters/Default', 'quick-failed': 'QuickFilters/FailedSelected', 'quick-zero': 'QuickFilters/EmptyFilters', 'quick-loading': 'QuickFilters/CountsUnknown' };

function readStrip(example) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const stage = document.querySelector(`[data-example="${example}"] > div`);
  const strip = stage.firstElementChild;
  const sb = strip.getBoundingClientRect();
  const cs = getComputedStyle(strip);
  const chips = [...strip.querySelectorAll('button')].map((b) => {
    const bb = b.getBoundingClientRect();
    return { text: b.textContent.replace(/\s+/g, ' ').trim(), left: r2(bb.left - sb.left), top: r2(bb.top - sb.top), w: r2(bb.width), h: r2(bb.height), pressed: b.getAttribute('aria-pressed'), tone: b.getAttribute('data-ov-tone') };
  });
  return {
    strip: { w: r2(sb.width), h: r2(sb.height) },
    chips,
    rows: new Set(chips.map((c) => c.top)).size,
    elements: 1 + strip.querySelectorAll('*').length,
    display: cs.display, flexWrap: cs.flexWrap, columnGap: cs.columnGap, rowGap: cs.rowGap, alignItems: cs.alignItems,
  };
}

async function strip(page, where, vpName, engineName) {
  for (const [id, example] of Object.entries(QUICK)) {
    if (!wanted(id)) continue;
    for (const [w, wantRaw] of Object.entries(reference.quick[id])) {
      const want = pick(wantRaw, engineName, vpName);
      const read = async (display) => {
        await page.evaluate(({ example, w, display }) => { const stage = document.querySelector(`[data-example="${example}"] > div`); stage.style.width = `${w}px`; stage.style.display = display; }, { example, w, display });
        await settle(page);
        const result = await page.evaluate(readStrip, example);
        await page.evaluate((example) => { const stage = document.querySelector(`[data-example="${example}"] > div`); stage.style.width = ''; stage.style.display = ''; }, example);
        return result;
      };
      // The flex stage of the page, as it is: the strip is a flex item and shrinks to its content. Only its width is looked at.
      const inFlex = await read('');
      const flexCounts = ((report.flex[where] ??= {}).strip ??= { differ: 0, total: 0 });
      flexCounts.total += 1;
      if (!near(want.strip.w, inFlex.strip.w)) flexCounts.differ += 1;
      // The block stage of the mock: the cell is a block and the strip fills it.
      const got = await read('block');
      const key = `${id}/${w}`;
      const diffs = [];
      for (const k of ['w', 'h']) if (!near(want.strip[k], got.strip[k])) diffs.push(`strip.${k}: mock ${want.strip[k]} kit ${got.strip[k]}`);
      for (const k of ['rows', 'elements', 'display', 'flexWrap', 'columnGap', 'rowGap', 'alignItems']) if (want[k] !== got[k]) diffs.push(`${k}: mock ${want[k]} kit ${got[k]}`);
      if (want.chips.length !== got.chips.length) diffs.push(`chips: mock ${want.chips.length} kit ${got.chips.length}`);
      else {
        want.chips.forEach((c, i) => {
          for (const k of ['left', 'top', 'w', 'h']) if (!near(c[k], got.chips[i][k])) diffs.push(`chip ${i} (${c.text}).${k}: mock ${c[k]} kit ${got.chips[i][k]}`);
          for (const k of ['text', 'pressed', 'tone']) if (c[k] !== got.chips[i][k]) diffs.push(`chip ${i} (${c.text}).${k}: mock ${c[k]} kit ${got.chips[i][k]}`);
        });
      }

      tick(where, 'strip');
      for (const diff of diffs) fail('strip', where, `${key} ${diff.split(':')[0]}`, diff);
      ((report.strip[where] ??= {})[key] = { diffs, kit: got });
    }
  }
}

// ---- ellipsis -----------------------------------------------------------------------------------------------------------------
const ELLIPSIS = { G: 'GeneratedName', L: 'LongGeneratedName', J: 'Timestamped', S: 'Short', D: 'DefaultTail', T12: 'TwelveCharacters', T13: 'ThirteenCharacters', 'G-scale125': 'GeneratedName' };

function readEllipsis({ example, width, display }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const stage = document.querySelector(`[data-example="${example}"] > div`);
  stage.style.width = `${width}px`;
  stage.style.display = display;
  const root = stage.firstElementChild;
  const rb = root.getBoundingClientRect();
  const split = root.getAttribute('data-ov-shape') === 'split';
  const head = split ? root.children[0] : null;
  const tail = split ? root.children[1] : null;
  const hb = head?.getBoundingClientRect();
  const tb = tail?.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(root);
  const out = {
    kind: split ? 'pmid' : 'pclip',
    root: { w: r2(rb.width), h: r2(rb.height) },
    headW: hb ? r2(hb.width) : null,
    tailW: tb ? r2(tb.width) : null,
    tailLeft: tb ? r2(tb.left - rb.left) : null,
    headClient: head ? r2(head.clientWidth) : null,
    rootScroll: r2(root.scrollWidth),
    rootClient: r2(root.clientWidth),
    cut: root.scrollWidth > root.clientWidth + 1,
    overflowX: getComputedStyle(root).overflowX,
    natural: r2(range.getBoundingClientRect().width),
    elements: 1 + root.querySelectorAll('*').length,
    text: root.textContent,
  };
  stage.style.width = '';
  stage.style.display = '';
  return out;
}

async function ellipsis(page, where, vpName, engineName) {
  for (const [id, exampleName] of Object.entries(ELLIPSIS)) {
    if (!wanted(id)) continue;
    const example = `MiddleEllipsis/${exampleName}`;
    await setContext(page, { ...CONTEXTS[id.endsWith('scale125') ? 'scale125' : 'default'], flavour: 'kit' });
    for (const [width, wantRaw] of Object.entries(reference.ellipsis[id])) {
      const want = pick(wantRaw, engineName, vpName);
      // The flex stage of the page, as it is: the root is a flex item and shrinks to its content. Only the root width is looked at.
      const inFlex = await page.evaluate(readEllipsis, { example, width, display: '' });
      const flexCounts = ((report.flex[where] ??= {}).ellipsis ??= { differ: 0, total: 0 });
      flexCounts.total += 1;
      if (!near(want.root.w, inFlex.root.w)) flexCounts.differ += 1;
      // The block stage of the mock: the cell is a block and the name fills it.
      const got = await page.evaluate(readEllipsis, { example, width, display: 'block' });
      const key = `ellipsis:${id}/${width}`;
      const diffs = [];
      const bad = (what, a, b) => diffs.push([what, `${what}: mock ${JSON.stringify(a)} kit ${JSON.stringify(b)}`]);
      if (want.kind !== got.kind) bad('kind', want.kind, got.kind);
      if (!near(want.root.w, got.root.w)) bad('root.w', want.root.w, got.root.w);
      if (!near(want.root.h, got.root.h)) bad('root.h', want.root.h, got.root.h);
      for (const k of ['headW', 'tailW', 'tailLeft', 'headClient']) if (want[k] !== null || got[k] !== null) if (!near(want[k], got[k])) bad(k, want[k], got[k]);
      for (const k of ['rootScroll', 'rootClient']) if (!near(want[k], got[k])) bad(k, want[k], got[k]);
      if (want.cut !== got.cut) bad('cut', want.cut, got.cut);
      if (want.text !== got.text) bad('text', want.text, got.text);
      if (got.overflowX === 'visible') bad('root overflow-x', 'not visible', got.overflowX);
      if (got.cut !== (got.rootScroll > got.rootClient + 1)) bad('cut signal', 'scrollWidth > clientWidth + 1', got.cut);
      // The kit alone: a plain name is cut exactly when its text is wider than the box.
      if (got.kind === 'pclip' && got.cut !== (got.natural > got.rootClient + 1)) bad('cut vs text width', `text ${got.natural} wider than ${got.rootClient}: ${got.natural > got.rootClient + 1}`, got.cut);
      tick(where, 'ellipsis');
      for (const [what, msg] of diffs) fail('ellipsis', where, `${key} ${got.kind} ${what}`, msg);
      ((report.ellipsis[where] ??= {})[key] = { diffs: diffs.map((d) => d[1]), kit: got });
    }

    await setContext(page, { ...CONTEXTS.default, flavour: 'kit' });
  }
}

// ---- roving -------------------------------------------------------------------------------------------------------------------
const SCENARIOS = {
  arrows: ['Tab', 'ArrowRight', 'ArrowRight', 'End', 'ArrowRight', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Tab', 'Shift+Tab', 'Shift+Tab'],
  modifiers: ['Tab', 'Shift+ArrowRight', 'Alt+ArrowRight', 'Meta+ArrowRight', 'Control+ArrowRight', 'Control+End', 'Control+Home'],
  'pressed-stop': ['Tab', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'Enter', 'Tab', 'Shift+Tab'],
};

async function roving(browser, url, engineName, where) {
  for (const [scenario, keys] of Object.entries(SCENARIOS)) {
    if (!wanted(scenario)) continue;
    const { page, context, errors } = await open(browser, url, VIEWPORTS[MAIN]);
    await page.evaluate(() => {
      const stage = document.querySelector('[data-example="QuickFilters/Default"] > div');
      const group = stage.firstElementChild;
      const make = (id) => {
        const b = document.createElement('button');
        b.id = id;
        b.type = 'button';
        b.textContent = id;
        return b;
      };
      stage.insertBefore(make('probe-prev'), group);
      stage.appendChild(make('probe-next'));
      window.__kd = [];
      window.addEventListener('keydown', (e) => window.__kd.push({ key: e.key, prevented: e.defaultPrevented }));
      document.getElementById('probe-prev').focus();
    });
    const steps = [];
    for (const key of keys) {
      const press = engineName === 'webkit' ? ({ Tab: 'Alt+Tab', 'Shift+Tab': 'Alt+Shift+Tab' })[key] ?? key : key;
      await page.evaluate(() => { window.__kd = []; });
      await page.keyboard.press(press);
      await sleep(key === 'Enter' ? 400 : 80);
      const step = await page.evaluate(() => {
        const group = document.querySelector('[data-example="QuickFilters/Default"] > div > [role=group]');
        const btns = [...group.querySelectorAll('button')];
        const a = document.activeElement;
        let at;
        if (btns.includes(a)) at = btns.indexOf(a);
        else if (a?.id === 'probe-prev') at = 'prev';
        else if (a?.id === 'probe-next') at = 'next';
        else at = `other:${a ? a.tagName.toLowerCase() : 'none'}`;
        const main = window.__kd.filter((k) => !['Shift', 'Alt', 'Control', 'Meta'].includes(k.key)).at(-1);
        return { at, tabindex: btns.map((b) => b.getAttribute('tabindex')), pressed: btns.map((b) => b.getAttribute('aria-pressed')), prevented: main ? main.prevented : null };
      });
      steps.push({ key, ...step });
    }

    if (errors.length) report.notes.push(`${where} roving ${scenario}: page errors ${errors.join(' | ')}`);
    await context.close();
    const want = pick(reference.roving[scenario], engineName, MAIN);
    steps.forEach((step, i) => {
      for (const k of ['at', 'tabindex', 'pressed', 'prevented']) {
        if (JSON.stringify(step[k]) !== JSON.stringify(want[i][k])) fail('roving', where, `${scenario} step ${i + 1} (${step.key}) ${k}`, `${k}: mock ${JSON.stringify(want[i][k])} kit ${JSON.stringify(step[k])}`);
      }

      tick(where, 'roving', 4);
    });
    report.roving[`${where} ${scenario}`] = steps;
  }
}

// ---- themes -------------------------------------------------------------------------------------------------------------------
async function themes(page, where, engineName) {
  const seen = [];
  for (const [themeId, byCase] of Object.entries(reference.paints)) {
    seen.push(themeId);
    await page.evaluate((id) => document.documentElement.setAttribute('data-ov-theme', id), themeId);
    await settle(page);
    const themeWhere = `${where} ${themeId}`;
    for (const [id, byState] of Object.entries(byCase)) {
      if (!wanted(id)) continue;
      const spec = specById[id];
      const states = Object.keys(byState);
      const recs = await measure(page, withGlyph(page.locator(targetOf(spec))), { states });
      for (const state of states) {
        const want = pick(byState[state], engineName, MAIN);
        const rec = recs[state];
        const s = rec.style;
        const got = {
          color: s.color,
          bg: s.backgroundColor,
          image: s.backgroundImage,
          border: s.borderTopColor,
          outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`,
          icon: rec.parts.icon ? rec.parts.icon.style.color : null,
          glyph: rec.glyph,
        };
        // The outline is a state of focus only: at rest and on hover the mock's value is the unfocused computed one, which the kit may name differently.
        const keys = ['color', 'bg', 'image', 'border', ...(state === 'focus' ? ['outline'] : []), 'icon', 'glyph'];
        for (const k of keys) {
          tick(themeWhere, 'themes');
          if (JSON.stringify(want[k]) !== JSON.stringify(got[k])) fail('themes', where, `${themeId} ${id}/${state} ${k}`, `${k}: mock ${JSON.stringify(want[k])} kit ${JSON.stringify(got[k])}`);
        }
      }
    }
  }

  await page.evaluate(() => document.documentElement.setAttribute('data-ov-theme', 'void'));
  await settle(page);
  report.themes[where] = seen;
}

// ---- counts, root writes, a11y, axe ---------------------------------------------------------------------------------------------
const EXPECT_COUNT = {
  'Chip/Static': 1, 'Chip/WithCount': 2, 'Chip/Toggle': 3, 'Chip/Removable': 5,
  'Status/Running': 3, 'Status/Failed': 4, 'MissingValue/NotApplicable': 1, 'KindTile/Blue': 3,
  'MiddleEllipsis/Short': 1, 'MiddleEllipsis/GeneratedName': 4, 'QuickFilters/Default': 16,
};
const partSelector = (part) => `[data-example^="${part}/"]`;

async function counts(page, where) {
  const got = await page.evaluate((parts) => {
    const out = {};
    for (const part of parts) {
      for (const figure of document.querySelectorAll(`[data-example^="${part}/"]`)) {
        const root = figure.querySelector(':scope > div')?.firstElementChild;
        out[figure.getAttribute('data-example')] = root ? 1 + root.querySelectorAll('*').length : 0; // 0: text only
      }
    }

    return out;
  }, PARTS);
  for (const [example, count] of Object.entries(EXPECT_COUNT)) {
    if (!wanted(example)) continue;
    tick(where, 'counts');
    if (got[example] !== count) fail('counts', where, example, `elements of ${example}: expected ${count}, found ${got[example]}`);
  }

  report.counts[where] = got;
}

async function writes(page, where) {
  await page.evaluate(() => {
    window.__rootWrites = [];
    const observer = new MutationObserver((records) => window.__rootWrites.push(...records.map((r) => `${r.target.nodeName}:${r.attributeName}`)));
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    window.__rootBefore = [document.documentElement.getAttribute('style'), document.body.getAttribute('style'), document.documentElement.outerHTML.slice(0, document.documentElement.outerHTML.indexOf('>'))];
  });
  const selector = PARTS.map(partSelector).join(', ');
  const boxes = await page.locator(selector).evaluateAll((figures) => figures.map((f) => { const r = (f.querySelector(':scope > div')?.firstElementChild ?? f).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  let visited = 0;
  for (const figure of await page.locator(selector).all()) {
    if (!wanted(await figure.getAttribute('data-example'))) continue;
    await figure.scrollIntoViewIfNeeded();
    const root = figure.locator(':scope > div').locator(':scope > *').first();
    // A text-only example (Status/BooleanWord) has no element to hover: its stage is the target.
    const box = (await root.count()) ? await root.boundingBox() : await figure.locator(':scope > div').boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (const button of await figure.locator('button').all()) {
      await button.hover();
      await button.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Home');
      await page.keyboard.press('End');
      await page.keyboard.press('Space');
      await page.keyboard.press('Enter');
      await button.click();
    }

    visited += 1;
  }

  void boxes;
  await page.mouse.move(1, 1);
  const after = await page.evaluate(() => ({ writes: window.__rootWrites, now: [document.documentElement.getAttribute('style'), document.body.getAttribute('style'), document.documentElement.outerHTML.slice(0, document.documentElement.outerHTML.indexOf('>'))], before: window.__rootBefore }));
  tick(where, 'writes');
  if (after.writes.length) fail('writes', where, 'root writes', `writes to the document root during pointer and keyboard use: ${after.writes.join(', ')}`);
  if (JSON.stringify(after.now) !== JSON.stringify(after.before)) fail('writes', where, 'root attributes', `the attributes of <html> or <body> changed: ${JSON.stringify(after.before)} -> ${JSON.stringify(after.now)}`);
  report.writes[where] = { examples: visited, writes: after.writes };
}

async function a11y(page, where) {
  const examples = await page.locator(PARTS.map(partSelector).join(', ')).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-example')));
  const snapshots = {};
  for (const example of examples) {
    if (!wanted(example)) continue;
    snapshots[example] = (await page.locator(`[data-example="${example}"] > div`).ariaSnapshot()).replace(/\n\s*/g, ' ').trim();
    tick(where, 'a11y');
  }

  report.a11y[where] = snapshots;
}

async function axe(page, where, label) {
  await page.addScriptTag({ path: AXE });
  const result = await page.evaluate(async (parts) => {
    const r = await axe.run({ include: parts.map((p) => [`[data-example^="${p}/"]`]) }, { resultTypes: ['violations'] });
    return r.violations.flatMap((v) => v.nodes.map((n) => ({ id: v.id, impact: v.impact, target: n.target.join(' '), example: document.querySelector(n.target[0])?.closest('[data-example]')?.getAttribute('data-example') ?? null, data: n.any[0]?.data ?? n.any[0]?.message ?? null })));
  }, PARTS);
  tick(where, 'axe');
  report.axe[`${where} ${label}`] = result;
  for (const v of result) fail('axe', where, `${label} ${v.id} ${v.example}`, `axe ${v.id} (${v.impact}) on ${v.target} [${label}] ${JSON.stringify(v.data)}`);
}

// ---------------------------------------------------------------------------------------------------------------------------
const t0 = Date.now();
const dist = await build();
const { server, url } = await serve(dist);
const timings = {};
try {
  for (const engineName of engineNames) {
    const browser = await ENGINES[engineName].launch();
    for (const vpName of viewportNames) {
      const t = Date.now();
      const where = `${engineName} ${vpName}`;
      const { page, context, errors } = await open(browser, url, VIEWPORTS[vpName]);
      await parity(page, where, vpName, engineName);
      await strip(page, where, vpName, engineName);
      await ellipsis(page, where, vpName, engineName);
      await counts(page, where);
      await a11y(page, where);
      await axe(page, where, 'void');
      // (writes: after the sections that read the examples at rest)
      if (SHOTS) {
        await page.evaluate(() => window.scrollTo(0, 0));
        for (const part of PARTS) {
          await page.locator('h3', { hasText: new RegExp(`^${part}$`) }).locator('..').screenshot({ path: path.join(SHOTS, `${engineName}-${vpName}-${part}.png`) });
        }
      }

      if (vpName === MAIN) {
        await themes(page, where, engineName);
        for (const themeId of Object.keys(reference.paints)) {
          await page.evaluate((id) => document.documentElement.setAttribute('data-ov-theme', id), themeId);
          await settle(page);
          await axe(page, where, themeId);
        }
        await page.evaluate(() => document.documentElement.setAttribute('data-ov-theme', 'void'));
        await settle(page);
      }

      // Last: it presses every button of every example, which changes the state of the toggles.
      await writes(page, where);

      if (errors.length) errorsSeen[where] = errors;
      await context.close();
      if (vpName === MAIN) await roving(browser, url, engineName, where);
      timings[where] = ((Date.now() - t) / 1000).toFixed(1);
      console.log(`${where} done in ${timings[where]}s`);
    }

    await browser.close();
  }
} finally {
  server.close();
}

// ---- report -------------------------------------------------------------------------------------------------------------------
mkdirSync(path.dirname(REPORT), { recursive: true });
writeFileSync(REPORT, JSON.stringify({ checks, failures, known, ...report, errorsSeen }, null, 1));

const out = [];
out.push(`total ${((Date.now() - t0) / 1000).toFixed(0)}s; build ${dist}; report ${REPORT}`);
for (const [where, sections] of Object.entries(checks)) {
  if (where.split(' ').length === 2) out.push(`${where}: ${Object.entries(sections).map(([s, n]) => `${s} ${n}`).join(', ')}`);
}

const themeChecks = {};
for (const [where, sections] of Object.entries(checks)) if (sections.themes) { const [engine, , theme] = where.split(' '); (themeChecks[engine] ??= {})[theme] = sections.themes; }
for (const [engine, byTheme] of Object.entries(themeChecks)) out.push(`themes ${engine}: ${Object.entries(byTheme).map(([t, n]) => `${t} ${n}`).join(', ')}`);

// One line per distinct deviation, with every place it happened.
const grouped = new Map();
for (const f of failures) {
  const key = `${f.section} | ${f.id} | ${f.msg}`;
  (grouped.get(key) ?? grouped.set(key, []).get(key)).push(f.where);
}

out.push(`deviations: ${grouped.size === 0 ? 'none' : `${grouped.size} distinct (${failures.length} occurrences)`}`);
for (const [key, wheres] of grouped) out.push(`  ${key}   [${wheres.length === engineNames.length * viewportNames.length ? 'all' : wheres.join('; ')}]`);
out.push(`known deviations: ${known.length}${known.length ? ` (${[...new Set(known.map((k) => k.reason))].join(' / ')})` : ''}`);
for (const [where, sections] of Object.entries(report.flex)) out.push(`flex stage (the page's own, not compared as deviations) ${where}: ${Object.entries(sections).map(([s, c]) => `${s}: root width differs from the mock's in ${c.differ} of ${c.total}`).join(', ')}`);
out.push(`notes: ${report.notes.length ? `\n  ${[...new Set(report.notes)].join('\n  ')}` : 'none'}`);
const errs = Object.entries(errorsSeen).map(([k, v]) => `${k}: ${v.length} (${v[0]})`);
out.push(`page errors: ${errs.length ? errs.join('; ') : 'none'}`);
console.log(out.join('\n'));
if (!existsSync(AXE)) console.log(`AXE not found at ${AXE}`);
if (failures.length || errs.length) process.exitCode = 1;

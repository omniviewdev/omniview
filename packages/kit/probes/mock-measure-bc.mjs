// Measures the design mock's chips, quick filters, resource state, missing value, tile and middle-ellipsis name: the REFERENCE the kit parts
// Chip, RovingGroup, QuickFilters, Status, MissingValue, KindTile and MiddleEllipsis are compared with. The sibling of mock-measure.mjs, which
// measured Icon, Button and IconButton; it reuses probe-lib.mjs unchanged.
//
//   1. Serve the mock (a CommonJS copy of its server.js with `root` set to the mock directory; the lab's package.json says
//      "type": "module"): the mock is `app/OmniviewNativeLab/frontend/mock` of the private repository omniviewdev/design-lab at tag
//      spec-baseline-2026-11-16 (mock tree c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0).
//   2. MOCK_URL=http://127.0.0.1:<port>/ node packages/kit/probes/mock-measure-bc.mjs
//
// Six sections, every one in WebKit and Chromium; the first four also at 1440 x 900 and 1030 x 720:
//   1. cases[id][ctx][state]       the mock's own helpers (H.chip, H.status, H.none, H.tile) rendered into a neutral stage, summarized by
//                                  summarize() with the extra keys in meta.extra; ctx[ 'extras' ] holds what summarize() does not: the count
//                                  inside a chip, the paints of a status glyph, the wrapper of a missing value's tooltip, the colours of a tile.
//   2. quick[id][width]            the geometry of H.quickFilters in a cell 1117, 707 and 300 px wide.
//   3. roving[scenario]            keyboard traces of the quick strip on the REAL Pods route (the mock applies roving focus in its render
//                                  pipeline: a markup string put into a stage is not roving), 1440 x 900.
//   4. ellipsis[name][width]       Shell.panel.longName in cells of ten widths.
//   5. paints[theme][id][state]    colours of the parts in the nine themes (kit theme ids), 1440 x 900.
//   6. inContext[engine][viewport] rects of the strip, the state cells and the identity cell on the real Pods route.
// The stage is the one of mock-measure.mjs; states rest, hover, active and focus are each checked with matches() (measure() throws when one
// is not really in effect); the font is normalized. Writes mock-atoms-bc.json, the reduced reference: ONE summary per case, context and
// state. Numbers within 0.5 px and strings exactly equal across engines and viewports (the height of a label's text range is the engine's
// measure of a text box, not geometry: it is not compared); where they disagree the run says so and the file keeps both as { webkit, chromium }.
//
// Environment: ENGINE=webkit|chromium (comma list), VIEWPORT=1440x900|1030x720 (comma list), ONLY=<regexp on a case, name, scenario id or
// a section name (cases, quick, roving, ellipsis, paints, inContext)>: a debug run that writes mock-atoms-bc.partial.json into the output
// directory instead of mock-atoms-bc.json. RAW=<dir>: the output directory; also writes the full records (mock-atoms-bc.raw.json) and a
// screenshot grid per engine of every element case (mock-grid-bc-<engine>.png).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, VIEWPORTS, measure, normalizeFont, setContext, settle, sleep, summarize } from './probe-lib.mjs';

const URL = process.env.MOCK_URL ?? 'http://127.0.0.1:49231/';
const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = process.env.RAW;
const OUT = RAW ?? here;
if (RAW) mkdirSync(RAW, { recursive: true });
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const engineFilter = process.env.ENGINE ? process.env.ENGINE.split(',') : Object.keys(ENGINES);
const viewportFilter = process.env.VIEWPORT ? process.env.VIEWPORT.split(',') : Object.keys(VIEWPORTS);
const writeOut = !only && !process.env.ENGINE && !process.env.VIEWPORT;
const wants = (section, id = '') => !only || only.test(section) || (id !== '' && only.test(id));
const pick = (section, id) => wants(section, id);
const MAIN_VP = '1440x900';

const EXTRA = ['backgroundImage', 'overflowX', 'textOverflow', 'maxWidth', 'verticalAlign', 'textDecorationLine'];
const TOL = 0.5;
const CTX = {
  default: { textScale: null, density: null },
  scale125: { textScale: '125', density: null },
  scale80: { textScale: '80', density: null },
};
const ALL = ['rest', 'hover', 'active', 'focus'];
const TONES = ['success', 'warning', 'error', 'info', 'muted'];
const J = JSON.stringify;

// ---- 1. the element cases ----
const chip = (text, count, opts) => `H.chip(${[J(text), ...(count === undefined ? [] : [J(count)]), ...(opts ? [J(opts)] : [])].join(', ')})`;
const CHIP = '#probe-stage > .chip';
const BTN = '#probe-stage > button.chip';
const ELEMENT_CASES = [];
// extra: which extras to read at rest ('count' first <b> of a chip, 'glyph' paints of a status, 'wrapper' the tip-target, 'tile' colours).
const add = (id, expr, target, ctx, states, extra = []) => ELEMENT_CASES.push({ id, expr, target, ctx: ['default', ...ctx], states, extra });
const act = (pressed, tone) => ({ action: 'noop:a', pressed, ...(tone ? { tone } : {}) });

add('chip-static', chip('Running'), CHIP, ['scale125', 'scale80'], ['rest']);
add('chip-static-count', chip('Running', 80), CHIP, ['scale125'], ['rest'], ['count']);
for (const t of TONES) add(`chip-static-${t}`, chip('Running', undefined, { tone: t }), CHIP, [], ['rest']);
for (const t of ['success', 'muted']) add(`chip-static-count-${t}`, chip('Running', 80, { tone: t }), CHIP, [], ['rest'], ['count']);
add('chip-button', chip('Failed', 3, act(false)), BTN, ['scale125'], ALL, ['count']);
add('chip-button-selected', chip('Failed', 3, act(true)), BTN, [], ALL, ['count']);
add('chip-button-nocount', chip('All', undefined, act(false)), BTN, [], ALL);
for (const t of TONES) add(`chip-button-${t}`, chip('Failed', 3, act(false, t)), BTN, [], ALL, ['count']);
for (const t of ['success', 'muted']) add(`chip-button-selected-${t}`, chip('Failed', 3, act(true, t)), BTN, [], ['rest', 'hover', 'focus'], ['count']);
const REMOVABLE = chip('app=cart-api', undefined, { remove: 'noop:r' });
add('chip-removable', REMOVABLE, CHIP, ['scale125'], ['rest']);
add('chip-removable-warning', chip('app=cart-api', undefined, { remove: 'noop:r', tone: 'warning' }), CHIP, [], ['rest']);
add('chip-removable-remove', REMOVABLE, '#probe-stage .chip__remove', [], ALL);

const STATUS = (id, label, role, ctx) => add(`status-${id}`, `H.status(${J(label)}, ${J(label)}, { role: ${J(role)} })`, '#probe-stage > .resource-state', ctx, ['rest'], ['glyph']);
STATUS('healthy', 'Passed', 'healthy', []);
STATUS('running', 'Running', 'running', ['scale125', 'scale80']);
STATUS('progress', 'Shutting down', 'progress', []);
STATUS('attention', 'Attention', 'attention', []);
STATUS('error', 'Failed', 'error', ['scale125']);
STATUS('stopped', 'Stopped', 'stopped', []);
STATUS('info', 'Update available', 'info', []);

add('none-default', 'H.none()', '#probe-stage > .dim', ['scale125'], ['rest']);
add('none-named', `H.none('No restart count')`, '#probe-stage .dim', [], ['rest']);
add('none-reason', `H.none('Not available', 'The value has not been reported')`, '#probe-stage .dim', [], ['rest'], ['wrapper']);

const TILE = (id, args) => add(id, `H.tile(${args})`, '#probe-stage > .tile', [], ['rest'], ['tile']);
TILE('tile-20', `'LuBox', '#3B6FD4', 28`);
TILE('tile-16', `'LuBox', '#3B6FD4', 16`);
TILE('tile-neutral', `'LuBox'`);
for (const [hue, color] of Object.entries({ orange: '#E8761B', green: '#3F9B3A', purple: '#8C4FFF', pink: '#E7157B', red: '#DD344C', teal: '#01A88D' })) TILE(`tile-${hue}`, `'LuBox', '${color}', 28`);

// ---- 2. the quick strip ----
const COUNTS = { all: 89, running: 80, pending: 4, failed: 3, completed: 2 };
const QUICK_WIDTHS = [1117, 707, 300];
const QUICK_CASES = {
  'quick-all': { active: 'all', counts: COUNTS },
  'quick-failed': { active: 'failed', counts: COUNTS },
  'quick-zero': { active: 'all', counts: { ...COUNTS, pending: 0 } },
  'quick-loading': { active: 'all', counts: {} },
};
// The Pods page's rule: a tone only while its count is not zero.
const quickExpr = ({ active, counts }) => {
  const T = (id, tone) => (counts[id] ? tone : 'muted');
  const filters = [
    { id: 'all', label: 'All' },
    { id: 'running', label: 'Running', tone: T('running', 'success') },
    { id: 'pending', label: 'Pending', tone: T('pending', 'warning') },
    { id: 'failed', label: 'Failed', tone: T('failed', 'error') },
    { id: 'completed', label: 'Completed', tone: T('completed', 'muted') },
  ];
  return `H.quickFilters(${J(filters)}, { active: ${J(active)}, counts: ${J(counts)}, label: 'State', action: id => 'noop:' + id })`;
};

// ---- 3. the keyboard traces ----
const SCENARIOS = {
  arrows: ['Tab', 'ArrowRight', 'ArrowRight', 'End', 'ArrowRight', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Tab', 'Shift+Tab', 'Shift+Tab'],
  modifiers: ['Tab', 'Shift+ArrowRight', 'Alt+ArrowRight', 'Meta+ArrowRight', 'Control+ArrowRight', 'Control+End', 'Control+Home'],
  'pressed-stop': ['Tab', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'Enter', 'Tab', 'Shift+Tab'],
};

// ---- 4. the middle ellipsis ----
const NAMES = {
  G: ['report-renderer-7d8c6f49b-7x5nx', 6],
  L: ['payments-reconciliation-worker-6f9d8b7c5d-x7k2m', 6],
  J: ['nightly-backup-28733280', 9],
  S: ['worker-0', null],
  D: ['a-long-name-with-no-tail-rule-at-all-1234567', null],
  T12: ['exactly-12ch', null],
  T13: ['exactly-13chr', null],
};
const ELLIPSIS_WIDTHS = [40, 60, 80, 100, 120, 160, 200, 240, 320, 480];
// [id in the file, name id, context, widths]
const ELLIPSIS_SETS = [
  ...Object.keys(NAMES).map((n) => [n, n, 'default', ELLIPSIS_WIDTHS]),
  ['G-scale125', 'G', 'scale125', [120, 200]],
];

// ---- 5. the paints per theme ----
const THEMES = {
  void: '', dark: 'dark', light: 'light', obsidian: 'obsidian', carbon: 'carbon',
  'solarized-dark': 'solarized-dark', 'solarized-light': 'solarized-light', 'high-contrast-dark': 'hc-dark', 'high-contrast-light': 'hc-light',
};
const PAINT_CASES = [
  ...[...TONES, 'count'].map((t) => [t === 'count' ? 'chip-static-count' : `chip-static-${t}`, ['rest']]),
  ['chip-button', ['rest', 'hover', 'focus']],
  ['chip-button-selected', ['rest']],
  ['chip-button-error', ['rest', 'hover']],
  ['chip-removable-remove', ['rest', 'hover']],
  ...['healthy', 'running', 'progress', 'attention', 'error', 'stopped', 'info'].map((s) => [`status-${s}`, ['rest']]),
  ['none-default', ['rest']],
  ['tile-neutral', ['rest']],
  ['tile-20', ['rest']],
];

const STAGE_CSS = 'position:fixed;inset:0;z-index:99999;padding:40px;background:var(--int-bg-island)';

// ---- in-page readers (self-contained: they run in the page) ----
const readGlyph = (el) => [...new Set([...el.querySelectorAll('svg path, svg circle')].map((n) => { const c = getComputedStyle(n); return `${c.fill}|${c.stroke}`; }))].sort();

function readExtras({ target, kinds }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const el = document.querySelector(target);
  const tb = el.getBoundingClientRect();
  const out = {};
  if (kinds.includes('count')) {
    const b = el.querySelector('b');
    if (!b) throw new Error('no <b> count in the chip');
    const bb = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    out.count = { left: r2(bb.left - tb.left), top: r2(bb.top - tb.top), w: r2(bb.width), h: r2(bb.height), color: cs.color, fontWeight: cs.fontWeight };
  }
  if (kinds.includes('glyph')) {
    const shapes = [...el.querySelectorAll('svg path, svg circle')];
    out.glyph = [...new Set(shapes.map((n) => { const c = getComputedStyle(n); return `${c.fill}|${c.stroke}`; }))].sort();
    out.shapes = shapes.length;
  }
  if (kinds.includes('wrapper')) {
    const w = el.closest('.tip-target');
    if (!w) throw new Error('no .tip-target around the missing value');
    const wb = w.getBoundingClientRect();
    out.wrapper = { left: r2(wb.left - tb.left), top: r2(wb.top - tb.top), w: r2(wb.width), h: r2(wb.height) };
  }
  if (kinds.includes('tile')) {
    const p = el.querySelector('svg path');
    out.color = getComputedStyle(el).color;
    out.stroke = p ? getComputedStyle(p).stroke : null;
  }
  return out;
}

function readQuick() {
  const r2 = (n) => Math.round(n * 100) / 100;
  const strip = document.querySelector('#probe-stage .quick-filters');
  const sb = strip.getBoundingClientRect();
  const cs = getComputedStyle(strip);
  const chips = [...strip.querySelectorAll('button')].map((b) => {
    const bb = b.getBoundingClientRect();
    const tone = [...b.classList].map((c) => /^chip--(success|warning|error|info|muted)$/.exec(c)?.[1]).find(Boolean) ?? null;
    return { text: b.textContent.replace(/\s+/g, ' ').trim(), left: r2(bb.left - sb.left), top: r2(bb.top - sb.top), w: r2(bb.width), h: r2(bb.height), pressed: b.getAttribute('aria-pressed'), tone };
  });
  return {
    strip: { w: r2(sb.width), h: r2(sb.height) },
    chips,
    rows: new Set(chips.map((c) => c.top)).size,
    elements: 1 + strip.querySelectorAll('*').length,
    display: cs.display, flexWrap: cs.flexWrap, columnGap: cs.columnGap, rowGap: cs.rowGap, alignItems: cs.alignItems,
  };
}

function readEllipsis({ jobs, stageCss }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  let stage = document.getElementById('probe-stage');
  if (!stage) {
    stage = document.createElement('div');
    stage.id = 'probe-stage';
    stage.style.cssText = stageCss;
    document.body.appendChild(stage);
  }
  return jobs.map((j) => {
    const markup = j.tail == null ? Shell.panel.longName(j.text) : Shell.panel.longName(j.text, { tail: j.tail });
    stage.innerHTML = `<div style="width:${j.width}px">${markup}</div>`;
    const root = stage.firstElementChild.firstElementChild;
    const rb = root.getBoundingClientRect();
    const head = root.querySelector('.pmid__head');
    const tail = root.querySelector('.pmid__tail');
    const hb = head?.getBoundingClientRect();
    const tb = tail?.getBoundingClientRect();
    return {
      kind: root.classList.contains('pmid') ? 'pmid' : 'pclip',
      root: { w: r2(rb.width), h: r2(rb.height) },
      headW: hb ? r2(hb.width) : null,
      tailW: tb ? r2(tb.width) : null,
      tailLeft: tb ? r2(tb.left - rb.left) : null,
      headScroll: head ? r2(head.scrollWidth) : null,
      headClient: head ? r2(head.clientWidth) : null,
      rootScroll: r2(root.scrollWidth),
      rootClient: r2(root.clientWidth),
      cut: root.scrollWidth > root.clientWidth + 1,
      elements: 1 + root.querySelectorAll('*').length,
      text: root.textContent,
    };
  });
}

function readPods() {
  const r2 = (n) => Math.round(n * 100) / 100;
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: r2(b.x), y: r2(b.y), w: r2(b.width), h: r2(b.height) };
  };
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  const strip = document.querySelector('.quick-filters');
  const rows = [...document.querySelectorAll('tbody tr')].slice(0, 12);
  const first = rows[0];
  const cell = first?.querySelector('.namecell') ?? first;
  const part = (sel) => { const el = cell?.querySelector(sel); return el ? { ...rect(el), text: text(el) } : null; };
  return {
    strip: rect(strip),
    buttons: strip ? [...strip.querySelectorAll('button')].map((b) => ({ ...rect(b), text: text(b) })) : [],
    rows: rows.map((row) => {
      const state = row.querySelector('.resource-state');
      const pmid = row.querySelector('.pmid');
      return {
        state: state ? { ...rect(state), text: text(state) } : null,
        pmid: pmid ? { cut: pmid.scrollWidth > pmid.clientWidth + 1 } : null,
      };
    }),
    identity: { tile: part('.tile'), name: part('.pmid, .pclip'), head: part('.pmid__head'), tail: part('.pmid__tail'), small: part('small') },
    dimCount: rows.reduce((n, row) => n + row.querySelectorAll('.dim[role=img]').length, 0),
  };
}

// ---- pages ----
async function loadMock(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(3000);
  const ok = await page.evaluate(() => typeof window.H === 'object' && typeof window.ICONS === 'object' && typeof window.Shell === 'object');
  if (!ok) throw new Error('mock did not expose H / ICONS / Shell');
  return { page, context, errors };
}

/** The real Pods route, opened as mock-measure.mjs does: 3.5 s, no mouse move. */
async function openPods(browser, viewport) {
  const loaded = await loadMock(browser, viewport);
  await normalizeFont(loaded.page, { rootVar: '--int-font-ui' });
  await loaded.page.evaluate(() => {
    const scope = K8s.connections.defaultScope('prod-eu');
    Shell.tabs.open({ plugin: 'kubernetes', route: K8s.route.make('k8s-resources', { logicalType: 'k8s:/pods' }, scope), scope }, { how: 'here' });
  });
  await sleep(3500);
  return loaded;
}

async function render(page, expr, cellWidth) {
  return page.evaluate(({ expr, cellWidth, stageCss }) => {
    let stage = document.getElementById('probe-stage');
    if (!stage) {
      stage = document.createElement('div');
      stage.id = 'probe-stage';
      stage.style.cssText = stageCss;
      document.body.appendChild(stage);
    }
    const markup = new Function('H', `return ${expr};`)(window.H);
    stage.innerHTML = cellWidth ? `<div style="width:${cellWidth}px">${markup}</div>` : markup;
    return markup;
  }, { expr, cellWidth, stageCss: STAGE_CSS });
}

/** A locator whose measure() records also carry `glyph`, the paints of the svg shapes in the state in effect. */
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
              if (Array.isArray(arg) && r && r.rect) r.glyph = await target.evaluate(readGlyph);
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

const record = { cases: {}, quick: {}, roving: {}, ellipsis: {}, paints: {}, inContext: {} };
const failures = [];
const notes = []; // surprises seen while measuring (navigation, errors in a keyboard trace)
const pageErrors = {};
const attempt = async (label, fn) => {
  try {
    return await fn();
  } catch (e) {
    failures.push(`${label}: ${String(e.message).split('\n')[0].slice(0, 220)}`);
    return undefined;
  }
};
const slot = (obj, ...keys) => keys.reduce((o, k) => (o[k] ??= {}), obj);

// ---- section 1, 2, 4: one page per engine and viewport ----
async function measureFixtures(engineName, browser, vpName, viewport) {
  const { page, context, errors } = await loadMock(browser, viewport);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  {
    for (const c of ELEMENT_CASES) {
      if (!pick('cases', c.id)) continue;
      await attempt(`${engineName}/${vpName} ${c.id}`, async () => {
        for (const ctxName of c.ctx) {
          await setContext(page, { ...CTX[ctxName], flavour: 'mock' });
          const markup = await render(page, c.expr);
          slot(record.cases, c.id).markup ??= markup;
          await sleep(30);
          const states = await measure(page, withGlyph(page.locator(c.target)), { states: c.states });
          // measure() leaves the pointer away and nothing focused: the extras are read at rest.
          if (c.extra.length) states.extras = await page.evaluate(readExtras, { target: c.target, kinds: c.extra });
          slot(record.cases, c.id, engineName, vpName)[ctxName] = states;
        }
      });
      await setContext(page, { ...CTX.default, flavour: 'mock' });
    }
  }
  {
    for (const [id, q] of Object.entries(QUICK_CASES)) {
      if (!pick('quick', id)) continue;
      await attempt(`${engineName}/${vpName} ${id}`, async () => {
        for (const w of QUICK_WIDTHS) {
          await render(page, quickExpr(q), w);
          await sleep(30);
          slot(record.quick, id, engineName, vpName)[w] = await page.evaluate(readQuick);
        }
      });
    }
  }
  {
    for (const [id, nameId, ctxName, widths] of ELLIPSIS_SETS) {
      if (!pick('ellipsis', id)) continue;
      await attempt(`${engineName}/${vpName} ellipsis ${id}`, async () => {
        await setContext(page, { ...CTX[ctxName], flavour: 'mock' });
        const [text, tail] = NAMES[nameId];
        const jobs = widths.map((width) => ({ text, tail, width }));
        const res = await page.evaluate(readEllipsis, { jobs, stageCss: STAGE_CSS });
        res.forEach((r, i) => { slot(record.ellipsis, id, engineName, vpName)[widths[i]] = r; });
        await setContext(page, { ...CTX.default, flavour: 'mock' });
      });
    }
  }
  await context.close();
  return errors;
}

async function measureInContext(engineName, browser, vpName, viewport) {
  const { page, context, errors } = await openPods(browser, viewport);
  const res = await page.evaluate(readPods);
  await context.close();
  slot(record.inContext, engineName)[vpName] = res;
  return errors;
}

// ---- section 5 ----
async function measurePaints(engineName, browser) {
  const { page, context, errors } = await loadMock(browser, VIEWPORTS[MAIN_VP]);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  for (const [themeId, attr] of Object.entries(THEMES)) {
    await page.evaluate((v) => {
      const root = document.documentElement;
      if (v === '') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', v);
    }, attr);
    await settle(page);
    for (const [id, states] of PAINT_CASES) {
      if (!pick('paints', id)) continue;
      const c = ELEMENT_CASES.find((x) => x.id === id);
      await attempt(`${engineName} paints ${themeId} ${id}`, async () => {
        await render(page, c.expr);
        await sleep(30);
        const recs = await measure(page, withGlyph(page.locator(c.target)), { states });
        for (const [state, rec] of Object.entries(recs)) {
          const s = rec.style;
          slot(record.paints, engineName, themeId, id)[state] = {
            color: s.color,
            bg: s.backgroundColor,
            image: s.backgroundImage,
            border: s.borderTopColor,
            outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`,
            icon: rec.parts.icon ? rec.parts.icon.style.color : null,
            glyph: rec.glyph,
          };
        }
      });
    }
  }
  await context.close();
  return errors;
}

// ---- section 3 ----
async function runScenario(engineName, browser, scenario, keys) {
  const { page, context, errors } = await openPods(browser, VIEWPORTS[MAIN_VP]);
  const url0 = page.url();
  // The brief starts at the Refresh Pods button; Tab from it reaches "More actions for Pods", not the strip (two stops before it). The trace
  // starts at the focusable immediately before the strip ('prev') and names the stop before that 'prev-2'.
  const stops = await page.evaluate(() => {
    window.__kd = [];
    window.addEventListener('keydown', (e) => window.__kd.push({ key: e.key, prevented: e.defaultPrevented }));
    const tabbable = [...document.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')].filter((e) => e.tabIndex >= 0 && !e.disabled && e.offsetParent !== null);
    const entry = tabbable.indexOf(document.querySelector('.quick-filters button[tabindex="0"]'));
    const label = (e) => e.getAttribute('aria-label') ?? `${e.tagName.toLowerCase()}:${e.textContent.trim().slice(0, 20)}`;
    tabbable[entry - 1].focus();
    return { prev: label(tabbable[entry - 1]), prev2: label(tabbable[entry - 2]), next: label(tabbable[entry + 1]) };
  });
  const stopNote = `roving stops: prev = ${stops.prev}, prev-2 = ${stops.prev2}, next = ${stops.next} (the brief's 'prev', Refresh Pods, is prev-2)`;
  if (!notes.includes(stopNote)) notes.push(stopNote);
  const steps = [];
  for (const key of keys) {
    // WebKit on macOS does not Tab to buttons: Alt+Tab is its Tab.
    const press = engineName === 'webkit' ? ({ Tab: 'Alt+Tab', 'Shift+Tab': 'Alt+Shift+Tab' })[key] ?? key : key;
    await page.evaluate(() => { window.__kd = []; });
    await page.keyboard.press(press);
    await sleep(key === 'Enter' ? 400 : 80);
    const step = await page.evaluate((stops) => {
      const strip = document.querySelector('.quick-filters');
      const btns = strip ? [...strip.querySelectorAll('button')] : [];
      const a = document.activeElement;
      const label = (e) => e.getAttribute('aria-label') ?? `${e.tagName.toLowerCase()}:${e.textContent.trim().slice(0, 20)}`;
      let at;
      if (btns.includes(a)) at = btns.indexOf(a);
      else if (a && label(a) === stops.prev) at = 'prev';
      else if (a && label(a) === stops.next) at = 'next';
      else if (a && label(a) === stops.prev2) at = 'prev-2';
      else at = `other:${a ? a.tagName.toLowerCase() : 'none'}`;
      const main = window.__kd.filter((k) => !['Shift', 'Alt', 'Control', 'Meta'].includes(k.key)).at(-1);
      return { at, tabindex: btns.map((b) => b.getAttribute('tabindex')), pressed: btns.map((b) => b.getAttribute('aria-pressed')), prevented: main ? main.prevented : null };
    }, stops);
    steps.push({ key, ...step });
  }
  if (page.url() !== url0) notes.push(`${engineName}/${scenario}: the page navigated from ${url0} to ${page.url()}`);
  if (errors.length) notes.push(`${engineName}/${scenario}: page errors ${errors.slice(0, 3).join(' | ')}`);
  await context.close();
  slot(record.roving, scenario)[engineName] = steps;
  return errors;
}

// ---- screenshot grid ----
async function gridShot(engineName, browser) {
  const { page, context } = await loadMock(browser, VIEWPORTS[MAIN_VP]);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  await page.evaluate(async ({ cases, stageCss }) => {
    const stage = document.createElement('div');
    stage.id = 'probe-stage';
    stage.style.cssText = `${stageCss};overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px 20px;align-content:start`;
    for (const c of cases) {
      const markup = new Function('H', `return ${c.expr};`)(window.H);
      const cell = document.createElement('div');
      cell.innerHTML = `<div style="margin-bottom:4px;font:11px Helvetica,Arial,sans-serif;color:var(--int-fg-secondary)">${c.id}</div><div>${markup}</div>`;
      stage.appendChild(cell);
    }
    document.body.appendChild(stage);
  }, { cases: ELEMENT_CASES.map(({ id, expr }) => ({ id, expr })), stageCss: STAGE_CSS });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/mock-grid-bc-${engineName}.png` });
  await context.close();
}

// ---- the run ----
const t0 = Date.now();
for (const engineName of engineFilter) {
  const browser = await ENGINES[engineName].launch();
  for (const vp of viewportFilter) {
    const t = Date.now();
    pageErrors[`${engineName}/${vp}/fixtures`] = (await attempt(`${engineName}/${vp} fixtures`, () => measureFixtures(engineName, browser, vp, VIEWPORTS[vp]))) ?? [];
    if (wants('inContext')) pageErrors[`${engineName}/${vp}/pods`] = (await attempt(`${engineName}/${vp} inContext`, () => measureInContext(engineName, browser, vp, VIEWPORTS[vp]))) ?? [];
    console.log(`${engineName} ${vp} done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  if (viewportFilter.includes(MAIN_VP)) {
    const t = Date.now();
    if (PAINT_CASES.some(([id]) => pick('paints', id))) pageErrors[`${engineName}/paints`] = (await attempt(`${engineName} paints`, () => measurePaints(engineName, browser))) ?? [];
    for (const [scenario, keys] of Object.entries(SCENARIOS)) {
      if (!pick('roving', scenario)) continue;
      pageErrors[`${engineName}/roving/${scenario}`] = (await attempt(`${engineName} roving ${scenario}`, () => runScenario(engineName, browser, scenario, keys))) ?? [];
    }
    console.log(`${engineName} paints and keyboard done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  if (RAW && !only) await attempt(`${engineName} grid`, () => gridShot(engineName, browser));
  await browser.close();
}

if (RAW) writeFileSync(`${RAW}/mock-atoms-bc.raw.json`, JSON.stringify(record, null, 1));

// ---- the reduced reference ----
// A value is one when every engine and viewport agrees (numbers within TOL, strings exactly); otherwise { webkit, chromium }, each the
// value or, when an engine's own viewports disagree, { <viewport>: value }.
const disagreements = [];
function diffPaths(a, b, at, ignore, out = []) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > TOL) out.push(at);
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const next = at ? `${at}.${k}` : k;
      if (!ignore.includes(next)) diffPaths(a[k], b[k], next, ignore, out);
    }
  } else if (a !== b) {
    out.push(at);
  }
  return out;
}
function reduce(label, variants, ignore = []) {
  if (!variants.length) return undefined;
  const base = variants[0].value;
  const bad = [];
  for (const v of variants.slice(1)) {
    const paths = diffPaths(base, v.value, '', ignore);
    if (paths.length) bad.push(`${v.engine}/${v.vp} vs ${variants[0].engine}/${variants[0].vp}: ${[...new Set(paths)].slice(0, 6).join(',')}`);
  }
  if (!bad.length) return base;
  disagreements.push(`${label}: ${bad.join('; ')}`);
  const by = {};
  for (const v of variants) (by[v.engine] ??= []).push(v);
  return Object.fromEntries(Object.entries(by).map(([engine, vs]) => {
    const same = vs.every((v) => diffPaths(vs[0].value, v.value, '', ignore).length === 0);
    return [engine, same ? vs[0].value : Object.fromEntries(vs.map((v) => [v.vp, v.value]))];
  }));
}
const expectedVariants = engineFilter.length * viewportFilter.length;
const missing = [];
const need = (label, variants, expected) => { if (variants.length < expected) missing.push(`${label}: ${variants.length} of ${expected} measurements`); };

const reduced = {
  meta: {
    mockTree: MOCK_TREE,
    specTag: 'spec-baseline-2026-11-16',
    font: 'Helvetica, Arial, sans-serif',
    extra: EXTRA,
    tolerance: 'numbers within 0.5 px, everything else exactly equal, across engines and viewports (label.h, the engine\'s text-box height, is not compared)',
    schema: {
      cases: 'cases[id].markup; cases[id][ctx][state] = summarize(record, { withOutline: state === focus, extra }); cases[id][ctx].extras = { count } | { glyph, shapes } | { wrapper } | { color, stroke }',
      quick: 'quick[id][width] = { strip:{w,h}, chips:[{ text, left, top, w, h, pressed, tone }], rows, elements, display, flexWrap, columnGap, rowGap, alignItems }',
      roving: 'roving[scenario] = [{ key, at, tabindex, pressed, prevented }]',
      ellipsis: 'ellipsis[nameId][width] = { kind, root, headW, tailW, tailLeft, headScroll, headClient, rootScroll, rootClient, cut, elements, text }; G-scale125 = G under data-text-scale 125',
      paints: 'paints[kitThemeId][id][state] = { color, bg, image, border, outline, icon, glyph }',
      inContext: 'inContext[engine][viewport] = { strip, buttons, rows:[{ state, pmid }], identity, dimCount }',
    },
    notes: [
      'Font normalized by setting --int-font-ui on <html> after load, before any fixture or route is opened.',
      'Stage: fixed full-screen div #probe-stage, padding 40px, background var(--int-bg-island). Contexts: default = no data-text-scale attribute.',
      'States: rest (pointer at 1,1, nothing focused), hover (pointer at centre), active (button held down at centre, record, then moved away and released outside), focus (sentinel + Tab, or Alt+Tab in WebKit; matches(:focus-visible) verified).',
      'extras.count: the first <b> of a chip relative to the chip border box. extras.wrapper: .tip-target relative to the .dim border box. extras.glyph: sorted unique fill|stroke of every path, circle inside the svg.',
      'Keyboard traces: real Pods route at 1440x900, 3.5 s, pressed Tab is Alt+Tab (Alt+Shift+Tab) in WebKit; prevented = defaultPrevented seen by a bubble-phase window keydown listener added after load (null: no non-modifier keydown seen).',
      'Themes: <html data-theme> set directly: void = attribute removed, high-contrast-dark = hc-dark, high-contrast-light = hc-light.',
      'inContext: fresh page per viewport and engine, Pods route opened, 3.5 s, no mouse move; rects rounded to 0.01.',
      ...notes,
    ],
    engines: engineFilter,
    viewports: viewportFilter,
    date: new Date().toISOString(),
  },
  cases: {},
  quick: {},
  roving: {},
  ellipsis: {},
  paints: {},
  inContext: record.inContext,
};

for (const [id, entry] of Object.entries(record.cases)) {
  const out = { markup: entry.markup };
  const variants = [];
  for (const engine of engineFilter) for (const vp of viewportFilter) if (entry[engine]?.[vp]) variants.push({ engine, vp, data: entry[engine][vp] });
  const spec = ELEMENT_CASES.find((c) => c.id === id);
  for (const ctxName of spec.ctx) {
    const have = variants.filter((v) => v.data[ctxName]);
    need(`cases/${id}/${ctxName}`, have, expectedVariants);
    if (!have.length) continue;
    out[ctxName] = {};
    for (const state of spec.states) {
      const list = have.filter((v) => v.data[ctxName][state]).map((v) => ({ ...v, value: summarize(v.data[ctxName][state], { withOutline: state === 'focus', extra: EXTRA }) }));
      need(`cases/${id}/${ctxName}/${state}`, list, expectedVariants);
      out[ctxName][state] = reduce(`cases/${id}/${ctxName}/${state}`, list, ['label.h']);
    }
    if (spec.extra.length) {
      const list = have.filter((v) => v.data[ctxName].extras).map((v) => ({ ...v, value: v.data[ctxName].extras }));
      out[ctxName].extras = reduce(`cases/${id}/${ctxName}/extras`, list);
    }
  }
  reduced.cases[id] = out;
}
const byWidth = (section) => {
  for (const [id, entry] of Object.entries(record[section])) {
    const widths = new Set();
    for (const engine of engineFilter) for (const vp of viewportFilter) for (const w of Object.keys(entry[engine]?.[vp] ?? {})) widths.add(w);
    reduced[section][id] = {};
    for (const w of [...widths].sort((a, b) => a - b)) {
      const list = [];
      for (const engine of engineFilter) for (const vp of viewportFilter) if (entry[engine]?.[vp]?.[w]) list.push({ engine, vp, value: entry[engine][vp][w] });
      need(`${section}/${id}/${w}`, list, expectedVariants);
      reduced[section][id][w] = reduce(`${section}/${id}/${w}`, list);
    }
  }
};
byWidth('quick');
byWidth('ellipsis');
for (const [scenario, entry] of Object.entries(record.roving)) {
  const list = engineFilter.filter((e) => entry[e]).map((engine) => ({ engine, vp: MAIN_VP, value: entry[engine] }));
  need(`roving/${scenario}`, list, engineFilter.length);
  reduced.roving[scenario] = reduce(`roving/${scenario}`, list);
}
{
  const engines = engineFilter.filter((e) => record.paints[e]);
  const themes = new Set(engines.flatMap((e) => Object.keys(record.paints[e])));
  for (const theme of themes) {
    reduced.paints[theme] = {};
    const ids = new Set(engines.flatMap((e) => Object.keys(record.paints[e][theme] ?? {})));
    for (const id of ids) {
      reduced.paints[theme][id] = {};
      const states = new Set(engines.flatMap((e) => Object.keys(record.paints[e][theme]?.[id] ?? {})));
      for (const state of states) {
        const list = engines.filter((e) => record.paints[e][theme]?.[id]?.[state]).map((engine) => ({ engine, vp: MAIN_VP, value: record.paints[engine][theme][id][state] }));
        need(`paints/${theme}/${id}/${state}`, list, engines.length);
        reduced.paints[theme][id][state] = reduce(`paints/${theme}/${id}/${state}`, list);
      }
    }
  }
}
reduced.meta.independence = disagreements;

const file = writeOut ? path.join(here, 'mock-atoms-bc.json') : path.join(OUT, 'mock-atoms-bc.partial.json');
const json = JSON.stringify(reduced);
writeFileSync(file, json);

// ---- summary ----
const count = (o, depth) => (depth === 0 ? 1 : Object.values(o ?? {}).reduce((n, v) => n + count(v, depth - 1), 0));
const s = [];
s.push(`file: ${file} (${(json.length / 1024).toFixed(0)} KB)  total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
s.push(`cases: ${Object.keys(reduced.cases).length}/${ELEMENT_CASES.length} ids, ${Object.values(reduced.cases).reduce((n, c) => n + Object.entries(c).filter(([k]) => k !== 'markup').reduce((m, [, ctx]) => m + Object.keys(ctx).filter((k) => k !== 'extras').length, 0), 0)} summaries, ${Object.values(reduced.cases).reduce((n, c) => n + Object.entries(c).filter(([k, ctx]) => k !== 'markup' && ctx.extras).length, 0)} extras`);
s.push(`quick: ${count(reduced.quick, 2)} geometries; roving: ${Object.keys(reduced.roving).length} scenarios, ${Object.values(reduced.roving).reduce((n, r) => n + (Array.isArray(r) ? r.length : 0), 0)} agreed steps; ellipsis: ${count(reduced.ellipsis, 2)} geometries; paints: ${count(reduced.paints, 3)} entries over ${Object.keys(reduced.paints).length} themes; inContext: ${engineFilter.flatMap((e) => Object.keys(record.inContext[e] ?? {})).length} runs`);
s.push(`independence (engines and viewports): ${disagreements.length ? `${disagreements.length} DISAGREEMENTS\n  ${disagreements.join('\n  ')}` : 'all agree'}`);
s.push(`missing measurements: ${missing.length ? `\n  ${missing.join('\n  ')}` : 'none'}`);
s.push(`failures: ${failures.length ? `\n  ${failures.join('\n  ')}` : 'none'}`);
s.push(`notes: ${notes.length ? `\n  ${notes.join('\n  ')}` : 'none'}`);
const errs = Object.entries(pageErrors).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.length} (${v[0]})`);
s.push(`page errors: ${errs.length ? errs.join('; ') : 'none'}`);
if (RAW) s.push(`raw: ${RAW}`);
console.log(s.join('\n'));
if (failures.length || missing.length) process.exitCode = 1;

// Measures the design mock's own buttons and icons: the REFERENCE the kit parts are compared with (kit-probe.mjs).
//
//   1. Serve the mock (a CommonJS copy of its server.js with `root` set to the mock directory; the lab's package.json says
//      "type": "module"): the mock is `app/OmniviewNativeLab/frontend/mock` of the private repository omniviewdev/design-lab at tag
//      spec-baseline-2026-11-16 (mock tree c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0).
//   2. MOCK_URL=http://127.0.0.1:<port>/ node packages/kit/probes/mock-measure.mjs
//
// Every case is rendered by the mock's own helpers (H.btn, H.ibtn, H.icon) into a neutral stage, in WebKit and Chromium at 1440 x 900
// and 1030 x 720, in the states rest, hover, active and focus (each checked with matches()), under the contexts the case lists. The
// fonts are the real ones on both sides (the mock's own Inter and JetBrains Mono; the kit delivers the same advances). Writes
// mock-reference.json, the reduced reference the kit probe reads, and, with RAW=<dir>, the full measurements and a screenshot grid per engine.
// The mock does not depend on the engine or the viewport for these controls: the run fails if its own numbers say otherwise.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, VIEWPORTS, STATES, awaitFonts, launch, measure, setContext, sleep, summarize } from './probe-lib.mjs';

const URL = process.env.MOCK_URL ?? 'http://127.0.0.1:49231/';
const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = process.env.RAW; // a directory for the full measurements and the screenshot grids
const OUT = RAW ?? here;
if (RAW) mkdirSync(RAW, { recursive: true });
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null; // debug filter on case ids
const engineFilter = process.env.ENGINE ? process.env.ENGINE.split(',') : Object.keys(ENGINES);
const viewportFilter = process.env.VIEWPORT ? process.env.VIEWPORT.split(',') : Object.keys(VIEWPORTS);
const writeOut = !only && !process.env.ENGINE && !process.env.VIEWPORT;

const CTX = {
  default: { textScale: null, density: null },
  scale125: { textScale: '125', density: null },
  scale80: { textScale: '80', density: null },
  compact: { textScale: null, density: 'compact' },
};

const DIS = { disabled: 'Refreshing' };
// id -> { make: ()=>markup (runs in page), kind, ctx, states }
const btn = (text, icon, cls, opts) => `H.btn(${JSON.stringify(text)}, '', ${JSON.stringify(icon)}, ${JSON.stringify(cls)}${opts ? ', ' + JSON.stringify(opts) : ''})`;
const ibtn = (icon, label, cls, opts) => `H.ibtn(${JSON.stringify(icon)}, '', ${JSON.stringify(label)}, ${JSON.stringify(cls)}${opts ? ', ' + JSON.stringify(opts) : ''})`;
const R = 'LuRefreshCw';
const CASES = {
  'btn-secondary': { expr: btn('Cancel', '', ''), ctx: ['scale125', 'scale80'] },
  'btn-secondary-small': { expr: btn('Cancel', '', 'small') },
  'btn-primary': { expr: btn('Create', '', 'primary'), ctx: ['scale125'] },
  'btn-primary-small': { expr: btn('Create', '', 'primary small') },
  'btn-ghost': { expr: btn('Cancel', '', 'ghost') },
  'btn-ghost-small': { expr: btn('Cancel', '', 'ghost small'), ctx: ['scale125'] },
  'btn-danger': { expr: btn('Delete', '', 'danger') },
  'btn-danger-small': { expr: btn('Delete', '', 'small danger') },
  'btn-primary-danger': { expr: btn('Delete', '', 'primary danger') },
  'btn-ghost-small-danger': { expr: btn('Delete', '', 'ghost small danger') },
  'btn-icon-ghost-small-columns': { expr: btn('Columns', 'LuColumns3', 'ghost small') },
  'btn-icon-ghost-small-clear': { expr: btn('Clear filters', 'LuX', 'ghost small') },
  'btn-icon-primary-create': { expr: btn('Create Pod', 'LuPlus', 'primary') },
  'btn-icon-secondary-small-more': { expr: btn('Load more', 'LuChevronDown', 'small') },
  'btn-secondary-disabled': { expr: btn('Cancel', '', '', DIS) },
  'btn-primary-disabled': { expr: btn('Create', '', 'primary', DIS) },
  'btn-ghost-small-disabled': { expr: btn('Cancel', '', 'ghost small', DIS) },
  'btn-danger-disabled': { expr: btn('Delete', '', 'danger', DIS) },
  'btn-primary-danger-disabled': { expr: btn('Delete', '', 'primary danger', DIS) },
  'btn-icon-ghost-small-disabled': { expr: btn('Columns', 'LuColumns3', 'ghost small', DIS) },
  'ibtn-secondary': { expr: ibtn(R, 'Refresh', 'small'), ctx: ['scale125'] },
  'ibtn-ghost': { expr: ibtn(R, 'Refresh', 'ghost small') },
  'ibtn-danger': { expr: ibtn(R, 'Refresh', 'small danger') },
  'ibtn-ghost-danger': { expr: ibtn(R, 'Refresh', 'ghost small danger') },
  'ibtn-secondary-disabled': { expr: ibtn(R, 'Refresh', 'small', DIS) },
  'ibtn-ghost-disabled': { expr: ibtn(R, 'Refresh', 'ghost small', DIS) },
  'td-ibtn-ghost': { expr: ibtn('LuPanelRightOpen', 'Inspect', 'ghost small'), td: true, ctx: ['compact'] },
  'td-btn-small': { expr: btn('Retry', '', 'small'), td: true, ctx: ['compact'] },
  'td-btn-ghost-small': { expr: btn('Retry', '', 'ghost small'), td: true, ctx: ['compact'] },
  'icon-12': { expr: `H.icon(${JSON.stringify(R)}, 12)`, icon: true },
  'icon-16': { expr: `H.icon(${JSON.stringify(R)}, 16)`, icon: true },
  'icon-20': { expr: `H.icon(${JSON.stringify(R)}, 20)`, icon: true },
  'icon-24': { expr: `H.icon(${JSON.stringify(R)}, 24)`, icon: true },
  'icon-chevron-down-12': { expr: `H.icon('LuChevronDown', 12)`, icon: true },
  'icon-statusSuccess-16': { expr: `H.icon('IntUiSuccess', 16)`, icon: true },
  'icon-statusWarning-16': { expr: `H.icon('IntUiWarning', 16)`, icon: true },
};

const STAGE_CSS = 'position:fixed;inset:0;z-index:99999;padding:40px;background:var(--int-bg-island)';

async function loadMock(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(3000);
  const ok = await page.evaluate(() => typeof window.H === 'object' && typeof window.ICONS === 'object');
  if (!ok) throw new Error('mock did not expose H / ICONS');
  return { page, context, errors };
}

async function renderCase(page, c) {
  return page.evaluate(({ expr, td, stageCss }) => {
    let stage = document.getElementById('probe-stage');
    if (!stage) {
      stage = document.createElement('div');
      stage.id = 'probe-stage';
      stage.style.cssText = stageCss;
      document.body.appendChild(stage);
    }
     
    const markup = new Function('H', `return ${expr};`)(window.H);
    stage.innerHTML = td ? `<table><tbody><tr><td>${markup}</td></tr></tbody></table>` : markup;
    return markup;
  }, { expr: c.expr, td: !!c.td, stageCss: STAGE_CSS });
}

const cleanCase = (id) => ({ ...CASES[id] });

async function measureFixtures(engineName, browser, viewportName, viewport, record) {
  const { page, context, errors } = await loadMock(browser, viewport);
  await awaitFonts(page);
  for (const id of Object.keys(CASES)) {
    if (only && !only.test(id)) continue;
    const c = cleanCase(id);
    const entry = (record.cases[id] ??= {});
    const target = c.icon ? '#probe-stage > .ic' : c.td ? '#probe-stage td > *' : '#probe-stage > button';
    for (const ctxName of ['default', ...(c.ctx ?? [])]) {
      await setContext(page, { ...CTX[ctxName], flavour: 'mock' });
      const markup = await renderCase(page, c);
      entry.markup ??= markup;
      await sleep(30);
      const states = c.icon ? ['rest', 'hover'] : STATES;
      const rec = await measure(page, page.locator(target), { states });
      ((entry[engineName] ??= {})[viewportName] ??= {})[ctxName] = rec;
    }
    await setContext(page, { ...CTX.default, flavour: 'mock' });
  }
  await context.close();
  return errors;
}

async function measureInContext(browser, viewport) {
  const { page, context } = await loadMock(browser, viewport);
  await awaitFonts(page);
  await page.evaluate(() => {
    const scope = K8s.connections.defaultScope('prod-eu');
    Shell.tabs.open({ plugin: 'kubernetes', route: K8s.route.make('k8s-resources', { logicalType: 'k8s:/pods' }, scope), scope }, { how: 'here' });
  });
  await sleep(3500);
  const sels = {
    'Create Pod': '.page-header__commands button.primary',
    'Refresh Pods': '[aria-label="Refresh Pods"]',
    'More actions for Pods': '[aria-label="More actions for Pods"]',
    Columns: '.column-picker button',
    'Inspect (first row)': 'tbody button[aria-label^="Inspect"]',
  };
  const res = await page.evaluate((sels) => {
    const out = {};
    for (const [k, s] of Object.entries(sels)) {
      const el = document.querySelector(s);
      if (!el) { out[k] = null; continue; }
      const b = el.getBoundingClientRect();
      out[k] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), elements: 1 + el.querySelectorAll('*').length, label: el.getAttribute('aria-label') ?? el.textContent.trim() };
    }
    return out;
  }, sels);
  await context.close();
  return res;
}

async function gridShot(engineName, browser) {
  const { page, context } = await loadMock(browser, VIEWPORTS['1440x900']);
  await awaitFonts(page);
  await page.evaluate(async ({ ids, cases, stageCss }) => {
    const stage = document.createElement('div');
    stage.id = 'probe-stage';
    stage.style.cssText = stageCss + ';overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px 20px;align-content:start';
    for (const id of ids) {
      const c = cases[id];
       
      const markup = new Function('H', `return ${c.expr};`)(window.H);
      const cell = document.createElement('div');
      cell.innerHTML = `<div style="margin-bottom:4px;font:11px Helvetica,Arial,sans-serif;color:var(--int-fg-secondary)">${id}</div>` + (c.td ? `<table><tbody><tr><td>${markup}</td></tr></tbody></table>` : `<div>${markup}</div>`);
      stage.appendChild(cell);
    }
    document.body.appendChild(stage);
  }, { ids: Object.keys(CASES), cases: CASES, stageCss: STAGE_CSS });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/mock-grid-${engineName}.png` });
  await context.close();
}

const t0 = Date.now();
const record = {
  meta: {
    mockTree: MOCK_TREE,
    date: new Date().toISOString(),
    engines: engineFilter,
    viewports: viewportFilter,
    font: 'Helvetica, Arial, sans-serif',
    notes: [
      'Font normalized by setting --int-font-ui on <html> after load, before any fixture or route is opened (inContext too).',
      'Stage: fixed full-screen div #probe-stage, padding 40px, background var(--int-bg-island); td cases sit in table>tbody>tr>td.',
      'States: rest (pointer at 1,1, nothing focused), hover (pointer at centre), active (button held down at centre, record, then moved away and released outside), focus (sentinel + Tab; matches(:focus-visible) verified).',
      'Icon cases measure rest and hover only (non-interactive). Contexts: default = no data-text-scale/data-density attribute.',
      'parts.icon.svg = svg inside the icon span: rect, width/height attributes. parts.label.text = visible text node. left/top are offsets from the target border box.',
      'inContext: fresh page per viewport and engine, Pods route opened, 3.5 s wait, no mouse move; rects rounded to 1 px.',
    ],
  },
  cases: {},
  inContext: {},
};
const pageErrors = {};
const summaryLines = [];

for (const engineName of engineFilter) {
  const browser = await launch(engineName);
  for (const vp of viewportFilter) {
    const t = Date.now();
    pageErrors[`${engineName}/${vp}`] = await measureFixtures(engineName, browser, vp, VIEWPORTS[vp], record);
    if (!only) ((record.inContext[engineName] ??= {})[vp] = await measureInContext(browser, VIEWPORTS[vp]));
    console.log(`${engineName} ${vp} done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  if (!only && RAW) await gridShot(engineName, browser);
  await browser.close();
}

if (RAW) writeFileSync(`${RAW}/mock-atoms.raw.json`, JSON.stringify(record, null, 1));

// ---- the reduced reference ----
// One summary per case, context and state. The mock's numbers must not depend on the engine or the viewport; the run fails if they do.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const independence = [];
const reduced = { meta: { mockTree: MOCK_TREE, font: record.meta.font, tolerance: 'rects within 1 px, everything else exact', notes: record.meta.notes }, cases: {}, inContext: record.inContext };
for (const [id, entry] of Object.entries(record.cases)) {
  const out = { markup: entry.markup };
  const [firstEngine] = engineFilter;
  const [firstViewport] = viewportFilter;
  for (const [ctxName, states] of Object.entries(entry[firstEngine][firstViewport])) {
    out[ctxName] = {};
    for (const [state, rec] of Object.entries(states)) {
      const base = summarize(rec, { withOutline: state === 'focus' });
      out[ctxName][state] = base;
      for (const engine of engineFilter) for (const vp of viewportFilter) {
        const other = summarize(entry[engine][vp][ctxName][state], { withOutline: state === 'focus' });
        const diffs = Object.keys(base).filter((k) => !['w', 'h', 'icon', 'label'].includes(k) && !same(base[k], other[k]));
        if (Math.abs(base.w - other.w) > 0.5 || Math.abs(base.h - other.h) > 0.5) diffs.push('rect');
        if (diffs.length) independence.push(`${id}/${ctxName}/${state} ${engine}/${vp}: ${diffs.join(',')}`);
      }
    }
  }
  reduced.cases[id] = out;
}
const file = writeOut ? path.join(here, 'mock-reference.json') : path.join(OUT, 'mock-reference.partial.json');
writeFileSync(file, JSON.stringify(reduced));
if (independence.length) {
  console.log(`THE MOCK DEPENDS ON THE ENGINE OR THE VIEWPORT:\n  ${independence.join('\n  ')}`);
}

// ---- Summary ----
const get = (id, e, v, ctx, s) => record.cases[id]?.[e]?.[v]?.[ctx]?.[s];
const fmt = (r) => (r ? `${r.rect.w}x${r.rect.h}` : 'n/a');
const e0 = engineFilter[0];
const v0 = viewportFilter[0];
const s = [];
s.push(`file: ${file}  total ${((Date.now() - t0) / 1000).toFixed(0)}s  cases ${Object.keys(record.cases).length}`);
for (const [id, ctx] of [['btn-secondary', 'default'], ['ibtn-secondary', 'default'], ['td-ibtn-ghost', 'default'], ['td-ibtn-ghost', 'compact']]) {
  const r = get(id, e0, v0, ctx, 'rest');
  if (r) s.push(`${e0} ${v0} ${id}/${ctx}: ${fmt(r)} pad ${r.style.paddingTop} ${r.style.paddingRight} ${r.style.paddingBottom} ${r.style.paddingLeft}`);
}
const paintKeys = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'opacity', 'cursor', 'outlineColor', 'outlineWidth', 'outlineStyle', 'outlineOffset'];
const diff = (a, b) => paintKeys.filter((k) => a.style[k] !== b.style[k]);
const sizeDiffs = [];
const disabledChanges = [];
const missing = [];
const noPaintChange = [];
for (const [id, c] of Object.entries(record.cases)) {
  for (const e of engineFilter) for (const v of viewportFilter) {
    const rest = get(id, e, v, 'default', 'rest');
    if (!rest) { missing.push(`${id} ${e} ${v}`); continue; }
    if (/disabled/.test(id)) {
      for (const st of ['hover', 'active', 'focus']) {
        const d = diff(rest, get(id, e, v, 'default', st)).filter((k) => !(st === 'focus' && k.startsWith('outline')));
        if (d.length) disabledChanges.push(`${e}/${v} ${id} ${st}: ${d.join(',')}`);
      }
    } else if (!id.startsWith('icon')) {
      for (const st of ['hover', 'active']) if (!diff(rest, get(id, e, v, 'default', st)).length) noPaintChange.push(`${e}/${v} ${id} ${st}`);
    }
  }
  if (engineFilter.length > 1) {
    for (const v of viewportFilter) {
      const a = get(id, 'webkit', v, 'default', 'rest');
      const b = get(id, 'chromium', v, 'default', 'rest');
      if (a && b && (a.rect.w !== b.rect.w || a.rect.h !== b.rect.h)) sizeDiffs.push(`${id}@${v}: webkit ${fmt(a)} chromium ${fmt(b)}`);
    }
  }
}
s.push(`missing: ${missing.length ? missing.join('; ') : 'none'}`);
s.push(`disabled paint changes (hover/active/focus vs rest): ${disabledChanges.length ? '\n  ' + disabledChanges.join('\n  ') : 'none'}`);
s.push(`enabled cases with NO paint change on hover/active: ${noPaintChange.length ? '\n  ' + noPaintChange.join('\n  ') : 'none'}`);
s.push(`engine size diffs (default/rest): ${sizeDiffs.length ? '\n  ' + sizeDiffs.join('\n  ') : 'none'}`);
const focusVia = new Set();
for (const c of Object.values(record.cases)) for (const e of engineFilter) for (const v of viewportFilter) { const f = c[e]?.[v]?.default?.focus; if (f) focusVia.add(`${e}:${f.via}`); }
s.push(`focus reached via: ${[...focusVia].join(', ')}`);
const ic = record.inContext;
for (const e of engineFilter) for (const v of viewportFilter) s.push(`inContext ${e} ${v}: ${Object.entries(ic[e]?.[v] ?? {}).map(([k, r]) => (r ? `${k} ${r.x},${r.y} ${r.w}x${r.h} el${r.elements}` : `${k} MISSING`)).join(' | ')}`);
const errs = Object.entries(pageErrors).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.length} (${v[0]})`);
s.push(`page errors: ${errs.length ? errs.join('; ') : 'none'}`);
console.log(s.join('\n'));
if (independence.length || missing.length) process.exitCode = 1;

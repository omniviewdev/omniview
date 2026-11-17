// Measures the design mock's table: the REFERENCE the kit DataTable is compared with (the table probe reads mock-table.json).
//
//   1. Serve the mock as mock-measure.mjs says (a CommonJS copy of its server.js with `root` set to the mock directory, run from /tmp).
//   2. MOCK_URL=http://127.0.0.1:<port>/ node packages/kit/probes/mock-table-measure.mjs      (about 4 minutes)
//      or, for the pinned reference of CI, node packages/kit/probes/generate-reference.mjs --lab <design-lab checkout>, which serves the
//      mock from `git archive` of the tag, runs this and mock-measure.mjs, and writes the provenance into both files.
//
// A. The Pods list of connection prod-eu (89 Pods), opened as appendix B of docs/ui-next/slices/1a-pods-list.md says, on a freshly loaded
//    page for every rendering: wide column set and narrow set (the Columns picker reaches the set the viewport does not show by
//    default), comfortable and data-density="compact". Case ids pods-<wide|narrow>-<comfortable|compact>.
// B. A one-line table built with the mock's own H.table in the neutral stage of mock-measure.mjs: line-plain, line-selection, line-inspect
//    and line-bounded (a bounded scroll region, for the sticky header), each comfortable and compact.
// C. Cell kinds: number and mono cells and clipped text with its tooltip attribute (cell-text), the middle-ellipsis name of a Pod
//    (cell-identity: .pmid, Shell.panel.longName) and the middle-ellipsis identifier (cell-identifier: .resource-identifier-text,
//    prepareIdentifiers), the identity column held at 268 px.
// Engines WebKit and Chromium, viewports 1440 x 900 and 1030 x 720, the default theme. The fonts are the real ones on both sides, as in
// mock-measure.mjs (the mock's own Inter and JetBrains Mono; the kit delivers the same advances); Chromium runs with --font-render-hinting=none
// (probe-lib.mjs `launch`), so a reference made on macOS holds on the Linux runner.
//
// Output mock-table.json, at most 150 KB: { meta, styles, colorTokens, checks, cases: { <id>: { <viewport>: <entry> } } }.
//   styles        every computed-style summary once, by id (a content hash); a node's `s` is such an id
//   colorTokens   computed colour -> the --int-* tokens that resolve to it
//   checks        the facts the table CSS must reproduce, each checked against the measurement
//   entry         { record } (anchor: WebKit, first viewport) or { from: '<case>/<viewport>', diff } (the paths that differ from that
//                 entry), plus engineDiff.chromium (the paths whose Chromium value differs by more than 0.5 px, from the WebKit record).
//                 expandCase(data, id, viewport, engine) rebuilds a full record; import it, the run starts only when this file is the entry.
//   record        short keys: t tag, c classes, r rect [x, y, w, h], s style id, a attributes, x own text, xr [text x, text width],
//                 v inline custom properties, cut 1 when the box clips its content, k descendants (d = depth, inner = svg elements),
//                 n element count (the element and everything below it), col header name of the column, td cells of a row, th headers.
//                 Rects are CSS px rounded to 0.01: relative to the table for table parts, to the cell for what a cell holds, absolute for
//                 `wrap` and `scroll`.
//
// Independence: styles, structure and every height and y offset must be the same in both engines and at both viewports; the run fails
// otherwise, as mock-measure.mjs does for the atoms. Widths and x offsets follow the text measure of the engine and the viewport, so
// they may differ: meta.engineDifferences lists them. Differences of 0.5 px or less are not recorded.
// Debug: ONLY=<regex on case ids>, ENGINE=, VIEWPORT=, RAW=<dir> writes the unreduced measurement, FROM_RAW=<dir> reduces a RAW run again.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, VIEWPORTS, awaitFonts, launch, setContext, sleep, settle, measure, buttonStates, installRecordLib } from './probe-lib.mjs';

const URL = process.env.MOCK_URL ?? 'http://127.0.0.1:49231/';
const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = process.env.RAW;
const FROM_RAW = process.env.FROM_RAW;
if (RAW) mkdirSync(RAW, { recursive: true });
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const MOCK_TAG = 'spec-baseline-2026-11-16';
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const engineFilter = process.env.ENGINE ? process.env.ENGINE.split(',') : Object.keys(ENGINES);
const viewportFilter = process.env.VIEWPORT ? process.env.VIEWPORT.split(',') : Object.keys(VIEWPORTS);
const writeOut = !only && !process.env.ENGINE && !process.env.VIEWPORT && !FROM_RAW;
const DENSITIES = ['comfortable', 'compact'];
const STAGE_CSS = 'position:fixed;inset:0;z-index:99999;padding:40px;background:var(--int-bg-island)';
const TOL = 0.5; // px: a difference of this or less is not a difference
const MAX_BYTES = 150 * 1024;

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The page side: installLib and the two fixtures run in the browser and must not close over anything.                               */
/* ------------------------------------------------------------------------------------------------------------------------------ */

function installLib() {
  // The node record (styleOf, nodeOf, walk, elements, scrollerOf) is probe-lib's installRecordLib, installed first: the kit's table probe
  // (table-probe.mjs) records the kit's table with the same functions.
  const { r2, styleOf, nodeOf, walk, elements, scrollerOf } = window.__rec;

  const isMetric = (td) => !!td.querySelector('.metric-cell');
  const headLabel = (th) => th.textContent.trim().replace(/\s+/g, ' ') || th.getAttribute('aria-label') || '';

  const ABS = { left: 0, top: 0 };

  const tdRecord = (td, origin, th, walkIt) => {
    const metric = isMetric(td);
    const n = nodeOf(td, origin, { text: !metric });
    n.col = headLabel(th);
    n.n = elements(td);
    if (metric) n.metric = 1;
    else if (walkIt) { const k = walk(td, td.getBoundingClientRect()); if (k.length) n.k = k; }
    return n;
  };

  const thRecord = (th, origin, withKids = true) => {
    const n = nodeOf(th, origin);
    n.col = headLabel(th);
    n.n = elements(th);
    if (withKids) { const k = walk(th, th.getBoundingClientRect()); if (k.length) n.k = k; }
    return n;
  };

  const rowRecord = (table, i, origin, walkIt) => {
    const tr = table.tBodies[0].rows[i];
    const heads = [...table.tHead.rows[0].cells];
    const n = nodeOf(tr, origin, { text: false });
    n.n = elements(tr);
    n.td = [...tr.cells].map((td, j) => tdRecord(td, origin, heads[j], walkIt));
    return n;
  };

  /** One row's paint: the computed style of the row, each cell and the control marks, with the pseudo-classes in effect. */
  const paint = (tr) => {
    const wrap = tr.closest('.tablewrap');
    const cb = tr.querySelector('.cb');
    const cmd = tr.querySelector('.selection-command');
    return {
      st: { row: styleOf(tr), td: [...tr.cells].map(styleOf), ...(cmd ? { command: styleOf(cmd) } : {}), ...(cb ? { mark: styleOf(cb) } : {}) },
      m: { hover: tr.matches(':hover'), focus: tr.matches(':focus'), focusVisible: tr.matches(':focus-visible'), wrapFocusWithin: !!wrap?.matches(':focus-within'), sel: tr.classList.contains('sel') },
    };
  };

  const captureTable = (table, { rows, walkRows }) => {
    const origin = table.getBoundingClientRect();
    const wrap = table.closest('.tablewrap');
    const scroller = scrollerOf(table);
    const heads = [...table.tHead.rows[0].cells];
    const body = table.tBodies[0];
    const rec = {};
    if (wrap) rec.wrap = nodeOf(wrap, ABS, { text: false });
    if (scroller) rec.scroll = { ...nodeOf(scroller, ABS, { text: false }), scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
    rec.table = nodeOf(table, origin, { text: false });
    rec.thead = nodeOf(table.tHead, origin, { text: false });
    rec.headRow = nodeOf(table.tHead.rows[0], origin, { text: false });
    rec.th = heads.map((th) => thRecord(th, origin));
    rec.colWidths = heads.map((th) => r2(th.getBoundingClientRect().width));
    rec.tbody = nodeOf(body, origin, { text: false });
    const per = {};
    for (const tr of body.rows) { const k = String(elements(tr)); per[k] = (per[k] ?? 0) + 1; }
    rec.counts = { rows: body.rows.length, tbodyElements: elements(body), tableElements: elements(table), elementsPerRow: per };
    const first = [...body.rows].slice(0, 12);
    const distinct = (f) => new Set(first.map(f)).size;
    rec.zebra = { rowBackgrounds: distinct((tr) => getComputedStyle(tr).backgroundColor), cellBackgrounds: [...first[0].cells].map((_, j) => distinct((tr) => getComputedStyle(tr.cells[j]).backgroundColor)) };
    rec.rows = {};
    for (const i of rows) rec.rows[i] = rowRecord(table, i, origin, walkRows === 'all' || walkRows.includes(i));
    return rec;
  };

  /** One header cell for the sort states: its box, style, attributes and the aria the mock writes on th and button. */
  const sortInfo = (th) => {
    const table = th.closest('table');
    const scroller = scrollerOf(table);
    const tb = table.getBoundingClientRect();
    const origin = { left: tb.left, top: scroller ? scroller.getBoundingClientRect().top : tb.top };
    const n = thRecord(th, origin, false);
    const b = th.querySelector('button.table-sort');
    return { th: { r: n.r, s: n.s, c: n.c }, aria: { thSort: th.getAttribute('aria-sort'), thLabel: th.getAttribute('aria-label'), buttonLabel: b?.getAttribute('aria-label') ?? null, buttonHasAction: b?.hasAttribute('data-action') ?? false, buttonIcon: !!b?.querySelector('.ic') } };
  };

  /** Scroll the region, read the header, put the scroll back. */
  const sticky = (table, by) => {
    const scroller = scrollerOf(table);
    if (!scroller) return null;
    const before = scroller.scrollTop;
    scroller.scrollTop = by;
    const sb = scroller.getBoundingClientRect();
    const rel = { left: sb.left, top: sb.top };
    const heads = [...table.tHead.rows[0].cells];
    const th = heads[Math.min(1, heads.length - 1)];
    const tb = th.getBoundingClientRect();
    const hit = document.elementFromPoint(tb.left + tb.width / 2, tb.top + tb.height / 2);
    const below = document.elementFromPoint(tb.left + tb.width / 2, tb.bottom + 2);
    const out = {
      asked: by, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
      thead: { r: nodeOf(table.tHead, rel, { text: false }).r, s: styleOf(table.tHead) }, th: { r: nodeOf(th, rel, { text: false }).r, s: styleOf(th) },
      headerTop: r2(tb.top - sb.top),
      hit: hit ? `${hit.tagName.toLowerCase()}${hit.className && typeof hit.className === 'string' ? '.' + hit.className.trim().replace(/\s+/g, '.') : ''}` : null,
      rowBelowHeader: below?.closest('tr') ? [...below.closest('tbody').rows].indexOf(below.closest('tr')) : null,
    };
    scroller.scrollTop = before;
    return out;
  };

  const tokens = async () => {
    const text = await (await fetch('/base.css')).text();
    const names = [...new Set([...text.matchAll(/--(int-[a-z0-9-]+)/g)].map((m) => `--${m[1]}`))];
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;background:rgb(1,2,3)';
    document.body.appendChild(probe);
    const out = {};
    for (const name of names) {
      probe.style.background = `var(${name}, rgb(1, 2, 3))`;
      const v = getComputedStyle(probe).backgroundColor;
      const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (raw && v !== 'rgb(1, 2, 3)' && v !== 'rgba(0, 0, 0, 0)') out[name] = v;
    }
    probe.remove();
    return out;
  };

  /** Render markup into the neutral stage and run the mock's own table fit and identifier measure on it. */
  const renderStage = (markup, css) => {
    let stage = document.getElementById('probe-stage');
    if (!stage) {
      stage = document.createElement('div');
      stage.id = 'probe-stage';
      document.body.appendChild(stage);
    }
    stage.style.cssText = css;
    stage.innerHTML = markup;
    fitTables(stage, true);
    prepareIdentifiers(stage);
    return stage.querySelectorAll('tbody tr').length;
  };

  /** Hold the flexible column of the (only) table in the stage at `target` px by giving the table wrapper a width. */
  const holdIdentity = (target) => {
    const stage = document.getElementById('probe-stage');
    const wrap = stage.querySelector('.tablewrap');
    const th = () => stage.querySelector('thead th.fit-h');
    let w = th().getBoundingClientRect().width;
    for (let i = 0; i < 8 && Math.abs(w - target) > 0.01; i += 1) {
      wrap.style.width = `${wrap.getBoundingClientRect().width + target - w}px`;
      fitTables(stage, true);
      prepareIdentifiers(stage);
      w = th().getBoundingClientRect().width;
    }
    return { wrapWidth: r2(wrap.getBoundingClientRect().width), identityWidth: r2(w) };
  };

  window.__p = { captureTable, sticky, paint, tokens, sortInfo, renderStage, holdIdentity };
}

function fixtureLine(variant) {
  const names = ['api-gateway', 'auth-service', 'billing-worker', 'cache-primary', 'cart-api', 'checkout-web', 'edge-proxy', 'ingest-queue', 'mailer', 'search-index', 'session-store', 'web-frontend'];
  const status = [['Running', 'healthy'], ['Running', 'healthy'], ['Pending', 'progress'], ['Running', 'healthy'], ['Failed', 'error'], ['Running', 'healthy'], ['Degraded', 'attention'], ['Running', 'healthy'], ['Stopped', 'stopped'], ['Running', 'healthy'], ['Running', 'healthy'], ['Unknown', 'info']];
  const req = ['12', '1,204', '87', '309', '5', '48,112', '730', '2,016', '64', '9', '418', '1,000'];
  const age = ['3d', '17h', '5m', '12d', '2h', '45s', '9d', '1d', '6d', '21h', '33m', '8d'];
  const rows = names.map((name, i) => ({ name, status: status[i], req: req[i], age: age[i] }));
  const cols = [
    { label: 'Name', k: 'name', fit: 'id', sort: { action: 'probe:sort:name', active: true, dir: 'asc' } },
    { label: 'Status', fn: (r) => H.status(r.status[0], r.status[0], { role: r.status[1] }), sort: { action: 'probe:sort:status', active: true, dir: 'desc' } },
    { label: 'Requests', num: true, k: 'req', sort: { action: 'probe:sort:req', active: false } },
    { label: 'Age', k: 'age' },
  ];
  const picked = (r, i) => i === 1 || i === 2;
  const base = { row: () => 'probe:open', sel: picked, label: 'Services' };
  if (variant === 'selection') {
    return H.table(cols, rows, { ...base, selection: { action: (r, i) => `probe:select:${i}`, checked: picked, label: (r) => `Select ${r.name}`, all: { action: 'probe:select-all', checked: 'mixed', label: 'Select all 12 rows' } } });
  }
  if (variant === 'inspect') {
    return H.table(cols, rows, { ...base, inspect: (r) => ({ title: r.name, rows: [] }), inspectKey: (r, i) => String(i), inspectId: 'probe-line', inspectLabel: (r) => r.name });
  }
  if (variant === 'bounded') return H.table(cols, rows, { ...base, maxHeight: 160 });
  return H.table(cols, rows, base);
}

function fixtureCells(kind) {
  const tile = H.tile('LuPackage', 'var(--int-brand-blue, #3B6FD4)');
  const ready = { label: 'Ready', num: true, fn: () => '<span class="mono">2/2</span>' };
  const age = { label: 'Age', fn: () => '<time datetime="2026-10-27T12:00:00Z">17d</time>' };
  if (kind === 'identity') {
    const pods = [['cart-api-7d8c6f49b-f8q4m', 'checkout'], ['alertmanager-prom-alertmanager-0', 'monitoring'], ['kube-prometheus-stack-operator-5c9d7b8f6d-x7k2p', 'monitoring'], ['etcd-0', 'kube-system']];
    const cols = [{ label: 'Name', fit: 'id', fn: (r) => H.nameCell(tile, `<a class="link" href="#probe">${Shell.panel.longName(r[0])}</a>`, r[1]) }, ready, age];
    return H.table(cols, pods, { row: () => 'probe:open', label: 'Pods' });
  }
  if (kind === 'identifier') {
    const ids = ['cart-api-7d8c6f49b-f8q4m', 'arn:aws:eks:eu-west-1:123456789012:cluster/prod-eu', 'arn:aws:iam::123456789012:role/service-role/AmazonEKSClusterRole-prod-eu-eu-west-1', 'i-0abc123'];
    const cols = [{ label: 'Identifier', fit: 'id', fn: (r) => H.identifier(r, { label: 'identifier' }) }, ready, age];
    return H.table(cols, ids, { row: () => 'probe:open', label: 'Identifiers' });
  }
  const rows = [
    { name: 'payments-api', image: 'registry.example.com/payments/payments-api:2026.11.3-build.8841-linux-arm64', note: 'ok', ready: '2/2', n: '0', big: '1,204,331' },
    { name: 'a-deployment-with-a-rather-long-name-that-has-to-be-cut', image: 'busybox:1.36', note: 'a text that is longer than its column and is cut at the cell edge with an ellipsis', ready: '10/10', n: '12', big: '7' },
    { name: 'mailer', image: 'ghcr.io/example/mailer@sha256:6f4a2d9c0b7e1a3f5d8c2e4b6a9d1f3c5e7a9b1d3f5a7c9e1b3d5f7a9c1e3b5d', note: 'ok', ready: '1/1', n: '3', big: '42' },
  ];
  const cols = [
    { label: 'Name', fit: 'id', k: 'name' },
    { label: 'Ready', num: true, fn: (r) => `<span class="mono">${r.ready}</span>` },
    { label: 'Restarts', num: true, k: 'n' },
    { label: 'Total', num: true, k: 'big' },
    // `text`: the image is a clip slot (`.cell-clip`), which caps what its column asks for at 240 px in the mock's measure (`--cell-max`, base.css
    // 1271). `text-plain`: the same cells as plain text, which is what the kit's table is given (it has no clip slot): the column asks for its text.
    { label: 'Image', fit: 'flex', fn: (r) => (kind === 'text-plain' ? r.image : `<span class="cell-clip"${H.tip(r.image)}>${r.image}</span>`) },
    { label: 'Note', fit: 'flex', fn: (r) => (kind === 'text-plain' ? r.note : `<span${H.tip(r.note)}>${r.note}</span>`) },
  ];
  return H.table(cols, rows, { row: () => 'probe:open', label: 'Cells' });
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Comparing and reducing records (Node).                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const isLeafArray = (v) => Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object');
const flatten = (v, p, out = {}) => {
  if (isLeafArray(v)) out[p] = v;
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) flatten(x, p ? `${p}.${k}` : k, out);
  else out[p] = v;
  return out;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** path -> [a, b] for every leaf that differs; `undefined` where a side lacks the path. */
const diffRecords = (a, b) => {
  const fa = flatten(a, '');
  const fb = flatten(b, '');
  const out = {};
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) if (!same(fa[k], fb[k])) out[k] = [fa[k], fb[k]];
  return out;
};

const NUM = /-?\d+(?:\.\d+)?/g;
/** Equal, except that numbers (alone or inside a string) may differ by TOL. */
const near = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= TOL;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => near(x, b[i]));
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) return true;
    const na = a.match(NUM);
    const nb = b.match(NUM);
    return !!na && !!nb && a.replace(NUM, '#') === b.replace(NUM, '#') && na.every((x, i) => Math.abs(Number(x) - Number(nb[i])) <= TOL);
  }
  return same(a, b);
};
const WRAP_PATHS = /^(wrap|scroll)\.|^sticky\.(scrollHeight|clientHeight|thead\.r|th\.r)$/;
/**
 * noise: within TOL. layout: the page or the viewport sets it. width: a width or an x offset that follows the text measure.
 * structure: a path one side lacks. height: a y offset or a height. value: anything else (a style, a name, a count).
 */
const classify = (p, [a, b]) => {
  if (p.split('.').pop() === 'cut') return 'width';
  if (a === undefined || b === undefined) return 'structure';
  if (near(a, b)) return 'noise';
  if (WRAP_PATHS.test(p)) return 'layout';
  const leaf = p.split('.').pop();
  const idx = Array.isArray(a) && Array.isArray(b) ? a.findIndex((x, i) => !near(x, b[i])) : -1;
  if (leaf === 'r' || leaf === 'icon') return idx === 1 || idx === 3 ? 'height' : 'width';
  if (leaf === 'size') return idx === 1 ? 'height' : 'width';
  if (['xr', 'label', 'colWidths', 'held'].includes(leaf) || /(^|\.)held\./.test(p)) return 'width';
  if (/(^|\.)v\./.test(p) || /(^|\.)s\.(maxW|minW)$/.test(p)) return 'width';
  return 'value';
};

const patternOf = (p) => p.replace(/\d+/g, '#');

/** Set a flattened path inside a record; a value of { $: 'removed' } deletes the leaf. */
function setPath(root, p, value) {
  const parts = p.split('.');
  let node = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (node[key] === undefined || node[key] === null) node[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    node = node[key];
  }
  const last = parts[parts.length - 1];
  if (value && typeof value === 'object' && !Array.isArray(value) && value.$ === 'removed') { if (Array.isArray(node)) node.splice(Number(last), 1); else delete node[last]; }
  else node[last] = value;
}
const applyDiff = (base, diff) => {
  const out = structuredClone(base);
  for (const [p, v] of Object.entries(diff)) setPath(out, p, v);
  return out;
};

/** Rebuild the full record of a case at a viewport for an engine from mock-table.json. Style ids resolve through data.styles. */
export function expandCase(data, id, viewport, engine = data.meta.engines[0]) {
  const entry = data.cases[id]?.[viewport];
  if (!entry) throw new Error(`no case ${id} at ${viewport}`);
  let rec;
  if (entry.record) rec = entry.record;
  else {
    const [fromId, fromViewport] = entry.from.split('/');
    rec = applyDiff(expandCase(data, fromId, fromViewport, data.meta.engines[0]), entry.diff);
  }
  if (engine !== data.meta.engines[0]) rec = applyDiff(rec, entry.engineDiff?.[engine] ?? {});
  return rec;
}

const hash6 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 6);

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Measuring (Node).                                                                                                                */
/* ------------------------------------------------------------------------------------------------------------------------------ */

async function loadMock(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(3000);
  const ok = await page.evaluate(() => typeof window.H === 'object' && typeof fitTables === 'function' && typeof prepareIdentifiers === 'function');
  if (!ok) throw new Error('mock did not expose H, fitTables and prepareIdentifiers');
  await awaitFonts(page);
  await page.evaluate(installRecordLib);
  await page.evaluate(installLib);
  return { page, context, errors };
}

const AWAY = { x: 1, y: 1 };
const paintOf = (handle) => handle.evaluate((tr) => window.__p.paint(tr));

async function pointerAway(page) {
  await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
  await page.mouse.move(AWAY.x, AWAY.y);
  await settle(page);
}

/** The states of the rows: rest, hover, keyboard focus on a row, and selected with the table focused, not focused and hovered. */
async function rowStates(page, { scope, hoverRow, focusRow, selectedRows, tick, plainRow, checkRow }) {
  const rows = () => page.locator(`${scope} tbody tr`);
  const out = {};
  await pointerAway(page);
  out.rest = await paintOf(await rows().nth(plainRow).elementHandle());
  const hv = await rows().nth(hoverRow).elementHandle();
  await hv.scrollIntoViewIfNeeded();
  const box = await hv.boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 2 });
  await settle(page);
  out.hover = await paintOf(hv);
  if (!out.hover.m.hover) throw new Error('row hover state not in effect');
  await pointerAway(page);
  // keyboard focus on a row: a key first, so the engine treats the focus as keyboard-initiated
  const fr = await rows().nth(focusRow).elementHandle();
  await page.keyboard.press('Shift');
  await fr.evaluate((el) => el.focus());
  await settle(page);
  out.focus = await paintOf(fr);
  if (!out.focus.m.focusVisible) throw new Error('row :focus-visible not in effect');
  await pointerAway(page);
  if (tick) {
    for (const i of selectedRows) {
      const cmd = rows().nth(i).locator('.selection-command');
      await cmd.scrollIntoViewIfNeeded();
      await cmd.click();
      await sleep(250);
    }
    await pointerAway(page);
  }
  const sel0 = await rows().nth(selectedRows[0]).elementHandle();
  if (!(await sel0.evaluate((el) => el.classList.contains('sel')))) throw new Error('selected row is not .sel');
  // the table focused: keyboard focus on the checkbox (or the row) of an unselected row
  await page.keyboard.press('Shift');
  const check = rows().nth(checkRow).locator('.selection-command');
  if (await check.count()) await check.evaluate((el) => el.focus());
  else await rows().nth(checkRow).evaluate((el) => el.focus());
  await settle(page);
  out.selectedFocused = await paintOf(sel0);
  if (!out.selectedFocused.m.wrapFocusWithin) throw new Error('table focus-within not in effect');
  await pointerAway(page);
  out.selectedBlurred = await paintOf(sel0);
  if (out.selectedBlurred.m.wrapFocusWithin) throw new Error('table still has focus-within');
  const sel1 = await rows().nth(selectedRows[1]).elementHandle();
  const sbox = await sel1.boundingBox();
  await page.mouse.move(sbox.x + sbox.width * 0.6, sbox.y + sbox.height / 2, { steps: 2 });
  await settle(page);
  out.selectedHover = await paintOf(sel1);
  if (!out.selectedHover.m.hover) throw new Error('selected-row hover not in effect');
  await pointerAway(page);
  return out;
}

/** Sort header: the th, its button and icon in the three states, with hover and focus-visible paint of the button. */
async function sortStates(page, scope, clickToDescend) {
  const out = {};
  const th = (sel) => page.locator(`${scope} thead th${sel}`).first();
  const info = async (sel) => {
    const rec = await (await th(sel).elementHandle()).evaluate((el) => window.__p.sortInfo(el));
    return { ...rec, button: buttonStates(await measure(page, th(`${sel} .table-sort`), { states: ['rest', 'hover', 'focus'] })) };
  };
  out.inactive = await info('[aria-sort="none"]');
  out.ascending = await info('[aria-sort="ascending"]');
  if (clickToDescend) {
    await th('[aria-sort="ascending"] .table-sort').click();
    await sleep(600);
    await pointerAway(page);
    out.descending = await info('[aria-sort="descending"]');
  }
  return out;
}

async function selectionCommand(page, scope, row) {
  const cmd = page.locator(`${scope} tbody tr`).nth(row).locator('.selection-command');
  return buttonStates(await measure(page, cmd, { states: ['rest', 'hover', 'focus'] }));
}

async function openPods(page, density, wantWide) {
  await setContext(page, { density: density === 'compact' ? 'compact' : null, flavour: 'mock' });
  await page.evaluate(() => {
    const scope = K8s.connections.defaultScope('prod-eu');
    Shell.tabs.open({ plugin: 'kubernetes', route: K8s.route.make('k8s-resources', { logicalType: 'k8s:/pods' }, scope), scope }, { how: 'here' });
  });
  await sleep(3500);
  const wide = async () => (await page.locator('.data-view thead th', { hasText: 'CPU' }).count()) > 0;
  if ((await wide()) !== wantWide) {
    await page.locator('.column-picker button[data-column-trigger]').click();
    await sleep(500);
    for (const name of ['CPU', 'Memory']) {
      await page.locator(`.column-picker__choice[aria-label^="${name}"]`).first().click({ force: true });
      await sleep(400);
    }
    await page.keyboard.press('Escape');
    await sleep(1000);
    if ((await wide()) !== wantWide) throw new Error(`could not reach the ${wantWide ? 'wide' : 'narrow'} column set`);
  }
  const rows = await page.locator('.data-view tbody tr').count();
  if (rows !== 89) throw new Error(`expected 89 Pods, found ${rows}`);
}

async function podsRecord(browser, viewport, density, set) {
  const { page, context, errors } = await loadMock(browser, viewport);
  const scope = '.data-view';
  await openPods(page, density, set === 'wide');
  await pointerAway(page);
  const rec = await page.evaluate(() => window.__p.captureTable(document.querySelector('.data-view table'), { rows: [0, 1, 44, 88], walkRows: [0] }));
  rec.sticky = await page.evaluate(() => window.__p.sticky(document.querySelector('.data-view table'), 300));
  rec.selectionCommand = await selectionCommand(page, scope, 5);
  rec.sort = await sortStates(page, scope, true);
  rec.states = await rowStates(page, { scope, hoverRow: 1, focusRow: 3, plainRow: 2, selectedRows: [0, 1], tick: true, checkRow: 6 });
  const tokens = await page.evaluate(() => window.__p.tokens());
  await context.close();
  return { rec, errors, tokens };
}

async function stageRecord(page, c) {
  await setContext(page, { density: c.density === 'compact' ? 'compact' : null, flavour: 'mock' });
  const markup = await page.evaluate(c.fixture, c.arg);
  const count = await page.evaluate(([m, css]) => window.__p.renderStage(m, css), [markup, STAGE_CSS]);
  let held = null;
  if (c.hold) held = await page.evaluate((t) => window.__p.holdIdentity(t), c.hold);
  await sleep(120);
  await pointerAway(page);
  const rows = c.rows.map((r) => (r < 0 ? count + r : r));
  const rec = await page.evaluate((o) => window.__p.captureTable(document.querySelector('#probe-stage table'), o), { rows, walkRows: c.walkRows });
  if (held) rec.held = held;
  rec.sticky = await page.evaluate(() => window.__p.sticky(document.querySelector('#probe-stage table'), 300));
  if (c.states) {
    rec.selectionCommand = c.states.cmd ? await selectionCommand(page, '#probe-stage', 5) : null;
    rec.sort = await sortStates(page, '#probe-stage', false);
    rec.states = await rowStates(page, { scope: '#probe-stage', hoverRow: 4, focusRow: 3, plainRow: 5, selectedRows: [1, 2], tick: false, checkRow: 7 });
  }
  return rec;
}

function caseList() {
  const list = [];
  for (const set of ['wide', 'narrow']) for (const density of DENSITIES) list.push({ id: `pods-${set}-${density}`, kind: 'pods', set, density, ...(set === 'wide' ? { vps: ['1440x900'] } : {}) });
  for (const density of DENSITIES) {
    const line = { kind: 'stage', density, fixture: fixtureLine, rows: [0, 1, 6, -1], walkRows: [0] };
    list.push({ ...line, id: `line-plain-${density}`, arg: 'plain', states: { cmd: false } });
    if (density === 'comfortable') {
      list.push({ ...line, id: `line-selection-${density}`, arg: 'selection', states: { cmd: true } });
      list.push({ ...line, id: `line-inspect-${density}`, arg: 'inspect', states: { cmd: false } });
    }
    if (density === 'comfortable') list.push({ ...line, id: `line-bounded-${density}`, arg: 'bounded', states: null, walkRows: [] });
  }
  list.push({ id: 'cell-identity', kind: 'stage', density: 'comfortable', fixture: fixtureCells, arg: 'identity', states: null, rows: [0, 1, 2, 3], walkRows: 'all', hold: 268 });
  list.push({ id: 'cell-identifier', kind: 'stage', density: 'comfortable', fixture: fixtureCells, arg: 'identifier', states: null, rows: [0, 1, 2, 3], walkRows: 'all', hold: 268 });
  list.push({ id: 'cell-text', kind: 'stage', density: 'comfortable', fixture: fixtureCells, arg: 'text', states: null, rows: [0, 1, 2], walkRows: 'all' });
  list.push({ id: 'cell-text-plain', kind: 'stage', density: 'comfortable', fixture: fixtureCells, arg: 'text-plain', states: null, rows: [0, 1, 2], walkRows: 'all' });
  return list.filter((c) => !only || only.test(c.id));
}

async function measureAll() {
  const cases = caseList();
  const raw = {}; // id -> viewport -> engine -> record
  const errorsSeen = {};
  const tokens = {};
  for (const engineName of engineFilter) {
    const browser = await launch(engineName);
    for (const vp of viewportFilter) {
      const t = Date.now();
      // One page per (engine, viewport, density) for B and C: they render into the stage and do not navigate.
      for (const density of DENSITIES) {
        const group = cases.filter((c) => c.kind === 'stage' && c.density === density && (!c.vps || c.vps.includes(vp)));
        if (!group.length) continue;
        const { page, context, errors } = await loadMock(browser, VIEWPORTS[vp]);
        for (const c of group) ((raw[c.id] ??= {})[vp] ??= {})[engineName] = await stageRecord(page, c);
        errorsSeen[`${engineName}/${vp}/stage-${density}`] = errors;
        await context.close();
      }
      for (const c of cases.filter((x) => x.kind === 'pods' && (!x.vps || x.vps.includes(vp)))) {
        const { rec, errors, tokens: t2 } = await podsRecord(browser, VIEWPORTS[vp], c.density, c.set);
        ((raw[c.id] ??= {})[vp] ??= {})[engineName] = rec;
        errorsSeen[`${engineName}/${vp}/${c.id}`] = errors;
        Object.assign(tokens, t2);
      }
      console.log(`${engineName} ${vp} done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    }
    await browser.close();
  }
  return { raw, tokens, errorsSeen };
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The facts the table CSS must reproduce, each checked against the measurement and, for a colour, against its token.               */
/* ------------------------------------------------------------------------------------------------------------------------------ */

function expectations(raw, tokens, e0, v0) {
  const checks = [];
  const rec = (id) => raw[id]?.[v0]?.[e0];
  const check = (fact, expected, got) => checks.push({ fact, expected: expected ?? null, got: got ?? null, ok: same(expected ?? null, got ?? null) });
  const tok = (name) => tokens[name];
  const grade = { comfortable: { row2: 40, row1: 24, head: 25, target: 24, padY: '4px' }, compact: { row2: 38, row1: 22, head: 23, target: 22, padY: '3px' } };
  for (const [density, d] of Object.entries(grade)) {
    const p = rec(`pods-narrow-${density}`);
    const line = rec(`line-plain-${density}`);
    if (p) {
      const tag = `pods ${density}`;
      const row = p.rows[1];
      const th = p.th[1];
      const st = p.states;
      check(`${tag}: two-line row height`, d.row2, row.r[3]);
      check(`${tag}: header height`, d.head, th.r[3]);
      check(`${tag}: selection cell width, th and td`, [46, 46], [p.th[0].r[2], row.td[0].r[2]]);
      check(`${tag}: selection cell padding`, '0px 10px 0px 12px', row.td[0].s.pad);
      const control = p.th[0].k.find((k) => k.t === 'button');
      check(`${tag}: selection control box`, [d.target, d.target], [control.r[2], control.r[3]]);
      check(`${tag}: td padding, interior and identity`, [`${d.padY} 10px ${d.padY} 10px`, `${d.padY} 10px ${d.padY} 10px`], [row.td[2].s.pad, row.td[1].s.pad]);
      check(`${tag}: last td padding-right`, '12px', row.td[row.td.length - 1].s.pad.split(' ')[1]);
      check(`${tag}: th padding (a sort button takes the block padding)`, '0px 24px 0px 10px', th.s.pad);
      check(`${tag}: th and td font`, ['13px/16px 400', '13px/16px 400'], [th.s.font, row.td[2].s.font]);
      check(`${tag}: th colour is --int-fg-muted`, tok('--int-fg-muted'), th.s.color);
      check(`${tag}: th background is --int-bg-island`, tok('--int-bg-island'), th.s.bg);
      check(`${tag}: th border-bottom is 1px --int-border-subtle`, `1px solid ${tok('--int-border-subtle')}`, th.s.bB);
      check(`${tag}: td colour is --int-fg`, tok('--int-fg'), row.td[2].s.color);
      check(`${tag}: td has no border`, undefined, row.td[2].s.bB);
      check(`${tag}: no zebra`, { rowBackgrounds: 1, cellBackgrounds: p.zebra.cellBackgrounds.map(() => 1) }, p.zebra);
      check(`${tag}: row has tabindex 0`, '0', row.a?.tabindex);
      check(`${tag}: hover paints a plain cell --int-hover-row`, tok('--int-hover-row'), st.hover.st.td[2].bg);
      check(`${tag}: hover paints a pinned cell as a --int-hover-row gradient over --int-bg-island`, [`linear-gradient(${tok('--int-hover-row')}, ${tok('--int-hover-row')}), none`, tok('--int-bg-island')], [st.hover.st.td[1].bgImage, st.hover.st.td[1].bg]);
      check(`${tag}: selected, table focused: --int-selection-active`, tok('--int-selection-active'), st.selectedFocused.st.td[2].bg);
      check(`${tag}: selected, table not focused: --int-selection-inactive`, tok('--int-selection-inactive'), st.selectedBlurred.st.td[2].bg);
      check(`${tag}: hover does not change a selected row`, st.selectedBlurred.st.td[2].bg, st.selectedHover.st.td[2].bg);
      check(`${tag}: row focus-visible outline`, `2px solid ${tok('--int-accent')} -2px`, st.focus.st.row.outline);
      const asc = p.sort.ascending.button;
      check(`${tag}: sort button height`, d.target, asc.rest.size[1]);
      check(`${tag}: sort button colour at rest --int-fg-muted, hover --int-fg`, [tok('--int-fg-muted'), tok('--int-fg')], [asc.rest.s.color, asc.hover.s.color]);
      check(`${tag}: sort icon is 12px, colour --int-icon`, [12, 12, tok('--int-icon')], [asc.rest.icon[2], asc.rest.icon[3], asc.rest.icon[4]]);
      check(`${tag}: sort button gap`, '4px', asc.rest.s.gap);
      check(`${tag}: aria-sort ascending, none, descending`, ['ascending', 'none', 'descending'], [p.sort.ascending.aria.thSort, p.sort.inactive.aria.thSort, p.sort.descending.aria.thSort]);
      check(`${tag}: header is sticky at top 0 and stays at the region top after a scroll`, ['sticky', '0px', 0], [th.s.position, th.s.top, p.sticky?.headerTop]);
    }
    if (line) {
      const tag = `line ${density}`;
      check(`${tag}: one-line row height and header height`, [d.row1, d.head], [line.rows[1].r[3], line.th[0].r[3]]);
      check(`${tag}: numeric cell aligned right with tabular figures`, ['right', 'tabular-nums'], [line.rows[1].td[2].s.align, line.rows[1].td[2].s.nums]);
    }
  }
  return checks;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Reduce, write, report.                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------------------------ */

function reduce({ raw, tokens, errorsSeen }) {
  const [e0, ...otherEngines] = engineFilter;
  const failures = [];
  const engineWidth = {}; // pattern -> { count, max, example }
  const engineNoise = {}; // pattern -> { count, max }: differences of TOL or less
  const perCaseWidth = {};
  const judge = (id, label, a, b, engineRun) => {
    for (const [p, pair] of Object.entries(diffRecords(a, b))) {
      const kind = classify(p, pair);
      const amount = Array.isArray(pair[0]) && Array.isArray(pair[1]) ? Math.max(...pair[0].map((x, i) => (typeof x === 'number' && typeof pair[1][i] === 'number' ? Math.abs(x - pair[1][i]) : 0))) : typeof pair[0] === 'number' && typeof pair[1] === 'number' ? Math.abs(pair[0] - pair[1]) : 0;
      if (kind === 'noise' && engineRun) {
        const e = (engineNoise[patternOf(p)] ??= { count: 0, max: 0 });
        e.count += 1;
        e.max = Math.max(e.max, Math.round(amount * 100) / 100);
      }
      if (kind === 'noise' || kind === 'layout') continue;
      if (kind === 'width') {
        if (!engineRun) continue;
        const delta = amount;
        const key = patternOf(p);
        const e = (engineWidth[key] ??= { count: 0, max: 0, example: `${id} ${label} ${p}: ${JSON.stringify(pair[0])} vs ${JSON.stringify(pair[1])}` });
        e.count += 1;
        e.max = Math.max(e.max, Math.round(delta * 100) / 100);
        perCaseWidth[id] = (perCaseWidth[id] ?? 0) + 1;
      } else failures.push(`${id} ${label} ${p} (${kind}): ${JSON.stringify(pair[0])} vs ${JSON.stringify(pair[1])}`);
    }
  };
  const viewportsOf = (perViewport) => Object.keys(perViewport);
  for (const [id, perViewport] of Object.entries(raw)) {
    const [first, ...rest] = viewportsOf(perViewport);
    for (const vp of [first, ...rest]) for (const engine of otherEngines) judge(id, `${vp} ${e0}/${engine}`, perViewport[vp][e0], perViewport[vp][engine], true);
    for (const vp of rest) for (const engine of engineFilter) judge(id, `${engine} ${first}/${vp}`, perViewport[first][engine], perViewport[vp][engine], false);
  }
  // A compact case is stored at its first viewport only: it must differ from its comfortable twin in the same way at the other viewports.
  const compactOf = (id) => (id.endsWith('-compact') ? id.replace(/-compact$/, '-comfortable') : null);
  const densityShape = (twin, id, vp, engine) => Object.fromEntries(Object.entries(diffRecords(raw[twin][vp][engine], raw[id][vp][engine])).filter(([p, pair]) => ['value', 'structure'].includes(classify(p, pair))));
  for (const [id, perViewport] of Object.entries(raw)) {
    const twin = compactOf(id);
    if (!twin || !raw[twin]) continue;
    const [first, ...rest] = viewportsOf(perViewport);
    for (const engine of engineFilter) for (const vp of rest) {
      if (!same(densityShape(twin, id, first, engine), densityShape(twin, id, vp, engine))) failures.push(`${id} ${engine}: compact differs from comfortable differently at ${first} and ${vp}`);
    }
  }

  // styles interned: a style object is replaced by its content-hash id
  const styles = {};
  const styleId = (x) => {
    const key = JSON.stringify(Object.fromEntries(Object.entries(x).sort()));
    const id = `S${hash6(key)}`;
    if (styles[id] && JSON.stringify(styles[id]) !== key) throw new Error(`style id collision ${id}`);
    styles[id] = JSON.parse(key);
    return id;
  };
  const intern = (v) => {
    if (Array.isArray(v)) return v.map(intern);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 's' && x && typeof x === 'object') out[k] = styleId(x);
      else if (k === 'st') out[k] = Object.fromEntries(Object.entries(x).map(([name, s]) => [name, Array.isArray(s) ? s.map(styleId) : styleId(s)]));
      else out[k] = intern(x);
    }
    return out;
  };
  const delta = (a, b) => Object.fromEntries(Object.entries(diffRecords(a, b)).map(([p, [, y]]) => [p, y === undefined ? { $: 'removed' } : y]));
  // The Chromium values that matter: a style that differs is told by its id (the path is cut at the style), every other leaf by its value.
  const styleRoot = /^(.*?\.s|.*?\.st\.(?:[a-zA-Z]+|td\.\d+))\.[^.]+$/;
  const getPath = (root, p) => p.split('.').reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), root);
  const significant = (rawA, rawB, internedB) => {
    const out = {};
    for (const [p, pair] of Object.entries(diffRecords(rawA, rawB))) {
      if (['noise', 'layout'].includes(classify(p, pair))) continue;
      const root = styleRoot.exec(p)?.[1] ?? p;
      const v = getPath(internedB, root);
      out[root] = v === undefined ? { $: 'removed' } : v;
    }
    return out;
  };

  const cases = {};
  const interned = {};
  for (const [id, perViewport] of Object.entries(raw)) for (const vp of viewportsOf(perViewport)) interned[`${id}/${vp}`] = intern(perViewport[vp][e0]);
  for (const [id, perViewport] of Object.entries(raw)) {
    cases[id] = {};
    const twin = compactOf(id);
    const [first, ...rest] = viewportsOf(perViewport);
    for (const vp of twin ? [first] : [first, ...rest]) {
      const me = interned[`${id}/${vp}`];
      let entry;
      if (twin && interned[`${twin}/${vp}`]) entry = { from: `${twin}/${vp}`, diff: delta(interned[`${twin}/${vp}`], me) };
      else if (vp !== first) entry = { from: `${id}/${first}`, diff: delta(interned[`${id}/${first}`], me) };
      else entry = { record: me };
      const engineDiff = {};
      for (const engine of otherEngines) {
        const d = significant(perViewport[vp][e0], perViewport[vp][engine], intern(perViewport[vp][engine]));
        if (Object.keys(d).length) engineDiff[engine] = d;
      }
      if (Object.keys(engineDiff).length) entry.engineDiff = engineDiff;
      cases[id][vp] = entry;
    }
  }
  return { failures, engineWidth, engineNoise, perCaseWidth, styles, cases };
}

async function main() {
  const t0 = Date.now();
  const measured = FROM_RAW ? JSON.parse(readFileSync(path.join(FROM_RAW, 'mock-table.raw.json'), 'utf8')) : await measureAll();
  if (RAW && !FROM_RAW) writeFileSync(path.join(RAW, 'mock-table.raw.json'), JSON.stringify(measured));
  const [e0] = engineFilter;
  const [v0] = viewportFilter;
  const { failures, engineWidth, engineNoise, perCaseWidth, styles, cases } = reduce(measured);
  const checks = expectations(measured.raw, measured.tokens, e0, v0);
  const colors = new Set();
  for (const s of Object.values(styles)) for (const [k, v] of Object.entries(s)) if (/^(color|bg|bT|bR|bB|bL|outline)$/.test(k)) for (const m of String(v).match(/rgba?\([^)]*\)/g) ?? []) colors.add(m);
  const colorTokens = {};
  for (const c of colors) {
    const names = Object.entries(measured.tokens).filter(([, v]) => v === c).map(([n]) => n).sort();
    if (names.length) colorTokens[c] = names;
  }
  const out = {
    meta: {
      mockTree: MOCK_TREE,
      tag: MOCK_TAG,
      measuredAt: new Date().toISOString(),
      engines: engineFilter,
      viewports: viewportFilter,
      font: "the mock's own Inter 3.019 Regular and SemiBold and JetBrains Mono 2.304 Regular; no font is normalized on either side",
      theme: 'default (no data-theme attribute)',
      notes: [
        'Fonts: the mock\'s own, on both sides: the page is measured once its fonts are loaded (probe-lib awaitFonts) and nothing is normalized, so the fixed widths of the fit (a ready count, a status, an age) are the Inter widths the plan names (59, 157, 72, 59). Chromium runs with --font-render-hinting=none (probe-lib launch), so the widths hold on Linux as on macOS.',
        'Pods: a freshly loaded page per rendering; 89 rows are asserted. The wide set (CPU and Memory) is what the mock shows at 1440 and is measured there only; the narrow set is reached at 1440 by unticking CPU and Memory in Columns and is the default at 1030. Ticking them at 1030 appends them after Age, which is not the order of the wide set.',
        'Stage (B and C): fixed full-screen div #probe-stage, padding 40px, background var(--int-bg-island), the wrapper as H.table writes it; the mock\'s own fitTables and prepareIdentifiers run once after the markup is set.',
        'cell-identity and cell-identifier: the identity column is held at 268 px by giving the table wrapper a width (record.held); it is the first column there, so its leading padding is 12px, not the 10px behind a selection cell.',
        'cell-text and cell-text-plain: the same table; in cell-text the Image and Note cells are clip slots (`.cell-clip`, which caps what its column asks for at 240 px in the mock\'s measure: base.css 1271), in cell-text-plain they are plain text, which is what the kit\'s table is given (it has no clip slot): its columns ask for their text. The probe compares cell-text-plain.',
        'states: the computed style of the row (st.row), every cell (st.td), the selection control (st.command) and its mark (st.mark); m = the pseudo-classes in effect. selectedFocused: a control of the table has keyboard focus (:focus-within on .tablewrap); selectedBlurred: nothing focused; selectedHover: pointer on a selected row.',
        'sticky: the scroll region scrolled by 300 px (clamped; scrollTop is what applied), then restored; th is the second header cell.',
        'sort: the th and the aria the mock writes, and the button in rest, hover and focus (probe-lib measure and summarize: size [w, h], icon [left, top, w, h, colour], label [left, width, text]).',
        'Metric cells (CPU, Memory) carry no text and no descendants: 1a shows current values only.',
        'A compact case is stored as a diff from its comfortable twin at the same viewport, and at its first viewport only (the run checks that it differs from the twin in the same way at the second); a second viewport of the other cases as a diff from the first. expandCase(data, id, viewport, engine) rebuilds a record. Selection and inspect variants are measured comfortable only: line-plain-compact and the Pods lists carry the compact selection and inspect columns.',
      ],
      engineDifferences: { note: 'WebKit against Chromium. byPath: paths (digits as #) that differ by more than 0.5 px, count over all cases and viewports and the largest difference in px (none when empty); subTolerance: paths that differ by 0.5 px or less (text-range boxes, float rounding), not stored; every other number and every style is identical in both engines', byPath: engineWidth, subTolerance: engineNoise, byCase: perCaseWidth },
      pageErrors: Object.fromEntries(Object.entries(measured.errorsSeen).filter(([, v]) => v.length)),
    },
    styles,
    colorTokens,
    checks: { held: checks.filter((c) => c.ok).length, of: checks.length, failing: checks.filter((c) => !c.ok) },
    cases,
  };
  const json = JSON.stringify(out);
  const file = writeOut ? path.join(here, 'mock-table.json') : path.join(RAW ?? FROM_RAW ?? here, 'mock-table.partial.json');
  writeFileSync(file, json);
  const bytes = Buffer.byteLength(json);
  console.log(`file: ${file}  ${(bytes / 1024).toFixed(1)} KB (limit ${MAX_BYTES / 1024})  styles ${Object.keys(styles).length}  total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`engine/viewport independence failures: ${failures.length}`);
  for (const f of failures.slice(0, 60)) console.log(`  ${f}`);
  console.log(`numbers that differ between engines (> ${TOL} px): ${Object.keys(engineWidth).length ? '' : 'none'}`);
  for (const [k, v] of Object.entries(engineWidth).sort((a, b) => b[1].max - a[1].max).slice(0, 40)) console.log(`  ${k}: x${v.count} max ${v.max}px  e.g. ${v.example}`);
  console.log(`numbers that differ by ${TOL} px or less between engines (not stored):`);
  for (const [k, v] of Object.entries(engineNoise).sort((a, b) => b[1].max - a[1].max).slice(0, 25)) console.log(`  ${k}: x${v.count} max ${v.max}px`);
  console.log(`expectations: ${out.checks.held}/${out.checks.of} hold`);
  for (const c of out.checks.failing) console.log(`  FAILS ${c.fact}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.got)}`);
  if (Object.keys(out.meta.pageErrors).length) console.log(`page errors: ${JSON.stringify(out.meta.pageErrors)}`);
  if (writeOut && bytes > MAX_BYTES) { console.log(`TOO BIG: ${bytes} bytes`); process.exitCode = 1; }
  if (failures.length || out.checks.failing.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

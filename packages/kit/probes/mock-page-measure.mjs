// Measures the design mock's page chrome: the REFERENCE the kit's PageHeader, WorkspaceToolbar, SearchField, CollectionFooter and DataView (and the generic
// list page built from them: the Kubernetes Pods list) are compared with. The sibling of mock-table-measure.mjs; it reuses probe-lib.mjs unchanged.
//
//   1. Serve the mock as mock-measure.mjs says (a CommonJS copy of its server.js with `root` set to the mock directory, run from /tmp on a free port):
//      `app/OmniviewNativeLab/frontend/mock` of omniviewdev/design-lab at tag spec-baseline-2026-11-16 (mock tree c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0).
//   2. MOCK_URL=http://127.0.0.1:<port>/ node packages/kit/probes/mock-page-measure.mjs      (about 2 minutes: one job per engine and viewport, four at a time)
//
// WebKit and Chromium, 1440 x 900 and 1030 x 720 (page container #mainscroll > .content 1117 and 707 px wide, the island's page 783 and 603 px high), default theme,
// text size and density, the font normalized as mock-measure.mjs does. Every case is a freshly loaded page. The Pods list is opened as the brief says (3 s, the
// route, 3.5 s, the pointer not moved). The other sections register a throwaway page with the mock's own AWS.page and open it in the tab (Shell.tabs.open), so the
// page container, its `@container page` rules and the island are the real ones; every part is built with the mock's own H.* helpers (H.pageHeader, H.dataView,
// H.collectionState, H.table, H.footer, H.count, H.quickFilters, H.search, ...) and every operation is a real Shell.ops record. The script exits non-zero when a
// target it expects is missing (or present where it must not be), a state is not really in effect, a calm sentence was measured late, or a check of the stated geometry fails.
//
// Sections (JSON keys): list (A: the real Pods list, 89 Pods, wide column set at 1440), listNarrow (A: CPU and Memory unticked in the Columns picker; at 1030 they are
// not shown by default, so `reached` says 'default'), header (B: h-list h-list-full h-detail h-detail-long h-disabled h-note), slot (C: the operation slot of h-detail
// through the phases rest running0 running1 indeterminate paused succeeded failed retrying cancelled restAgain), states (D: s-ready s-loading s-empty s-nomatch s-error
// s-error-rows s-partial s-stale s-refreshing s-denied s-footer-note s-footer-count), search (E: rest hover focus typed found foundTyped, native clear button, Escape).
//
// Output mock-page.json (at most 150 KB): { meta, styles, colorTokens, checks, list, listNarrow, header, slot, states, search }
//   meta          mock tree and tag, engines and versions, viewports, font, engineDifferences (paths per case), pageErrors (the mock's own console errors), failures, notes, surprises
//   styles        every computed-style summary once, by id (S + hash); a node's `s` is such an id. Keys: color, bg, bgImage, bT bR bB bL ('width style colour'), radius, pad,
//                 margin ('auto' where a side is over 32 px: an auto margin), font ('size/line-height weight'), ls, nums, mono, ws (white-space), overflow ('x y'), textOverflow,
//                 display, position, alignItems, justify, dir, gap (column), rowGap, cursor, outline ('width style colour offset'), shadow, opacity, flex ('grow shrink basis'),
//                 minW minH maxW maxH, clamp (line-clamp), talign; defaults are left out
//   colorTokens   computed colour -> the --int-* tokens that resolve to it
//   checks        the facts the chrome must reproduce, each checked against the measurement: { held, of, failing }
//   entry         { webkit: <record>, chromium: <the paths where Chromium differs by more than 0.5 px, with its value> (absent when none), deltas (slot only) };
//                 expandEntry(entry, engine) rebuilds a full record (import it: the run starts only when this file is the entry)
//   node          r rect [x, y, w, h] (absolute CSS px, 0.01), s style id, n element count (1 + descendants), x text, xr text range rect (its y and h are the engine's text box:
//                 not compared between engines), t tag, c classes, a attributes, cut [scrollWidth, clientWidth] when the box clips its content
//   list, listNarrow  [viewport] -> { island page content lane dataView dvHeader dvBody dvFooter header row title commands cmd0..2 (primary, Refresh, overflow) menu quick chipAll chipRunning
//                 chipPending chipFailed chipCompleted toolbar toolbarKids[{t, c, r}] search searchInput searchIconBox searchIcon facet0.. facetTrigger0.. columnsWrap columns cluster0.. footerSpan0..
//                 count footerRuns[{x, r, p}] thead tr0 scroll{scrollHeight clientHeight ...} reached cols[[name, width]] }
//   header        [id][viewport] -> { header breadcrumb crumb0.. chevron0.. row tile title meta state stateIcon stateLabel facts fact0.. factText0.. sep1.. (the ::before dot of fact i: its rect is derived
//                 from the computed box) copy0.. note reason slot (absent: no operation passed) commands cmd0.. overflow menu (closed: 0 x 0) next (the block 12px after the header) d{h gapToNext laneDropped pageWidth} }
//   slot          [viewport] -> { webkit: { <phase>: { header title meta state facts commands slot op notify main phase track bar fill actions btn0.. next; rest also fact0.. cmd0.. } }, deltas: { <phase>: { header title meta commands next } } }
//                 (a delta is [dx, dy, dw, dh] from rest, 0 when nothing moved); the facts are display: none under 1000 px of page width while an operation shows
//   states        [id][viewport] -> { dataView dvHeader dvBody first[{c, r}] (the first things in the body) dvFooter (absent: s-error) footerRuns cluster0.. + per state: quick toolbar search clear
//                 tablewrap thead th0.. tr0.. scroll | collection stateBody skeleton skRows skHeadRow skRow0 skBar0 | emptyCell empty emptyIcon emptyTitle emptyAction | notice noticeIcon noticeBody
//                 noticeMessage noticeTitle noticeActions retry | lane laneCluster laneSummary laneIcon laneLabel laneAction0 laneButton0 | note noteText | footer0..4 count0..4 }
//   search        [viewport] -> { rest hover focus typed found foundTyped: { toolbar field input iconBox icon count m{hover focus focusVisible value} }, native{cancel decoration drawn control}, escape }
//
// Engines: numbers within 0.5 px and everything else exactly equal are one value; where Chromium differs, the entry keeps its value by path.
// STATUS: every section above is measured in both engines at both viewports and its checks hold. Not verified: that the result is identical run to run with JOBS=1 (four jobs ran at a time);
// not measured: other themes, text sizes and densities, the header with an operation and no identity line (--op-row), the open overflow menu.
// Debug: ENGINE=, VIEWPORT= (comma lists), ONLY=<regexp on a section or case id> (writes mock-page.partial.json instead), RAW=<dir> (output directory; also writes mock-page.raw.json),
// FROM_RAW=<dir> reduces a RAW run again, SHOTS=<dir> writes full-page PNGs mock-list-<engine>-<viewport>.png and mock-list-narrow-<engine>-<viewport>.png, JOBS=<n> (default 4).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, VIEWPORTS, installRecordLib, normalizeFont, settle, sleep } from './probe-lib.mjs';

const URL = process.env.MOCK_URL ?? 'http://127.0.0.1:49231/';
const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = process.env.RAW;
const FROM_RAW = process.env.FROM_RAW;
const SHOTS = process.env.SHOTS;
if (RAW) mkdirSync(RAW, { recursive: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const MOCK_TAG = 'spec-baseline-2026-11-16';
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const engineFilter = process.env.ENGINE ? process.env.ENGINE.split(',') : Object.keys(ENGINES);
const viewportFilter = process.env.VIEWPORT ? process.env.VIEWPORT.split(',') : Object.keys(VIEWPORTS);
const JOBS = Math.max(1, Number(process.env.JOBS ?? 4));
const writeOut = !only && !process.env.ENGINE && !process.env.VIEWPORT && !FROM_RAW;
const TOL = 0.5; // px: a difference of this or less is not a difference
const MAX_BYTES = 150 * 1024;
const OPEN_PODS = "const scope = K8s.connections.defaultScope('prod-eu'); Shell.tabs.open({ plugin: 'kubernetes', route: K8s.route.make('k8s-resources', { logicalType: 'k8s:/pods' }, scope), scope }, { how: 'here' });";

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The page side: these functions run in the browser and must not close over anything.                                              */
/* ------------------------------------------------------------------------------------------------------------------------------ */

function installPageLib() {
  const { r2, styleOf, elements } = window.__rec;
  const rectOf = (el) => {
    const b = el.getBoundingClientRect();
    return [r2(b.left), r2(b.top), r2(b.width), r2(b.height)];
  };
  /** The record's style (defaults left out) and what a page's chrome also depends on: the cursor of every element, flex, row gap, clamp, text alignment, min and max height. */
  const styleFull = (el) => {
    const s = styleOf(el);
    const css = getComputedStyle(el);
    if (s.cursor === undefined && css.cursor !== 'auto') s.cursor = css.cursor;
    if (css.display !== 'none') {
      const flex = `${css.flexGrow} ${css.flexShrink} ${css.flexBasis}`;
      if (flex !== '0 1 auto') s.flex = flex;
    }
    if (css.rowGap !== 'normal' && css.rowGap !== css.columnGap) s.rowGap = css.rowGap;
    if (css.webkitLineClamp && css.webkitLineClamp !== 'none') s.clamp = css.webkitLineClamp;
    if (!/^(start|left)$/.test(css.textAlign) && !s.align) s.talign = css.textAlign;
    if (css.minHeight !== '0px' && css.minHeight !== 'auto') s.minH = css.minHeight;
    if (css.maxHeight !== 'none') s.maxH = css.maxHeight;
    // an auto margin computes to the px it takes at this width: the design scale stops at 24px, so a larger margin is the auto one
    const m = ['Top', 'Right', 'Bottom', 'Left'].map((k) => css[`margin${k}`]);
    if (m.some((v) => parseFloat(v) > 32)) s.margin = m.map((v) => (parseFloat(v) > 32 ? 'auto' : v)).join(' ');
    return s;
  };
  const attrsOf = (el, names) => {
    const out = {};
    const wanted = el.getAttribute('aria-disabled') === 'true' ? [...names, 'data-tooltip'] : names;
    for (const name of wanted) if (el.hasAttribute(name)) out[name] = el.getAttribute(name).slice(0, 80);
    return out;
  };
  const classesOf = (el) => (el.getAttribute('class') || '').trim().replace(/\s+/g, ' ');
  const textNodes = (el) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() && !n.parentElement.closest('svg') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
    return out;
  };
  const textOf = (el) => textNodes(el).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const rangeRect = (nodes) => {
    let u = null;
    for (const n of nodes) {
      const range = document.createRange();
      range.selectNodeContents(n);
      const b = range.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      u = u ? [Math.min(u[0], b.left), Math.min(u[1], b.top), Math.max(u[2], b.right), Math.max(u[3], b.bottom)] : [b.left, b.top, b.right, b.bottom];
    }
    return u ? [r2(u[0]), r2(u[1]), r2(u[2] - u[0]), r2(u[3] - u[1])] : null;
  };
  const nodeOf = (el, o) => {
    const n = { r: rectOf(el) };
    if (o.S) n.s = styleFull(el);
    if (o.N) n.n = elements(el);
    if (o.T) n.t = el.tagName.toLowerCase();
    if (o.C) { const c = classesOf(el); if (c) n.c = c; }
    if (o.X || o.XR) {
      const nodes = textNodes(el);
      const x = nodes.map((t) => t.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (x) { n.x = x; if (o.XR) { const xr = rangeRect(nodes); if (xr) n.xr = xr; } }
    }
    if (o.A) { const a = attrsOf(el, o.A); if (Object.keys(a).length) n.a = a; }
    if (o.cut && !(el instanceof SVGElement) && el.scrollWidth > el.clientWidth + 0.5) n.cut = [el.scrollWidth, el.clientWidth];
    return n;
  };
  /** The ::before of a fact (the separator dot): a pseudo-element has no rect, so it is derived from its computed box and the owner's box (the owner centres its items). */
  const pseudoNode = (el, which) => {
    const cs = getComputedStyle(el, which);
    if (cs.content === 'none' || cs.content === 'normal') return null;
    const b = el.getBoundingClientRect();
    const ml = parseFloat(cs.marginLeft) || 0;
    const w = parseFloat(cs.width);
    const h = parseFloat(cs.height);
    const n = { s: { content: cs.content, color: cs.color, font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`, margin: `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`, display: cs.display, position: cs.position } };
    if (Number.isFinite(w) && Number.isFinite(h)) n.r = [r2(b.left + ml), r2(b.top + (b.height - h) / 2), r2(w), r2(h)];
    return n;
  };
  const CUSTOM = {
    scroll: (el) => {
      const css = getComputedStyle(el);
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollTop: el.scrollTop, overflow: `${css.overflowX} ${css.overflowY}` };
    },
    runs: (el) => textNodes(el).map((t) => ({ x: t.textContent.trim().replace(/\s+/g, ' ').slice(0, 80), r: rangeRect([t]), p: classesOf(t.parentElement).split(' ')[0] || t.parentElement.tagName.toLowerCase() })),
    chain: (el, spec) => {
      const out = [];
      for (let cur = el.firstElementChild; cur && out.length < (spec.depth || 5); cur = cur.firstElementChild) out.push({ c: classesOf(cur).split(' ')[0] || cur.tagName.toLowerCase(), r: rectOf(cur) });
      return out;
    },
    skeleton: (el) => [...el.querySelectorAll(':scope > .skeleton__row')].slice(0, 3).map((row) => ({ r: rectOf(row), bars: [...row.children].map(rectOf) })),
  };
  /** Read the targets: { rec: { <name>: node | [nodes] }, counts: { <name>: matches } }. A target is { n, sel, root?, all?, names?, kids?, pseudo?, custom?, limit?, S, N, T, C, X, A, cut }. */
  const readAll = (specs) => {
    const rec = {};
    const counts = {};
    for (const spec of specs) {
      const root = spec.root === undefined ? document : document.querySelector(spec.root);
      let els = [];
      if (root) {
        if (spec.sel === '') els = root === document ? [] : [root];
        else if (spec.all || spec.kids) els = [...root.querySelectorAll(spec.sel)];
        else { const el = root.querySelector(spec.sel); els = el ? [el] : []; }
      }
      if (spec.limit) els = els.slice(0, spec.limit);
      counts[spec.n] = els.length;
      if (spec.custom) { if (els[0]) rec[spec.n] = CUSTOM[spec.custom](els[0], spec); continue; }
      if (spec.kids) { rec[spec.n] = els.map((el) => ({ t: el.tagName.toLowerCase(), c: classesOf(el), r: rectOf(el) })); continue; }
      if (spec.pseudo) {
        let found = 0;
        els.forEach((el, i) => { const p = pseudoNode(el, spec.pseudo); if (p) { rec[`${spec.n}${i}`] = p; found += 1; } });
        counts[spec.n] = found;
        continue;
      }
      if (spec.all) els.forEach((el, i) => { rec[spec.names ? spec.names[i] ?? `${spec.n}${i}` : `${spec.n}${i}`] = nodeOf(el, spec); });
      else if (els[0]) rec[spec.n] = nodeOf(els[0], spec);
    }
    return { rec, counts };
  };
  /** Computed colour -> the --int-* tokens that resolve to it (from base.css), as mock-table-measure does. */
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
  window.__pm = { rectOf, styleFull, readAll, tokens, textOf };
}

/** The mock's own helpers, driven with the neutral inputs of the brief; every fixture is html from H.* only. */
function installFixtures() {
  const need = (text, n) => { if (text.length !== n) throw new Error(`fixture text "${text}" is ${text.length} characters, not ${n}`); return text; };
  const refresh = { label: 'Refresh items', icon: 'LuRefreshCw', action: 'noop:refresh' };
  const detail = (over = {}) => ({
    id: 'probe-header',
    path: [['Acme', 'route'], ['Items', 'route'], 'orders-api'],
    tile: { icon: 'LuBox' },
    title: 'orders-api',
    state: { role: 'running', raw: 'Running', label: 'Running' },
    identity: [{ text: 'i-0a1b2c3d4e5f', mono: true, copy: true, label: 'id' }, { text: 'Deployment' }, { text: 'checkout' }, { text: '3d' }],
    commands: {
      primary: { label: 'Scale', icon: 'LuPlus', action: 'noop:scale' },
      secondary: [{ label: 'Edit', action: 'noop:edit' }, { label: 'Restart', action: 'noop:restart' }],
      danger: { label: 'Delete', action: 'noop:delete' },
      utility: refresh,
      menu: [{ id: 'pause', label: 'Pause rollout', action: 'noop:pause' }, { id: 'evict', label: 'Evict pods…', danger: true, action: 'noop:evict' }],
    },
    ...over,
  });
  const headers = {
    'h-list': () => ({ id: 'probe-header', title: 'Items', commands: { utility: refresh } }),
    'h-list-full': () => ({ id: 'probe-header', title: 'Items', commands: { primary: { label: 'Create item', icon: 'LuPlus', action: 'noop:create' }, utility: refresh, menu: [{ id: 'selector', label: 'Label selector…', icon: 'LuTag', action: 'noop:selector' }] } }),
    'h-detail': () => detail(),
    'h-detail-long': () => detail({
      title: need('orders-api-checkout-reconciliation-export-nightly-eu-west-1b', 60),
      identity: [{ text: need('i-0a1b2c3d4e5f6a7b8c9d0e1f2a3b', 30), mono: true, copy: true, label: 'id' }, { text: need('Deployment-checkout-eu-west-1b', 30) }, { text: need('checkout-payments-blue-green-1', 30) }, { text: need('rolled-out-three-days-ago-argo', 30) }],
    }),
    'h-disabled': () => { const o = detail(); o.commands.primary.disabled = 'Another change is running'; return o; },
    'h-note': () => ({ id: 'probe-header', path: [['Acme', 'route'], ['Items', 'route'], 'Create'], title: 'Create item', note: 'Name and namespace · step 1 of 3' }),
  };
  const next = '<div id="probe-next" style="height:8px"></div>';
  const slotOp = () => (window.__slot.op ? Shell.ops.get(window.__slot.op.id) ?? null : null);

  /* the operation, driven as the gallery's kitStart / kitTicks drive it */
  const SPEC = { title: 'Scaling orders-api', doneTitle: 'Scaled orders-api to 3 replicas', target: 'orders-api', start: 'Adding 3 replicas', total: 3, unit: 'replicas', failure: 'The API server refused: the checkout quota allows 2 replicas.', stopped: 'Stopped before every replica was ready' };
  window.__slot = { op: null };
  const slot = window.__slot;
  const drive = {
    begin: () => {
      slot.op = Shell.ops.begin({ title: SPEC.title, doneTitle: SPEC.doneTitle, initiator: 'user', source: { plugin: 'kubernetes' }, origin: { anchor: H.pageHeader.anchor('probe-header') }, target: { label: SPEC.target }, progress: { current: 0, total: SPEC.total, unit: SPEC.unit }, message: SPEC.start, cancellation: 'available',
        onCancel: () => { slot.op.acknowledgeCancel(); slot.op.cancel({ message: SPEC.stopped }); window.__mock.render(true, 'work'); },
        onRetry: () => true });
    },
    step: () => slot.op.update({ progress: { current: 1, total: SPEC.total, unit: SPEC.unit }, message: `1 of ${SPEC.total} ${SPEC.unit} ready` }),
    indeterminate: () => slot.op.update({ progress: 'indeterminate', message: 'Waiting for the API server' }),
    pause: () => slot.op.pause({ message: 'Waiting for approval', actions: [{ id: 'resume', kind: 'custom', label: 'Resume', run: () => {} }] }),
    resume: () => slot.op.resume({ message: SPEC.start, actions: [] }),
    succeed: () => slot.op.succeed({ message: '' }),
    fail: () => slot.op.fail({ message: SPEC.failure }),
    restart: () => slot.op.restart({ message: SPEC.start, progress: { current: 0, total: SPEC.total, unit: SPEC.unit } }),
    cancel: () => { slot.op.acknowledgeCancel(); slot.op.cancel({ message: SPEC.stopped }); },
    clear: () => { if (slot.op) { Shell.ops.remove(slot.op.id, { quiet: true }); slot.op = null; } },
  };

  /* the data view's states */
  const cols = [
    { label: 'Name', fit: 'id', fn: (r) => H.nameCell(H.tile('LuBox', 'var(--int-icon)', 28), `<a class="link" href="#probe">${r.name}</a>`, r.ns) },
    { label: 'Ready', num: true, fn: (r) => `<span class="mono">${r.ready}</span>` },
    { label: 'Status', fn: (r) => H.status(r.status, r.status, { role: r.status === 'Running' ? 'running' : 'error' }) },
    { label: 'Restarts', num: true, k: 'restarts' },
    { label: 'Age', num: true, k: 'age' },
  ];
  const rows = ['api-gateway', 'auth-service', 'billing-worker', 'cache-primary', 'cart-api'].map((name, i) => ({ name, ns: 'checkout', ready: '2/2', status: i === 2 ? 'Failed' : 'Running', restarts: String(i), age: `${i + 1}d` }));
  const filters = [{ id: 'all', label: 'All' }, { id: 'running', label: 'Running', tone: 'success' }, { id: 'pending', label: 'Pending', tone: 'info' }, { id: 'failed', label: 'Failed', tone: 'error' }, { id: 'completed', label: 'Completed' }];
  const header = (clear) => H.quickFilters(filters, { active: 'all', counts: { all: 89, running: 78, pending: 0, failed: 2, completed: 9 }, action: (id) => `noop:quick:${id}`, label: 'Item state' })
    + H.toolbar(H.search('Search items', 'probe-q', { label: 'Search items' }), clear ? H.btn('Clear filters', 'noop:clear', 'LuX', 'ghost small') : '');
  const inspect = { inspect: (r) => ({ title: r.name, rows: [] }), inspectId: 'probe', inspectKey: (r) => r.name, inspectLabel: (r) => r.name };
  const table = () => H.table(cols, rows, { scroll: 'parent', label: 'Items', row: () => 'noop:row', ...inspect });
  const count = (n, d) => H.count(n, d, 'item', 'items');
  const view = (o) => H.dataView({ label: 'Items', header: header(false), ...o });
  const lane = (state, retry) => H.collectionState({ id: 'probe-lane', state, surface: 'inline', noun: 'items', ...(retry ? { retry: { label: retry, action: 'noop:retry' } } : {}) });
  const five = count(5, { kind: 'exact', value: '5' });
  const states = {
    's-ready': () => view({ body: table(), footer: H.footer({ count: five }) }),
    's-loading': () => view({ body: H.collectionState({ id: 'probe-state', state: 'loading', surface: 'body', noun: 'items', columns: 5, rows: 8 }), footer: H.footer({ count: count(0, { kind: 'unknown' }) }) }),
    's-empty': () => view({ body: H.collectionState({ id: 'probe-state', state: 'empty', surface: 'body', noun: 'items', tableColumns: cols, tableOptions: inspect }), footer: H.footer({ count: count(0, { kind: 'exact', value: '0' }) }) }),
    's-nomatch': () => view({ header: header(true), body: H.collectionState({ id: 'probe-state', state: 'no-match', surface: 'body', noun: 'items', tableColumns: cols, tableOptions: inspect, emptyAction: { label: 'Clear filters', action: 'noop:clear' } }), footer: H.footer({ count: count(0, { kind: 'exact', value: '24' }) }) }),
    's-error': () => view({ body: H.collectionState({ id: 'probe-state', state: 'error', surface: 'body', noun: 'items', retry: { label: 'Retry', action: 'noop:retry' } }), footer: H.footer({ count: '', status: [''] }) }),
    's-error-rows': () => view({ body: table(), footer: H.footer({ count: five, status: [lane('error', 'Retry')] }) }),
    's-partial': () => view({ body: table(), footer: H.footer({ count: five, status: [lane('partial', 'Refresh')] }) }),
    's-stale': () => view({ body: table(), footer: H.footer({ count: five, status: [lane('stale', 'Refresh')] }) }),
    's-refreshing': () => view({ body: table(), footer: H.footer({ count: five, status: [lane('refreshing', '')] }) }),
    's-denied': () => view({ body: table(), footer: H.footer({ count: five, status: [lane('denied', 'Retry')] }) }),
    's-footer-note': () => view({ body: table(), footer: H.footer({ count: five, status: [H.tipped('<span class="muted">2 columns hidden at this width</span>', 'Memory, CPU fit a wider list. Choose them in Columns.')] }) }),
    's-footer-count': () => `<div class="stack">${[
      count(5, { kind: 'exact', value: '5' }), count(12, { kind: 'exact', value: '89' }), count(89, { kind: 'unknown', loaded: '89' }), count(50, { kind: 'unknown', loaded: '89' }), count(120, { kind: 'estimate', value: '120' }),
    ].map((c) => H.dataView({ label: 'Items', body: '', footer: H.footer({ count: c }) })).join('')}</div>`,
  };

  /* the search field: at rest, and the found variant as shell-panel.js builds it */
  const search = () => {
    const found = H.search('Search logs', 'probe-found', { label: 'Search logs' }).replace('<input ', '<input aria-describedby="probe-count" ').replace('<div class="search">', '<div class="search search--found">').replace(/<\/div>$/, '<span class="plog__count" id="probe-count">3 of 12</span></div>');
    return `<div id="probe-plain">${H.toolbar(H.search('Search items', 'probe-q', { label: 'Search items' }))}</div><div id="probe-found">${H.toolbar(found)}</div>`;
  };

  window.__fx = {
    header: (name) => H.pageHeader(headers[name]()) + next,
    slotHeader: () => H.pageHeader({ ...headers['h-detail'](), operation: slotOp() }) + next,
    state: (name) => states[name](),
    search,
    drive,
  };
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The targets. { n: name, sel, root, all, names, kids, pseudo, custom, S style, N element count, T tag, C classes, X text, A attributes, cut }  */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const LIST_SPECS = [
  { n: 'island', sel: '.frame__island' },
  { n: 'page', sel: '.frame__page' },
  { n: 'content', sel: '#mainscroll > .content' },
  { n: 'lane', sel: '.frame__lane' },
  { n: 'dataView', sel: '.data-view', S: 1 },
  { n: 'dvHeader', sel: '.data-view__header' },
  { n: 'dvBody', sel: '.data-view__body', S: 1 },
  { n: 'dvFooter', sel: '.data-view__footer', S: 1 },
  { n: 'header', sel: '.data-view__header > .page-header', S: 1, N: 1, C: 1 },
  { n: 'row', sel: '.data-view__header > .page-header > .page-header__row', S: 1 },
  { n: 'title', sel: '.data-view__header .page-header__title', S: 1, XR: 1 },
  { n: 'commands', sel: '.data-view__header .page-header__commands', S: 1 },
  { n: 'cmd', sel: '.data-view__header .page-header__commands > button', all: 1, min: 3, max: 3, S: 1, T: 1, C: 1, X: 1, A: ['aria-label'] },
  { n: 'menu', sel: '.data-view__header .page-header__commands > .menu', S: 1 },
  { n: 'quick', sel: '.data-view__header > .quick-filters', S: 1, N: 1 },
  { n: 'chip', sel: '.data-view__header > .quick-filters > .chip', all: 1, names: ['chipAll', 'chipRunning', 'chipPending', 'chipFailed', 'chipCompleted'], S: 1, N: 1, C: 1, X: 1, A: ['aria-pressed'] },
  { n: 'toolbar', sel: '.data-view__header > .toolbar', S: 1 },
  { n: 'toolbarKids', sel: '.data-view__header > .toolbar > *', kids: 1, min: 3 },
  { n: 'search', sel: '.data-view__header > .toolbar > .search', S: 1, N: 1 },
  { n: 'searchInput', sel: '.data-view__header > .toolbar > .search > input', S: 1, T: 1, A: ['type', 'placeholder', 'aria-label', 'role'] },
  { n: 'searchIconBox', sel: '.data-view__header > .toolbar > .search > .ic', S: 1 },
  { n: 'searchIcon', sel: '.data-view__header > .toolbar > .search > .ic > svg', S: 1 },
  { n: 'facet', sel: '.data-view__header > .toolbar > .value-picker', all: 1, min: 1, S: 1 },
  { n: 'facetTrigger', sel: '.data-view__header > .toolbar > .value-picker .entity-select__trigger', all: 1, min: 1, S: 1, X: 1, A: ['aria-label', 'role'] },
  { n: 'columnsWrap', sel: '.data-view__header > .toolbar > .toolbar-end', S: 1 },
  { n: 'columns', sel: '.data-view__header > .toolbar > .toolbar-end > .column-picker > button', S: 1, X: 1, A: ['aria-haspopup'] },
  { n: 'cluster', sel: '.data-view__footer > .footer-cluster', all: 1, min: 1, S: 1, C: 1 },
  { n: 'footerSpan', sel: '.data-view__footer .footer-cluster > *', all: 1, min: 1, S: 1, C: 1, X: 1 },
  { n: 'count', sel: '.data-view__footer .collection-count', S: 1, XR: 1 },
  { n: 'footerRuns', sel: '.data-view__footer', custom: 'runs' },
  { n: 'thead', sel: '.data-view thead' },
  { n: 'tr0', sel: '.data-view tbody tr' },
  { n: 'scroll', sel: '.data-view__body', custom: 'scroll' },
];

const HEADER = '#mainscroll .page-header';
const HEADER_SPECS = [
  { n: 'header', root: HEADER, sel: '', S: 1, N: 1, C: 1 },
  { n: 'breadcrumb', root: HEADER, sel: ':scope > .breadcrumb', S: 1 },
  { n: 'crumb', root: HEADER, sel: '.breadcrumb > a, .breadcrumb > span:not(.ic)', all: 1, S: 1, T: 1, X: 1 },
  { n: 'chevron', root: HEADER, sel: '.breadcrumb > .ic', all: 1, S: 1 },
  { n: 'row', root: HEADER, sel: ':scope > .page-header__row', S: 1 },
  { n: 'tile', root: HEADER, sel: '.page-header__row > .tile', S: 1 },
  { n: 'title', root: HEADER, sel: '.page-header__title', S: 1, T: 1, XR: 1, A: ['data-tooltip', 'tabindex'], cut: 1 },
  { n: 'meta', root: HEADER, sel: '.page-header__meta', S: 1, C: 1 },
  { n: 'state', root: HEADER, sel: '.page-header__meta > .resource-state', S: 1, N: 1, A: ['data-state-role'] },
  { n: 'stateIcon', root: HEADER, sel: '.resource-state__icon', S: 1 },
  { n: 'stateLabel', root: HEADER, sel: '.resource-state__label', S: 1, XR: 1 },
  { n: 'facts', root: HEADER, sel: '.page-header__facts', S: 1, cut: 1 },
  { n: 'fact', root: HEADER, sel: '.page-header__fact', all: 1, S: 1 },
  { n: 'factText', root: HEADER, sel: '.page-header__fact-text', all: 1, S: 1, XR: 1, A: ['data-clamp', 'data-tooltip-clip'], cut: 1 },
  { n: 'sep', root: HEADER, sel: '.page-header__fact', all: 1, pseudo: '::before' },
  { n: 'copy', root: HEADER, sel: '.page-header__fact > button', all: 1, S: 1, A: ['aria-label'] },
  { n: 'note', root: HEADER, sel: '.page-header__note', S: 1, XR: 1, cut: 1 },
  { n: 'reason', root: HEADER, sel: '.page-header__reason', S: 1, XR: 1, A: ['data-tooltip'], cut: 1 },
  { n: 'slot', root: HEADER, sel: '.page-header__slot', S: 1 },
  { n: 'commands', root: HEADER, sel: '.page-header__commands', S: 1 },
  { n: 'cmd', root: HEADER, sel: '.page-header__commands > button', all: 1, S: 1, T: 1, C: 1, X: 1, A: ['aria-label', 'aria-disabled'] },
  { n: 'overflow', root: HEADER, sel: '.page-header__commands > button[aria-haspopup="menu"]', S: 1 },
  { n: 'menu', root: HEADER, sel: '.page-header__commands > .menu', S: 1 },
  { n: 'next', sel: '#probe-next' },
];
const NONE = { breadcrumb: 0, crumb: 0, chevron: 0, tile: 0, meta: 0, state: 0, stateIcon: 0, stateLabel: 0, facts: 0, fact: 0, factText: 0, sep: 0, copy: 0, note: 0, reason: 0, slot: 0, commands: 0, cmd: 0, overflow: 0, menu: 0 };
const DETAIL = { ...NONE, breadcrumb: 1, crumb: 3, chevron: 2, tile: 1, meta: 1, state: 1, stateIcon: 1, stateLabel: 1, facts: 1, fact: 4, factText: 4, sep: 3, copy: 1, commands: 1, cmd: 6, overflow: 1, menu: 1 };
const HEADERS = {
  'h-list': { ...NONE, commands: 1, cmd: 1 },
  'h-list-full': { ...NONE, commands: 1, cmd: 3, overflow: 1, menu: 1 },
  'h-detail': DETAIL,
  'h-detail-long': DETAIL,
  'h-disabled': { ...DETAIL, reason: 1 },
  'h-note': { ...NONE, breadcrumb: 1, crumb: 3, chevron: 2, meta: 1, note: 1 },
};

const SLOT_SPECS = [
  { n: 'header', root: HEADER, sel: '', S: 1, C: 1 },
  { n: 'title', root: HEADER, sel: '.page-header__title', XR: 1 },
  { n: 'meta', root: HEADER, sel: '.page-header__meta', S: 1 },
  { n: 'state', root: HEADER, sel: '.page-header__meta > .resource-state' },
  { n: 'facts', root: HEADER, sel: '.page-header__facts', S: 1 },
  { n: 'commands', root: HEADER, sel: '.page-header__commands', S: 1 },
  { n: 'slot', root: HEADER, sel: '.page-header__slot', S: 1 },
  { n: 'op', root: HEADER, sel: '.page-header__slot > .page-op', S: 1, A: ['data-state'] },
  { n: 'notify', root: HEADER, sel: '.page-header__slot .notify', S: 1, A: ['data-state', 'data-severity', 'data-cancellation'] },
  { n: 'main', root: HEADER, sel: '.page-header__slot .notify__main', S: 1 },
  { n: 'phase', root: HEADER, sel: '.page-header__slot .notify__phase', S: 1, XR: 1, cut: 1 },
  { n: 'track', root: HEADER, sel: '.page-header__slot .notify__track', S: 1, A: ['aria-hidden'] },
  { n: 'bar', root: HEADER, sel: '.page-header__slot .notify__track > .progress', S: 1, A: ['aria-valuenow'] },
  { n: 'fill', root: HEADER, sel: '.page-header__slot .notify__track > .progress > i', S: 1 },
  { n: 'actions', root: HEADER, sel: '.page-header__slot .notify__actions', S: 1 },
  { n: 'btn', root: HEADER, sel: '.page-header__slot .notify__actions > button', all: 1, S: 1, C: 1, X: 1, A: ['aria-label'] },
  { n: 'next', sel: '#probe-next' },
];
// What only the first phase records: the rest of the header does not move (the deltas say so), so it is not repeated in every phase.
const SLOT_REST_SPECS = [
  { n: 'state', root: HEADER, sel: '.page-header__meta > .resource-state', S: 1 },
  { n: 'fact', root: HEADER, sel: '.page-header__fact', all: 1, min: 4, max: 4 },
  { n: 'cmd', root: HEADER, sel: '.page-header__commands > button', all: 1, min: 6, max: 6 },
];
const IDLE = { op: 0, notify: 0, main: 0, phase: 0, track: 0, bar: 0, fill: 0, actions: 0, btn: 0 };
const SHOWN = { op: 1, notify: 1, main: 1, phase: 1, track: 1, bar: 1, fill: 1, actions: 1 };
/** [phase, what the page does, expected targets]. Every record is a real Shell.ops record; the succeeded and cancelled sentences clear after 8 s, so each is measured at once. */
const PHASES = [
  ['rest', ['clear'], IDLE],
  ['running0', ['clear', 'begin'], { ...SHOWN, btn: 1 }],
  ['running1', ['step'], { ...SHOWN, btn: 1 }],
  ['indeterminate', ['indeterminate'], { ...SHOWN, btn: 1 }],
  ['paused', ['pause'], { ...SHOWN, btn: 2 }],
  ['succeeded', ['resume', 'succeed'], { ...SHOWN, btn: 1 }],
  ['failed', ['clear', 'begin', 'step', 'fail'], { ...SHOWN, btn: 2 }],
  ['retrying', ['restart'], { ...SHOWN, btn: 1 }],
  ['cancelled', ['cancel'], { ...SHOWN, btn: 2 }],
  ['restAgain', ['clear'], IDLE],
];

const STATE_COMMON = [
  { n: 'dataView', sel: '.data-view', S: 1 },
  { n: 'dvHeader', sel: '.data-view__header' },
  { n: 'dvBody', sel: '.data-view__body', S: 1 },
  { n: 'first', sel: '.data-view__body', custom: 'chain', depth: 4 },
  { n: 'dvFooter', sel: '.data-view__footer', S: 1 },
  { n: 'footerRuns', sel: '.data-view__footer', custom: 'runs' },
  { n: 'cluster', sel: '.data-view__footer > .footer-cluster', all: 1, S: 1, C: 1 },
];
// The header slot (strip and toolbar) is the same in every state: its parts are read where the state changes it.
const HEADER_PARTS = [
  { n: 'quick', sel: '.data-view__header > .quick-filters', S: 1 },
  { n: 'toolbar', sel: '.data-view__header > .toolbar', S: 1 },
  { n: 'search', sel: '.data-view__header > .toolbar > .search', S: 1 },
  { n: 'clear', sel: '.data-view__header > .toolbar > button', S: 1, X: 1 },
];
const TABLE_PARTS = [
  { n: 'tablewrap', sel: '.data-view__body .tablewrap', S: 1 },
  { n: 'thead', sel: '.data-view__body thead' },
  { n: 'th', sel: '.data-view__body thead th', all: 1, X: 1 },
];
const EMPTY_PARTS = [
  { n: 'collection', sel: '.data-view__body > .collection-state', S: 1 },
  { n: 'stateBody', sel: '.collection-state__body', S: 1 },
  { n: 'emptyCell', sel: '.data-view__body tbody td[colspan]', S: 1 },
  { n: 'empty', sel: '.data-view__body .empty2', S: 1, N: 1 },
  { n: 'emptyIcon', sel: '.data-view__body .empty2 > .bigicon', S: 1 },
  { n: 'emptyTitle', sel: '.data-view__body .empty2 > b', S: 1, XR: 1 },
  { n: 'emptyAction', sel: '.data-view__body .empty2 > button', S: 1, X: 1 },
];
const LANE_PARTS = [
  { n: 'lane', sel: '.data-view__footer .collection-state', S: 1, N: 1 },
  { n: 'laneCluster', sel: '.data-view__footer .footer-cluster--end', S: 1 },
  { n: 'laneSummary', sel: '.collection-state__summary', S: 1 },
  { n: 'laneIcon', sel: '.collection-state__summary > .ic', S: 1 },
  { n: 'laneLabel', sel: '.collection-state__label', S: 1, XR: 1 },
  { n: 'laneAction', sel: '.collection-state__action', all: 1, S: 1 },
  { n: 'laneButton', sel: '.collection-state__action > button', all: 1, S: 1, X: 1 },
];
const COLLECTION = [{ n: 'collection', sel: '.data-view__body > .collection-state', S: 1 }, { n: 'stateBody', sel: '.collection-state__body', S: 1 }];
// parts: what the state changes; want: the exact count of a part the state has none, one or a known number of.
const STATES = {
  's-ready': { parts: [...HEADER_PARTS, ...TABLE_PARTS, { n: 'tr', sel: '.data-view__body tbody tr', all: 1, limit: 2 }, { n: 'scroll', sel: '.data-view__body', custom: 'scroll' }], want: { th: 6, tr: 2, clear: 0 } },
  's-loading': { parts: [...COLLECTION, { n: 'skeleton', sel: '.data-view__body .skeleton', S: 1, N: 1, A: ['aria-busy', 'role'] }, { n: 'skRows', sel: '.data-view__body .skeleton', custom: 'skeleton' },
    { n: 'skHeadRow', sel: '.skeleton__row--head', S: 1 }, { n: 'skRow', sel: '.skeleton__row:not(.skeleton__row--head)', all: 1, limit: 1, S: 1 }, { n: 'skBar', sel: '.skeleton__bar', all: 1, limit: 1, S: 1 }], want: { skRow: 1, skBar: 1 } },
  's-empty': { parts: [...EMPTY_PARTS, ...TABLE_PARTS], want: { th: 6, emptyAction: 0 } },
  's-nomatch': { parts: [...HEADER_PARTS, ...EMPTY_PARTS, ...TABLE_PARTS], want: { th: 6, clear: 1, emptyAction: 1 } },
  's-error': { parts: [...COLLECTION, { n: 'notice', sel: '.data-view__body .notice', S: 1, N: 1, C: 1 }, { n: 'noticeIcon', sel: '.notice__icon', S: 1 }, { n: 'noticeBody', sel: '.notice__body', S: 1 }, { n: 'noticeMessage', sel: '.notice__message', S: 1, XR: 1 },
    { n: 'noticeTitle', sel: '.notice__message > b', S: 1, XR: 1 }, { n: 'noticeActions', sel: '.notice__actions', S: 1 }, { n: 'retry', sel: '.notice__actions > button', S: 1, XR: 1 }], want: { dvFooter: 0, cluster: 0, footerRuns: 0 } },
  's-error-rows': { parts: LANE_PARTS, want: { laneAction: 1, laneButton: 1 } },
  's-partial': { parts: LANE_PARTS, want: { laneAction: 1, laneButton: 1 } },
  's-stale': { parts: LANE_PARTS, want: { laneAction: 1, laneButton: 1 } },
  's-refreshing': { parts: LANE_PARTS, want: { laneAction: 0, laneButton: 0 } },
  's-denied': { parts: LANE_PARTS, want: { laneAction: 1, laneButton: 1 } },
  's-footer-note': { parts: [{ n: 'note', sel: '.data-view__footer .footer-cluster--end > .tip-target', S: 1, N: 1 }, { n: 'noteText', sel: '.data-view__footer .muted', S: 1, XR: 1 }], want: {} },
  's-footer-count': { layout: 'document', common: false, parts: [{ n: 'footer', sel: '.data-view__footer', all: 1, min: 5, max: 5, S: 1 }, { n: 'cluster', sel: '.data-view__footer > .footer-cluster', all: 1, S: 1 }, { n: 'count', sel: '.collection-count', all: 1, min: 5, max: 5, S: 1, XR: 1 }], want: {} },
};
// Parts that a state may have none of (the count is in `want` where the brief says how many).
const OPTIONAL = new Set(['clear', 'dvFooter', 'cluster', 'footerRuns', 'laneAction', 'laneButton', 'emptyAction', 'skRow', 'skBar']);

const SEARCH_SPECS = [
  { n: 'toolbar', sel: '#probe-plain > .toolbar', S: 1 },
  { n: 'field', sel: '#probe-plain .search', S: 1, N: 1 },
  { n: 'input', sel: '#probe-plain .search > input', S: 1, T: 1, A: ['type', 'placeholder', 'aria-label', 'role'] },
  { n: 'iconBox', sel: '#probe-plain .search > .ic', S: 1 },
  { n: 'icon', sel: '#probe-plain .search > .ic > svg', S: 1 },
];
const FOUND_SPECS = [
  { n: 'toolbar', sel: '#probe-found > .toolbar', S: 1 },
  { n: 'field', sel: '#probe-found .search', S: 1, N: 1, C: 1 },
  { n: 'input', sel: '#probe-found .search > input', S: 1, T: 1, A: ['type', 'placeholder', 'aria-label', 'aria-describedby'] },
  { n: 'iconBox', sel: '#probe-found .search > .ic', S: 1 },
  { n: 'icon', sel: '#probe-found .search > .ic > svg', S: 1 },
  { n: 'count', sel: '#probe-found .search > .plog__count', S: 1, XR: 1 },
];

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Measuring (Node).                                                                                                                */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const failures = [];
const notes = [];
const pageErrors = {};
const fail = (label, message) => failures.push(`${label}: ${message}`);

async function loadMock(browser, viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = (pageErrors[label] ??= []);
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 120)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text().slice(0, 120)}`); });
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(3000);
  const ok = await page.evaluate(() => typeof window.H === 'object' && typeof window.AWS === 'object' && typeof window.Shell === 'object' && typeof window.K8s === 'object' && typeof window.__mock === 'object');
  if (!ok) throw new Error('mock did not expose H / AWS / Shell / K8s / __mock');
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  await page.evaluate(installRecordLib);
  await page.evaluate(installPageLib);
  const root = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), scale: document.documentElement.getAttribute('data-text-scale'), density: document.documentElement.getAttribute('data-density') }));
  if (root.theme || root.scale || root.density) throw new Error(`the mock did not load in its defaults: ${JSON.stringify(root)}`);
  return { page, context };
}

async function pointerAway(page) {
  await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
  await page.mouse.move(1, 1);
  await settle(page);
}

/** Read targets and say which are missing (or present where they must not be). `want` names the exact count of a target. */
async function readSpecs(page, specs, label, want = {}) {
  const { rec, counts } = await page.evaluate((s) => window.__pm.readAll(s), specs);
  for (const spec of specs) {
    const got = counts[spec.n] ?? 0;
    const names = spec.names?.length;
    let min = names ?? spec.min ?? (spec.opt || OPTIONAL.has(spec.n) ? 0 : 1);
    let max = names ?? spec.max ?? (spec.all || spec.kids ? Infinity : 1);
    if (spec.n in want) { min = want[spec.n]; max = want[spec.n]; }
    if (got < min || got > max) fail(label, `target "${spec.n}" (${spec.sel || 'the root'}): expected ${min === max ? min : `${min}..${max}`}, found ${got}`);
  }
  return rec;
}

/** Register a throwaway page (the mock's own AWS.page) whose body is window.__fx[kind](arg), open it in the tab, and wait for `ready`. */
async function openStage(page, { kind, arg, layout, ready }) {
  await page.evaluate(installFixtures);
  await page.evaluate(({ kind, arg, layout }) => {
    window.__probeBuild = () => window.__fx[kind](arg);
    AWS.page('probe/stage', () => window.__probeBuild(), { layout, reuse: true });
    Shell.tabs.open({ page: 'probe/stage' }, { how: 'here' });
  }, { kind, arg, layout });
  await page.waitForSelector(ready, { state: 'attached', timeout: 15000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await sleep(500);
  await settle(page);
}

const render = (page) => page.evaluate(() => window.__mock.render(true, 'work'));

/** Page side: how many pixels differ between two PNGs (base64), and how many of them lie in the right 32 px of the field (where a native clear button would be). */
function comparePng({ a, c }) {
  const load = async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  };
  return Promise.all([load(a), load(c)]).then(([x, y]) => {
    let strip = 0;
    let all = 0;
    for (let row = 2; row < x.height - 2; row += 1) {
      for (let col = 0; col < x.width; col += 1) {
        const i = (row * x.width + col) * 4;
        if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) { all += 1; if (col >= x.width - 34 && col < x.width - 2) strip += 1; }
      }
    }
    return { differingPixels: all, inRightStrip: strip };
  });
}

/* ---- A. the real Pods list ---- */
async function podsPage(browser, viewport, label) {
  const loaded = await loadMock(browser, viewport, label);
  await loaded.page.evaluate(OPEN_PODS);
  await sleep(3500);
  const rows = await loaded.page.locator('.data-view tbody tr').count();
  if (rows !== 89) throw new Error(`expected 89 Pods, found ${rows}`);
  return loaded;
}
const wideNow = async (page) => (await page.locator('.data-view thead th', { hasText: 'CPU' }).count()) > 0;

async function listCase(browser, engineName, vpName, viewport, narrow, label) {
  const { page, context } = await podsPage(browser, viewport, label);
  const wide = await wideNow(page);
  if (wide !== (vpName === '1440x900')) throw new Error(`the Pods list is ${wide ? 'wide' : 'narrow'} at ${vpName}: not what the mock draws by default`);
  let reached = 'default';
  if (narrow && wide) {
    await page.locator('.column-picker button[data-column-trigger]').click();
    await sleep(500);
    for (const name of ['CPU', 'Memory']) {
      await page.locator(`.column-picker__choice[aria-label^="${name}"]`).first().click({ force: true });
      await sleep(400);
    }
    await page.keyboard.press('Escape');
    await sleep(1000);
    if (await wideNow(page)) throw new Error('could not reach the narrow column set');
    await pointerAway(page);
    reached = 'columns picker';
  } else if (narrow) reached = 'default (the viewport already hides CPU and Memory: the footer says so)';
  const rec = await readSpecs(page, LIST_SPECS, label);
  rec.reached = reached;
  rec.cols = await page.evaluate(() => [...document.querySelectorAll('.data-view thead th')].map((th) => [th.textContent.trim(), Math.round(th.getBoundingClientRect().width * 100) / 100]));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `mock-list-${narrow ? 'narrow-' : ''}${engineName}-${vpName}.png`), fullPage: true });
  await context.close();
  return rec;
}

/* ---- B. the header specimens ---- */
async function headerCase(browser, vpName, viewport, id, label) {
  const { page, context } = await loadMock(browser, viewport, label);
  await openStage(page, { kind: 'header', arg: id, layout: 'document', ready: '#mainscroll .page-header' });
  const rec = await readSpecs(page, HEADER_SPECS, label, HEADERS[id]);
  const [, hy, hw, hh] = rec.header.r;
  rec.d = {
    h: hh,
    gapToNext: Math.round((rec.next.r[1] - (hy + hh)) * 100) / 100,
    laneDropped: rec.commands && rec.title ? rec.commands.r[1] > rec.title.r[1] + 1 : null,
    pageWidth: hw,
  };
  await context.close();
  return rec;
}

/* ---- C. the operation slot ---- */
async function slotCase(browser, vpName, viewport, label) {
  const { page, context } = await loadMock(browser, viewport, label);
  await openStage(page, { kind: 'slotHeader', layout: 'document', ready: '#mainscroll .page-header__slot' });
  const out = {};
  for (const [phase, steps, want] of PHASES) {
    const t0 = Date.now();
    for (const step of steps) {
      await page.evaluate((s) => window.__fx.drive[s](), step);
      await render(page);
      await sleep(250);
    }
    await sleep(450);
    await settle(page);
    const rec = await readSpecs(page, SLOT_SPECS, `${label}/${phase}`, want);
    if (phase === 'rest') Object.assign(rec, await readSpecs(page, SLOT_REST_SPECS, `${label}/${phase}`));
    if (Date.now() - t0 > 5000) fail(`${label}/${phase}`, `measured ${Date.now() - t0} ms after the change: a calm sentence clears itself after 8 s`);
    out[phase] = rec;
  }
  await context.close();
  return out;
}

/* ---- D. the states of the data view ---- */
async function stateCase(browser, vpName, viewport, id, label) {
  const def = STATES[id];
  const { page, context } = await loadMock(browser, viewport, label);
  await openStage(page, { kind: 'state', arg: id, layout: def.layout ?? 'pane', ready: id === 's-footer-count' ? '#mainscroll .data-view__footer' : '#mainscroll .data-view' });
  await sleep(id === 's-loading' ? 500 : 200); // the skeleton shows after 250 ms
  await settle(page);
  const specs = [...(def.common === false ? [] : STATE_COMMON), ...def.parts];
  const rec = await readSpecs(page, specs, label, def.want);
  await context.close();
  return rec;
}

/* ---- E. the search field ---- */
async function searchCase(browser, vpName, viewport, label) {
  const { page, context } = await loadMock(browser, viewport, label);
  await openStage(page, { kind: 'search', layout: 'document', ready: '#probe-found .search' });
  const out = {};
  const input = '#probe-plain .search > input';
  const state = (s) => page.evaluate((sel) => { const i = document.querySelector(sel); return { hover: i.matches(':hover'), focus: document.activeElement === i, focusVisible: i.matches(':focus-visible'), value: i.value }; }, s);
  const take = async (name, specs, sel, expect) => {
    await settle(page);
    const rec = await readSpecs(page, specs, `${label}/${name}`);
    rec.m = await state(sel);
    for (const [k, v] of Object.entries(expect)) if (rec.m[k] !== v) fail(`${label}/${name}`, `the search state is not really in effect: ${k} is ${rec.m[k]}, not ${v}`);
    out[name] = rec;
  };
  await take('rest', SEARCH_SPECS, input, { hover: false, focus: false, focusVisible: false, value: '' });
  const box = await page.locator(input).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
  await sleep(300);
  await take('hover', SEARCH_SPECS, input, { hover: true, focus: false, value: '' });
  await page.mouse.move(1, 1);
  await sleep(200);
  // the keyboard reaches the field: focus the page (a tabindex -1 element) and press Tab
  await page.evaluate(() => document.getElementById('mainscroll').focus());
  let via = 'Tab';
  for (let i = 0; i < 3 && !(await state(input)).focus; i += 1) await page.keyboard.press('Tab');
  if (!(await state(input)).focus) { via = 'script'; await page.keyboard.press('Shift'); await page.locator(input).focus(); }
  await sleep(200);
  await take('focus', SEARCH_SPECS, input, { hover: false, focus: true, focusVisible: true, value: '' });
  out.focus.via = via;
  await page.keyboard.type('web', { delay: 40 });
  await sleep(500);
  await take('typed', SEARCH_SPECS, input, { hover: false, focus: true, value: 'web' });

  // is a native clear button drawn? The field with and without text, focused, the pointer at its right end: any pixel that differs in the right 32 px is a drawn button.
  // The control removes the mock's own `appearance: none` rule (base.css) and measures again: a test that sees nothing there is blind, not right.
  const native = await page.evaluate((sel) => {
    const i = document.querySelector(sel);
    const pc = getComputedStyle(i, '::-webkit-search-cancel-button');
    const pd = getComputedStyle(i, '::-webkit-search-decoration');
    return { cancel: { display: pc.display, appearance: pc.appearance || pc.webkitAppearance || '' }, decoration: { display: pd.display, appearance: pd.appearance || pd.webkitAppearance || '' }, appearance: getComputedStyle(i).appearance };
  }, input);
  const shot = async () => (await page.locator('#probe-plain .search').screenshot()).toString('base64');
  const clearProbe = async () => {
    await page.locator(input).focus();
    const b = await page.locator(input).boundingBox();
    await page.mouse.move(b.x + b.width - 12, b.y + b.height / 2, { steps: 2 });
    await sleep(250);
    await page.evaluate((sel) => { document.querySelector(sel).value = 'web'; }, input);
    const withText = await shot();
    await page.evaluate((sel) => { document.querySelector(sel).value = ''; }, input);
    const without = await shot();
    await page.evaluate((sel) => { document.querySelector(sel).value = 'web'; }, input);
    return page.evaluate(comparePng, { a: withText, c: without });
  };
  native.drawn = await clearProbe();
  out.native = native;
  await page.mouse.move(1, 1);

  // Escape in the focused field with text in it
  await page.evaluate((sel) => {
    const i = document.querySelector(sel);
    i.focus();
    window.__esc = { input: 0, search: 0, prevented: null };
    i.addEventListener('input', () => { window.__esc.input += 1; });
    i.addEventListener('search', () => { window.__esc.search += 1; });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc.prevented = e.defaultPrevented; });
  }, input);
  await sleep(150);
  await page.keyboard.press('Escape');
  await sleep(400);
  out.escape = await page.evaluate((sel) => { const i = document.querySelector(sel); return { valueAfter: i.value, focusKept: document.activeElement === i, ...window.__esc }; }, input);

  // the found variant: the count lane inside the field, at rest and typed
  await pointerAway(page);
  await take('found', FOUND_SPECS, '#probe-found .search > input', { hover: false, focus: false, value: '' });
  await page.keyboard.press('Shift');
  await page.locator('#probe-found .search > input').focus();
  await page.keyboard.type('web', { delay: 40 });
  await sleep(500);
  await take('foundTyped', FOUND_SPECS, '#probe-found .search > input', { hover: false, focus: true, value: 'web' });
  const removed = await page.evaluate(() => {
    let n = 0;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i -= 1) if (/webkit-search-(cancel-button|decoration)/.test(rules[i].selectorText ?? '')) { sheet.deleteRule(i); n += 1; }
    }
    return n;
  });
  out.native.control = { rulesRemoved: removed, ...(await clearProbe()) };
  if (removed !== 1 || out.native.control.inRightStrip === 0) fail(label, `the native clear-button test is blind: ${JSON.stringify(out.native.control)}`);
  await context.close();
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The run.                                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const HEADER_IDS = Object.keys(HEADERS);
const STATE_IDS = Object.keys(STATES);
const CASES = [
  { section: 'list', id: 'list' },
  { section: 'listNarrow', id: 'listNarrow' },
  ...HEADER_IDS.map((id) => ({ section: 'header', id })),
  { section: 'slot', id: 'slot' },
  ...STATE_IDS.map((id) => ({ section: 'states', id })),
  { section: 'search', id: 'search' },
].filter((c) => !only || only.test(c.section) || only.test(c.id));

async function runCase(browser, engineName, vpName, c) {
  const viewport = VIEWPORTS[vpName];
  const label = `${engineName}/${vpName}/${c.id}`;
  if (c.section === 'list') return listCase(browser, engineName, vpName, viewport, false, label);
  if (c.section === 'listNarrow') return listCase(browser, engineName, vpName, viewport, true, label);
  if (c.section === 'header') return headerCase(browser, vpName, viewport, c.id, label);
  if (c.section === 'slot') return slotCase(browser, vpName, viewport, label);
  if (c.section === 'states') return stateCase(browser, vpName, viewport, c.id, label);
  return searchCase(browser, vpName, viewport, label);
}

const raw = {}; // section -> id -> viewport -> engine -> record
const versions = {};
let tokens = {};

async function job(engineName, vpName) {
  const browser = await ENGINES[engineName].launch();
  versions[engineName] = browser.version();
  const t = Date.now();
  for (const c of CASES) {
    const label = `${engineName}/${vpName}/${c.id}`;
    try {
      const rec = await runCase(browser, engineName, vpName, c);
      (((raw[c.section] ??= {})[c.id] ??= {})[vpName] ??= {})[engineName] = rec;
    } catch (error) {
      fail(label, `${error.message.split('\n')[0]}`);
    }
  }
  if (CASES.length && engineName === engineFilter[0] && vpName === viewportFilter[0]) {
    const { page, context } = await loadMock(browser, VIEWPORTS[vpName], `${engineName}/${vpName}/tokens`);
    tokens = await page.evaluate(() => window.__pm.tokens());
    await context.close();
  }
  await browser.close();
  console.log(`${engineName} ${vpName}: ${CASES.length} cases in ${((Date.now() - t) / 1000).toFixed(0)}s`);
}

async function measureAll() {
  const jobs = engineFilter.flatMap((e) => viewportFilter.map((v) => [e, v]));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, async () => {
    while (next < jobs.length) { const [e, v] = jobs[next]; next += 1; await job(e, v); }
  }));
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Reducing: styles once by id, the WebKit record, and where Chromium differs.                                                      */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const isLeafArray = (v) => Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object');
const flatten = (v, p, out = {}) => {
  if (isLeafArray(v)) out[p] = v;
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) flatten(x, p ? `${p}.${k}` : k, out);
  else out[p] = v;
  return out;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (p, a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= TOL;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const idx = /\.xr$/.test(p) ? [0, 2] : a.map((_, i) => i); // a text range's y and height are the engine's text box, not geometry
    return idx.every((i) => near(`${p}.${i}`, a[i], b[i]));
  }
  return same(a, b);
};
const hash6 = (s, n) => createHash('sha1').update(s).digest('hex').slice(0, n);
const styles = {};
const styleId = (x) => {
  const key = JSON.stringify(Object.fromEntries(Object.entries(x).sort()));
  let id = `S${hash6(key, 4)}`;
  for (let n = 5; styles[id] && JSON.stringify(styles[id]) !== key; n += 1) id = `S${hash6(key, n)}`; // a collision takes a longer id
  styles[id] = JSON.parse(key);
  return id;
};
const intern = (v) => {
  if (Array.isArray(v)) return v.map(intern);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = k === 's' && x && typeof x === 'object' && !Array.isArray(x) ? styleId(x) : intern(x);
  return out;
};
const getPath = (root, p) => p.split('.').reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), root);
function setPath(root, p, value) {
  const parts = p.split('.');
  let node = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (node[key] === undefined || node[key] === null) node[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    node = node[key];
  }
  const last = parts[parts.length - 1];
  if (value && typeof value === 'object' && !Array.isArray(value) && value.$ === 'removed') { if (Array.isArray(node)) node.splice(Number(last), 1); else delete node[last]; } else node[last] = value;
}
/** The WebKit record of an entry with the Chromium differences applied (engine 'chromium'), or the record itself. */
export function expandEntry(entry, engine = 'webkit') {
  const rec = structuredClone(entry.webkit);
  if (engine !== 'webkit') for (const [p, v] of Object.entries(entry[engine] ?? {})) setPath(rec, p, v);
  return rec;
}
/** The paths where record b differs from record a by more than TOL, with b's value (a path b lacks is { $: 'removed' }). */
function diffRecords(a, b) {
  const fa = flatten(a, '');
  const fb = flatten(b, '');
  const out = {};
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (fb[k] === undefined) out[k] = { $: 'removed' };
    else if (fa[k] === undefined || !near(k, fa[k], fb[k])) out[k] = fb[k];
  }
  return out;
}

function reduceCase(perViewportEngine) {
  const out = {};
  const engineDifferences = [];
  for (const [vp, perEngine] of Object.entries(perViewportEngine)) {
    const [e0, ...others] = engineFilter.filter((e) => perEngine[e]);
    if (!e0) continue;
    const entry = { [e0]: intern(perEngine[e0]) };
    for (const e of others) {
      const diff = diffRecords(entry[e0], intern(perEngine[e]));
      if (Object.keys(diff).length) { entry[e] = diff; engineDifferences.push(...Object.keys(diff).map((p) => `${vp} ${p}`)); }
    }
    out[vp] = entry;
  }
  return { out, engineDifferences };
}

/** How far each phase moved the parts of the header from where they were at rest: [dx, dy, dw, dh], or 0 when nothing moved. */
function slotDeltas(phases) {
  const rest = phases.rest;
  const out = {};
  for (const [phase, rec] of Object.entries(phases)) {
    if (phase === 'rest') continue;
    const d = (name) => {
      const delta = rec[name].r.map((v, i) => Math.round((v - rest[name].r[i]) * 100) / 100);
      return delta.every((v) => v === 0) ? 0 : delta;
    };
    out[phase] = { header: d('header'), title: d('title'), meta: d('meta'), commands: d('commands'), next: d('next') };
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The facts the chrome must reproduce, each checked against the measurement.                                                       */
/* ------------------------------------------------------------------------------------------------------------------------------ */

function expectations(reduced) {
  const checks = [];
  const check = (fact, expected, got) => checks.push({ fact, expected: expected ?? null, got: got ?? null, ok: same(expected ?? null, got ?? null) });
  const at = (entry, vp) => entry?.[vp]?.webkit;
  for (const vp of viewportFilter) {
    const list = at(reduced.list, vp);
    if (list) {
      const tag = `list ${vp}`;
      check(`${tag}: the header is one 28px row`, 28, list.header.r[3]);
      check(`${tag}: 12px from the header to the quick filters`, 12, Math.round((list.quick.r[1] - (list.header.r[1] + list.header.r[3])) * 100) / 100);
      check(`${tag}: 8px from the quick filters to the toolbar`, 8, Math.round((list.toolbar.r[1] - (list.quick.r[1] + list.quick.r[3])) * 100) / 100);
      check(`${tag}: 8px from the toolbar to the body`, 8, Math.round((list.dvBody.r[1] - (list.toolbar.r[1] + list.toolbar.r[3])) * 100) / 100);
      check(`${tag}: the footer lane is 33px`, 33, list.dvFooter.r[3]);
    }
    for (const id of HEADER_IDS) {
      const h = at(reduced.header?.[id], vp);
      if (!h) continue;
      check(`${id} ${vp}: 12px from the header to the next block`, 12, h.d.gapToNext);
    }
    const detail = at(reduced.header?.['h-detail'], vp);
    if (detail) {
      check(`h-detail ${vp}: breadcrumb 16px, title row 28px, identity line 28px`, [16, 28, 28], [detail.breadcrumb.r[3], detail.title.r[3], detail.meta.r[3]]);
      check(`h-detail ${vp}: header is 84px (16 + 8 + 28 + 4 + 28)`, 84, detail.header.r[3]);
    }
    const note = at(reduced.header?.['h-note'], vp);
    if (note) check(`h-note ${vp}: the step line is 16px`, 16, note.meta.r[3]);
    const slot = at(reduced.slot, vp);
    if (slot) {
      const rest = slot.rest;
      const wide = Number(vp.split('x')[0]) >= 1440;
      check(`slot ${vp}: no width at rest, 28px high`, [0, 28], [rest.slot.r[2], rest.slot.r[3]]);
      for (const [phase, rec] of Object.entries(slot)) {
        if (phase === 'rest') continue;
        const moved = reduced.slot[vp].deltas[phase];
        check(`slot ${vp}/${phase}: header, title, identity line, commands and the block below do not move`, { header: 0, title: 0, meta: 0, commands: 0, next: 0 }, moved);
        if (phase === 'restAgain') continue;
        check(`slot ${vp}/${phase}: the slot is 28px high and ${wide ? '480px wide (the page is 1000px or more)' : 'takes the line the facts leave'}`, wide ? [480, 28] : [Math.round((rest.meta.r[0] + rest.meta.r[2] - rest.facts.r[0]) * 100) / 100, 28], [rec.slot.r[2], rec.slot.r[3]]);
        check(`slot ${vp}/${phase}: the facts ${wide ? 'stay' : 'give way (display: none) while the operation shows'}`, wide ? rest.facts.r : [0, 0, 0, 0], rec.facts.r);
      }
    }
    const search = at(reduced.search, vp);
    if (search) {
      check(`search ${vp}: the field is 28px high, the icon 16px, 9px from the left edge`, [28, 16, 9], [search.rest.field.r[3], search.rest.icon.r[2], search.rest.icon.r[0] - search.rest.field.r[0]]);
      check(`search ${vp}: a keyboard focus is a 2px outline`, '2px', search.focus.input.s && styles[search.focus.input.s].outline?.split(' ')[0]);
      check(`search ${vp}: the found lane is 100px wide, inside the field`, 100, search.found.count.r[2]);
    }
    const loading = at(reduced.states?.['s-loading'], vp);
    if (loading) check(`s-loading ${vp}: the skeleton header row is 25px, a row 24px`, [25, 24], [loading.skHeadRow.r[3], loading.skRow0.r[3]]);
    const ready = at(reduced.states?.['s-ready'], vp);
    if (ready) check(`s-ready ${vp}: the header slot is 72px (28 + 8 + 28 + 8) and the footer 33px`, [72, 33], [ready.dvHeader.r[3], ready.dvFooter.r[3]]);
  }
  return checks;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Report.                                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------------------------ */

async function main() {
  const t0 = Date.now();
  if (FROM_RAW) Object.assign(raw, JSON.parse(readFileSync(path.join(FROM_RAW, 'mock-page.raw.json'), 'utf8')));
  else await measureAll();
  if (RAW && !FROM_RAW) writeFileSync(path.join(RAW, 'mock-page.raw.json'), JSON.stringify(raw));

  const reduced = {};
  const differences = {};
  for (const [section, byId] of Object.entries(raw)) {
    const single = ['list', 'listNarrow', 'slot', 'search'].includes(section);
    reduced[section] = {};
    for (const [id, perViewportEngine] of Object.entries(byId)) {
      const { out, engineDifferences } = reduceCase(perViewportEngine);
      if (single) reduced[section] = out;
      else reduced[section][id] = out;
      differences[`${section}/${id}`] = engineDifferences.length;
    }
  }
  // the slot: how far each phase moved the header, in every engine (the anchor's are stored)
  for (const [vp, entry] of Object.entries(reduced.slot ?? {})) {
    const perEngine = raw.slot.slot[vp];
    const [e0, ...others] = engineFilter.filter((e) => perEngine[e]);
    entry.deltas = slotDeltas(perEngine[e0]);
    for (const e of others) if (!same(entry.deltas, slotDeltas(perEngine[e]))) fail(`slot ${vp}`, `${e} moves the header differently from ${e0}`);
  }
  const checks = expectations(reduced);
  const colors = new Set();
  for (const s of Object.values(styles)) for (const [k, v] of Object.entries(s)) if (/^(color|bg|bT|bR|bB|bL|outline)$/.test(k)) for (const m of String(v).match(/rgba?\([^)]*\)/g) ?? []) colors.add(m);
  const colorTokens = {};
  for (const c of colors) {
    const names = Object.entries(tokens).filter(([, v]) => v === c).map(([n]) => n).sort();
    if (names.length) colorTokens[c] = names;
  }
  const out = {
    meta: {
      mockTree: MOCK_TREE,
      tag: MOCK_TAG,
      measuredAt: new Date().toISOString(),
      engines: engineFilter,
      engineVersions: versions,
      viewports: viewportFilter,
      font: 'Helvetica, Arial, sans-serif',
      theme: 'default (no data-theme attribute), default text size and density',
      engineDifferences: differences,
      pageErrors: Object.fromEntries(Object.entries(pageErrors).filter(([, v]) => v.length).map(([k, v]) => [k, [...new Set(v)].slice(0, 6)])),
      failures,
      notes: [
        'Rects are absolute CSS px (nothing scrolls: viewport = page). The font is normalized to Helvetica, Arial: widths are not Inter widths. The Pods list field is .data-view__header > .toolbar > .search: a bare .search matches the rail field and the picker popups first.',
        'D: the table has 6 columns = Name (two lines), Ready, Status, Restarts, Age and the trailing Inspect column; H.collectionState needs an id. B: h-note keeps the breadcrumb of a flow header. C: a delta is from the rest phase; each terminal phase is measured within 5 s (a calm sentence clears after 8 s).',
        'listNarrow at 1030 is the default set: the footer says "2 columns hidden at this width" there (list and listNarrow alike); at 1440 the unticked set has no note.',
      ],
      surprises: [
        'h-detail-long at 1030: the facts box is 585 px and the facts need 642: fact 3 is hard-clipped with no ellipsis, fact 4 has width 0 (cut) and its dot lies outside the box; the 60-character title does not clip at either width.',
        's-error (no rows): no footer element at all, and the data view is 12 px shorter (759 against 771): the pane keeps its 12 px bottom padding when there is no footer.',
        'Search: no hover paint; focus darkens the border (rgb(25, 26, 28)) and adds a 2px outline; Escape clears natively in Chromium (input and search events) and does nothing in WebKit; the computed cursor is text in Chromium and auto in WebKit; no native clear button is drawn in either engine (the control without the appearance rule draws one).',
        'Slot: paused shows Cancel and an overflow (Resume only inside it); cancelled shows Retry and Dismiss; a failure sentence clamps to two lines (32 px text box in the 28 px cell); under 1000 px of page width the facts are display: none while an operation shows.',
        'The mock logs a 404 for /native/host.js on every load (meta.pageErrors).',
      ],
    },
    styles,
    colorTokens,
    checks: { held: checks.filter((c) => c.ok).length, of: checks.length, failing: checks.filter((c) => !c.ok) },
    ...reduced,
  };
  const json = JSON.stringify(out);
  const file = writeOut ? path.join(here, 'mock-page.json') : path.join(RAW ?? FROM_RAW ?? here, 'mock-page.partial.json');
  writeFileSync(file, json);
  const bytes = Buffer.byteLength(json);
  console.log(`file: ${file}  ${(bytes / 1024).toFixed(1)} KB (limit ${MAX_BYTES / 1024})  styles ${Object.keys(styles).length}  total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`engine differences > ${TOL} px (paths): ${Object.entries(differences).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`checks: ${out.checks.held}/${out.checks.of} hold`);
  for (const c of out.checks.failing) console.log(`  FAILS ${c.fact}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.got)}`);
  console.log(`failures: ${failures.length ? '' : 'none'}`);
  for (const f of failures) console.log(`  ${f}`);
  if (writeOut && bytes > MAX_BYTES) { console.log(`TOO BIG: ${bytes} bytes`); process.exitCode = 1; }
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

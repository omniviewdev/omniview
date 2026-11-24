// Measures the design mock's Problems and Operations tools (the bottom panel's two table tools): the REFERENCE the shell's real tools are built to (step PT1).
//
// Per engine (webkit, chromium) and viewport (1440x900, 1280x800), every scene in a FRESH page of the mock's start screen (default theme and density, font normalized as mock-panel-measure.mjs does):
//   - problems-empty:         Shell.panel.show('problems'), no condition, every plugin healthy.
//   - problems-rows:          seven neutral conditions through Shell.condition (plugins `alpha` and `beta`, which the mock names Alpha and Beta): errors, warnings, an info, a long target, no target, a row whose Open works
//                             and rows whose Open is disabled; plus the plugin-health condition the mock itself raises when Shell.plugins.report marks `flux` failed (the mock has no neutral plugin: Flux is one of its own).
//   - problems-filtered-none: the same kind of data (two errors and a warning) with the severity filter on Info, so no row matches.
//   - operations-empty:       Shell.panel.show('operations'), no operation.
//   - operations-rows:        nine operations through Shell.ops.begin (sources `alpha` and `beta`): running determinate ({current:6,total:14,unit:'jobs'}), running indeterminate, running with steps (2 of 5), queued,
//                             paused, succeeded, failed (with a message), cancelled and unknown; some with a target label, one without; CSS animations and transitions are frozen before measuring.
//   - tab-badges:             the tool strip in five states of one page: Problems with a count (2 errors), Problems with only warnings (a dot and its dotLabel), Operations with an error dot, Operations with a warning dot, none.
// The page is the mock's own start screen with no plugin screen opened, so the panel offers the host's five tools.
//
// Serve: the script serves the mock itself (MOCK_DIR, default the lab's frontend/mock) from a CommonJS copy of its server.js on a port the OS gave (never a fixed one: other agents serve the mock too). It keeps the pid of the
// server it started and kills exactly that pid, and closes every browser, in `finally`. Before any measurement or write it verifies the served mock against the git tree MOCK_TREE blob by blob (verifyMock); a
// different, partial or unverifiable mock stops the run with nothing written.
// Run:  node ui-next/shell/probes/mock-problems-operations-measure.mjs
// Writes mock-problems-operations.json (one line of compact JSON) and the screenshots mock-<scene>-<engine>-<viewport>.png in SHOTS (the environment's; by default a new directory in the temp directory, which the run names at its end).
// Exits non-zero when a scene misses its panel or rows, its empty state or its footer (the JSON is then written to the temp directory, not here, as mock-problems-operations.failed.json: the diagnostic is written for such a scene too).
//
// mock-problems-operations.json: { mockTree, viewports, load, note, words, data, facts }
//   data:  { <engine>: { <viewport>: { <scene>: reading } } }, reading: see READ. tab-badges: { states: { <state>: strip } }, strip: see STRIP.
//   facts: { <engine>: { <scene>: { role, aria-* and data-key facts the shell side asserts on } } }  (read at 1440x900; identical in both engines it is stored once under `both`)
//   words: the words the mock prints (empty titles and hints, footer counts, status words, tab dot labels), read from the page.
// reading (rectangles [x, y, w, h], viewport px, 0.01; null when absent or not laid out):
//   { viewport, tool, panelState, panel, header, tablist, tabs: [{ key, selected, tab, icon, label, count: { rect, text } | null, dot: { rect, tone } | null, hidden, text }], actions: [{ label, rect }],
//     body, content, rail: { rect, buttons: [{ label, rect, pressed, disabled }] }, dataView, dvHeader, filters: { group, seg: { rect, buttons }, select, search } | null, dvBody, scroll: { top, client, height },
//     table, headRow, ths: [{ rect, text, sort }], rows: { total, visible, first, last, items: [{ key, rect, cells, state, bar, actions }] }, firstRow: { rect, tds: [{ rect, text }] } | null,
//     footer: { rect, count: { rect, text } } | null, empty: { rect, icon, title, hint, actions } | null,
//     paint: { <part>: { color, backgroundColor, border, fontFamily, fontSize, fontWeight, lineHeight, borderRadius, opacity } } }
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { loadavg, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
const SHOTS = process.env.SHOTS ?? mkdtempSync(path.join(tmpdir(), 'mock-po-shots-'));
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const SCENES = ['problems-empty', 'problems-rows', 'problems-filtered-none', 'operations-empty', 'operations-rows', 'tab-badges'];
const BADGE_STATES = ['count-errors', 'dot-warnings', 'ops-error', 'ops-warning', 'none'];
const started = Date.now();
const load = loadavg();

/** A port the OS gave and nobody holds now. */
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

let server = null;
async function serve() {
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-po-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  const port = await freePort();
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/`;
  // Ready when it answers (no fixed sleep).
  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode !== null) throw new Error(`the mock server exited with ${server.exitCode}`);
    try { if ((await fetch(base)).ok) return base; } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the mock server did not answer at ${base}`);
}

/**
 * Proves the mock served at `base` is the git tree MOCK_TREE, file by file (the git blob id of each response body against the tree's). The numbers are written under that tree's id, so a mock of another revision
 * must never supply them. Throws when the tree cannot be read (unverifiable) or any file is missing or different; lists at most three differences.
 */
async function verifyMock(base) {
  let listing;
  try {
    // --full-tree: MOCK_DIR is a subdirectory of the lab's checkout; without it ls-tree lists only the entries under the working directory.
    listing = execFileSync('git', ['-C', MOCK_DIR, 'ls-tree', '-r', '-z', '--full-tree', MOCK_TREE], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`the mock at ${base} is unverifiable: cannot read the tree ${MOCK_TREE} with git in ${MOCK_DIR} (${String(error.stderr || error.message).trim()})`);
  }
  const files = listing.split('\0').filter(Boolean).map((entry) => {
    const [meta, file] = [entry.slice(0, entry.indexOf('\t')).split(' '), entry.slice(entry.indexOf('\t') + 1)];
    return { mode: meta[0], type: meta[1], id: meta[2], file };
  });
  if (files.length === 0 || files.some((f) => f.type !== 'blob' || f.mode === '120000')) throw new Error(`the mock at ${base} is unverifiable: the tree ${MOCK_TREE} is empty or holds a symlink or submodule`);
  const differences = [];
  const check = async ({ id, file }) => {
    let reason;
    try {
      const response = await fetch(new URL(file.split('/').map(encodeURIComponent).join('/'), base));
      if (!response.ok) reason = `HTTP ${response.status}`;
      else {
        const body = Buffer.from(await response.arrayBuffer());
        const got = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
        if (got !== id) reason = `differs (blob ${got}, the tree has ${id})`;
      }
    } catch (error) {
      reason = `cannot be fetched (${error.message})`;
    }
    if (reason !== undefined) differences.push(`${file} ${reason}`);
  };
  const queue = [...files];
  await Promise.all(Array.from({ length: 16 }, async () => { for (let next = queue.shift(); next !== undefined; next = queue.shift()) await check(next); }));
  if (differences.length > 0) {
    differences.sort();
    throw new Error(`the mock at ${base} is not the tree ${MOCK_TREE}: ${differences.slice(0, 3).join('; ')}${differences.length > 3 ? ` (and ${differences.length - 3} more)` : ''}`);
  }
  return files.length;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// In-page readers (strings, run with page.evaluate).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const HELPERS = `
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => { if (!el || el.getClientRects().length === 0) return null; const b = el.getBoundingClientRect(); return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)]; };
  const text = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : null);
  const P = document.getElementById('shell-panel');
  const V = P ? P.querySelector('.panel__view:not([hidden])') : null;
  const q = (s, root = V) => (root ? root.querySelector(s) : null);
  const qa = (s, root = V) => (root ? [...root.querySelectorAll(s)] : []);
  const key = (k) => (k == null ? k : String(k).replace(/op-[0-9a-f]+/, 'op-ID'));
  const PROPS = (el) => {
    const cs = getComputedStyle(el);
    const side = (s) => cs['border' + s + 'Width'] + ' ' + cs['border' + s + 'Style'] + ' ' + cs['border' + s + 'Color'];
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map(side);
    return {
      color: cs.color, backgroundColor: cs.backgroundColor,
      border: sides.every((s) => s === sides[0]) ? sides[0] : { top: sides[0], right: sides[1], bottom: sides[2], left: sides[3] },
      fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, borderRadius: cs.borderTopLeftRadius === cs.borderBottomRightRadius ? cs.borderTopLeftRadius : cs.borderRadius, opacity: cs.opacity,
    };
  };
  const tabReading = (t) => {
    const count = t.querySelector('.count'), dot = t.querySelector('.toolheader__dot'), hidden = t.querySelector('.visually-hidden');
    return {
      key: t.getAttribute('data-key'), selected: t.getAttribute('aria-selected') === 'true', tab: rect(t), icon: rect(t.querySelector('.ic')), label: rect(t.querySelector('.toolheader__tablabel')),
      count: count ? { rect: rect(count), text: count.textContent } : null,
      dot: dot ? { rect: rect(dot), tone: dot.getAttribute('data-tone') } : null,
      hidden: hidden ? { rect: rect(hidden), text: hidden.textContent } : null,
      text: text(t),
    };
  };
  const stripPaint = () => {
    const out = {}, put = (name, el) => { if (el) out[name] = PROPS(el); };
    const tabs = qa('.toolheader__tablist > [role=tab]', P);
    put('toolTabSelected', tabs.find((t) => t.getAttribute('aria-selected') === 'true'));
    put('toolTabOther', tabs.find((t) => t.getAttribute('aria-selected') === 'false'));
    put('countPill', q('.toolheader__tab .count', P));
    put('dotError', q('.toolheader__dot[data-tone="error"]', P));
    put('dotWarning', q('.toolheader__dot[data-tone="warning"]', P));
    put('tablist', q('.toolheader__tablist', P));
    put('header', q('.panel__header', P));
    put('panel', P);
    return out;
  };
`;

/** The strip alone (the tab-badges states): the panel, the header, the tabs with their badge parts and their paint. */
const STRIP = `(() => {
  ${HELPERS}
  return {
    viewport: [innerWidth, innerHeight], panel: rect(P), header: rect(q('.panel__header', P)), tablist: rect(q('.toolheader__tablist', P)),
    tabs: qa('.toolheader__tablist > [role=tab]', P).map(tabReading),
    actions: qa('.toolheader__actions button', P).map((b) => ({ label: b.getAttribute('aria-label'), rect: rect(b) })),
    paint: stripPaint(),
  };
})()`;

const READ = `(() => {
  ${HELPERS}
  const sc = q('.data-view__body');
  const scRect = sc ? sc.getBoundingClientRect() : null;
  const bodyRows = qa('.data-view tbody > tr');
  const inView = (el) => { if (!scRect) return false; const b = el.getBoundingClientRect(); return b.top >= scRect.top - 0.5 && b.bottom <= scRect.bottom + 0.5; };
  const visible = bodyRows.filter(inView);
  const stateOf = (cell) => {
    const s = cell ? cell.querySelector('.resource-state') : null;
    if (!s) return null;
    return { kind: s.getAttribute('data-state-kind'), tone: s.getAttribute('data-state-tone'), busy: s.classList.contains('resource-state--busy'), word: text(s.querySelector('.resource-state__label')), box: rect(s), glyph: rect(s.querySelector('.resource-state__icon')), glyphSvg: rect(s.querySelector('.resource-state__icon svg')), label: rect(s.querySelector('.resource-state__label')) };
  };
  const barOf = (tr) => {
    const m = tr.querySelector('.cell-measure');
    return m ? { measure: rect(m), viz: rect(m.querySelector('.cell-viz')), track: rect(m.querySelector('.micro-bar')), fill: rect(m.querySelector('.micro-bar__fill')), value: m.querySelector('.micro-bar__fill')?.style.getPropertyValue('--bar-value') ?? null, text: text(m.querySelector('.cell-measure__value')), textRect: rect(m.querySelector('.cell-measure__value')) } : null;
  };
  const overflowOf = (td) => {
    const cs = getComputedStyle(td), right = td.getBoundingClientRect().right - parseFloat(cs.paddingRight), kinds = new Set();
    for (const el of [td, ...td.querySelectorAll('.pclip, .cell-measure, .cell-measure__value, .resource-state, .resource-state__label')]) {
      if (el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 0.5) kinds.add('ellipsis');
      else if (el !== td && el.getBoundingClientRect().right > right + 0.5) kinds.add('spill');
    }
    return [...kinds];
  };
  const rowOf = (tr) => {
    const tds = [...tr.children];
    return {
      key: key(tr.getAttribute('data-key')), rect: rect(tr), cells: tds.map(text),
      state: stateOf(tds.find((td) => td.querySelector('.resource-state'))), bar: barOf(tr),
      actions: [...tr.querySelectorAll('.pact button')].map((b) => ({ label: b.getAttribute('aria-label'), rect: rect(b), disabled: b.getAttribute('aria-disabled') === 'true' })),
      overflow: tds.map((td, cell) => ({ cell, kinds: overflowOf(td) })).filter((o) => o.kinds.length > 0),
    };
  };
  const first = bodyRows[0] ?? null;
  const filters = q('.ptool__filters');
  const empty = q('.panel__empty');
  const footer = q('.data-view__footer');
  const empty2 = q('.empty2');
  const paint = {}, put = (name, el) => { if (el) paint[name] = PROPS(el); };
  Object.assign(paint, stripPaint());
  put('content', q('.panel__content')); put('rail', q('.panel__tools')); put('railButton', q('.panel__tools button'));
  put('dataView', q('.data-view')); put('dvHeader', q('.data-view__header')); put('dvBody', sc); put('table', q('.data-view table'));
  put('thead', q('.data-view thead')); put('headRow', q('.data-view thead tr')); put('th', q('.data-view thead th')); put('thLast', [...qa('.data-view thead th')].at(-1)); put('thSort', q('.data-view thead .table-sort'));
  put('rowRest', first); put('rowRestFirstCell', first?.children[0]); put('rowRestLastCell', first?.lastElementChild);
  if (bodyRows.length > 1) { put('rowRestSecond', bodyRows[1]); put('rowRestSecondFirstCell', bodyRows[1].children[0]); }
  put('pclip', q('.data-view tbody .pclip')); put('dim', q('.data-view tbody .dim')); put('since', q('.data-view tbody td .pclip')?.closest('td')?.nextElementSibling?.nextElementSibling);
  const seen = new Set();
  for (const s of qa('.data-view tbody .resource-state')) {
    const name = 'status-' + s.getAttribute('data-state-kind') + '-' + s.getAttribute('data-state-tone');
    if (seen.has(name)) continue;
    seen.add(name);
    paint[name] = { box: PROPS(s), icon: PROPS(s.querySelector('.resource-state__icon')), glyph: PROPS(s.querySelector('.resource-state__icon .ic')), label: PROPS(s.querySelector('.resource-state__label')), word: text(s.querySelector('.resource-state__label')) };
  }
  put('barMeasure', q('.cell-measure')); put('barTrack', q('.micro-bar')); put('barFill', q('.micro-bar__fill')); put('barText', q('.cell-measure__value'));
  put('rowAction', q('.data-view tbody .pact button'));
  put('footer', footer); put('footerCount', q('.collection-count')); put('footerCluster', q('.footer-cluster'));
  put('emptyBox', empty); put('emptyIcon', q('.empty2 .bigicon')); put('emptyIconSvg', q('.empty2 .bigicon .ic')); put('emptyTitle', q('.empty2 b')); put('emptyHint', q('.empty2 .tiny')); put('emptyAction', q('.panel__actions button'));
  put('segActive', q('.seg button.active')); put('segIdle', q('.seg button:not(.active)')); put('seg', q('.seg')); put('select', q('.ptool__filters select')); put('search', q('.search')); put('searchInput', q('.search input'));
  return {
    viewport: [innerWidth, innerHeight], tool: V ? V.getAttribute('data-tool') : null, panelState: Shell.panel.state(),
    panel: rect(P), header: rect(q('.panel__header', P)), tablist: rect(q('.toolheader__tablist', P)),
    tabs: qa('.toolheader__tablist > [role=tab]', P).map(tabReading),
    actions: qa('.toolheader__actions button', P).map((b) => ({ label: b.getAttribute('aria-label'), rect: rect(b) })),
    body: rect(q('.panel__body', P)), content: rect(q('.panel__content')),
    rail: { rect: rect(q('.panel__tools')), buttons: qa('.panel__tools button').map((b) => ({ label: b.getAttribute('aria-label'), rect: rect(b), pressed: b.getAttribute('aria-pressed'), disabled: b.getAttribute('aria-disabled') === 'true' })) },
    dataView: rect(q('.data-view')), dvHeader: rect(q('.data-view__header')),
    filters: filters ? {
      group: rect(filters),
      seg: { rect: rect(q('.seg')), buttons: qa('.seg button').map((b) => ({ text: text(b), rect: rect(b), checked: b.getAttribute('aria-checked') === 'true' })) },
      select: { rect: rect(q('.ptool__filters select')), text: text(q('.ptool__filters select option:checked')), options: qa('.ptool__filters select option').map(text) },
      search: q('.search') ? { rect: rect(q('.search')), icon: rect(q('.search .ic')), input: rect(q('.search input')), placeholder: q('.search input').getAttribute('placeholder') } : null,
    } : null,
    dvBody: rect(sc), scroll: sc ? { top: r2(sc.scrollTop), client: sc.clientHeight, height: sc.scrollHeight } : null,
    tablewrap: rect(q('.tablewrap')), table: rect(q('.data-view table')), headRow: rect(q('.data-view thead tr')),
    ths: qa('.data-view thead th').map((th) => ({ rect: rect(th), text: text(th), sort: th.getAttribute('aria-sort') })),
    rows: { total: bodyRows.length, visible: visible.length, first: rect(visible[0]), last: rect(visible.at(-1)), items: bodyRows.map(rowOf) },
    firstRow: first ? { rect: rect(first), tds: [...first.children].map((td) => ({ rect: rect(td), text: text(td) })) } : null,
    footer: footer ? { rect: rect(footer), count: { rect: rect(q('.collection-count')), text: text(q('.collection-count')) }, text: text(footer) } : null,
    empty: empty ? { rect: rect(empty), icon: rect(q('.empty2 .bigicon')), iconSvg: rect(q('.empty2 .bigicon svg')), title: { rect: rect(q('.empty2 b')), text: text(q('.empty2 b')) }, hint: { rect: rect(q('.empty2 .tiny')), text: text(q('.empty2 .tiny')) }, actions: qa('.panel__actions button').map((b) => ({ text: text(b), rect: rect(b) })) } : null,
    paint,
  };
})()`;

/** The resting facts the shell side asserts on: roles, aria-* and data-key of the tablist, tabs, table, rows, progress bars and row buttons. */
const FACTS = `(() => {
  ${HELPERS}
  const attrs = (el, names) => (el ? Object.fromEntries(names.map((n) => [n, n === 'data-key' ? key(el.getAttribute(n)) : el.getAttribute(n)]).filter(([, v]) => v !== null)) : null);
  const ARIA = ['role', 'aria-label', 'aria-labelledby', 'aria-controls', 'aria-selected', 'aria-checked', 'aria-pressed', 'aria-disabled', 'aria-hidden', 'aria-sort', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-valuetext', 'aria-expanded', 'aria-haspopup', 'aria-orientation', 'tabindex', 'data-key', 'scope'];
  const bodyRows = qa('.data-view tbody > tr');
  return {
    panel: attrs(P, [...ARIA, 'id']), tablist: attrs(q('.toolheader__tablist', P), ARIA),
    tabs: qa('.toolheader__tablist > [role=tab]', P).map((t) => ({ ...attrs(t, ARIA), id: t.id, text: text(t) })),
    tabpanel: attrs(q('.panel__body', P), [...ARIA, 'id']), view: attrs(V, ['data-tool', 'hidden', 'inert']),
    rail: { ...attrs(q('.panel__tools'), ARIA), buttons: qa('.panel__tools button').map((b) => ({ ...attrs(b, ARIA), tooltip: b.getAttribute('data-tooltip'), reason: b.getAttribute('data-tooltip-reason') })) },
    filters: { group: attrs(q('.ptool__filters'), ARIA), seg: attrs(q('.seg'), ARIA), segButtons: qa('.seg button').map((b) => ({ ...attrs(b, ARIA), text: text(b) })), select: attrs(q('.ptool__filters select'), [...ARIA, 'name']), search: attrs(q('.search input'), [...ARIA, 'type', 'placeholder']) },
    scroller: attrs(q('.data-view__body'), ARIA), table: { ...attrs(q('.data-view table'), ARIA), tag: q('.data-view table')?.tagName.toLowerCase() ?? null, className: q('.data-view table')?.className ?? null },
    ths: qa('.data-view thead th').map((th) => ({ ...attrs(th, ARIA), text: text(th), sortButton: th.querySelector('.table-sort')?.getAttribute('data-action') ?? null })),
    rows: bodyRows.map((tr) => ({ ...attrs(tr, ARIA), action: key(tr.getAttribute('data-action')), cls: tr.className.trim() })),
    states: qa('.data-view tbody .resource-state').map((s) => ({ ...attrs(s, ARIA), kind: s.getAttribute('data-state-kind'), tone: s.getAttribute('data-state-tone'), tooltip: s.getAttribute('data-tooltip'), word: text(s) })),
    bars: qa('.data-view tbody .cell-measure').map((m) => ({ measure: attrs(m, ARIA), viz: attrs(m.querySelector('.cell-viz'), ARIA), track: attrs(m.querySelector('.micro-bar'), ARIA), fill: attrs(m.querySelector('.micro-bar__fill'), ARIA), value: attrs(m.querySelector('.cell-measure__value'), ARIA), text: text(m.querySelector('.cell-measure__value')) })),
    dims: qa('.data-view tbody .dim').map((d) => ({ ...attrs(d, ARIA), text: text(d) })),
    rowButtons: qa('.data-view tbody .pact button').map((b) => ({ ...attrs(b, ARIA), tooltip: b.getAttribute('data-tooltip'), reason: b.getAttribute('data-tooltip-reason'), dataIconButton: b.hasAttribute('data-icon-button'), text: text(b) })),
    footer: { ...attrs(q('.footer-cluster'), ARIA), text: text(q('.data-view__footer')) },
    empty: q('.panel__empty') ? { title: text(q('.empty2 b')), hint: text(q('.empty2 .tiny')), buttons: qa('.panel__actions button').map((b) => ({ ...attrs(b, ARIA), text: text(b) })) } : null,
  };
})()`;

const FREEZE = `(() => {
  if (!document.getElementById('probe-freeze')) {
    const style = document.createElement('style');
    style.id = 'probe-freeze';
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.append(style);
  }
  document.getAnimations().forEach((animation) => animation.cancel());
})()`;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

async function open(browser, viewport, base) {
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'load' });
    // The DOM says when the shell is up: its APIs, the panel section and the status bar are there, the fonts are loaded.
    await page.waitForFunction(() => typeof Shell !== 'undefined' && Shell.panel?.show !== undefined && Shell.ops?.begin !== undefined && typeof Shell.condition === 'function' && Shell.plugins?.report !== undefined
      && document.getElementById('shell-panel') !== null && document.querySelector('.statusbar') !== null && document.readyState === 'complete');
    await page.evaluate(() => document.fonts.ready);
    await normalizeFont(page, { rootVar: '--int-font-ui' });
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Resolves when the panel's rectangle is the same on three frames in a row (the open or the redraw has finished). */
const stable = (page) => page.evaluate(() => new Promise((resolve) => {
  const read = () => JSON.stringify([...document.querySelectorAll('#shell-panel, #shell-panel .panel__view:not([hidden]) .panel__content, #shell-panel .toolheader__tablist')].map((el) => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }));
  let last = read(), same = 0;
  const tick = () => { const now = read(); same = now === last ? same + 1 : 0; last = now; if (same >= 3) resolve(true); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}));

const showTool = async (page, tool) => {
  await page.evaluate((id) => { Shell.panel.show(id); }, tool);
  await page.waitForFunction((id) => {
    const view = document.querySelector(`#shell-panel .panel__view:not([hidden])[data-tool="${id}"]`);
    return view !== null && view.querySelector('.panel__content > *') !== null && Shell.panel.state() !== 'hidden';
  }, tool);
  await stable(page);
};

const freeze = async (page) => { await page.evaluate(FREEZE); await stable(page); };

/** The first body row, hovered (the mouse over its centre, `:hover` confirmed by the DOM), then its paint and its action buttons are read. */
async function hoverRow(page) {
  const row = await page.$('#shell-panel .panel__view:not([hidden]) .data-view tbody > tr');
  if (row === null) return null;
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
  await page.waitForFunction(() => document.querySelector('#shell-panel .panel__view:not([hidden]) .data-view tbody > tr')?.matches(':hover') === true);
  const read = await row.evaluate((tr, helpers) => {
    const props = new Function(`${helpers}; return PROPS;`)();
    const r2 = (v) => Math.round(v * 100) / 100;
    const rect = (el) => { if (!el || el.getClientRects().length === 0) return null; const b = el.getBoundingClientRect(); return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)]; };
    return { row: props(tr), firstCell: props(tr.children[0]), lastCell: props(tr.lastElementChild), rect: rect(tr), actions: [...tr.querySelectorAll('.pact button')].map((b) => ({ label: b.getAttribute('aria-label'), rect: rect(b), paint: props(b) })) };
  }, HELPERS);
  await page.mouse.move(1, 1);
  await page.waitForFunction(() => document.querySelector('#shell-panel .panel__view:not([hidden]) .data-view tbody > tr')?.matches(':hover') === false);
  return read;
}

const shot = async (page, scene, engineName, viewportName, clip) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `mock-${scene}-${engineName}-${viewportName}.png`), ...(clip ? { clip } : {}) });
};

/** Conditions for the rows scenes: neutral names only. `alpha` and `beta` are not plugins of the mock; it names a source by its capitalised id (Alpha, Beta). */
const LONG_TARGET = 'a-very-long-target-name-that-keeps-going-until-the-column-has-to-clip-it/with/a/path-segment-0123456789';
const RAW_CONDITIONS = [
  ['c-1', { severity: 'error', title: 'Alpha: sync failed', label: 'Sync failed', target: { label: 'item-alpha-01', destination: { page: 'host/plugins', item: 'flux' } }, source: { plugin: 'alpha' } }],
  ['c-2', { severity: 'error', title: 'Beta: request failed for a long target', label: 'Request failed', target: { label: LONG_TARGET }, source: { plugin: 'beta' } }],
  ['c-3', { severity: 'warning', title: 'Alpha: certificate expires soon', label: 'Expiring', target: { label: 'item-alpha-02' }, source: { plugin: 'alpha' } }],
  ['c-4', { severity: 'warning', title: 'Beta: quota nearly used', source: { plugin: 'beta' } }],
  ['c-5', { severity: 'warning', title: 'Alpha: slow response', label: 'Slow response', target: { label: 'item-alpha-03' }, source: { plugin: 'alpha' } }],
  ['c-6', { severity: 'info', title: 'Beta: update available', label: 'Update available', target: { label: 'item-beta-01' }, source: { plugin: 'beta' } }],
  ['c-7', { severity: 'error', title: 'Beta: connection lost', label: 'Connection lost', target: { label: 'item-beta-02' }, source: { plugin: 'beta' } }],
];

const addConditions = (page, list) => page.evaluate((entries) => { for (const [key, spec] of entries) Shell.condition(key, spec); }, list);

/** The plugin-health condition: Shell.plugins.report marks `flux` failed, the mock's own producer raises `health:flux`. Returns the condition, or null when it did not come. */
async function reportFailedPlugin(page) {
  await page.evaluate(() => { Shell.plugins.report('flux', { service: 'failed', reason: 'The service stopped unexpectedly.', error: 'exit status 1' }); });
  try {
    await page.waitForFunction(() => Shell.condition.list().some((c) => c.key === 'health:flux'), undefined, { timeout: 5000 });
  } catch {
    return null;
  }
  return page.evaluate(() => Shell.condition.list().find((c) => c.key === 'health:flux'));
}

/** Begins the nine operations: the newest active one is the first row (active first, newest first). Returns their ids by state. */
const OPS = async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ids = {};
  const make = async (name, spec, after) => {
    const handle = Shell.ops.begin({ initiator: 'user', ...spec });
    if (after) after(handle);
    ids[name] = handle.id;
    await wait(8);
  };
  const noop = () => undefined;
  await make('succeeded', { title: 'Backed up the item', doneTitle: 'Backed up the item', target: { label: 'item-beta-03' }, source: { plugin: 'beta' }, progress: { current: 3, total: 3, unit: 'files' } }, (h) => h.succeed({ message: 'Done' }));
  await make('failed', { title: 'Syncing the index', target: { label: 'item-alpha-02' }, source: { plugin: 'alpha' }, onRetry: noop }, (h) => h.fail({ message: 'The connection was refused by the upstream' }));
  await make('cancelled', { title: 'Exporting the report', target: { label: 'report-beta' }, source: { plugin: 'beta' }, onCancel: noop }, (h) => h.cancel());
  await make('unknown', { title: 'Applying the change', target: { label: 'item-alpha-04' }, source: { plugin: 'alpha' } }, (h) => h.unknown({ message: 'The result was not confirmed' }));
  await make('paused', { title: 'Uploading the archive', target: { label: 'archive-beta' }, source: { plugin: 'beta' }, progress: { current: 40, total: 100, unit: '%' }, onCancel: noop }, (h) => h.pause({ message: 'Waiting for approval' }));
  await make('queued', { title: 'Scanning the items', target: { label: 'scan-alpha' }, source: { plugin: 'alpha' }, state: 'queued', onCancel: noop });
  await make('steps', { title: 'Provisioning the environment', source: { plugin: 'beta' }, progress: { kind: 'steps', current: 2, total: 5 }, onCancel: noop });
  await make('indeterminate', { title: 'Reindexing the catalogue', target: { label: 'catalogue-alpha' }, source: { plugin: 'alpha' }, progress: 'indeterminate', onCancel: noop });
  await make('determinate', { title: 'Restarting alpha-worker', target: { label: 'alpha-worker', destination: { page: 'host/plugins', item: 'flux' } }, source: { plugin: 'alpha' }, progress: { current: 6, total: 14, unit: 'jobs' }, message: 'Draining node 1', onCancel: noop });
  return ids;
};

const nextFrame = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const rowCount = (page, n) => page.waitForFunction((count) => document.querySelectorAll('#shell-panel .panel__view:not([hidden]) .data-view tbody > tr').length === count, n);

/** Each scene in a fresh page, closed whatever it reads. Returns { reading, facts, extra? }. */
async function scene(browser, viewport, name, base, engineName, viewportName) {
  const page = await open(browser, viewport, base);
  try {
    const result = {};
    if (name === 'problems-empty') {
      await showTool(page, 'problems');
      await freeze(page);
      result.reading = await page.evaluate(READ);
      result.facts = await page.evaluate(FACTS);
    } else if (name === 'problems-rows') {
      await showTool(page, 'problems');
      await addConditions(page, RAW_CONDITIONS);
      const health = await reportFailedPlugin(page);
      await rowCount(page, RAW_CONDITIONS.length + (health === null ? 0 : 1));
      await freeze(page);
      result.reading = await page.evaluate(READ);
      result.reading.healthCondition = health;
      result.reading.hover = await hoverRow(page);
      result.facts = await page.evaluate(FACTS);
    } else if (name === 'problems-filtered-none') {
      await showTool(page, 'problems');
      await addConditions(page, RAW_CONDITIONS.slice(0, 3));
      await rowCount(page, 3);
      await page.click('#shell-panel .panel__view:not([hidden]) .seg button[data-action="shell:host.problems.severity:info"]');
      await page.waitForFunction(() => document.querySelector('#shell-panel .panel__view:not([hidden]) .empty2 b')?.textContent === 'No problems match');
      await stable(page);
      await page.mouse.move(1, 1);
      await freeze(page);
      result.reading = await page.evaluate(READ);
      result.facts = await page.evaluate(FACTS);
    } else if (name === 'operations-empty') {
      await showTool(page, 'operations');
      await freeze(page);
      result.reading = await page.evaluate(READ);
      result.facts = await page.evaluate(FACTS);
    } else if (name === 'operations-rows') {
      await showTool(page, 'operations');
      result.ids = await page.evaluate(OPS);
      await rowCount(page, 9);
      await nextFrame(page);
      await freeze(page);
      result.reading = await page.evaluate(READ);
      result.reading.hover = await hoverRow(page);
      result.facts = await page.evaluate(FACTS);
    } else if (name === 'tab-badges') {
      await showTool(page, 'problems');
      await freeze(page);
      const states = {};
      const read = async (state, ready) => {
        await page.waitForFunction(ready, undefined, { timeout: 8000 });
        await stable(page);
        await page.mouse.move(1, 1);
        states[state] = await page.evaluate(STRIP);
        const panel = states[state].panel;
        await shot(page, state === 'count-errors' ? 'tab-badges' : `tab-badges-${state}`, engineName, viewportName, { x: panel[0], y: panel[1], width: panel[2], height: Math.min(panel[3], states[state].header[3] + 8) });
      };
      const tab = (id) => `document.querySelector('#shell-panel .toolheader__tablist > [data-key="${id}"]')`;
      // 1. Problems: two errors -> a count.
      await page.evaluate(() => { Shell.condition('b-1', { severity: 'error', title: 'Alpha: sync failed', source: { plugin: 'alpha' } }); Shell.condition('b-2', { severity: 'error', title: 'Beta: request failed', source: { plugin: 'beta' } }); });
      await read('count-errors', new Function(`return ${tab('problems')}?.querySelector('.count')?.textContent.trim() === '2'`));
      // 2. only warnings -> a dot with its label.
      await page.evaluate(() => { Shell.condition.resolve('b-1'); Shell.condition.resolve('b-2'); Shell.condition('b-3', { severity: 'warning', title: 'Alpha: slow response', source: { plugin: 'alpha' } }); Shell.condition('b-4', { severity: 'warning', title: 'Beta: quota nearly used', source: { plugin: 'beta' } }); });
      await read('dot-warnings', new Function(`const t = ${tab('problems')}; return t?.querySelector('.toolheader__dot[data-tone="warning"]') !== null && t.querySelector('.count') === null`));
      // 3. Operations: an unread failure -> an error dot.
      await page.evaluate(() => { Shell.condition.resolve('b-3'); Shell.condition.resolve('b-4'); window.__failed = Shell.ops.begin({ title: 'Syncing the index', source: { plugin: 'alpha' } }); window.__failed.fail({ message: 'The connection was refused' }); });
      await read('ops-error', new Function(`const t = ${tab('operations')}; return t?.querySelector('.toolheader__dot[data-tone="error"]') !== null && ${tab('problems')}.querySelector('.toolheader__dot, .count') === null`));
      // 4. Operations: an unread warning -> a warning dot.
      await page.evaluate(() => { Shell.ops.remove(window.__failed.id, { quiet: true }); window.__warned = Shell.ops.begin({ title: 'Backing up the item', source: { plugin: 'beta' } }); window.__warned.succeed({ severity: 'warning', message: 'Finished with warnings' }); });
      await read('ops-warning', new Function(`return ${tab('operations')}?.querySelector('.toolheader__dot[data-tone="warning"]') !== null`));
      // 5. nothing.
      await page.evaluate(() => { Shell.ops.remove(window.__warned.id, { quiet: true }); });
      await read('none', new Function(`return ${tab('operations')}?.querySelector('.toolheader__dot, .count') === null && ${tab('problems')}?.querySelector('.toolheader__dot, .count') === null`));
      result.states = states;
      result.reading = { states };
      return result;
    }
    await page.mouse.move(1, 1);
    await shot(page, name, engineName, viewportName);
    return result;
  } finally {
    await page.context().close();
  }
}

const verdicts = {
  'problems-empty': (r) => (r.panel === null || r.header === null || r.tabs.length < 5 || r.content === null || r.empty === null || r.empty.title.text !== 'No problems' || r.rows.total !== 0 ? 'misses its panel, tabs or the "No problems" state' : null),
  'problems-rows': (r) => (r.panel === null || r.dataView === null || r.tool !== 'problems' || r.rows.total < 7 || r.rows.visible < 1 || r.firstRow === null || r.footer === null || r.filters === null || r.healthCondition === null ? `misses its panel or rows (${r.rows.total} rows, health ${r.healthCondition === null ? 'missing' : 'ok'})` : null),
  'problems-filtered-none': (r) => (r.panel === null || r.empty === null || r.empty.title.text !== 'No problems match' || r.filters === null ? 'misses the "No problems match" state' : null),
  'operations-empty': (r) => (r.panel === null || r.empty === null || r.empty.title.text !== 'No operations' || r.rows.total !== 0 ? 'misses its panel or the "No operations" state' : null),
  'operations-rows': (r) => {
    const words = r.rows.items.map((i) => i.state?.word).join();
    if (r.panel === null || r.dataView === null || r.tool !== 'operations' || r.rows.total !== 9 || r.rows.visible < 1 || r.firstRow === null || r.footer === null) return `misses its panel or its nine rows (${r.rows.total})`;
    for (const word of ['Running', 'Queued', 'Paused', 'Succeeded', 'Failed', 'Canceled', 'Outcome unknown']) if (!words.includes(word)) return `no row says "${word}" (${words})`;
    if (!r.rows.items.some((i) => i.bar?.text === '6 of 14 jobs') || !r.rows.items.some((i) => i.bar?.text === '2 of 5')) return 'misses the determinate or the steps progress';
    return null;
  },
  'tab-badges': (r) => {
    const t = r.states;
    const tabOf = (state, key) => t[state]?.tabs.find((x) => x.key === key);
    if (Object.keys(t).join() !== BADGE_STATES.join()) return `states ${Object.keys(t)}`;
    if (tabOf('count-errors', 'problems')?.count?.text.trim() !== '2') return 'Problems shows no count of 2';
    if (tabOf('dot-warnings', 'problems')?.dot?.tone !== 'warning') return 'Problems shows no warning dot';
    if (tabOf('ops-error', 'operations')?.dot?.tone !== 'error') return 'Operations shows no error dot';
    if (tabOf('ops-warning', 'operations')?.dot?.tone !== 'warning') return 'Operations shows no warning dot';
    if (['problems', 'operations'].some((k) => tabOf('none', k)?.dot || tabOf('none', k)?.count)) return 'a badge stays in the none state';
    return null;
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const data = {};
const factsByEngine = {};
let failed = false;
try {
  const base = await serve();
  const files = await verifyMock(base);
  console.log(`the mock at ${base} is the tree ${MOCK_TREE} (${files} files)`);
  for (const engineName of Object.keys(ENGINES)) {
    const browser = await launch(engineName);
    try {
      data[engineName] = {};
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        data[engineName][viewportName] = {};
        for (const name of SCENES) {
          let result;
          try {
            result = await scene(browser, viewport, name, base, engineName, viewportName);
          } catch (error) {
            console.log('MISSING', engineName, viewportName, name, String(error.message).split('\n')[0]);
            failed = true;
            continue;
          }
          const problem = verdicts[name](result.reading);
          if (problem !== null) { console.log('MISSING', engineName, viewportName, name, problem); failed = true; }
          data[engineName][viewportName][name] = result.reading;
          if (viewportName === '1440x900' && result.facts) (factsByEngine[engineName] ??= {})[name] = result.facts;
          console.log(engineName, viewportName, name, problem === null ? 'ok' : 'FAILED');
        }
      }
    } finally {
      await browser.close();
    }
  }

  // Words, as printed by the mock (read from the 1440x900 readings of the first engine; checked equal across engines and viewports).
  const wordsOf = (engineName, viewportName) => {
    const d = data[engineName]?.[viewportName] ?? {};
    const status = (scene) => [...new Set((d[scene]?.rows.items ?? []).map((i) => i.state?.word).filter(Boolean))];
    const badge = (state, key) => { const t = d['tab-badges']?.states[state]?.tabs.find((x) => x.key === key); return t ? { count: t.count?.text.trim() ?? null, dot: t.dot?.tone ?? null, text: t.text } : null; };
    return {
      problemsEmpty: { title: d['problems-empty']?.empty?.title.text, hint: d['problems-empty']?.empty?.hint.text },
      problemsFilteredNone: { title: d['problems-filtered-none']?.empty?.title.text, hint: d['problems-filtered-none']?.empty?.hint.text, buttons: d['problems-filtered-none']?.empty?.actions.map((a) => a.text) },
      operationsEmpty: { title: d['operations-empty']?.empty?.title.text, hint: d['operations-empty']?.empty?.hint.text },
      // A scene that lacks its empty state or its footer is a scene the verdict has already failed: its words are not there, and the diagnostic is written all the same.
      problemsFooter: d['problems-rows']?.footer?.count.text, operationsFooter: d['operations-rows']?.footer?.count.text,
      problemsFilteredFooter: d['problems-filtered-none']?.footer?.count.text ?? null,
      problemsThs: d['problems-rows']?.ths.map((t) => t.text), operationsThs: d['operations-rows']?.ths.map((t) => t.text),
      problemsFilters: d['problems-rows']?.filters && { seg: d['problems-rows'].filters.seg.buttons.map((b) => b.text), select: d['problems-rows'].filters.select.options },
      operationsFilters: d['operations-rows']?.filters && { seg: d['operations-rows'].filters.seg.buttons.map((b) => b.text), select: d['operations-rows'].filters.select.options, searchPlaceholder: d['operations-rows'].filters.search?.placeholder },
      problemsStatus: status('problems-rows'), operationsStatus: status('operations-rows'),
      problemsCells: d['problems-rows']?.rows.items.map((i) => i.cells), operationsCells: d['operations-rows']?.rows.items.map((i) => i.cells),
      problemsRailLabels: d['problems-rows']?.rail.buttons.map((b) => b.label), operationsRailLabels: d['operations-rows']?.rail.buttons.map((b) => b.label),
      rowActionLabels: { problems: d['problems-rows']?.rows.items.map((i) => i.actions.map((a) => a.label)), operations: d['operations-rows']?.rows.items.map((i) => i.actions.map((a) => a.label)) },
      healthCondition: d['problems-rows']?.healthCondition,
      tabBadges: Object.fromEntries(BADGE_STATES.map((s) => [s, { problems: badge(s, 'problems'), operations: badge(s, 'operations') }])),
    };
  };
  const [firstEngine] = Object.keys(data);
  const words = wordsOf(firstEngine, '1440x900');
  for (const engineName of Object.keys(data)) for (const viewportName of Object.keys(VIEWPORTS)) {
    // The words must not depend on the engine or the viewport (cells carry a duration and an age that can differ by a tick: not compared).
    const got = wordsOf(engineName, viewportName);
    for (const field of ['problemsEmpty', 'problemsFilteredNone', 'operationsEmpty', 'problemsFooter', 'operationsFooter', 'problemsThs', 'operationsThs', 'problemsFilters', 'operationsFilters', 'problemsStatus', 'operationsStatus', 'tabBadges']) {
      if (JSON.stringify(got[field]) !== JSON.stringify(words[field])) { console.log('WORDS differ', engineName, viewportName, field); failed = true; }
    }
  }

  const engines = Object.keys(factsByEngine);
  const factsOut = engines.length === 2 && JSON.stringify(factsByEngine[engines[0]]) === JSON.stringify(factsByEngine[engines[1]]) ? { both: factsByEngine[engines[0]] } : factsByEngine;
  if (factsOut.both === undefined) console.log('FACTS differ between the engines: kept per engine');

  const note = `Rectangles [x, y, w, h] in viewport px, rounded to 0.01. Mock default context (theme, density, text scale); the start screen, no plugin screen. Measured on a machine with load average ${load.map((v) => v.toFixed(2)).join(' ')} (1, 5, 15 min at run start; uptime read 14.74 13.54 11.19 before writing the script). Each scene in a fresh page; animations and transitions are frozen (a style that sets animation and transition to none) before each reading, the panel rectangle is read once it is the same on three frames. `
    + 'Sources `alpha` and `beta` are not plugins of the mock: it names a source by its capitalised id (Alpha, Beta), so rows are neutral. The plugin-health condition is the mock\'s own `health:flux` (Shell.plugins.report(\'flux\', { service: \'failed\', ... })): the mock has no neutral plugin, so its Source cell reads the mock\'s own plugin name (Flux). '
    + 'The panel shows ONE tool view at a time (`.panel__view:not([hidden])`; the other tool views stay in the DOM, hidden, inert, aria-hidden). Operation ids are random: data-key reads `operation:op-ID` here. Durations and ages ("just now", "under 1 s") are volatile. A row is a `tr.click` with tabindex 0 and no role. '
    + 'The tab dot is `<i class="toolheader__dot" data-tone="error|warning">` and its label is a `.visually-hidden` span (", <dotLabel>") inside the tab; the count is `<span class="count"> N</span>`. The dot of the accent tone (no data-tone match) is not reachable from the two tools (they raise error or warning only) and is not measured. '
    + 'Mock behaviour the real tools should not copy blindly (measured, in both engines): the Problems table\'s pinned Condition column renders 37px (webkit) / 14px (chromium) wide although its th carries --fit-w: 886px (th.fit-w1 has width 1% and a min-width the engines ignore), so the Condition label is clipped to its glyph; the Operations Progress cell\'s `.cell-measure` (min-width = viz 48 + gap 8 + 12ch) is wider than the 124.5px content box of the 144.5px column, so "6 of 14 jobs" / "2 of 5" / "40%" spill under the Started cell and read clipped; an indeterminate operation draws no bar (the dim em dash, aria-label "No progress reported"). The `overflow` of each row lists the cells whose content ellipsizes or spills. '
    + 'Paint: every computed style is an entry of `styles` ({ color, backgroundColor, border, fontFamily, fontSize, fontWeight, lineHeight, borderRadius, opacity }) and a part of `paint` (and the hover reading) holds its index; the paint of 1440x900 is stored in full, at 1280x800 only the parts that differ (absent = same as 1440x900); the strip parts (tabs, header, panel) are kept in problems-rows and tab-badges only. '
    + `Words the mock prints are in \`words\` (read from the page, equal in both engines and both viewports): ${JSON.stringify({ problemsEmpty: words.problemsEmpty, problemsFilteredNone: words.problemsFilteredNone, operationsEmpty: words.operationsEmpty, problemsFooter: words.problemsFooter, operationsFooter: words.operationsFooter, problemsStatus: words.problemsStatus, operationsStatus: words.operationsStatus, tabBadges: words.tabBadges })}.`;
  // The file stays small: every distinct computed style is stored once (`styles`), the second viewport keeps only what differs, the strip paint is read once.
  const styles = [];
  const isStyle = (v) => v !== null && typeof v === 'object' && 'color' in v && 'backgroundColor' in v && 'fontSize' in v;
  const indexStyles = (value) => {
    if (value === null || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      if (isStyle(v)) {
        const text = JSON.stringify(v);
        let at = styles.findIndex((s) => JSON.stringify(s) === text);
        if (at < 0) at = styles.push(v) - 1;
        value[k] = at;
      } else indexStyles(v);
    }
  };
  const STRIP_PARTS = ['toolTabSelected', 'toolTabOther', 'countPill', 'dotError', 'dotWarning', 'tablist', 'header', 'panel'];
  const firstViewport = Object.keys(VIEWPORTS)[0];
  for (const engineName of Object.keys(data)) {
    const reference = structuredClone(data[engineName][firstViewport]);
    for (const [viewportName, scenes] of Object.entries(data[engineName])) {
      for (const [sceneName, reading] of Object.entries(scenes)) {
        if (reading.paint === undefined) continue;
        if (sceneName !== 'problems-rows') for (const part of STRIP_PARTS) delete reading.paint[part];
        if (viewportName !== firstViewport) {
          for (const part of Object.keys(reading.paint)) if (JSON.stringify(reading.paint[part]) === JSON.stringify(reference[sceneName]?.paint?.[part])) delete reading.paint[part];
        }
      }
    }
  }
  indexStyles(data);
  const text = `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, load, note, words, styles, data, facts: factsOut })}\n`;
  const file = failed ? path.join(tmpdir(), 'mock-problems-operations.failed.json') : path.join(here, 'mock-problems-operations.json');
  writeFileSync(file, text);
  console.log('wrote', file, statSync(file).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
  console.log('screenshots in', SHOTS);
  if (failed) { console.log('FAILED: a scene misses its panel, rows, empty state or footer: mock-problems-operations.json is unchanged'); process.exitCode = 1; }
} finally {
  // Exactly the server this script started; browsers were closed by their own `finally`.
  if (server !== null && server.exitCode === null) server.kill();
}
process.exit(process.exitCode ?? 0);

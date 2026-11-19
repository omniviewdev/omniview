// Measures the design mock's Logs tool body: the REFERENCE the kit's LogView (slice P1b2) is built to (decision A15).
//
// What it measures, per engine (webkit, chromium) and viewport (1440x900, 1280x800), every scenario in a FRESH page, with the mock's default context (no text scale, default density; the UI font
// normalized as probe-lib's normalizeFont does for the table and shell probes; the page runs in UTC and en-US so the clock text is the same everywhere). The page is the mock's own start screen. The
// mock's host streams add random lines about every 100 ms, so every scenario but `markers` runs on a session of the probe's OWN producer (`probe.logs`, registered through Shell.panel.producers.register:
// it declares one source, `probe`, and says `running` at once; its modes `idle`, `slow` (connecting for 20 s) and `fail` (refuses to start) serve `states`). The lines are fed through Shell.panel.logs.feed
// with fixed times, levels and messages, so the list is exactly what the probe made. The panel is at the mock's default height (the list shows about 6 rows); this script does not resize it.
//   - list:         a running session with 90 lines (levels cycle info, warn, error, info, debug, info, warn, info, debug, info; line 4 has an ANSI hue span, line 10 is 450+ chars), follow on, read once
//                   the lines/s rate has decayed to 0.0 (3.6 s): the regions, the filter row (field, lane, toggles, steps, seg, time button, gaps), the table head, the first three rows in full, the paint
//                   of one row per level, the ANSI span, the long line, the strip, the aria facts.
//   - find:         the filter row's controls in five states (rest, match: 'request', none: 'zzzzqq', invalid: '(' with the regex toggle on, empty: the query cleared with the regex still on), the
//                   largest movement of any control between them, the pressed toggles, hover and keyboard focus of a toggle, a step, a seg button and the time button, Enter / Shift+Enter / Escape.
//   - selected:     click a row, its paint focused (keyboard focus-visible) and unfocused, hover, the current (`data-current`) row, ArrowDown/ArrowUp/PageDown/PageUp/Home/End, Ctrl+C and Meta+C.
//   - dropped:      10,100 lines fed (LOG_CAP = 10000): the marker row at the top of the list (after Home), the strip; then a `cleared` marker; a finished log (`ended` marker, Stream ended).
//   - markers:      on the mock's own host runner session (`plugin-logs/host`): the `reconnect` and `gap` marker rows Shell.panel.sim.dropSource triggers. Their text and times are random (see `random`).
//   - states:       connecting, waiting for lines, no line matches the filters, ended, failed with lines (the banner), failed with no lines (the body notice).
//   - scrolledBack: after a wheel up the strip's `Jump to latest`; the `Scrolled back, N new lines` text; paused: `Resume` and `Paused, N new lines waiting`.
//   - facts:        the resting texts and aria/role facts (read at 1440x900; the two engines agree, else they are kept per engine under webkit and chromium).
//
// Serve the mock first or let the script do it: without MOCK_URL it serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) from a CommonJS copy of its server.js with `root` set, on port
// 49475 (see mock-panel-measure.mjs):
//   sed 's#const root=__dirname#const root="<mock dir>"#' <mock dir>/server.js > /tmp/server.cjs && PORT=49471 node /tmp/server.cjs
// Run:  node packages/kit/probes/mock-log-measure.mjs         (MOCK_URL=http://127.0.0.1:49471/ to use a server of your own; ENGINES=chromium or SCENARIOS=list,find to narrow a run: nothing is written then)
// Writes mock-log.json. Exits non-zero when a scenario misses a part; the file is then not replaced (what it read goes to the temp directory).
//
// mock-log.json: { mockTree, note, viewports, random, notes,
//   data:  { <engine>: { <viewport>: { list, find, selected, dropped, markers, states, scrolledBack } } },
//   facts: { ... }  (or { webkit, chromium } when the engines differ) }
// Every rectangle is [x, y, w, h] in px, 0.01 precision, relative to the top-left of the `.ptool--logs` element (`tool.abs` is that element's own viewport rectangle), except the rows' own
// (`rows[]`, `special.*`, `levels.*`), which are relative to the top-left of `.plog__table` (the table scrolls under the sticky head; a row's place in the TABLE is the same wherever the list is
// scrolled), and `viewportRows`, which is relative to the tool. null: the part is not laid out (display: none, or absent).
//   list: { tool: { abs, cls, state }, regions: { filters, main, scroll, table, status }, scroll: { scrollTop, scrollHeight, clientHeight, clientWidth, offsetWidth, vertical scrollbar width },
//           filters: { style, children: [{ cls, rect }], searchbox, field, fieldStyle, input, inputStyle, glyph, lane, laneStyle, rove, toggles: [{ name, rect, svg, pressed, tabIndex, tooltip, style }],
//                      steps: [...], seg, segStyle, segButtons: [{ label, rect, checked, tabIndex, tooltip, style }], time: { label, rect, svg, style }, gaps: { fieldToToggle, ... } },
//           head: { rect, position, cells: [{ text, rect, style, display }] },
//           rows: [3 x { n, cls, rect, tds: [{ rect, display, style }], time, level, message, paint, attrs }], levels: { info, warn, error, debug }, special: { ansi, long },
//           viewportRows: { count, firstN, lastN, last: rect }, strip: ..., aria: ... }
//   find: { states: { rest, match, none, invalid, empty }, movement: { <control>: max px any edge moved }, maxMovement, pressed, paint, keys: { enter: [..], escape: [..] } }
//   (the other scenarios: see the code; every reading is a plain object of rectangles, texts and computed styles.)
// Key behaviours are recorded as plain values: after each key, `activeN` (the row aria-activedescendant names), the first and last row in view, `follow`, `scrollTop`, and for the find field `current`
// (the row with data-current) and the lane text.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont, sleep } from './probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const ALL_SCENARIOS = ['list', 'find', 'selected', 'dropped', 'markers', 'states', 'scrolledBack'];
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const scenarioNames = (process.env.SCENARIOS ?? ALL_SCENARIOS.join(',')).split(',');
for (const [what, names, known] of [['ENGINES', engineNames, Object.keys(ENGINES)], ['SCENARIOS', scenarioNames, ALL_SCENARIOS]]) {
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`${what} names ${unknown.join(', ')}, which is not one of ${known.join(', ')}`);
}
/** Every known name exactly once: a count of names is not that (`webkit,webkit` has the count of two engines and measures one). Only a run that is complete may replace the reference. */
const eachOnce = (names, known) => names.length === known.length && known.every((name) => names.filter((entry) => entry === name).length === 1);
const partial = !eachOnce(engineNames, Object.keys(ENGINES)) || !eachOnce(scenarioNames, ALL_SCENARIOS);
const started = Date.now();

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';

/**
 * Whether the mock this run measures is the tree the reference is labelled with. `mock-log.json` says `mockTree` and the probes treat it as the approved design, so only a
 * measurement of that tree may carry the label: the directory must be in a git work tree whose HEAD holds MOCK_TREE at that directory, with no file of it changed or untracked, and
 * the script must serve it itself (a `MOCK_URL` is a server whose files this script cannot read, so what it answers cannot be shown to be that tree). A run that cannot show it
 * measures, and writes what it read to the temp directory, as a narrowed run does; the reference is not replaced.
 */
function mockIdentity() {
  if (process.env.MOCK_URL !== undefined) {
    return { ok: false, why: `MOCK_URL names a server of your own, whose files cannot be read, so it cannot be shown to be tree ${MOCK_TREE}` };
  }

  try {
    const git = (...args) => execFileSync('git', ['-C', MOCK_DIR, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const tree = git('rev-parse', 'HEAD:./');
    if (tree !== MOCK_TREE) {
      return { ok: false, why: `${MOCK_DIR} holds tree ${tree} at HEAD, not ${MOCK_TREE}` };
    }

    const changed = git('status', '--porcelain', '--untracked-files=all', '--', '.');
    return changed === '' ? { ok: true, why: `tree ${tree}, no change` } : { ok: false, why: `${MOCK_DIR} has changes against tree ${tree}: ${changed.split('\n')[0]}` };
  } catch (error) {
    return { ok: false, why: `the tree of ${MOCK_DIR} could not be read with git: ${String(error.message).split('\n')[0]}` };
  }
}

const identity = mockIdentity();
console.log(identity.ok ? `mock identity: ${identity.why}` : `mock identity NOT shown: ${identity.why}`);
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory.
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-log-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49475' }, stdio: 'ignore' });
  url = 'http://127.0.0.1:49475/';
  await sleep(1500);
}

/** Page side (self-contained: it is serialized into the page): the probe's producer and the readers. Installs window.__lv. */
function install() {
  const r2 = (v) => Math.round(v * 100) / 100;
  const shown = (el) => el instanceof Element && el.getClientRects().length > 0;
  const L = { r2, shown };

  // The probe's producer: one source, running at once. mode: 'idle' | 'slow' (connecting for 20 s) | 'fail' (refuses to start).
  Shell.panel.producers.register({
    id: 'probe.logs', kinds: ['logs'],
    start: async ({ sink, target }) => {
      sink.sources([{ id: 'probe/app', label: 'probe', detail: 'probe' }]);
      if (target.mode === 'fail') throw Object.assign(new Error('probe start rejected'), { sessionCause: 'The probe producer refused to start' });
      if (target.mode === 'slow') { setTimeout(() => sink.state({ state: 'running' }), 20000); return { slow: true }; }
      sink.state({ state: 'running' });
      return { ok: true };
    },
    stop: async () => ({ acknowledged: true }), reconnect: async () => ({ ok: true }), dispose: async () => undefined,
  });
  L.open = async (mode, title) => {
    const id = Shell.panel.logs.open({ id: `probe/${mode}`, producer: 'probe.logs', kind: 'probe', label: title, title, mode });
    const want = mode === 'slow' ? 'connecting' : mode === 'fail' ? 'failed' : 'running';
    for (let i = 0; i < 100 && Shell.panel.sessions.get(id)?.state !== want; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 400));
    return id;
  };

  // Deterministic lines. Level cycle of 10; line 4 has an ANSI hue span; line 10 is 450+ chars; every third line says 'request'.
  const LV = ['info', 'warn', 'error', 'info', 'debug', 'info', 'warn', 'info', 'debug', 'info'];
  const BASE = Date.UTC(2026, 0, 15, 10, 0, 0);
  L.lines = (from, count) => Array.from({ length: count }, (_, k) => {
    const i = from + k;
    let message = i % 3 === 0 ? `request ${i} served in ${10 + (i * 7) % 90} ms` : `worker ${i % 5} reconciled ${i} objects`;
    if (i === 3) message = `Applied \u001b[33mretry budget\u001b[0m to upstream ${i}`;
    if (i === 9) message = `request ${i} ${'very-long-message-segment '.repeat(18)}end`;
    return { time: BASE + i * 1013, level: LV[i % 10], message };
  });
  L.feed = (id, from, count) => Shell.panel.logs.feed(id, L.lines(from, count));

  const tool = () => [...document.querySelectorAll('#shell-panel .ptool')].find(shown) ?? null;
  L.tool = tool;
  const rel = (el, o) => { if (!shown(el)) return null; const b = el.getBoundingClientRect(); return [r2(b.x - o.x), r2(b.y - o.y), r2(b.width), r2(b.height)]; };
  L.rel = rel;
  const pick = (el, props) => { if (!el) return null; const cs = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, cs[p]])); };
  const TEXT = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'textTransform', 'letterSpacing', 'textAlign'];
  const CELL = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'textAlign', 'whiteSpace', 'overflow', 'textOverflow', 'fontVariantNumeric', 'verticalAlign', 'backgroundColor', 'boxShadow', 'borderBottomWidth', 'borderBottomColor'];
  const PAINT = ['backgroundColor', 'color', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderTopLeftRadius', 'boxShadow', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'opacity', 'cursor'];
  const BOX = ['display', 'position', 'boxSizing', 'width', 'height', 'minHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap', 'marginLeft', 'marginRight', 'flexGrow', 'flexShrink', 'flexBasis'];
  L.TEXT = TEXT; L.CELL = CELL; L.PAINT = PAINT; L.BOX = BOX; L.pick = pick;
  L.style = (el) => pick(el, [...BOX, ...PAINT, ...TEXT]);
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  L.txt = txt;
  const textRect = (el, o) => { // the rectangle of the text itself (its first text node)
    const node = el && [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim() !== '');
    if (!node) return null;
    const range = document.createRange(); range.selectNodeContents(node);
    const b = range.getBoundingClientRect();
    return [r2(b.x - o.x), r2(b.y - o.y), r2(b.width), r2(b.height)];
  };
  L.textRect = textRect;
  L.describe = (el) => (el ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}${el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label')}"]` : ''}${el === document.body ? '' : ''}` : null);
  L.follow = (id) => Shell.get(['panel', 'ui', 'logs', id, 'follow']) ?? true;
  L.cfg = (id) => Shell.get(['panel', 'ui', 'logs', id]) ?? null;

  const cell = (td, o) => ({ rect: rel(td, o), display: getComputedStyle(td).display, style: pick(td, CELL) });

  /** One body row in full, rectangles relative to the table. */
  L.rowDetail = (tr) => {
    const table = tr.closest('table'), to = table.getBoundingClientRect(), R = (el) => rel(el, to);
    const tds = [...tr.children], q = (s, r = tr) => r.querySelector(s);
    const first = tds[0], t = q('.plog__t--local'), state = q('.resource-state'), label = q('.resource-state__label'), mono = q('.mono'), prose = q('span.cell-prose'), dim = q('.dim');
    const cs = getComputedStyle(tr);
    return {
      n: Number(tr.dataset.n), cls: tr.className.trim().replace(/\s+/g, ' '), rect: R(tr), trBackground: cs.backgroundColor, trBoxShadow: cs.boxShadow, trHeight: cs.height,
      tds: tds.map((td) => cell(td, to)),
      time: { text: txt(t), rect: R(t), textRect: textRect(t, to), dimRect: R(dim), dimStyle: pick(dim, TEXT), style: pick(t, [...TEXT, 'fontVariantNumeric']) },
      level: { cell: R(tds[1]), state: R(state), stateStyle: pick(state, ['display', 'columnGap', 'gap', 'alignItems']), glyph: R(q('.resource-state__icon')), glyphSvg: R(q('.resource-state__icon svg')), word: R(label), wordText: txt(label), wordStyle: pick(label, TEXT), glyphStyle: pick(q('.resource-state__icon'), ['color', 'width', 'height']), tone: state?.dataset.stateTone ?? null },
      message: { td: R(tds[tds.length - 1]), prose: R(prose), proseStyle: pick(prose, [...TEXT, 'display', 'overflow', 'textOverflow', 'whiteSpace']), mono: R(mono), monoText: txt(mono), monoStyle: pick(mono, [...TEXT, 'fontVariantNumeric', 'whiteSpace']), tooltip: prose?.dataset.tooltip ?? null },
      firstTdBoxShadow: getComputedStyle(first).boxShadow, firstTdBackground: getComputedStyle(first).backgroundColor,
      attrs: { role: tr.getAttribute('role'), ariaSelected: tr.getAttribute('aria-selected'), ariaLabel: tr.getAttribute('aria-label'), tabIndex: tr.tabIndex, id: tr.id, dataset: { ...tr.dataset }, cellRoles: tds.map((td) => td.getAttribute('role')), tag: tr.tagName.toLowerCase() },
    };
  };
  L.rowByN = (n) => document.querySelector(`.plog__table tbody > tr[data-n="${n}"]`);

  /** The three regions and the strip. */
  L.strip = () => {
    const t = tool(), o = t.getBoundingClientRect(), R = (el) => rel(el, o), s = t.querySelector('.ptool__status');
    const stat = s?.querySelector('.ptool__stat'), state = s?.querySelector('.ptool__state'), op = s?.querySelector('.ptool__operation'), act = s?.querySelector('.ptool__actions'), btn = act?.querySelector('button');
    return {
      rect: R(s), style: pick(s, [...BOX, ...PAINT, ...TEXT, 'borderTopWidth', 'borderTopColor']), role: s?.getAttribute('role') ?? null, ariaLabel: s?.getAttribute('aria-label') ?? null,
      stat: { rect: R(stat), textRect: textRect(stat, o), text: stat ? stat.textContent : null, style: pick(stat, [...TEXT, 'fontVariantNumeric', 'overflow', 'textOverflow', 'whiteSpace']), ariaLive: stat?.getAttribute('aria-live') ?? null, tag: stat?.tagName.toLowerCase() ?? null },
      state: { rect: R(state), text: state ? state.textContent : null, style: pick(state, TEXT) },
      operation: { rect: R(op), text: txt(op) },
      actions: act ? { rect: R(act), button: { label: txt(btn), rect: R(btn), svg: R(btn?.querySelector('svg')), style: pick(btn, [...BOX, ...PAINT, ...TEXT]), action: btn?.dataset.action ?? null, tabIndex: btn?.tabIndex ?? null } } : null,
    };
  };

  L.regions = () => {
    const t = tool(), o = t.getBoundingClientRect(), R = (el) => rel(el, o), q = (s) => t.querySelector(s);
    const sc = q('.plog__scroll');
    return {
      tool: { abs: [r2(o.x), r2(o.y), r2(o.width), r2(o.height)], cls: t.className, state: t.dataset.state ?? t.dataset.notice ?? null, key: t.dataset.key ?? null },
      regions: { filters: R(q('.plog__filters')), main: R(q('.ptool__main')), scroll: R(sc), table: R(q('.plog__table')), tablewrap: R(q('.plog__tablewrap')), status: R(q('.ptool__status')), failure: R(q('.ptool__failure')), notice: R(q('.ptool__notice')) },
      scroll: sc ? { scrollTop: r2(sc.scrollTop), scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight, clientWidth: sc.clientWidth, offsetWidth: sc.offsetWidth, scrollbarWidth: sc.offsetWidth - sc.clientWidth, style: pick(sc, [...PAINT, 'overflowX', 'overflowY', 'overscrollBehavior', 'display', 'position']) } : null,
    };
  };

  /** The filter row. */
  L.filters = () => {
    const t = tool(), o = t.getBoundingClientRect(), R = (el) => rel(el, o), f = t.querySelector('.plog__filters');
    if (!f) return null;
    const box = f.querySelector('.plog__searchbox'), field = box.querySelector('.search'), input = field.querySelector('input'), glyph = field.querySelector(':scope > .ic'), lane = field.querySelector('.plog__count'), rove = box.querySelector('.rove');
    const btn = (b) => ({ name: b.getAttribute('aria-label'), rect: R(b), svg: R(b.querySelector('svg')), pressed: b.getAttribute('aria-pressed'), tabIndex: b.tabIndex, tooltip: b.dataset.tooltip ?? null, action: b.dataset.action ?? null, style: pick(b, [...BOX, ...PAINT]) });
    const buttons = [...rove.querySelectorAll('button')].map(btn);
    const toggles = buttons.slice(0, 2), steps = buttons.slice(2);
    const seg = f.querySelector('.seg'), time = f.querySelector(':scope > button');
    const segButtons = [...seg.querySelectorAll('button')].map((b) => ({ label: b.textContent.trim(), rect: R(b), checked: b.getAttribute('aria-checked'), tabIndex: b.tabIndex, tooltip: b.dataset.tooltip ?? null, cls: b.className, style: pick(b, [...BOX, ...PAINT, ...TEXT]) }));
    const gap = (a, b) => (a && b ? r2(b[0] - (a[0] + a[2])) : null);
    const f0 = R(field), tr = toggles.map((b) => b.rect), sr = steps.map((b) => b.rect), seg0 = R(seg), sb = segButtons.map((b) => b.rect), time0 = R(time);
    return {
      rect: R(f), style: pick(f, [...BOX, ...PAINT, 'borderBottomWidth', 'borderBottomColor', 'flexWrap', 'alignItems']), role: f.getAttribute('role'), ariaLabel: f.getAttribute('aria-label'),
      children: [...f.children].map((c) => ({ cls: c.className, tag: c.tagName.toLowerCase(), rect: R(c) })),
      searchbox: R(box), searchboxStyle: pick(box, [...BOX]),
      field: f0, fieldStyle: pick(field, [...BOX, ...PAINT, ...TEXT]), input: R(input), inputStyle: pick(input, [...BOX, ...PAINT, ...TEXT, 'caretColor']), glyph: R(glyph), glyphSvg: R(glyph?.querySelector('svg')), glyphStyle: pick(glyph, ['color', 'width', 'height', 'position', 'insetInlineStart']),
      lane: R(lane), laneStyle: pick(lane, [...BOX, ...TEXT, 'position', 'insetInlineEnd', 'insetBlockStart', 'overflow', 'textOverflow', 'whiteSpace', 'fontVariantNumeric', 'transform']), laneTag: lane.tagName.toLowerCase(),
      rove: R(rove), roveRole: rove.getAttribute('role'), roveLabel: rove.getAttribute('aria-label'), roveStyle: pick(rove, [...BOX, 'alignItems']),
      toggles, steps, seg: seg0, segRole: seg.getAttribute('role'), segLabel: seg.getAttribute('aria-label'), segStyle: pick(seg, [...BOX, ...PAINT]), segButtons,
      time: { label: txt(time), rect: time0, svg: R(time.querySelector('svg')), style: pick(time, [...BOX, ...PAINT, ...TEXT]), ariaHasPopup: time.getAttribute('aria-haspopup') },
      gaps: {
        fieldToToggle: gap(f0, tr[0]), toggleToToggle: gap(tr[0], tr[1]), toggleToStep: gap(tr[1], sr[0]), stepToStep: gap(sr[0], sr[1]),
        searchboxToSeg: gap(R(box), seg0), segToTime: gap(seg0, time0), segButtons: sb.slice(1).map((r, i) => gap(sb[i], r)),
      },
    };
  };

  /** The find controls' state: what must not move, and the lane. */
  L.findState = () => {
    const t = tool(), o = t.getBoundingClientRect(), R = (el) => rel(el, o), f = t.querySelector('.plog__filters');
    const field = f.querySelector('.search'), input = field.querySelector('input'), lane = field.querySelector('.plog__count');
    const buttons = [...f.querySelectorAll('.rove button')], seg = f.querySelector('.seg');
    const described = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    return {
      field: R(field), input: R(input), glyph: R(field.querySelector(':scope > .ic')), lane: R(lane), laneText: lane.textContent, laneTextRect: textRect(lane, o),
      laneStyle: pick(lane, [...TEXT, 'fontVariantNumeric']),
      toggles: buttons.slice(0, 2).map((b) => ({ name: b.getAttribute('aria-label'), rect: R(b), pressed: b.getAttribute('aria-pressed') })),
      steps: buttons.slice(2).map((b) => ({ name: b.getAttribute('aria-label'), rect: R(b) })),
      seg: R(seg), segButtons: [...seg.querySelectorAll('button')].map(R), time: R(f.querySelector(':scope > button')), filters: R(f),
      value: input.value, ariaInvalid: input.getAttribute('aria-invalid'), ariaDescribedby: input.getAttribute('aria-describedby'), describedIsLane: described === lane, describedText: described ? described.textContent : null,
      fieldPaint: pick(field, PAINT), inputPaint: pick(input, PAINT), inputMatchesInvalid: input.matches('[aria-invalid="true"]'), inputFocused: document.activeElement === input,
    };
  };

  /** A paint reading of one element (for a state the caller has set up). */
  L.paintOf = (el) => {
    const t = tool(), o = t.getBoundingClientRect(), cs = getComputedStyle(el), edge = parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : (cs.boxShadow.match(/rgba?\([^)]*\)|color\([^)]*\)/)?.[0] ?? '');
    return { matches: { hover: el.matches(':hover'), focus: el.matches(':focus'), focusVisible: el.matches(':focus-visible') }, rect: rel(el, o), edge, ...pick(el, PAINT) };
  };

  /** The head's box: the union of its visible th cells (the th cells are sticky, the thead is not; the thead would be wherever the table is scrolled to). */
  L.headBox = () => {
    const ths = [...tool().querySelectorAll('.plog__table thead th')].filter(shown).map((th) => th.getBoundingClientRect());
    const x = Math.min(...ths.map((b) => b.x)), y = Math.min(...ths.map((b) => b.y)), right = Math.max(...ths.map((b) => b.right)), bottom = Math.max(...ths.map((b) => b.bottom));
    return { x, y, width: right - x, height: bottom - y, bottom };
  };
  L.box = (b, o) => [r2(b.x - o.x), r2(b.y - o.y), r2(b.width), r2(b.height)];
  /** The rows in view (the rows of the DOM window that intersect the scroll box below the sticky head). */
  L.viewportRows = () => {
    const t = tool(), o = t.getBoundingClientRect(), sc = t.querySelector('.plog__scroll'), sr = sc.getBoundingClientRect(), head = L.headBox();
    const top = Math.max(sr.top, head.bottom), rows = [...t.querySelectorAll('.plog__table tbody > tr[data-n]')].filter((tr) => { const b = tr.getBoundingClientRect(); return b.bottom > top + 0.5 && b.top < sr.bottom - 0.5; });
    const ns = rows.map((tr) => Number(tr.dataset.n)), last = rows[rows.length - 1];
    return { count: rows.length, firstN: ns[0] ?? null, lastN: ns[ns.length - 1] ?? null, ns, first: rows[0] ? rel(rows[0], o) : null, last: last ? rel(last, o) : null, scrollBox: rel(sc, o), headBottom: r2(head.bottom - o.y) };
  };
  L.rowsInDom = () => document.querySelectorAll('.plog__table tbody > tr').length;
  L.activeN = () => { const t = document.querySelector('.plog__table'); const id = t?.getAttribute('aria-activedescendant'); const row = id ? document.getElementById(id) : null; return row ? Number(row.dataset.n) : null; };
  L.selectedNs = () => [...document.querySelectorAll('.plog__table tbody > tr[aria-selected]')].map((tr) => Number(tr.dataset.n));
  L.currentNs = () => [...document.querySelectorAll('.plog__table tbody > tr[data-current]')].map((tr) => Number(tr.dataset.n));
  L.foundCount = () => document.querySelectorAll('.plog__table tbody > tr[data-found]').length;
  L.rowIndex = (n) => { const row = L.rowByN(n); return row ? [...row.parentElement.children].indexOf(row) : null; };

  /** Where the keyboard is, after a key: the list's own state. */
  L.where = (id) => ({
    activeElement: L.describe(document.activeElement), activeN: L.activeN(), selected: L.selectedNs(), current: L.currentNs(), view: L.viewportRows(),
    follow: L.follow(id), scrollTop: r2(document.querySelector('.plog__scroll')?.scrollTop ?? 0), rows: L.rowsInDom(), lane: document.querySelector('.plog__count')?.textContent ?? null, stat: document.querySelector('.ptool__stat')?.textContent ?? null,
  });

  /** A marker row (dropped, cleared, ended, source, gap, reconnect). */
  L.marker = (tr) => {
    const t = tool(), o = t.getBoundingClientRect(), table = tr.closest('table'), to = table.getBoundingClientRect(), R = (el) => rel(el, o), Rt = (el) => rel(el, to);
    const td = tr.querySelector('td'), mark = tr.querySelector('.plog__mark'), text = tr.querySelector('.plog__marktext'), time = tr.querySelector('.plog__marktime'), svg = mark.querySelector('svg'), ic = mark.querySelector('.ic');
    return {
      kind: tr.dataset.kind, n: tr.dataset.n === '' ? null : Number(tr.dataset.n), cls: tr.className, text: text.textContent, time: time ? time.textContent : null, tone: mark.dataset.tone, id: tr.id || null, role: tr.getAttribute('role'),
      rect: R(tr), rectInTable: Rt(tr), td: R(td), tdTable: Rt(td), colspan: td.getAttribute('colspan'), tdStyle: pick(td, [...CELL, 'height']),
      mark: R(mark), markStyle: pick(mark, ['display', 'alignItems', 'justifyContent', 'columnGap', 'gap']), glyph: R(ic ?? svg), glyphSvg: R(svg), glyphStyle: pick(ic ?? svg, ['color', 'width', 'height']),
      textRect: R(text), textStyle: pick(text, [...TEXT, 'overflow', 'textOverflow', 'whiteSpace']), timeRect: R(time), timeStyle: pick(time, [...TEXT, 'fontVariantNumeric']),
    };
  };

  /** The empty text of the list and what is in it. */
  L.empty = () => {
    const t = tool(), o = t.getBoundingClientRect(), R = (el) => rel(el, o), e = t.querySelector('.plog__empty'), tx = e?.querySelector('.plog__emptytext'), b = e?.querySelector('button');
    return {
      hidden: e ? e.hidden : null, rect: R(e), style: pick(e, [...BOX, ...TEXT, 'display', 'flexDirection', 'alignItems']), role: e?.getAttribute('role') ?? null, text: tx ? tx.textContent : null, textRect: R(tx), textStyle: pick(tx, TEXT),
      button: b ? { label: txt(b), rect: R(b), svg: R(b.querySelector('svg')), style: pick(b, [...BOX, ...PAINT, ...TEXT]), action: b.dataset.action ?? null } : null,
      table: R(t.querySelector('.plog__table')), tableRows: t.querySelectorAll('.plog__table tbody > tr').length, head: R(t.querySelector('.plog__table thead')),
    };
  };

  /** The failure banner (.ptool__failure) or the body notice (.ptool__notice). */
  L.notice = (host) => {
    const t = tool(), o = t.getBoundingClientRect(), R = (el) => rel(el, o), h = t.querySelector(host);
    if (!h) return null;
    const n = h.querySelector('.notice'), body = n?.querySelector('.notice__body'), text = n?.querySelector('.pfail__text'), b = text?.querySelector('b'), actions = n?.querySelector('.notice__actions');
    const ic = n?.querySelector('.notice__icon, :scope > .ic, .ic'), svg = n?.querySelector('svg');
    const range = text ? (() => { const r = document.createRange(); r.selectNodeContents(text); const b2 = r.getBoundingClientRect(); return [r2(b2.x - o.x), r2(b2.y - o.y), r2(b2.width), r2(b2.height)]; })() : null;
    const cs = text ? getComputedStyle(text) : null;
    return {
      host: R(h), hostStyle: pick(h, [...BOX, ...PAINT, 'borderTopWidth', 'borderTopColor']),
      notice: R(n), noticeCls: n?.className ?? null, noticeAttrs: n ? Object.fromEntries([...n.attributes].filter((a) => a.name !== 'class').map((a) => [a.name, a.value])) : null, noticeStyle: pick(n, [...BOX, ...PAINT, ...TEXT, 'flexWrap', 'alignItems']),
      role: n?.getAttribute('role') ?? null, tone: n?.dataset.tone ?? n?.getAttribute('data-tone') ?? null,
      icon: R(ic), iconSvg: R(svg), iconStyle: pick(ic, ['color', 'width', 'height', 'backgroundColor']), body: R(body), bodyStyle: pick(body, [...BOX, ...TEXT]),
      text: text ? text.textContent : null, textBox: R(text), textRangeRect: range, textStyle: pick(text, [...TEXT, 'display', 'overflow']), lineClamp: cs ? (cs.webkitLineClamp || cs.lineClamp) : null, textScrollHeight: text ? text.scrollHeight : null, textClientHeight: text ? text.clientHeight : null,
      title: b ? b.textContent : null, titleStyle: pick(b, TEXT),
      actions: R(actions), buttons: n ? [...n.querySelectorAll('.notice__actions button')].map((x) => ({ label: txt(x) || x.getAttribute('aria-label'), rect: R(x), style: pick(x, [...BOX, ...PAINT, ...TEXT]), tabIndex: x.tabIndex })) : [],
    };
  };

  L.facts = () => {
    const t = tool(), f = t.querySelector('.plog__filters'), tb = t.querySelector('.plog__table'), sc = t.querySelector('.plog__scroll'), at = (el, names) => (el ? Object.fromEntries(names.map((n) => [n, el.getAttribute(n)])) : null);
    const input = f.querySelector('.search input'), tr = tb.querySelector('tbody > tr[data-n]');
    return {
      filters: at(f, ['role', 'aria-label']), searchInput: { ...at(input, ['type', 'aria-label', 'placeholder', 'aria-describedby', 'aria-invalid', 'autocomplete', 'spellcheck', 'data-bind']), tag: input.tagName.toLowerCase(), tabIndex: input.tabIndex },
      lane: { tag: f.querySelector('.plog__count').tagName.toLowerCase(), id: f.querySelector('.plog__count').id.replace(/--panel.*$/, ''), role: f.querySelector('.plog__count').getAttribute('role'), ariaLive: f.querySelector('.plog__count').getAttribute('aria-live') },
      rove: at(f.querySelector('.rove'), ['role', 'aria-label', 'data-roving']),
      buttons: [...f.querySelectorAll('.rove button')].map((b) => ({ ...at(b, ['aria-label', 'aria-pressed', 'data-tooltip', 'type']), tabIndex: b.tabIndex, tag: b.tagName.toLowerCase() })),
      seg: { ...at(f.querySelector('.seg'), ['role', 'aria-label']), buttons: [...f.querySelectorAll('.seg button')].map((b) => ({ ...at(b, ['role', 'aria-checked', 'data-tooltip']), label: b.textContent.trim(), tabIndex: b.tabIndex })) },
      time: { ...at(f.querySelector(':scope > button'), ['aria-haspopup', 'type']), label: txt(f.querySelector(':scope > button')) },
      scroll: { ...at(sc, ['role', 'aria-label']), tag: sc.tagName.toLowerCase(), tabIndex: sc.tabIndex, dataset: { ...sc.dataset } },
      table: { ...at(tb, ['role', 'aria-label', 'aria-activedescendant', 'aria-rowcount', 'aria-multiselectable']), tabIndex: tb.tabIndex },
      headers: [...tb.querySelectorAll('thead th')].map((th) => ({ text: th.textContent.trim(), scope: th.getAttribute('scope'), role: th.getAttribute('role'), display: getComputedStyle(th).display })),
      row: { role: tr.getAttribute('role'), tag: tr.tagName.toLowerCase(), ariaSelected: tr.getAttribute('aria-selected'), tabIndex: tr.tabIndex, idShape: tr.id.replace(/log-[0-9a-f]+/, 'log-<id>'), cellRoles: [...tr.children].map((c) => c.getAttribute('role')), cellTags: [...tr.children].map((c) => c.tagName.toLowerCase()) },
      status: { ...at(t.querySelector('.ptool__status'), ['role', 'aria-label']), stat: at(t.querySelector('.ptool__stat'), ['aria-live', 'role']) },
    };
  };

  window.__lv = L;
}

const point = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

async function open(browser, viewport) {
  const context = await browser.newContext({ viewport, timezoneId: 'UTC', locale: 'en-US' });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await sleep(3000);
    await page.waitForFunction(() => typeof Shell !== 'undefined' && Shell.panel?.show !== undefined && Shell.panel.logs !== undefined);
    await sleep(1500);
    await normalizeFont(page, { rootVar: '--int-font-ui' });
    await page.evaluate(install);
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Focuses the list the way the keyboard does (Tab from the Time button, the control before it), so :focus-visible applies in every engine (WebKit does not match it after a scripted focus()). */
async function tabToTable(page) {
  await blur(page);
  await page.evaluate(() => document.querySelector('.plog__filters > button').focus());
  await page.keyboard.press('Tab');
  await sleep(200);
  return page.evaluate(() => document.activeElement === document.querySelector('.plog__table'));
}

/** Closes every log session of the page, so the next one has the bare title (the mock numbers the labels of sessions that share one: `Omniview host logs (5)`). */
const closeAll = (page) => page.evaluate(async () => { for (const s of Shell.panel.sessions.list('logs')) await Shell.panel.sessions.close(s.id, { force: true }); await new Promise((r) => setTimeout(r, 500)); });

/** The probe's session with `count` lines, read once the lines/s rate has decayed to 0.0 (the strip says `0.0 lines/s`). */
async function session(page, { count = 90, mode = 'running', title = 'Omniview host logs', wait = 3800, fresh = false } = {}) {
  if (fresh) await closeAll(page);
  const id = await page.evaluate(([m, t]) => __lv.open(m, t), [mode, title]);
  if (count > 0) await page.evaluate(([i, n]) => __lv.feed(i, 0, n), [id, count]);
  await sleep(wait);
  return id;
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const stat = async (page) => (await page.evaluate(() => document.querySelector('.ptool__stat')?.textContent ?? null));

async function overview(page, id) {
  return page.evaluate((sid) => {
    const L = __lv, out = L.regions();
    out.filters = L.filters();
    const table = L.tool().querySelector('.plog__table'), head = table.querySelector('thead'), o = L.tool().getBoundingClientRect();
    out.head = { rect: L.box(L.headBox(), o), position: getComputedStyle(head.querySelector('th')).position, top: getComputedStyle(head.querySelector('th')).top, cells: [...head.querySelectorAll('th')].map((th) => ({ text: th.textContent.trim(), rect: L.rel(th, o), display: getComputedStyle(th).display, style: L.pick(th, [...L.TEXT, 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'backgroundColor', 'borderBottomWidth', 'borderBottomColor', 'whiteSpace', 'position', 'top']) })), headStyle: L.pick(head.querySelector('tr'), ['height', 'backgroundColor']) };
    out.table = { style: L.pick(table, ['tableLayout', 'borderCollapse', 'borderSpacing', 'width', 'fontFamily', 'fontSize']), cols: [...table.querySelectorAll('thead th')].filter((th) => L.shown(th)).map((th) => [th.textContent.trim(), L.r2(th.getBoundingClientRect().x - table.getBoundingClientRect().x), L.r2(th.getBoundingClientRect().width)]) };
    out.rowsInDom = L.rowsInDom();
    out.rows = [1, 2, 3].map((n) => L.rowDetail(L.rowByN(n)));
    out.levels = Object.fromEntries(['info', 'warn', 'error', 'debug'].map((lv) => {
      const tr = document.querySelector(`.plog__table tbody > tr.plog__row--${lv}`), d = L.rowDetail(tr);
      return [lv, { n: d.n, cls: d.cls, rect: d.rect, trBackground: d.trBackground, trBoxShadow: d.trBoxShadow, firstTdBoxShadow: d.firstTdBoxShadow, firstTdBackground: d.firstTdBackground, levelWordStyle: d.level.wordStyle, glyph: d.level.glyph, glyphStyle: d.level.glyphStyle, tone: d.level.tone, wordText: d.level.wordText }];
    }));
    const ansi = document.querySelector('.plog__a[data-hue]'), arow = ansi?.closest('tr'), tabs = arow ? L.rowDetail(arow) : null;
    out.special = {
      ansi: ansi ? { n: Number(arow.dataset.n), hue: ansi.dataset.hue, text: ansi.textContent, style: L.pick(ansi, [...L.TEXT, 'backgroundColor']), rect: L.rel(ansi, table.getBoundingClientRect()), monoText: tabs.message.monoText, rowRect: tabs.rect } : null,
    };
    // the long line: the 10th row
    const long = L.rowByN(10), ltd = long.lastElementChild, lmono = long.querySelector('.mono'), lp = long.querySelector('span.cell-prose');
    out.special.long = { n: 10, chars: lmono.textContent.length, td: L.rel(ltd, table.getBoundingClientRect()), rowRect: L.rel(long, table.getBoundingClientRect()), tdScrollWidth: ltd.scrollWidth, tdClientWidth: ltd.clientWidth, proseScrollWidth: lp.scrollWidth, proseClientWidth: lp.clientWidth, mono: L.rel(lmono, table.getBoundingClientRect()), tooltip: lp.dataset.tooltip === lmono.textContent, tooltipChars: (lp.dataset.tooltip ?? '').length, whiteSpace: getComputedStyle(ltd).whiteSpace, textOverflow: getComputedStyle(lp).textOverflow };
    out.viewportRows = L.viewportRows();
    out.scrollBackground = getComputedStyle(L.tool().querySelector('.plog__scroll')).backgroundColor;
    out.strip = L.strip();
    out.facts = L.facts();
    out.follow = L.follow(sid);
    return out;
  }, id);
}

/** Each control's rectangles at rest, hover and keyboard focus, as the panel probe does it. */
async function readParts(page, parts) {
  const out = {};
  for (const [name, sel] of Object.entries(parts)) {
    const handle = await page.$(sel);
    // A control that is not there is a measurement that was not taken: the scenario fails, and with it the run, so a reference is never published with a hole in it.
    if (handle === null) throw new Error(`the control ${name} is not on the page (${sel})`);
    out[name] = {};
    for (const state of ['rest', 'hover', 'focus']) {
      await blur(page);
      await page.mouse.move(1, 1);
      if (state === 'hover') {
        const box = await handle.boundingBox();
        const p = point(box);
        await page.mouse.move(p.x, p.y, { steps: 2 });
      } else if (state === 'focus') {
        await page.keyboard.press('Shift');
        await handle.evaluate((el) => el.focus());
      }
      await sleep(250);
      out[name][state] = await handle.evaluate((el) => __lv.paintOf(el));
    }
  }
  await blur(page);
  await page.mouse.move(1, 1);
  return out;
}

const INPUT = '.plog__filters input[type=search]';

async function scenarioList(page) {
  const id = await session(page);
  const out = await overview(page, id);
  return out;
}

async function scenarioFind(page) {
  const id = await session(page, { count: 110 });
  const states = {};
  const read = async (name) => { await sleep(450); states[name] = await page.evaluate(() => __lv.findState()); };
  await read('rest');
  await page.fill(INPUT, 'request');
  await read('match');
  await page.fill(INPUT, 'zzzzqq');
  await read('none');
  await page.evaluate(() => Shell.run('host.logs.regex'));
  await page.fill(INPUT, '(');
  await read('invalid');
  await page.fill(INPUT, '');
  await read('empty');
  // the largest movement of a control between the states, against `rest`
  const flat = (s) => ({ field: s.field, input: s.input, glyph: s.glyph, lane: s.lane, toggle0: s.toggles[0].rect, toggle1: s.toggles[1].rect, step0: s.steps[0].rect, step1: s.steps[1].rect, seg: s.seg, ...Object.fromEntries(s.segButtons.map((r, i) => [`seg${i}`, r])), time: s.time, filters: s.filters });
  const base = flat(states.rest), movement = {};
  let maxMovement = 0;
  for (const [name, s] of Object.entries(states)) {
    for (const [part, rect] of Object.entries(flat(s))) {
      const d = Math.max(...rect.map((v, i) => Math.abs(v - base[part][i])));
      movement[part] = Math.max(movement[part] ?? 0, Math.round(d * 100) / 100);
      maxMovement = Math.max(maxMovement, d);
    }
    void name;
  }
  maxMovement = Math.round(maxMovement * 100) / 100;

  // the pressed toggles: regex on (it is on now), then case on too; then both off for the rest.
  const pressed = {};
  await page.evaluate(() => Shell.run('host.logs.case'));
  await sleep(300);
  pressed.both = await page.evaluate(() => [...document.querySelectorAll('.plog__filters .rove button')].slice(0, 2).map((b) => ({ name: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), ...__lv.paintOf(b) })));
  await page.evaluate(() => Shell.run('host.logs.case'));
  await page.evaluate(() => Shell.run('host.logs.regex'));
  await sleep(300);
  pressed.none = await page.evaluate(() => [...document.querySelectorAll('.plog__filters .rove button')].slice(0, 2).map((b) => ({ name: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), ...__lv.paintOf(b) })));

  // the field's own paint: at rest, focused (the keyboard's), invalid
  const field = {};
  await blur(page);
  field.rest = await page.evaluate(() => __lv.findState());
  await page.keyboard.press('Shift');
  await page.focus(INPUT);
  await sleep(250);
  field.focus = await page.evaluate(() => ({ ...__lv.findState(), inputMatchesFocusVisible: document.querySelector('.plog__filters input[type=search]').matches(':focus-visible'), fieldHasFocusWithin: document.querySelector('.plog__filters .search').matches(':focus-within') }));
  await page.evaluate(() => Shell.run('host.logs.regex'));
  await page.fill(INPUT, '(');
  await sleep(450);
  field.invalidFocus = await page.evaluate(() => __lv.findState());
  await blur(page);
  await sleep(250);
  field.invalid = await page.evaluate(() => __lv.findState());
  await page.fill(INPUT, '');
  await page.evaluate(() => Shell.run('host.logs.regex'));
  await sleep(300);

  const paint = await readParts(page, {
    toggleCase: '.plog__filters .rove button[aria-label="Match case"]',
    toggleRegex: '.plog__filters .rove button[aria-label="Use regular expression"]',
    stepPrevious: '.plog__filters .rove button[aria-label="Previous match"]',
    stepNext: '.plog__filters .rove button[aria-label="Next match"]',
    segActive: '.plog__filters .seg button[aria-checked="true"]',
    segInactive: '.plog__filters .seg button[aria-checked="false"]',
    time: '.plog__filters > button',
  });

  // keys in the field. A fresh query; follow is on, the newest match is current.
  const keys = { enter: [], escape: [] };
  await page.fill(INPUT, 'request');
  await sleep(450);
  await page.focus(INPUT);
  keys.enter.push({ key: '(typed request)', ...(await page.evaluate((sid) => __lv.where(sid), id)) });
  for (const key of ['Enter', 'Enter', 'Enter', 'Shift+Enter', 'Shift+Enter']) {
    await page.keyboard.press(key);
    await sleep(350);
    keys.enter.push({ key, ...(await page.evaluate((sid) => __lv.where(sid), id)) });
  }
  // the Escape key: clears the query, keeps the field; Escape on an empty field returns to the list
  for (const key of ['Escape', 'Escape', 'Escape']) {
    await page.keyboard.press(key);
    await sleep(350);
    keys.escape.push({ key, value: await page.evaluate(() => document.querySelector('.plog__filters input[type=search]').value), ...(await page.evaluate((sid) => __lv.where(sid), id)) });
  }
  return { states, movement, maxMovement, pressed, field, paint, keys };
}

async function scenarioSelected(page) {
  const id = await session(page, { count: 100 });
  const where = () => page.evaluate((sid) => __lv.where(sid), id);
  const out = { sessionStartRows: await page.evaluate(() => __lv.rowsInDom()) };
  await page.evaluate(() => { window.__clip = []; navigator.clipboard.writeText = async (text) => { window.__clip.push(['writeText', text]); }; const exec = document.execCommand.bind(document); document.execCommand = (name, ...rest) => { if (name === 'copy') { window.__clip.push(['execCommand', document.activeElement?.value ?? null]); return true; } return exec(name, ...rest); }; });

  // keys with no row current: ArrowDown on a keyboard-focused list
  const reachedByTab = await tabToTable(page);
  await sleep(200);
  out.noActive = { reachedByTab, before: await where() };
  await page.keyboard.press('ArrowDown');
  await sleep(300);
  out.noActive.afterArrowDown = await where();
  await page.evaluate((sid) => Shell.panel.logs.jump(sid), id);
  await sleep(300);

  // click a visible row: the middle one
  const middle = await page.evaluate(() => { const v = __lv.viewportRows(); return v.ns[Math.floor(v.ns.length / 2)]; });
  const clickRow = async (n) => { const box = await (await page.$(`.plog__table tbody > tr[data-n="${n}"] td:nth-child(4)`)).boundingBox(); const p = point(box); await page.mouse.click(p.x, p.y); await sleep(300); };
  await blur(page);
  await page.mouse.move(1, 1);
  await clickRow(middle);
  const rowRead = (n) => page.evaluate((m) => { const tr = __lv.rowByN(m), cs = (td) => getComputedStyle(td); return { n: m, ariaSelected: tr.getAttribute('aria-selected'), tdBackground: [...tr.children].map((td) => cs(td).backgroundColor), firstTdBoxShadow: cs(tr.firstElementChild).boxShadow, trBackground: cs(tr).backgroundColor, tdColor: cs(tr.lastElementChild).color }; }, n);
  out.click = { middle, after: await where(), row: await rowRead(middle), tableOutline: await page.evaluate(() => __lv.pick(document.querySelector('.plog__table'), ['outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset'])), tableMatches: await page.evaluate(() => ({ focus: document.querySelector('.plog__table').matches(':focus'), focusVisible: document.querySelector('.plog__table').matches(':focus-visible') })) };
  // keyboard focus on the table (focus-visible) with the row selected
  const focusedByTab = await tabToTable(page);
  await sleep(250);
  out.focused = { reachedByTab: focusedByTab, row: await rowRead(middle), tableOutline: await page.evaluate(() => __lv.pick(document.querySelector('.plog__table'), ['outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset'])), tableMatches: await page.evaluate(() => ({ focus: document.querySelector('.plog__table').matches(':focus'), focusVisible: document.querySelector('.plog__table').matches(':focus-visible') })) };
  await blur(page);
  await sleep(250);
  out.unfocused = { row: await rowRead(middle), tableOutline: await page.evaluate(() => __lv.pick(document.querySelector('.plog__table'), ['outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset'])), activeElement: await page.evaluate(() => __lv.describe(document.activeElement)) };

  // hover on a row that is not selected
  const other = await page.evaluate((m) => { const v = __lv.viewportRows(); return v.ns.find((n) => n !== m); }, middle);
  const hbox = await (await page.$(`.plog__table tbody > tr[data-n="${other}"] td:nth-child(4)`)).boundingBox();
  const hp = point(hbox);
  await page.mouse.move(hp.x, hp.y, { steps: 2 });
  await sleep(250);
  out.hover = { n: other, ...(await page.evaluate((n) => { const tr = __lv.rowByN(n), cs = (el) => getComputedStyle(el); return { matches: tr.matches(':hover'), trBackground: cs(tr).backgroundColor, tdBackground: [...tr.children].map((td) => cs(td).backgroundColor), cursor: cs(tr).cursor, tdCursor: cs(tr.lastElementChild).cursor }; }, other)) };
  await page.mouse.move(1, 1);

  // Ctrl+C / Meta+C on the selected row
  await clickRow(middle);
  out.copy = {};
  for (const key of ['Control+c', 'Meta+c']) {
    await page.evaluate(() => { window.__clip.length = 0; });
    await page.keyboard.press(key);
    await sleep(300);
    out.copy[key] = { writes: await page.evaluate(() => window.__clip.slice()), row: await page.evaluate((m) => { const l = __lv.lines(m - 1, 1)[0]; return l; }, middle) };
  }
  // Ctrl+C with the field focused does not copy a line (the field's own copy)
  out.copy.rowText = await page.evaluate((m) => __lv.rowByN(m).innerText, middle);

  // current row paint (a found line), through the find field
  await page.fill(INPUT, 'request');
  await sleep(450);
  await page.focus(INPUT);
  await page.keyboard.press('Enter');
  await sleep(450);
  out.current = await page.evaluate(() => {
    const cur = document.querySelector('.plog__table tbody > tr[data-current]'), found = document.querySelector('.plog__table tbody > tr[data-found]:not([data-current])'), cs = (el) => getComputedStyle(el);
    const paintRow = (tr) => tr && { n: Number(tr.dataset.n), dataset: { ...tr.dataset }, ariaSelected: tr.getAttribute('aria-selected'), tds: [...tr.children].map((td) => ({ boxShadow: cs(td).boxShadow, backgroundColor: cs(td).backgroundColor })), trBoxShadow: cs(tr).boxShadow };
    // ::highlight() paint cannot be read through getComputedStyle (it answers transparent): only the registered names are read; the mock's CSS sets plog-find to --int-warning-bg and plog-find-current to --int-accent.
    return { current: paintRow(cur), found: paintRow(found), registered: typeof CSS !== 'undefined' && CSS.highlights ? [...CSS.highlights.keys()] : null };
  });
  await page.fill(INPUT, '');
  await sleep(450);

  // The keys. Each from a fresh state: follow on, the middle visible row current.
  const keyOut = {};
  const probe = async (key, { startAt = 'middle' } = {}) => {
    await page.evaluate((sid) => Shell.panel.logs.jump(sid), id);
    await sleep(350);
    const n = await page.evaluate((at) => { const v = __lv.viewportRows(); return at === 'last' ? v.lastN : at === 'first' ? v.firstN : v.ns[Math.floor(v.ns.length / 2)]; }, startAt);
    await clickRow(n);
    const before = await where();
    const idxBefore = await page.evaluate((m) => __lv.rowIndex(m), before.activeN);
    await page.keyboard.press(key);
    await sleep(500);
    const after = await where();
    const idxAfter = await page.evaluate((m) => __lv.rowIndex(m), after.activeN);
    return { startAt, before, after, deltaN: after.activeN === null || before.activeN === null ? null : after.activeN - before.activeN, deltaRows: idxAfter === null || idxBefore === null ? null : idxAfter - idxBefore, rowsPerPage: before.view.count };
  };
  for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']) keyOut[key] = await probe(key);
  keyOut['ArrowDown at the last row'] = await probe('ArrowDown', { startAt: 'last' });
  keyOut.Home = await probe('Home');
  keyOut['ArrowUp at the first row (after Home)'] = { before: await where() };
  await page.keyboard.press('ArrowUp');
  await sleep(300);
  keyOut['ArrowUp at the first row (after Home)'].after = await where();
  keyOut.End = await probe('End');
  out.keys = keyOut;
  return out;
}

async function scenarioDropped(page) {
  const id = await session(page, { count: 0, wait: 200 });
  // 10,100 lines in chunks: the buffer keeps 10,000
  await page.evaluate(async (sid) => {
    for (let from = 0; from < 10100; from += 100) { Shell.panel.logs.feed(sid, __lv.lines(from, Math.min(100, 10100 - from))); await new Promise((r) => setTimeout(r, 30)); }
  }, id);
  await sleep(3800);
  const out = { stats: await page.evaluate((sid) => Shell.panel.stats(sid), id), strip: await page.evaluate(() => __lv.strip()), rowsInDom: await page.evaluate(() => __lv.rowsInDom()), markerBeforeHome: await page.evaluate(() => document.querySelectorAll('tr.plog__marker[data-kind="dropped"]').length) };
  out.reachedByTab = await tabToTable(page);
  await page.keyboard.press('Home');
  await sleep(600);
  out.afterHome = { strip: await page.evaluate(() => __lv.strip()), where: await page.evaluate((sid) => __lv.where(sid), id), view: await page.evaluate(() => __lv.viewportRows()) };
  const markerHandle = await page.$('tr.plog__marker[data-kind="dropped"]');
  out.dropped = markerHandle ? await markerHandle.evaluate((tr) => __lv.marker(tr)) : null;
  // the row below the marker (its first line is not n = 101)
  out.firstLineAfterMarker = await page.evaluate(() => { const m = document.querySelector('tr.plog__marker[data-kind="dropped"]'); const next = m?.nextElementSibling; return next ? { n: Number(next.dataset.n), message: next.querySelector('.mono')?.textContent ?? null, rect: __lv.rowDetail(next).rect } : null; });
  out.markerIndexInTbody = await page.evaluate(() => { const m = document.querySelector('tr.plog__marker[data-kind="dropped"]'); return m ? [...m.parentElement.children].indexOf(m) : null; });

  // a `cleared` marker on a session of 20 lines
  const id2 = await session(page, { count: 20, wait: 3800, fresh: true });
  await page.evaluate((sid) => Shell.panel.logs.clear(sid), id2);
  await sleep(600);
  const cleared = await page.$('tr.plog__marker[data-kind="cleared"]');
  out.cleared = cleared ? await cleared.evaluate((tr) => __lv.marker(tr)) : null;
  out.clearedStrip = await page.evaluate(() => __lv.strip());
  out.clearedEmpty = await page.evaluate(() => __lv.empty());
  // a finished log: the `ended` marker and `Stream ended`
  await page.evaluate(() => Shell.panel.logs.build('probe', { name: 'Probe', lines: ['> omniview dev build probe', 'Compiling Go ✓', 'Bundling the UI ✓', 'Built Probe in 1.2 s'] }));
  await sleep(2500);
  const ended = await page.$('tr.plog__marker[data-kind="ended"]');
  out.ended = ended ? await ended.evaluate((tr) => __lv.marker(tr)) : null;
  out.endedStrip = await page.evaluate(() => __lv.strip());
  out.endedRegions = await page.evaluate(() => __lv.regions());
  return out;
}

async function scenarioMarkers(page) {
  // the mock's own host runner session: its streams are random, its markers are what the runner pushes
  await page.evaluate(async () => {
    const target = Shell.panel.targets.list('logs').find((g) => g.plugin === 'host').targets.find((t) => t.id === 'plugin-logs/host');
    window.__host = Shell.panel.logs.open(target);
    await new Promise((r) => setTimeout(r, 3500));
    Shell.run('host.logs.level', { arg: 'all' });
    await new Promise((r) => setTimeout(r, 600));
    Shell.panel.sim.dropSource(window.__host);
  });
  const out = { reconnect: null, gap: null };
  for (let i = 0; i < 80 && (out.reconnect === null || out.gap === null); i++) {
    await sleep(150);
    if (out.reconnect === null) { const h = await page.$('tr.plog__marker[data-kind="reconnect"]'); if (h) out.reconnect = await h.evaluate((tr) => __lv.marker(tr)); }
    if (out.gap === null) { const h = await page.$('tr.plog__marker[data-kind="gap"]'); if (h) out.gap = await h.evaluate((tr) => __lv.marker(tr)); }
  }
  out.strip = await page.evaluate(() => ({ ...__lv.strip(), stat: undefined, statText: document.querySelector('.ptool__stat')?.textContent ?? null }));
  return out;
}

async function scenarioStates(page) {
  const out = {};
  const body = (extra = {}) => page.evaluate((x) => {
    document.getAnimations().forEach((a) => { if (a.effect?.target?.closest?.('.ptool__status, .ptool__operation')) a.cancel(); });
    return { ...__lv.regions(), empty: __lv.empty(), strip: __lv.strip(), filters: { rect: __lv.regions().regions.filters, seg: __lv.filters()?.seg ?? null, field: __lv.filters()?.field ?? null }, failure: __lv.notice('.ptool__failure'), notice: __lv.notice('.ptool__notice'), ...x };
  }, extra);
  // connecting: the producer holds the start for 20 s
  await page.evaluate(() => __lv.open('slow', 'Omniview host logs'));
  await sleep(1300);
  out.connecting = await body();
  // waiting for lines: running, nothing fed
  await session(page, { count: 0, title: 'Omniview host logs', wait: 3800, fresh: true });
  out.waiting = await body();
  // no line matches the filters: twelve info lines, level Error
  const id3 = await session(page, { count: 0, wait: 200, fresh: true });
  await page.evaluate((sid) => Shell.panel.logs.feed(sid, Array.from({ length: 12 }, (_, i) => ({ time: Date.UTC(2026, 0, 15, 10, 0, i), level: 'info', message: `worker ${i} reconciled` }))), id3);
  await sleep(500);
  await page.evaluate(() => Shell.run('host.logs.level', { arg: 'error' }));
  await sleep(3800);
  out.noMatch = await body();
  out.noMatch.seg = await page.evaluate(() => __lv.filters().segButtons.map((b) => ({ label: b.label, checked: b.checked })));
  // ended: twelve lines, then Stop
  const id4 = await session(page, { count: 12, wait: 200, fresh: true });
  await page.evaluate(async (sid) => { await Shell.panel.sessions.stop(sid, { reason: 'user' }); }, id4);
  await sleep(1500);
  out.ended = await body({ sessionState: await page.evaluate((sid) => Shell.panel.sessions.get(sid).state, id4) });
  // failed with lines: twelve lines, then the connection fails
  const id5 = await session(page, { count: 12, wait: 200, fresh: true });
  await page.evaluate((sid) => Shell.panel.sim.fail(sid, 'The connection was refused'), id5);
  await sleep(1500);
  out.failedWithLines = await body({ sessionState: await page.evaluate((sid) => Shell.panel.sessions.get(sid).state, id5) });
  // failed with no lines: the producer refuses to start
  await closeAll(page);
  const id6 = await page.evaluate(() => __lv.open('fail', 'Omniview host logs'));
  await sleep(1500);
  out.failedNoLines = await body({ sessionState: await page.evaluate((sid) => Shell.panel.sessions.get(sid).state, id6) });
  void id6;
  return out;
}

async function scenarioScrolledBack(page) {
  const id = await session(page, { count: 120 });
  const out = { atRest: { strip: await page.evaluate(() => __lv.strip()), follow: await page.evaluate((sid) => __lv.follow(sid), id) } };
  const sc = await page.$('.plog__scroll');
  const p = point(await sc.boundingBox());
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, -420);
  await sleep(500);
  out.scrolledBack = { strip: await page.evaluate(() => __lv.strip()), where: await page.evaluate((sid) => __lv.where(sid), id), jumpPaint: await page.evaluate(() => __lv.paintOf(document.querySelector('.ptool__actions button'))) };
  // new lines while scrolled back
  await page.evaluate((sid) => __lv.feed(sid, 120, 5), id);
  await sleep(3800);
  out.scrolledBackNew = { strip: await page.evaluate(() => __lv.strip()) };
  // hover and keyboard focus of the button
  out.jumpParts = await readParts(page, { jump: '.ptool__actions button' });
  // click it: follow again
  await (await page.$('.ptool__actions button')).click();
  await sleep(500);
  out.afterJump = { strip: await page.evaluate(() => __lv.strip()), where: await page.evaluate((sid) => __lv.where(sid), id), hasButton: (await page.$('.ptool__actions')) !== null };
  // paused
  await page.evaluate(() => Shell.run('host.logs.pause'));
  await sleep(500);
  out.paused = { strip: await page.evaluate(() => __lv.strip()), where: await page.evaluate((sid) => __lv.where(sid), id) };
  await page.evaluate((sid) => __lv.feed(sid, 125, 4), id);
  await sleep(3800);
  out.pausedNew = { strip: await page.evaluate(() => __lv.strip()), where: await page.evaluate((sid) => __lv.where(sid), id) };
  out.resumeParts = await readParts(page, { resume: '.ptool__actions button' });
  return out;
}

const SCENARIO = { list: scenarioList, find: scenarioFind, selected: scenarioSelected, dropped: scenarioDropped, markers: scenarioMarkers, states: scenarioStates, scrolledBack: scenarioScrolledBack };

/** What a scenario must have found, else its reading missed a part. */
const checks = {
  list: (r) => (r.regions.filters === null || r.regions.scroll === null || r.regions.status === null || r.filters === null || r.filters.toggles.length !== 2 || r.filters.steps.length !== 2 || r.filters.segButtons.length !== 4 || r.rows.length !== 3 || r.levels.error.trBoxShadow === undefined || r.special.ansi === null || r.special.long.chars < 400 || r.strip.stat.text === null ? 'misses a region, the filter row, three rows, the ANSI span or the strip' : null),
  find: (r) => (!r.states.match || !/^\d+ of \d+$/.test(r.states.match.laneText) || r.states.none.laneText !== 'No results' || r.states.invalid.laneText !== 'Invalid pattern' || r.states.empty.laneText !== '' || r.states.invalid.ariaInvalid !== 'true' || r.keys.enter.length < 6 || r.keys.escape.length !== 3 ? `lane texts are ${JSON.stringify(Object.fromEntries(Object.entries(r.states).map(([k, v]) => [k, v.laneText])))}` : null),
  selected: (r) => (r.click.after.activeN === null || r.keys.Home.after.activeN !== 1 || r.copy['Control+c'].writes.length === 0 || r.current.current === null ? 'misses a click, a key, a copy or the current row' : null),
  dropped: (r) => (r.dropped === null || r.cleared === null || r.ended === null || r.stats.dropped !== 100 ? `dropped marker ${r.dropped === null ? 'missing' : 'there'}, dropped ${r.stats?.dropped}, cleared ${r.cleared === null ? 'missing' : 'there'}, ended ${r.ended === null ? 'missing' : 'there'}` : null),
  markers: (r) => (r.reconnect === null || r.gap === null ? `reconnect ${r.reconnect === null ? 'missing' : 'there'}, gap ${r.gap === null ? 'missing' : 'there'}` : null),
  states: (r) => (r.connecting.empty.text === null || r.waiting.empty.text !== 'Waiting for lines…' || r.noMatch.empty.text !== 'No lines match the filters.' || r.noMatch.empty.button === null || r.ended.strip.state.text !== 'Stream ended' || r.failedWithLines.failure === null || r.failedNoLines.notice === null ? 'misses the connecting, waiting, no match, ended or failed states' : null),
  scrolledBack: (r) => (!/Scrolled back/.test(r.scrolledBack.strip.stat.text ?? '') || r.scrolledBack.strip.actions === null || r.paused.strip.actions === null || !/Paused/.test(r.paused.strip.stat.text ?? '') ? 'misses Scrolled back, Jump to latest, Paused or Resume' : null),
};

/** Each scenario in a fresh page, closed whatever it reads. */
async function scenario(browser, viewport, name) {
  const page = await open(browser, viewport);
  try {
    page.on('pageerror', (e) => console.log('PAGEERROR', name, e.message));
    return await SCENARIO[name](page);
  } finally {
    await page.context().close();
  }
}

const data = {};
const facts = {};
let failed = false;
// The server this script started (no MOCK_URL) and every browser it launched are closed whatever happens.
try {
  for (const engineName of engineNames) {
    const browser = await launch(engineName);
    try {
      data[engineName] = {};
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        data[engineName][viewportName] = {};
        for (const name of scenarioNames) {
          let result = null, problem = null;
          try {
            result = await scenario(browser, viewport, name);
            problem = checks[name](result);
          } catch (error) {
            problem = `threw: ${error.message.split('\n')[0]}`;
          }
          if (problem !== null) { console.log('MISSING', engineName, viewportName, name, problem); failed = true; }
          data[engineName][viewportName][name] = result;
          if (name === 'list' && viewportName === '1440x900' && result) { (facts[engineName] ??= {}).list = result.facts; }
          console.log(engineName, viewportName, name, problem === null ? 'ok' : 'FAILED', `${Math.round((Date.now() - started) / 1000)}s`);
        }
        // the facts are read once per engine; the list's own copies would repeat in every viewport
        for (const vp of Object.values(data[engineName])) if (vp.list) delete vp.list.facts;
      }
    } finally {
      await browser.close();
    }
  }

  // The facts: identical in both engines, so they are stored once.
  const perEngine = Object.fromEntries(Object.entries(facts).map(([engine, f]) => [engine, f.list]));
  const values = Object.values(perEngine);
  let factsOut = values[0] ?? null;
  const ids = (v) => JSON.stringify(v).replace(/log-[0-9a-f]{8}/g, 'log-<id>');
  if (values.length > 1 && ids(values[0]) !== ids(values[1])) { console.log('FACTS differ between the engines: kept per engine'); factsOut = perEngine; }

  // What differs between two runs (measured: runs of this script compared leaf by leaf; nothing else differs).
  const random = [
    'markers.reconnect / markers.gap: `n`, `id`, `time`, the row\'s y (rect, td, rectInTable: the number of random host lines before it), the gap text ("Reconnected to host after <N> s", N = 3 to 6) and markers.strip.statText (line count, lines/s). The host runner generates lines about every 100 ms.',
    'Every marker row\'s x of glyph, glyphSvg, textRect and timeRect (dropped.cleared, dropped.ended, markers.*): the row is centered and its clock text is the wall time of the run, whose width moves with its digits (up to ~0.5 px). `dropped.dropped` has no clock, so it does not move.',
  ];
  const notes = [
    'Rectangles [x, y, w, h] in px, 0.01, relative to the .ptool--logs element\'s top-left; the tool\'s own viewport rectangle is `tool.abs`. Rows and markers are relative to .plog__table (see the header of mock-log-measure.mjs).',
    'The list is read at the mock\'s default panel height (no resize): the scroll box shows about 6 rows. Keys are therefore recorded against a small viewport (PageUp/PageDown move rows-in-view minus one).',
    'All scenarios but `markers` run on the probe\'s own producer (one source `probe`, so the Source column and chips are hidden as the host target\'s single source hides them); `markers` runs on plugin-logs/host with level All.',
    'A finished log (Shell.panel.logs.build) says `End of <label> output` in an `ended` marker; its session ends at once (Stream ended). `source` markers (toggling a source in a multi-source session) were not read.',
    'Highlights: ::highlight(plog-find) / ::highlight(plog-find-current) paint cannot be read through getComputedStyle (it answers transparent in both engines), so only the registered names are recorded (selected.current.registered); the mock\'s CSS sets them to --int-warning-bg and (with --int-fg-over-accent text) --int-accent.',
    'The list is focused by Tab (from the Time button) wherever :focus-visible matters: in WebKit a scripted focus() does not match :focus-visible. `reachedByTab` says whether Tab landed on .plog__table. A click is a mouse focus: :focus-visible does not match (both engines) and the selected row stays on the inactive selection colour.',
    'Session ids are random per run; the file replaces every `log-<8 hex>` with `log-<id>`.',
  ];
  const note = `Measured from the design lab mock, tree ${MOCK_TREE}, on ${new Date().toISOString().slice(0, 10)}. Mock default context (no text scale, default density), font normalized (--int-font-ui: Helvetica, Arial, sans-serif), UTC, en-US, the panel at its default height, the probe's own log producer (not the host's random streams) except in \`markers\`.`;
  const text = `${JSON.stringify({ mockTree: MOCK_TREE, note, viewports: VIEWPORTS, random, notes, data, facts: factsOut }).replace(/log-[0-9a-f]{8}/g, 'log-<id>')}\n`;
  // The reference is replaced only by a complete measurement of the approved tree: a run that missed a scenario, a narrowed one, or one that cannot show that the mock is the tree the
  // file is labelled with (`mockIdentity`) leaves it as it was and writes what it read to the temp directory, for diagnosis.
  const file = failed || partial || !identity.ok ? path.join(tmpdir(), 'mock-log.failed.json') : path.join(here, 'mock-log.json');
  writeFileSync(file, text);
  console.log('wrote', file, statSync(file).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
  if (failed) { console.log('FAILED: a scenario misses a part: mock-log.json is unchanged'); process.exitCode = 1; }
  else if (partial) console.log('narrowed run (ENGINES/SCENARIOS): mock-log.json is unchanged');
  else if (!identity.ok) { console.log(`the mock is not shown to be tree ${MOCK_TREE} (${identity.why}): mock-log.json is unchanged`); process.exitCode = 1; }
} finally {
  server?.kill();
}

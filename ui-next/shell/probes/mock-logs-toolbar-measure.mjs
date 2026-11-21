// Measures the design mock's Logs tool VERTICAL TOOLBAR (the `.panel__tools` column of the bottom panel): the REFERENCE the host's Logs toolbar (step P1b-4a) is drawn to.
//
// What it measures, per engine (webkit, chromium) and viewport (1440x900, 1280x800), every scenario in a FRESH page, with the mock's default context (no text scale, default density, default theme;
// the UI font normalized as probe-lib's normalizeFont does for the other probes; the page runs in UTC and en-US). The page is the mock's own start screen. Lines are fed to a session of the probe's OWN
// producer (`probe.logs`, registered through Shell.panel.producers.register, one source, `running` at once; modes `slow` (connecting for 120 s, longer than any scenario that uses it) and `fail` serve `facts`) through Shell.panel.logs.feed
// with fixed times, levels and messages, so the list is exactly what the probe made (the same 90 lines as mock-log-measure.mjs). The mock's panel is at its DEFAULT height unless a scenario says so.
// At the default height the body is 229 px (1440x900) / 199 px (1280x800) tall and holds 7 / 6 slots of 32 px: the toolbar keeps 6 / 5 buttons and puts the rest behind `More actions` (see `slots`).
// A scenario that needs a button behind `More actions` (Copy, Export, Filter, the three session buttons) raises the panel with the splitter's keyboard (`End`) and says `panel: 'tall'`.
//   - rest:       a running session with 90 lines, follow on, not paused, the lines/s rate decayed to 0.0 (3.8 s), default panel height: the rectangles of the body, the column, the content, the
//                 tool and of EVERY button in DOM order (viewport and relative to `.panel__body`), the toolbar's attributes, the slot arithmetic (`toolSlots`: which buttons are shown, which are
//                 behind `More actions`), the column's computed style and each button's computed style (Follow pressed, the others not). WebKit also writes the screenshots (see SHOTS).
//   - states:     tall panel: the toolbar after Pause pressed (and lines fed while paused), Pause off, Follow off (Scrolled back), Follow on, Copy confirming (sampled at 0.2 / 1.0 / 2.2 s: the
//                 glyph swap and its revert), hover / pressed (mouse down, no click) / keyboard-focus paint, then a session that has not started (`connecting`: `There are no lines yet`) and one that
//                 has ended (Stop: Pause `The stream has ended`): every button's aria-disabled and tooltip reason, the paint of a disabled button.
//   - tooltips:   the REAL pointer (page.mouse.move) on each button, wait for `#app-tooltip`, its text, parts and rectangle relative to the button: default height (6 buttons + `More actions` at 1440x900, 5 at 1280x800),
//                 tall (all 12), tall on a connecting session (the reasons), tall on an ended session (Pause).
//   - keys:       real key presses through the toolbar (default and tall panel): Tab in, ArrowDown x3, ArrowUp, Home, End, ArrowLeft, ArrowRight, Enter and Space on Follow and on Wrap lines,
//                 Tab out, Shift+Tab back and out. After each key: the focused element, every button's tabindex, the pressed buttons, the open tooltip. `tabStops`: how many buttons have tabindex 0.
//   - behaviour:  1440x900 only (the other viewport says `skipped`). (a) pause: 5 lines every 200 ms for 2 s while paused (strip text, rows, scroll over time), Resume, Follow while paused,
//                 Pause while follow is off. (b) clear: 10,100 lines (older lines dropped), Clear, the strip, the rows (marker kind and text), the next lines. (c) copy: the clipboard text (intercepted
//                 `navigator.clipboard.writeText` / `document.execCommand('copy')`) with all lines, with a level filter, after a Clear; the live region; the glyph. (d) palette: Follow / Pause / Clear / Copy.
//   - short:      the panel at its minimum height (splitter Home) and at 200 px (Home, then 5 x ArrowUp of 16 px): which buttons are shown, the `More actions` rect and tooltip, scrollHeight vs
//                 clientHeight, clipped buttons, the menu `More actions` opens; a sweep of the heights between the minimum and the default; the maximum height (End) with all 12 buttons.
//   - facts:      session states (connecting, failed, failed with lines, no session), focus after a press (is the node replaced), what Follow does to the scroll position, disabled buttons under the
//                 pointer and the keyboard, what each remaining button does (Wrap, Display, Jump, Filter, Export), the maximized panel.
//
// Serve the mock first or let the script do it: without MOCK_URL it serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) from a CommonJS copy of its server.js with `root` set, on the first
// free port from 49475 (see mock-panel-measure.mjs).
// Run:  node ui-next/shell/probes/mock-logs-toolbar-measure.mjs   (ENGINES=chromium, VIEWPORTS=1440x900 or SCENARIOS=rest,keys narrow a run: then nothing is written to the repo, the JSON goes to the temp directory)
// Writes mock-logs-toolbar.json (and, with webkit's `rest`, the screenshots under SHOTS). Exits non-zero when a scenario misses a part; the JSON is then not replaced (what it read goes to the temp directory).
// SHOTS: /Users/joshuapare/Notes/omniview/ui-migration/status/P1b-4a-assets/ (SHOTS_DIR overrides): mock-logs-webkit-<viewport>.png (the whole window, the panel open on Logs with a running session
// and 90 lines, default theme) and mock-logs-body-webkit-<viewport>.png (a crop of `.panel__body`).
//
// mock-logs-toolbar.json: { mockTree, note, viewports, buttonOrder, random, notes, data: { <engine>: { <viewport>: { rest, states, tooltips, keys, behaviour, short, facts } } } }
// COORDINATES: every rectangle is [x, y, w, h] in px, 0.01 precision. `abs` is in VIEWPORT coordinates (the window's top-left is 0,0); `rel` is relative to the top-left of `.panel__body`; `relTools`
// is relative to `.panel__tools`; a tooltip's `relButton` is relative to its button. null: the part is not laid out (display: none, or absent).
//   rest: { panel, body: {abs,rel}, tools, content, tool, header, toolbar: { role, ariaOrientation, ariaLabel, dataRoving, dataRovingKey, tag, cls }, slots: { bodyHeight, slotsFor, shown, labelsShown,
//           behindMore, more }, toolsStyle, toolsScroll, buttons: [{ i, label, abs, rel, relTools, svg, svgDigest, ariaPressed, ariaDisabled, ariaHaspopup, ariaExpanded, tabindex, idPrefix, id,
//           action, tooltip: { text, keys, reason }, cls, style }], stat, strip }
//   Every other scenario is a plain object of texts, snapshots (`snap`: the strip text, the buttons' label / pressed / disabled / reason / tabindex / glyph digest) and rectangles; see the code.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const ALL_SCENARIOS = ['rest', 'states', 'tooltips', 'keys', 'behaviour', 'short', 'facts'];
const SHOTS = process.env.SHOTS_DIR ?? '/Users/joshuapare/Notes/omniview/ui-migration/status/P1b-4a-assets';
/** The order of the mock's Logs toolbar (shell-panel.js logsToolbar + genericToolbar). */
const BUTTON_ORDER = ['Follow', 'Pause log updates', 'Wrap lines', 'Display options', 'Jump to time', 'Clear', 'Filter', 'Copy', 'Export', 'Stop session', 'Reconnect session', 'Inspect session'];
const names = (key, all) => (process.env[key] ?? all.join(',')).split(',');
const engineNames = names('ENGINES', Object.keys(ENGINES));
const viewportNames = names('VIEWPORTS', Object.keys(VIEWPORTS));
const scenarioNames = names('SCENARIOS', ALL_SCENARIOS);
for (const [what, list, known] of [['ENGINES', engineNames, Object.keys(ENGINES)], ['VIEWPORTS', viewportNames, Object.keys(VIEWPORTS)], ['SCENARIOS', scenarioNames, ALL_SCENARIOS]]) {
  const unknown = list.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`${what} names ${unknown.join(', ')}, which is not one of ${known.join(', ')}`);
}
/** Every known name exactly once: only a run that is complete may write into the repo. */
const eachOnce = (list, known) => list.length === known.length && known.every((name) => list.filter((entry) => entry === name).length === 1);
const partial = !eachOnce(engineNames, Object.keys(ENGINES)) || !eachOnce(viewportNames, Object.keys(VIEWPORTS)) || !eachOnce(scenarioNames, ALL_SCENARIOS);
const started = Date.now();
const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';

/**
 * Whether the mock this run measures is the tree the reference is labelled with (same rule as mock-log-measure.mjs): the directory is in a git work tree whose HEAD holds MOCK_TREE at that
 * directory, no file of it changed or untracked, and this script serves it itself. A run that cannot show it writes to the temp directory.
 */
function mockIdentity() {
  if (process.env.MOCK_URL !== undefined) return { ok: false, why: `MOCK_URL names a server of your own, whose files cannot be read, so it cannot be shown to be tree ${MOCK_TREE}` };
  try {
    const git = (...args) => execFileSync('git', ['-C', MOCK_DIR, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const tree = git('rev-parse', 'HEAD:./');
    if (tree !== MOCK_TREE) return { ok: false, why: `${MOCK_DIR} holds tree ${tree} at HEAD, not ${MOCK_TREE}` };
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
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory, on the first port that is free (a server that stays up for 1.5 s).
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-logs-toolbar-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  for (let port = 49475; port < 49495 && server === null; port++) {
    const child = spawn(process.execPath, [copy], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    await sleep(1500);
    if (child.exitCode === null) { server = child; url = `http://127.0.0.1:${port}/`; } else console.log(`port ${port} is taken`);
  }
  if (server === null) throw new Error('no free port from 49475 to 49494 for the mock server');
  console.log('serving the mock at', url);
}

/** Page side (self-contained: it is serialized into the page): the probe's producer and the readers. Installs window.__tb. */
function install() {
  const T = (window.__tb = {});
  const r2 = (v) => Math.round(v * 100) / 100;
  const shown = (el) => el instanceof Element && el.getClientRects().length > 0;
  const rect = (el, o = { x: 0, y: 0 }) => { if (!shown(el)) return null; const b = el.getBoundingClientRect(); return [r2(b.x - o.x), r2(b.y - o.y), r2(b.width), r2(b.height)]; };
  const pick = (el, props) => { if (!el) return null; const cs = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, cs[p]])); };
  const norm = (s) => (s == null ? null : s.replace(/[\s\u200b]+/g, ' ').trim());
  T.rect = rect; T.pick = pick; T.shown = shown;

  // The probe's producer: one source, running at once. mode: 'running' | 'slow' (connecting for 20 s) | 'fail' (refuses to start).
  Shell.panel.producers.register({
    id: 'probe.logs', kinds: ['logs'],
    start: async ({ sink, target }) => {
      sink.sources([{ id: 'probe/app', label: 'probe', detail: 'probe' }]);
      if (target.mode === 'fail') throw Object.assign(new Error('probe start rejected'), { sessionCause: 'The probe producer refused to start' });
      if (target.mode === 'slow') { setTimeout(() => sink.state({ state: 'running' }), 120000); return { slow: true }; }
      sink.state({ state: 'running' });
      return { ok: true };
    },
    stop: async () => ({ acknowledged: true }), reconnect: async () => ({ ok: true }), dispose: async () => undefined,
  });
  T.open = async (mode, title = 'Omniview host logs') => {
    const id = Shell.panel.logs.open({ id: `probe/${mode}`, producer: 'probe.logs', kind: 'probe', label: title, title, mode });
    const want = mode === 'slow' ? 'connecting' : mode === 'fail' ? 'failed' : 'running';
    for (let i = 0; i < 100 && Shell.panel.sessions.get(id)?.state !== want; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 400));
    T.sid = id;
    return id;
  };
  // Deterministic lines (the list of mock-log-measure.mjs): level cycle of 10; line 3 has an ANSI hue span; line 9 is 450+ chars; every third line says 'request'.
  const LV = ['info', 'warn', 'error', 'info', 'debug', 'info', 'warn', 'info', 'debug', 'info'];
  const BASE = Date.UTC(2026, 0, 15, 10, 0, 0);
  T.lines = (from, count) => Array.from({ length: count }, (_, k) => {
    const i = from + k;
    let message = i % 3 === 0 ? `request ${i} served in ${10 + (i * 7) % 90} ms` : `worker ${i % 5} reconciled ${i} objects`;
    if (i === 3) message = `Applied \u001b[33mretry budget\u001b[0m to upstream ${i}`;
    if (i === 9) message = `request ${i} ${'very-long-message-segment '.repeat(18)}end`;
    return { time: BASE + i * 1013, level: LV[i % 10], message };
  });
  T.feed = (id, from, count) => Shell.panel.logs.feed(id, T.lines(from, count));
  T.closeAll = async () => { for (const s of Shell.panel.sessions.list('logs')) await Shell.panel.sessions.close(s.id, { force: true }); await new Promise((r) => setTimeout(r, 500)); };

  T.view = () => document.querySelector('#panel-body > .panel__view:not([hidden])');
  T.tools = () => T.view()?.querySelector(':scope > .panel__tools') ?? null;
  T.buttons = () => (T.tools() ? [...T.tools().querySelectorAll('button')] : []);
  T.btn = (label) => T.buttons().find((b) => b.getAttribute('aria-label') === label) ?? null;
  T.cfg = (id = T.sid) => Shell.get(['panel', 'ui', 'logs', id]) ?? null;
  T.region = (el) => (!el ? null : el.closest('.panel__tools') ? 'toolbar' : el.closest('.toolheader') ? 'panel header' : el.closest('.plog__filters') ? 'filter row' : el.closest('.plog__table') ? 'table' : el.closest('.ptool__status') ? 'strip' : el.closest('.panel__content') ? 'content' : el.closest('#shell-panel') ? 'panel' : el === document.body ? 'body' : el.closest('.dlg') ? 'dialog' : el.closest('[role=menu]') ? 'menu' : 'other');
  T.describe = (el) => (!el ? null : { tag: el.tagName.toLowerCase(), label: el.getAttribute('aria-label'), text: norm(el.textContent)?.slice(0, 40) || null, cls: typeof el.className === 'string' ? el.className.trim() : null, id: el.id ? el.id.split('--panel-')[0] : null, tabindex: el.getAttribute('tabindex'), region: T.region(el), focusVisible: el.matches(':focus-visible') });
  // a short name of a glyph: its shapes (the serialized attribute order of a re-drawn glyph differs, so the markup is not compared), and the path data of a single-path glyph (the check mark)
  T.digest = (svg) => { if (!svg) return null; const kids = [...svg.querySelectorAll('*')]; return kids.length === 1 ? `${kids[0].tagName.toLowerCase()}:${kids[0].getAttribute('d')}` : kids.map((k) => k.tagName.toLowerCase()).join('+'); };

  const BTN_STYLE = ['display', 'boxSizing', 'width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'backgroundColor', 'color', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'boxShadow', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'opacity', 'cursor', 'flexShrink', 'transitionProperty', 'transitionDuration'];
  const TOOLS_STYLE = ['display', 'flexDirection', 'alignItems', 'justifyContent', 'rowGap', 'columnGap', 'width', 'height', 'minHeight', 'flexGrow', 'flexShrink', 'flexBasis', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'overflowX', 'overflowY', 'scrollbarWidth', 'backgroundColor', 'borderTopWidth', 'borderRightWidth', 'borderRightStyle', 'borderRightColor', 'borderLeftWidth', 'boxShadow', 'position'];
  T.paint = (b) => (b ? { ...pick(b, BTN_STYLE), svgColor: b.querySelector('svg') ? getComputedStyle(b.querySelector('svg')).color : null, svgStroke: b.querySelector('svg') ? getComputedStyle(b.querySelector('svg')).stroke : null, focusVisible: b.matches(':focus-visible'), hover: b.matches(':hover') } : null);

  /** One button in full. */
  T.button = (b, i, bo, to) => {
    const svg = b.querySelector('svg');
    return {
      i, label: b.getAttribute('aria-label'), abs: rect(b), rel: rect(b, bo), relTools: rect(b, to), svg: rect(svg), svgRel: rect(svg, bo), svgDigest: T.digest(svg), svgAttrs: svg ? { viewBox: svg.getAttribute('viewBox'), width: svg.getAttribute('width'), height: svg.getAttribute('height'), cls: svg.getAttribute('class') } : null,
      ariaPressed: b.getAttribute('aria-pressed'), ariaDisabled: b.getAttribute('aria-disabled'), ariaHaspopup: b.getAttribute('aria-haspopup'), ariaExpanded: b.getAttribute('aria-expanded'), disabledProp: b.disabled,
      tabindex: b.getAttribute('tabindex'), tag: b.tagName.toLowerCase(), type: b.getAttribute('type'), idPrefix: b.id ? b.id.split('--panel-')[0] : null, id: b.id ? b.id.replace(/log-[0-9a-f]{8}/g, 'log-<id>') : null,
      action: b.dataset.action ?? null, tooltip: { text: b.getAttribute('data-tooltip'), keys: b.getAttribute('data-tooltip-keys'), reason: b.getAttribute('data-tooltip-reason') }, ariaDescribedby: b.getAttribute('aria-describedby'),
      cls: b.className.trim(), text: norm(b.textContent), style: T.paint(b),
    };
  };

  /** Everything `rest` records. */
  T.read = () => {
    const body = document.querySelector('.panel__body'), bo = body.getBoundingClientRect(), view = T.view(), tools = T.tools(), content = view?.querySelector(':scope > .panel__content'), tool = view?.querySelector('.ptool--logs');
    const part = (el) => (el ? { abs: rect(el), rel: rect(el, bo) } : null);
    const to = tools ? tools.getBoundingClientRect() : { x: 0, y: 0 };
    const buttons = T.buttons().map((b, i) => T.button(b, i, bo, to));
    const more = buttons.find((b) => b.label === 'More actions') ?? null;
    const real = buttons.filter((b) => b.label !== 'More actions');
    const bodyHeight = bo.height;
    return {
      panel: part(document.getElementById('shell-panel')), header: part(document.querySelector('#shell-panel .toolheader')), body: part(body), view: part(view), tools: part(tools), content: part(content), tool: part(tool),
      toolbar: tools ? { tag: tools.tagName.toLowerCase(), cls: tools.className.trim(), role: tools.getAttribute('role'), ariaOrientation: tools.getAttribute('aria-orientation'), ariaLabel: tools.getAttribute('aria-label'), dataRoving: tools.getAttribute('data-roving'), dataRovingKey: (tools.getAttribute('data-roving-key') ?? '').replace(/log-[0-9a-f]{8}/g, 'log-<id>'), tabindex: tools.getAttribute('tabindex'), childCount: tools.children.length, childTags: [...tools.children].map((c) => c.tagName.toLowerCase()) } : null,
      slots: { bodyHeight: r2(bodyHeight), pitch: 32, pad: 4, slotsFor: Math.max(0, Math.floor((bodyHeight - 4) / 32)), shown: real.length, labelsShown: real.map((b) => b.label), more: more ? { abs: more.abs, rel: more.rel, relTools: more.relTools, tooltip: more.tooltip, ariaHaspopup: more.ariaHaspopup, ariaExpanded: more.ariaExpanded, action: more.action, tabindex: more.tabindex } : null },
      toolsStyle: pick(tools, TOOLS_STYLE),
      toolsScroll: tools ? { scrollHeight: tools.scrollHeight, clientHeight: tools.clientHeight, scrollTop: tools.scrollTop, offsetWidth: tools.offsetWidth, clientWidth: tools.clientWidth, scrollbarWidth: tools.offsetWidth - tools.clientWidth } : null,
      paint: { shellPanel: pick(document.getElementById('shell-panel'), ['backgroundColor', 'borderTopWidth', 'borderTopColor']), body: pick(body, ['backgroundColor']), view: pick(view, ['backgroundColor']), content: pick(content, ['backgroundColor']), tool: pick(tool, ['backgroundColor']) },
      contentStyle: pick(content, ['display', 'flexGrow', 'flexShrink', 'flexBasis', 'minWidth', 'minHeight', 'overflowX', 'overflowY', 'paddingLeft', 'paddingTop']),
      viewStyle: pick(view, ['display', 'flexDirection', 'flexGrow', 'columnGap', 'rowGap']),
      buttons, stat: norm(document.querySelector('.ptool__stat')?.textContent), tabStops: buttons.filter((b) => b.tabindex === '0').length,
    };
  };

  /** A compact snapshot: the strip, the buttons' state, the config, the live region. */
  T.snap = () => ({
    stat: norm(document.querySelector('.ptool__stat')?.textContent), action: norm(document.querySelector('.ptool__actions button')?.textContent), cfg: T.cfg(),
    buttons: T.buttons().map((b) => ({ label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), disabled: b.getAttribute('aria-disabled'), reason: b.getAttribute('data-tooltip-reason'), tabindex: b.getAttribute('tabindex'), glyph: T.digest(b.querySelector('svg')) })),
    live: norm(document.getElementById('shell-live')?.textContent), shownButtons: T.buttons().filter((b) => b.getAttribute('aria-label') !== 'More actions').length,
  });
  T.rowsInfo = () => {
    const rows = [...document.querySelectorAll('.plog__table tbody > tr')], data = rows.filter((r) => r.dataset.n !== undefined), sc = document.querySelector('.plog__scroll');
    return {
      count: rows.length, firstN: data.length ? Number(data[0].dataset.n) : null, lastN: data.length ? Number(data[data.length - 1].dataset.n) : null,
      scroll: sc ? { top: r2(sc.scrollTop), height: sc.scrollHeight, client: sc.clientHeight, atEnd: sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2 } : null,
    };
  };
  T.obs = () => ({ ...T.snap(), rows: T.rowsInfo(), stats: (() => { try { return JSON.parse(JSON.stringify(Shell.panel.stats(T.sid))); } catch { return null; } })() });
  T.rowList = (n = 8) => [...document.querySelectorAll('.plog__table tbody > tr')].slice(0, n).map((tr) => ({ n: tr.dataset.n ?? null, cls: tr.className.trim(), kind: tr.dataset.kind ?? null, text: norm(tr.textContent) }));
  T.tipNow = () => {
    const h = document.getElementById('app-tooltip');
    if (!h) return null;
    const open = h.matches(':popover-open'), cs = getComputedStyle(h);
    return {
      open, text: open ? norm(h.textContent) : null, label: open ? norm(h.querySelector('.tooltip__row')?.firstElementChild?.textContent ?? h.textContent) : null, keys: open ? h.querySelector('.tooltip__keys')?.textContent ?? null : null, reason: open ? h.querySelector('.tooltip__reason')?.textContent ?? null : null,
      abs: open ? rect(h) : null, placement: h.dataset.placement ?? null,
      style: open ? { backgroundColor: cs.backgroundColor, color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight, paddingTop: cs.paddingTop, paddingLeft: cs.paddingLeft, borderRadius: cs.borderTopLeftRadius, boxShadow: cs.boxShadow, maxWidth: cs.maxWidth, borderTopWidth: cs.borderTopWidth, borderTopColor: cs.borderTopColor } : null,
    };
  };
  T.menuNow = () => {
    const m = [...document.querySelectorAll('[role=menu]')].find(shown);
    if (!m) return null;
    return { abs: rect(m), label: m.getAttribute('aria-label'), id: m.id || null, items: [...m.querySelectorAll('[role^=menuitem]')].map((i) => ({ text: norm(i.textContent), role: i.getAttribute('role'), checked: i.getAttribute('aria-checked'), disabled: i.getAttribute('aria-disabled'), keys: i.querySelector('kbd')?.textContent ?? null, icon: !!i.querySelector('svg'), reason: i.getAttribute('data-tooltip-reason') })) };
  };
  T.keyState = () => {
    const tip = T.tipNow();
    return { active: T.describe(document.activeElement), tabs: T.buttons().map((b) => b.getAttribute('tabindex')).join(' '), pressed: Object.fromEntries(T.buttons().filter((b) => b.hasAttribute('aria-pressed')).map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])), tip: tip?.open ? tip.text : null, stat: norm(document.querySelector('.ptool__stat')?.textContent) };
  };
  /** The control the Tab order has just before the toolbar's tab stop (the focusable the Tab key leaves for the toolbar). */
  T.beforeToolbar = () => {
    const all = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length > 0 && !e.closest('[inert],[hidden]'));
    const first = all.find((e) => e.closest('.panel__tools') && e.tabIndex === 0), i = all.indexOf(first);
    document.querySelectorAll('[data-probe-prev]').forEach((e) => e.removeAttribute('data-probe-prev'));
    if (i < 1) return { i, prev: null };
    all[i - 1].setAttribute('data-probe-prev', '');
    return { i, prev: T.describe(all[i - 1]), around: all.slice(Math.max(0, i - 3), i + 4).map((e) => T.describe(e)) };
  };
  T.panelNow = () => { const p = document.getElementById('shell-panel'), b = document.querySelector('.panel__body'); return { panel: rect(p), body: rect(b), handle: (() => { const h = document.querySelector('.app > .splitter[data-handle="panel"]'); return h ? { now: h.getAttribute('aria-valuenow'), min: h.getAttribute('aria-valuemin'), max: h.getAttribute('aria-valuemax'), text: h.getAttribute('aria-valuetext') } : null; })() }; };
}

const point = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const AWAY = { x: 720, y: 250 };
const BTN = (label) => `#panel-body > .panel__view:not([hidden]) .panel__tools button[aria-label="${label}"]`;
const ev = (page, fn, arg) => page.evaluate(fn, arg);

/** The init script of the copy reading: every write to the clipboard is kept in window.__clip (by either route the mock tries) and still answers as the browser would. */
const CLIP_INIT = () => {
  window.__clip = [];
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__clip.push({ via: 'navigator.clipboard.writeText', text: String(text) }); } } }); } catch { /* kept as is */ }
  const exec = document.execCommand.bind(document);
  document.execCommand = (command, ...rest) => {
    if (command === 'copy') { const el = document.activeElement; window.__clip.push({ via: "document.execCommand('copy')", text: el && 'value' in el ? el.value : String(getSelection()) }); }
    return exec(command, ...rest);
  };
};

async function open(browser, viewport) {
  const context = await browser.newContext({ viewport, timezoneId: 'UTC', locale: 'en-US' });
  try {
    await context.addInitScript(CLIP_INIT);
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

/** A session of the probe's producer with `count` lines, read once the lines/s rate has decayed to 0.0. */
async function session(page, { count = 90, mode = 'running', wait = 3800, fresh = false } = {}) {
  if (fresh) await ev(page, () => __tb.closeAll());
  const id = await ev(page, (m) => __tb.open(m), mode);
  if (count > 0) await ev(page, ([i, n]) => __tb.feed(i, 0, n), [id, count]);
  await sleep(wait);
  return id;
}
/** The panel's splitter by the keyboard (Home: minimum, End: maximum, ArrowUp: 16 px larger (the panel follows the handle)); the handle gives the focus back. */
async function resizePanel(page, keys) {
  await ev(page, () => document.querySelector('.app > .splitter[data-handle="panel"]').focus());
  for (const key of keys) { await page.keyboard.press(key); await sleep(120); }
  await sleep(700);
  await ev(page, () => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(AWAY.x, AWAY.y);
  return ev(page, () => __tb.panelNow());
}
const tall = (page) => resizePanel(page, ['End']);
const click = async (page, label, pause = 350) => { await (await page.$(BTN(label))).click(); await sleep(pause); };
const away = async (page) => { await page.mouse.move(AWAY.x, AWAY.y); await sleep(300); };
const snap = (page) => ev(page, () => __tb.snap());
const obs = (page) => ev(page, () => __tb.obs());

/** The REAL pointer on a button: the tooltip when it shows, its rectangle relative to the button. */
async function hoverTip(page, label) {
  await away(page);
  const handle = await page.$(BTN(label));
  if (!handle) return { label, missing: true };
  const box = await handle.boundingBox();
  const t0 = Date.now();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  let tip = null;
  for (let i = 0; i < 60; i++) { await sleep(50); tip = await ev(page, () => __tb.tipNow()); if (tip?.open) break; }
  const shownAfterMs = Date.now() - t0;
  await sleep(200);
  tip = await ev(page, () => __tb.tipNow());
  const b = await ev(page, (l) => { const el = __tb.btn(l); return el ? { abs: __tb.rect(el), tooltip: { text: el.getAttribute('data-tooltip'), keys: el.getAttribute('data-tooltip-keys'), reason: el.getAttribute('data-tooltip-reason') }, ariaDisabled: el.getAttribute('aria-disabled'), cursor: getComputedStyle(el).cursor } : null; }, label);
  const rel = tip?.abs && b?.abs ? [Math.round((tip.abs[0] - b.abs[0]) * 100) / 100, Math.round((tip.abs[1] - b.abs[1]) * 100) / 100, tip.abs[2], tip.abs[3]] : null;
  // the gap between the button and the tooltip on the side it is placed
  const gap = tip?.abs && b?.abs ? { right: Math.round((tip.abs[0] - (b.abs[0] + b.abs[2])) * 100) / 100, below: Math.round((tip.abs[1] - (b.abs[1] + b.abs[3])) * 100) / 100, above: Math.round((b.abs[1] - (tip.abs[1] + tip.abs[3])) * 100) / 100 } : null;
  return { label, shown: !!tip?.open, shownAfterMs, ...tip, relButton: rel, gap, button: b };
}

/** Focuses the control before the toolbar and presses Tab, so :focus-visible applies in every engine. */
async function tabIntoToolbar(page) {
  await ev(page, () => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const before = await ev(page, () => __tb.beforeToolbar());
  if (before.prev === null) return { before, reached: false };
  await ev(page, () => document.querySelector('[data-probe-prev]').focus());
  await page.keyboard.press('Tab');
  await sleep(300);
  return { before, reached: await ev(page, () => document.activeElement?.closest('.panel__tools') !== null) };
}

async function scenarioRest(page, ctx) {
  await session(page);
  const out = await ev(page, () => __tb.read());
  out.panelHeight = 'default';
  out.viewportSize = ctx.viewport;
  if (ctx.engine === 'webkit') {
    mkdirSync(SHOTS, { recursive: true });
    const body = out.body.abs;
    const file = (name) => path.join(SHOTS, name);
    await page.screenshot({ path: file(`mock-logs-webkit-${ctx.viewportName}.png`) });
    await page.screenshot({ path: file(`mock-logs-body-webkit-${ctx.viewportName}.png`), clip: { x: body[0], y: body[1], width: body[2], height: body[3] } });
    out.shots = [`mock-logs-webkit-${ctx.viewportName}.png`, `mock-logs-body-webkit-${ctx.viewportName}.png`];
  }
  return out;
}

async function scenarioStates(page) {
  const out = { panel: 'tall', panelNow: null };
  const id = await session(page);
  out.panelNow = await tall(page);
  out.rest = await snap(page);
  const restCopy = out.rest.buttons.find((b) => b.label === 'Copy')?.glyph ?? null;
  out.restCopyGlyph = restCopy;

  // Pause pressed: lines fed while paused wait, the strip counts them
  await click(page, 'Pause log updates', 500);
  out.paused = await snap(page);
  await ev(page, (sid) => __tb.feed(sid, 90, 3), id);
  await sleep(900);
  out.pausedWithLines = await snap(page);
  out.pausedParts = await ev(page, () => ({ pauseButton: __tb.paint(__tb.btn('Pause log updates')), followButton: __tb.paint(__tb.btn('Follow')) }));
  await click(page, 'Pause log updates', 900);
  out.resumed = await snap(page);

  // Follow pressed off: Scrolled back
  await click(page, 'Follow', 500);
  out.followOff = await snap(page);
  await ev(page, (sid) => __tb.feed(sid, 93, 2), id);
  await sleep(900);
  out.followOffWithLines = await snap(page);
  await click(page, 'Follow', 700);
  out.followOn = await snap(page);

  // Copy confirming: the glyph swap and its revert
  await page.evaluate(() => { window.__clip.length = 0; });
  const t0 = Date.now();
  await click(page, 'Copy', 0);
  out.copy = [];
  for (const at of [200, 1000, 2200]) {
    await sleep(Math.max(0, at - (Date.now() - t0)));
    const s = await snap(page);
    const copy = s.buttons.find((b) => b.label === 'Copy');
    out.copy.push({ atMs: at, measuredMs: Date.now() - t0, glyph: copy?.glyph ?? null, glyphIsRest: copy?.glyph === restCopy, label: copy?.label ?? null, live: s.live });
  }

  // paint: hover (unpressed, pressed), pressed (mouse down, no click), keyboard focus-visible
  await away(page);
  const hoverOf = async (label) => { const box = await (await page.$(BTN(label))).boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 }); await sleep(350); return ev(page, (l) => __tb.paint(__tb.btn(l)), label); };
  out.paintRest = { unpressed: await ev(page, () => __tb.paint(__tb.btn('Wrap lines'))), pressed: await ev(page, () => __tb.paint(__tb.btn('Follow'))) };
  out.paintHover = { unpressed: await hoverOf('Wrap lines'), pressed: await hoverOf('Follow') };
  const box = await (await page.$(BTN('Wrap lines'))).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
  await page.mouse.down();
  await sleep(300);
  out.paintMouseDown = await ev(page, () => __tb.paint(__tb.btn('Wrap lines')));
  await page.mouse.move(AWAY.x, AWAY.y, { steps: 3 }); // released away from the button: no click
  await page.mouse.up();
  await sleep(300);
  out.afterCancelledPress = (await snap(page)).buttons.find((b) => b.label === 'Wrap lines');
  await away(page);
  const tabbed = await tabIntoToolbar(page);
  out.paintFocus = { reached: tabbed.reached, active: await ev(page, () => __tb.describe(document.activeElement)), paint: await ev(page, () => __tb.paint(document.activeElement)), other: await ev(page, () => __tb.paint(__tb.btn('Clear'))) };
  await page.keyboard.press('ArrowDown');
  await sleep(200);
  out.paintFocusNext = { active: await ev(page, () => __tb.describe(document.activeElement)), paint: await ev(page, () => __tb.paint(document.activeElement)) };
  await ev(page, () => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await away(page);

  // a session that has not started: connecting, no lines
  await ev(page, () => __tb.closeAll());
  await ev(page, () => __tb.open('slow'));
  await sleep(1000);
  out.connecting = { ...(await snap(page)), toolbar: await ev(page, () => __tb.read().buttons.map((b) => ({ label: b.label, ariaDisabled: b.ariaDisabled, tooltip: b.tooltip, tabindex: b.tabindex, cursor: b.style.cursor, opacity: b.style.opacity, color: b.style.color, backgroundColor: b.style.backgroundColor, abs: b.abs }))) };
  const disabledBox = await (await page.$(BTN('Clear'))).boundingBox();
  await page.mouse.move(disabledBox.x + disabledBox.width / 2, disabledBox.y + disabledBox.height / 2, { steps: 2 });
  await sleep(350);
  out.connectingDisabledHover = await ev(page, () => __tb.paint(__tb.btn('Clear')));
  await away(page);

  // a session that has ended: Stop, Pause disabled
  await ev(page, () => __tb.closeAll());
  const id2 = await session(page, { count: 12, wait: 300 });
  await ev(page, async (sid) => { await Shell.panel.sessions.stop(sid, { reason: 'user' }); }, id2);
  await sleep(1500);
  out.ended = { ...(await snap(page)), state: await ev(page, (sid) => Shell.panel.sessions.get(sid)?.state, id2), toolbar: await ev(page, () => __tb.read().buttons.map((b) => ({ label: b.label, ariaDisabled: b.ariaDisabled, tooltip: b.tooltip, tabindex: b.tabindex, cursor: b.style.cursor, opacity: b.style.opacity, color: b.style.color, backgroundColor: b.style.backgroundColor }))) };
  return out;
}

async function scenarioTooltips(page) {
  const out = {};
  await session(page);
  const visible = await ev(page, () => __tb.buttons().map((b) => b.getAttribute('aria-label')));
  out.default = { panel: 'default', buttons: [] };
  for (const label of visible) out.default.buttons.push(await hoverTip(page, label));
  await tall(page);
  out.tall = { panel: 'tall', buttons: [] };
  for (const label of BUTTON_ORDER) out.tall.buttons.push(await hoverTip(page, label));
  await ev(page, () => __tb.closeAll());
  await ev(page, () => __tb.open('slow'));
  await sleep(1000);
  out.tallConnecting = { panel: 'tall', session: 'connecting, no lines', buttons: [] };
  for (const label of BUTTON_ORDER) out.tallConnecting.buttons.push(await hoverTip(page, label));
  // Every tooltip of this scene is that of a session that is connecting: if the session left that state while the twelve were measured, the records would mix two states under one label.
  out.tallConnecting.state = await ev(page, () => Shell.panel.sessions.get(__tb.sid)?.state);
  if (out.tallConnecting.state !== 'connecting') throw new Error(`tooltips: the session is ${String(out.tallConnecting.state)} after the twelve tooltips, not connecting: the records would mix states`);
  await ev(page, () => __tb.closeAll());
  const id = await session(page, { count: 12, wait: 300 });
  await ev(page, async (sid) => { await Shell.panel.sessions.stop(sid, { reason: 'user' }); }, id);
  await sleep(1500);
  out.tallEnded = { panel: 'tall', session: 'ended', buttons: [] };
  for (const label of ['Pause log updates', 'Clear', 'Stop session', 'Reconnect session']) out.tallEnded.buttons.push(await hoverTip(page, label));
  // the tooltip's own style, from the first shown one
  out.style = out.default.buttons.find((b) => b.style)?.style ?? null;
  return out;
}

async function keysRun(page) {
  const out = { steps: [] };
  await away(page);
  out.labels = await ev(page, () => __tb.buttons().map((b) => b.getAttribute('aria-label')));
  out.tabStops = await ev(page, () => __tb.buttons().filter((b) => b.getAttribute('tabindex') === '0').length);
  out.tabindexesAtRest = await ev(page, () => __tb.buttons().map((b) => b.getAttribute('tabindex')).join(' '));
  const before = await ev(page, () => __tb.beforeToolbar());
  out.beforeToolbar = before;
  await ev(page, () => document.querySelector('[data-probe-prev]')?.focus());
  const rec = async (key) => { if (key) await page.keyboard.press(key); await sleep(300); out.steps.push({ key, ...(await ev(page, () => __tb.keyState())) }); };
  await rec(null);
  for (const key of ['Tab', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight', 'Home', 'Enter', 'Space', 'ArrowDown', 'ArrowDown', 'Enter', 'Space']) await rec(key);
  await rec('Tab');
  await rec('Shift+Tab');
  await rec('Shift+Tab');
  await rec('Tab');
  await ev(page, () => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  return out;
}

async function scenarioKeys(page) {
  const out = {};
  await session(page);
  out.default = { panel: 'default', ...(await keysRun(page)) };
  await tall(page);
  await session(page, { fresh: true }); // a clean session (the first run toggled Follow and Wrap)
  out.tall = { panel: 'tall', ...(await keysRun(page)) };
  return out;
}

const plainLines = (text) => (text === null || text === undefined ? null : text.split('\n'));
async function readClip(page) { return page.evaluate(() => window.__clip.map((c) => ({ via: c.via, text: c.text }))); }
function clipFacts(entries) {
  const e = entries.at(-1) ?? null;
  const lines = plainLines(e?.text);
  return { writes: entries.length, via: e?.via ?? null, lineCount: lines?.length ?? null, first3: lines?.slice(0, 3) ?? null, last: lines?.at(-1) ?? null, endsWithNewline: e ? e.text.endsWith('\n') : null, separator: 'LF', chars: e?.text.length ?? null };
}

async function scenarioBehaviour(page) {
  const out = {};
  await tall(page);
  const pause = {};
  // (a) pause: lines fed while paused are counted, not drawn
  let id = await session(page, { fresh: true });
  pause.atRest = await obs(page);
  await click(page, 'Pause log updates', 500);
  pause.paused = await obs(page);
  pause.timeline = [];
  const t0 = Date.now();
  for (let k = 0; k < 10; k++) {
    await ev(page, ([sid, from]) => __tb.feed(sid, from, 5), [id, 90 + k * 5]);
    await sleep(Math.max(0, (k + 1) * 200 - (Date.now() - t0)));
    const o = await obs(page);
    pause.timeline.push({ atMs: Date.now() - t0, fed: (k + 1) * 5, stat: o.stat, action: o.action, rows: o.rows.count, lastN: o.rows.lastN, scrollTop: o.rows.scroll?.top, atEnd: o.rows.scroll?.atEnd });
  }
  await sleep(1200);
  pause.afterFeed = await obs(page);
  await click(page, 'Pause log updates', 150);
  pause.resumed150 = await obs(page);
  await sleep(700);
  pause.resumed850 = await obs(page);
  await sleep(1500);
  pause.resumed2350 = await obs(page);
  // Follow pressed while paused (follow is on): does it unpause?
  await click(page, 'Pause log updates', 500);
  await ev(page, ([sid]) => __tb.feed(sid, 140, 3), [id]);
  await sleep(800);
  pause.pausedAgain = await obs(page);
  await click(page, 'Follow', 700);
  pause.followPressedWhilePaused = await obs(page);
  // Follow back on with follow off and paused: the unpause branch
  await click(page, 'Follow', 700);
  pause.followPressedAgain = await obs(page);
  // reset to follow on, not paused
  if (pause.followPressedAgain.cfg?.paused) await click(page, 'Pause log updates', 600);
  pause.normalised = await obs(page);
  // Pause pressed while follow is off
  await click(page, 'Follow', 500);
  pause.followOff = await obs(page);
  await click(page, 'Pause log updates', 500);
  pause.pausePressedWhileFollowOff = await obs(page);
  await ev(page, ([sid]) => __tb.feed(sid, 143, 4), [id]);
  await sleep(800);
  pause.pausedFollowOffWithLines = await obs(page);
  await click(page, 'Pause log updates', 900);
  pause.resumedFollowOff = await obs(page);
  // Follow pressed while paused AND follow is off (paused on again, then Follow)
  await click(page, 'Pause log updates', 500);
  pause.pausedFollowOffAgain = await obs(page);
  await click(page, 'Follow', 900);
  pause.followPressedWhilePausedAndOff = await obs(page);
  out.pause = pause;

  // (b) clear: 10,100 lines (the buffer keeps 10,000), then Clear
  const clear = {};
  id = await session(page, { count: 0, wait: 200, fresh: true });
  await ev(page, async (sid) => { for (let from = 0; from < 10100; from += 100) { __tb.feed(sid, from, Math.min(100, 10100 - from)); await new Promise((r) => setTimeout(r, 30)); } }, id);
  await sleep(3800);
  clear.before = await obs(page);
  await click(page, 'Clear', 100);
  clear.after100 = { ...(await obs(page)), rowList: await ev(page, () => __tb.rowList(6)), focus: await ev(page, () => __tb.describe(document.activeElement)) };
  await sleep(700);
  clear.after800 = { ...(await obs(page)), rowList: await ev(page, () => __tb.rowList(6)) };
  clear.afterButtons = await snap(page);
  await ev(page, ([sid]) => __tb.feed(sid, 20000, 3), [id]);
  await sleep(900);
  clear.nextLines = { ...(await obs(page)), rowList: await ev(page, () => __tb.rowList(8)) };
  await sleep(3800);
  clear.rateDecayed = await obs(page);
  // Clear pressed twice
  await click(page, 'Clear', 700);
  clear.clearedTwice = { ...(await obs(page)), rowList: await ev(page, () => __tb.rowList(6)) };
  out.clear = clear;

  // (c) copy: all lines, a level filter, after a Clear
  const copy = {};
  id = await session(page, { fresh: true });
  await ev(page, () => { window.__clip.length = 0; });
  await click(page, 'Copy', 100);
  copy.all = { clip: clipFacts(await readClip(page)), live100: await ev(page, () => document.getElementById('shell-live')?.textContent.replace(/\u200b/g, '') ?? null), glyph100: (await snap(page)).buttons.find((b) => b.label === 'Copy')?.glyph, restGlyph: out.copyRestGlyph };
  const allClip = await readClip(page);
  copy.all.lines = plainLines(allClip.at(-1)?.text)?.length;
  copy.all.longLineChars = plainLines(allClip.at(-1)?.text)?.[9]?.length ?? null;
  copy.all.ansiLine = plainLines(allClip.at(-1)?.text)?.[3] ?? null;
  await sleep(1000);
  copy.all.live1100 = await ev(page, () => document.getElementById('shell-live')?.textContent.replace(/\u200b/g, '') ?? null);
  await sleep(1300);
  copy.all.after2400 = (await snap(page)).buttons.find((b) => b.label === 'Copy')?.glyph;
  copy.all.glyphReverted = copy.all.after2400 !== copy.all.glyph100;
  await ev(page, () => Shell.run('host.logs.level', { arg: 'error' }));
  await sleep(1200);
  await ev(page, () => { window.__clip.length = 0; });
  copy.filterStat = (await obs(page)).stat;
  await click(page, 'Copy', 100);
  copy.filtered = { clip: clipFacts(await readClip(page)), live100: await ev(page, () => document.getElementById('shell-live')?.textContent.replace(/\u200b/g, '') ?? null), levelsInClip: [...new Set((plainLines((await readClip(page)).at(-1)?.text) ?? []).map((l) => l.split(/\s+/)[1]))] };
  await sleep(2400);
  await ev(page, () => Shell.run('host.logs.level', { arg: 'all' }));
  await sleep(800);
  // after a Clear: the marker row is a line of the text
  await click(page, 'Clear', 500);
  await ev(page, ([sid]) => __tb.feed(sid, 300, 2), [id]);
  await sleep(900);
  await ev(page, () => { window.__clip.length = 0; });
  await click(page, 'Copy', 100);
  copy.afterClear = { clip: clipFacts(await readClip(page)), text: (await readClip(page)).at(-1)?.text ?? null, live100: await ev(page, () => document.getElementById('shell-live')?.textContent.replace(/\u200b/g, '') ?? null) };
  out.copy = copy;

  // (d) the command palette
  const palette = { queries: {} };
  await sleep(2400);
  await ev(page, () => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  for (const chord of ['Meta+k', 'Control+k']) {
    await page.keyboard.press(chord);
    await sleep(700);
    if (await ev(page, () => !!document.getElementById('pq'))) { palette.openedWith = chord; break; }
  }
  const readRows = () => ev(page, () => {
    const norm = (s) => (s == null ? null : s.replace(/[\s\u200b]+/g, ' ').trim());
    const rows = [...document.querySelectorAll('.palette [role=option]')].map((r) => ({ text: norm(r.textContent), active: r.getAttribute('aria-selected') === 'true', disabled: r.getAttribute('aria-disabled'), keys: [...r.querySelectorAll('kbd, .kbd, .keyhint')].map((k) => norm(k.textContent)) }));
    return { rows, footer: norm(document.querySelector('.palette .foot, .palette [class*=foot]')?.textContent), chips: [...document.querySelectorAll('.pq-chips .chip')].map((c) => norm(c.textContent)) };
  });
  if (palette.openedWith) {
    for (const q of ['Follow', 'Pause', 'Clear', 'Copy', 'Logs', 'Wrap', 'Export', 'Jump']) {
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type(q);
      await sleep(600);
      palette.queries[q] = await readRows();
    }
    await page.keyboard.press('Escape');
    await sleep(400);
  }
  // the keyboard chords the mock binds (the key table of the commands), when it says
  palette.bindings = await ev(page, () => {
    const ids = ['follow', 'pause', 'clear', 'copy', 'wrap', 'filter', 'find', 'export', 'display', 'jump'].map((n) => `host.logs.${n}`);
    try { return Object.fromEntries(ids.map((id) => [id, (typeof Shell.keys?.of === 'function' ? Shell.keys.of(id) : null) ?? (typeof Shell.commands?.get === 'function' ? Shell.commands.get(id)?.keys ?? Shell.commands.get(id)?.shortcut ?? null : null)])); } catch { return null; }
  });
  out.palette = palette;
  return out;
}

async function scenarioShort(page) {
  const out = { sweep: [] };
  await session(page);
  const read = async (label) => {
    const r = await ev(page, () => __tb.read());
    const tools = r.tools?.abs;
    const clipped = r.buttons.filter((b) => b.abs && tools && (b.abs[1] < tools[1] - 0.01 || b.abs[1] + b.abs[3] > tools[1] + tools[3] + 0.01));
    return {
      label, panel: r.panel, body: r.body, tools: r.tools, slots: r.slots, toolsScroll: r.toolsScroll, toolsOverflowY: r.toolsStyle?.overflowY, scrolls: r.toolsScroll ? r.toolsScroll.scrollHeight > r.toolsScroll.clientHeight : null, clippedButtons: clipped.map((b) => b.label),
      buttons: r.buttons.map((b) => ({ label: b.label, rel: b.rel, relTools: b.relTools, ariaDisabled: b.ariaDisabled, ariaHaspopup: b.ariaHaspopup, ariaExpanded: b.ariaExpanded, tabindex: b.tabindex, tooltip: b.tooltip })), content: r.content,
    };
  };
  const more = async (label) => {
    const handle = await page.$(BTN('More actions'));
    if (!handle) return { present: false };
    const hover = await hoverTip(page, 'More actions');
    await away(page);
    await handle.click();
    await sleep(600);
    const menu = await ev(page, () => __tb.menuNow());
    const expanded = await ev(page, () => __tb.btn('More actions')?.getAttribute('aria-expanded') ?? null);
    const focus = await ev(page, () => __tb.describe(document.activeElement));
    await page.keyboard.press('Escape');
    await sleep(500);
    const after = await ev(page, () => ({ menu: __tb.menuNow() !== null, active: __tb.describe(document.activeElement), expanded: __tb.btn('More actions')?.getAttribute('aria-expanded') ?? null }));
    return { present: true, tooltip: hover, menu, ariaExpandedWhileOpen: expanded, focusWhileOpen: focus, afterEscape: after };
  };
  // the sweep: from the minimum up in 16 px steps to a little past the default
  out.min = { ...(await readAt(page, ['Home'], read)) };
  out.min.moreMenu = await more();
  out.sweep.push({ panelH: out.min.panel.abs[3], bodyH: out.min.body.abs[3], slotsFor: out.min.slots.slotsFor, shown: out.min.slots.shown, more: out.min.slots.more !== null });
  for (let k = 1; k <= 12; k++) {
    await resizePanel(page, ['Home', ...Array(k).fill('ArrowUp')]);
    const r = await ev(page, () => __tb.read());
    out.sweep.push({ panelH: r.panel.abs[3], bodyH: r.body.abs[3], slotsFor: r.slots.slotsFor, shown: r.slots.shown, more: r.slots.more !== null, labels: r.slots.labelsShown });
    if (k === 5) {
      out.at200 = await read('panel 200 px (Home, then 5 x ArrowUp)');
      out.at200.moreMenu = await more();
    }
  }
  out.max = await readAt(page, ['End'], read);
  out.max.moreMenu = await more();
  return out;
}
async function readAt(page, keys, read) { const now = await resizePanel(page, keys); const r = await read(keys.join(',')); r.panelNow = now; return r; }

async function scenarioFacts(page, ctx) {
  const out = {};
  const view = () => ev(page, () => {
    const v = __tb.view(), t = __tb.tools();
    return { toolbarPresent: t !== null, viewChildren: v ? [...v.children].map((c) => c.className.trim()) : null, buttons: __tb.buttons().map((b) => b.getAttribute('aria-label')), stat: document.querySelector('.ptool__stat')?.textContent ?? null, toolClass: v?.querySelector('.ptool')?.className.trim() ?? null, notice: (v?.querySelector('.ptool__notice, .ptool__failure, .panel__empty')?.textContent ?? '').replace(/\s+/g, ' ').trim() || null, tools: __tb.rect(t) };
  });
  await tall(page);

  // no session at all
  await ev(page, () => __tb.closeAll());
  await sleep(500);
  out.noSession = await view();
  out.noSessionLogsToolbarOnLogsTool = await ev(page, () => { Shell.panel.show('logs'); return null; });
  await sleep(500);
  out.noSession = { ...out.noSession, afterShowLogs: await view() };

  // connecting ('starting')
  await ev(page, () => __tb.open('slow'));
  await sleep(1000);
  out.connecting = { ...(await view()), snap: await snap(page) };
  // disabled buttons under the pointer and the keyboard
  const clearBox = await (await page.$(BTN('Clear'))).boundingBox();
  await page.mouse.move(clearBox.x + clearBox.width / 2, clearBox.y + clearBox.height / 2, { steps: 2 });
  await page.mouse.down(); await page.mouse.up();
  await sleep(500);
  out.disabledClick = { snap: await snap(page), focus: await ev(page, () => __tb.describe(document.activeElement)), menu: await ev(page, () => __tb.menuNow()) };
  await away(page);
  await ev(page, () => { __tb.btn('Clear').focus(); });
  await page.keyboard.press('Enter');
  await sleep(400);
  out.disabledEnter = { live: (await snap(page)).live, focus: await ev(page, () => __tb.describe(document.activeElement)) };
  const tabbed = await tabIntoToolbar(page);
  out.disabledReachableByArrow = { reachedToolbar: tabbed.reached, path: [] };
  for (let k = 0; k < 11; k++) {
    await page.keyboard.press('ArrowDown');
    await sleep(150);
    out.disabledReachableByArrow.path.push(await ev(page, () => ({ label: document.activeElement?.getAttribute('aria-label') ?? null, ariaDisabled: document.activeElement?.getAttribute('aria-disabled') ?? null, tabindex: document.activeElement?.getAttribute('tabindex') ?? null })));
  }
  await ev(page, () => document.activeElement instanceof HTMLElement && document.activeElement.blur());

  // failed, no lines
  await ev(page, () => __tb.closeAll());
  await ev(page, () => __tb.open('fail'));
  await sleep(1500);
  out.failedNoLines = { ...(await view()), snap: await snap(page) };
  // failed with lines
  await ev(page, () => __tb.closeAll());
  const idF = await session(page, { count: 12, wait: 300 });
  await ev(page, (sid) => Shell.panel.sim.fail(sid, 'The connection was refused'), idF);
  await sleep(1500);
  out.failedWithLines = { ...(await view()), snap: await snap(page) };
  await ev(page, () => __tb.closeAll());

  // focus after a press: is the node replaced?
  const id = await session(page);
  const press = async (label, how) => {
    await ev(page, (l) => { __tb.btn(l).__probeNode = 1; }, label);
    if (how === 'mouse') await click(page, label, 600);
    else { await ev(page, (l) => __tb.btn(l).focus(), label); await page.keyboard.press('Enter'); await sleep(600); }
    return { label, how, sameNode: await ev(page, (l) => __tb.btn(l)?.__probeNode === 1, label), active: await ev(page, () => __tb.describe(document.activeElement)), tabs: await ev(page, () => __tb.buttons().map((b) => b.getAttribute('tabindex')).join(' ')) };
  };
  out.focusAfterPress = [await press('Follow', 'mouse'), await press('Follow', 'mouse'), await press('Pause log updates', 'mouse'), await press('Pause log updates', 'mouse'), await press('Wrap lines', 'key'), await press('Wrap lines', 'key'), await press('Clear', 'mouse')];
  await ev(page, () => document.activeElement instanceof HTMLElement && document.activeElement.blur());

  // what Follow does to the scroll position
  await ev(page, () => __tb.closeAll());
  const id2 = await session(page, { count: 120 });
  const sc = await page.$('.plog__scroll');
  const p = point(await sc.boundingBox());
  await page.mouse.move(p.x, p.y);
  const follow = { atRest: await obs(page) };
  await page.mouse.wheel(0, -500);
  await sleep(600);
  follow.afterWheelUp = await obs(page);
  await ev(page, ([sid]) => __tb.feed(sid, 120, 4), [id2]);
  await sleep(900);
  follow.scrolledBackWithLines = await obs(page);
  await click(page, 'Follow', 900);
  follow.afterFollowOn = await obs(page);
  await click(page, 'Follow', 700);
  follow.afterFollowOff = await obs(page);
  await ev(page, () => __tb.feed(__tb.sid, 124, 3));
  await sleep(900);
  follow.followOffWithLines = await obs(page);
  await click(page, 'Follow', 900);
  // The observation is taken once the view is at the tail, waiting for it (at most 3 s) instead of for a fixed time: one run recorded it 72 px short. `reachedTail` says whether it got there.
  let again = await obs(page);
  for (let waited = 0; waited < 3000 && again.rows.scroll?.atEnd !== true; waited += 150) {
    await sleep(150);
    again = await obs(page);
  }

  follow.afterFollowOnAgain = again;
  follow.reachedTail = again.rows.scroll?.atEnd === true;
  out.follow = follow;

  // what each remaining button does
  const effects = {};
  await ev(page, () => __tb.closeAll());
  await session(page);
  await click(page, 'Wrap lines', 600);
  effects.wrap = { snap: await snap(page), tableWrap: await ev(page, () => { const t = document.querySelector('.plog__table'); return { cls: t?.className ?? null, dataWrap: t?.dataset.wrap ?? null, whiteSpace: getComputedStyle(document.querySelector('.plog__table tbody td:last-child .mono, .plog__table tbody td:last-child') ?? document.body).whiteSpace }; }) };
  await click(page, 'Wrap lines', 400);
  const filterBefore = await ev(page, () => !!document.querySelector('.plog__filters'));
  await click(page, 'Filter', 700);
  effects.filter = { filterRowBefore: filterBefore, filterRowAfter: await ev(page, () => !!document.querySelector('.plog__filters')), pressed: (await snap(page)).buttons.find((b) => b.label === 'Filter')?.pressed, panelAfter: await ev(page, () => __tb.rect(document.querySelector('.plog__filters'))) };
  await click(page, 'Filter', 500);
  for (const label of ['Display options', 'Export']) {
    await click(page, label, 700);
    effects[label] = { menu: await ev(page, () => __tb.menuNow()), pressed: (await snap(page)).buttons.find((b) => b.label === label), focus: await ev(page, () => __tb.describe(document.activeElement)) };
    await page.keyboard.press('Escape');
    await sleep(500);
    effects[label].afterEscape = { focus: await ev(page, () => __tb.describe(document.activeElement)), menu: await ev(page, () => __tb.menuNow() !== null) };
  }
  await click(page, 'Jump to time', 700);
  effects.jump = await ev(page, () => { const d = [...document.querySelectorAll('.dlg')].find(__tb.shown); return d ? { text: d.textContent.replace(/\s+/g, ' ').trim().slice(0, 160), role: d.getAttribute('role') ?? d.tagName.toLowerCase() } : null; });
  await page.keyboard.press('Escape');
  await sleep(500);
  effects.jump = { ...effects.jump, afterEscapeFocus: await ev(page, () => __tb.describe(document.activeElement)) };
  out.effects = effects;

  // the maximized panel
  await ev(page, () => Shell.run('host.panel.maximize'));
  await sleep(900);
  out.maximized = await ev(page, () => { const r = __tb.read(); return { panel: r.panel, body: r.body, tools: r.tools, slots: r.slots, labels: r.buttons.map((b) => b.label) }; });
  await ev(page, () => Shell.run('host.panel.maximize'));
  await sleep(600);

  // the default height again, to say how it was reached
  out.defaultHeights = ctx.viewport;
  return out;
}

const SCENARIO = { rest: scenarioRest, states: scenarioStates, tooltips: scenarioTooltips, keys: scenarioKeys, behaviour: scenarioBehaviour, short: scenarioShort, facts: scenarioFacts };

/** What a scenario must have found, else its reading missed a part. */
const checks = {
  rest: (r) => (r.slots.more === null || r.slots.shown !== r.slots.slotsFor - 1 || r.buttons.length !== r.slots.shown + 1 || r.buttons[0].ariaPressed !== 'true' || r.toolbar?.role !== 'toolbar' || r.buttons.some((b) => !b.abs || !b.svg) ? 'misses the buttons that fit and More actions, the pressed Follow or the toolbar attributes' : null),
  states: (r) => (!/Paused/.test(r.paused?.stat ?? '') || !/Paused, 3 new lines waiting/.test(r.pausedWithLines?.stat ?? '') || !/Scrolled back/.test(r.followOff?.stat ?? '') || r.copy?.length !== 3 || r.copy[0].glyphIsRest !== false || r.copy[2].glyphIsRest !== true || r.paintHover?.unpressed === null || r.connecting?.buttons?.length !== 12 || r.ended?.state !== 'exited' ? 'misses the Paused, Scrolled back, Copy glyph swap, hover or the connecting / ended toolbars' : null),
  tooltips: (r) => (r.default?.buttons?.length < 5 || r.default.buttons.some((b) => !b.shown) || r.tall?.buttons?.length !== 12 || r.tall.buttons.some((b) => !b.shown) || !r.tallConnecting.buttons.some((b) => b.reason) ? 'a tooltip did not show, or the reasons are missing' : null),
  keys: (r) => (r.default?.steps?.length < 20 || r.tall?.steps?.length < 20 || r.default.beforeToolbar?.prev === null ? 'misses the key steps or the control before the toolbar' : null),
  behaviour: (r) => (r.skipped ? null : !r.pause?.timeline?.some((t) => /Paused, \d+ new lines? waiting/.test(t.stat ?? '')) || !r.clear?.after100?.rowList?.some((x) => x.kind === 'cleared') || (r.copy?.all?.clip?.lineCount ?? 0) < 90 || !r.palette?.openedWith ? 'misses the pausing strip, the cleared marker, the copied text or the palette' : null),
  short: (r) => (!r.min?.slots?.more || r.min.moreMenu?.menu === null || r.at200?.moreMenu?.present !== true || r.max?.slots?.shown !== 12 || r.sweep.length < 10 ? 'misses the More actions button or its menu, or the full toolbar' : null),
  facts: (r) => (r.connecting?.buttons?.length !== 12 || r.focusAfterPress?.length !== 7 || !r.follow?.afterFollowOn || typeof r.follow?.reachedTail !== 'boolean' || !r.maximized || !r.effects?.Export?.menu ? 'misses the session states, the focus facts, Follow, the effects or the maximized panel' : null),
};

/** Each scenario in a fresh page, closed whatever it reads. */
async function scenario(browser, engine, viewportName, name) {
  const viewport = VIEWPORTS[viewportName];
  if (name === 'behaviour' && viewportName !== '1440x900') return { skipped: 'measured at 1440x900 only' };
  const page = await open(browser, viewport);
  try {
    page.on('pageerror', (e) => console.log('PAGEERROR', name, e.message));
    return await SCENARIO[name](page, { engine, viewportName, viewport });
  } finally {
    await page.context().close();
  }
}

const data = {};
let failed = false;
// The server this script started (no MOCK_URL) and every browser it launched are closed whatever happens.
try {
  for (const engineName of engineNames) {
    const browser = await launch(engineName);
    try {
      data[engineName] = {};
      for (const viewportName of viewportNames) {
        data[engineName][viewportName] = {};
        for (const name of scenarioNames) {
          let result = null, problem = null;
          try {
            result = await scenario(browser, engineName, viewportName, name);
            problem = checks[name](result);
          } catch (error) {
            problem = `threw: ${error.message.split('\n')[0]}`;
          }
          if (problem !== null) { console.log('MISSING', engineName, viewportName, name, problem); failed = true; }
          data[engineName][viewportName][name] = result;
          console.log(engineName, viewportName, name, problem === null ? 'ok' : 'FAILED', `${Math.round((Date.now() - started) / 1000)}s`);
        }
      }
    } finally {
      await browser.close();
    }
  }

  const random = [
    'Session ids are random per run; the file replaces every `log-<8 hex>` with `log-<id>`.',
    '`shownAfterMs` of a tooltip (the wall time from the pointer move to the open popover, polled every 50 ms) and every `measuredMs` / `atMs` sample carry the load of the machine; only their order and the 500 ms delay in the mock (core.js DELAY) are facts.',
    'The strip\'s lines/s part (`N lines · 0.0 lines/s · Following`) depends on when it is read: scenarios read it after 3.8 s (decayed) except the timelines of `behaviour.pause`, which are sampled live.',
  ];
  const notes = [
    'Rectangles [x, y, w, h] in px, 0.01. `abs`: viewport coordinates; `rel`: relative to the top-left of `.panel__body`; `relTools`: relative to `.panel__tools`; `relButton` (tooltips): relative to the button.',
    'The mock\'s toolbar: `.panel__tools` (role=toolbar, aria-orientation=vertical, aria-label "Logs tools", data-roving=col) is the FIRST child of `.panel__view`, before `.panel__content`. 40 px wide, 28 px buttons, 4 px gap (pitch 32), 4 px padding block, buttons centred (x 6).',
    'The mock draws the 9 Logs buttons plus the 3 session buttons (Stop / Reconnect / Inspect session) of genericToolbar: 12 in all (`buttonOrder`). A body of height h has slotsFor(h) = floor((h - 4) / 32) slots; when 12 do not fit it shows slots - 1 buttons and `More actions` (aria-haspopup="true", action shell:host.panel.more) as the last child.',
    'At the default panel height (270 px at 1440x900, 240 px at 1280x800; the body is 41 px shorter: 229 / 199 px, so 7 / 6 slots) the toolbar shows at 1440x900 Follow, Pause, Wrap, Display options, Jump to time, Clear and `More actions` (at 1280x800 the same without Clear); Filter, Copy, Export and the three session buttons are behind it. Copy and Export can only be read by raising the panel (`panel: tall`, splitter End) or from the More menu.',
    'The panel\'s own height is set with the splitter\'s keyboard (Home: minimum 120 px, End: maximum 100% - 312 px, ArrowUp: 16 px larger (the panel follows the handle)), as the panel probe does it; a scenario that does so says `panel`.',
    'A tooltip is the mock\'s one `#app-tooltip` popover: a 500 ms hover delay (data-tooltip-delay overrides), immediate on keyboard focus; the label and, when given, the key hint on one row, a reason on a second muted line. The mock binds NO chord to Follow / Pause / Clear / Copy, so no tooltip shows keys (see palette).',
    'Copy writes `navigator.clipboard.writeText(text)` (else a readonly textarea + document.execCommand): every line of the VIEW (filters applied) as `<HH:MM:SS.mmm> <LEVEL padded to 5> <source>  <message>`, marker rows as `-- <text> --`, joined with LF, no trailing newline; the announcement says `<lineCount> lines copied` where lineCount counts ALL lines, filtered or not (shell-panel.js copyLogs).',
    'Screenshots (webkit `rest`) go to SHOTS, not into the repo.',
  ];
  const note = `Measured from the design lab mock, tree ${MOCK_TREE}, on ${new Date().toISOString().slice(0, 10)}. Mock default context (no text scale, default density, default theme), font normalized (--int-font-ui: Helvetica, Arial, sans-serif), UTC, en-US, the probe's own log producer, the panel at its default height unless a scenario says otherwise.`;
  const json = JSON.stringify({ mockTree: MOCK_TREE, note, viewports: VIEWPORTS, buttonOrder: BUTTON_ORDER, random, notes, data }, null, 1)
    .replace(/log-[0-9a-f]{8}/g, 'log-<id>')
    // wall-clock readings of the run (the clock of a copied line) are the run's, not the reference's: the format is what the reference holds
    .replace(/\b\d\d:\d\d:\d\d\.\d{3}\b/g, 'HH:MM:SS.mmm')
    // arrays of numbers (rectangles) stay on one line
    .replace(/\[\n\s*(-?\d[^[\]{}"]*?)\n\s*\]/g, (m, inner) => `[${inner.replace(/\s*\n\s*/g, ' ')}]`);
  const text = `${json}\n`;
  // The reference is written into the repo only by a complete measurement of the approved tree; anything else goes to the temp directory, for diagnosis.
  const file = failed || partial || !identity.ok ? path.join(tmpdir(), 'mock-logs-toolbar.failed.json') : path.join(here, 'mock-logs-toolbar.json');
  writeFileSync(file, text);
  console.log('wrote', file, statSync(file).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
  if (failed) { console.log('FAILED: a scenario misses a part: mock-logs-toolbar.json is unchanged'); process.exitCode = 1; }
  else if (partial) console.log('narrowed run (ENGINES/VIEWPORTS/SCENARIOS): mock-logs-toolbar.json is unchanged');
  else if (!identity.ok) { console.log(`the mock is not shown to be tree ${MOCK_TREE} (${identity.why}): mock-logs-toolbar.json is unchanged`); process.exitCode = 1; }
} finally {
  server?.kill();
}

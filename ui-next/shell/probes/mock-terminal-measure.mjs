// Measures the design mock's TERMINAL TOOL BODY: the REFERENCE the host's Terminal tool (step T1) is drawn to. The panel frame (tool tabs, session tabs, header, empty panel, session card) is measured by
// mock-panel-measure.mjs, the Logs toolbar column by mock-logs-toolbar-measure.mjs; this script measures what those two leave out: the body of the Terminal tool (the vertical toolbar column, the screen, the
// transcript rows, the input row, the status lane, the failure and restore notices) and its words, announcements and keys.
//
// What it measures, per engine (webkit, chromium) and viewport (1440x900, 1280x800), every scenario in a FRESH page, with the mock's default context (no text scale, default density, default theme; the UI font
// normalized as probe-lib's normalizeFont does for the other probes, which leaves the CODE font of the transcript, --int-font-code, as the mock draws it; the page runs in UTC and en-US). The page is the mock's own
// start screen with NO plugin screen opened, the panel at its DEFAULT height (270 px at 1440x900, 240 px at 1280x800: the body is 229 / 199 px). Sessions are the host's local shells (Shell.panel.terminal.open on
// the `local/zsh` or `local/bash` target of the host's group) named with Shell.panel.sessions.rename; commands go through Shell.panel.terminal.run.
//   - empty:     the Terminal tool with no session (Shell.panel.show('terminal')): the empty state and its parts.
//   - running:   one `zsh` session, `echo hello`, `ls`, `pwd` run, state running: every part of the body, the focus rings, the card, the `More actions` menu and (the panel raised with the splitter's End key) the
//                whole toolbar.
//   - ended:     `exit` (session A, `zsh`) and `exit 3` (session B, `bash`): the same reading for each, then Enter on B (the restart) and the same reading again.
//   - failed:    four ways to a failed session, each its own page (see the shape below).
//   - restored:  a running session after Shell.panel.sim.expire (the session of the last run).
//   - transient: connecting, reconnecting (Shell.panel.sim.drop) and the connection restored.
//   - close:     the terminate confirmation of an idle shell and of a shell with a foreground process (`sleep 30`), and the close of an exited session.
//   - hints:     every text the live region #shell-live says for the events of a terminal (open, exit, exit 3, restart, fail, expire, Copy selection, Paste, Find), the toasts, and the names.
//   - keys:      real Playwright key presses on a running session, focus first in the input (and, for four keys, on the screen): Escape, Tab, Shift+Tab, F6, Shift+F6, the toggle-panel chords, Ctrl+Alt+J,
//                the new-terminal chord, the close-session chords, find; in four environments of the mock's own switch Shell.keys.override: the browser's own (no override), mac+native, win+web, win+native.
//
// Serve the mock first or let the script do it: without MOCK_URL it serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) from a CommonJS copy of its server.js with `root` set, on the first
// free port from 49475 (see mock-panel-measure.mjs). Before any measurement or write, the script verifies the mock the browser will load (verifyMock): every file of the git tree MOCK_TREE (read with
// `git -C <MOCK_DIR> ls-tree`) is fetched from the served mock and its git blob id compared; a different, partial or unverifiable mock stops the run with nothing written. MOCK_VERIFY_ONLY=1 only verifies,
// prints the result and exits 0 (no browser, no file written).
// Run:  node ui-next/shell/probes/mock-terminal-measure.mjs   (ENGINES=chromium, VIEWPORTS=1440x900 or SCENARIOS=running,keys narrow a run: then nothing is written to the repo, the JSON goes to the temp directory)
// Writes mock-terminal.measured.json (one line of compact JSON): the RAW measurement. It is not the probe's reference: `mock-terminal.json` (what terminal-probe.mjs reads: `viewports[engine][viewport]` rectangles and `rules`) is made from it and is never overwritten by this script. Exits non-zero when a scenario misses a part; the JSON is then not replaced (what it read goes to the temp directory).
//
// mock-terminal.measured.json: { mockTree, note, viewports, notes, data: { <engine>: { <viewport>: { empty, running, ended, failed, restored, transient, close, hints, keys } } } }
// COORDINATES: every rectangle is [x, y, w, h] in viewport px (the window's top-left is 0,0), rounded to 0.01. `rel` rectangles are relative to the top-left of `.panel__body`. null: the part is absent
// or not laid out. Texts are as drawn (white space collapsed); a time of day is replaced by HH:MM:SS and a session id by <id>. A field that is null or absent in an element description is left out.
//   empty:   { panelState, frame, toolbar (null: none), names, empty: { box, group, groupStyle, bigicon, bigiconStyle, glyph: { rect, name }, title: { text, rect, style }, hint: { text, rect, style }, actions: { rect, style,
//              buttons: [{ text, name, rect, primary, cls, haspopup, action, glyph, hint: { text, speech }, style }] } }, tab: { tool, sessionTabs } }
//   a state reading (running; ended.exit0 / exit3 / restart; failed.<way>; restored; transient.connecting / reconnecting / reconnected) is { panelState, sessionState, session, frame, tab, toolbar, screen, rows, input,
//              strip, notice, names, statusBar, activeBefore, card?, moreMenu?, noticeMenu?, focus?, panelTall?, toolbarTall?, stateLog? }:
//     frame:    { panel, body, view, tools: { abs, rel }, content, tool, main }            (the tool body is `.ptool`, the screen's column is `.ptool__main`)
//     tab:      { aria, head, leadState, glyph, leadColor, closeLabel, rect } of the selected session tab (glyph: the icon's name, found by comparing its shapes with H.icon(name))
//     toolbar:  { role, ariaOrientation, ariaLabel, dataRoving, rect, rel, style, slots: { bodyHeight, slotsFor, shown, behindMore }, scroll, tabStops, buttons: [{ i, label, rect, relTools, svg, glyph, ariaPressed,
//               ariaDisabled, ariaHaspopup, ariaExpanded, tabindex, reason (the disabled reason the tooltip carries), tooltip (only when it differs from the label), action, color, cursor }] }. `toolbarTall`: the same after the
//               panel is raised with the splitter's End key (running only), so every button is drawn; `panelTall` the panel and body rectangles then.
//     screen:   { rect, tag, cls, tabindex, role, ariaLabel, dataFont, dataState, dataShellKeys, scroll: { scrollWidth, scrollHeight, clientWidth, clientHeight, scrollTop, offsetWidth }, style, pre: { rect, role,
//               ariaLabel, cls, style }, grid: { columns, rows, byCell, basis } } (null: the body is a notice and holds no screen). grid.columns is what the mock sends the producer (its canvas measure), byCell the real one.
//     rows:     { count, texts, muted, kinds, first: { rect, rel, style }, last: { text, rect }, heights (distinct row heights), pitch, cell: { sample, width, perChar, canvasM, canvasFontSet, canvasFontApplied, fontLoaded },
//               prompt: { color, userSelect }, command: { color }, mutedColor }   (the input row is not counted). cell.width is a Range over the first 20 characters of the row `Applications  Deskto`.
//     input:    { row: { rect, style }, prompt: { text, rect, ariaHidden, color, display, marginInlineEnd }, field: { rect, style, placeholderColor }, attrs: { <every attribute> }, readOnly, focused, value, placeholder }
//     strip:    { rect, role, ariaLabel, style, state: { text, rect, tooltip, clip, style, ariaLive }, operation: { rect, text }, children }   (the status lane `.ptool__status`)
//     notice:   { where: 'failure' | 'notice', box, boxRel, boxStyle, notice: { rect, cls, role, glyph, glyphRect, title, message, tooltip, textRect, textStyle, clamp, style }, actions: { rect, buttons: [{ text, name, rect, rel,
//               primary, cls, haspopup, expanded, disabled, reason, action, glyph, hint }] } }   (`failure`: a banner under the screen; `notice`: the body of a session with no transcript)
//     names:    { panelBody: { role, ariaLabelledby, id }, toolTab, toolbar, screen: { role, ariaLabel }, pre, input, strip, noticeRole, liveRegions } (accessible names and roles)
//     statusBar: the text of each status bar item.   activeBefore: the focused element when the reading began (before the reading blurs it).
//     card:     { hover: { placement, card, head, kind, kindRect, facts, texts: [dt / dd], actions }, describe: { kind, state: { label, role, since, reason }, facts, actions } } (the card of the selected session tab)
//     moreMenu: { label, rect, items: [{ text, role, disabled, reason, keys }] } (the menu `More actions` of the toolbar opens at the default panel height); noticeMenu: the same for the notice's `⋯`.
//     focus:    { screen: { matches, outline: { style, width, color, offset }, active }, input: { matches, outline, borderColor, row: { backgroundColor, boxShadow, rect }, caretColor } } (running only; focus reached by a
//               Shift key press then .focus())
//   ended:   { exit0, exit3, restart } (state readings; restart: Enter pressed in the input of exit3's session).   restored: a state reading.
//   failed:  { startRejected, simFailHeld, simFailRan, simFailNew } (state readings). startRejected: a producer of the probe's own (`probe.fail`) rejects the start. simFailHeld: a producer (`probe.hold`) whose
//            start never says running, then Shell.panel.sim.fail. simFailRan: sim.fail on a session that has run (as mock-panel-measure.mjs makes `gamma`). simFailNew: sim.fail one tick after
//            Shell.panel.terminal.open on the local shell: the mock's runner then finishes its start and OVERWRITES the failure, so `stateLog` (the states seen, in order) shows failed then running (see notes).
//   transient: { connecting (probe.slow holds its start), connectingLive, reconnecting (Shell.panel.sim.drop, read 0.45 s later: attempt 1), reconnected (read 5.2 s after), live }.
//   close:   { closeLabel, idle: { dialog, sessions, afterEscape }, busyInput, busy: { dialog, sessions, terminate, afterTerminate }, exitedCloseLabel, exited: { dialog, sessions, closed } }; dialog: { rect, role,
//            ariaModal, title, headerClose, who, text, buttons: [{ text, cls, rect }], active }.
//   hints:   { steps: [{ action, announced: [{ text, urgent }], live, toasts }], find: { rect, role, ariaLabel, field, count, buttons, active }, findEscape, names: { tabs: [{ aria, close }], sessionList },
//            copy: { api, native } } where copy.api stubs navigator.clipboard.writeText (the text it received is `afterCopy.clipboard`) and copy.native lets the mock take its own route.
//   keys:    { <environment>: { platform, mode, chords, fromInput: [{ key, before, after, panelState, prevented, down, sessions, dialog, toolSelected, announced }], fromScreen: [...], findEscape: [{ step, active, findOpen }] } }
//            where before / after describe the active element { region, tag, id?, cls?, label?, text?, tabindex? } and `prevented` is whether any handler called preventDefault by the time the event reached window.
//            The environments are `browser` (no override: the browser's own platform, web mode), `mac-native`, `win-web`, `win-native` (Shell.keys.override).
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const ALL_SCENARIOS = ['empty', 'running', 'ended', 'failed', 'restored', 'transient', 'close', 'hints', 'keys'];
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
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory, on the first port that is free (a server that stays up for 1.5 s).
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-terminal-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  for (let port = 49475; port < 49495 && server === null; port++) {
    const child = spawn(process.execPath, [copy], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    await sleep(1500);
    if (child.exitCode === null) { server = child; url = `http://127.0.0.1:${port}/`; } else console.log(`port ${port} is taken`);
  }
  if (server === null) throw new Error('no free port from 49475 to 49494 for the mock server');
  console.log('serving the mock at', url);
}

/**
 * Proves the mock served at `base` is the git tree MOCK_TREE, file by file (the git blob id of each response body against the tree's). The measured numbers are written under that tree's id, so a mock of another revision
 * must never supply them. Throws when the tree cannot be read (unverifiable) or any file is missing or different; lists at most three differences.
 */
async function verifyMock(base) {
  let listing;
  try {
    // --full-tree: without it ls-tree lists only the entries under the working directory (MOCK_DIR is a subdirectory of the lab's checkout) and prints nothing.
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

/** Page side (self-contained: it is serialized into the page): the readers. Installs window.__tm. */
function install() {
  const T = (window.__tm = {});
  const r2 = (v) => Math.round(v * 100) / 100;
  const shown = (el) => el instanceof Element && el.getClientRects().length > 0;
  const rect = (el, o = { x: 0, y: 0 }) => { if (!shown(el)) return null; const b = el.getBoundingClientRect(); return [r2(b.x - o.x), r2(b.y - o.y), r2(b.width), r2(b.height)]; };
  const pick = (el, props, pseudo) => { if (!el) return null; const cs = getComputedStyle(el, pseudo); return Object.fromEntries(props.map((p) => [p, cs[p]])); };
  const norm = (s) => (s == null ? null : s.replace(/[\s\u200b]+/g, ' ').trim());
  const clean = (s) => (s == null ? s : s.replace(/\b\d\d:\d\d:\d\d\b/g, 'HH:MM:SS').replace(/term-[0-9a-f]{8}/g, 'term-<id>').replace(/_5b_22[^ ]*_5d/g, '<id>'));
  const attrsOf = (el) => (el ? Object.fromEntries([...el.attributes].map((a) => [a.name, clean(a.value)])) : null);
  const TEXT = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'whiteSpace', 'textAlign'];
  const BOX = ['display', 'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderBottomWidth', 'borderBottomColor', 'borderRightWidth', 'borderRightColor', 'borderTopLeftRadius', 'boxShadow', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'opacity', 'cursor'];
  T.rect = rect; T.norm = norm; T.pick = pick; T.clean = clean;

  T.view = () => document.querySelector('#panel-body > .panel__view:not([hidden])');
  const q = (s, root = T.view()) => (root ? root.querySelector(s) : null);

  // A glyph by its name: the shapes of the SVG against H.icon(name) of the candidates (attribute order and the class are not compared).
  const NAMES = ['IntUiInfo', 'IntUiError', 'IntUiWarning', 'IntUiSuccess', 'LuLoader', 'LuSquareTerminal', 'LuSearch', 'LuEraser', 'LuCopy', 'LuCheck', 'LuClipboardPaste', 'LuPencil', 'LuSquare', 'LuRotateCw', 'LuPanelRightOpen', 'LuEllipsis',
    'LuPlus', 'LuScrollText', 'LuX', 'LuRegex', 'LuCaseSensitive', 'LuChevronUp', 'LuChevronDown', 'LuTriangleAlert', 'LuCircleAlert', 'LuCircleCheck', 'LuInfo', 'LuPlay', 'LuRefreshCw', 'LuRotateCcw'];
  const shapes = (svg) => [...svg.querySelectorAll('*')].map((k) => `${k.tagName.toLowerCase()}:${[...k.attributes].filter((a) => !['class', 'style'].includes(a.name)).map((a) => `${a.name}=${a.value}`).sort().join(',')}`).join('|');
  let known = null;
  T.glyph = (el) => {
    const svg = el instanceof Element ? (el.matches('svg') ? el : el.querySelector('svg')) : null;
    if (!svg) return null;
    if (known === null) {
      known = {};
      for (const name of NAMES) { try { const t = document.createElement('template'); t.innerHTML = H.icon(name); const s = t.content.querySelector('svg'); if (s) known[shapes(s)] = name; } catch { /* an icon the mock does not have */ } }
    }
    return known[shapes(svg)] ?? `unknown:${shapes(svg).slice(0, 80)}`;
  };

  /** Active element: what it is and which region holds it. */
  T.region = (el) => (!el ? null : el === document.body ? 'body' : el.closest('.pterm__find') ? 'terminal find' : el.matches('input.code__line') ? 'terminal input' : el.closest('.pterm__screen') ? 'terminal screen' : el.closest('.panel__tools') ? 'panel toolbar'
    : el.closest('.toolheader') ? 'panel header' : el.closest('.ptool__status') ? 'panel status lane' : el.closest('.ptool__failure, .ptool__notice') ? 'panel notice' : el.closest('#shell-panel') ? 'panel' : el.closest('.statusbar') ? 'status bar'
    : el.closest('.topbar') ? 'top row' : el.closest('.frame__rail') ? 'rail' : el.closest('.frame__sidebar') ? 'sidebar' : el.closest('.frame__lane') ? 'context lane' : el.closest('.frame__inspector') ? 'inspector'
    : el.closest('.frame__island, #mainscroll, .pane') ? 'page' : el.closest('.splitter') || el.classList.contains('splitter') ? 'splitter' : el.closest('[role=menu]') ? 'menu' : el.closest('.dlg') ? 'dialog' : 'other');
  // An element as { region, tag, id?, cls?, label?, text?, tabindex? }: a field the element does not have is left out.
  T.describe = (el) => {
    if (!el) return null;
    const label = clean(el.getAttribute('aria-label')), text = label ? null : norm(el.textContent)?.slice(0, 40) || null;
    const out = { region: T.region(el), tag: el.tagName.toLowerCase(), id: el.id ? clean(el.id).split('--panel-')[0] : null, cls: typeof el.className === 'string' ? el.className.trim() || null : null, label, text, tabindex: el.getAttribute('tabindex') };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null));
  };

  /** The live region: every text it is given from the moment startLive runs. */
  T.startLive = () => {
    window.__live = [];
    const region = document.getElementById('shell-live');
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof Element && norm(n.textContent)) window.__live.push({ text: norm(n.textContent), urgent: n.getAttribute('role') === 'alert' });
    }).observe(region, { childList: true });
  };
  T.takeLive = () => { const out = window.__live; window.__live = []; return out; };
  T.toasts = () => { const f = document.getElementById('feedback'); return f ? [...f.querySelectorAll('[role=status], [role=alert], .toast')].map((n) => norm(n.textContent)).filter(Boolean) : []; };

  const buttonOf = (b, root, bo) => ({
    text: norm(b.textContent), name: b.getAttribute('aria-label') ?? norm(b.textContent), rect: rect(b), rel: rect(b, bo), primary: b.classList.contains('primary'), cls: b.className.trim(), haspopup: b.getAttribute('aria-haspopup'), expanded: b.getAttribute('aria-expanded'),
    disabled: b.getAttribute('aria-disabled'), reason: b.getAttribute('data-tooltip-reason'), action: clean(b.dataset.action ?? null), glyph: T.glyph(b),
    hint: b.querySelector('kbd') ? { text: norm(b.querySelector('kbd [aria-hidden]')?.textContent), speech: norm(b.querySelector('kbd .visually-hidden')?.textContent) } : null,
  });

  T.frame = () => {
    const body = document.querySelector('.panel__body'), bo = body.getBoundingClientRect(), v = T.view();
    const part = (el) => ({ abs: rect(el), rel: rect(el, bo) });
    return { panel: rect(document.getElementById('shell-panel')), body: rect(body), view: rect(v), tools: part(q(':scope > .panel__tools')), content: part(q(':scope > .panel__content')), tool: part(q('.ptool')), main: part(q('.ptool__main')) };
  };

  T.toolbar = () => {
    const tools = q(':scope > .panel__tools');
    if (!tools) return null;
    const body = document.querySelector('.panel__body'), bo = body.getBoundingClientRect(), to = tools.getBoundingClientRect();
    const buttons = [...tools.querySelectorAll('button')].map((b, i) => {
      const svg = b.querySelector('svg'), label = b.getAttribute('aria-label'), tip = b.getAttribute('data-tooltip');
      return {
        i, label, rect: rect(b), relTools: rect(b, to), svg: rect(svg), glyph: T.glyph(b), ariaPressed: b.getAttribute('aria-pressed'), ariaDisabled: b.getAttribute('aria-disabled'),
        ariaHaspopup: b.getAttribute('aria-haspopup'), ariaExpanded: b.getAttribute('aria-expanded'), tabindex: b.getAttribute('tabindex'), reason: b.getAttribute('data-tooltip-reason'), tooltip: tip === label ? undefined : tip, action: clean(b.dataset.action ?? null),
        color: getComputedStyle(b).color, cursor: getComputedStyle(b).cursor,
      };
    });
    const real = buttons.filter((b) => b.label !== 'More actions');
    return {
      role: tools.getAttribute('role'), ariaOrientation: tools.getAttribute('aria-orientation'), ariaLabel: tools.getAttribute('aria-label'), dataRoving: tools.getAttribute('data-roving'), rect: rect(tools), rel: rect(tools, bo),
      style: pick(tools, ['display', 'flexDirection', 'alignItems', 'rowGap', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'overflowY', 'backgroundColor', 'borderRightWidth', 'borderRightColor', 'borderRightStyle']),
      slots: { bodyHeight: r2(bo.height), slotsFor: Math.max(0, Math.floor((bo.height - 4) / 32)), shown: real.length, behindMore: buttons.some((b) => b.label === 'More actions') },
      scroll: { scrollHeight: tools.scrollHeight, clientHeight: tools.clientHeight }, tabStops: buttons.filter((b) => b.tabindex === '0').length, buttons,
    };
  };

  T.screen = () => {
    const s = q('.pterm__screen');
    if (!s) return null;
    const pre = s.querySelector(':scope > pre'), cs = getComputedStyle(s), pcs = pre ? getComputedStyle(pre) : null;
    const cell = T.cell();
    const padX = pcs ? parseFloat(pcs.paddingLeft) + parseFloat(pcs.paddingRight) : 0, padY = pcs ? parseFloat(pcs.paddingTop) + parseFloat(pcs.paddingBottom) : 0, line = pcs ? parseFloat(pcs.lineHeight) : 0;
    return {
      rect: rect(s), tag: s.tagName.toLowerCase(), cls: s.className.trim(), tabindex: s.getAttribute('tabindex'), role: s.getAttribute('role'), ariaLabel: clean(s.getAttribute('aria-label')), dataFont: s.getAttribute('data-font'), dataState: s.getAttribute('data-state'),
      dataShellKeys: s.getAttribute('data-shell-keys'), scroll: { scrollWidth: s.scrollWidth, scrollHeight: s.scrollHeight, clientWidth: s.clientWidth, clientHeight: s.clientHeight, scrollTop: r2(s.scrollTop), offsetWidth: s.offsetWidth },
      style: pick(s, ['display', 'overflowX', 'overflowY', 'position', 'backgroundColor', 'color', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'cursor', 'overscrollBehaviorY']),
      pre: pre ? { rect: rect(pre), role: pre.getAttribute('role'), ariaLabel: clean(pre.getAttribute('aria-label')), cls: pre.className.trim(), style: pick(pre, [...TEXT, 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'backgroundColor', 'tabSize', 'fontVariantLigatures', 'overflowWrap']) } : null,
      grid: cell && line ? { columns: Math.max(1, Math.floor((s.clientWidth - padX) / cell.canvasM)), rows: Math.max(1, Math.floor((s.clientHeight - padY) / line)), byCell: cell.perChar ? Math.floor((s.clientWidth - padX) / cell.perChar) : null,
        basis: 'columns / rows: the mock measureProducerViewport (what it sends to the producer): floor((clientWidth - padding) / canvas M width) by floor((clientHeight - padding) / line height); byCell: floor((clientWidth - padding) / the measured cell)' } : null,
    };
  };

  /** One character cell of the code font: a Range over the first 20 characters of the row that starts `Applications  Deskto` (the `ls` row of the home directory), else of the first plain row. */
  T.cell = () => {
    const pre = q('.pterm__screen > pre');
    if (!pre) return null;
    const rows = [...pre.querySelectorAll(':scope > .code__row')];
    const row = rows.find((r) => r.textContent.startsWith('Applications  Deskto')) ?? rows.find((r) => r.textContent.length >= 20 && r.firstChild?.nodeType === 3);
    const node = row?.firstChild;
    const cs = getComputedStyle(pre), canvas = document.createElement('canvas').getContext('2d');
    canvas.font = cs.font;
    const canvasM = canvas.measureText('M').width;
    const base = { canvasM: Math.round(canvasM * 1000) / 1000, canvasFontSet: cs.font, canvasFontApplied: canvas.font, fontLoaded: document.fonts.check(`${cs.fontSize} ${cs.fontFamily}`) };
    if (!node || node.nodeType !== 3 || node.length < 20) return { sample: null, width: null, perChar: null, ...base };
    const range = document.createRange();
    range.setStart(node, 0); range.setEnd(node, 20);
    const w = range.getBoundingClientRect().width;
    return { sample: clean(node.data.slice(0, 20)), width: r2(w), perChar: Math.round((w / 20) * 1000) / 1000, ...base };
  };

  T.rows = () => {
    const pre = q('.pterm__screen > pre');
    if (!pre) return null;
    const bo = document.querySelector('.panel__body').getBoundingClientRect();
    const rows = [...pre.querySelectorAll(':scope > .code__row')];
    const plain = rows.filter((r) => !r.classList.contains('code__row--input'));
    const first = rows[0];
    const prompt = pre.querySelector('.tok-prompt:not([aria-hidden])'), fn = pre.querySelector('.tok-fn'), muted = rows.find((r) => r.hasAttribute('data-muted'));
    const ys = rows.map((r) => r.getBoundingClientRect().top);
    return {
      count: plain.length, texts: plain.map((r) => clean(norm(r.textContent))), muted: plain.map((r) => r.hasAttribute('data-muted')), kinds: plain.map((r) => (r.querySelector('.tok-prompt') ? 'prompt' : 'output')),
      first: first ? { rect: rect(first), rel: rect(first, bo), style: pick(first, [...TEXT, 'paddingLeft', 'paddingRight', 'minHeight', 'backgroundColor']) } : null,
      last: plain.length ? { text: clean(norm(plain.at(-1).textContent)), rect: rect(plain.at(-1)) } : null,
      heights: [...new Set(rows.map((r) => r2(r.getBoundingClientRect().height)))], pitch: ys.length > 1 ? r2((ys.at(-1) - ys[0]) / (ys.length - 1)) : null, cell: T.cell(),
      prompt: prompt ? { color: getComputedStyle(prompt).color, userSelect: getComputedStyle(prompt).userSelect || getComputedStyle(prompt).webkitUserSelect } : null, command: fn ? { color: getComputedStyle(fn).color } : null, mutedColor: muted ? getComputedStyle(muted).color : null,
    };
  };

  T.input = () => {
    const row = q('.code__row--input'), inp = row?.querySelector('input.code__line'), pr = row?.querySelector('.tok-prompt');
    if (!inp) return null;
    return {
      row: { rect: rect(row), style: pick(row, ['display', 'alignItems', 'minHeight', 'paddingLeft', 'paddingRight', 'backgroundColor', 'boxShadow', 'color']) },
      prompt: { text: norm(pr?.textContent), rect: rect(pr), ariaHidden: pr?.getAttribute('aria-hidden') ?? null, color: pr ? getComputedStyle(pr).color : null, display: pr ? getComputedStyle(pr).display : null, marginInlineEnd: pr ? getComputedStyle(pr).marginInlineEnd : null },
      field: { rect: rect(inp), style: pick(inp, [...TEXT, 'height', 'caretColor', 'backgroundColor', 'borderTopWidth', 'outlineStyle', 'cursor']), placeholderColor: getComputedStyle(inp, '::placeholder').color },
      attrs: attrsOf(inp), readOnly: inp.readOnly, focused: document.activeElement === inp, value: inp.value, placeholder: inp.getAttribute('placeholder'),
    };
  };

  T.strip = () => {
    const s = q('.ptool__status');
    if (!s) return null;
    const st = s.querySelector('.ptool__state'), op = s.querySelector('.ptool__operation');
    return {
      rect: rect(s), role: s.getAttribute('role'), ariaLabel: s.getAttribute('aria-label'),
      style: pick(s, ['display', 'height', 'boxSizing', 'paddingLeft', 'paddingRight', 'columnGap', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderBottomWidth', 'backgroundColor', 'color', ...TEXT.slice(0, 5)]),
      state: st ? { text: norm(st.textContent), rect: rect(st), tooltip: st.getAttribute('data-tooltip'), clip: st.hasAttribute('data-tooltip-clip'), style: pick(st, ['color', 'width', 'flexBasis', 'overflow']), ariaLive: st.getAttribute('aria-live') } : null,
      operation: op ? { rect: rect(op), text: norm(op.textContent) } : null, children: [...s.children].map((c) => c.className),
    };
  };

  T.notice = () => {
    const f = q('.ptool__failure'), n = q('.ptool__notice'), box = f ?? n;
    if (!box) return null;
    const bo = document.querySelector('.panel__body').getBoundingClientRect();
    const notice = box.querySelector('.notice'), text = box.querySelector('.pfail__text'), actions = box.querySelector('.notice__actions');
    return {
      where: f ? 'failure' : 'notice', box: rect(box), boxRel: rect(box, bo), boxStyle: pick(box, ['paddingTop', 'paddingLeft', 'borderTopWidth', 'borderTopColor', 'width', 'overflowY']),
      notice: notice ? { rect: rect(notice), cls: notice.className.trim(), role: notice.getAttribute('role'), glyph: T.glyph(notice.querySelector('.notice__icon')), glyphRect: rect(notice.querySelector('.notice__icon svg')), title: norm(text?.querySelector('b')?.textContent), message: norm(text?.textContent.replace(text.querySelector('b')?.textContent ?? '', '')),
        tooltip: text?.getAttribute('data-tooltip') ?? null, textRect: rect(text), textStyle: pick(text, TEXT), clamp: text ? getComputedStyle(text).webkitLineClamp : null, style: pick(notice, ['backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderTopLeftRadius', 'paddingTop', 'paddingLeft', 'columnGap', 'minHeight']) } : null,
      actions: { rect: rect(actions), buttons: actions ? [...actions.querySelectorAll('button')].map((b) => buttonOf(b)) : [] },
    };
  };

  T.tab = () => {
    const item = [...document.querySelectorAll('#shell-panel .toolheader__sessionlist > .tab-item')].find((i) => i.querySelector('[role=tab]')?.getAttribute('aria-selected') === 'true');
    if (!item) return null;
    const tab = item.querySelector('[role=tab]'), lead = item.querySelector('.toolheader__lead'), close = item.querySelector('.tab__close');
    return {
      aria: tab.getAttribute('aria-label'), head: norm(item.querySelector('.toolheader__sessionhead')?.textContent), leadState: lead?.getAttribute('data-state') ?? null, glyph: T.glyph(lead), leadColor: lead ? getComputedStyle(lead).color : null,
      closeLabel: close?.getAttribute('aria-label') ?? null, rect: rect(item),
    };
  };

  T.names = () => {
    const v = T.view(), body = document.querySelector('.panel__body');
    return {
      panelBody: { role: body.getAttribute('role'), ariaLabelledby: body.getAttribute('aria-labelledby'), id: body.id }, toolTab: norm(document.querySelector('#shell-panel .toolheader__tablist [role=tab][aria-selected="true"]')?.textContent),
      toolbar: q(':scope > .panel__tools')?.getAttribute('aria-label') ?? null, screen: { role: q('.pterm__screen')?.getAttribute('role') ?? null, ariaLabel: clean(q('.pterm__screen')?.getAttribute('aria-label') ?? null) }, pre: clean(q('.pterm__screen > pre')?.getAttribute('aria-label') ?? null),
      input: clean(q('input.code__line')?.getAttribute('aria-label') ?? null), strip: q('.ptool__status')?.getAttribute('aria-label') ?? null, noticeRole: q('.notice')?.getAttribute('role') ?? null,
      liveRegions: [...(v?.querySelectorAll('[aria-live], [role=status], [role=alert]') ?? [])].map((n) => ({ cls: n.className?.trim?.() ?? null, ariaLive: n.getAttribute('aria-live'), role: n.getAttribute('role'), text: norm(n.textContent) })),
    };
  };

  /** Everything a state reading holds that does not need the pointer or the keyboard. */
  T.state = (id) => ({
    panelState: Shell.panel.state(), sessionState: id ? Shell.panel.sessions.get(id)?.state ?? null : null,
    session: id ? (() => { const s = Shell.panel.sessions.get(id); return s ? { state: s.state, exit: s.exit ?? null, label: s.label, certainty: s.certainty ?? null, cause: s.cause ?? null } : null; })() : null,
    frame: T.frame(), tab: T.tab(), toolbar: T.toolbar(), screen: T.screen(), rows: T.rows(), input: T.input(), strip: T.strip(), notice: T.notice(), names: T.names(),
    statusBar: [...document.querySelectorAll('.statusbar .statusitem')].map((el) => norm(el.textContent) || el.getAttribute('aria-label')),
  });

  /** The session card: the open card's parts and texts. */
  T.card = () => {
    const card = document.querySelector('.psession-card:popover-open');
    if (!card) return null;
    const c = (s) => card.querySelector(s);
    return {
      placement: card.getAttribute('data-placement'), card: rect(card), head: rect(c('.psession-card__head')), kind: norm(c('.psession-card__kind')?.textContent), kindRect: rect(c('.psession-card__kind')), facts: [...card.querySelectorAll('.kv .kv__row')].map((row) => rect(row)),
      texts: [...card.querySelectorAll('.kv dt, .kv dd')].map((el) => norm(el.textContent).replace(/\s+since \d\d:\d\d/, ' since HH:MM')), actions: [...card.querySelectorAll('.psession-card__actions button')].map((b) => norm(b.textContent)),
    };
  };
  T.describe2 = (id) => {
    const d = Shell.panel.cards.describe(id);
    return d ? { kind: d.kind ?? null, state: d.state ?? null, facts: d.facts ?? null, actions: (d.actions ?? []).map((a) => a.label), open: d.open ? true : null } : null;
  };

  T.menuNow = () => {
    const m = [...document.querySelectorAll('[role=menu]')].find(shown);
    if (!m) return null;
    return { label: m.getAttribute('aria-label'), rect: rect(m), items: [...m.querySelectorAll('[role^=menuitem]')].map((i) => ({ text: norm(i.textContent), role: i.getAttribute('role'), disabled: i.getAttribute('aria-disabled'), reason: i.getAttribute('data-tooltip-reason'), keys: i.querySelector('kbd')?.textContent ?? null })) };
  };
  T.panelNow = () => { const p = document.getElementById('shell-panel'), b = document.querySelector('.panel__body'); return { state: Shell.panel.state(), panel: rect(p), body: rect(b) }; };

  /** Opens one local shell and waits for the state. Returns the id. */
  T.open = async (name, shell, want = 'running') => {
    const targets = Shell.panel.targets.list('terminal').find((group) => group.plugin === 'host').targets;
    const id = Shell.panel.terminal.open(targets.find((t) => t.id === `local/${shell}`));
    Shell.panel.sessions.rename(id, name);
    for (let i = 0; i < 100 && Shell.panel.sessions.get(id)?.state !== want; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 500));
    return id;
  };
  T.run = async (id, lines) => { for (const line of lines) { await Shell.panel.terminal.run(id, line); await new Promise((r) => setTimeout(r, 500)); } };
  T.settle = (ms) => new Promise((r) => setTimeout(r, ms));
}

const AWAY = { x: 720, y: 250 };
const ev = (page, fn, arg) => page.evaluate(fn, arg);

/** The init script of the copy readings: every write to the clipboard is kept in window.__clip (by either route the mock tries); `readText` is absent, so a paste says what it says without the permission. */
const CLIP_INIT = () => {
  window.__clip = [];
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__clip.push(String(text)); } } }); } catch { /* kept as is */ }
};

async function open(browser, viewport, { clip = false } = {}) {
  const context = await browser.newContext({ viewport, timezoneId: 'UTC', locale: 'en-US' });
  try {
    if (clip) await context.addInitScript(CLIP_INIT);
    const page = await context.newPage();
    // What the browser measures must be what `verifyMock` certified: the document comes from the verified address and every request of the load stays on its origin, or a mock that redirects the base page to another build, and serves the right bytes at the tree's paths, would be measured under the tree's name.
    const origin = new URL(url).origin;
    const foreign = [];
    page.on('request', (request) => {
      if (!/^(data|blob|about):/.test(request.url()) && !request.url().startsWith(origin)) foreign.push(request.url());
    });
    await page.goto(url, { waitUntil: 'load' });
    if (new URL(page.url()).origin !== origin || ![new URL(url).pathname, `${new URL(url).pathname}index.html`.replace('//', '/')].includes(new URL(page.url()).pathname)) {
      throw new Error(`the mock at ${url} sent the browser to ${page.url()}: that document is not the one verifyMock certified`);
    }

    if (foreign.length > 0) throw new Error(`the mock at ${url} loaded ${foreign.slice(0, 3).join(', ')} from outside its own origin: what is measured is not only the tree verifyMock certified`);
    await sleep(3000);
    await page.waitForFunction(() => typeof Shell !== 'undefined' && Shell.panel?.show !== undefined && Shell.panel.terminal !== undefined);
    await sleep(1500);
    await normalizeFont(page, { rootVar: '--int-font-ui' });
    await page.evaluate(install);
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** The panel's splitter by the keyboard (Home: minimum, End: maximum); the handle gives the focus back. */
async function resizePanel(page, keys) {
  await ev(page, () => document.querySelector('.app > .splitter[data-handle="panel"]').focus());
  for (const key of keys) { await page.keyboard.press(key); await sleep(120); }
  await sleep(700);
  await ev(page, () => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(AWAY.x, AWAY.y);
  return ev(page, () => __tm.panelNow());
}
const blur = (page) => ev(page, () => document.activeElement instanceof HTMLElement && document.activeElement.blur());

/** The card of the tab at `index`, with the pointer on it. */
async function readCard(page, id, index) {
  const tabs = '#shell-panel .toolheader__sessionlist > .tab-item [role=tab]';
  await page.mouse.move(1, 1);
  await blur(page);
  await sleep(400);
  const box = await (await page.$$(tabs))[index].boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
  await sleep(1000);
  const hover = await ev(page, () => __tm.card());
  const describe = await ev(page, (sid) => __tm.describe2(sid), id);
  await page.mouse.move(1, 1);
  await sleep(500);
  return { hover, describe };
}

/** The `More actions` menu at the panel's current height: click, read, close with Escape. */
async function readMore(page) {
  const handle = await page.$('#panel-body > .panel__view:not([hidden]) .panel__tools button[aria-label="More actions"]');
  if (handle === null) return null;
  await handle.click();
  await sleep(500);
  const menu = await ev(page, () => __tm.menuNow());
  await page.keyboard.press('Escape');
  await sleep(300);
  await blur(page);
  await page.mouse.move(AWAY.x, AWAY.y);
  return menu;
}

/** The `⋯` of the failure or restore notice: click, read the menu, close with Escape. null when the state has no notice. */
async function readNoticeMenu(page) {
  const handle = await page.$('#panel-body > .panel__view:not([hidden]) .notice__actions button[aria-label="More actions"]');
  if (handle === null) return null;
  await handle.click();
  await sleep(500);
  const menu = await ev(page, () => __tm.menuNow());
  await page.keyboard.press('Escape');
  await sleep(300);
  await blur(page);
  await page.mouse.move(AWAY.x, AWAY.y);
  return menu;
}

/** The focus rings: the screen, then the input, each reached by a Shift key press then .focus() (the keyboard's focus, focus-visible). */
async function readFocus(page) {
  const out = {};
  await blur(page);
  await page.mouse.move(1, 1);
  await page.keyboard.press('Shift');
  await ev(page, () => __tm.view().querySelector('.pterm__screen').focus());
  await sleep(250);
  out.screen = await ev(page, () => {
    const s = __tm.view().querySelector('.pterm__screen'), cs = getComputedStyle(s);
    return { matches: { focus: s.matches(':focus'), focusVisible: s.matches(':focus-visible') }, outline: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset }, active: __tm.describe(document.activeElement) };
  });
  await blur(page);
  await page.keyboard.press('Shift');
  await ev(page, () => __tm.view().querySelector('input.code__line').focus());
  await sleep(250);
  out.input = await ev(page, () => {
    const i = __tm.view().querySelector('input.code__line'), row = i.closest('.code__row'), cs = getComputedStyle(i), rs = getComputedStyle(row);
    return { matches: { focus: i.matches(':focus'), focusVisible: i.matches(':focus-visible') }, outline: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor }, borderColor: cs.borderTopColor,
      row: { backgroundColor: rs.backgroundColor, boxShadow: rs.boxShadow, rect: __tm.rect(row) }, caretColor: cs.caretColor };
  });
  await blur(page);
  return out;
}

/** One state reading of the session `id` (the selected one), at the panel's default height, then the menu and the whole toolbar (the panel is raised: the page is not read after that). */
async function readState(page, id, index, { focus = false, tall = false, extras = true } = {}) {
  await page.mouse.move(AWAY.x, AWAY.y);
  // Where the focus is when the reading starts (a session that just opened or ran a command keeps it in its input: S116a), before the reading takes it away.
  const activeBefore = await ev(page, () => __tm.describe(document.activeElement));
  await blur(page);
  await sleep(300);
  const reading = await ev(page, (sid) => __tm.state(sid), id);
  reading.activeBefore = activeBefore;
  if (focus) reading.focus = await readFocus(page);
  if (extras) {
    reading.card = await readCard(page, id, index);
    reading.moreMenu = await readMore(page);
    reading.noticeMenu = await readNoticeMenu(page);
  }
  if (tall) {
    reading.panelTall = await resizePanel(page, ['End']);
    reading.toolbarTall = await ev(page, () => __tm.toolbar());
  }
  return reading;
}

async function scenarioEmpty(page) {
  await ev(page, () => { Shell.panel.show('terminal'); });
  await sleep(900);
  return ev(page, () => {
    const T = __tm, v = T.view(), e = v.querySelector('.panel__empty'), box = e?.querySelector('.empty2'), title = box?.querySelector('b'), hint = box?.querySelector('.tiny'), big = box?.querySelector('.bigicon'), acts = e?.querySelector('.panel__actions');
    const style = (el) => T.pick(el, ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'textAlign']);
    return {
      panelState: Shell.panel.state(), frame: T.frame(), toolbar: T.toolbar(), names: T.names(),
      empty: {
        box: T.rect(e), group: T.rect(box), groupStyle: T.pick(box, ['display', 'flexDirection', 'alignItems', 'rowGap', 'paddingTop', 'textAlign']), bigicon: T.rect(big), bigiconStyle: T.pick(big, ['width', 'height', 'color']), glyph: { rect: T.rect(big?.querySelector('svg')), name: T.glyph(big) },
        title: { text: T.norm(title?.textContent), rect: T.rect(title), style: style(title) }, hint: { text: T.norm(hint?.textContent), rect: T.rect(hint), style: style(hint) },
        actions: { rect: T.rect(acts), style: T.pick(acts, ['display', 'columnGap', 'justifyContent']), buttons: acts ? [...acts.querySelectorAll('button')].map((b) => ({
          text: T.norm(b.textContent), name: b.getAttribute('aria-label') ?? T.norm(b.textContent), rect: T.rect(b), primary: b.classList.contains('primary'), cls: b.className.trim(), haspopup: b.getAttribute('aria-haspopup'), action: b.dataset.action ?? null, glyph: T.glyph(b),
          hint: b.querySelector('kbd') ? { text: T.norm(b.querySelector('kbd [aria-hidden]')?.textContent), speech: T.norm(b.querySelector('kbd .visually-hidden')?.textContent) } : null,
          style: T.pick(b, ['height', 'color', 'backgroundColor', 'borderTopColor', 'fontSize', 'fontWeight']),
        })) : [] },
      },
      tab: { tool: T.norm(document.querySelector('#shell-panel .toolheader__tablist [role=tab][aria-selected="true"]')?.textContent), sessionTabs: document.querySelectorAll('#shell-panel .toolheader__sessionlist > .tab-item').length },
    };
  });
}

async function scenarioRunning(page) {
  await ev(page, () => { Shell.panel.show('terminal'); });
  await sleep(700);
  const id = await ev(page, async () => { const id = await __tm.open('zsh', 'zsh'); await __tm.run(id, ['echo hello', 'ls', 'pwd']); return id; });
  await sleep(800);
  return readState(page, id, 0, { focus: true, tall: true });
}

async function scenarioEnded(page) {
  await ev(page, () => { Shell.panel.show('terminal'); });
  await sleep(700);
  const out = {};
  const a = await ev(page, async () => { const id = await __tm.open('zsh', 'zsh'); await __tm.run(id, ['echo hello', 'exit']); return id; });
  await sleep(1200);
  out.exit0 = await readState(page, a, 0, { tall: false });
  // exit 3 in a second session (bash), the selected one.
  await ev(page, () => { Shell.panel.show('terminal'); });
  const b = await ev(page, async () => { const id = await __tm.open('bash', 'bash'); await __tm.run(id, ['echo hello', 'exit 3']); return id; });
  await sleep(1200);
  out.exit3 = await readState(page, b, 1, { tall: false });
  // Enter on the exited session's input: the restart.
  await ev(page, () => __tm.view().querySelector('input.code__line').focus());
  await page.keyboard.press('Enter');
  await sleep(2500);
  out.restart = await readState(page, b, 1, { tall: false });
  return out;
}

/** A failed session, in a page of its own, three ways (see the header). `simFailNew` is a reading of a RACE: it is kept with the states it passed through. */
async function scenarioFailed(browser, viewport, way) {
  const page = await open(browser, viewport);
  try {
    await ev(page, () => { Shell.panel.show('terminal'); });
    await sleep(700);
    const made = await ev(page, async (how) => {
      const states = [];
      if (how === 'startRejected') {
        Shell.panel.producers.register({ id: 'probe.fail', kinds: ['terminal'], start: async () => { throw Object.assign(new Error('probe start rejected'), { sessionCause: 'The shell could not be started' }); }, stop: async () => ({ acknowledged: true }), reconnect: async () => ({}), dispose: async () => undefined });
        const id = Shell.panel.terminal.open({ id: 'failstart', label: 'Fail shell', producer: 'probe.fail', kind: 'local' });
        Shell.panel.sessions.rename(id, 'zsh');
        await __tm.settle(1500);
        return { id, states };
      }
      if (how === 'simFailHeld') {
        // A producer whose start never says `running`: the session stays connecting until sim.fail.
        Shell.panel.producers.register({ id: 'probe.hold', kinds: ['terminal'], start: async () => ({ hold: true }), stop: async () => ({ acknowledged: true }), reconnect: async () => ({}), dispose: async () => undefined });
        const id = Shell.panel.terminal.open({ id: 'hold', label: 'Held shell', producer: 'probe.hold', kind: 'local' });
        Shell.panel.sessions.rename(id, 'zsh');
        await __tm.settle(1200);
        states.push(Shell.panel.sessions.get(id).state);
        Shell.panel.sim.fail(id, 'The connection was refused');
        await __tm.settle(1500);
        states.push(Shell.panel.sessions.get(id).state);
        return { id, states };
      }
      if (how === 'simFailNew') {
        const targets = Shell.panel.targets.list('terminal').find((group) => group.plugin === 'host').targets;
        const id = Shell.panel.terminal.open(targets.find((t) => t.id === 'local/zsh'));
        Shell.panel.sessions.rename(id, 'zsh');
        await Promise.resolve();
        Shell.panel.sim.fail(id, 'The connection was refused');
        for (let i = 0; i < 40; i++) { const s = Shell.panel.sessions.get(id).state; if (states.at(-1) !== s) states.push(s); await __tm.settle(50); }
        return { id, states };
      }
      const id = await __tm.open('zsh', 'zsh');
      await __tm.run(id, ['echo hello']);
      Shell.panel.sim.fail(id, 'The connection was refused');
      await __tm.settle(1000);
      states.push(Shell.panel.sessions.get(id).state);
      return { id, states };
    }, way);
    await sleep(600);
    const reading = await readState(page, made.id, 0, { extras: way !== 'simFailNew', tall: false });
    reading.stateLog = made.states;
    return reading;
  } finally {
    await page.context().close();
  }
}

async function scenarioRestored(page) {
  await ev(page, () => { Shell.panel.show('terminal'); });
  await sleep(700);
  const id = await ev(page, async () => { const id = await __tm.open('zsh', 'zsh'); await __tm.run(id, ['echo hello']); await Shell.panel.sim.expire([id]); await __tm.settle(1000); return id; });
  await sleep(600);
  return readState(page, id, 0);
}

/** Connecting (a producer of the probe's own that holds its start), reconnecting (Shell.panel.sim.drop on a running shell: the attempts are 1.5 s each) and the connection restored. */
async function scenarioTransient(page) {
  await ev(page, () => { Shell.panel.show('terminal'); __tm.startLive(); });
  await sleep(700);
  const out = {};
  const held = await ev(page, async () => {
    Shell.panel.producers.register({ id: 'probe.slow', kinds: ['terminal'], start: async () => ({ slow: true }), stop: async () => ({ acknowledged: true }), reconnect: async () => ({ slow: true }), dispose: async () => undefined });
    const id = Shell.panel.terminal.open({ id: 'slow', label: 'Slow shell', producer: 'probe.slow', kind: 'local' });
    Shell.panel.sessions.rename(id, 'zsh');
    await __tm.settle(1800);
    // The spinners turn: cancel their animations so the rectangles are not read mid-turn.
    document.getAnimations().forEach((animation) => animation.cancel());
    return id;
  });
  out.connecting = await readState(page, held, 0, { extras: false });
  out.connectingLive = await ev(page, () => __tm.takeLive());
  await ev(page, async (id) => { await Shell.panel.sessions.close(id, { force: true }); }, held);
  await sleep(500);
  const id = await ev(page, async () => { const id = await __tm.open('zsh', 'zsh'); await __tm.run(id, ['echo hello']); __tm.takeLive(); Shell.panel.sim.drop(id); await __tm.settle(450); document.getAnimations().forEach((animation) => animation.cancel()); return id; });
  out.reconnecting = await readState(page, id, 0, { extras: false });
  await sleep(5200);
  out.reconnected = await readState(page, id, 0, { extras: false });
  out.live = await ev(page, () => __tm.takeLive());
  return out;
}

/** Closing: the confirmation (an idle running shell, a shell with a foreground process), its outcome, and the close of an exited session. */
async function scenarioClose(page) {
  await ev(page, () => { Shell.panel.show('terminal'); __tm.startLive(); });
  await sleep(700);
  const dialog = () => ev(page, () => {
    const T = __tm, d = document.querySelector('#layer .dlg[role=dialog]');
    if (!d) return null;
    return {
      rect: T.rect(d), role: d.getAttribute('role'), ariaModal: d.getAttribute('aria-modal'), title: T.norm(d.querySelector('.hd h2')?.textContent), headerClose: d.querySelector('.hd button')?.getAttribute('aria-label') ?? null,
      who: [...d.querySelectorAll('.bd .identity-header')].map((h) => ({ title: T.norm(h.querySelector('h2')?.textContent), meta: T.norm(h.querySelector('.identity-header__meta')?.textContent) })), text: T.norm(d.querySelector('.bd p')?.textContent),
      buttons: [...d.querySelectorAll('.ft button')].map((b) => ({ text: T.norm(b.textContent), cls: b.className.trim(), rect: T.rect(b) })), active: T.describe(document.activeElement),
    };
  });
  const closeSelected = async () => { await (await page.$('#shell-panel .toolheader__sessionlist .tab-item.active .tab__close')).click(); await sleep(800); };
  const count = () => ev(page, () => Shell.panel.sessions.list('terminal').length);
  const out = {};
  const a = await ev(page, () => __tm.open('zsh', 'zsh'));
  out.closeLabel = await ev(page, () => document.querySelector('#shell-panel .toolheader__sessionlist .tab-item.active .tab__close')?.getAttribute('aria-label') ?? null);
  await closeSelected();
  out.idle = { dialog: await dialog(), sessions: await count() };
  await page.keyboard.press('Escape');
  await sleep(500);
  out.idle.afterEscape = { dialog: (await dialog()) !== null, sessions: await count() };
  await ev(page, (id) => __tm.run(id, ['sleep 30']), a);
  out.busyInput = await ev(page, () => { const i = __tm.view().querySelector('input.code__line'); return { readOnly: i.readOnly, placeholder: i.getAttribute('placeholder'), ariaDisabled: i.getAttribute('aria-disabled') }; });
  await closeSelected();
  out.busy = { dialog: await dialog(), sessions: await count() };
  out.busy.terminate = await step(page, 'click Terminate', async () => { await (await page.$('#layer .dlg .ft button.primary')).click(); await sleep(1500); });
  out.busy.afterTerminate = { sessions: await count(), dialog: (await dialog()) !== null };
  const b = await ev(page, async () => { const id = await __tm.open('zsh', 'zsh'); await __tm.run(id, ['exit']); return id; });
  await sleep(800);
  out.exitedCloseLabel = await ev(page, () => document.querySelector('#shell-panel .toolheader__sessionlist .tab-item.active .tab__close')?.getAttribute('aria-label') ?? null);
  await closeSelected();
  out.exited = { dialog: await dialog(), sessions: await count(), closed: !(await ev(page, (id) => !!Shell.panel.sessions.get(id), b)) };
  return out;
}

/** One step of the hints: what the live region and the toasts say within 700 ms of the action. */
async function step(page, action, run) {
  await ev(page, () => { __tm.takeLive(); });
  await run();
  await sleep(700);
  return ev(page, (a) => ({ action: a, announced: __tm.takeLive(), live: __tm.norm(document.getElementById('shell-live')?.textContent), toasts: __tm.toasts() }), action);
}

async function copyReading(browser, viewport, clip) {
  const page = await open(browser, viewport, { clip });
  try {
    await ev(page, () => { Shell.panel.show('terminal'); __tm.startLive(); });
    await sleep(700);
    const id = await ev(page, async () => { const id = await __tm.open('zsh', 'zsh'); await __tm.run(id, ['echo hello', 'ls']); return id; });
    const out = {};
    out.before = await ev(page, () => { const b = [...__tm.view().querySelectorAll('.panel__tools button')].find((x) => x.getAttribute('aria-label') === 'Copy selection'); return { ariaDisabled: b.getAttribute('aria-disabled'), reason: b.getAttribute('data-tooltip-reason'), glyph: __tm.glyph(b) }; });
    // Select from the prompt of `echo hello` through the row `hello`.
    out.selected = await ev(page, () => {
      const rows = [...__tm.view().querySelectorAll('.pterm__screen .code__row')], a = rows.find((r) => r.textContent.includes('echo hello')), b = rows.find((r) => r.textContent === 'hello');
      const range = document.createRange(); range.setStartBefore(a); range.setEndAfter(b);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      return { text: __tm.clean(sel.toString()) };
    });
    await sleep(500);
    out.afterSelect = await ev(page, () => { const b = [...__tm.view().querySelectorAll('.panel__tools button')].find((x) => x.getAttribute('aria-label') === 'Copy selection'); return { ariaDisabled: b.getAttribute('aria-disabled'), reason: b.getAttribute('data-tooltip-reason') }; });
    out.copy = await step(page, 'click Copy selection', async () => { await (await page.$('#panel-body > .panel__view:not([hidden]) .panel__tools button[aria-label="Copy selection"]')).click(); });
    out.afterCopy = await ev(page, () => { const b = [...__tm.view().querySelectorAll('.panel__tools button')].find((x) => x.getAttribute('aria-label') === 'Copy selection'); return { glyph: __tm.glyph(b), clipboard: (window.__clip ?? []).map(__tm.clean) }; });
    await sleep(2300);
    out.glyphAfter2s = await ev(page, () => { const b = [...__tm.view().querySelectorAll('.panel__tools button')].find((x) => x.getAttribute('aria-label') === 'Copy selection'); return __tm.glyph(b); });
    return out;
  } finally {
    await page.context().close();
  }
}

async function scenarioHints(browser, viewport) {
  const page = await open(browser, viewport);
  try {
    const out = { steps: [] };
    await ev(page, () => { Shell.panel.show('terminal'); __tm.startLive(); });
    await sleep(700);
    let a;
    out.steps.push(await step(page, 'open zsh (Shell.panel.terminal.open)', async () => { a = await ev(page, () => __tm.open('zsh', 'zsh')); }));
    out.steps.push(await step(page, 'Shell.panel.terminal.run echo hello', async () => { await ev(page, (id) => __tm.run(id, ['echo hello']), a); }));
    out.steps.push(await step(page, 'click Paste (no clipboard read permission)', async () => { await (await page.$('#panel-body > .panel__view:not([hidden]) .panel__tools button[aria-label="Paste"]')).click(); }));
    out.steps.push(await step(page, 'click Clear', async () => { await (await page.$('#panel-body > .panel__view:not([hidden]) .panel__tools button[aria-label="Clear"]')).click(); }));
    out.steps.push(await step(page, 'click Find, type hello (the count lane)', async () => {
      await (await page.$('#panel-body > .panel__view:not([hidden]) .panel__tools button[aria-label="Find"]')).click();
      await sleep(400);
      await ev(page, (id) => { Shell.panel.terminal.run(id, 'echo hello'); }, a);
      await sleep(600);
      await page.keyboard.type('hello');
    }));
    out.find = await ev(page, () => {
      const T = __tm, f = T.view().querySelector('.pterm__find');
      return f ? { rect: T.rect(f), role: f.getAttribute('role'), ariaLabel: f.getAttribute('aria-label'), field: { ariaLabel: f.querySelector('input')?.getAttribute('aria-label'), placeholder: f.querySelector('input')?.getAttribute('placeholder'), describedby: f.querySelector('input')?.getAttribute('aria-describedby') ? 'pterm-count-<id>' : null },
        count: { text: T.norm(f.querySelector('.pterm__count')?.textContent), ariaLive: f.querySelector('.pterm__count')?.getAttribute('aria-live') }, buttons: [...f.querySelectorAll('button')].map((b) => ({ name: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed') })), active: T.describe(document.activeElement) } : null;
    });
    out.steps.push(await step(page, 'Escape in the find field', async () => { await page.keyboard.press('Escape'); }));
    out.findEscape = await ev(page, () => ({ active: __tm.describe(document.activeElement), findOpen: !!__tm.view().querySelector('.pterm__find') }));
    out.steps.push(await step(page, 'Shell.panel.terminal.run exit', async () => { await ev(page, (id) => __tm.run(id, ['exit']), a); }));
    out.steps.push(await step(page, 'Enter on the exited input (restart)', async () => { await ev(page, () => __tm.view().querySelector('input.code__line').focus()); await page.keyboard.press('Enter'); await sleep(1800); }));
    out.steps.push(await step(page, 'exit 3 (restarted session)', async () => { await ev(page, (id) => __tm.run(id, ['exit 3']), a); }));
    let b;
    b = await ev(page, () => __tm.open('bash', 'bash'));
    out.steps.push(await step(page, 'Shell.panel.sim.fail on a running session', async () => { await ev(page, (id) => { Shell.panel.sim.fail(id, 'The connection was refused'); }, b); }));
    let c;
    c = await ev(page, () => __tm.open('sh', 'zsh'));
    out.steps.push(await step(page, 'Shell.panel.sim.expire on a running session', async () => { await ev(page, (id) => Shell.panel.sim.expire([id]), c); }));
    out.names = await ev(page, () => ({ tabs: [...document.querySelectorAll('#shell-panel .toolheader__sessionlist > .tab-item')].map((i) => ({ aria: i.querySelector('[role=tab]').getAttribute('aria-label'), close: i.querySelector('.tab__close')?.getAttribute('aria-label') })), sessionList: document.querySelector('#shell-panel .toolheader__sessionlist')?.getAttribute('aria-label') }));
    return out;
  } finally {
    await page.context().close();
  }
}

/** The keys: every press on a running session, in one page per environment. */
const ENVIRONMENTS = [
  { name: 'browser', override: null },
  { name: 'mac-native', override: { platform: 'mac', mode: 'native' } },
  { name: 'win-web', override: { platform: 'win', mode: 'web' } },
  { name: 'win-native', override: { platform: 'win', mode: 'native' } },
];
const KEYS = ['Escape', 'Tab', 'Shift+Tab', 'F6', 'Shift+F6', 'Meta+j', 'Control+j', 'Control+Alt+j', 'Meta+Shift+j', 'Control+Alt+Shift+j', 'Control+Shift+Backquote', 'Meta+w', 'Control+w', 'Control+Alt+w', 'Control+Shift+w', 'Control+Tab', 'Meta+f', 'Control+Shift+f'];
const SCREEN_KEYS = ['Escape', 'Tab', 'Shift+Tab', 'F6'];

/** The state before every key: no dialog, the panel normal and showing the terminal tool, no find bar, no session but the main one, which is selected. */
async function resetKeys(page, mainId) {
  await ev(page, async (id) => {
    document.querySelector('#layer .dlg [data-overlay-cancel]')?.click();
    await __tm.settle(250);
    if (Shell.panel.state() === 'maximized') { Shell.panel.maximize(); await __tm.settle(400); }
    for (const s of Shell.panel.sessions.list('terminal')) if (s.id !== id) await Shell.panel.sessions.close(s.id, { force: true });
    Shell.panel.show('terminal', { focus: false });
    await __tm.settle(300);
    if (document.querySelector('#panel-body > .panel__view:not([hidden]) .pterm__find')) { Shell.run('host.terminal.find-close'); await __tm.settle(300); }
    const tab = document.querySelector('#shell-panel .toolheader__sessionlist [role=tab]');
    if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
    await __tm.settle(300);
  }, mainId);
}

async function pressKey(page, key, mainId, from) {
  await resetKeys(page, mainId);
  await ev(page, (target) => { const v = __tm.view(); (target === 'input' ? v.querySelector('input.code__line') : v.querySelector('.pterm__screen')).focus(); window.__prevented = null; window.__down = null; }, from);
  await sleep(250);
  const before = await ev(page, () => __tm.describe(document.activeElement));
  await ev(page, () => {
    __tm.takeLive();
    if (!window.__keyHook) { window.__keyHook = true; window.addEventListener('keydown', (e) => { window.__prevented = e.defaultPrevented; window.__down = { key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey }; }); }
  });
  await page.keyboard.press(key);
  await sleep(600);
  return ev(page, ([k, b]) => ({
    key: k, before: b, after: __tm.describe(document.activeElement), panelState: Shell.panel.state(), prevented: window.__prevented, down: window.__down, sessions: Shell.panel.sessions.list('terminal').length,
    dialog: __tm.norm(document.querySelector('#layer .dlg[role=dialog] .hd h2')?.textContent) ?? null, toolSelected: __tm.norm(document.querySelector('#shell-panel .toolheader__tablist [role=tab][aria-selected="true"]')?.textContent), announced: __tm.takeLive().map((a) => a.text),
  }), [key, before]);
}

async function scenarioKeys(browser, viewport) {
  const out = {};
  for (const env of ENVIRONMENTS) {
    const page = await open(browser, viewport);
    try {
      await ev(page, () => { Shell.panel.show('terminal'); __tm.startLive(); });
      await sleep(700);
      const id = await ev(page, async () => { const id = await __tm.open('zsh', 'zsh'); await __tm.run(id, ['echo hello']); return id; });
      if (env.override) await ev(page, (o) => Shell.keys.override(o), env.override);
      await sleep(300);
      const result = await ev(page, () => ({ platform: Shell.keys.platform(), mode: Shell.keys.mode() }));
      result.chords = await ev(page, () => Object.fromEntries(['host.panel.toggle', 'host.terminal.new', 'host.panel.close-session', 'host.panel.find'].map((c) => [c, Shell.keys.hints?.(c) ?? Shell.keys.hint(c)])));
      result.fromInput = [];
      for (const key of KEYS) result.fromInput.push(await pressKey(page, key, id, 'input'));
      result.fromScreen = [];
      for (const key of SCREEN_KEYS) result.fromScreen.push(await pressKey(page, key, id, 'screen'));
      // Escape from the find field and from the input with find open.
      await resetKeys(page, id);
      await (await page.$('#panel-body > .panel__view:not([hidden]) .panel__tools button[aria-label="Find"]')).click();
      await sleep(500);
      const find = [];
      find.push({ step: 'after Find click', active: await ev(page, () => __tm.describe(document.activeElement)) });
      await page.keyboard.press('Escape'); await sleep(400);
      find.push({ step: 'Escape in the find field', active: await ev(page, () => __tm.describe(document.activeElement)), findOpen: await ev(page, () => !!__tm.view().querySelector('.pterm__find')) });
      await (await page.$('#panel-body > .panel__view:not([hidden]) .panel__tools button[aria-label="Find"]')).click();
      await sleep(400);
      await ev(page, () => __tm.view().querySelector('input.code__line').focus());
      await page.keyboard.press('Escape'); await sleep(400);
      find.push({ step: 'Escape in the input with find open', active: await ev(page, () => __tm.describe(document.activeElement)), findOpen: await ev(page, () => !!__tm.view().querySelector('.pterm__find')) });
      result.findEscape = find;
      out[env.name] = result;
    } finally {
      await page.context().close();
    }
  }
  return out;
}

/** Each scenario in a FRESH page, closed whatever it reads. */
async function scenario(browser, viewport, name) {
  if (name === 'hints') {
    const reading = await scenarioHints(browser, viewport);
    reading.copy = { api: await copyReading(browser, viewport, true), native: await copyReading(browser, viewport, false) };
    return reading;
  }
  if (name === 'keys') return scenarioKeys(browser, viewport);
  if (name === 'failed') {
    const out = {};
    for (const way of ['startRejected', 'simFailHeld', 'simFailRan', 'simFailNew']) out[way] = await scenarioFailed(browser, viewport, way);
    return out;
  }
  const page = await open(browser, viewport);
  try {
    return await { empty: scenarioEmpty, running: scenarioRunning, ended: scenarioEnded, restored: scenarioRestored, transient: scenarioTransient, close: scenarioClose }[name](page);
  } finally {
    await page.context().close();
  }
}

/** What a scenario must hold for the reading to count; null when it does. */
const checks = {
  empty: (r) => (r.empty.box === null || r.empty.title.text !== 'No terminals' || r.empty.actions.buttons.length < 2 || r.toolbar !== null ? 'misses the empty state, its title or its buttons, or a toolbar is drawn' : null),
  running: (r) => (r.sessionState !== 'running' || r.screen === null || r.rows === null || r.rows.count < 6 || r.input === null || r.strip === null || r.toolbar === null || r.toolbar.buttons.length < 5 || r.moreMenu === null || r.toolbarTall === null || r.card.hover === null ? 'misses the running session, its screen, rows, input, strip, toolbar, More menu or card' : null),
  ended: (r) => (r.exit0.sessionState !== 'exited' || r.exit3.sessionState !== 'exited' || r.exit0.strip?.state?.text !== 'Exited with code 0' || r.exit3.strip?.state?.text !== 'Exited with code 3' || r.restart.sessionState !== 'running' ? `states are ${r.exit0.sessionState}, ${r.exit3.sessionState}, ${r.restart.sessionState}` : null),
  failed: (r) => (Object.entries(r).filter(([k, v]) => (k === 'simFailNew' ? !v.stateLog.includes('failed') : v.sessionState !== 'failed' || v.notice === null) || v.strip === null).map(([k]) => k).join() || null),
  restored: (r) => (r.sessionState !== 'expired' || r.notice === null || r.strip === null ? `state is ${r.sessionState}` : null),
  transient: (r) => (r.connecting.sessionState !== 'connecting' || r.reconnecting.sessionState !== 'reconnecting' || r.reconnected.sessionState !== 'running' ? `states are ${r.connecting.sessionState}, ${r.reconnecting.sessionState}, ${r.reconnected.sessionState}` : null),
  close: (r) => (r.idle.dialog === null || r.busy.dialog === null || r.exited.dialog !== null || r.exited.closed !== true ? 'misses the terminate dialog of the idle or busy session, or the exited session asked for one, or closing it did not remove it' : null),
  hints: (r) => (r.steps.length < 10 || r.find === null || r.copy.api.copy === undefined ? 'misses its steps, the find bar or the copy readings' : null),
  keys: (r) => (Object.keys(r).length !== ENVIRONMENTS.length || Object.values(r).some((e) => e.fromInput.length !== KEYS.length) ? 'misses an environment or a key' : null),
};

if (process.env.MOCK_VERIFY_ONLY) {
  try {
    console.log(`the mock at ${url} is the tree ${MOCK_TREE} (${await verifyMock(url)} files)`);
  } finally {
    server?.kill();
  }
  process.exit(0);
}

const data = {};
let failed = false;
// The server this script started (no MOCK_URL) and every browser it launched are closed whatever happens.
try {
  await verifyMock(url);
  for (const engineName of engineNames) {
    const browser = await launch(engineName);
    try {
      data[engineName] = {};
      for (const viewportName of viewportNames) {
        data[engineName][viewportName] = {};
        for (const name of scenarioNames) {
          const reading = await scenario(browser, VIEWPORTS[viewportName], name);
          const problem = checks[name](reading);
          if (problem !== null) { console.log('MISSING', engineName, viewportName, name, problem); failed = true; }
          data[engineName][viewportName][name] = reading;
          console.log(engineName, viewportName, name, problem === null ? 'ok' : 'FAILED', Math.round((Date.now() - started) / 1000), 's');
        }
      }
    } finally {
      await browser.close();
    }
  }
  const notes = [
    'Mock default context; the start screen, no plugin screen. The panel is at its default height (the body is 229 px at 1440x900, 199 px at 1280x800) unless a reading says `tall` (the splitter\'s End key).',
    'The UI font is normalized (probe-lib normalizeFont); the transcript is set in --int-font-code, which is NOT normalized: its computed font-family and the measured cell are the mock\'s real code font.',
    'The first transcript row is `Last login: <weekday> <month> <day> at HH:MM:SS on ttys004`: the mock writes the time of the run (replaced by HH:MM:SS here).',
    'The status lane (`.ptool__status`) writes a state only for `exited` (`Exited with code N`, also for code 0), `expired` (`Expired`) and a stopping session (`Stopping…`); it is EMPTY while running (the card says `Connected`, the tab\'s accessible name says `running`), connecting and reconnecting (the operation cell says `Opening <target>` / `Reconnecting <name>` with Cancel) and failed (the banner tells). The card says `Ended` for exit code 0 and `Exited with code N` for N > 0.',
    'Shell.panel.sim.fail called one tick after Shell.panel.terminal.open is OVERWRITTEN within ~0.3 s: the local shell\'s own start finishes and the session ends `running` with a failed operation record in the lane (`failed.simFailNew.stateLog`). A failed session that stays failed needs a producer that rejects or holds its start (`startRejected`, `simFailHeld`) or a session that has run (`simFailRan`).',
    'The mock measures the viewport it sends the producer (columns x rows) with a canvas whose font is `getComputedStyle(pre).font`, which is the empty string in both engines (`rows.cell.canvasFontSet`): the canvas keeps `10px sans-serif`, its `M` is 8.33 px, and `screen.grid.columns` is therefore smaller than the columns that fit (`grid.byCell`, from the real 7.2 px cell).',
  ];
  const text = `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, note: 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01.', notes, data })}\n`;
  if (text.length > 900_000) { console.log('FAILED: the file is over 900 kB'); failed = true; }
  // The reference is replaced only by a complete measurement (every engine, viewport and scenario): a partial run or a run that missed a part writes what it read to the temp directory.
  const file = failed || partial ? path.join(tmpdir(), 'mock-terminal.partial.json') : path.join(here, 'mock-terminal.measured.json');
  writeFileSync(file, text);
  console.log('wrote', file, statSync(file).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
  if (failed) { console.log('FAILED: a scenario misses a part: mock-terminal.measured.json is unchanged'); process.exitCode = 1; } else if (partial) console.log('partial run: mock-terminal.measured.json is unchanged');
} finally {
  server?.kill();
}

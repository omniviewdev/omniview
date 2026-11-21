// Measures the design mock's notification centre: the REFERENCE the shell's centre is built to (slice O1b-2: the bell in the status bar and the popover of notification history).
//
// What it measures, per engine (webkit, chromium), viewport (1440x900, 1280x800) and scene (SCENES of centre-targets.mjs), in a FRESH page per scene, with the mock's default context (no text scale, default
// density; font normalized as mock-notices-measure.mjs does): the mock's list page (MOCK_OPEN_NODES of mock-screen.mjs) is opened, the toast gate is switched off (`Shell.toasts.configure({ focusGate: false })`),
// the pointer is put away at (1, 1), the scene's records are seeded with the mock's own API (`Shell.notify` for a message, `Shell.ops.begin(...).fail(...)` for a failed operation with its Retry; a record is
// backdated by writing its `createdAt` and `finishedAt` in the store, and marked as having had its toast so that no toast stands over the page), the centre is opened with `Shell.feedback.openCenter()` (the
// scenes that show it), the page waits 300 ms (the popover and its body have drawn; there is no animation), and every part (PARTS of centre-targets.mjs) is read as rectangles and as paint (STYLES) with side
// 'mock', together with the FACTS the page drew (words, flags, names). Each scene is checked to have drawn what it says; the script exits non-zero with the scene's name when it did not.
//
// Serve the mock first or let this script do it: a CommonJS copy of its server.js with `root` set to the mock directory (see mock-strip-measure.mjs), e.g.
//   sed 's#const root=__dirname#const root="<mock dir>"#' <mock dir>/server.js > /tmp/server.cjs && PORT=49477 node /tmp/server.cjs
// Without MOCK_URL the script serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) on port 49477 and stops that child at the end.
// Run:  node ui-next/shell/probes/mock-notice-centre-measure.mjs        (check `uptime` first: a loaded machine moves the timings)
// Writes mock-notice-centre.json. With SHOTS=<dir> it writes a screenshot of each scene there instead (mock-<scene>-<engine>-<viewport>.png) and leaves the pinned file alone. With ASSETS=<dir> it keeps
// one screenshot per scene and engine at 1440x900 there as well (same names).
//
// mock-notice-centre.json: { mockTree, viewports, note,
//   data: { <engine>: { <viewport>: { <scene>: { parts: { <part>: [[x, y, w, h]...] } (px, 0.01), styles: { <name or name#index>: { prop: value } }, facts: {...} } } } } }
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';
import { MOCK_OPEN_NODES } from '../../../packages/kit/probes/mock-screen.mjs';
import { PARTS, SCENES, readParts, readStyles } from './centre-targets.mjs';

const OPEN = MOCK_OPEN_NODES;

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const started = Date.now();
const SHOTS = process.env.SHOTS;
const ASSETS = process.env.ASSETS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (ASSETS) mkdirSync(ASSETS, { recursive: true });

/**
 * How each scene is seeded, with the mock's own API (an async function evaluated in the page). The words are fixed: the shell uses the same strings. Records are created oldest first so that the newest is first in the
 * list; each is marked as having had its toast (without reading it) so that no toast stands over the page.
 */
const HELPERS = `
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const quiet = () => { const r = Shell.ops.list()[0]; Shell.update(['operations', 'records', r.id], { toastShown: true, toastDismissed: true }); return r.id; };
  const message = async (spec) => { Shell.notify({ ...spec, source: { plugin: spec.plugin } }); const id = quiet(); await wait(8); return id; };
  const failed = async () => {
    Shell.ops.begin({ title: 'Timed out', initiator: 'system', source: { plugin: 'p1' }, onRetry: () => {} }).fail({ message: 'The cluster did not complete the request in time.' });
    const id = quiet(); await wait(8); return id;
  };
  const backdate = (id, at) => Shell.update(['operations', 'records', id], { createdAt: at, startedAt: at, updatedAt: at, finishedAt: at });
  const yesterdayStamp = () => {
    const at = Date.now() - 26 * 3600000, y = new Date(); y.setDate(y.getDate() - 1);
    if (new Date(at).toDateString() === y.toDateString()) return at;
    y.setHours(12, 0, 0, 0);
    return y.getTime();
  };
  const five = async (first) => {
    backdate(await message({ title: 'Snapshot created', message: 'It is ready to restore.', severity: 'success', plugin: 'p3', read: true }), yesterdayStamp());
    await message({ title: 'Update available', severity: 'info', plugin: 'p3', read: true });
    await message({ title: 'Connection added', message: 'prod-east is ready to use.', severity: 'info', plugin: 'p1', read: true });
    await message({ title: 'Signed out', message: 'Sign in again to continue.', severity: 'warning', plugin: 'p2' });
    return first === 'operation'
      ? failed()
      : message({ title: 'Timed out', message: 'The cluster did not complete the request in time.', severity: 'error', plugin: 'p1' });
  };
  const muteStamp = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 30, 0, 0); return d.getTime(); };
`;
const SEED = {
  closed: ``,
  'bell-info': `await message({ title: 'Connection added', message: 'prod-east is ready to use.', severity: 'info', plugin: 'p1' });`,
  'bell-warning': `await message({ title: 'Signed out', message: 'Sign in again to continue.', severity: 'warning', plugin: 'p2' });`,
  'bell-error': `await message({ title: 'Timed out', message: 'The cluster did not complete the request in time.', severity: 'error', plugin: 'p1' });`,
  empty: ``,
  list: `await five('message');`,
  expanded: `const id = await five('operation'); Shell.set(['notify', 'expanded', id], true);`,
  filtered: `await five('message'); Shell.update(['feedback', 'center'], { source: 'p1' });`,
  muted: `await five('message'); Shell.set(['preferences', 'notifications', 'muted', 'p1'], muteStamp());`,
  menu: `await five('message'); Shell.update(['feedback', 'center'], { source: 'p1' });`,
  dots: `for (const [title, severity] of [['Notice 1', 'info'], ['Notice 2', 'success'], ['Notice 3', 'warning'], ['Notice 4', 'error']]) await message({ title, severity, plugin: 'p1' });`,
};
const OPENS = new Set(['empty', 'list', 'expanded', 'filtered', 'muted', 'menu', 'dots']);

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory.
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-notice-centre-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49477' }, stdio: 'ignore' });
  url = 'http://127.0.0.1:49477/';
  await sleep(1500);
}

/** What the page drew, to check a scene against and to pin the shell's words to. */
const FACTS = `(() => {
  const BP = document.getElementById('statusitem-bell-popover');
  const text = (el, s) => el?.querySelector(s)?.textContent.trim() ?? null;
  const attr = (el, n) => el?.getAttribute(n) ?? null;
  const name = (el) => attr(el, 'aria-label') ?? el.textContent.trim();
  const bell = document.querySelector('.statusitem[data-key="bell"]');
  const dot = bell?.querySelector('.statusitem__dot');
  const open = !!BP && BP.matches(':popover-open');
  const rows = [...(BP?.querySelectorAll('.notify[data-surface="center"]') ?? [])];
  const menu = BP?.querySelector('.menu[role="menu"]');
  const empty = BP?.querySelector('.fbc__scroll .empty2');
  return {
    toasts: Shell.toasts.list().length,
    focus: document.activeElement ? { tag: document.activeElement.tagName, act: attr(document.activeElement, 'data-notify-act'), inPopover: !!BP?.contains(document.activeElement) } : null,
    bell: bell ? { ariaLabel: attr(bell, 'aria-label'), tooltip: attr(bell, 'data-tooltip'), expanded: attr(bell, 'aria-expanded'), haspopup: attr(bell, 'aria-haspopup'), tone: attr(bell, 'data-tone'), dot: dot ? attr(dot, 'data-tone') : null } : null,
    popover: BP ? { ariaLabel: attr(BP, 'aria-label'), role: attr(BP, 'role'), size: attr(BP, 'data-size'), open } : null,
    title: text(BP, '.panel-header h3'),
    footer: [...(BP?.querySelectorAll('.panel-footer button') ?? [])].map((b) => b.textContent.trim()),
    seg: [...(BP?.querySelectorAll('.fbc__bar .seg [role="radio"]') ?? [])].map((b) => ({ text: b.textContent.trim().replace(/\\s+/g, ' '), checked: attr(b, 'aria-checked') })),
    tools: [...(BP?.querySelectorAll('.fbc__tools > button') ?? [])].map((b) => ({ text: b.textContent.trim(), ariaLabel: attr(b, 'aria-label'), disabled: attr(b, 'aria-disabled'), tooltip: attr(b, 'data-tooltip'), haspopup: attr(b, 'aria-haspopup'), expanded: attr(b, 'aria-expanded') })),
    notes: [...(BP?.querySelectorAll('.fbc__note') ?? [])].map((n) => ({ text: text(n, '.fbc__notetext'), button: text(n, 'button') })),
    labels: [...(BP?.querySelectorAll('.fbc__list > .sectionlabel') ?? [])].map((l) => l.textContent.trim()),
    rows: rows.map((r) => ({
      title: text(r, '.notify__toggle .notify__title'), message: text(r, '.notify__toggle .notify__message'), hasMessage: !!r.querySelector('.notify__toggle .notify__message'),
      time: text(r, '.notify__time'), timeTooltip: (attr(r.querySelector('.notify__time'), 'data-tooltip') ?? '').replace(/^(Posted|Finished|Started) [^\\n]*/, '$1 <date, time>').replace(/\\nTook [^\\n]*/, ''), severity: r.dataset.severity, state: r.dataset.state, kind: r.dataset.kind, unread: r.hasAttribute('data-unread'),
      expanded: r.hasAttribute('data-expanded'), ariaLabel: attr(r, 'aria-label'), toggleExpanded: attr(r.querySelector('.notify__toggle'), 'aria-expanded'), dotTone: attr(r.querySelector('.notify__unread'), 'data-tone'),
      dotText: text(r, '.notify__unread'), actions: [...r.querySelectorAll('.notify__actions button')].map((b) => ({ name: name(b), text: b.textContent.trim(), tooltip: attr(b, 'data-tooltip'), disabled: attr(b, 'aria-disabled') })),
      actionsOpacity: getComputedStyle(r.querySelector(':scope > .notify__actions')).opacity, focusWithin: r.matches(':focus-within'), detailHidden: r.querySelector('.notify__detail')?.hidden ?? null, detail: text(r, '.notify__detail'),
    })),
    empty: empty ? { icon: !!empty.querySelector('.bigicon'), title: text(empty, 'b'), hint: text(empty, '.tiny'), buttons: [...empty.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null,
    menu: menu ? {
      label: attr(menu, 'aria-label'), role: attr(menu, 'role'), profile: attr(menu, 'data-profile'),
      titles: [...menu.querySelectorAll('.menu__title')].map((t) => t.textContent.trim()),
      items: [...menu.querySelectorAll('.menu__item')].map((i) => ({ label: i.querySelector('.menu__label')?.textContent.trim() ?? i.textContent.trim(), role: attr(i, 'role'), checked: attr(i, 'aria-checked'), group: i.closest('.menu__group')?.getAttribute('aria-label') ?? null })),
    } : null,
  };
})()`;

/** What a scene must have drawn: the list of the problems (empty when it drew what it says). */
function check(scene, facts) {
  const problems = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const rows = facts.rows;
  const open = facts.popover?.open === true;
  if (facts.toasts !== 0) problems.push(`${facts.toasts} toasts stand`);
  if (!facts.bell) problems.push('no bell');
  if (facts.popover?.ariaLabel !== 'Notifications') problems.push(`popover name ${JSON.stringify(facts.popover?.ariaLabel)}`);
  if (OPENS.has(scene) !== open) problems.push(`popover ${open ? 'open' : 'closed'}`);
  if (open && facts.title !== 'Notifications') problems.push(`header ${JSON.stringify(facts.title)}`);
  const wantDot = { closed: null, 'bell-info': 'info', 'bell-warning': 'warning', 'bell-error': 'error' }[scene];
  if (wantDot !== undefined && facts.bell?.dot !== wantDot) problems.push(`bell dot ${facts.bell?.dot}, not ${wantDot}`);
  if (wantDot !== undefined && facts.rows.length !== 0) problems.push('rows listed in a closed popover');
  const want = {
    list: { titles: ['Timed out', 'Signed out', 'Connection added', 'Update available', 'Snapshot created'], unread: [true, true, false, false, false], severities: ['error', 'warning', 'info', 'info', 'success'] },
    expanded: { titles: ['Timed out', 'Signed out', 'Connection added', 'Update available', 'Snapshot created'], unread: [true, true, false, false, false], severities: ['error', 'warning', 'info', 'info', 'success'] },
    muted: { titles: ['Timed out', 'Signed out', 'Connection added', 'Update available', 'Snapshot created'], severities: ['error', 'warning', 'info', 'info', 'success'] },
    filtered: { titles: ['Timed out', 'Connection added'], unread: [true, false], severities: ['error', 'info'] },
    menu: { titles: ['Timed out', 'Connection added'], unread: [true, false], severities: ['error', 'info'] },
    dots: { titles: ['Notice 4', 'Notice 3', 'Notice 2', 'Notice 1'], unread: [true, true, true, true], severities: ['error', 'warning', 'success', 'info'] },
  }[scene];
  if (want) {
    if (!same(rows.map((r) => r.title), want.titles)) problems.push(`titles ${JSON.stringify(rows.map((r) => r.title))}`);
    if (!same(rows.map((r) => r.severity), want.severities)) problems.push(`severities ${JSON.stringify(rows.map((r) => r.severity))}`);
    if (want.unread && !same(rows.map((r) => r.unread), want.unread)) problems.push(`unread ${JSON.stringify(rows.map((r) => r.unread))}`);
  }
  if (['list', 'expanded', 'muted'].includes(scene)) {
    const messages = ['The cluster did not complete the request in time.', 'Sign in again to continue.', 'prod-east is ready to use.', null, 'It is ready to restore.'];
    if (!same(rows.map((r) => r.message), messages)) problems.push(`messages ${JSON.stringify(rows.map((r) => r.message))}`);
    if (!same(facts.labels, ['Recent', 'Today', 'Yesterday'])) problems.push(`labels ${JSON.stringify(facts.labels)}`);
  }
  if (scene === 'empty') {
    if (facts.empty?.title !== 'No notifications') problems.push(`empty title ${JSON.stringify(facts.empty?.title)}`);
    if (facts.empty?.hint !== 'Messages from plugins and operations you start appear here.') problems.push(`empty hint ${JSON.stringify(facts.empty?.hint)}`);
    if (rows.length !== 0) problems.push('rows listed');
  }
  if (scene === 'expanded') {
    const first = rows[0];
    if (!first?.expanded || first.toggleExpanded !== 'true') problems.push('the first row is not expanded');
    if (first?.kind !== 'operation' || first?.state !== 'failed') problems.push(`first record ${first?.kind} ${first?.state}`);
    if (!same(first?.actions.map((a) => a.text || a.name).slice(0, 1), ['Retry'])) problems.push(`first row actions ${JSON.stringify(first?.actions.map((a) => a.name))}`);
    if (!first?.actions.some((a) => /^Dismiss/.test(a.name))) problems.push('no Dismiss on the first row');
  } else if (open && rows.some((r) => r.expanded)) problems.push('a row is expanded');
  if (scene === 'filtered' || scene === 'menu') {
    if (!same(facts.notes, [{ text: 'P1', button: 'Clear filters' }])) problems.push(`notes ${JSON.stringify(facts.notes)}`);
  } else if (scene === 'muted') {
    if (facts.notes.length !== 1 || facts.notes[0].button !== 'Unmute' || !/^P1 is muted until /.test(facts.notes[0].text ?? '')) problems.push(`notes ${JSON.stringify(facts.notes)}`);
  } else if (open && facts.notes.length !== 0) problems.push(`notes ${JSON.stringify(facts.notes)}`);
  if (scene === 'menu') {
    const labels = facts.menu?.items.map((i) => i.label);
    if (!facts.menu) problems.push('no menu');
    else if (!same(labels, ['All sources', 'P1 (2)', 'P2 (1)', 'P3 (2)', 'Any severity', 'Errors', 'Warnings', 'Success', 'Info', 'Mute P1 for 1 hour', 'Clear filters'])) problems.push(`menu items ${JSON.stringify(labels)}`);
  } else if (facts.menu) problems.push('a menu is open');
  if (open && !facts.tools.map((t) => t.text).join('|').startsWith('Mark all as read|')) problems.push(`tools ${JSON.stringify(facts.tools.map((t) => t.text))}`);
  return problems;
}

async function drive(browser, viewport, scene) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(url, { waitUntil: 'load' });
  await sleep(3000);
  await page.evaluate(OPEN);
  await sleep(3500);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  await page.evaluate(`Shell.toasts.configure({ focusGate: false })`);
  await page.mouse.move(1, 1);
  await page.evaluate(`(async () => { ${HELPERS} ${SEED[scene]} })()`);
  if (OPENS.has(scene)) {
    const opened = await page.evaluate(`Shell.feedback.openCenter()`);
    if (!opened) throw new Error(`${scene}: openCenter returned ${opened}`);
    await sleep(300);
    if (scene === 'menu') {
      await page.evaluate(`document.getElementById('fbc-filter').click()`);
      await page.mouse.move(1, 1);
      await sleep(300);
    }
  } else await sleep(300);
  return page;
}

const data = {};
let failed = false;
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch(engineName === 'chromium' ? { args: ['--font-render-hinting=none'] } : {});
    try {
      data[engineName] = {};
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        data[engineName][viewportName] = {};
        for (const { name: scene } of SCENES) {
          const page = await drive(browser, viewport, scene);
          const parts = await readParts(page, PARTS, 'mock');
          const styles = await readStyles(page, PARTS, 'mock');
          const facts = await page.evaluate(FACTS);
          const problems = check(scene, facts);
          const must = ['statusBar', 'bell', 'bellGlyph', 'centre'];
          if (OPENS.has(scene)) must.push('centreHeader', 'centreTitle', 'centreBar', 'centreSeg', 'centreTools', 'centreBody', 'centreScroll', 'centreFooter');
          if (['list', 'expanded', 'filtered', 'muted', 'menu', 'dots'].includes(scene)) must.push('centreList', 'row', 'rowToggle', 'rowDismiss', 'rowActions');
          if (scene === 'empty') must.push('centreEmpty', 'centreEmptyIcon', 'centreEmptyTitle', 'centreEmptyHint');
          if (scene === 'menu') must.push('centreMenu', 'centreMenuItem');
          if (['filtered', 'muted', 'menu'].includes(scene)) must.push('centreNote', 'centreNoteText', 'centreNoteButton');
          if (scene.startsWith('bell-')) must.push('bellDot');
          for (const part of must) if (parts[part].length === 0) problems.push(`part ${part} not found`);
          if (problems.length > 0) {
            console.log('MISSING', engineName, viewportName, scene, problems.join('; '));
            failed = true;
          }
          data[engineName][viewportName][scene] = { parts, styles, facts };
          console.log(engineName, viewportName, scene, `${Object.values(parts).filter((rects) => rects.length > 0).length} parts`, problems.length === 0 ? 'ok' : 'FAILED');
          if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `mock-${scene}-${engineName}-${viewportName}.png`) });
          if (ASSETS && viewportName === '1440x900') await page.screenshot({ path: path.join(ASSETS, `mock-${scene}-${engineName}-${viewportName}.png`) });
          await page.context().close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  // The mock's server is this script's own child: it goes whether the run finished or threw.
  server?.kill();
}

const note = 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. Mock default context, on the list page of a connection, the toast gate off, the pointer at (1, 1), read 300 ms after the centre opened (after the menu opened, for scene menu) (no animation). A per-row part lists only the rows that have it (a row with no message has no rowText): align by facts.rows[i].hasMessage. The record times are seeded now ("now" label), the older one 26 h earlier (label "1d ago"; when 26 h ago is not yesterday, yesterday 12:00 is used and the label is "Nh ago" or "1d ago"): the time label width is time dependent. The muted note says "P1 is muted until 10:30 AM" (a fixed clock time tomorrow; the mock\'s own mute is for 1 hour from the click). The Dismiss button of a collapsed row has a box (24x24) and the actions container of its row has opacity 0 until the row is hovered or has focus within: the mock moves focus to the FIRST row when it opens the centre, so the actions of row 0 stand at opacity 1 and every other row at 0 (facts.rows[i].actionsOpacity, focusWithin; styles rowActions#0 and #1). Scene dots is not in the brief: four unread rows, one per severity. Styles are named `<part>` or `<part>#<index>`.';
const file = path.join(here, 'mock-notice-centre.json');
// A reference that failed its own checks is not written: the committed one stays what it was measured as.
if (!SHOTS && !failed) writeFileSync(file, `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, note, data })}\n`);
console.log(SHOTS || failed ? (SHOTS ? `wrote screenshots to ${SHOTS}` : 'wrote nothing') : `wrote ${file} ${statSync(file).size} bytes`, Math.round((Date.now() - started) / 1000), 's');
if (failed) process.exit(1);

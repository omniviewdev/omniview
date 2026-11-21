// The sort of the list page (K3a) in a real engine, on the fixture's `sort` case (fixture.tsx: the real Shell around the real ListPage and the kit's table, invented rows whose columns declare their sort keys and a
// list that opens on Name, ascending). Called by page-probe.mjs, in its stages `sort` and `perf`, in a PRODUCTION build (the React Compiler on, React's production build).
//
//   sort   (a) the headers: every column that declares a key has a button in its header with its state in `aria-sort`, the one in force draws the arrow of its direction and no other does
//          (b) the order: the rows the table mounted are in the order the sort says, from the data the page holds (a stable sort: a tie keeps the order the source gave), after the default and after each press of every
//              header, ascending first and turned round on the second press, Name (the default) turned round on its FIRST
//          (c) nothing moves: no header changes its rectangle by 0.01 px when a press changes the sort
//          (d) the keyboard: Enter and Space on a header's button sort it and the focus stays on it; Tab walks the headers' buttons in order
//          (e) a live update: a row whose key changed moves to its place and the others keep their order, a change to a column that is not the one sorted moves nothing
//          (f) the detectors see what they are for: each of (a) to (d) is run again on the page after one fault is made in it (an `aria-sort` taken off, two rows swapped, a header moved, the focus dropped), and
//              must report it; the same reading and the same detector read the page without the fault and report nothing
//   perf   5,000 rows at 1440 x 900 (a press on a header, 12 of them over five columns): each costs ONE React commit (counted through the DevTools hook, which React calls in a production build too), the table mounts
//          the same few rows before and after, the table reads each row's key once for a column and not again when the column is turned round (a press does not rebuild the rows), and the time from the click to the
//          commit (the sort, the render and the commit: React flushes a click's update before the next microtask) and to the next painted frame are printed with the machine's load. The budget the table is held to is
//          one frame (16.7 ms): it is READ here and held in CI only as a bound far above it (CI runners are shared), because a timing taken under load proves a budget neither held nor missed (AGENTS.md rule 27).
//          The detector of the commit count is run on a press that is followed by a second update, which must report two commits
import os from 'node:os';
import { openCase, round2 } from './lib.mjs';
import { frames } from './shift.mjs';

export const SORT_VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };

/** What the perf stage holds a press to in CI: far above a frame, so that a runner under load does not fail it and an O(n^2) sort or a render per row does. */
export const PERF_BOUND_MS = 200;
const FRAME_MS = 16.7;

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* What the page says, read in the page.                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/** Page side: the headers of the table, in order, with the state each says, whether it holds a button and an arrow, and its rectangle. */
function readHeaders() {
  const round = (value) => Math.round(value * 100) / 100;
  return [...document.querySelectorAll('table thead th')].map((cell) => {
    const box = cell.getBoundingClientRect();
    return { text: cell.textContent.trim(), sort: cell.getAttribute('aria-sort'), button: cell.querySelector('button') !== null, arrows: cell.querySelectorAll('svg').length, rect: [round(box.left), round(box.top), round(box.width), round(box.height)] };
  });
}

/** Page side: the keys of the rows the table has mounted, in the order they are drawn. */
function readKeys() {
  return [...document.querySelectorAll('table tbody tr[data-ov-index] [data-fixture-key]')].map((element) => element.getAttribute('data-fixture-key'));
}

/** Page side: the table's scroll region goes back to the top, so that the rows mounted are the first ones of the order. */
function toTop() {
  const region = document.querySelector('[data-shell-part="page"] [role="region"]');
  if (region !== null) region.scrollTop = 0;
}

/** Page side: whether the focus is on a header's button, and which one, by its text. */
function readFocus() {
  const active = document.activeElement;
  return { onHeaderButton: active instanceof HTMLButtonElement && active.closest('thead') !== null, text: (active?.textContent ?? '').trim().slice(0, 30) };
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* What the sort should say.                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const readyFraction = (ready) => {
  const [have = 0, total = 1] = ready.split('/').map(Number);
  return total === 0 ? 1 : have / total;
};

/** The comparison of each column of the fixture (`SORT_KEYS` in fixture.tsx): text in natural order, numbers as numbers, an age as when it was made (the oldest first when ascending). */
const COMPARE = {
  name: (a, b) => collator.compare(a.name, b.name),
  ready: (a, b) => readyFraction(a.ready) - readyFraction(b.ready),
  status: (a, b) => collator.compare(a.status, b.status),
  restarts: (a, b) => a.restarts - b.restarts,
  age: (a, b) => -a.ageSeconds - -b.ageSeconds,
};

const HEADERS = { name: 'Name', ready: 'Ready', status: 'Status', restarts: 'Restarts', age: 'Age' };
const COLUMN_OF = Object.fromEntries(Object.entries(HEADERS).map(([id, text]) => [text, id]));

/** The keys of `rows` in the order of the sort: a stable sort, so a tie keeps the order the rows were given in, in either direction. */
export function expectedKeys(rows, column, direction) {
  const sign = direction === 'descending' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => COMPARE[column](a.row, b.row) * sign || a.index - b.index)
    .map(({ row }) => row.key);
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The detectors: pure, each takes what was read and answers what is wrong with it (nothing when nothing is).                      */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/** (a) The headers say the sort in force and no other, with a button each and the arrow on the one in force only. */
export function headerProblems(headers, inForce) {
  const problems = [];
  if (headers.length !== Object.keys(HEADERS).length) problems.push(`the table has ${headers.length} headers, wanted ${Object.keys(HEADERS).length}`);
  for (const header of headers) {
    const column = COLUMN_OF[header.text];
    const want = column === inForce.column ? inForce.direction : 'none';
    if (!header.button) problems.push(`${header.text}: no sort button`);
    if (header.sort !== want) problems.push(`${header.text}: aria-sort is ${String(header.sort)}, wanted ${want}`);
    const arrows = column === inForce.column ? 1 : 0;
    if (header.arrows !== arrows) problems.push(`${header.text}: ${header.arrows} arrows, wanted ${arrows}`);
  }

  return problems;
}

/** (b) The rows mounted are the first ones of the order the sort says. */
export function orderProblems(keys, expected) {
  if (keys.length === 0) return ['no row is mounted'];
  const want = expected.slice(0, keys.length);
  const at = keys.findIndex((key, index) => key !== want[index]);
  return at === -1 ? [] : [`row ${at} is ${keys[at]}, wanted ${want[at]} (first ${Math.min(keys.length, 6)}: ${keys.slice(0, 6).join(' ')} against ${want.slice(0, 6).join(' ')})`];
}

/** (c) No header moved: the same rectangles, to 0.01 px. */
export function shiftProblems(before, after) {
  const problems = [];
  before.forEach((header, index) => {
    const moved = header.rect.some((value, at) => Math.abs(value - (after[index]?.rect[at] ?? Number.NaN)) > 0.01);
    if (moved) problems.push(`${header.text}: ${header.rect.join(' ')} became ${after[index]?.rect.join(' ') ?? 'nothing'}`);
  });
  return problems;
}

/** (d) The focus is on the button of the header it was on. */
export function focusProblems(focus, text) {
  return focus.onHeaderButton && focus.text === text ? [] : [`the focus is ${focus.onHeaderButton ? `on ${focus.text}` : 'not on a header button'}, wanted ${text}`];
}

/** perf: a press is one commit. */
export function commitProblems(commits) {
  return commits === 1 ? [] : [`a press made ${commits} commits, wanted 1`];
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* One page of the case.                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/** A line of the report: what a detector said of what was read. */
function outcome(report, where, target, problems, got) {
  const ok = problems.length === 0;
  report.line(where, target, 'holds', got ?? (ok ? 'holds' : problems[0]), ok ? 0 : 'differs', ok ? 'ok' : 'FAIL', ok ? '' : problems.slice(0, 3).join('; '));
}

/** Reads the page the way every check does: the headers, the keys of the rows mounted from the top, and the rows the page holds. */
async function read(page) {
  await page.evaluate(toTop);
  await frames(page, 2);
  return { headers: await page.evaluate(readHeaders), keys: await page.evaluate(readKeys), rows: await page.evaluate(() => window.__fixture.rows()) };
}

const headerButton = (page, text) => page.locator('table thead th button', { hasText: text });

async function press(page, text) {
  await headerButton(page, text).click();
  await frames(page, 2);
}

/** (a), (b) and (c) for what is in force now, against the headers read before the press (none: not compared). */
async function check(report, where, page, label, inForce, before) {
  const now = await read(page);
  outcome(report, where, `${label}: the headers say it`, headerProblems(now.headers, inForce));
  outcome(report, where, `${label}: the order`, orderProblems(now.keys, expectedKeys(now.rows, inForce.column, inForce.direction)));
  if (before !== undefined) outcome(report, where, `${label}: no header moved`, shiftProblems(before, now.headers));
  return now;
}

/** The sort stage on one engine and viewport. */
export async function sortStage(report, browser, engine, viewportName, viewport, origin) {
  const where = `sort ${viewportName} ${engine}`;
  const { page, context, errors } = await openCase(browser, origin, 'sort', viewport, { ready: 'tbody tr[data-ov-index]' });
  for (const error of errors) report.fail(where, `page error: ${error}`);

  // (a) and (b): the list opens in the sort the definition names.
  let state = await check(report, where, page, 'opens', { column: 'name', direction: 'ascending' });
  const opened = state.headers;

  // (b) and (c): every header, pressed twice; Name, the default, turns round on its first press.
  const plan = [['Name', 'descending'], ['Name', 'ascending'], ['Ready', 'ascending'], ['Ready', 'descending'], ['Status', 'ascending'], ['Status', 'descending'], ['Restarts', 'ascending'], ['Restarts', 'descending'], ['Age', 'ascending'], ['Age', 'descending']];
  for (const [text, direction] of plan) {
    await press(page, text);
    state = await check(report, where, page, `${text} ${direction}`, { column: COLUMN_OF[text], direction }, opened);
  }

  // (d) the keyboard: Enter and Space on the button, the focus stays; Tab walks the buttons of the headers in order.
  await headerButton(page, 'Restarts').focus();
  await page.keyboard.press('Enter');
  await frames(page, 2);
  state = await check(report, where, page, 'Enter on Restarts', { column: 'restarts', direction: 'ascending' }, opened);
  outcome(report, where, 'Enter: the focus stays', focusProblems(await page.evaluate(readFocus), 'Restarts'));
  await page.keyboard.press('Space');
  await frames(page, 2);
  state = await check(report, where, page, 'Space on Restarts', { column: 'restarts', direction: 'descending' }, opened);
  outcome(report, where, 'Space: the focus stays', focusProblems(await page.evaluate(readFocus), 'Restarts'));
  // WebKit on macOS skips buttons with Tab (Alt+Tab reaches them: the window's own setting, which the native app turns on, N22); everywhere else Tab reaches every control.
  await page.keyboard.press(engine === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
  const next = await page.evaluate(readFocus);
  outcome(report, where, 'Tab walks the headers', next.onHeaderButton && next.text === 'Age' ? [] : [`Tab from Restarts reached ${next.text === '' ? 'nothing' : next.text}, wanted Age`], `Restarts, then ${next.text}`);

  // (e) a live update, under the sort in force (Restarts, descending): the row whose key changed moves to its place and the rest keep their order; a change to a column that is not sorted moves nothing.
  const quiet = state.rows.find((row) => row.restarts === 0);
  await page.evaluate((key) => window.__fixture.patch(key, { restarts: 99 }), quiet.key);
  await frames(page, 2);
  state = await check(report, where, page, 'live: a restart count rose to 99', { column: 'restarts', direction: 'descending' }, opened);
  outcome(report, where, 'live: the row moved to the top', state.keys[0] === quiet.key ? [] : [`the first row is ${state.keys[0]}, wanted ${quiet.key}`]);
  const other = state.rows.find((row) => row.key !== quiet.key && row.status === 'Running');
  await page.evaluate((key) => window.__fixture.patch(key, { status: 'Completed' }), other.key);
  await frames(page, 2);
  const after = await read(page);
  outcome(report, where, 'live: a change to a column that is not sorted moves nothing', after.keys.join() === state.keys.join() ? [] : ['the rows moved']);

  // (f) the detectors see what they are for, with the focus where the fault of the last control needs it.
  await headerButton(page, 'Restarts').focus();
  await controls(report, where, page);
  await context.close();
}

/**
 * One fault at a time, made in the page and taken out again: the detector reads the page as it is, says nothing, then reads it with the fault and must say something. The page is in the sort of
 * Restarts, descending, with the focus on that header's button, when it begins.
 */
async function controls(report, where, page) {
  const inForce = { column: 'restarts', direction: 'descending' };
  const faults = [
    {
      name: 'aria-sort taken off',
      fault: () => document.querySelector('table thead th[aria-sort="descending"]')?.setAttribute('aria-sort', 'none'),
      undo: () => document.querySelector('table thead th[aria-sort="none"]:nth-child(4)')?.setAttribute('aria-sort', 'descending'),
      detect: async () => headerProblems((await read(page)).headers, inForce),
    },
    {
      name: 'two rows swapped',
      fault: () => {
        const rows = document.querySelectorAll('table tbody tr[data-ov-index]');
        rows[0]?.before(rows[1]);
      },
      undo: () => {
        const rows = document.querySelectorAll('table tbody tr[data-ov-index]');
        rows[0]?.before(rows[1]);
      },
      detect: async () => {
        const { keys, rows } = await read(page);
        return orderProblems(keys, expectedKeys(rows, inForce.column, inForce.direction));
      },
    },
    {
      name: 'a header moved',
      fault: () => {
        const cell = document.querySelector('table thead th');
        if (cell instanceof HTMLElement) cell.style.transform = 'translateX(9px)';
      },
      undo: () => {
        const cell = document.querySelector('table thead th');
        if (cell instanceof HTMLElement) cell.style.transform = '';
      },
      detect: async (clean) => shiftProblems(clean.headers, await page.evaluate(readHeaders)),
    },
    {
      name: 'the focus dropped',
      fault: () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
      undo: () => document.querySelector('table thead th[aria-sort="descending"] button')?.focus(),
      detect: async () => focusProblems(await page.evaluate(readFocus), 'Restarts'),
    },
  ];
  for (const { name, fault, undo, detect } of faults) {
    const clean = await read(page);
    const without = await detect(clean);
    await page.evaluate(fault);
    const faulty = await detect(clean);
    await page.evaluate(undo);
    const seen = without.length === 0 && faulty.length > 0;
    report.line(where, `control: ${name}`, 'seen', faulty.length > 0 ? 'seen' : 'NOT SEEN', seen ? 0 : 'differs', seen ? 'ok' : 'FAIL', without.length > 0 ? `the page without the fault already reported: ${without[0]}` : '');
  }
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Five thousand rows, in a production build.                                                                                       */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/** Page side, before the page's own scripts: the DevTools hook React calls on every commit, in a production build too. It records when each commit ended. */
function installCommitCount() {
  const commits = [];
  window.__commits = commits;
  const noop = () => undefined;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    onCommitFiberRoot: () => {
      commits.push(performance.now());
    },
    onPostCommitFiberRoot: noop,
    onCommitFiberUnmount: noop,
    onScheduleFiberRoot: noop,
    checkDCE: noop,
  };
}

/** Page side: one press of a header's button, as a pointer press is: the click, the microtask React flushes the update in, then the next painted frame. */
async function pressInPage(text) {
  const button = [...document.querySelectorAll('table thead th button')].find((candidate) => candidate.textContent.trim() === text);
  const commitsBefore = window.__commits.length;
  const keysBefore = window.__fixture.keyReads();
  const started = performance.now();
  button.click();
  await Promise.resolve();
  const returned = performance.now();
  const made = window.__commits.slice(commitsBefore);
  const keys = window.__fixture.keyReads() - keysBefore;
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
  const painted = performance.now();
  return { commits: made.length, toCommit: (made.at(-1) ?? returned) - started, toPaint: painted - started, keys, mounted: document.querySelectorAll('table tbody tr[data-ov-index]').length };
}

/** Page side: a press, then a second update after React has flushed it: two commits, which the detector of the commit count must see. */
async function pressAndUpdate(text) {
  const before = window.__commits.length;
  [...document.querySelectorAll('table thead th button')].find((candidate) => candidate.textContent.trim() === text).click();
  await Promise.resolve();
  window.__fixture.patch('item-0', { restarts: 1 });
  return window.__commits.length - before;
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** The perf stage on one engine, at the viewport of the native window. */
export async function perfStage(report, browser, engine, viewportName, viewport, origin) {
  const where = `perf ${viewportName} ${engine}`;
  const { page, context, errors } = await openCase(browser, origin, 'sort', viewport, { ready: 'tbody tr[data-ov-index]', extra: '&rows=5000', init: installCommitCount });
  for (const error of errors) report.fail(where, `page error: ${error}`);
  const rowCount = await page.evaluate(() => window.__fixture.rows().length);
  if (rowCount !== 5000) report.fail(where, `the case holds ${rowCount} rows, wanted 5000`);
  const mountedAtRest = await page.evaluate(() => document.querySelectorAll('table tbody tr[data-ov-index]').length);
  // A first press of a column reads every key once; Name's keys were read when the list opened in its default sort.
  const plan = [['Restarts', 'first'], ['Restarts', 'again'], ['Age', 'first'], ['Age', 'again'], ['Name', 'again'], ['Name', 'again'], ['Ready', 'first'], ['Ready', 'again'], ['Status', 'first'], ['Status', 'again'], ['Restarts', 'again'], ['Age', 'again']];
  const readings = [];
  for (const [text, kind] of plan) {
    const reading = await page.evaluate(pressInPage, text);
    readings.push({ text, kind, ...reading });
    outcome(report, where, `${text} (${kind}): one commit`, commitProblems(reading.commits), `${reading.commits} commit${reading.commits === 1 ? '' : 's'}`);
  }

  const mounted = readings.map((reading) => reading.mounted);
  outcome(report, where, 'the table mounts the same few rows before and after a press', mounted.every((count) => count === mountedAtRest) && mountedAtRest < 80 ? [] : [`${mountedAtRest} rows at rest, then ${[...new Set(mounted)].join(', ')}`], `${mountedAtRest} rows of 5,000`);
  const keyReads = (kind) => readings.filter((reading) => reading.kind === kind).map((reading) => reading.keys);
  outcome(report, where, 'a first press reads each key once', keyReads('first').every((reads) => reads === 5000) ? [] : [`the first presses read ${keyReads('first').join(', ')} keys`], `${keyReads('first').join(', ')} keys`);
  outcome(report, where, 'a press that turns a column round reads no key: it does not rebuild the rows', keyReads('again').every((reads) => reads === 0) ? [] : [`the presses read ${keyReads('again').join(', ')} keys`], `${keyReads('again').length} presses, 0 keys`);

  const toCommit = readings.map((reading) => reading.toCommit);
  const toPaint = readings.map((reading) => reading.toPaint);
  const slowest = Math.max(...toCommit);
  outcome(report, where, `the slowest press is under ${PERF_BOUND_MS} ms to its commit`, slowest <= PERF_BOUND_MS ? [] : [`${round2(slowest)} ms`], `${round2(slowest)} ms`);
  report.note(
    where,
    `click to commit (the sort, the render, the commit): median ${round2(median(toCommit))} ms, slowest ${round2(slowest)} ms, over ${readings.length} presses (${keyReads('first').length} first of a column); to the next painted frame: median ${round2(median(toPaint))} ms, slowest ${round2(Math.max(...toPaint))} ms; one frame is ${FRAME_MS} ms; the one-minute load of the machine was ${round2(os.loadavg()[0])}`,
  );

  const doubled = await page.evaluate(pressAndUpdate, 'Status');
  const seen = commitProblems(doubled).length > 0 && commitProblems(1).length === 0;
  report.line(where, 'control: a commit more', 'seen', commitProblems(doubled).length > 0 ? 'seen' : 'NOT SEEN', seen ? 0 : 'differs', seen ? 'ok' : 'FAIL', `${doubled} commits`);
  await context.close();
}

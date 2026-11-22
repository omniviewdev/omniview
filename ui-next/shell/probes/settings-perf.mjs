// Section `perf` of the Settings probe: what Settings costs in the PRODUCTION build, counted on the page the way a person meets it. React's commits are counted with the DevTools hook React calls after every commit, in a production build
// too (ui-next/page/probes/sort.mjs does the same), so there is no second build; timers, frames, listeners and observers are counted by wrappers installed before the page's own scripts run (palette-perf.mjs `watch`, settings-lib.mjs).
//
//   open      (the sheet, and the window's first draw) the sheet opens with the host's answer held (the loading line is on screen), the answer is released, and what is read is the page's work from that instant: the commits it makes (at most ONE after the data
//             arrives, 250 ms counted) and the time to the second animation frame after the rows are in the document, a proxy for the first paint that has them (no page can see when a frame reached the screen: the second
//             frame's callbacks run once the first frame after the DOM is drawn), under 100 ms at its median of nine opens; the first open, which fetches the sheet's chunk, is recorded apart        perf.open.*
//   show      the Settings window shown again after a hide, from the host's event to the second frame after it is drawn: under 100 ms (a show lays the whole window out again; it takes 28 to 30 ms), and the commits it makes (the show, and what asking the host again gives the form)    perf.show.*
//   key       one key typed in a text field, a number field and a secret field, and one deleted: exactly ONE commit, and exactly one ROW rendered in it, the row of the field (the walk of the committed tree says which
//             function components rendered)                                                                                                                                                perf.key.*
//   idle      2 s with the sheet open, with the Settings window shown, and with it hidden: no commit, no timer, interval, frame or idle callback started or run, none outstanding                    perf.idle.*
//   closed    a closed sheet holds nothing: no node of Settings, no listener or observer more than before the first open (after three opens, uses and closes), no timer outstanding or run, and the host is told to stop        perf.closed.*
//
// Every sample and the machine's load are printed: a timing under load proves a budget neither held nor missed (docs/ui-next/AGENTS.md rule 27).
import os from 'node:os';
import { check, commitCounter, commitWalker, fail, goToPage, median, note, observerCounter, openFixture, openSheet, plant, round, script, sleep, startCounter, WINDOW_SIZES, wants } from './settings-lib.mjs';
import { watch } from './palette-perf.mjs';

const enc = (value) => encodeURIComponent(JSON.stringify(value));
const OPENS = 9;
/** What an open may take to the second frame after its rows are in the document: 100 ms, the response that still feels immediate. It is an absolute bound, so it has to hold on the CI runner, which is slower than the laptop (WebKit reads 40 ms there for the window, 23 for the sheet): 2.5 times the worst reading. The exact claims are the commit counts. */
const OPEN_BUDGET = 100;
/** A show lays out the whole window again (its content was not laid out while it was hidden): 28 to 30 ms in both engines on a quiet laptop and 26 to 30 on the runner; the bound is the same 100 ms, and what a show costs in commits is asserted exactly. */
const SHOW_BUDGET = 100;
const IDLE = 2000;
const AFTER = 250;
const WAIT = 8000;

/** The sheet's open, in the page: the answer is released, and the time to the second frame after the rows are in, and the commits at that point and 250 ms later. Runs in the page. */
const OPEN_SAMPLE = async ([settle, rowsSelector]) => {
  const commits = window.__commits;
  const from = commits.length;
  const started = performance.now();
  const beat = () => {
    window.__beating = requestAnimationFrame(beat);
  };
  beat();
  // The rows are in the document when a mutation observer, which runs in a microtask after the mutation, says so (a poll of microtasks would starve the task React renders in).
  const arrived = new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.querySelector(rowsSelector) !== null) {
        observer.disconnect();
        resolve(undefined);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  window.__release();
  await Promise.race([arrived, new Promise((resolve) => setTimeout(resolve, 8000))]);
  const rows = document.querySelectorAll(rowsSelector).length;
  const painted = await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))));
  const atPaint = commits.length - from;
  await new Promise((resolve) => setTimeout(resolve, settle));
  cancelAnimationFrame(window.__beating);
  return { ms: painted - started, atPaint, settled: commits.length - from, rows };
};

async function openPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const load = os.loadavg()[0];
  const { page, context, errors } = await openFixture(env, 'case=sheet', { init: [script(commitCounter)], fonts: 'none' });
  try {
    await sleep(500);
    await plant(env, page, 'start');
    const samples = [];
    const chord = (await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+Comma' : 'Control+Comma';
    for (let index = 0; index < OPENS + 1; index += 1) {
      await page.evaluate(() => window.__hold());
      await page.keyboard.press(chord);
      await page.waitForSelector('dialog[open] [data-settings-state="loading"]', { timeout: WAIT });
      await sleep(60);
      if (index === 0) await plant(env, page);
      samples.push(await page.evaluate(OPEN_SAMPLE, [AFTER, 'dialog[open] [data-settings-row]']));
      await sleep(80);
      await page.keyboard.press('Escape');
      await page.waitForSelector('dialog[open]', { state: 'detached', timeout: WAIT });
      await sleep(120);
    }

    const [cold, ...warm] = samples;
    const times = warm.map((sample) => round(sample.ms));
    const middle = round(median(times));
    note('perf', `open ${where}`, { cold: { ms: round(cold.ms), atPaint: cold.atPaint, settled: cold.settled }, warm: times, median: middle, budget: OPEN_BUDGET, commits: warm.map((sample) => sample.settled), rows: warm[0]?.rows, loadAverage: round(load) });
    console.log(`perf open ${where}: cold ${round(cold.ms)} ms; warm ${JSON.stringify(times)} ms, median ${middle} of ${OPEN_BUDGET}, commits after the data ${JSON.stringify(warm.map((sample) => sample.settled))}, ${warm[0]?.rows} rows (load average ${round(load)})`);
    const all = samples.map((sample) => sample.settled);
    check(all.every((count) => count >= 1), where, 'perf.open.commits', `an open made no commit the counter saw (${JSON.stringify(all)}): the page did not draw its rows`);
    check(all.every((count) => count <= 1), where, 'perf.open.commits', `the rows cost ${JSON.stringify(all)} commits after the host's answer (the first open fetched the chunk), wanted one each: the answer is one render`);
    check(warm.every((sample) => sample.rows > 0), where, 'perf.open.frames', 'an open did not draw rows');
    check(middle < OPEN_BUDGET, where, 'perf.open.frames', `the rows took ${middle} ms at the median to the second frame after the host's answer (samples ${JSON.stringify(times)}), over the ${OPEN_BUDGET} ms they may take`);
    for (const message of errors) fail(where, 'perf.open.commits', `page error: ${message}`);
  } finally {
    await context.close();
  }
}

/**
 * The Settings window's first draw: its page was made and asked the host, which has not answered (the loading line is on screen); the answer is released, and what is read is what the sheet's open reads. Five fresh pages: a window is made
 * once and lives as long as the app, so this is what a person waits for when the window is first opened, after its page has loaded.
 */
async function openWindowPart(env) {
  const where = `${env.engine}@1060x640 window`;
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    const { page, context } = await openFixture(env, `case=window&host=held&request=${enc({ requestId: 1, target: '/settings?category=appearance', visible: true })}`, { viewport: WINDOW_SIZES['1060x640'], init: [script(commitCounter)], fonts: 'none' });
    try {
      await page.waitForSelector('[data-settings-part="window"] [data-settings-state="loading"]', { timeout: WAIT });
      await sleep(200);
      if (index === 0) await plant(env, page);
      samples.push(await page.evaluate(OPEN_SAMPLE, [AFTER, '[data-settings-part="window"] [data-settings-row]']));
    } finally {
      await context.close();
    }
  }

  const times = samples.map((sample) => round(sample.ms));
  const middle = round(median(times));
  note('perf', `open window ${where}`, { samples: times, median: middle, budget: OPEN_BUDGET, commits: samples.map((sample) => sample.settled) });
  console.log(`perf open ${where}: ${JSON.stringify(times)} ms, median ${middle} of ${OPEN_BUDGET}, commits after the data ${JSON.stringify(samples.map((sample) => sample.settled))}`);
  check(samples.every((sample) => sample.settled === 1), where, 'perf.open.commits', `the window's rows cost ${JSON.stringify(samples.map((sample) => sample.settled))} commits after the host's answer, wanted one each`);
  check(middle < OPEN_BUDGET, where, 'perf.open.frames', `the window took ${middle} ms at the median to draw its rows after the host's answer (samples ${JSON.stringify(times)}), over the ${OPEN_BUDGET} ms they may take`);
}

/** The window shown again after a hide, in the page: from the host's event to the second frame after it is drawn. Runs in the page. */
const SHOW_SAMPLE = async (settle) => {
  const commits = window.__commits;
  const from = commits.length;
  const started = performance.now();
  const beat = () => {
    window.__beating = requestAnimationFrame(beat);
  };
  beat();
  const arrived = new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible') === 'true') {
        observer.disconnect();
        resolve(undefined);
      }
    });
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-visible'] });
  });
  window.__windows.emit({ requestId: 1, target: '/settings?category=appearance', visible: true });
  await Promise.race([arrived, new Promise((resolve) => setTimeout(resolve, 8000))]);
  const painted = await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))));
  const atPaint = commits.length - from;
  await new Promise((resolve) => setTimeout(resolve, settle));
  cancelAnimationFrame(window.__beating);
  return { ms: painted - started, atPaint, settled: commits.length - from };
};

async function showPart(env) {
  const where = `${env.engine}@1060x640 window`;
  const load = os.loadavg()[0];
  const { page, context } = await openFixture(env, `case=window&request=${enc({ requestId: 1, target: '/settings?category=appearance', visible: true })}`, { viewport: WINDOW_SIZES['1060x640'], init: [script(commitCounter)], fonts: 'none' });
  try {
    await page.waitForSelector('[data-settings-part="window"][data-visible="true"] [data-settings-row]', { timeout: WAIT });
    await sleep(500);
    await plant(env, page);
    const samples = [];
    for (let index = 0; index < OPENS; index += 1) {
      await page.evaluate(() => window.__windows.emit({ requestId: 1, target: '/settings?category=appearance', visible: false }));
      await page.waitForFunction(() => document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible') === 'false', null, { timeout: WAIT });
      await sleep(200);
      samples.push(await page.evaluate(SHOW_SAMPLE, AFTER));
      await sleep(80);
    }

    const times = samples.map((sample) => round(sample.ms));
    const middle = round(median(times));
    note('perf', `show ${where}`, { samples: times, median: middle, budget: SHOW_BUDGET, commits: samples.map((sample) => sample.settled), loadAverage: round(load) });
    console.log(`perf show ${where}: ${JSON.stringify(times)} ms, median ${middle} of ${SHOW_BUDGET}, commits ${JSON.stringify(samples.map((sample) => sample.settled))} (load average ${round(load)})`);
    check(samples.every((sample) => sample.settled <= 1), where, 'perf.show.commits', `a show made ${JSON.stringify(samples.map((sample) => sample.settled))} commits, wanted one at most: the show, and the host's answer when nothing changed is no commit`);
    check(middle < SHOW_BUDGET, where, 'perf.show.frames', `the window took ${middle} ms at the median to be drawn after a show (samples ${JSON.stringify(times)}), over the ${SHOW_BUDGET} ms it may take`);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/** The rows a key made render, in the page: the commits since `from`. Runs in the page. */
const COMMITS_SINCE = (from) => window.__commits.slice(from).map((commit) => ({ rows: commit.rows, components: commit.components }));

async function keyPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openFixture(env, 'case=sheet', { init: [script(commitWalker)], fonts: 'none' });
  try {
    await sleep(300);
    await openSheet(page);
    await goToPage(page, 'developer');
    await sleep(300);
    await plant(env, page);
    const selectAll = (await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+a' : 'Control+a';
    const fields = [
      ['a text', page.getByRole('textbox', { name: 'Marketplace URL' }), 'developer.marketplace_url', ['x', 'y', 'Backspace']],
      ['a number', page.getByRole('spinbutton', { name: 'Host profiling port' }), 'developer.pprof_port', ['7', '1', 'Backspace']],
    ];
    const seen = {};
    for (const [label, field, id, keys] of fields) {
      await field.click();
      await page.keyboard.press(selectAll);
      await sleep(150);
      const rows = [];
      for (const key of keys) {
        const from = await page.evaluate(() => window.__commits.length);
        await page.keyboard.press(key);
        await sleep(120);
        const made = await page.evaluate(COMMITS_SINCE, from);
        rows.push({ key, commits: made.length, rows: [...new Set(made.flatMap((commit) => commit.rows))] });
        check(made.length >= 1, where, 'perf.key.commits', `${label} field: the key ${key} made no commit the counter saw (the walk of the committed tree is not reporting)`);
        check(made.length <= 1, where, 'perf.key.commits', `${label} field: the key ${key} cost ${made.length} commits, wanted exactly one`);
        const touched = [...new Set(made.flatMap((commit) => commit.rows))];
        check(touched.length === 1 && touched[0] === id, where, 'perf.key.rows', `${label} field: the key ${key} rendered ${touched.length} rows (${touched.slice(0, 4).join(', ')}), wanted exactly one, ${id}`);
      }
      seen[label] = rows;
    }
    // A secret, which has the same cost and a secret's own rules: nothing but the typed row renders.
    await goToPage(page, 'telemetry');
    await sleep(200);
    const secret = page.locator('[data-settings-row="telemetry.loki_auth_value"] input');
    await secret.click();
    const secretKeys = [];
    for (const key of ['a', 'b', 'Backspace']) {
      const from = await page.evaluate(() => window.__commits.length);
      await page.keyboard.press(key);
      await sleep(120);
      const made = await page.evaluate(COMMITS_SINCE, from);
      const touched = [...new Set(made.flatMap((commit) => commit.rows))];
      secretKeys.push({ key, commits: made.length, rows: touched });
      // A secret is not held by the page: its first key says the field has one (the row draws), and the keys after it change nothing the row shows, so the row need not draw at all. At most one commit, and no row but its own.
      check(made.length <= 1, where, 'perf.key.commits', `a secret field: the key ${key} cost ${made.length} commits, wanted one at most`);
      check(touched.every((id) => id === 'telemetry.loki_auth_value') && (key !== 'a' || touched.length === 1), where, 'perf.key.rows', `a secret field: the key ${key} rendered ${touched.length} rows (${touched.slice(0, 4).join(', ')}), wanted its own row and no other (the first key draws it)`);
    }
    seen.secret = secretKeys;
    note('perf', `key ${where}`, seen);
    const total = await page.evaluate(() => window.__commits.length);
    check(total > 3, where, 'perf.key.commits', 'the counter saw no commits at all');
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
const KINDS = ['timeouts', 'intervals', 'frames', 'idles'];
const outstanding = (snapshot) => KINDS.reduce((sum, kind) => sum + snapshot[kind].length, 0);
const describe = (entry) => `#${entry.id} ${entry.delay} ms ${entry.stack === '' ? '(no stack)' : entry.stack.slice(0, 160)}`;

/** What the page has started, run and holds now. Runs in the page. */
const TAKE = () => ({
  commits: window.__commits.length,
  started: { ...window.__started },
  ran: window.__watch.ran().count,
  watch: window.__watch.snapshot(),
  observers: window.__observers(),
});

async function idleOf(env, label, query, viewport, ready, prepare) {
  const where = `${env.engine}@${viewport.width}x${viewport.height} ${label}`;
  const { page, context } = await openFixture(env, query, { viewport, init: [script(startCounter), script(commitCounter), script(watch), script(observerCounter)], fonts: 'none', ready: ready.wait });
  try {
    await page.waitForSelector(ready.selector, { timeout: WAIT, state: 'attached' });
    if (prepare !== undefined) await prepare(page);
    await plant(env, page);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.mouse.move(2, 2);
    await sleep(700);
    for (const problem of await page.evaluate(() => window.__watch.selfTest())) fail(where, 'perf.idle.timers', `the instrumentation is wrong: ${problem}`);
    const before = await page.evaluate(TAKE);
    await sleep(IDLE);
    const after = await page.evaluate(TAKE);
    const started = Object.fromEntries(Object.keys(after.started).map((kind) => [kind, after.started[kind] - before.started[kind]]));
    const startedTotal = Object.values(started).reduce((sum, count) => sum + count, 0);
    const ran = after.ran - before.ran;
    note('perf', `idle ${where}`, { commits: after.commits - before.commits, started, ran, outstanding: outstanding(after.watch), observers: after.observers });
    check(after.commits === before.commits, where, 'perf.idle.commits', `${after.commits - before.commits} commits in ${IDLE} ms of nothing`);
    check(startedTotal === 0, where, 'perf.idle.timers', `${startedTotal} timers, intervals, frames or idle callbacks were started in ${IDLE} ms of nothing (${JSON.stringify(started)})`);
    check(ran === 0, where, 'perf.idle.timers', `${ran} timer or frame callbacks ran in ${IDLE} ms of nothing: ${after.watch.timeouts.concat(after.watch.intervals).slice(0, 3).map(describe).join('; ')}`);
    check(outstanding(after.watch) === 0, where, 'perf.idle.timers', `${outstanding(after.watch)} timers are outstanding: ${KINDS.flatMap((kind) => after.watch[kind]).slice(0, 3).map(describe).join('; ')}`);
  } finally {
    await context.close();
  }
}

async function idlePart(env) {
  await idleOf(env, 'sheet open', 'case=sheet', env.viewport, { selector: '[data-shell-part="window"]' }, async (page) => {
    await openSheet(page);
  });
  if (!env.first) return;
  const size = WINDOW_SIZES['1060x640'];
  const request = enc({ requestId: 1, target: '/settings?category=appearance', visible: true });
  await idleOf(env, 'window shown', `case=window&request=${request}`, size, { selector: '[data-settings-part="window"][data-visible="true"] [data-settings-row]' });
  await idleOf(env, 'window hidden', `case=window&request=${request}`, size, { selector: '[data-settings-part="window"][data-visible="true"] [data-settings-row]' }, async (page) => {
    await page.evaluate(() => window.__windows.emit({ requestId: 1, target: '/settings?category=appearance', visible: false }));
    await page.waitForFunction(() => document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible') === 'false', null, { timeout: WAIT });
    await sleep(300);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
async function closedPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const say = (id, what) => fail(where, id, what);
  const { page, context } = await openFixture(env, 'case=sheet', { init: [script(startCounter), script(commitCounter), script(watch), script(observerCounter)], fonts: 'none' });
  try {
    await sleep(800);
    await plant(env, page);
    for (const problem of await page.evaluate(() => window.__watch.selfTest())) say('perf.closed.listeners', `the instrumentation is wrong: ${problem}`);
    const quiet = async () => {
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.mouse.move(2, 2);
      await sleep(250);
    };
    await quiet();
    const before = await page.evaluate(TAKE);
    const heldBefore = new Map(before.watch.held.map((entry) => [entry.key, entry]));
    if (before.watch.held.length === 0) say('perf.closed.listeners', 'the instrumentation saw no registration on the window or the document: it is not wrapping the page\'s calls');
    const nodesBefore = await page.evaluate(() => document.querySelectorAll('[data-settings-part], [data-settings-row], [data-settings-state], dialog').length);
    check(nodesBefore === 0, where, 'perf.closed.nodes', `${nodesBefore} nodes of Settings before the first open`);
    // Opened, used and closed three times.
    let heldWhileOpen = 0;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await openSheet(page);
      await goToPage(page, 'terminal');
      await page.getByRole('switch', { name: 'Cursor Blink' }).click();
      await page.getByRole('textbox', { name: 'Default Shell' }).click();
      await page.keyboard.type('x');
      await sleep(250);
      if (cycle === 0) heldWhileOpen = (await page.evaluate(TAKE)).watch.held.length;
      // The first Escape is the field's (it puts the applied value back), the second closes the sheet.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.waitForSelector('dialog[open]', { state: 'detached', timeout: WAIT });
      await quiet();
      await page.evaluate(() => window.__host.change('terminal.fontSize', 20 + 0));
    }

    await sleep(700);
    const after = await page.evaluate(TAKE);
    const ranBefore = after.ran;
    await sleep(1000);
    const later = await page.evaluate(TAKE);
    const nodes = await page.evaluate(() => ({ parts: document.querySelectorAll('[data-settings-part], [data-settings-row], [data-settings-state]').length, dialogs: document.querySelectorAll('dialog').length }));
    check(nodes.parts === 0 && nodes.dialogs === 0, where, 'perf.closed.nodes', `${nodes.parts} nodes of Settings and ${nodes.dialogs} dialogs after it was closed`);
    const heldAfter = new Map(later.watch.held.map((entry) => [entry.key, entry]));
    const added = [...heldAfter.values()].filter((entry) => !heldBefore.has(entry.key));
    const removed = [...heldBefore.values()].filter((entry) => !heldAfter.has(entry.key));
    check(added.length === 0, where, 'perf.closed.listeners', `${added.length} registrations on the window or the document stayed after the sheet closed: ${added.map((entry) => `${entry.key} ${entry.source.slice(0, 80)}`).join('; ')}`);
    check(removed.length === 0, where, 'perf.closed.listeners', `${removed.length} registrations that were there before the first open are gone: ${removed.map((entry) => entry.key).join('; ')}`);
    check(later.observers.join() === before.observers.join(), where, 'perf.closed.listeners', `observers held after the sheet closed: ${later.observers.join(', ') || 'none'}; before the first open: ${before.observers.join(', ') || 'none'}`);
    const host = await page.evaluate(() => window.__host.listeners());
    check(host === 0, where, 'perf.closed.listeners', `the host still has ${host} listeners of Settings after the sheet closed: it must be told to stop`);
    const stillHeld = outstanding(later.watch) - outstanding(before.watch);
    check(stillHeld <= 0, where, 'perf.closed.timers', `${stillHeld} timers, intervals or frames are outstanding after the sheet closed: ${KINDS.flatMap((kind) => later.watch[kind]).slice(0, 3).map(describe).join('; ')}`);
    check(later.ran - ranBefore === 0, where, 'perf.closed.timers', `${later.ran - ranBefore} timer or frame callbacks ran in a second with the sheet closed: ${later.watch.timeouts.slice(0, 2).map(describe).join('; ')}`);
    note('perf', `closed ${where}`, { listenersBefore: before.watch.held.length, listenersWhileOpen: heldWhileOpen, listenersAfter: later.watch.held.length, outstandingBefore: outstanding(before.watch), outstandingAfter: outstanding(later.watch), commitsWhileClosed: later.commits - after.commits });
    check(later.commits === after.commits, where, 'perf.closed.timers', `${later.commits - after.commits} commits in a second with the sheet closed`);
  } finally {
    await context.close();
  }
}

/** Runs the parts of the section `perf` for one engine and viewport; the window's are run once for an engine, with the first viewport. */
export async function perfSection(env) {
  const timed = async (part, run) => {
    const from = Date.now();
    await run(env);
    note('perf', `seconds ${env.engine}@${env.viewportName} ${part}`, round((Date.now() - from) / 1000));
  };
  if (wants(env, 'open')) await timed('open', openPart);
  if (wants(env, 'open') && env.first) await timed('open window', openWindowPart);
  if (wants(env, 'show') && env.first) await timed('show', showPart);
  if (wants(env, 'key')) await timed('key', keyPart);
  if (wants(env, 'idle')) await timed('idle', idlePart);
  if (wants(env, 'closed')) await timed('closed', closedPart);
}

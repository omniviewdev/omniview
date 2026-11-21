// What a plugin's providers do to the command palette, measured in the page the way a person meets it (palette-probe.mjs calls `plugins` once for each engine and viewport, in a page of its own for each part). The page is
// palette-plugins-fixture.tsx: the real shell, the real palette and the HOST'S OWN WIRING of a plugin's providers (`createHostPalette`) over the fixture plugin's four (plugins/fixture/src/palette.ts: pages, and three
// that answer on demand: `quick` at once, `slow` after 300 ms, `big` with five thousand rows), a plugin source the page changes, and the tab model. What is judged is what does not depend on how fast the machine is: the ORDER
// things happen in and what each costs relative to what it must not wait for. The times themselves are recorded in the report and never judged.
//
//   timeline   `orders` is typed (40 ms between keys). The input shows the text before the slow provider has answered (typing never waits), the providers are asked once for the six keys (the 150 ms debounce), the rows of
//              the fast providers are painted before the slow provider's (and at least 150 ms before), the five thousand rows of `big` come to twenty and the band says "first 20 of 5000", and the model never counts more
//              than 50 results.
//   typing     a key is pressed while the slow provider is working: it costs the page what a key costs (under 100 ms from the keydown to the end of its input event, and the text in the input before anything else), and the
//              slow provider is told to stop. A provider that holds the thread (the fixture's `spin`) is a plugin that makes the palette wait: that is what the negative control `slow-blocks` does, and it must be seen.
//   focus      the user moves to a row; when the slow section arrives the active row is the same row at the same place, and every row above it is the row it was: the late section comes after.
//   commits    (development build) a character, a Backspace and an ArrowDown cost one React commit each at most with all the providers registered; and each answer that arrives costs one, no more (the model rebuilds once per change).
//   shift      the sampler watches the window's regions and the Search control at every frame while the palette is used with the providers answering late: nothing outside the palette moves, and the engine's layout-shift
//              observer reads 0 (null where it has none: WebKit).
//   closed     a closed palette does no provider work: nothing is asked before it was opened, however the plugin comes and goes while it is closed; and after it was used and closed no request is in flight, none is
//              started, and no timer or listener of the palette's is left.
//   states     the sections with results and axe on them; a provider that rejects, answers what is not a list, never answers (at 1440 x 900), and one with a row that is not valid: the others answer, the band names the
//              source in the host's words with a Retry that asks again; an answer that comes after the provider was told to stop is never shown; a plugin that leaves while the palette is open takes its section away at once, and
//              comes back with its section when it is back.
//   aliases    (C1e, `?aliases=1`: the plugin's own providers stay quiet, so what answers is the host's pages source) a page found by the keyword its sidebar entry carries: `gz` is the keyword of Gadgets, and Gazebo is a
//              decoy whose title holds its letters in one word. The page is in the list, it is the FIRST row (a loose match in a title used to outrank a keyword), nothing of the keyword is drawn on a row, and a plain Enter
//              opens it in the tab on screen. The negative controls: `alias-ignored` (the host does not read the keyword) and `alias-loose` (the keyword ranks as a plain keyword did, below the decoy).
//   connection (C1f, `?connection=1`: the plugin's own providers stay quiet) the connection a row says. The tab on screen is the detail page of an item read in a connection whose KEY is `north-57a082bd74`, and its scope lane
//              says the NAME, `north`: the chips that narrow the palette say the name, the rows of Go to say `north · Group` and (a page in no group) `north`, the Tabs row says `north · Current tab`, and the key is in nothing
//              the palette draws in any of those states: no text and no accessible name. The negative control: `connection-key` (a source of the host's own that says the key).
//
// The numbers go to `report.plugins["<engine> <viewport>"]`; `fail(where, what)` records what must hold and is never thrown.
import { normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';
import { SAMPLER, open, sleep } from './harness.mjs';
import { script, watch } from './palette-perf.mjs';

const WAIT = 8000;
const IDLE = 1000;
const AFTER_CLOSE = 600;
/** Under this from a keydown to the end of its input event, or the key waited for something. The usual cost is 1 to 3 ms; this is for a machine that is loaded. */
const KEY_BUDGET = 100;
/** The slow provider answers this long after it is asked; the fast ones' rows must be painted at least half of it before. */
const SLOW_MS = 300;
const LEAD = SLOW_MS / 2;

const round = (value) => Math.round(value * 10) / 10;
const firstLine = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300);
const chordOf = async (page) => ((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+k' : 'Control+k');
const keyName = (character) => (character === ' ' ? 'Space' : character);
const noDialog = () => document.querySelector('dialog[open]') === null;
const url = (origin, query = '') => `${origin}/shell/probes/palette-plugins-fixture.html${query === '' ? '' : `?${query}`}`;

/** The rows of a plugin's provider in the list: the model names a row `<section>|<provider>|<id>`, so the section's id is what a row's id starts with. */
const SECTION = { quick: 'fixture-a-ok:quick|', slow: 'fixture-a-ok:slow|', big: 'fixture-a-ok:big|', pages: 'fixture-a-ok:pages|' };

// ---------------------------------------------------------------------------------------------------------------------------
// The page's side: runs in the page before its own scripts, uses nothing of this module.

/**
 * The clock of a query. `__tlArm(want)` says the text the input must hold once the keys are done; from then on, the first time each is true is marked on `performance.now()`'s clock: `typed` (the input holds `want`,
 * the model's query is `want` and the list is on screen) and `quick`, `slow`, `big` and `pages` (a row of that provider's section is in the DOM). Every key is recorded with its keydown's time stamp and the time the end of
 * its input event was reached (the model had the text and the tree was committed): the cost of the key before any frame.
 */
function timeline() {
  const tl = (window.__tl = { want: undefined, marks: {}, keys: [], sections: { quick: 'fixture-a-ok:quick|', slow: 'fixture-a-ok:slow|', big: 'fixture-a-ok:big|', pages: 'fixture-a-ok:pages|' } });
  const mark = (name) => {
    if (tl.marks[name] === undefined) tl.marks[name] = performance.now();
  };
  const look = () => {
    const input = document.querySelector('dialog[open] [role=combobox]');
    if (tl.want !== undefined && input !== null && input.value === tl.want && window.__palette.getSnapshot().query === tl.want && document.querySelector('dialog [role=listbox]') !== null) mark('typed');
    for (const [name, prefix] of Object.entries(tl.sections)) {
      if (document.querySelector('[data-palette-row^="' + prefix + '"]') !== null) mark(name);
    }
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
  window.addEventListener(
    'keydown',
    (event) => {
      tl.keys.push({ key: event.key, down: event.timeStamp, input: null });
    },
    true,
  );
  window.addEventListener('input', () => {
    const last = tl.keys[tl.keys.length - 1];
    if (last !== undefined && last.input === null) last.input = performance.now();
    look();
  });
  window.__tlArm = (want) => {
    tl.want = want;
    tl.marks = {};
    tl.keys = [];
  };
}

/** The fixture's stats, as the page holds them now. */
const statsOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__fixturePalette.stats)));

/** The list as the DOM shows it: each option's row id, in order, and which is selected. */
const listOf = (page) =>
  page.evaluate(() => {
    const options = [...document.querySelectorAll('dialog [role=option]')];
    return { ids: options.map((option) => option.getAttribute('data-palette-row')), active: options.findIndex((option) => option.getAttribute('aria-selected') === 'true'), names: options.map((option) => option.getAttribute('aria-label')) };
  });

const bandOf = (page) =>
  page.evaluate(() => {
    const element = document.querySelector('dialog [data-palette-part="band"]');
    return { text: element?.textContent ?? '', buttons: [...(element?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '') };
  });

/** Waits (up to WAIT) until every named mark of the page's clock has been made. */
const untilMarked = (page, names) => page.waitForFunction((list) => list.every((name) => window.__tl.marks[name] !== undefined), names, { timeout: WAIT });

/** Types `text` as a person does and waits (up to WAIT) for the marks `names` the page's clock makes. */
async function typeAndWait(page, text, names) {
  await page.evaluate((want) => window.__tlArm(want), text);
  await page.keyboard.type(text, { delay: 40 });
  await untilMarked(page, names);
}

/** The marks a wait is for: names, not a function, because a function cannot take what is in this module into the page. */
const marked = (...names) => names;

export async function plugins({ browser, engine, viewportName, viewport, production, development, report, fail, control, only, axe, shots }) {
  const where = `${engine} ${viewportName}`;
  const result = { timeline: null, typing: null, focus: null, commits: null, shift: null, closed: null, states: null, aliases: null, connection: null, seconds: {} };
  report.plugins ??= {};
  report.plugins[where] = result;

  /**
   * One part in a page of its own: opened by the harness (`fonts: false` leaves the fonts alone, for the part that counts the timers a page runs, because the font settling is itself a timer), then
   * `body(page, errors, messages)`. What throws is a failure of the part, the page's errors are failures, and the context is always closed. `messages` is what the page wrote to its console.
   */
  async function part(name, origin, query, { init, fonts = true } = {}, body) {
    // A negative control runs the part it perturbs and no other (`only` names it): the others do not see the perturbation, and each costs a page of its own.
    if (only !== undefined && !only.includes(name)) {
      return;
    }

    const began = performance.now();
    let opened;
    try {
      opened = await open(browser, url(origin, query), viewport, { init });
      const messages = [];
      opened.page.on('console', (message) => {
        messages.push({ type: message.type(), text: message.text() });
      });
      if (fonts) await normalizeFont(opened.page, { rootVar: '--ov-font-ui' });
      await sleep(200);
      await body(opened.page, opened.errors, messages);
    } catch (error) {
      fail(where, `plugins ${name}: ${firstLine(error)}`);
    } finally {
      result.seconds[name] = round((performance.now() - began) / 1000);
      if (opened !== undefined) {
        for (const message of opened.errors) fail(where, `plugins ${name}: page error: ${message}`);
        await opened.context.close();
      }
    }
  }

  const openPalette = async (page) => {
    await page.keyboard.press(await chordOf(page));
    await page.waitForSelector('dialog[open]', { timeout: WAIT });
    await sleep(150);
  };

  // 1. The order things happen in when a query is typed with a slow provider present.
  await part('timeline', production.origin, '', { init: script(timeline) }, async (page) => {
    if (control === 'quick-late') {
      // The perturbation: the provider that should be fast answers after the slow one.
      await page.evaluate(() => Object.assign(window.__fixturePalette.quick, { delay: 700 }));
    }

    await openPalette(page);
    await typeAndWait(page, 'orders', marked('typed', 'quick', 'slow', 'big'));
    await sleep(100);
    const { marks, keys } = await page.evaluate(() => ({ marks: { ...window.__tl.marks }, keys: window.__tl.keys.map((key) => ({ ...key })) }));
    const stats = await statsOf(page);
    const snapshot = await page.evaluate(() => ({ total: window.__palette.getSnapshot().total, runs: window.__palette.getSnapshot().runs.map((run) => run.label) }));
    const band = await bandOf(page);
    const last = keys[keys.length - 1];
    const since = (mark) => (mark === undefined ? null : round(mark - last.down));
    result.timeline = {
      keys: keys.length,
      typedMs: since(marks.typed),
      quickMs: since(marks.quick),
      slowMs: since(marks.slow),
      bigMs: since(marks.big),
      keyCostMs: round(Math.max(...keys.map((key) => (key.input === null ? Number.NaN : key.input - key.down)))),
      stats,
      total: snapshot.total,
      measure: 'keydown event.timeStamp of the last key to the first time the DOM holds what is named (a MutationObserver), on performance.now()\'s clock',
    };
    if (keys.length !== 6) fail(where, `plugins timeline: ${keys.length} keys were recorded for six typed`);
    for (const name of ['typed', 'quick', 'slow', 'big']) if (marks[name] === undefined) fail(where, `plugins timeline: the page never showed ${name}`);
    if (marks.typed === undefined || marks.slow === undefined || marks.quick === undefined) return;
    if (!(marks.typed < marks.slow)) fail(where, `plugins timeline: typing waited: the input showed its text at ${since(marks.typed)} ms, after the slow provider's rows (${since(marks.slow)} ms)`);
    if (!(marks.typed - last.down < KEY_BUDGET)) fail(where, `plugins timeline: typing waited: the last key took ${since(marks.typed)} ms to show in the input, wanted under ${KEY_BUDGET}`);
    if (!(marks.quick < marks.slow)) fail(where, `plugins timeline: the fast provider's rows did not paint before the slow one's: quick ${since(marks.quick)} ms, slow ${since(marks.slow)} ms`);
    else if (marks.slow - marks.quick < LEAD) fail(where, `plugins timeline: the fast provider's rows painted only ${round(marks.slow - marks.quick)} ms before the slow one's, wanted at least ${LEAD} (the slow provider takes ${SLOW_MS})`);
    for (const name of ['quick', 'slow', 'big']) {
      const stat = stats[`Seam Fixture/${name}`];
      if (stat === undefined || stat.calls !== 1 || stat.answered !== 1 || stat.aborted !== 0 || stat.active !== 0) fail(where, `plugins timeline: ${name} was asked ${stat?.calls} times for six keys and answered ${stat?.answered} (told to stop ${stat?.aborted}, ${stat?.active} in flight), wanted one request, answered`);
    }

    if (snapshot.total > 50) fail(where, `plugins timeline: the model counted ${snapshot.total} results, wanted at most 50`);
    if (!band.text.includes('Bulk items: first 20 of 5000')) fail(where, `plugins timeline: the band does not say that 20 of the 5000 rows were kept: ${JSON.stringify(band)}`);
    const rows = await listOf(page);
    const bulk = rows.ids.filter((id) => id.startsWith(SECTION.big)).length;
    if (bulk < 1 || bulk > 21) fail(where, `plugins timeline: ${bulk} rows of the 5000 are on screen`);
  });

  // 2. A key pressed while the slow provider works.
  await part(
    'typing',
    production.origin,
    '',
    { init: script(timeline) },
    async (page) => {
      if (control === 'slow-blocks') await page.evaluate(() => Object.assign(window.__fixturePalette.slow, { spin: true }));
      await openPalette(page);
      // The clock is armed for the text the last key will make, before any key: a call into the page while the slow provider holds the thread would itself wait for it, and the key would then not be pressed in the wait.
      await page.evaluate(() => window.__tlArm('ordersx'));
      await page.keyboard.type('orders', { delay: 40 });
      // The providers are asked 150 ms after the last key: the slow one has been working for about 50 ms when the next key is pressed, and works until 300 ms after it was asked.
      await sleep(200);
      await page.keyboard.press('x');
      await untilMarked(page, marked('typed'));
      const timing = await page.evaluate(() => ({ key: { ...window.__tl.keys[window.__tl.keys.length - 1] }, typed: window.__tl.marks.typed }));
      await sleep(900);
      const stats = await statsOf(page);
      const cost = timing.key.input === null ? Number.NaN : timing.key.input - timing.key.down;
      result.typing = { keyCostMs: round(cost), typedMs: round(timing.typed - timing.key.down), stats, measure: 'keydown event.timeStamp of a key pressed while the slow provider is working to the end of its input event (and to the DOM showing it)' };
      if (!(cost < KEY_BUDGET)) fail(where, `plugins typing: a key pressed while the slow provider worked waited ${round(cost)} ms for the page (the end of its input event), wanted under ${KEY_BUDGET}`);
      if (!(timing.typed - timing.key.down < KEY_BUDGET)) fail(where, `plugins typing: a key pressed while the slow provider worked took ${round(timing.typed - timing.key.down)} ms to show in the input, wanted under ${KEY_BUDGET}`);
      const slow = stats['Seam Fixture/slow'];
      if (control !== 'slow-blocks' && (slow === undefined || slow.aborted !== 1)) fail(where, `plugins typing: the slow provider was not told to stop when the query moved on (${JSON.stringify(slow)})`);
      if (slow === undefined || slow.calls !== 2 || slow.answered !== 1 || slow.active !== 0) fail(where, `plugins typing: the slow provider was asked ${slow?.calls} times and answered ${slow?.answered}, wanted two requests, the second answered, none in flight`);
    },
  );

  // 3. Nothing the user moved to moves when a late section arrives.
  await part('focus', production.origin, '', { init: script(timeline) }, async (page) => {
    await openPalette(page);
    await typeAndWait(page, 'orders', marked('quick'));
    await page.keyboard.press('ArrowDown');
    await sleep(60);
    const before = await listOf(page);
    if (control === 'focus-moves') {
      // The perturbation: a late answer that takes the cursor with it.
      await page.evaluate(() => {
        const wait = setInterval(() => {
          if ((window.__fixturePalette.stats['Seam Fixture/slow']?.answered ?? 0) > 0) {
            clearInterval(wait);
            setTimeout(() => window.__palette.move(1), 20);
          }
        }, 10);
      });
    }

    await untilMarked(page, marked('slow'));
    await sleep(150);
    const after = await listOf(page);
    result.focus = { before: { active: before.active, rows: before.ids.length }, after: { active: after.active, rows: after.ids.length } };
    if (before.active < 1) fail(where, `plugins focus: the user's move did not land on a row (active ${before.active})`);
    if (after.ids.length <= before.ids.length) fail(where, `plugins focus: the slow provider's section did not arrive (${before.ids.length} rows, then ${after.ids.length})`);
    if (after.ids[after.active] !== before.ids[before.active] || after.active !== before.active) {
      fail(where, `plugins focus: the active row moved when a late section arrived: ${before.ids[before.active]} at ${before.active}, then ${after.ids[after.active]} at ${after.active}`);
    }

    const moved = before.ids.findIndex((id, index) => after.ids[index] !== id);
    if (moved >= 0) fail(where, `plugins focus: a row above or at the active row changed when a late section arrived (row ${moved}: ${before.ids[moved]}, then ${after.ids[moved]})`);
    if (!after.ids.slice(before.ids.length).some((id) => id.startsWith(SECTION.slow))) fail(where, 'plugins focus: the late section was not put after the rows the user had in front of them');
  });

  // 4. The commits of a key, with every provider registered (React's development build: the Profiler calls its callback there and not in a production build).
  if (development !== null && development !== undefined) {
    await part('commits', development.origin, '', {}, async (page) => {
      const count = () => page.evaluate(() => window.__commits.length);
      const queryNow = () => page.evaluate(() => window.__palette.getSnapshot().query);
      await page.keyboard.press(await chordOf(page));
      await page.waitForSelector('dialog[open]', { timeout: WAIT });
      await sleep(400);
      if (control === 'extra-commit') {
        // The perturbation: every key is followed by a second change of the palette's state, which is a second commit.
        await page.evaluate(() => {
          let serial = 0;
          window.addEventListener(
            'keydown',
            () => {
              serial += 1;
              setTimeout(() => window.__palette.record({ route: { plugin: 'fixture-a-ok', contribution: 'widgets', params: { n: serial } } }), 10);
            },
            true,
          );
        });
      }

      const presses = [];
      // A key every 100 ms or so: the providers are asked after 150 ms of quiet, so no answer lands in the window of a key that is not the last (the answers are counted apart, below).
      const press = async (label, key) => {
        const [c0, q0] = [await count(), await queryNow()];
        await page.keyboard.press(key);
        await sleep(100);
        const [c1, q1] = [await count(), await queryNow()];
        presses.push({ label, commits: c1 - c0, changed: q0 !== q1 });
      };

      for (const character of 'orders') await press(`type "${character}"`, keyName(character));
      // What the last key asked for has been answered, and its sentence told, before the next key is pressed.
      await sleep(1200);
      await press('ArrowDown', 'ArrowDown');
      for (let index = 0; index < 'orders'.length; index += 1) await press('Backspace', 'Backspace');
      for (const { label, commits, changed } of presses) {
        if (commits > 1) fail(where, `plugins commits: ${label} made ${commits} commits (the query ${changed ? 'changed' : 'did not change'}), wanted at most 1`);
        else if (label !== 'ArrowDown' && !changed) fail(where, `plugins commits: ${label} did not change the query, so its commit count says nothing`);
        else if (label !== 'ArrowDown' && commits !== 1) fail(where, `plugins commits: ${label} made ${commits} commits, wanted 1`);
      }

      // The answers: typed again, every request is answered once and each answer is one commit (the model rebuilds once for each change), then the live region's sentence, once.
      await page.evaluate(() => window.__palette.setQuery(''));
      await sleep(200);
      const before = await count();
      await page.keyboard.type('orders', { delay: 40 });
      const typed = await count();
      await sleep(1400);
      const answers = await page.evaluate(() => Object.values(window.__fixturePalette.stats).filter((stat) => stat.answered > 0).length);
      const settled = (await count()) - typed;
      result.commits = { perKey: Math.max(...presses.map((entry) => entry.commits)), keys: presses.length, typingCommits: typed - before, afterTheLastKey: settled, answers };
      // Three providers answered (quick, slow, big), and the sentence is told to the live region once.
      if (answers !== 3) fail(where, `plugins commits: ${answers} providers answered, wanted 3`);
      else if (settled > answers + 1) fail(where, `plugins commits: ${settled} commits after the last key for ${answers} answers (and one sentence told), wanted at most ${answers + 1}`);
    });
  }

  // 5. Nothing outside the palette moves while the providers answer late. The sampler watches the Search control as well as the window's regions, and keeps sampling longer than its default.
  await part('shift', production.origin, '', { init: `window.__probeParts = ['search']; window.__probeFrames = 600; ${SAMPLER}` }, async (page) => {
    const before = await page.evaluate(() => ({
      frames: window.__probe.frames,
      layoutShift: window.__probe.layoutShift,
      sources: window.__probe.shiftSources.slice(),
      observed: typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes('layout-shift'),
    }));
    if (control === 'plugin-shift') {
      // The perturbation: when the slow provider's section arrives, the Search control moves.
      await page.evaluate(() => {
        const wait = setInterval(() => {
          if ((window.__fixturePalette.stats['Seam Fixture/slow']?.answered ?? 0) > 0) {
            clearInterval(wait);
            const style = document.createElement('style');
            style.textContent = '[data-shell-part="search"] { transform: translateX(3px) !important; }';
            document.head.append(style);
          }
        }, 10);
      });
    }

    await openPalette(page);
    await page.keyboard.type('orders', { delay: 120 });
    await sleep(900);
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press('ArrowDown');
      await sleep(120);
    }

    await page.keyboard.press('Escape');
    await page.waitForFunction(noDialog, null, { timeout: WAIT });
    await sleep(1200);
    const probe = await page.evaluate(() => ({ ...window.__probe }));
    const moves = probe.moves.filter((move) => move.frame > before.frames);
    const gone = probe.gone.filter((entry) => entry.frame > before.frames);
    const layoutShift = before.observed && probe.layoutShift !== null ? probe.layoutShift - (before.layoutShift ?? 0) : null;
    result.shift = { moves: moves.length, layoutShift, frames: probe.frames };
    if (probe.seen.search === undefined) fail(where, 'plugins shift: the sampler never found the Search control ([data-shell-part="search"]): nothing was watched there');
    if (probe.frames >= 600) fail(where, "plugins shift: the sampler stopped at its 600 frames before the end of the palette's use: the last of it was not watched");
    if (moves.length > 0) fail(where, `plugins shift: ${moves.length} moves outside the palette: ${JSON.stringify(moves.slice(0, 4))}`);
    if (gone.length > 0) fail(where, `plugins shift: ${gone.length} regions left the DOM: ${JSON.stringify(gone.slice(0, 4))}`);
    if (layoutShift !== null && layoutShift !== 0) fail(where, `plugins shift: layout shift ${layoutShift} while the palette was used with providers answering late`);
  });

  // 6. A closed palette does no provider work, however the plugin comes and goes while it is closed, and leaves none behind when it was used.
  await part('closed', production.origin, '', { init: script(watch), fonts: false }, async (page) => {
    if (control === 'closed-work') {
      // The perturbation: a provider is called while the palette is closed.
      await page.evaluate(() => {
        setTimeout(() => {
          window.__fixturePalette.stats['Seam Fixture/quick'] = { calls: 1, aborted: 0, answered: 0, active: 0 };
        }, 300);
      });
    }

    await sleep(800);
    const ran = () => page.evaluate(() => window.__watch.ran().count);
    const idle = async () => {
      const before = await ran();
      await sleep(IDLE);
      return (await ran()) - before;
    };
    const kinds = ['timeouts', 'intervals', 'frames', 'idles'];
    const outstanding = (snapshot) => Object.fromEntries(kinds.map((kind) => [kind, snapshot[kind].length]));
    const asked = async () => JSON.stringify(await statsOf(page));
    const quiet = await idle();
    const base = await page.evaluate(() => window.__watch.snapshot());
    if ((await asked()) !== '{}') fail(where, `plugins closed: a provider was asked before the palette had been opened: ${await asked()}`);
    if (quiet !== 0) fail(where, `plugins closed: ${quiet} timer or frame callbacks ran in ${IDLE} ms while the palette had never been opened`);

    // The plugin leaves and comes back while the palette is closed (a retry, an upgrade): nothing is asked, and nothing is held.
    await page.evaluate(() => window.__plugin.unload());
    await sleep(150);
    await page.evaluate(() => window.__plugin.reload());
    await sleep(300);
    if ((await asked()) !== '{}') fail(where, `plugins closed: a provider was asked while the palette was closed and its plugin left and came back: ${await asked()}`);
    const heldAfterReload = await page.evaluate(() => window.__watch.snapshot());
    if (outstanding(heldAfterReload).timeouts > outstanding(base).timeouts) fail(where, `plugins closed: ${outstanding(heldAfterReload).timeouts} timeouts outstanding after a plugin left and came back while the palette was closed, ${outstanding(base).timeouts} before`);

    // Used, and closed.
    await openPalette(page);
    await page.keyboard.type('orders', { delay: 80 });
    await sleep(900);
    await page.keyboard.press('ArrowDown');
    await sleep(100);
    const used = await statsOf(page);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { state: 'detached', timeout: WAIT });
    await sleep(AFTER_CLOSE);
    const closed = await statsOf(page);
    const quietAfter = await idle();
    const after = await statsOf(page);
    const snapshot = await page.evaluate(() => window.__watch.snapshot());
    const heldBase = new Set(base.held.map((entry) => entry.key));
    const added = snapshot.held.filter((entry) => !heldBase.has(entry.key));
    const left = outstanding(snapshot);
    const before = outstanding(base);
    for (const [key, stat] of Object.entries(closed)) {
      if (stat.active !== 0) fail(where, `plugins closed: ${key} has ${stat.active} requests in flight after the palette closed`);
      if (JSON.stringify(after[key]) !== JSON.stringify(stat)) fail(where, `plugins closed: ${key} did work while the palette was closed: ${JSON.stringify(stat)}, then ${JSON.stringify(after[key])}`);
    }

    if (Object.keys(used).length !== 3) fail(where, `plugins closed: ${Object.keys(used).length} providers were asked while the palette was used, wanted the three that answer on demand`);
    if (added.length > 0) fail(where, `plugins closed: ${added.length} registrations on the window or the document that the palette and its providers left behind: ${added.map((entry) => entry.key).join('; ')}`);
    for (const kind of kinds) if (left[kind] > before[kind]) fail(where, `plugins closed: ${left[kind]} ${kind} outstanding after the palette was used and closed, ${before[kind]} before`);
    if (quietAfter !== 0) fail(where, `plugins closed: ${quietAfter} timer or frame callbacks ran in ${IDLE} ms after the palette was used and closed`);
    result.closed = { askedBeforeOpen: 0, used: Object.fromEntries(Object.entries(used).map(([key, stat]) => [key, stat.calls])), outstandingAfter: left, callbacksRanAfterUse: quietAfter };
  });

  // 7. The states a user can be in with a plugin's sections, and what each says to a screen reader.
  await part('states', production.origin, '', { init: script(timeline) }, async (page, _errors, messages) => {
    const found = {};
    const check = async (label, within = null) => {
      if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async (selector) => {
        const done = await window.axe.run(selector === null ? document : document.querySelector(selector), { resultTypes: ['violations'] });
        return done.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, first: v.nodes[0]?.html.slice(0, 140) }));
      }, within);
      found[label] = violations;
      for (const violation of violations) fail(where, `a11y plugins ${label}: ${violation.id} (${violation.impact}, ${violation.nodes}): ${violation.first}`);
    };
    const shot = async (name) => {
      if (shots !== undefined) await page.screenshot({ path: `${shots}/palette-plugins-${name}-${engine}-${viewportName}.png` });
    };
    const reset = async () => {
      await page.evaluate(() => window.__palette.setQuery(''));
      await sleep(250);
    };

    // The sections with results: a plugin's providers, below the host's, each headed by the plugin's name.
    await openPalette(page);
    await typeAndWait(page, 'orders', marked('slow'));
    await sleep(500);
    const headings = await page.evaluate(() => [...document.querySelectorAll('dialog [data-palette-part="label"]')].map((label) => label.textContent));
    if (JSON.stringify(headings) !== JSON.stringify(['Seam Fixture · Items', 'Seam Fixture · Slow items', 'Seam Fixture · Bulk items'])) fail(where, `plugins states: the sections are ${JSON.stringify(headings)}, wanted the plugin's three, headed by its name`);
    found.headings = headings;
    await check('results');
    await shot('results');

    // A page and a command of the plugin, from its match provider.
    await reset();
    await typeAndWait(page, 'fixture', marked('pages'));
    const matched = await listOf(page);
    if (!matched.names.some((name) => name === 'Page: Fixture list, Everything in one place') || !matched.names.some((name) => name === 'Command: Reset fixture counters, Command')) fail(where, `plugins states: the match provider's page and command are not in the list: ${JSON.stringify(matched.names)}`);
    found.match = matched.names;
    await check('match');

    // A provider that rejects: said in the host's words, with a Retry; the others answer; the Retry asks again and, once the provider is well, its rows come.
    await reset();
    await page.evaluate(() => Object.assign(window.__fixturePalette.quick, { fail: 'reject' }));
    await typeAndWait(page, 'orders', marked('slow'));
    await sleep(300);
    const failed = await bandOf(page);
    if (!failed.text.includes('Items: Unavailable') || !failed.buttons.some((label) => label.startsWith('Retry '))) fail(where, `plugins states: the band does not say which source failed, with a Retry: ${JSON.stringify(failed)}`);
    if (/rejected on purpose/.test(failed.text)) fail(where, `plugins states: the band shows the plugin's own words: ${JSON.stringify(failed)}`);
    const withError = await listOf(page);
    if (withError.ids.some((id) => id.startsWith(SECTION.quick)) || !withError.ids.some((id) => id.startsWith(SECTION.slow))) fail(where, `plugins states: with the fast provider failing, its rows are on screen or the slow provider's are not: ${JSON.stringify(withError.ids)}`);
    await check('error');
    await shot('error');
    await page.evaluate(() => Object.assign(window.__fixturePalette.quick, { fail: '' }));
    await page.locator('dialog [data-palette-part="band"] button', { hasText: 'Retry' }).first().click();
    await page.waitForFunction(() => document.querySelector('[data-palette-row^="fixture-a-ok:quick|"]') !== null, null, { timeout: WAIT });
    const retried = await bandOf(page);
    if (retried.text.includes('Items: Unavailable')) fail(where, `plugins states: the band still says the source failed after its Retry answered: ${JSON.stringify(retried)}`);

    // A provider that answers what is not a list: the same line. One with a row that is not valid: the row is left out, the problem is told to the console once, the rest is shown, and the band says nothing.
    await reset();
    await page.evaluate(() => Object.assign(window.__fixturePalette.quick, { fail: 'garbage' }));
    await typeAndWait(page, 'orders', marked('slow'));
    await sleep(300);
    if (!(await bandOf(page)).text.includes('Items: Unavailable')) fail(where, 'plugins states: a provider that answered what is not a list is not said to be unavailable');
    await reset();
    await page.evaluate(() => Object.assign(window.__fixturePalette.quick, { fail: 'rows' }));
    messages.length = 0;
    await typeAndWait(page, 'orders', marked('quick'));
    await sleep(300);
    const dropped = await listOf(page);
    if (dropped.names.some((name) => name?.includes('Not valid'))) fail(where, `plugins states: a row with a glyph the kit does not have is on screen: ${JSON.stringify(dropped.names)}`);
    if (!dropped.ids.some((id) => id.startsWith(SECTION.quick))) fail(where, 'plugins states: the valid rows of an answer with a row that is not valid are not on screen');
    const told = messages.filter((message) => message.text.includes('[palette] fixture-a-ok:quick: row "bad"'));
    if (told.length !== 1) fail(where, `plugins states: the problem of the row that is not valid was told ${told.length} times, wanted once: ${JSON.stringify(messages.slice(0, 4))}`);
    await page.evaluate(() => Object.assign(window.__fixturePalette.quick, { fail: '' }));

    // An answer that comes after the provider was told to stop is never shown. `big` is deaf to its signal and answers after 400 ms; the query moves on at 250 ms; the old answer's rows are `alpha ...`.
    await reset();
    await page.evaluate(() => Object.assign(window.__fixturePalette.big, { listen: false, delay: 400 }));
    await page.evaluate(() => window.__tlArm('alpha'));
    await page.keyboard.type('alpha', { delay: 40 });
    await sleep(250);
    await page.keyboard.type('x', { delay: 40 });
    if (control === 'stale-shown') {
      // The perturbation: the old answer's rows are drawn after all.
      await page.evaluate(() => {
        setTimeout(() => {
          const row = document.createElement('div');
          row.setAttribute('role', 'option');
          row.setAttribute('data-palette-row', 'fixture-a-ok:big|fixture-a-ok:big|bulk:0000');
          row.setAttribute('aria-label', 'Resource: alpha 0000, Bulk');
          document.querySelector('dialog [role=listbox]')?.append(row);
        }, 700);
      });
    }

    await sleep(1400);
    const stale = await page.evaluate(() => [...document.querySelectorAll('dialog [role=option]')].map((option) => option.getAttribute('aria-label')).filter((name) => /Resource: alpha \d/.test(name ?? '')));
    const deaf = (await statsOf(page))['Seam Fixture/big'];
    found.stale = { rowsOfTheOldQuery: stale.length, big: deaf };
    if (deaf === undefined || deaf.aborted < 1 || deaf.answered < 2) fail(where, `plugins states: the deaf provider was not told to stop, or its first answer never came (${JSON.stringify(deaf)}): the check did not make an answer after a stop`);
    if (stale.length > 0) fail(where, `plugins states: ${stale.length} rows of an answer that came after the provider was told to stop are on screen: ${JSON.stringify(stale.slice(0, 2))}`);
    await page.evaluate(() => Object.assign(window.__fixturePalette.big, { listen: true, delay: 0 }));

    // A provider that never answers has failed after five seconds, and the others had answered: said once, at 1440 x 900 only (it takes five seconds).
    if (viewportName === '1440x900') {
      await reset();
      await page.evaluate(() => Object.assign(window.__fixturePalette.slow, { fail: 'hang' }));
      await typeAndWait(page, 'orders', marked('quick'));
      await page.waitForFunction(() => document.querySelector('dialog [data-palette-part="band"]')?.textContent?.includes('Slow items: Timed out'), null, { timeout: WAIT });
      await check('timeout');
      await page.evaluate(() => Object.assign(window.__fixturePalette.slow, { fail: '' }));
    }

    // A plugin that leaves while the palette is open takes its sections away at once, and its request with them; one that comes back brings its sections back without a key.
    await reset();
    await typeAndWait(page, 'orders', marked('quick'));
    const askedBefore = (await statsOf(page))['Seam Fixture/slow'];
    await page.evaluate(() => window.__plugin.unload());
    await sleep(150);
    const goneRows = await listOf(page);
    const gone = goneRows.ids.filter((id) => id.startsWith('fixture-a-ok:'));
    const left = (await statsOf(page))['Seam Fixture/slow'];
    if (gone.length > 0) fail(where, `plugins states: ${gone.length} rows of a plugin that left are still on screen 150 ms after it left`);
    if (askedBefore.active === 1 && (left.aborted !== askedBefore.aborted + 1 || left.active !== 0)) fail(where, `plugins states: the request of the plugin that left was not told to stop: ${JSON.stringify(askedBefore)}, then ${JSON.stringify(left)}`);
    const stillOpen = await page.evaluate(() => document.querySelector('dialog[open]') !== null);
    if (!stillOpen) fail(where, 'plugins states: the palette closed when a plugin left');
    await page.evaluate(() => window.__plugin.reload());
    await page.waitForFunction(() => document.querySelector('[data-palette-row^="fixture-a-ok:quick|"]') !== null, null, { timeout: WAIT });
    await page.evaluate(() => window.__plugin.fail());
    await sleep(150);
    if ((await listOf(page)).ids.some((id) => id.startsWith('fixture-a-ok:'))) fail(where, 'plugins states: the rows of a plugin that failed are still on screen');
    found.leaves = { rowsAfterUnload: gone.length };
    result.states = found;
  });

  // 8. A page found by the keyword its sidebar entry carries (C1e), through the host's own wiring of a plugin's sidebar (`?aliases=1`). `gz` is the keyword of Gadgets; Gazebo is a decoy whose title holds its letters in one
  // word, which a title match of that kind used to outrank a keyword with. The page the keyword names must be in the list (the negative control `alias-ignored`: the host does not read the keyword), the FIRST row (`alias-loose`:
  // the keyword ranks as a plain keyword did, 3 against a title's 6, so the decoy comes first), nothing of the keyword drawn on a row, and a plain Enter opens it in the tab on screen.
  await part('aliases', production.origin, 'aliases=1', {}, async (page) => {
    if (control === 'alias-ignored' || control === 'alias-loose') await page.evaluate((fault) => window.__aliasFault(fault), control === 'alias-ignored' ? 'ignored' : 'loose');
    await openPalette(page);
    await page.keyboard.type('gz', { delay: 60 });
    await sleep(400);
    const listed = await listOf(page);
    const drawn = await page.evaluate(() => [...document.querySelectorAll('dialog [role=option]')].map((option) => option.textContent ?? ''));
    const named = listed.names.indexOf('Page: Gadgets, Group');
    if (shots !== undefined) await page.screenshot({ path: `${shots}/palette-aliases-${engine}-${viewportName}.png` });
    result.aliases = { names: listed.names, named, active: listed.active };
    if (named < 0) {
      fail(where, `plugins aliases: the keyword "gz" does not find the page it names: ${JSON.stringify(listed.names)}`);
      return;
    }

    if (!listed.names.includes('Page: Gazebo, Group')) fail(where, `plugins aliases: the decoy (a title that holds the letters of the keyword) is not in the list, so the order says nothing: ${JSON.stringify(listed.names)}`);
    if (named !== 0) fail(where, `plugins aliases: the page a keyword names is not the first row: it is row ${named}, after ${JSON.stringify(listed.names.slice(0, named))}`);
    if (drawn.some((text) => /gz/i.test(text))) fail(where, `plugins aliases: the keyword is drawn on a row: ${JSON.stringify(drawn)}`);
    await page.keyboard.press('Enter');
    await sleep(200);
    const went = await page.evaluate(() => {
      const state = window.__tabs.getSnapshot();
      return { tabs: state.order.length, page: state.active === null ? null : (state.tabs[state.active]?.location.route.contribution ?? null) };
    });
    result.aliases = { ...result.aliases, went };
    if (went.page !== 'gadgets' || went.tabs !== 1) fail(where, `plugins aliases: a plain Enter on the page a keyword names did not open it in the tab on screen: ${JSON.stringify(went)}`);
  });

  // 9. The connection a row says (C1f), through the host's own wiring (`?connection=1`). The tab on screen is the detail page of an item read in a connection whose KEY is `north-57a082bd74`, and its scope lane says the NAME,
  // `north`. The palette says the name (its chips, the rows of Go to, the row of Tabs) and the key is in nothing it draws in any of those states: no text and no accessible name (the negative control `connection-key`: a
  // source of the host's own that says the key).
  await part('connection', production.origin, 'connection=1', {}, async (page) => {
    const KEY = 'north-57a082bd74';
    if (control === 'connection-key') await page.evaluate(() => window.__connectionFault());
    /** Everything the dialog draws, and every accessible name in it. */
    const drawn = () =>
      page.evaluate(() => {
        const dialog = document.querySelector('dialog');
        return dialog === null ? [] : [dialog.innerText, ...[...dialog.querySelectorAll('[aria-label]')].map((node) => node.getAttribute('aria-label') ?? '')];
      });
    const kind = async (name) => {
      await page.locator('dialog').getByRole('tab', { name, exact: true }).click();
      await sleep(300);
    };
    const seen = [];
    await openPalette(page);
    const chips = await page.evaluate(() => document.querySelector('dialog [data-palette-part="chips"]')?.textContent ?? '');
    seen.push(...(await drawn()));
    if (!/north/.test(chips)) fail(where, `plugins connection: the chip that narrows the palette to the connection does not say its name: ${JSON.stringify(chips)}`);
    // Without the chips the rows say the connection.
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await kind('Go to');
    const places = (await listOf(page)).names;
    seen.push(...(await drawn()));
    for (const want of ['Page: Gadgets, north · Group', 'Page: Overview, north']) {
      if (!places.includes(want)) fail(where, `plugins connection: no row of Go to says "${want}": ${JSON.stringify(places)}`);
    }

    await kind('Tabs');
    const tabs = (await listOf(page)).names;
    seen.push(...(await drawn()));
    if (!tabs.some((name) => name?.startsWith('Tab: ') && name.endsWith('north · Current tab'))) fail(where, `plugins connection: the row of the tab on screen does not say the connection once, by its name: ${JSON.stringify(tabs)}`);
    result.connection = { chips, places, tabs };
    const keyed = seen.filter((text) => text.includes(KEY));
    if (keyed.length > 0) fail(where, `plugins connection: the key of the connection is drawn (a text or an accessible name): ${JSON.stringify(keyed.map((text) => text.slice(0, 120)))}`);
  });
}

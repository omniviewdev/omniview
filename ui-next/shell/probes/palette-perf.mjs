// What the command palette costs, measured in the page the way a person meets it (palette-probe.mjs calls `perf` once for each engine and viewport, in a page of its own for each section):
//
//   open        the chord to the second animation frame after the dialog is in the DOM, 30 times. A proxy for first paint: no page can see when a frame reached the screen; the first frame after the
//               dialog is in the DOM is the first one drawn with it, and the second frame's callbacks run once that one is done (an upper bound: in Chromium the engine's own Event Timing puts the same presses about 10 ms lower). Recorded, never judged.
//   keystroke   a real key press to the second animation frame after the DOM shows what that key did (the input's text, and a list that is the model's, row for row), with the fixture's
//               1,000 host rows registered: nine characters typed and as many deleted, five times. Recorded, never judged; what is checked is that the palette showed rows that match, and the
//               model never counted more than 50 results. `dom` is what a key costs before any frame (its keydown to the end of its input event, the commit included).
//   commits     (development build) the React commits between a key press and 100 ms after it: a character and a Backspace cost exactly one, ArrowDown at most one.
//   shift       the sampler (harness.mjs SAMPLER) watches every named region of the window and the Search control at every frame while the palette opens, takes a query, moves and closes:
//               nothing may move (the palette is in the top layer) and the engine's layout-shift observer reads 0 (null where the engine has none: WebKit). Only what comes after the chord
//               is the palette's: the window loading and its fonts settling come before it and are reported apart (`beforeTheChord`).
//   closed      a closed palette holds one listener, the chord's, and no timer: the registrations on `window` and `document` and the outstanding timeouts, intervals, frames and idle callbacks are
//               taken before the palette is used and after it has been opened, typed in and closed, and must be the same; a closed page runs no timer or frame callback. The wrappers that see
//               these are tried on the page first. The palette's listener is the keydown capture on the window that takes the chord (the kit's tooltips hold another, for Escape).
//
// The numbers go to `report.perf["<engine> <viewport>"]` as
//   { open: { p50, p95, min, max, samples, first, measure }, keystroke: { p50, p95, max, samples, typing: { p50, p95 }, backspace: { p50, p95 }, slowest, dom, rows }, commits,
//     shift: { moves, layoutShift, frames, beforeTheChord? }, closed: { listenersHeld, timersOutstanding, callbacksRan, windowKeydownCaptures, windowKeydownCapturesAll, ... } }
// in milliseconds, nearest-rank percentiles; `fail(where, what)` records what must hold and is never thrown.
import { normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';
import { SAMPLER, open, sleep } from './harness.mjs';

/** Opens and closes of the first section, and the time between two key presses (so that none coalesces with the one before it). */
const OPENS = 30;
const GAP = 120;
/** The query of the second and third sections: typed one character at a time, then deleted one at a time. Its prefixes are `a`, `al`, `alp`, `alph`, `alpha`, `alpha `, `alpha b`, `alpha br`, `alpha bra`. */
const TYPED = 'alpha bra';
const REPETITIONS = 5;
/** The whole list is at most 50 rows (the model's own bound); a query up to this one finds some. */
const MAX_TOTAL = 50;
const MATCHING = 'alpha';
/** The third section: a key press, then 100 ms for its commits, then the rest of 150 ms. */
const COMMIT_GAP = 150;
const COMMIT_WINDOW = 100;
/** The fifth section: how long a closed page is watched for callbacks, and how long the page has to run what the palette left behind once it is closed again. */
const IDLE = 1000;
const AFTER_CLOSE = 600;
const WAIT = 8000;

const round = (value) => Math.round(value * 10) / 10;
const nearest = (sorted, percent) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1))];

/** Percentiles by nearest rank, in ms to a tenth. */
function summary(values) {
  if (values.length === 0) return { p50: null, p95: null, min: null, max: null, samples: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: round(nearest(sorted, 50)), p95: round(nearest(sorted, 95)), min: round(sorted[0]), max: round(sorted[sorted.length - 1]), samples: sorted.length };
}

const firstLine = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300);

// ---------------------------------------------------------------------------------------------------------------------------
// The page's side. Every function here is stringified into an init script (`script`): it runs in the page before the page's own scripts and uses nothing of this module.

/**
 * The key and the clock of the chord: when its keydown happened (`event.timeStamp`, which is on `performance.now()`'s clock), and the time of the second frame after a dialog is in the DOM. An idle
 * page in a headless engine is given its next frames at once and not at a display's pace (the same open reads 5 ms there and 22 ms with the page asking for a frame all the time), so the page
 * asks for one all the time, as a page that animates does, and its frames are paced as a display's are.
 */
function openClock() {
  const state = (window.__open = { downAt: null, samples: [], there: false });
  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.repeat && event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) state.downAt = event.timeStamp;
    },
    true,
  );
  const look = () => {
    const there = document.querySelector('dialog[open]') !== null;
    if (there && !state.there) {
      const from = state.downAt;
      requestAnimationFrame(() => requestAnimationFrame(() => state.samples.push({ from, at: performance.now() })));
    }
    state.there = there;
  };
  const beat = () => requestAnimationFrame(beat);
  requestAnimationFrame(beat);
  new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
}

/**
 * The clock of a key: `__ksArm(want)` says what the input must hold once the next key is done with; the key's keydown (`event.timeStamp`) starts the clock; from then on every frame asks whether the
 * DOM shows what the model holds (the input's text, and a list of options that is the snapshot's rows, one for one, each named by its row's name: the accessible name is the model's and may go on,
 * after a comma, with the words the row draws in its trailing slot, a chord or "Show all"); the second frame after the first one that does is the end. The `input` event bubbles up to the window
 * after the root's listeners have run, so the time it is seen at is when the model had been given the text and the tree had been committed: what the key cost before a frame.
 */
function keyClock() {
  const clock = (window.__ks = { t0: null, inputAt: null, record: null });
  window.addEventListener(
    'keydown',
    (event) => {
      clock.t0 = event.timeStamp;
    },
    true,
  );
  window.addEventListener('input', () => {
    if (clock.inputAt === null) clock.inputAt = performance.now();
  });
  window.__ksShown = (want) => {
    const input = document.querySelector('[role=combobox]');
    const snapshot = window.__palette.getSnapshot();
    const options = document.querySelectorAll('[role=option]');
    const state = { want, value: input === null ? null : input.value, query: snapshot.query, options: options.length, rows: snapshot.rows.length };
    if (input === null || input.value !== want || snapshot.query !== want || options.length !== snapshot.rows.length) return { shown: false, state };
    for (let index = 0; index < options.length; index += 1) {
      const label = options[index].getAttribute('aria-label') ?? '';
      const name = snapshot.rows[index].name ?? '';
      if (label !== name && !label.startsWith(`${name}, `)) return { shown: false, state: { ...state, differsAt: index, label, name } };
    }

    return { shown: true, state };
  };
  window.__ksArm = (want) => {
    const record = (clock.record = { want, t0: null, t1: null, dom: null, rows: -1, total: -1, query: null });
    clock.t0 = null;
    clock.inputAt = null;
    const tick = () => {
      if (clock.record !== record) return;
      if (clock.t0 !== null && window.__ksShown(want).shown) {
        const snapshot = window.__palette.getSnapshot();
        record.t0 = clock.t0;
        record.dom = clock.inputAt;
        record.rows = snapshot.rows.length;
        record.total = snapshot.total;
        record.query = snapshot.query;
        requestAnimationFrame(() => {
          record.t1 = performance.now();
        });
        return;
      }

      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  };
}

/**
 * What a page holds, and what it has outstanding: every listener on `window` and on `document` (a node that leaves takes its listeners with it, so nodes are not watched), keyed by the target, the
 * type, the phase and the listener's identity, and every timeout, interval, animation frame and idle callback that has not run or been cleared, with the stack that started it. Also how many
 * callbacks have run. Wraps the registering and the clearing on the prototypes that have them (an engine may put the window's own methods on the window), so it sees every caller.
 */
export function watch() {
  const held = new Map();
  const ids = new WeakMap();
  let serial = 0;
  const idOf = (listener) => {
    if (listener === null || (typeof listener !== 'object' && typeof listener !== 'function')) return 0;
    let id = ids.get(listener);
    if (id === undefined) {
      serial += 1;
      id = serial;
      ids.set(listener, id);
    }

    return id;
  };
  const kindOf = (target) => (target === window ? 'window' : target === document ? 'document' : 'node');
  const captureOf = (options) => (typeof options === 'boolean' ? options : options !== null && typeof options === 'object' && Boolean(options.capture));
  const keyOf = (kind, type, listener, options) => `${kind} ${String(type)} ${captureOf(options) ? 'capture' : 'bubble'} #${idOf(listener)}`;
  const sourceOf = (listener) => (typeof listener === 'function' ? Function.prototype.toString.call(listener).replace(/\s+/g, ' ').slice(0, 140) : '[object with handleEvent]');

  const own = (object, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    return descriptor !== undefined && typeof descriptor.value === 'function' ? descriptor : undefined;
  };
  const holders = (name) => {
    const found = new Set();
    for (const start of [window, document, document.createElement('div')]) {
      for (let object = start; object !== null; object = Object.getPrototypeOf(object)) {
        if (own(object, name) !== undefined) found.add(object);
      }
    }

    return found;
  };
  for (const holder of holders('addEventListener')) {
    const descriptor = own(holder, 'addEventListener');
    const original = descriptor.value;
    Object.defineProperty(holder, 'addEventListener', {
      ...descriptor,
      value: function addEventListener(type, listener, options) {
        const kind = kindOf(this ?? window);
        if (kind !== 'node' && listener !== null && listener !== undefined && !(options !== null && typeof options === 'object' && options.signal?.aborted === true)) {
          const key = keyOf(kind, type, listener, options);
          if (!held.has(key)) {
            const record = { kind, type: String(type), capture: captureOf(options), listener, source: sourceOf(listener) };
            held.set(key, record);
            // A listener that goes by itself (a `once`, an aborted signal) is not held after it has gone: its own record goes, and not one that took its place after it was removed.
            const release = () => {
              if (held.get(key) === record) held.delete(key);
            };
            if (options !== null && typeof options === 'object') {
              if (options.once === true) original.call(this, type, release, { capture: captureOf(options), once: true });
              if (options.signal) options.signal.addEventListener('abort', release, { once: true });
            }
          }
        }

        return original.apply(this, arguments);
      },
    });
  }

  for (const holder of holders('removeEventListener')) {
    const descriptor = own(holder, 'removeEventListener');
    const original = descriptor.value;
    Object.defineProperty(holder, 'removeEventListener', {
      ...descriptor,
      value: function removeEventListener(type, listener, options) {
        const kind = kindOf(this ?? window);
        if (kind !== 'node') held.delete(keyOf(kind, type, listener, options));
        return original.apply(this, arguments);
      },
    });
  }

  const timeouts = new Map();
  const intervals = new Map();
  const frames = new Map();
  const idles = new Map();
  const ranLog = [];
  let ran = 0;
  const stackOf = () => {
    const lines = String(new Error().stack ?? '')
      .split('\n')
      .filter((line) => !/^Error\b/.test(line));
    return lines.slice(1, 7).map((line) => line.trim()).join(' | ');
  };
  const ranOne = (kind, info) => {
    ran += 1;
    if (ranLog.length >= 60) ranLog.shift();
    ranLog.push({ kind, at: performance.now(), delay: info.delay, stack: info.stack });
  };

  const nativeSetTimeout = window.setTimeout;
  window.setTimeout = function setTimeout(handler, delay, ...args) {
    if (typeof handler !== 'function') return nativeSetTimeout.call(this, handler, delay, ...args);
    const info = { delay: Number(delay) || 0, stack: stackOf() };
    const id = nativeSetTimeout.call(
      this,
      function (...inner) {
        timeouts.delete(id);
        ranOne('timeout', info);
        return handler.apply(this, inner);
      },
      delay,
      ...args,
    );
    timeouts.set(id, info);
    return id;
  };
  const nativeClearTimeout = window.clearTimeout;
  window.clearTimeout = function clearTimeout(id) {
    timeouts.delete(id);
    intervals.delete(id);
    return nativeClearTimeout.call(this, id);
  };

  const nativeSetInterval = window.setInterval;
  window.setInterval = function setInterval(handler, delay, ...args) {
    if (typeof handler !== 'function') return nativeSetInterval.call(this, handler, delay, ...args);
    const info = { delay: Number(delay) || 0, stack: stackOf() };
    const id = nativeSetInterval.call(
      this,
      function (...inner) {
        ranOne('interval', info);
        return handler.apply(this, inner);
      },
      delay,
      ...args,
    );
    intervals.set(id, info);
    return id;
  };
  const nativeClearInterval = window.clearInterval;
  window.clearInterval = function clearInterval(id) {
    timeouts.delete(id);
    intervals.delete(id);
    return nativeClearInterval.call(this, id);
  };

  const nativeFrame = window.requestAnimationFrame;
  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (typeof callback !== 'function') return nativeFrame.call(this, callback);
    const info = { delay: 0, stack: stackOf() };
    const id = nativeFrame.call(this, function (time) {
      frames.delete(id);
      ranOne('frame', info);
      return callback.call(this, time);
    });
    frames.set(id, info);
    return id;
  };
  const nativeCancelFrame = window.cancelAnimationFrame;
  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    frames.delete(id);
    return nativeCancelFrame.call(this, id);
  };

  if (typeof window.requestIdleCallback === 'function') {
    const nativeIdle = window.requestIdleCallback;
    window.requestIdleCallback = function requestIdleCallback(callback, options) {
      if (typeof callback !== 'function') return nativeIdle.call(this, callback, options);
      const info = { delay: 0, stack: stackOf() };
      const id = nativeIdle.call(
        this,
        function (deadline) {
          idles.delete(id);
          ranOne('idle', info);
          return callback.call(this, deadline);
        },
        options,
      );
      idles.set(id, info);
      return id;
    };
    const nativeCancelIdle = window.cancelIdleCallback;
    window.cancelIdleCallback = function cancelIdleCallback(id) {
      idles.delete(id);
      return nativeCancelIdle.call(this, id);
    };
  }

  const listed = (map) => [...map.entries()].map(([id, info]) => ({ id, delay: info.delay, stack: info.stack }));
  window.__watch = {
    snapshot: () => ({
      held: [...held.entries()].map(([key, info]) => ({ key, kind: info.kind, type: info.type, capture: info.capture, source: info.source })),
      timeouts: listed(timeouts),
      intervals: listed(intervals),
      frames: listed(frames),
      idles: listed(idles),
    }),
    now: () => performance.now(),
    ran: () => ({ count: ran, log: ranLog.slice() }),
    /** Which keydown captures on the window take the chord: each is handed a made-up chord, and the one that takes it (marks it handled, or opens the palette) is the palette's. Closes what it opened. */
    chordListeners: (mac) => {
      const found = [];
      for (const [key, info] of held) {
        if (info.kind !== 'window' || info.type !== 'keydown' || !info.capture) continue;
        const event = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
        const before = window.__palette.getSnapshot().open;
        try {
          if (typeof info.listener === 'function') info.listener.call(window, event);
          else info.listener.handleEvent(event);
        } catch {
          // A listener that cannot take a made-up event does not take the chord.
        }

        if (event.defaultPrevented || window.__palette.getSnapshot().open !== before) found.push(key);
        if (window.__palette.getSnapshot().open) window.__palette.close();
      }

      return found;
    },
    /** What the wrappers must do, tried on the page itself, so that a page that holds nothing is a page that holds nothing and not wrappers that see nothing. Answers what failed. */
    selfTest: () => {
      const problems = [];
      const has = (prefix) => [...held.keys()].some((key) => key.startsWith(prefix));
      const noop = () => undefined;
      for (const [name, target] of [['window', window], ['document', document]]) {
        target.addEventListener('probe-self-test', noop, true);
        if (!has(`${name} probe-self-test capture`)) problems.push(`a listener added on the ${name} was not seen`);
        target.removeEventListener('probe-self-test', noop, true);
        if (has(`${name} probe-self-test capture`)) problems.push(`a listener removed from the ${name} is still held`);
        target.addEventListener('probe-self-test', noop, { once: true });
        target.dispatchEvent(new Event('probe-self-test'));
        if (has(`${name} probe-self-test bubble`)) problems.push(`a listener of the ${name} that ran once is still held`);
        const controller = new AbortController();
        target.addEventListener('probe-self-test', noop, { signal: controller.signal });
        controller.abort();
        if (has(`${name} probe-self-test bubble`)) problems.push(`a listener of the ${name} whose signal aborted is still held`);
      }

      const timeout = window.setTimeout(noop, 60000);
      if (!timeouts.has(timeout)) problems.push('a timeout was not seen');
      window.clearTimeout(timeout);
      if (timeouts.has(timeout)) problems.push('a cleared timeout is still outstanding');
      const interval = window.setInterval(noop, 60000);
      if (!intervals.has(interval)) problems.push('an interval was not seen');
      window.clearInterval(interval);
      if (intervals.has(interval)) problems.push('a cleared interval is still outstanding');
      const frame = window.requestAnimationFrame(noop);
      if (!frames.has(frame)) problems.push('an animation frame was not seen');
      window.cancelAnimationFrame(frame);
      if (frames.has(frame)) problems.push('a cancelled animation frame is still outstanding');
      if (typeof window.requestIdleCallback === 'function') {
        const idle = window.requestIdleCallback(noop);
        if (!idles.has(idle)) problems.push('an idle callback was not seen');
        window.cancelIdleCallback(idle);
        if (idles.has(idle)) problems.push('a cancelled idle callback is still outstanding');
      }

      return problems;
    },
  };
}

/** The text of an init script that runs `fn` in the page. */
export const script = (fn) => `(${fn.toString()})();`;

// ---------------------------------------------------------------------------------------------------------------------------
const url = (origin, query) => `${origin}/shell/probes/palette-fixture.html?case=${query}`;
const chordOf = async (page) => ((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+k' : 'Control+k');
const keyName = (character) => (character === ' ' ? 'Space' : character);
const noDialog = () => document.querySelector('dialog[open]') === null;

export async function perf({ browser, engine, viewportName, viewport, production, development, report, fail }) {
  const where = `${engine} ${viewportName}`;
  const result = { open: null, keystroke: null, commits: null, shift: null, closed: null };
  report.perf ??= {};
  report.perf[where] = result;

  /**
   * One section in a page of its own: opened by the harness (`fonts: false` leaves the fonts alone, for the section that counts the timers a page runs, because the font settling is itself a
   * timer), then `body(page, errors)`. What throws is a failure of the section, the page's errors are failures, and the context is always closed.
   */
  async function section(name, origin, query, { init, fonts = true }, body) {
    let opened;
    try {
      opened = await open(browser, url(origin, query), viewport, { init });
      if (fonts) await normalizeFont(opened.page, { rootVar: '--ov-font-ui' });
      await body(opened.page);
    } catch (error) {
      fail(where, `perf ${name}: ${firstLine(error)}`);
    } finally {
      if (opened !== undefined) {
        for (const message of opened.errors) fail(where, `perf ${name}: page error: ${message}`);
        await opened.context.close();
      }
    }
  }

  // 1. The chord to the second frame after the dialog is in the DOM.
  await section('open', production.origin, 'perf', { init: script(openClock) }, async (page) => {
    const chord = await chordOf(page);
    for (let index = 0; index < OPENS; index += 1) {
      await page.keyboard.press(chord);
      await page.waitForFunction((count) => window.__open.samples.length >= count, index + 1, { timeout: WAIT });
      await sleep(GAP);
      await page.keyboard.press(chord);
      await page.waitForFunction(noDialog, null, { timeout: WAIT });
      await sleep(GAP);
    }

    const samples = await page.evaluate(() => window.__open.samples);
    const times = samples.map(({ from, at }) => (from === null ? Number.NaN : at - from));
    const bad = times.filter((time) => !Number.isFinite(time) || time <= 0);
    if (bad.length > 0) fail(where, `perf open: ${bad.length} of ${times.length} samples have no usable keydown time stamp (${JSON.stringify(samples.slice(0, 2))}): event.timeStamp is not on performance.now()'s clock here`);
    result.open = {
      ...summary(times.filter((time) => Number.isFinite(time))),
      first: round(times[0]),
      measure: 'keydown event.timeStamp of the chord to the second requestAnimationFrame callback after dialog[open] is in the DOM (a proxy for first paint)',
    };
  });

  // 2. A key press to the rows painted, with the thousand rows registered.
  await section('keystroke', production.origin, 'perf', { init: script(keyClock) }, async (page) => {
    await page.keyboard.press(await chordOf(page));
    await page.waitForSelector('dialog[open]', { timeout: WAIT });
    await sleep(400);
    const samples = [];
    const press = async (phase, key, want) => {
      await page.evaluate((text) => window.__ksArm(text), want);
      await page.keyboard.press(key);
      try {
        await page.waitForFunction(() => window.__ks.record.t1 !== null, null, { timeout: WAIT });
      } catch (error) {
        const seen = await page.evaluate((text) => window.__ksShown(text).state, want);
        throw new Error(`${phase} "${key}": the DOM never showed what the model holds (${JSON.stringify(seen)}): ${firstLine(error)}`);
      }

      const record = await page.evaluate(() => window.__ks.record);
      samples.push({ phase, key, ms: record.t1 - record.t0, dom: record.dom === null ? null : record.dom - record.t0, rows: record.rows, total: record.total, query: record.query });
      await sleep(GAP);
    };

    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
      for (let index = 0; index < TYPED.length; index += 1) await press('typing', keyName(TYPED[index]), TYPED.slice(0, index + 1));
      for (let index = 0; index < TYPED.length; index += 1) await press('backspace', 'Backspace', TYPED.slice(0, TYPED.length - 1 - index));
      // The model clears the input between the repetitions, as a person's Select all and Delete would.
      await page.evaluate(() => window.__palette.setQuery(''));
      await sleep(GAP);
    }

    for (const sample of samples) {
      if (!Number.isFinite(sample.ms) || sample.ms <= 0) fail(where, `perf keystroke: ${sample.phase} "${sample.key}" has no usable time (${sample.ms}): event.timeStamp is not on performance.now()'s clock here`);
      const trimmed = (sample.query ?? '').trim();
      if (trimmed !== '' && MATCHING.startsWith(trimmed) && sample.rows < 1) fail(where, `perf keystroke: ${sample.phase} "${sample.key}": the palette showed no rows for "${sample.query}"`);
      if (sample.total > MAX_TOTAL) fail(where, `perf keystroke: ${sample.phase} "${sample.key}": the model counted ${sample.total} results for "${sample.query}", wanted at most ${MAX_TOTAL}`);
    }

    const times = samples.map((sample) => sample.ms);
    const slowest = samples.reduce((worst, sample) => (sample.ms > worst.ms ? sample : worst), samples[0]);
    const part = (phase) => {
      const { p50, p95 } = summary(samples.filter((sample) => sample.phase === phase).map((sample) => sample.ms));
      return { p50, p95 };
    };
    const all = summary(times);
    const dom = summary(samples.map((sample) => sample.dom).filter((time) => time !== null && Number.isFinite(time)));
    result.keystroke = {
      p50: all.p50,
      p95: all.p95,
      max: all.max,
      samples: all.samples,
      typing: part('typing'),
      backspace: part('backspace'),
      slowest: { phase: slowest.phase, key: slowest.key, query: slowest.query, rows: slowest.rows, ms: round(slowest.ms) },
      // What the key cost before any frame: its keydown to the end of its input event, when the model had the text and the tree was committed.
      dom: { p50: dom.p50, p95: dom.p95, max: dom.max, samples: dom.samples },
      // How many rows the palette showed for each query (a list with no rows is cheaper to draw than one with fifty).
      rows: Object.fromEntries(samples.map((sample) => [sample.query, sample.rows])),
    };
  });

  // 3. The commits of a key press, in React's development build (the Profiler calls its callback there and not in a production build).
  if (development === null || development === undefined) {
    result.commits = null;
  } else {
    await section('commits', development.origin, 'perf', {}, async (page) => {
      const count = () => page.evaluate(() => window.__commits.length);
      const queryNow = () => page.evaluate(() => window.__palette.getSnapshot().query);
      const before = await count();
      await page.keyboard.press(await chordOf(page));
      await page.waitForSelector('dialog[open]', { timeout: WAIT });
      await sleep(400);
      if ((await count()) <= before) fail(where, 'perf commits: opening the palette made no commit the profiler saw: the development build is not reporting commits');
      const presses = [];
      const press = async (label, key) => {
        const [c0, q0] = [await count(), await queryNow()];
        await page.keyboard.press(key);
        await sleep(COMMIT_WINDOW);
        const [c1, q1] = [await count(), await queryNow()];
        presses.push({ label, commits: c1 - c0, changed: q0 !== q1 });
        await sleep(COMMIT_GAP - COMMIT_WINDOW);
      };

      for (const character of TYPED) await press(`type "${character}"`, keyName(character));
      await press('ArrowDown', 'ArrowDown');
      for (let index = 0; index < TYPED.length; index += 1) await press('Backspace', 'Backspace');
      for (const { label, commits, changed } of presses) {
        if (commits > 1) fail(where, `perf commits: ${label} made ${commits} commits (the query ${changed ? 'changed' : 'did not change'}), wanted at most 1`);
        // A key that did not change the query was lost, and a lost key makes no commit: it must not pass as one that made none.
        else if (label !== 'ArrowDown' && !changed) fail(where, `perf commits: ${label} did not change the query, so its commit count says nothing`);
        else if (label !== 'ArrowDown' && commits !== 1) fail(where, `perf commits: ${label} made ${commits} commits, wanted 1`);
      }

      result.commits = Math.max(...presses.map((press) => press.commits));
    });
  }

  // 4. Nothing outside the palette moves while it is used. The sampler is told to watch the Search control as well as the window's regions, and to keep sampling longer than its default.
  await section('shift', production.origin, 'perf', { init: `window.__probeParts = ['search']; window.__probeFrames = 600; ${SAMPLER}` }, async (page) => {
    // The sampler has watched the window since its first frame. What it saw up to the chord is the window loading and its fonts settling (normalizeFont's own swap shifts a sub-pixel): not the palette's.
    const before = await page.evaluate(() => ({
      frames: window.__probe.frames,
      layoutShift: window.__probe.layoutShift,
      sources: window.__probe.shiftSources.slice(),
      // The harness reads 0 where the engine has no layout-shift observer (it only reads null where there is no PerformanceObserver): that 0 is not a measurement.
      observed: typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes ?? []).includes('layout-shift'),
    }));
    await page.keyboard.press(await chordOf(page));
    await page.waitForSelector('dialog[open]', { timeout: WAIT });
    await sleep(GAP);
    await page.keyboard.type('alpha', { delay: GAP });
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press('ArrowDown');
      await sleep(GAP);
    }

    await page.keyboard.press('Escape');
    await page.waitForFunction(noDialog, null, { timeout: WAIT });
    await sleep(1500);
    const probe = await page.evaluate(() => ({ ...window.__probe }));
    const moves = probe.moves.filter((move) => move.frame > before.frames);
    const gone = probe.gone.filter((entry) => entry.frame > before.frames);
    const layoutShift = before.observed && probe.layoutShift !== null ? probe.layoutShift - (before.layoutShift ?? 0) : null;
    result.shift = { moves: moves.length, layoutShift, frames: probe.frames };
    if (probe.moves.length > moves.length || probe.gone.length > gone.length || (before.layoutShift ?? 0) !== 0) {
      result.shift.beforeTheChord = { moves: probe.moves.length - moves.length, gone: probe.gone.length - gone.length, layoutShift: before.observed ? before.layoutShift : null, shiftSources: before.sources };
    }

    if (probe.seen.search === undefined) fail(where, 'perf shift: the sampler never found the Search control ([data-shell-part="search"]): nothing was watched there');
    if (probe.frames >= 600) fail(where, "perf shift: the sampler stopped at its 600 frames before the end of the palette's use: the last of it was not watched");
    if (moves.length > 0) fail(where, `perf shift: ${moves.length} moves outside the palette: ${JSON.stringify(moves.slice(0, 4))}`);
    if (gone.length > 0) fail(where, `perf shift: ${gone.length} regions left the DOM: ${JSON.stringify(gone.slice(0, 4))}`);
    if (layoutShift !== null && layoutShift !== 0) fail(where, `perf shift: layout shift ${layoutShift} while the palette was used (sources: ${JSON.stringify(probe.shiftSources.slice(before.sources.length, before.sources.length + 6))})`);
  });

  // 5. A closed palette costs nothing: what the page holds and has outstanding, before it is used and after, and what runs while it is closed.
  await section('closed', production.origin, 'geometry', { init: script(watch), fonts: false }, async (page) => {
    await sleep(800);
    const idle = async () => {
      const start = await page.evaluate(() => window.__watch.now());
      const before = await page.evaluate(() => window.__watch.ran().count);
      await sleep(IDLE);
      const after = await page.evaluate(() => window.__watch.ran());
      return { count: after.count - before, log: after.log.filter((entry) => entry.at >= start) };
    };
    const kinds = ['timeouts', 'intervals', 'frames', 'idles'];
    const outstanding = (snapshot) => Object.fromEntries(kinds.map((kind) => [kind, snapshot[kind].length]));
    const describe = (entry) => `${entry.id === undefined ? entry.kind : `#${entry.id}`} ${entry.delay} ms ${entry.stack === '' ? '(no stack)' : entry.stack.slice(0, 220)}`;
    // The wrappers are tried on the page first: a page that holds nothing must be a page that holds nothing, not wrappers that see nothing.
    for (const problem of await page.evaluate(() => window.__watch.selfTest())) fail(where, `perf closed: the instrumentation is wrong: ${problem}`);

    const quiet = await idle();
    const base = await page.evaluate(() => window.__watch.snapshot());
    if (base.held.length === 0) fail(where, 'perf closed: the instrumentation saw no registration on the window or the document: it is not wrapping the page\'s calls');
    const chord = await chordOf(page);
    await page.keyboard.press(chord);
    await page.waitForSelector('dialog[open]', { timeout: WAIT });
    await sleep(150);
    await page.keyboard.type('alpha', { delay: 80 });
    await sleep(150);
    for (let index = 0; index < 2; index += 1) {
      await page.keyboard.press('ArrowDown');
      await sleep(100);
    }

    const whileOpen = await page.evaluate(() => window.__watch.snapshot());

    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog[open]', { state: 'detached', timeout: WAIT });
    await sleep(AFTER_CLOSE);
    const after = await page.evaluate(() => window.__watch.snapshot());
    const quietAfter = await idle();

    // What is held: the same registrations, by target, type, phase and listener.
    const heldBase = new Map(base.held.map((entry) => [entry.key, entry]));
    const heldAfter = new Map(after.held.map((entry) => [entry.key, entry]));
    const added = [...heldAfter.values()].filter((entry) => !heldBase.has(entry.key));
    const removed = [...heldBase.values()].filter((entry) => !heldAfter.has(entry.key));
    const show = (entry) => `${entry.key} ${entry.source}`;
    if (added.length > 0) fail(where, `perf closed: ${added.length} registrations on the window or the document that the palette left behind: ${added.map(show).join('; ')}`);
    if (removed.length > 0) fail(where, `perf closed: ${removed.length} registrations on the window or the document that were there before the palette was used and are gone: ${removed.map(show).join('; ')}`);

    // What is outstanding: no more of each kind than before, and none that the palette started (the stacks name it where the build keeps names).
    const idsBase = new Set(kinds.flatMap((kind) => base[kind].map((entry) => `${kind}:${entry.id}`)));
    const started = kinds.flatMap((kind) => after[kind].filter((entry) => !idsBase.has(`${kind}:${entry.id}`)).map((entry) => ({ kind, ...entry })));
    const paletteOwn = started.filter((entry) => /palette/i.test(entry.stack.replace(/\bhttps?:\/\/[^\s)]+/g, '')));
    const before = outstanding(base);
    const left = outstanding(after);
    for (const kind of kinds) {
      if (left[kind] > before[kind]) fail(where, `perf closed: ${left[kind]} ${kind} outstanding after the palette was used and closed, ${before[kind]} before: ${started.filter((entry) => entry.kind === kind).map(describe).join('; ')}`);
    }

    if (paletteOwn.length > 0) fail(where, `perf closed: ${paletteOwn.length} timers or frames that the palette started are outstanding after it closed: ${paletteOwn.map(describe).join('; ')}`);

    // What runs while it is closed: nothing, before it was ever opened and after it has been used.
    if (quiet.count !== 0) fail(where, `perf closed: ${quiet.count} timer or frame callbacks ran in ${IDLE} ms while the palette had never been opened: ${quiet.log.slice(0, 4).map(describe).join('; ')}`);
    if (quietAfter.count !== 0) fail(where, `perf closed: ${quietAfter.count} timer or frame callbacks ran in ${IDLE} ms after the palette was used and closed: ${quietAfter.log.slice(0, 4).map(describe).join('; ')}`);

    // The window's keydown captures: the palette's is the one that takes the chord (the kit's tooltips hold another, for Escape).
    const captures = base.held.filter((entry) => entry.kind === 'window' && entry.type === 'keydown' && entry.capture);
    const chordCaptures = await page.evaluate((mac) => window.__watch.chordListeners(mac), chord === 'Meta+k');
    if (chordCaptures.length !== 1) fail(where, `perf closed: ${chordCaptures.length} keydown captures on the window take the chord, wanted exactly 1 (the palette's); the window holds ${captures.length}: ${captures.map(show).join('; ')}`);

    result.closed = {
      listenersHeld: base.held.length,
      timersOutstanding: { before, after: left },
      callbacksRan: quiet.count,
      windowKeydownCaptures: chordCaptures.length,
      windowKeydownCapturesAll: captures.length,
      callbacksRanAfterUse: quietAfter.count,
      listenersHeldAfterUse: after.held.length,
      // What the palette holds while it is open (the registrations it adds on the window and the document, and its timers and frames), for the one who reads the rest.
      whileOpen: { listeners: whileOpen.held.filter((entry) => !heldBase.has(entry.key)).length, ...outstanding(whileOpen) },
    };
  });
}

// What the person's settings do to a terminal that is open: the cursor's blink, the scrollback, Option as Meta and the bell (issue #697 steps 2 and 3), in real browsers, in both engines at both viewports, over the REAL emulator. The
// far end is the probe's own host (terminal-host.mjs, its synthetic shell, whose log holds the bytes the shell received); the settings are the fixture's (`?prefs=1`: `window.__prefs.set(...)` is one event of the host's
// `settings/changed`). The shell is synthetic here: the REAL bash and its readline (Alt+B moves a word) are the seam's (`terminal-programs`, `ui-next/plugins/e2e/seam.check.mjs`).
//   apply-blink       the blink of the cursor is a timer ONLY with the focus and the setting both (apply.blink): the live timers of the page are counted (a wrapper of setTimeout and setInterval, installed before the page's own
//                     scripts), never a time: with the setting on and no focus, with it off and the focus, and after each change, the count is what it is with no blink; with both there is one more
//   apply-scrollback  a smaller scrollback trims the oldest lines of the terminal that is open and a larger one keeps what is left (apply.scrollback): the first line the terminal holds is read through the keyboard's own
//                     scrolling, in lines
//   apply-meta        Option as Meta on a Mac (the page says `MacIntel` before its scripts run: the emulator reads it once): `on` sends ESC b for Option B and types no character, `off` types the character and sends no ESC, and `auto`
//                     follows the keyboard's layout map (a US layout is Meta; AZERTY, and a browser with no map, are not) (apply.meta-on, apply.meta-off, apply.meta-auto, apply.meta-live)
//   apply-bell        a bell in a terminal that is shown fades its screen and marks no tab; one in a terminal that is not shown puts a mark on its tab, in the tab's accessible name, and the mark ends when the tab is shown; with
//                     the setting off nothing happens; nothing beeps (apply.bell-visual, apply.bell-mark, apply.bell-off, apply.bell-silent)
// Every section waits for a state and never for a time. A control plants one fault in the page.
import { createHost } from './terminal-host.mjs';
import { serveContext } from './terminal-serve.mjs';

const MAC = () => {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel', configurable: true });
};
const LINUX = () => {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64', configurable: true });
};

/** What the sections read of the page, in the page, in one task. */
const HELPERS = () => {
  const apply = (window.__apply = {});
  // The timers the page has live: a wrapper of the four calls, installed before any script of the page. A timer is live from its call until it fires (a timeout) or is cleared.
  const live = new Set();
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  window.setTimeout = (callback, delay, ...rest) => {
    const id = nativeSetTimeout((...args) => {
      live.delete(id);
      if (typeof callback === 'function') callback(...args);
    }, delay, ...rest);
    live.add(id);
    return id;
  };
  window.setInterval = (callback, delay, ...rest) => {
    const id = nativeSetInterval(callback, delay, ...rest);
    live.add(id);
    return id;
  };
  window.clearTimeout = (id) => {
    live.delete(id);
    nativeClearTimeout(id);
  };
  window.clearInterval = (id) => {
    live.delete(id);
    nativeClearInterval(id);
  };
  /** What the blink costs: the live timers of the page (the GPU's renderer blinks with a timer) and the running animations inside an emulator (the DOM renderer blinks with a CSS animation, which is work for every frame as a timer is). */
  apply.timers = () => live.size + document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.target?.closest?.('.xterm') !== null && animation.effect?.target?.closest?.('.xterm') !== undefined).length;
  /** The frames the page has drawn since this was asked: a count, the unit of every wait of the blink. */
  apply.frames = (count) =>
    new Promise((resolve) => {
      let left = count;
      const step = () => {
        left -= 1;
        if (left <= 0) resolve(count);
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  /** The emulator that is shown: a terminal that is not shown is in the page too, with no box. */
  apply.shown = () => [...document.querySelectorAll('.xterm')].find((element) => element.getClientRects().length > 0);
  apply.rows = () => [...(apply.shown()?.querySelectorAll('.xterm-rows > div') ?? [])].map((row) => (row.textContent ?? '').replaceAll('\u00a0', ' ').trimEnd()).join('\n');
  apply.focused = () => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false;
  apply.blur = () => apply.shown()?.querySelector('.xterm-helper-textarea')?.blur();
  apply.focus = () => apply.shown()?.querySelector('.xterm-helper-textarea')?.focus();
  /** What a person who presses Option B on a Mac sends to the emulator: the keydown (Option makes the key's character `ƒ`; the physical key is B, key code 66), and the character the browser inserts when nobody took the key. */
  apply.optionB = () => {
    const input = apply.shown()?.querySelector('.xterm-helper-textarea');
    const event = new KeyboardEvent('keydown', { key: 'ƒ', code: 'KeyB', keyCode: 66, which: 66, altKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    if (!event.defaultPrevented) {
      // Nobody took the key: the browser makes the character of it (a keypress for `ƒ`, U+0192) and the emulator sends it.
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'ƒ', code: 'KeyB', charCode: 0x192, keyCode: 0x192, which: 0x192, altKey: true, bubbles: true, cancelable: true }));
    }

    return event.defaultPrevented;
  };
  /** The element the screen fades (the emulator's host: it holds `data-bell`, a name for each bell). */
  apply.screenHost = () => apply.shown()?.parentElement ?? null;
  apply.bellState = () => apply.screenHost()?.getAttribute('data-bell') ?? null;
  apply.tabs = () => [...document.querySelectorAll('[data-shell-part="sessionTabs"] [role="tab"]')].map((tab) => ({ label: tab.getAttribute('aria-label') ?? '', mark: tab.querySelector('[data-shell-part="sessionMark"]') !== null, selected: tab.getAttribute('aria-selected') === 'true' }));
  /** Whatever the page made that could make a sound: an audio context or an audio element asked to play. */
  apply.sounds = 0;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Native = window[name];
    if (Native === undefined) continue;
    window[name] = class extends Native {
      constructor(...args) {
        super(...args);
        apply.sounds += 1;
      }
    };
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    apply.sounds += 1;
    return play.apply(this, args);
  };
};

/** The keyboard map of a layout, as `navigator.keyboard.getLayoutMap()` answers it (Chromium): only the keys on which layouts differ. */
const MAPS = {
  us: { KeyQ: 'q', KeyW: 'w', KeyA: 'a', KeyZ: 'z', KeyM: 'm', Semicolon: ';', Quote: '\'', Backquote: '`', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/' },
  azerty: { KeyQ: 'a', KeyW: 'z', KeyA: 'q', KeyZ: 'w', KeyM: ',', Semicolon: 'm', Quote: 'ù', Backquote: '²', BracketLeft: '^', BracketRight: '$', Backslash: '*', Minus: ')', Equal: '=', Comma: ';', Period: ':', Slash: '!' },
};

/** The page's keyboard API: a map (`us`, `azerty`), or none at all (WebKit's WKWebView has none). */
const layoutScript = (name) => {
  if (name === 'none') {
    return () => {
      Object.defineProperty(Navigator.prototype, 'keyboard', { get: () => undefined, configurable: true });
    };
  }

  return (map) => {
    Object.defineProperty(Navigator.prototype, 'keyboard', { get: () => ({ getLayoutMap: async () => new Map(Object.entries(map)) }), configurable: true });
  };
};

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const APPLY_PARTS = {
  apply: ['apply-blink', 'apply-scrollback', 'apply-meta', 'apply-bell'],
};

/** The negative controls: a fault of the page (`init` before the page's scripts, `after` at the `stage` the section names). Each is seen by the assertion it is named for, and by that one. */
export const APPLY_CONTROLS = {
  // A timer is left running while the terminal has no focus: the count is one more than with no blink.
  'apply-blink-unfocused': {
    assertion: 'apply.blink',
    section: 'apply-blink',
    stage: 'unfocused',
    after: (page) => page.evaluate(() => window.setInterval(() => undefined, 60_000)),
  },
  // A timer is left running while the setting is off and the terminal has the focus.
  'apply-blink-off': {
    assertion: 'apply.blink',
    section: 'apply-blink',
    stage: 'off',
    after: (page) => page.evaluate(() => window.setInterval(() => undefined, 60_000)),
  },
  // The page hears no event of the host: a scrollback changed is a scrollback the terminal never sees.
  'apply-scrollback-not-live': {
    assertion: 'apply.scrollback',
    section: 'apply-scrollback',
    stage: 'ready',
    after: (page) => page.evaluate(() => {
      const prefs = window.__prefs;
      prefs.set = (next) => {
        prefs.values = { ...prefs.values, ...next };
        prefs.events += 1;
      };
    }),
  },
  // Option as Meta changed while the terminal is open is never heard.
  'apply-meta-not-live': {
    assertion: 'apply.meta-live',
    section: 'apply-meta',
    stage: 'ready',
    after: (page) => page.evaluate(() => {
      const prefs = window.__prefs;
      prefs.set = (next) => {
        prefs.values = { ...prefs.values, ...next };
        prefs.events += 1;
      };
    }),
  },
  // The page says a US layout whatever the keyboard is: `auto` makes Option Meta on AZERTY.
  'apply-meta-layout-wrong': {
    assertion: 'apply.meta-auto',
    section: 'apply-meta',
    layout: 'us-for-all',
  },
  // The mark of a bell that rang in a terminal that is not shown is gone.
  'apply-bell-mark-lost': {
    assertion: 'apply.bell-mark',
    section: 'apply-bell',
    stage: 'marked',
    after: (page) => page.evaluate(() => {
      // Not removed (React owns the node): the part it is found by is renamed.
      for (const mark of document.querySelectorAll('[data-shell-part="sessionMark"]')) mark.setAttribute('data-shell-part', 'gone');
    }),
  },
  // The mark stays after the terminal is shown.
  'apply-bell-mark-stuck': {
    assertion: 'apply.bell-mark',
    section: 'apply-bell',
    stage: 'shown',
    after: (page) => page.evaluate(() => {
      const tab = document.querySelector('[data-shell-part="sessionTabs"] [role="tab"]');
      const mark = document.createElement('span');
      mark.dataset.shellPart = 'sessionMark';
      mark.dataset.planted = '';
      tab.append(mark);
    }),
    // The planted mark is taken away again once the check has seen it, so that the checks after it are what they are without it.
    undo: (page) => page.evaluate(() => document.querySelector('[data-planted]')?.remove()),
  },
  // The screen fades for a bell although the setting is off.
  'apply-bell-off-fades': {
    assertion: 'apply.bell-off',
    section: 'apply-bell',
    stage: 'off',
    after: (page) => page.evaluate(() => window.__apply.screenHost()?.setAttribute('data-bell', 'x')),
  },
  // The page makes a sound for a bell.
  'apply-bell-beeps': {
    assertion: 'apply.bell-silent',
    section: 'apply-bell',
    stage: 'shown',
    after: (page) => page.evaluate(() => {
      const Context = window.AudioContext ?? window.webkitAudioContext;
      new Context().close();
    }),
  },
};

/**
 * @param {{ check: Function, note: Function, report: { numbers: Record<string, unknown> } }} deps
 */
export function createApplySections({ check, note, report }) {
  const sections = {};
  const perturb = async (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

  /** A page of the fixture against the probe's host, with the settings the fixture holds, the platform (`mac` makes the page say MacIntel before its scripts: the emulator reads it once) and the keyboard's layout; the shell starts. */
  async function open(ctx, { initial = {}, mac = false, layout, sessions = 1 } = {}) {
    const { browser, origin, viewport, control } = ctx;
    const host = createHost({ ...control?.host?.options, faults: { ...control?.host?.faults } });
    const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
    const served = await serveContext(context, host);
    const close = async () => {
      host.stop();
      await served.close();
      await context.close();
    };

    try {
      await context.addInitScript(HELPERS);
      await context.addInitScript((values) => {
        window.__prefsInitial = values;
      }, initial);
      await context.addInitScript(mac ? MAC : LINUX);
      const shown = control?.layout === 'us-for-all' ? 'us' : layout;
      if (shown !== undefined) {
        if (shown === 'none') await context.addInitScript(layoutScript('none'));
        else await context.addInitScript(layoutScript(shown), MAPS[shown]);
      }

      if (control?.init !== undefined) await context.addInitScript(control.init);
      const page = await context.newPage();
      await page.goto(`${origin}/shell/probes/terminal-fixture.html?host=shared&renderer=dom&prefs=1`, { waitUntil: 'load' });
      await page.waitForSelector('[data-shell-part="window"]');
      await page.click('[data-shell-part="panelToggle"]');
      await page.waitForSelector('[data-shell-part="panelEmpty"]');
      await page.click('[data-shell-part="panelEmpty"] button');
      for (let made = 1; made < sessions; made += 1) {
        await page.waitForFunction((count) => document.querySelectorAll('[data-shell-part="sessionTabs"] [role="tab"]').length >= count && /user@synthetic/.test(document.querySelector('.xterm-rows')?.textContent ?? ''), made, { timeout: 30_000 });
        await page.click('[data-shell-part="sessionAdd"] button');
      }

      await page.waitForSelector('.xterm-helper-textarea', { state: 'attached', timeout: 30_000 });
      await page.waitForFunction((count) => document.querySelectorAll('[data-shell-part="sessionTabs"] [role="tab"]').length >= count && /user@synthetic/.test(document.querySelector('.xterm-rows')?.textContent ?? ''), sessions, { timeout: 30_000 });
      await page.evaluate(() => window.__apply.focus());
      return { page, host, close };
    } catch (error) {
      await close().catch(() => undefined);
      throw error;
    }
  }

  const change = (page, values) => page.evaluate((next) => window.__prefs.set(next), values);

  /** A bounded wait for something the page or the host's log shows: the answer is whether it came. */
  const until = async (done, ms = 15_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await done()) return true;
      if (Date.now() > deadline) return false;
      await sleep(50);
    }
  };

  // ------------------------------------------------------------------------------------------------ apply-blink
  sections['apply-blink'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page } = session;
    try {
      // The count once it has settled: the same twice, 15 frames apart (a timer the emulator asks for when it takes the focus, an animation that ends, are not what a terminal holds at rest).
      const count = async () => {
        let last = -1;
        for (let turn = 0; turn < 40; turn += 1) {
          await page.evaluate(() => window.__apply.frames(15));
          const now = await page.evaluate(() => window.__apply.timers());
          if (now === last) return now;
          last = now;
        }

        return last;
      };

      const problems = [];
      // The setting is off (the default) and the terminal has the focus: the count of a terminal at rest.
      await page.evaluate(() => window.__apply.focus());
      const rest = await count();
      await perturb(ctx, page, 'off');
      const off = await count();
      if (off !== rest) problems.push(`with the blink off and the focus, ${String(off)} live timers, not the ${String(rest)} of a terminal at rest`);

      // On, with the focus: the blink is a timer.
      await change(page, { blinkingCursor: true });
      const focusedOn = await count();
      if (focusedOn <= rest) problems.push(`with the blink on and the focus, ${String(focusedOn)} live timers, not more than the ${String(rest)} at rest: nothing blinks`);

      // On, without the focus: no timer.
      await page.evaluate(() => window.__apply.blur());
      await perturb(ctx, page, 'unfocused');
      const unfocused = await count();
      if (unfocused !== rest) problems.push(`with the blink on and no focus, ${String(unfocused)} live timers, not the ${String(rest)} of a terminal at rest`);

      // The focus comes back: the blink is back. Off again, with the focus: no timer.
      await page.evaluate(() => window.__apply.focus());
      const again = await count();
      if (again <= rest) problems.push(`the focus came back with the blink on and ${String(again)} live timers, not more than the ${String(rest)} at rest: nothing blinks`);
      await change(page, { blinkingCursor: false });
      const turnedOff = await count();
      if (turnedOff !== rest) problems.push(`the blink turned off with the focus: ${String(turnedOff)} live timers, not the ${String(rest)} of a terminal at rest`);

      check('apply.blink', problems.length === 0, `${tag}: the live timers of the page, counted after 20 frames: ${problems.length === 0 ? `${String(rest)} at rest, ${String(off)} off with the focus, ${String(focusedOn)} on with the focus, ${String(unfocused)} on with no focus, ${String(turnedOff)} off again` : problems.join('; ')}`);
      report.numbers[`apply-blink ${tag}`] = { rest, off, focusedOn, unfocused, turnedOff };
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ apply-scrollback
  /** The number of the first `dense` line the terminal holds (`NNNNN needle` rows), after the keyboard has taken the viewport to the top: the keyboard's own scrolling, until a press changes nothing for three presses in a row. */
  async function firstLine(page) {
    await page.locator('.xterm-helper-textarea').focus();
    let last = '';
    let still = 0;
    for (let press = 0; press < 400 && still < 3; press += 1) {
      await page.keyboard.press('Shift+PageUp');
      await page.evaluate(() => window.__apply.frames(2));
      const top = await page.evaluate(() => window.__apply.rows().split('\n')[0] ?? '');
      still = top === last ? still + 1 : 0;
      last = top;
    }

    // The first of the numbered lines on the screen: above it there may be the shell's banner and the command.
    const first = (await page.evaluate(() => window.__apply.rows().split('\n').find((row) => /^\d{5} needle/.test(row)) ?? '')) || last;
    const found = /^(\d{5}) needle/.exec(first);
    return found === null ? -1 : Number(found[1]);
  }

  sections['apply-scrollback'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page } = session;
    try {
      await page.keyboard.type('dense 400 1');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /00399 needle/.test(window.__apply.rows()), null, { timeout: 30_000 });
      await perturb(ctx, page, 'ready');
      const rows = await page.evaluate(() => window.__apply.shown().querySelectorAll('.xterm-rows > div').length);
      const before = await firstLine(page);
      await change(page, { scrollback: 60 });
      const after = await firstLine(page);
      // The terminal holds 60 lines above the screen and the screen: the lines from the first it holds to 399 are at most 60 + rows (the prompt takes the last row or two) and at least 60.
      const held = 399 - after + 1;
      await change(page, { scrollback: 2000 });
      const grown = await firstLine(page);
      const problems = [];
      if (before !== 0) problems.push(`before the change the first line was ${String(before)}, not 0: the probe cannot read the scrollback`);
      if (after < 0 || held > 60 + rows || held < 60) problems.push(`with a scrollback of 60 the terminal holds ${String(held)} of the lines (first ${String(after)}), not 60 above a screen of ${String(rows)} rows`);
      if (grown !== after) problems.push(`a larger scrollback changed the first line from ${String(after)} to ${String(grown)}: the lines that were trimmed are not back, and the others are all there`);
      check('apply.scrollback', problems.length === 0, `${tag}: 400 lines in a scrollback of 5000, then 60, then 2000: ${problems.length === 0 ? `the first line is ${String(before)}, then ${String(after)} (${String(held)} lines held above and on a screen of ${String(rows)} rows), then ${String(grown)}` : problems.join('; ')}`);
      report.numbers[`apply-scrollback ${tag}`] = { before, after, grown, held, rows };
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ apply-meta
  /** Presses Option B as a Mac does, and what the shell received since: ESC b, a character, or nothing. */
  async function optionB(page, host) {
    const from = host.log.writes.length;
    await page.evaluate(() => window.__apply.optionB());
    await until(() => host.log.writes.length > from, 5_000);
    return host.log.writes.slice(from).map((write) => write.data).join('');
  }

  sections['apply-meta'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const ESC_B = '\u001bb';
    const seen = (text) => (text.includes(ESC_B) ? 'ESC b' : text.includes('ƒ') ? 'the character' : JSON.stringify(text));

    // The person's word: on is Meta whatever the keyboard is, off types the character.
    const onSession = await open(ctx, { mac: true, initial: { macOptionIsMeta: 'on' }, layout: 'azerty' });
    let onGot;
    let liveOff;
    let liveOn;
    try {
      await perturb(ctx, onSession.page, 'ready');
      onGot = await optionB(onSession.page, onSession.host);
      // Live: the setting changes while the terminal is open, and the next Option B is what the new setting says.
      await change(onSession.page, { macOptionIsMeta: 'off' });
      await onSession.page.evaluate(() => window.__apply.frames(5));
      liveOff = await optionB(onSession.page, onSession.host);
      await change(onSession.page, { macOptionIsMeta: 'on' });
      await onSession.page.evaluate(() => window.__apply.frames(5));
      liveOn = await optionB(onSession.page, onSession.host);
    } finally {
      await onSession.close();
    }

    const offSession = await open(ctx, { mac: true, initial: { macOptionIsMeta: 'off' }, layout: 'us' });
    let offGot;
    try {
      offGot = await optionB(offSession.page, offSession.host);
    } finally {
      await offSession.close();
    }

    check('apply.meta-on', onGot === ESC_B, `${tag}: Option B on a Mac with Option as Meta on (and an AZERTY keyboard): ${onGot === ESC_B ? 'the shell received ESC b and no character' : `the shell received ${seen(onGot)}, not ESC b alone`}`);
    check('apply.meta-off', offGot === 'ƒ', `${tag}: Option B on a Mac with Option as Meta off (and a US keyboard): ${offGot === 'ƒ' ? 'the shell received the character and no ESC' : `the shell received ${seen(offGot)}, not the character alone`}`);
    check('apply.meta-live', liveOff === 'ƒ' && liveOn === ESC_B, `${tag}: Option as Meta changed while the terminal is open: ${liveOff === 'ƒ' && liveOn === ESC_B ? 'off typed the character, and on again sent ESC b' : `off gave ${seen(liveOff)} and on gave ${seen(liveOn)}`}`);

    // auto: the keyboard's layout map.
    const autos = {};
    for (const layout of ['us', 'azerty', 'none']) {
      const session = await open(ctx, { mac: true, initial: { macOptionIsMeta: 'auto' }, layout });
      try {
        autos[layout] = await optionB(session.page, session.host);
      } finally {
        await session.close();
      }
    }

    const wanted = { us: ESC_B, azerty: 'ƒ', none: 'ƒ' };
    const wrong = Object.keys(wanted).filter((layout) => autos[layout] !== wanted[layout]);
    check('apply.meta-auto', wrong.length === 0, `${tag}: Option B with Option as Meta on auto: ${wrong.length === 0 ? 'a US layout is Meta (ESC b), AZERTY and a browser with no keyboard map type the character' : wrong.map((layout) => `${layout} gave ${seen(autos[layout])}, not ${seen(wanted[layout])}`).join('; ')}`);
    report.numbers[`apply-meta ${tag}`] = { on: seen(onGot), off: seen(offGot), liveOff: seen(liveOff), liveOn: seen(liveOn), auto: Object.fromEntries(Object.entries(autos).map(([layout, got]) => [layout, seen(got)])) };
    void note;
  };

  // ------------------------------------------------------------------------------------------------ apply-bell
  sections['apply-bell'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx, { sessions: 2 });
    const { page, host } = session;
    try {
      const typed = async (line) => {
        await page.evaluate(() => window.__apply.focus());
        await page.keyboard.type(line);
        await page.keyboard.press('Enter');
      };

      // The second terminal is the one shown; the first ran a program that rings after 400 ms, and is not shown.
      const selectTab = async (index) => {
        await page.locator('[data-shell-part="sessionTabs"] [role="tab"]').nth(index).click();
        await page.waitForFunction((at) => window.__apply.tabs()[at]?.selected === true, index, { timeout: 10_000 });
      };

      await selectTab(0);
      await typed('bell-later 400');
      await selectTab(1);
      const marked = await until(async () => (await page.evaluate(() => window.__apply.tabs()))[0]?.mark === true);
      await perturb(ctx, page, 'marked');
      const tabs = await page.evaluate(() => window.__apply.tabs());
      const problems = [];
      if (!marked) problems.push('a bell rang in the terminal that is not shown and its tab has no mark');
      if (marked && tabs[0]?.mark !== true) problems.push('the mark of the tab is gone while the bell is still unseen');
      if (!/bell rang/.test(tabs[0]?.label ?? '')) problems.push(`the tab's name is ${JSON.stringify(tabs[0]?.label)}: it does not say a bell rang`);
      if (tabs[1]?.mark === true || /bell/.test(tabs[1]?.label ?? '')) problems.push('the terminal that is shown has a mark');
      await selectTab(0);
      const cleared = await until(async () => (await page.evaluate(() => window.__apply.tabs()))[0]?.mark === false);
      await perturb(ctx, page, 'shown');
      const after = await page.evaluate(() => window.__apply.tabs());
      if (!cleared || after[0]?.mark || /bell/.test(after[0]?.label ?? '')) problems.push(`the mark is still on the tab after the terminal was shown (${JSON.stringify(after[0])})`);
      if (ctx.control?.stage === 'shown') await ctx.control.undo?.(page);
      check('apply.bell-mark', problems.length === 0, `${tag}: a bell in the terminal that is not shown: ${problems.length === 0 ? 'its tab has a mark and says "bell rang" in its name, the shown terminal has none, and the mark is gone once the terminal is shown' : problems.join('; ')}`);

      // A bell in the terminal that is shown fades its screen (the host element changes the name of its animation) and marks no tab.
      const faded = await page.evaluate(() => window.__apply.bellState());
      await typed('bell');
      const fades = await until(async () => (await page.evaluate(() => window.__apply.bellState())) !== faded);
      const tabsShown = await page.evaluate(() => window.__apply.tabs());
      check('apply.bell-visual', fades && tabsShown.every((tab) => !tab.mark), `${tag}: a bell in the terminal that is shown: ${fades ? 'the screen fades' : 'the screen does not fade'}, ${tabsShown.every((tab) => !tab.mark) ? 'no tab is marked' : 'a tab is marked'}`);

      // Off: nothing at all, shown or not. A command that runs after the bell proves the bell was parsed.
      await change(page, { bell: 'off' });
      await page.evaluate(() => window.__apply.frames(5));
      const beforeOff = await page.evaluate(() => window.__apply.bellState());
      await perturb(ctx, page, 'off');
      await typed('bell');
      await typed('hello');
      await page.waitForFunction(() => /hello from the synthetic shell/.test(window.__apply.rows()), null, { timeout: 15_000 });
      const afterOff = await page.evaluate(() => window.__apply.bellState());
      await selectTab(1);
      await selectTab(0);
      await typed('bell-later 400');
      await selectTab(1);
      await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent !== null);
      const sent = host.log.writes.length;
      await typed('bell');
      await typed('hello');
      await until(async () => host.log.writes.length >= sent + 2, 5_000);
      await page.waitForFunction(() => /hello from the synthetic shell/.test(window.__apply.rows()), null, { timeout: 15_000 });
      // The first terminal's bell is 400 ms after the command, and the second terminal's own commands took at least as long to run: nothing is on the tab.
      await until(async () => (await page.evaluate(() => window.__apply.tabs())).length === 2, 5_000);
      const tabsOff = await page.evaluate(() => window.__apply.tabs());
      const offProblems = [];
      if (afterOff !== beforeOff) offProblems.push(`the screen faded for a bell with the setting off (${String(beforeOff)} to ${String(afterOff)})`);
      if (tabsOff.some((tab) => tab.mark)) offProblems.push('a tab is marked for a bell with the setting off');
      check('apply.bell-off', offProblems.length === 0, `${tag}: a bell with the setting off: ${offProblems.length === 0 ? 'the screen does not fade and no tab is marked' : offProblems.join('; ')}`);

      const sounds = await page.evaluate(() => window.__apply.sounds);
      check('apply.bell-silent', sounds === 0, `${tag}: after every bell above, the page made ${String(sounds)} audio contexts and played ${sounds === 0 ? 'nothing' : 'something'}: the terminal never makes a sound`);
      report.numbers[`apply-bell ${tag}`] = { marked, cleared, fades, sounds };
    } finally {
      await session.close();
    }
  };

  return sections;
}

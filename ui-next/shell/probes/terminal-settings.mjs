// The person's terminal settings reach a terminal that is open (issue #697 step 1), in a real browser, in both engines at both viewports, over the REAL emulator and the REAL renderer of the page (the DOM's: `?renderer=dom`; the GPU's
// cell is the DOM's rounded to a device pixel, and what these sections prove is the order of the page's own steps). The far end is the probe's own host (terminal-host.mjs, its synthetic shell); the settings are the fixture's
// (`?prefs=1`, terminal-fixture.tsx: `window.__prefs.set(...)` is one event of the host's `settings/changed`, and the page asks for the snapshot after it). What the unit tests prove (the bounds, the order of the events, which settings
// are applied) is not proved again here; what only a real renderer shows is:
//   settings-live       a change of the font size, the line height and the cursor reaches the terminal that is open in ONE event and ONE question of the host (settings.live: the counts are the fixture's) and ZERO emulators made (a count of
//                       the `.terminal.xterm` elements the page ever added), the rows are the size and the height asked for, the cursor is the style asked for, and the lines written before the change are still in the scrollback
//   settings-font-open  a terminal made when the host's settings name a font that is not loaded yet (the font file comes 600 ms late) measures its cell in THAT font: the cell the emulator laid out is the loaded font's (settings.font-open)
//   settings-font-live  a family chosen while a terminal is open, whose font file is not loaded either, is loaded before the emulator measures: the cell is the loaded font's and not the fallback's (settings.font-live)
// Every section waits for a state and never for a time (the font's delay is the fixture's: what a late font is). A control plants one fault in the page.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost } from './terminal-host.mjs';
import { serveContext } from './terminal-serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
/** A proportional face (Inter) under another name: its cell is far from the theme's monospace face, so a terminal measured in the wrong font is told from one measured in the right one. */
const FACE_FILE = path.resolve(here, '../../../packages/kit/dist/fonts/Inter-SemiBold.latin.woff2');
const FACE = 'ProbeFace';
/** How late the font file comes: the page must wait for it, and not measure the fallback meanwhile. */
const FONT_DELAY_MS = 600;
const FACE_CSS = `@font-face{font-family:'${FACE}';src:url('/probe-face.woff2') format('woff2');font-weight:400}`;

const LINUX = () => {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64', configurable: true });
};

/** What the sections read of the page, in the page, in one task. */
const HELPERS = () => {
  const probe = (window.__settings = {});
  /** The emulators the page ever added: the page makes ONE for a terminal and none for a change of its settings. */
  const added = { made: 0 };
  probe.made = () => added.made;
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.terminal.xterm')) added.made += 1;
        added.made += node.querySelectorAll('.terminal.xterm').length;
      }
    }
  }).observe(document, { childList: true, subtree: true });
  probe.rows = () => [...document.querySelectorAll('.xterm-rows > div')].map((row) => (row.textContent ?? '').replaceAll('\u00a0', ' ').trimEnd()).join('\n');
  probe.look = () => {
    const rows = document.querySelector('.xterm-rows');
    const row = document.querySelector('.xterm-rows > div');
    return {
      fontSize: rows === null ? null : Number.parseFloat(getComputedStyle(rows).fontSize),
      family: rows === null ? null : getComputedStyle(rows).fontFamily,
      rowHeight: row === null ? null : row.getBoundingClientRect().height,
      cursor: ['block', 'bar', 'underline'].filter((style) => document.querySelector(`.xterm-cursor-${style}`) !== null),
      screenWidth: Number.parseFloat(document.querySelector('.xterm-screen')?.style.width ?? ''),
    };
  };
  /** The cell the emulator laid out (the screen's width over the columns the host was told), against what a font measures for 32 W (the emulator's own way) at the size it was given, once that font is loaded. */
  probe.cell = async (cols, size, family) => {
    await document.fonts.load(`${String(size)}px ${family}`);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${String(size)}px ${family}`;
    return { implied: Number.parseFloat(document.querySelector('.xterm-screen')?.style.width ?? '') / cols, loaded: context.measureText('W'.repeat(32)).width / 32 };
  };
  probe.theme = () => getComputedStyle(document.querySelector('[data-swatch="font"]')).fontFamily;
};

/** The fixture's settings change: one event of the host. */
const change = (page, values) => page.evaluate((next) => window.__prefs.set(next), values);

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A bounded wait for something the host's log shows: the answer is whether it came. */
const until = async (done, ms = 15_000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (done()) return true;
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
};

export const SETTINGS_PARTS = {
  settings: ['settings-live', 'settings-font-open', 'settings-font-live'],
};

/** The negative controls: a fault of the page (`init` before the page's scripts, `after` at the `stage` the section names). Each runs in Chromium. */
export const SETTINGS_CONTROLS = {
  // The page hears no event of the host: a setting changed is a setting the terminal never sees.
  'settings-not-live': {
    assertion: 'settings.live',
    section: 'settings-live',
    engines: ['chromium'],
    stage: 'ready',
    after: (page) =>
      page.evaluate(() => {
        const prefs = window.__prefs;
        prefs.set = (next) => {
          prefs.values = { ...prefs.values, ...next };
          prefs.events += 1;
        };
      }),
  },
  // A second emulator is made for the change (what applying a setting by making the terminal again does).
  'settings-recreate': {
    assertion: 'settings.live',
    section: 'settings-live',
    engines: ['chromium'],
    stage: 'changed',
    after: (page) =>
      page.evaluate(() => {
        const made = document.createElement('div');
        made.className = 'terminal xterm';
        document.body.append(made);
      }),
  },
  // The scrollback is gone after the change: the terminal was cleared.
  'settings-scrollback-lost': {
    assertion: 'settings.live',
    section: 'settings-live',
    engines: ['chromium'],
    stage: 'changed',
    after: async (page) => {
      await page.locator('[data-terminal-tool="clear"]').click();
    },
  },
  // The font is not waited for: the page's font loading answers at once, with nothing loaded, so the emulator measures what is there.
  'settings-font-unloaded-open': {
    assertion: 'settings.font-open',
    section: 'settings-font-open',
    engines: ['chromium'],
    init: () => {
      FontFaceSet.prototype.load = async () => [];
    },
  },
  // The emulator's screen has no inline width: the cell cannot be measured, and a comparison with NaN is false.
  'settings-cell-unmeasured': {
    assertion: 'settings.font-open',
    section: 'settings-font-open',
    engines: ['chromium'],
    init: () => {
      setInterval(() => {
        const screen = document.querySelector('.xterm-screen');
        if (screen instanceof HTMLElement) screen.style.removeProperty('width');
      }, 5);
    },
  },
  'settings-font-unloaded-live': {
    assertion: 'settings.font-live',
    section: 'settings-font-live',
    engines: ['chromium'],
    init: () => {
      FontFaceSet.prototype.load = async () => [];
    },
  },
};

/**
 * @param {{ check: Function, note: Function, report: { numbers: Record<string, unknown> } }} deps
 */
export function createSettingsSections({ check, note, report }) {
  const sections = {};
  const perturb = async (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

  /** A page of the fixture against the probe's host, with the person's settings the fixture holds (`initial` is what the host holds when the first terminal is made) and the late font file: the shell starts. */
  async function open(ctx, initial = {}) {
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
      const face = readFileSync(FACE_FILE);
      await context.route('**/probe-face.woff2', async (route) => {
        await sleep(FONT_DELAY_MS);
        await route.fulfill({ status: 200, contentType: 'font/woff2', body: face });
      });
      await context.addInitScript(HELPERS);
      await context.addInitScript((values) => {
        window.__prefsInitial = values;
      }, initial);
      if (ctx.engine === 'chromium') await context.addInitScript(LINUX);
      if (control?.init !== undefined) await context.addInitScript(control.init);
      const page = await context.newPage();
      await page.goto(`${origin}/shell/probes/terminal-fixture.html?host=shared&renderer=dom&prefs=1`, { waitUntil: 'load' });
      await page.addStyleTag({ content: FACE_CSS });
      await page.waitForSelector('[data-shell-part="window"]');
      await page.click('[data-shell-part="panelToggle"]');
      await page.waitForSelector('[data-shell-part="panelEmpty"]');
      await page.click('[data-shell-part="panelEmpty"] button');
      await page.waitForSelector('.xterm-helper-textarea', { timeout: 30_000 });
      await page.waitForFunction(() => /user@synthetic/.test(document.querySelector('.xterm-rows')?.textContent ?? ''), null, { timeout: 30_000 });
      await page.locator('.xterm-helper-textarea').focus();
      return { page, host, close };
    } catch (error) {
      // Nothing returns the handle that closes the bridge, the host and the context: close them here, in the order the handle does, and let the failure through.
      await close().catch(() => undefined);
      throw error;
    }
  }

  /** Whether every width of a measure is a number above zero: a missing screen width is NaN, and every comparison with it is false. */
  const measured = (read) => [read.implied, read.loaded, read.fallback].every((width) => Number.isFinite(width) && width > 0);

  /** The columns the host was last told: the emulator's grid. */
  const columns = (host) => host.log.resizes.at(-1)?.cols ?? 0;

  /** A key the person types takes the viewport to the bottom (the emulator scrolls on user input): a space and its erasure leave the line as it was. */
  async function toBottom(page) {
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type(' ');
    await page.keyboard.press('Backspace');
    await page.waitForFunction(() => /00119 needle/.test(window.__settings.rows()), null, { timeout: 10_000 });
  }

  /** The viewport is taken to the top by the emulator's own chord (Shift and Page Up); says whether the first line of the `dense` output is there. */
  async function toTop(page) {
    await page.locator('.xterm-helper-textarea').focus();
    for (let batch = 0; batch < 20; batch += 1) {
      for (let press = 0; press < 5; press += 1) await page.keyboard.press('Shift+PageUp');
      const seen = await page.waitForFunction(() => /00000 needle/.test(window.__settings.rows()), null, { timeout: 300 }).then(() => true, () => false);
      if (seen) return true;
    }

    return false;
  }

  // ------------------------------------------------------------------------------------------------ settings-live
  sections['settings-live'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page } = session;
    try {
      await page.keyboard.type('dense 120 1');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /00119 needle/.test(window.__settings.rows()), null, { timeout: 30_000 });
      await perturb(ctx, page, 'ready');
      // The way the scrollback is read is sound: the first line is reachable before the change, and the viewport goes back to the bottom.
      const reachable = await toTop(page);
      await toBottom(page);
      const before = await page.evaluate(() => ({ made: window.__settings.made(), look: window.__settings.look(), events: window.__prefs.events, snapshots: window.__prefs.snapshots }));
      await change(page, { fontSize: 16, lineHeight: 1.5, cursorStyle: 'bar' });
      const applied = await page
        .waitForFunction(() => window.__settings.look().fontSize === 16, null, { timeout: 10_000 })
        .then(() => true, () => false);
      await page.waitForFunction(() => window.__prefs.snapshots >= 2, null, { timeout: 10_000 }).catch(() => undefined);
      await perturb(ctx, page, 'changed');
      await page.locator('.xterm-helper-textarea').focus();
      const after = await page.evaluate(() => ({ made: window.__settings.made(), look: window.__settings.look(), events: window.__prefs.events, snapshots: window.__prefs.snapshots }));
      // The scrollback: the viewport is taken to the top by the wheel, and the first of the lines written before the change is there.
      const top = await toTop(page);
      const problems = [];
      if (!reachable) problems.push('the first line is not reachable by the wheel even before the change: the probe cannot read the scrollback');
      if (!applied) problems.push(`the rows are ${String(after.look.fontSize)} px after the change, not 16`);
      if (after.events - before.events !== 1) problems.push(`${String(after.events - before.events)} events of the host for the one change`);
      if (after.snapshots - before.snapshots !== 1) problems.push(`${String(after.snapshots - before.snapshots)} questions of the host for the one change`);
      if (after.made !== before.made) problems.push(`${String(after.made - before.made)} emulators made for the change`);
      if (applied && Math.abs(after.look.rowHeight - 24) > 1) problems.push(`a row is ${String(after.look.rowHeight)} px high, not the 24 of 16 px at 1.5`);
      if (applied && !after.look.cursor.includes('bar')) problems.push(`the cursor is ${JSON.stringify(after.look.cursor)}, not a bar`);
      if (!top) problems.push('the first line written before the change is no longer in the scrollback');
      // A row shorter than the font's own cannot be drawn: a line height of 1 at a size the person chose next is the font's own row, and the size is applied all the same (the emulator takes no multiple below 1).
      await change(page, { fontSize: 20, lineHeight: 1 });
      const shortest = await page
        .waitForFunction(() => window.__settings.look().fontSize === 20, null, { timeout: 10_000 })
        .then(() => true, () => false);
      const tight = await page.evaluate(() => window.__settings.look());
      if (!shortest) problems.push(`a line height of 1 after the size 20: the rows are ${String(tight.fontSize)} px, the change was not applied`);
      else if (tight.rowHeight < 20) problems.push(`a line height of 1 at 20 px drew rows of ${String(tight.rowHeight)} px, shorter than the font`);
      check('settings.live', problems.length === 0, `${tag}: a change of the font size, the line height and the cursor with 120 lines in the scrollback: ${problems.length === 0 ? 'rows of 16 px and 24 px high, a bar cursor, 1 event, 1 question of the host, 0 emulators made and the first line still there' : problems.join('; ')}`);
      report.numbers[`settings-live ${tag}`] = { before, after };
    } finally {
      await session.close();
    }
  };

  /** The font checks: the cell the emulator laid out against the loaded font's, and not the theme's. */
  async function measure(page, host, size) {
    const cols = columns(host);
    const read = await page.evaluate(([c, s, face]) => window.__settings.cell(c, s, face), [cols, size, FACE]);
    const theme = await page.evaluate(([c, s]) => window.__settings.theme().then?.(c) ?? window.__settings.theme(), [cols, size]);
    const fallback = await page.evaluate(
      ([s, family]) => {
        const context = document.createElement('canvas').getContext('2d');
        context.font = `${String(s)}px ${family}`;
        return context.measureText('W'.repeat(32)).width / 32;
      },
      [size, theme],
    );
    return { ...read, cols, fallback };
  }

  // ------------------------------------------------------------------------------------------------ settings-font-open
  sections['settings-font-open'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    // The font file comes late and the host's settings name it before the first terminal is made: the terminal is made after the font is in.
    const session = await open(ctx, { fontFamily: FACE });
    const { page, host } = session;
    try {
      const read = await measure(page, host, 12);
      const problems = [];
      if (read.cols === 0) problems.push('the host was told no size');
      if (!measured(read)) problems.push(`the cell could not be measured (${JSON.stringify(read)})`);
      // The grid is rounded to the pixel by the emulator: a few hundredths of a pixel of a cell, over a hundred columns.
      if (Math.abs(read.implied - read.loaded) > 0.04 * read.loaded) problems.push(`the emulator's cell is ${read.implied.toFixed(2)} px wide, the loaded font's is ${read.loaded.toFixed(2)} px`);
      if (Math.abs(read.implied - read.fallback) < 0.15 * read.fallback) problems.push(`the cell is the fallback's (${read.fallback.toFixed(2)} px): the font was measured before it loaded`);
      check('settings.font-open', problems.length === 0, `${tag}: the terminal made with the font ${FACE} that arrives ${String(FONT_DELAY_MS)} ms late: ${problems.length === 0 ? `the cell is the loaded font's (${read.implied.toFixed(2)} px; the fallback's would be ${read.fallback.toFixed(2)})` : problems.join('; ')}`);
      report.numbers[`settings-font-open ${tag}`] = read;
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ settings-font-live
  sections['settings-font-live'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      const first = columns(host);
      await change(page, { fontFamily: FACE });
      const applied = await page
        .waitForFunction((face) => window.__settings.look().family?.includes(face) ?? false, FACE, { timeout: 15_000 })
        .then(() => true, () => false);
      // The grid is read once the page has told the host the size the new font gives (a wider cell is fewer columns).
      const resized = await until(() => columns(host) !== first);
      const read = await measure(page, host, 12);
      const problems = [];
      if (!applied) problems.push('the emulator was never given the family');
      if (!measured(read)) problems.push(`the cell could not be measured (${JSON.stringify(read)})`);
      if (!resized) problems.push('the host was never told another size for the new font');
      if (Math.abs(read.implied - read.loaded) > 0.04 * read.loaded) problems.push(`the emulator's cell is ${read.implied.toFixed(2)} px wide, the loaded font's is ${read.loaded.toFixed(2)} px`);
      if (Math.abs(read.implied - read.fallback) < 0.15 * read.fallback) problems.push(`the cell is the fallback's (${read.fallback.toFixed(2)} px): the font was measured before it loaded`);
      check('settings.font-live', problems.length === 0, `${tag}: the family ${FACE} chosen while the terminal is open, its file ${String(FONT_DELAY_MS)} ms late: ${problems.length === 0 ? `the cell is the loaded font's (${read.implied.toFixed(2)} px; the fallback's would be ${read.fallback.toFixed(2)})` : problems.join('; ')}`);
      report.numbers[`settings-font-live ${tag}`] = read;
    } finally {
      await session.close();
    }
  };

  void note;
  return sections;
}

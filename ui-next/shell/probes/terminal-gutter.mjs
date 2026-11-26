// The command gutter of the Terminal tool (issue #694 step 5), in a real xterm, in both engines at both viewports. The far end is the probe's own host (terminal-host.mjs) with the shell's integration on (`integration: true`):
// its synthetic shell prints the marks of a shell with the integration (a prompt between the end of the command that ran, the directory and the start of the prompt and its input; a command with its line, proved with the session's
// nonce) and the host sends them on the channel, typed and addressed by offset. What this proves is what only a real renderer shows: where a mark is DRAWN, that it covers no cell of the output, that the alternate screen hides it, what the
// pointer on it says, where the keys take the view and what they copy, and that a reload brings the gutter back. The model, the markers and their death are proved by the unit tests against the real emulator; the real zsh and bash are step 7's.
//
// Every section waits for a state and never for a time. Each has ONE assertion, so that a control trips only that one. `GUTTER_CONTROLS` is each control's fault in the shape of the probe's own table.
//   gutter-marks   a mark for each command run, drawn on the row of its command in the left inset of the screen: none covers a cell, the mark is the element under its own centre (nothing clips or covers it), it says success for a command that
//                  ended with status 0, and a program that has the alternate screen up hides every mark (gutter.marks)
//   gutter-hover   the pointer on a mark says the command line, how it ended and the directory, and the words go when the pointer does (gutter.hover)
//   gutter-keys    the jump keys take the view to the previous and the next command (the command's own row is the top row), say so at the end of the list, and the menu's Copy command output copies exactly the output of the command the view
//                  is on (gutter.keys)
//   gutter-reload  after a reload the gutter is back: two jumps back reach the first of the two commands the host's replay holds (gutter.reload)
//   gutter-axe     axe-core finds nothing in a terminal with marks drawn (axe.gutter)
import { createHost } from './terminal-host.mjs';
import { AXE } from './harness.mjs';
import { serveContext } from './terminal-serve.mjs';

const IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Chromium says it runs on Linux (the seam's way), so that the chords of the platforms that are not a Mac are run on a Mac too. WebKit says what it is. */
const LINUX = () => {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64', configurable: true });
};

/** The clipboard of the page, deterministic: what the page writes is kept (`writes`); `drop` is true only for the control `clipboard-dropped`. */
const CLIPBOARD = ({ drop }) => {
  const clip = (window.__clip = { text: '', writes: [], drop });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        if (!clip.drop) clip.writes.push(String(text));
      },
      readText: async () => clip.text,
    },
  });
};

/** What the sections read of the page, in the page, in one task: the marks, their rows, and what the screen shows. */
const HELPERS = () => {
  const gutter = (window.__gutter = {});
  const box = (element) => {
    if (element === null || element === undefined) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  const rowText = (row) => (row.textContent ?? '').replaceAll('\u00a0', ' ').trimEnd();
  gutter.rows = () => [...document.querySelectorAll('.xterm-rows > div')].map(rowText);
  gutter.marks = () => [...document.querySelectorAll('.xterm-decoration [data-state]')];
  gutter.states = () => gutter.marks().map((mark) => mark.getAttribute('data-state'));
  /** Each mark: its state, its box, whether it is drawn at all, whether it is the element under its own centre, and the row it is beside (the row whose box holds its centre). */
  gutter.read = () => {
    const rows = [...document.querySelectorAll('.xterm-rows > div')];
    const text = document.querySelector('.xterm-rows');
    const screen = document.querySelector('[data-shell-part="terminalScreen"]');
    return {
      text: box(text),
      screen: box(screen),
      marks: gutter.marks().map((mark) => {
        const rect = mark.getBoundingClientRect();
        const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        const row = rows.find((candidate) => {
          const r = candidate.getBoundingClientRect();
          return centre.y >= r.y && centre.y < r.bottom;
        });
        const view = screen === null ? null : screen.getBoundingClientRect();
        return {
          state: mark.getAttribute('data-state'),
          // The mark of a command whose row has scrolled out of the view is where the emulator leaves it (above or below the screen): only a mark in the view is drawn for the person.
          inView: view !== null && rect.y >= view.y - 1 && rect.bottom <= view.bottom + 1,
          rect: box(mark),
          shown: getComputedStyle(mark).display !== 'none' && rect.width > 0 && rect.height > 0,
          under: rect.width > 0 && document.elementFromPoint(centre.x, centre.y) !== null && mark.contains(document.elementFromPoint(centre.x, centre.y)),
          row: row === undefined ? null : rowText(row),
          centre,
        };
      }),
    };
  };
  gutter.tip = () => {
    const tip = document.querySelector('[role="tooltip"]');
    return tip === null ? null : [...tip.querySelectorAll('div')].map((line) => (line.textContent ?? '').trim());
  };
  gutter.top = () => gutter.rows()[0] ?? '';
  gutter.live = () => document.querySelector('[data-shell-part="terminalBody"] [aria-live="polite"]')?.textContent ?? '';
};

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The output the synthetic shell's `flood N W` prints for a command: numbered lines of W bytes. */
const floodLines = (lines, width) => Array.from({ length: lines }, (_, at) => `${String(at).padStart(7, '0')} ${'x'.repeat(Math.max(0, width - 8))}`);

export const GUTTER_PARTS = {
  gutter: ['gutter-marks', 'gutter-hover', 'gutter-keys', 'gutter-reload', 'gutter-axe'],
};

const plantImage = (page) =>
  page.evaluate((src) => {
    const image = document.createElement('img');
    image.src = src;
    document.querySelector('[data-shell-part="terminalBody"]').append(image);
  }, IMAGE);

/**
 * The negative controls of the gutter: a fault of the page (`init` before the page's own scripts, `after` at the `stage` the section names), of the clipboard (`clipboard`) or of the host (`host.faults`). Each runs in Chromium: what it
 * proves does not depend on the engine.
 */
export const GUTTER_CONTROLS = {
  // A mark that sits on the first cell, over the output, instead of beside it; and one that is drawn in the alternate screen.
  'gutter-covers-text': {
    assertion: 'gutter.marks',
    section: 'gutter-marks',
    engines: ['chromium'],
    stage: 'marks',
    after: (page) => page.addStyleTag({ content: '.xterm-decoration > [data-state]{inset-inline-end:auto !important;inset-inline-start:0 !important}' }),
  },
  'gutter-alt-shown': {
    assertion: 'gutter.marks',
    section: 'gutter-marks',
    engines: ['chromium'],
    stage: 'alt',
    after: (page) => page.addStyleTag({ content: '[data-shell-part="terminalScreen"] .xterm-decoration > [data-state]{display:flex !important}' }),
  },
  // The shell's marks never reach the page: the host sends no marks frame.
  'gutter-marks-never': { assertion: 'gutter.marks', section: 'gutter-marks', engines: ['chromium'], host: { faults: { marksNever: true } } },
  // A pointer that is never said to have left the mark.
  'gutter-tip-stuck': {
    assertion: 'gutter.hover',
    section: 'gutter-hover',
    engines: ['chromium'],
    init: () => {
      document.addEventListener('mouseleave', (event) => { if (event.target instanceof Element && event.target.hasAttribute('data-state')) event.stopImmediatePropagation(); }, true);
    },
  },
  'gutter-tip-never': { assertion: 'gutter.hover', section: 'gutter-hover', engines: ['chromium'], init: () => {
    document.addEventListener('mouseenter', (event) => { if (event.target instanceof Element && event.target.hasAttribute('data-state')) event.stopImmediatePropagation(); }, true);
  } },
  // A jump chord that never reaches the product, and a clipboard that keeps nothing it is given.
  'gutter-jump-lost': {
    assertion: 'gutter.keys',
    section: 'gutter-keys',
    engines: ['chromium'],
    init: () => {
      window.addEventListener('keydown', (event) => { if (event.key === 'ArrowUp' && event.ctrlKey) event.stopImmediatePropagation(); }, true);
    },
  },
  'gutter-clipboard-dropped': { assertion: 'gutter.keys', section: 'gutter-keys', engines: ['chromium'], clipboard: { drop: true } },
  // A host whose replay brings no marks.
  'gutter-reload-forgets': { assertion: 'gutter.reload', section: 'gutter-reload', engines: ['chromium'], host: { faults: { marksAfterFirst: true } } },
  'gutter-axe': { assertion: 'axe.gutter', section: 'gutter-axe', engines: ['chromium'], stage: 'axe', after: plantImage },
};

/**
 * @param {{ check: Function, note: Function, report: { numbers: Record<string, unknown> }, runAxe: Function }} deps
 */
export function createGutterSections({ check, note, report, runAxe }) {
  const sections = {};

  const perturb = async (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

  const waitFor = async (page, done, arg, timeout = 15_000) =>
    page.waitForFunction(done, arg, { timeout }).then(
      () => true,
      () => false,
    );

  const installIn = async (target, ctx) => {
    if (ctx.engine === 'chromium') await target.addInitScript(LINUX);
    await target.addInitScript(CLIPBOARD, { drop: ctx.control?.clipboard?.drop === true });
    await target.addInitScript(HELPERS);
    if (ctx.control?.init !== undefined) await target.addInitScript(ctx.control.init);
  };

  /** A page of the fixture against the probe's host (the shell's integration on): the panel is opened on the Terminal tool, a shell starts and its first prompt is on the screen. */
  async function open(ctx) {
    const { browser, origin, viewport, control } = ctx;
    const host = createHost({ integration: true, ...control?.host?.options, faults: { ...control?.host?.faults } });
    const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
    const served = await serveContext(context, host);
    await installIn(context, ctx);
    const page = await context.newPage();
    const query = ['host=shared', 'renderer=dom', control?.query].filter((part) => part !== undefined && part !== '').join('&');
    await page.goto(`${origin}/shell/probes/terminal-fixture.html?${query}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-shell-part="window"]');
    await page.click('[data-shell-part="panelToggle"]');
    await page.waitForSelector('[data-shell-part="panelEmpty"]');
    await page.click('[data-shell-part="panelEmpty"] button');
    await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
    await page.waitForFunction(() => /user@synthetic/.test(document.querySelector('.xterm-rows')?.textContent ?? ''), null, { timeout: 20_000 });
    await page.locator('.xterm-helper-textarea').focus();
    const close = async () => {
      host.stop();
      await served.close();
      await context.close();
    };

    return { page, host, context, close };
  }

  /** Types a command and waits until it has ended and the mark for it says how: `count` marks, the last not running. */
  async function ran(page, line, count) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
    return waitFor(page, (n) => window.__gutter.marks().length >= n && window.__gutter.states().at(-1) !== 'running' && /user@synthetic/.test(window.__gutter.rows().at(-1) ?? window.__gutter.rows().join('')), count, 20_000);
  }

  const isMac = async (page) => page.evaluate(() => /Mac/.test(navigator.platform));

  // ------------------------------------------------------------------------------------------------ gutter.marks
  sections['gutter-marks'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page } = session;
    try {
      const first = await ran(page, 'known', 1);
      const second = await ran(page, 'known', 2);
      await perturb(ctx, page, 'marks');
      // `GUTTER_SHOT=<directory>` photographs the terminal with its marks, for a person to look at (a dev tool: no unit sets it).
      if (process.env.GUTTER_SHOT !== undefined) await page.locator('[data-shell-part="terminalBody"]').screenshot({ path: `${process.env.GUTTER_SHOT}/gutter-${engine}-${vp}.png` });
      const read = await page.evaluate(() => window.__gutter.read());
      const problems = [];
      if (!first || !second) problems.push('a mark did not come for a command that ran');
      const seen = read.marks.filter((mark) => mark.inView);
      if (seen.length < 1 || seen.length > 2) problems.push(`${String(seen.length)} marks are in the view for 2 commands`);
      for (const [index, mark] of seen.entries()) {
        if (mark.state !== 'success') problems.push(`mark ${String(index)} says ${String(mark.state)}`);
        if (!mark.shown) problems.push(`mark ${String(index)} is not drawn`);
        if (mark.rect.right > read.text.x + 1) problems.push(`mark ${String(index)} is over the output (its right edge ${String(Math.round(mark.rect.right))} is past the first cell at ${String(Math.round(read.text.x))})`);
        if (mark.rect.x < read.screen.x - 1) problems.push(`mark ${String(index)} is outside the screen`);
        if (!mark.under) problems.push(`mark ${String(index)} is not the element under its own centre (clipped or covered)`);
        if (mark.row === null || !/known/.test(mark.row)) problems.push(`mark ${String(index)} is beside ${JSON.stringify(mark.row)}, not the row of its command`);
      }

      // A program with the whole screen: no mark is drawn while it has it.
      await page.keyboard.type('fullscreen');
      await page.keyboard.press('Enter');
      const alternate = await waitFor(page, () => document.querySelector('[data-shell-part="terminalScreen"]')?.hasAttribute('data-alternate') === true);
      // The emulator hides the decorations of the normal screen's lines itself while the other screen is up (measured: its own `display: none`); the stylesheet's rule is what holds when it does not, so the emulator's is put aside here and the
      // rule is read alone: the marks must still not be drawn.
      await page.addStyleTag({ content: '.xterm-decoration{display:block !important}' });
      await perturb(ctx, page, 'alt');
      const hidden = await page.evaluate(() => window.__gutter.read().marks.filter((mark) => mark.shown).length);
      if (!alternate) problems.push('the screen never said a program has the alternate screen');
      if (hidden !== 0) problems.push(`${String(hidden)} marks are drawn on the alternate screen`);
      check('gutter.marks', problems.length === 0, `${tag}: two commands ran; ${problems.length === 0 ? 'a success mark beside the row of each command that is in the view and over no cell, none on the alternate screen' : problems.join('; ')}`);
      note(`gutter marks ${tag}: ${JSON.stringify(read.marks.map((mark) => [mark.state, mark.inView, Math.round(mark.rect.right - read.text.x), mark.row?.slice(0, 20)]))}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ gutter.hover
  sections['gutter-hover'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page } = session;
    try {
      await ran(page, 'known', 1);
      const centre = await page.evaluate(() => window.__gutter.read().marks.find((mark) => mark.inView)?.centre);
      const problems = [];
      if (centre === undefined) problems.push('no mark to hover');
      let on;
      let off;
      if (centre !== undefined) {
        await page.mouse.move(centre.x, centre.y);
        await waitFor(page, () => window.__gutter.tip() !== null, undefined, 3_000);
        on = await page.evaluate(() => window.__gutter.tip());
        await page.mouse.move(centre.x + 400, centre.y + 80);
        await waitFor(page, () => window.__gutter.tip() === null, undefined, 3_000);
        off = await page.evaluate(() => window.__gutter.tip());
        if (on === null || on === undefined) problems.push('no words while the pointer is on the mark');
        else {
          if (on[0] !== 'known') problems.push(`the command line says ${JSON.stringify(on[0])}`);
          if (!/^Succeeded, took /.test(on[1] ?? '')) problems.push(`the status says ${JSON.stringify(on[1])}`);
          if (on[2] !== '/home/user') problems.push(`the directory says ${JSON.stringify(on[2])}`);
        }

        if (off !== null) problems.push('the words stay when the pointer leaves');
      }

      check('gutter.hover', problems.length === 0, `${tag}: ${problems.length === 0 ? 'the pointer on a mark says the command, how it ended and the directory, and the words go with the pointer' : problems.join('; ')}`);
      note(`gutter hover ${tag}: ${JSON.stringify(on)}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ gutter.keys
  sections['gutter-keys'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page } = session;
    try {
      const mac = await isMac(page);
      const up = mac ? 'Meta+ArrowUp' : 'Control+ArrowUp';
      const down = mac ? 'Meta+ArrowDown' : 'Control+ArrowDown';
      await ran(page, 'known', 1);
      await ran(page, 'flood 60 40', 2);
      const top = async () => page.evaluate(() => window.__gutter.top());
      const topIs = async (pattern) => waitFor(page, (source) => new RegExp(source).test(window.__gutter.top()), pattern, 3_000);
      const problems = [];
      await page.keyboard.press(up);
      if (!(await topIs('flood 60 40'))) problems.push(`the first jump back left ${JSON.stringify(await top())} at the top, not the row of flood 60 40`);
      await page.keyboard.press(up);
      if (!(await topIs('\\$ known'))) problems.push(`the second jump back left ${JSON.stringify(await top())} at the top, not the row of known`);
      await page.keyboard.press(up);
      const said = await waitFor(page, () => /No previous command/.test(window.__gutter.live()), undefined, 3_000);
      if (!said) problems.push(`the end of the list was not said (${JSON.stringify(await page.evaluate(() => window.__gutter.live()))})`);
      await page.keyboard.press(down);
      if (!(await topIs('flood 60 40'))) problems.push(`a jump forward left ${JSON.stringify(await top())} at the top, not the row of flood 60 40`);
      // The output of the command the view is on, copied from the menu (the keyboard path: Shift F10).
      await page.keyboard.press('Shift+F10');
      const item = page.getByRole('menuitem', { name: 'Copy command output' });
      const offered = await item.waitFor({ timeout: 5_000 }).then(() => true, () => false);
      if (!offered) problems.push('the menu has no Copy command output');
      else {
        await item.click();
        const copied = await waitFor(page, () => window.__clip.writes.length > 0, undefined, 5_000);
        const text = await page.evaluate(() => window.__clip.writes.at(-1) ?? null);
        const expected = floodLines(60, 40).join('\n');
        if (!copied) problems.push('nothing was copied');
        else if (text !== expected) problems.push(`the copy is ${String(text?.split('\n').length)} lines and not the 60 of the output of flood 60 40`);
      }

      await page.keyboard.press('Escape');
      check('gutter.keys', problems.length === 0, `${tag}: ${problems.length === 0 ? 'Up goes to flood 60 40 and to known, says the end of the list, Down comes back, and Copy command output copies the 60 lines of the command the view is on' : problems.join('; ')}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ gutter.reload
  sections['gutter-reload'] = async (ctx) => {
    const { engine, vp, origin, control } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await ran(page, 'known', 1);
      await ran(page, 'known', 2);
      const attaches = host.log.attaches.length;
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('[data-shell-part="window"]');
      const waited = Date.now();
      while (host.log.attaches.length <= attaches && Date.now() - waited < 15_000) await sleep(50);
      const shown = await page.evaluate(() => (document.querySelector('[data-shell-part="panel"]')?.getBoundingClientRect().height ?? 0) > 0);
      if (!shown) await page.click('[data-shell-part="panelToggle"]');
      await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
      // The gutter is the page's own after the reload: every command the replay holds is a command to jump to, and the marks the emulator draws are those of the rows in the view, so the proof is the jump: two jumps back reach the first of two.
      await page.locator('.xterm-helper-textarea').focus();
      const mac = await isMac(page);
      const up = mac ? 'Meta+ArrowUp' : 'Control+ArrowUp';
      await page.keyboard.press(up);
      await page.keyboard.press(up);
      const back = await waitFor(page, () => /Command 1 of 2/.test(window.__gutter.live()), undefined, 12_000);
      const said = await page.evaluate(() => window.__gutter.live());
      void origin;
      void control;
      check('gutter.reload', back, `${tag}: two commands ran and the page was loaded again: ${back ? `two jumps back reach the first of two (${JSON.stringify(said)})` : `the gutter did NOT come back (the page says ${JSON.stringify(said)})`}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ axe.gutter
  sections['gutter-axe'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page } = session;
    try {
      await ran(page, 'known', 1);
      await page.addScriptTag({ path: AXE });
      await perturb(ctx, page, 'axe');
      const found = await runAxe(page, '[data-shell-part="terminalBody"]');
      check('axe.gutter', found.length === 0, `${tag}: axe-core on a terminal with a mark drawn: ${found.length === 0 ? 'no violation' : found.join('; ')}`);
      report.numbers[`gutter-axe ${tag}`] = { violations: found.length };
    } finally {
      await session.close();
    }
  };

  return sections;
}

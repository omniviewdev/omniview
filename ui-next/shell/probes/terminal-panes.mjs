// The panes of the Terminal tool (issue #697 step 6, the layout), in a real browser, in both engines at both viewports: Split terminal starts a NEW terminal where the host says the first one is and draws it beside the first, two and three
// panes share the room equally within a pixel, a drag of the sash moves the line and each emulator's size follows its pane, 80 px is the least a pane has whatever the pointer or the window does, a double click and Enter share the room
// again, the arrow keys move the line by 16 px, a window made narrower brings the panes within the minimum, a split that would leave a pane under 80 px is refused, and the WebGL contexts the page holds stay one for each terminal across
// ten hidings and showings of three panes. The far end is the probe's own host (terminal-host.mjs: it records every terminal made, with the directory it was asked to start in, every directory it was asked for, and every size an emulator
// told it); the emulator is the product's own, in its lazy chunk (the DOM renderer where text is read, the GPU's where contexts are counted). The model's rules are the unit tests' (core/panel, panel/panes/Panes.test.tsx, whose
// bodies are invented streams): what only a real engine shows is where the panes are DRAWN, their widths in pixels and the columns an emulator takes from them.
//
// Every section waits for a state and never for a time (the host's log counts what it received). `PANES_CONTROLS` is each control's fault in the shape of the probe's own table; each assertion has a control.
//   panes-layout  a press of Split terminal in the first pane: a second terminal is created, under another id, in the directory the host said the first was in, and the host was asked where the first was (panes.split); the two panes are side by
//                 side, equal within 1 px, each at least 80 px, and with the sash they fill the deck (panes.equal); the new terminal has the keyboard (panes.focus); each emulator's columns are its pane's, within one column (panes.cols); a third split
//                 gives three equal panes (panes.three)
//   panes-sash    a drag of the sash moves the line by what the pointer moved, and each emulator's columns follow the share (panes.drag); a drag past either end stops at 80 px (panes.min); a double click shares the room equally (panes.reset);
//                 the arrow keys move the line by 16 px, Shift by 64, Home to the minimum and Enter equalises (panes.keys); the sash is a Tab stop with a hit area wider than its line (panes.sash)
//   panes-resize  a window made narrower brings every pane to at least 80 px with nothing overflowing (panes.fit), also when the window changes while the sash is dragged (panes.drag-resize)
//   panes-full    a narrow window takes as many panes as fit at 80 px and then Split terminal says why it cannot and starts nothing (panes.full)
//   panes-gl      three panes shown and hidden ten times hold no more WebGL contexts than there are terminals, and the number does not grow after the first showing (panes.gl)
//   panes-axe     axe-core finds nothing in three panes with their sashes (axe.panes)
import { createHost } from './terminal-host.mjs';
import { AXE } from './harness.mjs';
import { serveContext } from './terminal-serve.mjs';

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the sections read of the page, in the page, in one task. */
const HELPERS = () => {
  const panes = (window.__panes = {});
  const box = (element) => {
    if (element === null || element === undefined) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  /** The bodies on screen, left to right: the session, the pane's slot, the body's box and its screen's. */
  panes.bodies = () =>
    [...document.querySelectorAll('[data-shell-part="panelDeck"] > [data-shell-part="panelBody"][data-session-id]')]
      .filter((element) => !element.hidden && element.getClientRects().length > 0)
      .map((element) => ({ session: element.getAttribute('data-session-id'), pane: element.getAttribute('data-pane'), box: box(element), screen: box(element.querySelector('[data-shell-part="terminalScreen"]')), textarea: element.querySelector('.xterm-helper-textarea') !== null }))
      .sort((a, b) => a.box.x - b.box.x);
  panes.deck = () => {
    const deck = document.querySelector('[data-shell-part="panelDeck"]');
    return { box: box(deck), clientWidth: deck.clientWidth, scrollWidth: deck.scrollWidth, axis: deck.getAttribute('data-axis') };
  };
  panes.sashes = () => [...document.querySelectorAll('[data-shell-part="paneSash"]')].map((element) => ({ box: box(element), now: Number(element.getAttribute('aria-valuenow')), label: element.getAttribute('aria-label'), tabIndex: element.tabIndex, orientation: element.getAttribute('aria-orientation') }));
  /** The Split button of the pane at `index` (left to right): where it is and whether it says it cannot. */
  panes.split = (index) => {
    const slots = panes.bodies();
    const slot = document.querySelector(`[data-shell-part="panelBody"][data-session-id="${slots[index]?.session}"]`);
    const button = slot?.querySelector('[data-terminal-tool="split"]') ?? null;
    return button === null ? null : { box: box(button), disabled: button.getAttribute('aria-disabled') === 'true', described: [...(button.getAttribute('aria-describedby') ?? '').split(' ')].map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim() };
  };
  /** Which pane the keyboard is in, by its index from the left, and what it is on. */
  panes.focus = () => {
    const active = document.activeElement;
    const slot = active?.closest('[data-shell-part="panelBody"][data-session-id]') ?? null;
    const index = slot === null ? -1 : panes.bodies().findIndex((one) => one.session === slot.getAttribute('data-session-id'));
    return { index, part: active?.getAttribute('data-shell-part') ?? null, tag: active?.tagName ?? null };
  };
  /** The tool's active pane: the one its tab strip chose. */
  panes.activePane = () => document.querySelector('[data-shell-part="panelBody"][data-pane]:has(:focus)')?.getAttribute('data-pane') ?? null;
  /** The width of one column as the emulator measured it (its measuring element holds a run of characters), or 0 where there is none. */
  panes.cell = () => {
    const element = document.querySelector('.xterm-char-measure-element');
    return element === null || (element.textContent ?? '').length === 0 ? 0 : element.getBoundingClientRect().width / element.textContent.length;
  };
  panes.hit = (x, y) => document.elementFromPoint(x, y)?.getAttribute('data-shell-part') ?? null;
  // The WebGL contexts the page asked for (the GPU addon's dispose() does not release its context in 0.19.0 and WebKit allows 16 live ones in a page).
  const gl = (window.__gl = { made: 0 });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const context = getContext.call(this, kind, ...rest);
    if (context !== null && (kind === 'webgl' || kind === 'webgl2')) gl.made += 1;
    return context;
  };
};

export const PANES_PARTS = {
  panes: ['panes-layout', 'panes-sash', 'panes-resize', 'panes-full', 'panes-gl', 'panes-axe'],
};

const near = (a, b, tolerance = 1) => typeof a === 'number' && Math.abs(a - b) <= tolerance;
const rounded = (value) => Math.round(value * 10) / 10;

/**
 * The negative controls: a fault of the page (`init` before the page's own scripts, `after` at the `stage` the section names). Each runs in Chromium: what it proves does not depend on the engine.
 */
export const PANES_CONTROLS = {
  // The first pane takes three times the room of the second.
  'panes-unequal': {
    assertion: 'panes.equal',
    section: 'panes-layout',
    engines: ['chromium'],
    stage: 'split',
    after: (page) => page.evaluate(() => document.querySelector('[data-shell-part="panelBody"][data-pane]').style.setProperty('--_share', '3')),
  },
  // The request for the new terminal carries another directory than the one the host said the first was in.
  'panes-wrong-directory': {
    assertion: 'panes.split',
    section: 'panes-layout',
    engines: ['chromium'],
    init: () => {
      const send = window.fetch.bind(window);
      window.fetch = (input, init) => send(input, typeof init?.body === 'string' ? { ...init, body: init.body.replaceAll('/home/user', '/etc') } : init);
    },
  },
  // The keyboard stays where it was when the new terminal is made.
  'panes-focus-stays': {
    assertion: 'panes.focus',
    section: 'panes-layout',
    engines: ['chromium'],
    stage: 'split',
    after: (page) => page.locator('[data-shell-part="panelBody"][data-pane] [data-terminal-tool="find"]').first().focus(),
  },
  // A pane is given a share that makes it 30 px wide, as a page that did not keep the minimum would.
  'panes-min-lost': {
    assertion: 'panes.min',
    section: 'panes-sash',
    engines: ['chromium'],
    stage: 'min',
    after: (page) =>
      page.evaluate(() => {
        const [first] = document.querySelectorAll('[data-shell-part="panelBody"][data-pane]');
        first.style.setProperty('--_share', '0.03');
      }),
  },
  // A double click on a sash does nothing.
  'panes-reset-lost': {
    assertion: 'panes.reset',
    section: 'panes-sash',
    engines: ['chromium'],
    init: () => {
      window.addEventListener('dblclick', (event) => event.stopImmediatePropagation(), true);
    },
  },
  // The arrow keys on a sash are taken before the sash hears them.
  'panes-keys-lost': {
    assertion: 'panes.keys',
    section: 'panes-sash',
    engines: ['chromium'],
    init: () => {
      window.addEventListener('keydown', (event) => { if (event.target?.getAttribute?.('role') === 'separator' && event.key.startsWith('Arrow')) event.stopImmediatePropagation(); }, true);
    },
  },
  // The sash is taken out of the Tab order.
  'panes-sash-not-a-stop': {
    assertion: 'panes.sash',
    section: 'panes-sash',
    engines: ['chromium'],
    stage: 'start',
    after: (page) => page.evaluate(() => document.querySelectorAll('[data-shell-part="paneSash"]').forEach((sash) => sash.setAttribute('tabindex', '-1'))),
  },
  // A pane is left at 30 px after the window is made narrower, as a page that never fitted the shares would.
  'panes-fit-lost': {
    assertion: 'panes.fit',
    section: 'panes-resize',
    engines: ['chromium'],
    stage: 'narrow',
    after: (page) =>
      page.evaluate(() => {
        const [first] = document.querySelectorAll('[data-shell-part="panelBody"][data-pane]');
        first.style.setProperty('--_share', '0.03');
      }),
  },
  // Split terminal does not say it cannot when no pane fits.
  'panes-full-enabled': {
    assertion: 'panes.full',
    section: 'panes-full',
    engines: ['chromium'],
    stage: 'full',
    after: (page) => page.evaluate(() => document.querySelectorAll('[data-terminal-tool="split"]').forEach((button) => button.removeAttribute('aria-disabled'))),
  },
  // Every WebGL context is lost 100 ms after it was made, so the next showing makes another: a context for each showing.
  'panes-gl-every-show': {
    assertion: 'panes.gl',
    section: 'panes-gl',
    engines: ['chromium'],
    init: () => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        const context = getContext.call(this, kind, ...rest);
        if (context !== null && (kind === 'webgl' || kind === 'webgl2')) setTimeout(() => context.getExtension('WEBGL_lose_context')?.loseContext(), 100);
        return context;
      };
    },
  },
  // A violation that exists only in the panes: an image with no text alternative.
  'panes-axe': {
    assertion: 'axe.panes',
    section: 'panes-axe',
    engines: ['chromium'],
    stage: 'axe',
    after: (page) =>
      page.evaluate(() => {
        const image = document.createElement('img');
        image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        document.querySelector('[data-shell-part="panelDeck"]').append(image);
      }),
  },
};

/**
 * @param {{ check: Function, note: Function, report: { numbers: Record<string, unknown> }, runAxe: Function }} deps
 */
export function createPanesSections({ check, note, report, runAxe }) {
  const sections = {};

  const perturb = async (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

  /** A page of the fixture against the probe's host: the panel is opened on the Terminal tool and a shell starts. */
  async function open(ctx, { renderer = 'dom', width } = {}) {
    const { browser, origin, viewport, control } = ctx;
    const host = createHost({ ...control?.host?.options, faults: { ...control?.host?.faults } });
    const context = await browser.newContext({ viewport: { width: width ?? viewport.width, height: viewport.height }, locale: 'en-US', timezoneId: 'UTC' });
    const served = await serveContext(context, host);
    await context.addInitScript(HELPERS);
    if (control?.init !== undefined) await context.addInitScript(control.init);
    const page = await context.newPage();
    await page.goto(`${origin}/shell/probes/terminal-fixture.html?host=shared&renderer=${renderer}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-shell-part="window"]');
    await page.click('[data-shell-part="panelToggle"]');
    await page.waitForSelector('[data-shell-part="panelEmpty"]');
    await page.click('[data-shell-part="panelEmpty"] button');
    await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
    await page.waitForFunction(() => /user@synthetic/.test(document.querySelector('.xterm-rows, [data-shell-part="terminalScreen"]')?.textContent ?? '') || document.querySelector('canvas') !== null, null, { timeout: 20_000 });
    const close = async () => {
      host.stop();
      await served.close();
      await context.close();
    };

    // The width of one column, from the one terminal there is, once the host has been told its size.
    await until(async () => host.log.created.length === 1 && colsOf(host, 0) !== null && (await bodies(page)).length === 1 && (await bodies(page))[0].screen !== null);
    const [only] = await bodies(page);
    const measured = await page.evaluate(() => window.__panes.cell());
    const cell = measured > 0 ? measured : only.screen.width / colsOf(host, 0);
    // What a screen's width holds besides its columns (the inset and the scrollbar's room), which is the same for every pane: a pane of width w has floor((w - offset) / cell) columns.
    return { page, host, context, close, cell, offset: only.screen.width - colsOf(host, 0) * cell };
  }

  /** A bounded wait for something the page or the host's log shows: the answer is whether it came. */
  const until = async (done, ms = 15_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await done()) return true;
      if (Date.now() > deadline) return false;
      await sleep(25);
    }
  };

  const bodies = (page) => page.evaluate(() => window.__panes.bodies());
  const sashes = (page) => page.evaluate(() => window.__panes.sashes());

  /** The last size the host was told for a terminal, by the order the terminals were made in. */
  const colsOf = (host, index) => {
    const id = host.log.created[index]?.id;
    const sizes = host.log.resizes.filter((entry) => entry.id === id);
    return sizes.at(-1)?.cols ?? null;
  };

  /** Presses Split terminal in the pane at `index` and waits until the host made one more terminal and the page draws one more body with its screen. */
  async function split(page, host, index) {
    const before = host.log.created.length;
    const pane = page.locator('[data-shell-part="panelDeck"] > [data-shell-part="panelBody"][data-session-id]:not([hidden])').nth(index);
    await pane.locator('[data-terminal-tool="split"]').click();
    const made = await until(() => host.log.created.length === before + 1);
    const drawn = await until(async () => (await bodies(page)).length === before + 1 && (await bodies(page)).every((one) => one.textarea));
    return made && drawn;
  }

  /** Waits until every terminal's emulator has told the host the number of columns its pane holds, within one column: a pane's columns follow its width once the size observer's frame has run. */
  async function settled(page, host, { cell, offset }) {
    return until(async () => {
      const shown = await bodies(page);
      if (shown.length !== host.log.created.length) return false;
      return shown.every((one, index) => {
        const cols = colsOf(host, index);
        return cols !== null && one.screen !== null && Math.abs(cols - Math.floor((one.screen.width - offset) / cell)) <= 1;
      });
    });
  }

  const widthsOf = (shown) => shown.map((one) => one.box.width);

  // ------------------------------------------------------------------------------------------------ panes-layout
  sections['panes-layout'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      const firstCols = colsOf(host, 0);
      const done = await split(page, host, 0);
      await perturb(ctx, page, 'split');
      const shown = await bodies(page);
      const asked = host.log.cwds.length;
      const problems = [];
      if (!done) problems.push(`a press of Split terminal made ${String(host.log.created.length)} terminals and drew ${String(shown.length)} bodies, not 2 and 2`);
      else {
        const [first, second] = host.log.created;
        if (first.id === second.id) problems.push('the second terminal has the first\'s id: a copy');
        if (asked < 1 || host.log.cwds[0] !== first.id) problems.push(`the host was asked where ${JSON.stringify(host.log.cwds)} is, not where the first terminal (${first.id}) is`);
        if (second.cwd !== '/home/user') problems.push(`the second terminal was asked to start in ${JSON.stringify(second.cwd)}, not in /home/user, the directory the host said the first was in`);
        if (shown[1].box.x <= shown[0].box.x) problems.push('the second body is not to the right of the first');
      }

      check('panes.split', problems.length === 0, `${tag}: Split terminal in the first pane: ${problems.length === 0 ? 'a second terminal under another id, asked to start in /home/user where the host said the first is, and drawn beside it' : problems.join('; ')}`);

      // The panes share the room equally, none under 80 px, and with the sash they fill the deck.
      const deck = await page.evaluate(() => window.__panes.deck());
      const lines = await sashes(page);
      const [a, b] = widthsOf(shown);
      const equalProblems = [];
      if (shown.length !== 2) equalProblems.push(`${String(shown.length)} bodies drawn`);
      else {
        if (!near(a, b, 1)) equalProblems.push(`the panes are ${String(rounded(a))} and ${String(rounded(b))} px wide, not equal within 1 px`);
        if (Math.min(a, b) < 80) equalProblems.push(`a pane is ${String(rounded(Math.min(a, b)))} px wide, under 80`);
        if (lines.length !== 1) equalProblems.push(`${String(lines.length)} sashes, not 1`);
        else if (!near(a + b + lines[0].box.width, deck.clientWidth, 1)) equalProblems.push(`the panes and the sash (${String(rounded(a + b + lines[0].box.width))} px) do not fill the deck (${String(deck.clientWidth)} px)`);
        if (shown.some((one) => Math.abs(one.box.y - shown[0].box.y) > 1 || Math.abs(one.box.height - shown[0].box.height) > 1)) equalProblems.push('the panes are not the same height and on one line');
      }

      check('panes.equal', equalProblems.length === 0, `${tag}: two panes: ${equalProblems.length === 0 ? `${String(rounded(a))} and ${String(rounded(b))} px of a deck of ${String(deck.clientWidth)} px, with a sash of ${String(lines[0]?.box.width)} px` : equalProblems.join('; ')}`);

      // The new terminal has the keyboard.
      const focus = await page.waitForFunction(() => window.__panes.focus().index === 1, null, { timeout: 10_000 }).then(() => true, () => false);
      const where = await page.evaluate(() => window.__panes.focus());
      check('panes.focus', focus, `${tag}: after the split the keyboard is ${focus ? 'in the new terminal (the second pane)' : `in pane ${String(where.index)} (${JSON.stringify(where)}), not the new terminal`}`);

      // Each emulator's columns are its pane's: the first lost columns, and the two have as many as their equal widths hold.
      const ok = await settled(page, host, session);
      const colsA = colsOf(host, 0);
      const colsB = colsOf(host, 1);
      const colProblems = [];
      if (!ok) colProblems.push('the emulators never told the host a size that fits their pane');
      if (!(colsA < firstCols)) colProblems.push(`the first terminal has ${String(colsA)} columns after the split, as many as before (${String(firstCols)}): it was not resized`);
      if (Math.abs(colsA - colsB) > 1) colProblems.push(`the terminals have ${String(colsA)} and ${String(colsB)} columns in panes of equal width`);
      check('panes.cols', colProblems.length === 0, `${tag}: ${colProblems.length === 0 ? `${String(firstCols)} columns became ${String(colsA)} and ${String(colsB)}, one terminal in each pane` : colProblems.join('; ')}`);
      report.numbers[`panes-layout ${tag}`] = { widths: [a, b], deck: deck.clientWidth, cols: [firstCols, colsA, colsB] };

      // A third split, from the last pane.
      const third = await split(page, host, 1);
      const three = await bodies(page);
      const threeLines = await sashes(page);
      const threeProblems = [];
      if (!third) threeProblems.push('a third split was not made');
      else {
        const widths = widthsOf(three);
        if (Math.max(...widths) - Math.min(...widths) > 1) threeProblems.push(`the panes are ${widths.map(rounded).join(', ')} px wide, not equal within 1 px`);
        if (Math.min(...widths) < 80) threeProblems.push('a pane is under 80 px');
        if (threeLines.length !== 2) threeProblems.push(`${String(threeLines.length)} sashes, not 2`);
        if (host.log.created.length !== 3 || new Set(host.log.created.map((made) => made.id)).size !== 3) threeProblems.push('three distinct terminals were not made');
      }

      check('panes.three', threeProblems.length === 0, `${tag}: three panes: ${threeProblems.length === 0 ? `${widthsOf(three).map(rounded).join(', ')} px, two sashes, three terminals` : threeProblems.join('; ')}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ panes-sash
  sections['panes-sash'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await split(page, host, 0);
      await settled(page, host, session);
      await perturb(ctx, page, 'start');
      const [start] = await sashes(page);
      const startWidths = widthsOf(await bodies(page));
      const stop = await page.evaluate(() => window.__panes.sashes()[0].tabIndex);
      const centre = { x: start.box.x + start.box.width / 2, y: start.box.y + start.box.height / 2 };
      const hits = await page.evaluate(({ x, y }) => [-3, 0, 3].map((dx) => window.__panes.hit(x + dx, y)), centre);
      const sashProblems = [];
      if (stop !== 0) sashProblems.push(`the sash's tabindex is ${String(stop)}, not 0`);
      if (hits.some((part) => part !== 'paneSash')) sashProblems.push(`the pointer 3 px either side of the line (and on it) reaches ${JSON.stringify(hits)}, not the sash: the hit area is not wider than the line`);
      if (start.orientation !== 'vertical') sashProblems.push(`its orientation is ${String(start.orientation)}, not vertical`);
      await page.locator('[data-shell-part="paneSash"]').focus();
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-shell-part'));
      if (focused !== 'paneSash') sashProblems.push(`focus() leaves the keyboard on ${String(focused)}`);
      check('panes.sash', sashProblems.length === 0, `${tag}: the sash: ${sashProblems.length === 0 ? 'a Tab stop (tabindex 0), vertical, and the pointer reaches it 3 px either side of its line' : sashProblems.join('; ')}`);

      // A drag by 150 px to the left.
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x - 75, centre.y, { steps: 5 });
      await page.mouse.move(centre.x - 150, centre.y, { steps: 5 });
      await page.mouse.up();
      const moved = await until(async () => near(widthsOf(await bodies(page))[0], startWidths[0] - 150, 2));
      const after = widthsOf(await bodies(page));
      const colsBefore = [colsOf(host, 0), colsOf(host, 1)];
      const followed = await until(() => colsOf(host, 0) !== colsBefore[0] || colsOf(host, 1) !== colsBefore[1]);
      await settled(page, host, session);
      const colsAfter = [colsOf(host, 0), colsOf(host, 1)];
      const dragProblems = [];
      if (!moved) dragProblems.push(`the first pane is ${String(rounded(after[0]))} px wide after a drag of 150 px to the left, not ${String(rounded(startWidths[0] - 150))}`);
      if (!near(after[0] + after[1], startWidths[0] + startWidths[1], 1)) dragProblems.push('the two panes do not hold what they held together');
      if (!followed) dragProblems.push('no emulator was resized by the drag');
      if (!(colsAfter[0] < colsAfter[1])) dragProblems.push(`the terminals have ${colsAfter.join(' and ')} columns in panes of ${after.map(rounded).join(' and ')} px`);
      const [now] = (await sashes(page)).map((one) => one.now);
      if (Math.abs(now - Math.round((after[0] / (after[0] + after[1])) * 100)) > 1) dragProblems.push(`the sash's value is ${String(now)}, not ${String(Math.round((after[0] / (after[0] + after[1])) * 100))} percent`);
      check('panes.drag', dragProblems.length === 0, `${tag}: a drag of 150 px: ${dragProblems.length === 0 ? `${startWidths.map(rounded).join(' and ')} became ${after.map(rounded).join(' and ')} px, the emulators have ${colsAfter.join(' and ')} columns, the sash says ${String(now)} percent` : dragProblems.join('; ')}`);

      // A drag past either end stops at 80 px.
      const grab = async () => {
        const [line] = await sashes(page);
        return { x: line.box.x + line.box.width / 2, y: line.box.y + line.box.height / 2 };
      };
      let at = await grab();
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x - 2000, at.y, { steps: 10 });
      await page.mouse.up();
      await until(async () => widthsOf(await bodies(page))[0] < 90);
      await perturb(ctx, page, 'min');
      const low = widthsOf(await bodies(page));
      at = await grab();
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x + 4000, at.y, { steps: 10 });
      await page.mouse.up();
      await until(async () => widthsOf(await bodies(page))[1] < 90);
      const high = widthsOf(await bodies(page));
      const minProblems = [];
      if (low[0] < 79.5 || low[0] > 81) minProblems.push(`dragged to the far left the first pane is ${String(rounded(low[0]))} px, not 80`);
      if (high[1] < 79.5 || high[1] > 81) minProblems.push(`dragged to the far right the second pane is ${String(rounded(high[1]))} px, not 80`);
      check('panes.min', minProblems.length === 0, `${tag}: a drag far past either end: ${minProblems.length === 0 ? `the first pane stops at ${String(rounded(low[0]))} px and the second at ${String(rounded(high[1]))} px` : minProblems.join('; ')}`);

      // A double click shares the room equally.
      at = await grab();
      await page.mouse.dblclick(at.x, at.y);
      const equal = await until(async () => {
        const [x, y] = widthsOf(await bodies(page));
        return near(x, y, 1);
      });
      const equalWidths = widthsOf(await bodies(page));
      check('panes.reset', equal, `${tag}: a double click on the sash: ${equal ? `${equalWidths.map(rounded).join(' and ')} px` : `the panes are ${equalWidths.map(rounded).join(' and ')} px, not equal`}`);

      // The keys.
      await page.locator('[data-shell-part="paneSash"]').focus();
      const keyProblems = [];
      const width = async () => widthsOf(await bodies(page))[0];
      const base = await width();
      await page.keyboard.press('ArrowRight');
      if (!(await until(async () => near(await width(), base + 16, 1.5)))) keyProblems.push(`ArrowRight moved the line to ${String(rounded(await width()))} px, not ${String(rounded(base + 16))}`);
      const afterRight = await width();
      await page.keyboard.press('Shift+ArrowLeft');
      if (!(await until(async () => near(await width(), afterRight - 64, 1.5)))) keyProblems.push(`Shift+ArrowLeft moved the line to ${String(rounded(await width()))} px, not ${String(rounded(afterRight - 64))}`);
      await page.keyboard.press('Home');
      if (!(await until(async () => near(await width(), 80, 1)))) keyProblems.push(`Home left the first pane at ${String(rounded(await width()))} px, not 80`);
      await page.keyboard.press('Enter');
      if (!(await until(async () => near(await width(), base, 1.5)))) keyProblems.push(`Enter left the first pane at ${String(rounded(await width()))} px, not ${String(rounded(base))}`);
      check('panes.keys', keyProblems.length === 0, `${tag}: the sash's keys: ${keyProblems.length === 0 ? 'ArrowRight +16 px, Shift+ArrowLeft -64 px, Home to 80 px, Enter equal again' : keyProblems.join('; ')}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ panes-resize
  sections['panes-resize'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await split(page, host, 0);
      await split(page, host, 1);
      await settled(page, host, session);
      // The first pane is dragged to its minimum, the window is made narrower, and every pane keeps at least 80 px with nothing overflowing.
      await page.locator('[data-shell-part="paneSash"]').first().focus();
      await page.keyboard.press('Home');
      await until(async () => near(widthsOf(await bodies(page))[0], 80, 1));
      const width = ctx.viewport.width;
      await page.setViewportSize({ width: Math.round(width * 0.6), height: ctx.viewport.height });
      await perturb(ctx, page, 'narrow');
      const fitted = await until(async () => {
        const shown = await bodies(page);
        const deck = await page.evaluate(() => window.__panes.deck());
        return shown.length === 3 && Math.min(...widthsOf(shown)) >= 79.5 && deck.scrollWidth <= deck.clientWidth + 1;
      });
      const narrow = widthsOf(await bodies(page));
      const deck = await page.evaluate(() => window.__panes.deck());
      check('panes.fit', fitted, `${tag}: the window made ${String(Math.round(width * 0.6))} px wide with the first pane at its minimum: ${fitted ? `${narrow.map(rounded).join(', ')} px of a deck of ${String(deck.clientWidth)} px, nothing overflows` : `the panes are ${narrow.map(rounded).join(', ')} px of a deck of ${String(deck.clientWidth)} px (scroll ${String(deck.scrollWidth)})`}`);

      // The window changes while the sash is dragged.
      await page.setViewportSize({ width, height: ctx.viewport.height });
      await until(async () => (await page.evaluate(() => window.__panes.deck())).clientWidth > Math.round(width * 0.6) + 100);
      const [line] = await sashes(page);
      const at = { x: line.box.x + line.box.width / 2, y: line.box.y + line.box.height / 2 };
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x + 40, at.y, { steps: 4 });
      await page.setViewportSize({ width: Math.round(width * 0.6), height: ctx.viewport.height });
      await page.mouse.move(at.x - 3000, at.y, { steps: 6 });
      await page.mouse.up();
      const settledAgain = await until(async () => {
        const shown = await bodies(page);
        return shown.length === 3 && Math.min(...widthsOf(shown)) >= 79.5;
      });
      const widths = widthsOf(await bodies(page));
      check('panes.drag-resize', settledAgain, `${tag}: the window made narrower in the middle of a drag: ${settledAgain ? `${widths.map(rounded).join(', ')} px, none under 80` : `the panes are ${widths.map(rounded).join(', ')} px`}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ panes-full
  sections['panes-full'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    // A window just wide enough for a few panes: the panel's deck is the window less the rail and the margins.
    const session = await open(ctx, { width: 520 });
    const { page, host } = session;
    try {
      let made = 1;
      for (let guard = 0; guard < 12; guard += 1) {
        const last = (await bodies(page)).length - 1;
        const state = await page.evaluate((index) => window.__panes.split(index), last);
        if (state === null || state.disabled) break;
        if (!(await split(page, host, last))) break;
        made += 1;
      }

      await perturb(ctx, page, 'full');
      const shown = await bodies(page);
      const last = await page.evaluate((index) => window.__panes.split(index), shown.length - 1);
      const deck = await page.evaluate(() => window.__panes.deck());
      const before = host.log.created.length;
      await page.locator('[data-shell-part="panelDeck"] > [data-shell-part="panelBody"][data-session-id]:not([hidden])').nth(shown.length - 1).locator('[data-terminal-tool="split"]').click({ force: true });
      await sleep(250);
      const problems = [];
      if (made < 2) problems.push(`only ${String(made)} pane(s) fit in a deck of ${String(deck.clientWidth)} px`);
      if (last === null || !last.disabled) problems.push('Split terminal does not say it cannot when no other pane fits');
      else if (!/No room/.test(last.described)) problems.push(`it says ${JSON.stringify(last.described)}, not why (no room)`);
      if (host.log.created.length !== before) problems.push('a press with no room started a terminal');
      if (Math.min(...widthsOf(shown)) < 79.5) problems.push(`a pane is ${String(rounded(Math.min(...widthsOf(shown))))} px, under 80`);
      if (shown.length * 80 > deck.clientWidth) problems.push(`${String(shown.length)} panes of 80 px do not fit a deck of ${String(deck.clientWidth)} px`);
      check('panes.full', problems.length === 0, `${tag}: a deck of ${String(deck.clientWidth)} px: ${problems.length === 0 ? `${String(shown.length)} panes (${widthsOf(shown).map(rounded).join(', ')} px), then Split terminal says "${last.described}" and starts nothing` : problems.join('; ')}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ panes-gl
  sections['panes-gl'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx, { renderer: 'gpu' });
    const { page, host } = session;
    try {
      await split(page, host, 0);
      await split(page, host, 1);
      await settled(page, host, session);
      const first = await page.evaluate(() => window.__gl.made);
      for (let cycle = 0; cycle < 10; cycle += 1) {
        await page.click('[data-shell-part="panelToggle"]');
        await page.waitForFunction(() => document.querySelector('[data-shell-region="panel"]')?.hidden === true, null, { timeout: 10_000 });
        await page.click('[data-shell-part="panelToggle"]');
        await until(async () => (await bodies(page)).length === 3);
      }

      const last = await page.evaluate(() => window.__gl.made);
      const terminals = host.log.created.length;
      const problems = [];
      if (terminals !== 3) problems.push(`${String(terminals)} terminals, not 3`);
      if (last > terminals) problems.push(`${String(last)} WebGL contexts for ${String(terminals)} terminals after 10 hidings and showings`);
      if (last > first) problems.push(`the contexts grew from ${String(first)} to ${String(last)} across the hidings and showings`);
      check('panes.gl', problems.length === 0, `${tag}: three panes hidden and shown ten times: ${problems.length === 0 ? `${String(first)} WebGL contexts after the first showing and ${String(last)} after the tenth, for 3 terminals` : problems.join('; ')}`);
      report.numbers[`panes-gl ${tag}`] = { first, last, terminals };
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ panes-axe
  sections['panes-axe'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await split(page, host, 0);
      await split(page, host, 1);
      await settled(page, host, session);
      await page.addScriptTag({ path: AXE });
      await perturb(ctx, page, 'axe');
      const found = await runAxe(page, '[data-shell-part="panelDeck"]');
      check('axe.panes', found.length === 0, `${tag}: axe-core on three panes and their sashes: ${found.length === 0 ? 'no violation' : found.join('; ')}`);
      report.numbers[`panes-axe ${tag}`] = { violations: found.length };
    } finally {
      await session.close();
    }
  };

  return sections;
}

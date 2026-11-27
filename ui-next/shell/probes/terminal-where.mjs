// Where a terminal opens and what it is called (issue #695 steps 2 to 5), in a real browser, in both engines at both viewports: the menu beside the `+` that lists the shells of the machine, the tab that shows a program's title while it runs
// (and the shell's name after it, and nothing of a hostile title but its text, bounded), the rename in place, and the lane of an ended terminal that offers Restart. The far end is the probe's own host (terminal-host.mjs), whose synthetic shell
// has the commands `title <text>`, `untitle` and `title-hostile` (the host's frame of protocol 4b: the title and whether a program runs); the list of shells is the fixture's (`?shells=`, terminal-fixture.tsx). What this proves is what only a
// real renderer shows: where the arrow and the rows are DRAWN, where the keyboard is after Escape, what the tab says and how wide it is, where the field of a rename is, and what the lane and the emulator show after a restart. The page's rules
// (which title wins, the pin of a rename, the fresh id of a restart) are proved by the unit tests of the registry and of the feed; the real shells, the real host and the real zsh and bash are the seam's (scenario r9).
//
// Every section waits for a state and never for a time (the host's log counts what it sent). `WHERE_CONTROLS` is each control's fault in the shape of the probe's own table; each section has one check for each thing it proves and a control for each check.
//   where-menu  the arrow beside the `+` and the rows of its menu (where.menu-rows: the shells in the host's order, each with its path, the default marked), the keyboard (where.menu-keys: Enter opens it, Escape closes it and gives the keyboard back to the
//               arrow) and the choice (where.menu-start: a shell chosen is asked of the host by its path, and its tab is named after it until the host names it)
//   where-tab   a program's title is on the tab while it runs and the shell's name is back after it (where.title); a hostile title (a control character, a right-to-left override, markup, 100,000 characters) is text, bounded, and the tab keeps
//               its width (where.title-bound); a rename is a field in the tab, Escape leaves the name, Enter gives it and the keyboard goes back to the tab, and a program's title does not take it back (where.rename)
//   where-lane  the lane of an ended terminal offers Restart, drawn inside it (where.restart-offer); Enter in the screen starts a shell under another id in the same tab, and what the ended shell printed is still above the new one's banner (where.restart)
//   where-axe   axe-core finds nothing in the lane that offers Restart (axe.where). The menu of shells is read too and its finding is a GAP, noted and not asserted: axe's label-content-name-mismatch on its rows (the row's accessible name is the shell's name and its visible words are the name, "Default" and the path), a defect of the kit's menu rows that the Terminal tool does not own
import { createHost } from './terminal-host.mjs';
import { AXE } from './harness.mjs';
import { serveContext } from './terminal-serve.mjs';

/** The shells the host says it found: the first is the default, which the menu marks. */
const SHELLS = 'bash=/bin/bash*,zsh=/usr/bin/zsh,fish=/usr/local/bin/fish';
const TITLE = 'seam program title';
const NAME = 'my name';
const OTHER_TITLE = 'another title';

/** Chromium says it runs on Linux (the seam's way), so that the chords of the platforms that are not a Mac are run on a Mac too. WebKit says what it is. */
const LINUX = () => {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64', configurable: true });
};

/** What the sections read of the page, in the page, in one task: the tabs (their words, boxes and the markup in them), the add button and its arrow, the lane and its Restart, and the requests the page made of the runtime. */
const HELPERS = () => {
  const where = (window.__where = {});
  const box = (element) => {
    if (element === null || element === undefined) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  where.tabs = () => [...document.querySelectorAll('[data-shell-part="sessionTabs"] [role="tab"]')];
  where.labels = () => where.tabs().map((tab) => tab.getAttribute('aria-label') ?? '');
  where.strip = () => box(document.querySelector('[data-shell-part="sessionTabs"]'));
  where.item = (index) => box(where.tabs()[index]?.closest('[data-shell-part="sessionTab"]') ?? null);
  where.markup = (index) => where.tabs()[index]?.querySelectorAll('b, i, a, img, script').length ?? -1;
  where.focus = () => {
    const active = document.activeElement;
    return { part: active?.getAttribute('data-shell-part') ?? null, role: active?.getAttribute('role') ?? null, tag: active?.tagName ?? null, label: active?.getAttribute('aria-label') ?? null };
  };
  where.add = () => ({ plus: box(document.querySelector('[data-shell-part="sessionAdd"] button')), arrow: box(document.querySelector('[data-shell-part="sessionAddChoice"]')) });
  where.lane = () => ({ lane: box([...document.querySelectorAll('[data-shell-part="terminalLane"]')].find((lane) => lane.getClientRects().length > 0) ?? null), restart: box(document.querySelector('[data-shell-part="terminalRestart"]')), words: document.querySelector('[data-shell-part="terminalRestart"]')?.textContent ?? null });
  where.rows = () => [...document.querySelectorAll('.xterm-rows > div')].map((row) => (row.textContent ?? '').replaceAll('\u00a0', ' ').trimEnd()).join('\n');
  /** What the page put on the clipboard, in order: the copy of the whole buffer of the emulator is the transcript. */
  where.copied = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        where.copied.push(String(text));
      },
      readText: async () => '',
    },
  });
  /** The requests the page made of the host's runtime, as text, in order (what a choice in the menu asks for). */
  where.calls = [];
  const send = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (String(input instanceof Request ? input.url : input).includes('/wails/runtime') && typeof init?.body === 'string') where.calls.push(init.body);
    return send(input, init);
  };
};

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const WHERE_PARTS = {
  where: ['where-menu', 'where-tab', 'where-lane', 'where-axe'],
};

const plant = (page) =>
  page.evaluate(() => {
    const image = document.createElement('img');
    image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    document.querySelector('[data-shell-part="terminalBody"]').append(image);
  });

/**
 * The negative controls: a fault of the page (`init` before the page's own scripts, `after` at the `stage` the section names) or of the host (`host.faults`). Each runs in Chromium: what it proves does not depend on the engine.
 */
export const WHERE_CONTROLS = {
  // The menu lists the shells but does not say which one is the default.
  'where-menu-default-unmarked': {
    assertion: 'where.menu-rows',
    section: 'where-menu',
    engines: ['chromium'],
    stage: 'menu',
    after: (page) =>
      page.evaluate(() => {
        for (const item of document.querySelectorAll('[role="menu"] [role="menuitem"]')) {
          const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) node.textContent = (node.textContent ?? '').replace('Default', '');
        }
      }),
  },
  // Escape closes the menu and the keyboard is left on nothing.
  'where-menu-focus-lost': {
    assertion: 'where.menu-keys',
    section: 'where-menu',
    engines: ['chromium'],
    init: () => {
      window.addEventListener(
        'keyup',
        (event) => {
          if (event.key === 'Escape' && document.activeElement instanceof HTMLElement) document.activeElement.blur();
        },
        true,
      );
    },
  },
  // The page asks the host for another shell than the one that was chosen.
  'where-menu-wrong-shell': {
    assertion: 'where.menu-start',
    section: 'where-menu',
    engines: ['chromium'],
    init: () => {
      const send = window.fetch.bind(window);
      window.fetch = (input, init) => send(input, typeof init?.body === 'string' ? { ...init, body: init.body.replaceAll('/usr/bin/zsh', '/bin/sh') } : init);
    },
  },
  // The host says a program still runs after it has ended: the title stays on the tab.
  'where-title-kept': { assertion: 'where.title', section: 'where-tab', engines: ['chromium'], host: { faults: { titleKept: true } } },
  // The tab carries a title that was never cleaned: a control character, markup and 300 characters.
  'where-title-raw': {
    assertion: 'where.title-bound',
    section: 'where-tab',
    engines: ['chromium'],
    stage: 'bound',
    after: (page) =>
      page.evaluate(() => {
        const tab = document.querySelector('[data-shell-part="sessionTabs"] [role="tab"]');
        tab.setAttribute('aria-label', `ab\u0001cd${'x'.repeat(300)}`);
        const head = tab.querySelector('[data-shell-part="sessionHead"]');
        head.innerHTML = '<b>raw</b>';
      }),
  },
  // A program's title takes the name the person gave the tab.
  'where-rename-unpinned': {
    assertion: 'where.rename',
    section: 'where-tab',
    engines: ['chromium'],
    stage: 'pinned',
    after: (page) => page.evaluate((title) => document.querySelector('[data-shell-part="sessionTabs"] [role="tab"]').setAttribute('aria-label', title), OTHER_TITLE),
  },
  // The lane of an ended terminal has a Restart that is not drawn.
  'where-restart-hidden': {
    assertion: 'where.restart-offer',
    section: 'where-lane',
    engines: ['chromium'],
    stage: 'ended',
    after: (page) => page.addStyleTag({ content: '[data-shell-part="terminalRestart"]{display:none !important}' }),
  },
  // The transcript of the ended terminal is gone once the new shell runs: the screen is cleared.
  'where-restart-transcript-lost': {
    assertion: 'where.restart',
    section: 'where-lane',
    engines: ['chromium'],
    stage: 'restarted',
    after: async (page) => {
      await page.locator('[data-terminal-tool="clear"]').click();
    },
  },
  // A violation that exists only in the panel: an image with no text alternative.
  'where-axe': { assertion: 'axe.where', section: 'where-axe', engines: ['chromium'], stage: 'axe', after: (page) => plant(page) },
};

/**
 * @param {{ check: Function, note: Function, report: { numbers: Record<string, unknown> }, runAxe: Function }} deps
 */
export function createWhereSections({ check, note, report, runAxe }) {
  const sections = {};

  const perturb = async (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

  /** A page of the fixture against the probe's host: the panel is opened on the Terminal tool and a shell starts. `shells` gives the page the host's list of shells. */
  async function open(ctx, { shells = false } = {}) {
    const { browser, origin, viewport, control } = ctx;
    const host = createHost({ ...control?.host?.options, faults: { ...control?.host?.faults } });
    const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
    const served = await serveContext(context, host);
    await context.addInitScript(HELPERS);
    if (ctx.engine === 'chromium') await context.addInitScript(LINUX);
    if (control?.init !== undefined) await context.addInitScript(control.init);
    const page = await context.newPage();
    const query = ['host=shared', 'renderer=dom', shells ? `shells=${SHELLS}` : '', control?.query].filter((part) => part !== undefined && part !== '').join('&');
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

  /** A bounded wait for something the host's log or the page shows: the answer is whether it came. */
  const until = async (done, ms = 15_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await done()) return true;
      if (Date.now() > deadline) return false;
      await sleep(50);
    }
  };

  const labelIs = (page, index, text) => until(async () => (await page.evaluate(() => window.__where.labels()))[index] === text);

  /** Types a line into the terminal and waits until the host has sent the title frame it makes (`count` more). */
  const titled = async (page, host, line, count = 1) => {
    const before = host.log.titles.length;
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
    return until(() => host.log.titles.length >= before + count);
  };

  const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  // ------------------------------------------------------------------------------------------------ where-menu
  sections['where-menu'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx, { shells: true });
    const { page } = session;
    try {
      const arrow = page.locator('[data-shell-part="sessionAddChoice"]');
      const present = await arrow.waitFor({ timeout: 15_000 }).then(() => true, () => false);
      const placed = await page.evaluate(() => window.__where.add());
      await arrow.click();
      const menu = page.getByRole('menu');
      const opened = await menu.waitFor({ timeout: 5_000 }).then(() => true, () => false);
      await perturb(ctx, page, 'menu');
      const rows = opened ? await menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => (item.textContent ?? '').replace(/\s+/g, ' ').trim())) : [];
      const problems = [];
      if (!present) problems.push('there is no arrow beside the +');
      else {
        const { plus, arrow: shape } = placed;
        if (Math.abs(plus.height - shape.height) > 1 || Math.abs(plus.y - shape.y) > 1) problems.push(`the arrow (${JSON.stringify([Math.round(shape.y), Math.round(shape.height)])}) is not as high and as tall as the + (${JSON.stringify([Math.round(plus.y), Math.round(plus.height)])})`);
        const gap = shape.x - plus.right;
        if (gap < -1 || gap > 8) problems.push(`the arrow is ${String(Math.round(gap))} px from the +, not beside it`);
      }

      if (rows.length !== 3) problems.push(`${String(rows.length)} rows for 3 shells (${JSON.stringify(rows)})`);
      else {
        for (const [index, [name, path]] of [['bash', '/bin/bash'], ['zsh', '/usr/bin/zsh'], ['fish', '/usr/local/bin/fish']].entries()) {
          if (!rows[index].includes(name) || !rows[index].includes(path)) problems.push(`row ${String(index)} says ${JSON.stringify(rows[index])}, not ${name} and ${path}`);
          if (rows[index].includes('Default') !== (index === 0)) problems.push(`row ${String(index)} ${index === 0 ? 'does not say Default' : 'says Default'} (${JSON.stringify(rows[index])})`);
        }
      }

      check('where.menu-rows', problems.length === 0, `${tag}: the menu beside the +: ${problems.length === 0 ? 'the arrow is beside the + and as high, and the rows are bash (Default), zsh and fish, each with its path' : problems.join('; ')}`);
      note(`where menu ${tag}: ${JSON.stringify(rows)}`);
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);

      // The keyboard: Enter on the arrow opens the menu, Escape closes it and the arrow has the keyboard again.
      await arrow.focus();
      await page.keyboard.press('Enter');
      const openedByKey = await menu.waitFor({ timeout: 5_000 }).then(() => true, () => false);
      await page.keyboard.press('Escape');
      const closed = await menu.waitFor({ state: 'detached', timeout: 5_000 }).then(() => true, () => false);
      const back = await page.evaluate(() => window.__where.focus());
      const keys = [];
      if (!openedByKey) keys.push('Enter on the arrow did not open the menu');
      if (!closed) keys.push('Escape did not close the menu');
      if (back.part !== 'sessionAddChoice') keys.push(`after Escape the keyboard is on ${JSON.stringify(back)}, not on the arrow`);
      check('where.menu-keys', keys.length === 0, `${tag}: ${keys.length === 0 ? 'Enter on the arrow opens the menu, Escape closes it and the keyboard is on the arrow again' : keys.join('; ')}`);

      // The choice: zsh, by the pointer. The page asks the host for that shell by its path, and the tab is named after it until the host names the shell.
      await arrow.click();
      await menu.waitFor({ timeout: 5_000 });
      await menu.getByRole('menuitem', { name: /^zsh/ }).click();
      const tabbed = await until(async () => (await page.evaluate(() => window.__where.labels())).some((label) => /^zsh/.test(label)));
      const calls = await page.evaluate(() => window.__where.calls.filter((body) => body.includes('/usr/bin/zsh') || body.includes('/bin/sh')));
      const asked = calls.some((body) => body.includes('/usr/bin/zsh'));
      check('where.menu-start', tabbed && asked, `${tag}: zsh chosen in the menu: ${tabbed ? 'a tab named zsh' : 'NO tab named zsh'}, ${asked ? 'and the host was asked for /usr/bin/zsh' : `and the host was NOT asked for /usr/bin/zsh (${String(calls.length)} calls name a shell)`}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ where-tab
  sections['where-tab'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      const [first] = await page.evaluate(() => window.__where.labels());
      // A program's title is on the tab while it runs, and the shell's name is back after it.
      const said = await titled(page, host, `title ${TITLE}`);
      const shown = await labelIs(page, 0, TITLE);
      const ended = await titled(page, host, 'untitle');
      const back = await labelIs(page, 0, first);
      const titleProblems = [];
      if (!said || !shown) titleProblems.push(`the tab says ${JSON.stringify((await page.evaluate(() => window.__where.labels()))[0])} while a program runs, not ${JSON.stringify(TITLE)}`);
      if (!ended || !back) titleProblems.push(`the tab says ${JSON.stringify((await page.evaluate(() => window.__where.labels()))[0])} after the program ended, not ${JSON.stringify(first)}`);
      check('where.title', titleProblems.length === 0, `${tag}: ${titleProblems.length === 0 ? `a program's title ${JSON.stringify(TITLE)} is on the tab while it runs and ${JSON.stringify(first)} is back after it` : titleProblems.join('; ')}`);

      // A hostile title: text, bounded, and the tab keeps its width.
      const sent = await titled(page, host, 'title-hostile');
      await until(async () => /^abcd/.test((await page.evaluate(() => window.__where.labels()))[0] ?? ''));
      await perturb(ctx, page, 'bound');
      const read = await page.evaluate(() => ({ label: window.__where.labels()[0], markup: window.__where.markup(0), item: window.__where.item(0), strip: window.__where.strip() }));
      const boundProblems = [];
      if (!sent) boundProblems.push('the host never sent the title');
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(read.label)) boundProblems.push(`the tab's name has a control or direction character (${JSON.stringify(read.label.slice(0, 20))})`);
      if (!read.label.startsWith('abcdevil<b>x</b>xxxx')) boundProblems.push(`the tab's name starts ${JSON.stringify(read.label.slice(0, 24))}, not the title's text with the control character and the override gone`);
      if (new TextEncoder().encode(read.label).length > 256) boundProblems.push(`the tab's name is ${String(read.label.length)} characters, over the 256 bytes of a title`);
      if (read.markup !== 0) boundProblems.push(`${String(read.markup)} elements of markup in the tab: the title is not text`);
      if (read.item.right > read.strip.right + 1) boundProblems.push(`the tab ends at ${String(Math.round(read.item.right))}, past the strip's end at ${String(Math.round(read.strip.right))}`);
      check('where.title-bound', boundProblems.length === 0, `${tag}: a title with a control character, a right-to-left override, markup and 100,000 characters: ${boundProblems.length === 0 ? 'the tab says its text, at most 256 bytes, as text, inside the strip' : boundProblems.join('; ')}`);
      await titled(page, host, 'untitle');
      await labelIs(page, 0, first);

      // A rename is a field in the tab: Escape leaves the name, Enter gives it and the keyboard goes back to the tab, and a program's title does not take the name.
      const itemBox = await page.evaluate(() => window.__where.item(0));
      await page.locator('[data-shell-part="sessionTabs"] [role="tab"]').first().dblclick();
      const field = page.getByRole('textbox', { name: 'Session name' });
      const drawn = await field.waitFor({ timeout: 5_000 }).then(() => true, () => false);
      const fieldBox = drawn ? await field.boundingBox() : null;
      const renameProblems = [];
      if (!drawn) renameProblems.push('a double click on the tab drew no field');
      else {
        if (fieldBox.x < itemBox.x - 2 || fieldBox.right > itemBox.right + 2 || fieldBox.y < itemBox.y - 2 || fieldBox.y + fieldBox.height > itemBox.bottom + 2) {
          renameProblems.push(`the field (${JSON.stringify([fieldBox.x, fieldBox.y, fieldBox.width, fieldBox.height].map(Math.round))}) is not inside the tab (${JSON.stringify([itemBox.x, itemBox.y, itemBox.width, itemBox.height].map(Math.round))})`);
        }

        await field.fill('not kept');
        await field.press('Escape');
        await field.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
        const unchanged = (await page.evaluate(() => window.__where.labels()))[0];
        if (unchanged !== first) renameProblems.push(`Escape left the name ${JSON.stringify(unchanged)}, not ${JSON.stringify(first)}`);
        await page.locator('[data-shell-part="sessionTabs"] [role="tab"]').first().dblclick();
        await field.waitFor({ timeout: 5_000 });
        await field.fill(NAME);
        await field.press('Enter');
        const named = await labelIs(page, 0, NAME);
        if (!named) renameProblems.push(`Enter left the name ${JSON.stringify((await page.evaluate(() => window.__where.labels()))[0])}, not ${JSON.stringify(NAME)}`);
        const focus = await page.evaluate(() => window.__where.focus());
        if (focus.role !== 'tab') renameProblems.push(`after Enter the keyboard is on ${JSON.stringify(focus)}, not on the tab`);
        // A program sets a title: the host's frame reaches the page, and the name stays.
        const reached = await titled(page, host, `title ${OTHER_TITLE}`);
        await frames(page);
        await perturb(ctx, page, 'pinned');
        const kept = (await page.evaluate(() => window.__where.labels()))[0];
        if (!reached) renameProblems.push('the host never sent the title');
        if (kept !== NAME) renameProblems.push(`a program's title ${JSON.stringify(OTHER_TITLE)} took the tab's name: it says ${JSON.stringify(kept)}, not ${JSON.stringify(NAME)}`);
      }

      check('where.rename', renameProblems.length === 0, `${tag}: ${renameProblems.length === 0 ? `a double click draws the field in the tab, Escape leaves the name, Enter gives ${JSON.stringify(NAME)} and the keyboard goes back to the tab, and a program's title does not take it` : renameProblems.join('; ')}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ where-lane
  sections['where-lane'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      const [first] = await page.evaluate(() => window.__where.labels());
      await page.keyboard.type('hello');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /hello from the synthetic shell/.test(window.__where.rows()), null, { timeout: 15_000 });
      await page.keyboard.type('exit');
      await page.keyboard.press('Enter');
      const offered = await page.waitForSelector('[data-shell-part="terminalRestart"]', { state: 'attached', timeout: 15_000 }).then(() => true, () => false);
      await perturb(ctx, page, 'ended');
      const lane = await page.evaluate(() => window.__where.lane());
      const offerProblems = [];
      if (!offered) offerProblems.push('the lane of an ended terminal has no Restart');
      else {
        if (lane.restart === null || lane.restart.width === 0 || lane.restart.height === 0) offerProblems.push('Restart is not drawn');
        else if (lane.lane === null || lane.restart.x < lane.lane.x - 1 || lane.restart.right > lane.lane.right + 1 || lane.restart.y < lane.lane.y - 1 || lane.restart.bottom > lane.lane.bottom + 1) {
          offerProblems.push(`Restart (${JSON.stringify(lane.restart)}) is not inside the lane (${JSON.stringify(lane.lane)})`);
        }

        if (lane.words !== null && lane.words.trim() !== 'Restart') offerProblems.push(`the button says ${JSON.stringify(lane.words)}`);
      }

      check('where.restart-offer', offerProblems.length === 0, `${tag}: an ended terminal's lane: ${offerProblems.length === 0 ? 'Restart is drawn inside it' : offerProblems.join('; ')}`);
      const ended = host.log.created.map((made) => made.id);

      // Enter in the screen restarts: a shell under another id in the same tab, and the ended shell's output is still above the new one's banner.
      await page.locator('.xterm-helper-textarea').focus();
      await page.keyboard.press('Enter');
      const created = await until(() => host.log.created.length === 2);
      const buffer = async () => {
        const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
        await page.evaluate(() => {
          window.__where.copied.length = 0;
        });
        await page.locator('.xterm-helper-textarea').focus();
        await page.keyboard.press(mac ? 'Meta+a' : 'Control+Shift+A');
        await page.keyboard.press(mac ? 'Meta+c' : 'Control+Shift+C');
        await until(() => page.evaluate(() => window.__where.copied.length > 0), 5_000);
        return page.evaluate(() => window.__where.copied.at(-1) ?? '');
      };
      const live = await until(async () => ((await buffer()).match(/Synthetic shell:/g) ?? []).length === 2);
      await perturb(ctx, page, 'restarted');
      const text = await buffer();
      const after = await page.evaluate(() => ({ labels: window.__where.labels(), lane: window.__where.lane().restart }));
      const restartProblems = [];
      if (!created) restartProblems.push(`${String(host.log.created.length)} terminals were made, not 2`);
      else if (host.log.created[1].id === ended[0]) restartProblems.push('the new terminal has the ended terminal\'s id');
      if (after.labels.length !== 1 || after.labels[0] !== first) restartProblems.push(`the tabs say ${JSON.stringify(after.labels)}, not the one tab that said ${JSON.stringify(first)}`);
      if (after.lane !== null) restartProblems.push('the lane still offers Restart');
      const banners = (text.match(/Synthetic shell:/g) ?? []).length;
      if (!live || banners !== 2) restartProblems.push(`${String(banners)} banners in the transcript, not the ended shell's and the new one's`);
      if (!/hello from the synthetic shell/.test(text) || text.indexOf('hello from the synthetic shell') > text.lastIndexOf('Synthetic shell:')) restartProblems.push('what the ended shell printed is not above the new banner');
      check('where.restart', restartProblems.length === 0, `${tag}: Enter in the screen of an ended terminal: ${restartProblems.length === 0 ? 'a new terminal under another id in the same tab, the ended shell\'s output above the new banner, no Restart left' : restartProblems.join('; ')}`);
    } finally {
      await session.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ axe.where
  sections['where-axe'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx, { shells: true });
    const { page } = session;
    try {
      await page.addScriptTag({ path: AXE });
      await page.locator('[data-shell-part="sessionAddChoice"]').click();
      await page.getByRole('menu').waitFor({ timeout: 5_000 });
      const menuFound = await runAxe(page, '[role="menu"]');
      await page.keyboard.press('Escape');
      await page.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type('exit');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-shell-part="terminalRestart"]', { state: 'attached', timeout: 15_000 });
      await perturb(ctx, page, 'axe');
      const found = await runAxe(page, '[data-shell-part="terminalBody"]');
      check('axe.where', found.length === 0, `${tag}: axe-core on the lane that offers Restart: ${found.length === 0 ? 'no violation' : found.join('; ')}`);
      note(`GAP where menu axe ${tag}: ${menuFound.length === 0 ? 'no violation' : menuFound.join('; ')}`);
      report.numbers[`where-axe ${tag}`] = { violations: found.length, menu: menuFound.length };
    } finally {
      await session.close();
    }
  };

  return sections;
}

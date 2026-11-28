// FILE LINKS in the terminal's output (issue #696 step 4), in a real xterm, in both engines at both viewports. The far end is the probe's own host (terminal-host.mjs) with the shell's integration on, whose
// `ChannelTerminalResolveLink` answers from a fixture tree (`TREE` below: a directory to the files in it) and writes every question it was asked to `host.log.resolves` (the directory the page named, and the text). The synthetic shell
// has `files` (what a compiler prints: a path that is in the tree, one that is not, a quoted path with `, line 9`, and a path inside a web address), `cd <dir>`, `many` (thirty candidates on one line and three lines of one each), `short` (one path in each directory),
// `bigline` (a megabyte with no line break) and `hold` (a program that holds the foreground and prints a path: ssh). The page's own side is real: the provider, the hook, the tooltip, the menu and the clipboard (a stub of the page's).
// Every section waits for a state and never for a time: a page that is asked for something is read until it says it (`waitForFunction`), the host's log is a count, and what must NOT happen is proven after a number of frames.
//
// The decisions the sections hold the page to (docs/ui-next/status/T7-provider.md has the reasons): a link is made only under the modifier (Command on a Mac, Control elsewhere), only for a path the HOST resolved, and its tooltip shows the
// resolved absolute path first and whole, then the line and the column; a path resolves against the directory of the command that printed its row (the shell's proof), never the page's guess; the host is asked about at most 10
// candidates of the hovered line and about no other line; nothing is asked while a program holds the foreground; a megabyte of `a:1` makes no link and the page stays responsive; a click copies the path until an editor opens files.
//   files-link        under the modifier a path in the tree is a link whose tooltip says the resolved path and position, a missing path and a path inside a web address are none, and the pointer is not on a link for them (files.link)
//   files-modifier    without the modifier the host is asked nothing; the key pressed while the pointer rests on the line asks, once (files.modifier)
//   files-click       a click with the modifier copies the path with its line and column, once; a plain click copies nothing (files.click)
//   files-directory   after `cd`, the new rows resolve against the new directory and the old rows against the directory of their own command (files.directory)
//   files-counts      thirty candidates on a line: at most 10 questions, all about that line; three other lines hovered by nobody: no question about them (files.counts)
//   files-big         a megabyte of `a:1` makes no link and no question, and the page answers a key within a count of frames (files.big)
//   files-foreign     while a program holds the foreground the host is asked nothing, and there is no link; the next row after it ends is a link (files.foreign)
//   files-keys        after the keyboard comes in, Open link lists the files in view, named by what they copy, and Enter on one copies it (files.keys)
//   files-axe         axe-core finds nothing in the tooltip of a file link, nor in the open submenu (axe.files)

import { AXE } from './harness.mjs';
import { createHost } from './terminal-host.mjs';
import { serveContext } from './terminal-serve.mjs';

/** The fixture tree of the host: a directory to the files in it. The shell starts in `/home/user`. */
const TREE = { '/home/user': ['src/a.go', 'README.md'], '/home/user/other': ['src/b.go'] };
const HERE = '/home/user';
const OTHER = '/home/user/other';
const IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Chromium says it runs on Linux (the seam's way), so that the chords of the platforms that are not a Mac are run on a Mac too. WebKit says what it is. */
const LINUX = () => {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64', configurable: true });
};

/** The clipboard of the page, deterministic: what the page writes is kept (`writes`). */
const CLIPBOARD = () => {
  const clip = (window.__clip = { text: '', writes: [], reads: 0 });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        clip.writes.push(String(text));
      },
      readText: async () => {
        clip.reads += 1;
        return clip.text;
      },
    },
  });
};

/** What the sections read of the page, in the page (`window.__fl`), so that it is read in one task: the tooltip of a link, the menus, where the keyboard is, and where a piece of the output is. */
const HELPERS = () => {
  const fl = (window.__fl = {});
  /** The tooltips of links: the popovers with the role, which the kit's own tooltips are not. */
  fl.tips = () =>
    [...document.querySelectorAll('[role="tooltip"][popover]')].map((element) => ({
      words: (element.children[0]?.textContent ?? '').trim(),
      path: (element.children[1]?.textContent ?? '').trim(),
      position: (element.children[2]?.textContent ?? '').trim(),
      count: element.children.length,
    }));
  fl.pointing = () => document.querySelector('.xterm-screen')?.classList.contains('xterm-cursor-pointer') === true;
  fl.menus = () =>
    [...document.querySelectorAll('[role="menu"]')]
      .filter((menu) => menu.getClientRects().length > 0)
      .map((menu) => ({ label: menu.getAttribute('aria-label'), items: [...menu.querySelectorAll('[role="menuitem"]')].map((item) => ({ label: item.getAttribute('aria-label'), disabled: item.getAttribute('aria-disabled') === 'true' })) }));
  fl.active = () => {
    const element = document.activeElement;
    return element === null ? null : { label: element.getAttribute('aria-label') ?? element.tagName, terminal: element.classList.contains('xterm-helper-textarea') };
  };
  fl.rows = () => [...document.querySelectorAll('.xterm-rows > div')].map((row) => (row.textContent ?? '').replaceAll('\u00a0', ' ').trimEnd());
  /** Where the text is on the screen: its first occurrence, or its last when `last` says so (the output of two commands holds the same text). */
  fl.pointOf = (text, last = false) => {
    const rows = document.querySelector('.xterm-rows');
    if (rows === null) return null;
    const walker = document.createTreeWalker(rows, NodeFilter.SHOW_TEXT);
    let found = null;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.data.replaceAll('\u00a0', ' ').indexOf(text);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      const rect = range.getBoundingClientRect();
      found = { x: rect.x + Math.min(rect.width / 2, 40), y: rect.y + rect.height / 2 };
      if (!last) return found;
    }

    return found;
  };
};

export const FILELINKS_PARTS = {
  filelinks: ['files-link', 'files-modifier', 'files-click', 'files-directory', 'files-counts', 'files-big', 'files-foreign', 'files-keys', 'files-axe'],
};

/**
 * The negative controls of the assertions of this file, each a single fault, in the shape of the probe's own table: `host.faults` is a fault of the far end (terminal-host.mjs), `init` is run in the page before its own scripts
 * and `after` at the `stage` the section names. `ASKS` plants a page that asks the host more than it should, by asking it again itself for each question the page makes. Each runs in Chromium: what it proves does not depend on the engine.
 */
const asks = (texts) => () => {
  const real = window.__host;
  if (typeof real !== 'function') return;
  window.__host = async (windowId, method, args) => {
    const answer = await real(windowId, method, args);
    if (method === 'ChannelTerminalResolveLink') for (const text of texts()) void real(windowId, method, [args[0], args[1], text]);
    return answer;
  };
};

export const FILELINKS_CONTROLS = {
  // The host says that a file that is not there is there: a link for a missing file.
  'files-missing-link': { assertion: 'files.link', section: 'files-link', engines: ['chromium'], host: { faults: { resolveAny: true } } },
  // The page asks the host about every line printed, and not only about the hovered one; and with no cap on the candidates of a line.
  'files-all-lines': {
    assertion: 'files.counts',
    section: 'files-counts',
    engines: ['chromium'],
    init: () => {
      const real = window.__host;
      if (typeof real !== 'function') return;
      window.__host = async (windowId, method, args) => {
        const answer = await real(windowId, method, args);
        if (method === 'ChannelTerminalResolveLink') for (let index = 0; index < 12; index += 1) void real(windowId, method, [args[0], args[1], `g${String(index)}.go:${String(index + 1)}`]);
        return answer;
      };
    },
  },
  'files-no-cap': {
    assertion: 'files.counts',
    section: 'files-counts',
    engines: ['chromium'],
    init: () => {
      const real = window.__host;
      if (typeof real !== 'function') return;
      window.__host = async (windowId, method, args) => {
        const answer = await real(windowId, method, args);
        if (method === 'ChannelTerminalResolveLink') for (let index = 10; index < 30; index += 1) void real(windowId, method, [args[0], args[1], `f${String(index)}.go:1`]);
        return answer;
      };
    },
  },
  // The page believes the host's busy fact is idle while a program holds the foreground: the host here says idle.
  'files-foreign-link': { assertion: 'files.foreign', section: 'files-foreign', engines: ['chromium'], host: { faults: { busyIdle: true } } },
  // The host resolves against where the shell is now, whatever directory the page names.
  'files-wrong-directory': { assertion: 'files.directory', section: 'files-directory', engines: ['chromium'], host: { faults: { rowDirectoryIgnored: true } } },
  // The modifier is always held, whatever the pointer says.
  'files-no-modifier': {
    assertion: 'files.modifier',
    section: 'files-modifier',
    engines: ['chromium'],
    init: () => {
      Object.defineProperty(MouseEvent.prototype, 'ctrlKey', { get: () => true, configurable: true });
      Object.defineProperty(MouseEvent.prototype, 'metaKey', { get: () => true, configurable: true });
    },
  },
  // A click copies nothing: a clipboard that keeps nothing it is given.
  'files-clipboard-dropped': {
    assertion: 'files.click',
    section: 'files-click',
    engines: ['chromium'],
    stage: 'click',
    after: (page) =>
      page.evaluate(() => {
        window.__clip.writes.length = 0;
        window.__clip.writes.push = () => 0;
      }),
  },
  // The tooltip names the path but not where in it, or the path is cut.
  'files-tooltip-position-lost': {
    assertion: 'files.link',
    section: 'files-link',
    engines: ['chromium'],
    stage: 'tip',
    after: (page) =>
      page.evaluate(() => {
        for (const tip of document.querySelectorAll('[role="tooltip"][popover]')) tip.children[2]?.remove();
      }),
  },
  // A violation that exists only in the tooltip of a file link: an image with no text alternative.
  'files-tooltip-axe': {
    assertion: 'axe.files',
    section: 'files-axe',
    engines: ['chromium'],
    stage: 'axe',
    after: (page) =>
      page.evaluate((src) => {
        const image = document.createElement('img');
        image.src = src;
        document.querySelector('[role="tooltip"][popover]')?.append(image);
      }, IMAGE),
  },
};

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFilelinksSections({ check, note, runAxe }) {
  const sections = {};

  const perturb = async (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

  /** Whether the page is waited for: `done` is true of the page within `timeout` ms, read on every frame; false when it never was. */
  const waitFor = async (page, done, arg, timeout = 15_000) =>
    page.waitForFunction(done, arg, { timeout }).then(
      () => true,
      () => false,
    );

  /** The host's own state is read until `done` says so (the host is in this process: what is read is an observation, and the wait ends when it holds). */
  const until = async (done, ms = 15_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await done()) return true;
      if (Date.now() > deadline) return false;
      await sleep(30);
    }
  };

  /** Some frames have passed (what the page did with an event is on the screen): a page that draws no frame is not waited for past three seconds. */
  const frames = async (page, count = 2) =>
    page.evaluate(
      async (n) =>
        Promise.race([
          new Promise((resolve) => {
            let left = n;
            const tick = () => {
              left -= 1;
              if (left <= 0) resolve(true);
              else requestAnimationFrame(tick);
            };

            requestAnimationFrame(tick);
          }),
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(false);
            }, 3000);
          }),
        ]),
      count,
    );

  /** A page of the fixture against the probe's host (the shell's integration on, the fixture tree): the panel is opened on the Terminal tool, a shell starts and its first prompt is on the screen. */
  async function open(ctx) {
    const { browser, origin, viewport, control } = ctx;
    const host = createHost({ integration: true, tree: TREE, ...control?.host?.options, faults: { ...control?.host?.faults } });
    const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
    const served = await serveContext(context, host);
    if (ctx.engine === 'chromium') await context.addInitScript(LINUX);
    await context.addInitScript(CLIPBOARD);
    await context.addInitScript(HELPERS);
    if (control?.init !== undefined) await context.addInitScript(control.init);
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

    return { page, host, context, close, resolves: () => host.log.resolves };
  }

  /** What the page shows of a command's output once it is drawn (the page draws on a frame, after the host has written it): a command that prints something a section hovers is waited for on the screen. */
  const DRAWN = { files: 'url: https://example.com', many: 'g2.go:3', short: 'short: src/b.go:4' };

  /** Types a command and waits until the shell has written its next prompt and the page has drawn what the command printed. */
  async function ran(page, host, line) {
    const before = host.log.prompts;
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
    const prompted = await until(() => host.log.prompts > before);
    const marker = DRAWN[line.split(' ')[0]];
    const drawn = marker === undefined || (await waitFor(page, (text) => (document.querySelector('.xterm-rows')?.textContent ?? '').includes(text), marker));
    return prompted && drawn;
  }

  const isMac = async (page) => page.evaluate(() => /Mac/.test(navigator.platform));
  const modifierOf = (mac) => (mac ? 'Meta' : 'Control');
  const wantWords = (mac) => `Copy path (${mac ? 'cmd' : 'ctrl'} + click)`;
  const tips = async (page) => page.evaluate(() => window.__fl.tips());

  /** The pointer is on the text, as a person moves it. Answers where it is, or null when the text is not on the screen. */
  const hoverAt = async (page, text, last = false) => {
    const point = await page.evaluate(({ word, end }) => window.__fl.pointOf(word, end), { word: text, end: last });
    if (point === null) return null;
    await page.mouse.move(point.x - 20, point.y);
    await page.mouse.move(point.x, point.y, { steps: 4 });
    return point;
  };

  sections['files-link'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await ran(page, host, 'files');
      const mac = await isMac(page);
      const key = modifierOf(mac);
      const rowsNow = await page.evaluate(() => window.__fl.rows());
      await page.keyboard.down(key);
      const point = await hoverAt(page, 'src/a.go:12:3');
      const shown = await waitFor(page, () => window.__fl.tips().length > 0);
      await perturb(ctx, page, 'tip');
      const tip = (await tips(page))[0];
      const pointing = await page.evaluate(() => window.__fl.pointing());
      // A path that is not in the tree: asked, answered no, and not a link.
      const askedBefore = host.log.resolves.length;
      const missing = await hoverAt(page, 'src/missing.go:7:1');
      const askedMissing = await until(() => host.log.resolves.some((one) => one.text === 'src/missing.go:7:1'));
      await frames(page, 8);
      const none = await tips(page);
      const pointingMissing = await page.evaluate(() => window.__fl.pointing());
      // A path inside a web address is the web link's: the host is never asked to look at it.
      const url = await hoverAt(page, 'src/a.go:12 end');
      await frames(page, 15);
      const asked = host.log.resolves.slice(askedBefore).map((one) => one.text);
      await page.keyboard.up(key);
      check(
        'files.link',
        point !== null && shown && tip?.words === wantWords(mac) && tip?.path === `${HERE}/src/a.go` && tip?.position === 'line 12, column 3' && pointing && missing !== null && askedMissing && none.length === 0 && !pointingMissing && url !== null && !asked.some((text) => text.includes('example.com') || text === 'src/a.go:12'),
        `${tag}: under the modifier the path in the tree${point === null ? ' (NOT found on the screen: the rows are ${JSON.stringify(rowsNow)})' : ''} has the tooltip ${JSON.stringify(tip)} (the words ${JSON.stringify(wantWords(mac))}, the path ${HERE}/src/a.go and "line 12, column 3") and the pointer is ${pointing ? '' : 'NOT '}on a link; the path that is not in the tree was ${askedMissing ? 'asked' : 'NOT asked'} and left ${JSON.stringify(none)} tooltips (none) and the pointer ${pointingMissing ? 'ON' : 'not on'} a link; the path inside a web address was asked as ${JSON.stringify(asked)} (nothing)`,
      );
      note(`files link ${tag}: ${JSON.stringify(tip)}, missing: ${String(none.length)} tooltips, the questions: ${JSON.stringify(host.log.resolves.map((one) => one.text))}`);
    } finally {
      await session.close();
    }
  };

  sections['files-modifier'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await ran(page, host, 'files');
      const mac = await isMac(page);
      const key = modifierOf(mac);
      const point = await hoverAt(page, 'src/a.go:12:3');
      await frames(page, 20);
      const plain = host.log.resolves.length;
      const plainTips = (await tips(page)).length;
      // The key is pressed while the pointer rests on the line, with no move: the line is asked about, once.
      await page.keyboard.down(key);
      const asked = await until(() => host.log.resolves.some((one) => one.text === 'src/a.go:12:3'));
      const shown = await waitFor(page, () => window.__fl.tips().length > 0);
      await frames(page, 10);
      const pressed = host.log.resolves.filter((one) => one.text === 'src/a.go:12:3').length;
      await page.keyboard.up(key);
      check(
        'files.modifier',
        point !== null && plain === 0 && plainTips === 0 && asked && shown && pressed === 1,
        `${tag}: with the pointer on a path and no modifier the host was asked ${String(plain)} times and ${String(plainTips)} tooltips were drawn (none of either); with ${key} pressed while the pointer rested there the line was ${asked ? 'asked' : 'NOT asked'} ${String(pressed)} times (once) and the tooltip ${shown ? 'came' : 'did NOT come'}`,
      );
      note(`files modifier ${tag}: without ${key} ${String(plain)} questions, with it ${String(pressed)}`);
    } finally {
      await session.close();
    }
  };

  sections['files-click'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await ran(page, host, 'files');
      const mac = await isMac(page);
      const key = modifierOf(mac);
      await page.keyboard.down(key);
      const point = await hoverAt(page, 'src/a.go:12:3');
      await waitFor(page, () => window.__fl.tips().length > 0);
      await page.keyboard.up(key);
      // A plain click selects text: it copies nothing.
      await page.mouse.down();
      await page.mouse.up();
      await frames(page, 6);
      const plain = await page.evaluate(() => [...window.__clip.writes]);
      await page.keyboard.down(key);
      await page.mouse.move((point?.x ?? 0) + 1, point?.y ?? 0);
      await page.mouse.down();
      await page.mouse.up();
      await page.keyboard.up(key);
      await waitFor(page, () => window.__clip.writes.length > 0, null, 5000);
      await frames(page, 6);
      await perturb(ctx, page, 'click');
      const writes = await page.evaluate(() => [...window.__clip.writes]);
      check(
        'files.click',
        point !== null && plain.length === 0 && JSON.stringify(writes) === JSON.stringify([`${HERE}/src/a.go:12:3`]),
        `${tag}: a plain click on the link copied ${JSON.stringify(plain)} (nothing); ${key} and a click copied ${JSON.stringify(writes)} (${HERE}/src/a.go:12:3, once)`,
      );
      note(`files click ${tag}: plain ${JSON.stringify(plain)}, ${key} click ${JSON.stringify(writes)}`);
    } finally {
      await session.close();
    }
  };

  sections['files-directory'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await ran(page, host, 'short');
      await ran(page, host, `cd ${OTHER}`);
      await ran(page, host, 'short');
      const mac = await isMac(page);
      const key = modifierOf(mac);
      await page.keyboard.down(key);
      // The new rows are the command that ran in `other`: `src/b.go:4` is in that tree (the last occurrence on the screen), and `src/a.go` is not.
      const point = await hoverAt(page, 'src/b.go:4', true);
      const newShown = await waitFor(page, () => window.__fl.tips().length > 0);
      const newTip = (await tips(page))[0];
      // The first `files` ran in /home/user: its `build:` row is the first command's, and resolves against that directory, whatever the shell is in now.
      await page.mouse.move(5, 5);
      await frames(page, 4);
      const first = await hoverAt(page, 'src/a.go:12:3');
      const oldShown = await waitFor(page, (want) => window.__fl.tips().some((tip) => tip.path === want), `${HERE}/src/a.go`, 8000);
      await perturb(ctx, page, 'directory');
      await page.keyboard.up(key);
      const named = host.log.resolves.map((one) => [one.rowDirectory, one.text]);
      const forB = named.filter(([, text]) => text === 'src/b.go:4').map(([dir]) => dir);
      const forA = named.filter(([, text]) => text === 'src/a.go:12:3').map(([dir]) => dir);
      check(
        'files.directory',
        point !== null && first !== null && newShown && newTip?.path === `${OTHER}/src/b.go` && oldShown && forB.length > 0 && forB.every((dir) => dir === OTHER) && forA.length > 0 && forA.every((dir) => dir === HERE),
        `${tag}: after cd ${OTHER} the new row's src/b.go:4 ${newShown ? 'was' : 'was NOT'} a link with the path ${JSON.stringify(newTip?.path)} (${OTHER}/src/b.go) and was asked with the directories ${JSON.stringify(forB)} (${OTHER}); the old row's src/a.go:12:3 ${oldShown ? 'was' : 'was NOT'} still a link to ${HERE}/src/a.go and was asked with ${JSON.stringify(forA)} (${HERE}, the directory of the command that printed it)`,
      );
      note(`files directory ${tag}: new ${JSON.stringify(newTip)}, asks ${JSON.stringify(named)}`);
    } finally {
      await session.close();
    }
  };

  sections['files-counts'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await ran(page, host, 'many');
      const mac = await isMac(page);
      const key = modifierOf(mac);
      await page.keyboard.down(key);
      const point = await hoverAt(page, 'f3.go:1');
      await until(() => host.log.resolves.length > 0);
      await frames(page, 25);
      const asked = host.log.resolves.map((one) => one.text);
      await page.keyboard.up(key);
      const fromLine = asked.every((text) => /^f\d+\.go:1$/.test(text));
      const distinct = new Set(asked);
      check(
        'files.counts',
        point !== null && asked.length > 0 && asked.length <= 10 && distinct.size === asked.length && fromLine,
        `${tag}: on a line of thirty candidates, with three other lines of one each printed, the host was asked ${String(asked.length)} questions (at most 10, once each), ${fromLine ? 'all about the hovered line' : `NOT all about the hovered line: ${JSON.stringify(asked.filter((text) => !/^f\\d+\\.go:1$/.test(text)))}`}`,
      );
      note(`files counts ${tag}: ${String(asked.length)} questions for the hovered line of 30 candidates`);
    } finally {
      await session.close();
    }
  };

  sections['files-big'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await ran(page, host, 'bigline');
      const mac = await isMac(page);
      const key = modifierOf(mac);
      await page.keyboard.down(key);
      // The pointer goes over the rows of the megabyte: 40 places.
      const screen = await page.evaluate(() => {
        const rect = document.querySelector('.xterm-screen')?.getBoundingClientRect();
        return rect === undefined ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      if (screen !== null) {
        for (let step = 0; step < 40; step += 1) await page.mouse.move(screen.x + 20 + ((step * 37) % Math.max(40, screen.width - 40)), screen.y + 4 + ((step * 13) % Math.max(10, screen.height - 8)));
      }

      await frames(page, 30);
      await page.keyboard.up(key);
      const asked = host.log.resolves.length;
      const tipsNow = (await tips(page)).length;
      // The page answers: a key typed reaches the screen within a count of frames, not a time.
      await page.keyboard.type('x');
      let counted = 0;
      const echoed = await page.evaluate(
        async () =>
          new Promise((resolve) => {
            let frame = 0;
            const tick = () => {
              frame += 1;
              if ((document.querySelector('.xterm-rows')?.textContent ?? '').includes('$ x')) resolve(frame);
              else if (frame > 120) resolve(-1);
              else requestAnimationFrame(tick);
            };

            requestAnimationFrame(tick);
          }),
      );
      counted = echoed;
      check(
        'files.big',
        screen !== null && asked === 0 && tipsNow === 0 && counted > 0 && counted <= 120,
        `${tag}: the pointer went over a megabyte of "a:1" with ${key} held: the host was asked ${String(asked)} times (none) and ${String(tipsNow)} tooltips were drawn (none); a key typed afterwards reached the screen after ${String(counted)} frames (within 120)`,
      );
      note(`files big ${tag}: ${String(asked)} questions, a key echoed after ${String(counted)} frames`);
    } finally {
      await session.close();
    }
  };

  sections['files-foreign'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await page.keyboard.type('hold 60');
      await page.keyboard.press('Enter');
      await waitFor(page, () => /remote: src\/a\.go:12:3 held/.test(document.querySelector('.xterm-rows')?.textContent ?? ''));
      const mac = await isMac(page);
      const key = modifierOf(mac);
      await page.keyboard.down(key);
      const point = await hoverAt(page, 'src/a.go:12:3');
      await until(() => host.log.busy.length > 0);
      await frames(page, 25);
      const duringTips = (await tips(page)).length;
      const duringAsked = host.log.resolves.length;
      await page.keyboard.up(key);
      // The program ends (Control C): the shell is at its prompt, and the next path it prints is a link.
      await page.keyboard.press('Control+C');
      await until(() => host.log.prompts >= 2);
      await ran(page, host, 'files');
      await page.keyboard.down(key);
      await hoverAt(page, 'src/a.go:12:3: error');
      const after = await waitFor(page, () => window.__fl.tips().length > 0);
      await page.keyboard.up(key);
      check(
        'files.foreign',
        point !== null && duringAsked === 0 && duringTips === 0 && after,
        `${tag}: while a program (ssh) held the foreground and printed a path, hovered with ${key} held, the host was asked ${String(duringAsked)} questions (none) and ${String(duringTips)} tooltips were drawn (none); once it ended the next path ${after ? 'was' : 'was NOT'} a link`,
      );
      note(`files foreign ${tag}: during ${String(duringAsked)} questions, after the program a link: ${String(after)}`);
    } finally {
      await session.close();
    }
  };

  sections['files-keys'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await ran(page, host, 'files');
      // The keyboard comes in: the terminal's input loses the focus and gets it back, which asks about the lines in view.
      const before = host.log.resolves.length;
      await page.evaluate(() => document.activeElement?.blur());
      await page.locator('.xterm-helper-textarea').focus();
      const warmed = await until(() => host.log.resolves.length > before);
      await frames(page, 6);
      await page.keyboard.press('Shift+F10');
      const menu = await waitFor(page, () => window.__fl.menus().length > 0, null, 8000);
      let reached = false;
      for (let step = 0; step < 12 && menu; step += 1) {
        await page.keyboard.press('ArrowDown');
        if ((await page.evaluate(() => window.__fl.active()))?.label === 'Open link') {
          reached = true;
          break;
        }
      }

      if (reached) await page.keyboard.press('ArrowRight');
      const sub = reached && (await waitFor(page, () => window.__fl.menus().length > 1, null, 8000));
      await perturb(ctx, page, 'submenu');
      const labels = ((await page.evaluate(() => window.__fl.menus()))[1]?.items ?? []).map((item) => item.label);
      const want = `Copy path ${HERE}/src/a.go:12:3`;
      let chosen = false;
      for (let step = 0; step < 8 && sub; step += 1) {
        if ((await page.evaluate(() => window.__fl.active()))?.label === want) {
          chosen = true;
          break;
        }

        await page.keyboard.press('ArrowDown');
      }

      if (chosen) await page.keyboard.press('Enter');
      const done = await waitFor(page, () => window.__clip.writes.length > 0 && window.__fl.menus().length === 0, null, 8000);
      await frames(page, 4);
      const writes = await page.evaluate(() => [...window.__clip.writes]);
      const back = await page.evaluate(() => window.__fl.active());
      check(
        'files.keys',
        warmed && menu && reached && sub && labels.includes(want) && !labels.some((label) => /missing/.test(label ?? '')) && chosen && done && JSON.stringify(writes) === JSON.stringify([`${HERE}/src/a.go:12:3`]) && back?.terminal === true,
        `${tag}: the keyboard coming in ${warmed ? 'asked' : 'did NOT ask'} about the lines in view; Shift+F10 ${menu ? 'opened' : 'did NOT open'} the menu; ArrowDown ${reached ? 'reached' : 'did NOT reach'} Open link, whose items are ${JSON.stringify(labels)} (${JSON.stringify(want)} among them, and none for a file that is not there; the web address in the output is listed too); Enter on it copied ${JSON.stringify(writes)} (${HERE}/src/a.go:12:3, once) and the keyboard is on ${JSON.stringify(back)} (the terminal)`,
      );
      note(`files keys ${tag}: Open link lists ${JSON.stringify(labels)}, Enter copied ${JSON.stringify(writes)}`);
    } finally {
      await session.close();
    }
  };

  sections['files-axe'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const session = await open(ctx);
    const { page, host } = session;
    try {
      await ran(page, host, 'files');
      const mac = await isMac(page);
      const key = modifierOf(mac);
      await page.keyboard.down(key);
      await hoverAt(page, 'src/a.go:12:3');
      const shown = await waitFor(page, () => window.__fl.tips().length > 0);
      await page.addScriptTag({ path: AXE });
      await page.evaluate(() => document.querySelector('[role="tooltip"][popover]')?.setAttribute('data-probe-axe', 'files'));
      await perturb(ctx, page, 'axe');
      const found = shown ? await runAxe(page, '[data-probe-axe="files"]') : ['the tooltip never came'];
      await page.keyboard.up(key);
      await page.mouse.move(5, 5);
      await page.locator('.xterm-helper-textarea').focus();
      await until(() => host.log.resolves.length > 0);
      await page.keyboard.press('Shift+F10');
      await waitFor(page, () => window.__fl.menus().length > 0, null, 8000);
      for (let step = 0; step < 12; step += 1) {
        await page.keyboard.press('ArrowDown');
        if ((await page.evaluate(() => window.__fl.active()))?.label === 'Open link') break;
      }

      await page.keyboard.press('ArrowRight');
      const sub = await waitFor(page, () => window.__fl.menus().length > 1, null, 8000);
      await page.evaluate(() => document.querySelectorAll('[role="menu"]')[1]?.setAttribute('data-probe-axe', 'files-menu'));
      const menuFound = sub ? await runAxe(page, '[data-probe-axe="files-menu"]') : ['the submenu never opened'];
      check('axe.files', shown && found.length === 0 && sub && menuFound.length === 0, `${tag}: the tooltip of a file link (${shown ? 'shown' : 'NOT shown'}): ${JSON.stringify(found)}; the submenu of Open link (${sub ? 'open' : 'NOT open'}): ${JSON.stringify(menuFound)}`);
    } finally {
      await session.close();
    }
  };

  return sections;
}

// URLs and OSC 8 hyperlinks in the terminal's output, through the host's opener (issue #696 step 1), in a real xterm, in both engines at both viewports. The far end is the fixture's synthetic shell (terminal-fixture.tsx), whose command
// `hyperlinks <address of the page's own server>` prints hyperlinks whose text and target differ (terminal-host.mjs), and the window's way to open an address is the fixture's (`window.__opened`: every address the page asked the host to open,
// the stand-in for `Browser.OpenURL`). `window.open` and `confirm` are counted by a script that runs before the page's own: the default handler of an emulator's hyperlink asks with `confirm` and opens a window, and the probe asserts that
// neither is ever called. Every section waits for a state and never for a time: a page that is asked for something is read until it says it (`waitForFunction`, which wakes on a frame), a count is a count, and what must not happen is proven
// after a number of frames and not of milliseconds.
//
// The decisions the sections hold the page to (docs/ui-next/status/T7-links-urls.md has the reasons): a link opens through the opener and only with the platform's modifier (Command on a Mac, Control elsewhere); its target is SHOWN before it
// opens; `javascript:`, `file:` and every scheme but http and https are refused; a link to the host's own server (the page's origin, or a loopback name on its port) is refused; and the links in view are reachable from the keyboard.
//   urls-target   the pointer on a hyperlink whose text says `https://a.example` and whose target is `https://b.example/login` shows the target, with the words that say how to follow it, and the opener has not been called (urls.target)
//   urls-open     a plain click opens nothing; the platform's click opens the target once, and not the text; a dev server on another loopback port opens too; `window.open` and `confirm` are never called (urls.open)
//   urls-refuse   a hyperlink to `javascript:`, to `file:`, to the host's own server, and the host's own address printed: no tooltip, and the modifier and a click open nothing (urls.refuse)
//   urls-keys     the Menu key opens the terminal's menu, the arrow opens Open link, its items are the targets of the links in view (the host's own server, a script and a file are not), Enter opens the one chosen, once, and the keyboard is in
//                 the terminal again (urls.keys)
//   urls-axe      axe-core finds nothing in the tooltip that shows a target, nor in the open submenu (axe.urls)

import { AXE } from './harness.mjs';

/** Chromium says it runs on Linux (the seam's way), so that the chords of the platforms that are not a Mac are run on a Mac too. WebKit says what it is. */
const LINUX = () => {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64', configurable: true });
};

/** `window.open` and `confirm`, counted and answered with nothing: the page must never call either to follow a link. */
const WINDOW_SPY = () => {
  const calls = (window.__windowCalls = { open: 0, confirm: 0 });
  window.open = () => {
    calls.open += 1;
    return null;
  };

  window.confirm = () => {
    calls.confirm += 1;
    return false;
  };
};

/** What the sections read of the page, in the page (`window.__lk`), so that it is read in one task: the tooltip of a link, the menus and where the keyboard is, and where a piece of the output is. */
const HELPERS = () => {
  const lk = (window.__lk = {});
  /** The tooltips of links: the popovers with the role, which the kit's own tooltips are not. */
  lk.tips = () =>
    [...document.querySelectorAll('[role="tooltip"][popover]')].map((element) => ({
      text: (element.textContent ?? '').trim(),
      words: (element.children[0]?.textContent ?? '').trim(),
      target: (element.children[1]?.textContent ?? '').trim(),
    }));
  lk.menus = () =>
    [...document.querySelectorAll('[role="menu"]')]
      .filter((menu) => menu.getClientRects().length > 0)
      .map((menu) => ({ label: menu.getAttribute('aria-label'), items: [...menu.querySelectorAll('[role="menuitem"]')].map((item) => ({ label: item.getAttribute('aria-label'), disabled: item.getAttribute('aria-disabled') === 'true' })) }));
  lk.active = () => {
    const element = document.activeElement;
    return element === null ? null : { label: element.getAttribute('aria-label') ?? element.tagName, terminal: element.classList.contains('xterm-helper-textarea') };
  };
  lk.pointOf = (text) => {
    const rows = document.querySelector('.xterm-rows');
    if (rows === null) return null;
    const walker = document.createTreeWalker(rows, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.data.replaceAll('\u00a0', ' ').indexOf(text);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }

    return null;
  };
};

const IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export const URLS_PARTS = {
  urls: ['urls-target', 'urls-open', 'urls-refuse', 'urls-keys', 'urls-axe'],
};

const TARGET = 'https://b.example/login';
const TEXT = 'https://a.example';
const DEV = 'http://localhost:3000/';

/**
 * A planted page that a modifier click on the text `text` follows to `uri` by a way of its own: what a page that let a scheme through, or the host's own server, would do. It adds the address to what the page opened, as the
 * window's opener would, and does so on the click that the page's own handler refused (the page's handler did not call it).
 */
const follows = (text, uri) => (page) =>
  page.evaluate(
    ({ word, address }) => {
      window.addEventListener(
        'mouseup',
        (event) => {
          if (!(event.metaKey || event.ctrlKey)) return;
          const at = window.__lk.pointOf(word);
          if (at !== null && event.clientX >= at.left && event.clientX <= at.right && event.clientY >= at.top && event.clientY <= at.bottom) window.__opened.push(address);
        },
        true,
      );
    },
    { word: text, address: uri },
  );

/**
 * The negative controls of the assertions of this file, each a single fault, in the shape of the probe's own table: `init` is run in the page before its own scripts, `after` at the `stage` the section names, `query` is a control of the
 * fixture page. Each runs in Chromium: what it proves does not depend on the engine.
 */
export const URLS_CONTROLS = {
  // The tooltip is up and says how to follow the link, and does not say where it goes: a link whose text may say anything.
  'urls-target-hidden': {
    assertion: 'urls.target',
    section: 'urls-target',
    engines: ['chromium'],
    stage: 'tip',
    after: (page) =>
      page.evaluate(() => {
        for (const tip of document.querySelectorAll('[role="tooltip"][popover]')) tip.children[1]?.remove();
      }),
  },
  // The page opens a window of its own for the click, as the emulator's default handler of a hyperlink does.
  'urls-window-open': {
    assertion: 'urls.open',
    section: 'urls-open',
    engines: ['chromium'],
    init: () => {
      window.addEventListener(
        'mouseup',
        (event) => {
          if (event.metaKey || event.ctrlKey) window.open('https://b.example/login');
        },
        true,
      );
    },
  },
  // The click opens the text on the screen and not the target it points at.
  'urls-text-opened': {
    assertion: 'urls.open',
    section: 'urls-open',
    engines: ['chromium'],
    stage: 'click',
    after: (page) =>
      page.evaluate(() => {
        const opened = window.__opened;
        const at = opened.indexOf('https://b.example/login');
        if (at !== -1) opened[at] = 'https://a.example';
      }),
  },
  // A file: link is followed.
  'urls-file-allowed': { assertion: 'urls.refuse', section: 'urls-refuse', engines: ['chromium'], stage: 'click', after: follows('file link', 'file:///etc/passwd') },
  // A javascript: link is followed.
  'urls-script-allowed': { assertion: 'urls.refuse', section: 'urls-refuse', engines: ['chromium'], stage: 'click', after: follows('script link', 'javascript:alert(1)') },
  // A link to the host's own server is followed (the address is the page's own origin, which the plant reads from the page).
  'urls-own-allowed': {
    assertion: 'urls.refuse',
    section: 'urls-refuse',
    engines: ['chromium'],
    stage: 'click',
    after: (page) =>
      page.evaluate(() => {
        window.addEventListener(
          'mouseup',
          (event) => {
            if (!(event.metaKey || event.ctrlKey)) return;
            const at = window.__lk.pointOf('own server link');
            if (at !== null && event.clientX >= at.left && event.clientX <= at.right && event.clientY >= at.top && event.clientY <= at.bottom) window.__opened.push(`${location.origin}/api`);
          },
          true,
        );
      }),
  },
  // The menu lists the link by its text and not by its target.
  'urls-keys-text': {
    assertion: 'urls.keys',
    section: 'urls-keys',
    engines: ['chromium'],
    stage: 'submenu',
    after: (page) =>
      page.evaluate(() => {
        for (const item of document.querySelectorAll('[role="menu"] [role="menuitem"]')) {
          if (item.getAttribute('aria-label') === 'https://b.example/login') item.setAttribute('aria-label', 'https://a.example');
        }
      }),
  },
  // A violation that exists only in the tooltip of a link: an image with no text alternative.
  'urls-tooltip-axe': {
    assertion: 'axe.urls',
    section: 'urls-axe',
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

export function createUrlsSections({ check, note, runAxe }) {
  const sections = {};

  /** What a control plants at the stage it names, as the probe's own `perturb` does. */
  const perturb = async (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

  /** Whether the page is waited for: `done` is true of the page within `timeout` ms, read on every frame; false when it never was. */
  const waitFor = async (page, done, arg, timeout = 15_000) =>
    page.waitForFunction(done, arg, { timeout }).then(
      () => true,
      () => false,
    );

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

  /** A page of the fixture (the synthetic shell in the page, the DOM renderer so that the text can be read). */
  async function openPage(ctx, { query = '' } = {}) {
    const { browser, origin, viewport, control } = ctx;
    const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', (error) => page.errors.push(String(error.message).slice(0, 300)));
    if (ctx.engine === 'chromium') await page.addInitScript(LINUX);
    await page.addInitScript(WINDOW_SPY);
    await page.addInitScript(HELPERS);
    if (control?.init !== undefined) await page.addInitScript(control.init);
    const params = ['renderer=dom', query, control?.query].filter((part) => part !== undefined && part !== '').join('&');
    await page.goto(`${origin}/shell/probes/terminal-fixture.html?${params}`, { waitUntil: 'load' });
    await page.waitForSelector('[data-shell-part="window"]');
    return page;
  }

  /** The panel opens on the Terminal tool, New terminal starts the shell, its first prompt is on the screen and the emulator has the keyboard. */
  async function start(page) {
    await page.click('[data-shell-part="panelToggle"]');
    await page.waitForSelector('[data-shell-part="panelEmpty"]');
    await page.click('[data-shell-part="panelEmpty"] button');
    await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
    await page.waitForFunction(
      () => window.__engine.writes > 0 && window.__pty.log.resizes.length >= 1 && window.__pty.log.prompts >= 1 && window.__engine.accepted >= window.__pty.log.delivered && window.__engine.parsed === window.__engine.accepted,
      null,
      { timeout: 20_000 },
    );
    await page.locator('.xterm-helper-textarea').focus();
  }

  /** A command typed and run: the shell has written its next prompt, the host has delivered all of it, and the emulator has parsed all of it. */
  async function ran(page, command) {
    const before = await page.evaluate(() => window.__pty.log.prompts);
    await page.keyboard.type(command);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (count) => window.__pty.log.prompts > count && window.__pty.log.waiting() === 0 && window.__engine.accepted >= window.__pty.log.delivered && window.__engine.parsed === window.__engine.accepted,
      before,
      { timeout: 40_000 },
    );
    await frames(page);
  }

  /** A page with the shell started and the hyperlinks printed, whose own server is the page's own origin. */
  async function printed(ctx, options) {
    const page = await openPage(ctx, options);
    await start(page);
    const own = await page.evaluate(() => location.origin);
    await ran(page, `hyperlinks ${own}/api`);
    return { page, own };
  }

  const isMac = async (page) => page.evaluate(() => /Mac/.test(navigator.platform));
  const modifierOf = (mac) => (mac ? 'Meta' : 'Control');
  const wantWords = (mac) => `Follow link (${mac ? 'cmd' : 'ctrl'} + click)`;
  const opened = async (page) => page.evaluate(() => [...window.__opened]);
  const windows = async (page) => page.evaluate(() => ({ ...window.__windowCalls }));
  const tips = async (page) => page.evaluate(() => window.__lk.tips());

  /** The pointer is on the text, as a person moves it: the emulator finds the link under it from the pointer's moves. Answers where it is, or null when the text is not on the screen. */
  const hoverAt = async (page, text) => {
    const point = await page.evaluate((word) => window.__lk.pointOf(word), text);
    if (point === null) return null;
    await page.mouse.move(point.x - 20, point.y);
    await page.mouse.move(point.x, point.y, { steps: 4 });
    return point;
  };

  /** A click at a point of the output, with the key that is held: the pointer is on the link first. */
  const click = async (page, point, modifier) => {
    await page.mouse.move(point.x - 20, point.y);
    await page.mouse.move(point.x, point.y, { steps: 4 });
    await frames(page, 3);
    if (modifier !== undefined) await page.keyboard.down(modifier);
    await page.mouse.down();
    await page.mouse.up();
    if (modifier !== undefined) await page.keyboard.up(modifier);
    await frames(page, 3);
  };

  sections['urls-target'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const { page } = await printed(ctx);
    try {
      const mac = await isMac(page);
      const before = (await opened(page)).length;
      const point = await hoverAt(page, TEXT);
      const shown = await page.waitForFunction(() => window.__lk.tips().length > 0, null, { timeout: 8000 }).then(() => true, () => false);
      await perturb(ctx, page, 'tip');
      const tip = (await tips(page))[0];
      const calls = (await opened(page)).length - before;
      check(
        'urls.target',
        point !== null && shown && tip?.words === wantWords(mac) && tip?.target === TARGET && !tip.text.includes(TEXT) && calls === 0,
        `${tag}: on the hyperlink whose text says ${TEXT}${point === null ? ' (NOT found on the screen)' : ''} the tooltip is ${JSON.stringify(tip)} (the words ${JSON.stringify(wantWords(mac))} and the target ${TARGET}, and not the text), and the opener was called ${String(calls)} times before the click (none)`,
      );
      note(`urls target ${tag}: the tooltip says ${JSON.stringify(tip)} before any call (${String(calls)} calls)`);
    } finally {
      await page.context().close();
    }
  };

  sections['urls-open'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const { page } = await printed(ctx);
    try {
      const mac = await isMac(page);
      const modifier = modifierOf(mac);
      const link = await hoverAt(page, TEXT);
      await page.waitForFunction(() => window.__lk.tips().length > 0, null, { timeout: 8000 }).catch(() => undefined);
      await click(page, link, undefined);
      const plain = await opened(page);
      await click(page, link, modifier);
      await page.waitForFunction(() => window.__opened.length > 0, null, { timeout: 5000 }).catch(() => undefined);
      await frames(page, 6);
      await perturb(ctx, page, 'click');
      const once = await opened(page);
      const dev = await page.evaluate((word) => window.__lk.pointOf(word), 'dev server link');
      if (dev !== null) await click(page, dev, modifier);
      await page.waitForFunction((count) => window.__opened.length > count, once.length, { timeout: 5000 }).catch(() => undefined);
      const both = await opened(page);
      const window_ = await windows(page);
      check(
        'urls.open',
        link !== null && dev !== null && plain.length === 0 && once.length === 1 && once[0] === TARGET && both.length === 2 && both[1] === DEV && window_.open === 0 && window_.confirm === 0,
        `${tag}: a plain click opened ${String(plain.length)} addresses (none); ${modifier} and a click on the hyperlink whose text says ${TEXT} opened ${JSON.stringify(once)} (${TARGET} once); the dev server's link${dev === null ? ' (NOT found)' : ''} then made ${JSON.stringify(both)} (that and ${DEV}); window.open was called ${String(window_.open)} times and confirm ${String(window_.confirm)} (never)`,
      );
      note(`urls open ${tag}: plain ${String(plain.length)}, ${modifier} click ${JSON.stringify(both)}, window.open ${String(window_.open)}, confirm ${String(window_.confirm)}`);
    } finally {
      await page.context().close();
    }
  };

  sections['urls-refuse'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const { page, own } = await printed(ctx);
    try {
      const mac = await isMac(page);
      const modifier = modifierOf(mac);
      await perturb(ctx, page, 'click');
      const rows = [];
      for (const [name, text] of [['script', 'script link'], ['file', 'file link'], ['own server', 'own server link'], ['own server, printed', `${own}/api/printed`]]) {
        const point = await hoverAt(page, text);
        if (point === null) {
          rows.push({ name, found: false });
          continue;
        }

        await frames(page, 6);
        const tooltip = (await tips(page)).length;
        const before = (await opened(page)).length;
        await click(page, point, modifier);
        rows.push({ name, found: true, tooltip, opened: (await opened(page)).length - before });
      }

      const window_ = await windows(page);
      check(
        'urls.refuse',
        rows.every((row) => row.found && row.tooltip === 0 && row.opened === 0) && window_.open === 0 && window_.confirm === 0,
        `${tag}: the links a window must refuse, each hovered and followed with ${modifier}: ${JSON.stringify(rows)} (found, no tooltip, nothing opened); window.open ${String(window_.open)} and confirm ${String(window_.confirm)} (never)`,
      );
      note(`urls refuse ${tag}: ${JSON.stringify(rows)}`);
    } finally {
      await page.context().close();
    }
  };

  sections['urls-keys'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const { page, own } = await printed(ctx);
    try {
      await page.locator('.xterm-helper-textarea').focus();
      await page.keyboard.press('Shift+F10');
      const menu = await page.waitForFunction(() => window.__lk.menus().length > 0, null, { timeout: 8000 }).then(() => true, () => false);
      // The arrows go down to Open link, and the right arrow opens it.
      let reached = false;
      for (let step = 0; step < 12 && menu; step += 1) {
        await page.keyboard.press('ArrowDown');
        if ((await page.evaluate(() => window.__lk.active()))?.label === 'Open link') {
          reached = true;
          break;
        }
      }

      if (reached) await page.keyboard.press('ArrowRight');
      const sub = reached && (await page.waitForFunction(() => window.__lk.menus().length > 1, null, { timeout: 8000 }).then(() => true, () => false));
      await perturb(ctx, page, 'submenu');
      const menus = await page.evaluate(() => window.__lk.menus());
      const labels = (menus[1]?.items ?? []).map((item) => item.label);
      // Down to the target, and Enter.
      let chosen = false;
      for (let step = 0; step < 6 && sub; step += 1) {
        if ((await page.evaluate(() => window.__lk.active()))?.label === TARGET) {
          chosen = true;
          break;
        }

        await page.keyboard.press('ArrowDown');
      }

      if (chosen) await page.keyboard.press('Enter');
      const done = await page.waitForFunction(() => window.__opened.length > 0 && window.__lk.menus().length === 0, null, { timeout: 8000 }).then(() => true, () => false);
      await frames(page, 4);
      const calls = await opened(page);
      const back = await page.evaluate(() => window.__lk.active());
      const window_ = await windows(page);
      const expected = [TARGET, DEV];
      check(
        'urls.keys',
        menu && reached && sub && JSON.stringify(labels) === JSON.stringify(expected) && !labels.some((label) => label?.startsWith(own)) && chosen && done && JSON.stringify(calls) === JSON.stringify([TARGET]) && back?.terminal === true && window_.open === 0,
        `${tag}: Shift+F10 ${menu ? 'opened' : 'did NOT open'} the menu; ArrowDown ${reached ? 'reached' : 'did NOT reach'} Open link; ArrowRight ${sub ? 'opened' : 'did NOT open'} its items ${JSON.stringify(labels)} (${JSON.stringify(expected)}: the targets in reading order, no script, file or own server); Enter on ${TARGET} ${chosen ? 'was pressed' : 'could NOT be reached'} and the opener was called ${JSON.stringify(calls)} (that once), the menu ${done ? 'closed' : 'did NOT close'}, the keyboard is on ${JSON.stringify(back)} (the terminal); window.open ${String(window_.open)} times`,
      );
      note(`urls keys ${tag}: Open link lists ${JSON.stringify(labels)}, Enter opened ${JSON.stringify(calls)}, keyboard back in the terminal: ${String(back?.terminal)}`);
    } finally {
      await page.context().close();
    }
  };

  sections['urls-axe'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const { page } = await printed(ctx);
    try {
      await hoverAt(page, TEXT);
      const shown = await page.waitForFunction(() => window.__lk.tips().length > 0, null, { timeout: 8000 }).then(() => true, () => false);
      await page.addScriptTag({ path: AXE });
      await page.evaluate(() => document.querySelector('[role="tooltip"][popover]')?.setAttribute('data-probe-axe', 'urls'));
      await perturb(ctx, page, 'axe');
      const found = shown ? await runAxe(page, '[data-probe-axe="urls"]') : ['the tooltip never came'];
      // The open submenu too: the menu opens from the keyboard, with the link items in it.
      await page.mouse.move(5, 5);
      await page.locator('.xterm-helper-textarea').focus();
      await page.keyboard.press('Shift+F10');
      await page.waitForFunction(() => window.__lk.menus().length > 0, null, { timeout: 8000 });
      for (let step = 0; step < 12; step += 1) {
        await page.keyboard.press('ArrowDown');
        if ((await page.evaluate(() => window.__lk.active()))?.label === 'Open link') break;
      }

      await page.keyboard.press('ArrowRight');
      const sub = await page.waitForFunction(() => window.__lk.menus().length > 1, null, { timeout: 8000 }).then(() => true, () => false);
      await page.evaluate(() => document.querySelectorAll('[role="menu"]')[1]?.setAttribute('data-probe-axe', 'urls-menu'));
      const menuFound = sub ? await runAxe(page, '[data-probe-axe="urls-menu"]') : ['the submenu never opened'];
      check('axe.urls', shown && found.length === 0 && sub && menuFound.length === 0, `${tag}: the tooltip of a link that shows its target (${shown ? 'shown' : 'NOT shown'}): ${JSON.stringify(found)}; the submenu of Open link (${sub ? 'open' : 'NOT open'}): ${JSON.stringify(menuFound)}`);
    } finally {
      await page.context().close();
    }
  };

  return sections;
}

// The sections of the Terminal probe for T3a: find in the scrollback, the context menu and the links in the output, in a real xterm, in both engines at both viewports. The far end is the fixture's synthetic shell
// (terminal-fixture.tsx: `known`, `dense`, `urls`, `mouse-on`, `mouse-off` print what the sections look for) and, for the replay, the probe's own T2-go host (terminal-host.mjs). Every section waits for a state and never for a time: a
// page that is asked for something is read until it says it (`waitForFunction`, which wakes on a frame), a count is a count, and what must not happen is proven after a number of frames and not of milliseconds.
// This file knows nothing of the probe's own internals: terminal-probe.mjs hands it `check`, `note`, `report` and `runAxe`, and adds its sections, its parts and its negative controls to its own.
//
// The platform the page runs on: WebKit says what it is (a Mac: the Command chords, `cmd + click`), Chromium says Linux (the seam's way, `navigator.platform`) so that the other platforms' chords (Control Shift F and Control F, `ctrl + click`) are run on a Mac too.
// The clipboard is a stub of the page's own (`window.__clip`: what it was given and what it hands out), and the window's way to open an address is the fixture's (`window.__opened`). The fixture mounts the window's menu host, as the app's entry does:
// without it a menu trigger is inert. The mock's find bar is read from mock-terminal-find.json, which mock-terminal-find-measure.mjs writes (the mock measured in each engine at each viewport).
//
// Each section has ONE assertion (the three axe ones are sections of their own), so that a control trips only that one. `FIND_CONTROLS` is each control's fault, in the shape of the probe's own table; a fault of the emulator, of the shell or
// of the host is in the fixture or the host (`?control=`), a fault of the page is planted by the control itself (`init` before the page's own scripts, `after` at the `stage` the section names).
//   find-open        the chord opens the bar with the field focused, the emulator's columns and rows are the same, the bar is where and as large as the mock's (its field, its buttons and the space between them, read by parts), and the toolbar's Find button
//                    is pressed while the bar is open, closes it, and opens it again (find.open)
//   find-count       the count is `k of N` for a buffer whose text the probe counts itself, steps wrap both ways, the three switches change the count as a reference scan does, an invalid pattern says so, no match says so (find.count)
//   find-keys        Enter and Shift+Enter step, F3 and Shift+F3 step from the terminal, Escape closes the bar from the terminal's input and from the field (clears the highlights, is not sent to the shell, gives the keyboard back), the bar opened again
//                    searches the text it kept, Control F opens it as well, Tab goes through the bar's controls in order (find.keys)
//   find-lazy        the code that finds is requested by the first find and once: none before it, one after it, one after a second open (find.lazy)
//   find-replay      after a reload the replayed scrollback is searched: a line the host kept is found (find.replay)
//   find-idle        a closed bar is nothing: no node of it, and no React commit in a count of frames at rest, before the bar was ever opened and after it was opened and closed (find.idle)
//   find-cap         a find with more matches than it highlights says so, and holds no more highlights than the cap (find.cap)
//   find-axe         axe-core finds nothing in the find bar (axe.find)
//   menu-open        the context menu: by the pointer, by Shift+F10 and the Menu key, its name and items (none draws a shortcut) and which are enabled, what each does, and where the keyboard is when it closes (menu.open)
//   menu-mouse       a program that has the mouse gets the right click and no menu opens, unless Shift is held; with the mouse given back the menu opens (menu.mouse)
//   menu-axe         axe-core finds nothing in the open menu (axe.menu)
//   links-tooltip    the pointer on a link in the output says how to follow it for the platform, and the words go when the pointer does (links.tooltip)
//   links-activate   a plain click follows nothing, a click with the platform's modifier follows a web address once, a script, another scheme and a name follow nothing, and a window with no way to open one has no link (links.activate)
//   links-axe        axe-core finds nothing in the tooltip of a link (axe.tooltip)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AXE } from './harness.mjs';
import { createHost } from './terminal-host.mjs';
import { serveContext } from './terminal-serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** The lines of the replay's flood, and the bytes they are (the host's `flood N W` writes lines of W bytes and a line break). */
const REPLAY_LINES = 3000;
const REPLAY_BYTES = REPLAY_LINES * 82;

/** The characters between words, as the emulator's find counts a whole word (the search addon's own list): a word is whole when each side of it is one of these, or the end of the line. */
const NON_WORD = ' ~!@#$%^&*()+`-=[]{}|\\;:"\',./<>?';

/**
 * The bar's controls in the order a person goes through them, written here and not read from the page: the field, then the six buttons of its row. The kit's roving group makes the row ONE Tab stop (its first button, while nothing in it is
 * pressed and nothing was focused) and its arrows walk the row without wrapping, so a Tab from the field reaches Match case and the arrows reach the others in this order. A button that the page took out of that order is still in this list.
 */
const BAR_ORDER = ['Find in terminal', 'Match case', 'Use regular expression', 'Match whole word', 'Previous match', 'Next match', 'Close find'];

/** The mock's find bar, measured in each engine at each viewport (mock-terminal-find-measure.mjs): absent until it was run. */
const reference = () => {
  try {
    return JSON.parse(readFileSync(path.join(here, 'mock-terminal-find.json'), 'utf8'));
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------------- what the page is given before its own scripts

/** Chromium says it runs on Linux: the seam's own way (SEAM_PLATFORM=linux), so that the chords and the words of the platforms that are not a Mac are run on a Mac. WebKit says what it is. */
const LINUX = () => {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64', configurable: true });
};

/**
 * The clipboard of the page, deterministic: what the page writes is kept (`writes`), what it reads is `text` (`empty`: nothing). `drop` is given to the script (`addInitScript` passes it) and is true only for the negative control
 * `clipboard-dropped`, a clipboard that keeps nothing it is given: the clipboard and its fault are made in this one script, so that the fault never waits on another script that Playwright does not order against it.
 */
const CLIPBOARD = ({ drop }) => {
  const clip = (window.__clip = { text: 'pasted from the clipboard', writes: [], reads: 0, drop, empty: false });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        if (!clip.drop) clip.writes.push(String(text));
      },
      readText: async () => {
        clip.reads += 1;
        return clip.empty ? '' : clip.text;
      },
    },
  });
};

/** What the sections read of the page, in the page (`window.__find`), so that it is read in one task: the find bar, the menu, the tooltip of a link and where a piece of the output is. */
const HELPERS = () => {
  const find = (window.__find = {});
  const box = (element) => {
    if (element === null || element === undefined) return null;
    const rect = element.getBoundingClientRect();
    return [rect.x, rect.y, rect.width, rect.height].map((n) => Math.round(n * 100) / 100);
  };
  const body = () => document.querySelector('[data-shell-part="terminalBody"]');
  find.field = () => body()?.querySelector('input[type="search"]') ?? null;
  find.bar = () => {
    const named = body()?.querySelector('[data-shell-part="terminalFind"]');
    if (named !== null && named !== undefined) return named;
    const field = find.field();
    return field === null ? null : (field.closest('[role="search"]') ?? field.parentElement?.parentElement ?? null);
  };
  /** The part of the bar that holds the field (the box the bar gives it, which is a direct child of the bar): the field and its count lane inside it. */
  find.fieldBox = () => {
    const bar = find.bar();
    let node = find.field();
    if (bar === null) return null;
    while (node !== null && node.parentElement !== bar) node = node.parentElement;
    return node;
  };
  find.count = () => find.field()?.parentElement?.querySelector('[data-ov-lane]')?.textContent?.trim() ?? null;
  find.invalid = () => find.field()?.getAttribute('aria-invalid') === 'true';
  find.focused = () => find.field() !== null && document.activeElement === find.field();
  find.nodes = () => body()?.querySelectorAll('input[type="search"], [role="search"], [data-shell-part="terminalFind"]').length ?? 0;
  find.decorations = () => document.querySelectorAll('.xterm-decoration').length;
  find.buttons = () => {
    const bar = find.bar();
    return bar === null ? [] : [...bar.querySelectorAll('button')].filter((button) => button.getAttribute('aria-label') !== 'Clear search');
  };
  find.geometry = () => {
    const bar = find.bar();
    const field = find.field();
    const style = bar === null ? null : getComputedStyle(bar);
    return {
      screen: box(document.querySelector('[data-shell-part="terminalScreen"]')),
      bar: box(bar),
      field: box(find.fieldBox()),
      count: box(field?.parentElement?.querySelector('[data-ov-lane]') ?? null),
      buttons: find.buttons().map((button) => ({ name: button.getAttribute('aria-label') ?? '', rect: box(button) })),
      style: style === null ? null : { radius: style.borderTopLeftRadius, border: style.borderTopWidth, padding: style.paddingTop },
    };
  };
  find.active = () => {
    const element = document.activeElement;
    return element === null ? null : { name: element.getAttribute('aria-label') ?? element.tagName, inBar: find.bar() !== null && find.bar().contains(element), terminal: element.classList.contains('xterm-helper-textarea') };
  };
  find.menu = () => {
    const popup = document.querySelector('[role="menu"]');
    if (popup === null || popup.getClientRects().length === 0) return null;
    return {
      label: popup.getAttribute('aria-label'),
      items: [...popup.querySelectorAll('[role="menuitem"]')].map((item) => ({ label: item.getAttribute('aria-label'), text: item.textContent ?? '', disabled: item.getAttribute('aria-disabled') === 'true', description: item.getAttribute('aria-description') ?? '' })),
      separators: popup.querySelectorAll('[role="separator"]').length,
    };
  };
  /** The nodes that say how to follow a link: the elements with no child whose words start with "Follow link". */
  find.tooltips = () => [...document.querySelectorAll('body *')].filter((element) => element.children.length === 0 && /^Follow link/.test((element.textContent ?? '').trim()));
  find.pointOf = (text) => {
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
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }

    return null;
  };
  find.rows = () => [...document.querySelectorAll('.xterm-rows > div')].map((row) => (row.textContent ?? '').replaceAll('\u00a0', ' ').trimEnd()).filter((text) => text !== '');
};

// ---------------------------------------------------------------------------------------------------- the parts and the negative controls

export const FIND_PARTS = {
  'find-a': ['find-open', 'find-count', 'find-keys', 'find-lazy'],
  'find-b': ['find-replay', 'find-idle', 'find-cap', 'find-axe'],
  'find-c': ['menu-open', 'menu-mouse', 'menu-axe'],
  'find-d': ['links-tooltip', 'links-activate', 'links-axe'],
};

/** What a control plants in the bar that axe finds: an image with no text alternative (the pattern of `axe-failed`). */
const plantImage = (selector) => (page) =>
  page.evaluate(
    ({ src, target }) => {
      const image = document.createElement('img');
      image.src = src;
      document.querySelector(target).append(image);
    },
    { src: IMAGE, target: selector },
  );

/**
 * The negative controls of the T3a assertions, each a single fault, in the shape of the probe's own table: `query` is a control of the fixture page (`?control=`, terminal-fixture.tsx: the shell, the emulator's wrapper, the window's
 * `openExternal`), `host` one of the far end (terminal-host.mjs `faults`), `init` is run in the page before its own scripts, and `after` at the `stage` the section names. Each runs in Chromium: what it proves does not depend on the engine.
 */
export const FIND_CONTROLS = {
  // The chord never reaches the product (a window that takes it first), and a bar that takes room from the screen: the emulator's rows are the ones it had less the bar's own.
  'find-chord-lost': {
    assertion: 'find.open',
    section: 'find-open',
    engines: ['chromium'],
    init: () => {
      window.addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) event.stopImmediatePropagation(); }, true);
    },
  },
  'find-pushes-grid': {
    assertion: 'find.open',
    section: 'find-open',
    engines: ['chromium'],
    init: () => {
      new MutationObserver(() => {
        const bar = document.querySelector('[data-shell-part="terminalFind"]');
        const screen = document.querySelector('[data-shell-part="terminalScreen"]');
        if (bar !== null && screen !== null && screen.dataset.pushed === undefined) {
          screen.dataset.pushed = '';
          const height = screen.getBoundingClientRect().height;
          screen.style.flex = 'none';
          screen.style.height = `${String(height - 72)}px`;
        }
      }).observe(document, { childList: true, subtree: true });
    },
  },
  'find-button-unpressed': {
    assertion: 'find.open',
    section: 'find-open',
    engines: ['chromium'],
    stage: 'opened',
    after: (page) => page.evaluate(() => { document.querySelector('[data-terminal-tool="find"]')?.setAttribute('aria-pressed', 'false'); }),
  },
  'find-button-dead': {
    assertion: 'find.open',
    section: 'find-open',
    engines: ['chromium'],
    init: () => {
      document.addEventListener('click', (event) => { if (event.target instanceof Element && event.target.closest('[data-terminal-tool="find"]') !== null) event.stopImmediatePropagation(); }, true);
    },
  },
  // The count against the reference scan: output the screen lacks, and an emulator that reads a query without the case switch, without the whole word switch, without the pattern switch, or a find that does not leave the match it is on.
  'known-short': { assertion: 'find.count', section: 'find-count', engines: ['chromium'], query: 'control=known-short' },
  'count-case-ignored': { assertion: 'find.count', section: 'find-count', engines: ['chromium'], query: 'control=count-case-ignored' },
  'count-word-ignored': { assertion: 'find.count', section: 'find-count', engines: ['chromium'], query: 'control=count-word-ignored' },
  'count-regex-ignored': { assertion: 'find.count', section: 'find-count', engines: ['chromium'], query: 'control=count-regex-ignored' },
  'step-stuck': { assertion: 'find.count', section: 'find-count', engines: ['chromium'], query: 'control=step-stuck' },
  // An Escape that never reaches the bar, and an F3 that never reaches the find.
  'find-escape-stuck': {
    assertion: 'find.keys',
    section: 'find-keys',
    engines: ['chromium'],
    init: () => {
      window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.querySelector('[data-shell-part="terminalBody"] input[type="search"]') !== null) event.stopImmediatePropagation(); }, true);
    },
  },
  'find-f3-lost': {
    assertion: 'find.keys',
    section: 'find-keys',
    engines: ['chromium'],
    init: () => {
      window.addEventListener('keydown', (event) => { if (event.key === 'F3') { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    },
  },
  'find-escape-terminal-stuck': {
    assertion: 'find.keys',
    section: 'find-keys',
    engines: ['chromium'],
    init: () => {
      window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.activeElement?.classList.contains('xterm-helper-textarea') && document.querySelector('[data-shell-part="terminalFind"]') !== null) event.stopImmediatePropagation(); }, true);
    },
  },
  'find-ctrl-f-lost': {
    assertion: 'find.keys',
    section: 'find-keys',
    engines: ['chromium'],
    init: () => {
      window.addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'f' && event.ctrlKey && !event.shiftKey && !event.metaKey) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    },
  },
  // The row of buttons has one Tab stop, its first button, and a page that takes it out of the Tab order has no way into the row from the field.
  'find-tab-stop-lost': {
    assertion: 'find.keys',
    section: 'find-keys',
    engines: ['chromium'],
    init: () => {
      const strip = () => {
        const button = document.querySelector('[data-shell-part="terminalFind"] button[aria-label="Match case"]');
        if (button !== null && button.getAttribute('tabindex') !== '-1') button.setAttribute('tabindex', '-1');
      };

      new MutationObserver(strip).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex'] });
    },
  },
  'reopen-forgets': { assertion: 'find.keys', section: 'find-keys', engines: ['chromium'], query: 'control=reopen-forgets' },
  // The code that finds is asked for when the page loads.
  'search-eager': { assertion: 'find.lazy', section: 'find-lazy', engines: ['chromium'], query: 'control=search-eager' },
  // The host's replay lacks its last bytes: the last lines of the scrollback are not there to be found.
  'find-replay-gap': { assertion: 'find.replay', section: 'find-replay', engines: ['chromium'], host: { faults: { replayGap: true } } },
  // A bar that stays in the document while it is closed, and a page that commits at rest.
  'find-mounted': {
    assertion: 'find.idle',
    section: 'find-idle',
    engines: ['chromium'],
    stage: 'idle',
    after: (page) => page.evaluate(() => { const bar = document.createElement('div'); bar.setAttribute('role', 'search'); document.querySelector('[data-shell-part="terminalBody"]').append(bar); }),
  },
  'idle-commits': { assertion: 'find.idle', section: 'find-idle', engines: ['chromium'], query: 'control=idle-commits' },
  // No highest count, a buffer with fewer matches than the highest count, and highlights that are never let go of (elements for more matches than the find highlights).
  'cap-unlimited': { assertion: 'find.cap', section: 'find-cap', engines: ['chromium'], query: 'control=cap-unlimited' },
  'cap-short': { assertion: 'find.cap', section: 'find-cap', engines: ['chromium'], query: 'control=cap-short' },
  'decorations-leak': {
    assertion: 'find.cap',
    section: 'find-cap',
    engines: ['chromium'],
    stage: 'found',
    after: (page) => page.evaluate(() => { const container = document.querySelector('.xterm-decoration-container'); for (let n = 0; n < 20_001; n += 1) { const element = document.createElement('div'); element.className = 'xterm-decoration'; container.append(element); } }),
  },
  'find-axe': { assertion: 'axe.find', section: 'find-axe', engines: ['chromium'], stage: 'axe', after: plantImage('[data-probe-axe="find"]') },
  // The menu: an item that is not there, a paste that goes nowhere, an input that never gets the attributes of the menu's trigger (so that the keyboard does not open it), and a clipboard that keeps nothing it is given.
  'menu-item-missing': {
    assertion: 'menu.open',
    section: 'menu-open',
    engines: ['chromium'],
    stage: 'open',
    after: (page) => page.evaluate(() => { document.querySelector('[role="menu"] [role="menuitem"][aria-label="Find"]')?.remove(); }),
  },
  'menu-shortcut-drawn': {
    assertion: 'menu.open',
    section: 'menu-open',
    engines: ['chromium'],
    stage: 'open',
    after: (page) => page.evaluate(() => { const item = document.querySelector('[role="menu"] [role="menuitem"][aria-label="Copy"]'); const hint = document.createElement('span'); hint.textContent = '⌘C'; item?.append(hint); }),
  },
  'paste-lost': { assertion: 'menu.open', section: 'menu-open', engines: ['chromium'], query: 'control=paste-lost' },
  'trigger-lost': { assertion: 'menu.open', section: 'menu-open', engines: ['chromium'], query: 'control=trigger-lost' },
  'clipboard-dropped': { assertion: 'menu.open', section: 'menu-open', engines: ['chromium'], clipboard: { drop: true } },
  // A shell that never asks for the mouse, an emulator that never says the program has it, and a Shift that never gets the menu through.
  'mouse-never': { assertion: 'menu.mouse', section: 'menu-mouse', engines: ['chromium'], query: 'control=mouse-never' },
  'mouse-reporting-lost': { assertion: 'menu.mouse', section: 'menu-mouse', engines: ['chromium'], query: 'control=mouse-reporting-lost' },
  'shift-menu-blocked': {
    assertion: 'menu.mouse',
    section: 'menu-mouse',
    engines: ['chromium'],
    init: () => {
      window.addEventListener('contextmenu', (event) => { if (event.shiftKey) event.preventDefault(); }, true);
    },
  },
  'menu-axe': { assertion: 'axe.menu', section: 'menu-axe', engines: ['chromium'], stage: 'axe', after: plantImage('[data-probe-axe="menu"]') },
  // The pointer is never said to be on a link, and never said to have left it.
  'links-hover-never': { assertion: 'links.tooltip', section: 'links-tooltip', engines: ['chromium'], query: 'control=links-hover-never' },
  'links-leave-never': { assertion: 'links.tooltip', section: 'links-tooltip', engines: ['chromium'], query: 'control=links-leave-never' },
  // A click that the emulator says had the modifier held, a window whose way to open an address records every call twice, and a window that gives the way it says it cannot.
  'links-plain-follows': { assertion: 'links.activate', section: 'links-activate', engines: ['chromium'], query: 'control=links-plain-follows' },
  'open-twice': { assertion: 'links.activate', section: 'links-activate', engines: ['chromium'], query: 'control=open-twice' },
  'open-given': { assertion: 'links.activate', section: 'links-activate', engines: ['chromium'], query: 'control=open-given' },
  'tooltip-axe': { assertion: 'axe.tooltip', section: 'links-axe', engines: ['chromium'], stage: 'axe', after: plantImage('[data-probe-axe="tooltip"]') },
};

// ---------------------------------------------------------------------------------------------------- the reference scan

/** The matches of a word in the lines of the buffer, counted as the probe counts them (and not as the emulator does): literal, in the case asked for, whole when it is asked for. */
const countLiteral = (lines, term, { caseSensitive, wholeWord }) => {
  const needle = caseSensitive ? term : term.toLowerCase();
  let count = 0;
  for (const line of lines) {
    const text = caseSensitive ? line : line.toLowerCase();
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      const before = at === 0 || NON_WORD.includes(text[at - 1]);
      const after = at + needle.length === text.length || NON_WORD.includes(text[at + needle.length]);
      if (!wholeWord || (before && after)) count += 1;
    }
  }

  return count;
};

/** The matches of a pattern in the lines of the buffer, in the case asked for (an empty match is not one). */
const countPattern = (lines, pattern, { caseSensitive }) => {
  const expression = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  let count = 0;
  for (const line of lines) for (const match of line.matchAll(expression)) if (match[0].length > 0) count += 1;
  return count;
};

/** What the bar's count says for `n` matches when the screen is on the first of them (`k of N`), and when there are none. */
const saysFor = (n, k = 1) => (n === 0 ? 'No results' : `${String(k)} of ${String(n)}`);

/**
 * @param {{ check: Function, note: Function, report: { numbers: Record<string, unknown> }, runAxe: Function }} deps
 */
export function createFindSections({ check, note, report, runAxe }) {
  const sections = {};
  const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const near = (a, b, tolerance = 1) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;
  const rectNear = (a, b, tolerance = 1) => Array.isArray(a) && Array.isArray(b) && a.length === 4 && a.every((value, index) => near(value, b[index], tolerance));

  /** What a control plants at the stage it names, as the probe's own `perturb` does. */
  const perturb = async (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

  /** Whether the page is waited for: `done` is true of the page within `timeout` ms, read on every frame; false when it never was (what the assertion says is then what the page held). */
  const waitFor = async (page, done, arg, timeout = 15_000) =>
    page.waitForFunction(done, arg, { timeout }).then(
      () => true,
      () => false,
    );

  /** Two frames have passed (what the page did with an event is on the screen): a page that draws no frame is not waited for past a second. */
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

  /** The emulator's columns and rows once they have stopped changing: the same twice in three frames each. */
  const settledGrid = async (page) => {
    let grid = await page.evaluate(() => window.__engine.grid());
    for (let rounds = 0; rounds < 40; rounds += 1) {
      await frames(page, 3);
      const next = await page.evaluate(() => window.__engine.grid());
      if (next.cols === grid.cols && next.rows === grid.rows) return next;
      grid = next;
    }

    return grid;
  };

  const installIn = async (target, ctx) => {
    if (ctx.engine === 'chromium') await target.addInitScript(LINUX);
    await target.addInitScript(CLIPBOARD, { drop: ctx.control?.clipboard?.drop === true });
    await target.addInitScript(HELPERS);
    if (ctx.control?.init !== undefined) await target.addInitScript(ctx.control.init);
  };

  /** A page of the fixture (the synthetic shell in the page; `dev` is the development build, whose React Profiler counts commits). */
  async function openPage(ctx, { query = '', dev = false } = {}) {
    const { browser, origin, devOrigin, viewport, control } = ctx;
    const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
    const page = await context.newPage();
    page.errors = [];
    page.requests = [];
    page.on('pageerror', (error) => page.errors.push(String(error.message).slice(0, 300)));
    page.on('request', (request) => page.requests.push(request.url()));
    await installIn(page, ctx);
    const params = ['renderer=dom', query, control?.query].filter((part) => part !== undefined && part !== '').join('&');
    await page.goto(`${dev ? devOrigin : origin}/shell/probes/terminal-fixture.html?${params}`, { waitUntil: 'load' });
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

  const isMac = async (page) => page.evaluate(() => /Mac/.test(navigator.platform));
  /** The chord that opens the find on the platform (the Command one, the Control Shift one: the written spec's). */
  const findChord = (mac) => (mac ? 'Meta+f' : 'Control+Shift+f');
  /** WebKit on a Mac leaves buttons out of the Tab order unless the system asks for it: Alt+Tab is its Tab (as in the kit's probes). */
  const tabKey = (engine) => (engine === 'webkit' ? 'Alt+Tab' : 'Tab');

  const countText = async (page) => page.evaluate(() => window.__find.count());
  /** The bar says exactly `text` within `timeout` ms: answers what it says. */
  const countIs = async (page, text, timeout = 8000) => {
    await waitFor(page, (want) => window.__find.count() === want, text, timeout);
    return countText(page);
  };

  /** The bar says something that matches `source` within `timeout` ms: answers what it says. */
  const countLike = async (page, source, timeout = 8000) => {
    await waitFor(page, (pattern) => new RegExp(pattern).test(window.__find.count() ?? ''), source, timeout);
    return countText(page);
  };

  /** The host's state is read until `done` says so (the host is in this process: what is read is an observation, and the wait ends when it holds). */
  const waitHost = async (done, ms = 15_000) => {
    const stop = Date.now() + ms;
    while (!done() && Date.now() < stop) await sleep(30);
    return done();
  };

  /** The bar is open and the field has the keyboard, by the chord `chord` (the platform's own, when none is given). */
  async function opened(page, mac, chord = findChord(mac)) {
    await page.keyboard.press(chord);
    return waitFor(page, () => window.__find.focused(), null, 6000);
  }

  const barButton = (page, name) => page.locator('[data-shell-part="terminalFind"]').getByRole('button', { name });
  const field = (page) => page.locator('[data-shell-part="terminalBody"] input[type="search"]');
  const pressed = async (page, name) => (await barButton(page, name).getAttribute('aria-pressed')) === 'true';

  // ------------------------------------------------------------------------------------------------ find.open
  sections['find-open'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await start(page);
      await ran(page, 'known');
      const mac = await isMac(page);
      const before = await settledGrid(page);
      await page.keyboard.press(findChord(mac));
      const shown = await waitFor(page, () => window.__find.field() !== null, null, 6000);
      const focused = shown && (await waitFor(page, () => window.__find.focused(), null, 6000));
      const after = await settledGrid(page);
      const read = await page.evaluate(() => window.__find.geometry());
      // The toolbar's Find button says the bar is open (it is pressed), closes the bar when it is pressed, and opens it again with the keyboard in its field.
      await perturb(ctx, page, 'opened');
      const toolFind = page.locator('[data-terminal-tool="find"]');
      const pressedOpen = await toolFind.getAttribute('aria-pressed');
      await toolFind.click();
      const closedByButton = await waitFor(page, () => window.__find.nodes() === 0, null, 3000);
      const pressedClosed = await toolFind.getAttribute('aria-pressed');
      await toolFind.click();
      const openedByButton = await waitFor(page, () => window.__find.focused(), null, 3000);
      const mock = reference();
      const ref = mock?.data?.[engine]?.[vp] ?? null;
      const gap = mock?.rules?.gap ?? 4;
      const round2 = (value) => Math.round(value * 100) / 100;
      const items = [read.field, ...read.buttons.map((button) => button.rect)].filter((rect) => rect !== null).sort((a, b) => a[0] - b[0]);
      const gaps = items.slice(1).map((rect, index) => round2(rect[0] - (items[index][0] + items[index][2])));
      /** How far the bar is from the top of its screen and from the edge it is anchored to: the mock's bar is on the right (the distance from the right edge), or on the left when the measurement found it there. */
      const side = ref !== null && ref.screen[0] + ref.screen[2] - (ref.find[0] + ref.find[2]) <= ref.find[0] - ref.screen[0] ? 'right' : 'left';
      const insetOf = (bar, screen) => (bar === null || screen === null ? null : [round2(side === 'right' ? screen[0] + screen[2] - (bar[0] + bar[2]) : bar[0] - screen[0]), round2(bar[1] - screen[1])]);
      const inset = insetOf(read.bar, read.screen);
      /** The bar is its field, its buttons, the space between them and its own padding and border: the mock's bar is read by its parts, because its width in WebKit holds 10.61 px that none of them has (a shrink to fit of the mock's own). */
      const chrome = ref === null ? 0 : Number.parseFloat(ref.style.paddingRight) + Number.parseFloat(ref.style.borderTopWidth);
      const wanted = ref === null ? null : { inset: insetOf(ref.find, ref.screen), height: ref.find[3], field: ref.field[2], fieldHeight: ref.field[3], button: ref.buttons[0].slice(2), width: ref.field[2] + (ref.buttons.length + 1) * (ref.buttons[0][2] + gap) + 2 * chrome, buttons: ref.buttons.length + 1, side };
      const placed =
        wanted !== null &&
        inset !== null &&
        near(inset[0], wanted.inset[0]) &&
        near(inset[1], wanted.inset[1]) &&
        near(read.bar[3], wanted.height) &&
        near(read.field?.[2], wanted.field) &&
        near(read.field?.[3], wanted.fieldHeight) &&
        near(read.bar[2], wanted.width) &&
        read.buttons.length === wanted.buttons &&
        read.buttons.every((button) => near(button.rect?.[2], wanted.button[0]) && near(button.rect?.[3], wanted.button[1])) &&
        gaps.length > 0 &&
        gaps.every((value) => near(value, gap));
      check(
        'find.open',
        shown && focused && before.cols === after.cols && before.rows === after.rows && placed && pressedOpen === 'true' && closedByButton && pressedClosed === 'false' && openedByButton,
        `${tag}: the chord ${findChord(mac)} ${shown ? 'opened' : 'did NOT open'} the bar, the field ${focused ? 'has' : 'does NOT have'} the keyboard; the emulator had ${String(before.cols)} x ${String(before.rows)} cells and has ${String(after.cols)} x ${String(after.rows)} (the same is right); the bar is ${JSON.stringify(read.bar)} (${JSON.stringify(inset)} in from the screen ${JSON.stringify(read.screen)}), its field ${JSON.stringify(read.field)}, ${String(read.buttons.length)} buttons ${JSON.stringify(read.buttons.map((button) => button.name))} with gaps ${JSON.stringify(gaps)}; the mock's bar${ref === null ? ' is not measured (run mock-terminal-find-measure.mjs)' : ` is ${JSON.stringify(ref.find)} on its screen ${JSON.stringify(ref.screen)} with a field of ${String(ref.field[2])} px and ${String(ref.buttons.length)} buttons: ${JSON.stringify(wanted)} is what the host's must be (one more button: the whole word switch) at gaps of ${String(gap)} px`}; the toolbar's Find button is ${JSON.stringify(pressedOpen)} while the bar is open (pressed: "true"), the press ${closedByButton ? 'closed' : 'did NOT close'} the bar and the button is then ${JSON.stringify(pressedClosed)} ("false"), and a second press ${openedByButton ? 'opened' : 'did NOT open'} it with the keyboard in the field`,
      );
      note(`find open ${tag}: the bar at ${JSON.stringify(inset)} from the screen, ${JSON.stringify(read.bar?.slice(2))} px, a field of ${String(read.field?.[2])} px, the emulator ${String(after.cols)} x ${String(after.rows)} before and after`);
      report.numbers[`find-open ${tag}`] = { read, gaps, before, after };
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ find.count
  sections['find-count'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await start(page);
      await ran(page, 'known');
      const known = await page.evaluate(() => window.__known);
      const mac = await isMac(page);
      const open = await opened(page, mac);
      const input = field(page);
      const steps = [];
      /** A reading waits for the count as long as a slow page needs, until one has failed: what follows a failed reading is read at once, so that a fault does not wait out every step after it. */
      const patience = () => (steps.some((step) => !step.ok) ? 150 : 8000);
      const exact = async (name, want) => {
        const got = await countIs(page, want, patience());
        steps.push({ name, want, got, ok: got === want });
      };

      const like = async (name, n) => {
        const source = n === 0 ? '^No results$' : `^(\\d+|\\?) of ${String(n)}$`;
        const got = await countLike(page, source, patience());
        steps.push({ name, want: source, got, ok: got !== null && new RegExp(source).test(got) });
      };

      const flags = { caseSensitive: false, wholeWord: false, regex: false };
      /** A switch is pressed: its button says so, and the probe's scan counts with the switches as they are from then on. */
      const press = async (key, name) => {
        await barButton(page, name).click();
        flags[key] = !flags[key];
        const says = await pressed(page, name);
        steps.push({ name: `the ${key} switch ${flags[key] ? 'is pressed' : 'is let go'}`, want: flags[key], got: says, ok: says === flags[key] });
      };

      // 1. A word with no switch: the first match is the screen's, the steps go to the last and wrap to the first, and back.
      const first = countLiteral(known, 'alpha', flags);
      await input.fill('alpha');
      await exact('the first match', saysFor(first, 1));
      for (let step = 2; step <= first; step += 1) {
        await barButton(page, /next/i).click();
        await exact(`next, to ${String(step)}`, saysFor(first, step));
      }

      await barButton(page, /next/i).click();
      await exact('next wraps to the first', saysFor(first, 1));
      await barButton(page, /previous/i).click();
      await exact('previous wraps to the last', saysFor(first, first));
      await barButton(page, /previous/i).click();
      await exact('previous steps back', saysFor(first, first - 1));

      // 2. The switches, one after another: the count is the reference scan's for the switches as they are.
      await press('caseSensitive', /match case/i);
      await like('the case switch', countLiteral(known, 'alpha', flags));
      await press('wholeWord', /whole word/i);
      await like('case and whole word', countLiteral(known, 'alpha', flags));
      await press('caseSensitive', /match case/i);
      await like('whole word alone', countLiteral(known, 'alpha', flags));
      await press('wholeWord', /whole word/i);
      await press('regex', /regular expression|regex/i);
      await input.fill('(alpha|delta)');
      await like('a pattern', countPattern(known, '(alpha|delta)', flags));

      // 3. A pattern that does not parse says so, and so does a word that is not there.
      await input.fill('(');
      await exact('a pattern that does not parse', 'Invalid pattern');
      const invalid = await page.evaluate(() => window.__find.invalid());
      steps.push({ name: 'the field is aria-invalid for it', want: true, got: invalid, ok: invalid });
      await press('regex', /regular expression|regex/i);
      await input.fill('zzzzzz');
      await exact('a word that is not there', 'No results');
      const valid = await page.evaluate(() => window.__find.invalid());
      steps.push({ name: 'the field is not aria-invalid for it', want: false, got: valid, ok: !valid });
      const wrong = steps.filter((step) => !step.ok);
      check(
        'find.count',
        open && wrong.length === 0,
        `${tag}: the bar ${open ? 'opened' : 'did NOT open'}; of ${String(steps.length)} readings of the count against the probe's own scan of the ${String(known.length)} lines, ${String(wrong.length)} are wrong: ${JSON.stringify(wrong.slice(0, 4))}`,
      );
      note(`find count ${tag}: ${String(steps.length)} readings of the count, ${String(wrong.length)} wrong; alpha has ${String(first)} matches in ${String(known.length)} lines`);
      report.numbers[`find-count ${tag}`] = { steps };
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ find.keys
  sections['find-keys'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await start(page);
      await ran(page, 'known');
      const mac = await isMac(page);
      const total = countLiteral(await page.evaluate(() => window.__known), 'alpha', { caseSensitive: false, wholeWord: false });
      const open = await opened(page, mac);
      const readings = [];
      /** A reading waits for the count as long as a slow page needs, until one has failed (what follows a failed reading is read at once). */
      const record = async (name, want) => {
        const got = await countIs(page, want, readings.some((reading) => !reading.ok) ? 150 : 8000);
        readings.push({ name, want, got, ok: got === want });
      };

      await field(page).fill('alpha');
      await record('the first match', saysFor(total, 1));
      // Enter and Shift+Enter in the field.
      await page.keyboard.press('Enter');
      await record('Enter steps on', saysFor(total, 2));
      await page.keyboard.press('Shift+Enter');
      await record('Shift+Enter steps back', saysFor(total, 1));
      // F3 and Shift+F3 with the terminal's own input focused (the bar stays open).
      await page.locator('.xterm-helper-textarea').focus();
      await page.keyboard.press('F3');
      await record('F3 steps on', saysFor(total, 2));
      await page.keyboard.press('Shift+F3');
      await record('Shift+F3 steps back', saysFor(total, 1));
      const highlighted = await page.evaluate(() => window.__find.decorations());
      // Escape with the terminal's own input focused closes the bar too, and that Escape is the bar's and not the shell's; the bar opened again looks for the text it kept.
      const sent = await page.evaluate(() => window.__pty.log.writes.length);
      await page.keyboard.press('Escape');
      const closedFromTerminal = await waitFor(page, () => window.__find.nodes() === 0, null, 5000);
      await frames(page);
      const leaked = await page.evaluate((count) => window.__pty.log.writes.slice(count).join(''), sent);
      const reopened = await opened(page, mac);
      const kept = await countLike(page, `^(\\d+|\\?) of ${String(total)}$`, readings.some((reading) => !reading.ok) ? 150 : 8000);
      readings.push({ name: 'the bar opened again searches the text it kept', want: `${String(total)} matches`, got: kept, ok: kept !== null && new RegExp(`^(\\d+|\\?) of ${String(total)}$`).test(kept) });
      // Escape in the field: the bar is gone, the highlights are gone and what is typed next is the shell's.
      await field(page).focus();
      const writes = await page.evaluate(() => window.__pty.log.writes.length);
      await page.keyboard.press('Escape');
      const closed = await waitFor(page, () => window.__find.nodes() === 0, null, 5000);
      await frames(page);
      const where = await page.evaluate(() => window.__find.active());
      const left = await page.evaluate(() => window.__find.decorations());
      await page.keyboard.type('xyz');
      await waitFor(page, (count) => window.__pty.log.writes.length > count, writes, 5000);
      const typed = await page.evaluate((count) => window.__pty.log.writes.slice(count).join(''), writes);
      // The platform's other chord (Control F: a Mac has only the one) opens the bar again. Then Tab leaves the field for the row of buttons, which is one stop (its first button), the arrows walk the row, and one Tab more leaves the bar. The
      // order expected is the probe's own list (`BAR_ORDER`) and is not read from the page, so a button that the page took out of the order cannot drop out of what is expected.
      const again = await opened(page, mac, mac ? findChord(mac) : 'Control+f');
      const begun = await page.evaluate(() => window.__find.active());
      const walked = [];
      await page.keyboard.press(tabKey(engine));
      walked.push((await page.evaluate(() => window.__find.active()))?.name);
      for (let step = 2; step < BAR_ORDER.length; step += 1) {
        await page.keyboard.press('ArrowRight');
        walked.push((await page.evaluate(() => window.__find.active()))?.name);
      }

      await page.keyboard.press(tabKey(engine));
      const out = await page.evaluate(() => window.__find.active());
      const inOrder = begun?.name === BAR_ORDER[0] && JSON.stringify(walked) === JSON.stringify(BAR_ORDER.slice(1));
      const wrong = readings.filter((reading) => !reading.ok);
      check(
        'find.keys',
        open && wrong.length === 0 && highlighted > 0 && closedFromTerminal && leaked === '' && reopened && closed && left === 0 && where?.terminal === true && typed === 'xyz' && again && inOrder && out?.inBar === false,
        `${tag}: the bar ${open ? 'opened' : 'did NOT open'}; ${String(readings.length - wrong.length)} of ${String(readings.length)} steps by the keys are right (${JSON.stringify(wrong.slice(0, 3))}); ${String(highlighted)} highlights while it was open; Escape in the terminal's input ${closedFromTerminal ? 'closed' : 'did NOT close'} the bar and the shell was sent ${JSON.stringify(leaked)} (nothing is right); Escape in the field ${closed ? 'closed' : 'did NOT close'} the bar and left ${String(left)} highlights (none is right), the keyboard is ${JSON.stringify(where)} (the terminal's input) and typing xyz reached the shell as ${JSON.stringify(typed)}; from the field (${JSON.stringify(begun?.name)}) Tab and the arrows went to ${JSON.stringify(walked)} where the bar's controls are ${JSON.stringify(BAR_ORDER.slice(1))}, and one Tab more went to ${JSON.stringify(out)} (out of the bar is right)`,
      );
      note(`find keys ${tag}: ${String(readings.length)} steps by Enter, Shift+Enter, F3 and Shift+F3, Escape left ${String(left)} highlights of ${String(highlighted)} and the shell got ${JSON.stringify(typed)}, Tab and the arrows went through ${String(BAR_ORDER.length - 1)} controls`);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ find.lazy
  sections['find-lazy'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      const chunks = () => page.requests.filter((url) => /addon-search/.test(url)).length;
      const entries = async () => page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => /addon-search/.test(entry.name)).length);
      await start(page);
      await ran(page, 'known');
      const early = { requests: chunks(), entries: await entries() };
      const mac = await isMac(page);
      await opened(page, mac);
      await field(page).fill('alpha');
      await waitFor(page, () => /^\d+ of \d+$/.test(window.__find.count() ?? ''));
      const first = { requests: chunks(), entries: await entries() };
      await page.keyboard.press('Escape');
      await waitFor(page, () => window.__find.nodes() === 0, null, 5000);
      await opened(page, mac);
      await field(page).fill('delta');
      await waitFor(page, () => /^\d+ of \d+$/.test(window.__find.count() ?? ''));
      const second = { requests: chunks(), entries: await entries() };
      check(
        'find.lazy',
        early.requests === 0 && early.entries === 0 && first.requests === 1 && first.entries === 1 && second.requests === 1 && second.entries === 1,
        `${tag}: requests for the code that finds: ${String(early.requests)} before the first find (${String(early.entries)} resource entries: none is right), ${String(first.requests)} after it (${String(first.entries)}: one) and ${String(second.requests)} after a second open (${String(second.entries)}: still one)`,
      );
      note(`find lazy ${tag}: the code that finds was requested ${String(early.requests)} times before the first find, ${String(first.requests)} after it, ${String(second.requests)} after a second open`);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ find.replay
  sections['find-replay'] = async (ctx) => {
    const { engine, vp, browser, origin, viewport, control } = ctx;
    const tag = `${engine} ${vp}`;
    const host = createHost({ ...control?.host?.options, faults: { ...control?.host?.faults } });
    const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
    const served = await serveContext(context, host);
    try {
      await installIn(context, ctx);
      const query = ['host=shared', 'renderer=dom', control?.query].filter((part) => part !== undefined && part !== '').join('&');
      const page = await context.newPage();
      await page.goto(`${origin}/shell/probes/terminal-fixture.html?${query}`, { waitUntil: 'load' });
      await page.waitForSelector('[data-shell-part="window"]');
      await page.click('[data-shell-part="panelToggle"]');
      await page.waitForSelector('[data-shell-part="panelEmpty"]');
      await page.click('[data-shell-part="panelEmpty"] button');
      await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
      await page.waitForFunction(() => /user@synthetic/.test(document.querySelector('.xterm-rows')?.textContent ?? ''), null, { timeout: 20_000 });
      await page.locator('.xterm-helper-textarea').focus();
      const id = host.ids()[0];
      await page.keyboard.type(`flood ${String(REPLAY_LINES)} 80`);
      await page.keyboard.press('Enter');
      const flooded = await waitHost(() => (host.state(id)?.end ?? 0) >= REPLAY_BYTES && (host.state(id)?.waiting ?? 1) === 0 && host.state(id)?.paused === false, 40_000);
      await page.waitForFunction((last) => window.__engine.lines.last >= last, REPLAY_LINES - 1, { timeout: 40_000 });
      // The page loads again: its terminal is attached to it, and the host's replay is the scrollback it has.
      const attaches = host.log.attaches.length;
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('[data-shell-part="window"]');
      await waitHost(() => host.log.attaches.length > attaches, 15_000);
      // The panel comes back as it was left, and one left open a moment before the reload comes back closed in an engine that saves its state late (Chromium): a person opens it, and so does this.
      const shown = await page.evaluate(() => (document.querySelector('[data-shell-part="panel"]')?.getBoundingClientRect().height ?? 0) > 0);
      if (!shown) await page.click('[data-shell-part="panelToggle"]');
      // A page that was handed a replay it cannot join (the host's replay lacks its end: the stream does not continue where the replay says it ends) fails its terminal in words and shows no screen: it has nothing to find, and the check below says so.
      const screen = await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 }).then(() => true, () => false);
      const replayed = screen && (await waitFor(page, (last) => window.__engine.lines.last >= last, REPLAY_LINES - 1, 12_000));
      let open = false;
      const readings = [];
      if (screen) {
        await page.locator('.xterm-helper-textarea').focus();
        const mac = await isMac(page);
        open = await opened(page, mac);
        // What the replay holds is searched only when it came: a page that did not take it in has nothing to find, and the check says so.
        for (const line of replayed ? ['0002999', '0000123'] : []) {
          await field(page).fill(line);
          await waitFor(page, () => window.__find.count() !== null && window.__find.count() !== '');
          const got = await countIs(page, saysFor(1));
          readings.push({ line, got, ok: got === saysFor(1) });
        }
      }

      const wrong = readings.filter((reading) => !reading.ok);
      check(
        'find.replay',
        flooded && replayed && open && wrong.length === 0,
        `${tag}: the shell wrote ${String(REPLAY_LINES)} numbered lines ${flooded ? '' : '(NOT all of them reached the host) '}and the page, loaded again, ${replayed ? 'took' : 'did NOT take'} them in from the replay; the bar ${open ? 'opened' : 'did NOT open'}; finding the lines the host kept says ${JSON.stringify(readings)} (${JSON.stringify(saysFor(1))} each is right)`,
      );
      note(`find replay ${tag}: after a reload the replayed scrollback holds ${String(REPLAY_LINES)} lines and a find says ${JSON.stringify(readings.map((reading) => reading.got))}`);
    } finally {
      host.stop();
      await served.close();
      await context.close();
    }
  };

  // ------------------------------------------------------------------------------------------------ find.idle
  sections['find-idle'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx, { dev: true });
    try {
      await start(page);
      await ran(page, 'known');
      await perturb(ctx, page, 'idle');
      // A count of frames at rest (not a time): what the page commits and what it holds of the bar, before the bar was ever opened.
      const rest = async () => {
        const commits = await page.evaluate(() => window.__commits.length);
        await frames(page, 90);
        return page.evaluate((count) => ({ commits: window.__commits.length - count, nodes: window.__find.nodes() }), commits);
      };

      const never = await rest();
      const mac = await isMac(page);
      await opened(page, mac);
      await field(page).fill('alpha');
      await waitFor(page, () => /^\d+ of \d+$/.test(window.__find.count() ?? ''));
      await page.keyboard.press('Escape');
      await waitFor(page, () => window.__find.nodes() === 0, null, 5000);
      const used = await rest();
      check(
        'find.idle',
        never.nodes === 0 && never.commits === 0 && used.nodes === 0 && used.commits === 0,
        `${tag}: with the bar closed and never opened the page holds ${String(never.nodes)} nodes of it and committed ${String(never.commits)} times in 90 frames; opened and closed again ${String(used.nodes)} nodes and ${String(used.commits)} commits (none of them is right)`,
      );
      note(`find idle ${tag}: bar closed, 90 frames: ${String(never.nodes)} nodes and ${String(never.commits)} commits, and ${String(used.nodes)} nodes and ${String(used.commits)} commits after it was used`);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ find.cap
  sections['find-cap'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await start(page);
      await ran(page, 'dense');
      const mac = await isMac(page);
      const open = await opened(page, mac);
      await field(page).fill('needle');
      const capped = await waitFor(page, () => /20,000\+/.test(window.__find.count() ?? ''), null, 15_000);
      const text = await countText(page);
      await perturb(ctx, page, 'found');
      const elements = await page.evaluate(() => window.__find.decorations());
      check(
        'find.cap',
        open && capped && elements <= 20_000,
        `${tag}: the bar ${open ? 'opened' : 'did NOT open'}; in a buffer of lines of six matches each the count says ${JSON.stringify(text)} (it ends in "20,000+": the matches are more than the find highlights) and the page holds ${String(elements)} elements of highlights (20,000 at most)`,
      );
      note(`find cap ${tag}: the count says ${JSON.stringify(text)} and ${String(elements)} highlight elements are in the page`);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ axe.find
  sections['find-axe'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await start(page);
      await ran(page, 'known');
      const mac = await isMac(page);
      const open = await opened(page, mac);
      await field(page).fill('alpha');
      await waitFor(page, () => /^\d+ of \d+$/.test(window.__find.count() ?? ''));
      await page.addScriptTag({ path: AXE });
      await page.evaluate(() => window.__find.bar()?.setAttribute('data-probe-axe', 'find'));
      await perturb(ctx, page, 'axe');
      const found = open ? await runAxe(page, '[data-probe-axe="find"]') : ['the bar never opened'];
      check('axe.find', open && found.length === 0, `${tag}: the find bar (open ${String(open)}) with its field, its switches and its count: ${JSON.stringify(found)}`);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ the context menu
  const menuNow = async (page) => page.evaluate(() => window.__find.menu());
  /** The menu is open, answers what it holds; the pointer's way (the right click on the screen at `at`). */
  const openByPointer = async (page, at, modifiers = []) => {
    await page.mouse.move(at.x, at.y);
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    for (const key of modifiers) await page.keyboard.up(key);
  };

  const screenPoint = async (page) => {
    const box = await page.locator('[data-shell-part="terminalScreen"]').boundingBox();
    return { x: Math.round(box.x + box.width * 0.7), y: Math.round(box.y + box.height * 0.5) };
  };

  const menuShown = async (page, shown = true, timeout = 8000) => {
    await waitFor(page, (want) => (window.__find.menu() !== null) === want, shown, timeout);
    return menuNow(page);
  };

  sections['menu-open'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await start(page);
      await ran(page, 'known');
      const known = await page.evaluate(() => window.__known);
      // The items draw no shortcut: the kit names an item by its label alone, and a drawn shortcut makes the name differ from what is drawn (axe: label-content-name-mismatch), so the terminal's menu has none until the kit names the two together.
      const at = await screenPoint(page);
      const labels = ['Copy', 'Paste', 'Select all', 'Clear', 'Find', 'Open link', 'New terminal here'];
      const problems = [];
      const expect = (name, ok, got) => {
        if (!ok) problems.push({ name, got });
      };

      // 1. The pointer: the items, in order, with two separators, Copy unavailable while nothing is selected.
      await openByPointer(page, at);
      const first = await menuShown(page, true, 5000);
      await perturb(ctx, page, 'open');
      const again = await menuNow(page);
      expect('the pointer opens the menu', first !== null);
      expect('its items', JSON.stringify(again?.items?.map((item) => item.label)) === JSON.stringify(labels), again?.items?.map((item) => item.label));
      expect('two separators', again?.separators === 2, again?.separators);
      expect('Copy is unavailable without a selection', again?.items?.find((item) => item.label === 'Copy')?.disabled === true, again?.items);
      expect('the others are available, and Open link is not while no link is in view', again?.items?.filter((item) => item.label !== 'Copy' && item.label !== 'Open link').every((item) => !item.disabled) === true && again?.items?.find((item) => item.label === 'Open link')?.disabled === true, again?.items);
      expect('the menu is named', again?.label === 'Terminal actions', again?.label);
      const drawn = (again?.items ?? []).filter((item) => item.text !== item.label || /⌘|Ctrl|Shift|Alt/.test(item.description)).map((item) => ({ label: item.label, text: item.text, description: item.description }));
      expect('no item draws a shortcut', drawn.length === 0, drawn);
      // 2. Escape closes it and the keyboard is where it was.
      await page.keyboard.press('Escape');
      const closed = await menuShown(page, false);
      const back = await page.evaluate(() => window.__find.active());
      expect('Escape closes the menu', closed === null);
      expect('the keyboard is in the terminal after Escape', back?.terminal === true, back);
      // 3. The keyboard: Shift+F10 and the Menu key from the terminal's input open it; Escape closes it.
      await page.locator('.xterm-helper-textarea').focus();
      let byKey = 0;
      for (const key of ['Shift+F10', 'ContextMenu']) {
        await page.keyboard.press(key);
        const shown = await menuShown(page, true, 3000);
        expect(`${key} opens the menu`, shown !== null);
        if (shown !== null) byKey += 1;
        await page.keyboard.press('Escape');
        await menuShown(page, false);
      }

      /** An item is chosen with the pointer: the menu opens by the right click at `at`, the item is pressed and the menu is gone. Answers whether the menu opened and the item was there to press. Once the menu has not opened, the next choices wait only a moment for it. */
      let missed = false;
      const choose = async (label) => {
        await openByPointer(page, at);
        const shown = await menuShown(page, true, missed ? 300 : 3000);
        if (shown === null) {
          missed = true;
          return false;
        }

        const done = await page.locator(`[role="menu"] [role="menuitem"][aria-label="${label}"]`).click({ timeout: 3000 }).then(() => true, () => false);
        await menuShown(page, false, 3000);
        return done;
      };

      // 4. Select all selects the buffer: Copy is available then, and puts the buffer's text on the clipboard.
      expect('Select all is chosen from the menu', await choose('Select all'));
      await openByPointer(page, at);
      const selected = await menuShown(page, true, 3000);
      expect('Copy is available once the buffer is selected', selected?.items?.find((item) => item.label === 'Copy')?.disabled === false, selected?.items);
      const copyChosen = selected !== null && (await page.locator('[role="menu"] [role="menuitem"][aria-label="Copy"]').click({ timeout: 3000 }).then(() => true, () => false));
      expect('Copy is chosen from the menu', copyChosen);
      await menuShown(page, false, 3000);
      if (copyChosen) await waitFor(page, () => window.__clip.writes.length > 0, null, 3000);
      const copied = await page.evaluate(() => window.__clip.writes);
      expect('Copy puts one text on the clipboard', copied.length === 1, copied.length);
      expect('that text is the buffer: every known line, in order', known.every((line, index) => copied[0]?.includes(line) && (index === 0 || copied[0].indexOf(line) > copied[0].indexOf(known[index - 1]))), copied[0]?.slice(0, 120));
      // 5. Paste sends what the clipboard holds to the shell, once.
      const wrote = await page.evaluate(() => window.__pty.log.writes.length);
      const pasteChosen = await choose('Paste');
      expect('Paste is chosen from the menu', pasteChosen);
      if (pasteChosen) await waitFor(page, (count) => window.__pty.log.writes.length > count, wrote, 3000);
      const pasted = await page.evaluate((count) => window.__pty.log.writes.slice(count).filter((text) => text.includes('pasted from the clipboard')).length, wrote);
      expect('Paste sends the clipboard to the shell once', pasted === 1, pasted);
      // 6. Clear empties the screen of what was there.
      expect('Clear is chosen from the menu', await choose('Clear'));
      await frames(page);
      const rows = await page.evaluate(() => window.__find.rows());
      expect('Clear leaves none of the known lines', !rows.some((row) => known.some((line) => row.includes(line))), rows.slice(0, 3));
      // 7. Find opens the bar, with the keyboard in it.
      expect('Find is chosen from the menu', await choose('Find'));
      const bar = await waitFor(page, () => window.__find.focused(), null, 3000);
      expect('Find opens the bar with the keyboard in its field', bar);
      check(
        'menu.open',
        problems.length === 0 && byKey === 2,
        `${tag}: ${String(problems.length)} of the readings of the menu are wrong: ${JSON.stringify(problems.slice(0, 4))}; the keyboard opened it ${String(byKey)} times of 2`,
      );
      note(`menu open ${tag}: the items ${JSON.stringify(again?.items?.map((item) => item.label))}, opened by the pointer and by ${String(byKey)} keys, ${String(problems.length)} readings wrong`);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ menu.mouse
  sections['menu-mouse'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await start(page);
      const at = await screenPoint(page);
      /** The reports of the right button in what the page wrote to the shell since `from`: a press and a release, in the SGR encoding. */
      const reports = async (from) => page.evaluate((count) => ({ down: window.__pty.log.writes.slice(count).join('').match(/\u001b\[<2;\d+;\d+M/g)?.length ?? 0, up: window.__pty.log.writes.slice(count).join('').match(/\u001b\[<2;\d+;\d+m/g)?.length ?? 0 }), from);
      const mark = async () => page.evaluate(() => window.__pty.log.writes.length);
      // The program asks for the mouse: a right click is its own, and no menu opens.
      await ran(page, 'mouse-on');
      const from = await mark();
      await openByPointer(page, at);
      await waitFor(page, (count) => window.__pty.log.writes.slice(count).join('').includes('\u001b[<2;'), from, 8000);
      await frames(page, 10);
      const given = await reports(from);
      const menuWhile = await menuNow(page);
      // With Shift the menu is the person's.
      await openByPointer(page, at, ['Shift']);
      const withShift = await menuShown(page, true, 4000);
      await page.keyboard.press('Escape');
      await menuShown(page, false);
      // The mouse given back: the menu opens, and the program is told nothing.
      await page.locator('.xterm-helper-textarea').focus();
      await ran(page, 'mouse-off');
      const after = await mark();
      await openByPointer(page, at);
      const off = await menuShown(page, true, 4000);
      await frames(page, 4);
      const told = await reports(after);
      await page.keyboard.press('Escape');
      check(
        'menu.mouse',
        given.down === 1 && given.up === 1 && menuWhile === null && withShift !== null && off !== null && told.down === 0 && told.up === 0,
        `${tag}: with the program holding the mouse a right click reached it as ${String(given.down)} press and ${String(given.up)} release of button 2 (one of each is right) and ${menuWhile === null ? 'no menu opened (right)' : 'a menu OPENED'}; with Shift the menu ${withShift === null ? 'did NOT open' : 'opened'}; with the mouse given back the menu ${off === null ? 'did NOT open' : 'opened'} and the program was told ${String(told.down)} presses and ${String(told.up)} releases (none is right)`,
      );
      note(`menu mouse ${tag}: with the mouse held a right click was ${String(given.down)} press, ${String(given.up)} release and ${menuWhile === null ? 'no menu' : 'a menu'}; with Shift ${withShift === null ? 'no menu' : 'the menu'}; with the mouse given back ${off === null ? 'no menu' : 'the menu'}`);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ axe.menu
  sections['menu-axe'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await start(page);
      await ran(page, 'known');
      const at = await screenPoint(page);
      await openByPointer(page, at);
      const shown = await menuShown(page);
      await page.addScriptTag({ path: AXE });
      await page.evaluate(() => document.querySelector('[role="menu"]')?.setAttribute('data-probe-axe', 'menu'));
      await perturb(ctx, page, 'axe');
      const found = shown === null ? ['the menu never opened'] : await runAxe(page, '[data-probe-axe="menu"]');
      check('axe.menu', shown !== null && found.length === 0, `${tag}: the open context menu (${shown === null ? 'NOT open' : `${String(shown.items.length)} items`}): ${JSON.stringify(found)}`);
    } finally {
      await page.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ the links
  const URL_TEXT = 'https://example.com/docs/alpha';
  const modifierOf = (mac) => (mac ? 'Meta' : 'Control');
  const wantWords = (mac) => `Follow link (${mac ? 'cmd' : 'ctrl'} + click)`;
  const hoverAt = async (page, text) => {
    const point = await page.evaluate((word) => window.__find.pointOf(word), text);
    if (point === null) return null;
    await page.mouse.move(point.x - 20, point.y);
    await page.mouse.move(point.x, point.y, { steps: 4 });
    return point;
  };

  const tooltipWords = async (page) => page.evaluate(() => window.__find.tooltips().map((element) => (element.textContent ?? '').trim()));

  sections['links-tooltip'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await start(page);
      await ran(page, 'urls');
      const mac = await isMac(page);
      const idle = (await tooltipWords(page)).length;
      const point = await hoverAt(page, URL_TEXT);
      const hovered = await waitFor(page, () => window.__find.tooltips().length > 0, null, 8000);
      const words = await tooltipWords(page);
      await page.mouse.move(10, 10, { steps: 4 });
      const gone = await waitFor(page, () => window.__find.tooltips().length === 0, null, 8000);
      const after = (await tooltipWords(page)).length;
      check(
        'links.tooltip',
        idle === 0 && point !== null && hovered && words.length === 1 && words[0] === wantWords(mac) && gone && after === 0,
        `${tag}: with the pointer nowhere the page holds ${String(idle)} tooltip nodes (none is right); on the link${point === null ? ' (the link was NOT found on the screen)' : ''} it holds ${String(words.length)}: ${JSON.stringify(words)} (one, ${JSON.stringify(wantWords(mac))}); with the pointer off the link ${String(after)} nodes (none is right)`,
      );
      note(`links tooltip ${tag}: ${String(idle)} nodes idle, ${JSON.stringify(words)} on the link, ${String(after)} nodes after it`);
    } finally {
      await page.context().close();
    }
  };

  sections['links-activate'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const calls = async (page) => page.evaluate(() => [...window.__opened]);
    /** A click at a point of the output, with the keys that are held: the pointer is on it first, so that the emulator knows the link under it. */
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

    let page;
    let without;
    try {
      page = await openPage(ctx);
      without = await openPage(ctx, { query: 'openExternal=off' });
      await start(page);
      await ran(page, 'urls');
      const mac = await isMac(page);
      const modifier = modifierOf(mac);
      const link = await hoverAt(page, URL_TEXT);
      await waitFor(page, () => window.__find.tooltips().length > 0, null, 8000);
      await click(page, link);
      const plain = (await calls(page)).length;
      await click(page, link, modifier);
      await waitFor(page, () => window.__opened.length > 0, null, 5000);
      await frames(page, 6);
      const once = await calls(page);
      // A script, another scheme and a name are not links: the modifier follows nothing.
      let others = 0;
      for (const text of ['javascript:alert(1)', 'ftp://example.com/file', 'example.com in a line']) {
        const point = await page.evaluate((word) => window.__find.pointOf(word), text);
        if (point === null) {
          others = -1000;
          break;
        }

        await click(page, point, modifier);
        others = (await calls(page)).length - once.length;
        if (others !== 0) break;
      }

      // A window that gave no way to open an address has no link: nothing is said on it, and nothing follows it.
      await start(without);
      await ran(without, 'urls');
      const none = await hoverAt(without, URL_TEXT);
      await frames(without, 30);
      const dead = (await tooltipWords(without)).length;
      if (none !== null) await click(without, none, modifier);
      const deadCalls = (await calls(without)).length;
      check(
        'links.activate',
        link !== null && plain === 0 && once.length === 1 && once[0] === URL_TEXT && others === 0 && none !== null && dead === 0 && deadCalls === 0,
        `${tag}: a plain click on the link opened ${String(plain)} addresses (none is right); ${modifier} and a click opened ${JSON.stringify(once)} (the one address, once); the same click on a script, another scheme and a name opened ${String(others)} more (none); in a window that gave no way to open an address the link${none === null ? ' (not found on the screen)' : ''} was hovered and said ${String(dead)} tooltip nodes (none) and the click opened ${String(deadCalls)} (none)`,
      );
      note(`links activate ${tag}: plain click ${String(plain)} calls, ${modifier} click ${JSON.stringify(once)}, script, scheme and name ${String(others)} more, a window with no way ${String(dead)} tooltips and ${String(deadCalls)} calls`);
    } finally {
      await page?.context().close();
      await without?.context().close();
    }
  };

  // ------------------------------------------------------------------------------------------------ axe.tooltip
  sections['links-axe'] = async (ctx) => {
    const { engine, vp } = ctx;
    const tag = `${engine} ${vp}`;
    const page = await openPage(ctx);
    try {
      await start(page);
      await ran(page, 'urls');
      await hoverAt(page, URL_TEXT);
      const shown = await waitFor(page, () => window.__find.tooltips().length > 0, null, 8000);
      await page.addScriptTag({ path: AXE });
      await page.evaluate(() => window.__find.tooltips()[0]?.setAttribute('data-probe-axe', 'tooltip'));
      await perturb(ctx, page, 'axe');
      const found = shown ? await runAxe(page, '[data-probe-axe="tooltip"]') : ['the tooltip never came'];
      check('axe.tooltip', shown && found.length === 0, `${tag}: the tooltip of a link (${shown ? 'shown' : 'NOT shown'}): ${JSON.stringify(found)}`);
    } finally {
      await page.context().close();
    }
  };

  return sections;
}

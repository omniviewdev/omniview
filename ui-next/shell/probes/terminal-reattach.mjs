// The reattach sections of the Terminal probe (docs/ui-next/terminal-channel-protocol.md): a terminal survives a reload of the page, in a real xterm, in both engines at both viewports. The far end is the probe's own channel host
// (terminal-host.mjs), held in this process for a whole browser context: it outlives the fixture page, and a second page of the same context shares it. The fixture page (`?host=shared`) forwards the host's calls to it, opens one stream
// for each terminal through it, keeps its capabilities in the tab's own sessionStorage (never in the host's window state: the probe fails if a `SaveState` call carries one) and its saved session in the host's window state (the real `loadSession` over a fake window service), and counts the numbered lines of a flood that its emulator is given.
// The host models what the real one does: a capability answered once by `CreateTerminal` that is the only way to a terminal, one stream for each terminal that is its holder, a second stream with the capability that takes the terminal
// (the first is sent `taken-over` and is refused from then on), a lease that runs when no stream holds the terminal and closes it silently when it ends, the kept end of a shell that ended while nobody held it, and a ring that a stream
// is replayed from exactly where it asks. A page that goes away sends the `detach` frame as a keepalive request (the binding is dropped with the page in Chromium).
// This file knows nothing of the probe's own internals: terminal-probe.mjs hands it `check`, `note`, `report` and `runAxe`, and adds its sections, its parts and its negative controls to its own. The sections of T2d (the saved open flag
// of the panel, taking a terminal back with the guard of its button and what a tab that was offline learns, the reattach from the offset the page has, the reattach past the host's ring, the keys typed while a late replay is written, the acknowledgement in
// flight, a terminal that is not there any more) are in terminal-reattach-followups.mjs and are added to these here, with their parts and controls.
//
// Each section has ONE assertion, so that a control trips only that one:
//   reattach-slot       the capability is made once, kept in the tab's sessionStorage (`omniview.terminal-capabilities`), never in the window state, the address, a request or the console; after a reload the page lists by it and makes no new terminal (reattach.slot)
//   reattach-restore    a reload brings back the same tabs, titles, order and tab on screen, running again, and the input works (reattach.restore)
//   reattach-exact      a reload during a numbered flood whose ring has moved joins with no gap and no duplicate in the emulator's lines, and the page acknowledges every byte of the stream it reattached with, the replay included (reattach.exact)
//   reattach-muted      a replay that holds a query (the cursor position, the device attributes) is answered by nobody, and a live query after it is (reattach.muted)
//   reattach-modes      the alternate screen, the mouse, bracketed paste, the application cursor, focus events and a hidden cursor come back from the replay's modes, which the ring kept after the bytes that set them were gone (reattach.modes)
//   reattach-size       the size the shell reports after a reload is the screen's cells, and a full-screen program draws itself again (reattach.size)
//   reattach-detached   a page that lost its terminal to another tab says so, takes no input, and sends neither a detach nor a close when it goes; the tab that took it is not told it lost it (reattach.detached)
//   reattach-lease      a terminal whose stream ended is kept for its lease and found running, with what its shell wrote meanwhile, by a page that comes back within it; one whose lease ran out was closed with nobody told, and the saved tab says so (reattach.lease)
//   reattach-restart    a saved tab whose terminal the host no longer lists stays, ended, with the words for it, and no stream is opened for it (reattach.restart)
//   reattach-tombstone  a shell that ended while no page held it comes back to its saved tab as ended with its output, and no tab comes back for a kept end that no tab holds nor for one the person closed (reattach.tombstone)
//   reattach-leave      a page that is going away sends the detach frame once for each terminal it holds, and closes none (reattach.leave)
//   reattach-axe        axe-core finds no violation in a terminal whose tab is reattaching while the host holds the `ready` of its attach (its lane), nor in the same terminal once another tab took it (reattach.axe)
import { AXE } from './harness.mjs';
import { createHost } from './terminal-host.mjs';
import { serveContext } from './terminal-serve.mjs';
import { createFollowupSections, FOLLOWUP_CONTROLS, FOLLOWUP_PARTS } from './terminal-reattach-followups.mjs';

/** The words the screen writes in the lane for each way a terminal is lost or not found (state.ts, execFeed.ts, tool.ts), and for a saved tab whose terminal is gone. */
export const WORDS = Object.freeze({
  takenOver: 'Taken over by another tab',
  taken: 'Input is off',
  free: 'The tab that took this terminal has closed.',
  takeBack: 'Take it back',
  reattaching: 'Reattaching',
  gone: 'The earlier output is gone',
  notThere: 'The terminal is not there any more',
  connectionLost: 'The connection to the terminal was lost.',
});

export const REATTACH_PARTS = {
  'reattach-a': ['reattach-slot', 'reattach-restore', 'reattach-exact'],
  'reattach-b': ['reattach-muted', 'reattach-modes', 'reattach-size'],
  'reattach-c': ['reattach-detached', 'reattach-lease', 'reattach-restart', 'reattach-tombstone', 'reattach-leave', 'reattach-axe'],
  // T2d (terminal-reattach-followups.mjs): the saved open flag, taking a terminal back, the reattach from an offset, the reattach past the ring, a terminal that is not there any more.
  ...FOLLOWUP_PARTS,
};

/**
 * The negative controls of the reattach assertions, each a single fault, in the shape of the probe's own table. `query` is a control of the fixture page (`?control=`); `host` is one of the far end: its `faults` (named in
 * terminal-host.mjs) and its `options`. Each runs in Chromium: what it proves does not depend on the engine.
 */
export const REATTACH_CONTROLS = {
  // The page puts its capability in the address, and (the other) never keeps the capabilities in its tab's sessionStorage, so that a reload finds no terminal.
  'cap-in-url': { assertion: 'reattach.slot', section: 'reattach-slot', engines: ['chromium'], query: 'control=cap-in-url' },
  // The capabilities are also saved in the window's state (`SaveState`), where the host's other windows and its disk would keep them.
  'cap-in-state': { assertion: 'reattach.slot', section: 'reattach-slot', engines: ['chromium'], query: 'control=cap-in-state' },
  'cap-forgotten': { assertion: 'reattach.slot', section: 'reattach-slot', engines: ['chromium'], query: 'control=cap-forgotten' },
  // The window's state never keeps the session: the tabs are not there after a reload.
  'no-session': { assertion: 'reattach.restore', section: 'reattach-restore', engines: ['chromium'], query: 'control=no-session' },
  // The replay lacks its last bytes (a gap), the page never credits the replay (the host's window then fills and the flood stalls).
  'replay-gap': { assertion: 'reattach.exact', section: 'reattach-exact', engines: ['chromium'], host: { faults: { replayGap: true } } },
  'replay-unacked': { assertion: 'reattach.exact', section: 'reattach-exact', engines: ['chromium'], query: 'control=replay-unacked' },
  // A reply to a query of the replay reaches the shell.
  'unmuted-reply': { assertion: 'reattach.muted', section: 'reattach-muted', engines: ['chromium'], host: { faults: { unmutedReply: true } } },
  // The host's modes are all off, as if its scanner had lost them.
  'modes-lost': { assertion: 'reattach.modes', section: 'reattach-modes', engines: ['chromium'], host: { faults: { modesLost: true } } },
  // The host takes a resize frame and the pty keeps its size.
  'resize-ignored': { assertion: 'reattach.size', section: 'reattach-size', engines: ['chromium'], host: { faults: { resizeIgnored: true } } },
  // The host does not tell the first stream that another one took the terminal.
  'no-taken-over': { assertion: 'reattach.detached', section: 'reattach-detached', engines: ['chromium'], host: { faults: { noTakenOver: true } } },
  // The lease never runs out: a terminal nobody holds is kept for ever.
  'lease-never': { assertion: 'reattach.lease', section: 'reattach-lease', engines: ['chromium'], host: { faults: { leaseNever: true } } },
  // The host goes on listing a terminal it no longer has.
  'list-ghost': { assertion: 'reattach.restart', section: 'reattach-restart', engines: ['chromium'], host: { faults: { listGhost: true } } },
  // The page never sends the detach frame as it goes away.
  'leave-lost': { assertion: 'reattach.leave', section: 'reattach-leave', engines: ['chromium'], query: 'control=leave-lost' },
  // The host lists the kept end of a terminal as one that runs (the page makes a tab for a terminal no tab holds).
  'tombstone-adopted': { assertion: 'reattach.tombstone', section: 'reattach-tombstone', engines: ['chromium'], host: { faults: { tombstoneUnmarked: true } } },
  // axe finds a violation in the lane of a terminal that another tab took: an image with no text alternative, planted once the lane is drawn (the pattern of `axe-failed`).
  'detached-axe': { assertion: 'reattach.axe', section: 'reattach-axe', engines: ['chromium'], stage: 'taken', after: (page) => page.evaluate(() => { const image = document.createElement('img'); image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; document.querySelector('[data-shell-part="terminalLane"]').append(image); }) },
  ...FOLLOWUP_CONTROLS,
};

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settled = async (promise) => promise.then(() => true, () => false);

/** What a control of a section plants in the page at the stage it names (its `stage`; its `after` is what it does), as the probe's own `perturb` does. */
const perturbed = async (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

/** Reads until `done` accepts what was read, or `ms` is over; answers the last reading. */
async function until(read, done, ms = 15_000) {
  const stop = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < stop) {
    await sleep(50);
    value = await read();
  }

  return value;
}

/**
 * Reads until `done` accepts what was read, until nothing it reads has changed for `stall` ms (what is waited for is not coming), or until `limit` ms: a fault that stops the flow is not waited for as long as a slow machine is,
 * and a slow machine, which goes on moving, is waited for.
 */
async function moving(read, done, { stall = 4000, limit = 60_000 } = {}) {
  const started = Date.now();
  let value = await read();
  let seen = JSON.stringify(value);
  let changed = Date.now();
  while (!done(value) && Date.now() - changed < stall && Date.now() - started < limit) {
    await sleep(100);
    value = await read();
    const now = JSON.stringify(value);
    if (now !== seen) {
      seen = now;
      changed = Date.now();
    }
  }

  return value;
}

/**
 * A browser context with the probe's host behind it and the fixture page's address. A page opened in it is a page load that opens streams to the host (terminal-serve.mjs); one that loads another document, or closes, ends its streams.
 * `options.host` are the host's options (the lease, the ring); the control's own are added to them.
 */
async function world(ctx, options = {}) {
  const { browser, origin, viewport, control } = ctx;
  const host = createHost({ ...options.host, ...control?.host?.options, faults: { ...control?.host?.faults } });
  const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
  const served = await serveContext(context, host);
  const query = ['host=shared', 'renderer=dom', options.query, control?.query].filter((part) => part !== undefined && part !== '').join('&');
  const url = `${origin}/shell/probes/terminal-fixture.html?${query}`;
  /**
   * The capabilities are kept in the sessionStorage of a tab, which a duplicated tab copies and a new tab does not have. A page opened while another page of the context is on the fixture is a duplicate of it: it is given a copy
   * of what that page keeps (before its own scripts run). One opened with no such page is a new tab, with nothing.
   */
  const open = async () => {
    const before = context.pages().find((other) => other.url().startsWith(origin));
    const carried = before === undefined ? null : await before.evaluate((key) => window.sessionStorage.getItem(key), CAPABILITY_KEY).catch(() => null);
    const page = await context.newPage();
    // Seeded once, on the first load of the duplicate: a later load of a tab that forgot its capabilities must find none (the marker is a key of the tab's own storage).
    if (carried !== null) await page.addInitScript(([key, text]) => { if (window.sessionStorage.getItem('probe.seeded') === null) { window.sessionStorage.setItem('probe.seeded', '1'); if (window.sessionStorage.getItem(key) === null) window.sessionStorage.setItem(key, text); } }, [CAPABILITY_KEY, carried]);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-shell-part="window"]');
    return page;
  };

  return {
    host,
    url,
    context,
    open,
    close: async () => {
      host.stop();
      await served.close();
      await context.close();
    },
  };
}

/** The panel opens on the Terminal tool, New terminal starts a shell, and the emulator has been given its first output. */
async function start(page) {
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine.writes > 0, null, { timeout: 15_000 });
  await sleep(400);
}

/** The panel of a page that loaded again comes back as it was left (T2d: its open flag, its tool, its session and its height are restored); one that was left closed stays closed, and a person opens it, and so does this. */
async function reveal(page) {
  await page.waitForSelector('[data-shell-part="panelToggle"]');
  const shown = await page.evaluate(() => (document.querySelector('[data-shell-part="panel"]')?.getBoundingClientRect().height ?? 0) > 0);
  if (!shown) await page.click('[data-shell-part="panelToggle"]');
}

/** The page loads again and the terminals it was holding are attached to it (`attaches` of them), or, for a host that lists none, the page has settled; the panel is opened on what it holds. */
async function reload(page, w, { attaches = 1 } = {}) {
  const before = w.host.log.attaches.length;
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-shell-part="window"]');
  if (attaches > 0) await until(() => w.host.log.attaches.length, (count) => count >= before + attaches, 8000);
  await reveal(page);
  // A page that did not bring its terminals back has no screen to wait for: the assertion that follows says what there is.
  await settled(page.waitForSelector(attaches > 0 ? '.xterm-helper-textarea' : '[data-shell-part="panelBody"]', { timeout: 6000 }));
  await sleep(500);
}

const tabsOf = async (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-shell-part="sessionTabs"] [role="tab"]')].map((tab) => ({ id: tab.getAttribute('data-tab-id'), title: (tab.textContent ?? '').trim(), selected: tab.getAttribute('aria-selected') === 'true' })));
const laneOf = async (page) => page.evaluate(() => (document.querySelector('[data-shell-part="terminalLane"]')?.textContent ?? '').trim());
/** What the panel's body says when it holds no screen: the card of a saved tab whose terminal is not there any more. */
const bodyOf = async (page) => page.evaluate(() => (document.querySelector('[data-shell-part="panelBody"]')?.textContent ?? '').trim());
const rowsOf = async (page) => page.evaluate(() => [...document.querySelectorAll('.xterm-rows > div')].map((row) => (row.textContent ?? '').trimEnd()).filter((text) => text !== ''));
const typeLine = async (page, text) => {
  await page.locator('.xterm-helper-textarea').focus({ timeout: 3000 }).catch(() => undefined);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
};

/** What the shell was typed since the `from`-th write the host applied, in order, as one text (the host has no window to say who typed: a stream does). */
const wroteBy = (host, from = 0) =>
  host.log.writes
    .slice(from)
    .map((entry) => entry.data)
    .join('');

/** The capabilities the tab keeps, as the text of its sessionStorage (`undefined`: nothing kept). */
const CAPABILITY_KEY = 'omniview.terminal-capabilities';
const capsOf = async (page) => page.evaluate((key) => window.sessionStorage.getItem(key) ?? undefined, CAPABILITY_KEY);
const slotOf = async (host, slot) => (await host.call('GetState', ['main']))[slot];

export function createReattachSections({ check, note, report, runAxe }) {
  const sections = {};

  /** The page loads again after it was away (about:blank): the terminals it holds a capability for are attached to it (`attaches` of them), the panel is opened on what it holds. */
  const comeBack = async (page, w, { attaches = 1 } = {}) => {
    const before = w.host.log.attaches.length;
    await page.goto(w.url, { waitUntil: 'load' });
    await page.waitForSelector('[data-shell-part="window"]');
    if (attaches > 0) await until(() => w.host.log.attaches.length, (count) => count >= before + attaches, 8000);
    await reveal(page);
    await settled(page.waitForSelector(attaches > 0 ? '.xterm-helper-textarea' : '[data-shell-part="panelBody"]', { timeout: 6000 }));
  };

  /** Waits until the emulator has parsed everything it was given, and was given at least `atLeast` bytes. */
  const drained = async (page, atLeast = 0) =>
    moving(
      async () => page.evaluate(() => ({ accepted: window.__engine.accepted, parsed: window.__engine.parsed })),
      (state) => state.accepted >= atLeast && state.parsed === state.accepted,
      { limit: 30_000 },
    );

  /** Waits until the window's saved session holds every one of `ids` (its saver writes a burst, 400 ms after the last change). */
  const sessionHolds = async (host, ids) =>
    until(
      async () => slotOf(host, 'session'),
      (text) => typeof text === 'string' && ids.every((id) => text.includes(id)),
    );

  const parsedSlot = (text) => {
    try {
      const value = JSON.parse(text ?? 'null');
      return typeof value === 'object' && value !== null ? value : null;
    } catch {
      return null;
    }
  };

  /** The capability: made once, kept in the tab's sessionStorage, in no address, request or console line; a reload lists by it and makes no new terminal. */
  sections['reattach-slot'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const seen = [];
      w.context.on('request', (request) => {
        seen.push(`${request.url()} ${request.postData() ?? ''}`);
      });
      w.context.on('console', (message) => {
        seen.push(message.text());
      });
      const page = await w.open();
      await start(page);
      const created = host.log.created[0];
      const id = created?.id ?? '';
      const cap = created?.cap ?? '';
      const usable = /^[A-Za-z0-9_-]{43}$/.test(cap);
      const kept = await until(async () => capsOf(page), (text) => text !== undefined, 5000);
      const slot = parsedSlot(kept);
      const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
      const leakedBefore = cap !== '' && [page.url(), ...resources, ...seen].some((text) => text.includes(cap));
      const createdBefore = host.log.created.length;
      const listsBefore = host.log.lists.length;
      const attachesBefore = host.log.attaches.length;
      await reload(page, w);
      const createdAfter = host.log.created.length;
      const keptAfter = await capsOf(page);
      const listed = host.log.lists.slice(listsBefore).filter((entry) => entry.asked >= 1 && entry.listed.some((item) => item.id === id)).length;
      const again = host.log.attaches.slice(attachesBefore).find((entry) => entry.id === id);
      await page.click('[data-shell-part="sessionAdd"] button', { timeout: 5000 }).catch(() => undefined);
      await until(() => host.log.created.length, (count) => count >= 2, 5000);
      const second = host.log.created[1];
      const both = parsedSlot(await until(async () => capsOf(page), (text) => Object.keys(parsedSlot(text) ?? {}).length >= 2, 5000));
      const leaked = [cap, second?.cap ?? ''].some((one) => one !== '' && [page.url(), ...seen].some((text) => text.includes(one)));
      // No capability reaches the host's window state: every `SaveState` call of the page is looked at.
      const saved = [cap, second?.cap ?? ''].some((one) => one !== '' && host.log.saved.some((entry) => entry.text.includes(one)));
      check(
        'reattach.slot',
        usable && slot !== null && Object.keys(slot).length === 1 && slot[id] === cap && !leakedBefore && keptAfter === kept && createdBefore === 1 && createdAfter === 1 && listed >= 1 && again?.outcome === 'ready' && second !== undefined && /^[A-Za-z0-9_-]{43}$/.test(second.cap) && second.cap !== cap && both?.[id] === cap && both?.[second.id] === second.cap && !leaked && !saved,
        `${engine} ${vp}: the first create answered ${usable ? 'a capability of 43 characters of base64url' : 'NO usable capability'}; the tab's sessionStorage held ${slot === null ? 'nothing' : `${String(Object.keys(slot).length)} entr${Object.keys(slot).length === 1 ? 'y' : 'ies'}`} and ${slot?.[id] === cap ? 'the' : 'NOT the'} capability for the terminal (one entry is right); it is ${leakedBefore ? '' : 'not '}in the address, a request or the console (not is right); a capability reached the window state (SaveState): ${String(saved)} (false is right); after a reload the storage is ${keptAfter === kept ? 'the same' : 'DIFFERENT'}, ${String(createdAfter - createdBefore)} terminal(s) were made (none is right), the page listed by the capability ${String(listed)} time(s) (1 or more) and the attach after it ${again === undefined ? 'was never made' : `was ${again.outcome}`}; the next create made ${second === undefined ? 'nothing' : second.cap === cap ? 'the SAME capability' : 'another capability'} and the slot then holds both (${String(both?.[id] === cap && both?.[second?.id ?? ''] === second?.cap)}); either of them is ${leaked ? '' : 'not '}in the address or a request after the reload (not is right)`,
      );
      note(`reattach slot ${engine} ${vp}: one capability made once, kept in the tab's sessionStorage and in no address, request or window state, listed by after a reload; a second terminal made a second capability`);
    } finally {
      await w.close();
    }
  };

  /** The saved session: the same tabs in the same order under the same titles, the same one on screen, running again, and typing works. */
  sections['reattach-restore'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      for (let more = 0; more < 2; more += 1) {
        await page.click('[data-shell-part="sessionAdd"] button');
        await until(() => host.log.created.length, (count) => count >= 2 + more);
        await until(() => host.log.attaches.length, (count) => count >= 2 + more);
      }

      const tabs = await tabsOf(page);
      // The second tab is the one on screen when the page goes: a person who picked it.
      await page.locator('[data-shell-part="sessionTabs"] [role="tab"]').nth(1).click();
      await until(async () => (await tabsOf(page)).findIndex((tab) => tab.selected), (index) => index === 1);
      const before = await tabsOf(page);
      // The saver must have written THIS state: every tab, and the second one on screen (an older record with the third active is not it).
      const savedActive = (text) => {
        try {
          return JSON.parse(text)?.panel?.active?.terminal;
        } catch {
          return undefined;
        }
      };
      const saved = await until(
        async () => slotOf(host, 'session'),
        (text) => typeof text === 'string' && before.every((tab) => text.includes(tab.id ?? '?')) && savedActive(text) === before[1]?.id,
        10_000,
      );
      // The saver has written the session as it is now: the order and the tab on screen are in it.
      await until(async () => slotOf(host, 'session'), (text) => typeof text === 'string' && text.length > 0);
      const attachMark = host.log.attaches.length;
      await reload(page, w, { attaches: 3 });
      const arrivals = host.log.attaches.slice(attachMark);
      const after = await tabsOf(page);
      const lane = await laneOf(page);
      const ids = host.ids();
      const live = ids.filter((id) => host.state(id)?.holder !== null).length;
      const mark = host.log.writes.length;
      await typeLine(page, 'hello');
      const echoed = await until(
        async () => (await rowsOf(page)).filter((row) => /hello from the synthetic shell/.test(row)).length,
        (count) => count >= 1,
        8000,
      );
      const typed = /hello/.test(wroteBy(host, mark));
      const same = JSON.stringify(after) === JSON.stringify(before);
      check(
        'reattach.restore',
        tabs.length === 3 && typeof saved === 'string' && same && after.filter((tab) => tab.selected).length === 1 && after.findIndex((tab) => tab.selected) === 1 && lane === '' && live === 3 && arrivals.length === 3 && arrivals.every((entry) => entry.outcome === 'ready' && ids.includes(entry.id ?? '')) && typed && echoed >= 1,
        `${engine} ${vp}: three tabs ${JSON.stringify(before)}; after a reload ${JSON.stringify(after)} (the same ones, in the same order, with the second on screen: ${String(same)}); the lane says ${JSON.stringify(lane)} (nothing is right: running), ${String(arrivals.length)} attaches were made (3 is right), ${String(live)} of 3 terminals are held by a stream, what was typed reached the shell: ${String(typed)}, the screen shows its answer ${String(echoed)} time(s)`,
      );
      note(`reattach restore ${engine} ${vp}: three tabs came back in order with the second on screen, running, and typing works`);
    } finally {
      await w.close();
    }
  };

  /**
   * A reload during a numbered flood whose ring has moved (the host's ring is 2 MiB, the flood 4.9 MB): the new stream attaches with no offset (a fresh screen) and is replayed from the first byte the ring has, then live, with no gap and
   * no duplicate in the emulator's lines; the page acknowledges every byte of the stream it reattached with, the replay too (never a gap), so that the host's window of 1 MiB does not fill under a replay larger than it.
   */
  sections['reattach-exact'] = async (ctx) => {
    const { engine, vp } = ctx;
    const LINES = 60_000;
    const TOTAL = LINES * 82;
    // The flood yields for 15 ms between two batches so that it is still running when the new page takes the terminal: what it writes meanwhile is the live part, which is reported and not asserted.
    const w = await world(ctx, { host: { ringBytes: 2 * 1024 * 1024, defer: (task) => setTimeout(task, 15) } });
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const id = host.ids()[0];
      await typeLine(page, `flood ${String(LINES)} 80`);
      await until(() => host.state(id)?.end ?? 0, (end) => end >= 2_500_000, 60_000);
      const first = host.log.attaches[0];
      await reload(page, w);
      await moving(() => ({ end: host.state(id)?.end ?? 0, waiting: host.state(id)?.waiting ?? 1, paused: host.state(id)?.paused ?? true }), (state) => state.end >= TOTAL && state.waiting === 0 && !state.paused, { limit: 90_000 });
      await moving(
        async () => page.evaluate(() => ({ accepted: window.__engine.accepted, parsed: window.__engine.parsed, last: window.__engine.lines.last })),
        (state) => state.parsed === state.accepted && state.last === LINES - 1,
        { limit: 30_000 },
      );
      const attach = host.log.attaches.at(-1);
      const end = host.state(id).end;
      const acked = await until(() => host.log.acks.filter((entry) => entry.stream === attach.stream).reduce((sum, entry) => sum + entry.bytes, 0), (sum) => sum === end - attach.start, 5000);
      const lines = await page.evaluate(() => window.__engine.lines);
      check(
        'reattach.exact',
        attach.outcome === 'ready' && attach.stream !== first.stream && attach.start > 0 && attach.lost === 0 && lines.last === LINES - 1 && lines.gaps.length === 0 && lines.dups.length === 0 && lines.count > 5000 && acked === end - attach.start,
        `${engine} ${vp}: the ring had moved (the replay started at ${String(attach.start)} of ${String(attach.end)}, ${String(attach.lost)} lost); the emulator was given ${String(lines.count)} numbered lines ending at ${String(lines.last)} (${String(LINES - 1)} is the last) with ${JSON.stringify(lines.gaps.slice(0, 3))} gaps and ${JSON.stringify(lines.dups.slice(0, 3))} duplicates (none of either); the new stream's output was ${String(end - attach.start)} B (the replay ${String(attach.end - attach.start)} B) and the page acknowledged ${String(acked)} B (equal is right: the replay too, never more)`,
      );
      note(`reattach exact ${engine} ${vp}: the page reloaded at ${String(attach.end)} B of ${String(TOTAL)}, the replay was ${String(attach.end - attach.start)} B from offset ${String(attach.start)}, ${String(end - attach.end)} B were live, ${String(lines.count)} lines in order to ${String(lines.last)}, ${String(acked)} B acknowledged`);
      report.numbers[`reattach exact ${engine} ${vp}`] = { attach, acked, end, lines: { count: lines.count, last: lines.last, gaps: lines.gaps.length, dups: lines.dups.length } };
    } finally {
      await w.close();
    }
  };

  /** A query in the replay is answered by nobody; a live one is answered. */
  sections['reattach-muted'] = async (ctx) => {
    const { engine, vp } = ctx;
    const REPLY = /\u001b\[\d+;\d+R|\u001b\[\?[\d;]*c/;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      await typeLine(page, 'query');
      // The program asks twice (where the cursor is, and what the terminal is) and the emulator answers both: the mark is taken once BOTH answers have reached the shell, so that a late answer of the first page is not counted as the new page's.
      const asked = await until(() => /\u001b\[\d+;\d+R/.test(wroteBy(host)) && /\u001b\[\?[\d;]*c/.test(wroteBy(host)), (answered) => answered, 8000);
      const mark = host.log.writes.length;
      await reload(page, w);
      await until(async () => rowsOf(page), (rows) => rows.some((row) => /asking:/.test(row)), 8000);
      // The keys typed now travel on the stream after anything the replay made the emulator say, and the host applies a stream's frames in order: once the shell has answered, nothing from the replay is still on its way.
      await typeLine(page, 'hello');
      await until(async () => (await rowsOf(page)).some((row) => /hello from the synthetic shell/.test(row)), (shown) => shown, 8000);
      const replayed = wroteBy(host, mark);
      await typeLine(page, 'query');
      const live = await until(() => REPLY.test(wroteBy(host, mark)), (answered) => answered, 8000);
      check(
        'reattach.muted',
        asked && !REPLY.test(replayed) && live,
        `${engine} ${vp}: the first page answered the query of its shell: ${String(asked)}; after the reload the replay held that query and the shell was sent ${JSON.stringify(replayed.slice(0, 80))} by the new page (nothing that answers a query is right); a live query after it was answered: ${String(live)}`,
      );
      note(`reattach muted ${engine} ${vp}: the query in the replay was answered by nobody, the live one after it was`);
    } finally {
      await w.close();
    }
  };

  /** The modes of the replay: read from the emulator by what it does with a paste, a key, the mouse, the focus, its cursor and its alternate screen. */
  sections['reattach-modes'] = async (ctx) => {
    const { engine, vp } = ctx;
    // A ring of 1.5 MiB: the flood of 2 MB moves it past the bytes that set the modes, which only `start_modes` keeps.
    const w = await world(ctx, { host: { ringBytes: 1_572_864 } });
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const id = host.ids()[0];
      await typeLine(page, 'fullscreen');
      await until(() => host.state(id)?.program, (program) => program === 'fullscreen');
      host.flood(id, 25_000, 80);
      await moving(() => ({ end: host.state(id)?.end ?? 0, waiting: host.state(id)?.waiting ?? 1 }), (state) => state.end >= 2_000_000 && state.waiting === 0, { limit: 60_000 });
      const before = host.state(id);
      await reload(page, w);
      const attach = host.log.attaches.at(-1);
      await drained(page, attach.bytes);
      const mark = host.log.writes.length;
      await page.locator('.xterm-helper-textarea').focus({ timeout: 3000 }).catch(() => undefined);
      await page.evaluate(() => {
        const input = document.querySelector('.xterm-helper-textarea');
        const data = new DataTransfer();
        data.setData('text/plain', 'pasted');
        input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      });
      await page.keyboard.press('ArrowUp');
      const box = await page.locator('.xterm-screen').boundingBox();
      await page.mouse.click(box.x + 60, box.y + 40);
      await page.evaluate(() => {
        const input = document.querySelector('.xterm-helper-textarea');
        input.blur();
        input.focus();
      });
      await until(() => wroteBy(host, mark), (text) => text.includes('\u001b[O') && text.lastIndexOf('\u001b[I') > text.indexOf('\u001b[O'), 4000);
      const wrote = wroteBy(host, mark);
      const cursors = await page.evaluate(() => document.querySelectorAll('.xterm-rows .xterm-cursor').length);
      const modes = {
        paste: wrote.includes('\u001b[200~pasted\u001b[201~'),
        applicationCursor: wrote.includes('\u001bOA') && !wrote.includes('\u001b[A'),
        mouse: /\u001b\[<0;\d+;\d+M/.test(wrote),
        focus: wrote.includes('\u001b[O') && wrote.includes('\u001b[I'),
        cursorHidden: cursors === 0,
      };
      // The program leaves: with the alternate screen restored the emulator returns to the normal one, which holds no flood; without it the lines of the flood are still on the screen.
      await page.keyboard.press('q');
      await until(async () => rowsOf(page), (rows) => rows.some((row) => /user@synthetic/.test(row)), 8000);
      const rows = await rowsOf(page);
      const alternate = !rows.some((row) => /^\d{7} x/.test(row)) && rows.some((row) => /user@synthetic/.test(row));
      const missing = Object.entries({ ...modes, alternateScreen: alternate }).filter(([, kept]) => !kept).map(([name]) => name);
      check(
        'reattach.modes',
        before.modes.alt_screen && before.modes.mouse_tracking === 1 && attach.start > 1000 && missing.length === 0,
        `${engine} ${vp}: the program set its modes (${JSON.stringify(before.modes)}) and the ring moved past them (the replay started at ${String(attach.start)}); after the reload the emulator is missing: ${JSON.stringify(missing)} (nothing is right); it was sent ${JSON.stringify(wrote.slice(0, 120))}, ${String(cursors)} cursor(s) are drawn (none is right: hidden), and after the program left the screen shows ${JSON.stringify(rows.slice(0, 3))}`,
      );
      note(`reattach modes ${engine} ${vp}: alternate screen, bracketed paste, application cursor, the mouse, focus events and a hidden cursor were all restored from the replay's modes (the replay started at ${String(attach.start)} B, past the bytes that set them)`);
    } finally {
      await w.close();
    }
  };

  /** The size after a reload is the screen's cells, and a full-screen program draws itself again. */
  sections['reattach-size'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const id = host.ids()[0];
      // Another client resized the pty while the page was away: the size the replay ends at is not the screen's, and the shell must be told the cells the screen has.
      const before = await page.evaluate(() => window.__engine.grid());
      host.setSize(id, before.rows + 3, before.cols + 7);
      await reload(page, w);
      const grid = await page.evaluate(() => window.__engine.grid());
      await until(() => host.state(id), (state) => state?.rows === grid.rows && state?.cols === grid.cols, 6000);
      await typeLine(page, 'size');
      const reported = await until(async () => (await rowsOf(page)).filter((row) => /^\d+ \d+$/.test(row)).at(-1) ?? null, (row) => row !== null, 8000);
      const fitted = reported === `${String(grid.rows)} ${String(grid.cols)}`;
      // A full-screen program: after the next reload it must draw again (the size is sent one cell off and then as it is, so that the pty signals a change twice).
      await typeLine(page, 'fullscreen');
      await until(() => host.state(id)?.program, (program) => program === 'fullscreen');
      const frame = host.state(id).frame;
      const mark = host.log.resizes.length;
      await reload(page, w);
      const gridAfter = await page.evaluate(() => window.__engine.grid());
      await until(() => ({ state: host.state(id), sent: host.log.resizes.length - mark }), (now) => now.sent >= 2 && now.state?.rows === gridAfter.rows && now.state?.cols === gridAfter.cols && (now.state?.frame ?? 0) >= frame + 1, 6000);
      // The screen must show the frame the host drew last, and not the one the replay brought: an older frame does not satisfy it.
      const drawn = host.state(id).frame;
      await until(async () => rowsOf(page), (rows) => rows.some((row) => row.includes(`FULLSCREEN frame ${String(drawn)} `)), 6000);
      const after = host.state(id);
      const resizes = host.log.resizes.slice(mark);
      const redrew = after.frame >= frame + 1 && resizes.length >= 2;
      const rowsNow = await rowsOf(page);
      check(
        'reattach.size',
        fitted && redrew && after.rows === gridAfter.rows && after.cols === gridAfter.cols && rowsNow.some((row) => row.includes(`FULLSCREEN frame ${String(drawn)} `)),
        `${engine} ${vp}: after a reload in a window of another size the shell reported ${JSON.stringify(reported)} and the screen has ${String(grid.rows)} rows and ${String(grid.cols)} columns; the full-screen program drew frame ${String(frame)} before the next reload and ${String(after.frame)} after it, with ${JSON.stringify(resizes.map((entry) => `${String(entry.rows)}x${String(entry.cols)}`))} sent in between; the pty is ${String(after.rows)}x${String(after.cols)} and the screen ${String(gridAfter.rows)}x${String(gridAfter.cols)}; the screen shows the program: ${String(rowsNow.some((row) => /FULLSCREEN frame/.test(row)))}`,
      );
      note(`reattach size ${engine} ${vp}: the shell reported ${String(reported)} for a screen of ${String(grid.rows)}x${String(grid.cols)}; the full-screen program went from frame ${String(frame)} to ${String(after.frame)} with ${String(resizes.length)} sizes sent`);
    } finally {
      await w.close();
    }
  };

  /** A second tab takes the terminal: the first says so, takes no input, and sends no detach or close when it goes; the tab that took it is not told it lost it. */
  sections['reattach-detached'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const a = await w.open();
      await start(a);
      const id = host.ids()[0];
      const first = host.log.attaches[0]?.stream;
      await sessionHolds(host, [id]);
      // The same window state and the same capability: a duplicated tab. Its restore finds the terminal and takes it.
      const b = await w.open();
      await reveal(b);
      const holder = await until(() => host.state(id)?.holder, (now) => now !== null && now !== first);
      await settled(b.waitForSelector('.xterm-helper-textarea', { timeout: 8000 }));
      const lane = await until(async () => laneOf(a), (text) => text.includes(WORDS.takenOver), 4000);
      const taken = host.log.taken.filter((entry) => entry.id === id);
      const frameMark = host.log.frames.length;
      await a.locator('.xterm-helper-textarea').focus({ timeout: 3000 }).catch(() => undefined);
      await a.keyboard.type('zzz');
      await sleep(400);
      const sentByA = host.log.frames.slice(frameMark).filter((entry) => entry.stream === first);
      const typedInA = host.log.writes.filter((entry) => entry.stream === first && /zzz/.test(entry.data));
      await a.goto('about:blank');
      await sleep(600);
      const leftByA = host.log.frames.slice(frameMark).filter((entry) => entry.stream === first && (entry.kind === 'detach' || entry.kind === 'close'));
      const detachedByA = host.log.detaches.filter((entry) => entry.stream === first);
      const laneB = await laneOf(b);
      await typeLine(b, 'hello');
      const echoed = await until(async () => (await rowsOf(b)).some((row) => /hello from the synthetic shell/.test(row)), (shown) => shown, 4000);
      check(
        'reattach.detached',
        lane.includes(WORDS.takenOver) && taken.length === 1 && taken[0].from === first && taken[0].by === holder && sentByA.length === 0 && typedInA.length === 0 && leftByA.length === 0 && detachedByA.length === 0 && host.state(id)?.holder === holder && laneB === '' && echoed,
        `${engine} ${vp}: the first tab's lane says ${JSON.stringify(lane)} (${JSON.stringify(WORDS.takenOver)} is right); the host recorded ${JSON.stringify(taken.map((entry) => `${String(entry.from)} by ${String(entry.by)}`))} (one, from the first stream to the holder ${String(holder)}); what it typed afterwards sent ${JSON.stringify(sentByA.map((entry) => entry.kind))} and reached the shell ${String(typedInA.length)} time(s) (nothing is right); when it went it sent ${JSON.stringify(leftByA.map((entry) => entry.kind))} and ${String(detachedByA.length)} detach(es) were applied (nothing is right); the other tab holds the terminal (${String(host.state(id)?.holder)}), its lane says ${JSON.stringify(laneB)} (nothing is right), and it still takes input: ${String(echoed)}`,
      );
      note(`reattach detached ${engine} ${vp}: the first tab was told taken-over, took no input and sent nothing when it went; the tab that took the terminal says nothing of it and works`);
    } finally {
      await w.close();
    }
  };

  /**
   * The lease. A terminal whose stream ended (the page went away) is kept for its lease: a page that comes back within it finds it running, with what its shell wrote meanwhile. One whose lease ran out was closed with nobody told (the host
   * kept nothing, and no close or dismiss was asked of it): the saved tab comes back with the card of a terminal that is not there any more, no stream is opened for it, and the page forgot its capability, which opens nothing.
   */
  sections['reattach-lease'] = async (ctx) => {
    const { engine, vp } = ctx;
    let within;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const id = host.ids()[0];
      await sessionHolds(host, [id]);
      await page.goto('about:blank');
      await until(() => host.state(id)?.holder, (holder) => holder === null);
      const away = host.state(id);
      // The lease is judged while nobody holds the terminal, and the attach that follows proves the page came back in time (not the clock after the replay was drawn).
      const leaseOpen = away !== undefined && away.leaseExpires > Date.now() && away.holder === null;
      host.append(id, 'kept words\r\n');
      await comeBack(page, w);
      const rows = await until(async () => rowsOf(page), (shown) => shown.some((row) => /kept words/.test(row)), 8000);
      const attach = host.log.attaches.at(-1);
      within = { running: leaseOpen && attach.outcome === 'ready', lane: await laneOf(page), words: rows.some((row) => /kept words/.test(row)), attach, held: host.state(id)?.holder === attach.stream, closed: host.log.closed.length };
    } finally {
      await w.close();
    }

    const late = await world(ctx, { host: { leaseMs: 1500 } });
    let over;
    try {
      const { host } = late;
      const page = await late.open();
      await start(page);
      const id = host.ids()[0];
      const tab = (await tabsOf(page))[0];
      await sessionHolds(host, [id]);
      await page.goto('about:blank');
      // The lease runs from the end of the stream; when it ends the terminal is closed with nobody told, so that the host has nothing under its capability.
      const gone = await until(() => host.state(id) === undefined, (is) => is, 8000);
      const silent = host.log.closed.length === 0 && host.log.dismissed.length === 0 && host.keptEnds().length === 0;
      const streams = host.log.streams.length;
      const attaches = host.log.attaches.length;
      await comeBack(page, late, { attaches: 0 });
      const card = await until(async () => bodyOf(page), (text) => text.includes(WORDS.gone), 5000);
      const slot = await until(async () => parsedSlot(await capsOf(page)), (value) => value !== null && value[id] === undefined, 5000);
      const tabs = await tabsOf(page);
      over = { gone, silent, card, forgot: slot !== null && slot[id] === undefined, tabs, tab, streams: host.log.streams.length - streams, attaches: host.log.attaches.length - attaches };
    } finally {
      await late.close();
    }

    check(
      'reattach.lease',
      within.running && within.lane === '' && within.words && within.attach.outcome === 'ready' && within.attach.from_offset === null && within.held && within.closed === 0 && over.gone && over.silent && over.card.includes(WORDS.gone) && over.forgot && over.tabs.length === 1 && over.tabs[0].id === over.tab.id && over.streams === 0 && over.attaches === 0,
      `${engine} ${vp}: while the page was away the terminal was held by nobody with its lease running (${String(within.running)}); the page that came back within the lease found it ${within.attach.outcome}, with its lane ${JSON.stringify(within.lane)} (nothing is right) and what the shell wrote meanwhile on the screen: ${String(within.words)}; after a lease of 1.5 s the host had closed it: ${String(over.gone)}, with nothing asked of it and nothing kept: ${String(over.silent)}; the saved tab ${JSON.stringify(over.tab)} came back as ${JSON.stringify(over.tabs)} with the card ${JSON.stringify(over.card.slice(0, 90))} (${JSON.stringify(WORDS.gone)} is right), the page forgot the capability: ${String(over.forgot)}, and opened ${String(over.streams)} stream(s) and made ${String(over.attaches)} attach(es) for it (none is right)`,
    );
    note(`reattach lease ${engine} ${vp}: a page that came back within the lease found its terminal running with the output written meanwhile; after a lease of 1.5 s the terminal was closed with nobody told, and its saved tab says ${JSON.stringify(over.card.slice(0, 60))}`);
  };

  /** The host no longer has the terminal: the saved tab stays, ended, with the words for it, and no stream is opened. */
  sections['reattach-restart'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const before = await tabsOf(page);
      await sessionHolds(host, before.map((tab) => tab.id ?? '?'));
      // The host restarts while the page is away (a page that stayed would try to reach the terminal again, which a restart is not about).
      await page.goto('about:blank');
      host.restart();
      const streams = host.log.streams.length;
      const attaches = host.log.attaches.length;
      const lists = host.log.lists.length;
      await comeBack(page, w, { attaches: 0 });
      await until(() => host.log.lists.length, (count) => count > lists, 8000);
      const lane = await until(async () => bodyOf(page), (text) => text.includes(WORDS.gone), 5000);
      const after = await tabsOf(page);
      const listed = host.log.lists.slice(lists);
      const writes = host.log.writes.length;
      await page.keyboard.type('zzz');
      await sleep(300);
      check(
        'reattach.restart',
        before.length === 1 && JSON.stringify(after) === JSON.stringify(before) && lane.includes(WORDS.gone) && listed.length >= 1 && listed.every((entry) => entry.listed.length === 0) && host.log.streams.length === streams && host.log.attaches.length === attaches && host.log.writes.length === writes,
        `${engine} ${vp}: the saved tab ${JSON.stringify(before)} came back as ${JSON.stringify(after)} (the same); its card says ${JSON.stringify(lane)} (${JSON.stringify(WORDS.gone)} is right: a tab with no terminal behind it); the host was asked to list ${String(listed.length)} time(s) (1 or more) and listed ${JSON.stringify(listed.map((entry) => entry.listed.length))} terminal(s) (none is right); ${String(host.log.streams.length - streams)} stream(s) were opened and ${String(host.log.attaches.length - attaches)} attach(es) made (none is right); what was typed reached the shell: ${String(host.log.writes.length !== writes)} (no is right)`,
      );
      note(`reattach restart ${engine} ${vp}: the saved tab stayed, ended, and its card says ${JSON.stringify(lane.slice(0, 80))}, and no stream was opened for it`);
    } finally {
      await w.close();
    }
  };

  /**
   * A page that is going away sends the detach frame once for each terminal it holds, and asks the host to close none. The terminals are two, so that "once" is for each terminal and not for the page.
   */
  sections['reattach-leave'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      await page.click('[data-shell-part="sessionAdd"] button');
      await until(() => host.log.attaches.length, (count) => count >= 2);
      const ids = host.ids();
      const owners = host.log.attaches.map((entry) => entry.stream);
      await sessionHolds(host, ids);
      const mark = host.log.detaches.length;
      const closedMark = host.log.closed.length;
      await reload(page, w, { attaches: 2 });
      const sent = host.log.detaches.slice(mark).filter((entry) => owners.includes(entry.stream));
      const each = ids.map((id) => sent.filter((entry) => entry.id === id).length);
      check(
        'reattach.leave',
        ids.length === 2 && each.every((count) => count === 1) && sent.length === 2 && host.log.closed.length === closedMark,
        `${engine} ${vp}: the page that went away sent the detach frame ${JSON.stringify(each)} time(s) for each of its ${String(ids.length)} terminals (once each is right) and asked the host to close ${String(host.log.closed.length - closedMark)} (none is right)`,
      );
      note(`reattach leave ${engine} ${vp}: pagehide sent the detach frame once for each of two terminals and closed none`);
    } finally {
      await w.close();
    }
  };

  /**
   * A shell that ended while no page held it comes back to its saved tab as ended, with its output; a kept end that no tab holds (a terminal whose tab was never saved) is skipped, not opened and not attached; and when the person closes the
   * tab of an ended terminal the page dismisses it, so that no tab comes back for it after a reload.
   */
  sections['reattach-tombstone'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      await typeLine(page, 'hello');
      await until(async () => (await rowsOf(page)).some((row) => /hello from the synthetic shell/.test(row)), (shown) => shown, 8000);
      const id = host.ids()[0];
      const tab = (await tabsOf(page))[0];
      await sessionHolds(host, [id]);
      // The page goes away and the shell ends while no page holds it: the host keeps its end and its output.
      const caps = parsedSlot(await capsOf(page));
      await page.goto('about:blank');
      await until(() => host.state(id)?.holder, (holder) => holder === null);
      host.append(id, 'last words\r\n');
      host.end(id, { reason: 'exited', exit_code: 7 });
      await until(() => host.keptEnds().length, (count) => count === 1);
      // A terminal made by the page whose tab was never saved (the tab's storage holds its capability and the session does not): its shell ended too.
      const orphan = await host.call('CreateTerminal', [{ id: 'orphan-terminal', tty: true, command: [], labels: {}, params: {}, resource_plugin: '', resource_key: '' }, { channel: true, cols: 80, rows: 24 }]);
      // The tab's own storage keeps it: the page that comes back finds it there (the init script adds it before the page's scripts run).
      await page.addInitScript(([key, text]) => window.sessionStorage.setItem(key, text), [CAPABILITY_KEY, JSON.stringify({ ...caps, [orphan.id]: orphan.cap })]);
      host.end(orphan.id, { reason: 'exited', exit_code: 3 });
      await until(() => host.keptEnds().length, (count) => count === 2);
      const attachMark = host.log.attaches.length;
      await comeBack(page, w);
      const lane = await until(async () => laneOf(page), (text) => /Exited with code 7/.test(text), 5000);
      const rows = await until(async () => rowsOf(page), (shown) => shown.some((row) => /last words/.test(row)), 5000);
      const tabs = await tabsOf(page);
      const arrived = host.log.attaches.slice(attachMark);
      const writes = host.log.writes.length;
      await page.keyboard.type('zzz');
      await sleep(300);
      const quiet = host.log.writes.length === writes;
      // The person closes the tab of the ended terminal: the page dismisses it (it is not closed: nothing runs) and the host keeps no end of it.
      await page.click('[data-shell-part="sessionClose"]');
      await until(async () => tabsOf(page), (left) => left.length === 0);
      await until(() => host.log.dismissed, (dismissed) => dismissed.includes(id));
      const dismissed = host.log.dismissed.filter((one) => one === id).length;
      await until(async () => slotOf(host, 'session'), (text) => typeof text === 'string' && !text.includes(id));
      const keptIds = host.keptEnds().map((entry) => entry.id);
      const attaches = host.log.attaches.length;
      const listsBefore = host.log.lists.length;
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('[data-shell-part="window"]');
      await until(() => host.log.lists.length, (count) => count > listsBefore);
      await reveal(page);
      await settled(page.waitForSelector('[data-shell-part="panelEmpty"]', { timeout: 6000 }));
      const left = await tabsOf(page);
      check(
        'reattach.tombstone',
        tabs.length === 1 && tabs[0].id === tab.id && arrived.length === 1 && arrived[0].id === id && arrived[0].outcome === 'ended' && /Exited with code 7/.test(lane) && rows.some((row) => /last words/.test(row)) && quiet && dismissed === 1 && host.log.closed.length === 0 && !keptIds.includes(id) && left.length === 0 && host.log.attaches.length === attaches,
        `${engine} ${vp}: the saved tab ${JSON.stringify(tab)} came back as ${JSON.stringify(tabs)} (one: the kept end of a terminal no tab holds is skipped) with the lane ${JSON.stringify(lane)} (Exited with code 7 is right) and its output ${JSON.stringify(rows.slice(-3))} (it holds the last words); ${JSON.stringify(arrived.map((entry) => `${String(entry.id)} ${entry.outcome}`))} attached (the saved tab's, ended, and nothing else is right), typing reached the shell: ${String(!quiet)} (no is right); after the person closed the tab the host was asked to dismiss it ${String(dismissed)} time(s) (once is right) and to close ${String(host.log.closed.length)} (none) and keeps ${JSON.stringify(keptIds.includes(id))} of its end (no is right); after a reload the strip holds ${JSON.stringify(left)} (no tab is right) and ${String(host.log.attaches.length - attaches)} attach(es) were made (none is right)`,
      );
      note(`reattach tombstone ${engine} ${vp}: the saved tab came back ended (${JSON.stringify(lane)}) with its output, a kept end no tab holds was skipped, and after the tab was closed the page dismissed the end and no tab came back`);
    } finally {
      await w.close();
    }
  };

  /**
   * axe-core finds no violation in a terminal whose tab is reattaching (the page reloaded and the host holds the `ready` of its attach: its lane says "Reattaching"), nor in the same terminal once a second page of the same window state took
   * it (the held stream is sent `taken-over`, and the lane says "Taken over by another tab" and its note). axe runs over the tool's body as the `axe` section runs it; the premises (the host held the answer, the other page holds the
   * terminal, the two lanes say what they must) are part of the assertion, so that a page that is not in these two states is not taken for a clean one.
   */
  sections['reattach-axe'] = async (ctx) => {
    if (ctx.vp !== '1440x900') return;
    const { engine, vp } = ctx;
    const BODY = '[data-shell-part="terminalBody"]';
    const w = await world(ctx);
    let hold;
    try {
      const { host } = w;
      const a = await w.open();
      await start(a);
      const id = host.ids()[0];
      await sessionHolds(host, [id]);
      // The `ready` of the next attach of the terminal is held: the page that reloads is reattaching it until the probe lets it go.
      hold = host.holdReady(id);
      await a.reload({ waitUntil: 'load' });
      await a.waitForSelector('[data-shell-part="window"]');
      const held = await until(() => hold.held(), (is) => is, 8000);
      const heldStream = host.log.attaches.at(-1)?.stream;
      await reveal(a);
      await a.addScriptTag({ path: AXE });
      const reattaching = await until(async () => laneOf(a), (text) => text.includes(WORDS.reattaching), 5000);
      const axeReattaching = await runAxe(a, BODY);
      // The same window state and capability: a duplicated tab, which takes the terminal from the stream whose `ready` is held.
      await w.open();
      const holder = await until(() => host.state(id)?.holder, (now) => now !== null && now !== heldStream, 8000);
      const taken = await until(async () => laneOf(a), (text) => text.includes(WORDS.takenOver), 8000);
      await perturbed(ctx, a, 'taken');
      const axeTaken = await runAxe(a, BODY);
      check(
        'reattach.axe',
        held && holder !== heldStream && reattaching.includes(WORDS.reattaching) && taken.includes(WORDS.takenOver) && taken.includes(WORDS.taken) && axeReattaching.length === 0 && axeTaken.length === 0,
        `${engine} ${vp}: with the \`ready\` of its attach ${held ? 'held' : 'NOT held'} the tab's lane says ${JSON.stringify(reattaching)} (${JSON.stringify(WORDS.reattaching)} is right) and axe finds ${JSON.stringify(axeReattaching)} in the tool's body (nothing is right); once the other page took the terminal (stream ${String(holder)}, not ${String(heldStream)}) the lane says ${JSON.stringify(taken)} (${JSON.stringify(WORDS.takenOver)} and its note are right) and axe finds ${JSON.stringify(axeTaken)} (nothing is right)`,
      );
      note(`reattach axe ${engine} ${vp}: axe found nothing in the tab that was reattaching (${JSON.stringify(reattaching)}) nor in the same tab once another tab took the terminal (${JSON.stringify(taken)})`);
    } finally {
      hold?.release();
      await w.close();
    }
  };

  // The follow-ups (terminal-reattach-followups.mjs) are given what they need of this file, and run as the sections above do.
  Object.assign(sections, createFollowupSections({ check, note, runAxe, helpers: { world, start, reveal, until, moving, sleep, perturbed, tabsOf, laneOf, bodyOf, rowsOf, typeLine, slotOf, wroteBy, AXE } }));

  // A control proves an assertion at one viewport: what it plants does not depend on the size of the window.
  for (const [name, section] of Object.entries(sections)) {
    sections[name] = async (ctx) => (ctx.control !== undefined && ctx.vp !== '1440x900' ? undefined : section(ctx));
  }

  return sections;
}

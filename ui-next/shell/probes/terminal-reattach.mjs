// The reattach sections of the Terminal probe (docs/ui-next/status/T2-go.md, T2b): a terminal survives a reload of the page, in a real xterm, in both engines at both viewports. The far end is the probe's own T2-go host
// (terminal-host.mjs), held in this process for a whole browser context: it outlives the fixture page, and a second page of the same context shares it. The fixture page (`?host=shared`) forwards the host's calls to it and
// receives its events from it, keeps its page key and its saved session in the host's window state (the real `loadSession` over a fake window service), and counts the numbered lines of a flood that its emulator is given.
// The host models what the real one does that the document does not say (T2b explore, /tmp/t2b-explore/REPORT.md): a terminal whose shell ended is kept as a tombstone and is not dismissed by a close, the old window of a reload
// still holds the terminal until the host notices it is gone, a new holder's own takeover is announced with the number of the window it displaced, a program that is given the size it has draws nothing, and (host #675) the
// answer of an attach and each entry of the list say which input number the queue takes next (the list's is stale when another tab writes before the page attaches). A call a page makes as it goes away is a keepalive request
// (the binding is dropped with the page in Chromium).
// This file knows nothing of the probe's own internals: terminal-probe.mjs hands it `check`, `note`, `report` and `runAxe`, and adds its sections, its parts and its negative controls to its own. The sections of T2d (the saved open flag
// of the panel, taking a terminal back with the guard of its button and what a tab that was offline learns, the rejoin by offset, the rejoin past the host's ring, the keys typed while a late replay is written, the acknowledgement in
// flight, a terminal that is not there any more) are in terminal-reattach-followups.mjs and are added to these here, with their parts and controls.
//
// Each section has ONE assertion, so that a control trips only that one:
//   reattach-key        the page key is made once, kept in the window's state, never in the address, and every create carries it, before and after a reload (reattach.key)
//   reattach-restore    a reload brings back the same tabs, titles, order and tab on screen, running again, and the input works (reattach.restore)
//   reattach-exact      a reload during a numbered flood joins with no gap and no duplicate in the emulator's lines, with an event the replay holds delivered late and dropped by its offset, and the page acknowledges the live
//                       bytes and never the replay (reattach.exact)
//   reattach-muted      a replay that holds a query (the cursor position, the device attributes) is answered by nobody, and a live query after it is (reattach.muted)
//   reattach-modes      the alternate screen, the mouse, bracketed paste, the application cursor, focus events and a hidden cursor come back from the replay's modes, which the ring kept after the bytes that set them were gone (reattach.modes)
//   reattach-size       the size the shell reports after a reload is the screen's cells, and a full-screen program draws itself again (reattach.size)
//   reattach-detached   a page that lost its terminal to another tab says so, takes no input, and sends neither a detach nor a close when it goes; the new holder's own takeover, and a DETACHED with another number, change nothing (reattach.detached)
//   reattach-lease      a terminal detached by its owner says so, and when its lease runs out says that no tab took it back in time (reattach.lease)
//   reattach-restart    a saved tab whose terminal the host no longer lists stays ended, with the words for it, and nothing is attached (reattach.restart)
//   reattach-tombstone  a shell that ended while no page held it comes back to its saved tab as ended with its output, and no tab comes back for one the person closed, which the host still lists (reattach.tombstone)
//   reattach-leave      a page that is going away detaches a keyed terminal once (reattach.leave)
//   reattach-seq        the input of a reattached page is numbered from the number the answer of the attach says, never the list's (another tab's write made it stale on purpose): the first call is exactly that number, the rest follow it, none is 0 and none is refused as stale (reattach.seq)
//   reattach-axe        axe-core finds no violation in a terminal that another tab took (the ended tab, its lane and its note), nor, in the same page, in the tab that is reattaching while the host holds the answer of its attach (reattach.axe)
import { AXE } from './harness.mjs';
import { createHost, serveContext } from './terminal-host.mjs';
import { createFollowupSections, FOLLOWUP_CONTROLS, FOLLOWUP_PARTS } from './terminal-reattach-followups.mjs';

/** The words the screen writes in the lane for each way a terminal is lost (state.ts), and for a saved tab whose terminal is gone. */
export const WORDS = Object.freeze({
  takenOver: 'Taken over by another tab',
  requested: 'Detached',
  windowRetired: 'Detached with its window',
  lease: 'Closed: no tab took it back in time',
  reattaching: 'Reattaching',
  gone: 'The earlier output is gone',
});

export const REATTACH_PARTS = {
  'reattach-a': ['reattach-key', 'reattach-restore', 'reattach-exact', 'reattach-axe'],
  'reattach-b': ['reattach-muted', 'reattach-modes', 'reattach-size'],
  'reattach-c': ['reattach-detached', 'reattach-lease', 'reattach-restart', 'reattach-tombstone', 'reattach-leave', 'reattach-seq'],
  // T2d (terminal-reattach-followups.mjs): the saved open flag, taking a terminal back, the rejoin by offset, the rejoin past the ring, a terminal that is not there any more.
  ...FOLLOWUP_PARTS,
};

/**
 * The negative controls of the reattach assertions, each a single fault, in the shape of the probe's own table. `query` is a control of the fixture page (`?control=`); `host` is one of the far end: its `faults` (named in
 * terminal-host.mjs) and its `options`. Each runs in Chromium: what it proves does not depend on the engine.
 */
export const REATTACH_CONTROLS = {
  // The page puts its key in the address, and the window's state never keeps it, so that every load makes a new one.
  'key-in-url': { assertion: 'reattach.key', section: 'reattach-key', engines: ['chromium'], query: 'control=key-in-url' },
  'key-regen': { assertion: 'reattach.key', section: 'reattach-key', engines: ['chromium'], query: 'control=key-regen' },
  // The window's state never keeps the session: the tabs are not there after a reload.
  'no-session': { assertion: 'reattach.restore', section: 'reattach-restore', engines: ['chromium'], query: 'control=no-session' },
  // The replay lacks its last bytes (a gap), an event the replay holds comes again at the offset the page expects next (a duplicate), the page acknowledges the replay.
  'replay-gap': { assertion: 'reattach.exact', section: 'reattach-exact', engines: ['chromium'], host: { faults: { replayGap: true } } },
  'dup-offset': { assertion: 'reattach.exact', section: 'reattach-exact', engines: ['chromium'], host: { faults: { duplicateOffset: true } } },
  'ack-replay': { assertion: 'reattach.exact', section: 'reattach-exact', engines: ['chromium'], query: 'control=ack-replay' },
  // A reply to a query of the replay reaches the shell.
  'unmuted-reply': { assertion: 'reattach.muted', section: 'reattach-muted', engines: ['chromium'], host: { faults: { unmutedReply: true } } },
  // The host's modes are all off, as if its scanner had lost them.
  'modes-lost': { assertion: 'reattach.modes', section: 'reattach-modes', engines: ['chromium'], host: { faults: { modesLost: true } } },
  // The host takes a resize call and the pty keeps its size.
  'resize-ignored': { assertion: 'reattach.size', section: 'reattach-size', engines: ['chromium'], host: { faults: { resizeIgnored: true } } },
  // The host does not tell the page that another tab took the terminal.
  'no-detached': { assertion: 'reattach.detached', section: 'reattach-detached', engines: ['chromium'], host: { faults: { noDetached: true } } },
  // The lease runs out and the host says nothing.
  'lease-silent': { assertion: 'reattach.lease', section: 'reattach-lease', engines: ['chromium'], host: { faults: { leaseSilent: true } } },
  // The host goes on listing a terminal it no longer has.
  'list-ghost': { assertion: 'reattach.restart', section: 'reattach-restart', engines: ['chromium'], host: { faults: { listGhost: true } } },
  // The page never tells the host it is going away.
  'leave-lost': { assertion: 'reattach.leave', section: 'reattach-leave', engines: ['chromium'], query: 'control=leave-lost' },
  // The answer of the attach hands the page a wrong number, 1, which is what a page that had sent nothing would be told: the terminal takes a higher number next, so every call the page numbers is refused as stale.
  'seq-restart': { assertion: 'reattach.seq', section: 'reattach-seq', engines: ['chromium'], query: 'control=seq-restart' },
  // The host names a new holder's own takeover with the new holder's number (the page takes its own takeover for its loss), and lists a tombstone as a terminal that runs (the page makes a tab for a terminal nobody holds).
  'own-number': { assertion: 'reattach.detached', section: 'reattach-detached', engines: ['chromium'], host: { faults: { ownNumber: true } } },
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
 * A browser context with the probe's host behind it and the fixture page's address. A page opened in it is a window of the host; one that loads another document, or closes, retires its window.
 * `options.host` are the host's options (the lease, whether another tab writes between the list and the attach, whether a close dismisses a tombstone); the control's own are added to them.
 */
async function world(ctx, options = {}) {
  const { browser, origin, viewport, control } = ctx;
  const host = createHost({ ...options.host, ...control?.host?.options, faults: { ...control?.host?.faults } });
  const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
  const served = await serveContext(context, host, { sweepMs: options.sweepMs ?? 0 });
  const query = ['host=shared', 'renderer=dom', options.query, control?.query].filter((part) => part !== undefined && part !== '').join('&');
  const url = `${origin}/shell/probes/terminal-fixture.html?${query}`;
  const open = async () => {
    const page = await context.newPage();
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

/** What a window wrote to the shell, in order, as one text. */
const wroteBy = (host, who, from = 0) =>
  host.log.writes
    .slice(from)
    .filter((entry) => entry.window === who)
    .map((entry) => entry.data)
    .join('');

const windowsOf = (host) => host.windows();
const slotOf = async (host, slot) => (await host.call('probe', 'GetState', ['main']))[slot];

export function createReattachSections({ check, note, report, runAxe }) {
  const sections = {};

  /** The page key: made once, kept in the window's state and not in the address, and carried by every create. */
  sections['reattach-key'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const key = host.log.created[0]?.key ?? null;
      const usable = key !== null && /^[\x21-\x7e]{16,128}$/.test(key);
      const saved = await slotOf(host, 'terminal-page-key');
      const saves = () => host.log.calls.filter((entry) => entry.method === 'SaveState' && entry.args[0] === 'terminal-page-key').length;
      const savesBefore = saves();
      const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
      const inAddress = key !== null && [page.url(), ...resources].some((text) => text.includes(key));
      await reload(page, w);
      const keptAfter = await slotOf(host, 'terminal-page-key');
      await page.click('[data-shell-part="sessionAdd"] button');
      await until(() => host.log.created.length, (count) => count >= 2);
      const second = host.log.created[1]?.key ?? null;
      const listed = host.log.calls.filter((entry) => entry.method === 'ListTerminals' && entry.id === key).length;
      const inAddressAfter = key !== null && page.url().includes(key);
      check(
        'reattach.key',
        usable && saved === JSON.stringify(key) && savesBefore === 1 && !inAddress && keptAfter === saved && saves() === 1 && second === key && listed >= 1 && !inAddressAfter,
        `${engine} ${vp}: the first create carried ${JSON.stringify(key === null ? null : `${key.slice(0, 4)}... (${String(key.length)} characters)`)} (16 to 128 visible ASCII: ${String(usable)}); the window's state held ${saved === undefined ? 'nothing' : 'a value'} that is ${saved === JSON.stringify(key) ? '' : 'NOT '}the key, saved ${String(savesBefore)} time(s) (once is right); it is ${inAddress ? '' : 'not '}in the address or a request (not is right); after a reload the state is ${keptAfter === saved ? 'the same' : 'DIFFERENT'}, ${String(saves())} saves in all (once), ListTerminals was asked with it ${String(listed)} time(s) (1 or more), the next create carried ${second === key ? 'the same key' : 'ANOTHER key'}, and it is ${inAddressAfter ? '' : 'not '}in the address`,
      );
      note(`reattach key ${engine} ${vp}: one key of ${String(key?.length)} characters, saved once in the window's state, in no address, carried by ${String(host.log.created.length)} creates and used by ${String(listed)} list(s) after a reload`);
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
        await sleep(300);
      }

      const tabs = await tabsOf(page);
      // The second tab is the one on screen when the page goes: a person who picked it.
      await page.locator('[data-shell-part="sessionTabs"] [role="tab"]').nth(1).click();
      await sleep(300);
      const before = await tabsOf(page);
      // The window's state keeps the session once its saver has written it (a burst, 400 ms after the last change).
      await until(
        async () => slotOf(host, 'session'),
        (text) => typeof text === 'string' && before.every((tab) => text.includes(tab.id ?? '?')),
      );
      const saved = await slotOf(host, 'session');
      await sleep(600);
      await reload(page, w, { attaches: 3 });
      const after = await tabsOf(page);
      const lane = await laneOf(page);
      const live = host.ids().filter((id) => host.state(id)?.holder !== null).length;
      const mark = host.log.writes.length;
      await typeLine(page, 'hello');
      const echoed = await until(
        async () => (await rowsOf(page)).filter((row) => /hello from the synthetic shell/.test(row)).length,
        (count) => count >= 1,
        8000,
      );
      const writer = windowsOf(host).at(-1);
      const typed = /hello/.test(wroteBy(host, writer, mark));
      const same = JSON.stringify(after) === JSON.stringify(before);
      check(
        'reattach.restore',
        tabs.length === 3 && typeof saved === 'string' && same && after.filter((tab) => tab.selected).length === 1 && after.findIndex((tab) => tab.selected) === 1 && lane === '' && live === 3 && typed && echoed >= 1,
        `${engine} ${vp}: three tabs ${JSON.stringify(before)}; after a reload ${JSON.stringify(after)} (the same ones, in the same order, with the second on screen: ${String(same)}); the lane says ${JSON.stringify(lane)} (nothing is right: running), ${String(live)} of 3 terminals are held by the new page, what was typed reached the shell: ${String(typed)}, the screen shows its answer ${String(echoed)} time(s)`,
      );
      note(`reattach restore ${engine} ${vp}: three tabs came back in order with the second on screen, running, and typing works`);
    } finally {
      await w.close();
    }
  };

  /** A reload during a numbered flood: the ring has moved on, the join is exact, and only the live bytes are acknowledged. */
  sections['reattach-exact'] = async (ctx) => {
    const { engine, vp } = ctx;
    const LINES = 60_000;
    const TOTAL = LINES * 82;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const id = host.ids()[0];
      await typeLine(page, `flood ${String(LINES)} 80`);
      await until(() => host.state(id)?.end ?? 0, (end) => end >= 2_500_000, 60_000);
      const first = windowsOf(host)[0];
      await reload(page, w);
      await moving(() => ({ end: host.state(id)?.end ?? 0, waiting: host.state(id)?.waiting ?? 1, paused: host.state(id)?.paused ?? true }), (state) => state.end >= TOTAL && state.waiting === 0 && !state.paused, { limit: 90_000 });
      await moving(
        async () => page.evaluate(() => ({ accepted: window.__engine.accepted, parsed: window.__engine.parsed, last: window.__engine.lines.last })),
        (state) => state.parsed === state.accepted && state.last === LINES - 1,
        { limit: 30_000 },
      );
      await sleep(300);
      const attach = host.log.attaches.at(-1);
      const end = host.state(id).end;
      const acked = await until(() => host.log.acks.filter((entry) => entry.window === attach.window).reduce((sum, entry) => sum + entry.bytes, 0), (sum) => sum === end - attach.end, 5000);
      const lines = await page.evaluate(() => window.__engine.lines);
      const dupSent = host.log.duplicates.length;
      check(
        'reattach.exact',
        attach.start > 0 && attach.window !== first && dupSent >= 1 && lines.last === LINES - 1 && lines.gaps.length === 0 && lines.dups.length === 0 && lines.count > 5000 && acked === end - attach.end,
        `${engine} ${vp}: the ring had moved (the replay started at ${String(attach.start)} of ${String(attach.end)}); an event the replay held was sent again ${String(dupSent)} time(s) (1 or more); the emulator was given ${String(lines.count)} numbered lines ending at ${String(lines.last)} (${String(LINES - 1)} is the last) with ${JSON.stringify(lines.gaps.slice(0, 3))} gaps and ${JSON.stringify(lines.dups.slice(0, 3))} duplicates (none of either); the new page acknowledged ${String(acked)} B and the live bytes were ${String(end - attach.end)} (equal is right: never the replay, never a dropped duplicate)`,
      );
      note(`reattach exact ${engine} ${vp}: the page reloaded at ${String(attach.end)} B of ${String(TOTAL)}, the replay was ${String(attach.end - attach.start)} B from offset ${String(attach.start)}, ${String(lines.count)} lines in order to ${String(lines.last)}, ${String(dupSent)} late duplicate(s) dropped, ${String(acked)} B acknowledged`);
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
      const firstWindow = windowsOf(host)[0];
      const asked = await until(() => REPLY.test(wroteBy(host, firstWindow)), (answered) => answered, 8000);
      await reload(page, w);
      await sleep(800);
      const second = windowsOf(host).at(-1);
      const replayed = wroteBy(host, second);
      await typeLine(page, 'query');
      const live = await until(() => REPLY.test(wroteBy(host, second)), (answered) => answered, 8000);
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
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const id = host.ids()[0];
      await typeLine(page, 'fullscreen');
      await until(() => host.state(id)?.program, (program) => program === 'fullscreen');
      // The shell writes 2 MB more while the program runs: the ring moves past the bytes that set the modes, which only `start_modes` keeps.
      host.flood(id, 25_000, 80);
      await moving(() => ({ end: host.state(id)?.end ?? 0, waiting: host.state(id)?.waiting ?? 1 }), (state) => state.end >= 2_000_000 && state.waiting === 0, { limit: 60_000 });
      const before = host.state(id);
      await reload(page, w);
      await sleep(800);
      const attach = host.log.attaches.at(-1);
      const holder = attach.window;
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
      await sleep(500);
      const wrote = wroteBy(host, holder, mark);
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
      await sleep(800);
      await typeLine(page, 'size');
      const reported = await until(async () => (await rowsOf(page)).filter((row) => /^\d+ \d+$/.test(row)).at(-1) ?? null, (row) => row !== null, 8000);
      const grid = await page.evaluate(() => window.__engine.grid());
      const fitted = reported === `${String(grid.rows)} ${String(grid.cols)}`;
      // A full-screen program: after the next reload it must draw again (the size is sent one cell off and then as it is, so that the pty signals a change twice).
      await typeLine(page, 'fullscreen');
      await until(() => host.state(id)?.program, (program) => program === 'fullscreen');
      const frame = host.state(id).frame;
      const mark = host.log.resizes.length;
      await reload(page, w);
      await sleep(800);
      const after = host.state(id);
      const resizes = host.log.resizes.slice(mark);
      const gridAfter = await page.evaluate(() => window.__engine.grid());
      const redrew = after.frame >= frame + 1 && resizes.length >= 2;
      const rowsNow = await rowsOf(page);
      check(
        'reattach.size',
        fitted && redrew && after.rows === gridAfter.rows && after.cols === gridAfter.cols && rowsNow.some((row) => /FULLSCREEN frame/.test(row)),
        `${engine} ${vp}: after a reload in a window of another size the shell reported ${JSON.stringify(reported)} and the screen has ${String(grid.rows)} rows and ${String(grid.cols)} columns; the full-screen program drew frame ${String(frame)} before the next reload and ${String(after.frame)} after it, with ${JSON.stringify(resizes.map((entry) => `${String(entry.rows)}x${String(entry.cols)}`))} sent in between; the pty is ${String(after.rows)}x${String(after.cols)} and the screen ${String(gridAfter.rows)}x${String(gridAfter.cols)}; the screen shows the program: ${String(rowsNow.some((row) => /FULLSCREEN frame/.test(row)))}`,
      );
      note(`reattach size ${engine} ${vp}: the shell reported ${String(reported)} for a screen of ${String(grid.rows)}x${String(grid.cols)}; the full-screen program went from frame ${String(frame)} to ${String(after.frame)} with ${String(resizes.length)} sizes sent`);
    } finally {
      await w.close();
    }
  };

  /** A second tab takes the terminal: the first says so with its own number, takes no input, and sends no detach or close; a DETACHED with another number changes nothing. */
  sections['reattach-detached'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const a = await w.open();
      await start(a);
      const id = host.ids()[0];
      const first = windowsOf(host)[0];
      await sleep(600);
      // The same window state and the same key: a duplicated tab. Its restore finds the terminal and takes it over.
      const b = await w.open();
      await reveal(b);
      await until(() => host.state(id)?.holder, (holder) => holder === 1);
      await settled(b.waitForSelector('.xterm-helper-textarea', { timeout: 8000 }));
      const lane = await until(async () => laneOf(a), (text) => text.includes(WORDS.takenOver), 4000);
      const told = host.log.events.filter((event) => event.name === `core/exec/signal/DETACHED/${id}`).map((event) => event.data);
      const mark = host.log.writes.length;
      const callMark = host.log.calls.length;
      await a.locator('.xterm-helper-textarea').focus({ timeout: 3000 }).catch(() => undefined);
      await a.keyboard.type('zzz');
      await sleep(400);
      const typedInA = wroteBy(host, first, mark);
      await a.goto('about:blank');
      await sleep(600);
      const sentByA = host.log.calls.slice(callMark).filter((entry) => entry.window === first && (entry.method === 'DetachTerminal' || entry.method === 'CloseSession'));
      // A DETACHED for another number is not the page's business: the page that holds the terminal goes on.
      host.emit(`core/exec/signal/DETACHED/${id}`, { by: 'taken-over', attachment: 99 });
      await sleep(500);
      const laneB = await laneOf(b);
      await typeLine(b, 'hello');
      const echoed = await until(async () => (await rowsOf(b)).some((row) => /hello from the synthetic shell/.test(row)), (shown) => shown, 4000);
      // A page that reloads when the one that went away did not say so: the host still takes the old window for the holder (it notices 1.5 s later here, 2 to 4 s in the real host), so the terminal is listed as held and the new
      // page takes it over. Its own takeover comes back to it with the number of the window it displaced, and it must not take that for its own loss; the old window's late retirement finds nothing.
      const late = await world(ctx, { sweepMs: 1500, query: 'detach=off' });
      let own = { lane: null, echoed: false, holder: null, told: [] };
      try {
        const p = await late.open();
        await start(p);
        const lid = late.host.ids()[0];
        await sleep(500);
        await reload(p, late);
        await sleep(2000);
        const toldOwn = late.host.log.events.filter((event) => event.name === `core/exec/signal/DETACHED/${lid}`).map((event) => event.data);
        await typeLine(p, 'hello');
        const echoedOwn = await until(async () => (await rowsOf(p)).some((row) => /hello from the synthetic shell/.test(row)), (shown) => shown, 4000);
        own = { lane: await laneOf(p), echoed: echoedOwn, holder: late.host.state(lid)?.holder, told: toldOwn };
      } finally {
        await late.close();
      }

      check(
        'reattach.detached',
        lane.includes(WORDS.takenOver) && told.length === 1 && told[0].by === 'taken-over' && told[0].attachment === 0 && !typedInA.includes('zzz') && sentByA.length === 0 && host.state(id)?.holder === 1 && laneB === '' && echoed && own.lane === '' && own.echoed && own.holder === 1 && own.told.length === 1 && own.told[0].attachment === 0,
        `${engine} ${vp}: the first tab's lane says ${JSON.stringify(lane)} (${JSON.stringify(WORDS.takenOver)} is right); the host told it ${JSON.stringify(told)} (once, taken-over, with the number 0); what it typed afterwards reached the shell: ${JSON.stringify(typedInA)} (nothing is right); when it went it sent ${JSON.stringify(sentByA.map((entry) => entry.method))} (nothing is right); the other tab holds the terminal (${String(host.state(id)?.holder)}), its lane says ${JSON.stringify(laneB)} after its own takeover and a DETACHED with another number (nothing is right), and it still takes input: ${String(echoed)}; a page that reloaded while the old window still held the terminal was told ${JSON.stringify(own.told)} (once, with the number 0), its lane says ${JSON.stringify(own.lane)} (nothing is right), it holds the terminal (${String(own.holder)}) and takes input: ${String(own.echoed)}`,
      );
      note(`reattach detached ${engine} ${vp}: the first tab was told taken-over with its own number, took no input, sent nothing when it went; the new holder's own takeover, and a DETACHED with another number, changed nothing`);
    } finally {
      await w.close();
    }
  };

  /** The owner detaches the terminal: the page says so, and when its lease runs out says that no tab took it back in time. */
  sections['reattach-lease'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx, { host: { leaseMs: 1500 } });
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const id = host.ids()[0];
      const owner = windowsOf(host)[0];
      const key = host.log.created[0].key;
      await host.call(owner, 'DetachTerminal', [id, { page_key: key }]);
      const detached = await until(async () => laneOf(page), (text) => text.includes(WORDS.requested), 5000);
      const closed = await until(async () => laneOf(page), (text) => text.includes(WORDS.lease), 8000);
      const closes = host.log.events.filter((event) => event.name === `core/exec/signal/CLOSE/${id}`).map((event) => event.data);
      check(
        'reattach.lease',
        detached.includes(WORDS.requested) && closed.includes(WORDS.lease) && closes.length === 1 && closes[0].closed_by === 'detach-timeout',
        `${engine} ${vp}: after the owner detached the terminal the lane said ${JSON.stringify(detached)} (${JSON.stringify(WORDS.requested)} is right); after its lease of 1.5 s ran out it said ${JSON.stringify(closed)} (${JSON.stringify(WORDS.lease)} is right); the host sent ${JSON.stringify(closes.map((end) => `${end.reason} ${end.closed_by}`))} (one closed detach-timeout)`,
      );
      note(`reattach lease ${engine} ${vp}: detached by its owner (${JSON.stringify(detached)}), then ${JSON.stringify(closed)} when the lease of 1.5 s ran out`);
    } finally {
      await w.close();
    }
  };

  /** The host no longer has the terminal: the saved tab stays, ended, with the words for it, and nothing is attached. */
  sections['reattach-restart'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      await sleep(600);
      const before = await tabsOf(page);
      await until(
        async () => slotOf(host, 'session'),
        (text) => typeof text === 'string' && before.every((tab) => text.includes(tab.id ?? '?')),
      );
      host.restart();
      const mark = host.log.calls.length;
      await reload(page, w, { attaches: 0 });
      await until(() => host.log.calls.slice(mark).filter((entry) => entry.method === 'ListTerminals').length, (count) => count >= 1);
      await sleep(800);
      const lane = await bodyOf(page);
      const after = await tabsOf(page);
      const asked = host.log.calls.slice(mark).filter((entry) => entry.method === 'AttachTerminal').length;
      const listed = host.log.calls.slice(mark).filter((entry) => entry.method === 'ListTerminals').length;
      const writes = host.log.writes.length;
      await sleep(50);
      await page.keyboard.type('zzz');
      await sleep(300);
      check(
        'reattach.restart',
        before.length === 1 && JSON.stringify(after) === JSON.stringify(before) && lane.includes(WORDS.gone) && listed >= 1 && asked === 0 && host.log.writes.length === writes && host.log.attaches.length === 0,
        `${engine} ${vp}: the saved tab ${JSON.stringify(before)} came back as ${JSON.stringify(after)} (the same); its lane says ${JSON.stringify(lane)} (${JSON.stringify(WORDS.gone)} is right: a tab with no terminal behind it); the host was asked to list ${String(listed)} time(s) (1 or more) and to attach ${String(asked)} (none is right); what was typed reached the shell: ${String(host.log.writes.length !== writes)} (no is right)`,
      );
      note(`reattach restart ${engine} ${vp}: the saved tab stayed, ended, and its card says ${JSON.stringify(lane.slice(0, 80))}, and nothing was attached`);
    } finally {
      await w.close();
    }
  };

  /** A page that is going away detaches the keyed terminal it holds, once, and sends nothing for one that has no key. */
  sections['reattach-leave'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    let plain = { unkeyed: false, detaches: -1 };
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const id = host.ids()[0];
      const owner = windowsOf(host)[0];
      await sleep(600);
      const mark = host.log.calls.length;
      await reload(page, w);
      const detaches = host.log.calls.slice(mark).filter((entry) => entry.window === owner && entry.method === 'DetachTerminal' && entry.id === id);
      const closes = host.log.calls.slice(mark).filter((entry) => entry.window === owner && entry.method === 'CloseSession');
      // A page whose terminal has no key (`?key=off`) has nothing to leave: it ends with the page, and the page says nothing.
      const p = await world(ctx, { query: 'key=off' });
      try {
        const other = await p.open();
        await start(other);
        const unkeyed = p.host.log.created[0]?.key === null;
        const who = windowsOf(p.host)[0];
        await sleep(600);
        const from = p.host.log.calls.length;
        await other.reload({ waitUntil: 'load' });
        await sleep(800);
        plain = { unkeyed, detaches: p.host.log.calls.slice(from).filter((entry) => entry.window === who && entry.method === 'DetachTerminal').length };
      } finally {
        await p.close();
      }

      check(
        'reattach.leave',
        detaches.length === 1 && closes.length === 0 && plain.unkeyed && plain.detaches === 0,
        `${engine} ${vp}: the page that went away sent DetachTerminal ${String(detaches.length)} time(s) for the terminal it held (once is right) and CloseSession ${String(closes.length)} time(s) (never); a page whose terminal has no key (${String(plain.unkeyed)}) sent DetachTerminal ${String(plain.detaches)} time(s) (never)`,
      );
      note(`reattach leave ${engine} ${vp}: pagehide sent DetachTerminal once and no close for a keyed terminal, and nothing for one with no key`);
    } finally {
      await w.close();
    }
  };

  /**
   * The input numbers after a reattach (host #675): the answer of the attach says which number the input queue takes next (`next_input_seq`), and the reattached page continues the count from it, one counter for the keys and the
   * sizes. The terminal is one whose first page made a few calls, so the number is not 1; the entry of the list said a smaller number, true when the list was made and stale when the page attached (another tab wrote between the
   * two: `writeBetween`), and the page must not use it. The first call after the attach is numbered exactly the number the answer said, the calls after it follow one by one, none is 0 (unsequenced), and none is refused as stale.
   */
  sections['reattach-seq'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx, { host: { writeBetween: true } });
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      await typeLine(page, 'hello');
      await sleep(500);
      await reload(page, w);
      const writer = windowsOf(host).at(-1);
      const answered = host.log.attaches.at(-1);
      const first = answered.next_input_seq;
      const listed = host.log.lists.at(-1)?.listed.find((entry) => entry.id === answered.id)?.next_input_seq;
      await typeLine(page, 'hello');
      await sleep(600);
      // Writes and sizes share one counter: every numbered call of the new page, from its first, is in the series.
      const calls = host.log.calls.filter((entry) => entry.window === writer && (entry.method === 'WriteTerminal' || entry.method === 'ResizeTerminal'));
      const numbers = calls.map((entry) => entry.seq);
      const refused = calls.filter((entry) => entry.outcome !== 'applied');
      check(
        'reattach.seq',
        first > 1 && listed !== undefined && listed < first && calls.length > 0 && numbers.every((seq, index) => seq === first + index) && !numbers.includes(0) && !numbers.includes(listed) && refused.length === 0,
        `${engine} ${vp}: the answer of the attach said the host takes ${String(first)} next (more than 1 is right: the first page made calls) and the list said ${String(listed)} (a smaller number: another tab wrote between the two); the ${String(calls.length)} calls of the reattached page were numbered ${JSON.stringify(numbers)} (${String(first)}, ${String(first + 1)} ... is right: from the number of the answer, never the list's, never 0) and ${String(refused.length)} were refused or not applied ${JSON.stringify(refused.slice(0, 3).map((entry) => `${String(entry.seq)} ${String(entry.outcome)}`))} (none is right)`,
      );
      note(`reattach seq ${engine} ${vp}: the reattached page numbered its input from ${String(first)}, the number of the answer of the attach (the list had said ${String(listed)}, stale): ${JSON.stringify(numbers)}`);
    } finally {
      await w.close();
    }
  };

  /** A shell that ended while no page held it comes back to its saved tab as ended, with its output; one the person closed is still listed by the host (it does not dismiss it) and no tab makes it come back. */
  sections['reattach-tombstone'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      await typeLine(page, 'hello');
      await sleep(500);
      const id = host.ids()[0];
      const tab = (await tabsOf(page))[0];
      await until(
        async () => slotOf(host, 'session'),
        (text) => typeof text === 'string' && text.includes(id),
      );
      // The page goes away and the shell ends while no page holds it: the host keeps its end and its output for its lease.
      await page.goto('about:blank');
      await sleep(300);
      host.append(id, 'last words\r\n');
      host.end(id, { reason: 'exited', exit_code: 7 });
      await page.goto(w.url, { waitUntil: 'load' });
      await until(() => host.log.attaches.length, (count) => count >= 1);
      await reveal(page);
      const lane = await until(async () => laneOf(page), (text) => /Exited with code 7/.test(text), 5000);
      const rows = await until(async () => rowsOf(page), (shown) => shown.some((row) => /last words/.test(row)), 5000);
      const tabs = await tabsOf(page);
      const writes = host.log.writes.length;
      await page.keyboard.type('zzz');
      await sleep(300);
      const quiet = host.log.writes.length === writes;
      // The person closes the tab: the host answers that the session is not there and keeps the tombstone, and the saved session no longer holds the tab.
      await page.click('[data-shell-part="sessionClose"]');
      await until(async () => tabsOf(page), (left) => left.length === 0);
      await until(
        async () => slotOf(host, 'session'),
        (text) => typeof text === 'string' && !text.includes(id),
      );
      const kept = host.state(id) !== undefined && host.state(id).ended !== null;
      const attaches = host.log.attaches.length;
      const listsBefore = host.log.calls.filter((entry) => entry.method === 'ListTerminals').length;
      await page.reload({ waitUntil: 'load' });
      await until(() => host.log.calls.filter((entry) => entry.method === 'ListTerminals').length, (count) => count > listsBefore);
      await sleep(800);
      const left = await tabsOf(page);
      check(
        'reattach.tombstone',
        tabs.length === 1 && tabs[0].id === tab.id && /Exited with code 7/.test(lane) && rows.some((row) => /last words/.test(row)) && quiet && kept && left.length === 0 && host.log.attaches.length === attaches,
        `${engine} ${vp}: the saved tab ${JSON.stringify(tab)} came back as ${JSON.stringify(tabs)} with the lane ${JSON.stringify(lane)} (Exited with code 7 is right) and its output ${JSON.stringify(rows.slice(-3))} (it holds the last words), typing reached the shell: ${String(!quiet)} (no is right); after the person closed the tab the host still keeps the tombstone (${String(kept)}), and after a reload the strip holds ${JSON.stringify(left)} (no tab is right: one that no tab holds is skipped) and ${String(host.log.attaches.length - attaches)} attach(es) were made (none is right)`,
      );
      note(`reattach tombstone ${engine} ${vp}: the saved tab came back ended (${JSON.stringify(lane)}) with its output; after it was closed the host still listed the tombstone and no tab came back for it`);
    } finally {
      await w.close();
    }
  };

  /**
   * axe-core finds no violation in a terminal that another tab took: the ended tab, its lane ("Taken over by another tab") and its note, and, in the same page, the tab that is reattaching while the host holds the answer of its
   * attach (its lane says "Reattaching"). The page is one that reloaded and attaches both of its terminals, the host holding the answer of the second; a second page of the same window state and key takes both: the first, whose
   * attach the reloaded page had answered, is lost to it, and the second is reattaching still (what the host says of it waits for the page's own number, which the held answer carries). axe runs over the tool's body as the
   * `axe` section runs it, with each tab on screen in turn; the premises (the host held the answer, the other tab holds both terminals, the two lanes say what they must) are part of the assertion, so that a page that is not in these
   * two states is not taken for a clean one.
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
      await a.click('[data-shell-part="sessionAdd"] button');
      await until(() => host.log.created.length, (count) => count >= 2);
      await sleep(400);
      const ids = host.ids();
      await until(
        async () => slotOf(host, 'session'),
        (text) => typeof text === 'string' && ids.every((id) => text.includes(id)),
      );
      await sleep(600);
      // The answer of the next attach of the second terminal is held: the page that reloads is reattaching it until the probe lets the answer go.
      hold = host.holdAttach(ids[1]);
      await a.reload({ waitUntil: 'load' });
      await a.waitForSelector('[data-shell-part="window"]');
      const held = await until(() => hold.held(), (is) => is, 8000);
      await until(() => host.state(ids[0])?.holder, (holder) => holder === 1, 8000);
      // The same window state and key: a duplicated tab, which takes both terminals.
      await w.open();
      const holders = await until(
        () => ({ first: host.state(ids[0])?.holder, second: host.state(ids[1])?.holder }),
        (now) => now.first === 2 && now.second === 2,
        8000,
      );
      await reveal(a);
      await a.addScriptTag({ path: AXE });
      const tabs = a.locator('[data-shell-part="sessionTabs"] [role="tab"]');
      await tabs.nth(1).click();
      const reattaching = await until(async () => laneOf(a), (text) => text.includes(WORDS.reattaching), 5000);
      const axeReattaching = await runAxe(a, BODY);
      await tabs.nth(0).click();
      const taken = await until(async () => laneOf(a), (text) => text.includes(WORDS.takenOver), 8000);
      await perturbed(ctx, a, 'taken');
      const axeTaken = await runAxe(a, BODY);
      check(
        'reattach.axe',
        held && holders.first === 2 && holders.second === 2 && reattaching.includes(WORDS.reattaching) && taken.includes(WORDS.takenOver) && /Input is off/.test(taken) && axeReattaching.length === 0 && axeTaken.length === 0,
        `${engine} ${vp}: with the answer of its attach ${held ? 'held' : 'NOT held'} the second tab's lane says ${JSON.stringify(reattaching)} (${JSON.stringify(WORDS.reattaching)} is right) and axe finds ${JSON.stringify(axeReattaching)} in the tool's body (nothing is right); the first tab, which the other tab took (it holds ${String(holders.first)} and ${String(holders.second)}: 2 and 2 is right), says ${JSON.stringify(taken)} (${JSON.stringify(WORDS.takenOver)} and its note are right) and axe finds ${JSON.stringify(axeTaken)} (nothing is right)`,
      );
      note(`reattach axe ${engine} ${vp}: axe found nothing in the tab another tab took (${JSON.stringify(taken)}) nor in the tab that was reattaching (${JSON.stringify(reattaching)})`);
    } finally {
      hold?.release();
      await w.close();
    }
  };

  // The follow-ups (terminal-reattach-followups.mjs) are given what they need of this file, and run as the sections above do.
  Object.assign(sections, createFollowupSections({ check, note, runAxe, helpers: { world, start, reveal, until, moving, sleep, perturbed, tabsOf, laneOf, bodyOf, rowsOf, typeLine, windowsOf, slotOf, wroteBy, AXE } }));

  // A control proves an assertion at one viewport: what it plants does not depend on the size of the window.
  for (const [name, section] of Object.entries(sections)) {
    sections[name] = async (ctx) => (ctx.control !== undefined && ctx.vp !== '1440x900' ? undefined : section(ctx));
  }

  return sections;
}

// The follow-ups of the reattach probe (T2d): what the panel does with its saved open flag after a reload, taking back a terminal whose taker has gone (what a tab learns by asking the host, and what it does not learn without
// asking), and what the page does when its stream to a terminal is lost and comes back (the reconnect from the offset it has, the reconnect when the host's ring no longer reaches back, the terminal that is not there any more). The
// sections run in a real xterm against the probe's own terminal-channel host (terminal-host.mjs, terminal-reattach.mjs says how), in both engines at both viewports. This file knows nothing of the probe's own internals:
// terminal-reattach.mjs hands it `check`, `note`, `runAxe` and the helpers of its sections, and adds its sections, its parts and its negative controls to its own.
//
// Each assertion has its own controls, each ONE fault, which trip only it:
//   restore-open        a saved OPEN panel comes back open with its saved tool, its saved active session and its height; a saved CLOSED panel stays closed and, when it is opened, is on the tool and at the height it was left at, before another tool is chosen (restore.open)
//   reattach-takeback   a tab that lost its terminal to another tab and whose taker then went says so once it has asked the host (a visible tab asks when it is shown, when it gets the focus and every few seconds: the probe waits for
//                       the question and never provokes it), has a real button that takes it back (Tab reaches it, Enter presses it, a visible ring), makes ONE new stream that attaches with no offset, runs again in the same place with
//                       its earlier output and the keyboard in it, with the lane no higher than before; while the taker lives, also when a third tab took the terminal from the taker, there is no button and the old sentence (reattach.takeback);
//                       axe finds nothing in the lane with the button (reattach.axe-free)
//   reattach-reconnect  the stream of a terminal is lost and comes back: the page connects ONCE more, with the offset it has applied up to, the host continues exactly there, the numbered lines are in order with no gap and no
//                       duplicate across the blip, the screen is not reset, every byte of output the new stream sent (the replay included, never a gap) is acknowledged, and what is typed afterwards reaches the shell (reattach.reconnect)
//   reattach-reconnect-gap  the host's ring no longer reaches back to what the page has (`ready.lost` is more than nothing): the screen is reset and brought to the ring by a replay, and the lines are in order from the first of the replay to the end (reattach.reconnect-gap)
//   reattach-gone       the terminal vanished while the page was away: the host answers its one `not-found`, the page says the terminal is not there any more and does not connect again (reattach.gone)
//   reattach-reconnect-keys  a key typed while a late replay is being written (the fixture holds the end of the emulator's writes, so that the replay takes as many frames as the probe lets pass) is queued and reaches the shell once, in
//                       order, after the replay, none lost; what the emulator answers to a query in the replayed bytes reaches the shell never (reattach.reconnect-keys)
//   reattach-reconnect-acks  an acknowledgement that was in flight on the stream that was lost reaches the host late, after the page's new stream has taken the terminal, and counts for nothing: what is credited after the new
//                       attach is the bytes the new stream sent and nothing else (reattach.reconnect-acks)
//   reattach-takeback-guard  a tab whose free flag is stale (a third tab holds the terminal and the tab has not asked since) presses Take it back: it asks the host who holds the terminal and attaches nothing, the button goes, the lane
//                       says the terminal is taken over again and the third tab goes on typing (reattach.takeback-guard)
//   reattach-takeback-offline  a tab that could not reach the host when the tab that took the terminal let it go is told nothing and shows what it showed, and shows the button once the host can be asked again (reattach.takeback-offline)

/** The lines of the flood of the blips, and the bytes they are: a flood that is still running when the stream is lost, and that the host's backlog stops. */
const LINES = 60_000;
const TOTAL = LINES * 82;
const IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** What a program asks the terminal in the bytes the host kept: where the cursor is, and what the terminal is. The emulator answers both, and an answer to bytes of a replay is nobody's to send. */
const QUERIES = '\u001b[6n\u001b[c';
/** What the shell writes while no page is there: more than a chunk of the host's ring holds, so that the ring can be trimmed past the bytes a page has. Plain lines: no escape, no number. */
const FILLER = 'filler of the ring\r\n'.repeat(10_000);
/** What the shell writes after the page has joined again: bytes that are live whatever the page did before. */
const TAIL = 'after the join\r\n';

/** The words of the lane of a tab that lost its terminal: while the tab that took it lives, once it has gone, and for a terminal that is not there any more. */
const FREE = Object.freeze({
  old: /keeps running in the tab that took it/,
  closed: 'The tab that took this terminal has closed',
  lease: 'The shell keeps running until its lease ends',
  gone: /not there any more/i,
  lost: /connection to the terminal was lost/i,
  taken: 'Taken over by another tab',
});

export const FOLLOWUP_PARTS = {
  'reattach-d': ['restore-open'],
  'reattach-e': ['reattach-takeback', 'reattach-takeback-guard', 'reattach-takeback-offline'],
  'reattach-f': ['reattach-reconnect', 'reattach-reconnect-gap', 'reattach-gone', 'reattach-reconnect-keys', 'reattach-reconnect-acks'],
};

/** The negative controls of the follow-ups, in the shape of the probe's own table (see terminal-reattach.mjs). A `query` is a control of the fixture page, a `host` one of the far end, a `stage` and an `after` one of the page the probe plants. */
export const FOLLOWUP_CONTROLS = {
  // The saved panel comes back with the flag the other way: a restore that forgot that the panel was open, and one that forgot that it was closed.
  'restore-forgets-open': { assertion: 'restore.open', section: 'restore-open', engines: ['chromium'], query: 'control=restore-forgets-open' },
  'restore-forgets-closed': { assertion: 'restore.open', section: 'restore-open', engines: ['chromium'], query: 'control=restore-forgets-closed' },
  // The host's list says that a stream holds a terminal nobody holds, so that no button appears once the taker has gone; and a button that, once pressed, attaches twice.
  'taker-gone-ignored': { assertion: 'reattach.takeback', section: 'reattach-takeback', engines: ['chromium'], host: { faults: { attachedStuck: true } } },
  'take-back-twice': { assertion: 'reattach.takeback', section: 'reattach-takeback', engines: ['chromium'], stage: 'press', after: (page) => page.evaluate(() => { window.__link.arm(true); }) },
  // A violation that exists only in the lane of a tab that can be taken back: an image with no text alternative, planted once the lane with its button is drawn (the pattern of `axe-failed`).
  'free-axe': { assertion: 'reattach.axe-free', section: 'reattach-takeback', engines: ['chromium'], stage: 'free', after: (page) => page.evaluate((src) => { const image = document.createElement('img'); image.src = src; document.querySelector('[data-shell-part="terminalLane"]').append(image); }, IMAGE) },
  // A reconnect that starts over from the first byte, one whose replay lacks its last bytes, and one whose page never credits the replay (the host's window then stalls once the replay is more than it).
  'rejoin-from-zero': { assertion: 'reattach.reconnect', section: 'reattach-reconnect', engines: ['chromium'], query: 'control=rejoin-from-zero' },
  'reconnect-drops-missed': { assertion: 'reattach.reconnect', section: 'reattach-reconnect', engines: ['chromium'], host: { faults: { replayGap: true } } },
  'reconnect-replay-unacked': { assertion: 'reattach.reconnect', section: 'reattach-reconnect', engines: ['chromium'], query: 'control=replay-unacked' },
  // The host's ring no longer reaches back, and the host says that its replay starts where the page is.
  'gap-hidden': { assertion: 'reattach.reconnect-gap', section: 'reattach-reconnect-gap', engines: ['chromium'], host: { faults: { gapHidden: true } } },
  // A terminal that is gone is answered by closing the stream with no word, as a transient failure is: the page cannot tell it from a blip, connects again three times and gives up in the words of a lost connection.
  'gone-keeps-attaching': { assertion: 'reattach.gone', section: 'reattach-gone', engines: ['chromium'], host: { faults: { goneTransient: true } } },
  // A screen that drops what is typed while it writes a replay, and an engine that gives what the emulator answers to a query as keys.
  'keys-dropped': { assertion: 'reattach.reconnect-keys', section: 'reattach-reconnect-keys', engines: ['chromium'], query: 'control=keys-dropped' },
  'replies-as-keys': { assertion: 'reattach.reconnect-keys', section: 'reattach-reconnect-keys', engines: ['chromium'], query: 'control=replies-as-keys' },
  // The acknowledgement that was in flight on the lost stream is taken by the host after the new attach and credited to the new holder (a host that credits by terminal and not by stream).
  'ack-stale-restore': { assertion: 'reattach.reconnect-acks', section: 'reattach-reconnect-acks', engines: ['chromium'], host: { faults: { acksStale: true } } },
  // The host's list never says that a stream holds a terminal, so that a page that presses Take it back on a stale flag is told that nobody holds the terminal, and attaches (as a button that does not ask would).
  'takeback-unguarded': { assertion: 'reattach.takeback-guard', section: 'reattach-takeback-guard', engines: ['chromium'], host: { faults: { attachedHidden: true } } },
  // The host's list fails again once the tab can reach the host, so that a page that missed that the tab that took the terminal had gone cannot learn it (as a page that never asks).
  'refresh-skipped': { assertion: 'reattach.takeback-offline', section: 'reattach-takeback-offline', engines: ['chromium'], stage: 'offline', after: (page) => page.evaluate(() => { window.__link.failLists(true); }) },
};

/**
 * @param {{ check: Function, note: Function, runAxe: Function, helpers: Record<string, any> }} deps
 *   `helpers` are the helpers of terminal-reattach.mjs: `world`, `start`, `reveal`, `until`, `moving`, `perturbed`, `tabsOf`, `laneOf`, `bodyOf`, `rowsOf`, `typeLine`, `slotOf`, `wroteBy` and `AXE`.
 */
const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFollowupSections({ check, note, runAxe, helpers }) {
  const { world, start, reveal, until, moving, perturbed, tabsOf, laneOf, bodyOf, rowsOf, typeLine, slotOf, wroteBy, AXE } = helpers;
  const sections = {};
  const HELLO = /hello from the synthetic shell/;

  /** The panel as the person sees it: how high it is (0 when it is closed), the tool on screen and the session on screen. */
  const panelNow = async (page) =>
    page.evaluate(() => ({
      height: Math.round((document.querySelector('[data-shell-part="panel"]')?.getBoundingClientRect().height ?? 0) * 10) / 10,
      tool: document.querySelector('[data-shell-part="panelTools"] [role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null,
      active: document.querySelector('[data-shell-part="sessionTabs"] [role="tab"][aria-selected="true"]')?.getAttribute('data-tab-id') ?? null,
    }));

  /** The panel the window's state holds, once `done` accepts it (the saver writes a burst after the last change): what the next load is given. */
  const savedPanel = async (host, done, ms = 8000) =>
    until(
      async () => {
        try {
          return JSON.parse((await slotOf(host, 'session')) ?? 'null')?.panel ?? null;
        } catch {
          return null;
        }
      },
      (panel) => panel !== null && done(panel),
      ms,
    );

  /** The page has drawn what it was told: two frames have passed, so that what the page did with an answer or an event is on screen. A page that draws no frame is not waited for past a second. */
  const frames = async (page) =>
    page.evaluate(async () =>
      Promise.race([
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve(true);
            });
          });
        }),
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(false);
          }, 1000);
        }),
      ]),
    );

  /** How many times the page has asked the host who holds the terminals it knows (`ListChannelTerminals`, answered or failed). */
  const listedBy = async (page) => page.evaluate(() => window.__link.state().listed);

  /**
   * The page asks the host once more, and what it made of the answer is on screen. A visible tab asks when it is shown, when it gets the focus and every few seconds, so this waits for the question (a count of the page's
   * own) and never makes it.
   */
  const asked = async (page, ms = 20_000) => {
    const before = await listedBy(page);
    const count = await until(async () => listedBy(page), (now) => now > before, ms);
    await frames(page);
    return count - before;
  };

  /** The page loads again: its window and its panel are there, and the terminals it held are attached to it again (`attaches` of them), so that what is read next is what the restore made of the saved session. */
  const reloaded = async (page, host, attaches) => {
    const before = host.log.attaches.length;
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-shell-part="window"]');
    await page.waitForSelector('[data-shell-part="panel"]', { state: 'attached', timeout: 8000 });
    await until(() => host.log.attaches.length, (count) => count >= before + attaches, 8000);
    await frames(page);
  };

  /** A saved open panel comes back open, with its tool, its session and its height; a saved closed panel stays closed, and is open on the tool and at the height it was left at when it is opened. */
  sections['restore-open'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      await page.click('[data-shell-part="sessionAdd"] button');
      await until(() => host.log.created.length, (count) => count >= 2);
      await until(async () => (await tabsOf(page)).length, (count) => count >= 2, 8000);
      const base = await panelNow(page);
      // The first tab is on screen (a new session takes the screen), and the panel is higher than it began.
      await page.locator('[data-shell-part="sessionTabs"] [role="tab"]').nth(0).click();
      await page.locator('[data-shell-part="panelHandle"]').focus();
      await page.keyboard.press('PageUp');
      await page.keyboard.press('PageUp');
      const left = await until(async () => panelNow(page), (now) => now.height > base.height + 64, 8000);
      const first = (await tabsOf(page))[0];
      await savedPanel(host, (panel) => panel.open === true && panel.tool === 'terminal' && typeof panel.height === 'number' && panel.active?.terminal === first.id);

      // 1. Left open, on the Terminal tool, on the first session, higher than it began.
      await reloaded(page, host, 2);
      const opened = await panelNow(page);
      await reveal(page);

      // 2. Left open on the Logs tool.
      await page.locator('[data-shell-part="panelTools"] [role="tab"]', { hasText: 'Logs' }).click({ timeout: 4000 });
      await savedPanel(host, (panel) => panel.open === true && panel.tool === 'logs');
      await reloaded(page, host, 2);
      const onLogs = await panelNow(page);
      await reveal(page);

      // 3. Left closed on the Logs tool, at the height it was raised to: it stays closed, and once it is opened it is on the Logs tool at that height, before the Terminal tool is chosen again and has its session.
      await page.click('[data-shell-part="panelToggle"]');
      await savedPanel(host, (panel) => panel.open === false && panel.tool === 'logs' && typeof panel.height === 'number');
      await reloaded(page, host, 2);
      const closed = await panelNow(page);
      await reveal(page);
      const reopened = await until(async () => panelNow(page), (now) => now.height > 0, 8000);
      await page.locator('[data-shell-part="panelTools"] [role="tab"]', { hasText: 'Terminal' }).click({ timeout: 4000 });
      const back = await until(async () => panelNow(page), (now) => now.tool === 'Terminal' && now.active !== null, 8000);

      check(
        'restore.open',
        left.height > base.height &&
          opened.height > 0 &&
          Math.abs(opened.height - left.height) <= 1 &&
          opened.tool === 'Terminal' &&
          opened.active === first.id &&
          onLogs.height > 0 &&
          Math.abs(onLogs.height - left.height) <= 1 &&
          onLogs.tool === 'Logs' &&
          closed.height === 0 &&
          reopened.tool === 'Logs' &&
          Math.abs(reopened.height - left.height) <= 1 &&
          back.tool === 'Terminal' &&
          back.active === first.id,
        `${engine} ${vp}: the panel was left open at ${String(left.height)} px (it began at ${String(base.height)}) on the Terminal tool and on the first session ${String(first.id)}, and after a reload it is ${JSON.stringify(opened)} (open at the same height, the tool and the session are right); left on the Logs tool it comes back ${JSON.stringify(onLogs)} (open at that height, on Logs); left closed on the Logs tool it comes back ${JSON.stringify(closed)} (closed: 0 px) and is ${JSON.stringify(reopened)} once opened (on Logs, at ${String(left.height)} px, before the Terminal tool is chosen), and the Terminal tool has its session again: ${JSON.stringify(back)}`,
      );
      note(`restore open ${engine} ${vp}: the panel came back open at ${String(opened.height)} px on ${String(opened.tool)} and the first session, open on Logs when it was left there, and closed when it was left closed, on Logs at ${String(reopened.height)} px once opened`);
    } finally {
      await w.close();
    }
  };

  /** The tab that took the terminal has gone: the tab that lost it can take it back once it has asked the host. While the taker lives there is no button. */
  sections['reattach-takeback'] = async (ctx) => {
    const { engine, vp } = ctx;
    const BODY = '[data-shell-part="terminalBody"]';
    const w = await world(ctx);
    try {
      const { host } = w;
      const a = await w.open();
      await start(a);
      await typeLine(a, 'hello');
      await until(async () => rowsOf(a), (rows) => rows.some((row) => HELLO.test(row)), 8000);
      const id = host.ids()[0];
      const own = host.state(id)?.holder;
      const tabs = await tabsOf(a);
      const buttons = async () => a.getByRole('button', { name: /take it back/i }).count();
      const laneHeight = async () => a.evaluate(() => document.querySelector('[data-shell-part="terminalLane"]')?.getBoundingClientRect().height ?? 0);

      // The tab that took it, and then the tab that took it from the tab that took it: the first has nothing more to hold, the second does.
      const b = await w.open();
      const holderB = await until(() => host.state(id)?.holder, (holder) => holder !== null && holder !== own, 8000);
      const taken = await until(async () => laneOf(a), (text) => text.includes(FREE.taken), 8000);
      const heightTaken = await laneHeight();
      const buttonsTaken = await buttons();
      const c = await w.open();
      await until(() => host.state(id)?.holder, (holder) => holder !== null && holder !== holderB, 8000);
      // The first taker goes while the third tab holds the terminal; the page asks the host after both, and the host says that a stream holds it.
      const listedBefore = await listedBy(a);
      await b.goto('about:blank');
      await until(async () => listedBy(a), (count) => count > listedBefore, 20_000);
      await frames(a);
      const third = await laneOf(a);
      const buttonsThird = await buttons();
      // The tab that holds it now goes: nobody has it, its lease runs, and the page learns it by asking.
      await c.goto('about:blank');
      const free = await until(buttons, (count) => count >= 1, 20_000);
      const laneFree = await laneOf(a);
      const heightFree = await laneHeight();

      let element = { tag: null, focusVisible: false, ringed: false };
      let reached = 0;
      const trail = [];
      let viaF6 = false;
      let again = [];
      let moved = { tabs: null, lane: null, earlier: false, keyboard: false, typed: 0 };
      await a.addScriptTag({ path: AXE });
      const focusOf = async () =>
        a.evaluate(() => {
          const focused = document.activeElement;
          return { button: focused?.tagName === 'BUTTON' && /take it back/i.test(focused.textContent ?? ''), name: `${focused?.tagName ?? ''} ${(focused?.getAttribute('aria-label') ?? focused?.textContent ?? '').slice(0, 24)}`.trim() };
        });
      if (free >= 1) {
        element = await a.getByRole('button', { name: /take it back/i }).evaluate((button) => ({ tag: button.tagName, focusVisible: false, ringed: false }));
        // The keyboard: Tab from the session's own tab reaches the button, and its ring shows. WebKit on macOS leaves buttons out of the Tab order unless the system asks for it: Alt+Tab is its Tab (as in the kit's probes).
        await a.locator('[data-shell-part="sessionTabs"] [role="tab"][aria-selected="true"]').focus();
        for (let presses = 1; presses <= 14 && reached === 0; presses += 1) {
          await a.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
          const focused = await focusOf();
          trail.push(focused.name);
          if (focused.button) reached = presses;
        }

        if (reached === 0) {
          // Only for the words of the failure: the screen takes Tab for the shell, F6 leaves it, and Shift+Tab from the next part of the window goes back to the last control of the panel.
          await a.keyboard.press('F6');
          trail.push(`F6 ${(await focusOf()).name}`);
          await a.keyboard.press('Shift+Tab');
          const back = await focusOf();
          trail.push(`Shift+Tab ${back.name}`);
          viaF6 = back.button;
          // The rest is checked from the button, whatever the keys did.
          await a.getByRole('button', { name: /take it back/i }).focus();
          trail.push(
            JSON.stringify(
              await a.evaluate(() => {
                const button = document.querySelector('[data-shell-part="terminalTakeBack"]');
                const style = button === null ? null : getComputedStyle(button);
                const textarea = document.querySelector('.xterm-helper-textarea');
                return {
                  button: button === null ? null : { tabIndex: button.tabIndex, disabled: button.disabled, focused: document.activeElement === button, inert: button.closest('[inert]') !== null, visibility: style.visibility, display: style.display, rect: button.getBoundingClientRect().toJSON() },
                  textarea: textarea === null ? null : { tabIndex: textarea.tabIndex, readOnly: textarea.readOnly, disabled: textarea.disabled },
                  next: [...document.querySelectorAll('button, input, [tabindex], textarea, a[href]')].filter((element) => element.tabIndex >= 0).map((element) => element.tagName + ':' + (element.getAttribute('data-shell-part') ?? element.getAttribute('aria-label') ?? element.className.toString().slice(0, 12))).slice(0, 40),
                };
              }),
            ),
          );
        }

        if (reached > 0) {
          const ring = await a.evaluate(() => {
            const style = getComputedStyle(document.activeElement);
            return { focusVisible: document.activeElement.matches(':focus-visible'), outline: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0, shadow: style.boxShadow !== 'none' };
          });
          element = { ...element, focusVisible: ring.focusVisible, ringed: ring.focusVisible && (ring.outline || ring.shadow) };
        }
      }

      // axe finds nothing in the lane with its button (the control plants an image here).
      await perturbed(ctx, a, 'free');
      const axeFree = await runAxe(a, BODY);

      if (free >= 1) {
        // Enter presses it: one new stream that attaches with no offset, and the tab runs again where it was, with what it had shown and the keyboard in it.
        const mark = host.log.attaches.length;
        await perturbed(ctx, a, 'press');
        await a.keyboard.press('Enter');
        await until(() => host.log.attaches.length, (count) => count > mark, 8000);
        const rowsBack = await until(async () => rowsOf(a), (rows) => rows.some((row) => HELLO.test(row)), 4000);
        // The screen shows the earlier output, which the new stream's replay brought: whatever the press made has been made by now.
        const keyboard = await until(async () => a.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') === true), (is) => is, 4000);
        await a.keyboard.type('hello');
        await a.keyboard.press('Enter');
        const rowsTyped = await until(async () => rowsOf(a), (rows) => rows.filter((row) => HELLO.test(row)).length >= 2, 6000);
        // Counted after the keyboard and the typing: a second attach made during them is counted too.
        again = host.log.attaches.slice(mark).filter((entry) => entry.id === id || entry.id === null);
        moved = {
          tabs: await tabsOf(a),
          lane: await laneOf(a),
          earlier: rowsBack.some((row) => HELLO.test(row)),
          keyboard,
          typed: rowsTyped.filter((row) => HELLO.test(row)).length,
        };
      }

      const heightOk = Math.abs(heightFree - heightTaken) <= 0.5;
      check(
        'reattach.takeback',
        taken.includes(FREE.taken) &&
          FREE.old.test(taken) &&
          buttonsTaken === 0 &&
          FREE.old.test(third) &&
          buttonsThird === 0 &&
          free === 1 &&
          laneFree.includes(FREE.closed) &&
          laneFree.includes(FREE.lease) &&
          heightOk &&
          element.tag === 'BUTTON' &&
          reached > 0 &&
          element.ringed &&
          again.length === 1 &&
          again[0].from_offset === null &&
          again[0].id === id &&
          JSON.stringify(moved.tabs) === JSON.stringify(tabs) &&
          moved.lane === '' &&
          moved.earlier &&
          moved.keyboard &&
          moved.typed >= 2,
        `${engine} ${vp}: while the tab that took the terminal lives the lane says ${JSON.stringify(taken)} and has ${String(buttonsTaken)} buttons (none is right), after a third tab took it from that tab and the first taker went, and the page asked the host, ${JSON.stringify(third)} and ${String(buttonsThird)}; when the tab that holds it went it has ${String(free)} button (one is right) and the lane says ${JSON.stringify(laneFree)} (${JSON.stringify(FREE.closed)} and ${JSON.stringify(FREE.lease)} are right), ${String(heightFree)} px high where it was ${String(heightTaken)}; the button is a ${String(element.tag)} (BUTTON), Tab reaches it in ${String(reached)} presses (0 is never; the focus went ${JSON.stringify(trail)}; F6 then Shift+Tab reaches it: ${String(viaF6)}), its ring ${element.ringed ? 'shows' : 'does NOT show'} (focus-visible ${String(element.focusVisible)}); Enter made ${String(again.length)} attach(es) (one is right) with the offset ${JSON.stringify(again[0]?.from_offset ?? null)} (null: a new stream that has nothing), the tabs are ${JSON.stringify(moved.tabs) === JSON.stringify(tabs) ? 'the same' : 'DIFFERENT'}, the lane says ${JSON.stringify(moved.lane)} (nothing), the earlier output is ${moved.earlier ? 'back' : 'NOT back'}, the keyboard is ${moved.keyboard ? '' : 'NOT '}in the screen, and typed hello was answered ${String(moved.typed)} time(s) on screen (2 or more)`,
      );
      check('reattach.axe-free', axeFree.length === 0, `${engine} ${vp}: the tab that can be taken back, with its lane and its button: ${JSON.stringify(axeFree)}`);
      note(`reattach takeback ${engine} ${vp}: no button while the taker lived, a button ${String(reached)} Tab presses from the tab once the last taker went and the page asked, one attach with no offset, the lane ${String(heightFree)} px high where it was ${String(heightTaken)}`);
    } finally {
      await w.close();
    }
  };

  /**
   * A page with a terminal in the middle of a flood of numbered lines whose stream is lost (what the host sends meanwhile is lost to it) while the host's backlog has stopped the flood: the page has the output up to `applied`. The
   * emulator's parse callbacks are held while the flood runs, so that the page acknowledges nothing and the host's window and its backlog are what stop it, and are let go once the stream is cut. Answers the page, the terminal and `applied`.
   */
  async function flooded(w) {
    const { host } = w;
    const page = await w.open();
    await start(page);
    const id = host.ids()[0];
    await page.evaluate(() => {
      window.__gate.close();
    });
    await typeLine(page, `flood ${String(LINES)} 80`);
    await until(() => host.state(id)?.end ?? 0, (end) => end >= 400_000, 30_000);
    await until(() => host.state(id)?.paused === true, (paused) => paused, 15_000);
    const heard = await page.evaluate(() => window.__link.down());
    await page.evaluate(() => {
      window.__gate.open();
    });
    return { page, id, applied: heard[id] };
  }

  /** The flood has been written whole by the host and parsed whole by the page: nothing is waiting in the pty, the host reads again, and the emulator has every line. */
  async function finished(w, page, id) {
    const { host } = w;
    await moving(() => ({ end: host.state(id)?.end ?? 0, waiting: host.state(id)?.waiting ?? 1, paused: host.state(id)?.paused ?? true }), (state) => state.end >= TOTAL && state.waiting === 0 && !state.paused, { limit: 60_000 });
    await moving(
      async () => page.evaluate(() => ({ accepted: window.__engine.accepted, parsed: window.__engine.parsed, last: window.__engine.lines.last })),
      (state) => state.parsed === state.accepted && state.last === LINES - 1,
      { limit: 30_000 },
    );
  }

  /** The page has been given everything the host has of the terminal and has parsed it, with nothing held: the emulator's screen is what the host wrote. */
  async function caughtUp(w, page, id) {
    const { host } = w;
    const settled = (now) => now.delivered === now.end && now.parsed === now.accepted && now.held === 0;
    const last = await moving(
      async () => {
        const now = await page.evaluate((terminal) => ({ delivered: window.__link.state().delivered[terminal] ?? 0, accepted: window.__engine.accepted, parsed: window.__engine.parsed, held: window.__gate.held() }), id);
        return { ...now, end: host.state(id)?.end ?? 0 };
      },
      settled,
      { stall: 20_000, limit: 120_000 },
    );
    // A wait that ended by its stall or its limit is not a caught-up page: the section fails here, with the numbers, and not later on a state nobody confirmed.
    if (!settled(last)) throw new Error(`the page did not catch up: ${JSON.stringify(last)}`);
  }

  /**
   * The stream of a page is lost in the middle of a flood of numbered lines (`flooded`): the host runs the flood on into its ring with nobody to wait for (and, for `trim`, until its ring no longer reaches back to what the page has),
   * and the page's transport comes back; the page connects again by itself. Answers what the page did.
   */
  async function blip(w, { trim }) {
    const { host } = w;
    const { page, id, applied } = await flooded(w);
    let trimmed = null;
    if (trim) {
      await until(() => host.state(id)?.end ?? 0, (end) => end > applied + 300_000, 5000);
      trimmed = host.trimRing(id, applied);
    }

    const mark = host.log.attaches.length;
    await page.evaluate(() => {
      window.__link.up();
    });
    await until(() => host.log.attaches.length, (count) => count > mark, 8000);
    const attach = host.log.attaches[mark];
    await finished(w, page, id);
    const lines = await page.evaluate(() => window.__engine.lines);
    // The emulator's DOM renderer draws a frame after it parsed the last byte: the screen is read when it shows the last line of the flood (what is waited for is the draw, bounded; a page that never draws it ends the wait and fails the assertion).
    const lastLine = String(LINES - 1).padStart(7, '0');
    const screen = await until(async () => rowsOf(page), (rows) => rows.some((row) => row.startsWith(lastLine)), 8000);
    // What the shell writes now is live whatever the page did before, and what is typed reaches the shell through the new stream.
    host.append(id, TAIL);
    await typeLine(page, 'hello');
    await until(async () => rowsOf(page), (rows) => rows.some((row) => HELLO.test(row)), 8000);
    await caughtUp(w, page, id);
    const end = host.state(id).end;
    // The page acknowledges every byte of output the new stream sent, the replay included (the host counts it against its window), and never a gap: here the ring has what the page asked for, so no gap came.
    const expected = end - attach.start;
    const credited = () => host.log.acks.filter((entry) => entry.id === id && entry.attachesAt > mark).reduce((sum, entry) => sum + entry.bytes, 0);
    const acked = await until(credited, (sum) => sum >= expected, 5000);
    return {
      id,
      applied,
      trimmed,
      attach,
      attaches: host.log.attaches.slice(mark).filter((entry) => entry.id === id).length,
      end,
      expected,
      acked,
      lines,
      screen,
      typed: wroteBy(host, attach.writesAt),
    };
  }

  /** The stream is lost and the host still has what the page is missing: the page connects once more from the offset it has, and goes on. */
  sections['reattach-reconnect'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const r = await blip(w, { trim: false });
      const { attach, lines } = r;
      check(
        'reattach.reconnect',
        typeof r.applied === 'number' &&
          attach.outcome === 'ready' &&
          attach.from_offset === r.applied &&
          attach.start === r.applied &&
          attach.lost === 0 &&
          attach.bytes > 0 &&
          r.attaches === 1 &&
          lines.last === LINES - 1 &&
          lines.gaps.length === 0 &&
          lines.dups.length === 0 &&
          lines.resets === 0 &&
          r.acked === r.expected &&
          r.typed === 'hello\r',
        `${engine} ${vp}: the page had applied the output up to ${String(r.applied)} when its stream was lost and asked for it from ${String(attach.from_offset)} (the same), in ${String(r.attaches)} attach (one is right), and the host's answer started at ${String(attach.start)} (exactly there: it still had the bytes) with ${String(attach.lost)} lost (none) and ${String(attach.bytes)} B to catch up; the emulator was given ${String(lines.count)} numbered lines ending at ${String(lines.last)} (${String(LINES - 1)} is the last) with ${JSON.stringify(lines.gaps.slice(0, 3))} gaps, ${JSON.stringify(lines.dups.slice(0, 3))} duplicates and ${String(lines.resets)} resets (none of the three is right: the output goes on); the page acknowledged ${String(r.acked)} B on the new stream where it was sent ${String(r.expected)} B (equal is right: all of them, the replay included), and what was typed afterwards reached the shell as ${JSON.stringify(r.typed)} (${JSON.stringify('hello\r')})`,
      );
      note(`reattach reconnect ${engine} ${vp}: the stream was lost at ${String(r.applied)} B, the page asked for the output from there once (${String(attach.bytes)} B to catch up, no reset), ${String(lines.count)} lines in order to ${String(lines.last)}, ${String(r.acked)} B acknowledged`);
    } finally {
      await w.close();
    }
  };

  /** The stream is lost and the host's ring no longer reaches back: the screen is brought to the ring by a replay. */
  sections['reattach-reconnect-gap'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const r = await blip(w, { trim: true });
      const { attach, lines } = r;
      const last = String(LINES - 1).padStart(7, '0');
      check(
        'reattach.reconnect-gap',
        typeof r.applied === 'number' &&
          r.trimmed > r.applied &&
          attach.from_offset === r.applied &&
          attach.start === r.trimmed &&
          attach.lost === r.trimmed - r.applied &&
          r.attaches === 1 &&
          lines.resets === 1 &&
          attach.firstLine !== null &&
          lines.first === attach.firstLine &&
          lines.gaps.length === 0 &&
          lines.dups.length === 0 &&
          lines.last === LINES - 1 &&
          r.screen.some((row) => row.startsWith(last)),
        `${engine} ${vp}: the page had applied the output up to ${String(r.applied)} and asked for it from ${String(attach.from_offset)}, and the host's ring started at ${String(r.trimmed)} (past it) and said its replay starts at ${String(attach.start)} with ${String(attach.lost)} lost (the ring's start and ${String(r.trimmed - r.applied)} are right: the gap is stated); the screen was reset ${String(lines.resets)} time(s) (once is right) and its first numbered line was ${String(lines.first)} where the replay's first whole line is ${String(attach.firstLine)}; from there ${String(lines.count)} lines ended at ${String(lines.last)} (${String(LINES - 1)}) with ${JSON.stringify(lines.gaps.slice(0, 3))} gaps and ${JSON.stringify(lines.dups.slice(0, 3))} duplicates (none is right), ${String(r.attaches)} attach (one), and the screen shows the last line ${last}: ${String(r.screen.some((row) => row.startsWith(last)))}`,
      );
      note(`reattach reconnect-gap ${engine} ${vp}: the ring started at ${String(r.trimmed)} past the ${String(r.applied)} B the page had (${String(attach.lost)} lost), the screen was reset once and brought to the ring (first line ${String(lines.first)}), ${String(lines.last)} the last`);
    } finally {
      await w.close();
    }
  };

  /**
   * The terminal vanished while the page was away. The host answers a stream that shows the capability of a terminal it does not have with its one `not-found`, and the page says that the terminal is not there any more and does not
   * connect again. (A host that closed the stream with no word, as a transient failure does, would be connected to again three times, after 250 ms, 1 s and 4 s, and then given up in the words of a lost connection: the control.)
   */
  sections['reattach-gone'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      await typeLine(page, 'hello');
      await until(async () => rowsOf(page), (rows) => rows.some((row) => HELLO.test(row)), 8000);
      const id = host.ids()[0];
      const mark = host.log.attaches.length;
      // The terminal is gone with no word and the stream that held it ends: the page connects again by itself.
      host.vanish(id);
      const words = await until(
        async () => `${await laneOf(page)} ${await bodyOf(page)}`,
        (text) => FREE.gone.test(text) || FREE.lost.test(text),
        20_000,
      );
      // A definitive refusal leaves no retry: the feed's first retry would come after 250 ms and its second after a second more, so the attaches are counted after both could have run.
      await sleep(1500);
      const attaches = host.log.attaches.slice(mark);
      check(
        'reattach.gone',
        attaches.length === 1 && attaches[0].outcome === 'not-found' && FREE.gone.test(words),
        `${engine} ${vp}: the terminal vanished while the page was away; the page made ${String(attaches.length)} attach(es) (one is right: it is not there any more, and that is the end), answered ${JSON.stringify(attaches.map((entry) => entry.outcome))} (not-found) and the tab says ${JSON.stringify(words.slice(0, 200))} (it says the terminal is not there any more)`,
      );
      note(`reattach gone ${engine} ${vp}: one attach, answered not-found, and the tab says ${JSON.stringify(words.slice(0, 80))}`);
    } finally {
      await w.close();
    }
  };

  /**
   * A key is typed while a late replay is being written. The host's ring no longer reaches back to what the page has (the shell wrote more than the ring keeps while the stream was lost), so the page is brought to the ring by a replay that
   * holds a program's questions to the terminal, and the fixture holds the end of the emulator's writes: the replay takes as many frames as the probe lets pass. The key is queued and reaches the shell once, in order, after the replay;
   * what the emulator answers to the questions reaches it never.
   */
  sections['reattach-reconnect-keys'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      await typeLine(page, 'hello');
      await until(async () => rowsOf(page), (rows) => rows.some((row) => HELLO.test(row)), 8000);
      const id = host.ids()[0];
      await caughtUp(w, page, id);
      // The stream is lost; the shell writes more than the ring needs to keep, and the ring forgets what the page has; a program's questions are in what is left.
      const heard = await page.evaluate(() => window.__link.down());
      const applied = heard[id];
      host.append(id, FILLER);
      const trimmed = host.trimRing(id, applied);
      host.plant(id, QUERIES);
      const resets = await page.evaluate(() => window.__engine.lines.resets);
      const mark = host.log.attaches.length;
      await page.evaluate(() => {
        window.__gate.close();
        window.__link.up();
      });
      await until(() => host.log.attaches.length, (count) => count > mark, 8000);
      const attach = host.log.attaches.length > mark ? host.log.attaches[mark] : undefined;
      // The replay is being written: the emulator was reset for it (the screen's own first write of a replay), it has been given that write, and the screen has not been told that it parsed it.
      const begun = await until(async () => page.evaluate(() => ({ resets: window.__engine.lines.resets, held: window.__gate.held() })), (now) => now.resets > resets && now.held >= 1, 8000);
      const held = begun.held;
      const before = await page.evaluate(() => ({ keys: window.__gate.keys(), writes: window.__link.state().writes }));
      await typeLine(page, 'ab');
      const keys = await until(async () => page.evaluate(() => window.__gate.keys()), (count) => count >= before.keys + 3, 4000);
      await frames(page);
      const meanwhile = await page.evaluate(() => ({ writes: window.__link.state().writes, held: window.__gate.held() }));
      await page.evaluate(() => {
        window.__gate.open();
      });
      if (attach !== undefined) await until(() => wroteBy(host, attach.writesAt), (text) => text.length >= 3, 6000);
      await caughtUp(w, page, id);
      const shell = attach === undefined ? '' : wroteBy(host, attach.writesAt);
      const replies = await page.evaluate(() => window.__gate.replies());
      check(
        'reattach.reconnect-keys',
        attach !== undefined &&
          trimmed > applied &&
          attach.start === trimmed &&
          attach.lost > 0 &&
          begun.resets > resets &&
          held >= 1 &&
          keys >= before.keys + 3 &&
          meanwhile.held >= 1 &&
          meanwhile.writes === before.writes &&
          shell === 'ab\r' &&
          replies >= 1,
        `${engine} ${vp}: the host's ring started at ${String(trimmed)} past the ${String(applied)} B the page had, so the page was brought to it by a replay that starts at ${String(attach?.start)} (${String(attach?.lost)} lost) and holds ${JSON.stringify(QUERIES)}; with the end of the emulator's writes held (${String(held)} held, ${String(meanwhile.held)} still when the keys were typed) 'ab' and Enter were typed: ${String(keys - before.keys)} keys reached the emulator (3 is right) and the page made ${String(meanwhile.writes - before.writes)} calls to the shell while the replay was being written (none is right: the keys wait for it); once it was written the shell was sent ${JSON.stringify(shell)} (${JSON.stringify('ab\r')} is right: once, in order, none lost, and none of what the emulator answered to the questions), and the emulator answered ${String(replies)} time(s) (at least once is right: the questions were asked)`,
      );
      note(`reattach reconnect-keys ${engine} ${vp}: the replay was held while 'ab' and Enter were typed, and the shell was sent ${JSON.stringify(shell)} once it was written; the emulator answered ${String(replies)} time(s) and none of it reached the shell`);
    } finally {
      await w.close();
    }
  };

  /**
   * Acknowledgements are in flight on the stream of a page when the stream is lost: the connection that carried them is gone and the host never gets them in time. The page connects again from the offset it has, and the
   * acknowledgements of the old stream reach the host late, after the new stream has taken the terminal (a half-open connection): they count for nothing, and what is credited after the new attach is the bytes the new stream sent
   * and nothing else (the page does not credit the new stream for what the old one delivered, either).
   */
  sections['reattach-reconnect-acks'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const id = host.ids()[0];
      // The page's acknowledgements are held from here: they are in flight with no word, so the host's credit runs out.
      await page.evaluate(() => {
        window.__acks.hold();
      });
      await typeLine(page, `flood ${String(LINES)} 80`);
      const inFlight = await until(async () => page.evaluate(() => window.__acks.held()), (count) => count >= 1, 15_000);
      await until(() => host.state(id)?.paused === true, (paused) => paused, 15_000);
      // Every byte the host delivered is in the emulator: what is given to it from here is what the host sends after the new attach.
      const baseline = await until(
        async () => page.evaluate((terminal) => ({ accepted: window.__engine.accepted, delivered: window.__link.state().delivered[terminal] ?? 0 }), id),
        (now) => now.delivered > 0 && now.accepted >= now.delivered,
        15_000,
      );
      // The stream is lost with its acknowledgements in flight, and the page connects again by itself from the offset it has.
      const heard = await page.evaluate(() => window.__link.down());
      const applied = heard[id];
      const mark = host.log.attaches.length;
      await page.evaluate(() => {
        window.__link.up();
      });
      await until(() => host.log.attaches.length, (count) => count > mark, 8000);
      const attach = host.log.attaches.length > mark ? host.log.attaches[mark] : undefined;
      // The page has the answer when it has been given bytes that the host sent after it.
      const taken = await until(async () => page.evaluate(() => window.__engine.accepted), (bytes) => bytes > baseline.accepted + 100_000, 15_000);
      // The late acknowledgements of the old stream reach the host now, with those the new stream has held meanwhile, which are its own and are let go.
      await page.evaluate(() => {
        window.__acks.accept();
        window.__acks.release();
      });
      await finished(w, page, id);
      const end = host.state(id).end;
      const credited = () => host.log.acks.filter((entry) => entry.id === id && entry.attachesAt > mark).reduce((sum, entry) => sum + entry.bytes, 0);
      const expected = attach === undefined ? 0 : end - attach.start;
      const acked = attach === undefined ? 0 : await until(credited, (sum) => sum >= expected, 5000);
      check(
        'reattach.reconnect-acks',
        inFlight >= 1 && attach !== undefined && attach.from_offset === applied && attach.lost === 0 && taken > baseline.accepted + 100_000 && acked === expected,
        `${engine} ${vp}: ${String(inFlight)} acknowledgement(s) were in flight when the stream was lost (one or more is right) and the page connected again from ${String(attach?.from_offset)} (the ${String(applied)} B it had); the page was given ${String(taken - baseline.accepted)} B by the new stream; the old stream's acknowledgements reached the host after the new attach, and the host was credited ${String(acked)} B where the new stream sent ${String(expected)} B (equal is right: what the old stream had acknowledged is credited to nobody)`,
      );
      note(`reattach reconnect-acks ${engine} ${vp}: ${String(inFlight)} acknowledgement(s) were in flight when the stream was lost and reached the host late; ${String(acked)} B credited after the new attach, the ${String(expected)} B the new stream sent`);
    } finally {
      await w.close();
    }
  };

  /**
   * A tab that lost its terminal presses Take it back on a flag that is stale: the tab that took it has gone, so the button came, and a third tab has taken the terminal since, with no word to this one (the host says nothing when a tab
   * attaches a terminal that nobody holds, and the page has not asked since: its questions fail until the press). The page asks the host who holds it and attaches nothing: the button goes, the lane says that the terminal is
   * taken over, and the third tab goes on.
   */
  sections['reattach-takeback-guard'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const a = await w.open();
      await start(a);
      await typeLine(a, 'hello');
      await until(async () => rowsOf(a), (rows) => rows.some((row) => HELLO.test(row)), 8000);
      const id = host.ids()[0];
      const own = host.state(id)?.holder;
      const buttons = async () => a.getByRole('button', { name: /take it back/i }).count();
      // The tab that took the terminal goes: the page asks, and has the button.
      const b = await w.open();
      const holderB = await until(() => host.state(id)?.holder, (holder) => holder !== null && holder !== own, 8000);
      await until(async () => laneOf(a), (text) => text.includes(FREE.taken), 8000);
      await b.goto('about:blank');
      await until(buttons, (count) => count >= 1, 20_000);
      // From here the page cannot ask the host: a third tab takes the terminal that nobody holds, and the host tells nobody: the button is still there, and is not true.
      await a.evaluate(() => {
        window.__link.failLists(true);
      });
      const c = await w.open();
      const holderC = await until(() => host.state(id)?.holder, (holder) => holder !== null && holder !== holderB, 8000);
      await reveal(c);
      await c.waitForSelector('.xterm-helper-textarea', { timeout: 8000 });
      const stale = await buttons();
      const listsBefore = host.log.lists.length;
      const attachesBefore = host.log.attaches.length;
      const writesBefore = host.log.writes.length;
      // The host can be asked again in the very task of the press, so that no question of the page's own comes between the two.
      // What the press itself asks of the host is counted in that same task (a call of the list STARTED by it): the page's own poll every 5 s cannot stand in for it.
      const pressAsked = await a.evaluate(() => {
        window.__link.failLists(false);
        const started = window.__link.state().started;
        document.querySelector('[data-shell-part="terminalTakeBack"]')?.click();
        return window.__link.state().started - started;
      });
      // The page asks the host who holds the terminal, and the button goes.
      await until(() => host.log.lists.length, (count) => count > listsBefore, 8000);
      const left = await until(buttons, (count) => count === 0, 8000);
      await frames(a);
      const lane = await laneOf(a);
      const asks = host.log.lists.length - listsBefore;
      const attaches = host.log.attaches.length - attachesBefore;
      const holder = host.state(id)?.holder;
      // The tab that holds it goes on: what it types reaches the shell.
      await typeLine(c, 'hello');
      const rows = await until(async () => rowsOf(c), (shown) => shown.some((row) => HELLO.test(row)), 8000);
      const typed = wroteBy(host, writesBefore);
      const laneC = await laneOf(c);
      check(
        'reattach.takeback-guard',
        stale === 1 &&
          asks >= 1 &&
          pressAsked >= 1 &&
          attaches === 0 &&
          left === 0 &&
          lane.includes(FREE.taken) &&
          FREE.old.test(lane) &&
          !lane.includes(FREE.closed) &&
          holder === holderC &&
          typed.includes('hello') &&
          rows.some((row) => HELLO.test(row)) &&
          laneC === '',
        `${engine} ${vp}: the button was still there when the tab that holds the terminal now had taken it with no word to this tab (${String(stale)} button: one is right); once pressed the page asked the host ${String(asks)} time(s) (once or more is right) and made ${String(attaches)} attach(es) (none is right: it is not its to take), the button ${left === 0 ? 'went' : 'is still there'}, the lane says ${JSON.stringify(lane)} (the terminal is taken over again: ${JSON.stringify(FREE.taken)}), the host's holder is stream ${String(holder)} (${String(holderC)}, the third tab's), the third tab typed ${JSON.stringify(typed)} and its screen ${rows.some((row) => HELLO.test(row)) ? 'shows' : 'does NOT show'} the answer, with its lane ${JSON.stringify(laneC)} (empty)`,
      );
      note(`reattach takeback-guard ${engine} ${vp}: the press asked the host ${String(asks)} time(s), attached ${String(attaches)} time(s), the button went and the third tab went on`);
    } finally {
      await w.close();
    }
  };

  /**
   * A tab that could not reach the host when the tab that took its terminal let it go. It was told nothing and shows what it showed (its questions fail, and the transport of its streams is down); once the host can be asked again
   * the page asks, the host says that nobody holds the terminal, and the tab shows the button. It attaches nothing: only a press takes the terminal back.
   */
  sections['reattach-takeback-offline'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const a = await w.open();
      await start(a);
      await typeLine(a, 'hello');
      await until(async () => rowsOf(a), (rows) => rows.some((row) => HELLO.test(row)), 8000);
      const id = host.ids()[0];
      const own = host.state(id)?.holder;
      const buttons = async () => a.getByRole('button', { name: /take it back/i }).count();
      const b = await w.open();
      await until(() => host.state(id)?.holder, (holder) => holder !== null && holder !== own, 8000);
      await until(async () => laneOf(a), (text) => text.includes(FREE.taken), 8000);
      const attachesBefore = host.log.attaches.length;

      // 1. The page cannot reach the host, and the tab that took the terminal goes meanwhile: the page is told nothing and shows what it showed, though it asked.
      await a.evaluate(() => {
        window.__link.down();
        window.__link.failLists(true);
      });
      await b.goto('about:blank');
      await until(() => host.state(id)?.holder, (holder) => holder === null, 8000);
      const triedDown = await asked(a);
      const laneDown = await laneOf(a);
      const buttonsDown = await buttons();

      // 2. The host can be reached again: the page asks, and the host says that nobody holds the terminal.
      const listed1 = await listedBy(a);
      // The list stays blocked while the stage's fault is planted (`refresh-skipped`), from the first instant of the reconnection until the button state has been read.
      const blocked = ctx.control?.stage === 'offline';
      await a.evaluate((keep) => {
        window.__link.up();
        if (!keep) window.__link.failLists(false);
      }, blocked);
      await perturbed(ctx, a, 'offline');
      const freed = await until(buttons, (count) => count >= 1, 20_000);
      const laneFreed = await laneOf(a);
      const asks = (await listedBy(a)) - listed1;
      const attaches = host.log.attaches.length - attachesBefore;
      check(
        'reattach.takeback-offline',
        triedDown >= 1 &&
          buttonsDown === 0 &&
          laneDown.includes(FREE.taken) &&
          FREE.old.test(laneDown) &&
          freed === 1 &&
          laneFreed.includes(FREE.closed) &&
          laneFreed.includes(FREE.lease) &&
          asks >= 1 &&
          attaches === 0,
        `${engine} ${vp}: with the host out of reach while the tab that took the terminal went the page tried to ask ${String(triedDown)} time(s) and the lane says ${JSON.stringify(laneDown)} with ${String(buttonsDown)} buttons (the old words and none is right: it was told nothing); once the host could be reached it asked ${String(asks)} time(s) (once or more) and has ${String(freed)} button (one is right) and the lane says ${JSON.stringify(laneFreed)} (${JSON.stringify(FREE.closed)} and ${JSON.stringify(FREE.lease)} are right); it made ${String(attaches)} attach(es) (none: only a press takes the terminal back)`,
      );
      note(`reattach takeback-offline ${engine} ${vp}: no button while the host could not be reached when the taker went, one once it could and the page had asked (${String(asks)} call(s)), no attach`);
    } finally {
      await w.close();
    }
  };

  return sections;
}

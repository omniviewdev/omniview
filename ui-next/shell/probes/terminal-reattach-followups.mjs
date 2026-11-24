// The follow-ups of the reattach probe (T2d): what the panel does with its saved open flag after a reload, taking back a terminal whose taker has gone, and what the page does when its events come back after a gap (the rejoin by offset,
// the rejoin when the host's ring no longer reaches back, the terminal that is not there any more). The sections run in a real xterm against the probe's own T2-go host (terminal-host.mjs, terminal-reattach.mjs says how), in both engines
// at both viewports. This file knows nothing of the probe's own internals: terminal-reattach.mjs hands it `check`, `note`, `runAxe` and the helpers of its sections, and adds its sections, its parts and its negative controls to its own.
//
// Each assertion has its own controls, each ONE fault, which trip only it:
//   restore-open        a saved OPEN panel comes back open with its saved tool, its saved active session and its height; a saved CLOSED panel stays closed and, when it is opened, is on the tool and at the height it was left at, before another tool is chosen (restore.open)
//   reattach-takeback   a tab that lost its terminal to another tab and whose taker then went (the host says a LATER attachment `requested` or `window-retired`) says so, has a real button that takes it back (Tab reaches it, Enter presses it, a
//                       visible ring), makes ONE attach, runs again in the same place with its earlier output and the keyboard in it, with the lane no higher than before; while the taker lives, also when a third tab took it from the taker, there is
//                       no button and the old sentence (reattach.takeback); axe finds nothing in the lane with the button (reattach.axe-free)
//   reattach-rejoin     the page's events come back after a gap: it asks for the output it has by offset, once, and the numbered lines are in order with no gap and no duplicate across the blip, only live bytes are acknowledged, and the input
//                       numbers go on from the number of the new answer (reattach.rejoin)
//   reattach-rejoin-gap the host's ring no longer reaches back to what the page has: the screen is reset and brought to the ring by a replay, and the lines are in order from the first of the replay to the end (reattach.rejoin-gap)
//   reattach-gone       the terminal vanished while the page was away: the tab says it is not there any more, and the page does not attach again however often the events come back (reattach.gone)
//   reattach-rejoin-keys  a key typed while a late replay is being written (the fixture holds the end of the emulator's writes, so that the replay takes as many frames as the probe lets pass) is queued and reaches the shell once, in
//                       order, after the replay, none lost; what the emulator answers to a query in the replayed bytes reaches the shell never (reattach.rejoin-keys)
//   reattach-rejoin-acks  an acknowledgement that is in flight when the answer of the rejoin comes is refused after it, and what the page credits after the attach is the live bytes taken after it and nothing else (reattach.rejoin-acks)
//   reattach-takeback-guard  a tab whose free flag is stale (a third tab holds the terminal and the host said nothing to it) presses Take it back: it asks the host who holds the terminal and attaches nothing, the button goes, the lane
//                       says the terminal is taken over again and the third tab goes on typing (reattach.takeback-guard)
//   reattach-takeback-offline  a tab whose events were down when the tab that took the terminal let it go shows the button once the events are back (it asks the host), and does not while the tab that took it still holds it (reattach.takeback-offline)

/** The lines of the flood of the blips, and the bytes they are: a flood that is still running when the events stop reaching the page, and when the host runs out of credit. */
const LINES = 60_000;
const TOTAL = LINES * 82;
const IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** What a program asks the terminal in the bytes the host kept: where the cursor is, and what the terminal is. The emulator answers both, and an answer to bytes of a replay is nobody's to send. */
const QUERIES = '\u001b[6n\u001b[c';

/** The words of the lane of a tab that lost its terminal: while the tab that took it lives, once it has gone, and for a terminal that is not there any more. */
const FREE = Object.freeze({
  old: /keeps running in the tab that took it/,
  closed: 'The tab that took this terminal has closed',
  lease: 'The shell keeps running until its lease ends',
  gone: /not there any more/i,
  taken: 'Taken over by another tab',
});

export const FOLLOWUP_PARTS = {
  'reattach-d': ['restore-open'],
  'reattach-e': ['reattach-takeback', 'reattach-takeback-guard', 'reattach-takeback-offline'],
  'reattach-f': ['reattach-rejoin', 'reattach-rejoin-gap', 'reattach-gone', 'reattach-rejoin-keys', 'reattach-rejoin-acks'],
};

/** The negative controls of the follow-ups, in the shape of the probe's own table (see terminal-reattach.mjs). A `query` is a control of the fixture page, a `host` one of the far end, a `stage` and an `after` one of the page the probe plants. */
export const FOLLOWUP_CONTROLS = {
  // The saved panel comes back with the flag the other way: a restore that forgot that the panel was open, and one that forgot that it was closed.
  'restore-forgets-open': { assertion: 'restore.open', section: 'restore-open', engines: ['chromium'], query: 'control=restore-forgets-open' },
  'restore-forgets-closed': { assertion: 'restore.open', section: 'restore-open', engines: ['chromium'], query: 'control=restore-forgets-closed' },
  // The host does not say that the tab that took the terminal has gone, so that no button appears; the button, once pressed, attaches twice.
  'taker-gone-ignored': { assertion: 'reattach.takeback', section: 'reattach-takeback', engines: ['chromium'], host: { faults: { takerSilent: true } } },
  'take-back-twice': { assertion: 'reattach.takeback', section: 'reattach-takeback', engines: ['chromium'], stage: 'press', after: (page) => page.evaluate(() => { window.__link.arm(true); }) },
  // A violation that exists only in the lane of a tab that can be taken back: an image with no text alternative, planted once the lane with its button is drawn (the pattern of `axe-failed`).
  'free-axe': { assertion: 'reattach.axe-free', section: 'reattach-takeback', engines: ['chromium'], stage: 'free', after: (page) => page.evaluate((src) => { const image = document.createElement('img'); image.src = src; document.querySelector('[data-shell-part="terminalLane"]').append(image); }, IMAGE) },
  // A rejoin that starts over from the first byte, one that is given nothing of what was missed, and one that acknowledges the replay.
  'rejoin-from-zero': { assertion: 'reattach.rejoin', section: 'reattach-rejoin', engines: ['chromium'], query: 'control=rejoin-from-zero' },
  'rejoin-drops-missed': { assertion: 'reattach.rejoin', section: 'reattach-rejoin', engines: ['chromium'], host: { faults: { missedDropped: true } } },
  'rejoin-acks-replay': { assertion: 'reattach.rejoin', section: 'reattach-rejoin', engines: ['chromium'], query: 'control=ack-replay' },
  // The host's ring no longer reaches back, and the host says that its replay starts where the page is.
  'gap-hidden': { assertion: 'reattach.rejoin-gap', section: 'reattach-rejoin-gap', engines: ['chromium'], host: { faults: { gapHidden: true } } },
  // A terminal that is gone is answered with a plain server error, which the page may try again at every signal.
  'gone-keeps-attaching': { assertion: 'reattach.gone', section: 'reattach-gone', engines: ['chromium'], host: { faults: { goneTransient: true } } },
  // A screen that drops what is typed while it writes a replay, and an engine that gives what the emulator answers to a query as keys.
  'keys-dropped': { assertion: 'reattach.rejoin-keys', section: 'reattach-rejoin-keys', engines: ['chromium'], query: 'control=keys-dropped' },
  'replies-as-keys': { assertion: 'reattach.rejoin-keys', section: 'reattach-rejoin-keys', engines: ['chromium'], query: 'control=replies-as-keys' },
  // The acknowledgement that was in flight when the attach was answered is taken by the host after it: the stale count is credited after the attach, as a page that restored it would credit it.
  'ack-stale-restore': { assertion: 'reattach.rejoin-acks', section: 'reattach-rejoin-acks', engines: ['chromium'], stage: 'ack-release', after: (page) => page.evaluate(() => { window.__acks.accept(); }) },
  // The host's list never says that a page holds a terminal, so that a page that presses Take it back on a stale flag is told that nobody holds the terminal, and attaches (as a button that does not ask would).
  'takeback-unguarded': { assertion: 'reattach.takeback-guard', section: 'reattach-takeback-guard', engines: ['chromium'], host: { faults: { attachedHidden: true } } },
  // The host's list fails from the moment the events come back, so that a page that missed the word that the tab that took the terminal had gone cannot learn it (as a page that never asks when its events come back).
  'refresh-skipped': { assertion: 'reattach.takeback-offline', section: 'reattach-takeback-offline', engines: ['chromium'], stage: 'offline', after: (page) => page.evaluate(() => { window.__link.failLists(true); }) },
};

/**
 * @param {{ check: Function, note: Function, runAxe: Function, helpers: Record<string, any> }} deps
 *   `helpers` are the helpers of terminal-reattach.mjs: `world`, `start`, `reveal`, `until`, `moving`, `sleep`, `perturbed`, `tabsOf`, `laneOf`, `bodyOf`, `rowsOf`, `typeLine`, `windowsOf`, `slotOf`, `wroteBy` and `AXE`.
 */
export function createFollowupSections({ check, note, runAxe, helpers }) {
  const { world, start, reveal, until, moving, sleep, perturbed, tabsOf, laneOf, bodyOf, rowsOf, typeLine, windowsOf, slotOf, wroteBy, AXE } = helpers;
  const sections = {};

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

  /** The tab that took the terminal has gone: the tab that lost it can take it back. While the taker lives there is no button. */
  sections['reattach-takeback'] = async (ctx) => {
    const { engine, vp } = ctx;
    const BODY = '[data-shell-part="terminalBody"]';
    const w = await world(ctx);
    try {
      const { host } = w;
      const a = await w.open();
      await start(a);
      await typeLine(a, 'hello');
      await sleep(500);
      const id = host.ids()[0];
      const owner = windowsOf(host)[0];
      const tabs = await tabsOf(a);
      const buttons = async () => a.getByRole('button', { name: /take it back/i }).count();
      const laneHeight = async () => a.evaluate(() => document.querySelector('[data-shell-part="terminalLane"]')?.getBoundingClientRect().height ?? 0);

      // The tab that took it, and then the tab that took it from the tab that took it: the first lives on while the second does.
      const b = await w.open();
      await until(() => host.state(id)?.holder, (holder) => holder === 1, 8000);
      const taken = await until(async () => laneOf(a), (text) => text.includes('Taken over by another tab'), 8000);
      const heightTaken = await laneHeight();
      const buttonsTaken = await buttons();
      const c = await w.open();
      await until(() => host.state(id)?.holder, (holder) => holder === 2, 8000);
      await sleep(700);
      const third = await laneOf(a);
      const buttonsThird = await buttons();
      await b.goto('about:blank');
      await sleep(900);
      const buttonsAfterFirst = await buttons();
      // The tab that holds it now goes: nobody has it, and its lease runs.
      await c.goto('about:blank');
      const free = await until(buttons, (count) => count >= 1, 4000);
      const laneFree = await laneOf(a);
      const heightFree = await laneHeight();

      let element = { tag: null, focusVisible: false, ringed: false };
      let reached = 0;
      const trail = [];
      let viaF6 = false;
      let again = 0;
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
        // Enter presses it: one attach, and the tab runs again where it was, with what it had shown and the keyboard in it.
        await perturbed(ctx, a, 'press');
        await a.keyboard.press('Enter');
        await until(() => host.log.attaches.filter((entry) => entry.window === owner).length, (count) => count >= 1, 6000);
        await sleep(900);
        again = host.log.attaches.filter((entry) => entry.window === owner).length;
        const rowsBack = await until(async () => rowsOf(a), (rows) => rows.some((row) => /hello from the synthetic shell/.test(row)), 4000);
        const keyboard = await until(async () => a.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') === true), (is) => is, 4000);
        await a.keyboard.type('hello');
        await a.keyboard.press('Enter');
        await sleep(600);
        const rowsTyped = await rowsOf(a);
        moved = {
          tabs: await tabsOf(a),
          lane: await laneOf(a),
          earlier: rowsBack.some((row) => /hello from the synthetic shell/.test(row)),
          keyboard,
          typed: rowsTyped.filter((row) => /hello from the synthetic shell/.test(row)).length,
        };
      }

      const heightOk = Math.abs(heightFree - heightTaken) <= 0.5;
      check(
        'reattach.takeback',
        taken.includes('Taken over by another tab') &&
          FREE.old.test(taken) &&
          buttonsTaken === 0 &&
          FREE.old.test(third) &&
          buttonsThird === 0 &&
          buttonsAfterFirst === 0 &&
          free === 1 &&
          laneFree.includes(FREE.closed) &&
          laneFree.includes(FREE.lease) &&
          heightOk &&
          element.tag === 'BUTTON' &&
          reached > 0 &&
          element.ringed &&
          again === 1 &&
          JSON.stringify(moved.tabs) === JSON.stringify(tabs) &&
          moved.lane === '' &&
          moved.earlier &&
          moved.keyboard &&
          moved.typed >= 2,
        `${engine} ${vp}: while the tab that took the terminal lives the lane says ${JSON.stringify(taken)} and has ${String(buttonsTaken)} buttons (none is right), after a third tab took it from that tab ${JSON.stringify(third)} and ${String(buttonsThird)}, after the first taker went ${String(buttonsAfterFirst)}; when the tab that holds it went it has ${String(free)} button (one is right) and the lane says ${JSON.stringify(laneFree)} (${JSON.stringify(FREE.closed)} and ${JSON.stringify(FREE.lease)} are right), ${String(heightFree)} px high where it was ${String(heightTaken)}; the button is a ${String(element.tag)} (BUTTON), Tab reaches it in ${String(reached)} presses (0 is never; the focus went ${JSON.stringify(trail)}; F6 then Shift+Tab reaches it: ${String(viaF6)}), its ring is ${element.ringed ? 'visible' : 'NOT visible'}; Enter made ${String(again)} attach (one is right), the tab is ${JSON.stringify(moved.tabs)} where it was ${JSON.stringify(tabs)}, its lane says ${JSON.stringify(moved.lane)} (nothing is right: it runs), it shows its earlier output: ${String(moved.earlier)}, the keyboard is in the terminal: ${String(moved.keyboard)}, and ${String(moved.typed)} lines answer what was typed (2 or more)`,
      );
      check('reattach.axe-free', axeFree.length === 0, `${engine} ${vp}: the tab that can be taken back, with its lane and its button: ${JSON.stringify(axeFree)}`);
      note(`reattach takeback ${engine} ${vp}: no button while the taker lived, a button ${String(reached)} Tab presses from the tab once the last taker went, one attach, the lane ${String(heightFree)} px high where it was ${String(heightTaken)}`);
    } finally {
      await w.close();
    }
  };

  /**
   * A page with a terminal in the middle of a flood of numbered lines, whose events have stopped reaching it (what the host tells meanwhile is lost to it for good) and whose host has used up its credit and stopped reading: the page has
   * the output up to `applied`. Answers the page, the terminal, the page's window, `applied`, which calls are the page's numbered ones and the last number it gave its input.
   */
  async function flooded(w) {
    const { host } = w;
    const page = await w.open();
    await start(page);
    const id = host.ids()[0];
    const me = windowsOf(host)[0];
    await typeLine(page, `flood ${String(LINES)} 80`);
    await until(() => host.state(id)?.end ?? 0, (end) => end >= 400_000, 30_000);
    const heard = await page.evaluate(() => window.__link.down());
    const applied = heard[id];
    const numbered = (entry) => entry.window === me && (entry.method === 'WriteTerminal' || entry.method === 'ResizeTerminal');
    const lastNumber = Math.max(0, ...host.log.calls.filter(numbered).map((entry) => entry.seq));
    await until(() => host.state(id)?.paused === true, (paused) => paused, 15_000);
    return { page, id, me, applied, numbered, lastNumber };
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

  /**
   * A blip of the page's events in the middle of a flood of numbered lines: the events stop reaching the page, the host runs on until its credit is used up (and, for `trim`, until its ring no longer reaches back to what the page
   * has), another tab types (the number the input queue takes next is not the one the page has counted), and the events come back. Answers what the page did.
   */
  async function blip(w, { trim }) {
    const { host } = w;
    const { page, id, me, applied, numbered, lastNumber } = await flooded(w);
    const trimmed = trim ? host.trimRing(id, applied) : null;
    host.strayWrite(id);
    const mark = host.log.attaches.length;
    await page.evaluate(() => {
      window.__link.up();
    });
    await until(() => host.log.attaches.length, (count) => count > mark, 8000);
    const attach = host.log.attaches.at(-1);
    const attaches = host.log.attaches.slice(mark).filter((entry) => entry.window === me && entry.id === id).length;
    await finished(w, page, id);
    const end = host.state(id).end;
    // The attach makes the host forget what it was owed: what the page credits from then on is for what the host sent after the replay, and nothing else.
    const credited = (later) => host.log.acks.filter((entry) => entry.window === me && entry.id === id && (entry.attachesAt > mark) === later).reduce((sum, entry) => sum + entry.bytes, 0);
    const acked = await until(() => credited(true), (sum) => sum === end - attach.end, 5000);
    const ackedBefore = credited(false);
    const lines = await page.evaluate(() => window.__engine.lines);
    // What is typed after the blip is numbered from the number of the new answer, and its echo on the screen says that the host applied it.
    await typeLine(page, 'hello');
    const rows = await until(async () => rowsOf(page), (shown) => shown.some((row) => /hello from the synthetic shell/.test(row)), 8000);
    const calls = host.log.calls.slice(attach.callsAt).filter(numbered);
    return { id, applied, lastNumber, trimmed, attach, attaches, end, acked, ackedBefore, lines, calls, numbers: calls.map((entry) => entry.seq), rows };
  }

  /** The events come back after a gap and the host still has what the page is missing: the page asks for it by offset, once, and goes on. */
  sections['reattach-rejoin'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const r = await blip(w, { trim: false });
      const { attach, lines } = r;
      check(
        'reattach.rejoin',
        typeof r.applied === 'number' &&
          attach.from_offset === r.applied &&
          attach.start <= r.applied &&
          r.attaches === 1 &&
          lines.last === LINES - 1 &&
          lines.gaps.length === 0 &&
          lines.dups.length === 0 &&
          lines.resets === 0 &&
          r.acked === r.end - attach.end &&
          attach.next_input_seq > r.lastNumber + 1 &&
          r.numbers.length > 0 &&
          r.numbers.every((number, index) => number === attach.next_input_seq + index) &&
          r.calls.every((entry) => entry.outcome === 'applied'),
        `${engine} ${vp}: the page had applied the output up to ${String(r.applied)} when its events stopped and asked for it from ${String(attach.from_offset)} (the same, in ${String(r.attaches)} attach: one is right) and the host's replay started at ${String(attach.start)}, ${String(r.applied - attach.start)} B below it (at or below is right: the host answers from the boundary of the chunk that holds the offset, and the page skips what it has); the emulator was given ${String(lines.count)} numbered lines ending at ${String(lines.last)} (${String(LINES - 1)} is the last) with ${JSON.stringify(lines.gaps.slice(0, 3))} gaps, ${JSON.stringify(lines.dups.slice(0, 3))} duplicates and ${String(lines.resets)} resets (none of the three is right: the output goes on); after the attach the page acknowledged ${String(r.acked)} B (${String(r.ackedBefore)} B before it) and the host sent ${String(r.end - attach.end)} B after the replay (equal is right: the replay's bytes are never credited, the live ones always); another tab had taken a number, so the answer said ${String(attach.next_input_seq)} where the page had counted ${String(r.lastNumber + 1)}, and the calls after it were numbered ${JSON.stringify(r.numbers)} (from ${String(attach.next_input_seq)}, one by one, all applied)`,
      );
      note(`reattach rejoin ${engine} ${vp}: the events stopped at ${String(r.applied)} B, the page asked for the output from there once (a replay of ${String(attach.end - attach.start)} B that began ${String(r.applied - attach.start)} B below it, at a chunk boundary of the host's ring), ${String(lines.count)} lines in order to ${String(lines.last)}, ${String(r.acked)} B acknowledged, the input went on from ${String(attach.next_input_seq)}`);
    } finally {
      await w.close();
    }
  };

  /** The events come back after a gap and the host's ring no longer reaches back: the screen is brought to the ring by a replay. */
  sections['reattach-rejoin-gap'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const r = await blip(w, { trim: true });
      const { attach, lines } = r;
      const last = String(LINES - 1).padStart(7, '0');
      check(
        'reattach.rejoin-gap',
        typeof r.applied === 'number' &&
          r.trimmed > r.applied &&
          attach.from_offset === r.applied &&
          attach.start === r.trimmed &&
          r.attaches === 1 &&
          lines.resets === 1 &&
          attach.firstLine !== null &&
          lines.first === attach.firstLine &&
          lines.gaps.length === 0 &&
          lines.dups.length === 0 &&
          lines.last === LINES - 1 &&
          r.rows.some((row) => row.startsWith(last)),
        `${engine} ${vp}: the page had applied the output up to ${String(r.applied)} and asked for it from ${String(attach.from_offset)}, and the host's ring started at ${String(r.trimmed)} (past it) and said its replay started at ${String(attach.start)} (the ring's start is right: the gap is stated); the screen was reset ${String(lines.resets)} time(s) (once is right) and its first numbered line was ${String(lines.first)} where the replay's first whole line is ${String(attach.firstLine)}; from there ${String(lines.count)} lines ended at ${String(lines.last)} (${String(LINES - 1)}) with ${JSON.stringify(lines.gaps.slice(0, 3))} gaps and ${JSON.stringify(lines.dups.slice(0, 3))} duplicates (none is right), ${String(r.attaches)} attach (one), and the screen shows the last line ${String(last)}: ${String(r.rows.some((row) => row.startsWith(last)))}`,
      );
      note(`reattach rejoin-gap ${engine} ${vp}: the ring started at ${String(r.trimmed)} past the ${String(r.applied)} B the page had, the screen was reset once and brought to the ring (first line ${String(lines.first)}), ${String(lines.last)} the last`);
    } finally {
      await w.close();
    }
  };

  /** The terminal vanished while the page was away: the tab says it is not there any more, and the page does not loop attaches however often its events come back. */
  sections['reattach-gone'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      await typeLine(page, 'hello');
      await sleep(500);
      const id = host.ids()[0];
      const me = windowsOf(host)[0];
      await page.evaluate(() => window.__link.down());
      host.vanish(id);
      const mark = host.log.calls.length;
      await page.evaluate(() => {
        window.__link.up();
      });
      // The connection flaps: its events come back twice more.
      for (let again = 0; again < 2; again += 1) {
        await sleep(500);
        await page.evaluate(() => {
          window.__link.signal();
        });
      }

      await sleep(1200);
      const attaches = host.log.calls.slice(mark).filter((entry) => entry.window === me && entry.method === 'AttachTerminal' && entry.id === id);
      const words = `${await laneOf(page)} ${await bodyOf(page)}`;
      check(
        'reattach.gone',
        attaches.length === 1 && FREE.gone.test(words),
        `${engine} ${vp}: the terminal vanished while the page was away; its events came back three times and the page attached ${String(attaches.length)} time(s) (once is right: it is not there any more, and that is the end) and the tab says ${JSON.stringify(words.slice(0, 200))} (it says the terminal is not there any more)`,
      );
      note(`reattach gone ${engine} ${vp}: one attach for three signals, and the tab says ${JSON.stringify(words.slice(0, 80))}`);
    } finally {
      await w.close();
    }
  };

  /**
   * A key is typed while a late replay is being written. The host's ring no longer reaches back to what the page has, so the page is brought to the ring by a replay, and the fixture holds the end of the emulator's writes: the replay
   * takes as many frames as the probe lets pass, and it holds a program's questions to the terminal. The key is queued and reaches the shell once, in order, after the replay; what the emulator answers to the questions reaches it never.
   */
  sections['reattach-rejoin-keys'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const { page, id, me, applied } = await flooded(w);
      // The page has been given everything the host delivered and has parsed it: the screen lets the emulator parse what it was given before it begins a replay, so nothing live may be left to be written when this one comes.
      await until(
        async () => page.evaluate((terminal) => window.__engine.accepted >= (window.__link.state().delivered[terminal] ?? 0) && window.__engine.parsed === window.__engine.accepted, id),
        (idle) => idle,
        15_000,
      );
      const trimmed = host.trimRing(id, applied);
      host.plant(id, QUERIES);
      const resets = await page.evaluate(() => window.__engine.lines.resets);
      const mark = host.log.attaches.length;
      await page.evaluate(() => {
        window.__gate.close();
      });
      await page.evaluate(() => {
        window.__link.up();
      });
      await until(() => host.log.attaches.length, (count) => count > mark, 8000);
      const attach = host.log.attaches.length > mark ? host.log.attaches.at(-1) : undefined;
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
      if (attach !== undefined) await until(() => wroteBy(host, me, attach.writesAt), (text) => text.length >= 3, 6000);
      await finished(w, page, id);
      const shell = attach === undefined ? '' : wroteBy(host, me, attach.writesAt);
      const replies = await page.evaluate(() => window.__gate.replies());
      check(
        'reattach.rejoin-keys',
        attach !== undefined &&
          trimmed > applied &&
          attach.start === trimmed &&
          begun.resets > resets &&
          held >= 1 &&
          keys >= before.keys + 3 &&
          meanwhile.held >= 1 &&
          meanwhile.writes === before.writes &&
          shell === 'ab\r' &&
          replies >= 1,
        `${engine} ${vp}: the host's ring started at ${String(trimmed)} past the ${String(applied)} B the page had, so the page was brought to it by a replay that starts at ${String(attach?.start)} and holds ${JSON.stringify(QUERIES)}; with the end of the emulator's writes held (${String(held)} held, ${String(meanwhile.held)} still when the keys were typed) 'ab' and Enter were typed: ${String(keys - before.keys)} keys reached the emulator (3 is right) and the page made ${String(meanwhile.writes - before.writes)} calls to the shell while the replay was being written (none is right: the keys wait for it); once it was written the shell was sent ${JSON.stringify(shell)} (${JSON.stringify('ab\r')} is right: once, in order, none lost, and none of what the emulator answered to the questions: it answered ${String(replies)} time(s))`,
      );
      note(`reattach rejoin-keys ${engine} ${vp}: the replay was held while 'ab' and Enter were typed, and the shell was sent ${JSON.stringify(shell)} once it was written; the emulator answered ${String(replies)} time(s) and none of it reached the shell`);
    } finally {
      await w.close();
    }
  };

  /**
   * An acknowledgement is in flight when the answer of the rejoin comes, and the connection that carries it drops: the host never gets it. The attach made the host forget what it was owed, so the page does not credit that count
   * again: what it credits after the attach is the live bytes taken after it, and nothing else.
   */
  sections['reattach-rejoin-acks'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const page = await w.open();
      await start(page);
      const id = host.ids()[0];
      const me = windowsOf(host)[0];
      // The page's acknowledgements are held from here: the next one is in flight with no answer, and the page makes no other while it is (one call is out at a time), so the host's credit runs out.
      await page.evaluate(() => {
        window.__acks.hold();
      });
      await typeLine(page, `flood ${String(LINES)} 80`);
      const inFlight = await until(async () => page.evaluate(() => window.__acks.held()), (count) => count >= 1, 15_000);
      await until(() => host.state(id)?.paused === true, (paused) => paused, 15_000);
      // Every event the host delivered is in the emulator: what is given to it from here is what the host sends after the attach.
      const baseline = await until(
        async () => page.evaluate((terminal) => ({ accepted: window.__engine.accepted, delivered: window.__link.state().delivered[terminal] ?? 0 }), id),
        (now) => now.delivered > 0 && now.accepted >= now.delivered,
        15_000,
      );
      const mark = host.log.attaches.length;
      // The events come back with nothing lost to the page: it asks for what it may have missed, and the host answers while the acknowledgement is still out.
      await page.evaluate(() => {
        window.__link.signal();
      });
      await until(() => host.log.attaches.length, (count) => count > mark, 8000);
      const attach = host.log.attaches.length > mark ? host.log.attaches.at(-1) : undefined;
      // The page has the answer when it has been given bytes that the host sent after it: nothing is given to the emulator while the call is out.
      const taken = await until(async () => page.evaluate(() => window.__engine.accepted), (bytes) => bytes > baseline.accepted + 100_000, 15_000);
      await perturbed(ctx, page, 'ack-release');
      await page.evaluate(() => {
        window.__acks.release();
      });
      await finished(w, page, id);
      const end = host.state(id).end;
      const credited = () => host.log.acks.filter((entry) => entry.window === me && entry.id === id && entry.attachesAt > mark).reduce((sum, entry) => sum + entry.bytes, 0);
      const acked = attach === undefined ? 0 : await until(credited, (sum) => sum >= end - attach.end, 5000);
      check(
        'reattach.rejoin-acks',
        inFlight >= 1 && attach !== undefined && taken > baseline.accepted + 100_000 && acked === end - attach.end,
        `${engine} ${vp}: ${String(inFlight)} acknowledgement(s) were in flight when the page asked for what it may have missed (one is right) and the host's answer came (${attach === undefined ? 'it never did' : `the replay ended at ${String(attach.end)}`}); the page was given ${String(taken - baseline.accepted)} B after it; the connection dropped under the acknowledgement, and after the attach the page credited ${String(acked)} B where the host sent ${String(attach === undefined ? 0 : end - attach.end)} B after the replay (equal is right: the count that was refused is not credited again)`,
      );
      note(`reattach rejoin-acks ${engine} ${vp}: an acknowledgement was in flight when the attach was answered and was refused after it; ${String(acked)} B credited after the attach, the ${String(attach === undefined ? 0 : end - attach.end)} B the host sent`);
    } finally {
      await w.close();
    }
  };

  /**
   * A tab that lost its terminal presses Take it back on a flag that is stale: the tab that took it has gone, so the button came, and a third tab has taken the terminal since, with no word to this one (the host says nothing when a tab
   * attaches a terminal that nobody holds). The page asks the host who holds it and attaches nothing: the button goes, the lane says that the terminal is taken over, and the third tab goes on.
   */
  sections['reattach-takeback-guard'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const a = await w.open();
      await start(a);
      await typeLine(a, 'hello');
      await until(async () => rowsOf(a), (rows) => rows.some((row) => /hello from the synthetic shell/.test(row)), 8000);
      const id = host.ids()[0];
      const owner = windowsOf(host)[0];
      const buttons = async () => a.getByRole('button', { name: /take it back/i }).count();
      const own = (list) => list.filter((entry) => entry.window === owner).length;
      // The tab that took the terminal goes: the page is told, and has the button.
      const b = await w.open();
      await until(() => host.state(id)?.holder, (holder) => holder === 1, 8000);
      await until(async () => laneOf(a), (text) => text.includes(FREE.taken), 8000);
      await b.goto('about:blank');
      await until(buttons, (count) => count >= 1, 8000);
      // A third tab takes the terminal that nobody holds, and the host tells nobody: the button is still there, and is not true.
      const c = await w.open();
      await until(() => host.state(id)?.holder, (holder) => holder === 2, 8000);
      const windowC = host.log.attaches.filter((entry) => entry.window !== owner).at(-1)?.window;
      await reveal(c);
      await c.waitForSelector('.xterm-helper-textarea', { timeout: 8000 });
      const stale = await buttons();
      const listsBefore = own(host.log.lists);
      const attachesBefore = own(host.log.attaches);
      await a.getByRole('button', { name: /take it back/i }).click();
      // The page asks the host who holds the terminal, and the button goes.
      await until(() => own(host.log.lists), (count) => count > listsBefore, 8000);
      const left = await until(buttons, (count) => count === 0, 8000);
      await frames(a);
      const lane = await laneOf(a);
      const asks = own(host.log.lists) - listsBefore;
      const attaches = own(host.log.attaches) - attachesBefore;
      const holder = host.state(id)?.holder;
      // The tab that holds it goes on: what it types reaches the shell.
      await typeLine(c, 'hello');
      const rows = await until(async () => rowsOf(c), (shown) => shown.some((row) => /hello from the synthetic shell/.test(row)), 8000);
      const typed = windowC === undefined ? '' : wroteBy(host, windowC);
      const laneC = await laneOf(c);
      check(
        'reattach.takeback-guard',
        windowC !== undefined &&
          stale === 1 &&
          asks >= 1 &&
          attaches === 0 &&
          left === 0 &&
          lane.includes(FREE.taken) &&
          FREE.old.test(lane) &&
          !lane.includes(FREE.closed) &&
          holder === 2 &&
          typed.includes('hello') &&
          rows.some((row) => /hello from the synthetic shell/.test(row)) &&
          laneC === '',
        `${engine} ${vp}: the button was still there when the tab that holds the terminal now had taken it with no word to this tab (${String(stale)} button: one is right); once pressed the page asked the host ${String(asks)} time(s) (once or more is right) and made ${String(attaches)} attach(es) (none is right: it is not its to take), the button ${left === 0 ? 'went' : 'is still there'}, the lane says ${JSON.stringify(lane)} (the terminal is taken over again: ${JSON.stringify(FREE.taken)}), the host's holder is ${String(holder)} (2, the third tab's), the third tab typed ${JSON.stringify(typed)} and its screen ${rows.some((row) => /hello from the synthetic shell/.test(row)) ? 'shows' : 'does NOT show'} the answer, with its lane ${JSON.stringify(laneC)} (empty: it was not taken from)`,
      );
      note(`reattach takeback-guard ${engine} ${vp}: the press asked the host ${String(asks)} time(s), attached ${String(attaches)} time(s), the button went and the third tab went on`);
    } finally {
      await w.close();
    }
  };

  /**
   * A tab whose events were down when the tab that took its terminal let it go. It was told nothing, and when its events come back it asks the host who holds the terminal: with the taker gone it shows the button, and with the taker
   * still there (the events were down for a moment) it shows what it showed.
   */
  sections['reattach-takeback-offline'] = async (ctx) => {
    const { engine, vp } = ctx;
    const w = await world(ctx);
    try {
      const { host } = w;
      const a = await w.open();
      await start(a);
      await typeLine(a, 'hello');
      await until(async () => rowsOf(a), (rows) => rows.some((row) => /hello from the synthetic shell/.test(row)), 8000);
      const id = host.ids()[0];
      const owner = windowsOf(host)[0];
      const buttons = async () => a.getByRole('button', { name: /take it back/i }).count();
      const listed = async () => a.evaluate(() => window.__link.state().listed);
      const dropped = async () => a.evaluate(() => window.__link.state().dropped);
      const b = await w.open();
      await until(() => host.state(id)?.holder, (holder) => holder === 1, 8000);
      await until(async () => laneOf(a), (text) => text.includes(FREE.taken), 8000);

      // 1. The events are down for a moment while the tab that took the terminal still holds it: the page asks who holds it, and nothing changes.
      const listed0 = await listed();
      await a.evaluate(() => {
        window.__link.down();
      });
      await a.evaluate(() => {
        window.__link.up();
      });
      const asked = await until(listed, (count) => count > listed0, 8000);
      await frames(a);
      const laneHeld = await laneOf(a);
      const buttonsHeld = await buttons();

      // 2. The events go down again and the tab that took the terminal goes while they are down: the page is told nothing, and shows what it showed.
      await a.evaluate(() => {
        window.__link.down();
      });
      const dropped0 = await dropped();
      await b.goto('about:blank');
      await until(() => host.state(id)?.holder, (holder) => holder === null, 8000);
      await until(dropped, (count) => count > dropped0, 8000);
      const laneDown = await laneOf(a);
      const buttonsDown = await buttons();

      // 3. The events come back: the page asks the host, and the host says that nobody holds the terminal.
      await perturbed(ctx, a, 'offline');
      const listed1 = await listed();
      await a.evaluate(() => {
        window.__link.up();
      });
      const freed = await until(buttons, (count) => count >= 1, 8000);
      const laneFreed = await laneOf(a);
      const asks = (await listed()) - listed1;
      const attaches = host.log.attaches.filter((entry) => entry.window === owner).length;
      check(
        'reattach.takeback-offline',
        asked > listed0 &&
          buttonsHeld === 0 &&
          laneHeld.includes(FREE.taken) &&
          FREE.old.test(laneHeld) &&
          buttonsDown === 0 &&
          laneDown.includes(FREE.taken) &&
          FREE.old.test(laneDown) &&
          freed === 1 &&
          laneFreed.includes(FREE.closed) &&
          laneFreed.includes(FREE.lease) &&
          asks >= 1 &&
          attaches === 0,
        `${engine} ${vp}: with the events down for a moment and the tab that took the terminal still holding it the page asked the host (${String(asked - listed0)} call(s)) and the lane says ${JSON.stringify(laneHeld)} with ${String(buttonsHeld)} buttons (the old words and none is right); with the events down while that tab went the lane says ${JSON.stringify(laneDown)} with ${String(buttonsDown)} buttons (the same: it was told nothing); once they were back it asked the host ${String(asks)} time(s) (once or more) and has ${String(freed)} button (one is right) and the lane says ${JSON.stringify(laneFreed)} (${JSON.stringify(FREE.closed)} and ${JSON.stringify(FREE.lease)} are right); it made ${String(attaches)} attach(es) (none: only a press takes the terminal back)`,
      );
      note(`reattach takeback-offline ${engine} ${vp}: no button while the taker held the terminal, none while the events were down when it went, one once they were back and the page had asked the host (${String(asks)} call(s))`);
    } finally {
      await w.close();
    }
  };

  return sections;
}

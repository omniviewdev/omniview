import { HOST, type PanelStore, type Session, type SessionId } from '../../core/panel';
import { offersTakeBack, type TerminalFeedHandle, type TerminalFeedSnapshot, type TerminalFinished, type TerminalRestart, type TerminalTarget } from './feed';
import { sessionStateOf } from './state';
import { isOwnServer, isWebAddress, type Origin } from './links/links';
import { TERMINAL_TOOL_ID } from './tool';

// The registry of the feeds of the Terminal tool, beside the panel model (framework-free: no React, no DOM, no xterm). A caller hands the host a TARGET (`open(target)`, the one entry point: the host's own
// shell today, a plugin's exec target one day) and the registry makes the session in the panel and owns the feed from then on, until the session goes. It is the Logs registry's sibling and keeps its rules
// (panel/logs/LogStreams.ts); what differs is said where it does:
//
//   - it copies what the feed says to what the session says (`sessionStateOf`): the card and the tab show it, whether the session is on screen or not;
//   - it closes the feed, and lets go of its own listener, when the session's tab closes and when its plugin unloads. A session the unload ENDED is kept (A21, `Session.held`): its process is ended, but its
//     entry stays, with the very feed the view over it was made for, until the tab closes, so what a person was reading stays readable;
//   - it LEAVES a feed that can be left, where it closes any other, when the page goes away (`leave`) and when the registry itself ends (the window unmounts): the host holds a terminal that has a key for its lease,
//     and the page that comes back finds it (T2-go). A tab the person closes is still a close: the shell ends;
//   - it never reads the feed and never writes to it: the view is the one reader (a feed has one);
//   - it does NOT look for a session a target already has (A22 is the Logs tool's rule: reading one item's log twice is reading it). A press of "New terminal" is a new process, and so is a second shell in
//     the same container: two sessions of one title are twins, which the strip already tells apart;
//   - it remembers that the USER started a session and wants the keyboard in it (S116a): the body that shows the session takes the request when its screen is ready, once;
//   - it finds the tab of a terminal that comes back after a reload by the id of its session (`TerminalTarget.sessionId`, which is the id of the terminal): the saved tab (the restore makes every terminal session `ended`,
//     with no feed) is given the feed and stays where it is, under the title the person saw, and goes from `ended` to what the feed says through the write every status takes; a terminal with no saved tab gets a session
//     of that id. Nothing is shown or focused for it. A terminal has one session: this is the one case where a target already has a session, and it is told by the id, not by what the target runs.
//   - it takes a terminal back for a session that lost it (`takeBack`, T2d): the feed of a terminal another tab took over and has left is over for this page (`detached`, `free`), and the person asks for it again. The host is asked
//     first who holds the terminal now (`refresh` of the feed that was lost: a tab may have attached it since, and attaching takes a terminal from whoever holds it), and only a terminal that is still free is attached: the target the
//     window makes for the session's id (`TerminalSessionsOptions.reattach`) gives the session a NEW feed, the feed it had is let go of after the new one is published (a feed that lost its terminal sends nothing to the host for it),
//     and the status flows through the write every status takes (ended, starting, running...) with the tab where it was, under the title it had. The swap is announced by that write: the entry is replaced first, so whoever hears of it
//     finds the new feed in `feedOf`. Nothing is shown or focused for it. What the supplier runs while that is done may close the tab: nothing is published for a session that is gone;
//   - it does not tell the feeds that the page's connection to the host came back: each feed connects its own stream again, from the offset it has, and a terminal another tab took is offered back when its feed says it is free (the host's `released`),
//     and `refresh` is asked once more at the take-back, which is the only time the registry asks.
//   - it can be followed (`subscribeFeeds`, T2d): which feed a session has is read in a render (`feedOf`), so whoever draws a body is told when that changes: a saved tab is given its terminal after its body was drawn with
//     none, a terminal is taken back (one feed for another), a feed is let go of. The listener runs once, synchronously, when the change is complete, and `feedOf` answers the same value between two changes.
//   - it opens the address of a link in a terminal's output outside the app (`openExternal`, T3a), through the way the window gave it (`TerminalSessionsOptions.openExternal`): only an http or https address is let through, because a
//     program writes what it likes and a link can name any scheme; a window that gave no way has no link to draw (`canOpenExternal`). It keeps no state for it.
//
// A feed's status is told to the registry's listener with every held chunk's first wake-up too; the listener compares the status with the last it saw and writes to the panel only for a new one, so a flood
// of output is a handful of writes in the life of a session, never one a chunk.

export type TerminalOpened = {
  /** The id the panel knows the session by. */
  readonly id: SessionId;
  /** Closes the session's tab, and with it the process. Safe to call again. */
  readonly close: () => void;
};

/** What a session's card is made of, besides the session: what the target said of its resource, and the feed's status as it is now. */
export type TerminalSessionRecord = {
  /** The target's id: what runs, as its supplier names it. */
  readonly id: string;
  readonly plugin: string;
  readonly resource: TerminalTarget['resource'];
  readonly snapshot: TerminalFeedSnapshot;
};

export type TerminalSessionsOptions = {
  /** Makes a session id. Default: a random UUID. */
  readonly newId?: (() => SessionId) | undefined;
  /** Where the host says what it could not do for a supplier. Default: the console, with the `[panel]` prefix the panel's other messages have. */
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
  /**
   * Makes the target that attaches the terminal of a session again (T2d), given the id of the terminal (the feed's own `id`, else the session's): what `takeBack` opens for a session whose terminal another tab took over and the person wants back. The host's own shell makes it with the page's
   * key. Absent: a terminal this window lost cannot be taken back.
   */
  readonly reattach?: ((session: SessionId, lost?: TerminalFeedHandle) => TerminalTarget) | undefined;
  /** Makes the target that starts a terminal in place of an ended one (#695 step 5): what `restart` opens for a session, given what the ended feed said a restart is made from and the session's id. Absent: nothing is restarted. */
  readonly restart?: ((restart: TerminalRestart, session: SessionId) => TerminalTarget) | undefined;
  /**
   * What opens an address outside the app (T3a): the window's own way to do it (the system browser, through the runtime), called with the address of a link a person followed in a terminal. Absent: the window cannot open an address, and no link
   * is drawn (`canOpenExternal`). The registry gives it only http and https addresses, once for each follow; a way that throws or rejects is one warning, and nothing is tried again.
   */
  readonly openExternal?: ((url: string) => void | Promise<void>) | undefined;
  /** The address of the page the registry runs in (default: `location`): a link to the host's own server is not followed. */
  readonly origin?: Origin | undefined;
  /**
   * A command finished in a session's terminal (`TerminalFeedSnapshot.finished`: a live end mark, in the producer's times), told once for each, in the order the feed says them. What the host makes of it (a notice) is the window's: the registry
   * only passes it on. A listener that throws is one warning.
   */
  readonly finished?: ((session: SessionId, finished: TerminalFinished, generation: number) => void) | undefined;
};

export type OpenTerminalOptions = {
  /** The user started this session and wants the keyboard in it once its screen is ready. Default: no. */
  readonly focus?: boolean | undefined;
  /**
   * The panel opens on a session this call makes, and it becomes the one on screen (the panel's own `reveal`, S116). A terminal that is found again after a reload says `false`: a restored terminal must not cover the page.
   * A saved tab that is given its feed is never shown or moved, whatever this says. Default: true.
   */
  readonly reveal?: boolean | undefined;
  /**
   * Opens the session in a NEW pane beside the active one (the panel model's `splitPane`, #697 step 6) instead of as another tab of one body: `extent` is the length the panes would share along the deck's axis, in pixels, which the
   * layout knows and the model does not. A split the panel refuses (no room for another pane: each needs 80 px) is a refused session: nothing opens and the process that was started is closed again.
   */
  readonly split?: { readonly extent: number; readonly beside?: SessionId | undefined } | undefined;
};

export type TerminalSessions = {
  /**
   * Starts listening to the panel: a session that closes, or a plugin that leaves, releases its process (a session the plugin's unload ended is kept: its process is ended and its entry stays until its tab
   * closes, A21). Returns what stops it, which also releases every entry (the window is going): a feed that can be left is left, and any other is closed. It may be attached again after it was stopped.
   */
  readonly attach: () => () => void;
  /**
   * The page is going away (`pagehide`): every feed that can be left is told so (`TerminalFeedHandle.leave`), once, and nothing is closed or released: the host holds a terminal that has a key for its lease, and the page
   * that comes back finds it. A feed that cannot be left is not touched, because the page may come back to it. The end of the registry leaves the same feeds, closes the others, and does not tell a feed twice.
   */
  readonly leave: () => void;
  /**
   * Asks every feed that can no longer be told when its lost terminal is free (`detached.unwatched`, its end not known) who holds it now, anew (`TerminalFeedHandle.refresh` with `fresh`): what a tab does when the person comes back to it. Answers whether any feed
   * was asked. No timer is behind it.
   */
  readonly refreshUnwatched: () => boolean;
  /**
   * Opens a session in the Terminal tool for a target: calls its `open` once, and makes the session in the panel (which opens on it). Every call is a new process, except for a target that names the id of its session
   * (`TerminalTarget.sessionId`): a terminal has one session. When the panel has a session of that id (a saved tab: the restore makes every terminal session `ended`, with no feed) the session is GIVEN the feed, stays
   * where it is under the title it has, and follows the feed from then on; when it has none, a session of that id is made. `undefined` when it could not, and why is in the log: the target is not well formed, its id names
   * a session that cannot have this terminal (another tool's or plugin's, one a plugin's unload kept, one of a plugin that is not live, or one this registry holds a terminal for already: nothing is started for any of
   * these), its `open` threw or answered something that is not a feed, or the panel refused the session (its plugin is not live); the process is closed again in the last two cases.
   */
  readonly open: (target: TerminalTarget, options?: OpenTerminalOptions) => TerminalOpened | undefined;
  /** The feed of a session the registry holds, by identity: the live one, or the closed one of a held session (A21); the one a terminal was taken back with after the one it lost (`takeBack`); `undefined` for a session that has none (one that closed, one restored from the last run that no terminal was found for). The same value until the next change (`subscribeFeeds`). */
  readonly feedOf: (session: SessionId) => TerminalFeedHandle | undefined;
  /** What the card of a session needs of its feed; `undefined` when it has none. */
  readonly recordOf: (session: SessionId) => TerminalSessionRecord | undefined;
  /** Whether the user asked for the keyboard in this session when it opened and nobody took the request yet: true once. */
  readonly takeFocus: (session: SessionId) => boolean;
  /**
   * Whether the terminal of this session was lost by this page and may be taken back now: the host's own terminal, whose feed is over for this page with a `detached` that says the tab that took it has gone (`free`: nobody
   * holds it), with no end known for the terminal itself (an ended terminal has nothing to take back), in a window that can attach a terminal again (`TerminalSessionsOptions.reattach`). The status of the feed decides it, so it
   * is read where the lane reads that status.
   */
  readonly canTakeBack: (session: SessionId) => boolean;
  /** What stops this session and keeps its tab, which then says it ended (Stop session): `undefined` for a session that holds no process now. */
  readonly stopOf: (session: SessionId) => (() => void) | undefined;
  /**
   * Takes the terminal of this session back (T2d). The host is asked first who holds it now (`TerminalFeedHandle.refresh` of the feed that was lost): the page's word that nobody does may be old, and attaching takes a terminal
   * from whoever holds it. Only a session that is still this window's lost terminal, which the feed still says is free, goes on: the target the window makes for the session's id attaches it again, the session is given its feed,
   * the feed it had is let go of after the new one is published, and the status flows through the write every status takes, keeping the tab's place and title; nothing is shown or focused. Answers whether the session's feed was
   * swapped, and never rejects. `false` changes nothing: a press that finds nothing to take back (the terminal runs, nobody has said it is free, the tab is gone, or a take-back of the session is in flight already: a second press
   * does nothing), an answer that says somebody holds the terminal or that it ended, a tab closed or a window stopped while the host was asked or the new feed was made, and an attach that cannot be made (the window cannot make
   * the target, it cannot open, what it opened is not a feed: one warning, and the session keeps its feed so that it can be tried again). An attach the host refuses is the feed's failed state in the host's words, as for any feed.
   */
  readonly takeBack: (session: SessionId) => Promise<boolean>;
  /**
   * Follows which feed a session has (T2d): the listener is called, synchronously and with nothing, once after every change of it, and reads `feedOf` again. A session is given its feed (a saved tab whose terminal was found
   * again, a new terminal), has it replaced (a terminal taken back) or loses it (its tab closes, its plugin goes and the panel does not keep the session, the registry stops), and the listener runs when that change is
   * complete: the status of the feed is written to the session, or the feed is let go of. What the registry does with the same feed is no change (a plugin's unload that keeps the session, A21; a status the feed says; the page
   * going away), nor is an open that comes to nothing. Answers what stops it, which is safe to call again. A listener that throws is one warning, and the others are called all the same. With `feedOf`, which answers the same value
   * between two changes, it is an external store (`useSyncExternalStore(subscribeFeeds, () => feedOf(session))`): a body drawn before its terminal was found, or while another feed was the session's, is drawn again.
   */
  readonly subscribeFeeds: (listener: () => void) => () => void;
  /** Whether the terminal of this session is over for good and a restart can be made from it (#695 step 5). */
  readonly canRestart: (session: SessionId) => boolean;
  /** Starts a new terminal in the session of an ended one, and answers whether it did (#695 step 5). */
  readonly restart: (session: SessionId) => boolean;
  /** The feed a feed was made to continue by a restart (`restart`): the one whose transcript its screen keeps. `undefined` for any other feed. */
  readonly restartedFrom: (feed: TerminalFeedHandle) => TerminalFeedHandle | undefined;
  /** Whether the window gave the registry a way to open an address outside the app (`TerminalSessionsOptions.openExternal`). A link in a terminal's output is drawn only where this is true, so that no link is dead. The same answer every time. */
  readonly canOpenExternal: () => boolean;
  /**
   * Opens the address of a link a person followed in a terminal, outside the app, through the window's way (T3a). Only an http or https address with a host goes to it, once: a program writes what it likes, so another scheme, a relative path,
   * an empty string and an address with a space, a control character or a backslash in it are refused, with one warning and no call. A way that throws, or rejects when it is done, is one warning too. Never throws and answers nothing: the caller is
   * a click. Does nothing when the window gave no way (`canOpenExternal`).
   */
  readonly openExternal: (uri: string) => void;
  /** Whether a link to this address is followed: the window can open one, and the address is a web address that is not the host's own server. */
  readonly canFollow: (uri: string) => boolean;
  /**
   * Asks for the view of a session's terminal to be moved to a command and the keyboard put in it (a notice's Show): kept until the terminal's body takes it, and answered `false` for a session the registry does not hold. A later
   * request for the session replaces the earlier. The registry moves nothing itself: the body that shows the session does it, when its screen is there.
   */
  readonly requestJump: (session: SessionId, command: string, generation?: number) => boolean;
  /** Which terminal of the session the pending request is about: 0 is the first, each restart the next. `undefined` when none is pending. */
  readonly jumpGeneration: (session: SessionId) => number | undefined;
  /** The command a session's view is asked to move to and nobody has taken: the same value until it is taken or replaced (an external store with `subscribeJumps`). */
  readonly pendingJump: (session: SessionId) => string | undefined;
  /** Takes the request of a session, once: the second call finds none. */
  readonly takeJump: (session: SessionId) => string | undefined;
  /** Follows the requests: the listener is called, with nothing, after each one is made, replaced, taken or dropped (a session that goes drops its request). */
  readonly subscribeJumps: (listener: () => void) => () => void;
};

type Entry = {
  readonly plugin: string;
  readonly target: string;
  readonly resource: TerminalTarget['resource'];
  readonly feed: TerminalFeedHandle;
  stop: () => void;
  /** What the target says the tab is called once the feed says more than the target knew (`TerminalTarget.retitle`), and the title the session has now. */
  readonly retitle: TerminalTarget['retitle'];
  title: string;
  /** The person had named the session when the registry last looked: when the name is cleared (the pin is gone) the registry names the session by what the feed says now. */
  named: boolean;
  /** The status the registry last copied to the session. */
  last: TerminalFeedSnapshot;
  /** The registry stopped listening to the feed and closed it, and the session stays (A21): the entry is kept for the feed, which the view reads, and for the card's record, until the tab closes. Closed only once. */
  ended: boolean;
  /** The feed was told to leave, because the page is going away: its process lives on for its lease, and the end of the registry that follows must not close it or tell it again. */
  left: boolean;
  /** Whoever follows the feeds (`subscribeFeeds`) was told that the session has this feed. An entry that was never announced (its session was refused, or closed as it opened) is let go of without telling anybody it was there. */
  announced: boolean;
  /** A take-back of the session is in flight (the host is being asked who holds the terminal): a second press does nothing. */
  taking: boolean;
  /** A restart of the session is in flight (the target is being opened): a press that comes inside it does nothing. */
  restarting: boolean;
  /** How many restarts the session has had: the terminal a restart makes counts its commands from c1 again, so a command is named by its id and this. */
  generation: number;
  /** What the record says once the entry ended (A21: a kept session never changes again): the status at the unload, with a process that was starting or running as ended. A closed feed may say anything after. */
  final?: TerminalFeedSnapshot | undefined;
};

/** What stands where a target says its session is (`claim`): a saved tab to give the feed to, or nothing there (`saved` is undefined: a session is made), or why this terminal cannot have that id. */
type Claim = { readonly saved: Session | undefined } | { readonly why: string };

const MEMBERS = ['subscribe', 'getSnapshot', 'read', 'ack', 'write', 'writeBinary', 'resize', 'close'] as const;

/** A feed has all eight members (what it can say about what runs in it is optional). A supplier that hands over less has made a mistake the host names, and does not run. */
function isFeed(value: unknown): value is TerminalFeedHandle {
  return typeof value === 'object' && value !== null && MEMBERS.every((name) => typeof Reflect.get(value, name) === 'function');
}

/** Something that can at least be closed: what a feed that is not one may still hold in the backend. */
function hasClose(value: unknown): value is { readonly close: () => unknown } {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'close') === 'function';
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The window's own `location`, which a page has and a test environment of another kind may not. */
const page: { readonly location?: Origin | undefined } = globalThis;

/** An origin that no address has: where a window with no `location` is served from. */
const NOWHERE: Origin = { protocol: 'about:', hostname: '', port: '' };

/** The platform's `crypto`, which every engine the app runs in has, and a test environment may not. */
const platform: { readonly crypto?: Crypto | undefined } = globalThis;
let fallbackCounter = 0;
/** A random id from the platform; without one the clock and a counter stand in, which is unique within a run (the panel's own fallback). */
function newUuid(): SessionId {
  if (typeof platform.crypto?.randomUUID === 'function') {
    return platform.crypto.randomUUID();
  }

  fallbackCounter += 1;
  return `terminal-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const consoleWarn = (message: string, error?: unknown): void => {
  if (error === undefined) {
    console.warn(message);
  } else {
    console.warn(message, error);
  }
};

export function createTerminalSessions(store: PanelStore, options: TerminalSessionsOptions = {}): TerminalSessions {
  const newId = options.newId ?? newUuid;
  const warn = options.warn ?? consoleWarn;
  const external = options.openExternal;
  /** Where the page is served from, read when a link is followed: a window that moves is still the page it was. A window with no `location` (a test's) has no server to point at. */
  const ownOrigin = (): Origin => options.origin ?? page.location ?? NOWHERE;
  const entries = new Map<SessionId, Entry>();
  const wanted = new Set<SessionId>();
  /** The command each session's view is asked to move to, until its body takes the request; and who follows them. */
  const jumps = new Map<SessionId, { readonly command: string; readonly generation: number }>();
  const jumpListeners = new Set<() => void>();
  const tellJumps = (): void => {
    for (const listener of [...jumpListeners]) {
      listener();
    }
  };

  /** The feed each feed made for a restart continues: its screen keeps the transcript. */
  const continuations = new WeakMap<TerminalFeedHandle, TerminalFeedHandle>();
  const feedListeners = new Set<() => void>();

  /** Tells whoever follows which feed a session has (`subscribeFeeds`) that it changed, once, now. A listener that throws is the host's own fault: it goes to the log, and the others, and what the registry was doing, go on. */
  const feedsChanged = (): void => {
    for (const listener of [...feedListeners]) {
      if (feedListeners.has(listener)) {
        try {
          listener();
        } catch (error) {
          warn('[panel] a listener of the terminal feeds failed', error);
        }
      }
    }
  };

  /** Tells a supplier's feed something it may fail at (close it, leave it) and does not wait. An action that throws or rejects is the supplier's: it goes to the log, and the registry has done what it could either way. */
  const tellFeed = (plugin: string, action: () => unknown, failure: string): void => {
    try {
      void Promise.resolve(action()).catch((error: unknown) => {
        warn(`[panel] ${plugin} ${failure}`, error);
      });
    } catch (error) {
      warn(`[panel] ${plugin} ${failure}`, error);
    }
  };

  /** Asks a supplier's feed something and waits for its answer. A question that throws or rejects, or whose member cannot be read, is the supplier's: it goes to the log, and the registry goes on as if the feed had nothing to say. */
  const askFeed = async (plugin: string, action: () => unknown, failure: string): Promise<void> => {
    try {
      await action();
    } catch (error) {
      warn(`[panel] ${plugin} ${failure}`, error);
    }
  };

  /** Closes a feed, which ends its process. */
  const closeFeed = (plugin: string, close: () => unknown): void => {
    tellFeed(plugin, close, 'could not close the terminal');
  };

  /** Tells a feed that the page is going away, once: the host holds its terminal for its lease. */
  const leaveFeed = (entry: Entry): void => {
    if (!entry.left) {
      entry.left = true;
      tellFeed(entry.plugin, () => entry.feed.leave?.(), 'could not let go of the terminal');
    }
  };

  /**
   * Stops listening to a session's feed and lets go of it, and keeps the entry: the session stays and its view reads the feed it already has. A feed is closed, which ends its process, unless the page is going away
   * (`how` is `leave`) and the feed can be left: then it is left, and its process lives on for its lease (one the page left already is not told again, and is not closed after). Once: an entry that is ended is not let
   * go of again. It is marked first, so nothing the feed publishes as it closes (a real one may tell its listeners it ended) is heard.
   */
  const end = (entry: Entry, how: 'close' | 'leave' = 'close'): void => {
    if (entry.ended) {
      return;
    }

    entry.ended = true;
    entry.final = entry.last.state === 'starting' || entry.last.state === 'running' ? { state: 'ended' } : entry.last;
    try {
      entry.stop();
    } catch (error) {
      // The supplier's unsubscribe is the supplier's: the feed is let go of whatever it does.
      warn(`[panel] ${entry.plugin} could not stop listening to the terminal`, error);
    }

    if (how === 'leave' && typeof entry.feed.leave === 'function') {
      leaveFeed(entry);
      return;
    }

    closeFeed(entry.plugin, (): Promise<void> | void => entry.feed.close());
  };

  /** Lets a session's process go: out of the registry first (a feed that publishes as it closes finds nobody), then its listener, then the feed (closed, or left: `end`), unless an unload already ended it. */
  const release = (id: SessionId, how: 'close' | 'leave' = 'close'): void => {
    const entry = entries.get(id);
    wanted.delete(id);
    if (jumps.delete(id)) {
      tellJumps();
    }

    if (entry === undefined) {
      return;
    }

    entries.delete(id);
    end(entry, how);
    if (entry.announced) {
      feedsChanged();
    }
  };

  /**
   * What stands where a target says its session is: nothing (a session is made), a saved tab that can be given the feed, or why that id cannot have this terminal. A terminal has one session, so a registry that holds
   * a terminal for the id already refuses a second; a session of another tool or plugin, one its plugin's unload kept (it never changes again, A21) and one of a plugin that is not live cannot take a feed.
   */
  const claim = (id: SessionId, plugin: string): Claim => {
    if (entries.has(id)) {
      return { why: `this window holds a terminal for the session ${id} already` };
    }

    const state = store.getSnapshot();
    const session: Session | undefined = Object.hasOwn(state.sessions, id) ? state.sessions[id] : undefined;
    if (session === undefined) {
      return { saved: undefined };
    }

    if (session.tool !== TERMINAL_TOOL_ID || session.plugin !== plugin) {
      return { why: `the session ${id} is not a terminal session of ${plugin}` };
    }

    if (session.held === true) {
      return { why: `the session ${id} ended when its plugin was unloaded and is kept as it is until it is closed` };
    }

    return plugin !== HOST && !state.live.includes(plugin) ? { why: `the plugin ${plugin} is not live` } : { saved: session };
  };

  /**
   * The panel changed: a session that is gone has no use for its process, and neither has one whose plugin is off, except that a session the unload ended and the panel kept (held, A21) is still being read:
   * its process is ended once and its entry stays, until its tab closes.
   */
  const reconcile = (): void => {
    if (entries.size === 0) {
      return;
    }

    const state = store.getSnapshot();
    for (const [id, entry] of [...entries]) {
      if (!Object.hasOwn(state.sessions, id)) {
        release(id);
      } else if (entry.plugin !== HOST && !state.live.includes(entry.plugin)) {
        if (state.sessions[id]?.held === true) {
          end(entry);
        } else {
          release(id);
        }
      } else {
        const session = state.sessions[id];
        const named = session?.titlePinned === true;
        if (entry.named && !named && session !== undefined) {
          // The person cleared their name: the tab is named by what the feed says now, without waiting for the feed to change.
          entry.named = false;
          entry.title = session.title;
          retitle(id, entry, entry.feed.getSnapshot());
        } else {
          entry.named = named;
        }
      }
    }
  };

  /**
   * The tab's name once the feed says more than the target knew when it opened (the shell it started): what the target says, when that is something and is not the title the session has. One change of the panel for
   * each, and none for a flood of wake-ups with the same word. A session its plugin's unload kept never changes again (the panel refuses it).
   */
  const retitle = (id: SessionId, entry: Entry, snapshot: TerminalFeedSnapshot): void => {
    if (entry.retitle === undefined) {
      return;
    }

    let named: string | undefined;
    try {
      named = entry.retitle(snapshot)?.trim();
    } catch (error) {
      warn(`[panel] ${entry.plugin} could not name the terminal`, error);
      return;
    }

    if (named === undefined || named === '' || named === entry.title) {
      return;
    }

    // A name the person gave (Rename session) is pinned in the panel's record, which refuses the owner's naming: the program does not take it back, and a reload keeps it.
    store.retitleSession(id, named);
    entry.title = store.getSnapshot().sessions[id]?.title ?? entry.title;
  };

  /** A feed told its listeners something: only a new status is the session's business, and not once the registry has closed the feed (the session is ended for good, with its own cause). */
  const heard = (id: SessionId): void => {
    const entry = entries.get(id);
    if (entry === undefined || entry.ended) {
      return;
    }

    const snapshot = entry.feed.getSnapshot();
    if (snapshot === entry.last) {
      return;
    }

    const before = entry.last.finished;
    entry.last = snapshot;
    store.setSessionState(id, sessionStateOf(snapshot));
    retitle(id, entry, snapshot);
    // A command that finished is told to the window once: the feed says a new object for each.
    if (snapshot.finished !== undefined && snapshot.finished !== before && options.finished !== undefined) {
      try {
        options.finished(id, snapshot.finished, entry.generation);
      } catch (error) {
        warn('[panel] the window could not tell that a command finished', error);
      }
    }
  };

  /**
   * The entry of a terminal this page lost and may take back now (`canTakeBack`): the host's own, in a window that can attach a terminal again, whose feed is over for this page because another tab took the terminal, says that
   * tab has gone (`free`: nobody holds the terminal) and says nothing of the terminal having ended. A feed the registry let go of is never taken back.
   */
  const lostEntry = (id: SessionId): Entry | undefined => {
    const entry = entries.get(id);
    if (entry === undefined || entry.ended || entry.plugin !== HOST || options.reattach === undefined) {
      return undefined;
    }

    const status = entry.feed.getSnapshot();
    return status.state === 'ended' && offersTakeBack(status.detached) && status.exit === undefined ? entry : undefined;
  };

  /**
   * The entry of a terminal that is over for good and can be restarted (`canRestart`): the host's own, in a window that can make the target of a restart, whose feed says its process is over (`restart`: the producer's word) and is ended or
   * failed. An entry the registry has let go of is restarted all the same (a session that was stopped: its process is over, and its feed is closed already), but not one that was LEFT because the page is going away: that terminal belongs to the
   * page that comes back. One whose restart is in flight is not restartable again.
   */
  const restartEntry = (id: SessionId): { readonly entry: Entry; readonly spec: TerminalRestart } | undefined => {
    const entry = entries.get(id);
    if (entry === undefined || entry.left || entry.restarting || entry.plugin !== HOST || options.restart === undefined) {
      return undefined;
    }

    try {
      const { state } = entry.feed.getSnapshot();
      const spec = entry.feed.restart?.();
      return spec !== undefined && (state === 'ended' || state === 'failed') ? { entry, spec } : undefined;
    } catch (error) {
      warn(`[panel] ${entry.plugin} could not say whether the terminal can be restarted`, error);
      return undefined;
    }
  };

  /**
   * Puts another feed in a session in place of the one it has: makes the feed with the target the window makes for the session (the one that attaches the terminal again for a take-back, the one that starts a new terminal for a restart),
   * listens to it, and, when the session is still what it was, replaces the entry, lets the old feed go and tells whoever follows the feeds. The new feed is made and listened to before the old one is let go of, so that one that cannot be made
   * leaves the session as it was and the person can try again. `what` is what the supplier could not do, for the log. A feed made for a restart continues the one it replaced (`restartedFrom`), whose screen the body keeps. Whether a feed was published.
   */
  const replaceFeed = (session: SessionId, old: Entry, target: () => TerminalTarget, what: 'take the terminal back' | 'restart the terminal'): boolean => {
    let feed: unknown;
    try {
      feed = target().open();
    } catch (error) {
      warn(`[panel] ${old.plugin} could not ${what}`, error);
      return false;
    }

    if (!isFeed(feed)) {
      // Whatever it is, it may hold a process in the backend: close it if it can be.
      if (hasClose(feed)) {
        closeFeed(old.plugin, () => feed.close());
      }

      warn(`[panel] ${old.plugin} could not ${what}: it gave no terminal feed`);
      return false;
    }

    let first: TerminalFeedSnapshot;
    let stop: () => void;
    try {
      first = feed.getSnapshot();
      stop = feed.subscribe(() => {
        heard(session);
      });
    } catch (error) {
      closeFeed(old.plugin, (): Promise<void> | void => feed.close());
      warn(`[panel] ${old.plugin} could not ${what}`, error);
      return false;
    }

    // What ran above is the supplier's, and it may have closed the tab (a feed that calls what it is given as it is listened to): a feed is published only for the session this still is, and for a tab that is there (a registry that
    // does not hear of the panel still holds the entry of a tab that was closed). Otherwise the feed that was made is let go of, and nothing is published.
    if (entries.get(session) !== old || !Object.hasOwn(store.getSnapshot().sessions, session)) {
      try {
        stop();
      } catch (error) {
        warn(`[panel] ${old.plugin} could not stop listening to the terminal`, error);
      }

      closeFeed(old.plugin, (): Promise<void> | void => feed.close());
      return false;
    }

    // The session is the same one: its entry is replaced, with what the tab was named and what the card knows, and the feed that was lost is let go of (it sends the host nothing for a terminal it lost, and nobody hears it
    // any more). The entry is the new one before the panel hears of the first status, as when a session opens.
    const next: Entry = { plugin: old.plugin, target: old.target, resource: old.resource, feed, stop, retitle: old.retitle, title: old.title, named: old.named, last: old.last, ended: false, left: false, announced: true, taking: false, restarting: false, generation: what === 'restart the terminal' ? old.generation + 1 : old.generation };
    entries.set(session, next);
    if (what === 'restart the terminal') {
      continuations.set(feed, old.feed);
    }

    end(old);
    retitle(session, next, first);
    heard(session);
    // The session has the new feed now, and its status is written: whoever follows the feeds is told, unless the panel's listeners closed the session meanwhile (that was the change they were told of).
    if (entries.get(session) === next) {
      feedsChanged();
    }

    return true;
  };

  return {
    attach: () => {
      const stop = store.subscribe(reconcile);
      reconcile();
      return () => {
        stop();
        for (const id of [...entries.keys()]) {
          release(id, 'leave');
        }
      };
    },

    leave: () => {
      for (const entry of [...entries.values()]) {
        if (!entry.ended && typeof entry.feed.leave === 'function') {
          leaveFeed(entry);
        }
      }
    },

    refreshUnwatched: () => {
      let asked = false;
      for (const entry of [...entries.values()]) {
        if (entry.ended || typeof entry.feed.refresh !== 'function') {
          continue;
        }

        let unwatched = false;
        try {
          const status = entry.feed.getSnapshot();
          unwatched = status.state === 'ended' && status.exit === undefined && status.detached?.unwatched === true;
        } catch (error) {
          warn(`[panel] ${entry.plugin} could not ask who holds the terminal`, error);
        }

        if (unwatched) {
          asked = true;
          tellFeed(entry.plugin, (): Promise<void> | undefined => entry.feed.refresh?.({ fresh: true }), 'could not ask who holds the terminal');
        }
      }

      return asked;
    },

    open: (target, opening = {}) => {
      const plugin = text(target.plugin);
      const targetId = typeof target.id === 'string' ? target.id : '';
      if (plugin === '' || targetId.trim() === '' || text(target.title) === '' || typeof target.open !== 'function') {
        warn(`[panel] ${plugin === '' ? 'a supplier' : plugin} could not open a terminal: a target needs a plugin, an id, a title and a way to open it`);
        return undefined;
      }

      // The id of the session is the terminal's own when the target names it (T2-go: a terminal that comes back after a reload finds its tab by it), else one the registry makes. What the id stands for already is settled
      // before anything starts: a process is never started for a session that cannot have it.
      const named = target.sessionId;
      if (named !== undefined && (typeof named !== 'string' || named.trim() === '')) {
        warn(`[panel] ${plugin} could not open a terminal for ${targetId}: its session id is not an id`);
        return undefined;
      }

      const claimed: Claim = named === undefined ? { saved: undefined } : claim(named, plugin);
      if ('why' in claimed) {
        warn(`[panel] ${plugin} could not open a terminal for ${targetId}: ${claimed.why}`);
        return undefined;
      }

      const { saved } = claimed;

      let feed: unknown;
      try {
        feed = target.open();
      } catch (error) {
        warn(`[panel] ${plugin} could not open a terminal for ${targetId}`, error);
        return undefined;
      }

      if (!isFeed(feed)) {
        // Whatever it is, it may hold a process in the backend: close it if it can be.
        if (hasClose(feed)) {
          closeFeed(plugin, () => feed.close());
        }

        warn(`[panel] ${plugin} gave no terminal feed for ${targetId}: a feed has ${MEMBERS.join(', ')}`);
        return undefined;
      }

      // The registry knows the session before the panel does, so nothing that hears of the session (a render, a listener) can find it without its feed.
      const id = named ?? newId();
      let first: TerminalFeedSnapshot;
      try {
        first = feed.getSnapshot();
      } catch (error) {
        closeFeed(plugin, (): Promise<void> | void => feed.close());
        warn(`[panel] ${plugin} gave a terminal for ${targetId} whose status cannot be read`, error);
        return undefined;
      }

      // A saved tab keeps the title the person saw, and says what it was when the last run saved it (ended) until the first status is copied to it below, through the write every status takes.
      const entry: Entry = {
        plugin,
        target: targetId,
        resource: target.resource,
        feed,
        stop: () => undefined,
        retitle: target.retitle,
        title: saved?.title ?? text(target.title),
        named: saved?.titlePinned === true,
        last: saved === undefined ? first : { state: saved.state },
        ended: false,
        left: false,
        announced: false,
        taking: false,
        restarting: false,
        generation: 0,
      };
      entries.set(id, entry);
      if (saved === undefined) {
        const input = { id, plugin, title: target.title, scope: target.scope, route: target.resource?.route, ...sessionStateOf(first) };
        const opened = opening.split === undefined ? store.openSession({ ...input, tool: TERMINAL_TOOL_ID }, { reveal: opening.reveal }) : store.splitPane(TERMINAL_TOOL_ID, input, { extent: opening.split.extent, beside: opening.split.beside });
        if (opened.status === 'refused') {
          entries.delete(id);
          closeFeed(plugin, (): Promise<void> | void => feed.close());
          warn(`[panel] ${plugin} could not open a terminal for ${targetId}: ${opened.message}`);
          return undefined;
        }

        entry.title = store.getSnapshot().sessions[id]?.title ?? entry.title;
      }

      // The panel tells its listeners as the session opens, and one of them may have closed it (the registry released the entry, and with it the feed): nothing is followed or asked for then.
      if (entries.get(id) !== entry) {
        return undefined;
      }

      try {
        entry.stop = feed.subscribe(() => {
          heard(id);
        });
      } catch (error) {
        // A feed that cannot be listened to cannot be followed: a session the registry made goes with its process, and a saved tab stays as it was, ended.
        warn(`[panel] ${plugin} gave a terminal for ${targetId} that cannot be listened to`, error);
        if (saved === undefined) {
          store.closeSession(id);
        }

        release(id);
        return undefined;
      }

      if (opening.focus === true) {
        wanted.add(id);
      }

      // The first status names the session when the feed already says what it runs, and a status that changed since the first read (while the panel announced the session) is the session's state now: a subscription
      // only tells of what changes after it. For a saved tab it is the first state it has had since it was restored.
      retitle(id, entry, first);
      heard(id);
      if (entries.get(id) !== entry) {
        return undefined;
      }

      // The session has its feed now, and the panel has been written: whoever follows the feeds is told.
      entry.announced = true;
      feedsChanged();

      return {
        id,
        close: () => {
          store.closeSession(id);
        },
      };
    },

    feedOf: (session) => entries.get(session)?.feed,

    subscribeFeeds: (listener) => {
      feedListeners.add(listener);
      return () => {
        feedListeners.delete(listener);
      };
    },

    recordOf: (session) => {
      const entry = entries.get(session);
      return entry === undefined ? undefined : { id: entry.target, plugin: entry.plugin, resource: entry.resource, snapshot: entry.final ?? entry.feed.getSnapshot() };
    },

    takeFocus: (session) => wanted.delete(session),

    requestJump: (session, command, generation = 0) => {
      if (!entries.has(session)) {
        return false;
      }

      jumps.set(session, { command, generation });
      tellJumps();
      return true;
    },

    pendingJump: (session) => jumps.get(session)?.command,

    jumpGeneration: (session) => jumps.get(session)?.generation,

    takeJump: (session) => {
      const request = jumps.get(session);
      if (request !== undefined) {
        jumps.delete(session);
        tellJumps();
      }

      return request?.command;
    },

    subscribeJumps: (listener) => {
      jumpListeners.add(listener);
      return () => {
        jumpListeners.delete(listener);
      };
    },

    canTakeBack: (session) => lostEntry(session) !== undefined,

    stopOf: (session) => {
      const entry = entries.get(session);
      if (entry === undefined || entry.ended) {
        return undefined;
      }

      return () => {
        end(entry);
        store.setSessionState(session, { state: 'ended' });
      };
    },

    takeBack: async (session) => {
      const old = lostEntry(session);
      const { reattach } = options;
      if (old === undefined || reattach === undefined || old.taking) {
        return false;
      }

      // One take-back of a session at a time: a second press while the host is being asked does nothing.
      old.taking = true;
      try {
        // The page's word that nobody holds the terminal may be old (a tab may have attached it since), and attaching takes a terminal from whoever holds it: the feed that lost it asks the host and puts the answer in its status.
        await askFeed(old.plugin, (): Promise<void> | undefined => old.feed.refresh?.({ fresh: true }), 'could not ask who holds the terminal');
        // The answer came, and the session may not be what it was: its tab closed, the window stopped, the terminal ended, or somebody holds it now. Then nothing is attached.
        // The answer is the host's: a terminal it did not say is free (a holder it names, or no answer at all) is not attached, because attaching takes a terminal from whoever holds it.
        return lostEntry(session) === old && old.feed.getSnapshot().detached?.free === true && replaceFeed(session, old, () => reattach(old.feed.id ?? session, old.feed), 'take the terminal back');
      } finally {
        old.taking = false;
      }
    },

    canRestart: (session) => restartEntry(session) !== undefined,

    restart: (session) => {
      const found = restartEntry(session);
      const make = options.restart;
      if (found === undefined || make === undefined) {
        return false;
      }

      // One restart of a session at a time, and one new terminal for it: the swap is synchronous, so a press after it finds a terminal that starts, and a press inside it (what the supplier runs while the target opens) finds this flag.
      const { entry, spec } = found;
      entry.restarting = true;
      try {
        return replaceFeed(session, entry, () => make(spec, session), 'restart the terminal');
      } finally {
        entry.restarting = false;
      }
    },

    restartedFrom: (feed) => continuations.get(feed),

    canOpenExternal: () => external !== undefined,

    canFollow: (uri) => external !== undefined && isWebAddress(uri) && !isOwnServer(uri, ownOrigin()),

    openExternal: (uri) => {
      if (external === undefined) {
        return;
      }

      if (!isWebAddress(uri)) {
        warn('[terminal] the link could not be opened: only http and https addresses are opened');
        return;
      }

      if (isOwnServer(uri, ownOrigin())) {
        warn('[terminal] the link could not be opened: it points at this app\'s own server');
        return;
      }

      // The window's way is called here, before this returns, and what comes of it is the window's: a throw or a rejection is one warning, and nothing is tried again.
      void (async () => {
        try {
          await external(uri);
        } catch (error) {
          warn('[terminal] the link could not be opened', error);
        }
      })();
    },
  };
}

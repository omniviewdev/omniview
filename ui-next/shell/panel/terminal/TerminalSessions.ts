import { HOST, type PanelStore, type Session, type SessionId } from '../../core/panel';
import type { TerminalFeedHandle, TerminalFeedSnapshot, TerminalTarget } from './feed';
import { sessionStateOf } from './state';
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
};

export type OpenTerminalOptions = {
  /** The user started this session and wants the keyboard in it once its screen is ready. Default: no. */
  readonly focus?: boolean | undefined;
  /**
   * The panel opens on a session this call makes, and it becomes the one on screen (the panel's own `reveal`, S116). A terminal that is found again after a reload says `false`: a restored terminal must not cover the page.
   * A saved tab that is given its feed is never shown or moved, whatever this says. Default: true.
   */
  readonly reveal?: boolean | undefined;
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
   * Opens a session in the Terminal tool for a target: calls its `open` once, and makes the session in the panel (which opens on it). Every call is a new process, except for a target that names the id of its session
   * (`TerminalTarget.sessionId`): a terminal has one session. When the panel has a session of that id (a saved tab: the restore makes every terminal session `ended`, with no feed) the session is GIVEN the feed, stays
   * where it is under the title it has, and follows the feed from then on; when it has none, a session of that id is made. `undefined` when it could not, and why is in the log: the target is not well formed, its id names
   * a session that cannot have this terminal (another tool's or plugin's, one a plugin's unload kept, one of a plugin that is not live, or one this registry holds a terminal for already: nothing is started for any of
   * these), its `open` threw or answered something that is not a feed, or the panel refused the session (its plugin is not live); the process is closed again in the last two cases.
   */
  readonly open: (target: TerminalTarget, options?: OpenTerminalOptions) => TerminalOpened | undefined;
  /** The feed of a session the registry holds, by identity: the live one, or the closed one of a held session (A21); `undefined` for a session that has none (one that closed, one restored from the last run that no terminal was found for). */
  readonly feedOf: (session: SessionId) => TerminalFeedHandle | undefined;
  /** What the card of a session needs of its feed; `undefined` when it has none. */
  readonly recordOf: (session: SessionId) => TerminalSessionRecord | undefined;
  /** Whether the user asked for the keyboard in this session when it opened and nobody took the request yet: true once. */
  readonly takeFocus: (session: SessionId) => boolean;
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
  /** The status the registry last copied to the session. */
  last: TerminalFeedSnapshot;
  /** The registry stopped listening to the feed and closed it, and the session stays (A21): the entry is kept for the feed, which the view reads, and for the card's record, until the tab closes. Closed only once. */
  ended: boolean;
  /** The feed was told to leave, because the page is going away: its process lives on for its lease, and the end of the registry that follows must not close it or tell it again. */
  left: boolean;
  /** What the record says once the entry ended (A21: a kept session never changes again): the status at the unload, with a process that was starting or running as ended. A closed feed may say anything after. */
  final?: TerminalFeedSnapshot | undefined;
};

/** What stands where a target says its session is (`claim`): a saved tab to give the feed to, or nothing there (`saved` is undefined: a session is made), or why this terminal cannot have that id. */
type Claim = { readonly saved: Session | undefined } | { readonly why: string };

const MEMBERS = ['subscribe', 'getSnapshot', 'read', 'ack', 'write', 'resize', 'close'] as const;

/** A feed has all seven members (what it can say about what runs in it is optional). A supplier that hands over less has made a mistake the host names, and does not run. */
function isFeed(value: unknown): value is TerminalFeedHandle {
  return typeof value === 'object' && value !== null && MEMBERS.every((name) => typeof Reflect.get(value, name) === 'function');
}

/** Something that can at least be closed: what a feed that is not one may still hold in the backend. */
function hasClose(value: unknown): value is { readonly close: () => unknown } {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'close') === 'function';
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

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
  const entries = new Map<SessionId, Entry>();
  const wanted = new Set<SessionId>();

  /** Does what lets a supplier's feed go of its process (close it, leave it). An action that throws or rejects is the supplier's: it goes to the log, and the registry has let go of the feed either way. */
  const letGo = (plugin: string, action: () => unknown, failure: string): void => {
    try {
      void Promise.resolve(action()).catch((error: unknown) => {
        warn(`[panel] ${plugin} ${failure}`, error);
      });
    } catch (error) {
      warn(`[panel] ${plugin} ${failure}`, error);
    }
  };

  /** Closes a feed, which ends its process. */
  const closeFeed = (plugin: string, close: () => unknown): void => {
    letGo(plugin, close, 'could not close the terminal');
  };

  /** Tells a feed that the page is going away, once: the host holds its terminal for its lease. */
  const leaveFeed = (entry: Entry): void => {
    if (!entry.left) {
      entry.left = true;
      letGo(entry.plugin, () => entry.feed.leave?.(), 'could not let go of the terminal');
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
    if (entry === undefined) {
      return;
    }

    entries.delete(id);
    end(entry, how);
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

    entry.title = named;
    store.retitleSession(id, named);
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

    entry.last = snapshot;
    store.setSessionState(id, sessionStateOf(snapshot));
    retitle(id, entry, snapshot);
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
        last: saved === undefined ? first : { state: saved.state },
        ended: false,
        left: false,
      };
      entries.set(id, entry);
      if (saved === undefined) {
        const opened = store.openSession({ id, tool: TERMINAL_TOOL_ID, plugin, title: target.title, scope: target.scope, route: target.resource?.route, ...sessionStateOf(first) }, { reveal: opening.reveal });
        if (opened.status === 'refused') {
          entries.delete(id);
          closeFeed(plugin, (): Promise<void> | void => feed.close());
          warn(`[panel] ${plugin} could not open a terminal for ${targetId}: ${opened.message}`);
          return undefined;
        }
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

      return {
        id,
        close: () => {
          store.closeSession(id);
        },
      };
    },

    feedOf: (session) => entries.get(session)?.feed,

    recordOf: (session) => {
      const entry = entries.get(session);
      return entry === undefined ? undefined : { id: entry.target, plugin: entry.plugin, resource: entry.resource, snapshot: entry.final ?? entry.feed.getSnapshot() };
    },

    takeFocus: (session) => wanted.delete(session),
  };
}

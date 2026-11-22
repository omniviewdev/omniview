import { HOST, type PanelStore, type SessionId } from '../../core/panel';
import type { TerminalFeedHandle, TerminalFeedSnapshot, TerminalTarget } from './feed';
import { sessionStateOf } from './state';
import { TERMINAL_TOOL_ID } from './tool';

// The registry of the feeds of the Terminal tool, beside the panel model (framework-free: no React, no DOM, no xterm). A caller hands the host a TARGET (`open(target)`, the one entry point: the host's own
// shell today, a plugin's exec target one day) and the registry makes the session in the panel and owns the feed from then on, until the session goes. It is the Logs registry's sibling and keeps its rules
// (panel/logs/LogStreams.ts); what differs is said where it does:
//
//   - it copies what the feed says to what the session says (`sessionStateOf`): the card and the tab show it, whether the session is on screen or not;
//   - it closes the feed, and lets go of its own listener, when the session's tab closes, when its plugin unloads, and when the registry itself ends (the window). A session the unload ENDED is kept (A21,
//     `Session.held`): its process is ended, but its entry stays, with the very feed the view over it was made for, until the tab closes, so what a person was reading stays readable;
//   - it never reads the feed and never writes to it: the view is the one reader (a feed has one);
//   - it does NOT look for a session a target already has (A22 is the Logs tool's rule: reading one item's log twice is reading it). A press of "New terminal" is a new process, and so is a second shell in
//     the same container: two sessions of one title are twins, which the strip already tells apart;
//   - it remembers that the USER started a session and wants the keyboard in it (S116a): the body that shows the session takes the request when its screen is ready, once.
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
};

export type TerminalSessions = {
  /**
   * Starts listening to the panel: a session that closes, or a plugin that leaves, releases its process (a session the plugin's unload ended is kept: its process is ended and its entry stays until its tab
   * closes, A21). Returns what stops it, which also closes every process still open and releases every entry (the window is going). It may be attached again after it was stopped.
   */
  readonly attach: () => () => void;
  /**
   * Opens a session in the Terminal tool for a target: calls its `open` once, and makes the session in the panel (which opens on it). Every call is a new process. `undefined` when it could not, and why is in the
   * log: the target is not well formed, its `open` threw or answered something that is not a feed, or the panel refused the session (its plugin is not live); the process is closed again in the last two cases.
   */
  readonly open: (target: TerminalTarget, options?: OpenTerminalOptions) => TerminalOpened | undefined;
  /** The feed of a session the registry holds, by identity: the live one, or the closed one of a held session (A21); `undefined` for a session that has none (one that closed, one restored from the last run). */
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
  /** The status the registry last copied to the session. */
  last: TerminalFeedSnapshot;
  /** The registry stopped listening to the feed and closed it, and the session stays (A21): the entry is kept for the feed, which the view reads, and for the card's record, until the tab closes. Closed only once. */
  ended: boolean;
};

const MEMBERS = ['subscribe', 'getSnapshot', 'read', 'write', 'resize', 'close'] as const;

/** A feed has all six members. A supplier that hands over less has made a mistake the host names, and does not run. */
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

  /** Closes a feed. A close that throws or rejects is the supplier's: it goes to the log, and the feed is closed either way. */
  const closeFeed = (plugin: string, close: () => unknown): void => {
    try {
      void Promise.resolve(close()).catch((error: unknown) => {
        warn(`[panel] ${plugin} could not close the terminal`, error);
      });
    } catch (error) {
      warn(`[panel] ${plugin} could not close the terminal`, error);
    }
  };

  /**
   * Stops listening to a session's feed and closes it, and keeps the entry: the session stays and its view reads the feed it already has. Once: an entry that is ended is not closed again. It is marked first,
   * so nothing the feed publishes as it closes (a real one may tell its listeners it ended) is heard.
   */
  const end = (entry: Entry): void => {
    if (entry.ended) {
      return;
    }

    entry.ended = true;
    try {
      entry.stop();
    } catch (error) {
      // The supplier's unsubscribe is the supplier's: the feed is closed whatever it does.
      warn(`[panel] ${entry.plugin} could not stop listening to the terminal`, error);
    }

    closeFeed(entry.plugin, (): Promise<void> | void => entry.feed.close());
  };

  /** Lets a session's process go: out of the registry first (a feed that publishes as it closes finds nobody), then its listener, then the feed, unless an unload already ended it. */
  const release = (id: SessionId): void => {
    const entry = entries.get(id);
    wanted.delete(id);
    if (entry === undefined) {
      return;
    }

    entries.delete(id);
    end(entry);
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
  };

  return {
    attach: () => {
      const stop = store.subscribe(reconcile);
      reconcile();
      return () => {
        stop();
        for (const id of [...entries.keys()]) {
          release(id);
        }
      };
    },

    open: (target, opening = {}) => {
      const plugin = text(target.plugin);
      const targetId = typeof target.id === 'string' ? target.id : '';
      if (plugin === '' || targetId.trim() === '' || text(target.title) === '' || typeof target.open !== 'function') {
        warn(`[panel] ${plugin === '' ? 'a supplier' : plugin} could not open a terminal: a target needs a plugin, an id, a title and a way to open it`);
        return undefined;
      }

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

      // The registry knows the session before the panel does, so nothing that hears of the new session (a render, a listener) can find it without its feed.
      const id = newId();
      let first: TerminalFeedSnapshot;
      try {
        first = feed.getSnapshot();
      } catch (error) {
        closeFeed(plugin, (): Promise<void> | void => feed.close());
        warn(`[panel] ${plugin} gave a terminal for ${targetId} whose status cannot be read`, error);
        return undefined;
      }

      const entry: Entry = { plugin, target: targetId, resource: target.resource, feed, stop: () => undefined, last: first, ended: false };
      entries.set(id, entry);
      const opened = store.openSession({ id, tool: TERMINAL_TOOL_ID, plugin, title: target.title, scope: target.scope, route: target.resource?.route, ...sessionStateOf(first) });
      if (opened.status === 'refused') {
        entries.delete(id);
        closeFeed(plugin, (): Promise<void> | void => feed.close());
        warn(`[panel] ${plugin} could not open a terminal for ${targetId}: ${opened.message}`);
        return undefined;
      }

      try {
        entry.stop = feed.subscribe(() => {
          heard(id);
        });
      } catch (error) {
        // A feed that cannot be listened to cannot be followed: the session goes with its process.
        warn(`[panel] ${plugin} gave a terminal for ${targetId} that cannot be listened to`, error);
        store.closeSession(id);
        release(id);
        return undefined;
      }

      if (opening.focus === true) {
        wanted.add(id);
      }

      // A status that changed since the first read (while the panel announced the session) is the session's state now: a subscription only tells of what changes after it.
      heard(id);

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
      return entry === undefined ? undefined : { id: entry.target, plugin: entry.plugin, resource: entry.resource, snapshot: entry.feed.getSnapshot() };
    },

    takeFocus: (session) => wanted.delete(session),
  };
}

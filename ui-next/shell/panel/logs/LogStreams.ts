import type { LogFeedSnapshot } from '@omniviewdev/kit';
import type { PanelStore, SessionId } from '../../core/panel';
import type { LogFeedHandle, LogTarget } from './feed';
import { sessionStateOf } from './state';
import { LOGS_TOOL_ID } from './tool';

// The registry of the feeds of the Logs tool, beside the panel model (framework-free: no React, no DOM). A plugin hands the host a TARGET (`open(target)`, the one entry point: a plugin's page or command
// today, a registry and a picker one day, decision A20) and the registry makes the session in the panel and owns the feed from then on, until the session goes:
//
//   - it copies what the feed says to what the session says (`sessionStateOf`): the card and the tab show it, whether the session is on screen or not;
//   - it closes the feed, and lets go of its own listener, when the session's tab closes, when its plugin unloads, and when the registry itself ends (the window). A session the unload ENDED is kept (A21,
//     `Session.held`): its stream is closed, but its entry stays, with the very feed object the view over it was made for, until the tab closes, so the lines a person was reading stay readable; a session
//     the unload did not end (one that had ended or failed on its own) is hidden with its plugin and released with it (PO1);
//   - it never reads the feed, and never pauses it: the view is the one reader (a feed has one), and a hidden view reads nothing while the feed goes on holding its lines, bounded.
//
// A feed's status is told to the registry's listener with every held line's first wake-up too; the listener compares the status with the last it saw and writes to the panel only for a new one, so a
// stream of 10,000 lines a second is a handful of writes in its life, never one a line.

export type LogOpened = {
  /** The id the panel knows the session by. */
  readonly id: SessionId;
  /** Closes the session's tab, and with it the stream. Safe to call again. */
  readonly close: () => void;
};

/** What a session's card is made of, besides the session: what the target said of its resource, and the feed's status as it is now. */
export type LogSessionRecord = {
  /** The target's id: what is read, as its plugin names it. */
  readonly id: string;
  readonly plugin: string;
  readonly resource: LogTarget['resource'];
  readonly snapshot: LogFeedSnapshot;
};

export type LogStreamsOptions = {
  /** Makes a session id. Default: a random UUID. */
  readonly newId?: (() => SessionId) | undefined;
  /** Where the host says what it could not do for a plugin. Default: the console, with the `[panel]` prefix the panel's other messages have. */
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
};

export type LogStreams = {
  /**
   * Starts listening to the panel: a session that closes, or a plugin that leaves, releases its stream (a session the plugin's unload ended is kept: its stream is closed and its entry stays until its tab
   * closes, A21). Returns what stops it, which also closes every stream still open and releases every entry (the window is going). It may be attached again after it was stopped.
   */
  readonly attach: () => () => void;
  /**
   * Opens a session in the Logs tool for a target: calls its `open` once, and makes the session in the panel (which opens on it). `undefined` when it could not, and why is in the log: the target is not
   * well formed, the plugin's `open` threw or answered something that is not a feed, or the panel refused the session (the plugin is not live); the stream is closed again in the last two cases.
   */
  readonly open: (target: LogTarget) => LogOpened | undefined;
  /** The stream of a session the registry holds, by identity: the stream of a live session, or the closed one of a held session (A21); `undefined` for a session that has none (one that closed, one restored from the last run, one hidden with its plugin and back). */
  readonly feedOf: (session: SessionId) => LogFeedHandle | undefined;
  /** What the card of a session needs of its stream; `undefined` when it has none. */
  readonly recordOf: (session: SessionId) => LogSessionRecord | undefined;
};

type Entry = {
  readonly plugin: string;
  readonly target: string;
  readonly resource: LogTarget['resource'];
  readonly feed: LogFeedHandle;
  stop: () => void;
  /** The status the registry last copied to the session. */
  last: LogFeedSnapshot;
  /**
   * The registry stopped listening to the stream and closed it, and the session stays (A21): the entry is kept for the feed, which the view over it reads, and for the card's record, until the tab closes.
   * Nothing the closed stream says afterwards is the session's business, and it is closed only once.
   */
  ended: boolean;
};

const MEMBERS = ['subscribe', 'getSnapshot', 'read', 'stats', 'pause', 'resume', 'close'] as const;

/** A feed has all seven members. A plugin that hands over less has made a mistake the host names, and does not run. */
function isFeed(value: unknown): value is LogFeedHandle {
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
  return `log-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const consoleWarn = (message: string, error?: unknown): void => {
  if (error === undefined) {
    console.warn(message);
  } else {
    console.warn(message, error);
  }
};

export function createLogStreams(store: PanelStore, options: LogStreamsOptions = {}): LogStreams {
  const newId = options.newId ?? newUuid;
  const warn = options.warn ?? consoleWarn;
  const entries = new Map<SessionId, Entry>();

  /** Closes a feed. A close that throws or rejects is the plugin's: it goes to the log, and the feed is closed either way. */
  const closeFeed = (plugin: string, close: () => unknown): void => {
    try {
      void Promise.resolve(close()).catch((error: unknown) => {
        warn(`[panel] ${plugin} could not close the log stream`, error);
      });
    } catch (error) {
      warn(`[panel] ${plugin} could not close the log stream`, error);
    }
  };

  /**
   * Stops listening to a session's stream and closes it, and keeps the entry: the session stays and its view reads the feed it already has. Once: an entry that is ended is not closed again. It is marked
   * first, so nothing the stream publishes as it closes (a real one tells its listeners it ended) is heard.
   */
  const end = (entry: Entry): void => {
    if (entry.ended) {
      return;
    }

    entry.ended = true;
    try {
      entry.stop();
    } catch (error) {
      // The plugin's unsubscribe is the plugin's: the feed is closed whatever it does.
      warn(`[panel] ${entry.plugin} could not stop listening to the log stream`, error);
    }

    closeFeed(entry.plugin, (): Promise<void> | void => entry.feed.close());
  };

  /** Lets a session's stream go: out of the registry first (a feed that publishes as it closes finds nobody), then its listener, then the feed, unless an unload already ended it. */
  const release = (id: SessionId): void => {
    const entry = entries.get(id);
    if (entry === undefined) {
      return;
    }

    entries.delete(id);
    end(entry);
  };

  /**
   * The panel changed: a session that is gone has no use for its stream, and neither has one whose plugin is off, except that a session the unload ended and the panel kept (held, A21) is still being
   * read: its stream is closed once and its entry stays, until its tab closes.
   */
  const reconcile = (): void => {
    if (entries.size === 0) {
      return;
    }

    const state = store.getSnapshot();
    for (const [id, entry] of [...entries]) {
      if (!Object.hasOwn(state.sessions, id)) {
        release(id);
      } else if (!state.live.includes(entry.plugin)) {
        if (state.sessions[id]?.held === true) {
          end(entry);
        } else {
          release(id);
        }
      }
    }
  };

  /** A feed told its listeners something: only a new status is the session's business, and not once the registry has closed the stream (the session is ended for good, with its own cause). */
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

    open: (target) => {
      const plugin = text(target.plugin);
      const targetId = text(target.id);
      if (plugin === '' || targetId === '' || text(target.title) === '' || typeof target.open !== 'function') {
        warn(`[panel] ${plugin === '' ? 'a plugin' : plugin} could not open a log stream: a target needs a plugin, an id, a title and a way to open it`);
        return undefined;
      }

      let feed: unknown;
      try {
        feed = target.open();
      } catch (error) {
        warn(`[panel] ${plugin} could not open a log stream for ${targetId}`, error);
        return undefined;
      }

      if (!isFeed(feed)) {
        // Whatever it is, it may hold something in the backend: close it if it can be.
        if (hasClose(feed)) {
          closeFeed(plugin, () => feed.close());
        }

        warn(`[panel] ${plugin} gave no log feed for ${targetId}: a feed has ${MEMBERS.join(', ')}`);
        return undefined;
      }

      // The registry knows the session before the panel does, so nothing that hears of the new session (a render, a listener) can find it without its stream.
      const id = newId();
      let first: LogFeedSnapshot;
      try {
        first = feed.getSnapshot();
      } catch (error) {
        closeFeed(plugin, (): Promise<void> | void => feed.close());
        warn(`[panel] ${plugin} gave a log stream for ${targetId} whose status cannot be read`, error);
        return undefined;
      }

      const entry: Entry = { plugin, target: targetId, resource: target.resource, feed, stop: () => undefined, last: first, ended: false };
      entries.set(id, entry);
      const opened = store.openSession({ id, tool: LOGS_TOOL_ID, plugin, title: target.title, scope: target.scope, route: target.resource?.route, ...sessionStateOf(first) });
      if (opened.status === 'refused') {
        entries.delete(id);
        closeFeed(plugin, (): Promise<void> | void => feed.close());
        warn(`[panel] ${plugin} could not open a log stream for ${targetId}: ${opened.message}`);
        return undefined;
      }

      try {
        entry.stop = feed.subscribe(() => {
          heard(id);
        });
      } catch (error) {
        // A feed that cannot be listened to cannot be followed: the session goes with its stream.
        warn(`[panel] ${plugin} gave a log stream for ${targetId} that cannot be listened to`, error);
        store.closeSession(id);
        release(id);
        return undefined;
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
  };
}


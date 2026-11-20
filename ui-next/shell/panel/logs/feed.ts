import type { LogFeed, LogFeedSnapshot } from '@omniviewdev/kit';
import type { RouteInput } from '../../core/tabs';

// What the Logs tool of the host reads and is told, in the host's own terms. A plugin's `LogFeedV1` and `LogTargetV1` (plugins/contract/v1.ts) are the same shapes written for plugins; the shell never
// imports the contract (the contract imports the shell), so the host maps one to the other where it hands a target over (plugins/host/panelHost.ts), and a type test keeps the two apart from drifting.

/** A source a feed has heard of, as far as a card names it. */
export type LogSourceName = {
  /** What a line's `source` says. */
  readonly id: string;
};

/** The status of a feed: the kit's, and the sources it lists when it can. The same object until something in it changes. */
export type LogFeedHandleSnapshot = LogFeedSnapshot & {
  readonly sources?: readonly LogSourceName[] | undefined;
};

/**
 * The stream of a Logs session as the host holds it: what the kit's log view reads (`LogFeed`), and `close`, which the host calls once, when the session's tab closes or its plugin unloads: it
 * releases every listener and what the feed holds in the backend. A `close` that rejects or throws is logged; the feed is closed either way.
 */
export type LogFeedHandle = Pick<LogFeed, 'subscribe' | 'read' | 'stats' | 'pause' | 'resume'> & {
  readonly getSnapshot: () => LogFeedHandleSnapshot;
  readonly close: () => Promise<void> | void;
};

/**
 * What opens a Logs session: the descriptor owner decision A20 asks for. Plain data and one function. Who supplies it (a plugin's resource view or command today, a registry and a picker one day) is not
 * the host's business: `LogStreams.open` is the one entry point for all of them.
 */
export type LogTarget = {
  /** The plugin that supplies the stream, by the id it is installed under: the session is its, and it ends with the plugin. */
  readonly plugin: string;
  /** Names what is read, as the plugin knows it, and is the same each time the same thing is opened. The host keeps it with the session and does not read it. */
  readonly id: string;
  /** What the tab is called; the shell cuts a long one (SCT1). */
  readonly title: string;
  /** The muted qualifier after the title. */
  readonly scope?: string | undefined;
  /** The resource the lines belong to: its display text, the word of the card's button, its glyph and its page (a route of the tab model). */
  readonly resource?: { readonly label: string; readonly kind?: string | undefined; readonly icon?: string | undefined; readonly route?: RouteInput | undefined } | undefined;
  /** Starts the stream. Called once, when the session opens. */
  readonly open: () => LogFeedHandle;
};

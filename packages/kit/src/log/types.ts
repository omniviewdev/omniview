// The log view's vocabulary: what it reads from a feed, and what it keeps.
//
// The feed is a STRUCTURAL type. The kit knows nothing of the runtime or the host (design D2.3): `LogFeed` is the smallest shape the view needs, written
// to match the store that `openLogStream` returns in `@omniviewdev/runtime/ui/v1` (docs/ui-next/status/P1b-1.md): that stream satisfies it as it is,
// and the host proves it with `satisfies LogFeed` where it hands one over. A change to either side that breaks the match is a type error there.

/** How serious a line is, as a feed says it. A feed may give none (the backend sets none today): the view then detects one from the text. */
export type LogFeedLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** One line of a feed. Immutable: the view keeps the object and compares it by identity. */
export type LogFeedLine = {
  /** The line's number in its stream, from 1, in arrival order. A jump is a gap: the feed dropped the lines between. */
  readonly seq: number;
  /**
   * The id of the source the line came from (`orders-api/app`: the thing and the part of it that wrote the line); '' when it names none. The same string for every line of a source. The view tells sources
   * apart, with a column and a hue, only when it has heard of more than one; a line that names none is no source.
   */
  readonly source: string;
  /** When the line was written, as the RFC 3339 text the backend sent; '' when it has no time for it. */
  readonly timestamp: string;
  /** The line as it was written, with its ANSI escapes. */
  readonly text: string;
  /** The level the source gave the line; undefined when it gave none. */
  readonly level: LogFeedLevel | undefined;
};

/** What one `read` returns. */
export type LogFeedBatch = {
  /**
   * At most the `max` asked for, oldest first: in the order the feed ACCEPTED them, which is arrival order. With several sources that is not clock order (a line may carry an earlier timestamp than the
   * one before it, as a command-line tool prints the output of several streams followed at once), and the view never sorts: a live tail cannot wait for a line that may not come. Empty while the feed
   * is paused or closed, or when nothing is held.
   */
  readonly lines: readonly LogFeedLine[];
  /** How many lines the feed dropped for want of room, between the previous batch and `lines[0]`. */
  readonly dropped: number;
  /** How many lines are still held after this batch. A reader that stopped at `max` reads again while this is above 0. */
  readonly held: number;
};

/** Where a feed is. `paused` while its reads are held (the source goes on sending); `ended` and `failed` are final. */
export type LogFeedState = 'starting' | 'streaming' | 'paused' | 'ended' | 'failed';

/** Why a feed failed: where, and one sentence to show. */
export type LogFeedCause = {
  readonly stage: 'create' | 'session' | 'source';
  /** The failing source, for stage `source`. */
  readonly source?: string | undefined;
  /** One sentence: the source's own words. */
  readonly message: string;
};

/** A source a feed follows, as the feed lists it. */
export type LogFeedSource = {
  /** What a line's `source` says. */
  readonly id: string;
  /** What the view says for the source: a name that is text and is cut from its start when it does not fit (`app`, `sidecar`). The id when the feed gives none. */
  readonly label?: string | undefined;
};

/** The status of a feed. The SAME object until something in it changes: it is what `useSyncExternalStore` compares. */
export type LogFeedSnapshot = {
  readonly state: LogFeedState;
  /** True from `pause()` to `resume()`, whatever `state` says. */
  readonly paused: boolean;
  /** Why the feed failed; undefined unless `state` is `failed`. */
  readonly cause: LogFeedCause | undefined;
  /**
   * The sources the feed has heard of, in the order it heard of them. A feed that follows several lists them here, so the view has the column before a second source speaks; a feed that lists none is
   * read from its lines. The runtime's stream lists them (`LogStreamSnapshot.sources`), and what it lists satisfies this as it is.
   */
  readonly sources?: readonly LogFeedSource[] | undefined;
};

/** The feed's counters. They change with every batch and are not part of the snapshot. */
export type LogFeedStats = {
  /** Lines accepted since the feed opened, dropped ones included. */
  readonly received: number;
  /** Lines dropped because the feed was full. */
  readonly dropped: number;
  /** Lines held now, waiting for `read`. */
  readonly held: number;
  /**
   * The lines a rate may be made of: those the source says are live, counted when the feed ACCEPTED them (dropped ones included, and whether or not the view has read them), so a view that is away or slow does not
   * change it. A line the source flags as part of a replay (what it already held when the stream opened) is not live, and nor is a line of a source that has not yet said its replay is over. It only goes up. The view
   * tells the strip's rate from it and the clock, and reads no line's time and no gap to work one out: what is live is the source's to say, and a feed that is told nothing says nothing. `undefined` (or absent: a feed
   * written before this member) while it has no count (the sources are replaying, or the source never says): the strip then shows no rate, which is not 0.0 (a source that writes nothing).
   */
  readonly live?: number | undefined;
};

/**
 * The lines of one session, at the view's pace. `subscribe` and `getSnapshot` are the two functions `useSyncExternalStore` takes; `read` is how lines
 * come out. The listener runs when `getSnapshot()` changed and, once, when held lines became readable after a `read`: it must schedule a read, not do one.
 */
export type LogFeed = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => LogFeedSnapshot;
  /** Takes up to `maxLines` held lines out of the feed, oldest first. Only one reader may read a feed. */
  readonly read: (maxLines: number) => LogFeedBatch;
  readonly stats: () => LogFeedStats;
  /** Holds reads: `read` returns nothing and lines go on being held (and dropped past the feed's bound) until `resume()`. */
  readonly pause: () => void;
  /** Lets reads through again. */
  readonly resume: () => void;
};

/** The levels the view tells apart. A feed's `fatal` is an `error` here. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * Which clock a log shows its lines' times in: `local`, the viewer's own, or `utc`. The mock shows local time and offers UTC as a display option (shell-panel.js 1572 `ts: 'local'`, 2666 the Timestamps option);
 * its third choice, Hidden, comes with the toolbar that offers the choice.
 */
export type LogTimestamps = 'local' | 'utc';

/** The closed set of hues a coloured span may take: the mock's own (`.plog__a[data-hue]`), each a token of the theme. */
export type LogHue = 'red' | 'green' | 'amber' | 'blue' | 'purple' | 'cyan' | 'gray';

/** A run of a line's text with one paint: the colour an ANSI escape gave it, and whether it is bold. */
export type PaintedRun = {
  readonly text: string;
  readonly hue?: LogHue | undefined;
  readonly bold?: boolean | undefined;
};

/** A line of the log as the view keeps it. Immutable, made once at ingest; rows compare it by identity (HLT-2). */
export type LineEntry = {
  readonly kind: 'line';
  /** The entry's ordinal in this view, from 1 and never reused: stable while older entries are evicted, so a row, a selection and a match are named by it. */
  readonly n: number;
  readonly seq: number;
  readonly source: string;
  readonly timestamp: string;
  /** The text with its escapes removed: what the view searches, copies and measures. */
  readonly text: string;
  readonly level: LogLevel | undefined;
  /** The painted runs of a line that had colour or bold escapes; undefined for every other line (the common case: a plain string renders). */
  readonly runs: readonly PaintedRun[] | undefined;
};

/** Lines the feed dropped between two batches: a marker where they would have been. */
export type GapEntry = {
  readonly kind: 'gap';
  readonly n: number;
  readonly dropped: number;
};

export type LogEntry = LineEntry | GapEntry;

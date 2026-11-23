// The model of the log view: one object that reads a feed at the view's pace, keeps the buffer, its filtered view, the search, follow and selection, and
// says what the list must draw in ONE immutable snapshot that is published at most once per animation frame.
//
// Why it is not React state. A stream is 1,000 to 50,000 lines a second; React's commit is bounded by the frame rate, not the line rate, only when the
// lines never pass through it one at a time. So the lines go: feed -> `read(max)` in a frame -> entries made once -> the buffer; and only the SNAPSHOT
// (a count, a window of rows, a few flags) reaches React, through `useSyncExternalStore`. That is what the old viewer's `useLogBuffer` did with a ref and
// a version (HLT-4), kept: no copy per append, one pending frame, O(batch) per append, memory bounded.
//
// The frame. Lines held by the feed wake the model, which asks for one frame (never one per wake-up); the frame reads slices of 2,000 lines until the feed
// holds none or the frame's budget is spent (a backlog of 100,000 lines is read over frames, never in one: HLT-6), runs one slice of the search, and
// publishes if anything changed. A paused feed reads nothing and publishes nothing; the strip's clock still runs (it tells how many lines the feed holds), and a frame it asks
// for reads nothing. A feed that ends or fails while paused is let through (see `frame`): its last lines are the ones a reader needs.
//
// Follow (HLT-9). While following, the window of rows is derived from the COUNT (the last rows of the log), never from the scroll offset, so a flush
// does not depend on a scroll event that has not arrived yet; the list is asked to pin to the end with a scroll command after each commit, and the scroll
// event that pin causes is recognised as the list's own (`applied`) and is not mistaken for the reader.
//
// Scroll commands. The model never touches the DOM. When the list must move (pin to the end, show a match, keep a reader on the same line when the head
// goes) the snapshot carries a command with a new id; the list applies each id once, in a layout effect, and says where it landed.
import { makeLineEntry } from './entry';
import { LineBuffer } from './lineBuffer';
import { LineSearch, type SearchOptions, type SearchStatus } from './lineSearch';
import { LineView } from './lineView';
import { LogSources, type SourceTag } from './sources';
import { formatStamp } from './time';
import type { LogEntry, LogFeed, LogFeedState, LogTimestamps } from './types';
import { windowOf, type RowWindow } from './window';

/** The most entries a view keeps unless it is told otherwise: the cap of the old viewer (HLT-4, MNR-L2). */
export const DEFAULT_MAX_LINES = 100_000;
/** Lines of a feed read at a time: the slice that bounds one `read`, and so one allocation. */
export const READ_SLICE_LINES = 2000;
/** What a frame may spend reading the feed before it leaves the rest to the next frame, in ms. */
export const FEED_BUDGET_MS = 4;
/** What a frame may spend scanning for a search before it leaves the rest to the next frame, in ms. 2, not 3: the frames of a search measured 4 to 6 ms in WebKit and once 8.24 (budget B5: 8). */
export const SEARCH_SLICE_MS = 2;
/** Rows mounted beyond the viewport on each side (HLT-1 measured 30 against the table's 10: docs/ui-next/status/P1b-2.md has the sweep). */
export const OVERSCAN_ROWS = 10;
/** The window moves in steps of this many rows (T-02). */
export const RANGE_STEP = 4;
/** How often the strip's numbers may change on screen, in ms. */
export const STATS_INTERVAL_MS = 250;
/** The window over which the rate of a feed is told, in ms (the mock's three seconds). */
const RATE_WINDOW_MS = 3000;
/** A scroll event this close to the place the list was asked to go is the list's own (sub-pixel layout and rounding), in px. */
const OWN_SCROLL_TOLERANCE = 3;

export type ViewModelOptions = {
  /** The most entries the view keeps; older ones are dropped and counted (HLT-4: 100,000). */
  readonly maxLines: number;
  readonly now?: (() => number) | undefined;
  /** Runs `callback` at the next animation frame; returns what cancels it. */
  readonly schedule?: ((callback: () => void) => () => void) | undefined;
  /** Runs `callback` after `ms`; returns what cancels it. */
  readonly timer?: ((callback: () => void, ms: number) => () => void) | undefined;
};

/** A range of lines by ordinal. The focus is the line that moves with the arrow keys; the anchor stays. */
export type Selection = { readonly anchor: number; readonly focus: number };

/** A move the list must make. Each command has an id that was not used before; the list applies each once. */
export type ScrollCommand = { readonly id: number; readonly top: number | 'end' };

/** What a list reports with its scroll offset: the height of its box and of its content, in px, as the browser has them now. */
export type ScrollGeometry = { readonly clientHeight: number; readonly scrollHeight: number };

export type SearchSnapshot = {
  readonly options: SearchOptions;
  readonly status: SearchStatus;
  /** Lines with a match found so far. */
  readonly count: number;
  /** The pattern to mark matches with; null while there is no usable query. */
  readonly pattern: RegExp | null;
  /** The ordinal of the line of the current match; 0 when there is none. */
  readonly current: number;
  /** The place of the current match among the matches, from 1; 0 when there is none. */
  readonly position: number;
  /**
   * A bound stopped the scan: the count is not all of them, and with a count of none the log was not all searched. The cap on matches lifts when eviction takes
   * held matches away and the scan goes on; the carried engine's time guard (a slow pattern) does not lift until the query or the filter changes.
   */
  readonly capped: boolean;
};

/** One row of the window: the entry, and whether the search found a match in it. Made when the snapshot is, so a render reads no mutable state. */
export type ViewRow = {
  readonly entry: LogEntry;
  readonly hit: boolean;
  /** The tag of the line's source while the view has a source column; undefined without one, and for a line that names none and a marker. The same object for a source until its label changes (HLT-2). */
  readonly source: SourceTag | undefined;
};

export type ViewSnapshot = {
  /** A number that rises with every snapshot. */
  readonly version: number;
  /** Rows in the list: the entries the filter shows. */
  readonly count: number;
  /** Lines the view holds, whatever the filter shows: an empty list with lines behind it is a filter, not a quiet log. */
  readonly buffered: number;
  /** The rows to mount, in order, from `window.start`. Meaningful for the fixed-height list; a wrapped list is windowed by its own measures. They are in the snapshot and
   *  not read from the model during render: a render that read them by index would be cached on the window by the compiler, and at the cap (a count that has stopped
   *  growing) it would never draw a new line (T-10). */
  readonly rows: readonly ViewRow[];
  /** The window the rows are those of. */
  readonly window: RowWindow;
  readonly following: boolean;
  readonly selection: Selection | undefined;
  /** The same object until the search changed. */
  readonly search: SearchSnapshot;
  /** The latest command; the list applies it once, by its id. */
  readonly scroll: ScrollCommand | undefined;
  readonly minRank: number;
  /** The view has heard of more than one source (a line named it, or the feed lists it): every row draws its source. Once true it stays true, so the shape of the log never changes under a reader. */
  readonly sourceColumn: boolean;
};

/** What the strip says. A new object only when a number changed. */
export type StatsSnapshot = {
  /** Lines the view shows after the level filter. */
  readonly shown: number;
  /** Lines the view holds. */
  readonly total: number;
  /**
   * Lines a second that the FEED made over the last three seconds, to a tenth: the lines its producer says are live (`LogFeedStats.live`: not flagged replay, from a source whose replay is over) over the wall
   * clock, counted when the feed accepted them and not when the view read them or appended them in a frame, so a catch-up of lines the feed held while the view was away is not read as live (L1). `undefined`
   * while the feed has no such count (its sources are replaying, or it never says): the rate is not known, which is not a source that writes nothing (0).
   */
  readonly rate: number | undefined;
  /** Lines the feed holds back (a paused feed). */
  readonly held: number;
  /** Lines that came while the reader was scrolled back. */
  readonly unseen: number;
  /** Lines that were dropped and are not in the view: the ones the view evicted to stay within its bound and the ones the feed dropped before the view read them. */
  readonly dropped: number;
  /** Of `dropped`, the lines the feed dropped for want of room before the view read them (the view was not reading, or was too slow): they were never shown. */
  readonly unread: number;
  /** The most lines the view keeps, for the note that says what `dropped` is made of. */
  readonly capacity: number;
};

/** A move of the active line: by rows, by a page, or to an end. */
export type ActiveMove = number | 'home' | 'end' | 'pageUp' | 'pageDown';

/**
 * What a control beside the view reads of it (P1b-4a: the toolbar's Follow, Pause, Clear and Copy). A handful of facts and no count that a line changes, so a control that reads them is drawn again
 * when one changes and not once a frame: a stream of 10,000 lines a second moves none of them after its first lines.
 */
export type LogViewState = {
  /** The view follows the end of the log. */
  readonly following: boolean;
  /** The list draws at least one line (after the level filter). */
  readonly drawn: boolean;
  /** The view holds at least one line, whatever the level filter shows: with `drawn` false, the filter hides every one. */
  readonly held: boolean;
  /** The feed's own pause flag, whatever its state says. */
  readonly paused: boolean;
  /** Where the feed is. */
  readonly feed: LogFeedState;
};

/** What the Copy control copies: the lines as plain text, and how many lines that is (a marker is no line). */
export type LogViewCopy = { readonly text: string; readonly lines: number };

const defaultSchedule = (callback: () => void): (() => void) => {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(callback);
    return () => {
      cancelAnimationFrame(id);
    };
  }

  const id = setTimeout(callback, 16);
  return () => {
    clearTimeout(id);
  };
};

const defaultTimer = (callback: () => void, ms: number): (() => void) => {
  const id = setTimeout(callback, ms);
  return () => {
    clearTimeout(id);
  };
};

function sameStats(a: StatsSnapshot, b: StatsSnapshot): boolean {
  return (
    a.shown === b.shown &&
    a.total === b.total &&
    a.rate === b.rate &&
    a.held === b.held &&
    a.unseen === b.unseen &&
    a.dropped === b.dropped &&
    a.unread === b.unread &&
    a.capacity === b.capacity
  );
}

/**
 * The text of an entry as it is copied: the clock, the level, the text; a marker as its own sentence. The clock is the one the rows show (`timestamps`: local, or UTC with its Z). With a source `label` (a line that
 * has a source) the label comes after the level and two spaces set it off from the text, as the mock copies a line (shell-panel.js 2062 `lineText`: the clock, the level padded to five, the label, two spaces,
 * the message). The mock names the source of every line it copies, whether or not its Source column shows; a line that names none is copied without a label.
 */
export function entryText(entry: LogEntry, label?: string, timestamps: LogTimestamps = 'local'): string {
  if (entry.kind === 'gap') {
    return `-- ${entry.dropped.toLocaleString('en-US')} ${entry.dropped === 1 ? 'line' : 'lines'} dropped --`;
  }

  const clock = formatStamp(entry.timestamp, timestamps);
  if (label !== undefined && label !== '') {
    return `${clock === '' ? '' : `${clock} `}${(entry.level?.toUpperCase() ?? '').padEnd(5)} ${label}  ${entry.text}`;
  }

  return [clock, entry.level?.toUpperCase() ?? '', entry.text].filter((part, index) => part !== '' || index === 2).join(' ');
}

export class LogViewModel {
  private readonly stream: LogFeed;
  private readonly buffer: LineBuffer;
  private readonly view: LineView;
  private readonly search: LineSearch;
  private readonly sources = new LogSources();
  private readonly now: () => number;
  private readonly schedule: (callback: () => void) => () => void;
  private readonly timer: (callback: () => void, ms: number) => () => void;

  private readonly listeners = new Set<() => void>();
  private readonly statsListeners = new Set<() => void>();
  private readonly controlsListeners = new Set<() => void>();
  private snapshot: ViewSnapshot;
  private controls: LogViewState;
  private searchSnapshot: SearchSnapshot;
  private stats: StatsSnapshot;
  private revision = 0;

  private unsubscribe: (() => void) | undefined;
  private cancelFrame: (() => void) | undefined;
  private cancelStats: (() => void) | undefined;
  /** The strip's clock ran out: the next frame tells it. */
  private statsDue = false;
  /** When the strip was last told. */
  private statsAt = Number.NEGATIVE_INFINITY;

  private rowHeight = 24;
  private viewport = 0;
  private scrollTop = 0;
  private expectedTop: number | undefined;
  private following = true;
  private unseen = 0;
  private selection: Selection | undefined;
  private command: ScrollCommand | undefined;
  private commandId = 0;
  private currentMatch = 0;
  private autoCurrent = true;
  /** What the search was last asked for, and the version of its result that the last snapshot carries. */
  private options: SearchOptions = { query: '', regex: false, caseSensitive: false };
  private searchRevision = -1;
  /** The feed's count of live lines, sampled with the clock: what the rate is told from. Empty while the feed has no count. The first is the baseline. */
  private readonly arrivals: Array<{ readonly at: number; readonly live: number }> = [];
  /** The feed has a count of live lines (its producer has said a source's replay is over): there is a rate to tell, though it may be 0. */
  private rateKnown = false;
  /** The rate the strip last told: kept while there is no span long enough to tell a new one. */
  private lastRate = 0;
  /** Lines the feed dropped before the view read them: the sum of what its batches said. */
  private unread = 0;
  /** The strip has been told of lines: the first lines are told at once, the rest by the clock. */
  private toldLines = false;
  constructor(feed: LogFeed, options: ViewModelOptions) {
    this.stream = feed;
    this.buffer = new LineBuffer(options.maxLines);
    this.view = new LineView(this.buffer);
    this.now = options.now ?? (() => performance.now());
    this.search = new LineSearch(this.view, this.now);
    this.schedule = options.schedule ?? defaultSchedule;
    this.timer = options.timer ?? defaultTimer;
    this.searchSnapshot = this.makeSearchSnapshot();
    this.sample(true);
    this.sources.learn(this.stream.getSnapshot().sources);
    this.stats = this.computeStats();
    this.snapshot = this.makeSnapshot();
    this.controls = this.readControls();
  }

  // ---- what React reads ----

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): ViewSnapshot => this.snapshot;

  /** The strip's own subscription: told at most every STATS_INTERVAL_MS, and only when a number changed. */
  readonly subscribeStats = (listener: () => void): (() => void) => {
    this.statsListeners.add(listener);
    return () => {
      this.statsListeners.delete(listener);
    };
  };

  /**
   * The strip's numbers as they were last told: the same object until a tell changed them. A pure read, because React calls it twice around a commit and a store
   * whose answer moves between the two calls (the rate is a window over the clock) is torn, and React commits a second time to repair it: the bench saw two
   * commits, 0.1 ms apart, in about one frame in a hundred.
   */
  readonly getStats = (): StatsSnapshot => this.stats;

  /**
   * The facts a control beside the view reads, told when one changes and not otherwise: the same object until then. It is told in the frame that published the change, and the moment the feed says it paused,
   * resumed, ended or failed, so a control and the strip that read the feed's status are drawn in one commit.
   */
  readonly subscribeControls = (listener: () => void): (() => void) => {
    this.controlsListeners.add(listener);
    return () => {
      this.controlsListeners.delete(listener);
    };
  };

  readonly getControls = (): LogViewState => this.controls;

  /**
   * The entry at `index` of the list; the index must be inside it. For tests and tools: NEVER read it during a render. A render that reads the model by index is
   * cached by the compiler on its other inputs, and the entries behind an index change with no input changing (T-10): the snapshot carries what the list draws.
   */
  entryAt(index: number): LogEntry {
    return this.view.at(index);
  }

  // ---- the lifecycle ----

  /** Starts reading the feed. Safe to call again. */
  attach(): void {
    if (this.unsubscribe !== undefined) {
      return;
    }

    this.unsubscribe = this.stream.subscribe(this.wake);
    // A view that comes back found the feed going on without it: the lines it held are the feed's past, and the rate is what the feed makes from here on.
    this.sample(true);
    this.requestFrame();
    this.requestStats();
    // ...and perhaps paused, ended or failed meanwhile: a control reads the feed as it is now.
    this.refreshControls();
  }

  /** Stops reading, drops the feed's listener and cancels what was scheduled. The entries stay. */
  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.cancelFrame?.();
    this.cancelFrame = undefined;
    this.cancelStats?.();
    this.cancelStats = undefined;
    this.statsDue = false;
  }

  /**
   * Changes the most entries the view keeps, while it holds some. The feed gives each line once, so a model that was replaced to change the cap would lose every line the feed
   * had already given it. A larger cap keeps them all; a smaller one drops the oldest, counted as dropped as any the cap pushes out, and everything that names a line the buffer
   * no longer holds goes with it (the matches, a selection, the place of a reader scrolled back).
   */
  setMaxLines(maxLines: number): void {
    const lost = this.buffer.resize(maxLines);
    if (lost.length === 0) {
      return;
    }

    this.afterEviction(this.view.shrunk(lost));
    // The search lost the matches of the lines that went. The current one may have been among them, and a snapshot that named it would say matches were kept and none was current.
    if (this.search.version !== this.searchRevision) {
      this.pickCurrent();
    }

    this.tellSoon();
    this.publish(this.following ? 'end' : undefined);
  }

  // ---- the geometry the list reports ----

  setRowHeight(height: number): void {
    if (height === this.rowHeight || height <= 0) {
      return;
    }

    this.scrollTop = (this.scrollTop / this.rowHeight) * height;
    this.rowHeight = height;
    this.publish(this.following ? 'end' : this.scrollTop);
  }

  /** The height of the area the rows scroll in, in px (the list's height less its header). */
  setViewport(height: number): void {
    if (height === this.viewport) {
      return;
    }

    this.viewport = height;
    this.publish(this.following ? 'end' : undefined);
  }

  /**
   * The list reports its scroll offset, and the geometry the browser has for it. With the geometry the end is where the browser says it is: when a list changes
   * size the browser clamps the offset and fires a scroll event BEFORE the resize that tells the model the new height, so a model that judged the end by
   * the height it last knew would read the clamp as the reader leaving the end (found in WebKit: a log that gained 34 px of height stopped following).
   */
  onScroll(top: number, geometry?: ScrollGeometry): void {
    const own = this.expectedTop !== undefined && Math.abs(top - this.expectedTop) < OWN_SCROLL_TOLERANCE;
    this.expectedTop = undefined;
    this.scrollTop = top;
    let moved = false;
    const atEnd = geometry === undefined ? top >= this.maxTop() - 1 : geometry.scrollHeight - top - geometry.clientHeight <= 1;
    if (!own) {
      if (this.following && !atEnd) {
        this.following = false;
        moved = true;
      } else if (!this.following && atEnd && !this.stream.getSnapshot().paused) {
        this.following = true;
        this.unseen = 0;
        this.tellSoon();
        moved = true;
      }
    }

    if (moved || !this.sameWindow()) {
      this.publish(undefined);
    }
  }

  /**
   * The list moved itself to `top` because it was asked to: the scroll event that follows is not the reader. It is where the list is now, too: a wheel that goes up before that event is
   * delivered leaves the end from here (`followOff` publishes the window of the offset it has), not from the place the last event reported.
   */
  applied(top: number): void {
    this.expectedTop = top;
    this.scrollTop = top;
  }

  // ---- follow ----

  /** The reader scrolled away (the wheel went up, a key moved the list): stop following at once. */
  followOff(): void {
    if (this.following) {
      this.following = false;
      this.publish(undefined);
    }
  }

  /** Back to the live end of the log: follow again, and let the feed's lines through if it was paused. */
  jumpToLatest(): void {
    this.following = true;
    this.unseen = 0;
    this.tellSoon();
    if (this.stream.getSnapshot().paused) {
      this.stream.resume();
    }

    this.publish('end');
  }

  // ---- what the toolbar does ----

  /**
   * Clear (the toolbar's): the view forgets everything made so far, as the mock's `logClear` does (shell-panel.js 2083-2090: its buffer, its view and its queue are emptied and its dropped count is 0). What the view holds,
   * what it had evicted and the marker of lines the feed dropped before it are all lines of the past: none is counted as dropped, because a reader cleared them, and what the feed drops or the view evicts from now is
   * told as it comes. What the feed holds and the view has not read was made before the clear too (a feed that is paused holds the lines that came while it was, a feed that is going holds the lines of the last frame,
   * and a drop it made that the view had not yet been told of is among them): it is read and thrown away, so that the lines which come after the clear are the only ones shown, as the mock's queue is emptied. A feed that
   * is paused stays paused. The search keeps its query and looks at the lines that come, the level filter stays, the selection goes with its lines, and the list is asked to go to the end (while it follows) or to its
   * top (a reader who had scrolled back has nothing to be scrolled back in). Ordinals go on, so nothing that named a cleared line can name a new one. A view with nothing to forget, and a feed that holds nothing, is
   * left as it is: no snapshot, no frame.
   */
  clear(): void {
    const held = this.stream.stats().held;
    if (this.buffer.length === 0 && this.view.length === 0 && this.unread === 0 && this.buffer.evictedLines === 0 && held === 0) {
      return;
    }

    if (held > 0) {
      this.discardHeld();
    }

    this.buffer.clear();
    this.view.reset();
    this.search.restart();
    this.pickCurrent();
    this.autoCurrent = true;
    this.selection = undefined;
    this.unseen = 0;
    this.unread = 0;
    this.scrollTop = 0;
    this.expectedTop = undefined;
    this.tellSoon();
    this.publish(this.following ? 'end' : 0);
  }

  /** Holds the feed's reads, or lets them through again (the toolbar's Pause): the pause is the feed's, which goes on holding the lines it is sent. Asks the feed nothing when it already is as asked. */
  setPaused(paused: boolean): void {
    if (this.stream.getSnapshot().paused === paused) {
      return;
    }

    if (paused) {
      this.stream.pause();
    } else {
      this.stream.resume();
    }
  }

  // ---- the level filter ----

  setMinRank(rank: number): void {
    this.view.setMinRank(rank);
    this.search.restart();
    this.currentMatch = 0;
    this.autoCurrent = true;
    this.tellSoon();
    this.publish(this.following ? 'end' : undefined);
  }

  // ---- search ----

  setSearch(options: SearchOptions): void {
    this.options = options;
    this.search.configure(options);
    this.currentMatch = 0;
    this.autoCurrent = true;
    this.requestFrame();
    this.publish(undefined);
  }

  /** Moves to the next (1) or previous (-1) match, wrapping, and asks the list to show it in the middle. Returns false when there is none. */
  stepMatch(direction: 1 | -1): boolean {
    const count = this.search.count;
    if (count === 0) {
      return false;
    }

    const current = this.currentMatch;
    let next: number;
    if (current === 0 || !this.search.hit(current)) {
      next = direction > 0 ? this.search.at(0) : this.search.at(count - 1);
    } else if (direction > 0) {
      next = this.search.after(current) ?? this.search.at(0);
    } else {
      next = this.search.before(current) ?? this.search.at(count - 1);
    }

    this.currentMatch = next;
    this.autoCurrent = false;
    this.following = false;
    const index = this.view.lowerBound(next);
    this.scrollTop = this.clampTop(index * this.rowHeight - this.viewport / 2 + this.rowHeight / 2);
    this.publish(this.scrollTop);
    return true;
  }

  // ---- selection ----

  /** Selects the line `n`; with `extend`, from the line already selected. */
  select(n: number, extend: boolean): void {
    this.selection = extend && this.selection !== undefined ? { anchor: this.selection.anchor, focus: n } : { anchor: n, focus: n };
    this.publish(undefined);
  }

  selectAll(): void {
    if (this.view.length === 0) {
      return;
    }

    this.selection = { anchor: this.view.ordinalAt(0), focus: this.view.ordinalAt(this.view.length - 1) };
    this.publish(undefined);
  }

  /** Moves the active line (the selection's focus); with `extend` the range grows, else it is the one line. Keeps it in view. */
  moveActive(move: ActiveMove, extend: boolean): void {
    const count = this.view.length;
    if (count === 0) {
      return;
    }

    if (move === 'end') {
      const last = this.view.ordinalAt(count - 1);
      this.selection = extend && this.selection !== undefined ? { anchor: this.selection.anchor, focus: last } : { anchor: last, focus: last };
      this.jumpToLatest();
      return;
    }

    const top = this.effectiveTop();
    // The rows in view are the rows the viewport touches, one cut by its top or its bottom included (the mock's `visibleRows`: a page is that many less one), not the rows that fit whole.
    const rows = Math.max(1, Math.ceil((top + this.viewport) / this.rowHeight) - Math.floor(top / this.rowHeight));
    const firstVisible = Math.min(count - 1, Math.floor(top / this.rowHeight));
    let index: number;
    if (this.selection === undefined) {
      // Nothing is active: a move down starts at the first line in view, a move up at the last. The last is the row at the viewport's bottom edge, a row that edge cuts included:
      // it comes from the top plus the height, not from how many whole rows fit, because a list scrolled by part of a row shows part of one more.
      const lastVisible = Math.min(count - 1, Math.max(firstVisible, Math.ceil((top + this.viewport) / this.rowHeight) - 1));
      index = move === 'home' ? 0 : typeof move === 'number' && move < 0 ? lastVisible : move === 'pageUp' ? lastVisible : firstVisible;
    } else {
      // `place` is where the active line is, or would be: the first row at or after it. A line the level filter hides is between two rows, and `place` is the one after it, so
      // a step down from it is already there, and every other move counts from that place.
      const place = this.view.lowerBound(this.selection.focus);
      const hidden = place >= count || this.view.ordinalAt(place) !== this.selection.focus;
      const page = Math.max(1, rows - 1);
      const by = move === 'pageUp' ? -page : move === 'pageDown' ? page : typeof move === 'number' ? move : 0;
      index = move === 'home' ? 0 : place + by - (hidden && by > 0 ? 1 : 0);
    }

    index = Math.min(count - 1, Math.max(0, index));
    const ordinal = this.view.ordinalAt(index);
    this.selection = extend && this.selection !== undefined ? { anchor: this.selection.anchor, focus: ordinal } : { anchor: ordinal, focus: ordinal };
    this.reveal(index);
  }

  /**
   * The selected lines as plain text, a line each, or undefined with no selection. A line that has a source is copied with its name, a log of one source included: what a copy says does not depend on
   * whether the view has a column for it (the mock's `lineText` names the source of every line). The clock is the one the rows show: the viewer's own by default, or UTC with its Z.
   */
  copyText(timestamps: LogTimestamps = 'local'): string | undefined {
    return this.textOfSelection(timestamps)?.text;
  }

  /**
   * What the Copy control copies: every line the list draws, as the mock's toolbar Copy writes the lines of its view (`copyLogs`, shell-panel.js 2063-2070: the level filter applies, a line it hides is neither drawn nor
   * copied; a marker is written as its own sentence and is no line). A selection does not narrow it: the keyboard's copy is the selection's (the list's `copy` event, `copyText`; the mock's keyboard copy writes the
   * active line, 3091-3096). The text is the one the keyboard's copy writes, a line each, the source of every line that has one included, in the clock the rows show. Undefined when the list draws no line.
   */
  copyLines(timestamps: LogTimestamps = 'local'): LogViewCopy | undefined {
    return this.textOfRows(0, this.view.length, timestamps);
  }

  /** The text of the selected range, or undefined with no selection, or when none of its lines is in the list. */
  private textOfSelection(timestamps: LogTimestamps): { readonly text: string; readonly lines: number } | undefined {
    const selection = this.selection;
    if (selection === undefined) {
      return undefined;
    }

    const low = Math.min(selection.anchor, selection.focus);
    const high = Math.max(selection.anchor, selection.focus);
    const from = this.view.lowerBound(low);
    let to = from;
    while (to < this.view.length && this.view.ordinalAt(to) <= high) {
      to += 1;
    }

    return this.textOfRows(from, to, timestamps);
  }

  /** The rows `from` up to `to` of the list as text, a row each, and how many of them are lines; undefined when none is a line. */
  private textOfRows(from: number, to: number, timestamps: LogTimestamps): { readonly text: string; readonly lines: number } | undefined {
    const rows: string[] = [];
    let lines = 0;
    for (let index = from; index < to; index += 1) {
      const entry = this.view.at(index);
      if (entry.kind === 'line') {
        lines += 1;
      }

      rows.push(entryText(entry, entry.kind === 'line' ? this.sources.tag(entry.source)?.label : undefined, timestamps));
    }

    return lines === 0 ? undefined : { text: rows.join('\n'), lines };
  }

  // ---- the frame ----

  /** The feed woke us: a frame will read it. */
  private readonly wake = (): void => {
    this.sample(false);
    this.requestFrame();
    this.requestStats();
    this.refreshControls();
  };

  private requestFrame(): void {
    if (this.cancelFrame === undefined && this.unsubscribe !== undefined) {
      this.cancelFrame = this.schedule(() => {
        this.cancelFrame = undefined;
        this.frame();
      });
    }
  }

  /** Reads what the feed holds, to the last line, and throws it away. A paused feed returns nothing to a read, so it is let through for the reads and held again after them: the lines that come after are held as before. */
  private discardHeld(): void {
    const paused = this.stream.getSnapshot().paused;
    if (paused) {
      this.stream.resume();
    }

    while (this.stream.read(READ_SLICE_LINES).lines.length > 0) {
      // Each slice is dropped as it is read: nothing of it is kept.
    }

    if (paused) {
      this.stream.pause();
    }
  }

  private frame(): void {
    const started = this.now();
    // What the feed lists of its sources is read first: a listing and the lines that came with it are one snapshot, and the series follows the listing's order. It is read here and not in a listener, because
    // the frame is the one place the view changes.
    let changed = this.sources.learn(this.stream.getSnapshot().sources);
    let again = false;

    // A feed that is over while it is paused still holds lines (`paused` stays true "whatever `state` says"), and they are the last the reader will get: the error before a
    // failure, the shutdown before an end. Nothing can resume a finished log, so the view leaves the pause for the reader: the held lines are read below, to the same cap as any
    // others (the oldest past it are counted as dropped, a drop the feed made is a marker), and the state reads `ended` or `failed` with its cause.
    const feed = this.stream.getSnapshot();
    if (feed.paused && (feed.state === 'ended' || feed.state === 'failed')) {
      this.stream.resume();
    }

    if (!this.stream.getSnapshot().paused) {
      const evictedBefore = this.buffer.evicted;
      let shift = 0;
      let lines = 0;
      for (;;) {
        const batch = this.stream.read(READ_SLICE_LINES);
        if (batch.dropped > 0) {
          this.unread += batch.dropped;
          shift += this.append({ kind: 'gap', n: this.buffer.next, dropped: batch.dropped });
          changed = true;
        }

        for (const line of batch.lines) {
          this.sources.note(line.source);
          shift += this.append(makeLineEntry(line, this.buffer.next));
        }

        lines += batch.lines.length;
        if (batch.lines.length > 0) {
          changed = true;
        }

        if (batch.lines.length === 0 || batch.held === 0) {
          break;
        }

        if (this.now() - started >= FEED_BUDGET_MS) {
          again = true;
          break;
        }
      }

      if (lines > 0) {
        if (!this.following) {
          this.unseen += lines;
        }

        // The first lines the strip could tell of are told at once: it was told (empty) when the view started, and its clock would leave it saying `0 lines` over lines that are drawn.
        if (!this.toldLines) {
          this.toldLines = true;
          this.statsDue = true;
        }
      }

      // The buffer lost entries whether or not the list showed them: a level filter hides lines, and an ordinal that names a line the buffer no longer holds
      // must not outlive it. `shift` is only what the LIST lost.
      if (this.buffer.evicted > evictedBefore) {
        this.afterEviction(shift);
      }
    }

    if (this.search.step(SEARCH_SLICE_MS)) {
      again = true;
    }

    if (this.search.version !== this.searchRevision) {
      this.pickCurrent();
      changed = true;
    }

    if (changed) {
      this.publish(this.following ? 'end' : undefined);
    }

    if (again) {
      this.requestFrame();
    }

    // The strip is told HERE, in the frame, so its commit is the list's own (MNR-L2); the first frame tells at once and then at most every interval. The clock
    // below only asks for a frame when none is coming (a rate that decays, a paused feed's held lines).
    const at = this.now();
    if (this.statsDue || at - this.statsAt >= STATS_INTERVAL_MS) {
      this.statsDue = false;
      this.statsAt = at;
      if (this.tellStats() || (this.rateKnown && this.lastRate > 0) || this.stream.getSnapshot().paused) {
        this.requestStats();
      }
    } else {
      this.requestStats();
    }
  }

  /** Puts an entry at the end of the buffer and in the view; returns how many entries left the head of the view. */
  private append(entry: LogEntry): number {
    const evicted = this.buffer.push(entry);
    return this.view.pushed(entry, evicted);
  }

  /**
   * The head of the buffer lost entries, and the list lost `shift` of them (fewer when a level filter hid some): the matches of those lines go, a selection is
   * clipped to what the buffer still holds, and a reader scrolled back stays on their line by the rows of the list that left, and moves for none when none did.
   */
  private afterEviction(shift: number): void {
    this.search.trim(this.buffer.first);
    this.selection = this.clip(this.selection);
    if (shift > 0 && !this.following) {
      this.scrollTop = Math.max(0, this.scrollTop - shift * this.rowHeight);
      this.issue(this.scrollTop);
    }
  }

  private clip(selection: Selection | undefined): Selection | undefined {
    if (selection === undefined) {
      return undefined;
    }

    const first = this.buffer.first;
    if (Math.max(selection.anchor, selection.focus) < first) {
      return undefined;
    }

    return selection.anchor >= first && selection.focus >= first ? selection : { anchor: Math.max(selection.anchor, first), focus: Math.max(selection.focus, first) };
  }

  /** The match that is current unless the reader chose one: the newest while following, else the first at or after the line they read. */
  private pickCurrent(): void {
    this.searchRevision = this.search.version;
    if (this.search.count === 0) {
      this.currentMatch = 0;
      return;
    }

    if (!this.autoCurrent && this.search.hit(this.currentMatch)) {
      return;
    }

    if (this.following) {
      this.currentMatch = this.search.at(this.search.count - 1);
      return;
    }

    const first = this.view.ordinalAt(Math.min(this.view.length - 1, Math.floor(this.scrollTop / this.rowHeight)));
    this.currentMatch = this.search.after(first - 1) ?? this.search.at(this.search.count - 1);
  }

  /** Scrolls the least that shows the row `index`; following ends when that leaves the end of the log, and begins when it reaches it. */
  private reveal(index: number): void {
    const top = this.effectiveTop();
    const rowTop = index * this.rowHeight;
    let next = top;
    if (rowTop < top) {
      next = rowTop;
    } else if (rowTop + this.rowHeight > top + this.viewport) {
      next = rowTop + this.rowHeight - this.viewport;
    }

    if (next === top) {
      this.publish(undefined);
      return;
    }

    this.scrollTop = this.clampTop(next);
    this.following = this.scrollTop >= this.maxTop() - 1;
    if (this.following) {
      this.unseen = 0;
      this.tellSoon();
    }

    this.publish(this.scrollTop);
  }

  // ---- geometry helpers ----

  private maxTop(): number {
    return Math.max(0, this.view.length * this.rowHeight - this.viewport);
  }

  private clampTop(top: number): number {
    return Math.min(Math.max(0, top), this.maxTop());
  }

  /** Where the list is scrolled to: the end of the log while following, else where the reader left it. */
  private effectiveTop(): number {
    return this.following ? this.maxTop() : this.scrollTop;
  }

  private computeWindow(): RowWindow {
    return windowOf({
      count: this.view.length,
      rowHeight: this.rowHeight,
      viewport: this.viewport,
      scrollTop: this.effectiveTop(),
      overscan: OVERSCAN_ROWS,
      step: RANGE_STEP,
    });
  }

  private sameWindow(): boolean {
    const next = this.computeWindow();
    return next.start === this.snapshot.window.start && next.end === this.snapshot.window.end && this.view.length === this.snapshot.count;
  }

  // ---- publishing ----

  /** Records a scroll command (a place, or the end), without publishing. */
  private issue(top: number | 'end'): void {
    this.commandId += 1;
    this.command = { id: this.commandId, top };
  }

  private makeSearchSnapshot(): SearchSnapshot {
    const search = this.search;
    return {
      options: this.options,
      status: search.status,
      count: search.count,
      pattern: search.pattern,
      current: this.currentMatch,
      position: this.currentMatch === 0 ? 0 : search.indexOf(this.currentMatch) + 1,
      capped: search.status === 'capped',
    };
  }

  private makeSnapshot(): ViewSnapshot {
    const window = this.computeWindow();
    const pattern = this.searchSnapshot.pattern;
    const sourceColumn = this.sources.count > 1;
    const rows: ViewRow[] = [];
    for (let index = window.start; index < window.end; index += 1) {
      const entry = this.view.at(index);
      const line = entry.kind === 'line';
      rows.push({ entry, hit: line && pattern !== null && this.search.hit(entry.n), source: sourceColumn && line ? this.sources.tag(entry.source) : undefined });
    }

    return {
      version: this.revision,
      count: this.view.length,
      buffered: this.buffer.lines,
      rows,
      window,
      following: this.following,
      selection: this.selection,
      search: this.searchSnapshot,
      scroll: this.command,
      minRank: this.view.rank,
      sourceColumn,
    };
  }

  /** Publishes a snapshot and tells the listeners; `command` is the place the list must go to, if it must move. */
  private publish(command: number | 'end' | undefined): void {
    if (command !== undefined) {
      this.issue(command);
    }

    const next = this.makeSearchSnapshot();
    const previous = this.searchSnapshot;
    if (
      next.status !== previous.status ||
      next.count !== previous.count ||
      next.current !== previous.current ||
      next.position !== previous.position ||
      next.pattern !== previous.pattern ||
      next.options !== previous.options
    ) {
      this.searchSnapshot = next;
    }

    this.revision += 1;
    this.snapshot = this.makeSnapshot();
    for (const listener of [...this.listeners]) {
      listener();
    }

    this.refreshControls();
    this.requestStats();
  }

  // ---- the controls ----

  private readControls(): LogViewState {
    const feed = this.stream.getSnapshot();
    return { following: this.following, drawn: this.view.lineCount > 0, held: this.buffer.lines > 0, paused: feed.paused, feed: feed.state };
  }

  /** Reads what a control reads and tells its listeners when one of the five moved: a line that arrives moves none of them after the first. */
  private refreshControls(): void {
    const next = this.readControls();
    const was = this.controls;
    if (was.following === next.following && was.drawn === next.drawn && was.held === next.held && was.paused === next.paused && was.feed === next.feed) {
      return;
    }

    this.controls = next;
    for (const listener of [...this.controlsListeners]) {
      listener();
    }
  }

  // ---- the strip ----

  /**
   * Starts the series of the feed's count of live lines against the clock. `fresh`: from the feed's count now (the view starts or comes back, and the lines the feed counted before are its past). Otherwise it is the
   * feed's wake-up, and a sample is taken only when the last is older than the window, which is a feed that was quiet and speaks: from the last count, which the quiet left unchanged, so the lines that woke it
   * are counted, and from now, so the quiet is not. The clock's tells take every other sample. A feed with no count (`live` undefined: its sources are replaying, or it never says) has no series: the rate is
   * not known, and it starts again from the count the feed gives when it has one.
   */
  private sample(fresh: boolean): void {
    const live = this.stream.stats().live;
    if (live === undefined) {
      this.loseRate();
      return;
    }

    const at = this.now();
    const last = this.arrivals.at(-1);
    if (this.rateKnown && !fresh && last !== undefined && at - last.at < RATE_WINDOW_MS) {
      return;
    }

    // A rate that was not known has no count to continue from: it starts from the one the feed gives now. A view that starts or comes back starts from it too.
    const count = fresh || last === undefined || !this.rateKnown ? live : last.live;
    this.startRate(at, count);
  }

  /** The feed has no count of live lines: no rate is known, and no series is kept for the next one. */
  private loseRate(): void {
    this.arrivals.length = 0;
    this.rateKnown = false;
    this.lastRate = 0;
  }

  /** The series starts at `at` from `live`. A rate that was not known reads 0.0 until a span long enough exists (the mock's strip reads 0.0 before its first live lines); one that was keeps what it last told. */
  private startRate(at: number, live: number): void {
    this.arrivals.length = 0;
    this.arrivals.push({ at, live });
    this.rateKnown = true;
  }

  private computeStats(): StatsSnapshot {
    const at = this.now();
    const feed = this.stream.stats();
    if (feed.live === undefined) {
      this.loseRate();
    } else if (!this.rateKnown) {
      this.startRate(at, feed.live);
    } else {
      // The baseline is the newest sample that is at least a window old, else the oldest: the series is the feed's counter against the wall clock, taken at each tell.
      while ((this.arrivals.at(1)?.at ?? Number.POSITIVE_INFINITY) <= at - RATE_WINDOW_MS) {
        this.arrivals.shift();
      }

      const base = this.arrivals.at(0);
      if (base !== undefined && at - base.at >= STATS_INTERVAL_MS) {
        this.lastRate = Math.round(((feed.live - base.live) / ((at - base.at) / 1000)) * 10) / 10;
      }

      this.arrivals.push({ at, live: feed.live });
    }

    return {
      shown: this.view.lineCount,
      total: this.buffer.lines,
      rate: this.rateKnown ? this.lastRate : undefined,
      held: feed.held,
      unseen: this.unseen,
      dropped: this.buffer.evictedLines + this.unread,
      unread: this.unread,
      capacity: this.buffer.capacity,
    };
  }

  /** Takes the strip's numbers as they are now and tells its listeners when one moved; returns whether one did. */
  private tellStats(): boolean {
    const next = this.computeStats();
    if (sameStats(this.stats, next)) {
      return false;
    }

    this.stats = next;
    for (const listener of [...this.statsListeners]) {
      listener();
    }

    return true;
  }

  /**
   * Arms the strip's clock: after STATS_INTERVAL_MS the strip is DUE, and a frame tells it. It is not told from the timer: a timer is its own task, and a commit in
   * it would be one more than the frame's own (MNR-L2: at most one commit a frame whatever the rate; the bench counted 64 a second at 60 frames).
   */
  private requestStats(): void {
    if (this.cancelStats !== undefined || this.unsubscribe === undefined) {
      return;
    }

    this.cancelStats = this.timer(() => {
      this.cancelStats = undefined;
      this.statsDue = true;
      this.requestFrame();
    }, STATS_INTERVAL_MS);
  }

  /** A person's action changed a number the strip counts (the minimum level, the end reached): the next frame tells it, not the clock. */
  private tellSoon(): void {
    this.statsDue = true;
    this.requestFrame();
  }
}

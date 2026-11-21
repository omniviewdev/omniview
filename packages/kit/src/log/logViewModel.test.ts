// The model of the log view: the feed read at the view's pace, the buffer and its view, follow, selection and search, behind one snapshot that changes at most
// once a frame (HLT-4, HLT-6, HLT-9, HLT-10; MNR-L2, L3, L4, L6). These tests drive it with a feed written here and a clock and a frame scheduler they own,
// so every assertion is about work done and snapshots published, never about time.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_CHUNK_LINES } from './lineSearch';
import { LogViewModel, READ_SLICE_LINES, SEARCH_SLICE_MS, type ViewModelOptions } from './logViewModel';
import { MAX_MATCH_COUNT, SEARCH_TIME_BUDGET_MS } from './regexSafety';
import type { LogFeed, LogFeedBatch, LogFeedCause, LogFeedLevel, LogFeedLine, LogFeedSnapshot, LogFeedSource, LogFeedState } from './types';
import { countText } from './words';

const ROW = 24;
const VIEWPORT = 600;

class Frames {
  now = 0;
  private readonly queue = new Map<number, () => void>();
  private next = 1;
  schedule = (callback: () => void): (() => void) => {
    const id = this.next++;
    this.queue.set(id, callback);
    return () => {
      this.queue.delete(id);
    };
  };

  get pending(): number {
    return this.queue.size;
  }

  /** Runs the frame callbacks that are waiting, as one animation frame does, and moves the clock a frame on. */
  frame(): void {
    const callbacks = [...this.queue.values()];
    this.queue.clear();
    this.now += 16;
    callbacks.forEach((callback) => {
      callback();
    });
  }

  /** Frames until nothing is waiting; fails on a loop that never ends. */
  settle(limit = 5000): number {
    let frames = 0;
    while (this.pending > 0) {
      this.frame();
      frames += 1;
      if (frames > limit) {
        throw new Error('frames that never end');
      }
    }

    return frames;
  }
}

class FakeFeed implements LogFeed {
  reads: number[] = [];
  subscribers = 0;
  received = 0;
  private readonly lines: LogFeedLine[] = [];
  private readonly listeners = new Set<() => void>();
  private pendingDrops = 0;
  private droppedTotal = 0;
  private status: LogFeedSnapshot = { state: 'streaming', paused: false, cause: undefined };
  private seq = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.subscribers += 1;
    return () => {
      this.listeners.delete(listener);
      this.subscribers -= 1;
    };
  };

  getSnapshot = (): LogFeedSnapshot => this.status;
  read = (max: number): LogFeedBatch => {
    this.reads.push(max);
    if (this.status.paused) {
      return { lines: [], dropped: 0, held: this.lines.length };
    }

    const lines = this.lines.splice(0, max);
    const dropped = this.pendingDrops;
    if (lines.length > 0) {
      this.pendingDrops = 0;
    }

    return { lines, dropped: lines.length > 0 ? dropped : 0, held: this.lines.length };
  };

  stats = () => ({ received: this.received, dropped: this.droppedTotal, held: this.lines.length });
  pause = (): void => {
    this.set({ ...this.status, paused: true, state: 'paused' });
  };

  /** Like the runtime's stream: a pause lifted on a feed that is over leaves it over (`state` is `ended` or `failed` whatever `paused` says). */
  resume = (): void => {
    this.set({ ...this.status, paused: false, state: this.status.state === 'paused' ? 'streaming' : this.status.state });
  };

  /** Lines arrive; the listener is told once, as the runtime's stream does. */
  push(texts: readonly string[], level?: LogFeedLevel): void {
    for (const text of texts) {
      this.seq += 1;
      this.lines.push({ seq: this.seq, source: 'src', timestamp: '2024-01-15T10:30:00.000Z', text, level });
    }

    this.received += texts.length;
    this.wake();
  }

  /** Lines of one source arrive, each with the clock the test gives it (default: the same instant for every line); the listener is told once. */
  pushFrom(source: string, texts: readonly string[], level?: LogFeedLevel, timestamp = '2024-01-15T10:30:00.000Z'): void {
    for (const text of texts) {
      this.seq += 1;
      this.lines.push({ seq: this.seq, source, timestamp, text, level });
    }

    this.received += texts.length;
    this.wake();
  }

  /** The feed lists its sources (what the runtime's stream does as it hears of them): a new status, and every listener is told. */
  list(sources: readonly LogFeedSource[]): void {
    this.set({ ...this.status, sources });
  }

  /** Like the runtime's stream: lines it had to drop were accepted first, so they are counted as received, and the next read tells of them. */
  drop(count: number): void {
    this.pendingDrops += count;
    this.droppedTotal += count;
    this.received += count;
  }

  wake(): void {
    [...this.listeners].forEach((listener) => {
      listener();
    });
  }

  set(next: LogFeedSnapshot): void {
    this.status = next;
    this.wake();
  }

  /**
   * The feed ends or fails WHILE PAUSED. The runtime's stream keeps `paused` true "whatever `state` says" (`LogFeedSnapshot.paused`): a session that is over is
   * still held, and `read` returns nothing until `resume()`.
   */
  finishPaused(state: Extract<LogFeedState, 'ended' | 'failed'>, cause?: LogFeedCause): void {
    this.set({ state, paused: true, cause });
  }

  finish(state: Extract<LogFeedState, 'ended' | 'failed'>, cause?: LogFeedCause): void {
    this.set({ state, paused: false, cause });
  }
}

function setup(over: Partial<ViewModelOptions> = {}) {
  const frames = new Frames();
  const feed = new FakeFeed();
  const timers: Array<() => void> = [];
  const model = new LogViewModel(feed, {
    maxLines: 100_000,
    now: () => frames.now,
    schedule: frames.schedule,
    timer: (callback) => {
      timers.push(callback);
      return () => {
        timers.splice(timers.indexOf(callback), 1);
      };
    },
    ...over,
  });
  model.setRowHeight(ROW);
  model.setViewport(VIEWPORT);
  const published: unknown[] = [];
  model.subscribe(() => {
    published.push(model.getSnapshot());
  });
  model.attach();
  /** The strip's numbers once its clock has run out and the frame it asked for has told them. */
  const strip = () => {
    frames.now += 300;
    timers.splice(0).forEach((fire) => {
      fire();
    });
    frames.settle();
    return model.getStats();
  };

  return { frames, feed, model, published, strip };
}

const numbered = (count: number, from = 1, text = 'line') => Array.from({ length: count }, (_, index) => `${text} ${from + index}`);

describe('reading the feed', () => {
  it('reads what the feed already holds on the first frame, and nothing before it', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(30));
    expect(model.getSnapshot().count).toBe(0);
    expect(frames.pending).toBe(1);
    frames.frame();
    expect(model.getSnapshot().count).toBe(30);
  });

  it('wakes once for any number of wake-ups before a frame: five batches in a frame are one frame, one read pass and one snapshot (MNR-L2)', () => {
    const { frames, feed, published, model } = setup();
    for (let batch = 0; batch < 5; batch += 1) {
      feed.push(numbered(100, batch * 100 + 1));
    }

    expect(frames.pending).toBe(1);
    frames.frame();
    expect(published.length).toBe(1);
    expect(model.getSnapshot().count).toBe(500);
    expect(frames.pending).toBe(0);
  });

  it('publishes nothing per line: 100 batches of 100 lines in one frame are one snapshot (MNR-L2)', () => {
    const { frames, feed, published, model } = setup();
    for (let batch = 0; batch < 100; batch += 1) {
      feed.push(numbered(100, batch * 100 + 1));
    }

    frames.frame();
    expect(published.length).toBe(1);
    expect(model.getSnapshot().count).toBe(10_000);
  });

  it('reads in slices of the size it says, and keeps reading while lines are held', () => {
    const { frames, feed } = setup();
    feed.push(numbered(READ_SLICE_LINES * 2 + 5));
    frames.frame();
    expect(feed.reads.slice(0, 3)).toEqual([READ_SLICE_LINES, READ_SLICE_LINES, READ_SLICE_LINES]);
  });

  it('checks its budget between slices: once a slice has crossed it the rest of a backlog waits for the next frame, so a long backlog never holds a frame for all of it (HLT-6)', () => {
    // Every read costs the clock 1.5 ms. The budget is read AFTER a slice, so a frame may end up to one slice past it: with a 4 ms budget a frame reads three slices (4.5 ms), not four.
    const frames = new Frames();
    const feed = new FakeFeed();
    let clock = 0;
    const model = new LogViewModel(feed, { maxLines: 100_000, now: () => clock, schedule: frames.schedule, timer: () => () => undefined });
    const read = feed.read;
    feed.read = (max) => {
      clock += 1.5;
      return read(max);
    };

    model.setRowHeight(ROW);
    model.setViewport(VIEWPORT);
    model.attach();
    feed.push(numbered(READ_SLICE_LINES * 10));
    frames.frame();
    expect(feed.reads.length).toBeLessThanOrEqual(3);
    expect(model.getSnapshot().count).toBeLessThan(READ_SLICE_LINES * 10);
    expect(frames.pending).toBe(1);
    frames.settle();
    expect(model.getSnapshot().count).toBe(READ_SLICE_LINES * 10);
  });

  it('holds 100,000 lines at most and counts what it dropped (HLT-4)', () => {
    const { frames, feed, model, strip } = setup({ maxLines: 1000 });
    feed.push(numbered(2500));
    frames.settle();
    expect(model.getSnapshot().count).toBe(1000);
    expect(model.entryAt(0).n).toBe(1501);
    const stats = strip();
    expect(stats.dropped).toBe(1500);
    expect(stats.total).toBe(1000);
  });

  it('puts a marker where the feed says it dropped lines, before the lines that followed', () => {
    const { frames, feed, model, strip } = setup();
    feed.push(numbered(3));
    frames.settle();
    feed.drop(7);
    feed.push(numbered(2, 4));
    frames.settle();
    const kinds = Array.from({ length: model.getSnapshot().count }, (_, index) => model.entryAt(index));
    expect(kinds.map((entry) => entry.kind)).toEqual(['line', 'line', 'line', 'gap', 'line', 'line']);
    expect(kinds[3]).toMatchObject({ kind: 'gap', dropped: 7 });
    // The marker is not a line: the strip counts five lines.
    expect(strip().total).toBe(5);
  });

  it('reads nothing while the feed is paused and publishes no snapshot: the frame queue is empty once it has settled (HLT-6, MNR-L6)', () => {
    const { frames, feed, model, published } = setup();
    feed.push(numbered(10));
    frames.settle();
    published.length = 0;
    const reads = feed.reads.length;
    feed.pause();
    frames.settle();
    published.length = 0;
    feed.push(numbered(500, 11));
    frames.settle();
    expect(published.length).toBe(0);
    expect(model.getSnapshot().count).toBe(10);
    expect(frames.pending).toBe(0);
    // A paused feed is not read at all: the frames that ran while it was paused asked it for nothing.
    expect(feed.reads.length).toBe(reads);
    feed.resume();
    frames.settle();
    expect(model.getSnapshot().count).toBe(510);
  });

  it('stops reading and drops its listener on detach, and starts again on attach', () => {
    const { frames, feed, model } = setup();
    expect(feed.subscribers).toBe(1);
    feed.push(numbered(5));
    model.detach();
    expect(feed.subscribers).toBe(0);
    expect(frames.pending).toBe(0);
    model.attach();
    expect(feed.subscribers).toBe(1);
    frames.settle();
    expect(model.getSnapshot().count).toBe(5);
  });
});

describe('a feed that ends or fails while it is paused', () => {
  // The runtime's stream keeps `paused` true "whatever `state` says", and a paused feed's `read` returns nothing. The lines it held when it ended are the last the reader
  // will ever get, and those are the lines most needed (the error before a failure, the shutdown before an end): the view leaves the pause, reads them, and the state reads
  // ended or failed with its cause. Nothing is left that could resume a finished log.
  it('reads what it held when the feed ENDS paused, and the feed is no longer paused', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10));
    frames.settle();
    feed.pause();
    feed.push(numbered(5, 11));
    frames.settle();
    expect(model.getSnapshot().count).toBe(10);
    feed.finishPaused('ended');
    frames.settle();
    expect(model.getSnapshot().count).toBe(15);
    expect(model.entryAt(14)).toMatchObject({ n: 15, text: 'line 15' });
    expect(feed.getSnapshot()).toMatchObject({ state: 'ended', paused: false });
    expect(frames.pending).toBe(0);
  });

  it('reads what it held when the feed FAILS paused, and the state reads failed with its cause', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10));
    frames.settle();
    feed.pause();
    feed.push(['the last line before the failure'], 'error');
    frames.settle();
    expect(model.getSnapshot().count).toBe(10);
    const cause: LogFeedCause = { stage: 'session', message: 'the connection to the source was lost' };
    feed.finishPaused('failed', cause);
    frames.settle();
    expect(model.getSnapshot().count).toBe(11);
    expect(model.entryAt(10)).toMatchObject({ text: 'the last line before the failure' });
    expect(feed.getSnapshot()).toMatchObject({ state: 'failed', paused: false, cause });
  });

  it('leaves a feed that is paused and still running alone: the pause is the reader\'s until the feed is over', () => {
    const { frames, feed, model } = setup();
    feed.pause();
    feed.push(numbered(5));
    frames.settle();
    expect(model.getSnapshot().count).toBe(0);
    expect(feed.getSnapshot()).toMatchObject({ state: 'paused', paused: true });
  });

  it('holds a feed that failed paused with more lines than the view keeps to the same cap: the oldest are counted as dropped, and the strip says so', () => {
    const { frames, feed, model, strip } = setup({ maxLines: 100 });
    feed.pause();
    feed.push(numbered(250));
    frames.settle();
    expect(model.getSnapshot().count).toBe(0);
    feed.finishPaused('failed', { stage: 'session', message: 'it failed' });
    frames.settle();
    expect(model.getSnapshot().count).toBe(100);
    expect(model.entryAt(0).n).toBe(151);
    expect(model.entryAt(99)).toMatchObject({ n: 250, text: 'line 250' });
    expect(strip().dropped).toBe(150);
  });

  it('shows the drop marker of a feed that dropped lines while it was paused and then ended: the marker comes first, then the lines the feed kept', () => {
    const { frames, feed, model } = setup({ maxLines: 100 });
    feed.push(numbered(10));
    frames.settle();
    feed.pause();
    // The feed kept 80 of the lines that came while it was paused and dropped 30 before them.
    feed.drop(30);
    feed.push(numbered(80, 41));
    frames.settle();
    feed.finishPaused('ended');
    frames.settle();
    expect(model.getSnapshot().count).toBe(91);
    expect(model.entryAt(10)).toMatchObject({ kind: 'gap', dropped: 30 });
    expect(model.entryAt(11)).toMatchObject({ kind: 'line', text: 'line 41' });
    expect(model.entryAt(90)).toMatchObject({ kind: 'line', text: 'line 120' });
  });
});

describe('a cap that changes while lines are held', () => {
  // The feed gives each line once, so a model that is replaced to change the cap has lost every line the feed already gave it. The cap is the model's to change.
  it('keeps every line it holds when the cap goes up, and holds more after it', () => {
    const { frames, feed, model, strip } = setup({ maxLines: 300 });
    feed.push(numbered(300));
    frames.settle();
    model.setMaxLines(600);
    expect(model.getSnapshot().count).toBe(300);
    expect(model.entryAt(0).n).toBe(1);
    feed.push(numbered(250, 301));
    frames.settle();
    expect(model.getSnapshot().count).toBe(550);
    expect(strip().dropped).toBe(0);
  });

  it('drops the oldest lines when the cap goes down, counts them as dropped, and keeps the newest', () => {
    const { frames, feed, model, strip } = setup({ maxLines: 300 });
    feed.push(numbered(300));
    frames.settle();
    model.setMaxLines(100);
    expect(model.getSnapshot().count).toBe(100);
    expect(model.entryAt(0).n).toBe(201);
    expect(model.entryAt(99).n).toBe(300);
    expect(strip().dropped).toBe(200);
    // It is a buffer of 100 from now on.
    feed.push(numbered(10, 301));
    frames.settle();
    expect(model.getSnapshot().count).toBe(100);
    expect(model.entryAt(0).n).toBe(211);
    expect(strip().dropped).toBe(210);
  });

  it('cuts what refers to the lines that went: their matches, a selection inside them, and the place of a reader scrolled back, who stays on the line they read', () => {
    const { frames, feed, model } = setup({ maxLines: 1000 });
    feed.push(numbered(1000));
    frames.settle();
    model.setSearch({ query: 'line', regex: false, caseSensitive: false });
    frames.settle();
    expect(model.getSnapshot().search.count).toBe(1000);
    model.select(10, false);
    // The reader is at line 800, at the top of the list.
    model.followOff();
    model.onScroll(24 * 799);
    model.setMaxLines(400);
    const snapshot = model.getSnapshot();
    expect([snapshot.count, model.entryAt(0).n]).toEqual([400, 601]);
    expect(snapshot.search.count).toBe(400);
    expect(snapshot.selection).toBeUndefined();
    // Line 800 was row 799 and is row 199: the list is asked to go there, and the reader does not move.
    expect(snapshot.scroll?.top).toBe(24 * 199);
    expect(snapshot.following).toBe(false);
  });

  it('follows the end when it was following, and publishes the new count once', () => {
    const { frames, feed, model, published } = setup({ maxLines: 300 });
    feed.push(numbered(300));
    frames.settle();
    published.length = 0;
    model.setMaxLines(100);
    expect(published.length).toBe(1);
    expect(model.getSnapshot()).toMatchObject({ count: 100, following: true, scroll: { top: 'end' } });
    // The same cap again does nothing.
    model.setMaxLines(100);
    expect(published.length).toBe(1);
  });

  it('applies to a level filter: the lines it hides go too, and the lines it shows are counted from what is left', () => {
    const { frames, feed, model } = setup({ maxLines: 200 });
    feed.push(numbered(100, 1, 'warn'), 'warn');
    feed.push(numbered(100, 101, 'info'), 'info');
    frames.settle();
    model.setMinRank(2);
    expect(model.getSnapshot().count).toBe(100);
    // 150 lines go: the 100 warnings and 50 of the infos are in them.
    model.setMaxLines(50);
    expect(model.getSnapshot().count).toBe(0);
    expect(model.getSnapshot().buffered).toBe(50);
    model.setMinRank(0);
    expect(model.getSnapshot().count).toBe(50);
  });

  // The search's current match is the model's, and a cap that takes the line it names must not leave the snapshot naming it: two matches kept, `current` a line that is gone and `position` 0
  // would be published until the next frame. The model picks another before it publishes, as a frame that evicts does.
  it('picks another current match at once when a smaller cap takes the one the reader stepped to, so the snapshot never names a line the buffer no longer holds', () => {
    const { frames, feed, model } = setup({ maxLines: 100 });
    feed.push(numbered(50));
    frames.settle();
    model.setSearch({ query: 'line', regex: false, caseSensitive: false });
    frames.settle();
    // The newest match is the current one while following; the reader steps round to the first.
    model.stepMatch(1);
    expect(model.getSnapshot().search).toMatchObject({ count: 50, current: 1, position: 1 });
    model.setMaxLines(20);
    const { search } = model.getSnapshot();
    expect(search.count).toBe(20);
    expect(search.current).toBe(31);
    expect(search.position).toBe(1);
  });
});

describe('the snapshot', () => {
  it('is the same object until something it says changed, and a scroll inside the window changes nothing (T-05)', () => {
    const { frames, feed, model, published } = setup();
    feed.push(numbered(5000));
    frames.settle();
    model.followOff();
    model.onScroll(24 * 2000);
    const before = model.getSnapshot();
    const count = published.length;
    // Inside the window: no row boundary of the window moves.
    model.onScroll(24 * 2000 + 1);
    model.onScroll(24 * 2000 + 12);
    model.onScroll(24 * 2000 + 23);
    expect(model.getSnapshot()).toBe(before);
    expect(published.length).toBe(count);
    model.onScroll(24 * 2000 + 24 * 40);
    expect(model.getSnapshot()).not.toBe(before);
  });

  it('carries the rows of its window: at the cap the count and the window stop and the rows go on (T-10)', () => {
    const { frames, feed, model } = setup({ maxLines: 500 });
    feed.push(numbered(500));
    frames.settle();
    const full = model.getSnapshot();
    expect(full.count).toBe(500);
    expect(full.rows.map((row) => row.entry.n)).toEqual(Array.from({ length: full.window.end - full.window.start }, (_, index) => full.window.start + 1 + index));
    expect(full.rows.at(-1)?.entry).toMatchObject({ n: 500, text: 'line 500' });
    feed.push(numbered(20, 501));
    frames.settle();
    const later = model.getSnapshot();
    // The count and the window did not move; the lines behind them did.
    expect(later.count).toBe(500);
    expect(later.window).toEqual(full.window);
    expect(later.rows.at(-1)?.entry).toMatchObject({ n: 520, text: 'line 520' });
    expect(later.rows[0]?.entry.n).toBe((full.rows[0]?.entry.n ?? 0) + 20);
  });
});

describe('follow (HLT-9)', () => {
  it('follows from the start: the window is the end of the log, the last line is in it, and each flush asks the list to stay there', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10_000));
    frames.settle();
    const snapshot = model.getSnapshot();
    expect(snapshot.following).toBe(true);
    expect(snapshot.window.end).toBe(10_000);
    expect(snapshot.scroll).toMatchObject({ top: 'end' });
    const first = snapshot.scroll?.id ?? 0;
    feed.push(numbered(100, 10_001));
    frames.settle();
    expect(model.getSnapshot().window.end).toBe(10_100);
    expect(model.getSnapshot().scroll?.id).toBeGreaterThan(first);
  });

  it('stops following when the reader scrolls up, and the window stays where it was while lines come', () => {
    const { frames, feed, model, strip } = setup();
    feed.push(numbered(10_000));
    frames.settle();
    model.onScroll(24 * 10_000 - VIEWPORT - 24 * 200);
    expect(model.getSnapshot().following).toBe(false);
    const window = model.getSnapshot().window;
    const asked = model.getSnapshot().scroll?.id;
    feed.push(numbered(500, 10_001));
    frames.settle();
    expect(model.getSnapshot().window).toEqual(window);
    // No new command: the list is not asked to move.
    expect(model.getSnapshot().scroll?.id).toBe(asked);
    // The strip says how many came meanwhile.
    expect(strip().unseen).toBe(500);
  });

  it('follows again when the reader scrolls back to the end, and not before', () => {
    const { frames, feed, model, strip } = setup();
    feed.push(numbered(10_000));
    frames.settle();
    model.onScroll(24 * 9000);
    expect(model.getSnapshot().following).toBe(false);
    model.onScroll(24 * 10_000 - VIEWPORT - 30);
    expect(model.getSnapshot().following).toBe(false);
    model.onScroll(24 * 10_000 - VIEWPORT);
    expect(model.getSnapshot().following).toBe(true);
    expect(strip().unseen).toBe(0);
  });

  it('does not take the scroll the list made itself for a reader scrolling away: a pin to the end and its scroll event are not the reader', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10_000));
    frames.settle();
    const top = 24 * 10_000 - VIEWPORT;
    // The list pinned and says where it landed; the scroll event that follows reports the same place.
    model.applied(top);
    model.onScroll(top);
    expect(model.getSnapshot().following).toBe(true);
    // A scroll event a pixel or two off the place it was asked for (sub-pixel layout) is still its own.
    model.applied(top);
    model.onScroll(top - 1);
    expect(model.getSnapshot().following).toBe(true);
  });

  it('knows where the list is once it has moved itself, so a wheel that comes before the scroll event of a pin leaves the window at the end, where the list is', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10_000));
    frames.settle();
    // The list pinned to the end and says where it landed; the scroll event that follows has not been delivered, and the wheel goes up first.
    model.applied(24 * 10_000 - VIEWPORT);
    model.followOff();
    expect(model.getSnapshot().following).toBe(false);
    expect(model.getSnapshot().window.end).toBe(10_000);
  });

  it('takes the end from the geometry the list reports: the browser clamps the offset when the list grows and fires a scroll event before the resize that tells the model', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(1000));
    frames.settle();
    // The list became 34 px taller: its end is 34 px nearer than the model, which still holds the old viewport, thinks.
    const geometry = { clientHeight: VIEWPORT + 25 + 34, scrollHeight: 24 * 1000 + 25 };
    model.onScroll(geometry.scrollHeight - geometry.clientHeight, geometry);
    expect(model.getSnapshot().following).toBe(true);
    // Judged by the viewport the model last knew, the same event reads as the reader leaving the end.
    model.onScroll(geometry.scrollHeight - geometry.clientHeight);
    expect(model.getSnapshot().following).toBe(false);
  });

  it('leaves at once when the wheel goes up, before any scroll event says so', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10_000));
    frames.settle();
    model.followOff();
    expect(model.getSnapshot().following).toBe(false);
  });

  it('jumps to the latest line and follows again', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10_000));
    frames.settle();
    model.onScroll(0);
    expect(model.getSnapshot().following).toBe(false);
    model.jumpToLatest();
    expect(model.getSnapshot().following).toBe(true);
    expect(model.getSnapshot().window.end).toBe(10_000);
    expect(model.getSnapshot().scroll).toMatchObject({ top: 'end' });
  });

  it('keeps a reader on the line they read when the head goes: the scroll moves up by the rows that left', () => {
    const { frames, feed, model } = setup({ maxLines: 1000 });
    feed.push(numbered(1000));
    frames.settle();
    model.onScroll(24 * 500);
    expect(model.getSnapshot().following).toBe(false);
    feed.push(numbered(40, 1001));
    frames.settle();
    expect(model.getSnapshot().scroll).toEqual({ id: expect.any(Number), top: 24 * 500 - 24 * 40 });
  });

  it('moves a reader scrolled back only when a row of the list left: a line the filter hid that the head lost asks the list for nothing', () => {
    const { frames, feed, model } = setup({ maxLines: 100 });
    feed.push(['quiet'], 'info');
    feed.push(numbered(99, 2, 'warn'), 'warn');
    frames.settle();
    model.setMinRank(2);
    model.onScroll(24 * 10);
    expect(model.getSnapshot().following).toBe(false);
    const asked = model.getSnapshot().scroll?.id;
    // The head loses line 1, which the list does not show: no row left it, and the reader's place is where it was.
    feed.push(['quiet again'], 'info');
    frames.settle();
    expect(model.getSnapshot().scroll?.id).toBe(asked);
    // The head loses three lines the list shows: the rows above the reader go, and the list is asked to move up by three.
    feed.push(numbered(3, 101, 'warn'), 'warn');
    frames.settle();
    expect(model.getSnapshot().scroll).toEqual({ id: expect.any(Number), top: 24 * 10 - 24 * 3 });
  });
});

describe('the level filter', () => {
  it('shows the lines at or above a level, counts them apart from the buffer, and learns of new ones', () => {
    const { frames, feed, model, strip } = setup();
    feed.push(['a', 'b', 'c'], 'info');
    feed.push(['d'], 'warn');
    feed.push(['e', 'f'], 'error');
    frames.settle();
    expect(model.getSnapshot().count).toBe(6);
    model.setMinRank(2);
    expect(model.getSnapshot().count).toBe(3);
    expect(model.entryAt(0)).toMatchObject({ text: 'd', level: 'warn' });
    expect(strip()).toMatchObject({ shown: 3, total: 6 });
    feed.push(['g'], 'info');
    feed.push(['h'], 'error');
    frames.settle();
    expect(model.getSnapshot().count).toBe(4);
    model.setMinRank(0);
    expect(model.getSnapshot().count).toBe(8);
  });
});

describe('search (HLT-10, MNR-L4)', () => {
  const literal = (query: string) => ({ query, regex: false, caseSensitive: false });

  it('scans over frames and finds the lines, one result object per change and none for a scroll', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(5000, 1, 'row'));
    frames.settle();
    const snapshotBefore = model.getSnapshot();
    model.setSearch(literal('row 4'));
    frames.settle();
    const search = model.getSnapshot().search;
    expect(search.status).toBe('done');
    // 4, 40-49, 400-499, 4000-4999
    expect(search.count).toBe(1 + 10 + 100 + 1000);
    expect(model.getSnapshot()).not.toBe(snapshotBefore);
    const again = model.getSnapshot().search;
    model.onScroll(24 * 100);
    expect(model.getSnapshot().search).toBe(again);
  });

  it('picks a current match: the newest while following, and counts it among the matches', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(100, 1, 'row'));
    frames.settle();
    model.setSearch(literal('row 7'));
    frames.settle();
    const search = model.getSnapshot().search;
    // row 7, 70-79: eleven matches; following, so the newest is current.
    expect(search.count).toBe(11);
    expect(search.position).toBe(11);
    expect(model.entryAt(model.getSnapshot().count - 1).n).toBe(100);
  });

  it('steps to the next and the previous match, wraps, stops following and asks the list to show the line', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10_000, 1, 'row'));
    frames.settle();
    model.setSearch(literal('row 5000'));
    frames.settle();
    feed.push(['row 5000 again']);
    frames.settle();
    model.setSearch(literal('row 50'));
    frames.settle();
    const count = model.getSnapshot().search.count;
    expect(count).toBeGreaterThan(2);
    model.stepMatch(1);
    expect(model.getSnapshot().following).toBe(false);
    const first = model.getSnapshot().search.position;
    expect(first).toBe(1);
    expect(model.getSnapshot().scroll?.top).toEqual(expect.any(Number));
    model.stepMatch(-1);
    expect(model.getSnapshot().search.position).toBe(count);
    model.stepMatch(1);
    expect(model.getSnapshot().search.position).toBe(1);
  });

  it('puts the matching line in the middle of the viewport', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10_000, 1, 'row'));
    frames.settle();
    model.setSearch(literal('row 3000'));
    frames.settle();
    model.stepMatch(1);
    const line = model.entryAt(3000 - 1);
    expect(line.n).toBe(3000);
    const top = model.getSnapshot().scroll?.top;
    expect(top).toBe(24 * (3000 - 1) - VIEWPORT / 2 + 24 / 2);
  });

  it('reports an invalid pattern, and nothing for an empty query', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10));
    frames.settle();
    model.setSearch({ query: '(', regex: true, caseSensitive: false });
    expect(model.getSnapshot().search.status).toBe('invalid');
    model.setSearch(literal(''));
    expect(model.getSnapshot().search.status).toBe('idle');
  });

  it('scans only the lines that come after the first pass, and drops the matches of lines that left (HLT-10)', () => {
    const { frames, feed, model } = setup({ maxLines: 1000 });
    feed.push(numbered(1000, 1, 'hit'));
    frames.settle();
    model.setSearch(literal('hit'));
    frames.settle();
    expect(model.getSnapshot().search.count).toBe(1000);
    feed.push(numbered(10, 1001, 'miss'));
    frames.settle();
    expect(model.getSnapshot().search.count).toBe(990);
    feed.push(numbered(10, 1011, 'hit'));
    frames.settle();
    expect(model.getSnapshot().search.count).toBe(990);
  });

  it('starts the scan over for a new level, over the lines that level shows', () => {
    const { frames, feed, model } = setup();
    feed.push(['needle a'], 'info');
    feed.push(['needle b'], 'error');
    frames.settle();
    model.setSearch(literal('needle'));
    frames.settle();
    expect(model.getSnapshot().search.count).toBe(2);
    model.setMinRank(3);
    frames.settle();
    expect(model.getSnapshot().search.count).toBe(1);
  });

  it('keeps finding matches after eviction took the held ones from under the cap: the cap bounds what is held, not the life of the stream', () => {
    const { frames, feed, model } = setup({ maxLines: MAX_MATCH_COUNT });
    feed.push(numbered(MAX_MATCH_COUNT, 1, 'needle'));
    frames.settle();
    model.setSearch(literal('needle'));
    frames.settle();
    expect(model.getSnapshot().search).toMatchObject({ status: 'capped', capped: true, count: MAX_MATCH_COUNT });
    // A whole buffer of lines that miss comes: every held match goes with the head, and nothing is left for the search to be stopped by.
    feed.push(numbered(MAX_MATCH_COUNT, MAX_MATCH_COUNT + 1, 'quiet'));
    frames.settle();
    expect(model.getSnapshot().search).toMatchObject({ status: 'done', capped: false, count: 0 });
    // A line that matches and comes later is found.
    feed.push(['needle late']);
    frames.settle();
    expect(model.getSnapshot().search).toMatchObject({ status: 'done', capped: false, count: 1, position: 1, current: 2 * MAX_MATCH_COUNT + 1 });
  });

  it('says a search the time guard stopped before it found a line is stopped, not empty: the snapshot is capped with nothing found, and the count text is not "No results"', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(600));
    frames.settle();
    // The carried engine reads its clock at the end of a chunk of 512 lines: a clock that has jumped past its budget by then stops it there.
    let readings = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (readings++ === 0 ? 0 : SEARCH_TIME_BUDGET_MS + 1));
    try {
      model.setSearch(literal('needle'));
      frames.settle();
    } finally {
      clock.mockRestore();
    }

    const search = model.getSnapshot().search;
    expect(search).toMatchObject({ status: 'capped', capped: true, count: 0, position: 0, current: 0 });
    expect(countText(search)).toBe('Search stopped');
  });
});

describe('selection and copy (HLT-18)', () => {
  it('selects a line, extends to another, and copies the lines as plain text, a line each, with their clock and level (lines that name no source: with one, the copy carries its name)', () => {
    const { frames, feed, model } = setup();
    feed.pushFrom('', ['first', 'second', 'third'], 'info');
    feed.pushFrom('', ['fourth'], 'error');
    frames.settle();
    model.select(2, false);
    expect(model.getSnapshot().selection).toEqual({ anchor: 2, focus: 2 });
    model.select(4, true);
    expect(model.getSnapshot().selection).toEqual({ anchor: 2, focus: 4 });
    const clock = (text: string) => text.replace(/^\d\d:\d\d:\d\d\.\d{3}/, 'HH:MM:SS.mmm');
    expect(model.copyText()?.split('\n').map(clock)).toEqual(['HH:MM:SS.mmm INFO second', 'HH:MM:SS.mmm INFO third', 'HH:MM:SS.mmm ERROR fourth']);
  });

  describe('the clock', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // The mock copies the clock of the viewer's own zone (`lineText` takes `clock(l.t)`, shell-panel.js 2062) and shows UTC, when asked, with a Z (1708). A copy says what the row said: local without a mark, UTC with its Z.
    it('is the viewer\'s local clock with no mark of a zone by default', () => {
      vi.stubEnv('TZ', 'Asia/Kolkata');
      const { frames, feed, model } = setup();
      feed.pushFrom('', ['first'], 'info', '2024-01-15T10:30:00.123Z');
      frames.settle();
      model.selectAll();
      expect(model.copyText()).toBe('16:00:00.123 INFO first');
      expect(model.copyText('local')).toBe('16:00:00.123 INFO first');
    });

    it('is the UTC clock with its Z when the view shows UTC, whatever zone the viewer is in, with a source too', () => {
      vi.stubEnv('TZ', 'Asia/Kolkata');
      const { frames, feed, model } = setup();
      feed.pushFrom('', ['first'], 'info', '2024-01-15T10:30:00.123Z');
      feed.pushFrom('svc/app', ['second'], 'warn', '2024-01-15T10:30:01.000+02:00');
      frames.settle();
      model.selectAll();
      expect(model.copyText('utc')?.split('\n')).toEqual(['10:30:00.123Z INFO first', '08:30:01.000Z WARN  svc/app  second']);
    });

    it('leaves a line with no time with no clock, and no lone Z, in UTC as in local', () => {
      const { frames, feed, model } = setup();
      feed.pushFrom('', ['first'], 'info', '');
      frames.settle();
      model.selectAll();
      expect(model.copyText('utc')).toBe('INFO first');
      expect(model.copyText('local')).toBe('INFO first');
    });
  });

  it('writes a marker as a line of its own', () => {
    const { frames, feed, model } = setup();
    feed.push(['a']);
    frames.settle();
    feed.drop(3);
    feed.push(['b']);
    frames.settle();
    model.selectAll();
    expect(model.copyText()?.split('\n')[1]).toBe('-- 3 lines dropped --');
  });

  it('moves the active line by rows and pages, to the ends, and keeps it in view', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(1000));
    frames.settle();
    model.moveActive(1, false);
    // Nothing was active: the first line of the viewport is.
    expect(model.getSnapshot().selection).toEqual({ anchor: 976, focus: 976 });
    model.moveActive(1, false);
    expect(model.getSnapshot().selection?.focus).toBe(977);
    model.moveActive(-1, false);
    expect(model.getSnapshot().selection?.focus).toBe(976);
    model.moveActive('home', false);
    expect(model.getSnapshot().selection?.focus).toBe(1);
    expect(model.getSnapshot().following).toBe(false);
    model.moveActive('end', false);
    expect(model.getSnapshot().selection?.focus).toBe(1000);
    expect(model.getSnapshot().following).toBe(true);
    model.moveActive('pageUp', false);
    expect(model.getSnapshot().selection?.focus).toBe(1000 - 24);
    model.moveActive('pageDown', false);
    expect(model.getSnapshot().selection?.focus).toBe(1000);
  });

  it('starts a move up from nothing at the last row in view, a row cut by the bottom of the viewport included: that is the bottom (top plus height), not the rows that fit', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(1000));
    frames.settle();
    model.followOff();
    // A whole number of rows down: the rows in view are 11 to 35 (600 px of 24), and the last is 35.
    model.onScroll(24 * 10);
    model.moveActive(-1, false);
    expect(model.getSnapshot().selection).toEqual({ anchor: 35, focus: 35 });

    // 13 px further: row 0 of the view is cut at the top, and the row at 600 to 624 px shows its first 13 px at the bottom of the 600 px viewport.
    const other = setup();
    other.feed.push(numbered(1000));
    other.frames.settle();
    other.model.followOff();
    other.model.onScroll(13);
    other.model.moveActive(-1, false);
    expect(other.model.getSnapshot().selection).toEqual({ anchor: 26, focus: 26 });
  });

  it('pages by the rows the viewport touches, one cut by its top or its bottom included, less one (the mock\'s `visibleRows`): 137 px of 24 touch six rows at the end of the log and at the top, seven 13 px down', () => {
    // The offset at the end is 100 rows of 24 less 137: 2263 px, so rows 95 to 100 touch the viewport, the first by 17 px of its 24 (the mock's table shows it so under its header).
    const end = setup();
    end.feed.push(numbered(100));
    end.frames.settle();
    end.model.setViewport(137);
    end.model.select(98, false);
    end.model.moveActive('pageUp', false);
    expect(end.model.getSnapshot().selection?.focus).toBe(93);

    // At the top six rows touch the 137 px (5.7 rows): a page is five.
    const top = setup();
    top.feed.push(numbered(100));
    top.frames.settle();
    top.model.setViewport(137);
    top.model.followOff();
    top.model.onScroll(0);
    top.model.select(1, false);
    top.model.moveActive('pageDown', false);
    expect(top.model.getSnapshot().selection?.focus).toBe(6);

    // 13 px down the first row is cut at the top and a seventh row shows its last pixels at the bottom: a page is six.
    const down = setup();
    down.feed.push(numbered(100));
    down.frames.settle();
    down.model.setViewport(137);
    down.model.followOff();
    down.model.onScroll(13);
    down.model.select(1, false);
    down.model.moveActive('pageDown', false);
    expect(down.model.getSnapshot().selection?.focus).toBe(7);
  });

  it('does not run past the last row when the log is shorter than the viewport', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(7));
    frames.settle();
    model.moveActive(-1, false);
    expect(model.getSnapshot().selection).toEqual({ anchor: 7, focus: 7 });
  });

  it('moves down from a selection the level filter hides to the first row that passes, not the second: the place it would be at is already the next row', () => {
    const { frames, feed, model } = setup();
    feed.push(['info a'], 'info');
    feed.push(['warn b', 'warn c'], 'warn');
    frames.settle();
    model.select(1, false);
    model.setMinRank(2);
    model.moveActive(1, false);
    expect(model.getSnapshot().selection).toEqual({ anchor: 2, focus: 2 });
  });

  it('moves from a hidden selection by rows counted from the place it would be at: up is the row before it, a page is that many rows from it', () => {
    const make = () => {
      const made = setup();
      // Lines 1 to 10 and 12 to 21 pass the filter; line 11 is an info line between them, and it is the selection.
      made.feed.push(numbered(10, 1, 'warn'), 'warn');
      made.feed.push(['info hidden'], 'info');
      made.feed.push(numbered(10, 11, 'warn'), 'warn');
      made.frames.settle();
      made.model.setViewport(ROW * 4);
      made.model.select(11, false);
      made.model.setMinRank(2);
      return made.model;
    };

    const up = make();
    up.moveActive(-1, false);
    expect(up.getSnapshot().selection?.focus).toBe(10);
    const down = make();
    down.moveActive(1, false);
    expect(down.getSnapshot().selection?.focus).toBe(12);
    // A page is three rows here (four in view less one): three rows after the place the line would be at is line 14 (12, 13, 14); three before it is line 8 (10, 9, 8).
    const pageDown = make();
    pageDown.moveActive('pageDown', false);
    expect(pageDown.getSnapshot().selection?.focus).toBe(14);
    const pageUp = make();
    pageUp.moveActive('pageUp', false);
    expect(pageUp.getSnapshot().selection?.focus).toBe(8);
  });

  it('stays inside the rows when the hidden selection lies past the last of them', () => {
    const { frames, feed, model } = setup();
    feed.push(['warn a'], 'warn');
    feed.push(['info b'], 'info');
    frames.settle();
    model.select(2, false);
    model.setMinRank(2);
    model.moveActive(-1, false);
    expect(model.getSnapshot().selection?.focus).toBe(1);
    model.select(2, false);
    model.moveActive(1, false);
    expect(model.getSnapshot().selection?.focus).toBe(1);
    model.moveActive(1, false);
    expect(model.getSnapshot().selection?.focus).toBe(1);
  });

  it('extends with shift, and the range follows the focus', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(100));
    frames.settle();
    model.select(50, false);
    model.moveActive(1, true);
    model.moveActive(1, true);
    expect(model.getSnapshot().selection).toEqual({ anchor: 50, focus: 52 });
    model.moveActive(-1, true);
    expect(model.getSnapshot().selection).toEqual({ anchor: 50, focus: 51 });
  });

  it('forgets a selection that went with the head, and clips one that is partly gone', () => {
    const { frames, feed, model } = setup({ maxLines: 100 });
    feed.push(numbered(100));
    frames.settle();
    model.select(10, false);
    model.select(20, true);
    feed.push(numbered(15, 101));
    frames.settle();
    expect(model.getSnapshot().selection).toEqual({ anchor: 16, focus: 20 });
    feed.push(numbered(50, 116));
    frames.settle();
    expect(model.getSnapshot().selection).toBeUndefined();
  });

  it('forgets a selection whose line the buffer evicted even when the filter hid that line: no row of the list left, and the ordinal must not outlive the line', () => {
    const { frames, feed, model } = setup({ maxLines: 3 });
    feed.push(['info line'], 'info');
    feed.push(['warn a', 'warn b'], 'warn');
    frames.settle();
    model.select(1, false);
    model.setMinRank(2);
    expect(model.getSnapshot().count).toBe(2);
    feed.push(['info again'], 'info');
    frames.settle();
    // The buffer evicted line 1, which the filter hid: the list lost no row, and the selection named the line that is gone.
    expect(model.getSnapshot().count).toBe(2);
    expect(model.getSnapshot().selection).toBeUndefined();
    // With the filter cleared, a move down from nothing starts at the first line the buffer holds; from the evicted ordinal it would skip that line.
    model.setMinRank(0);
    model.moveActive(1, false);
    expect(model.getSnapshot().selection).toEqual({ anchor: 2, focus: 2 });
  });

  it('clips a selection that began at an evicted line the filter hid: no ordinal below the first line the buffer holds survives, whatever the list shows', () => {
    const { frames, feed, model } = setup({ maxLines: 3 });
    feed.push(['info line'], 'info');
    feed.push(['warn a', 'warn b'], 'warn');
    frames.settle();
    model.select(1, false);
    model.select(3, true);
    model.setMinRank(2);
    feed.push(['info again'], 'info');
    frames.settle();
    expect(model.getSnapshot().selection).toEqual({ anchor: 2, focus: 3 });
  });
});

describe('what the strip reads', () => {
  it('is a separate snapshot that changes when its numbers do, not with every frame: a frame in which none moved tells nobody and keeps the object', () => {
    const { frames, feed, model, strip } = setup();
    const seen: unknown[] = [];
    model.subscribeStats(() => seen.push(model.getStats()));
    feed.push(numbered(10));
    frames.settle();
    expect(model.getStats().total).toBe(10);

    // The rate of a feed that went quiet falls to nothing and stays there; the clock stops asking once it has.
    for (let tell = 0; tell < 20; tell += 1) {
      strip();
    }

    expect(model.getStats().rate).toBe(0);
    // The clock runs out and a frame tells: the strip's numbers are what they were (the same lines, the same rate), so nobody is told, and the object is the same.
    const before = model.getStats();
    const told = seen.length;
    expect(strip()).toBe(before);
    expect(seen.length).toBe(told);

    // A number moved: the next tell gives a new object, once. (The rate of a feed that speaks again moves with every tell until its window is full, so the count is taken before the next.)
    feed.push(numbered(5, 11));
    frames.frame();
    const after = model.getStats();
    expect(after).not.toBe(before);
    expect(after.total).toBe(15);
    expect(seen.length).toBe(told + 1);
  });

  it('is told in a frame, never from its own timer: a timer is a turn of its own, and a commit in it would be one more than the frame makes (MNR-L2)', () => {
    const timers: Array<() => void> = [];
    const { frames, feed, model } = setup({
      timer: (callback) => {
        timers.push(callback);
        return () => undefined;
      },
    });
    const told = vi.fn();
    model.subscribeStats(told);
    feed.push(numbered(10));
    frames.settle();
    // The first frame tells at once, and the strip has the numbers.
    expect(told).toHaveBeenCalledTimes(1);
    expect(model.getStats().total).toBe(10);
    // More lines come in a frame that is too soon to tell again; then the clock runs out. The clock tells nobody: it asks for a frame, and the frame tells.
    feed.push(numbered(5, 11));
    frames.frame();
    expect(told).toHaveBeenCalledTimes(1);
    timers.splice(0).forEach((fire) => {
      fire();
    });
    expect(told).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(1);
    frames.frame();
    expect(told).toHaveBeenCalledTimes(2);
    expect(model.getStats().total).toBe(15);
  });

  it('answers with the same object however the clock moves between two reads, until it is told: React reads a store twice around a commit, and a store that moved between them is torn (MNR-L2)', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10));
    frames.settle();
    const told = model.getStats();
    // The window the rate is told over passes: a read that computed the rate from the clock would now answer another object.
    frames.now += 10_000;
    expect(model.getStats()).toBe(told);
    expect(model.getStats()).toBe(told);
  });
});

// L1: the lines the FEED dropped (a hidden panel at 10,000 lines a second, a reader that was too slow) were lost without the reader being told: the marker the view appended for them was
// the oldest entry of a full buffer and went with the first line that did not fit, the strip counted only what the view itself evicted, and the rate counted the catch-up as live.
describe('what the feed dropped (L1)', () => {
  it('keeps the marker of a drop that came before the whole buffer was read: it is the first row, the lines are all there, and the strip counts the drop', () => {
    const { frames, feed, model, strip } = setup({ maxLines: 100 });
    feed.drop(30);
    feed.push(numbered(100));
    frames.settle();
    expect(model.getSnapshot().count).toBe(101);
    expect(model.entryAt(0)).toMatchObject({ kind: 'gap', dropped: 30 });
    expect(model.entryAt(1)).toMatchObject({ kind: 'line', text: 'line 1' });
    expect(model.entryAt(100)).toMatchObject({ kind: 'line', text: 'line 100' });
    const stats = strip();
    expect([stats.total, stats.shown, stats.dropped, stats.unread]).toEqual([100, 100, 30, 30]);
  });

  it('marks the gap where it occurred and keeps it while lines on either side of it are held', () => {
    const { frames, feed, model } = setup({ maxLines: 100 });
    feed.push(numbered(60));
    frames.settle();
    feed.drop(25);
    feed.push(numbered(30, 61));
    frames.settle();
    const kinds = () => Array.from({ length: model.getSnapshot().count }, (_, index) => model.entryAt(index));
    expect(kinds().findIndex((entry) => entry.kind === 'gap')).toBe(60);
    // The lines before the marker roll off as new ones come; the marker goes on being the oldest, then the first row, and is never lost while the view holds a line.
    feed.push(numbered(300, 91));
    frames.settle();
    const entries = kinds();
    expect(entries[0]).toMatchObject({ kind: 'gap', dropped: 25 });
    expect(entries.filter((entry) => entry.kind === 'gap')).toHaveLength(1);
    expect(entries.filter((entry) => entry.kind === 'line')).toHaveLength(100);
  });

  it('adds what the feed dropped to what the view evicted, and every line the feed made is told: made = held + dropped', () => {
    const { frames, feed, model, strip } = setup({ maxLines: 1000 });
    feed.push(numbered(650));
    frames.settle();
    // A long time away: the feed dropped 300 lines, and kept the 1,000 newest.
    feed.drop(300);
    feed.push(numbered(1000, 651));
    frames.settle();
    const stats = strip();
    expect(stats.total).toBe(1000);
    expect(stats.unread).toBe(300);
    // 650 held, 300 dropped by the feed, 1,000 more: the view evicted 650 of its own, and the strip says 950 in one number.
    expect(stats.dropped).toBe(950);
    expect(stats.total + stats.dropped).toBe(feed.received);
    expect(stats.capacity).toBe(1000);
    expect(model.entryAt(0)).toMatchObject({ kind: 'gap', dropped: 300 });
  });

  it('counts a drop that was told with no lines behind it, and one that is told again after the first has left the head', () => {
    const { frames, feed, strip } = setup({ maxLines: 50 });
    feed.drop(4);
    feed.push(numbered(10));
    frames.settle();
    feed.drop(6);
    feed.push(numbered(10, 11));
    frames.settle();
    expect(strip().dropped).toBe(10);
    feed.push(numbered(200, 21));
    frames.settle();
    const stats = strip();
    // 220 lines read, 50 held: 170 evicted by the view, 10 by the feed.
    expect([stats.total, stats.dropped, stats.unread]).toEqual([50, 180, 10]);
  });

  it('says so from the first frame in which it read the lines: the strip is not told twice about one drop', () => {
    const { frames, feed, model } = setup({ maxLines: 100 });
    const seen: number[] = [];
    model.subscribeStats(() => seen.push(model.getStats().dropped));
    feed.drop(30);
    feed.push(numbered(10));
    frames.frame();
    expect(model.getStats().dropped).toBe(30);
    expect(seen).toEqual([30]);
  });
});

describe('the rate on the strip (L1)', () => {
  /** The strip's rate once its clock has run, with the feed given `lines` first and the clock moved a tell on. */
  const tell = (strip: () => { rate: number }, feed: { push: (texts: readonly string[], level?: LogFeedLevel) => void }, lines: number) => {
    feed.push(numbered(lines));
    return strip().rate;
  };

  it('is the rate the feed makes, measured by the lines it accepted over the wall clock', () => {
    const { feed, strip } = setup();
    let rate = 0;
    for (let tick = 0; tick < 20; tick += 1) {
      rate = tell(strip, feed, 300);
    }

    // 300 lines in 316 ms of the clock (the frame and the strip's clock): about 950 a second.
    expect(rate).toBeGreaterThan(900);
    expect(rate).toBeLessThanOrEqual(1000);
  });

  it('is not the burst of a catch-up: lines that waited while the view was away are not lines the feed makes now', () => {
    const { frames, feed, model, strip } = setup();
    for (let tick = 0; tick < 20; tick += 1) {
      tell(strip, feed, 300);
    }

    // Away for ten seconds, in which the feed made the same 1,000 lines a second and held them.
    model.detach();
    feed.push(numbered(10_000));
    frames.now += 10_000;
    model.attach();
    // The view reads them all on return (a burst of ten thousand lines in a few frames) while the feed goes on at the same rate.
    const rate = tell(strip, feed, 300);
    expect(model.getStats().total).toBeGreaterThan(10_000);
    expect(rate).toBeGreaterThan(900);
    expect(rate).toBeLessThanOrEqual(1000);
  });

  it('is 0 once the feed is quiet, and again what the feed makes when it speaks after a long quiet', () => {
    const { frames, feed, strip } = setup();
    for (let tick = 0; tick < 5; tick += 1) {
      tell(strip, feed, 300);
    }

    // Quiet for longer than the window the rate is told over.
    for (let tick = 0; tick < 20; tick += 1) {
      expect(strip().rate).toBeGreaterThanOrEqual(0);
    }

    expect(strip().rate).toBe(0);
    // An hour later it speaks at the rate it had: not the average of the hour.
    frames.now += 3_600_000;
    const first = tell(strip, feed, 300);
    const later = tell(strip, feed, 300);
    expect(first).toBeGreaterThan(900);
    expect(first).toBeLessThanOrEqual(1000);
    expect(later).toBeGreaterThan(900);
    expect(later).toBeLessThanOrEqual(1000);
  });
});

describe('the strip after the first lines (L1)', () => {
  it('tells the first lines at once, in the frame that read them, though the strip was told (empty) a moment before', () => {
    const { frames, feed, model } = setup();
    frames.frame();
    expect(model.getStats().total).toBe(0);
    feed.push(numbered(5));
    frames.frame();
    expect(model.getStats().total).toBe(5);
    expect(model.getStats().shown).toBe(5);
  });

  it('then keeps to its clock: lines that follow within a quarter second wait for the next tell', () => {
    const { frames, feed, model } = setup();
    frames.frame();
    feed.push(numbered(5));
    frames.frame();
    feed.push(numbered(5, 6));
    frames.frame();
    expect(model.getStats().total).toBe(5);
    frames.now += 300;
    feed.push(numbered(1, 11));
    frames.frame();
    expect(model.getStats().total).toBe(11);
  });
});

describe('the search slice', () => {
  // The slice is a SETTING, and what a frame of a search costs is the bench's to say (bench/log/search.mjs measures the frames in WebKit and Chromium; budget B5 is no frame
  // over 8 ms): a unit test has no frame to time. The first run measured the slice of 3 ms with the commit of the rows that changed, layout and paint at 4 to 6 ms a frame and once
  // 8.24 ms in the typed search, over the 8 ms the rule allows; the slice was cut to 2 ms, which leaves the rest of the frame its margin and still finishes a search of 100,000 lines
  // in a few frames.
  it('is set to 2 ms or less', () => {
    expect(SEARCH_SLICE_MS).toBeLessThanOrEqual(2);
  });

  // What the model can show is work: a slice ends at the first chunk after which the slice is spent, and the scan goes on in the next frame. A clock that costs a whole slice for every
  // reading spends it with the first chunk, whatever else reads the clock in a frame, so each frame scans one chunk and the scan of a log is one frame a chunk.
  it('yields after the chunk that spends it: with every reading of the clock costing a slice, a frame scans one chunk', () => {
    let clock = 0;
    const { frames, feed, model } = setup({ now: () => (clock += SEARCH_SLICE_MS) });
    feed.push(numbered(SEARCH_CHUNK_LINES * 4));
    frames.settle();
    model.setSearch({ query: 'line', regex: false, caseSensitive: false });
    const found: number[] = [];
    // Four frames and no more: a frame that left another one waiting after each callback would make a loop on `pending` never end, and here it fails at the count.
    for (let step = 0; step < 4; step += 1) {
      frames.frame();
      found.push(model.getSnapshot().search.count);
    }

    expect(found).toEqual([SEARCH_CHUNK_LINES, SEARCH_CHUNK_LINES * 2, SEARCH_CHUNK_LINES * 3, SEARCH_CHUNK_LINES * 4]);
    expect(frames.pending).toBe(0);
    expect(model.getSnapshot().search.status).toBe('done');
  });

  it('scans more than one chunk in a frame when the slice is not spent by the first', () => {
    // Every reading costs a tenth of the slice: the slice is spent after ten readings, so a frame scans several chunks, and fewer frames finish the same scan.
    let clock = 0;
    const { frames, feed, model } = setup({ now: () => (clock += SEARCH_SLICE_MS / 10) });
    feed.push(numbered(SEARCH_CHUNK_LINES * 4));
    frames.settle();
    model.setSearch({ query: 'line', regex: false, caseSensitive: false });
    frames.frame();
    expect(model.getSnapshot().search.count).toBe(SEARCH_CHUNK_LINES * 4);
    expect(model.getSnapshot().search.status).toBe('done');
  });
});

describe('detaching', () => {
  it('cancels a frame that is waiting', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(5));
    expect(frames.pending).toBe(1);
    model.detach();
    expect(frames.pending).toBe(0);
    frames.frame();
    expect(model.getSnapshot().count).toBe(0);
    vi.useRealTimers();
  });
});

describe('the sources of the log (L2)', () => {
  const texts = (model: LogViewModel) => model.getSnapshot().rows.map((row) => (row.entry.kind === 'line' ? row.entry.text : `-- ${String(row.entry.dropped)} --`));
  const labels = (model: LogViewModel) => model.getSnapshot().rows.map((row) => row.source?.label);

  it('has no source column while one source speaks or the lines name none: the snapshot says so, and no row carries a source', () => {
    const { frames, feed, model } = setup();
    expect(model.getSnapshot().sourceColumn).toBe(false);
    feed.pushFrom('svc/app', numbered(5));
    frames.settle();
    expect(model.getSnapshot().sourceColumn).toBe(false);
    expect(model.getSnapshot().rows.every((row) => row.source === undefined)).toBe(true);
    // A line that names no source is no source: it is not a second one.
    feed.pushFrom('', numbered(3, 6));
    frames.settle();
    expect(model.getSnapshot().sourceColumn).toBe(false);
  });

  it('shows the column in the very snapshot that carries the second source\'s first line: one frame, one snapshot, and every row of the window already has its tag', () => {
    const { frames, feed, model, published } = setup();
    feed.pushFrom('svc/app', numbered(5));
    frames.settle();
    const before = published.length;
    feed.pushFrom('svc/sidecar', ['hello']);
    frames.frame();
    expect(published.length).toBe(before + 1);
    expect(model.getSnapshot().sourceColumn).toBe(true);
    expect(labels(model)).toEqual(['svc/app', 'svc/app', 'svc/app', 'svc/app', 'svc/app', 'svc/sidecar']);
  });

  it('has the column from the first snapshot when two sources speak in the first frame', () => {
    const { frames, feed, model, published } = setup();
    feed.pushFrom('a', ['one']);
    feed.pushFrom('b', ['two']);
    frames.frame();
    expect(published.length).toBe(1);
    expect(model.getSnapshot().sourceColumn).toBe(true);
    expect(labels(model)).toEqual(['a', 'b']);
  });

  it('keeps the column once it shows: the lines of the second source may leave the buffer, and the log does not change shape under the reader', () => {
    const { frames, feed, model } = setup({ maxLines: 10 });
    feed.pushFrom('a', numbered(3));
    feed.pushFrom('b', ['only b line']);
    frames.settle();
    expect(model.getSnapshot().sourceColumn).toBe(true);
    feed.pushFrom('a', numbered(40, 4));
    frames.settle();
    expect(texts(model)).not.toContain('only b line');
    expect(new Set(labels(model))).toEqual(new Set(['a']));
    expect(model.getSnapshot().sourceColumn).toBe(true);
  });

  it('shows the column when the feed lists two sources before either has spoken, and not when it lists one', () => {
    const { frames, feed, model, published } = setup();
    feed.list([{ id: 'a' }]);
    frames.settle();
    expect(model.getSnapshot().sourceColumn).toBe(false);
    const before = published.length;
    feed.list([{ id: 'a' }, { id: 'b' }]);
    frames.settle();
    expect(model.getSnapshot().sourceColumn).toBe(true);
    // One snapshot for the change, and the same listing read again makes none.
    expect(published.length).toBe(before + 1);
    feed.list([{ id: 'a' }, { id: 'b' }]);
    frames.settle();
    expect(published.length).toBe(before + 1);
  });

  it('has the column from the first snapshot when the feed already lists two sources when the view is made: nothing is drawn before it', () => {
    const frames = new Frames();
    const feed = new FakeFeed();
    feed.list([{ id: 'a' }, { id: 'b' }]);
    const model = new LogViewModel(feed, { maxLines: 1000, now: () => frames.now, schedule: frames.schedule, timer: () => () => undefined });
    expect(model.getSnapshot().sourceColumn).toBe(true);
  });

  it('gives every row of a source the same tag in every snapshot, so a flush that appends lines changes no existing row\'s props (HLT-2)', () => {
    const { frames, feed, model } = setup();
    feed.pushFrom('a', numbered(3));
    feed.pushFrom('b', numbered(3, 4));
    frames.settle();
    const first = model.getSnapshot().rows;
    feed.pushFrom('a', numbered(2, 7));
    feed.pushFrom('b', numbered(2, 9));
    frames.settle();
    const later = model.getSnapshot().rows;
    let shared = 0;
    for (const row of later) {
      const was = first.find((candidate) => candidate.entry === row.entry);
      if (was !== undefined) {
        shared += 1;
        expect(row.source).toBeDefined();
        expect(row.source).toBe(was.source);
      }
    }

    expect(shared).toBe(first.length);
    expect(later.length).toBeGreaterThan(first.length);
  });

  it('names a source by the label the feed lists for it, and a label that comes later changes the tags of that source only, in one snapshot', () => {
    const { frames, feed, model, published } = setup();
    feed.pushFrom('a', ['one']);
    feed.pushFrom('b', ['two']);
    frames.settle();
    expect(labels(model)).toEqual(['a', 'b']);
    const [a, b] = model.getSnapshot().rows.map((row) => row.source);
    const before = published.length;
    feed.list([{ id: 'a' }, { id: 'b', label: 'worker' }]);
    frames.settle();
    expect(published.length).toBe(before + 1);
    const [nextA, nextB] = model.getSnapshot().rows.map((row) => row.source);
    expect(nextA).toBe(a);
    expect(nextB).not.toBe(b);
    expect(nextB).toMatchObject({ id: 'b', label: 'worker', hue: 'green' });
  });

  it('says the name the latest listing gives: a label that goes away is the id again in the rows, as it is on the host\'s card, which reads the same listing', () => {
    const { frames, feed, model } = setup();
    feed.list([{ id: 'a', label: 'app' }, { id: 'b', label: 'worker' }]);
    feed.pushFrom('a', ['x']);
    feed.pushFrom('b', ['y']);
    frames.settle();
    expect(labels(model)).toEqual(['app', 'worker']);
    feed.list([{ id: 'a' }, { id: 'b', label: 'worker' }]);
    frames.settle();
    expect(labels(model)).toEqual(['a', 'worker']);
  });

  it('does not sort: lines come out in the order they arrived, whatever their clocks say', () => {
    const { frames, feed, model } = setup();
    feed.pushFrom('a', ['arrived first, clock later'], 'info', '2024-01-15T10:30:05.000Z');
    feed.pushFrom('b', ['arrived second, clock earlier'], 'info', '2024-01-15T10:30:01.000Z');
    feed.pushFrom('a', ['arrived third'], 'info', '2024-01-15T10:30:06.000Z');
    frames.settle();
    expect(texts(model)).toEqual(['arrived first, clock later', 'arrived second, clock earlier', 'arrived third']);
    expect(model.getSnapshot().rows.map((row) => row.entry.n)).toEqual([1, 2, 3]);
  });

  it('asks the list to go nowhere because a column appeared: scrolled back, the snapshot keeps the command it had and the reader\'s place; following, the one pin to the end every flush gets', () => {
    const { frames, feed, model } = setup();
    feed.pushFrom('a', numbered(2000));
    frames.settle();
    const pinned = model.getSnapshot().scroll;
    feed.pushFrom('b', ['the second source speaks']);
    frames.settle();
    expect(model.getSnapshot().sourceColumn).toBe(true);
    expect(model.getSnapshot().scroll).toMatchObject({ top: 'end', id: (pinned?.id ?? 0) + 1 });

    // Scrolled back, a listing that makes a column appear (no line comes with it) moves nothing.
    const scrolled = setup();
    scrolled.feed.pushFrom('a', numbered(2000));
    scrolled.frames.settle();
    scrolled.model.followOff();
    scrolled.model.onScroll(24 * 500);
    const before = scrolled.model.getSnapshot();
    scrolled.feed.list([{ id: 'a' }, { id: 'b' }]);
    scrolled.frames.settle();
    const after = scrolled.model.getSnapshot();
    expect(after.sourceColumn).toBe(true);
    expect(after.scroll).toBe(before.scroll);
    expect(after.following).toBe(false);
    expect(after.window).toEqual(before.window);
    // And a line of the second source arriving while the reader is back there moves nothing either.
    scrolled.feed.pushFrom('b', ['late']);
    scrolled.frames.settle();
    expect(scrolled.model.getSnapshot().scroll).toBe(before.scroll);
    expect(scrolled.model.getSnapshot().window).toEqual(before.window);
  });

  it('copies the source of every line that has one, whether or not the log shows a Source column: the clock, the level padded to five, the label and two spaces, the text (the mock\'s `lineText`, shell-panel.js 2062)', () => {
    const clock = (text: string) => text.replace(/^\d\d:\d\d:\d\d\.\d{3}/, 'HH:MM:SS.mmm');
    // One source: nothing extra on screen, and the label is in the copy all the same.
    const one = setup();
    one.feed.pushFrom('svc/app', ['first', 'second'], 'info');
    one.frames.settle();
    expect(one.model.getSnapshot().sourceColumn).toBe(false);
    one.model.selectAll();
    expect(one.model.copyText()?.split('\n').map(clock)).toEqual(['HH:MM:SS.mmm INFO  svc/app  first', 'HH:MM:SS.mmm INFO  svc/app  second']);

    const { frames, feed, model } = setup();
    feed.pushFrom('svc/app', ['first'], 'info');
    feed.pushFrom('svc/sidecar', ['second'], 'error');
    feed.pushFrom('svc/app', ['third']);
    frames.settle();
    model.selectAll();
    expect(model.copyText()?.split('\n').map(clock)).toEqual(['HH:MM:SS.mmm INFO  svc/app  first', 'HH:MM:SS.mmm ERROR svc/sidecar  second', 'HH:MM:SS.mmm       svc/app  third']);
  });

  it('copies a line that names no source as it always was, with no label and no extra space, among lines that do', () => {
    const clock = (text: string) => text.replace(/^\d\d:\d\d:\d\d\.\d{3}/, 'HH:MM:SS.mmm');
    const { frames, feed, model } = setup();
    feed.pushFrom('svc/app', ['first'], 'info');
    feed.pushFrom('', ['second'], 'warn');
    frames.settle();
    model.selectAll();
    expect(model.copyText()?.split('\n').map(clock)).toEqual(['HH:MM:SS.mmm INFO  svc/app  first', 'HH:MM:SS.mmm WARN second']);
  });

  it('copies the name the feed lists for the one source of a log, and its id when it lists none', () => {
    const clock = (text: string) => text.replace(/^\d\d:\d\d:\d\d\.\d{3}/, 'HH:MM:SS.mmm');
    const { frames, feed, model } = setup();
    feed.list([{ id: 'svc/app', label: 'app' }]);
    feed.pushFrom('svc/app', ['first'], 'info');
    frames.settle();
    model.selectAll();
    expect(model.copyText()?.split('\n').map(clock)).toEqual(['HH:MM:SS.mmm INFO  app  first']);

    const bare = setup();
    bare.feed.list([{ id: 'svc/app' }]);
    bare.feed.pushFrom('svc/app', ['first'], 'info');
    bare.frames.settle();
    bare.model.selectAll();
    expect(bare.model.copyText()?.split('\n').map(clock)).toEqual(['HH:MM:SS.mmm INFO  svc/app  first']);
  });

  it('copies the label the feed gave, and a marker as its own sentence', () => {
    const { frames, feed, model } = setup();
    feed.list([{ id: 'a', label: 'app' }, { id: 'b', label: 'worker' }]);
    feed.pushFrom('b', ['x'], 'warn');
    frames.settle();
    feed.drop(2);
    feed.pushFrom('a', ['y'], 'warn');
    frames.settle();
    model.selectAll();
    const lines = model.copyText()?.split('\n') ?? [];
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} WARN  worker {2}x$/);
    expect(lines[1]).toBe('-- 2 lines dropped --');
    expect(lines[2]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} WARN  app {2}y$/);
  });

  it('does not search the source, as the mock does not (shell-panel.js 1668 and 1953 test the message only): a query that is in a label and in no text finds nothing', () => {
    const { frames, feed, model } = setup();
    feed.list([{ id: 'a', label: 'sidecar' }, { id: 'b', label: 'app' }]);
    feed.pushFrom('a', ['one', 'two']);
    feed.pushFrom('b', ['the sidecar said so']);
    frames.settle();
    model.setSearch({ query: 'sidecar', regex: false, caseSensitive: false });
    frames.settle();
    const search = model.getSnapshot().search;
    expect(search.count).toBe(1);
    expect(search.status).toBe('done');
    const hit = model.getSnapshot().rows.filter((row) => row.hit).map((row) => (row.entry.kind === 'line' ? row.entry.text : ''));
    expect(hit).toEqual(['the sidecar said so']);
  });
});

describe('the rate of a paused or quiet feed (L3)', () => {
  // L1 flagged that a paused feed's rate is the feed's arrival rate and said the mock decays it. Measured in the mock (WebKit and Chromium, a producer at 20 lines a second): its rate is the lines pushed in the last
  // 3 seconds over 3 (`rateOf`, shell-panel.js 1995), and `pushLines` (1679) is called by the generator (1650) whether or not the log is paused, so a paused log that goes on receiving reads 20.0 and one that
  // goes quiet, paused or not, reads 0.0 about 3 seconds later. The kit's rate is the feed's lines accepted over the clock, and the feed goes on accepting while it is paused: the same two behaviours.
  const tell = (strip: () => { rate: number }, feed: { push: (texts: readonly string[]) => void }) => {
    feed.push(numbered(300));
    return strip().rate;
  };

  it('is what the feed makes while the view is paused, as the mock\'s is: a pause holds the reads, not the arrivals', () => {
    const { feed, strip } = setup();
    for (let tick = 0; tick < 12; tick += 1) {
      tell(strip, feed);
    }

    feed.pause();
    let rate = 0;
    for (let tick = 0; tick < 12; tick += 1) {
      rate = tell(strip, feed);
    }

    expect(rate).toBeGreaterThan(900);
    expect(rate).toBeLessThanOrEqual(1000);
  });

  it('decays to 0 when a paused feed goes quiet, as it does for one that is not paused, and the strip goes on asking for frames until it has', () => {
    const { feed, model, strip } = setup();
    for (let tick = 0; tick < 12; tick += 1) {
      tell(strip, feed);
    }

    feed.pause();
    const rates: number[] = [];
    for (let tick = 0; tick < 20; tick += 1) {
      rates.push(strip().rate);
    }

    expect(rates[0]).toBeGreaterThan(0);
    expect(rates.at(-1)).toBe(0);
    // It falls and does not come back: a feed that is quiet makes nothing.
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
    expect(model.getStats().rate).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The toolbar beside the view (P1b-4a). Clear drops what the VIEW holds and touches nothing of the stream; Pause is the feed's; Copy is the selected lines, or every line of the list; and a control reads
// a handful of facts of the view (`getControls`), told when one changes and not once a frame.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

describe('clear (the toolbar\'s Clear)', () => {
  it('drops the lines the view holds, whatever the strip said: no row, no line held, a strip that counts none', () => {
    const { frames, feed, model, strip } = setup();
    feed.push(numbered(40));
    frames.settle();
    expect(model.getSnapshot().count).toBe(40);
    model.clear();
    frames.settle();
    const snapshot = model.getSnapshot();
    expect([snapshot.count, snapshot.buffered, snapshot.rows.length]).toEqual([0, 0, 0]);
    const stats = strip();
    expect([stats.shown, stats.total, stats.dropped, stats.unread]).toEqual([0, 0, 0, 0]);
  });

  it('touches nothing of the stream: it neither pauses, nor resumes, nor reads, and the lines that come after it are shown, counted from the first', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10));
    frames.settle();
    const reads = feed.reads.length;
    const status = feed.getSnapshot();
    model.clear();
    expect(feed.reads.length).toBe(reads);
    expect(feed.getSnapshot()).toBe(status);
    expect(feed.subscribers).toBe(1);
    feed.push(numbered(3, 11));
    frames.settle();
    expect(model.getSnapshot().count).toBe(3);
    expect(model.entryAt(0)).toMatchObject({ kind: 'line', text: 'line 11' });
  });

  it('does not clear what the feed holds and the view had not read: those lines are new lines', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(10));
    frames.settle();
    feed.push(numbered(5, 11));
    model.clear();
    frames.settle();
    expect(model.getSnapshot().count).toBe(5);
    expect(model.entryAt(0)).toMatchObject({ text: 'line 11' });
  });

  it('starts the account again: what the view evicts or the feed drops afterwards is told, and what was cleared is not told as dropped', () => {
    const { frames, feed, model, strip } = setup({ maxLines: 50 });
    feed.push(numbered(80));
    frames.settle();
    expect(strip()).toMatchObject({ total: 50, dropped: 30, unread: 0 });
    const madeBefore = feed.received;
    model.clear();
    frames.settle();
    expect(strip()).toMatchObject({ shown: 0, total: 0, dropped: 0, unread: 0 });
    feed.push(numbered(20, 81));
    frames.settle();
    feed.drop(5);
    feed.push(numbered(10, 106));
    frames.settle();
    const stats = strip();
    // Since the clear the feed made 20 + 5 + 10 lines; the view shows 30 and says it never got 5.
    expect([stats.total, stats.dropped, stats.unread]).toEqual([30, 5, 5]);
    expect(stats.total + stats.dropped).toBe(feed.received - madeBefore);
    // And the cap still counts what it evicts after the clear.
    feed.push(numbered(100, 116));
    frames.settle();
    expect(strip()).toMatchObject({ total: 50, dropped: 5 + 80, unread: 5 });
  });

  it('does not tell again the lines the feed dropped before the clear: they were told, and they are cleared with the rest', () => {
    const { frames, feed, model, strip } = setup({ maxLines: 50 });
    feed.drop(12);
    feed.push(numbered(10));
    frames.settle();
    expect(strip()).toMatchObject({ total: 10, dropped: 12, unread: 12 });
    model.clear();
    frames.settle();
    expect(strip()).toMatchObject({ total: 0, dropped: 0, unread: 0 });
    feed.push(numbered(3, 11));
    frames.settle();
    expect(strip()).toMatchObject({ total: 3, dropped: 0, unread: 0 });
  });

  it('forgets the marker a drop left at the head: the first row after a clear is the first new line', () => {
    const { frames, feed, model } = setup({ maxLines: 20 });
    feed.drop(12);
    feed.push(numbered(40));
    frames.settle();
    expect(model.entryAt(0)).toMatchObject({ kind: 'gap', dropped: 12 });
    model.clear();
    feed.push(numbered(2, 41));
    frames.settle();
    expect(model.getSnapshot().count).toBe(2);
    expect(model.entryAt(0)).toMatchObject({ kind: 'line', text: 'line 41' });
  });

  it('drops the selection and the matches of the lines it dropped, and keeps the reader\'s query, finding the lines that come', () => {
    const { frames, feed, model } = setup();
    model.setSearch({ query: 'needle', regex: false, caseSensitive: false });
    feed.push(['a needle', 'b', 'c needle']);
    frames.settle();
    model.select(1, false);
    model.select(3, true);
    expect(model.getSnapshot().search.count).toBe(2);
    model.clear();
    frames.settle();
    const cleared = model.getSnapshot();
    expect(cleared.selection).toBeUndefined();
    expect([cleared.search.count, cleared.search.current, cleared.search.options.query]).toEqual([0, 0, 'needle']);
    feed.push(['d', 'e needle']);
    frames.settle();
    expect(model.getSnapshot().search).toMatchObject({ count: 1, status: 'done' });
  });

  it('keeps the level the reader chose', () => {
    const { frames, feed, model } = setup();
    model.setMinRank(2);
    feed.push(['one', 'two'], 'info');
    feed.push(['three'], 'error');
    frames.settle();
    expect(model.getSnapshot().count).toBe(1);
    model.clear();
    feed.push(['four'], 'info');
    feed.push(['five'], 'warn');
    frames.settle();
    expect(model.getSnapshot()).toMatchObject({ count: 1, buffered: 2, minRank: 2 });
  });

  it('asks the list to go to the end of the log while it follows: it is empty, and the next lines are at its foot', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(100));
    frames.settle();
    const before = model.getSnapshot().scroll?.id ?? 0;
    model.clear();
    const snapshot = model.getSnapshot();
    expect(snapshot.following).toBe(true);
    expect(snapshot.scroll?.id).toBeGreaterThan(before);
    expect(snapshot.scroll?.top).toBe('end');
  });

  it('puts a reader who had scrolled back at the top of the empty list, and counts no line that came while they were away', () => {
    const { frames, feed, model, strip } = setup();
    feed.push(numbered(200));
    frames.settle();
    model.onScroll(240);
    expect(model.getSnapshot().following).toBe(false);
    feed.push(numbered(10, 201));
    frames.settle();
    expect(strip().unseen).toBe(10);
    model.clear();
    frames.settle();
    expect(model.getSnapshot().scroll?.top).toBe(0);
    expect(strip().unseen).toBe(0);
  });

  it('is one snapshot, and the strip is told in the next frame, not at the next tick of its clock', () => {
    const { frames, feed, model, published } = setup();
    feed.push(numbered(5));
    frames.settle();
    const before = published.length;
    model.clear();
    expect(published.length).toBe(before + 1);
    frames.settle();
    expect(model.getStats()).toMatchObject({ shown: 0, total: 0 });
  });

  it('does nothing for a view that holds nothing and has nothing to forget: no snapshot, no frame', () => {
    const { frames, model, published } = setup();
    frames.settle();
    const before = published.length;
    model.clear();
    expect(published.length).toBe(before);
    expect(frames.pending).toBe(0);
  });

  it('leaves a paused feed paused, holding its lines: they come when it is resumed', () => {
    const { frames, feed, model, strip } = setup();
    feed.push(numbered(10));
    frames.settle();
    feed.pause();
    feed.push(numbered(7, 11));
    frames.settle();
    model.clear();
    frames.settle();
    expect(model.getSnapshot().count).toBe(0);
    expect(strip().held).toBe(7);
    expect(feed.getSnapshot().paused).toBe(true);
    feed.resume();
    frames.settle();
    expect(model.getSnapshot().count).toBe(7);
  });

  it('never reuses an ordinal: a row of the cleared lines cannot be taken for a new one', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(5));
    frames.settle();
    const oldest = model.getSnapshot().rows[4]?.entry.n ?? 0;
    model.clear();
    feed.push(numbered(1, 6));
    frames.settle();
    expect(model.getSnapshot().rows[0]?.entry.n).toBeGreaterThan(oldest);
  });
});

describe('what a control beside the view reads (getControls)', () => {
  it('starts as a view that follows, draws nothing, holds nothing, and whose feed is going', () => {
    const { model } = setup();
    expect(model.getControls()).toEqual({ following: true, drawn: false, held: false, paused: false, feed: 'streaming' });
  });

  it('says the list draws and the view holds lines once a frame read them, and tells its listeners then and not at every frame after', () => {
    const { frames, feed, model } = setup();
    const told: unknown[] = [];
    model.subscribeControls(() => {
      told.push(model.getControls());
    });
    feed.push(numbered(10));
    frames.settle();
    expect(model.getControls()).toMatchObject({ drawn: true, held: true });
    expect(told).toHaveLength(1);
    for (let batch = 0; batch < 20; batch += 1) {
      feed.push(numbered(50, batch * 50 + 11));
      frames.settle();
    }

    expect(told).toHaveLength(1);
  });

  it('is the same object for as long as nothing it says has changed: a control that reads it is not drawn again for a line', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(5));
    frames.settle();
    const first = model.getControls();
    feed.push(numbered(5, 6));
    frames.settle();
    expect(model.getControls()).toBe(first);
  });

  it('says a level filter that hides every line draws nothing of lines it still holds', () => {
    const { frames, feed, model } = setup();
    feed.push(['quiet'], 'info');
    frames.settle();
    model.setMinRank(3);
    frames.settle();
    expect(model.getControls()).toMatchObject({ drawn: false, held: true });
    model.setMinRank(0);
    expect(model.getControls()).toMatchObject({ drawn: true, held: true });
  });

  it('follows when the view follows, and says so when the reader leaves, when a control stops it and when the end is asked for again', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(100));
    frames.settle();
    const told: boolean[] = [];
    model.subscribeControls(() => {
      told.push(model.getControls().following);
    });
    model.followOff();
    expect(model.getControls().following).toBe(false);
    model.jumpToLatest();
    expect(model.getControls().following).toBe(true);
    model.onScroll(240);
    expect(model.getControls().following).toBe(false);
    expect(told).toEqual([false, true, false]);
  });

  it('tells a pause the moment the feed says it, with no frame and no snapshot of the view: the pause is the feed\'s', () => {
    const { frames, feed, model, published } = setup();
    feed.push(numbered(3));
    frames.settle();
    const snapshots = published.length;
    const told: boolean[] = [];
    model.subscribeControls(() => {
      told.push(model.getControls().paused);
    });
    feed.pause();
    expect(model.getControls().paused).toBe(true);
    feed.resume();
    expect(model.getControls().paused).toBe(false);
    expect(told).toEqual([true, false]);
    frames.settle();
    expect(published.length).toBe(snapshots);
  });

  it('says where the feed is: going, ended, failed', () => {
    const { feed, model } = setup();
    expect(model.getControls().feed).toBe('streaming');
    feed.finish('ended');
    expect(model.getControls().feed).toBe('ended');
    feed.finish('failed', { stage: 'source', message: 'no' });
    expect(model.getControls().feed).toBe('failed');
  });

  it('says a feed that is paused is paused whatever its state says, as the feed\'s own flag does', () => {
    const { feed, model } = setup();
    feed.finishPaused('ended');
    expect(model.getControls()).toMatchObject({ paused: true, feed: 'ended' });
  });

  it('says the list draws nothing and the view holds nothing after Clear', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(4));
    frames.settle();
    expect(model.getControls()).toMatchObject({ drawn: true, held: true });
    model.clear();
    expect(model.getControls()).toMatchObject({ drawn: false, held: false });
  });

  it('hears nothing of the feed while it is not attached, and reads it again, once, when it is', () => {
    const { feed, model } = setup();
    const told: unknown[] = [];
    model.subscribeControls(() => {
      told.push(model.getControls());
    });
    model.detach();
    feed.pause();
    expect(model.getControls().paused).toBe(false);
    expect(told).toHaveLength(0);
    model.attach();
    expect(model.getControls().paused).toBe(true);
    expect(told).toHaveLength(1);
  });

  it('stops telling a listener that unsubscribed', () => {
    const { feed, model } = setup();
    let told = 0;
    const stop = model.subscribeControls(() => {
      told += 1;
    });
    feed.pause();
    stop();
    feed.resume();
    expect(told).toBe(1);
  });
});

describe('pausing from a control (setPaused)', () => {
  it('holds the feed\'s reads, and lets them through again', () => {
    const { frames, feed, model } = setup();
    feed.push(numbered(5));
    frames.settle();
    model.setPaused(true);
    expect(feed.getSnapshot().paused).toBe(true);
    feed.push(numbered(5, 6));
    frames.settle();
    expect(model.getSnapshot().count).toBe(5);
    model.setPaused(false);
    frames.settle();
    expect(feed.getSnapshot().paused).toBe(false);
    expect(model.getSnapshot().count).toBe(10);
  });

  it('asks the feed once for what it already is: a pause that is on is not asked again', () => {
    const { feed, model } = setup();
    const pause = vi.spyOn(feed, 'pause');
    const resume = vi.spyOn(feed, 'resume');
    model.setPaused(false);
    expect(resume).not.toHaveBeenCalled();
    model.setPaused(true);
    model.setPaused(true);
    expect(pause).toHaveBeenCalledTimes(1);
    model.setPaused(false);
    model.setPaused(false);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('counts the lines the feed holds while it is paused, and shows them in the strip: the lines are counted, not drawn (the mock: Paused, N new lines waiting)', () => {
    const { frames, feed, model, strip } = setup();
    feed.push(numbered(5));
    frames.settle();
    model.setPaused(true);
    feed.push(numbered(30, 6));
    frames.settle();
    expect(model.getSnapshot().count).toBe(5);
    expect(strip().held).toBe(30);
    feed.push(numbered(12, 36));
    frames.settle();
    expect(strip().held).toBe(42);
  });
});

describe('the lines a Copy control copies (copyLines)', () => {
  const clock = (text: string) => text.replace(/^\d\d:\d\d:\d\d\.\d{3}/, 'HH:MM:SS.mmm');

  it('is nothing for a view that draws nothing', () => {
    const { model } = setup();
    expect(model.copyLines()).toBeUndefined();
  });

  it('is every line of the list, a line each, in the order they are drawn, with their clock, level and source, when no range is selected', () => {
    const { frames, feed, model } = setup();
    feed.pushFrom('svc/app', ['first', 'second'], 'info');
    feed.pushFrom('svc/job', ['third'], 'error');
    frames.settle();
    const copied = model.copyLines();
    expect(copied?.lines).toBe(3);
    expect(copied?.selection).toBe(false);
    expect(copied?.text.split('\n').map(clock)).toEqual(['HH:MM:SS.mmm INFO  svc/app  first', 'HH:MM:SS.mmm INFO  svc/app  second', 'HH:MM:SS.mmm ERROR svc/job  third']);
  });

  it('carries a line\'s source whether or not the view has a column for it, as the mock\'s lineText does (L3)', () => {
    const { frames, feed, model } = setup();
    feed.pushFrom('svc/app', ['only'], 'info');
    frames.settle();
    expect(model.getSnapshot().sourceColumn).toBe(false);
    expect(model.copyLines()?.text.replace(/^\d\d:\d\d:\d\d\.\d{3}/, '')).toBe(' INFO  svc/app  only');
  });

  it('is only the lines the level filter lets through: what is hidden is not drawn and is not copied', () => {
    const { frames, feed, model } = setup();
    feed.pushFrom('', ['debug one'], 'debug');
    feed.pushFrom('', ['warn one'], 'warn');
    feed.pushFrom('', ['error one'], 'error');
    frames.settle();
    model.setMinRank(2);
    expect(model.copyLines()?.text.split('\n').map(clock)).toEqual(['HH:MM:SS.mmm WARN warn one', 'HH:MM:SS.mmm ERROR error one']);
    expect(model.copyLines()?.lines).toBe(2);
  });

  it('is nothing when the filter hides every line', () => {
    const { frames, feed, model } = setup();
    feed.push(['quiet'], 'info');
    frames.settle();
    model.setMinRank(3);
    expect(model.copyLines()).toBeUndefined();
  });

  it('writes a marker as its own sentence and does not count it as a line, the lead of a head that lost lines included', () => {
    const { frames, feed, model } = setup({ maxLines: 5 });
    feed.drop(9);
    feed.push(numbered(8));
    frames.settle();
    const copied = model.copyLines();
    expect(copied?.lines).toBe(5);
    expect(copied?.text.split('\n')[0]).toBe('-- 9 lines dropped --');
    expect(copied?.text.split('\n')).toHaveLength(6);
  });

  it('is the selected lines, and says so, when a range is selected: the selection narrows what the control copies', () => {
    const { frames, feed, model } = setup();
    feed.pushFrom('', ['a', 'b', 'c', 'd'], 'info');
    frames.settle();
    model.select(2, false);
    model.select(3, true);
    const copied = model.copyLines();
    expect(copied?.selection).toBe(true);
    expect(copied?.lines).toBe(2);
    expect(copied?.text.split('\n').map(clock)).toEqual(['HH:MM:SS.mmm INFO b', 'HH:MM:SS.mmm INFO c']);
  });

  it('writes the clock the rows show: UTC with its Z when the view shows UTC', () => {
    const { frames, feed, model } = setup();
    feed.pushFrom('', ['first'], 'info', '2024-01-15T10:30:00.123Z');
    frames.settle();
    expect(model.copyLines('utc')?.text).toBe('10:30:00.123Z INFO first');
  });

  it('is what it was before the clock changed: a copy is made when it is asked for', () => {
    const { frames, feed, model } = setup();
    feed.pushFrom('', ['first'], 'info', '2024-01-15T10:30:00.123Z');
    frames.settle();
    const utc = model.copyLines('utc')?.text;
    expect(model.copyLines('utc')?.text).toBe(utc);
    expect(model.copyLines('local')?.text).not.toBe(utc);
  });
});

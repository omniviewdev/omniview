// A synthetic source of log lines: the feed of the examples, the tests and the bench. Its lines are neutral (no plugin, no product word) and made from a
// seed, so a run is the same run; it keeps the contract of a real feed (consumer-paced `read`, a bound that drops the oldest and counts them, a local
// pause, one wake-up between two reads) and nothing more. It is development and documentation only: it is reached through the examples entry and never
// through the root entry.
import type { LogFeed, LogFeedBatch, LogFeedCause, LogFeedLevel, LogFeedLine, LogFeedSnapshot, LogFeedSource, LogFeedState, LogFeedStats } from '../../log/types';

export type SyntheticFeedOptions = {
  /** Lines a second while `start()` has been called. Default 20. */
  readonly rate?: number | undefined;
  /** Seeds the lines: the same seed makes the same text, levels and gaps. Default 1. */
  readonly seed?: number | undefined;
  /** The most lines held for a reader that is slow or paused; past it the oldest are dropped and counted. Default 100,000. */
  readonly maxHeld?: number | undefined;
  /** Where the feed starts. Default `streaming`. */
  readonly state?: LogFeedState | undefined;
  /** The clock, in ms since the epoch, for the lines' timestamps. Default `Date.now`. */
  readonly clock?: (() => number) | undefined;
  /**
   * The sources the made lines come from, in turn: line `seq` is of source `seq - 1` modulo the count, with no random number drawn, so the text and levels of a seed do not depend on them. A source is an id, or
   * an id with the label the view shows for it. The feed lists what it is given in its status, as the runtime's stream lists the sources it has heard of. Default: one, `source/main`, and none listed.
   */
  readonly sources?: ReadonlyArray<string | LogFeedSource> | undefined;
};

/** A small seeded generator (mulberry32): a number in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOUNS = ['request', 'job', 'batch', 'snapshot', 'session', 'task', 'sync'];
const VERBS = ['handled', 'queued', 'retried', 'flushed', 'compacted', 'refreshed', 'committed'];
const KEYS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
const AMBER = '\u001b[33m';
const RESET = '\u001b[0m';

/** The wake-up and the paused reads of the runtime's stream, and its bound, in the smallest form. */
export class SyntheticFeed implements LogFeed {
  private readonly random: () => number;
  private readonly clock: () => number;
  private readonly sourceIds: readonly string[];
  private listed: readonly LogFeedSource[] | undefined;
  private readonly rate: number;
  private readonly maxHeld: number;
  private readonly listeners = new Set<() => void>();
  // The held lines are a ring, the oldest line at index `oldest`: a drop is an overwrite, so a feed that is paused or unread keeps no line it dropped, and a line costs the
  // same at 50,000 a second as at ten (no `shift`, no `splice`, no copy of what is held). The ring has `cap` slots, doubled when it is full and holds fewer than `maxHeld`
  // lines, so its storage follows what is HELD and not what went through it: the memory run of the bench (bench/log) saw a feed bounded at a million grow 4 MB over a million
  // lines that were read as they came, because the oldest line's index walked the whole bound.
  private slots: Array<LogFeedLine | undefined> = [];
  private cap = 0;
  private oldest = 0;
  private count = 0;
  private seq = 0;
  private received = 0;
  private droppedTotal = 0;
  private droppedSinceRead = 0;
  private notified = false;
  private drained: Array<{ readonly callback: () => void; live: boolean }> = [];
  private status: LogFeedSnapshot;
  private timer: ReturnType<typeof setInterval> | undefined;
  private started = 0;
  private emitted = 0;

  constructor(options: SyntheticFeedOptions = {}) {
    this.random = seeded(options.seed ?? 1);
    this.clock = options.clock ?? (() => Date.now());
    this.rate = options.rate ?? 20;
    this.maxHeld = Math.max(0, Math.floor(options.maxHeld ?? 100_000));
    this.listed = options.sources?.map((source) => (typeof source === 'string' ? { id: source } : source));
    this.sourceIds = this.listed === undefined || this.listed.length === 0 ? ['source/main'] : this.listed.map((source) => source.id);
    const state = options.state ?? 'streaming';
    this.status = this.statusOf(state, state === 'paused', undefined);
  }

  // ---- the LogFeed contract ----

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): LogFeedSnapshot => this.status;

  readonly read = (maxLines: number): LogFeedBatch => {
    this.notified = false;
    if (this.status.paused) {
      return { lines: [], dropped: 0, held: this.size };
    }

    const take = Math.min(Math.max(0, Math.floor(maxLines)), this.count);
    const lines: LogFeedLine[] = [];
    for (let index = 0; index < take; index += 1) {
      const slot = this.oldest + index;
      const at = slot < this.cap ? slot : slot - this.cap;
      lines.push(this.slots[at]!);
      this.slots[at] = undefined;
    }

    if (take > 0) {
      this.oldest = (this.oldest + take) % this.cap;
      this.count -= take;
    }

    const dropped = take > 0 ? this.droppedSinceRead : 0;
    if (take > 0) {
      this.droppedSinceRead = 0;
    }

    if (this.count === 0 && this.drained.length > 0) {
      // The reader has what the feed held: whoever waited for that is told in a turn of its own, after this read has returned.
      const waiting = this.drained;
      this.drained = [];
      setTimeout(() => {
        for (const waiter of waiting) {
          if (waiter.live) {
            waiter.live = false;
            waiter.callback();
          }
        }
      }, 0);
    }

    return { lines, dropped, held: this.size };
  };

  readonly stats = (): LogFeedStats => ({ received: this.received, dropped: this.droppedTotal, held: this.size });

  readonly pause = (): void => {
    this.set({ ...this.status, paused: true, state: this.status.state === 'streaming' ? 'paused' : this.status.state });
  };

  readonly resume = (): void => {
    this.set({ ...this.status, paused: false, state: this.status.state === 'paused' ? 'streaming' : this.status.state });
  };

  private get size(): number {
    return this.count;
  }

  /** The slots the feed's storage holds, whether or not a line is in them: it follows what the feed holds, and is never more than `maxHeld`. For tests. */
  stored(): number {
    return this.slots.length;
  }

  // ---- driving it ----

  /**
   * Emits `rate` lines a second until `stop()`: one batch and one wake-up a tick (every 4 ms). A tick that comes late finds a long stretch due (a hidden tab, a long task): the
   * feed holds at most `maxHeld` lines and would drop all the others as it took them, so a late tick makes the lines the feed can hold, and the rest are counted as dropped, with
   * the numbers they would have had (`seq` jumps over them) and without being made.
   */
  start(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.started = performance.now();
    this.emitted = 0;
    this.timer = setInterval(() => {
      const due = Math.floor(((performance.now() - this.started) * this.rate) / 1000) - this.emitted;
      if (due > 0) {
        this.emitted += due;
        const skipped = Math.max(0, due - this.maxHeld);
        if (skipped > 0) {
          this.seq += skipped;
          this.received += skipped;
          this.droppedTotal += skipped;
          this.droppedSinceRead += skipped;
        }

        this.emit(due - skipped);
      }
    }, 4);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Calls `callback` once, in a turn of its own (never inside the read), after the first read that leaves nothing held: the reader has taken what the feed held. A scenario that
   * must begin once the reader has the lines before it (a pause, a gap) waits for this and not for a fixed time, which a reader that has not mounted yet has not met. Returns what
   * cancels it, up to the turn it runs in.
   */
  whenDrained(callback: () => void): () => void {
    const waiter = { callback, live: true };
    this.drained.push(waiter);
    return () => {
      waiter.live = false;
    };
  }

  /** Makes `count` lines now, held for the reader, with one wake-up. */
  emit(count: number): void {
    const at = this.clock();
    const lines: LogFeedLine[] = [];
    for (let index = 0; index < count; index += 1) {
      lines.push(this.makeLine(at + index));
    }

    this.push(lines);
  }

  /** Holds lines that were made elsewhere (a test's own text), with one wake-up. */
  push(lines: readonly LogFeedLine[]): void {
    // A line that comes when the ring is full takes the place of the oldest, which is dropped and counted: the same lines are kept as if all had been held
    // and the oldest cut off after, and the dropped one is released now, not when a reader next reads (a paused feed reads nothing).
    let over = 0;
    for (const line of lines) {
      if (this.count < this.maxHeld) {
        if (this.count === this.cap) {
          this.grow();
        }

        const slot = this.oldest + this.count;
        this.slots[slot < this.cap ? slot : slot - this.cap] = line;
        this.count += 1;
      } else {
        over += 1;
        if (this.maxHeld > 0) {
          this.slots[this.oldest] = line;
          this.oldest = this.oldest + 1 < this.cap ? this.oldest + 1 : 0;
        }
      }
    }

    this.received += lines.length;
    this.droppedTotal += over;
    this.droppedSinceRead += over;

    this.wake();
  }

  /**
   * The next read will report that `count` lines were dropped before its first line. The lines the drop stands for are numbered and counted as received, as the runtime's stream does
   * and as a late tick does (`start`): the line after the gap has a `seq` that jumps over them.
   */
  drop(count: number): void {
    this.seq += count;
    this.received += count;
    this.droppedSinceRead += count;
    this.droppedTotal += count;
  }

  /** A line of text the caller chose, with a level and the source that wrote it (default: the first source the feed has); numbered and stamped as a made one. */
  line(text: string, level?: LogFeedLevel, source?: string): LogFeedLine {
    this.seq += 1;
    return { seq: this.seq, source: source ?? this.sourceIds[0] ?? 'source/main', timestamp: new Date(this.clock()).toISOString(), text, level };
  }

  /**
   * The feed's state changes; a failed one carries its cause. `paused` is the reader's and follows the runtime's stream: only `pause()` and `resume()` change it, so a feed that
   * ends or fails while paused stays paused, "whatever `state` says", and holds its lines until a reader lifts the pause.
   */
  setState(state: LogFeedState, cause?: LogFeedCause): void {
    this.set(this.statusOf(state, state === 'paused' ? true : this.status.paused, cause));
  }

  /** The feed lists other sources: a new status, and every listener is told. What lines it makes is not changed by it. */
  setSources(sources: readonly LogFeedSource[]): void {
    this.listed = sources;
    this.set({ ...this.status, sources });
  }

  private statusOf(state: LogFeedState, paused: boolean, cause: LogFeedCause | undefined): LogFeedSnapshot {
    return this.listed === undefined ? { state, paused, cause } : { state, paused, cause, sources: this.listed };
  }

  /**
   * A change of status reaches every listener, whatever is held and whether or not one was told since the last read: the runtime publishes each change, and
   * a view that shows the status (it reads it through `useSyncExternalStore`) must not keep a state the feed has left.
   */
  private set(next: LogFeedSnapshot): void {
    this.status = next;
    this.notify();
  }

  /** Lines were held: the data wake-up, which has its own gate (a status change does not pass through it): once until the next `read`, and not at all while nothing is held. */
  private wake(): void {
    if (this.notified || this.size === 0) {
      return;
    }

    this.notified = true;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  // ---- the lines ----

  /** Doubles the ring (64 slots to start, never past `maxHeld`) and lays the held lines out from its start. A packed array, never a sparse one: a large sparse array is a dictionary. */
  private grow(): void {
    const next = Math.min(this.maxHeld, Math.max(64, this.cap * 2));
    const grown: Array<LogFeedLine | undefined> = [];
    for (let index = 0; index < this.count; index += 1) {
      const slot = this.oldest + index;
      grown.push(this.slots[slot < this.cap ? slot : slot - this.cap]);
    }

    while (grown.length < next) {
      grown.push(undefined);
    }

    this.slots = grown;
    this.oldest = 0;
    this.cap = next;
  }

  private pick(list: readonly string[]): string {
    return list[Math.floor(this.random() * list.length)] ?? '';
  }

  private hex(): string {
    return Math.floor(this.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0');
  }

  private makeLine(at: number): LogFeedLine {
    this.seq += 1;
    const roll = this.random();
    const ms = Math.floor(this.random() * 1500);
    let text: string;
    let level: LogFeedLevel | undefined;
    if (roll < 0.62) {
      text = `${this.pick(NOUNS)} ${this.hex()} ${this.pick(VERBS)} in ${Math.floor(this.random() * 90) + 2}ms`;
      level = 'info';
    } else if (roll < 0.72) {
      text = `${this.pick(NOUNS)} ${this.hex()} took ${AMBER}${ms + 1000}ms${RESET} (budget 1000ms)`;
      level = 'warn';
    } else if (roll < 0.76) {
      text = `upstream error: code = Unavailable desc = connection reset by peer (attempt ${Math.floor(this.random() * 4) + 1})`;
      level = 'error';
    } else if (roll < 0.86) {
      text = `cache lookup key=${this.pick(KEYS)}-${this.hex()} hit=${this.random() < 0.7 ? 'true' : 'false'}`;
      level = 'debug';
    } else if (roll < 0.94) {
      text = `{"level":"info","msg":"${this.pick(VERBS)}","id":"${this.hex()}","took_ms":${ms}}`;
      level = undefined;
    } else if (roll < 0.998) {
      text = `${this.pick(NOUNS)} ${this.hex()} ${this.pick(VERBS)}`;
      level = undefined;
    } else {
      // A long line: sixty key=value pairs, about 600 characters.
      text = Array.from({ length: 60 }, (_, index) => `${this.pick(KEYS)}${index}=${this.hex()}`).join(' ');
      level = 'info';
    }

    return { seq: this.seq, source: this.sourceIds[(this.seq - 1) % this.sourceIds.length] ?? 'source/main', timestamp: new Date(at).toISOString(), text, level };
  }
}

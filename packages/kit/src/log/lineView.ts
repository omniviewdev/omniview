// The lines the viewer shows: the whole buffer, or the entries at or above a minimum level. The level quick filter of the mock (All, Info+, Warn+, Error)
// is a rank; a marker (a gap) always shows, and a line that says no level counts as info (the mock's `LEVEL_RANK[level] ?? 1`).
//
// A view of everything is the buffer: no array, no copy. A filtered view keeps the ordinals that pass in an array that grows at the end and loses its head
// as the buffer evicts, compacted once most of it is dead, so a filtered view of a 100,000-line buffer costs one number per line shown (HLT-16: no
// filtered copy of the entries, no rescan of the buffer per frame).
//
// The lead (L1). A marker is the one place the reader is told that lines are missing, and a ring that overwrites its head would take it with the oldest lines: a view that had
// read nothing and was handed a whole buffer after a gap pushed the marker out in the frame that appended it. So a marker that reaches the head of the buffer is not given up:
// the view keeps what it stood for (`headDropped`, the sum of the markers that reached the head) and shows it as ONE row before the oldest entry the buffer holds, for as long as the
// view holds any line. That row is the one entry beyond the buffer's own bound. It is not in the buffer: it is numbered one before the buffer's first ordinal (an ordinal no entry holds
// any more), so the ordinals of the view stay in a row, and it is told in the four places a list reads the view by index.
import type { LineBuffer } from './lineBuffer';
import type { GapEntry, LogEntry, LogLevel } from './types';

/** The mock's ranks: a minimum rank keeps the levels at or above it. */
export const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { trace: 0, debug: 0, info: 1, warn: 2, error: 3 };

/** Past this many dead slots, and once they are half of the index, the index is rebuilt without them. */
const COMPACT_AFTER = 4096;

function rankOf(entry: LogEntry): number {
  return entry.kind === 'gap' ? Number.POSITIVE_INFINITY : LEVEL_RANK[entry.level ?? 'info'];
}

export class LineView {
  private minRank = 0;
  /** The ordinals that pass, ascending; live from `start`. Unused (empty) while the view shows everything. */
  private ordinals: number[] = [];
  private start = 0;
  /** The lines among what a filtered view shows (the markers are not lines). */
  private shownLines = 0;
  /** What the markers that left the head of the buffer stood for: lines the feed dropped before the oldest entry the buffer holds. 0 while there is no lead. */
  private headDropped = 0;
  /** The row that says it, made when it is asked for and kept while its ordinal and its count stay. */
  private headEntry: GapEntry | undefined;

  private readonly source: LineBuffer;

  constructor(buffer: LineBuffer) {
    this.source = buffer;
  }

  get rank(): number {
    return this.minRank;
  }

  /** How many entries the view shows, the lead included. */
  get length(): number {
    return this.lead + (this.minRank === 0 ? this.source.length : this.ordinals.length - this.start);
  }

  /** How many of the entries are lines, markers left out: what the strip counts. */
  get lineCount(): number {
    return this.minRank === 0 ? this.source.lines : this.shownLines;
  }

  /** The size of the index behind a filtered view, for tests: 0 while the view shows everything. */
  get indexSize(): number {
    return this.ordinals.length;
  }

  /** The entry at `index` of the view. The index must be inside it. */
  at(index: number): LogEntry {
    if (this.lead === 1) {
      if (index === 0) {
        return this.head();
      }

      index -= 1;
    }

    return this.minRank === 0 ? this.source.at(index) : this.source.at((this.ordinals[this.start + index] ?? 0) - this.source.first);
  }

  ordinalAt(index: number): number {
    if (this.lead === 1) {
      if (index === 0) {
        return this.source.first - 1;
      }

      index -= 1;
    }

    return this.minRank === 0 ? this.source.first + index : (this.ordinals[this.start + index] ?? 0);
  }

  /** The index of the first entry of the view whose ordinal is at least `n`; the length when there is none. */
  lowerBound(n: number): number {
    if (this.lead === 1) {
      return n < this.source.first ? 0 : this.entriesFrom(n) + 1;
    }

    return this.entriesFrom(n);
  }

  /** Shows the entries at or above `rank`: 0 shows everything. Rebuilds the index from the buffer once, in one pass. */
  setMinRank(rank: number): void {
    if (rank === this.minRank) {
      return;
    }

    this.minRank = rank;
    this.start = 0;
    this.ordinals = [];
    this.shownLines = 0;
    if (rank === 0) {
      return;
    }

    for (let index = 0; index < this.source.length; index += 1) {
      const entry = this.source.at(index);
      if (rankOf(entry) >= rank) {
        this.ordinals.push(entry.n);
        this.shownLines += entry.kind === 'line' ? 1 : 0;
      }
    }
  }

  /**
   * The buffer took `entry` as its newest, and gave back `evicted` when that pushed its oldest out: the view takes the one and forgets the other, except a marker, which it keeps as the
   * lead. Returns how many rows left the head of the list, which is how far a reader scrolled back has to be moved to stay on the same line: a marker that became the lead is one row
   * that did not leave (it is where it was), and one that joined a lead already there is a row that did.
   */
  pushed(entry: LogEntry, evicted?: LogEntry): number {
    const replaced = evicted?.kind === 'gap' ? this.keep([evicted]) : 0;
    if (this.minRank === 0) {
      return evicted === undefined ? 0 : 1 - replaced;
    }

    if (rankOf(entry) >= this.minRank) {
      this.ordinals.push(entry.n);
      this.shownLines += entry.kind === 'line' ? 1 : 0;
    }

    if (evicted?.kind === 'line' && rankOf(evicted) >= this.minRank) {
      this.shownLines -= 1;
    }

    return this.trim() - replaced;
  }

  /**
   * The buffer gave up its oldest entries because its capacity went down (`LineBuffer.resize`): the view forgets them, as `pushed` forgets the one a full ring overwrites, and keeps their
   * markers as the lead. Returns how many rows left the head of the list.
   */
  shrunk(evicted: readonly LogEntry[]): number {
    const replaced = this.keep(evicted);
    if (this.minRank === 0) {
      return evicted.length - replaced;
    }

    for (const entry of evicted) {
      if (entry.kind === 'line' && rankOf(entry) >= this.minRank) {
        this.shownLines -= 1;
      }
    }

    return this.trim() - replaced;
  }

  /**
   * The buffer was emptied (`LineBuffer.clear`): the view shows nothing and holds no index. It keeps the level the reader chose, so what comes next is filtered as before, and it forgets the lead:
   * what a marker that reached the head stood for was a count of lines that are not held any more, and the reader cleared the place it was told of.
   */
  reset(): void {
    this.ordinals = [];
    this.start = 0;
    this.shownLines = 0;
    this.headDropped = 0;
    this.headEntry = undefined;
  }

  /** 1 while the view has a lead, else 0: the rows before the entries of the buffer. */
  private get lead(): number {
    return this.headDropped > 0 ? 1 : 0;
  }

  /** The row of the lead: the ordinal moves with the buffer's head, the count with the markers that reach it. */
  private head(): GapEntry {
    const n = this.source.first - 1;
    if (this.headEntry?.n !== n || this.headEntry.dropped !== this.headDropped) {
      this.headEntry = { kind: 'gap', n, dropped: this.headDropped };
    }

    return this.headEntry;
  }

  /** `lowerBound` over the entries of the buffer alone: the lead is not among them. */
  private entriesFrom(n: number): number {
    if (this.minRank === 0) {
      return Math.min(Math.max(n - this.source.first, 0), this.source.length);
    }

    let low = this.start;
    let high = this.ordinals.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((this.ordinals[middle] ?? 0) < n) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low - this.start;
  }

  /** Adds what the markers among `evicted` stood for to the lead; returns 1 when that made the lead, else 0. */
  private keep(evicted: readonly LogEntry[]): number {
    const had = this.headDropped > 0;
    for (const entry of evicted) {
      if (entry.kind === 'gap') {
        this.headDropped += entry.dropped;
      }
    }

    return !had && this.headDropped > 0 ? 1 : 0;
  }

  /** Drops the ordinals below the buffer's first; returns how many it dropped. */
  private trim(): number {
    const first = this.source.first;
    let dropped = 0;
    while ((this.ordinals[this.start] ?? Number.POSITIVE_INFINITY) < first) {
      this.start += 1;
      dropped += 1;
    }

    if (this.start >= COMPACT_AFTER && this.start * 2 >= this.ordinals.length) {
      this.ordinals = this.ordinals.slice(this.start);
      this.start = 0;
    }

    return dropped;
  }
}

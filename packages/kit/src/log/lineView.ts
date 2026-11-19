// The lines the viewer shows: the whole buffer, or the entries at or above a minimum level. The level quick filter of the mock (All, Info+, Warn+, Error)
// is a rank; a marker (a gap) always shows, and a line that says no level counts as info (the mock's `LEVEL_RANK[level] ?? 1`).
//
// A view of everything is the buffer: no array, no copy. A filtered view keeps the ordinals that pass in an array that grows at the end and loses its head
// as the buffer evicts, compacted once most of it is dead, so a filtered view of a 100,000-line buffer costs one number per line shown (HLT-16: no
// filtered copy of the entries, no rescan of the buffer per frame).
import type { LineBuffer } from './lineBuffer';
import type { LogEntry, LogLevel } from './types';

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

  private readonly source: LineBuffer;

  constructor(buffer: LineBuffer) {
    this.source = buffer;
  }

  get rank(): number {
    return this.minRank;
  }

  /** How many entries the view shows. */
  get length(): number {
    return this.minRank === 0 ? this.source.length : this.ordinals.length - this.start;
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
    return this.minRank === 0 ? this.source.at(index) : this.source.at((this.ordinals[this.start + index] ?? 0) - this.source.first);
  }

  ordinalAt(index: number): number {
    return this.minRank === 0 ? this.source.first + index : (this.ordinals[this.start + index] ?? 0);
  }

  /** The index of the first entry of the view whose ordinal is at least `n`; the length when there is none. */
  lowerBound(n: number): number {
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
   * The buffer took `entry` as its newest, and gave back `evicted` when that pushed its oldest out: the view takes the one and forgets the other.
   * Returns how many entries left the head of the view, which is how far a reader scrolled back has to be moved to stay on the same line.
   */
  pushed(entry: LogEntry, evicted?: LogEntry): number {
    if (this.minRank === 0) {
      return evicted === undefined ? 0 : 1;
    }

    if (rankOf(entry) >= this.minRank) {
      this.ordinals.push(entry.n);
      this.shownLines += entry.kind === 'line' ? 1 : 0;
    }

    if (evicted?.kind === 'line' && rankOf(evicted) >= this.minRank) {
      this.shownLines -= 1;
    }

    return this.trim();
  }

  /**
   * The buffer gave up its oldest entries because its capacity went down (`LineBuffer.resize`): the view forgets them, as `pushed` forgets the one a full ring overwrites.
   * Returns how many entries left the head of the view.
   */
  shrunk(evicted: readonly LogEntry[]): number {
    if (this.minRank === 0) {
      return evicted.length;
    }

    for (const entry of evicted) {
      if (entry.kind === 'line' && rankOf(entry) >= this.minRank) {
        this.shownLines -= 1;
      }
    }

    return this.trim();
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

// The display buffer of the log view: one ring of entries with a capacity (HLT-4, MNR-L2: 100,000 lines, head eviction, never a copy; the capacity can change while entries are held).
//
// Provenance: the technique of `ui/providers/BottomDrawer/containers/LogViewer/hooks/useLogBuffer.ts` (one mutable array, appends that never copy, an
// eviction counter, render requested once per frame by the caller). The array and its head `splice` are not carried: a ring overwrites the oldest slot in
// O(1), where `splice(0, n)` moves every held line, and entries carry an ordinal that is never reused, so nothing that names a line (a row's key, the
// selection, a search match, the scroll anchor) has to be shifted when the head goes.
import type { LogEntry } from './types';

export class LineBuffer {
  private cap: number;
  private slots: Array<LogEntry | undefined>;
  /** The index of the oldest entry in `slots`. */
  private head = 0;
  private size = 0;
  private upcoming = 1;
  private gone = 0;
  private goneLines = 0;
  private markers = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('capacity must be a positive integer');
    }

    this.cap = capacity;
    this.slots = new Array<LogEntry | undefined>(capacity);
  }

  /** The most entries the buffer holds. */
  get capacity(): number {
    return this.cap;
  }

  /** Entries held. */
  get length(): number {
    return this.size;
  }

  /** Lines held: the entries that are not markers. */
  get lines(): number {
    return this.size - this.markers;
  }

  /** The ordinal of the oldest entry held; the next ordinal while the buffer is empty. */
  get first(): number {
    return this.upcoming - this.size;
  }

  /** The ordinal the next entry must carry. */
  get next(): number {
    return this.upcoming;
  }

  /** Entries pushed out of the head since the buffer was made, markers included. */
  get evicted(): number {
    return this.gone;
  }

  /** Lines pushed out of the head: what the viewer says it dropped. */
  get evictedLines(): number {
    return this.goneLines;
  }

  /** Appends the next entry. When the ring is full the oldest entry is overwritten and given back, so the caller can trim what refers to it. */
  push(entry: LogEntry): LogEntry | undefined {
    if (entry.n !== this.upcoming) {
      throw new RangeError(`expected entry ${this.upcoming}, got ${entry.n}`);
    }

    this.upcoming += 1;
    if (entry.kind === 'gap') {
      this.markers += 1;
    }

    if (this.size < this.cap) {
      this.slots[(this.head + this.size) % this.cap] = entry;
      this.size += 1;
      return undefined;
    }

    const old = this.slots[this.head];
    this.slots[this.head] = entry;
    this.head = (this.head + 1) % this.cap;
    this.gone += 1;
    if (old?.kind === 'line') {
      this.goneLines += 1;
    } else {
      this.markers -= 1;
    }

    return old;
  }

  /**
   * Changes the capacity. A larger one keeps every entry. A smaller one gives up the OLDEST entries that no longer fit, counted as evicted exactly as the ones a full ring
   * overwrites are, and hands them back oldest first, so the caller can trim what refers to them. Ordinals are untouched.
   */
  resize(capacity: number): LogEntry[] {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('capacity must be a positive integer');
    }

    if (capacity === this.cap) {
      return [];
    }

    const kept = Math.min(this.size, capacity);
    const lost: LogEntry[] = [];
    for (let index = 0; index < this.size - kept; index += 1) {
      const old = this.at(index);
      lost.push(old);
      this.gone += 1;
      if (old.kind === 'line') {
        this.goneLines += 1;
      } else {
        this.markers -= 1;
      }
    }

    const slots = new Array<LogEntry | undefined>(capacity);
    for (let index = 0; index < kept; index += 1) {
      slots[index] = this.at(this.size - kept + index);
    }

    this.slots = slots;
    this.head = 0;
    this.size = kept;
    this.cap = capacity;
    return lost;
  }

  /**
   * Empties the buffer: what it holds is forgotten, and with it the count of lines it had evicted, which is what the strip tells as dropped (a line the reader cleared is not a line the view dropped).
   * The ordinals go on, never reused: a selection, a match or a row's key that named a cleared line names nothing, and can never name a new one. The entries evicted before are not given back.
   */
  clear(): void {
    this.slots.fill(undefined);
    this.head = 0;
    this.size = 0;
    this.goneLines = 0;
    this.markers = 0;
  }

  /** The entry `index` places after the oldest. The index must be inside the buffer. */
  at(index: number): LogEntry {
    return this.slots[(this.head + index) % this.cap]!;
  }

  /** The entry numbered `n`, or undefined when it was evicted or has not come. */
  byOrdinal(n: number): LogEntry | undefined {
    const index = n - this.first;
    return index < 0 || index >= this.size ? undefined : this.at(index);
  }
}

type BrowserErrorRecord = {
  kind: string;
  message: string;
  occurrences: number;
  firstAt: number;
  lastAt: number;
  messageTruncated: boolean;
  coverageIncomplete?: true;
};

/** One fixture's shared, bounded diagnostic artifact across all its pages. */
export class BrowserErrors {
  private readonly records = new Map<string, BrowserErrorRecord>();
  private overflow: BrowserErrorRecord | undefined;

  add(kind: string, message: string, at = Date.now()): void {
    const clipped = message.slice(0, 2048);
    const messageTruncated = message.length > clipped.length;
    const key = JSON.stringify([kind, clipped]);
    const existing = this.records.get(key);
    if (existing) {
      existing.occurrences++;
      existing.lastAt = at;
      existing.messageTruncated ||= messageTruncated;
      return;
    }

    if (this.records.size < 500) {
      this.records.set(key, { kind, message: clipped, occurrences: 1, firstAt: at, lastAt: at, messageTruncated });
      return;
    }

    // Count every unretained occurrence, including repeats: coverage is incomplete.
    if (this.overflow) {
      this.overflow.occurrences++;
      this.overflow.lastAt = at;
    } else {
      this.overflow = {
        kind: 'overflow',
        message: 'Browser error record limit reached; additional occurrences were not retained.',
        occurrences: 1,
        firstAt: at,
        lastAt: at,
        messageTruncated: false,
        coverageIncomplete: true,
      };
    }
  }

  serialize(): string {
    const records = [...this.records.values()];
    if (this.overflow) {
      records.push(this.overflow);
    }

    return JSON.stringify(records, null, 2);
  }
}

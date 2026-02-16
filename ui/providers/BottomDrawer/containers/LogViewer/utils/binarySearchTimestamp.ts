import type { LogEntry } from '../types';

/**
 * Binary search for the first entry with timestamp >= target.
 * Entries are assumed to be in chronological order.
 * Returns the index of the first matching entry, or -1 if no match.
 */
export function findEntryIndexByTime(entries: LogEntry[], target: Date): number {
  if (entries.length === 0) return -1;

  const targetMs = target.getTime();
  let lo = 0;
  let hi = entries.length - 1;
  let result = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const entryTs = entries[mid].timestamp ? new Date(entries[mid].timestamp).getTime() : 0;

    if (entryTs >= targetMs) {
      result = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return result;
}

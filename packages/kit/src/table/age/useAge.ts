import { useSyncExternalStore } from 'react';
import { ageClock, type AgeFormatter, type AgeStore } from './ageClock';

/** What a cell with no value reads: an empty label, and nothing to subscribe to. */
const NO_AGE: AgeStore = { subscribe: () => () => undefined, getSnapshot: () => '' };

/** The timestamp of a value in epoch milliseconds; undefined for an empty or invalid value. Epoch zero is a value. */
function timestampOf(value: string | number | Date | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

/**
 * The age label of a timestamp, kept current by the page's one age clock (`ageClock.ts`). A cell wakes only when its own label
 * changes. An empty or invalid value reads `''` and subscribes to nothing.
 */
export function useAge(value: string | number | Date | null | undefined, formatter: AgeFormatter): string {
  const timestamp = timestampOf(value);
  const store = timestamp === undefined ? NO_AGE : ageClock.store(timestamp, formatter);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * The age clock: one timer for any number of Age cells, with no UI in it.
 *
 * A cell subscribes to a store through `useSyncExternalStore`. Cells with the same timestamp and the same formatter share one
 * store. The clock keeps one timer, set for the earliest instant at which a live label changes; a tick refreshes only the stores
 * that are due. It makes no timer while the document is hidden and refreshes every live store at once when the document is
 * visible again. It holds one `visibilitychange` listener while any store is live, and no timer and no listener after the last
 * store leaves.
 */

/** What a formatter says about a date at one instant. */
export type AgeLabel = {
  readonly text: string;
  /** The epoch millisecond at which `text` next changes; `Infinity` when it never does. */
  readonly changesAt: number;
};

/** A label rule. It must depend on nothing but its two arguments. `now` and `date` are epoch milliseconds, integers. */
export type AgeFormatter = (date: Date, now: number) => AgeLabel;

/** What a cell subscribes to. Both members keep their identity for the life of the store. */
export type AgeStore = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => string;
};

/**
 * The longest the timer ever sleeps. A label can name a change a day away, but the wall clock can move under a sleeping timer (a
 * user, NTP, a time-zone change) and every label then needs a new reading. A timer notices that only when it fires, so no sleep is
 * longer than a minute: a clock change shows within a minute, whatever the labels say.
 */
export const MAX_SLEEP_MS = 60_000;

/** A tick whose `now` is further than this from the instant it was set for sees a clock change (or a long stall) and refreshes every store. */
const CLOCK_JUMP_TOLERANCE_MS = 250;

/** The part of `Document` the clock uses. */
export type AgeClockDocument = {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

export type AgeClockOptions = {
  /** Epoch milliseconds; default `Date.now`. */
  readonly now?: () => number;
  /** Default: the global `setTimeout`, looked up at each call so a test's fake timers apply. */
  readonly setTimeout?: (handler: () => void, delay: number) => unknown;
  readonly clearTimeout?: (handle: never) => void;
  /** Default: the global `document`, when there is one. */
  readonly document?: AgeClockDocument;
};

export type AgeClock = {
  /** The store of one timestamp (epoch milliseconds) under one formatter; the same arguments give the same store while it is in use. */
  readonly store: (timestamp: number, formatter: AgeFormatter) => AgeStore;
  /** How many stores have a listener now. For tests. */
  readonly _liveStores: () => number;
};

/** A store as the clock sees it. */
type Entry = AgeStore & {
  /** The instant of the next change, never at or before the instant of the last refresh. */
  next: number;
  refresh: (now: number) => void;
  /** Whether the label no longer reads right at `now`: its change is due, or the clock went back since the last refresh. */
  stale: (now: number) => boolean;
};

type Pending = { readonly handle: unknown; readonly at: number };

export function createAgeClock(options: AgeClockOptions = {}): AgeClock {
  const readNow = options.now ?? (() => Date.now());
  const setTimer = options.setTimeout ?? ((handler, delay) => globalThis.setTimeout(handler, delay));
  // The type of a handle is the supplier's: `clearTimeout` is given only what `setTimeout` returned.
  const clearTimer = (options.clearTimeout ?? ((handle: never) => {
    globalThis.clearTimeout(handle);
  })) as (handle: unknown) => void;
  const getDocument = (): AgeClockDocument | undefined =>
    options.document ?? (typeof document === 'undefined' ? undefined : document);

  const live = new Set<Entry>();
  let pending: Pending | undefined;
  let attachedTo: AgeClockDocument | undefined;

  const isHidden = () => getDocument()?.hidden === true;

  function stopTimer() {
    if (pending === undefined) {
      return;
    }

    clearTimer(pending.handle);
    pending = undefined;
  }

  /** Sleeps until `at`, unless an earlier alarm is already set. `at` is already capped by `MAX_SLEEP_MS`. */
  function arm(at: number, now: number) {
    if (pending !== undefined && pending.at <= at) {
      return;
    }

    stopTimer();
    pending = { at, handle: setTimer(tick, Math.max(1, at - now)) };
  }

  function tick() {
    const expected = pending?.at ?? Infinity;
    pending = undefined;
    if (isHidden() || live.size === 0) {
      return;
    }

    const now = readNow();
    const clockChanged = Math.abs(now - expected) > CLOCK_JUMP_TOLERANCE_MS;
    let next = Infinity;
    for (const entry of live) {
      if (clockChanged || entry.next <= now) {
        entry.refresh(now);
      }

      if (entry.next < next) {
        next = entry.next;
      }
    }

    if (live.size > 0) {
      arm(Math.min(next, now + MAX_SLEEP_MS), now);
    }
  }

  function visibilityChanged() {
    stopTimer();
    if (isHidden() || live.size === 0) {
      return;
    }

    const now = readNow();
    let next = Infinity;
    for (const entry of live) {
      entry.refresh(now);
      if (entry.next < next) {
        next = entry.next;
      }
    }

    if (live.size > 0) {
      arm(Math.min(next, now + MAX_SLEEP_MS), now);
    }
  }

  function join(entry: Entry) {
    if (live.size === 0) {
      attachedTo = getDocument();
      attachedTo?.addEventListener('visibilitychange', visibilityChanged);
    }

    live.add(entry);
    if (isHidden()) {
      return;
    }

    const now = readNow();
    if (entry.stale(now)) {
      entry.refresh(now);
    }

    arm(Math.min(entry.next, now + MAX_SLEEP_MS), now);
  }

  function leave(entry: Entry) {
    live.delete(entry);
    if (live.size > 0) {
      return;
    }

    // With other stores left, an alarm set for this one stays: one early tick costs less than a scan of every store on each unmount.
    stopTimer();
    attachedTo?.removeEventListener('visibilitychange', visibilityChanged);
    attachedTo = undefined;
  }

  function createEntry(timestamp: number, formatter: AgeFormatter): Entry {
    const date = new Date(timestamp);
    const listeners = new Set<() => void>();
    let text = '';
    let readAt = -Infinity;
    // Due, or read at a later instant than now: the clock went back, and the label is of the future.
    const isStale = (now: number) => entry.next <= now || now < readAt;
    const entry: Entry = {
      next: Infinity,
      stale: isStale,
      refresh(now) {
        readAt = now;
        const label = formatter(date, now);
        // A formatter that names a change at or before `now` would wake the timer in a loop.
        entry.next = Math.max(label.changesAt, now + 1);
        if (label.text === text) {
          return;
        }

        text = label.text;
        for (const listener of [...listeners]) {
          listener();
        }
      },
      subscribe(listener) {
        listeners.add(listener);
        if (listeners.size === 1) {
          join(entry);
        }

        return () => {
          if (listeners.delete(listener) && listeners.size === 0) {
            leave(entry);
          }
        };
      },
      getSnapshot() {
        // A live store is kept current by the ticks, and a hidden one stays as it was. One that nobody reads reads the clock.
        if (listeners.size === 0) {
          const now = readNow();
          if (isStale(now)) {
            entry.refresh(now);
          }
        }

        return text;
      },
    };
    entry.refresh(readNow());
    return entry;
  }

  // Stores are held weakly: one that no cell holds any more (a render that never committed, an unmounted cell) is collected, and
  // its key is dropped from the map.
  const byFormatter = new WeakMap<AgeFormatter, Map<number, WeakRef<Entry>>>();
  const keys = new FinalizationRegistry<{ readonly stores: Map<number, WeakRef<Entry>>; readonly timestamp: number; readonly ref: WeakRef<Entry> }>(
    ({ stores, timestamp, ref }) => {
      if (stores.get(timestamp) === ref) {
        stores.delete(timestamp);
      }
    },
  );

  return {
    store(timestamp, formatter) {
      let stores = byFormatter.get(formatter);
      if (stores === undefined) {
        stores = new Map();
        byFormatter.set(formatter, stores);
      }

      const found = stores.get(timestamp)?.deref();
      if (found !== undefined) {
        return found;
      }

      const entry = createEntry(timestamp, formatter);
      const ref = new WeakRef(entry);
      stores.set(timestamp, ref);
      keys.register(entry, { stores, timestamp, ref });
      return entry;
    },
    _liveStores: () => live.size,
  };
}

/** The clock `useAge` uses: one per page. */
export const ageClock = createAgeClock();

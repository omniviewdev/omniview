import { useMemo, useSyncExternalStore } from 'react';
import { addDays, differenceInDays } from 'date-fns';
import { formatTimeDifference } from './time';

// Private to this renderer. Only subscribed cells participate in scheduling.
const stores = new Set<AgeStore>();
let timer: number | undefined;
let timerAt = Infinity;
let timezoneOffset: number | undefined;

function stopTimer() {
  window.clearTimeout(timer);
  timer = undefined;
  timerAt = Infinity;
}

function schedule(at: number) {
  // Keep one shared heartbeat to detect wall-clock/timezone changes even when
  // every label's next display boundary is hours away.
  at = Math.min(at, Date.now() + 1000);
  if (document.hidden || stores.size === 0 || timerAt <= at) {
    return;
  }

  stopTimer();
  timezoneOffset ??= new Date().getTimezoneOffset();
  timerAt = at;
  timer = window.setTimeout(tick, Math.max(1, at - Date.now()));
}

function scheduleRemaining() {
  let next = Infinity;
  for (const store of stores) {
    next = Math.min(next, store.next);
  }

  schedule(next);
}

function tick() {
  const expected = timerAt;
  stopTimer();
  if (document.hidden) {
    return;
  }

  const now = Date.now();
  const offset = new Date(now).getTimezoneOffset();
  const clockChanged = Math.abs(now - expected) > 100 || offset !== timezoneOffset;
  timezoneOffset = offset;
  for (const store of stores) {
    if (clockChanged || store.next <= now) {
      store.update(now);
    }
  }

  scheduleRemaining();
}

function visibilityChanged() {
  stopTimer();
  if (document.hidden) {
    return;
  }

  const now = Date.now();
  for (const store of stores) {
    store.update(now);
  }

  scheduleRemaining();
}

// date-fns uses full local days, not fixed 24-hour intervals. Include offset
// transitions: a skipped/repeated local anniversary can change the day label.
function nextDayChange(date: Date, now: number, days: number): number {
  let next = addDays(date, days + 1).getTime();
  const offset = new Date(now).getTimezoneOffset();
  if (next <= now) {
    next += (offset - new Date(next).getTimezoneOffset()) * 60_000;
  }

  if (!Number.isFinite(next) || next <= now) {
    return Infinity;
  }

  if (new Date(next).getTimezoneOffset() !== offset) {
    let low = now;
    let high = next;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (new Date(middle).getTimezoneOffset() === offset) {
        low = middle;
      } else {
        high = middle;
      }
    }

    if (differenceInDays(new Date(high), date) !== days) {
      return high;
    }
  }

  return next;
}

function nextChange(date: Date, now: number): number {
  const timestamp = date.getTime();
  const elapsed = now - timestamp;
  if (elapsed <= -1000) {
    // Truncation toward zero changes negative seconds just after the boundary.
    return timestamp + Math.trunc(elapsed / 1000) * 1000 + 1;
  }

  if (elapsed < 0) {
    return timestamp + 1000;
  }

  const days = differenceInDays(new Date(now), date);
  const dayChange = nextDayChange(date, now, days);
  if (days > 0) {
    return dayChange;
  }

  const unit = elapsed >= 3_600_000 ? 60_000 : 1000;
  return Math.min(timestamp + (Math.floor(elapsed / unit) + 1) * unit, dayChange);
}

class AgeStore {
  next = Infinity;
  private label = '0s';
  private readonly date: Date | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(timestamp: number) {
    if (Number.isFinite(timestamp)) {
      this.date = new Date(timestamp);
      this.update(Date.now());
    }
  }

  update(now: number) {
    if (!this.date) {
      return;
    }

    const previous = this.label;
    this.label = formatTimeDifference(this.date);
    this.next = nextChange(this.date, now);
    if (this.label !== previous) {
      for (const listener of this.listeners) {
        listener();
      }
    }
  }

  getSnapshot = () => this.label;

  subscribe = (listener: () => void) => {
    if (!this.date) {
      return () => undefined;
    }

    this.listeners.add(listener);
    if (!stores.has(this)) {
      if (stores.size === 0) {
        document.addEventListener('visibilitychange', visibilityChanged);
      }

      stores.add(this);
      const now = Date.now();
      if (!document.hidden && this.next <= now) {
        this.update(now);
      }

      schedule(this.next);
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size !== 0) {
        return;
      }

      stores.delete(this);
      // Retain one early alarm rather than rescan all stores on each unmount.
      if (stores.size === 0) {
        stopTimer();
        timezoneOffset = undefined;
        document.removeEventListener('visibilitychange', visibilityChanged);
      }
    };
  };
}

/** Subscribe to this renderer's clock without waking unchanged age labels. */
export function useAge(value: string | number | Date | null | undefined): string {
  const timestamp = useMemo(
    () => value === null || value === undefined || value === ''
      ? NaN
      : value instanceof Date ? value.getTime() : new Date(value).getTime(),
    [value],
  );
  const store = useMemo(() => new AgeStore(timestamp), [timestamp]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

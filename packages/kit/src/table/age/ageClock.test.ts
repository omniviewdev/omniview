import { describe, expect, it, vi } from 'vitest';
import { createAgeClock, MAX_SLEEP_MS, type AgeFormatter } from './ageClock';

type Timer = { readonly at: number; readonly run: () => void };

/**
 * A clock with no real time in it. `advance` moves the monotonic time that timers run on; `jump` moves the wall clock alone, the
 * way a user, NTP or a time-zone change does while a timer is waiting.
 */
function harness(start = 1_000_000) {
  let monotonic = 0;
  let skew = start;
  let hidden = false;
  let nextHandle = 1;
  const timers = new Map<number, Timer>();
  const visibility = new Set<() => void>();
  const delays: number[] = [];
  const document = {
    get hidden() {
      return hidden;
    },
    addEventListener(type: 'visibilitychange', listener: () => void) {
      if (type === 'visibilitychange') {
        visibility.add(listener);
      }
    },
    removeEventListener(type: 'visibilitychange', listener: () => void) {
      if (type === 'visibilitychange') {
        visibility.delete(listener);
      }
    },
  };
  const clock = createAgeClock({
    now: () => monotonic + skew,
    setTimeout: (run, delay) => {
      const handle = nextHandle++;
      delays.push(delay);
      timers.set(handle, { at: monotonic + delay, run });
      return handle;
    },
    clearTimeout: (handle: number) => {
      timers.delete(handle);
    },
    document,
  });
  return {
    clock,
    delays,
    get now() {
      return monotonic + skew;
    },
    get timers() {
      return timers.size;
    },
    get listeners() {
      return visibility.size;
    },
    advance(ms: number) {
      const end = monotonic + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort(([, a], [, b]) => a.at - b.at)[0];
        if (!due) {
          break;
        }

        timers.delete(due[0]);
        monotonic = Math.max(monotonic, due[1].at);
        due[1].run();
      }

      monotonic = end;
    },
    jump(ms: number) {
      skew += ms;
    },
    setHidden(value: boolean) {
      hidden = value;
      for (const listener of [...visibility]) {
        listener();
      }
    },
  };
}

/** A formatter whose label is the number of times it has been called, with the change instant chosen by the test. */
function counting(changesIn: (date: Date, now: number) => number) {
  let calls = 0;
  const formatter: AgeFormatter = (date, now) => {
    calls++;
    return { text: `${Math.floor(now / 1000)}`, changesAt: changesIn(date, now) };
  };

  return { formatter, calls: () => calls };
}

/** A formatter that reads whole seconds since the timestamp. */
const seconds: AgeFormatter = (date, now) => ({
  text: `${Math.floor((now - date.getTime()) / 1000)}s`,
  changesAt: date.getTime() + (Math.floor((now - date.getTime()) / 1000) + 1) * 1000,
});

describe('createAgeClock: stores', () => {
  it('shares one store between cells of one timestamp and one formatter', () => {
    const h = harness();
    expect(h.clock.store(5, seconds)).toBe(h.clock.store(5, seconds));
    expect(h.clock.store(5, seconds)).not.toBe(h.clock.store(6, seconds));
    expect(h.clock.store(5, seconds)).not.toBe(h.clock.store(5, (date, now) => seconds(date, now)));
  });

  it('reads a snapshot without a timer, a listener or a live store until someone subscribes', () => {
    const h = harness();
    const store = h.clock.store(h.now - 5000, seconds);
    expect(store.getSnapshot()).toBe('5s');
    expect(h.timers).toBe(0);
    expect(h.listeners).toBe(0);
    expect(h.clock._liveStores()).toBe(0);
  });

  it('keeps a snapshot current while nobody listens, and stable between two reads', () => {
    const h = harness();
    const store = h.clock.store(h.now - 5000, seconds);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    h.advance(3000);
    expect(store.getSnapshot()).toBe('8s');
  });
});

describe('createAgeClock: one timer, one listener', () => {
  it('serves many stores and many listeners with one timer and one visibilitychange listener', () => {
    const h = harness();
    const unsubscribe: Array<() => void> = [];
    for (let index = 0; index < 500; index++) {
      const store = h.clock.store(h.now - 5000 - (index % 7) * 1000, seconds);
      unsubscribe.push(store.subscribe(() => undefined), store.subscribe(() => undefined));
    }

    expect(h.timers).toBe(1);
    expect(h.listeners).toBe(1);
    expect(h.clock._liveStores()).toBe(7);
    h.advance(1000);
    expect(h.timers).toBe(1);
    for (const stop of unsubscribe) {
      stop();
    }

    expect(h.timers).toBe(0);
    expect(h.listeners).toBe(0);
    expect(h.clock._liveStores()).toBe(0);
  });

  it('sleeps until the earliest changesAt of the live stores', () => {
    const h = harness();
    const far = counting((_date, now) => now + 40_000);
    const near = counting((_date, now) => now + 7000);
    h.clock.store(1, far.formatter).subscribe(() => undefined);
    h.clock.store(2, near.formatter).subscribe(() => undefined);
    expect(h.delays.at(-1)).toBe(7000);
  });

  it('never sleeps more than MAX_SLEEP_MS, so a clock change is noticed within a minute', () => {
    expect(MAX_SLEEP_MS).toBe(60_000);
    const h = harness();
    const never = counting(() => Infinity);
    h.clock.store(1, never.formatter).subscribe(() => undefined);
    expect(h.delays).toEqual([MAX_SLEEP_MS]);
    const later = counting((_date, now) => now + 600_000);
    h.clock.store(2, later.formatter).subscribe(() => undefined);
    expect(h.delays).toEqual([MAX_SLEEP_MS]);
  });

  it('moves its alarm earlier when a store with an earlier change joins', () => {
    const h = harness();
    const slow = counting((_date, now) => now + 30_000);
    h.clock.store(1, slow.formatter).subscribe(() => undefined);
    expect(h.timers).toBe(1);
    const fast = counting((_date, now) => now + 2000);
    h.clock.store(2, fast.formatter).subscribe(() => undefined);
    expect(h.timers).toBe(1);
    expect(h.delays).toEqual([30_000, 2000]);
  });

  it('sleeps again after each tick, until the next change', () => {
    const h = harness();
    const store = h.clock.store(h.now - 5250, seconds);
    store.subscribe(() => undefined);
    expect(h.delays).toEqual([750]);
    h.advance(750);
    expect(h.delays).toEqual([750, 1000]);
    h.advance(1000);
    expect(h.delays).toEqual([750, 1000, 1000]);
    expect(store.getSnapshot()).toBe('7s');
  });

  it('cannot spin on a formatter that names a change in the past', () => {
    const h = harness();
    const broken = counting((_date, now) => now - 10);
    h.clock.store(1, broken.formatter).subscribe(() => undefined);
    expect(h.delays.every((delay) => delay >= 1)).toBe(true);
    h.advance(10);
    expect(h.delays.length).toBeLessThanOrEqual(11);
  });
});

describe('createAgeClock: a tick refreshes only what is due', () => {
  it('formats only the stores whose change instant has come, and wakes only listeners whose text changed', () => {
    const h = harness();
    const quick = counting((_date, now) => now + 1000);
    const slow = counting((_date, now) => now + 30_000);
    const onQuick = vi.fn();
    const onSlow = vi.fn();
    const a = h.clock.store(1, quick.formatter);
    const b = h.clock.store(2, slow.formatter);
    a.subscribe(onQuick);
    b.subscribe(onSlow);
    const before = { quick: quick.calls(), slow: slow.calls() };
    h.advance(1000);
    expect(quick.calls()).toBe(before.quick + 1);
    expect(slow.calls()).toBe(before.slow);
    expect(onQuick).toHaveBeenCalledTimes(1);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('does not wake a listener when the refreshed text is the same', () => {
    const h = harness();
    const same: AgeFormatter = (_date, now) => ({ text: 'fixed', changesAt: now + 1000 });
    const listener = vi.fn();
    h.clock.store(1, same).subscribe(listener);
    h.advance(5000);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createAgeClock: hidden', () => {
  it('has no timer while the document is hidden, and none when a store subscribes while hidden', () => {
    const h = harness();
    h.setHidden(true);
    const store = h.clock.store(h.now - 5000, seconds);
    store.subscribe(() => undefined);
    expect(h.timers).toBe(0);
    expect(h.listeners).toBe(1);
    h.setHidden(false);
    expect(h.timers).toBe(1);
  });

  it('freezes hidden cells, refreshes every live store at once on becoming visible, and sleeps again', () => {
    const h = harness();
    const first = h.clock.store(h.now - 5000, seconds);
    const second = h.clock.store(h.now - 90_000, seconds);
    const wakes = vi.fn();
    first.subscribe(wakes);
    second.subscribe(wakes);
    h.setHidden(true);
    expect(h.timers).toBe(0);
    h.advance(10 * 60_000);
    expect(first.getSnapshot()).toBe('5s');
    expect(second.getSnapshot()).toBe('90s');
    expect(wakes).not.toHaveBeenCalled();
    h.setHidden(false);
    expect(first.getSnapshot()).toBe('605s');
    expect(second.getSnapshot()).toBe('690s');
    expect(wakes).toHaveBeenCalledTimes(2);
    expect(h.timers).toBe(1);
  });

  it('formats nothing while hidden, even when a timer is still pending as the page hides', () => {
    const h = harness();
    const count = counting((_date, now) => now + 1000);
    h.clock.store(1, count.formatter).subscribe(() => undefined);
    const before = count.calls();
    h.setHidden(true);
    h.advance(60_000);
    expect(count.calls()).toBe(before);
  });
});

describe('createAgeClock: a clock change', () => {
  it.each([-2 * 86_400_000, 2 * 86_400_000, 3_600_000, -3_600_000])('refreshes every store on the tick after a %i ms jump', (jump) => {
    const h = harness();
    const dueSoon = counting((_date, now) => now + 1000);
    const notDue = counting((_date, now) => now + 600_000);
    const a = h.clock.store(1, dueSoon.formatter);
    const b = h.clock.store(2, notDue.formatter);
    a.subscribe(() => undefined);
    b.subscribe(() => undefined);
    const before = notDue.calls();
    h.jump(jump);
    h.advance(1000);
    expect(notDue.calls()).toBe(before + 1);
    expect(b.getSnapshot()).toBe(`${Math.floor(h.now / 1000)}`);
  });

  it('is noticed within MAX_SLEEP_MS even when every label is far from changing', () => {
    const h = harness();
    const never = counting(() => Infinity);
    const store = h.clock.store(1, never.formatter);
    store.subscribe(() => undefined);
    const before = never.calls();
    h.jump(86_400_000);
    h.advance(MAX_SLEEP_MS);
    expect(never.calls()).toBe(before + 1);
  });

  it('does not refresh a store that is not due when the timer fires on time', () => {
    const h = harness();
    const notDue = counting((_date, now) => now + 600_000);
    h.clock.store(1, notDue.formatter).subscribe(() => undefined);
    const before = notDue.calls();
    h.advance(MAX_SLEEP_MS);
    expect(notDue.calls()).toBe(before);
  });
});

describe('createAgeClock: leaving', () => {
  it('adds the listener on the first live store, keeps one for the rest, and removes it on the last unsubscribe', () => {
    const h = harness();
    const a = h.clock.store(h.now - 5000, seconds).subscribe(() => undefined);
    expect(h.listeners).toBe(1);
    const b = h.clock.store(h.now - 9000, seconds).subscribe(() => undefined);
    expect(h.listeners).toBe(1);
    a();
    expect(h.listeners).toBe(1);
    expect(h.timers).toBe(1);
    b();
    expect(h.listeners).toBe(0);
    expect(h.timers).toBe(0);
    expect(h.clock._liveStores()).toBe(0);
  });

  it('counts a store live once however many listeners it has, and unsubscribing twice is harmless', () => {
    const h = harness();
    const store = h.clock.store(h.now - 5000, seconds);
    const first = store.subscribe(() => undefined);
    const second = store.subscribe(() => undefined);
    expect(h.clock._liveStores()).toBe(1);
    first();
    first();
    expect(h.clock._liveStores()).toBe(1);
    second();
    expect(h.clock._liveStores()).toBe(0);
    expect(h.timers).toBe(0);
  });

  it('works again after everything left (the Strict Mode order: subscribe, unsubscribe, subscribe)', () => {
    const h = harness();
    const store = h.clock.store(h.now - 5000, seconds);
    store.subscribe(() => undefined)();
    expect(h.timers).toBe(0);
    expect(h.listeners).toBe(0);
    const stop = store.subscribe(() => undefined);
    expect(h.timers).toBe(1);
    expect(h.listeners).toBe(1);
    stop();
    expect(h.timers).toBe(0);
  });
});

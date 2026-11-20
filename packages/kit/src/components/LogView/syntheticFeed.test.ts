// The synthetic feed keeps the contract of the runtime's stream (packages/omniviewdev-runtime/src/logStream.ts), which the view is written against: the
// listener runs for every change of the status, whether or not lines are held, and the feed never holds more than `maxHeld` lines, whatever the reader does.
import { describe, expect, it, vi } from 'vitest';
import { SyntheticFeed } from './syntheticFeed';

const cause = { stage: 'session', message: 'the source went away' } as const;

describe('a change of state reaches the listeners (the runtime publishes every one)', () => {
  it('tells the listener of each state an empty feed goes through, not only the first', () => {
    const feed = new SyntheticFeed({ state: 'starting' });
    const listener = vi.fn();
    feed.subscribe(listener);

    feed.setState('streaming');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot().state).toBe('streaming');

    // The reader has not read in between (a view that is hidden, or a frame that has not come yet): the second change is still a change.
    feed.setState('failed', cause);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(feed.getSnapshot()).toEqual({ state: 'failed', paused: false, cause });
  });

  it('tells the listener of a pause and of a resume on an empty feed', () => {
    const feed = new SyntheticFeed({ state: 'streaming' });
    const listener = vi.fn();
    feed.subscribe(listener);

    feed.pause();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot().paused).toBe(true);

    feed.pause();
    feed.resume();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(feed.getSnapshot().paused).toBe(false);
    expect(feed.getSnapshot().state).toBe('streaming');
  });

  it('gives a new snapshot object for each change, so a store that compares by identity sees it', () => {
    const feed = new SyntheticFeed({ state: 'starting' });
    const seen = new Set([feed.getSnapshot()]);
    feed.setState('streaming');
    seen.add(feed.getSnapshot());
    feed.setState('failed', cause);
    seen.add(feed.getSnapshot());
    expect(seen.size).toBe(3);
  });

  // The runtime's stream: a pause is the reader's and `paused` stays "whatever `state` says"; a session that ends or fails while paused is still held, and `read` returns nothing
  // until the pause is lifted (logStream.ts: `read` returns nothing when `closed || paused`, `resume` leaves `ended` and `failed` as they are).
  it('keeps a pause through an end and a failure, as the runtime stream does, and holds its lines until the pause is lifted', () => {
    const feed = new SyntheticFeed();
    feed.pause();
    feed.push([feed.line('a'), feed.line('b')]);
    feed.setState('failed', cause);
    expect(feed.getSnapshot()).toEqual({ state: 'failed', paused: true, cause });
    expect(feed.read(10).lines).toEqual([]);
    feed.resume();
    expect(feed.getSnapshot()).toEqual({ state: 'failed', paused: false, cause });
    expect(feed.read(10).lines.map((line) => line.text)).toEqual(['a', 'b']);

    const ended = new SyntheticFeed();
    ended.pause();
    ended.setState('ended');
    expect(ended.getSnapshot()).toMatchObject({ state: 'ended', paused: true });
  });

  // The contract of `LogFeed.subscribe`: the listener runs when the status changed and, once, when held lines became readable after a `read`.
  it('wakes the reader once for the lines held until a read: two batches before it are one wake-up, and a read opens the gate again; a status change is never held back by it', () => {
    const feed = new SyntheticFeed({ maxHeld: 100 });
    const listener = vi.fn();
    feed.subscribe(listener);
    feed.push([feed.line('a')]);
    feed.push([feed.line('b')]);
    expect(listener).toHaveBeenCalledTimes(1);
    feed.setState('streaming');
    expect(listener).toHaveBeenCalledTimes(2);
    feed.push([feed.line('c')]);
    expect(listener).toHaveBeenCalledTimes(2);
    feed.read(10);
    feed.push([feed.line('d')]);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('the bound (maxHeld)', () => {
  const MAX = 1000;
  const lines = (feed: SyntheticFeed, from: number, count: number) => Array.from({ length: count }, (_, index) => feed.line(`line ${from + index}`));

  it('holds at most maxHeld lines while paused, however many the source produces, and drops the oldest', () => {
    const feed = new SyntheticFeed({ maxHeld: MAX });
    feed.pause();
    // In pushes of 100, as the source's batches come: five times the bound.
    for (let at = 0; at < 5 * MAX; at += 100) {
      feed.push(lines(feed, at, 100));
    }

    expect(feed.stats()).toEqual({ received: 5 * MAX, dropped: 4 * MAX, held: MAX });
    // The storage, not only the count: a dropped line must not stay referenced.
    expect(feed.stored()).toBeLessThanOrEqual(MAX);

    feed.resume();
    const batch = feed.read(10 * MAX);
    expect(batch.lines).toHaveLength(MAX);
    expect(batch.lines.map((line) => line.text)).toEqual(Array.from({ length: MAX }, (_, index) => `line ${4 * MAX + index}`));
    expect(batch.dropped).toBe(4 * MAX);
    expect(batch.held).toBe(0);
  });

  it('holds at most maxHeld lines for a reader that never reads, paused or not', () => {
    const feed = new SyntheticFeed({ maxHeld: MAX });
    for (let at = 0; at < 3 * MAX; at += 7) {
      feed.push(lines(feed, at, 7));
    }

    expect(feed.stored()).toBeLessThanOrEqual(MAX);
    expect(feed.stats().held).toBe(MAX);
  });

  it('keeps the oldest-first order across partial reads and the wrap of the storage', () => {
    const feed = new SyntheticFeed({ maxHeld: 10 });
    feed.push(lines(feed, 0, 5));
    expect(feed.read(3).lines.map((line) => line.text)).toEqual(['line 0', 'line 1', 'line 2']);

    // Two held, then twelve more: the bound is ten, so the newest ten stay, and the two that were held are among the dropped.
    feed.push(lines(feed, 5, 12));
    expect(feed.stats()).toEqual({ received: 17, dropped: 4, held: 10 });
    const first = feed.read(4);
    expect(first.lines.map((line) => line.text)).toEqual(['line 7', 'line 8', 'line 9', 'line 10']);
    expect(first.dropped).toBe(4);
    expect(first.held).toBe(6);

    feed.push(lines(feed, 17, 3));
    const rest = feed.read(100);
    expect(rest.lines.map((line) => line.text)).toEqual(['line 11', 'line 12', 'line 13', 'line 14', 'line 15', 'line 16', 'line 17', 'line 18', 'line 19']);
    expect(rest.dropped).toBe(0);
    expect(rest.held).toBe(0);
    expect(feed.stored()).toBeLessThanOrEqual(10);
  });

  it('counts a drop the caller declared as the lines it stands for: the lines after it are numbered past it, `received` includes it, and it is reported once with the next lines', () => {
    const feed = new SyntheticFeed({ maxHeld: 10 });
    feed.push(lines(feed, 0, 1));
    expect(feed.read(10).lines.map((line) => line.seq)).toEqual([1]);
    feed.drop(7);
    feed.push(lines(feed, 1, 1));
    const batch = feed.read(10);
    expect(batch.dropped).toBe(7);
    expect(batch.lines.map((line) => line.seq)).toEqual([9]);
    expect(feed.read(10).dropped).toBe(0);
    expect(feed.stats()).toEqual({ received: 9, dropped: 7, held: 0 });
  });

  // Found by the memory run of the bench (bench/log/memory.mjs): after a million lines had gone through a feed bounded at a million, the page held 4 MB more than before. The ring used
  // the bound as its modulus, so the oldest line's index walked the whole range as lines were read, and the array behind it grew to the bound though at most a thousand lines were
  // ever held. What the feed keeps follows what it HOLDS, not what went through it.
  it('keeps storage for what it holds, not for the lines that went through it', () => {
    const MAX = 1_000_000;
    const feed = new SyntheticFeed({ maxHeld: MAX });
    for (let batch = 0; batch < 2000; batch += 1) {
      feed.push(lines(feed, batch * 500, 500));
      expect(feed.read(500).lines).toHaveLength(500);
    }

    expect(feed.stats()).toEqual({ received: 1_000_000, dropped: 0, held: 0 });
    expect(feed.stored()).toBeLessThanOrEqual(2048);
  });

  it('grows its storage as the backlog does, and keeps the order while it does', () => {
    const feed = new SyntheticFeed({ maxHeld: 100_000 });
    feed.push(lines(feed, 0, 10));
    expect(feed.read(4).lines.map((line) => line.text)).toEqual(['line 0', 'line 1', 'line 2', 'line 3']);
    // Six held with the oldest not at the start of the storage; then enough to grow it twice over.
    feed.push(lines(feed, 10, 5000));
    const all = feed.read(100_000).lines;
    expect(all).toHaveLength(5006);
    expect(all.map((line) => line.text)).toEqual(Array.from({ length: 5006 }, (_, index) => `line ${index + 4}`));
    expect(feed.stored()).toBeLessThan(100_000);
  });
});

describe('driving it', () => {
  it('makes `rate` lines a second between start() and stop(), and none after', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    try {
      const feed = new SyntheticFeed({ rate: 100 });
      feed.start();
      vi.advanceTimersByTime(1000);
      expect(feed.stats().received).toBeGreaterThanOrEqual(95);
      expect(feed.stats().received).toBeLessThanOrEqual(100);

      feed.stop();
      const stopped = feed.stats().received;
      vi.advanceTimersByTime(1000);
      expect(feed.stats().received).toBe(stopped);
    } finally {
      vi.useRealTimers();
    }
  });

  // A timer that comes late (a hidden tab, a debugger, a long task) finds a long stretch of production due. The feed is bounded: it can hold `maxHeld` lines, and it would drop all
  // the others as it took them. So a late callback makes the lines the feed can hold and counts the rest as dropped, with the numbers they would have had; it does not make millions
  // of lines in one task only to throw them away.
  it('makes no more lines in one callback than the feed can hold, however late the callback is, and counts the rest as dropped with their numbers', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const ticks: Array<() => void> = [];
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => {
      ticks.push(callback);
      return 1;
    }) as unknown as typeof setInterval);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    try {
      const late = new SyntheticFeed({ rate: 50_000, maxHeld: 1000, seed: 3 });
      late.start();
      // Six seconds pass before the first callback: 300,000 lines are due.
      now += 6000;
      ticks[0]?.();
      expect(late.stats()).toEqual({ received: 300_000, dropped: 299_000, held: 1000 });
      const batch = late.read(5000);
      expect(batch.dropped).toBe(299_000);
      expect(batch.lines).toHaveLength(1000);
      // The lines keep their numbers: the jump from nothing to 299,001 is the gap, as a real feed's would be.
      expect(batch.lines[0]?.seq).toBe(299_001);
      expect(batch.lines.at(-1)?.seq).toBe(300_000);
      // They are the lines a feed of its own seed makes first: no line that was not kept was made.
      const fresh = new SyntheticFeed({ rate: 0, maxHeld: 1000, seed: 3 });
      fresh.emit(1000);
      expect(batch.lines.map((line) => line.text)).toEqual(fresh.read(5000).lines.map((line) => line.text));
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('whenDrained: the example that must begin once the reader has what the feed holds', () => {
  // A pause or a gap that an example shows has to come AFTER the view has read the lines before it. A fixed time does not say that when the view mounts late (the stage of the parts
  // page mounts an example when it comes near the screen), so the example waits for the read.
  it('calls back once, in a turn of its own after the first read that leaves nothing held, and not before', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    try {
      const feed = new SyntheticFeed();
      feed.push([feed.line('a'), feed.line('b'), feed.line('c')]);
      const done = vi.fn();
      feed.whenDrained(done);
      vi.advanceTimersByTime(1000);
      expect(done).not.toHaveBeenCalled();
      // A read that leaves one line held is not it.
      feed.read(2);
      vi.advanceTimersByTime(10);
      expect(done).not.toHaveBeenCalled();
      // The read that takes the last line: the callback is not run inside it, but in the turn after it.
      feed.read(10);
      expect(done).not.toHaveBeenCalled();
      vi.advanceTimersByTime(0);
      expect(done).toHaveBeenCalledTimes(1);
      // Once.
      feed.push([feed.line('d')]);
      feed.read(10);
      vi.advanceTimersByTime(10);
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not met by a read of a paused feed, which returns nothing and leaves its lines held; and it can be cancelled, up to the turn it runs in', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    try {
      const feed = new SyntheticFeed();
      feed.pause();
      feed.push([feed.line('a')]);
      const waiting = vi.fn();
      feed.whenDrained(waiting);
      feed.read(10);
      vi.advanceTimersByTime(10);
      expect(waiting).not.toHaveBeenCalled();
      feed.resume();
      feed.read(10);
      vi.advanceTimersByTime(10);
      expect(waiting).toHaveBeenCalledTimes(1);

      feed.push([feed.line('b')]);
      const cancelled = vi.fn();
      const cancel = feed.whenDrained(cancelled);
      cancel();
      feed.read(10);
      vi.advanceTimersByTime(10);
      expect(cancelled).not.toHaveBeenCalled();

      // Cancelled after the read that met it and before the turn that runs it: it does not run.
      feed.push([feed.line('c')]);
      const late = vi.fn();
      const cancelLate = feed.whenDrained(late);
      feed.read(10);
      cancelLate();
      vi.advanceTimersByTime(10);
      expect(late).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sources (L2)', () => {
  const sourcesOf = (feed: SyntheticFeed) => feed.read(1000).lines.map((line) => line.source);

  it('has one source, `source/main`, and lists none, unless it is given some: the lines and the status are what they were', () => {
    const feed = new SyntheticFeed({ seed: 3 });
    feed.emit(5);
    expect(new Set(sourcesOf(feed))).toEqual(new Set(['source/main']));
    expect(feed.getSnapshot()).toEqual({ state: 'streaming', paused: false, cause: undefined });
    expect('sources' in feed.getSnapshot()).toBe(false);
  });

  it('makes its lines in turn from the sources it is given, and lists them with their labels, as the runtime\'s stream lists what it has heard of', () => {
    const feed = new SyntheticFeed({ sources: [{ id: 'item/app', label: 'app' }, 'item/worker', { id: 'item/audit' }] });
    feed.emit(7);
    expect(sourcesOf(feed)).toEqual(['item/app', 'item/worker', 'item/audit', 'item/app', 'item/worker', 'item/audit', 'item/app']);
    expect(feed.getSnapshot().sources).toEqual([{ id: 'item/app', label: 'app' }, { id: 'item/worker' }, { id: 'item/audit' }]);
  });

  it('makes the same text and levels whatever sources it has: the seed decides them, not the sources', () => {
    const plain = new SyntheticFeed({ seed: 9 });
    const several = new SyntheticFeed({ seed: 9, sources: ['a', 'b'] });
    plain.emit(40);
    several.emit(40);
    expect(several.read(100).lines.map((line) => [line.text, line.level])).toEqual(plain.read(100).lines.map((line) => [line.text, line.level]));
  });

  it('keeps the list of sources through a change of state, a pause and a resume, and gives a new status object for each', () => {
    const feed = new SyntheticFeed({ sources: ['a', 'b'] });
    const listed = feed.getSnapshot().sources;
    feed.pause();
    feed.resume();
    feed.setState('failed', cause);
    expect(feed.getSnapshot().sources).toBe(listed);
    expect(feed.getSnapshot()).toEqual({ state: 'failed', paused: false, cause, sources: [{ id: 'a' }, { id: 'b' }] });
  });

  it('names the source of a line it was told to write, and `source/main` (or its first source) for one it was not', () => {
    const plain = new SyntheticFeed();
    expect(plain.line('x').source).toBe('source/main');
    expect(plain.line('x', 'info', 'svc/sidecar').source).toBe('svc/sidecar');
    const several = new SyntheticFeed({ sources: ['a', 'b'] });
    expect(several.line('x').source).toBe('a');
  });

  it('lists other sources when it is told to: a new status, and the listener is told', () => {
    const feed = new SyntheticFeed();
    const listener = vi.fn();
    feed.subscribe(listener);
    const before = feed.getSnapshot();
    feed.setSources([{ id: 'a' }, { id: 'b', label: 'Bee' }]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot()).not.toBe(before);
    expect(feed.getSnapshot().sources).toEqual([{ id: 'a' }, { id: 'b', label: 'Bee' }]);
    // The lines it makes are what they were: the sources it lists are not the ones it writes for.
    feed.emit(2);
    expect(sourcesOf(feed)).toEqual(['source/main', 'source/main']);
  });
});

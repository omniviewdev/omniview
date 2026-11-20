import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logTargetsOf, type FixtureLogCounters, type FixtureLogHooks } from './logs';

// The fixture plugin's Logs sessions (logs.ts): four targets of one item, over the kit's synthetic feed, so that a check can see every state the host's Logs tool draws and count what a session opens, closes
// and listens to. The fixture is a plugin as far as the host can tell: what it hands over is a `LogTargetV1`.

const ITEM = { name: 'orders-api', group: 'north-yard' } as const;
const counters = (): FixtureLogCounters => {
  const found: unknown = Reflect.get(window, '__fixtureLogs');
  if (typeof found !== 'object' || found === null) {
    throw new Error('the fixture published no counters');
  }

  return found as FixtureLogCounters;
};

/** The members the counters offer besides the three numbers: not enumerable, so they are not in `{ ...counters }`. */
const hooks = (): FixtureLogHooks => {
  const found = counters();
  if (typeof Reflect.get(found, 'stats') !== 'function') {
    throw new Error('the fixture published no way to read what its sources emitted');
  }

  return found as FixtureLogCounters & FixtureLogHooks;
};

beforeEach(() => {
  Reflect.deleteProperty(window, '__fixtureLogs');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the fixture\'s Logs sessions', () => {
  it('are six targets of one item: an id and a title of their own, the item\'s group as the scope, and the item as the resource a card links to', () => {
    const targets = logTargetsOf(ITEM);
    expect(targets.map((target) => target.title)).toEqual(['orders-api/app', 'orders-api/migrate', 'orders-api/sync', 'orders-api/audit', 'orders-api/pair', 'orders-api/late']);
    expect(new Set(targets.map((target) => target.id)).size).toBe(6);
    for (const target of targets) {
      expect(target.scope).toBe('north-yard');
      expect(target.resource).toMatchObject({ label: 'Item orders-api', kind: 'Item', route: { page: 'item', params: { name: 'orders-api', group: 'north-yard' } } });
    }
  });

  it('has one session that follows two sources: it lists them with their labels and its lines take them in turn; the others follow one and list none', () => {
    const targets = logTargetsOf(ITEM);
    const pair = targets[4]?.open();
    expect(pair?.getSnapshot().sources).toEqual([{ id: 'pair/app', label: 'app' }, { id: 'pair/worker', label: 'worker' }]);
    vi.advanceTimersByTime(500);
    const lines = pair?.read(100).lines ?? [];
    expect(lines.length).toBeGreaterThan(4);
    expect(lines.map((line) => line.source)).toEqual(lines.map((line) => (line.seq % 2 === 1 ? 'pair/app' : 'pair/worker')));
    const single = targets[0]?.open();
    expect(single?.getSnapshot().sources).toBeUndefined();
    void pair?.close();
    void single?.close();
  });

  it('has one session whose second source speaks later (the log\'s Source column appears while it is open): one source is listed at first, and `speak()` lists a second and writes its first line, once', () => {
    const second = 'late/orders-7d8c6f49b-f8q4m/init-migrations';
    const late = logTargetsOf(ITEM)[5]?.open();
    expect(late?.getSnapshot().sources).toEqual([{ id: 'late/app' }]);
    vi.advanceTimersByTime(100);
    const before = late?.read(1_000).lines ?? [];
    expect(before.length).toBeGreaterThan(10);
    expect(new Set(before.map((line) => line.source))).toEqual(new Set(['late/app']));

    hooks().speak();
    expect(late?.getSnapshot().sources).toEqual([{ id: 'late/app' }, { id: second }]);
    const spoke = late?.read(1_000).lines ?? [];
    expect(spoke.filter((line) => line.source === second)).toHaveLength(1);
    // Once: it has spoken, and a second call lists nothing new and writes nothing.
    const listed = late?.getSnapshot();
    hooks().speak();
    expect(late?.getSnapshot()).toBe(listed);
    expect((late?.read(1_000).lines ?? []).filter((line) => line.source === second)).toHaveLength(0);
    void late?.close();
  });

  it('does not speak for a session that was closed, and does nothing when no session has a second source to give', () => {
    const targets = logTargetsOf(ITEM);
    const late = targets[5]?.open();
    const app = targets[0]?.open();
    void late?.close();
    hooks().speak();
    expect(late?.getSnapshot().sources).toEqual([{ id: 'late/app' }]);
    expect(app?.getSnapshot().sources).toBeUndefined();
    void app?.close();
  });

  it('start nothing until the host opens them, and count what a check reads: opened, closed, and the listeners on their feeds now', () => {
    const [stream] = logTargetsOf(ITEM);
    expect(Reflect.get(window, '__fixtureLogs')).toBeUndefined();
    const feed = stream?.open();
    expect(counters()).toEqual({ opened: 1, closed: 0, listeners: 0 });
    const first = feed?.subscribe(() => undefined);
    const second = feed?.subscribe(() => undefined);
    expect(counters().listeners).toBe(2);
    first?.();
    first?.();
    expect(counters().listeners).toBe(1);
    void feed?.close();
    expect(counters()).toEqual({ opened: 1, closed: 1, listeners: 1 });
    void feed?.close();
    expect(counters().closed).toBe(1);
    second?.();
    expect(counters().listeners).toBe(0);
  });

  it('give the first a stream that goes on at about twenty lines a second', () => {
    const feed = logTargetsOf(ITEM)[0]?.open();
    vi.advanceTimersByTime(1_000);
    expect(feed?.getSnapshot().state).toBe('streaming');
    expect(feed?.stats().received).toBeGreaterThanOrEqual(15);
    expect(feed?.stats().received).toBeLessThanOrEqual(25);
    vi.advanceTimersByTime(60_000);
    expect(feed?.getSnapshot().state).toBe('streaming');
    void feed?.close();
  });

  it('give the second a stream that ends after a moment of lines', () => {
    const feed = logTargetsOf(ITEM)[1]?.open();
    vi.advanceTimersByTime(1_000);
    expect(feed?.getSnapshot().state).toBe('streaming');
    vi.advanceTimersByTime(1_000);
    expect(feed?.getSnapshot()).toMatchObject({ state: 'ended', cause: undefined });
    expect(feed?.stats().received).toBeGreaterThan(10);
  });

  it('give the third a stream that fails with a cause, after a moment of lines', () => {
    const feed = logTargetsOf(ITEM)[2]?.open();
    vi.advanceTimersByTime(1_000);
    expect(feed?.getSnapshot().state).toBe('streaming');
    vi.advanceTimersByTime(1_000);
    expect(feed?.getSnapshot()).toMatchObject({ state: 'failed', cause: { stage: 'source', message: 'The source did not answer' } });
    expect(feed?.stats().received).toBeGreaterThan(10);
  });

  it('give the fourth ten thousand lines a second', () => {
    const feed = logTargetsOf(ITEM)[3]?.open();
    vi.advanceTimersByTime(1_000);
    expect(feed?.stats().received).toBeGreaterThanOrEqual(9_500);
    expect(feed?.stats().received).toBeLessThanOrEqual(10_500);
    void feed?.close();
  });

  it('close what they opened: the clocks stop, the stream is over, and nothing is left running', () => {
    const feeds = logTargetsOf(ITEM).map((target) => target.open());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    for (const feed of feeds) {
      void feed.close();
    }

    expect(vi.getTimerCount()).toBe(0);
    expect(feeds.map((feed) => feed.getSnapshot().state)).toEqual(['ended', 'ended', 'ended', 'ended', 'ended', 'ended']);
    expect(counters()).toMatchObject({ opened: 6, closed: 6 });
  });

  it('keep what happened to a stream that failed or ended on its own: closing it later is no new end', () => {
    const [, ends, fails] = logTargetsOf(ITEM);
    const over = ends?.open();
    const broken = fails?.open();
    vi.advanceTimersByTime(3_000);
    void over?.close();
    void broken?.close();
    expect(over?.getSnapshot().state).toBe('ended');
    expect(broken?.getSnapshot()).toMatchObject({ state: 'failed', cause: { message: 'The source did not answer' } });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('what a check reads of the sources, apart from the three counters', () => {
  it('is what the sources emitted, still hold (nobody read it) and dropped, in members that are not enumerable: the counters stay the three numbers a check compares', () => {
    const feed = logTargetsOf(ITEM)[3]?.open();
    vi.advanceTimersByTime(1_000);
    const { emitted, held, dropped } = hooks().stats();
    expect(emitted).toBeGreaterThanOrEqual(9_500);
    expect(emitted).toBeLessThanOrEqual(10_500);
    expect({ emitted, held, dropped }).toEqual({ emitted: feed?.stats().received, held: feed?.stats().held, dropped: 0 });
    expect(held).toBe(emitted);
    expect(Object.keys(counters())).toEqual(['opened', 'closed', 'listeners']);
    expect({ ...counters() }).toEqual({ opened: 1, closed: 0, listeners: 0 });
    void feed?.close();
  });

  it('keeps what nobody reads up to the stream\'s bound and counts the rest as dropped: every line emitted is held, dropped or read', () => {
    const feed = logTargetsOf(ITEM)[3]?.open();
    vi.advanceTimersByTime(12_000);
    const full = hooks().stats();
    expect(full.held).toBe(100_000);
    expect(full.dropped).toBeGreaterThanOrEqual(19_000);
    expect(full.emitted).toBe(full.held + full.dropped);
    const batch = feed?.read(1_000);
    expect(batch?.lines).toHaveLength(1_000);
    const after = hooks().stats();
    expect(after.held).toBe(99_000);
    expect(after.emitted).toBe(after.held + after.dropped + 1_000);
    void feed?.close();
  });

  it('stops the sources when told to, and only the sources: the feed stays open and listened to, and nothing more is emitted', () => {
    const feed = logTargetsOf(ITEM)[3]?.open();
    const stop = feed?.subscribe(() => undefined);
    vi.advanceTimersByTime(1_000);
    const before = hooks().stats().emitted;
    hooks().stopSources();
    vi.advanceTimersByTime(2_000);
    expect(hooks().stats().emitted).toBe(before);
    expect(counters()).toMatchObject({ opened: 1, closed: 0, listeners: 1 });
    expect(feed?.getSnapshot().state).toBe('streaming');
    stop?.();
    void feed?.close();
  });

  it('counts a feed that was closed in what was emitted and dropped, and no longer in what it holds', () => {
    const [first, , , audit] = logTargetsOf(ITEM);
    const a = first?.open();
    const b = audit?.open();
    vi.advanceTimersByTime(1_000);
    const open = hooks().stats();
    void b?.close();
    const closed = hooks().stats();
    expect(closed.emitted).toBe(open.emitted);
    expect(closed.held).toBeLessThan(open.held);
    expect(closed.held).toBe(a?.stats().held);
    void a?.close();
  });
});

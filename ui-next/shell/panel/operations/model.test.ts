import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivityFeed, HOST_SOURCE, type ActivityFeed, type ActivityRecordLike, type ActivitySeverity, type TaskState } from '../activity';
import { createOperations } from './model';
import { copy, names, other, T0, task, units, type Cancellation } from './testing';
import type { CancelFailure, Operation, OperationsSnapshot } from './types';

// The model of the Operations tool (ch16 S122, S74, S81, S84, S114): the feed's task records as rows that hold every decision a table needs (the order, the words a producer gave, what Cancel may say, what is unread), and a
// snapshot that keeps its object while it says the same, so the one React reader (`useSyncExternalStore`) renders only for what changed. Against the real feed (`createActivityFeed`), with invented plugins.

/** A promise a test settles when it chooses, to force the order of two things. */
const deferred = () => Promise.withResolvers<unknown>();

type Options = {
  readonly cancel?: (id: string) => Promise<unknown>;
  readonly markRead?: (id: string) => Promise<unknown>;
  readonly fail?: (failure: CancelFailure) => void;
  /** What the feed does instead of the real one's, for the calls that throw before they return a promise. */
  readonly feed?: Partial<ActivityFeed>;
  /** `false`: the model is made and not attached. */
  readonly attach?: boolean;
};

function setup(options: Options = {}) {
  const cancel = vi.fn<(id: string) => Promise<unknown>>(options.cancel ?? (async () => undefined));
  const markRead = vi.fn<(id: string) => Promise<unknown>>(options.markRead ?? (async () => undefined));
  const control = createActivityFeed({ cancel, markRead });
  const subscriptions = { live: 0, made: 0 };
  const feed: ActivityFeed = {
    ...control.feed,
    subscribe: (listener) => {
      subscriptions.live += 1;
      subscriptions.made += 1;
      const stop = control.feed.subscribe(listener);
      return () => {
        subscriptions.live -= 1;
        stop();
      };
    },
    ...options.feed,
  };
  const known = names();
  const fail = vi.fn<(failure: CancelFailure) => void>(options.fail ?? (() => undefined));
  const operations = createOperations({ feed, resolve: known.resolve, fail });
  const detach = options.attach === false ? () => undefined : operations.attach();
  const rows = (): readonly Operation[] => operations.getSnapshot().rows;
  const row = (id: string): Operation => {
    const found = rows().find((candidate) => candidate.id === id);
    if (found === undefined) {
      throw new Error(`no row ${id}: the rows are ${rows().map((candidate) => candidate.id).join(', ')}`);
    }

    return found;
  };

  return { operations, push: control.push, feed, cancel, markRead, fail, known, subscriptions, detach, rows, row, ids: () => rows().map((candidate) => candidate.id), snapshot: (): OperationsSnapshot => operations.getSnapshot() };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('which records are rows', () => {
  it('lists the tasks of the feed and nothing else: an alert and a message have tools of their own', () => {
    const { push, ids } = setup();
    push([task('t1'), other('a1', 'alert'), other('m1', 'message')]);
    expect(ids()).toEqual(['t1']);
  });

  it('does not list a record that says it is a task and has no task in it: there is no state to draw', () => {
    const { push, ids } = setup();
    push([{ ...task('t1'), task: undefined }, task('t2')]);
    expect(ids()).toEqual(['t2']);
  });

  it('lists a record once when the feed lists its id twice: the first wins, because a row\'s id is the key a table keeps it by', () => {
    const { push, rows } = setup();
    push([task('t1', { title: 'First' }), task('t1', { title: 'Second', at: 5 })]);
    expect(rows().map((row) => row.title)).toEqual(['First']);
  });

  it('forgets a task the host dropped (its history was cleared), and the count with it', () => {
    const { push, ids, snapshot } = setup();
    push([task('t1'), task('t2')]);
    expect(snapshot().active).toBe(2);
    push([task('t2')]);
    expect(ids()).toEqual(['t2']);
    expect(snapshot().active).toBe(1);
    push([]);
    expect(ids()).toEqual([]);
    expect(snapshot()).toEqual({ rows: [], active: 0, unread: { ids: [], errors: 0, warnings: 0 }, badge: undefined });
  });

  it('never changes the feed\'s records or the array it holds: they are the provider\'s, and the other tool reads them too', () => {
    const { push, ids } = setup();
    const records = [task('a', { at: 1 }), task('b', { at: 3, state: 'failed' }), task('c', { at: 2, source: { pluginID: 'alpha', connectionID: 'c-1' } })];
    for (const record of records) {
      Object.freeze(record.presentation);
      Object.freeze(record.source);
      Object.freeze(record.task);
      Object.freeze(record.visibility);
      Object.freeze(record);
    }

    Object.freeze(records);
    expect(() => {
      push(records);
    }).not.toThrow();
    expect(ids()).toEqual(['c', 'a', 'b']);
    expect(records.map((record) => record.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('a row', () => {
  it('holds what the producer said and what the window knows of its source', () => {
    const { push, row } = setup();
    push([
      task('t1', {
        title: 'Reindexing the catalogue',
        state: 'running',
        cancellation: 'available',
        at: 5,
        source: { pluginID: 'alpha', connectionID: 'c-1' },
        message: 'Scanning the second shard',
        progress: units('6', '14', 'files'),
      }),
    ]);
    expect(row('t1')).toEqual({
      id: 't1',
      title: 'Reindexing the catalogue',
      state: 'running',
      active: true,
      progress: { text: '6 of 14 files', fraction: expect.closeTo(0.428571, 5) },
      source: { id: 'alpha', name: 'Alpha Cloud' },
      target: 'north',
      startedAt: T0 + 5000,
      cancel: 'available',
      unread: undefined,
      subject: { kind: 'connection', plugin: 'alpha', connection: 'c-1' },
      message: 'Scanning the second shard',
    });
  });

  it('is the host\'s own work when the record names no plugin: the host\'s name, no target and no page to go to', () => {
    const { push, row } = setup();
    push([task('h1', { source: {} })]);
    expect(row('h1')).toMatchObject({ source: { id: HOST_SOURCE, name: 'Omniview' }, target: undefined, subject: undefined });
  });

  it('is the host\'s own work when the record names an empty plugin id too: an empty id is no plugin, and no connection is asked for', () => {
    const { push, row, known } = setup();
    push([task('h1', { source: { pluginID: '', connectionID: 'c-1' } })]);
    expect(row('h1')).toMatchObject({ source: { id: HOST_SOURCE, name: 'Omniview' }, target: undefined, subject: undefined });
    expect(known.asked.connection).toBe(0);
  });

  it('names no target and goes to the plugin when the window does not know the connection the record names', () => {
    const { push, row } = setup();
    push([task('t1', { source: { pluginID: 'alpha', connectionID: 'gone' } })]);
    expect(row('t1')).toMatchObject({ source: { id: 'alpha', name: 'Alpha Cloud' }, target: undefined, subject: { kind: 'plugin', plugin: 'alpha' } });
  });

  it('says the plugin\'s id when the window does not know its name (it is not loaded)', () => {
    const { push, row } = setup();
    push([task('t1', { source: { pluginID: 'gamma' } })]);
    expect(row('t1').source).toEqual({ id: 'gamma', name: 'gamma' });
  });

  it('starts when the host first had the record: the instant of its createdAt, whatever the offset it is written in', () => {
    const { push, row } = setup();
    push([task('t1', { createdAt: '2026-11-24T12:00:00+02:00' }), task('t2', { createdAt: '2026-11-24T10:00:00.250Z' })]);
    expect(row('t1').startedAt).toBe(T0);
    expect(row('t2').startedAt).toBe(T0 + 250);
  });

  it.each<readonly [TaskState, boolean]>([
    ['starting', true],
    ['running', true],
    ['paused', true],
    ['succeeded', false],
    ['failed', false],
    ['cancelled', false],
    ['unknown', false],
  ])('is %s: active is %s, and the state is the producer\'s', (state, active) => {
    const { push, row } = setup();
    push([task('t1', { state })]);
    expect(row('t1')).toMatchObject({ state, active });
  });

  it('keeps the producer\'s message as it came', () => {
    const { push, row } = setup();
    push([task('t1', { state: 'failed', message: 'The server did not answer' }), task('t2')]);
    expect(row('t1').message).toBe('The server did not answer');
    expect(row('t2').message).toBeUndefined();
  });
});

describe('the progress of a row', () => {
  it.each<TaskState>(['starting', 'running', 'paused'])('is the producer\'s, for a task that is %s', (state) => {
    const { push, row } = setup();
    push([task('t1', { state, progress: units('2', '5', 'files') })]);
    expect(row('t1').progress).toEqual({ text: '2 of 5 files', fraction: 0.4 });
  });

  it('is steps as "2 of 5"', () => {
    const { push, row } = setup();
    push([task('t1', { progress: { kind: 'steps', current: '2', total: '5', label: 'Compile' } })]);
    expect(row('t1').progress).toEqual({ text: '2 of 5', fraction: 0.4 });
  });

  it.each<TaskState>(['succeeded', 'failed', 'cancelled', 'unknown'])('is none for a task that is %s: the work that finished is not "6 of 14" any more', (state) => {
    const { push, row } = setup();
    push([task('t1', { state, progress: units('6', '14', 'files') })]);
    expect(row('t1').progress).toBeUndefined();
  });

  it('is none for work that cannot be measured, and for no progress', () => {
    const { push, row } = setup();
    push([task('t1', { progress: { kind: 'indeterminate', message: 'Scanning' } }), task('t2')]);
    expect(row('t1').progress).toBeUndefined();
    expect(row('t2').progress).toBeUndefined();
  });

  it('is exact for a count of any size: the producer\'s numbers are decimal strings', () => {
    const { push, row } = setup();
    push([task('t1', { progress: units('999999999999999999999999999999', '1000000000000000000000000000000', 'bytes') })]);
    expect(row('t1').progress?.fraction).toBe(0.999999);
  });
});

describe('what Cancel may say (S84: only when the producer says it is available)', () => {
  it.each<readonly [string, TaskState, Cancellation, Operation['cancel']]>([
    ['an active task that says it can be cancelled', 'running', 'available', 'available'],
    ['a task that is starting and says it can be cancelled', 'starting', 'available', 'available'],
    ['a paused task that says it can be cancelled', 'paused', 'available', 'available'],
    ['an active task that cannot be cancelled', 'running', 'unsupported', 'none'],
    ['an active task whose cancellation was requested', 'running', 'requested', 'requested'],
    ['an active task whose cancellation the producer acknowledged', 'running', 'acknowledged', 'requested'],
    ['a task that finished and still says it can be cancelled (its record is behind)', 'succeeded', 'available', 'none'],
    ['a task that failed with a cancellation that was requested', 'failed', 'requested', 'none'],
    ['a task whose outcome nobody knows', 'unknown', 'available', 'none'],
  ])('is the row of %s', (_name, state, cancellation, expected) => {
    const { push, row } = setup();
    push([task('t1', { state, cancellation })]);
    expect(row('t1').cancel).toBe(expected);
  });
});

describe('the order of the rows', () => {
  it('is active work first, and each group newest first', () => {
    const { push, ids } = setup();
    push([
      task('old-done', { state: 'succeeded', at: 10 }),
      task('new-done', { state: 'failed', at: 50 }),
      task('old-run', { state: 'running', at: 20 }),
      task('new-run', { state: 'paused', at: 40 }),
      task('start', { state: 'starting', at: 30 }),
    ]);
    expect(ids()).toEqual(['new-run', 'start', 'old-run', 'new-done', 'old-done']);
  });

  it('is the same whatever order the feed lists them in', () => {
    const records = [task('a', { at: 1 }), task('b', { at: 2, state: 'failed' }), task('c', { at: 3 }), task('d', { at: 4, state: 'succeeded' }), task('e', { at: 5, state: 'paused' })];
    const expected = ['e', 'c', 'a', 'd', 'b'];
    for (const order of [records, [...records].reverse(), [records[2], records[4], records[0], records[3], records[1]]]) {
      const { push, ids } = setup();
      push(order);
      expect(ids()).toEqual(expected);
    }
  });

  it('breaks a tie of time by the id, so the order never depends on the feed', () => {
    const { push, ids } = setup();
    push([task('b', { at: 7 }), task('c', { at: 7 }), task('a', { at: 7 })]);
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('is by the instant, not by the spelling of the stamp: an offset moves it', () => {
    const { push, ids } = setup();
    // 12:00 at +02:00 is 10:00 UTC: older than 10:30 UTC, though the text of the first is "bigger".
    push([task('later-text', { createdAt: '2026-11-24T12:00:00+02:00' }), task('later-time', { createdAt: '2026-11-24T10:30:00Z' })]);
    expect(ids()).toEqual(['later-time', 'later-text']);
  });

  it('moves a task below the active ones when it finishes, and back to its place among its group', () => {
    const { push, ids } = setup();
    const newest = task('newest', { at: 3 });
    const middle = task('middle', { at: 2 });
    const oldest = task('oldest', { at: 1 });
    push([newest, middle, oldest]);
    expect(ids()).toEqual(['newest', 'middle', 'oldest']);
    push([{ ...newest, task: { state: 'succeeded', cancellation: 'unsupported' } }, middle, oldest]);
    expect(ids()).toEqual(['middle', 'oldest', 'newest']);
  });

  it('keeps a record whose time cannot be read, as the oldest, and does not make the order depend on it', () => {
    const { push, ids, row } = setup();
    // Its id sorts before the others: an order that fell back to the ids for a time it could not compare would put it first.
    push([task('0-bad', { createdAt: 'not a time' }), task('a', { at: 1 }), task('b', { at: 2 })]);
    expect(ids()).toEqual(['b', 'a', '0-bad']);
    expect(row('0-bad').startedAt).toBeNaN();
  });
});

describe('what is unread, and the severity of what finished (S74, S81)', () => {
  // S74: the severity of a finished task is its state's (failed error, unknown warning, cancelled info, succeeded success), raised by the record's own and never lowered by it.
  it.each<readonly [string, TaskState, ActivitySeverity, boolean, Operation['unread']]>([
    ['a failure nobody read', 'failed', 'info', false, 'error'],
    ['a failure that is read', 'failed', 'info', true, undefined],
    ['an outcome nobody knows, not read', 'unknown', 'info', false, 'warning'],
    ['an outcome nobody knows, read', 'unknown', 'info', true, undefined],
    ['a task that was cancelled', 'cancelled', 'info', false, undefined],
    ['a task that succeeded', 'succeeded', 'success', false, undefined],
    ['a task that succeeded and says warning, not read', 'succeeded', 'warning', false, 'warning'],
    ['a task that succeeded and says error, not read', 'succeeded', 'error', false, 'error'],
    ['a task that succeeded and says error, read', 'succeeded', 'error', true, undefined],
    ['a task that was cancelled and says error', 'cancelled', 'error', false, 'error'],
    ['a task that was cancelled and says warning', 'cancelled', 'warning', false, 'warning'],
    ['a failure whose record says only warning (the record never lowers it)', 'failed', 'warning', false, 'error'],
    ['an outcome nobody knows whose record says error (raised)', 'unknown', 'error', false, 'error'],
    ['a failure whose record says success (the record never lowers it)', 'failed', 'success', false, 'error'],
  ])('is %s: unread is %s', (_name, state, severity, read, expected) => {
    const { push, row } = setup();
    push([task('t1', { state, severity, read })]);
    expect(row('t1').unread).toBe(expected);
  });

  it.each<TaskState>(['starting', 'running', 'paused'])('is never so for a task that is %s, whatever its record says: an active task is not unread, it becomes unread when it finishes', (state) => {
    const { push, row, snapshot } = setup();
    push([task('t1', { state, severity: 'error', read: false })]);
    expect(row('t1').unread).toBeUndefined();
    expect(snapshot().unread).toEqual({ ids: [], errors: 0, warnings: 0 });
  });

  it('counts what is unread, in the order of the rows, and names the ids to mark', () => {
    const { push, snapshot } = setup();
    push([
      task('run', { at: 9, severity: 'error' }),
      task('failed-new', { at: 8, state: 'failed' }),
      task('unknown', { at: 7, state: 'unknown' }),
      task('failed-read', { at: 6, state: 'failed', read: true }),
      task('failed-old', { at: 5, state: 'failed' }),
      task('fine', { at: 4, state: 'succeeded' }),
    ]);
    expect(snapshot().unread).toEqual({ ids: ['failed-new', 'unknown', 'failed-old'], errors: 2, warnings: 1 });
  });
});

describe('the badge of the tool (S114: a dot while a failure is unread, never a count)', () => {
  it('is nothing while nothing is unread: running work is counted by the status bar, not by the tab', () => {
    const { push, snapshot } = setup();
    push([task('a'), task('b', { state: 'succeeded' }), task('c', { state: 'failed', read: true })]);
    expect(snapshot().badge).toBeUndefined();
  });

  it.each<readonly [number, string]>([
    [1, '1 unread failure'],
    [2, '2 unread failures'],
    [12, '12 unread failures'],
  ])('is an error dot that names %i failure(s): "%s"', (count, label) => {
    const { push, snapshot } = setup();
    push(Array.from({ length: count }, (_, index) => task(`f${String(index)}`, { state: 'failed', at: index })));
    expect(snapshot().badge).toEqual({ kind: 'dot', tone: 'error', label });
  });

  it.each<readonly [number, string]>([
    [1, '1 unread warning'],
    [3, '3 unread warnings'],
  ])('is a warning dot that names %i warning(s) when none is a failure: "%s"', (count, label) => {
    const { push, snapshot } = setup();
    push(Array.from({ length: count }, (_, index) => task(`w${String(index)}`, { state: 'unknown', at: index })));
    expect(snapshot().badge).toEqual({ kind: 'dot', tone: 'warning', label });
  });

  it('is the error dot when there is a failure and a warning, and names the failures', () => {
    const { push, snapshot } = setup();
    push([task('w', { state: 'unknown', at: 1 }), task('f', { state: 'failed', at: 2 }), task('w2', { state: 'unknown', at: 3 })]);
    expect(snapshot().badge).toEqual({ kind: 'dot', tone: 'error', label: '1 unread failure' });
  });

  it('goes when the failure is read, and the warning that was behind it shows', () => {
    const { push, snapshot } = setup();
    const failure = task('f', { state: 'failed', at: 2 });
    push([task('w', { state: 'unknown', at: 1 }), failure]);
    const first = snapshot().badge;
    expect(first?.kind === 'dot' ? first.tone : undefined).toBe('error');
    push([task('w', { state: 'unknown', at: 1 }), { ...failure, visibility: { read: true } }]);
    expect(snapshot().badge).toEqual({ kind: 'dot', tone: 'warning', label: '1 unread warning' });
    push([task('w', { state: 'unknown', at: 1, read: true }), { ...failure, visibility: { read: true } }]);
    expect(snapshot().badge).toBeUndefined();
  });

  it('is a dot and never a count, whatever the number of rows or of failures', () => {
    const { push, snapshot } = setup();
    push(Array.from({ length: 40 }, (_, index) => task(`f${String(index)}`, { state: index % 2 === 0 ? 'failed' : 'running', at: index })));
    expect(snapshot().badge?.kind).toBe('dot');
    expect(snapshot().active).toBe(20);
  });
});

// A failed observation of the activity service holds no record, like an observation of no activity does: the snapshot carries the feed's sentence beside its rows, so the body can say which one it is.
describe('when the activity service cannot be observed (the feed\'s error)', () => {
  const SENTENCE = 'The activity service did not answer.';

  it('is not unavailable while the feed has no error', () => {
    const { push, snapshot } = setup();
    expect(snapshot().unavailable).toBeUndefined();
    push([task('a')]);
    expect(snapshot().unavailable).toBeUndefined();
  });

  it('is the feed\'s sentence, with no row, when the first read failed: a failed read is not "no operations"', () => {
    const { push, snapshot } = setup();
    push([], SENTENCE);
    expect(snapshot().unavailable).toBe(SENTENCE);
    expect(snapshot().rows).toEqual([]);
  });

  it('keeps the rows it holds when the observation fails after it worked, and says so beside them', () => {
    const { push, snapshot, ids } = setup();
    const records = [task('a', { at: 1 }), task('b', { at: 2, state: 'failed' })];
    push(records);
    push(records, SENTENCE);
    expect(snapshot().unavailable).toBe(SENTENCE);
    expect(ids()).toEqual(['a', 'b']);
    expect(snapshot().active).toBe(1);
    expect(snapshot().unread.ids).toEqual(['b']);
  });

  it('tells its listeners once for a change of the error alone, with a new snapshot whose rows, counts and badge are the objects they were', () => {
    const { push, operations, snapshot } = setup();
    const records = [task('a', { state: 'failed', at: 1 }), task('b', { at: 2 })];
    push(records);
    const before = snapshot();
    const listener = vi.fn();
    operations.subscribe(listener);
    push(records, SENTENCE);
    expect(listener).toHaveBeenCalledTimes(1);
    const after = snapshot();
    expect(after).not.toBe(before);
    expect(after.unavailable).toBe(SENTENCE);
    expect(after.rows).toBe(before.rows);
    expect(after.unread).toBe(before.unread);
    expect(after.badge).toBe(before.badge);
  });

  it('goes when the feed says the service can be observed again, and tells its listeners once', () => {
    const { push, operations, snapshot } = setup();
    const records = [task('a')];
    push(records, SENTENCE);
    const listener = vi.fn();
    operations.subscribe(listener);
    push(records);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(snapshot().unavailable).toBeUndefined();
    expect(snapshot().rows).toHaveLength(1);
  });

  it('says it with the rows of the same push, in one notification, when the records and the error change together', () => {
    const { push, operations, snapshot } = setup();
    const seen: Array<{ readonly rows: number; readonly unavailable: string | undefined }> = [];
    operations.subscribe(() => {
      seen.push({ rows: snapshot().rows.length, unavailable: snapshot().unavailable });
    });
    push([task('a'), task('b', { at: 1 })], SENTENCE);
    expect(seen).toEqual([{ rows: 2, unavailable: SENTENCE }]);
  });

  it('keeps the snapshot, and tells nobody, when the feed says the same error again', () => {
    const { push, operations, snapshot } = setup();
    const records = [task('a')];
    push(records, SENTENCE);
    const before = snapshot();
    const listener = vi.fn();
    operations.subscribe(listener);
    push(records, SENTENCE);
    push([...records], SENTENCE);
    expect(listener).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it('reads the error when it is attached: a window that mounts after the service failed', () => {
    const { push, operations } = setup({ attach: false });
    push([task('a')], SENTENCE);
    expect(operations.getSnapshot().unavailable).toBeUndefined();
    operations.attach();
    expect(operations.getSnapshot().unavailable).toBe(SENTENCE);
    expect(operations.getSnapshot().rows).toHaveLength(1);
  });

  it('keeps it when the names the window knows change: refreshing makes the rows again and says the same of the service', () => {
    const { push, operations, snapshot } = setup();
    push([task('a')], SENTENCE);
    operations.refresh();
    expect(snapshot().unavailable).toBe(SENTENCE);
  });
});

describe('identity: a change of one record makes no new object for the others', () => {
  const a = task('a', { at: 1, progress: units('1', '4', 'files') });
  const b = task('b', { at: 2, state: 'failed' });
  const c = task('c', { at: 3, state: 'succeeded' });

  const byId = (rows: readonly Operation[]): Record<string, Operation> => Object.fromEntries(rows.map((row) => [row.id, row]));

  it('keeps the row of a record that did not change, the rows, the counts and the badge, and tells nobody, when the feed holds the same records in a new array', () => {
    const { push, snapshot, operations } = setup();
    push([a, b, c]);
    const before = snapshot();
    const listener = vi.fn();
    operations.subscribe(listener);
    push([a, b, c]);
    expect(snapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the row, and the snapshot, of a record that was made again and says the same', () => {
    const { push, snapshot, operations } = setup();
    push([a, b, c]);
    const before = snapshot();
    const listener = vi.fn();
    operations.subscribe(listener);
    push([copy(a), copy(b), copy(c)]);
    expect(snapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the row of a record whose time cannot be read when it is made again: a time that is not a time is the same as itself', () => {
    const { push, snapshot, operations } = setup();
    const timeless = task('t', { createdAt: 'not a time' });
    push([timeless, a]);
    const before = snapshot();
    const listener = vi.fn();
    operations.subscribe(listener);
    push([copy(timeless), a]);
    expect(snapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('makes a new row for the record that changed and keeps the others; the counts and the badge, which it did not touch, keep their objects', () => {
    const { push, snapshot, rows } = setup();
    push([a, b, c]);
    const before = snapshot();
    const rowsBefore = byId(rows());
    push([{ ...a, presentation: { ...a.presentation, progress: units('2', '4', 'files') } }, b, c]);
    const after = snapshot();
    expect(after).not.toBe(before);
    expect(after.rows).not.toBe(before.rows);
    const rowsAfter = byId(rows());
    expect(rowsAfter.a).not.toBe(rowsBefore.a);
    expect(rowsAfter.a?.progress?.text).toBe('2 of 4 files');
    expect(rowsAfter.b).toBe(rowsBefore.b);
    expect(rowsAfter.c).toBe(rowsBefore.c);
    expect(after.unread).toBe(before.unread);
    expect(after.badge).toBe(before.badge);
  });

  it('makes a new count, and a new badge, only when what they say changed', () => {
    const { push, snapshot, rows } = setup();
    push([a, b, c]);
    const before = snapshot();
    const rowsBefore = byId(rows());
    push([a, { ...b, visibility: { read: true } }, c]);
    const after = snapshot();
    expect(after.unread).not.toBe(before.unread);
    expect(after.unread).toEqual({ ids: [], errors: 0, warnings: 0 });
    expect(after.badge).toBeUndefined();
    expect(byId(rows()).a).toBe(rowsBefore.a);
    expect(byId(rows()).c).toBe(rowsBefore.c);
  });

  it('keeps the rows array when only the order of the feed changed', () => {
    const { push, snapshot } = setup();
    push([a, b, c]);
    const before = snapshot();
    push([c, b, a]);
    expect(snapshot()).toBe(before);
  });

  it('keeps the ids of the unread as one array while the same ones are unread, though the counts change, so a reader keyed on it is not made to start again', () => {
    const { push, snapshot } = setup();
    const odd = task('odd', { state: 'unknown', at: 5 });
    push([a, odd]);
    const before = snapshot().unread;
    expect(before).toEqual({ ids: ['odd'], errors: 0, warnings: 1 });
    // The same record, now said to be an error: the counts are others and the one id is the same.
    push([a, { ...odd, severity: 'error' }]);
    expect(snapshot().unread).not.toBe(before);
    expect(snapshot().unread).toEqual({ ids: ['odd'], errors: 1, warnings: 0 });
    expect(snapshot().unread.ids).toBe(before.ids);
  });
});

describe('the listeners', () => {
  it('are told once for a change, and the snapshot is current when they are', () => {
    const { push, operations } = setup();
    const seen: number[] = [];
    const listener = vi.fn(() => {
      seen.push(operations.getSnapshot().rows.length);
    });
    operations.subscribe(listener);
    push([task('a'), task('b')]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([2]);
  });

  it('are told once when a task finishes, though its row, the count, the unread and the badge all change', () => {
    const { push, operations } = setup();
    const record = task('a');
    push([record]);
    const listener = vi.fn();
    operations.subscribe(listener);
    push([{ ...record, task: { state: 'failed', cancellation: 'unsupported' } }]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('are told once for 500 records that arrive together, and the rows are all of them in order', () => {
    const { push, operations, ids } = setup();
    const listener = vi.fn();
    operations.subscribe(listener);
    push(Array.from({ length: 500 }, (_, index) => task(`t${String(index).padStart(3, '0')}`, { at: index, state: index % 5 === 0 ? 'failed' : 'running' })));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ids()).toHaveLength(500);
    expect(operations.getSnapshot().active).toBe(400);
    expect(operations.getSnapshot().unread.ids).toHaveLength(100);
    // Active first, newest first: t498 is the newest that is running; t495 the newest failure comes after the last running one.
    expect(ids().slice(0, 2)).toEqual(['t499', 't498']);
    expect(ids()[400]).toBe('t495');
  });

  it('are not told again for a change that says nothing new', () => {
    const { push, operations } = setup();
    const records = [task('a'), task('b', { state: 'failed' })];
    push(records);
    const listener = vi.fn();
    operations.subscribe(listener);
    push([...records]);
    push(records.map(copy));
    expect(listener).not.toHaveBeenCalled();
  });

  it('are not told after they unsubscribe, and the others still are', () => {
    const { push, operations } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const stop = operations.subscribe(first);
    operations.subscribe(second);
    push([task('a')]);
    stop();
    stop();
    push([task('a'), task('b')]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('are not told in the middle of a notification they unsubscribed in', () => {
    const { push, operations } = setup();
    const second = vi.fn();
    let stopSecond: () => void = () => undefined;
    operations.subscribe(() => {
      stopSecond();
    });
    stopSecond = operations.subscribe(second);
    push([task('a')]);
    expect(second).not.toHaveBeenCalled();
  });
});

describe('attaching to the feed', () => {
  it('holds nothing before it is attached, and has no listener on the feed', () => {
    const { push, snapshot, subscriptions } = setup({ attach: false });
    push([task('a')]);
    expect(snapshot().rows).toEqual([]);
    expect(subscriptions.made).toBe(0);
  });

  it('reads the feed at once when it is attached, and tells its listeners of the rows it found', () => {
    const { push, operations, ids } = setup({ attach: false });
    push([task('a'), task('b', { at: 1 })]);
    const listener = vi.fn();
    operations.subscribe(listener);
    operations.attach();
    expect(ids()).toEqual(['b', 'a']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('follows the feed while it is attached: one listener on the feed, whatever the number of changes', () => {
    const { push, ids, subscriptions } = setup();
    push([task('a')]);
    push([task('a'), task('b', { at: 1 })]);
    push([task('b', { at: 1 })]);
    expect(ids()).toEqual(['b']);
    expect(subscriptions).toEqual({ live: 1, made: 1 });
  });

  it('stops listening when it is detached: the feed has no listener of the model and the rows stay as they were', () => {
    const { push, snapshot, detach, subscriptions } = setup();
    push([task('a')]);
    const before = snapshot();
    detach();
    expect(subscriptions.live).toBe(0);
    push([task('a'), task('b')]);
    expect(snapshot()).toBe(before);
  });

  it('does nothing when the function that detaches is called twice', () => {
    const { detach, subscriptions } = setup();
    detach();
    detach();
    expect(subscriptions.live).toBe(0);
  });

  it('reads what the feed holds when it is attached again, and has again one listener', () => {
    const { push, operations, ids, detach, subscriptions } = setup();
    push([task('a')]);
    detach();
    push([task('a'), task('b', { at: 1 })]);
    expect(ids()).toEqual(['a']);
    operations.attach();
    expect(ids()).toEqual(['b', 'a']);
    expect(subscriptions.live).toBe(1);
  });

  it('keeps following the feed while one of two attachments is left (a window that mounts twice), and stops with the last', () => {
    const { push, operations, ids, detach, subscriptions } = setup();
    const second = operations.attach();
    expect(subscriptions.live).toBe(1);
    detach();
    push([task('a')]);
    expect(ids()).toEqual(['a']);
    second();
    expect(subscriptions.live).toBe(0);
    push([task('a'), task('b')]);
    expect(ids()).toEqual(['a']);
  });

  it('can be attached, detached and attached again in a row, as a strict mount does: the model follows the feed', () => {
    const { push, operations, ids, detach, subscriptions } = setup();
    detach();
    const again = operations.attach();
    push([task('a')]);
    expect(ids()).toEqual(['a']);
    expect(subscriptions.live).toBe(1);
    again();
    expect(subscriptions.live).toBe(0);
  });
});

describe('refreshing what the window knows of names and connections', () => {
  it('makes every row again from the records and the names now: a plugin that was named by its id gets its name, a connection that was unknown is a target and a page', () => {
    const { push, row, known, operations } = setup();
    push([task('t1', { source: { pluginID: 'gamma', connectionID: 'c-9' } })]);
    expect(row('t1')).toMatchObject({ source: { id: 'gamma', name: 'gamma' }, target: undefined, subject: { kind: 'plugin', plugin: 'gamma' } });
    known.plugins.gamma = 'Gamma Labs';
    known.connections['gamma/c-9'] = 'harbour';
    // Nothing tells the model on its own: the window says when what it knows changed.
    expect(row('t1').source.name).toBe('gamma');
    operations.refresh();
    expect(row('t1')).toMatchObject({ source: { id: 'gamma', name: 'Gamma Labs' }, target: 'harbour', subject: { kind: 'connection', plugin: 'gamma', connection: 'c-9' } });
  });

  it('keeps the rows that come out the same, and tells the listeners once', () => {
    const { push, row, known, operations } = setup();
    push([task('t1', { source: { pluginID: 'alpha' } }), task('t2', { source: { pluginID: 'beta' }, at: 1 })]);
    const before = row('t2');
    const listener = vi.fn();
    operations.subscribe(listener);
    known.plugins.alpha = 'Alpha Cloud, renamed';
    operations.refresh();
    expect(row('t1').source.name).toBe('Alpha Cloud, renamed');
    expect(row('t2')).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the snapshot and tells nobody when nothing it knows changed', () => {
    const { push, snapshot, operations } = setup();
    push([task('t1'), task('t2', { state: 'failed' })]);
    const before = snapshot();
    const listener = vi.fn();
    operations.subscribe(listener);
    operations.refresh();
    expect(snapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('asks the resolver again for every record: that is what it is for', () => {
    const { push, known, operations } = setup();
    push([task('a', { source: { pluginID: 'alpha', connectionID: 'c-1' } }), task('b', { source: { pluginID: 'beta', connectionID: 'c-2' } })]);
    const asked = { ...known.asked };
    operations.refresh();
    expect(known.asked.plugin).toBeGreaterThan(asked.plugin + 1);
    expect(known.asked.connection).toBeGreaterThan(asked.connection + 1);
  });

  it('does no work for a record that did not change when the feed changes: the resolver is asked for the one that did', () => {
    const { push, known } = setup();
    const records = Array.from({ length: 50 }, (_, index) => task(`t${String(index)}`, { at: index, source: { pluginID: 'alpha', connectionID: 'c-1' } }));
    push(records);
    const asked = { ...known.asked };
    const next = [...records];
    next[7] = { ...records[7], presentation: { title: 'Task t7, again' } };
    push(next);
    // One record, asked about its plugin and its connection (twice: its target, and its subject), and no more.
    expect(known.asked.plugin - asked.plugin).toBe(1);
    expect(known.asked.connection - asked.connection).toBeLessThanOrEqual(2);
  });
});

describe('cancelling a task', () => {
  const cancellable = (id = 'a') => task(id, { title: 'Reindexing the catalogue', cancellation: 'available', source: { pluginID: 'alpha' } });

  it('asks the feed once, with the id, and the row says requested while the call is in flight; the listeners are told', async () => {
    const gate = deferred();
    const { operations, push, cancel, row } = setup({ cancel: async () => gate.promise });
    push([cancellable()]);
    expect(row('a').cancel).toBe('available');
    const listener = vi.fn();
    operations.subscribe(listener);
    const call = operations.cancel('a');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('a');
    expect(row('a').cancel).toBe('requested');
    expect(listener).toHaveBeenCalledTimes(1);
    gate.resolve(undefined);
    await call;
  });

  it('follows its record again when the call is answered: the host\'s own word says what the row says next', async () => {
    const gate = deferred();
    const { operations, push, row, fail } = setup({ cancel: async () => gate.promise });
    const record = cancellable();
    push([record]);
    const call = operations.cancel('a');
    gate.resolve({ accepted: true });
    await expect(call).resolves.toBeUndefined();
    expect(row('a').cancel).toBe('available');
    push([{ ...record, task: { state: 'running', cancellation: 'requested' } }]);
    expect(row('a').cancel).toBe('requested');
    expect(fail).not.toHaveBeenCalled();
  });

  it('does not ask the feed again while its own call is in flight, and answers when the first call does', async () => {
    const gate = deferred();
    const { operations, push, cancel } = setup({ cancel: async () => gate.promise });
    push([cancellable()]);
    const first = operations.cancel('a');
    const second = operations.cancel('a');
    expect(cancel).toHaveBeenCalledTimes(1);
    let secondDone = false;
    void second.then(() => {
      secondDone = true;
    });
    await Promise.resolve();
    expect(secondDone).toBe(false);
    gate.resolve(undefined);
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
  });

  it.each<Cancellation>(['requested', 'acknowledged'])('does not ask the feed for a task the host says is already %s', async (cancellation) => {
    const { operations, push, cancel, row } = setup();
    push([task('a', { cancellation })]);
    expect(row('a').cancel).toBe('requested');
    await operations.cancel('a');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not ask the feed for a task that cannot be cancelled, one that finished, or one it does not know: Cancel never promises what the producer did not', async () => {
    const { operations, push, cancel, fail } = setup();
    push([task('plain', { cancellation: 'unsupported' }), task('done', { state: 'succeeded', cancellation: 'available' })]);
    await operations.cancel('plain');
    await operations.cancel('done');
    await operations.cancel('nobody');
    expect(cancel).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it('never rejects: a rejection of the feed puts available back and tells the host once, with the title, the plugin, the error and a way to ask again', async () => {
    const error = new Error('cancellation unavailable');
    const { operations, push, row, fail } = setup({
      cancel: async () => {
        throw error;
      },
    });
    push([cancellable()]);
    await expect(operations.cancel('a')).resolves.toBeUndefined();
    expect(row('a').cancel).toBe('available');
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith({ id: 'a', title: 'Reindexing the catalogue', plugin: 'alpha', error, running: true, retry: expect.any(Function) });
  });

  it('has put available back before it tells the host: a way to ask again that is used at once finds a row that can be asked for', async () => {
    let seen: Operation['cancel'] | undefined;
    const ref: { row: (id: string) => Operation } = { row: () => {
      throw new Error('not set'); 
    } };
    const { operations, push, row } = setup({
      cancel: async () => {
        throw new Error('no');
      },
      fail: () => {
        seen = ref.row('a').cancel;
      },
    });
    ref.row = row;
    push([cancellable()]);
    await operations.cancel('a');
    expect(seen).toBe('available');
  });

  it('is told of the host\'s own work with no plugin: there is none to name', async () => {
    const { operations, push, fail } = setup({
      cancel: async () => {
        throw new Error('no');
      },
    });
    push([task('h', { cancellation: 'available', source: {}, title: 'Syncing the window' })]);
    await operations.cancel('h');
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ id: 'h', title: 'Syncing the window', plugin: undefined }));
  });

  it('asks the feed again when the way it gave is used, and tells the host again if that fails too: once for each failure', async () => {
    const { operations, push, cancel, fail, row } = setup({
      cancel: async () => {
        throw new Error('no');
      },
    });
    push([cancellable()]);
    await operations.cancel('a');
    const [first] = fail.mock.calls[0];
    first.retry();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(row('a').cancel).toBe('requested');
    await vi.waitFor(() => {
      expect(fail).toHaveBeenCalledTimes(2);
    });
    expect(row('a').cancel).toBe('available');
    const [second] = fail.mock.calls[1];
    expect(second.id).toBe('a');
  });

  it('succeeds on the second ask: the way to ask again is the one that works', async () => {
    let calls = 0;
    const gate = deferred();
    const { operations, push, cancel, fail, row } = setup({
      cancel: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('no');
        }

        return gate.promise;
      },
    });
    push([cancellable()]);
    await operations.cancel('a');
    (fail.mock.calls[0])[0].retry();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(row('a').cancel).toBe('requested');
    gate.resolve(undefined);
    await vi.waitFor(() => {
      expect(row('a').cancel).toBe('available');
    });
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it('does not ask again, when the way to ask again is used, for a task that finished meanwhile', async () => {
    const { operations, push, cancel, fail } = setup({
      cancel: async () => {
        throw new Error('no');
      },
    });
    const record = cancellable();
    push([record]);
    await operations.cancel('a');
    push([{ ...record, task: { state: 'succeeded', cancellation: 'unsupported' } }]);
    (fail.mock.calls[0])[0].retry();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('treats a feed that throws before it returns a promise as a failure like any other', async () => {
    const error = new Error('the bridge is down');
    const { operations, push, row, fail } = setup({
      feed: {
        cancel: () => {
          throw error;
        },
      },
    });
    push([cancellable()]);
    await expect(operations.cancel('a')).resolves.toBeUndefined();
    expect(row('a').cancel).toBe('available');
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', error }));
  });

  it('never rejects when the host\'s own handler of the failure throws: it is logged', async () => {
    const { operations, push, row } = setup({
      cancel: async () => {
        throw new Error('no');
      },
      fail: () => {
        throw new Error('the handler is broken');
      },
    });
    push([cancellable()]);
    await expect(operations.cancel('a')).resolves.toBeUndefined();
    expect(row('a').cancel).toBe('available');
    expect(console.warn).toHaveBeenCalled();
  });

  it('tells the host what it knew when it asked, when the task is gone from the feed before the answer comes', async () => {
    const gate = deferred();
    const { operations, push, fail } = setup({ cancel: async () => gate.promise });
    push([cancellable()]);
    const call = operations.cancel('a');
    push([]);
    gate.reject(new Error('too late'));
    await call;
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', title: 'Reindexing the catalogue', plugin: 'alpha', running: false }));
  });

  // The notice a person reads says what the row says. The model makes the row again from the feed's latest record before it tells the host, so what it tells is what the row is at that moment.
  it.each<TaskState>(['starting', 'running', 'paused'])('tells the host the work is still running when the task is %s at the moment the failure is reported', async (state) => {
    const gate = deferred();
    const { operations, push, fail } = setup({ cancel: async () => gate.promise });
    const record = cancellable();
    push([record]);
    const call = operations.cancel('a');
    push([{ ...record, task: { state, cancellation: 'available' } }]);
    gate.reject(new Error('no'));
    await call;
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', running: true }));
  });

  it.each<TaskState>(['succeeded', 'failed', 'cancelled', 'unknown'])('tells the host the work is not running when the task was %s by the time the failure is reported: it finished while the request was on its way', async (state) => {
    const gate = deferred();
    const { operations, push, fail, row } = setup({ cancel: async () => gate.promise });
    const record = cancellable();
    push([record]);
    const call = operations.cancel('a');
    push([{ ...record, task: { state, cancellation: 'unsupported' } }]);
    gate.reject(new Error('too late'));
    await call;
    expect(row('a').active).toBe(false);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', running: false }));
  });

  it('tells the host the work is still running when a feed that throws before it returns a promise fails it, as it does for any other failure of a task that has not finished', async () => {
    const { operations, push, fail } = setup({
      feed: {
        cancel: () => {
          throw new Error('the bridge is down');
        },
      },
    });
    const record = cancellable();
    push([record]);
    await operations.cancel('a');
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', running: true }));
  });

  it('says the work is still running for the first failure and not running for the second, when the task finished while the way to ask again was in flight', async () => {
    const { operations, push, fail } = setup({
      cancel: async () => {
        throw new Error('no');
      },
    });
    const record = cancellable();
    push([record]);
    await operations.cancel('a');
    expect(fail.mock.calls[0][0].running).toBe(true);
    fail.mock.calls[0][0].retry();
    push([{ ...record, task: { state: 'failed', cancellation: 'unsupported' } }]);
    await vi.waitFor(() => {
      expect(fail).toHaveBeenCalledTimes(2);
    });
    expect(fail.mock.calls[1][0].running).toBe(false);
  });

  it('is a model that needs no failure handler: a rejection with no one to tell is still not a rejection', async () => {
    const control = createActivityFeed({
      cancel: async () => {
        throw new Error('no');
      },
      markRead: async () => undefined,
    });
    const operations = createOperations({ feed: control.feed, resolve: names().resolve });
    operations.attach();
    control.push([task('a', { cancellation: 'available' })]);
    await expect(operations.cancel('a')).resolves.toBeUndefined();
  });
});

describe('marking records read', () => {
  it('asks the feed for each id, once, and answers when all of them did', async () => {
    const { operations, markRead } = setup();
    await expect(operations.markRead(['a', 'b', 'c'])).resolves.toBeUndefined();
    expect(markRead.mock.calls).toEqual([['a'], ['b'], ['c']]);
  });

  it('asks for every id at once: one that is slow does not hold the others', async () => {
    const gate = deferred();
    const { operations, markRead } = setup({ markRead: async (id) => (id === 'a' ? gate.promise : undefined) });
    const done = operations.markRead(['a', 'b', 'c']);
    expect(markRead).toHaveBeenCalledTimes(3);
    gate.resolve(undefined);
    await done;
  });

  it('makes no call for no ids', async () => {
    const { operations, markRead } = setup();
    await operations.markRead([]);
    expect(markRead).not.toHaveBeenCalled();
  });

  it('never rejects: a failure is logged with console.warn, naming the record, the other ids are still asked, and the rows stay unread', async () => {
    const { operations, push, markRead, row } = setup({
      markRead: async (id) => {
        if (id === 'op-bad') {
          throw new Error('the host did not answer');
        }

        return undefined;
      },
    });
    push([task('op-first', { state: 'failed', at: 3 }), task('op-bad', { state: 'failed', at: 2 }), task('op-last', { state: 'failed', at: 1 })]);
    await expect(operations.markRead(['op-first', 'op-bad', 'op-last'])).resolves.toBeUndefined();
    expect(markRead).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(console.warn).mock.calls[0]?.map(String).join(' ');
    expect(logged).toContain('op-bad');
    expect(logged).not.toContain('op-first');
    // The model changes a row only on the host's word: it comes back through the feed as a read record.
    expect(row('op-bad').unread).toBe('error');
  });

  it('treats a feed that throws before it returns a promise as a failure like any other', async () => {
    const { operations } = setup({
      feed: {
        markRead: () => {
          throw new Error('the bridge is down');
        },
      },
    });
    await expect(operations.markRead(['a'])).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('shows a record as read when the host says so, through the feed, and the badge goes with it', async () => {
    const { operations, push, snapshot } = setup();
    const failure = task('a', { state: 'failed' });
    push([failure]);
    expect(snapshot().badge).toEqual({ kind: 'dot', tone: 'error', label: '1 unread failure' });
    await operations.markRead(['a']);
    push([{ ...failure, visibility: { read: true } }]);
    expect(snapshot().badge).toBeUndefined();
    expect(snapshot().unread.ids).toEqual([]);
  });
});

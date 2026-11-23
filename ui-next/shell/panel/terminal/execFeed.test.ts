import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createExecFeed, signalEvent, streamEvent, type ExecTransport } from './execFeed';
import type { TerminalFeedHandle } from './feed';

// The session of a pty as the host holds it, against a transport the test drives: what `ExecClient` and the Wails events are, as far as the feed is concerned. The feed is where the rules of a terminal's
// wire live (docs/ui-next/optimisations.md HLT-25 to HLT-28, HGO-34 to HGO-36): the listeners are in place BEFORE the process starts and are all released, output is held as it came and read at the reader's
// pace, input goes in order with one call in flight, the size is settled (one message for a size that stood still, rows before columns), and a close ends the process exactly once.

type Deferred = { readonly resolve: (value?: unknown) => void; readonly reject: (error: unknown) => void };

type Rig = {
  readonly feed: TerminalFeedHandle & { readonly id: string };
  readonly calls: string[];
  /** The calls of one kind, with their arguments. */
  readonly of: (kind: 'create' | 'write' | 'resize' | 'close') => unknown[][];
  /** Delivers an event to its listeners, as Wails does. */
  readonly emit: (name: string, data: unknown) => void;
  /** Listeners alive now, over all names, or on one. */
  readonly listeners: (name?: string) => number;
  /** The calls whose answer the test has not given yet. */
  readonly pending: (kind: 'create' | 'write' | 'resize' | 'close') => Deferred[];
  readonly warn: Mock<(message: string, error?: unknown) => void>;
  readonly wakes: () => number;
};

const text = (value: string): string => btoa(value);
const bytes = (value: string): number[] => [...new TextEncoder().encode(value)];

function rig(options: { readonly auto?: boolean; readonly limit?: number; readonly settleMs?: number; readonly gone?: (error: unknown) => boolean; readonly size?: false | { readonly cols: number; readonly rows: number } } = {}): Rig {
  const calls: string[] = [];
  const log: Record<string, unknown[][]> = { create: [], write: [], resize: [], close: [] };
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const waiting: Record<string, Deferred[]> = { create: [], write: [], resize: [], close: [] };
  const auto = options.auto ?? true;
  const answer = async (kind: string, args: unknown[]): Promise<unknown> => {
    calls.push(kind);
    log[kind]?.push(args);
    if (auto) {
      return Promise.resolve(undefined);
    }

    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    waiting[kind]?.push({ resolve, reject });
    return promise;
  };

  const transport: ExecTransport = {
    create: async (id, size) => answer('create', [id, size.cols, size.rows]),
    write: async (id, data) => answer('write', [id, data]),
    resize: async (id, rows, cols) => answer('resize', [id, rows, cols]),
    close: async (id) => answer('close', [id]),
    on: (name, listener) => {
      calls.push(`on ${name}`);
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => {
        calls.push(`off ${name}`);
        set.delete(listener);
      };
    },
    describe: (error) => (error instanceof Error ? error.message : String(error)),
    isGone: options.gone ?? ((error) => error instanceof Error && error.message === 'gone'),
  };
  const warn = vi.fn<(message: string, error?: unknown) => void>();
  const feed = createExecFeed({ transport, newId: () => 'term-1', warn, ...(options.limit === undefined ? {} : { limit: options.limit }), ...(options.settleMs === undefined ? {} : { settleMs: options.settleMs }) });
  let woken = 0;
  feed.subscribe(() => {
    woken += 1;
  });
  // The view measuring itself, as the body does when it mounts: the process starts at that size (`size: false` is a view that has not measured).
  if (options.size !== false) {
    const size = options.size ?? { cols: 80, rows: 24 };
    feed.resize(size.cols, size.rows);
  }

  return {
    feed,
    calls,
    of: (kind) => log[kind] ?? [],
    emit: (name, data) => {
      for (const listener of [...(listeners.get(name) ?? [])]) {
        listener(data);
      }
    },
    listeners: (name) => (name === undefined ? [...listeners.values()].reduce((sum, set) => sum + set.size, 0) : (listeners.get(name)?.size ?? 0)),
    pending: (kind) => waiting[kind] ?? [],
    warn,
    wakes: () => woken,
  };
}

/** Lets the promises of the feed settle. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('starting a session', () => {
  it('puts every listener in place BEFORE it starts the process, so no byte of the first prompt can come before somebody is listening (the old terminal attached after the call)', () => {
    const { calls } = rig();
    const first = calls.indexOf('create');
    expect(first).toBeGreaterThan(0);
    expect(calls.slice(0, first).sort()).toEqual([
      'on core/exec/signal/CLOSE/term-1',
      'on core/exec/signal/ERROR/term-1',
      'on core/exec/stream/stderr/term-1',
      'on core/exec/stream/stdout/term-1',
    ]);
  });

  it('names the session itself: the id it asks the backend for is the one its events carry', () => {
    const { feed, of } = rig();
    expect(feed.id).toBe('term-1');
    expect(of('create')).toEqual([['term-1', 80, 24]]);
    expect(streamEvent('term-1', 'stdout')).toBe('core/exec/stream/stdout/term-1');
    expect(signalEvent('term-1', 'CLOSE')).toBe('core/exec/signal/CLOSE/term-1');
  });

  it('is starting until the backend answers, then running; the status is a new object each time and the same one between', async () => {
    const { feed, pending } = rig({ auto: false });
    const first = feed.getSnapshot();
    expect(first).toEqual({ state: 'starting' });
    expect(feed.getSnapshot()).toBe(first);
    pending('create')[0]?.resolve();
    await settle();
    expect(feed.getSnapshot()).toEqual({ state: 'running' });
    expect(feed.getSnapshot()).not.toBe(first);
  });

  it('tells its listeners when the status changes', async () => {
    const { pending, wakes } = rig({ auto: false });
    const before = wakes();
    pending('create')[0]?.resolve();
    await settle();
    expect(wakes()).toBe(before + 1);
  });

  it('fails when the backend refuses, with its own words as the cause of a start that did not happen, and lets go of every listener', async () => {
    const { feed, pending, listeners } = rig({ auto: false });
    pending('create')[0]?.reject(new Error('Failed to start terminal'));
    await settle();
    expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'start', message: 'Failed to start terminal' } });
    expect(listeners()).toBe(0);
  });
});

describe('what the process writes', () => {
  it('is held as it came and read as bytes, oldest first, once', () => {
    const { feed, emit } = rig();
    emit(streamEvent('term-1', 'stdout'), text('hello '));
    emit(streamEvent('term-1', 'stdout'), text('world'));
    const read = feed.read();
    expect(read.chunks.map((chunk) => [...chunk])).toEqual([bytes('hello '), bytes('world')]);
    expect(read.bytes).toBe(11);
    expect(read.dropped).toBe(0);
    expect(feed.read()).toEqual({ chunks: [], bytes: 0, dropped: 0 });
  });

  it('keeps what arrives before the backend has answered: the first prompt may come before the call returns', async () => {
    const { feed, emit, pending } = rig({ auto: false });
    emit(streamEvent('term-1', 'stdout'), text('prompt $ '));
    expect(feed.getSnapshot().state).toBe('starting');
    pending('create')[0]?.resolve();
    await settle();
    expect(feed.read().chunks.map((chunk) => [...chunk])).toEqual([bytes('prompt $ ')]);
  });

  it('hands back part of what it holds when the reader asks for less, and the rest is for the next read: a screen that cannot take more now takes what it can', () => {
    const { feed, emit, wakes } = rig();
    const before = wakes();
    emit(streamEvent('term-1', 'stdout'), text('aaaa'));
    emit(streamEvent('term-1', 'stdout'), text('bbbb'));
    emit(streamEvent('term-1', 'stdout'), text('cccc'));
    const first = feed.read(5);
    expect(first.chunks.map((chunk) => [...chunk])).toEqual([bytes('aaaa'), bytes('bbbb')]);
    expect(first.bytes).toBe(8);
    expect(feed.read().chunks.map((chunk) => [...chunk])).toEqual([bytes('cccc')]);
    expect(wakes()).toBe(before + 1);
  });

  it('takes the error stream too, into the same output: a pty has one', () => {
    const { feed, emit } = rig();
    emit(streamEvent('term-1', 'stdout'), text('a'));
    emit(streamEvent('term-1', 'stderr'), text('b'));
    expect(feed.read().chunks.map((chunk) => [...chunk])).toEqual([bytes('a'), bytes('b')]);
  });

  it('wakes a listener ONCE until its reader has read, however many chunks come: a flood is one wake-up between two reads', () => {
    const { feed, emit, wakes } = rig();
    const before = wakes();
    for (let index = 0; index < 1_000; index += 1) {
      emit(streamEvent('term-1', 'stdout'), text('y\r\n'));
    }

    expect(wakes()).toBe(before + 1);
    feed.read();
    emit(streamEvent('term-1', 'stdout'), text('y\r\n'));
    expect(wakes()).toBe(before + 2);
  });

  it('does not touch what it holds until somebody reads: no decode, no copy (a hidden terminal costs a push)', () => {
    const decode = vi.spyOn(Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }, 'fromBase64');
    const { emit } = rig();
    for (let index = 0; index < 100; index += 1) {
      emit(streamEvent('term-1', 'stdout'), text('y\r\n'));
    }

    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
  });

  it('holds at most its bound and says how many bytes it dropped, the oldest first', () => {
    const { feed, emit } = rig({ limit: 10 });
    emit(streamEvent('term-1', 'stdout'), text('aaaa'));
    emit(streamEvent('term-1', 'stdout'), text('bbbb'));
    emit(streamEvent('term-1', 'stdout'), text('cccc'));
    const read = feed.read();
    expect(read.chunks.map((chunk) => [...chunk])).toEqual([bytes('bbbb'), bytes('cccc')]);
    expect(read.dropped).toBe(4);
  });

  it('ignores a payload that is not the text of a chunk, and says so once, not for every event', () => {
    const { feed, emit, warn } = rig();
    emit(streamEvent('term-1', 'stdout'), { not: 'a string' });
    emit(streamEvent('term-1', 'stdout'), null);
    emit(streamEvent('term-1', 'stdout'), 42);
    expect(feed.read().chunks).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('what the user types', () => {
  it('is sent as the base64 of its UTF-8 bytes, to the session, once the process exists', async () => {
    const { feed, of } = rig();
    await settle();
    feed.write('ls -la é\r');
    await settle();
    expect(of('write')).toEqual([['term-1', btoa(String.fromCharCode(...new TextEncoder().encode('ls -la é\r')))]]);
  });

  it('waits for the process: what is typed while it starts is sent when it is there, in order, as one call', async () => {
    const { feed, of, pending } = rig({ auto: false });
    feed.write('ls');
    feed.write(' -la');
    feed.write('\r');
    expect(of('write')).toEqual([]);
    pending('create')[0]?.resolve();
    await settle();
    expect(of('write')).toEqual([['term-1', btoa('ls -la\r')]]);
  });

  it('keeps ONE call in flight: what is typed meanwhile goes in the next call, in order, and nothing is lost or repeated', async () => {
    const { feed, of, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    feed.write('a');
    expect(of('write')).toEqual([['term-1', btoa('a')]]);
    feed.write('b');
    feed.write('c');
    feed.write('d');
    expect(of('write')).toHaveLength(1);
    pending('write')[0]?.resolve();
    await settle();
    expect(of('write')).toEqual([['term-1', btoa('a')], ['term-1', btoa('bcd')]]);
    pending('write')[1]?.resolve();
    await settle();
    expect(of('write')).toHaveLength(2);
  });

  it('fails the session when the backend does not take it, saying that what was typed was not delivered, and sends no more', async () => {
    const { feed, pending, of } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    feed.write('a');
    pending('write')[0]?.reject(new Error('Failed to write'));
    await settle();
    expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'input', message: 'Failed to write' } });
    feed.write('b');
    await settle();
    expect(of('write')).toHaveLength(1);
  });

  it('ends the session when the backend says the session is gone: nothing runs to take it', async () => {
    const { feed, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    feed.write('a');
    pending('write')[0]?.reject(new Error('gone'));
    await settle();
    expect(feed.getSnapshot()).toEqual({ state: 'ended' });
  });

  it('is ignored once the session is over', async () => {
    const { feed, emit, of } = rig();
    await settle();
    emit(signalEvent('term-1', 'CLOSE'), text('Session terminated'));
    feed.write('a');
    await settle();
    expect(of('write')).toEqual([]);
  });
});

describe('the size of the screen', () => {
  it('starts the process AT the first size, columns and rows in the call that starts it, and sends no resize after it: the shell lays out its first prompt for the size the view measured', async () => {
    const { feed, of, pending } = rig({ auto: false, size: false });
    expect(of('create')).toEqual([]);
    feed.resize(132, 41);
    expect(of('create')).toEqual([['term-1', 132, 41]]);
    pending('create')[0]?.resolve();
    await settle();
    expect(feed.getSnapshot()).toEqual({ state: 'running' });
    vi.advanceTimersByTime(1000);
    await settle();
    expect(of('resize')).toEqual([]);
  });

  it('starts at the whole cells of a size that is not whole: a cell is a whole thing', () => {
    const { feed, of } = rig({ size: false });
    feed.resize(100.9, 20.2);
    expect(of('create')).toEqual([['term-1', 100, 20]]);
  });

  it('does not start the process before it has a size, with every listener in place, and what is typed meanwhile is sent once it runs', async () => {
    const { feed, of, listeners } = rig({ size: false });
    feed.write('ls\r');
    await settle();
    expect(of('create')).toEqual([]);
    expect(feed.getSnapshot()).toEqual({ state: 'starting' });
    expect(listeners()).toBe(4);
    feed.resize(100, 20);
    await settle();
    expect(of('create')).toEqual([['term-1', 100, 20]]);
    expect(of('write')).toEqual([['term-1', text('ls\r')]]);
  });

  it('lets a session that never got a size be closed: nothing started, nothing to end, every listener released, and a size that comes later starts nothing', async () => {
    const { feed, of, listeners } = rig({ size: false });
    await feed.close();
    expect(of('create')).toEqual([]);
    expect(of('close')).toEqual([]);
    expect(listeners()).toBe(0);
    feed.resize(100, 20);
    await settle();
    expect(of('create')).toEqual([]);
  });

  it('settles a size that came while the process was starting like any other, and sends it once the process runs and the size has stood still, as one more call: ROWS then COLUMNS, as the binding takes them (the old terminal had them swapped once, host #54)', async () => {
    const { feed, of, pending } = rig({ auto: false, size: false, settleMs: 10 });
    feed.resize(132, 41);
    feed.resize(100, 20);
    expect(of('resize')).toEqual([]);
    pending('create')[0]?.resolve();
    await settle();
    expect(of('create')).toEqual([['term-1', 132, 41]]);
    expect(of('resize')).toEqual([]);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toEqual([['term-1', 20, 100]]);
  });

  it('starts nothing at a size the host would refuse: a first size past 1,000 cells waits for one it can start at', () => {
    const { feed, of } = rig({ size: false });
    feed.resize(1001, 24);
    expect(of('create')).toEqual([]);
    feed.resize(1000, 24);
    expect(of('create')).toEqual([['term-1', 1000, 24]]);
  });

  it('settles every size after the first: fifty sizes in a drag are one message when the size stood still', async () => {
    const { feed, of } = rig({ settleMs: 100 });
    await settle();
    for (let step = 0; step < 50; step += 1) {
      feed.resize(100 + step, 20 + (step % 7));
      vi.advanceTimersByTime(2);
    }

    expect(of('resize')).toEqual([]);
    vi.advanceTimersByTime(100);
    await settle();
    expect(of('resize')).toEqual([['term-1', 20 + (49 % 7), 149]]);
  });

  it('restarts the settling for every size: a size that keeps changing is not sent until it stops', async () => {
    const { feed, of } = rig({ settleMs: 100 });
    await settle();
    for (let step = 0; step < 10; step += 1) {
      feed.resize(101 + step, 20);
      vi.advanceTimersByTime(90);
    }

    expect(of('resize')).toEqual([]);
    vi.advanceTimersByTime(100);
    await settle();
    expect(of('resize')).toEqual([['term-1', 20, 110]]);
  });

  it('keeps ONE call in flight and the newest size wins: the sizes that came while it was out are one more call with the last of them', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    expect(of('resize')).toEqual([['term-1', 20, 100]]);
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    feed.resize(120, 22);
    vi.advanceTimersByTime(20);
    expect(of('resize')).toHaveLength(1);
    pending('resize')[0]?.resolve();
    await settle();
    expect(of('resize')).toEqual([['term-1', 20, 100], ['term-1', 22, 120]]);
  });

  it('sends nothing for the size it started at or last sent, and nothing that is not a size: below 1 cell, past 1,000, not a number', async () => {
    const { feed, of } = rig({ settleMs: 10 });
    await settle();
    feed.resize(80, 24);
    feed.resize(0, 24);
    feed.resize(80, 0);
    feed.resize(70_000, 24);
    feed.resize(Number.NaN, 24);
    feed.resize(80, Number.POSITIVE_INFINITY);
    vi.advanceTimersByTime(50);
    await settle();
    expect(of('resize')).toEqual([]);
  });

  it('floors a later size that is not whole', async () => {
    const { feed, of } = rig({ settleMs: 10 });
    await settle();
    feed.resize(100.9, 20.2);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toEqual([['term-1', 20, 100]]);
  });

  it('goes on after a size the backend refused: the next size is sent', async () => {
    const { feed, of, pending, warn } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    await settle();
    expect(warn).toHaveBeenCalled();
    feed.resize(101, 20);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toHaveLength(2);
  });

  it('sends nothing once the feed was closed: the size that waited behind the call in flight leaves with the session', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    const closing = feed.close();
    pending('resize')[0]?.resolve();
    await settle();
    expect(of('resize')).toEqual([['term-1', 20, 100]]);
    pending('close')[0]?.resolve();
    await closing;
  });

  it('sends the newer size that was waiting when a size is refused, and never the refused size again', async () => {
    const { feed, of, pending, warn } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    expect(of('resize')).toEqual([['term-1', 20, 100]]);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    await settle();
    expect(warn).toHaveBeenCalled();
    expect(of('resize')).toEqual([['term-1', 20, 100], ['term-1', 21, 110]]);
    pending('resize')[1]?.reject(new Error('Failed to resize'));
    await settle();
    expect(of('resize')).toHaveLength(2);
  });
});

describe('the end of the process', () => {
  it('ends the session when the backend says it closed, and lets go of every listener: nothing more can come', async () => {
    const { feed, emit, listeners, wakes } = rig();
    await settle();
    const before = wakes();
    emit(signalEvent('term-1', 'CLOSE'), text('Session terminated'));
    expect(feed.getSnapshot()).toEqual({ state: 'ended' });
    expect(wakes()).toBe(before + 1);
    expect(listeners()).toBe(0);
  });

  it('keeps what the process wrote readable after it ended: the scrollback is the user\'s', async () => {
    const { feed, emit } = rig();
    await settle();
    emit(streamEvent('term-1', 'stdout'), text('bye\r\n'));
    emit(signalEvent('term-1', 'CLOSE'), text('Session terminated'));
    expect(feed.read().chunks.map((chunk) => [...chunk])).toEqual([bytes('bye\r\n')]);
  });

  it('is told of the end once: a second close signal changes nothing', async () => {
    const { feed, emit, wakes } = rig();
    await settle();
    emit(signalEvent('term-1', 'CLOSE'), text('Session terminated'));
    const snapshot = feed.getSnapshot();
    const before = wakes();
    emit(signalEvent('term-1', 'CLOSE'), text('Session terminated'));
    expect(feed.getSnapshot()).toBe(snapshot);
    expect(wakes()).toBe(before);
  });

  it('fails the session when the backend says it broke, in the words it gave (a title and a message)', async () => {
    const { feed, emit, listeners } = rig();
    await settle();
    emit(signalEvent('term-1', 'ERROR'), { title: 'Shell not found', message: 'The shell "bash" was not found in this container.', suggestion: 'Try sh.', retryable: true });
    expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'Shell not found. The shell "bash" was not found in this container.' } });
    expect(listeners()).toBe(0);
  });

  it('says the failure in its own words even when the backend sent a plain text or nothing', async () => {
    const one = rig();
    await settle();
    one.emit(signalEvent('term-1', 'ERROR'), 'it broke');
    expect(one.feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'it broke' } });
    const two = rig();
    await settle();
    two.emit(signalEvent('term-1', 'ERROR'), null);
    expect(two.feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: '' } });
  });

  it('keeps the failure when a close signal follows it: the end that follows an error does not undo it', async () => {
    const { feed, emit } = rig();
    await settle();
    emit(signalEvent('term-1', 'ERROR'), { title: 'Boom', message: 'It broke' });
    const snapshot = feed.getSnapshot();
    emit(signalEvent('term-1', 'CLOSE'), text('Session terminated'));
    expect(feed.getSnapshot()).toBe(snapshot);
  });
});

describe('closing the session', () => {
  it('ends the process and lets go of every listener, once', async () => {
    const { feed, of, listeners, calls } = rig();
    await settle();
    await feed.close();
    expect(of('close')).toEqual([['term-1']]);
    expect(listeners()).toBe(0);
    expect(calls.filter((call) => call.startsWith('off ')).sort()).toEqual([
      'off core/exec/signal/CLOSE/term-1',
      'off core/exec/signal/ERROR/term-1',
      'off core/exec/stream/stderr/term-1',
      'off core/exec/stream/stdout/term-1',
    ]);
  });

  it('is safe to call again: the process is ended once, and the second call is the same answer', async () => {
    const { feed, of } = rig();
    await settle();
    const first = feed.close();
    const second = feed.close();
    await Promise.all([first, second]);
    expect(of('close')).toHaveLength(1);
  });

  it('ends a process that is still starting when the backend has answered: the call that made it is out, and its answer is the first chance to end it', async () => {
    const { feed, of, pending } = rig({ auto: false });
    const closing = feed.close();
    expect(of('close')).toEqual([]);
    pending('create')[0]?.resolve();
    await settle();
    expect(of('close')).toEqual([['term-1']]);
    pending('close')[0]?.resolve();
    await closing;
  });

  it('has nothing to end when the process never started or already ended on its own', async () => {
    const failed = rig({ auto: false });
    failed.pending('create')[0]?.reject(new Error('Failed to start terminal'));
    await settle();
    await failed.feed.close();
    expect(failed.of('close')).toEqual([]);
    const ended = rig();
    await settle();
    ended.emit(signalEvent('term-1', 'CLOSE'), text('Session terminated'));
    await ended.feed.close();
    expect(ended.of('close')).toEqual([]);
  });

  it('is not troubled by a backend that says the session is gone: that is what was wanted', async () => {
    const { feed, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    const closing = feed.close();
    await settle();
    pending('close')[0]?.reject(new Error('gone'));
    await expect(closing).resolves.toBeUndefined();
  });

  it('tells the caller when the backend refused for another reason, and the feed is closed all the same', async () => {
    const { feed, pending, listeners } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    const closing = feed.close();
    await settle();
    pending('close')[0]?.reject(new Error('The host is busy'));
    await expect(closing).rejects.toThrow('The host is busy');
    expect(listeners()).toBe(0);
  });

  it('holds nothing and sends nothing afterwards: no read, no write, no size, no timer', async () => {
    const { feed, emit, of } = rig({ settleMs: 10 });
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    await settle();
    emit(streamEvent('term-1', 'stdout'), text('late'));
    feed.resize(110, 21);
    await feed.close();
    expect(feed.read()).toEqual({ chunks: [], bytes: 0, dropped: 0 });
    feed.write('x');
    feed.resize(120, 22);
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(of('write')).toEqual([]);
    expect(of('resize')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets no listener it was given hear of anything once it is closed', async () => {
    const { feed, emit, wakes } = rig();
    await settle();
    await feed.close();
    const before = wakes();
    emit(streamEvent('term-1', 'stdout'), text('late'));
    emit(signalEvent('term-1', 'CLOSE'), text('Session terminated'));
    expect(wakes()).toBe(before);
  });
});

describe('the listeners a caller gives it', () => {
  it('can stop listening, and does so for good', async () => {
    const { feed, emit } = rig();
    await settle();
    const heard = vi.fn();
    const stop = feed.subscribe(heard);
    emit(streamEvent('term-1', 'stdout'), text('a'));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    stop();
    feed.read();
    emit(streamEvent('term-1', 'stdout'), text('b'));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('is not undone by a listener that stops itself while it is told', async () => {
    const { feed, emit } = rig();
    await settle();
    const calls: string[] = [];
    const stop = feed.subscribe(() => {
      calls.push('first');
      stop();
    });
    feed.subscribe(() => {
      calls.push('second');
    });
    emit(streamEvent('term-1', 'stdout'), text('a'));
    expect(calls).toEqual(['first', 'second']);
  });
});

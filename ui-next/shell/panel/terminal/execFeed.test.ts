import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ACK_RETRY_MS, BACKLOG_RETRY_MS, CHUNK_BYTES, WINDOW_BYTES, WINDOW_CALLS, createExecFeed, signalEvent, streamEvent, type ExecTransport } from './execFeed';
import type { TerminalFeedHandle } from './feed';
import { fakeCreditHost } from './testing';

// The session of a pty as the host holds it, against a transport the test drives: what `ExecClient` and the Wails events are, as far as the feed is concerned. The feed is where the rules of a terminal's
// wire live (docs/ui-next/optimisations.md HLT-25 to HLT-28, HGO-34 to HGO-36): the listeners are in place BEFORE the process starts and are all released, output is held as it came and read at the reader's
// pace, input goes out at once and the host puts it in order by the number every call carries (docs/ui-next/status/T1-go.md 2.4: one counter for the writes and the sizes, a paste in pieces under a window, a call
// the host refused for its backlog sent again with its number), the size is settled (one message for a size that stood still, rows before columns), and a close ends the process exactly once.

type Deferred = { readonly resolve: (value?: unknown) => void; readonly reject: (error: unknown) => void };

type Rig = {
  readonly feed: TerminalFeedHandle & { readonly id: string };
  readonly calls: string[];
  /** The calls of one kind, with their arguments. */
  readonly of: (kind: 'create' | 'write' | 'resize' | 'close' | 'ack' | 'busy') => unknown[][];
  /** Delivers an event to its listeners, as Wails does. */
  readonly emit: (name: string, data: unknown) => void;
  /** Listeners alive now, over all names, or on one. */
  readonly listeners: (name?: string) => number;
  /** The calls whose answer the test has not given yet. */
  readonly pending: (kind: 'create' | 'write' | 'resize' | 'close' | 'ack' | 'busy') => Deferred[];
  /** The kind and the number of every input call, in the order the transport was called: the counter the host puts the calls in order by. */
  readonly numbered: () => ReadonlyArray<readonly ['write' | 'resize', number]>;
  readonly warn: Mock<(message: string, error?: unknown) => void>;
  readonly wakes: () => number;
};

const text = (value: string): string => btoa(value);
const bytes = (value: string): number[] => [...new TextEncoder().encode(value)];

type RigOptions = {
  readonly auto?: boolean;
  readonly settleMs?: number;
  readonly gone?: (error: unknown) => boolean;
  readonly size?: false | { readonly cols: number; readonly rows: number };
  /** What the backend answers to the call that starts the process (the host answers with the session it made). */
  readonly created?: unknown;
  /** What the backend answers to the question of what runs in the session. */
  readonly busy?: unknown;
};

function rig(options: RigOptions = {}): Rig {
  const calls: string[] = [];
  const log: Record<string, unknown[][]> = { create: [], write: [], resize: [], close: [], ack: [], busy: [] };
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const waiting: Record<string, Deferred[]> = { create: [], write: [], resize: [], close: [], ack: [], busy: [] };
  const auto = options.auto ?? true;
  const numbered: Array<readonly ['write' | 'resize', number]> = [];
  const answer = async (kind: string, args: unknown[], value?: unknown): Promise<unknown> => {
    calls.push(kind);
    log[kind]?.push(args);
    if (auto) {
      return Promise.resolve(value);
    }

    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    waiting[kind]?.push({ resolve, reject });
    return promise;
  };

  const transport: ExecTransport = {
    create: async (id, size) => answer('create', [id, size.cols, size.rows], options.created),
    write: async (id, seq, data) => {
      numbered.push(['write', seq]);
      return answer('write', [id, seq, data]);
    },
    resize: async (id, seq, rows, cols) => {
      numbered.push(['resize', seq]);
      return answer('resize', [id, seq, rows, cols]);
    },
    close: async (id) => answer('close', [id]),
    ack: async (id, count) => answer('ack', [id, count]),
    busy: async (id) => answer('busy', [id], options.busy),
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
    codeOf: (error) => (typeof error === 'object' && error !== null && typeof Reflect.get(error, 'code') === 'string' ? String(Reflect.get(error, 'code')) : undefined),
  };
  const warn = vi.fn<(message: string, error?: unknown) => void>();
  const feed = createExecFeed({ transport, newId: () => 'term-1', warn, ...(options.settleMs === undefined ? {} : { settleMs: options.settleMs }) });
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
    numbered: () => numbered,
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

const KIB = 1_024;

/** A paste of `kib` KiB of text that is never the same in two places: a different block for each KiB, so that a piece that came twice, or out of order, or not at all, is seen. */
const pasteOf = (kib: number): string => Array.from({ length: kib }, (_, block) => String(block).padStart(4, '0').repeat(256)).join('');

/** How many bytes a write call carries. */
const sizeOf = (call: readonly unknown[]): number => atob(String(call[2])).length;

/** The text of a write call, as the host's pty would read it: a piece that was cut in the middle of a character does not decode, and this throws. */
const textOf = (call: readonly unknown[]): string => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(String(call[2])), (char) => char.charCodeAt(0)));

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
    expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
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
  it('is sent as the base64 of its UTF-8 bytes, to the session, as call number 1, once the process exists', async () => {
    const { feed, of } = rig();
    await settle();
    feed.write('ls -la é\r');
    await settle();
    expect(of('write')).toEqual([['term-1', 1, btoa(String.fromCharCode(...new TextEncoder().encode('ls -la é\r')))]]);
  });

  it('waits for the process: what is typed while it starts is held and sent when it is there, in order, as one call; nothing is numbered before the process exists', async () => {
    const { feed, of, pending, numbered } = rig({ auto: false });
    feed.write('ls');
    feed.write(' -la');
    feed.write('\r');
    expect(of('write')).toEqual([]);
    expect(numbered()).toEqual([]);
    pending('create')[0]?.resolve();
    await settle();
    expect(of('write')).toEqual([['term-1', 1, btoa('ls -la\r')]]);
    feed.write('x');
    expect(numbered()).toEqual([['write', 1], ['write', 2]]);
  });

  it('sends what is typed AT ONCE, each piece as its own call with the next number, and never waits for the answer of an earlier call: a key pressed while a call is in flight goes now', async () => {
    const { feed, of, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    feed.write('a');
    expect(of('write')).toEqual([['term-1', 1, btoa('a')]]);
    feed.write('b');
    expect(of('write')).toEqual([['term-1', 1, btoa('a')], ['term-1', 2, btoa('b')]]);
    feed.write('c');
    expect(of('write')).toHaveLength(3);
    // The answers come late and in another order, and change nothing: no call was waiting for one.
    pending('write')[2]?.resolve();
    pending('write')[0]?.resolve();
    await settle();
    feed.write('d');
    expect(of('write')).toEqual([['term-1', 1, btoa('a')], ['term-1', 2, btoa('b')], ['term-1', 3, btoa('c')], ['term-1', 4, btoa('d')]]);
  });

  it('numbers the calls made in one tick in the order they were made, so that the host can put them in the order they were typed in, whatever order they reach it in', async () => {
    const { feed, of, numbered } = rig();
    await settle();
    for (const key of 'echo') {
      feed.write(key);
    }

    expect(numbered()).toEqual([['write', 1], ['write', 2], ['write', 3], ['write', 4]]);
    expect(of('write').map((call) => atob(String(call[2])))).toEqual(['e', 'c', 'h', 'o']);
  });

  it('counts the writes and the sizes with ONE counter, from 1, one number for each call: a size takes the next number like a key', async () => {
    const { feed, numbered } = rig({ settleMs: 10 });
    await settle();
    feed.write('a');
    feed.resize(100, 20);
    vi.advanceTimersByTime(10);
    feed.write('b');
    feed.resize(110, 21);
    vi.advanceTimersByTime(10);
    feed.write('c');
    expect(numbered()).toEqual([['write', 1], ['resize', 2], ['write', 3], ['resize', 4], ['write', 5]]);
  });

  it('sends nothing for nothing typed, and takes no number for it', async () => {
    const { feed, of } = rig();
    await settle();
    feed.write('');
    expect(of('write')).toEqual([]);
    feed.write('a');
    expect(of('write')).toEqual([['term-1', 1, btoa('a')]]);
  });

  it('counts the calls of the typing, for whoever asks whether anything was typed since it looked (a close that asked what runs): each write is one call however much it carries, and what is not typing is not counted', async () => {
    const { feed, emit } = rig({ settleMs: 10 });
    await settle();
    expect(feed.inputs?.()).toBe(0);
    feed.write('l');
    feed.write('s');
    expect(feed.inputs?.()).toBe(2);
    // A paste that goes out in many pieces is still one call of the typing.
    feed.write(pasteOf(300));
    expect(feed.inputs?.()).toBe(3);
    // Nothing typed, a size, an acknowledgement and a read are not typing.
    feed.write('');
    feed.resize(100, 20);
    vi.advanceTimersByTime(10);
    feed.ack(10);
    feed.read();
    await settle();
    expect(feed.inputs?.()).toBe(3);
    // Nor is what the feed ignores once the session is over.
    emit(signalEvent('term-1', 'CLOSE'), { reason: 'exited', exit_code: 0 });
    feed.write('x');
    expect(feed.inputs?.()).toBe(3);
  });

  it('counts what is typed before the process exists too, and what is typed once the feed is closed is not: the count follows what the feed takes', async () => {
    const { feed, pending } = rig({ auto: false });
    feed.write('ls');
    expect(feed.inputs?.()).toBe(1);
    pending('create')[0]?.resolve();
    await settle();
    expect(feed.inputs?.()).toBe(1);
    const closing = feed.close();
    feed.write('x');
    expect(feed.inputs?.()).toBe(1);
    await settle();
    pending('write')[0]?.resolve();
    pending('close')[0]?.resolve();
    await closing;
  });

  describe('whether what was typed has all been delivered (a close that is told that nothing runs asks it, as typing may have started a program the host had not seen yet)', () => {
    /** A session that runs; every call waits for the answer the test gives it. */
    const running = async (): Promise<Rig> => {
      const made = rig({ auto: false, settleMs: 10 });
      made.pending('create')[0]?.resolve();
      await settle();
      return made;
    };

    it('is settled when nothing was typed, and a size that is in flight is not typing', async () => {
      const { feed, pending } = await running();
      expect(feed.inputsSettled?.()).toBe(true);
      feed.resize(100, 20);
      vi.advanceTimersByTime(10);
      expect(pending('resize')).toHaveLength(1);
      expect(feed.inputsSettled?.()).toBe(true);
    });

    it('is not settled while what was typed waits for the process or is in flight, and is when the host has answered it', async () => {
      const { feed, pending } = rig({ auto: false });
      expect(feed.inputsSettled?.()).toBe(true);
      feed.write('ls');
      expect(feed.inputsSettled?.()).toBe(false);
      pending('create')[0]?.resolve();
      await settle();
      expect(pending('write')).toHaveLength(1);
      expect(feed.inputsSettled?.()).toBe(false);
      pending('write')[0]?.resolve();
      await settle();
      expect(feed.inputsSettled?.()).toBe(true);
    });

    it('is not settled while a paste still has pieces that wait for room, and is when the last one was answered', async () => {
      const { feed, of, pending } = await running();
      const paste = pasteOf(2_048);
      const pieces = paste.length / CHUNK_BYTES;
      feed.write(paste);
      for (let answered = 0; answered < pieces; answered += 1) {
        expect(feed.inputsSettled?.()).toBe(false);
        pending('write')[answered]?.resolve();
        await settle();
      }

      expect(of('write')).toHaveLength(pieces);
      expect(feed.inputsSettled?.()).toBe(true);
    });

    it('is not settled while a call the host refused for its backlog waits to be sent again, and is when the host took it', async () => {
      const { feed, pending } = await running();
      feed.write('a');
      pending('write')[0]?.reject(Object.assign(new Error('The terminal holds as much input as it may.'), { code: 'INPUT_BACKLOG' }));
      await settle();
      expect(feed.inputsSettled?.()).toBe(false);
      vi.advanceTimersByTime(BACKLOG_RETRY_MS);
      await settle();
      expect(feed.inputsSettled?.()).toBe(false);
      pending('write')[1]?.resolve();
      await settle();
      expect(feed.inputsSettled?.()).toBe(true);
    });

    it('is settled once the session is over or the feed is closed: nothing is sent any more, so nothing typed is left to wait for', async () => {
      const ended = await running();
      ended.feed.write('a');
      expect(ended.feed.inputsSettled?.()).toBe(false);
      ended.emit(signalEvent('term-1', 'CLOSE'), { reason: 'exited', exit_code: 0 });
      expect(ended.feed.inputsSettled?.()).toBe(true);
      const failed = await running();
      failed.feed.write('a');
      failed.emit(signalEvent('term-1', 'ERROR'), 'it broke');
      expect(failed.feed.inputsSettled?.()).toBe(true);
      const closed = await running();
      closed.feed.write('a');
      const closing = closed.feed.close();
      expect(closed.feed.inputsSettled?.()).toBe(true);
      await settle();
      closed.pending('close')[0]?.resolve();
      await closing;
    });
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

  it('ends the session, without a word, when the backend says the session is gone: nothing runs to take it', async () => {
    const { feed, pending, warn } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    feed.write('a');
    pending('write')[0]?.reject(new Error('gone'));
    await settle();
    expect(feed.getSnapshot()).toEqual({ state: 'ended' });
    expect(warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['SEQUENCE_STALE', 'SEQUENCE_AHEAD'])('fails the session in the host\'s own words, with its code, when a call is refused with %s, and does not send the call again: only a full queue is sent again', async (code) => {
    const { feed, pending, of } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    feed.write('a');
    pending('write')[0]?.reject(Object.assign(new Error('The host cannot take this number.'), { code }));
    await settle();
    expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'input', message: 'The host cannot take this number.', code } });
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(of('write')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
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

describe('how many calls are in flight (the host holds 256 operations for a session and refuses a call more than 64 past the number it waits for, T1-go 2.4)', () => {
  const typed = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  it('keeps at most WINDOW_CALLS calls in flight, as it keeps at most the window of bytes: what is typed past that waits and goes together in the next call, in order, as a call is answered', async () => {
    expect(WINDOW_CALLS).toBeLessThan(64);
    const { feed, of, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    const keys = typed.slice(0, WINDOW_CALLS + 8);
    for (const key of keys) {
      feed.write(key);
    }

    expect(of('write')).toHaveLength(WINDOW_CALLS);
    pending('write')[0]?.resolve();
    await settle();
    expect(of('write')).toHaveLength(WINDOW_CALLS + 1);
    expect(of('write').at(-1)).toEqual(['term-1', WINDOW_CALLS + 1, btoa(keys.slice(WINDOW_CALLS))]);
  });

  it('loses nothing and repeats nothing when it waits: every key is in the calls, once, in the order it was typed, with consecutive numbers', async () => {
    const { feed, of, pending, numbered } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    const keys = Array.from({ length: 300 }, (_, key) => String.fromCharCode(97 + (key % 26))).join('');
    for (const key of keys) {
      feed.write(key);
    }

    // The list grows while it is walked: a call that goes out when one is answered is answered in its turn.
    for (const call of pending('write')) {
      call.resolve();
      await settle();
    }

    expect(of('write')).toHaveLength(WINDOW_CALLS + 1);
    expect(of('write').map(textOf).join('')).toBe(keys);
    expect(numbered().map(([, number]) => number)).toEqual(Array.from({ length: WINDOW_CALLS + 1 }, (_, index) => index + 1));
  });

  it('lets a size wait for room in the calls as it lets a key, and the newest size goes when a call is answered', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    for (const key of typed.slice(0, WINDOW_CALLS)) {
      feed.write(key);
    }

    feed.resize(100, 20);
    vi.advanceTimersByTime(10);
    feed.resize(110, 21);
    vi.advanceTimersByTime(10);
    expect(of('resize')).toEqual([]);
    pending('write')[0]?.resolve();
    await settle();
    expect(of('resize')).toEqual([['term-1', WINDOW_CALLS + 1, 21, 110]]);
  });
});

describe('what the user pastes', () => {
  it('goes in pieces of at most 64 KiB, each its own call with its own number, in order: one call of a megabyte is more than the host holds', async () => {
    expect(CHUNK_BYTES).toBe(64 * KIB);
    const { feed, of, numbered } = rig();
    await settle();
    const paste = pasteOf(200);
    feed.write(paste);
    const calls = of('write');
    expect(calls.map(sizeOf)).toEqual([64 * KIB, 64 * KIB, 64 * KIB, 8 * KIB]);
    expect(numbered()).toEqual([['write', 1], ['write', 2], ['write', 3], ['write', 4]]);
    expect(calls.map(textOf).join('')).toBe(paste);
  });

  it('is cut between characters, never in the middle of one: every piece decodes whole, whatever the width of the characters', async () => {
    for (const paste of ['€'.repeat(50_000), `a${'😀'.repeat(40_000)}`, '日本語 é 😀 '.repeat(20_000)]) {
      const { feed, of } = rig();
      await settle();
      feed.write(paste);
      const calls = of('write');
      expect(calls.length).toBeGreaterThan(1);
      for (const call of calls) {
        expect(sizeOf(call)).toBeLessThanOrEqual(CHUNK_BYTES);
      }

      expect(calls.map(textOf).join('')).toBe(paste);
    }
  });

  it('keeps at most the window of bytes in flight: the rest waits and follows as calls are answered, one more piece for each, in order', async () => {
    // The window protects the host's own bound on what it holds for a session (1 MiB); the order is kept by the numbers.
    expect(WINDOW_BYTES).toBeLessThan(1_048_576);
    expect(WINDOW_BYTES % CHUNK_BYTES).toBe(0);
    const { feed, of, pending, numbered } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    const paste = pasteOf(2_048);
    const pieces = paste.length / CHUNK_BYTES;
    const first = WINDOW_BYTES / CHUNK_BYTES;
    feed.write(paste);
    expect(of('write')).toHaveLength(first);
    for (let answered = 0; answered < pieces; answered += 1) {
      expect(of('write').slice(answered).reduce((sum, call) => sum + sizeOf(call), 0)).toBeLessThanOrEqual(WINDOW_BYTES);
      pending('write')[answered]?.resolve();
      await settle();
      expect(of('write')).toHaveLength(Math.min(pieces, first + answered + 1));
    }

    expect(numbered().map(([, number]) => number)).toEqual(Array.from({ length: pieces }, (_, index) => index + 1));
    expect(of('write').map(textOf).join('')).toBe(paste);
  });

  it('lets a key typed behind a paste that waits for room wait behind it: the order is the order of the typing', async () => {
    const { feed, of, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    const paste = pasteOf(2_048);
    feed.write(paste);
    feed.write('\r');
    expect(of('write')).toHaveLength(WINDOW_BYTES / CHUNK_BYTES);
    for (let answered = 0; answered < 33; answered += 1) {
      pending('write')[answered]?.resolve();
      await settle();
    }

    expect(of('write')).toHaveLength(33);
    expect(of('write').at(-1)).toEqual(['term-1', 33, btoa('\r')]);
    expect(of('write').slice(0, 32).map(textOf).join('')).toBe(paste);
  });

  it('does not stop a key that has room: a paste inside the window leaves the window open, and the key goes now with the next number', async () => {
    const { feed, of, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    feed.write(pasteOf(200));
    feed.write('x');
    expect(of('write')).toHaveLength(5);
    expect(of('write').at(-1)).toEqual(['term-1', 5, btoa('x')]);
  });

  it('lets a size go at once while the window is full: a size carries no bytes, and the window is about bytes; the pieces that wait are numbered after it, as they are sent', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.write(pasteOf(2_048));
    expect(of('write')).toHaveLength(WINDOW_BYTES / CHUNK_BYTES);
    feed.resize(100, 20);
    vi.advanceTimersByTime(10);
    expect(of('resize')).toEqual([['term-1', 9, 20, 100]]);
    pending('write')[0]?.resolve();
    await settle();
    expect(of('write')[WINDOW_BYTES / CHUNK_BYTES]?.[1]).toBe(10);
  });

  it('drops what waits when a piece is not taken: the session failed, and nothing of the paste is sent after that', async () => {
    const { feed, of, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await settle();
    feed.write(pasteOf(2_048));
    pending('write')[0]?.reject(new Error('Failed to write'));
    await settle();
    expect(feed.getSnapshot().state).toBe('failed');
    for (const call of pending('write').slice(1)) {
      call.resolve();
    }

    await settle();
    expect(of('write')).toHaveLength(WINDOW_BYTES / CHUNK_BYTES);
  });
});

describe('input the host refused for its backlog (INPUT_BACKLOG: not applied, and it took no number, T1-go 2.4)', () => {
  const backlog = (): Error => Object.assign(new Error('The terminal holds 256 operations or 1048576 bytes of input it has not applied yet. Send it again later.'), { code: 'INPUT_BACKLOG' });

  /** A session that runs; every call waits for the answer the test gives it. */
  const running = async (): Promise<Rig> => {
    const made = rig({ auto: false, settleMs: 10 });
    made.pending('create')[0]?.resolve();
    await settle();
    return made;
  };

  it('sends the same call again after a short delay, with the SAME number: the refusal consumed none, so nothing was lost and nothing is renumbered', async () => {
    const { feed, of, pending, warn } = await running();
    feed.write('a');
    pending('write')[0]?.reject(backlog());
    await settle();
    expect(of('write')).toHaveLength(1);
    vi.advanceTimersByTime(BACKLOG_RETRY_MS - 1);
    await settle();
    expect(of('write')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await settle();
    expect(of('write')).toEqual([['term-1', 1, btoa('a')], ['term-1', 1, btoa('a')]]);
    pending('write')[1]?.resolve();
    await settle();
    feed.write('b');
    expect(of('write').at(-1)).toEqual(['term-1', 2, btoa('b')]);
    expect(feed.getSnapshot()).toEqual({ state: 'running' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('goes on sending it again for as long as the host refuses it, each time with its number, and neither fails nor warns: a full queue is not a failure', async () => {
    const { feed, of, pending, warn } = await running();
    feed.write('a');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      pending('write')[attempt]?.reject(backlog());
      await settle();
      vi.advanceTimersByTime(BACKLOG_RETRY_MS);
      await settle();
    }

    expect(of('write')).toEqual(Array.from({ length: 6 }, () => ['term-1', 1, btoa('a')]));
    expect(feed.getSnapshot()).toEqual({ state: 'running' });
    expect(warn).not.toHaveBeenCalled();
    pending('write')[5]?.resolve();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets nothing else take the number meanwhile: what is typed while the call waits to be sent again goes at once with the next numbers, and the call keeps its own when it goes again', async () => {
    const { feed, of, pending } = await running();
    feed.write('a');
    pending('write')[0]?.reject(backlog());
    await settle();
    feed.write('b');
    feed.write('c');
    expect(of('write')).toEqual([['term-1', 1, btoa('a')], ['term-1', 2, btoa('b')], ['term-1', 3, btoa('c')]]);
    vi.advanceTimersByTime(BACKLOG_RETRY_MS);
    await settle();
    expect(of('write')).toHaveLength(4);
    expect(of('write').at(-1)).toEqual(['term-1', 1, btoa('a')]);
  });

  it('sends a size again with its number as well, and a newer size goes at once with the next number', async () => {
    const { feed, of, pending, warn } = await running();
    feed.resize(100, 20);
    vi.advanceTimersByTime(10);
    pending('resize')[0]?.reject(backlog());
    await settle();
    feed.resize(110, 21);
    vi.advanceTimersByTime(10);
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 21, 110]]);
    vi.advanceTimersByTime(BACKLOG_RETRY_MS);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 21, 110], ['term-1', 1, 20, 100]]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps a refused piece of a paste in the window until it is taken: its bytes still count and its number is kept, and the pieces after it use only the room the others leave', async () => {
    const { feed, of, pending, numbered } = await running();
    const full = WINDOW_BYTES / CHUNK_BYTES;
    feed.write(pasteOf(2_048));
    expect(of('write')).toHaveLength(full);
    pending('write')[0]?.reject(backlog());
    await settle();
    for (let index = 1; index < full; index += 1) {
      pending('write')[index]?.resolve();
    }

    await settle();
    expect(numbered().map(([, number]) => number)).toEqual(Array.from({ length: 2 * full - 1 }, (_, index) => index + 1));
    vi.advanceTimersByTime(BACKLOG_RETRY_MS);
    await settle();
    expect(numbered().at(-1)).toEqual(['write', 1]);
    expect(of('write')).toHaveLength(2 * full);
  });

  it('stops when the feed is closed: a call that waits to be sent again is not sent, and no timer is left', async () => {
    const { feed, of, pending } = await running();
    feed.write('a');
    pending('write')[0]?.reject(backlog());
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    const closing = feed.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * BACKLOG_RETRY_MS);
    await settle();
    expect(of('write')).toHaveLength(1);
    pending('close')[0]?.resolve();
    await closing;
  });

  it('is not asked to send a call again by a refusal that comes after the feed was closed: nothing is scheduled', async () => {
    const { feed, of, pending } = await running();
    feed.write('a');
    pending('write')[0]?.reject(backlog());
    await settle();
    vi.advanceTimersByTime(BACKLOG_RETRY_MS);
    await settle();
    feed.write('b');
    const closing = feed.close();
    pending('write')[1]?.reject(backlog());
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * BACKLOG_RETRY_MS);
    await settle();
    expect(of('write')).toHaveLength(3);
    pending('close')[0]?.resolve();
    await closing;
  });

  it('stops when the session ended: a call that waits to be sent again is not sent, and no timer is left', async () => {
    const { feed, of, pending, emit } = await running();
    feed.write('a');
    pending('write')[0]?.reject(backlog());
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    emit(signalEvent('term-1', 'CLOSE'), { reason: 'exited', exit_code: 0 });
    expect(feed.getSnapshot().state).toBe('ended');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * BACKLOG_RETRY_MS);
    await settle();
    expect(of('write')).toHaveLength(1);
  });

  it('is not asked to send a call again by a refusal that comes after the session ended: nothing is scheduled', async () => {
    const { feed, of, pending, emit } = await running();
    feed.write('a');
    pending('write')[0]?.reject(backlog());
    await settle();
    vi.advanceTimersByTime(BACKLOG_RETRY_MS);
    await settle();
    emit(signalEvent('term-1', 'CLOSE'), { reason: 'exited', exit_code: 0 });
    pending('write')[1]?.reject(backlog());
    await settle();
    expect(feed.getSnapshot().state).toBe('ended');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * BACKLOG_RETRY_MS);
    await settle();
    expect(of('write')).toHaveLength(2);
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
    expect(of('write')).toEqual([['term-1', 1, text('ls\r')]]);
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
    expect(of('resize')).toEqual([['term-1', 1, 20, 100]]);
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
    expect(of('resize')).toEqual([['term-1', 1, 20 + (49 % 7), 149]]);
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
    expect(of('resize')).toEqual([['term-1', 1, 20, 110]]);
  });

  it('sends every size that stood still AT ONCE, as its own call with the next number, and never waits for the answer of the call before it: nothing is held back and nothing is dropped', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    expect(of('resize')).toEqual([['term-1', 1, 20, 100]]);
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    feed.resize(120, 22);
    vi.advanceTimersByTime(20);
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 21, 110], ['term-1', 3, 22, 120]]);
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
    expect(of('resize')).toEqual([['term-1', 1, 20, 100]]);
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
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 20, 101]]);
  });

  it('sends a size again when it is measured again after the backend refused it, and not before: the host never had it, so it is not a duplicate of what the host has, and the refusal alone does not send it again', async () => {
    const { feed, of, pending, warn } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100]]);
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 20, 100]]);
  });

  it('forgets what the host has when it refuses a size: nothing is known of the size it holds then, so the size measured next is sent, whatever it is (the size the process started at included)', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    await settle();
    feed.resize(80, 24);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 24, 80]]);
  });

  it.each([
    { order: 'in the order they were sent', refused: [0, 1] },
    { order: 'in the opposite order', refused: [1, 0] },
  ])('sends a fresh measurement of the first size when two sizes went out and both were refused $order: the host holds neither of them, and the size before them is not what it has either', async ({ refused }) => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 21, 110]]);
    for (const call of refused) {
      pending('resize')[call]?.reject(new Error('Failed to resize'));
      await settle();
    }

    vi.advanceTimersByTime(1_000);
    await settle();
    expect(of('resize')).toHaveLength(2);
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 21, 110], ['term-1', 3, 20, 100]]);
  });

  it('still holds back the duplicate of a size the host took: only a refusal makes a size one to send again', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    pending('resize')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100]]);
  });

  it('keeps the newer size when an older one is refused after it went out: the refusal of the first does not make the second one to send again', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    await settle();
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 21, 110]]);
  });

  it('holds back the duplicate of a newer size the host took after an older one was refused: the host has the newer size, and a size measured again that is not it is sent', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    pending('resize')[1]?.resolve();
    await settle();
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toHaveLength(2);
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 21, 110], ['term-1', 3, 20, 100]]);
  });

  it('sends nothing once the feed was closed: the size that was still settling leaves with the session, and so does its timer', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    feed.resize(110, 21);
    const closing = feed.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100]]);
    pending('resize')[0]?.resolve();
    pending('close')[0]?.resolve();
    await closing;
  });

  it('does not send a refused size again: the call that was refused is not repeated, and the sizes that were sent after it are not held up by it', async () => {
    const { feed, of, pending, warn } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 21, 110]]);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    pending('resize')[1]?.reject(new Error('Failed to resize'));
    await settle();
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(of('resize')).toHaveLength(2);
  });

  it('says nothing of a size the backend refuses because the session is gone: the close that follows says what happened', async () => {
    const { feed, pending, warn } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    pending('resize')[0]?.reject(new Error('gone'));
    await settle();
    expect(warn).not.toHaveBeenCalled();
    expect(feed.getSnapshot()).toEqual({ state: 'running' });
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
    expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
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

/** Lets the promises of the feed settle, a chain of calls deep. */
const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 40; turn += 1) {
    await Promise.resolve();
  }
};

const SESSION = { id: 'term-1', pid: 4242, shell: { path: '/bin/zsh', name: 'zsh' }, cwd: '/home/u', cols: 80, rows: 24 };

describe('flow control: acknowledging what the screen took in (the host\'s contract, T1-go 2.8.6)', () => {
  it('turns the backend\'s flow control on as soon as the process exists, with the first acknowledgement (nothing taken in yet), before anybody reads a byte: a terminal that nobody reads is paced from its first prompt', async () => {
    const { of } = rig();
    await flush();
    expect(of('ack')).toEqual([['term-1', 0]]);
  });

  it('does not acknowledge before the process exists: a session that is still starting has no flow to turn on, and a start that failed never turns one on', async () => {
    const started = rig({ auto: false });
    expect(started.of('ack')).toEqual([]);
    started.pending('create')[0]?.resolve();
    await flush();
    expect(started.of('ack')).toEqual([['term-1', 0]]);
    const failed = rig({ auto: false });
    failed.pending('create')[0]?.reject(new Error('no'));
    await flush();
    expect(failed.of('ack')).toEqual([]);
  });

  it('passes on the bytes the reader says it parsed, as the count it was given, once the first call is out', async () => {
    const { feed, of } = rig();
    await flush();
    feed.ack(65_536);
    await flush();
    expect(of('ack')).toEqual([['term-1', 0], ['term-1', 65_536]]);
  });

  it('keeps ONE acknowledgement in flight and sends what was parsed meanwhile as the sum, in the next call: every byte once, none twice, and no burst of calls for a flood', async () => {
    const { feed, of, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await flush();
    feed.ack(100);
    feed.ack(200);
    feed.ack(300);
    expect(of('ack')).toEqual([['term-1', 0]]);
    pending('ack')[0]?.resolve();
    await flush();
    expect(of('ack')).toEqual([['term-1', 0], ['term-1', 600]]);
    feed.ack(7);
    expect(of('ack')).toHaveLength(2);
    pending('ack')[1]?.resolve();
    await flush();
    expect(of('ack')).toEqual([['term-1', 0], ['term-1', 600], ['term-1', 7]]);
    pending('ack')[2]?.resolve();
    await flush();
    expect(of('ack')).toHaveLength(3);
  });

  it('puts what was parsed before the first call went out in that call: output that came while the process was starting', async () => {
    const { feed, of, pending } = rig({ auto: false });
    feed.ack(50);
    expect(of('ack')).toEqual([]);
    pending('create')[0]?.resolve();
    await flush();
    expect(of('ack')).toEqual([['term-1', 50]]);
  });

  it('sends nothing for a count that is not a positive whole number of bytes, and floors one that is not whole', async () => {
    const { feed, of } = rig();
    await flush();
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
      feed.ack(bad);
    }

    await flush();
    expect(of('ack')).toEqual([['term-1', 0]]);
    feed.ack(2.9);
    await flush();
    expect(of('ack')).toEqual([['term-1', 0], ['term-1', 2]]);
  });

  it('stops when the session is over: an ended or a failed process has no flow to credit, and a count that comes later is not sent', async () => {
    const ended = rig();
    await flush();
    ended.emit(signalEvent('term-1', 'CLOSE'), { reason: 'exited', exit_code: 0 });
    ended.feed.ack(10);
    await flush();
    expect(ended.of('ack')).toEqual([['term-1', 0]]);
    const failed = rig();
    await flush();
    failed.emit(signalEvent('term-1', 'ERROR'), 'it broke');
    failed.feed.ack(10);
    await flush();
    expect(failed.of('ack')).toEqual([['term-1', 0]]);
  });

  it('stops when the feed was closed: nothing is sent for a count that comes after the close', async () => {
    const { feed, of } = rig();
    await flush();
    await feed.close();
    feed.ack(10);
    await flush();
    expect(of('ack')).toEqual([['term-1', 0]]);
  });

  it('does not hold the session up when the backend refuses a count: the bytes stay owed and go with the next call, and the refusal is said once', async () => {
    const { feed, of, pending, warn } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await flush();
    pending('ack')[0]?.resolve();
    await flush();
    feed.ack(10);
    pending('ack')[1]?.reject(new Error('boom'));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('acknowledg');
    feed.ack(5);
    expect(of('ack')).toEqual([['term-1', 0], ['term-1', 10], ['term-1', 15]]);
    pending('ack')[2]?.reject(new Error('boom again'));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot()).toEqual({ state: 'running' });
  });

  it('lets a refusal that says the session is gone go quietly: nothing runs to credit, and nothing more is sent', async () => {
    const { feed, of, pending, warn } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await flush();
    pending('ack')[0]?.reject(new Error('gone'));
    await flush();
    feed.ack(5);
    await flush();
    expect(of('ack')).toEqual([['term-1', 0]]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('gives up quietly when the host will not turn its flow control on (a host that has none, a first call that failed): its transport\'s credit paces the shell, and no call is made for every byte parsed after that', async () => {
    const { feed, of, pending, warn } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await flush();
    pending('ack')[0]?.reject(new Error('unsupported'));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('flow control');
    for (let count = 0; count < 20; count += 1) {
      feed.ack(1_000);
    }

    await flush();
    expect(of('ack')).toEqual([['term-1', 0]]);
    expect(feed.getSnapshot()).toEqual({ state: 'running' });
  });

  describe('a count the host refused goes again by itself: it may be the credit the host paused the shell for, and then no more output comes to carry it', () => {
    const refusal = (): Error => new Error('boom');

    /** A session that runs, with its flow control on (the first call answered); every later call waits for the answer the test gives it. */
    const flowing = async (): Promise<Rig> => {
      const made = rig({ auto: false });
      made.pending('create')[0]?.resolve();
      await flush();
      made.pending('ack')[0]?.resolve();
      await flush();
      return made;
    };

    it('sends the refused count again after ACK_RETRY_MS, with no output and no call of the reader, and then leaves nothing to wait for once the host takes it', async () => {
      const { feed, of, pending, warn } = await flowing();
      feed.ack(10);
      pending('ack')[1]?.reject(refusal());
      await flush();
      expect(of('ack')).toEqual([['term-1', 0], ['term-1', 10]]);
      vi.advanceTimersByTime(ACK_RETRY_MS - 1);
      await flush();
      expect(of('ack')).toHaveLength(2);
      vi.advanceTimersByTime(1);
      await flush();
      expect(of('ack')).toEqual([['term-1', 0], ['term-1', 10], ['term-1', 10]]);
      pending('ack')[2]?.resolve();
      await flush();
      vi.advanceTimersByTime(10 * ACK_RETRY_MS);
      await flush();
      expect(of('ack')).toHaveLength(3);
      expect(vi.getTimerCount()).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('goes on until the host takes it, one call and one wait at a time: each refusal waits again, the count that was refused is the one that goes, and the refusal is said once', async () => {
      const { feed, of, pending, warn } = await flowing();
      feed.ack(10);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        pending('ack')[attempt]?.reject(refusal());
        await flush();
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(ACK_RETRY_MS);
        await flush();
        // The call is out, and nothing waits meanwhile.
        expect(of('ack')).toHaveLength(attempt + 2);
        expect(vi.getTimerCount()).toBe(0);
      }

      expect(of('ack').slice(1).map((call) => call[1])).toEqual([10, 10, 10, 10, 10]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(feed.getSnapshot()).toEqual({ state: 'running' });
    });

    it('sends what the reader parsed meanwhile with it, at once: that call stands in for the wait, so there is never more than one wait, and none while a call is out', async () => {
      const { feed, of, pending } = await flowing();
      feed.ack(10);
      pending('ack')[1]?.reject(refusal());
      await flush();
      expect(vi.getTimerCount()).toBe(1);
      feed.ack(5);
      expect(of('ack').at(-1)).toEqual(['term-1', 15]);
      expect(vi.getTimerCount()).toBe(0);
      pending('ack')[2]?.reject(refusal());
      await flush();
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(ACK_RETRY_MS);
      await flush();
      expect(of('ack')).toEqual([['term-1', 0], ['term-1', 10], ['term-1', 15], ['term-1', 15]]);
    });

    it('stops when the feed is closed: the count that waits is not sent, and no timer is left', async () => {
      const { feed, of, pending } = await flowing();
      feed.ack(10);
      pending('ack')[1]?.reject(refusal());
      await flush();
      expect(vi.getTimerCount()).toBe(1);
      const closing = feed.close();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10 * ACK_RETRY_MS);
      await flush();
      expect(of('ack')).toHaveLength(2);
      pending('close')[0]?.resolve();
      await closing;
    });

    it('is not asked to wait by a refusal that comes after the feed was closed: nothing is scheduled', async () => {
      const { feed, of, pending } = await flowing();
      feed.ack(10);
      const closing = feed.close();
      pending('ack')[1]?.reject(refusal());
      await flush();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10 * ACK_RETRY_MS);
      await flush();
      expect(of('ack')).toHaveLength(2);
      pending('close')[0]?.resolve();
      await closing;
    });

    it('stops when the session ended: the count that waits is not sent, and no timer is left', async () => {
      const { feed, of, pending, emit } = await flowing();
      feed.ack(10);
      pending('ack')[1]?.reject(refusal());
      await flush();
      expect(vi.getTimerCount()).toBe(1);
      emit(signalEvent('term-1', 'CLOSE'), { reason: 'exited', exit_code: 0 });
      expect(feed.getSnapshot().state).toBe('ended');
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10 * ACK_RETRY_MS);
      await flush();
      expect(of('ack')).toHaveLength(2);
    });

    it('is not asked to wait by a refusal that comes after the session ended: nothing is scheduled', async () => {
      const { feed, of, pending, emit } = await flowing();
      feed.ack(10);
      emit(signalEvent('term-1', 'CLOSE'), { reason: 'exited', exit_code: 0 });
      pending('ack')[1]?.reject(refusal());
      await flush();
      expect(feed.getSnapshot().state).toBe('ended');
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10 * ACK_RETRY_MS);
      await flush();
      expect(of('ack')).toHaveLength(2);
    });

    it('stops when the host says the session is gone: the call that was refused so is the last, and no timer is left', async () => {
      const { feed, of, pending, warn } = await flowing();
      feed.ack(10);
      pending('ack')[1]?.reject(refusal());
      await flush();
      vi.advanceTimersByTime(ACK_RETRY_MS);
      await flush();
      expect(of('ack')).toHaveLength(3);
      pending('ack')[2]?.reject(new Error('gone'));
      await flush();
      expect(vi.getTimerCount()).toBe(0);
      feed.ack(5);
      vi.advanceTimersByTime(10 * ACK_RETRY_MS);
      await flush();
      expect(of('ack')).toHaveLength(3);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('makes no wait for a first call the host refused: a host that would not turn its flow control on is not asked again', async () => {
      const { of, pending } = rig({ auto: false });
      pending('create')[0]?.resolve();
      await flush();
      pending('ack')[0]?.reject(refusal());
      await flush();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10 * ACK_RETRY_MS);
      await flush();
      expect(of('ack')).toEqual([['term-1', 0]]);
    });
  });
});

describe('what the feed holds for a reader that is not reading', () => {
  it('holds all of it and drops nothing: the backend\'s pacing is the bound, so a reader that comes late reads every byte, in order', () => {
    const { feed, emit } = rig();
    for (let index = 0; index < 300; index += 1) {
      emit(streamEvent('term-1', 'stdout'), text(String(index).padStart(4, '0').repeat(256)));
    }

    const read = feed.read();
    expect(read.chunks).toHaveLength(300);
    expect(read.bytes).toBe(300 * 1_024);
    // Every chunk is the one that came at its place: one that was lost, repeated or moved in the middle is seen, and not only at the ends.
    const markers = read.chunks.map((chunk) => new TextDecoder().decode(chunk).slice(0, 4));
    expect(markers).toEqual(Array.from({ length: 300 }, (_, index) => String(index).padStart(4, '0')));
  });
});

describe('the shell the host started', () => {
  it('is named by what the host answered to the call that started it: the shell\'s own name', async () => {
    const { feed } = rig({ created: SESSION });
    await flush();
    expect(feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh' });
  });

  it('trims the name and says nothing of a program when the answer names none (a backend that does not say, an answer that is not what was asked for)', async () => {
    const named = rig({ created: { shell: { name: '  bash ' } } });
    await flush();
    expect(named.feed.getSnapshot()).toEqual({ state: 'running', program: 'bash' });
    for (const answer of [undefined, null, 'zsh', 42, {}, { shell: null }, { shell: {} }, { shell: { name: '' } }, { shell: { name: '   ' } }, { shell: { name: 7 } }]) {
      const none = rig({ created: answer });
      await flush();
      expect(none.feed.getSnapshot()).toEqual({ state: 'running' });
    }
  });
});

describe('the end of the process, typed (the host\'s contract, T1-go 2.2)', () => {
  const closeWith = async (payload: unknown) => {
    const r = rig();
    await flush();
    r.emit(signalEvent('term-1', 'CLOSE'), payload);
    return r;
  };

  it('says the exit code of a shell that exited, zero included', async () => {
    expect((await closeWith({ reason: 'exited', exit_code: 3 })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 3 } });
    expect((await closeWith({ reason: 'exited', exit_code: 0 })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 0 } });
  });

  it('says the signal that killed it, with its number and a core dump', async () => {
    expect((await closeWith({ reason: 'signaled', signal: 'SIGTERM', signal_number: 15 })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { signal: 'SIGTERM', signalNumber: 15 } });
    expect((await closeWith({ reason: 'signaled', signal: 'SIGSEGV', signal_number: 11, core_dumped: true })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { signal: 'SIGSEGV', signalNumber: 11, coreDumped: true } });
  });

  it('says who closed what the host ended: a close that was asked for, its window, the host quitting', async () => {
    for (const closedBy of ['request', 'window', 'shutdown'] as const) {
      expect((await closeWith({ reason: 'closed', closed_by: closedBy })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { closedBy } });
    }
  });

  it('says what the host did when a program kept the terminal open after the shell exited: it stopped reading, and dropped what it read after that', async () => {
    expect((await closeWith({ reason: 'exited', exit_code: 0, drain_capped: true, dropped_bytes: 4_096 })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 0, drainCapped: true, droppedBytes: 4_096 } });
    expect((await closeWith({ reason: 'exited', exit_code: 1, drain_capped: true })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 1, drainCapped: true } });
  });

  it('says nothing of how a process ended when it does not know the reason, a capped drain included: a plain end, with no exit and so no drain line (the notice belongs to an exit the page recognises)', async () => {
    for (const payload of [
      { reason: 'vanished', drain_capped: true, dropped_bytes: 4_096 },
      { reason: 'vanished', drain_capped: true },
      { drain_capped: true, dropped_bytes: 10 },
      { reason: 7, drain_capped: true },
    ]) {
      expect((await closeWith(payload)).feed.getSnapshot()).toEqual({ state: 'ended' });
    }
  });

  it('keeps the drain notice of every exit the page recognises: a process that was signaled, a close the host made, and a shell that exited with nothing more said of it', async () => {
    expect((await closeWith({ reason: 'signaled', signal: 'SIGHUP', signal_number: 1, drain_capped: true, dropped_bytes: 8 })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { signal: 'SIGHUP', signalNumber: 1, drainCapped: true, droppedBytes: 8 } });
    expect((await closeWith({ reason: 'closed', closed_by: 'request', drain_capped: true })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { closedBy: 'request', drainCapped: true } });
    expect((await closeWith({ reason: 'exited', drain_capped: true, dropped_bytes: 5 })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { drainCapped: true, droppedBytes: 5 } });
  });

  it('is a failed session when the pty or the wait failed, in the system\'s words: that is not an exit', async () => {
    const r = await closeWith({ reason: 'failed', failure: { stage: 'pty', message: 'input/output error' } });
    expect(r.feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'input/output error' } });
    expect(r.listeners()).toBe(0);
  });

  it('is an end all the same when the page cannot read what it was told (the older text, nothing, a reason it does not know, a code that is not a number): ended, and nothing is said of how', async () => {
    for (const payload of [text('Session terminated'), undefined, null, {}, { reason: 'vanished' }, { reason: 'exited' }, { reason: 'exited', exit_code: 'three' }, { reason: 'exited', exit_code: Number.NaN }, { reason: 'signaled' }, { reason: 'closed', closed_by: 'someone' }]) {
      const r = await closeWith(payload);
      const status = r.feed.getSnapshot();
      expect(status.state).toBe('ended');
      expect(status.exit).toBeUndefined();
    }

    // A failure the host reports is not an end the page cannot read: it is a failed session, with no words when it carries none.
    expect((await closeWith({ reason: 'failed' })).feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: '' } });
  });

  it('lets go of every listener on a typed end, and keeps what the process wrote before it exited readable', async () => {
    const r = rig();
    await flush();
    r.emit(streamEvent('term-1', 'stdout'), text('bye\r\n'));
    r.emit(signalEvent('term-1', 'CLOSE'), { reason: 'exited', exit_code: 3 });
    expect(r.listeners()).toBe(0);
    expect(r.feed.read().chunks.map((chunk) => [...chunk])).toEqual([bytes('bye\r\n')]);
  });
});

describe('what runs in the session (IsBusy, the host\'s contract, T1-go 2.3)', () => {
  it('asks the backend, by the session\'s id, and answers idle when only the shell holds the terminal', async () => {
    const { feed, of } = rig({ busy: { state: 'idle' } });
    await flush();
    expect(await feed.busy?.()).toEqual({ state: 'idle' });
    expect(of('busy')).toEqual([['term-1']]);
  });

  it('names the program that does, and says busy with no name when the platform gave none', async () => {
    const named = rig({ busy: { state: 'busy', pgid: 812, name: 'sleep' } });
    await flush();
    expect(await named.feed.busy?.()).toEqual({ state: 'busy', name: 'sleep' });
    for (const answer of [{ state: 'busy', pgid: 812 }, { state: 'busy', pgid: 812, name: '' }, { state: 'busy', pgid: 812, name: 4 }]) {
      const r = rig({ busy: answer });
      await flush();
      expect(await r.feed.busy?.()).toEqual({ state: 'busy' });
    }
  });

  it('answers unknown when the backend cannot tell, whatever its reason, and for an answer it does not understand', async () => {
    for (const answer of [{ state: 'unknown', reason: 'query-failed' }, { state: 'unknown', reason: 'unsupported' }, { state: 'unknown', reason: 'remote' }, { state: 'unknown' }, undefined, null, 'idle', {}, { state: 'resting' }]) {
      const r = rig({ busy: answer });
      await flush();
      expect(await r.feed.busy?.()).toEqual({ state: 'unknown' });
    }
  });

  it('answers unknown when the question fails: a question that is not answered is not "nothing runs", and a close asks', async () => {
    const { feed, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await flush();
    const asked = feed.busy?.();
    pending('busy')[0]?.reject(new Error('boom'));
    expect(await asked).toEqual({ state: 'unknown' });
  });

  it('answers idle for a session the backend says is gone: nothing runs in it', async () => {
    const { feed, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await flush();
    const asked = feed.busy?.();
    pending('busy')[0]?.reject(new Error('gone'));
    expect(await asked).toEqual({ state: 'idle' });
  });

  it('asks nothing of a session that is not running (starting, ended, failed, closed): nothing runs in it', async () => {
    const starting = rig({ auto: false });
    expect(await starting.feed.busy?.()).toEqual({ state: 'idle' });
    const ended = rig({ busy: { state: 'busy', name: 'sleep' } });
    await flush();
    ended.emit(signalEvent('term-1', 'CLOSE'), { reason: 'exited', exit_code: 0 });
    expect(await ended.feed.busy?.()).toEqual({ state: 'idle' });
    const closed = rig({ busy: { state: 'busy', name: 'sleep' } });
    await flush();
    await closed.feed.close();
    expect(await closed.feed.busy?.()).toEqual({ state: 'idle' });
    expect([...starting.of('busy'), ...ended.of('busy'), ...closed.of('busy')]).toEqual([]);
  });
});

describe('a start the backend refused, by its code', () => {
  const refusal = (message: string, code?: string): Error => Object.assign(new Error(message), code === undefined ? {} : { code });

  it('keeps the typed code beside the words: the words are the backend\'s, the code is what the host reads (no shell could be started)', async () => {
    const { feed, pending } = rig({ auto: false });
    pending('create')[0]?.reject(refusal('shell executable unavailable: tried /bin/zsh: not found; /bin/bash: not found', 'SHELL_UNAVAILABLE'));
    await flush();
    expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'start', message: 'shell executable unavailable: tried /bin/zsh: not found; /bin/bash: not found', code: 'SHELL_UNAVAILABLE' } });
  });

  it('has no code for a refusal that has none, and never reads one out of the words', async () => {
    const { feed, pending } = rig({ auto: false });
    pending('create')[0]?.reject(refusal('SHELL_UNAVAILABLE: this reads like a code and is not one'));
    await flush();
    expect(feed.getSnapshot().cause?.code).toBeUndefined();
  });

  it('keeps the code of what was typed and could not be delivered, too', async () => {
    const { feed, pending } = rig({ auto: false });
    pending('create')[0]?.resolve();
    await flush();
    feed.write('x');
    pending('write')[0]?.reject(refusal('Sequence number 1 was already applied or given up; the next expected is 2.', 'SEQUENCE_STALE'));
    await flush();
    expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'input', message: 'Sequence number 1 was already applied or given up; the next expected is 2.', code: 'SEQUENCE_STALE' } });
  });
});

describe('input while the host has paused the shell for credit (T1-go 2.8.6)', () => {
  it('goes at once and carries its number: the credit is about the output, and a key typed in a flood (Ctrl+C) waits for nothing', async () => {
    const host = fakeCreditHost();
    const feed = createExecFeed({ transport: host.transport, newId: () => 'term-1', settleMs: 10, warn: () => undefined });
    feed.resize(80, 24);
    await flush();
    host.produce(5 * 1_048_576);
    expect(host.paused()).toBe(true);
    feed.write('\u0003');
    feed.resize(100, 30);
    vi.advanceTimersByTime(10);
    feed.write('ls\r');
    expect(host.inputs()).toEqual([
      { kind: 'write', seq: 1, text: '\u0003' },
      { kind: 'resize', seq: 2, rows: 30, cols: 100 },
      { kind: 'write', seq: 3, text: 'ls\r' },
    ]);
  });
});

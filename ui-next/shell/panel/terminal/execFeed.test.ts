import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ACK_RETRY_MS, BACKLOG_RETRY_MS, CHUNK_BYTES, WINDOW_BYTES, WINDOW_CALLS, createExecFeed, listedOf, signalEvent, streamEvent, type ExecFeed, type ExecLaunch, type ExecTransport } from './execFeed';
import type { TerminalFeedHandle, TerminalReplay, TerminalShellAttempt } from './feed';
import { fakeCreditHost } from './testing';

// The session of a pty as the host holds it, against a transport the test drives: what `ExecClient` and the Wails events are, as far as the feed is concerned. The feed is where the rules of a terminal's
// wire live (docs/ui-next/optimisations.md HLT-25 to HLT-28, HGO-34 to HGO-36): the listeners are in place BEFORE the process starts and are all released, output is held as it came and read at the reader's
// pace, input goes out at once and the host puts it in order by the number every call carries (docs/ui-next/status/T1-go.md 2.4: one counter for the writes and the sizes, a paste in pieces under a window, a call
// the host refused for its backlog sent again with its number), the size is settled (one message for a size that stood still, rows before columns), and a close ends the process exactly once.

type Deferred = { readonly resolve: (value?: unknown) => void; readonly reject: (error: unknown) => void };

type Kind = 'create' | 'write' | 'resize' | 'close' | 'ack' | 'busy' | 'list' | 'attach' | 'detach';

type Rig = {
  readonly feed: ExecFeed;
  readonly calls: string[];
  /** The calls of one kind, with their arguments. */
  readonly of: (kind: Kind) => unknown[][];
  /** Delivers an event to its listeners, as Wails does. */
  readonly emit: (name: string, data: unknown) => void;
  /** Listeners alive now, over all names, or on one. */
  readonly listeners: (name?: string) => number;
  /** The calls whose answer the test has not given yet. */
  readonly pending: (kind: Kind) => Deferred[];
  /** The kind and the number of every input call, in the order the transport was called: the counter the host puts the calls in order by. */
  readonly numbered: () => ReadonlyArray<readonly ['write' | 'resize', number]>;
  /** What each call that starts a process was given besides the size, in order. */
  readonly launches: ReadonlyArray<ExecLaunch | undefined>;
  readonly warn: Mock<(message: string, error?: unknown) => void>;
  readonly wakes: () => number;
};

const text = (value: string): string => btoa(value);
const bytes = (value: string): number[] => [...new TextEncoder().encode(value)];

/** The page key the rigs give a feed that has one: 36 visible characters, as a UUID is. */
const KEY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** The modes of a terminal that has switched nothing on, as the host states them. */
const PLAIN_MODES = { known: true, alt_screen: false, bracketed_paste: false, application_cursor: false, focus_events: false, cursor_hidden: false, mouse_tracking: 0, mouse_encoding: 0, kitty_keyboard: [] as number[] };

type AttachedOptions = {
  /** What the host kept: the bytes of [start, start + data.length). */
  readonly data?: string;
  readonly start?: number;
  /** Where the live output continues; default: the end of `data`. */
  readonly end?: number;
  readonly attachment?: number;
  readonly shell?: string;
  readonly ended?: unknown;
  /** The number the terminal's input queue takes next. Default: 1 for a terminal that runs, 0 for one that ended. Not a number when a test says what the host must not say. */
  readonly nextInputSeq?: unknown;
  readonly size?: { readonly cols: number; readonly rows: number };
  readonly startSize?: { readonly cols: number; readonly rows: number };
  readonly modes?: Partial<typeof PLAIN_MODES>;
  readonly startModes?: Partial<typeof PLAIN_MODES>;
};

/**
 * What `AttachTerminal` answers (`terminal.Attached`, T2-go 2.2). `next_input_seq` is the number the terminal's input queue takes next (host #675): at least 1 for a terminal that runs, 0 for one that ended, which takes no
 * input. `nextInputSeq` says another number; the member is left out with `without(answer, 'next_input_seq')`.
 */
function attached(options: AttachedOptions = {}): Record<string, unknown> {
  const data = options.data ?? '';
  const start = options.start ?? 0;
  return {
    session: { id: 'term-1', pid: 4242, shell: { path: `/bin/${options.shell ?? 'zsh'}`, name: options.shell ?? 'zsh' }, cwd: '/home/u', cols: 80, rows: 24, lease_ms: 300_000 },
    replay: {
      start,
      end: options.end ?? start + data.length,
      data: btoa(data),
      start_size: options.startSize ?? { cols: 80, rows: 24 },
      start_modes: { ...PLAIN_MODES, ...options.startModes },
      size: options.size ?? { cols: 80, rows: 24 },
      modes: { ...PLAIN_MODES, ...options.modes },
    },
    cwd: { path: '/home/u' },
    busy: { state: 'idle' },
    attachment: options.attachment ?? 1,
    ...(options.ended === undefined ? {} : { ended: options.ended }),
    next_input_seq: Object.hasOwn(options, 'nextInputSeq') ? options.nextInputSeq : options.ended === undefined ? 1 : 0,
  };
}

/** An answer without one of its members. */
const without = (answer: Record<string, unknown>, member: string): Record<string, unknown> => Object.fromEntries(Object.entries(answer).filter(([name]) => name !== member));

/** An output event of a terminal that has a key (T2-go 2.3): where its bytes lie in the terminal's output, and the bytes as base64. */
const output = (offset: number, value: string): { readonly offset: number; readonly data: string } => ({ offset, data: btoa(value) });

const OUTPUT = streamEvent('term-1', 'output');
const DETACHED = signalEvent('term-1', 'DETACHED');
const CLOSE = signalEvent('term-1', 'CLOSE');

/** What a reader gets of the feed's output, as text. */
const readText = (feed: TerminalFeedHandle, max?: number): string => feed.read(max).chunks.map((chunk) => new TextDecoder().decode(chunk)).join('');

/** The replay a feed gives, or a failure of the test when it gives none. */
function replayOf(feed: TerminalFeedHandle): TerminalReplay {
  const replay = feed.takeReplay?.();
  if (replay === undefined) {
    throw new Error('the feed has no replay to give');
  }

  return replay;
}

type RigOptions = {
  readonly auto?: boolean;
  readonly settleMs?: number;
  readonly gone?: (error: unknown) => boolean;
  readonly size?: false | { readonly cols: number; readonly rows: number };
  /** What the backend answers to the call that starts the process (the host answers with the session it made). */
  readonly created?: unknown;
  /** What the backend answers to the question of what runs in the session. */
  readonly busy?: unknown;
  /** The page's key: the feed is keyed, and its terminal outlives the page (T2-go). */
  readonly pageKey?: string;
  /** Takes over the terminal of this id instead of starting one (the key is `KEY` when the test gives none). The view has not measured: nothing is sent until the test sizes it. */
  readonly attach?: { readonly id: string; readonly program?: string };
  /** What the backend answers to the call that takes a terminal over. Default: an answer with no output yet. */
  readonly attached?: unknown;
};

function rig(options: RigOptions = {}): Rig {
  const calls: string[] = [];
  const log: Record<string, unknown[][]> = { create: [], write: [], resize: [], close: [], ack: [], busy: [], list: [], attach: [], detach: [] };
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const waiting: Record<string, Deferred[]> = { create: [], write: [], resize: [], close: [], ack: [], busy: [], list: [], attach: [], detach: [] };
  const auto = options.auto ?? true;
  const numbered: Array<readonly ['write' | 'resize', number]> = [];
  const launches: Array<ExecLaunch | undefined> = [];
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
    create: async (id, size, launch) => {
      launches.push(launch);
      return answer('create', [id, size.cols, size.rows], options.created);
    },
    list: async (key) => answer('list', [key]),
    attach: async (id, request) => answer('attach', [id, request], Object.hasOwn(options, 'attached') ? options.attached : attached()),
    detach: async (id, request) => answer('detach', [id, request]),
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
    triedOf: (error) => {
      const tried: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'tried') : undefined;
      return Array.isArray(tried) ? (tried as TerminalShellAttempt[]) : undefined;
    },
  };
  const warn = vi.fn<(message: string, error?: unknown) => void>();
  const common = { transport, newId: () => 'term-1', warn, ...(options.settleMs === undefined ? {} : { settleMs: options.settleMs }) };
  let feed: ExecFeed;
  if (options.attach !== undefined) {
    feed = createExecFeed({ ...common, pageKey: options.pageKey ?? KEY, attach: options.attach });
  } else if (options.pageKey !== undefined) {
    feed = createExecFeed({ ...common, pageKey: options.pageKey });
  } else {
    feed = createExecFeed(common);
  }

  let woken = 0;
  feed.subscribe(() => {
    woken += 1;
  });
  // The view measuring itself, as the body does when it mounts: the process starts at that size (`size: false` is a view that has not measured). A terminal that is taken over is already there: nothing is sized unless the test says.
  const size = options.size === false ? undefined : (options.size ?? (options.attach === undefined ? { cols: 80, rows: 24 } : undefined));
  if (size !== undefined) {
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
    launches,
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

// ---- T2b: a terminal that outlives its page (docs/ui-next/status/T2-go.md, sections 2.1 to 2.5) ---------------------------------------------------------------------------------------------------------------

describe('a terminal that has a key: it outlives the page that started it (T2-go 2.1)', () => {
  it('gives the key to the transport with the call that starts the process, beside the size, and a feed that has none gives nothing at all: it starts as it always did', () => {
    const keyed = rig({ pageKey: KEY });
    expect(keyed.launches).toEqual([{ pageKey: KEY }]);
    expect(keyed.of('create')).toEqual([['term-1', 80, 24]]);
    expect(rig().launches).toEqual([undefined]);
  });

  it('listens to the three events of a keyed terminal BEFORE it starts the process: its output with offsets, its end, and the loss of it (the host sends no plain stream for it)', () => {
    const { calls } = rig({ pageKey: KEY });
    const first = calls.indexOf('create');
    expect(first).toBeGreaterThan(0);
    expect(calls.slice(0, first).sort()).toEqual(['on core/exec/signal/CLOSE/term-1', 'on core/exec/signal/DETACHED/term-1', 'on core/exec/stream/output/term-1']);
  });

  it('lets go of all three when it is closed', async () => {
    const { feed, listeners, calls } = rig({ pageKey: KEY });
    await settle();
    await feed.close();
    expect(listeners()).toBe(0);
    expect(calls.filter((call) => call.startsWith('off ')).sort()).toEqual(['off core/exec/signal/CLOSE/term-1', 'off core/exec/signal/DETACHED/term-1', 'off core/exec/stream/output/term-1']);
  });

  it('names the events as the host does (backend/pkg/plugin/exec/terminal.go)', () => {
    expect(streamEvent('term-1', 'output')).toBe('core/exec/stream/output/term-1');
    expect(signalEvent('term-1', 'DETACHED')).toBe('core/exec/signal/DETACHED/term-1');
  });

  it('numbers its input from 1 once the process exists, as a feed that started the terminal always did', async () => {
    const { feed, of } = rig({ pageKey: KEY });
    await settle();
    feed.write('ls');
    expect(of('write')).toEqual([['term-1', 1, btoa('ls')]]);
  });

  it('has `leave` and no `takeReplay` when it started the terminal; a feed with no key has neither', () => {
    expect(typeof rig({ pageKey: KEY }).feed.leave).toBe('function');
    expect(rig({ pageKey: KEY }).feed.takeReplay).toBeUndefined();
    expect(rig().feed.leave).toBeUndefined();
    expect(rig().feed.takeReplay).toBeUndefined();
  });

  it('never puts the key in what it says: not in the status of a session that failed, not in a warning', async () => {
    const { feed, emit, pending, warn } = rig({ pageKey: KEY, auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await flush();
    emit(OUTPUT, output(0, 'abc'));
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    pending('ack')[0]?.resolve();
    await flush();
    feed.ack(3);
    pending('ack')[1]?.reject(new Error('refused'));
    await flush();
    emit(OUTPUT, output(50, 'gap'));
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify([warn.mock.calls, feed.getSnapshot()])).not.toContain(KEY);
  });
});

describe('the output of a terminal that has a key, joined by offset (T2-go 2.3, 2.4 rules 5 and 6)', () => {
  it('applies each event at the offset the feed has reached, in order, and reads it as bytes, once', () => {
    const { feed, emit } = rig({ pageKey: KEY });
    emit(OUTPUT, output(0, 'hello '));
    emit(OUTPUT, output(6, 'world'));
    const read = feed.read();
    expect(read.chunks.map((chunk) => [...chunk])).toEqual([bytes('hello '), bytes('world')]);
    expect(read.bytes).toBe(11);
    expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
  });

  it('does not listen to the plain output stream: a keyed terminal has none, and a byte taken from both would be applied twice', () => {
    const { feed, emit } = rig({ pageKey: KEY });
    emit(streamEvent('term-1', 'stdout'), text('plain'));
    emit(streamEvent('term-1', 'stderr'), text('plain'));
    expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
  });

  it('keeps what arrives before the host has answered: the first prompt may come before the call returns', async () => {
    const { feed, emit, pending } = rig({ pageKey: KEY, auto: false });
    emit(OUTPUT, output(0, 'prompt $ '));
    expect(feed.getSnapshot().state).toBe('starting');
    pending('create')[0]?.resolve();
    await settle();
    expect(readText(feed)).toBe('prompt $ ');
  });

  it('drops an event whose bytes it already has, whenever it comes, and neither holds it, wakes anybody for it, nor lets it be read: a duplicate is not output', () => {
    const { feed, emit, wakes } = rig({ pageKey: KEY });
    emit(OUTPUT, output(0, 'hello '));
    feed.read();
    const before = wakes();
    // The same event again, one that lies inside what it has, one that ends exactly where it stands: all of them are bytes it has.
    emit(OUTPUT, output(0, 'hello '));
    emit(OUTPUT, output(2, 'llo'));
    emit(OUTPUT, output(4, 'o '));
    expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
    expect(wakes()).toBe(before);
    emit(OUTPUT, output(6, 'world'));
    expect(readText(feed)).toBe('world');
    expect(wakes()).toBe(before + 1);
  });

  it('drops a duplicate that comes while what it duplicates is still held, not yet read: held or read, it is the same bytes', () => {
    const { feed, emit } = rig({ pageKey: KEY });
    emit(OUTPUT, output(0, 'abc'));
    emit(OUTPUT, output(0, 'abc'));
    emit(OUTPUT, output(3, 'def'));
    emit(OUTPUT, output(3, 'def'));
    expect(readText(feed)).toBe('abcdef');
  });

  it('treats an event above the offset it has as a gap that must not happen: the session fails in words that say so, with a warning, and every listener is released; what came before stays readable', () => {
    const { feed, emit, warn, listeners } = rig({ pageKey: KEY });
    emit(OUTPUT, output(0, 'abc'));
    emit(OUTPUT, output(10, 'xyz'));
    expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'Some of the terminal\'s output did not arrive.' } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(listeners()).toBe(0);
    emit(OUTPUT, output(3, 'def'));
    expect(readText(feed)).toBe('abc');
  });

  it('ends the process of a session that failed that way when the feed is closed: the host still has it', async () => {
    const { feed, emit, of } = rig({ pageKey: KEY });
    await flush();
    emit(OUTPUT, output(5, 'gap'));
    await feed.close();
    expect(of('close')).toEqual([['term-1']]);
  });

  it('does not apply an event that overlaps what it has and goes beyond it, either: the offsets no longer join, and that is said as a gap is', () => {
    const { feed, emit, warn } = rig({ pageKey: KEY });
    emit(OUTPUT, output(0, 'abc'));
    emit(OUTPUT, output(2, 'cdef'));
    expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'Some of the terminal\'s output did not arrive.' } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(readText(feed)).toBe('abc');
  });

  it('ignores an output event that is not an offset and text, and says so once, not for every event: what it ignored took no place in the output', () => {
    const { feed, emit, warn } = rig({ pageKey: KEY });
    const bad: unknown[] = [null, undefined, 42, 'aGk=', { offset: 0 }, { data: btoa('x') }, { offset: -1, data: btoa('x') }, { offset: 1.5, data: btoa('x') }, { offset: '0', data: btoa('x') }, { offset: 0, data: 7 }, { offset: 0, data: 'abc' }, { offset: Number.NaN, data: btoa('x') }];
    for (const payload of bad) {
      emit(OUTPUT, payload);
    }

    expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot().state).toBe('starting');
    emit(OUTPUT, output(0, 'ok'));
    expect(readText(feed)).toBe('ok');
  });

  it('holds all of it and drops nothing, as a feed with no key does: the host\'s pacing is the bound, so a reader that comes late reads every byte, in order', () => {
    const { feed, emit } = rig({ pageKey: KEY });
    for (let index = 0; index < 300; index += 1) {
      emit(OUTPUT, { offset: index * 1_024, data: text(String(index).padStart(4, '0').repeat(256)) });
    }

    const read = feed.read();
    expect(read.chunks).toHaveLength(300);
    expect(read.bytes).toBe(300 * 1_024);
    const markers = read.chunks.map((chunk) => new TextDecoder().decode(chunk).slice(0, 4));
    expect(markers).toEqual(Array.from({ length: 300 }, (_, index) => String(index).padStart(4, '0')));
  });

  it('does not touch what it holds until somebody reads: no decode, no copy; the length of an event is counted from its text', () => {
    const decode = vi.spyOn(Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }, 'fromBase64');
    const { emit } = rig({ pageKey: KEY });
    for (let index = 0; index < 100; index += 1) {
      emit(OUTPUT, { offset: index * 3, data: text('y\r\n') });
    }

    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
  });

  it('wakes a listener ONCE until its reader has read, however many events come, and not for the events it dropped', () => {
    const { feed, emit, wakes } = rig({ pageKey: KEY });
    const before = wakes();
    for (let index = 0; index < 1_000; index += 1) {
      emit(OUTPUT, { offset: index * 3, data: text('y\r\n') });
      emit(OUTPUT, { offset: index * 3, data: text('y\r\n') });
    }

    expect(wakes()).toBe(before + 1);
    feed.read();
    emit(OUTPUT, { offset: 3_000, data: text('y\r\n') });
    expect(wakes()).toBe(before + 2);
  });

  it('ends on the typed close of the terminal as a feed with no key does, and says when it was the lease of a terminal nobody held that ran out', async () => {
    const { feed, emit, listeners } = rig({ pageKey: KEY });
    await flush();
    emit(OUTPUT, output(0, 'bye\r\n'));
    emit(CLOSE, { reason: 'closed', closed_by: 'detach-timeout', last_offset: 5 });
    expect(feed.getSnapshot()).toEqual({ state: 'ended', exit: { closedBy: 'detach-timeout' } });
    expect(listeners()).toBe(0);
    expect(readText(feed)).toBe('bye\r\n');
  });

  it('dismisses the terminal at the host when it is closed after it ended on its own: the host keeps how it ended and what it wrote for the rest of its lease, until a page closes it', async () => {
    const keyed = rig({ pageKey: KEY });
    await flush();
    keyed.emit(CLOSE, { reason: 'exited', exit_code: 0, last_offset: 0 });
    await keyed.feed.close();
    expect(keyed.of('close')).toEqual([['term-1']]);
    // A feed with no key has nothing to dismiss: its process ended and the host kept nothing.
    const plain = rig();
    await flush();
    plain.emit(signalEvent('term-1', 'CLOSE'), { reason: 'exited', exit_code: 0 });
    await plain.feed.close();
    expect(plain.of('close')).toEqual([]);
  });

  it('is not troubled when the host says the terminal it dismisses is already gone', async () => {
    const { feed, emit, pending } = rig({ pageKey: KEY, auto: false });
    pending('create')[0]?.resolve();
    await flush();
    emit(CLOSE, { reason: 'closed', closed_by: 'request', last_offset: 0 });
    const closing = feed.close();
    await flush();
    pending('close')[0]?.reject(new Error('gone'));
    await expect(closing).resolves.toBeUndefined();
  });

  it('takes a not-found answer to the close of a terminal that ended on its own as done: the host keeps such a terminal listed until its lease runs out and does not dismiss it (its close answers not-found), so closing the tab is no failure and says nothing', async () => {
    const { feed, emit, pending, of, warn } = rig({ pageKey: KEY, auto: false });
    pending('create')[0]?.resolve();
    await flush();
    emit(CLOSE, { reason: 'exited', exit_code: 3, last_offset: 0 });
    const closing = feed.close();
    await flush();
    expect(of('close')).toEqual([['term-1']]);
    pending('close')[0]?.reject(new Error('gone'));
    await expect(closing).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 3 } });
  });

  it('takes it as done for a terminal that had ended while no page held it, too: the page took it over only to show how it ended', async () => {
    const { feed, pending, of, warn } = rig({ auto: false, attach: { id: 'term-1', program: 'zsh' } });
    pending('attach')[0]?.resolve(attached({ ended: { reason: 'exited', exit_code: 7, last_offset: 0 } }));
    await flush();
    const closing = feed.close();
    await flush();
    pending('close')[0]?.reject(new Error('gone'));
    await expect(closing).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(of('close')).toHaveLength(1);
  });

  it('still tells the caller when the host refuses the close of an ended terminal for another reason: only not-found is done', async () => {
    const { feed, emit, pending } = rig({ pageKey: KEY, auto: false });
    pending('create')[0]?.resolve();
    await flush();
    emit(CLOSE, { reason: 'exited', exit_code: 0, last_offset: 0 });
    const closing = feed.close();
    await flush();
    pending('close')[0]?.reject(new Error('The host is busy'));
    await expect(closing).rejects.toThrow('The host is busy');
  });
});

describe('taking over a terminal that outlived its page (T2-go 2.4)', () => {
  const ATTACH = { id: 'term-1', program: 'zsh' };

  it('is starting, named by the shell the listing gave, and listens to the three events BEFORE the one call that takes the terminal over: with the key and NO offset, since a fresh emulator has nothing', () => {
    const { feed, calls, of } = rig({ auto: false, attach: ATTACH });
    expect(feed.getSnapshot()).toEqual({ state: 'starting', program: 'zsh' });
    const first = calls.indexOf('attach');
    expect(first).toBeGreaterThan(0);
    expect(calls.slice(0, first).sort()).toEqual(['on core/exec/signal/CLOSE/term-1', 'on core/exec/signal/DETACHED/term-1', 'on core/exec/stream/output/term-1']);
    expect(of('attach')).toHaveLength(1);
    expect(of('attach')[0]?.[0]).toBe('term-1');
    expect(of('attach')[0]?.[1]).toStrictEqual({ pageKey: KEY });
  });

  it('starts no process, measures nothing and waits for no size: the terminal is there, and the call goes at once', () => {
    const { of } = rig({ auto: false, attach: ATTACH });
    expect(of('create')).toEqual([]);
    expect(of('attach')).toHaveLength(1);
  });

  it('is running when the host has answered, named by the shell its answer says (it wins over the listing), and tells its listeners once', async () => {
    const { feed, pending, wakes } = rig({ auto: false, attach: { id: 'term-1', program: 'sh' } });
    const before = wakes();
    pending('attach')[0]?.resolve(attached({ shell: 'zsh' }));
    await flush();
    expect(feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh' });
    expect(wakes()).toBe(before + 1);
  });

  it('keeps the name the listing gave when the answer names no shell, and has none when neither does', async () => {
    const named = rig({ auto: false, attach: ATTACH });
    named.pending('attach')[0]?.resolve({ ...attached(), session: {} });
    await flush();
    expect(named.feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh' });
    const nameless = rig({ auto: false, attach: { id: 'term-1' } });
    expect(nameless.feed.getSnapshot()).toEqual({ state: 'starting' });
    nameless.pending('attach')[0]?.resolve({ ...attached(), session: {} });
    await flush();
    expect(nameless.feed.getSnapshot()).toEqual({ state: 'running' });
  });

  describe('the replay', () => {
    it('is given once, as the bytes the host kept and the sizes and the modes it states, with the offset the live output continues at', async () => {
      const { feed, pending } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(
        attached({
          data: 'hello\r\n',
          start: 100,
          startSize: { cols: 120, rows: 30 },
          size: { cols: 100, rows: 40 },
          startModes: { bracketed_paste: true },
          modes: { alt_screen: true, bracketed_paste: true, application_cursor: true, focus_events: true, cursor_hidden: true, mouse_tracking: 5, mouse_encoding: 2, kitty_keyboard: [1, 3] },
        }),
      );
      await flush();
      const replay = replayOf(feed);
      expect([...replay.data]).toEqual(bytes('hello\r\n'));
      expect(replay.end).toBe(107);
      expect(replay.startSize).toEqual({ cols: 120, rows: 30 });
      expect(replay.size).toEqual({ cols: 100, rows: 40 });
      expect(replay.startModes).toEqual({ altScreen: false, bracketedPaste: true, applicationCursor: false, focusEvents: false, cursorHidden: false, mouseTracking: 0, mouseEncoding: 0, kittyKeyboard: [] });
      expect(replay.modes).toEqual({ altScreen: true, bracketedPaste: true, applicationCursor: true, focusEvents: true, cursorHidden: true, mouseTracking: 5, mouseEncoding: 2, kittyKeyboard: [1, 3] });
      expect(feed.takeReplay?.()).toBeUndefined();
    });

    it('is not decoded until the reader takes it: a terminal that is never shown costs the text it holds and no more', async () => {
      const decode = vi.spyOn(Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }, 'fromBase64');
      const { feed, pending } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ data: 'x'.repeat(4_096) }));
      await flush();
      expect(decode).not.toHaveBeenCalled();
      replayOf(feed);
      decode.mockRestore();
    });

    it('does not exist before the host has answered, and nothing is read then: whatever came is held for after it', () => {
      const { feed, emit } = rig({ auto: false, attach: ATTACH });
      expect(feed.takeReplay?.()).toBeUndefined();
      emit(OUTPUT, output(0, 'x'));
      expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
    });

    it('gives no live output before it is taken: `read` is empty until then, however much has come, and what came is there after it, in order', async () => {
      const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ data: 'old' }));
      await flush();
      emit(OUTPUT, output(3, 'new1'));
      emit(OUTPUT, output(7, 'new2'));
      expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
      replayOf(feed);
      expect(readText(feed)).toBe('new1new2');
    });

    it('is given when there was nothing to replay, with the size and the modes that are in force: the bytes are none, and the emulator is still brought to where the terminal is', async () => {
      const { feed, pending } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ size: { cols: 90, rows: 33 }, modes: { cursor_hidden: true } }));
      await flush();
      const replay = replayOf(feed);
      expect(replay.data).toHaveLength(0);
      expect(replay.end).toBe(0);
      expect(replay.size).toEqual({ cols: 90, rows: 33 });
      expect(replay.modes.cursorHidden).toBe(true);
    });

    it('continues at an offset past 2^32: a terminal that has written gigabytes joins as exactly as one that wrote a prompt', async () => {
      const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
      const end = 2 ** 33;
      pending('attach')[0]?.resolve(attached({ data: 'tail', start: end - 4 }));
      await flush();
      replayOf(feed);
      emit(OUTPUT, output(end - 4, 'tail'));
      emit(OUTPUT, output(end, 'more'));
      expect(readText(feed)).toBe('more');
    });
  });

  describe('the output that comes while the call is out, and after it (rule 5)', () => {
    it('holds what comes while the call is out and applies it after the answer by offset: what the replay has is dropped, what continues it is read, in order', async () => {
      const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
      emit(OUTPUT, output(0, 'aaaa'));
      emit(OUTPUT, output(4, 'bbbb'));
      emit(OUTPUT, output(8, 'cccc'));
      emit(OUTPUT, output(12, 'dddd'));
      expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
      pending('attach')[0]?.resolve(attached({ data: 'aaaabbbb' }));
      await flush();
      replayOf(feed);
      expect(readText(feed)).toBe('ccccdddd');
    });

    it('drops, ALWAYS, an event the replay has the bytes of, also one that comes AFTER the answer: an event and a reply travel apart (7 in 2,051 reattaches seen in the field), and then goes on with the event at the offset it has', async () => {
      const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ data: 'aaaabbbb' }));
      await flush();
      replayOf(feed);
      emit(OUTPUT, output(4, 'bbbb'));
      emit(OUTPUT, output(0, 'aaaa'));
      emit(OUTPUT, output(8, 'cccc'));
      emit(OUTPUT, output(8, 'cccc'));
      emit(OUTPUT, output(12, 'dddd'));
      expect(readText(feed)).toBe('ccccdddd');
    });

    it('does not wake its reader for an event it dropped', async () => {
      const { feed, pending, emit, wakes } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ data: 'aaaabbbb' }));
      await flush();
      replayOf(feed);
      feed.read();
      const before = wakes();
      emit(OUTPUT, output(4, 'bbbb'));
      expect(wakes()).toBe(before);
    });

    it('fails the session in words when a held event lies above where the replay ends: a gap that must not happen, and the host\'s output is not guessed at', async () => {
      const { feed, pending, emit, warn } = rig({ auto: false, attach: ATTACH });
      emit(OUTPUT, output(12, 'dddd'));
      pending('attach')[0]?.resolve(attached({ data: 'aaaabbbb' }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'Some of the terminal\'s output did not arrive.' } });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('fails the same way when an event straddles the end of the replay: whole events never do, and one that does is not to be trusted', async () => {
      const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ data: 'aaaabbbb' }));
      await flush();
      emit(OUTPUT, output(6, 'bbcccc'));
      expect(feed.getSnapshot().state).toBe('failed');
    });

    it('reads every event after the replay once and in order when events and the answer are shuffled any way: held before, dropped after, applied after', async () => {
      // The terminal wrote 'abcdefghij' in five events of two bytes; the replay holds the first three, and the events the page hears are the ones it hears in each interleaving.
      const events = [output(0, 'ab'), output(2, 'cd'), output(4, 'ef'), output(6, 'gh'), output(8, 'ij')];
      for (let heardBefore = 0; heardBefore <= events.length; heardBefore += 1) {
        for (let late = 0; late <= 3; late += 1) {
          const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
          for (const event of events.slice(0, heardBefore)) {
            emit(OUTPUT, event);
          }

          pending('attach')[0]?.resolve(attached({ data: 'abcdef' }));
          await flush();
          // Events that were handed to the transport before the answer was made and reach the page after it, then the live ones.
          for (const event of [...events.slice(Math.max(heardBefore, 3 - late), 3), ...events.slice(Math.max(heardBefore, 3))]) {
            emit(OUTPUT, event);
          }

          replayOf(feed);
          expect(readText(feed)).toBe('ghij');
        }
      }
    });
  });

  describe('flow control and the input counter (rule 6)', () => {
    it('turns flow control on once the host has answered, with the first acknowledgement and nothing owed, and not before', async () => {
      const { pending, of } = rig({ auto: false, attach: ATTACH });
      await flush();
      expect(of('ack')).toEqual([]);
      pending('attach')[0]?.resolve(attached());
      await flush();
      expect(of('ack')).toEqual([['term-1', 0]]);
    });

    it('acknowledges what the reader parsed of the live output, and nothing of the replay, whatever its size: the first call carries no byte', async () => {
      const { feed, pending, of, emit } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ data: 'x'.repeat(1_000) }));
      await flush();
      pending('ack')[0]?.resolve();
      replayOf(feed);
      await flush();
      expect(of('ack')).toEqual([['term-1', 0]]);
      emit(OUTPUT, output(1_000, 'live'));
      emit(OUTPUT, output(500, 'dropped duplicate'));
      feed.ack(feed.read().bytes);
      await flush();
      expect(of('ack')).toEqual([['term-1', 0], ['term-1', 4]]);
    });

    it('continues the count of input calls from the number the answer states, whatever it is and not from 1: the first write is exactly that number, a size the next, a write after it the next, one counter for the writes and the sizes together', async () => {
      const { feed, pending, numbered, of } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ nextInputSeq: 17 }));
      await flush();
      feed.write('a');
      feed.resize(100, 30);
      vi.advanceTimersByTime(200);
      feed.write('b');
      expect(numbered()).toEqual([['write', 17], ['resize', 18], ['write', 19]]);
      expect(of('write')).toEqual([['term-1', 17, btoa('a')], ['term-1', 19, btoa('b')]]);
      expect(of('resize')).toEqual([['term-1', 18, 30, 100]]);
    });

    it('sends what is typed at once, each key as its own call with the next number, and never waits for the answer of a call before it: the numbers keep the order, as they do for a terminal this page started', async () => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ nextInputSeq: 17 }));
      await flush();
      feed.write('a');
      feed.write('b');
      feed.write('c');
      expect(of('write')).toEqual([['term-1', 17, btoa('a')], ['term-1', 18, btoa('b')], ['term-1', 19, btoa('c')]]);
    });

    it('keeps the numbers of a typed burst consecutive across the windows: what does not fit waits and goes in the next call as calls are answered, and every call, those of the first window and those after it, takes the number after the one before, from the answer\'s', async () => {
      const { feed, pending, of, numbered } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ nextInputSeq: 17 }));
      await flush();
      const keys = Array.from({ length: 300 }, (_, key) => String.fromCharCode(97 + (key % 26))).join('');
      for (const key of keys) {
        feed.write(key);
      }

      expect(of('write')).toHaveLength(WINDOW_CALLS);
      // The list grows while it is walked: a call that goes out when one is answered is answered in its turn.
      for (const call of pending('write')) {
        call.resolve();
        await settle();
      }

      expect(of('write')).toHaveLength(WINDOW_CALLS + 1);
      expect(of('write').map(textOf).join('')).toBe(keys);
      expect(numbered().map(([, number]) => number)).toEqual(Array.from({ length: WINDOW_CALLS + 1 }, (_, index) => 17 + index));
    });

    it('keeps the numbers of a paste consecutive across the window of bytes: one more piece goes for each call answered, in order, and the numbers go on from the answer\'s', async () => {
      const { feed, pending, of, numbered } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ nextInputSeq: 17 }));
      await flush();
      const paste = pasteOf(2_048);
      const pieces = paste.length / CHUNK_BYTES;
      feed.write(paste);
      for (let answered = 0; answered < pieces; answered += 1) {
        pending('write')[answered]?.resolve();
        await settle();
      }

      expect(of('write')).toHaveLength(pieces);
      expect(numbered().map(([, number]) => number)).toEqual(Array.from({ length: pieces }, (_, index) => 17 + index));
      expect(of('write').map(textOf).join('')).toBe(paste);
    });

    it('holds what is typed while the call is out, and sends it after the answer, in order, under the numbers the answer gives', async () => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH });
      feed.write('ls');
      feed.write('\r');
      expect(of('write')).toEqual([]);
      pending('attach')[0]?.resolve(attached({ nextInputSeq: 7 }));
      await flush();
      expect(of('write')).toEqual([['term-1', 7, btoa('ls\r')]]);
    });

    it('numbers the two sizes of a redraw from the answer\'s number, one counter with the writes: both go out at once, the size one column short and then as it is, and what is typed behind them takes the number after them', async () => {
      const { feed, pending, of, numbered } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ size: { cols: 100, rows: 30 }, nextInputSeq: 17 }));
      await flush();
      feed.redraw?.();
      feed.write('x');
      expect(of('resize')).toEqual([['term-1', 17, 30, 99], ['term-1', 18, 30, 100]]);
      expect(of('write')).toEqual([['term-1', 19, btoa('x')]]);
      expect(numbered()).toEqual([['resize', 17], ['resize', 18], ['write', 19]]);
    });

    it('fails the session in the host\'s words and code when it refuses a number as stale, as it does for any other refusal of a call, and does not send the call again: only a full queue is sent again', async () => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ nextInputSeq: 17 }));
      await flush();
      feed.write('a');
      const words = 'Sequence number 17 was already applied or given up; the next expected is 40.';
      pending('write')[0]?.reject(Object.assign(new Error(words), { code: 'SEQUENCE_STALE' }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'input', message: words, code: 'SEQUENCE_STALE' } });
      vi.advanceTimersByTime(10_000);
      await flush();
      expect(of('write')).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('the size', () => {
    it('knows the size the host has from the replay: a size measured that is the same sends nothing, and a different one is sent once, as its own call', async () => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ size: { cols: 100, rows: 30 }, nextInputSeq: 3 }));
      await flush();
      feed.resize(100, 30);
      vi.advanceTimersByTime(200);
      await settle();
      expect(of('resize')).toEqual([]);
      feed.resize(120, 40);
      vi.advanceTimersByTime(200);
      await settle();
      expect(of('resize')).toEqual([['term-1', 3, 40, 120]]);
    });

    it('holds a size measured before the answer until the host has answered, and sends it only when it is not the size the host has', async () => {
      const same = rig({ auto: false, attach: ATTACH });
      same.feed.resize(100, 30);
      vi.advanceTimersByTime(200);
      expect(same.of('resize')).toEqual([]);
      same.pending('attach')[0]?.resolve(attached({ size: { cols: 100, rows: 30 }, nextInputSeq: 1 }));
      await flush();
      expect(same.of('resize')).toEqual([]);
      const other = rig({ auto: false, attach: ATTACH });
      other.feed.resize(120, 40);
      vi.advanceTimersByTime(200);
      other.pending('attach')[0]?.resolve(attached({ size: { cols: 100, rows: 30 }, nextInputSeq: 1 }));
      await flush();
      expect(other.of('resize')).toEqual([['term-1', 1, 40, 120]]);
    });
  });

  describe('a terminal that had ended while no page held it (rule 7)', () => {
    it('is ended, with how it ended in the words of the typed end, the replay still given, nothing acknowledged, and every listener released: no live output follows', async () => {
      const { feed, pending, listeners, of } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ data: 'bye\r\n', ended: { reason: 'exited', exit_code: 3, last_offset: 5 } }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 3 }, program: 'zsh' });
      expect(listeners()).toBe(0);
      expect([...replayOf(feed).data]).toEqual(bytes('bye\r\n'));
      expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
      expect(of('ack')).toEqual([]);
    });

    it.each([
      { name: 'the 0 a terminal that takes no input says', answer: attached({ ended: { reason: 'exited', exit_code: 3, last_offset: 5 } }) },
      { name: 'no number at all', answer: without(attached({ ended: { reason: 'exited', exit_code: 3, last_offset: 5 } }), 'next_input_seq') },
      { name: 'a fraction where the number goes', answer: attached({ ended: { reason: 'exited', exit_code: 3, last_offset: 5 }, nextInputSeq: -4.5 }) },
      { name: 'text where the number goes', answer: attached({ ended: { reason: 'exited', exit_code: 3, last_offset: 5 }, nextInputSeq: 'seven' }) },
      { name: 'null where the number goes', answer: attached({ ended: { reason: 'exited', exit_code: 3, last_offset: 5 }, nextInputSeq: null }) },
    ])('is ended all the same when the answer carries $name: a terminal that ended takes no input, so its number is not read and no call is ever sent for it', async ({ answer }) => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(answer);
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 3 }, program: 'zsh' });
      feed.write('x');
      feed.resize(100, 30);
      vi.advanceTimersByTime(1_000);
      await flush();
      expect([...of('write'), ...of('resize'), ...of('ack')]).toEqual([]);
    });

    it.each([
      { how: 'was killed by a signal', ended: { reason: 'signaled', signal: 'SIGKILL', signal_number: 9, last_offset: 0 }, exit: { signal: 'SIGKILL', signalNumber: 9 } },
      { how: 'was ended when the lease ran out', ended: { reason: 'closed', closed_by: 'detach-timeout', last_offset: 0 }, exit: { closedBy: 'detach-timeout' } },
      { how: 'was closed with its window', ended: { reason: 'closed', closed_by: 'window', last_offset: 0 }, exit: { closedBy: 'window' } },
    ])('says how it ended when the terminal $how', async ({ ended, exit }) => {
      const { feed, pending } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ ended }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'ended', exit, program: 'zsh' });
    });

    it('does not read the output it held while the call was out: the terminal is over, and what the replay holds is all there is', async () => {
      const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
      emit(OUTPUT, output(5, 'late'));
      pending('attach')[0]?.resolve(attached({ data: 'bye\r\n', ended: { reason: 'exited', exit_code: 0, last_offset: 5 } }));
      await flush();
      replayOf(feed);
      expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
    });

    it('is dismissed at the host by the close of the feed: the host keeps the end and the output of a terminal that ended while no page held it until a page closes it', async () => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ ended: { reason: 'exited', exit_code: 0, last_offset: 0 } }));
      await flush();
      const closing = feed.close();
      await flush();
      expect(of('close')).toEqual([['term-1']]);
      pending('close')[0]?.resolve();
      await closing;
    });

    it('says nothing is running in it, and asks the host nothing', async () => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ ended: { reason: 'exited', exit_code: 0, last_offset: 0 } }));
      await flush();
      expect(await feed.busy?.()).toEqual({ state: 'idle' });
      expect(of('busy')).toEqual([]);
    });

    it('is a failed session when the end it was told of is a failure of the pty, in the host\'s words', async () => {
      const { feed, pending } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached({ ended: { reason: 'failed', failure: { stage: 'pty', message: 'input/output error' }, last_offset: 0 } }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'input/output error' } });
    });
  });

  describe('a call the host refused, or an answer that cannot be read', () => {
    const refusal = (message: string, code?: string): Error => Object.assign(new Error(message), code === undefined ? {} : { code });

    it('fails in the host\'s words and code, at the start, and lets every listener go: a terminal that is not there, or that cannot be taken over, is not a terminal', async () => {
      const { feed, pending, listeners } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.reject(refusal('This terminal cannot be attached again', 'NOT_REATTACHABLE'));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'start', message: 'This terminal cannot be attached again', code: 'NOT_REATTACHABLE' } });
      expect(listeners()).toBe(0);
    });

    it('says the same of a terminal the host says is not there: a failed start, and not an end', async () => {
      const { feed, pending } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.reject(refusal('gone'));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'start', message: 'gone' } });
    });

    it('has nothing to end when the host refused: the close of the feed sends nothing to the host', async () => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.reject(refusal('nope'));
      await flush();
      await feed.close();
      expect(of('close')).toEqual([]);
    });

    it('sends nothing and acknowledges nothing for a terminal it could not take over', async () => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.reject(refusal('nope'));
      await flush();
      feed.write('x');
      feed.resize(100, 30);
      feed.ack(5);
      vi.advanceTimersByTime(1_000);
      await flush();
      expect([...of('write'), ...of('resize'), ...of('ack')]).toEqual([]);
    });

    it.each([
      { name: 'nothing', answer: undefined },
      { name: 'null', answer: null },
      { name: 'an empty object', answer: {} },
      { name: 'no replay', answer: { attachment: 1 } },
      { name: 'a replay with no end', answer: { attachment: 1, replay: { start: 0, data: '', start_size: { cols: 80, rows: 24 }, size: { cols: 80, rows: 24 } } } },
      { name: 'a replay whose end is not a number', answer: { attachment: 1, replay: { ...(attached().replay as Record<string, unknown>), end: 'ten' } } },
      { name: 'a replay whose data is not text', answer: { attachment: 1, replay: { ...(attached().replay as Record<string, unknown>), data: 7 } } },
      { name: 'a replay with a size of no cells', answer: { attachment: 1, replay: { ...(attached().replay as Record<string, unknown>), size: { cols: 0, rows: 24 } } } },
      { name: 'no attachment number', answer: { replay: attached().replay } },
    ])('fails at the start, in words, when the answer is $name: the output could not be joined exactly, and the host is not guessed at', async ({ answer }) => {
      const { feed, listeners } = rig({ attach: ATTACH, attached: answer });
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'start', message: 'The terminal could not be taken over: the host\'s answer was not understood.' } });
      expect(listeners()).toBe(0);
    });

    it.each([
      { name: 'absent', answer: without(attached(), 'next_input_seq') },
      { name: '0, which a terminal that ended says and one that runs does not', answer: attached({ nextInputSeq: 0 }) },
      { name: 'below 1', answer: attached({ nextInputSeq: -1 }) },
      { name: 'a fraction', answer: attached({ nextInputSeq: 17.5 }) },
      { name: 'text', answer: attached({ nextInputSeq: '17' }) },
      { name: 'null', answer: attached({ nextInputSeq: null }) },
    ])('fails at the start, in the same words, when the terminal runs and the number its input takes next is $name: the page cannot say where the count continues, and calls numbered from 1 would be refused as stale', async ({ answer }) => {
      const { feed, listeners, of } = rig({ attach: ATTACH, attached: answer });
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'start', message: 'The terminal could not be taken over: the host\'s answer was not understood.' } });
      expect(listeners()).toBe(0);
      feed.write('x');
      feed.resize(100, 30);
      vi.advanceTimersByTime(1_000);
      await flush();
      expect([...of('write'), ...of('resize'), ...of('ack')]).toEqual([]);
    });
  });

  describe('closing', () => {
    it('ends the terminal when the feed is closed while the call is out: the answer is the first chance, as for a process that is starting', async () => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH });
      const closing = feed.close();
      expect(of('close')).toEqual([]);
      pending('attach')[0]?.resolve(attached());
      await flush();
      expect(of('close')).toEqual([['term-1']]);
      pending('close')[0]?.resolve();
      await closing;
    });

    it('ends the terminal once, and lets go of every listener, when it is running', async () => {
      const { feed, pending, of, listeners } = rig({ auto: false, attach: ATTACH });
      pending('attach')[0]?.resolve(attached());
      await flush();
      const closing = Promise.all([feed.close(), feed.close()]);
      await flush();
      pending('close')[0]?.resolve();
      await closing;
      expect(of('close')).toEqual([['term-1']]);
      expect(listeners()).toBe(0);
    });

    it('asks the host what runs in it as any session does, once it is taken over', async () => {
      const { feed, pending, of } = rig({ auto: false, attach: ATTACH, busy: { state: 'busy', name: 'sleep' } });
      expect(await feed.busy?.()).toEqual({ state: 'idle' });
      pending('attach')[0]?.resolve(attached());
      await flush();
      const asked = feed.busy?.();
      pending('busy')[0]?.resolve({ state: 'busy', pgid: 1, name: 'sleep' });
      expect(await asked).toEqual({ state: 'busy', name: 'sleep' });
      expect(of('busy')).toEqual([['term-1']]);
    });
  });
});

describe('the loss of a terminal this page held (DETACHED, T2-go 2.4 rule 8)', () => {
  /** A feed that started its terminal (the creating page holds attachment 0), running and named by the shell. */
  const started = async (options: RigOptions = {}) => {
    const r = rig({ pageKey: KEY, created: SESSION, ...options });
    await flush();
    return r;
  };

  /** A feed that took a terminal over and holds the attachment number the host gave it. */
  const reattached = async (attachment: number, options: RigOptions = {}) => {
    const r = rig({ auto: false, attach: { id: 'term-1', program: 'zsh' }, ...options });
    r.pending('attach')[0]?.resolve(attached({ attachment, nextInputSeq: 1 }));
    await flush();
    return r;
  };

  it.each(['taken-over', 'requested', 'window-retired'] as const)('ends the session for this page, and says it was %s, when the event carries the attachment this page holds: the page that created the terminal holds 0', async (by) => {
    const { feed, emit, wakes } = await started();
    const before = wakes();
    emit(DETACHED, { by, attachment: 0 });
    expect(feed.getSnapshot()).toEqual({ state: 'ended', detached: { by }, program: 'zsh' });
    expect(wakes()).toBe(before + 1);
  });

  it('is the page\'s business only for the number it holds: the event of the attachment before it, or after it, changes nothing, for a page that took the terminal over and for one that created it', async () => {
    const taken = await reattached(4);
    const snapshot = taken.feed.getSnapshot();
    taken.emit(DETACHED, { by: 'taken-over', attachment: 3 });
    taken.emit(DETACHED, { by: 'taken-over', attachment: 5 });
    taken.emit(DETACHED, { by: 'taken-over', attachment: 0 });
    expect(taken.feed.getSnapshot()).toBe(snapshot);
    taken.emit(DETACHED, { by: 'taken-over', attachment: 4 });
    expect(taken.feed.getSnapshot()).toEqual({ state: 'ended', detached: { by: 'taken-over' }, program: 'zsh' });
    const created = await started();
    const before = created.feed.getSnapshot();
    created.emit(DETACHED, { by: 'taken-over', attachment: 1 });
    expect(created.feed.getSnapshot()).toBe(before);
  });

  it('reads a reason it does not know as a release (`requested`): the terminal is no longer held, and that is what matters; and ignores an event that carries no number it can compare', async () => {
    const { feed, emit } = await started();
    const before = feed.getSnapshot();
    for (const payload of [null, undefined, 'taken-over', 7, {}, { by: 'taken-over' }, { by: 'taken-over', attachment: '0' }, { by: 'taken-over', attachment: Number.NaN }, { by: 'taken-over', attachment: -1 }]) {
      emit(DETACHED, payload);
    }

    expect(feed.getSnapshot()).toBe(before);
    emit(DETACHED, { by: 'a-reason-from-the-future', attachment: 0 });
    expect(feed.getSnapshot()).toEqual({ state: 'ended', detached: { by: 'requested' }, program: 'zsh' });
  });

  it('stops everything toward the host: what is typed, the size that was settling, the counts, and every timer; and it keeps what it had read readable', async () => {
    const { feed, emit, of } = await started({ settleMs: 10 });
    emit(OUTPUT, output(0, 'before'));
    feed.resize(120, 30);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    emit(DETACHED, { by: 'taken-over', attachment: 0 });
    expect(vi.getTimerCount()).toBe(0);
    feed.write('x');
    feed.resize(130, 31);
    feed.ack(6);
    vi.advanceTimersByTime(1_000);
    await flush();
    expect(of('write')).toEqual([]);
    expect(of('resize')).toEqual([]);
    expect(of('ack')).toEqual([['term-1', 0]]);
    expect(readText(feed)).toBe('before');
  });

  it('lets go of the output and the loss, and keeps listening to the END of the terminal only: it learns when the lease it was lost to runs out', async () => {
    const { emit, listeners } = await started();
    emit(DETACHED, { by: 'requested', attachment: 0 });
    expect(listeners()).toBe(1);
    expect(listeners(CLOSE)).toBe(1);
  });

  it('reads no output that comes after the loss: the terminal belongs to another page now', async () => {
    const { feed, emit } = await started();
    emit(DETACHED, { by: 'taken-over', attachment: 0 });
    emit(OUTPUT, output(0, 'after'));
    expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
  });

  it('sends neither DetachTerminal nor CloseSession for a terminal it lost: that would hold or end what another page shows', async () => {
    const { feed, emit, of } = await started();
    emit(DETACHED, { by: 'taken-over', attachment: 0 });
    feed.leave?.();
    await feed.close();
    expect(of('detach')).toEqual([]);
    expect(of('close')).toEqual([]);
  });

  it('says why the terminal ended when the lease it was lost to runs out: the snapshot keeps `detached`, gains the exit, and the state stays `ended`; then the last listener is released', async () => {
    const { feed, emit, listeners, wakes } = await started();
    emit(DETACHED, { by: 'requested', attachment: 0 });
    const before = wakes();
    emit(CLOSE, { reason: 'closed', closed_by: 'detach-timeout', last_offset: 100 });
    expect(feed.getSnapshot()).toEqual({ state: 'ended', detached: { by: 'requested' }, exit: { closedBy: 'detach-timeout' }, program: 'zsh' });
    expect(wakes()).toBe(before + 1);
    expect(listeners()).toBe(0);
    const snapshot = feed.getSnapshot();
    emit(CLOSE, { reason: 'exited', exit_code: 0, last_offset: 100 });
    expect(feed.getSnapshot()).toBe(snapshot);
  });

  it('says how the terminal ended when the page that has it exits the shell: the exit code is the lost page\'s to read as well', async () => {
    const { feed, emit } = await started();
    emit(DETACHED, { by: 'taken-over', attachment: 0 });
    emit(CLOSE, { reason: 'exited', exit_code: 3, last_offset: 9 });
    expect(feed.getSnapshot()).toEqual({ state: 'ended', detached: { by: 'taken-over' }, exit: { code: 3 }, program: 'zsh' });
  });

  it('keeps the snapshot as it is, and lets the last listener go, when the end says nothing it can read, or is a failure: the page lost the terminal, and what became of it is not the page\'s state', async () => {
    for (const payload of [undefined, null, {}, { reason: 'vanished' }, { reason: 'failed', failure: { stage: 'pty', message: 'broken' } }]) {
      const { feed, emit, listeners, wakes } = await started();
      emit(DETACHED, { by: 'requested', attachment: 0 });
      const snapshot = feed.getSnapshot();
      const before = wakes();
      emit(CLOSE, payload);
      expect(feed.getSnapshot()).toBe(snapshot);
      expect(wakes()).toBe(before);
      expect(listeners()).toBe(0);
    }
  });

  it('is not told twice: a second loss, or one after the session ended or failed or was closed, changes nothing', async () => {
    const ended = await started();
    ended.emit(CLOSE, { reason: 'exited', exit_code: 0, last_offset: 0 });
    const snapshot = ended.feed.getSnapshot();
    ended.emit(DETACHED, { by: 'taken-over', attachment: 0 });
    expect(ended.feed.getSnapshot()).toBe(snapshot);
    const lost = await started();
    lost.emit(DETACHED, { by: 'taken-over', attachment: 0 });
    const once = lost.feed.getSnapshot();
    lost.emit(DETACHED, { by: 'requested', attachment: 0 });
    expect(lost.feed.getSnapshot()).toBe(once);
    const closed = await started();
    await closed.feed.close();
    const before = closed.wakes();
    closed.emit(DETACHED, { by: 'taken-over', attachment: 0 });
    expect(closed.wakes()).toBe(before);
    expect(closed.feed.getSnapshot().detached).toBeUndefined();
  });

  describe('an event that comes while the call that takes the terminal over is out (the page does not know its number yet)', () => {
    const ATTACH = { id: 'term-1', program: 'zsh' };

    it('is held, and applied once the answer has said the number: the page lost the terminal before it knew it had it', async () => {
      const { feed, pending, emit, of } = rig({ auto: false, attach: ATTACH });
      emit(DETACHED, { by: 'taken-over', attachment: 4 });
      expect(feed.getSnapshot()).toEqual({ state: 'starting', program: 'zsh' });
      pending('attach')[0]?.resolve(attached({ attachment: 4, nextInputSeq: 1 }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'ended', detached: { by: 'taken-over' }, program: 'zsh' });
      expect(of('ack')).toEqual([]);
    });

    it('is ignored when its number is not the one the answer gives, each held event by its own: the page holds the terminal', async () => {
      const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
      emit(DETACHED, { by: 'taken-over', attachment: 2 });
      emit(DETACHED, { by: 'requested', attachment: 3 });
      emit(DETACHED, { by: 'window-retired', attachment: 5 });
      pending('attach')[0]?.resolve(attached({ attachment: 4, nextInputSeq: 1 }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh' });
    });

    it('finds the one that is the page\'s among several held', async () => {
      const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
      emit(DETACHED, { by: 'taken-over', attachment: 2 });
      emit(DETACHED, { by: 'requested', attachment: 4 });
      emit(DETACHED, { by: 'window-retired', attachment: 5 });
      pending('attach')[0]?.resolve(attached({ attachment: 4, nextInputSeq: 1 }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'ended', detached: { by: 'requested' }, program: 'zsh' });
    });

    it('keeps the order the events came in: the output heard before the loss is applied, the output heard after it is not', async () => {
      const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
      emit(OUTPUT, output(2, 'b'));
      emit(DETACHED, { by: 'taken-over', attachment: 4 });
      emit(OUTPUT, output(3, 'c'));
      pending('attach')[0]?.resolve(attached({ attachment: 4, data: 'aa', nextInputSeq: 1 }));
      await flush();
      replayOf(feed);
      expect(readText(feed)).toBe('b');
    });

    it('still reads the end of the terminal that was heard after the loss, and says why: the lease ran out while the answer was on its way', async () => {
      const { feed, pending, emit, listeners } = rig({ auto: false, attach: ATTACH });
      emit(DETACHED, { by: 'requested', attachment: 4 });
      emit(CLOSE, { reason: 'closed', closed_by: 'detach-timeout', last_offset: 2 });
      pending('attach')[0]?.resolve(attached({ attachment: 4, nextInputSeq: 1 }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'ended', detached: { by: 'requested' }, exit: { closedBy: 'detach-timeout' }, program: 'zsh' });
      expect(listeners()).toBe(0);
    });

    it('is not the business of a terminal the answer says had already ended: it is over, and its end is what the page shows', async () => {
      const { feed, pending, emit } = rig({ auto: false, attach: ATTACH });
      emit(DETACHED, { by: 'taken-over', attachment: 4 });
      pending('attach')[0]?.resolve(attached({ attachment: 4, ended: { reason: 'exited', exit_code: 1, last_offset: 0 } }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 1 }, program: 'zsh' });
    });

    it('applies the end that was heard while the call was out: the terminal ended as the page took it over', async () => {
      const { feed, pending, emit, listeners } = rig({ auto: false, attach: ATTACH });
      emit(OUTPUT, output(2, 'bye'));
      emit(CLOSE, { reason: 'exited', exit_code: 0, last_offset: 5 });
      pending('attach')[0]?.resolve(attached({ data: 'aa', nextInputSeq: 1 }));
      await flush();
      expect(feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 0 } });
      expect(listeners()).toBe(0);
      replayOf(feed);
      expect(readText(feed)).toBe('bye');
    });
  });
});

describe('a page that is going away leaves its terminal for the page that comes back (`leave`, T2-go 2.4)', () => {
  const started = async (options: RigOptions = {}) => {
    const r = rig({ pageKey: KEY, created: SESSION, ...options });
    await flush();
    return r;
  };

  it('detaches a running terminal that has a key: ONE DetachTerminal with the key, and every listener is released without ending the process', async () => {
    const { feed, of, listeners } = await started();
    feed.leave?.();
    expect(of('detach')).toEqual([['term-1', { pageKey: KEY }]]);
    expect(of('close')).toEqual([]);
    expect(listeners()).toBe(0);
  });

  it('does it once: a second call does nothing', async () => {
    const { feed, of } = await started();
    feed.leave?.();
    feed.leave?.();
    expect(of('detach')).toHaveLength(1);
  });

  it('is fire and forget: it returns at once, and the answer of the host changes nothing', async () => {
    const { feed, pending } = await started({ auto: false });
    pending('create')[0]?.resolve(SESSION);
    await flush();
    const before = feed.getSnapshot();
    expect(feed.leave?.()).toBeUndefined();
    pending('detach')[0]?.resolve({ lease_ms: 300_000, lease_expires_unix_ms: 1 });
    await flush();
    expect(feed.getSnapshot()).toBe(before);
  });

  it('says an error of the host as a warning only, and nothing else changes', async () => {
    const { feed, pending, warn } = await started({ auto: false });
    pending('create')[0]?.resolve(SESSION);
    await flush();
    const before = feed.getSnapshot();
    feed.leave?.();
    pending('detach')[0]?.reject(new Error('The window service is gone'));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot()).toBe(before);
  });

  it('leaves the process alone when the feed is closed after it left: the terminal must survive for the page that comes back, so nothing ends it, and the feed is closed all the same', async () => {
    const { feed, of, listeners } = await started({ settleMs: 10 });
    feed.leave?.();
    feed.resize(130, 31);
    await feed.close();
    expect(of('close')).toEqual([]);
    expect(of('detach')).toHaveLength(1);
    expect(listeners()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends nothing more once it left: what is typed, a size, a count, and nothing is held for a reader that will not come', async () => {
    const { feed, emit, of } = await started({ settleMs: 10 });
    const typed = feed.inputs?.();
    feed.leave?.();
    feed.write('x');
    feed.resize(130, 31);
    feed.ack(10);
    emit(OUTPUT, output(0, 'late'));
    vi.advanceTimersByTime(1_000);
    await flush();
    expect([...of('write'), ...of('resize')]).toEqual([]);
    expect(of('ack')).toEqual([['term-1', 0]]);
    expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
    // What was typed after it left was not taken, and so is not counted.
    expect(feed.inputs?.()).toBe(typed);
  });

  it('does not send the count that was owed when it left, when the call that was in flight is answered afterwards: nothing is credited for a terminal the page has let go of', async () => {
    const { feed, pending, of } = await started({ auto: false });
    pending('create')[0]?.resolve(SESSION);
    await flush();
    pending('ack')[0]?.resolve();
    await flush();
    feed.ack(5);
    feed.ack(7);
    expect(of('ack')).toEqual([['term-1', 0], ['term-1', 5]]);
    feed.leave?.();
    pending('ack')[1]?.resolve();
    await flush();
    expect(of('ack')).toEqual([['term-1', 0], ['term-1', 5]]);
  });

  it('does not change the status: the page is going, and what it shows is not for this to rewrite', async () => {
    const { feed } = await started();
    const before = feed.getSnapshot();
    feed.leave?.();
    expect(feed.getSnapshot()).toBe(before);
  });

  it('does nothing for a session that is not running and held by this page: starting, ended, failed, closed, or lost', async () => {
    const starting = rig({ pageKey: KEY, auto: false });
    starting.feed.leave?.();
    const ended = await started();
    ended.emit(CLOSE, { reason: 'exited', exit_code: 0, last_offset: 0 });
    ended.feed.leave?.();
    const failed = await started();
    failed.emit(OUTPUT, output(9, 'gap'));
    failed.feed.leave?.();
    const closed = await started();
    await closed.feed.close();
    closed.feed.leave?.();
    const lost = await started();
    lost.emit(DETACHED, { by: 'taken-over', attachment: 0 });
    lost.feed.leave?.();
    expect([starting, ended, failed, closed, lost].flatMap((r) => r.of('detach'))).toEqual([]);
  });

  it('does it for a terminal it took over as well, and not for one it is taking over: the answer has not come, and the close that follows is the caller\'s', async () => {
    const taking = rig({ auto: false, attach: { id: 'term-1' } });
    taking.feed.leave?.();
    expect(taking.of('detach')).toEqual([]);
    taking.pending('attach')[0]?.resolve(attached());
    await flush();
    taking.feed.leave?.();
    expect(taking.of('detach')).toEqual([['term-1', { pageKey: KEY }]]);
  });
});

describe('making a full-screen program draw itself again (`redraw`, T2-go 2.4 rule 4)', () => {
  const sized = async (cols: number, rows: number, options: RigOptions = {}) => {
    const r = rig({ pageKey: KEY, auto: false, size: { cols, rows }, ...options });
    r.pending('create')[0]?.resolve();
    await flush();
    return r;
  };

  it('sends the size one column short and then as it is, as two numbered calls out together, rows before columns, without waiting for the size to settle', async () => {
    const { feed, of, numbered } = await sized(100, 20);
    feed.redraw?.();
    expect(of('resize')).toEqual([['term-1', 1, 20, 99], ['term-1', 2, 20, 100]]);
    expect(numbered()).toEqual([['resize', 1], ['resize', 2]]);
  });

  it('redraws at the size the screen stands at, which is not the size it started at, and drops the settling that was waiting for it: the size is not sent a second time', async () => {
    const { feed, of } = await sized(100, 20, { settleMs: 10 });
    feed.resize(120, 30);
    feed.redraw?.();
    expect(of('resize')).toEqual([['term-1', 1, 30, 119], ['term-1', 2, 30, 120]]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000);
    await flush();
    expect(of('resize')).toHaveLength(2);
  });

  it('has sent the size the screen stands at afterwards, so the same size measured again is not sent', async () => {
    const { feed, of } = await sized(100, 20, { settleMs: 10 });
    feed.redraw?.();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    await flush();
    expect(of('resize')).toHaveLength(2);
  });

  it('shortens the rows instead when there is one column: a terminal of one column has no column to spare', async () => {
    const { feed, of } = await sized(1, 10);
    feed.redraw?.();
    expect(of('resize')).toEqual([['term-1', 1, 9, 1], ['term-1', 2, 10, 1]]);
  });

  it('sends nothing for a terminal of one cell: there is no size one cell off that is a size', async () => {
    const { feed, of } = await sized(1, 1);
    feed.redraw?.();
    expect(of('resize')).toEqual([]);
  });

  it('redraws at the size the host has when the screen has measured nothing yet: a terminal that was taken over knows it from the replay', async () => {
    const { feed, pending, of } = rig({ auto: false, attach: { id: 'term-1' } });
    pending('attach')[0]?.resolve(attached({ size: { cols: 100, rows: 30 }, nextInputSeq: 5 }));
    await flush();
    feed.redraw?.();
    expect(of('resize')).toEqual([['term-1', 5, 30, 99], ['term-1', 6, 30, 100]]);
  });

  it('does nothing before it knows any size, and nothing when the session is not running: starting, ended, failed, closed, lost, or gone for the page that comes back', async () => {
    const starting = rig({ pageKey: KEY, auto: false, size: false });
    starting.feed.redraw?.();
    const unmeasured = rig({ attach: { id: 'term-1' }, attached: attached({ size: { cols: 100, rows: 30 } }) });
    unmeasured.feed.redraw?.();
    const ended = await sized(100, 20);
    ended.emit(CLOSE, { reason: 'exited', exit_code: 0, last_offset: 0 });
    ended.feed.redraw?.();
    const failed = await sized(100, 20);
    failed.emit(OUTPUT, output(9, 'gap'));
    failed.feed.redraw?.();
    const closed = await sized(100, 20);
    void closed.feed.close();
    closed.feed.redraw?.();
    const lost = await sized(100, 20);
    lost.emit(DETACHED, { by: 'taken-over', attachment: 0 });
    lost.feed.redraw?.();
    const left = await sized(100, 20);
    left.feed.leave?.();
    left.feed.redraw?.();
    expect([starting, unmeasured, ended, failed, closed, lost, left].flatMap((r) => r.of('resize'))).toEqual([]);
  });

  it('says a refusal of either call as a warning, as for any size, and the other call is not held up by it', async () => {
    const { feed, pending, of, warn } = await sized(100, 20);
    feed.redraw?.();
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    pending('resize')[1]?.resolve();
    await flush();
    expect(of('resize')).toHaveLength(2);
    expect(feed.getSnapshot().state).toBe('running');
  });
});

describe('a size the host refused, and measured again while the call was out (the leftover of T2a)', () => {
  it('is not sent again by the refusal: the same size by its columns and rows is the same size whatever object measured it, and a size that is sent again is a new measurement', async () => {
    const { feed, of, pending, warn } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    // The screen measures the same size again while the first call is still out: a new measurement of the same cells.
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    expect(of('resize')).toEqual([['term-1', 1, 20, 100]]);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    await settle();
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100]]);
    expect(warn).toHaveBeenCalledTimes(1);
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 20, 100]]);
  });

  it('is not sent again either when it was measured again several times, or with fractions that floor to it', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    feed.resize(100.7, 20.3);
    vi.advanceTimersByTime(20);
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    await settle();
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(of('resize')).toHaveLength(1);
  });

  it('still sends a different size that was measured while the refused one was out: the refusal of the first leaves the one the screen stands at to its own settling', async () => {
    const { feed, of, pending } = rig({ auto: false, settleMs: 10 });
    pending('create')[0]?.resolve();
    await settle();
    feed.resize(100, 20);
    vi.advanceTimersByTime(20);
    feed.resize(110, 21);
    vi.advanceTimersByTime(20);
    pending('resize')[0]?.reject(new Error('Failed to resize'));
    await settle();
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(of('resize')).toEqual([['term-1', 1, 20, 100], ['term-1', 2, 21, 110]]);
  });
});

describe('the shells the host tried when none could be started (SHELL_UNAVAILABLE, host #672)', () => {
  const tried: TerminalShellAttempt[] = [
    { source: 'requested', path: '/opt/bin/fish', reason: 'not-found' },
    { source: 'account', path: '/bin/zsh', reason: 'not-executable' },
    { source: 'fallback', path: '/bin/sh', reason: 'other', detail: 'permission denied' },
  ];
  const refusal = (extra: Record<string, unknown>): Error => Object.assign(new Error('shell executable unavailable: tried /opt/bin/fish: not found'), { code: 'SHELL_UNAVAILABLE' }, extra);

  it('carries the list the transport read from the refusal, in the order the host gave it, beside the words and the code', async () => {
    const { feed, pending } = rig({ auto: false });
    pending('create')[0]?.reject(refusal({ tried }));
    await flush();
    expect(feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'start', message: 'shell executable unavailable: tried /opt/bin/fish: not found', code: 'SHELL_UNAVAILABLE', tried } });
  });

  it('keeps a token it does not know as it was given: the words for it are not the feed\'s business', async () => {
    const odd = [{ source: 'a-source-from-the-future', path: '/x/sh', reason: 'a-reason-from-the-future' }];
    const { feed, pending } = rig({ auto: false });
    pending('create')[0]?.reject(refusal({ tried: odd }));
    await flush();
    expect(feed.getSnapshot().cause?.tried).toEqual(odd);
  });

  it('has no list when the refusal carries none, or an empty one: no member at all', async () => {
    for (const extra of [{}, { tried: [] }]) {
      const { feed, pending } = rig({ auto: false });
      pending('create')[0]?.reject(refusal(extra));
      await flush();
      expect(feed.getSnapshot().cause).toEqual({ stage: 'start', message: 'shell executable unavailable: tried /opt/bin/fish: not found', code: 'SHELL_UNAVAILABLE' });
      expect(feed.getSnapshot().cause).not.toHaveProperty('tried');
    }
  });

  it('is carried by a refusal to take a terminal over as it is by a refusal to start one: the cause is the cause', async () => {
    const { feed, pending } = rig({ auto: false, attach: { id: 'term-1' } });
    pending('attach')[0]?.reject(refusal({ tried }));
    await flush();
    expect(feed.getSnapshot().cause?.tried).toEqual(tried);
  });
});

describe('the terminals the host lists for a page key (`ListTerminals`)', () => {
  const listed = (id: string, name: string | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    created_at: '2026-11-23T10:00:00Z',
    pid: 4242,
    shell: name === undefined ? {} : { path: `/bin/${name}`, name },
    labels: {},
    params: {},
    size: { cols: 80, rows: 24 },
    attached: false,
    next_offset: 0,
    replay_start: 0,
    next_input_seq: 1,
    lease_expires_unix_ms: 0,
    ...extra,
  });

  it('reads the id and the shell\'s name of each, in the order the host gave them (by creation)', () => {
    expect(listedOf([listed('a', 'zsh'), listed('b', 'bash'), listed('c', 'zsh')])).toEqual([{ id: 'a', program: 'zsh' }, { id: 'b', program: 'bash' }, { id: 'c', program: 'zsh' }]);
  });

  it('says no program for a terminal whose shell has no usable name, and trims one that has', () => {
    expect(listedOf([listed('a', undefined), listed('b', '  bash '), listed('c', '   ')])).toEqual([{ id: 'a' }, { id: 'b', program: 'bash' }, { id: 'c' }]);
  });

  it('reads no input number of a listing: a page continues the count from the answer to its attach, since the window that holds the terminal can write between the list and the attach, and the host refuses the number the listing stated then as stale', () => {
    const end = { reason: 'exited', exit_code: 0, last_offset: 0 };
    const answer = listedOf([listed('a', 'zsh', { next_input_seq: 12 }), listed('b', 'bash', { next_input_seq: 0, ended: end })]);
    expect(answer).toEqual([{ id: 'a', program: 'zsh' }, { id: 'b', program: 'bash', ended: true }]);
    expect(JSON.stringify(answer)).not.toMatch(/seq/i);
  });

  it('skips what is not a terminal: no id, an id that is not text or is empty, not an object', () => {
    expect(listedOf([null, 7, 'x', {}, { id: 7 }, { id: '' }, { id: '  ' }, listed('ok', 'zsh')])).toEqual([{ id: 'ok', program: 'zsh' }]);
  });

  it('says a terminal ended when the host lists how it ended, and says nothing of it for one that runs: a terminal whose shell ended while no page held it is listed with its end', () => {
    const ended = { reason: 'exited', exit_code: 7, last_offset: 208 };
    const answer = listedOf([listed('a', 'zsh'), listed('b', 'bash', { ended }), listed('c', 'zsh', { ended: null }), listed('d', undefined, { ended })]);
    expect(answer).toEqual([{ id: 'a', program: 'zsh' }, { id: 'b', program: 'bash', ended: true }, { id: 'c', program: 'zsh' }, { id: 'd', ended: true }]);
    expect(answer[0]).not.toHaveProperty('ended');
    expect(answer[2]).not.toHaveProperty('ended');
  });

  it('is empty for an answer that is not a list', () => {
    for (const answer of [undefined, null, {}, 'a', 7, { id: 'a' }]) {
      expect(listedOf(answer)).toEqual([]);
    }
  });
});

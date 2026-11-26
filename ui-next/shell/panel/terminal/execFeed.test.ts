import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MAX_INPUT_BYTES, MAX_KEPT_INPUT_BYTES } from './channel';
import { offersTakeBack } from './feed';
import { laneOf } from './state';
import { RECONNECT_DELAYS_MS, createExecFeed, listedOf, type ExecAttach, type ExecFeed } from './execFeed';
import type { TerminalFeedHandle, TerminalModes, TerminalReplay, TerminalShellAttempt } from './feed';
import { fakeChannels, goneError, type FakeChannels, type FakeChannelsOptions, type FakeStream, type ReadyInit } from './testing';

// The feed of a terminal over the terminal channel (docs/ui-next/terminal-channel-protocol.md), against a fake host the test speaks for frame by frame (`fakeChannels`, testing.ts). The feed is where the rules of a
// terminal's wire live: it makes the terminal at the first size the view measured, treats every byte of a terminal it made as live (nothing replayed, nothing muted) and gives a terminal it attaches to the replay the
// host's `ready` states, acknowledges what the reader parsed of what the shell wrote LIVE and nothing else, connects again from the offset it has applied up to, says what a `gap` made of the reader's screen, puts what
// was typed in order after `ready`, and ends the terminal exactly once (dismissed when it ended by itself). No test waits for a clock: the timers are fake and the answers are promises the test holds.

const turns = async (count = 8): Promise<void> => {
  for (let turn = 0; turn < count; turn += 1) {
    await Promise.resolve();
  }
};

const PLAIN: TerminalModes = { altScreen: false, bracketedPaste: false, applicationCursor: false, focusEvents: false, cursorHidden: false, mouseTracking: 0, mouseEncoding: 0, kittyKeyboard: [] };
const bytes = (value: string): number[] => [...new TextEncoder().encode(value)];

type RigOptions = {
  readonly channels?: FakeChannelsOptions;
  readonly attach?: ExecAttach;
  readonly settleMs?: number;
  readonly leaseMs?: number;
  readonly launch?: { readonly command: readonly string[]; readonly cwd?: string; readonly env?: Readonly<Record<string, string>> };
  readonly startNote?: 'home-for-unknown-directory';
  readonly homeIfMissing?: boolean;
  readonly delays?: readonly number[];
};

type Rig = {
  readonly feed: ExecFeed;
  readonly channels: FakeChannels;
  readonly stream: () => FakeStream;
  readonly warn: Mock<(message: string, error?: unknown) => void>;
  /** How many times the listeners of the feed were told. */
  readonly wakes: () => number;
};

function rig(options: RigOptions = {}): Rig {
  const channels = fakeChannels(options.channels);
  const warn = vi.fn<(message: string, error?: unknown) => void>();
  const feed = createExecFeed({
    channels,
    newId: () => 'term-1',
    warn,
    settleMs: options.settleMs ?? 100,
    ...(options.attach === undefined ? {} : { attach: options.attach }),
    ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
    ...(options.launch === undefined ? {} : { launch: options.launch }),
    ...(options.startNote === undefined ? {} : { startNote: options.startNote }),
    ...(options.homeIfMissing === true ? { homeIfMissing: true } : {}),
    ...(options.delays === undefined ? {} : { reconnectDelaysMs: options.delays }),
  });
  let wakes = 0;
  feed.subscribe(() => {
    wakes += 1;
  });
  return { feed, channels, warn, stream: () => channels.stream(), wakes: () => wakes };
}

/** A feed that made its terminal at 80 by 24, whose stream is open and has not said `ready`. */
async function connecting(options: RigOptions = {}): Promise<Rig> {
  const r = rig(options);
  r.feed.resize(80, 24);
  await turns();
  return r;
}

/** A feed that made its terminal and whose host said `ready`. */
async function running(init: ReadyInit = {}, options: RigOptions = {}): Promise<Rig> {
  const r = await connecting(options);
  r.stream().ready(init);
  return r;
}

/** A feed that made its terminal and was closed before it opened a stream: it holds nothing but the capability, which nobody else can hold. */
async function madeWithNoStream(options: RigOptions = {}): Promise<Rig> {
  const created = Promise.withResolvers<unknown>();
  const r = rig({ ...options, channels: { ...options.channels, create: async () => created.promise } });
  r.feed.resize(80, 24);
  await turns();
  const closing = r.feed.close();
  created.resolve({});
  await Promise.resolve(closing).catch(() => undefined);
  return { ...r, feed: { ...r.feed, close: async () => closing } };
}

/** A feed that attaches to `term-1` (a page after a reload): its stream is open and has not said `ready`. */
function attaching(attach: Partial<ExecAttach> = {}, options: RigOptions = {}): Rig {
  return rig({ ...options, attach: { id: 'term-1', ...attach } });
}

/** Closes a feed that holds a live stream: the close goes on the stream, and the host answers with the end. */
async function closeLive(r: Rig): Promise<void> {
  const closing = r.feed.close();
  if (r.stream().open()) {
    r.stream().ended({ reason: 'closed', closed_by: 'request', last_offset: 0 });
  }

  await closing;
}

/** What a reader gets of the feed's output, as text. */
const readText = (feed: TerminalFeedHandle, max?: number): string => feed.read(max).chunks.map((chunk) => new TextDecoder().decode(chunk)).join('');

function replayOf(feed: TerminalFeedHandle): TerminalReplay {
  const replay = feed.takeReplay?.();
  expect(replay, 'the feed has a replay to give').toBeDefined();
  return replay!;
}

/** The feed connects again after `ms`: the stream it opened. */
function reconnect(r: Rig, ms = 250): FakeStream {
  const before = r.channels.streams().length;
  vi.advanceTimersByTime(ms);
  expect(r.channels.streams()).toHaveLength(before + 1);
  return r.stream();
}

/** The sum of the acknowledgements a stream carried. */
const acked = (stream: FakeStream): number => stream.acks().reduce((sum, count) => sum + count, 0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('making a terminal', () => {
  it('waits for the first measured size and makes the terminal at it, once, with the lease it was given', async () => {
    const r = rig({ leaseMs: 60_000 });
    await turns();
    expect(r.channels.calls()).toEqual([]);
    expect(r.feed.getSnapshot()).toEqual({ state: 'starting' });
    r.feed.resize(100, 30);
    r.feed.resize(120, 40);
    await turns();
    expect(r.channels.of('create')).toEqual([{ kind: 'create', id: 'term-1', cols: 100, rows: 30, leaseMs: 60_000 }]);
  });

  it('asks for the shell, directory and environment of its launch, and for none when it has none', async () => {
    const r = rig({ launch: { command: ['/usr/bin/zsh'], cwd: '/work', env: { A: '1' } } });
    r.feed.resize(100, 30);
    await turns();
    expect(r.channels.of('create')).toEqual([{ kind: 'create', id: 'term-1', cols: 100, rows: 30, leaseMs: undefined, command: ['/usr/bin/zsh'], cwd: '/work', env: { A: '1' } }]);
    const plain = rig();
    plain.feed.resize(100, 30);
    await turns();
    expect(plain.channels.of('create')[0]).not.toHaveProperty('command');
  });

  it('names its own id: the one the caller supplies, and a different one for each feed by default', () => {
    const channels = fakeChannels();
    const one = createExecFeed({ channels, warn: vi.fn() });
    const two = createExecFeed({ channels, warn: vi.fn() });
    expect(one.id).not.toBe('');
    expect(one.id).not.toBe(two.id);
    expect(rig().feed.id).toBe('term-1');
  });

  it('takes no size that is not a size: whole cells, 1 to 1,000 on each side', async () => {
    const r = rig();
    for (const [cols, rows] of [[0, 24], [80, 0], [1001, 24], [80, 1001], [Number.NaN, 24], [-3, 24]] as const) {
      r.feed.resize(cols, rows);
    }

    await turns();
    expect(r.channels.calls()).toEqual([]);
    r.feed.resize(80.9, 24.2);
    await turns();
    expect(r.channels.of('create')).toMatchObject([{ cols: 80, rows: 24 }]);
  });

  it('opens its stream once the host made the terminal, asking from offset 0, and is running when the host says ready, named by its shell', async () => {
    const created = Promise.withResolvers<unknown>();
    const r = rig({ channels: { create: async () => created.promise } });
    r.feed.resize(80, 24);
    await turns();
    expect(r.channels.streams()).toHaveLength(0);
    created.resolve({ shell: { name: 'bash' } });
    await turns();
    expect(r.channels.streams()).toHaveLength(1);
    expect(r.stream().id).toBe('term-1');
    expect(r.stream().fromOffset).toBe(0);
    expect(r.feed.getSnapshot()).toEqual({ state: 'starting' });
    r.stream().ready({ shell: 'zsh' });
    expect(r.feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh' });
  });

  it('is running with no program when the host names no shell', async () => {
    const r = await running({ raw: { session: undefined } }, { channels: { create: () => ({}) } });
    expect(r.feed.getSnapshot()).toEqual({ state: 'running' });
  });

  it('tells its listeners when the status changes, and gives the same object until it does', async () => {
    const r = await connecting();
    const before = r.feed.getSnapshot();
    expect(r.feed.getSnapshot()).toBe(before);
    const wakes = r.wakes();
    r.stream().ready();
    expect(r.wakes()).toBe(wakes + 1);
    expect(r.feed.getSnapshot()).not.toBe(before);
    expect(r.feed.getSnapshot()).toBe(r.feed.getSnapshot());
  });

  it('fails when the host refused to make the terminal, in its words and its code, and opens no stream and takes no later size', async () => {
    const r = rig({ channels: { create: async () => Promise.reject(Object.assign(new Error('no pty for you'), { code: 'RESOURCE_EXHAUSTED' })) } });
    r.feed.resize(80, 24);
    await turns();
    expect(r.feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'start', message: 'no pty for you', code: 'RESOURCE_EXHAUSTED' } });
    expect(r.channels.streams()).toHaveLength(0);
    r.feed.resize(100, 30);
    await turns();
    expect(r.channels.of('create')).toHaveLength(1);
  });

  describe('when the host tried shells and none could be started (SHELL_UNAVAILABLE, host #672)', () => {
    const tried: TerminalShellAttempt[] = [
      { source: 'requested', path: '/opt/bin/fish', reason: 'not-found' },
      { source: 'account', path: '/bin/zsh', reason: 'not-executable' },
      { source: 'fallback', path: '/bin/sh', reason: 'other', detail: 'permission denied' },
    ];
    const refusal = (extra: Record<string, unknown>): Error => Object.assign(new Error('shell executable unavailable: tried /opt/bin/fish: not found'), { code: 'SHELL_UNAVAILABLE' }, extra);
    const failure = async (extra: Record<string, unknown>) => {
      const r = rig({ channels: { create: async () => Promise.reject(refusal(extra)) } });
      r.feed.resize(80, 24);
      await turns();
      return r.feed.getSnapshot();
    };

    it('carries the list the host read from the refusal, in the order it gave it, beside the words and the code', async () => {
      expect(await failure({ tried })).toEqual({ state: 'failed', cause: { stage: 'start', message: 'shell executable unavailable: tried /opt/bin/fish: not found', code: 'SHELL_UNAVAILABLE', tried } });
    });

    it('keeps a token it does not know as it was given', async () => {
      const odd = [{ source: 'a-source-from-the-future', path: '/x/sh', reason: 'a-reason-from-the-future' }];
      expect((await failure({ tried: odd })).cause?.tried).toEqual(odd);
    });

    it('has no list when the refusal carries none, or an empty one: no member at all', async () => {
      for (const extra of [{}, { tried: [] }]) {
        const cause = (await failure(extra)).cause;
        expect(cause).toEqual({ stage: 'start', message: 'shell executable unavailable: tried /opt/bin/fish: not found', code: 'SHELL_UNAVAILABLE' });
        expect(cause).not.toHaveProperty('tried');
      }
    });
  });
});

describe('the first frame of the host (`ready`)', () => {
  it('turns the host\'s window on at once with an acknowledgement of nothing, before anything else the feed sends', async () => {
    const r = await connecting();
    r.feed.write('ls\r');
    r.feed.resize(100, 30);
    vi.advanceTimersByTime(100);
    expect(r.stream().sent()).toEqual([]);
    r.stream().ready();
    expect(r.stream().sent()[0]).toEqual({ kind: 'ack', bytes: 0 });
  });

  it('fails in words when the host\'s ready cannot be read, and closes the stream: no size, a size that is not one, not an object', async () => {
    for (const raw of [{ size: undefined }, { size: { cols: 0, rows: 24 } }, { size: 'big' }, { start: 'zero' }, { end: -1 }, { start: 5, end: 3 }, { lost: 'many' }]) {
      const r = await connecting();
      r.stream().ready({ raw });
      expect(r.feed.getSnapshot()).toMatchObject({ state: 'failed', cause: { stage: 'start', message: expect.stringContaining('not understood') as string } });
      expect(r.stream().closedByFeed()).toBe(true);
    }
  });

  it('fails when the host sends output before it said ready: it is not the host of this protocol', async () => {
    const r = await connecting();
    r.stream().output(0, 'early');
    expect(r.feed.getSnapshot().state).toBe('failed');
    expect(r.stream().closedByFeed()).toBe(true);
  });
});

describe('what the shell writes, in a terminal the feed made', () => {
  it('is live from its first byte: nothing is replayed to it and nothing is muted, though the shell wrote before the stream was ready', async () => {
    const r = await running({ start: 0, end: 5 });
    r.stream().output(0, 'hello');
    expect(r.feed.takeReplay?.()).toBeUndefined();
    expect(readText(r.feed)).toBe('hello');
  });

  it('holds it as it came, in order, and wakes the listeners once until the reader has read', async () => {
    const r = await running();
    const before = r.wakes();
    r.stream().output(0, 'a');
    r.stream().output(1, 'b');
    r.stream().output(2, 'c');
    expect(r.wakes()).toBe(before + 1);
    expect(readText(r.feed)).toBe('abc');
    r.stream().output(3, 'd');
    expect(r.wakes()).toBe(before + 2);
  });

  it('gives whole chunks up to a count, at least one, and keeps the rest for the next read, with no wake-up of its own', async () => {
    const r = await running();
    for (const [offset, text] of [[0, 'aaaa'], [4, 'bbbb'], [8, 'cccc']] as const) {
      r.stream().output(offset, text);
    }

    const wakes = r.wakes();
    expect(r.feed.read(1).chunks.map((chunk) => [...chunk])).toEqual([bytes('aaaa')]);
    expect(r.feed.read(5).chunks.map((chunk) => [...chunk])).toEqual([bytes('bbbb'), bytes('cccc')]);
    expect(r.feed.read().chunks).toEqual([]);
    expect(r.wakes()).toBe(wakes);
  });

  it('keeps the bytes of a frame as they came: a character cut between two frames is the emulator\'s to join', async () => {
    const r = await running();
    r.stream().output(0, new Uint8Array([0xe2, 0x82]));
    r.stream().output(2, new Uint8Array([0xac]));
    expect(r.feed.read().chunks.map((chunk) => [...chunk])).toEqual([[0xe2, 0x82], [0xac]]);
  });

  it('fails in words, and closes the stream, when a frame does not continue where the one before ended: the screen would show a hole', async () => {
    const r = await running();
    r.stream().output(0, 'abc');
    r.stream().output(7, 'xyz');
    expect(r.feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'Some of the terminal\'s output did not arrive.' } });
    expect(r.stream().closedByFeed()).toBe(true);
    expect(r.warn).toHaveBeenCalledTimes(1);
    expect(readText(r.feed)).toBe('abc');
  });

  it('holds nothing for a feed that was closed', async () => {
    const r = await running();
    r.stream().output(0, 'abc');
    await closeLive(r);
    expect(r.feed.read()).toEqual({ chunks: [], bytes: 0 });
  });
});

describe('acknowledging what the reader parsed', () => {
  it('sends the live bytes the reader acknowledges, as the reader gives them, and nothing for a count that is not one', async () => {
    const r = await running();
    r.stream().output(0, 'abcdef');
    r.feed.read();
    r.feed.ack(4);
    r.feed.ack(2);
    r.feed.ack(0);
    r.feed.ack(-3);
    r.feed.ack(Number.NaN);
    r.stream().output(6, 'gh');
    r.feed.read();
    r.feed.ack(2.9);
    expect(r.stream().acks()).toEqual([0, 4, 2, 2]);
  });

  it('acknowledges the bytes of a replay as they arrive (the host counts every output frame against its window) and none of a gap, and the reader\'s own acknowledgements only for live bytes', async () => {
    const r = attaching();
    r.stream().ready({ start: 0, end: 6 });
    r.stream().output(0, 'abc');
    r.stream().output(3, 'def');
    expect(acked(r.stream())).toBe(6);
    r.stream().output(6, 'live');
    expect(replayOf(r.feed).data).toEqual(new Uint8Array(bytes('abcdef')));
    expect(readText(r.feed)).toBe('live');
    r.feed.ack(4);
    expect(r.stream().acks()).toEqual([0, 3, 3, 4]);
    r.stream().gap(10, 50);
    expect(acked(r.stream())).toBe(10);
  });

  it('completes a replay of 2 MiB against a host whose window is 1 MiB: the host sends only while sent less acknowledged fits the window, and every replay byte it sent is credited', async () => {
    const WINDOW = 1_048_576;
    const FRAME = 65_536;
    const TOTAL = 2 * WINDOW;
    const r = attaching();
    r.stream().ready({ start: 0, end: TOTAL });
    let sent = 0;
    const stream = r.stream();
    for (let guard = 0; guard < 1_000 && sent < TOTAL; guard += 1) {
      if (sent - acked(stream) + FRAME > WINDOW) {
        break;
      }

      stream.output(sent, new Uint8Array(FRAME));
      sent += FRAME;
    }

    expect(sent).toBe(TOTAL);
    expect(replayOf(r.feed).data).toHaveLength(TOTAL);
    // The whole replay is credited, so the host has its window back for the first live frame.
    expect(acked(stream)).toBe(TOTAL);
  });

  it('sends nothing for a feed that was closed, that left, or whose session is over', async () => {
    const over = await running();
    over.stream().output(0, 'abc');
    over.stream().ended();
    over.feed.ack(3);
    expect(over.stream().dropped()).toBe(0);
    expect(over.stream().acks()).toEqual([0]);

    const gone = await running();
    gone.stream().output(0, 'abc');
    await closeLive(gone);
    gone.feed.ack(3);
    // What the stream had delivered and was not credited is credited when the close goes on it, and nothing after the feed was closed.
    expect(gone.stream().acks()).toEqual([0, 3]);

    const left = await running();
    left.stream().output(0, 'abc');
    left.feed.leave?.();
    left.feed.ack(3);
    expect(left.stream().acks()).toEqual([0]);
  });
});

describe('what the user types', () => {
  it('goes out at once as input frames once the stream is ready, in the order it was typed', async () => {
    const r = await running();
    r.feed.write('l');
    r.feed.write('s');
    r.feed.write('\r');
    expect(r.stream().typed()).toBe('ls\r');
    expect(r.stream().sent().filter((frame) => frame.kind === 'input')).toHaveLength(3);
  });

  it('waits for the stream to be ready when it is typed before: while the terminal is being made, and before `ready`, and goes after the acknowledgement of nothing, in order', async () => {
    const created = Promise.withResolvers<unknown>();
    const r = rig({ channels: { create: async () => created.promise } });
    r.feed.resize(80, 24);
    r.feed.write('ec');
    await turns();
    created.resolve({});
    await turns();
    r.feed.write('ho');
    expect(r.stream().sent()).toEqual([]);
    r.stream().ready();
    expect(r.stream().sent().map((frame) => frame.kind)).toEqual(['ack', 'input']);
    expect(r.stream().typed()).toBe('echo');
  });

  it('counts the calls that had something typed in them, and not an empty one', async () => {
    const r = await running();
    r.feed.write('a');
    r.feed.write('');
    r.feed.write('b');
    expect(r.feed.inputs?.()).toBe(2);
    expect(r.stream().typed()).toBe('ab');
  });

  it('cuts a paste into frames of at most MAX_INPUT_BYTES, in order, and never inside a character', async () => {
    const r = await running();
    const paste = `${'€'.repeat(30_000)}x${'é'.repeat(40_000)}`;
    r.feed.write(paste);
    const frames = r.stream().sent().flatMap((frame) => (frame.kind === 'input' ? [frame] : []));
    expect(frames.length).toBeGreaterThan(2);
    for (const frame of frames) {
      expect(frame.bytes.length).toBeLessThanOrEqual(MAX_INPUT_BYTES);
      expect(frame.text).not.toContain('\uFFFD');
    }

    expect(r.stream().typed()).toBe(paste);
  });

  it('sends a paste of exactly MAX_INPUT_BYTES as one frame', async () => {
    const r = await running();
    r.feed.write('a'.repeat(MAX_INPUT_BYTES));
    expect(r.stream().sent().filter((frame) => frame.kind === 'input')).toHaveLength(1);
  });

  it('arrives after `ready`, in order, on the stream that was connected again, when it was typed while the feed was reconnecting', async () => {
    const r = await running();
    r.feed.write('one');
    r.stream().drop();
    r.feed.write('two');
    r.feed.write('three');
    reconnect(r);
    const again = r.stream();
    expect(again.sent()).toEqual([]);
    again.ready({ inputApplied: 3 });
    expect(again.sent().map((frame) => frame.kind)).toEqual(['ack', 'input']);
    expect(again.typed()).toBe('twothree');
    expect(r.channels.streams()[0]?.typed()).toBe('one');
  });

  it('keeps what was typed after the socket died but before its close was told, and sends it on the next stream after ready, in order, once', async () => {
    const r = await running();
    r.feed.write('one');
    const first = r.stream();
    first.die();
    r.feed.write('two');
    r.feed.write('three');
    expect(first.typed()).toBe('one');
    expect(r.channels.streams()).toHaveLength(1);
    const again = reconnect(r);
    expect(again.sent()).toEqual([]);
    again.ready({ inputApplied: 3 });
    expect(again.typed()).toBe('twothree');
    expect(again.sent().filter((frame) => frame.kind === 'input')).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(2);
    expect(r.feed.inputs?.()).toBe(3);
  });

  it('keeps a paste of three pieces that the link refuses part of the way, and sends it whole and in order on the next stream', async () => {
    const r = await running();
    const piece = (letter: string): string => letter.repeat(MAX_INPUT_BYTES);
    const paste = piece('a') + piece('b') + piece('c');
    const first = r.stream();
    // The socket dies after the first piece went: the second is refused.
    r.feed.write(piece('a'));
    first.die();
    r.feed.write(piece('b') + piece('c'));
    expect(first.typed()).toHaveLength(MAX_INPUT_BYTES);
    const again = reconnect(r);
    again.ready({ inputApplied: MAX_INPUT_BYTES });
    expect(again.typed()).toBe(piece('b') + piece('c'));
    expect(first.typed() + again.typed()).toBe(paste);
    expect(again.sent().filter((frame) => frame.kind === 'input').map((frame) => (frame.kind === 'input' ? frame.bytes.length : 0))).toEqual([MAX_INPUT_BYTES, MAX_INPUT_BYTES]);
  });

  it('keeps the refused frame and the suffix of ONE paste whose first frame went: the next stream gets exactly those, once and in order', async () => {
    const r = await running();
    const piece = (letter: string): string => letter.repeat(MAX_INPUT_BYTES);
    const first = r.stream();
    first.dieAfterInputs(1);
    r.feed.write(piece('a') + piece('b') + piece('c') + 'd');
    expect(first.typed()).toBe(piece('a'));
    const again = reconnect(r);
    again.ready({ inputApplied: MAX_INPUT_BYTES });
    expect(again.typed()).toBe(piece('b') + piece('c') + 'd');
    again.applied(MAX_INPUT_BYTES * 3 + 1);
    expect(r.feed.inputsSettled?.()).toBe(true);
  });

  it('drops a size and an acknowledgement sent on a dead link: the next stream sends the size the screen wants', async () => {
    const r = await running();
    r.stream().die();
    r.feed.resize(120, 40);
    vi.advanceTimersByTime(100);
    const again = reconnect(r);
    again.ready({ size: { cols: 80, rows: 24 } });
    expect(again.sent()).toEqual([{ kind: 'ack', bytes: 0 }, { kind: 'resize', cols: 120, rows: 40 }]);
  });

  it('is ignored once the session is over, closed, or left: not counted, not sent', async () => {
    for (const end of ['ended', 'closed', 'left', 'taken-over', 'not-found'] as const) {
      const r = await running();
      r.feed.write('a');
      if (end === 'ended') {
        r.stream().ended();
      } else if (end === 'closed') {
        await closeLive(r);
      } else if (end === 'left') {
        r.feed.leave?.();
      } else if (end === 'taken-over') {
        r.stream().takenOver();
      } else {
        r.stream().notFound();
      }

      r.feed.write('b');
      expect(r.feed.inputs?.()).toBe(1);
      expect(r.stream().typed()).toBe('a');
    }
  });

  it('says what is settled: nothing waits in the feed and nothing waits in the link', async () => {
    const r = await connecting();
    expect(r.feed.inputsSettled?.()).toBe(true);
    r.feed.write('a');
    expect(r.feed.inputsSettled?.()).toBe(false);
    r.stream().ready();
    expect(r.feed.inputsSettled?.()).toBe(false);
    r.stream().applied(1);
    expect(r.feed.inputsSettled?.()).toBe(true);
    r.stream().setPending(3);
    expect(r.feed.inputsSettled?.()).toBe(false);
    r.stream().setPending(0);
    expect(r.feed.inputsSettled?.()).toBe(true);
  });

  it('is settled for a session that is over, whatever waited', async () => {
    const r = await connecting();
    r.feed.write('a');
    r.stream().notFound();
    expect(r.feed.inputsSettled?.()).toBe(true);
  });
});

describe('the size of the screen', () => {
  it('goes once it stood still: a drag is one frame, cols and rows together', async () => {
    const r = await running();
    r.feed.resize(90, 30);
    vi.advanceTimersByTime(60);
    r.feed.resize(95, 31);
    vi.advanceTimersByTime(60);
    r.feed.resize(100, 32);
    expect(r.stream().sent().filter((frame) => frame.kind === 'resize')).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(r.stream().sent().filter((frame) => frame.kind === 'resize')).toEqual([{ kind: 'resize', cols: 100, rows: 32 }]);
  });

  it('is not sent again when it is the size the host has, the ready\'s or the last sent', async () => {
    const r = await running();
    r.feed.resize(80, 24);
    vi.advanceTimersByTime(100);
    r.feed.resize(90, 20);
    vi.advanceTimersByTime(100);
    r.feed.resize(90, 20);
    vi.advanceTimersByTime(100);
    expect(r.stream().sent().filter((frame) => frame.kind === 'resize')).toEqual([{ kind: 'resize', cols: 90, rows: 20 }]);
  });

  it('is sent once the stream is ready when the screen measured another size than the terminal has: the one the terminal was made at is not sent again', async () => {
    const r = await connecting();
    r.feed.resize(100, 30);
    vi.advanceTimersByTime(100);
    expect(r.stream().sent()).toEqual([]);
    r.stream().ready({ size: { cols: 80, rows: 24 } });
    expect(r.stream().sent()).toEqual([{ kind: 'ack', bytes: 0 }, { kind: 'resize', cols: 100, rows: 30 }]);
  });

  it('goes after `ready` of the stream that was connected again, when the screen changed while the feed was reconnecting', async () => {
    const r = await running();
    r.stream().drop();
    r.feed.resize(120, 40);
    reconnect(r);
    const again = r.stream();
    vi.advanceTimersByTime(100);
    expect(again.sent()).toEqual([]);
    again.ready({ size: { cols: 80, rows: 24 } });
    expect(again.sent()).toEqual([{ kind: 'ack', bytes: 0 }, { kind: 'resize', cols: 120, rows: 40 }]);
  });

  it('is brought back to the size the screen has when the host says another at `ready`: whoever held the terminal meanwhile may have changed it, and the host\'s own is what is in force until then', async () => {
    const r = await running();
    r.stream().drop();
    reconnect(r);
    r.stream().ready({ size: { cols: 132, rows: 50 } });
    expect(r.stream().sent().filter((frame) => frame.kind === 'resize')).toEqual([{ kind: 'resize', cols: 80, rows: 24 }]);
    r.feed.resize(80, 24);
    vi.advanceTimersByTime(100);
    expect(r.stream().sent().filter((frame) => frame.kind === 'resize')).toHaveLength(1);
  });

  it('is ignored once the session is over', async () => {
    const r = await running();
    r.stream().ended();
    r.feed.resize(90, 30);
    vi.advanceTimersByTime(100);
    expect(r.stream().dropped()).toBe(0);
    expect(r.stream().sent().filter((frame) => frame.kind === 'resize')).toEqual([]);
  });

  it('draws a full-screen program again by two sizes, one cell off and then the size, at once', async () => {
    const r = await running({ size: { cols: 80, rows: 24 } });
    r.feed.redraw?.();
    expect(r.stream().sent().filter((frame) => frame.kind === 'resize')).toEqual([{ kind: 'resize', cols: 79, rows: 24 }, { kind: 'resize', cols: 80, rows: 24 }]);
  });

  it('draws again at the size the screen measured when it is not the one the host has, and off by a row for a terminal of one column', async () => {
    const r = await running({ size: { cols: 80, rows: 24 } });
    r.feed.resize(1, 10);
    vi.advanceTimersByTime(100);
    r.feed.redraw?.();
    expect(r.stream().sent().filter((frame) => frame.kind === 'resize').slice(1)).toEqual([{ kind: 'resize', cols: 1, rows: 9 }, { kind: 'resize', cols: 1, rows: 10 }]);
  });

  it('sends nothing for a redraw of a terminal of one cell, of one that is not running, or before the stream is ready', async () => {
    const tiny = rig();
    tiny.feed.resize(1, 1);
    await turns();
    tiny.stream().ready({ size: { cols: 1, rows: 1 } });
    tiny.feed.redraw?.();
    expect(tiny.stream().sent().filter((frame) => frame.kind === 'resize')).toEqual([]);

    const early = await connecting();
    early.feed.redraw?.();
    early.stream().ready();
    expect(early.stream().sent().filter((frame) => frame.kind === 'resize')).toEqual([]);

    const over = await running();
    over.stream().ended();
    over.feed.redraw?.();
    expect(over.stream().sent().filter((frame) => frame.kind === 'resize')).toEqual([]);
  });
});

describe('a terminal the feed attaches to (a page after a reload, a take-back)', () => {
  it('connects at once, with nothing applied, and without a size: a size does not make another terminal', async () => {
    const r = attaching({ program: 'zsh' });
    expect(r.feed.id).toBe('term-1');
    expect(r.channels.streams()).toHaveLength(1);
    expect(r.stream().fromOffset).toBeUndefined();
    expect(r.feed.getSnapshot()).toEqual({ state: 'starting', program: 'zsh' });
    r.feed.resize(100, 30);
    await turns();
    expect(r.channels.of('create')).toEqual([]);
  });

  it('gives the bytes of `[start, end)` as one replay with the sizes and modes they were written under and those in force at its end, and the reader takes it once', async () => {
    const r = attaching();
    r.stream().ready({
      start: 10,
      end: 15,
      size: { cols: 100, rows: 30 },
      startSize: { cols: 80, rows: 24 },
      modes: { alt_screen: true, mouse_tracking: 1, kitty_keyboard: [1, 3] },
      startModes: { bracketed_paste: true },
    });
    expect(r.feed.takeReplay?.()).toBeUndefined();
    r.stream().output(10, 'he');
    expect(r.feed.takeReplay?.()).toBeUndefined();
    r.stream().output(12, 'llo');
    expect(replayOf(r.feed)).toEqual({
      data: new Uint8Array(bytes('hello')),
      startSize: { cols: 80, rows: 24 },
      startModes: { ...PLAIN, bracketedPaste: true },
      size: { cols: 100, rows: 30 },
      modes: { ...PLAIN, altScreen: true, mouseTracking: 1, kittyKeyboard: [1, 3] },
      end: 15,
    });
    expect(r.feed.takeReplay?.()).toBeUndefined();
  });

  it('has the replay at once when the host kept nothing, with the sizes and modes: the terminal is only brought to where it is', async () => {
    const r = attaching();
    r.stream().ready({ start: 7, end: 7, modes: { alt_screen: true } });
    expect(replayOf(r.feed)).toMatchObject({ data: new Uint8Array(0), end: 7, modes: { ...PLAIN, altScreen: true } });
  });

  it('wakes the reader when the replay is complete, and gives no live output before it is taken: it is read first, muted', async () => {
    const r = attaching();
    r.stream().ready({ start: 0, end: 4 });
    const wakes = r.wakes();
    r.stream().output(0, 'old!');
    expect(r.wakes()).toBeGreaterThan(wakes);
    r.stream().output(4, 'live');
    expect(r.feed.read()).toEqual({ chunks: [], bytes: 0 });
    replayOf(r.feed);
    expect(readText(r.feed)).toBe('live');
  });

  it('is running at `ready`, named by the shell the host says, or the one the listing named when it says none', async () => {
    const named = attaching({ program: 'fish' });
    named.stream().ready({ shell: 'zsh' });
    expect(named.feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh' });
    const listed = attaching({ program: 'fish' });
    listed.stream().ready({ raw: { session: undefined } });
    expect(listed.feed.getSnapshot()).toEqual({ state: 'running', program: 'fish' });
  });

  it('is brought to its size when the screen measured another before `ready`', async () => {
    const r = attaching();
    r.feed.resize(100, 30);
    vi.advanceTimersByTime(100);
    r.stream().ready({ size: { cols: 80, rows: 24 } });
    expect(r.stream().sent()).toEqual([{ kind: 'ack', bytes: 0 }, { kind: 'resize', cols: 100, rows: 30 }]);
  });

  it('asks again with nothing applied when its stream drops before the replay is complete: a part of a replay is not the terminal', async () => {
    const r = attaching();
    r.stream().ready({ start: 0, end: 6 });
    r.stream().output(0, 'abc');
    r.stream().drop();
    reconnect(r);
    expect(r.channels.streams()).toHaveLength(2);
    expect(r.stream().fromOffset).toBeUndefined();
    r.stream().ready({ start: 0, end: 6 });
    r.stream().output(0, 'abcdef');
    expect(replayOf(r.feed).data).toEqual(new Uint8Array(bytes('abcdef')));
  });

  it('fails when a frame of the replay goes past its end, and accepts one that ends exactly at it', async () => {
    const over = attaching();
    over.stream().ready({ start: 0, end: 4 });
    over.stream().output(0, 'abcde');
    expect(over.feed.getSnapshot().state).toBe('failed');
    const exact = attaching();
    exact.stream().ready({ start: 0, end: 4 });
    exact.stream().output(0, 'abcd');
    expect(exact.feed.getSnapshot().state).toBe('running');
    expect(replayOf(exact.feed)).toMatchObject({ data: new Uint8Array(bytes('abcd')), end: 4 });
  });

  it('fails in words when a frame of the replay does not continue where the one before ended', async () => {
    const r = attaching();
    r.stream().ready({ start: 0, end: 6 });
    r.stream().output(0, 'abc');
    r.stream().output(4, 'ef');
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'failed', cause: { stage: 'session' } });
    expect(r.stream().closedByFeed()).toBe(true);
  });
});

describe('a stream that is ready and drops before the replay is complete, again and again', () => {
  it('spends the retries and fails in words: a ready does not make the connection good', async () => {
    const r = attaching();
    for (let round = 0; round < 3; round += 1) {
      r.stream().ready({ start: 0, end: 6 });
      r.stream().output(0, 'abc');
      r.stream().drop();
      reconnect(r, RECONNECT_DELAYS_MS[round]);
    }

    r.stream().ready({ start: 0, end: 6 });
    r.stream().drop();
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'failed', cause: { message: 'The connection to the terminal was lost.' } });
  });
});

describe('a feed that attached, failed to connect, and then completed its replay', () => {
  it('has the whole retry budget again for a later drop: the failed attempts are forgotten once the replay is complete', async () => {
    const r = attaching();
    r.stream().drop();
    reconnect(r, RECONNECT_DELAYS_MS[0]);
    r.stream().drop();
    reconnect(r, RECONNECT_DELAYS_MS[1]);
    r.stream().ready({ start: 0, end: 3 });
    r.stream().output(0, 'abc');
    expect(replayOf(r.feed).data).toEqual(new Uint8Array(bytes('abc')));
    // Three drops, each followed by its connection, and the feed still runs: the budget is full.
    for (const delay of RECONNECT_DELAYS_MS) {
      r.stream().drop();
      reconnect(r, delay);
    }

    expect(r.feed.getSnapshot().state).toBe('running');
    r.stream().drop();
    expect(r.feed.getSnapshot().state).toBe('failed');
  });
});

describe('a stream whose acknowledgement finds the socket dead in the middle of a replay', () => {
  it('does not throw: the stream ends as closed, and the feed connects again from nothing', async () => {
    const r = attaching();
    r.stream().ready({ start: 0, end: 6 });
    r.stream().die();
    expect(() => {
      r.stream().output(0, 'abc');
    }).not.toThrow();
    expect(r.feed.getSnapshot().state).toBe('running');
    const again = reconnect(r);
    expect(again.fromOffset).toBeUndefined();
    again.ready({ start: 0, end: 6 });
    again.output(0, 'abcdef');
    expect(replayOf(r.feed).data).toEqual(new Uint8Array(bytes('abcdef')));
  });
});

describe('a terminal the listing said had ended, and a stream that drops before its replay', () => {
  it('is connected again when it drops before `ready`: nothing was received, so the end is not known', async () => {
    const r = attaching({ ended: true });
    r.stream().drop();
    expect(r.feed.getSnapshot().state).toBe('starting');
    const again = reconnect(r);
    again.ready({ start: 0, end: 3, ended: { reason: 'exited', exit_code: 2 } });
    again.output(0, 'bye');
    again.ended({ reason: 'exited', exit_code: 2 });
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'ended', exit: { code: 2 } });
    expect(replayOf(r.feed).data).toEqual(new Uint8Array(bytes('bye')));
  });

  it('is dismissed, and not closed, when the feed is closed before `ready`', async () => {
    const r = attaching({ ended: true });
    await r.feed.close();
    expect(r.channels.of('dismiss')).toHaveLength(1);
    expect(r.channels.of('close')).toEqual([]);
  });
});

describe('a reconnect that continues the output of a terminal that had ended', () => {
  it('is not the end until the cursor reaches the end the host advertised: a drop half way is connected again, and the retry budget is not given back', async () => {
    const r = await running({}, { delays: [250] });
    r.stream().output(0, 'abcd');
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ start: 4, end: 10, ended: { reason: 'exited', exit_code: 1 } });
    again.output(4, 'ef');
    again.drop();
    expect(r.feed.getSnapshot().state).toBe('failed');
    expect(r.feed.getSnapshot().exit).toBeUndefined();
  });

  it('is the end when the cursor reaches it, and a continuation with nothing to bring completes at ready', async () => {
    const r = await running();
    r.stream().output(0, 'abcd');
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ start: 4, end: 6, ended: { reason: 'exited', exit_code: 1 } });
    again.output(4, 'ef');
    again.drop();
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'ended', exit: { code: 1 } });
    const empty = await running();
    empty.stream().output(0, 'ab');
    empty.stream().drop();
    reconnect(empty).ready({ start: 2, end: 2, ended: { reason: 'exited', exit_code: 3 } });
    empty.stream().drop();
    expect(empty.feed.getSnapshot()).toMatchObject({ state: 'ended', exit: { code: 3 } });
  });
});

describe('a continuation that reaches the end the host advertised', () => {
  it('is complete when it ends in a gap: the end the host reported is believed', async () => {
    const r = await running();
    r.stream().output(0, 'abcd');
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ start: 4, end: 10, ended: { reason: 'exited', exit_code: 5 } });
    again.gap(4, 10);
    again.drop();
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'ended', exit: { code: 5 } });
  });

  it('gives the whole retry budget back once it is reached: three more drops are connected again and the fourth fails', async () => {
    const r = await running();
    r.stream().output(0, 'abcd');
    r.stream().drop();
    const again = reconnect(r, RECONNECT_DELAYS_MS[0]);
    again.ready({ start: 4, end: 6 });
    again.output(4, 'ef');
    for (const delay of RECONNECT_DELAYS_MS) {
      r.stream().drop();
      reconnect(r, delay);
    }

    expect(r.feed.getSnapshot().state).toBe('running');
    r.stream().drop();
    expect(r.feed.getSnapshot().state).toBe('failed');
  });
});

describe('the first acknowledgement and the first running notification', () => {
  it('goes before anything a subscriber writes when it is told the feed is running', async () => {
    const r = await connecting();
    let wrote = false;
    r.feed.subscribe(() => {
      if (r.feed.getSnapshot().state === 'running' && !wrote) {
        wrote = true;
        r.feed.write('x');
      }
    });
    r.stream().ready();
    expect(r.stream().sent().map((frame) => frame.kind)).toEqual(['ack', 'input']);
  });

  it('stops processing the ready when that acknowledgement finds the socket dead: the feed is not running on a stream that is over, and connects again', async () => {
    const r = await connecting();
    r.stream().die();
    r.stream().ready();
    expect(r.feed.getSnapshot().state).toBe('starting');
    const again = reconnect(r);
    again.ready();
    expect(r.feed.getSnapshot().state).toBe('running');
  });
});

describe('asking who holds a terminal for a take-back (`refresh({ fresh })`)', () => {
  it('shares the question that is out with a poll, and waits for it and asks again for a take-back: the answer begins after the press', async () => {
    const gates = [Promise.withResolvers<unknown>(), Promise.withResolvers<unknown>()];
    let asked = 0;
    const r = await running({}, { channels: { listed: async () => gates[asked++]?.promise } });
    r.stream().takenOver();
    const poll = r.feed.refresh?.();
    const sharing = r.feed.refresh?.();
    const fresh = r.feed.refresh?.({ fresh: true });
    await turns();
    expect(r.channels.of('listed')).toHaveLength(1);
    gates[0]?.resolve({ id: 'term-1', attached: false });
    await turns();
    expect(r.channels.of('listed')).toHaveLength(2);
    expect(r.feed.getSnapshot().detached?.free).toBe(true);
    gates[1]?.resolve({ id: 'term-1', attached: true });
    await Promise.all([poll, sharing, fresh]);
    expect(r.feed.getSnapshot().detached?.free).toBeUndefined();
  });
});

describe('a take-back that waits for the listing in flight', () => {
  it('asks no more when the feed was closed while it waited', async () => {
    const gate = Promise.withResolvers<unknown>();
    const r = await running({}, { channels: { listed: async () => gate.promise } });
    r.stream().takenOver();
    const poll = r.feed.refresh?.();
    const fresh = r.feed.refresh?.({ fresh: true });
    await turns();
    await r.feed.close();
    gate.resolve({ id: 'term-1', attached: false });
    await Promise.all([poll, fresh]);
    expect(r.channels.of('listed')).toHaveLength(1);
  });
});

describe('a stream that dropped', () => {
  it('is connected again after 250 ms, from the offset the feed applied up to, unread output included', async () => {
    const r = await running();
    r.stream().output(0, 'hello ');
    r.feed.read();
    r.stream().output(6, 'world');
    r.stream().drop();
    expect(r.channels.streams()).toHaveLength(1);
    vi.advanceTimersByTime(249);
    expect(r.channels.streams()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(r.channels.streams()).toHaveLength(2);
    expect(r.stream().fromOffset).toBe(11);
    expect(r.feed.getSnapshot().state).toBe('running');
  });

  it('is connected again from the end of the replay the reader has not taken yet', async () => {
    const r = attaching();
    r.stream().ready({ start: 100, end: 103 });
    r.stream().output(100, 'abc');
    r.stream().output(103, 'de');
    r.stream().drop();
    reconnect(r);
    expect(r.stream().fromOffset).toBe(105);
  });

  it('waits one second and then four seconds for the next drops, and then fails in words, keeping the terminal: nothing was closed', async () => {
    expect(RECONNECT_DELAYS_MS).toEqual([250, 1_000, 4_000]);
    const r = await running();
    r.stream().drop();
    reconnect(r);
    r.stream().drop();
    vi.advanceTimersByTime(999);
    expect(r.channels.streams()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(r.channels.streams()).toHaveLength(3);
    r.stream().drop();
    vi.advanceTimersByTime(3_999);
    expect(r.channels.streams()).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(r.channels.streams()).toHaveLength(4);
    expect(r.feed.getSnapshot().state).toBe('running');
    r.stream().drop();
    expect(r.feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'The connection to the terminal was lost.' } });
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
    // Giving up leaves the host's terminal alone: a reload may still find it.
    expect(r.channels.of('close')).toEqual([]);
    expect(r.channels.of('dismiss')).toEqual([]);
  });

  it('starts counting again from the first delay once a stream was ready', async () => {
    const r = await running();
    for (let round = 0; round < 6; round += 1) {
      r.stream().drop();
      reconnect(r);
      expect(r.channels.streams()).toHaveLength(round + 2);
      r.stream().ready();
    }

    expect(r.feed.getSnapshot().state).toBe('running');
  });

  it('uses the delays it was given', async () => {
    const r = await running({}, { delays: [5, 7] });
    r.stream().drop();
    reconnect(r, 5);
    r.stream().drop();
    reconnect(r, 7);
    r.stream().drop();
    expect(r.feed.getSnapshot().state).toBe('failed');
  });

  it('turns the host\'s window on again with an acknowledgement of nothing, first', async () => {
    const r = await running();
    r.stream().drop();
    reconnect(r);
    r.stream().ready();
    expect(r.stream().sent()[0]).toEqual({ kind: 'ack', bytes: 0 });
  });

  describe('and the host has what the feed lacks (`lost` is 0)', () => {
    it('credits nothing to the new stream for what the reader parsed while the feed was reconnecting', async () => {
      const r = await running();
      r.stream().output(0, 'abcdef');
      r.feed.read();
      r.stream().drop();
      r.feed.ack(6);
      const again = reconnect(r);
      again.ready({ start: 6, end: 6 });
      expect(again.acks()).toEqual([0]);
      again.output(6, 'gh');
      r.feed.read();
      r.feed.ack(2);
      expect(again.acks()).toEqual([0, 2]);
    });

    it('continues the output where it was, with no replay and nothing muted', async () => {
      const r = await running();
      r.stream().output(0, 'abc');
      r.feed.read();
      r.stream().drop();
      reconnect(r);
      r.stream().ready({ start: 3, end: 8, lost: 0 });
      r.stream().output(3, 'defgh');
      expect(r.feed.takeReplay?.()).toBeUndefined();
      expect(readText(r.feed)).toBe('defgh');
    });

    it('credits the new stream only for what it delivered: what the reader parsed of the stream that dropped is not acknowledged to this one', async () => {
      const r = await running();
      r.stream().output(0, 'abcdef');
      r.feed.read();
      r.stream().output(6, 'gh');
      r.stream().drop();
      reconnect(r);
      const again = r.stream();
      again.ready({ start: 8, end: 8 });
      again.output(8, 'ij');
      r.feed.read();
      // The reader parsed everything it was given: eight bytes of the old stream, two of the new one.
      r.feed.ack(6);
      r.feed.ack(2);
      r.feed.ack(2);
      expect(again.acks()).toEqual([0, 2]);
    });

    it('splits ONE acknowledgement that spans the old and the new stream: the bytes of the old one are forgiven, and the new one is credited exactly for its own', async () => {
      const r = await running();
      r.stream().output(0, 'abcdef');
      r.feed.read();
      r.stream().drop();
      const again = reconnect(r);
      again.ready({ start: 6, end: 6 });
      again.output(6, 'gh');
      r.feed.read();
      r.feed.ack(8);
      expect(again.acks()).toEqual([0, 2]);
    });

    it('fails in words when the host says nothing was lost and starts somewhere else: the output cannot be joined', async () => {
      const r = await running();
      r.stream().output(0, 'abc');
      r.stream().drop();
      reconnect(r);
      r.stream().ready({ start: 1, end: 5, lost: 0 });
      expect(r.feed.getSnapshot()).toMatchObject({ state: 'failed', cause: { stage: 'session' } });
      expect(r.stream().closedByFeed()).toBe(true);
    });
  });

  describe('and the host lost bytes the feed asked for (`lost` is above 0)', () => {
    it('gives the reader a fresh replay of what the host kept, with its sizes and modes, and drops the output it held and nobody read: that is older', async () => {
      const r = await running();
      r.stream().output(0, 'abc');
      r.feed.read();
      r.stream().output(3, 'unread');
      r.stream().drop();
      expect(reconnect(r).fromOffset).toBe(9);
      r.stream().ready({ start: 50, end: 54, lost: 41, size: { cols: 100, rows: 30 }, modes: { alt_screen: true } });
      r.stream().output(50, 'ring');
      r.stream().output(54, 'live');
      expect(replayOf(r.feed)).toMatchObject({ data: new Uint8Array(bytes('ring')), end: 54, size: { cols: 100, rows: 30 }, modes: { ...PLAIN, altScreen: true } });
      expect(readText(r.feed)).toBe('live');
    });

    it('wakes the reader for the replay whether or not a wake-up was pending, and gives no output before it is taken', async () => {
      const r = await running();
      r.stream().output(0, 'abc');
      r.feed.read();
      r.stream().drop();
      reconnect(r);
      r.stream().ready({ start: 10, end: 12, lost: 7 });
      const wakes = r.wakes();
      r.stream().output(10, 'xy');
      expect(r.wakes()).toBe(wakes + 1);
      r.stream().output(12, 'z');
      expect(r.feed.read()).toEqual({ chunks: [], bytes: 0 });
      replayOf(r.feed);
      expect(readText(r.feed)).toBe('z');
    });

    it('credits the host for the bytes it dropped unread and for the replay as it arrives, and not twice for what the reader already had', async () => {
      const r = await running();
      r.stream().output(0, 'abcd');
      r.feed.read();
      r.stream().output(4, 'efgh');
      r.stream().drop();
      const again = reconnect(r);
      expect(again.fromOffset).toBe(8);
      again.ready({ start: 20, end: 22, lost: 12 });
      again.output(20, 'xy');
      again.output(22, 'zz');
      replayOf(r.feed);
      r.feed.read();
      // The reader parsed the four bytes of the old stream it had been given, and now parses what the new stream delivered.
      r.feed.ack(4);
      r.feed.ack(2);
      expect(again.acks()).toEqual([0, 2, 2]);
    });
  });

  it('is not connected again once the feed was closed, whatever was waiting', async () => {
    const r = await running();
    r.stream().drop();
    await r.feed.close();
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is not connected again once the page left: the terminal was let go, and a later drop is the detach', async () => {
    const r = await running();
    r.feed.leave?.();
    r.stream().drop();
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(1);
  });

  it('is not connected again when the terminal ended meanwhile: the end is the end', async () => {
    const r = await running();
    r.stream().drop();
    reconnect(r);
    r.stream().ready({ ended: { reason: 'exited', exit_code: 2 } });
    r.stream().ended({ reason: 'exited', exit_code: 2 });
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'ended', exit: { code: 2 } });
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(2);
  });
});

describe('a stream that drops in the middle of the replay of a terminal that had ended', () => {
  it('is connected again, with nothing applied, and ends with the whole replay: it does not end with none', async () => {
    const r = attaching({ ended: true });
    r.stream().ready({ start: 0, end: 6, ended: { reason: 'exited', exit_code: 4 } });
    r.stream().output(0, 'abc');
    r.stream().drop();
    expect(r.feed.getSnapshot().state).toBe('running');
    expect(reconnect(r).fromOffset).toBeUndefined();
    r.stream().ready({ start: 0, end: 6, ended: { reason: 'exited', exit_code: 4 } });
    r.stream().output(0, 'abcdef');
    r.stream().ended({ reason: 'exited', exit_code: 4 });
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'ended', exit: { code: 4 } });
    expect(replayOf(r.feed).data).toEqual(new Uint8Array(bytes('abcdef')));
  });
});

describe('a gap (`gap{from, to}`: the host overwrote bytes before it sent them)', () => {
  it('fails when it does not start where the output stands, and when it ends before it starts, and accepts an empty one', async () => {
    const early = await running();
    early.stream().output(0, 'abc');
    early.stream().gap(2, 9);
    expect(early.feed.getSnapshot().state).toBe('failed');
    const late = await running();
    late.stream().output(0, 'abc');
    late.stream().gap(4, 9);
    expect(late.feed.getSnapshot().state).toBe('failed');
    const backwards = await running();
    backwards.stream().output(0, 'abc');
    backwards.stream().gap(3, 2);
    expect(backwards.feed.getSnapshot().state).toBe('failed');
    const empty = await running();
    empty.stream().output(0, 'abc');
    empty.stream().gap(3, 3);
    expect(empty.feed.getSnapshot().state).toBe('running');
  });


  it('is a replay of nothing at `to` for the reader, which resets the screen, with the size and modes the feed last knew', async () => {
    const r = await running({ size: { cols: 100, rows: 30 }, modes: { bracketed_paste: true } });
    r.stream().output(0, 'abc');
    r.feed.read();
    r.stream().gap(3, 1_000);
    expect(replayOf(r.feed)).toEqual({
      data: new Uint8Array(0),
      startSize: { cols: 100, rows: 30 },
      startModes: { ...PLAIN, bracketedPaste: true },
      size: { cols: 100, rows: 30 },
      modes: { ...PLAIN, bracketedPaste: true },
      end: 1_000,
    });
  });

  it('wakes the reader for it, gives nothing before it is taken, and continues live at `to`', async () => {
    const r = await running();
    r.stream().output(0, 'abc');
    r.feed.read();
    const wakes = r.wakes();
    r.stream().gap(3, 10);
    expect(r.wakes()).toBeGreaterThan(wakes);
    r.stream().output(10, 'live');
    expect(r.feed.read()).toEqual({ chunks: [], bytes: 0 });
    replayOf(r.feed);
    expect(readText(r.feed)).toBe('live');
  });

  it('acknowledges no byte of the gap, and credits the host for what it delivered and the reader never got: output held unread is dropped with the reset', async () => {
    const r = await running();
    r.stream().output(0, 'abc');
    r.feed.read();
    r.feed.ack(3);
    r.stream().output(3, 'unread');
    r.stream().gap(9, 5_000);
    expect(r.stream().acks()).toEqual([0, 3, 6]);
    r.stream().output(5_000, 'zz');
    replayOf(r.feed);
    r.feed.read();
    r.feed.ack(2);
    expect(r.stream().acks()).toEqual([0, 3, 6, 2]);
    expect(acked(r.stream())).toBe(11);
  });

  it('drops the output that came after a replay the reader had not taken yet: the new replay resets the screen', async () => {
    const r = await running();
    r.stream().gap(0, 10);
    r.stream().output(10, 'first');
    r.stream().gap(15, 40);
    expect(replayOf(r.feed)).toMatchObject({ data: new Uint8Array(0), end: 40 });
    expect(r.feed.takeReplay?.()).toBeUndefined();
    expect(readText(r.feed)).toBe('');
  });

  it('is a replay of nothing at `to` for a feed that attached, when it comes while the replay of the terminal is still arriving: the bytes gathered so far are not the terminal', async () => {
    const r = attaching();
    r.stream().ready({ start: 0, end: 100, size: { cols: 90, rows: 20 } });
    r.stream().output(0, 'abc');
    r.stream().gap(3, 120);
    expect(replayOf(r.feed)).toMatchObject({ data: new Uint8Array(0), end: 120, size: { cols: 90, rows: 20 } });
    r.stream().output(120, 'live');
    expect(readText(r.feed)).toBe('live');
  });

  it('fails in words when the output after it is not at `to`', async () => {
    const r = await running();
    r.stream().gap(0, 10);
    r.stream().output(11, 'x');
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'failed', cause: { stage: 'session', message: 'Some of the terminal\'s output did not arrive.' } });
  });

  it('is connected again from `to`: what the feed applied up to includes it', async () => {
    const r = await running();
    r.stream().gap(0, 10);
    r.stream().output(10, 'ab');
    r.stream().drop();
    reconnect(r);
    expect(r.stream().fromOffset).toBe(12);
  });
});

describe('how the terminal ended (`ended`, typed)', () => {
  const endedWith = async (payload: unknown) => {
    const r = await running();
    r.stream().ended(payload);
    return r;
  };

  it('says the exit code of a shell that exited, zero included', async () => {
    expect((await endedWith({ reason: 'exited', exit_code: 3 })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 3 }, program: 'zsh' });
    expect((await endedWith({ reason: 'exited', exit_code: 0 })).feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 0 }, program: 'zsh' });
  });

  it('says the signal that killed it, with its number and a core dump', async () => {
    expect((await endedWith({ reason: 'signaled', signal: 'SIGTERM', signal_number: 15 })).feed.getSnapshot().exit).toEqual({ signal: 'SIGTERM', signalNumber: 15 });
    expect((await endedWith({ reason: 'signaled', signal: 'SIGSEGV', signal_number: 11, core_dumped: true })).feed.getSnapshot().exit).toEqual({ signal: 'SIGSEGV', signalNumber: 11, coreDumped: true });
  });

  it('says who closed what the host ended: a close that was asked for, its window, the host quitting, the lease running out', async () => {
    for (const closedBy of ['request', 'window', 'shutdown', 'detach-timeout'] as const) {
      expect((await endedWith({ reason: 'closed', closed_by: closedBy })).feed.getSnapshot().exit).toEqual({ closedBy });
    }
  });

  it('says what the host did when a program kept the terminal open after the shell exited', async () => {
    expect((await endedWith({ reason: 'exited', exit_code: 0, drain_capped: true, dropped_bytes: 4_096 })).feed.getSnapshot().exit).toEqual({ code: 0, drainCapped: true, droppedBytes: 4_096 });
    expect((await endedWith({ reason: 'exited', exit_code: 1, drain_capped: true })).feed.getSnapshot().exit).toEqual({ code: 1, drainCapped: true });
  });

  it('says nothing of how it ended when the reason is not one the page knows, a capped drain included', async () => {
    for (const payload of [{ reason: 'vanished', drain_capped: true, dropped_bytes: 4_096 }, { drain_capped: true }, { reason: 7, drain_capped: true }, {}, null, 'Session terminated', { reason: 'exited', exit_code: 'three' }]) {
      const status = (await endedWith(payload)).feed.getSnapshot();
      expect(status.state).toBe('ended');
      expect(status.exit).toBeUndefined();
    }
  });

  it('is a failed session when the pty or the wait failed, in the system\'s words, with no words when it carries none', async () => {
    expect((await endedWith({ reason: 'failed', failure: { stage: 'pty', message: 'input/output error' } })).feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'input/output error' } });
    expect((await endedWith({ reason: 'failed' })).feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: '' } });
  });

  it('keeps what the shell wrote before it ended readable, and turns every timer and the stream off', async () => {
    const r = await running();
    r.stream().output(0, 'bye\r\n');
    r.feed.resize(90, 30);
    r.stream().ended({ reason: 'exited', exit_code: 3 });
    expect(readText(r.feed)).toBe('bye\r\n');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is an end for a stream that closed after a `ready` that said the terminal had ended, even when the `ended` frame did not come', async () => {
    const r = attaching({ ended: true });
    r.stream().ready({ start: 0, end: 3, ended: { reason: 'exited', exit_code: 9 } });
    r.stream().output(0, 'bye');
    r.stream().drop();
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'ended', exit: { code: 9 } });
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(1);
  });

  it('gives the replay of a terminal that had ended while no page held it, and then says how it ended', async () => {
    const r = attaching({ ended: true });
    r.stream().ready({ start: 0, end: 4, ended: { reason: 'exited', exit_code: 7 } });
    r.stream().output(0, 'done');
    r.stream().ended({ reason: 'exited', exit_code: 7 });
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'ended', exit: { code: 7 }, program: 'zsh' });
    expect(replayOf(r.feed).data).toEqual(new Uint8Array(bytes('done')));
  });
});

describe('a terminal another page took (`taken-over`)', () => {
  it('ends the feed for this page, with its program, `detached` and input off, and connects no more', async () => {
    const r = await running();
    r.feed.write('a');
    r.stream().takenOver();
    expect(r.feed.getSnapshot()).toEqual({ state: 'ended', program: 'zsh', detached: { by: 'taken-over' } });
    r.feed.write('b');
    expect(r.feed.inputs?.()).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps what the shell wrote before it readable', async () => {
    const r = await running();
    r.stream().output(0, 'abc');
    r.stream().takenOver();
    expect(readText(r.feed)).toBe('abc');
  });

  it('keeps the stream open as a watcher: the feed does not close it, and sends nothing on it', async () => {
    const r = await running();
    r.stream().takenOver();
    expect(r.stream().open()).toBe(true);
    expect(r.stream().closedByFeed()).toBe(false);
    const sent = r.stream().sent().length;
    r.feed.write('b');
    r.feed.resize(120, 40);
    vi.advanceTimersByTime(1_000);
    expect(r.stream().sent()).toHaveLength(sent);
    await r.feed.close();
    expect(r.stream().closedByFeed()).toBe(true);
  });

  it('is free to take back the moment the host says `released`, with no question asked and no timer', async () => {
    const r = await running();
    r.stream().takenOver();
    const wakes = r.wakes();
    expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over' });
    r.stream().released();
    expect(r.feed.getSnapshot()).toEqual({ state: 'ended', program: 'zsh', detached: { by: 'taken-over', free: true } });
    expect(r.wakes()).toBe(wakes + 1);
    vi.advanceTimersByTime(60_000);
    expect(r.channels.calls().filter((call) => call.kind === 'listed' || call.kind === 'list')).toEqual([]);
    expect(r.channels.streams()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says how the terminal ended when the host tells the watcher `ended`: not free, and not this page\'s to end or dismiss', async () => {
    const r = await running();
    r.stream().takenOver();
    r.stream().ended({ reason: 'exited', exit_code: 7, last_offset: 0 });
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'ended', program: 'zsh', exit: { code: 7 }, detached: { by: 'taken-over' } });
    expect(r.feed.getSnapshot().detached?.free).toBeUndefined();
    await r.feed.close();
    expect(r.channels.of('close')).toEqual([]);
    expect(r.channels.of('dismiss')).toEqual([]);
    expect(r.channels.of('listed')).toEqual([]);
  });

  it('offers the way back at once when the watcher closes with no word (the page can no longer be told when the terminal is free), asks the host, and never connects again', async () => {
    const answer = Promise.withResolvers<unknown>();
    const r = await running({}, { channels: { listed: async () => answer.promise } });
    r.stream().takenOver();
    r.stream().drop();
    expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over', unwatched: true });
    expect(offersTakeBack(r.feed.getSnapshot().detached)).toBe(true);
    answer.resolve({ id: 'term-1', attached: false });
    await turns();
    expect(r.channels.of('listed')).toEqual([{ kind: 'listed', id: 'term-1' }]);
    expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over', unwatched: true, free: true });
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(1);
    expect(r.channels.of('listed')).toHaveLength(1);
  });

  it('keeps offering it when the host cannot say, and when the host says another tab holds the terminal (the press asks again and attaches only when nobody does)', async () => {
    const down = await running({}, { channels: { listed: async () => Promise.reject(new Error('offline')) } });
    down.stream().takenOver();
    down.stream().drop();
    await turns();
    expect(offersTakeBack(down.feed.getSnapshot().detached)).toBe(true);
    const held = await running({}, { channels: { listed: async () => ({ id: 'term-1', attached: true }) } });
    held.stream().takenOver();
    held.stream().drop();
    await turns();
    expect(held.feed.getSnapshot().detached).toEqual({ by: 'taken-over', unwatched: true, free: false });
    expect(offersTakeBack(held.feed.getSnapshot().detached)).toBe(true);
    expect(held.channels.streams()).toHaveLength(1);
  });

  it('is never unwatched while a watcher is open: only a `released` or an answer of the host changes what is offered', async () => {
    const r = await running();
    r.stream().takenOver();
    expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over' });
    expect(offersTakeBack(r.feed.getSnapshot().detached)).toBe(false);
  });

  it('fails the stream when `released` comes to a stream that holds the terminal', async () => {
    const r = await running();
    r.stream().raw.released();
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'failed', cause: { stage: 'start' } });
  });

  it('keeps who took the terminal, exactly, when a watcher is told how it ended', async () => {
    const r = await running();
    r.stream().takenOver();
    r.stream().ended({ reason: 'exited', exit_code: 7, last_offset: 0 });
    expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over' });
  });

  it('asks again, on the schedule of a reconnect, while the host cannot be reached for the question, and stops when it answers', async () => {
    let reachable = false;
    const r = await running({}, { channels: { listed: async () => (reachable ? { id: 'term-1', attached: false } : Promise.reject(new Error('offline'))) } });
    r.stream().takenOver();
    r.stream().drop();
    await turns();
    expect(r.channels.of('listed')).toHaveLength(1);
    expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over', unwatched: true });
    reachable = true;
    await vi.advanceTimersByTimeAsync(250);
    expect(r.channels.of('listed')).toHaveLength(2);
    expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over', unwatched: true, free: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.channels.of('listed')).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up asking after the last delay of the schedule when the host is never reached, and a feed that is closed asks no more', async () => {
    const r = await running({}, { channels: { listed: async () => Promise.reject(new Error('offline')) } });
    r.stream().takenOver();
    r.stream().drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(r.channels.of('listed')).toHaveLength(1 + RECONNECT_DELAYS_MS.length);
    expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over', unwatched: true });
    const closed = await running({}, { channels: { listed: async () => Promise.reject(new Error('offline')) } });
    closed.stream().takenOver();
    closed.stream().drop();
    await turns();
    await closed.feed.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(closed.channels.of('listed')).toHaveLength(1);
  });

  describe('`refresh`: who holds it now', () => {
    const lost = async (listed: FakeChannelsOptions['listed']): Promise<Rig> => {
      const r = await running({}, { channels: { listed } });
      r.stream().takenOver();
      return r;
    };

    it('makes it free to take back when the host says no stream holds it, and not free when one does, whatever it said before', async () => {
      let answer: unknown = { id: 'term-1', attached: false };
      const r = await lost(() => answer);
      await r.feed.refresh?.();
      expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over', free: true });
      answer = { id: 'term-1', attached: true };
      await r.feed.refresh?.();
      expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over' });
      expect(r.channels.of('listed')).toEqual([{ kind: 'listed', id: 'term-1' }, { kind: 'listed', id: 'term-1' }]);
    });

    it('leaves it as it is when the host has no entry for it, or says nothing of who holds it', async () => {
      for (const answer of [undefined, {}, { id: 'term-1' }, { attached: 'yes' }, null]) {
        const r = await lost(() => answer);
        const before = r.feed.getSnapshot();
        await r.feed.refresh?.();
        expect(r.feed.getSnapshot()).toBe(before);
      }
    });

    it('is not free when the host lists how it ended, and an ended listing takes back a `free` an earlier listing gave: nobody can take it back', async () => {
      let answer: unknown = { id: 'term-1', attached: false };
      const r = await lost(() => answer);
      await r.feed.refresh?.();
      expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over', free: true });
      answer = { id: 'term-1', attached: false, ended: { reason: 'exited' } };
      await r.feed.refresh?.();
      expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over' });
    });

    it('never attaches and never throws: a question that fails is one warning, said once, and changes nothing', async () => {
      const r = await lost(async () => Promise.reject(new Error('host away')));
      await r.feed.refresh?.();
      await r.feed.refresh?.();
      expect(r.warn).toHaveBeenCalledTimes(1);
      expect(r.channels.of('listed')).toHaveLength(2);
      expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over' });
      expect(r.channels.streams()).toHaveLength(1);
    });

    it('shares the question that is out with a second call', async () => {
      const gate = Promise.withResolvers<unknown>();
      const r = await lost(async () => gate.promise);
      const one = r.feed.refresh?.();
      const two = r.feed.refresh?.();
      gate.resolve({ id: 'term-1', attached: false });
      await Promise.all([one, two]);
      expect(r.channels.of('listed')).toHaveLength(1);
    });

    it('asks nothing of a feed that did not lose its terminal, or whose terminal ended, or that was closed', async () => {
      const running1 = await running();
      await running1.feed.refresh?.();
      const ended = await running();
      ended.stream().ended();
      await ended.feed.refresh?.();
      const closed = await lost(() => ({ attached: false }));
      await closed.feed.close();
      await closed.feed.refresh?.();
      expect(running1.channels.of('listed')).toEqual([]);
      expect(ended.channels.of('listed')).toEqual([]);
      expect(closed.channels.of('listed')).toEqual([]);
    });
  });
});

describe('a terminal the host does not know (`not-found`)', () => {
  it('ends the feed in words that say it is not there any more, and connects no more', async () => {
    const r = await running();
    r.stream().notFound();
    expect(r.feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: 'The terminal is not there any more: the host ended it while this window was away.' } });
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(1);
  });

  it('is the answer a feed that attaches gets for a terminal that was closed while the page was away', async () => {
    const r = attaching({ program: 'zsh' });
    r.stream().notFound();
    expect(r.feed.getSnapshot().state).toBe('failed');
    expect(r.feed.takeReplay?.()).toBeUndefined();
  });
});

describe('closing the feed', () => {
  it('ends a running terminal with the close frame of its live stream, once, however many times it is asked, and waits for the end on that stream', async () => {
    const r = await running();
    r.feed.resize(90, 30);
    const first = r.feed.close();
    const second = r.feed.close();
    await turns();
    expect(r.stream().sent().filter((frame) => frame.kind === 'close')).toHaveLength(1);
    expect(r.stream().sent().at(-1)).toEqual({ kind: 'close' });
    expect(r.stream().closedByFeed()).toBe(false);
    let done = false;
    void Promise.resolve(first).then(() => {
      done = true;
    });
    await turns();
    expect(done).toBe(false);
    r.stream().ended({ reason: 'closed', closed_by: 'request', last_offset: 0 });
    await first;
    expect(r.channels.of('close')).toEqual([]);
    expect(r.channels.of('dismiss')).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    r.feed.resize(100, 40);
    r.feed.write('late');
    expect(r.stream().sent().filter((frame) => frame.kind === 'input' || frame.kind === 'resize')).toEqual([]);
  });

  it('takes the rest of the output the host sends before the end, and nothing of it reaches the reader', async () => {
    const r = await running();
    const closing = r.feed.close();
    expect(r.stream().sent().at(-1)).toEqual({ kind: 'close' });
    expect(r.stream().open()).toBe(true);
    r.stream().output(0, 'last words');
    r.stream().applied(0);
    r.stream().ended({ reason: 'closed', closed_by: 'request', last_offset: 10 });
    await closing;
    expect(r.feed.read().bytes).toBe(0);
  });

  it('ends nothing when the host says close-refused (another tab took the terminal and this page had not heard): it leaves the stream and resolves', async () => {
    const r = await running();
    const closing = r.feed.close();
    await turns();
    expect(r.stream().sent().at(-1)).toEqual({ kind: 'close' });
    expect(r.stream().open()).toBe(true);
    r.stream().takenOver();
    r.stream().closeRefused();
    await closing;
    expect(r.channels.of('close')).toEqual([]);
    expect(r.channels.of('dismiss')).toEqual([]);
    expect(r.stream().closedByFeed()).toBe(true);
  });

  it('ends nothing through the capability when the stream drops before the end: another tab may hold the terminal, and the host\'s lease ends it if nobody does', async () => {
    const r = await running();
    const closing = r.feed.close();
    await turns();
    expect(r.stream().sent().at(-1)).toEqual({ kind: 'close' });
    expect(r.stream().open()).toBe(true);
    r.stream().drop();
    await closing;
    expect(r.channels.of('close')).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(1);
  });

  it('does not send the close frame to a stream whose socket is dead, and does not end the terminal through the capability either', async () => {
    const r = await running();
    r.stream().die();
    await r.feed.close();
    expect(r.channels.of('close')).toEqual([]);
  });

  it('ends a terminal it made and never opened a stream to by the capability: nobody else can hold it', async () => {
    const r = await madeWithNoStream();
    await r.feed.close();
    expect(r.channels.of('close')).toEqual([{ kind: 'close', id: 'term-1' }]);
    expect(r.channels.streams()).toHaveLength(0);
  });

  it('dismisses a terminal that ended by itself instead of closing it, once: the host keeps its end until a page does', async () => {
    const r = await running();
    r.stream().ended({ reason: 'exited', exit_code: 0 });
    await r.feed.close();
    await r.feed.close();
    expect(r.channels.of('dismiss')).toEqual([{ kind: 'dismiss', id: 'term-1' }]);
    expect(r.channels.of('close')).toEqual([]);
  });

  it('dismisses a terminal whose end was a failure of its pty, as well', async () => {
    const r = await running();
    r.stream().ended({ reason: 'failed', failure: { message: 'eio' } });
    await r.feed.close();
    expect(r.channels.of('dismiss')).toHaveLength(1);
    expect(r.channels.of('close')).toEqual([]);
  });

  it('dismisses a terminal it attached to that had ended while no page held it', async () => {
    const r = attaching({ ended: true });
    r.stream().ready({ start: 0, end: 0, ended: { reason: 'exited', exit_code: 1 } });
    r.stream().ended({ reason: 'exited', exit_code: 1 });
    await r.feed.close();
    expect(r.channels.of('dismiss')).toHaveLength(1);
    expect(r.channels.of('close')).toEqual([]);
  });

  it('leaves a terminal alone when the feed holds no live stream to it: another tab may hold it now, and the host\'s lease ends it if nobody does', async () => {
    const gave = await running({}, { delays: [] });
    gave.stream().drop();
    expect(gave.feed.getSnapshot().state).toBe('failed');
    await gave.feed.close();
    const waiting = await running();
    waiting.stream().drop();
    await waiting.feed.close();
    const joining = await running();
    joining.stream().output(5, 'x');
    await joining.feed.close();
    const early = attaching();
    await early.feed.close();
    for (const r of [gave, waiting, joining, early]) {
      expect(r.channels.of('close')).toEqual([]);
      expect(r.channels.of('dismiss')).toEqual([]);
    }
  });

  it('does not end a terminal this page lost to another, nor one the host does not know: what it shows is not this page\'s to end', async () => {
    const taken = await running();
    taken.stream().takenOver();
    await taken.feed.close();
    const gone = await running();
    gone.stream().notFound();
    await gone.feed.close();
    for (const r of [taken, gone]) {
      expect(r.channels.of('close')).toEqual([]);
      expect(r.channels.of('dismiss')).toEqual([]);
    }
  });

  it('waits for the terminal to be made when it is closed meanwhile, then ends it, and never connects a stream', async () => {
    const created = Promise.withResolvers<unknown>();
    const r = rig({ channels: { create: async () => created.promise } });
    r.feed.resize(80, 24);
    await turns();
    const closing = r.feed.close();
    await turns();
    expect(r.channels.of('close')).toEqual([]);
    created.resolve({});
    await closing;
    expect(r.channels.of('close')).toEqual([{ kind: 'close', id: 'term-1' }]);
    expect(r.channels.streams()).toHaveLength(0);
  });

  it('has nothing to end for a feed that never made a terminal, nor one whose start failed', async () => {
    const never = rig();
    await never.feed.close();
    const failed = rig({ channels: { create: async () => Promise.reject(new Error('no')) } });
    failed.feed.resize(80, 24);
    await turns();
    await failed.feed.close();
    expect(never.channels.calls()).toEqual([]);
    expect(failed.channels.of('close')).toEqual([]);
    expect(failed.channels.of('dismiss')).toEqual([]);
  });

  it('closes the stream of a feed that attached and was closed before the host said ready, and ends nothing: it holds no stream to the terminal yet', async () => {
    const r = attaching();
    await r.feed.close();
    expect(r.stream().closedByFeed()).toBe(true);
    expect(r.channels.of('close')).toEqual([]);
  });

  it('is no error when the host says the terminal is not there: it ended meanwhile', async () => {
    const r = await madeWithNoStream({ channels: { close: async () => Promise.reject(goneError()) } });
    await expect(r.feed.close()).resolves.toBeUndefined();
    const dismissed = await running({}, { channels: { dismiss: async () => Promise.reject(goneError()) } });
    dismissed.stream().ended();
    await expect(dismissed.feed.close()).resolves.toBeUndefined();
  });

  it('rejects with any other refusal of the host, and asks it once: the registry logs it', async () => {
    const r = await madeWithNoStream({ channels: { close: async () => Promise.reject(new Error('host on fire')) } });
    await expect(r.feed.close()).rejects.toThrow('host on fire');
    await expect(r.feed.close()).rejects.toThrow('host on fire');
    expect(r.channels.of('close')).toHaveLength(1);
  });

  it('does not end what the page left for the page that comes back, and does not close the stream before the detach went', async () => {
    const r = await running();
    r.feed.leave?.();
    await r.feed.close();
    expect(r.channels.of('close')).toEqual([]);
    expect(r.channels.of('dismiss')).toEqual([]);
    expect(r.stream().closedByFeed()).toBe(false);
    expect(r.stream().sent().at(-1)).toEqual({ kind: 'detach' });
  });
});

describe('leaving (the page is going away)', () => {
  it('sends the detach frame, once, and sends and connects nothing after it', async () => {
    const r = await running();
    r.feed.leave?.();
    r.feed.leave?.();
    r.feed.write('late');
    r.feed.resize(90, 30);
    r.feed.ack(1);
    vi.advanceTimersByTime(100);
    expect(r.stream().sent()).toEqual([{ kind: 'ack', bytes: 0 }, { kind: 'detach' }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing for a feed that ended, failed or was closed', async () => {
    const ended = await running();
    ended.stream().ended();
    ended.feed.leave?.();
    const closed = await running();
    await closeLive(closed);
    closed.feed.leave?.();
    expect(ended.stream().dropped()).toBe(0);
    expect(closed.stream().sent()).toEqual([{ kind: 'ack', bytes: 0 }, { kind: 'close' }]);
  });

  it('lets the terminal go before the stream is ready: the detach waits behind the attach in the link', async () => {
    const r = attaching();
    r.feed.leave?.();
    expect(r.stream().sent()).toEqual([{ kind: 'detach' }]);
  });
});

describe('what runs in the terminal', () => {
  it('asks the host and reads its answer: idle, busy with the program\'s name, and unknown for what it cannot read', async () => {
    const answers: unknown[] = [{ state: 'idle' }, { state: 'busy', name: 'vim' }, { state: 'busy' }, { state: 'unknown' }, { state: 'sleeping' }, 'x', null];
    const r = await running({}, { channels: { busy: () => answers.shift() } });
    const got = [];
    for (let at = 0; at < 7; at += 1) {
      got.push(await r.feed.busy?.());
    }

    expect(got).toEqual([{ state: 'idle' }, { state: 'busy', name: 'vim' }, { state: 'busy' }, { state: 'unknown' }, { state: 'unknown' }, { state: 'unknown' }, { state: 'unknown' }]);
    expect(r.channels.of('busy')[0]).toEqual({ kind: 'busy', id: 'term-1' });
  });

  it('is idle for a terminal the host says is not there, and unknown for a question that failed', async () => {
    const gone = await running({}, { channels: { busy: async () => Promise.reject(goneError()) } });
    expect(await gone.feed.busy?.()).toEqual({ state: 'idle' });
    const failed = await running({}, { channels: { busy: async () => Promise.reject(new Error('x')) } });
    expect(await failed.feed.busy?.()).toEqual({ state: 'unknown' });
  });

  it('is idle without asking when the terminal is not running here: ended, lost, left, closed, or not yet ready', async () => {
    const early = await connecting();
    const ended = await running();
    ended.stream().ended();
    const lost = await running();
    lost.stream().takenOver();
    const left = await running();
    left.feed.leave?.();
    const closed = await running();
    await closeLive(closed);
    for (const r of [early, ended, lost, left, closed]) {
      expect(await r.feed.busy?.()).toEqual({ state: 'idle' });
      expect(r.channels.of('busy')).toEqual([]);
    }
  });
});

describe('the terminals the host lists (`ListChannelTerminals`)', () => {
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
    expect(listedOf([listed('a', 'zsh'), listed('b', 'bash'), listed('c', 'zsh')])).toEqual([{ id: 'a', program: 'zsh', attached: false }, { id: 'b', program: 'bash', attached: false }, { id: 'c', program: 'zsh', attached: false }]);
  });

  it('says no program for a terminal whose shell has no usable name, and trims one that has', () => {
    expect(listedOf([listed('a', undefined), listed('b', '  bash '), listed('c', '   ')])).toEqual([{ id: 'a', attached: false }, { id: 'b', program: 'bash', attached: false }, { id: 'c', attached: false }]);
  });

  it('skips what is not a terminal: no id, an id that is not text or is empty, not an object', () => {
    expect(listedOf([null, 7, 'x', {}, { id: 7 }, { id: '' }, { id: '  ' }, listed('ok', 'zsh')])).toEqual([{ id: 'ok', program: 'zsh', attached: false }]);
  });

  it('says a terminal ended when the host lists how it ended, and says nothing of it for one that runs: a terminal whose shell ended while no page held it is listed with its end', () => {
    const ended = { reason: 'exited', exit_code: 7, last_offset: 208 };
    const answer = listedOf([listed('a', 'zsh'), listed('b', 'bash', { ended }), listed('c', 'zsh', { ended: null }), listed('d', undefined, { ended })]);
    expect(answer).toEqual([{ id: 'a', program: 'zsh', attached: false }, { id: 'b', program: 'bash', attached: false, ended: true }, { id: 'c', program: 'zsh', attached: false }, { id: 'd', attached: false, ended: true }]);
    expect(answer[0]).not.toHaveProperty('ended');
    expect(answer[2]).not.toHaveProperty('ended');
  });

  it('says whether a window holds each terminal, as the host says it: `attached` is carried when it is a boolean, and left out when the host says anything else', () => {
    const answer = listedOf([listed('a', 'zsh', { attached: true }), listed('b', 'zsh', { attached: false }), listed('c', 'zsh', { attached: 'yes' }), listed('d', 'zsh', { attached: undefined }), listed('e', 'zsh', { attached: 1 })]);
    expect(answer).toEqual([{ id: 'a', program: 'zsh', attached: true }, { id: 'b', program: 'zsh', attached: false }, { id: 'c', program: 'zsh' }, { id: 'd', program: 'zsh' }, { id: 'e', program: 'zsh' }]);
    expect(answer[2]).not.toHaveProperty('attached');
  });

  it('is empty for an answer that is not a list', () => {
    for (const answer of [undefined, null, {}, 'a', 7, { id: 'a' }]) {
      expect(listedOf(answer)).toEqual([]);
    }
  });
});

describe('input the host has not said it applied (protocol version 2)', () => {
  it('sends exactly the bytes after `input_applied` after the next `ready`, before anything typed since, and each byte once', async () => {
    const r = await running();
    r.feed.write('one');
    const first = r.stream();
    first.drop();
    r.feed.write('two');
    const again = reconnect(r);
    r.feed.write('new');
    expect(again.sent()).toEqual([]);
    // The host took the `o` of `one` and nothing else.
    again.ready({ inputApplied: 1 });
    expect(again.typed()).toBe('netwonew');
    r.feed.write('!');
    expect(again.typed()).toBe('netwonew!');
    expect(r.feed.inputs?.()).toBe(4);
  });

  it('trims what each `applied` confirms: the bytes the host gave a number for are never sent again, and a number that does not grow changes nothing', async () => {
    const r = await running();
    r.feed.write('abc');
    r.stream().applied(2);
    r.feed.write('de');
    r.stream().applied(2);
    r.stream().applied(1);
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ inputApplied: 2 });
    expect(again.typed()).toBe('cde');
    again.applied(5);
    again.drop();
    const third = reconnect(r, 1_000);
    third.ready({ inputApplied: 5 });
    expect(third.sent()).toEqual([{ kind: 'ack', bytes: 0 }]);
  });

  it('sends the tail of a paste the stream dropped in the middle of: what the host took of the first piece is not sent again, and the pieces it never saw are', async () => {
    const r = await running();
    const piece = (letter: string): string => letter.repeat(MAX_INPUT_BYTES);
    const first = r.stream();
    first.dieAfterInputs(1);
    const paste = piece('a') + piece('b') + piece('c') + 'd';
    r.feed.write(paste);
    expect(first.typed()).toBe(piece('a'));
    const again = reconnect(r);
    again.ready({ inputApplied: 10 });
    expect(paste.slice(0, 10) + again.typed()).toBe(paste);
    expect(again.typed()).toHaveLength(paste.length - 10);
  });

  it('sends what a refused frame left, once, when the socket died before its close was told', async () => {
    const r = await running();
    r.feed.write('one');
    const first = r.stream();
    first.die();
    r.feed.write('two');
    expect(first.typed()).toBe('one');
    const again = reconnect(r);
    again.ready({ inputApplied: 3 });
    expect(again.typed()).toBe('two');
    vi.advanceTimersByTime(60_000);
    expect(again.typed()).toBe('two');
  });

  it('counts from the `ready` of a terminal it attaches to: what an earlier page typed is not its own, and what was typed before the stream was ready is sent once', async () => {
    const r = attaching();
    r.feed.write('x');
    r.stream().ready({ start: 0, end: 0, inputApplied: 500 });
    expect(r.stream().typed()).toBe('x');
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ start: 0, end: 0, inputApplied: 500 });
    expect(again.typed()).toBe('x');
    again.drop();
    const third = reconnect(r, 1_000);
    third.ready({ start: 0, end: 0, inputApplied: 501 });
    expect(third.typed()).toBe('');
  });

  it('gives the terminal up in words when the `ready` does not say how much input was applied', async () => {
    for (const bad of [undefined, -1, 1.5, '3', null]) {
      const r = await connecting();
      r.stream().ready({ raw: { input_applied: bad } });
      expect(r.feed.getSnapshot()).toMatchObject({ state: 'failed', cause: { stage: 'start' } });
    }
  });

  it('does not resend what the host says it applied above what this page sent, and says so', async () => {
    const r = await running();
    r.feed.write('ab');
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ inputApplied: 9 });
    expect(again.typed()).toBe('');
    expect(r.feed.getSnapshot().state).toBe('running');
    expect(r.warn).toHaveBeenCalledTimes(1);
  });

  it('fails in words when more than 1 MiB is typed that the host has not said it applied, and takes the room back when it does', async () => {
    const r = await running();
    r.feed.write('a'.repeat(MAX_KEPT_INPUT_BYTES));
    expect(r.feed.getSnapshot().state).toBe('running');
    r.stream().applied(MAX_KEPT_INPUT_BYTES);
    r.feed.write('b'.repeat(MAX_KEPT_INPUT_BYTES));
    expect(r.feed.getSnapshot().state).toBe('running');
    r.feed.write('c');
    const status = r.feed.getSnapshot();
    expect(status.state).toBe('failed');
    expect(status.cause?.message).toMatch(/1 MiB/);
    expect(r.stream().closedByFeed()).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(1);
  });

  it('keeps what is typed before the stream is ready within the same bound', async () => {
    const r = await connecting();
    r.feed.write('a'.repeat(MAX_KEPT_INPUT_BYTES + 1));
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'failed' });
    expect(r.feed.getSnapshot().cause?.message).toMatch(/1 MiB/);
  });

  it('treats an `applied` before `ready` as a stream it cannot join', async () => {
    const r = await connecting();
    r.stream().applied(1);
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'failed', cause: { stage: 'start' } });
  });
});

describe('a host of another version (`unsupported`)', () => {
  it('fails in words that say the version the host speaks, and never connects again', async () => {
    const r = await connecting();
    r.stream().unsupported(3);
    const status = r.feed.getSnapshot();
    expect(status.state).toBe('failed');
    expect(status.cause?.stage).toBe('start');
    expect(status.cause?.message).toMatch(/version 3/);
    vi.advanceTimersByTime(60_000);
    expect(r.channels.streams()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails in words when the version it names is not a number, too', async () => {
    const r = await connecting();
    r.stream().unsupported('x');
    expect(r.feed.getSnapshot()).toMatchObject({ state: 'failed', cause: { stage: 'start' } });
    expect(r.feed.getSnapshot().cause?.message).toMatch(/another version/);
  });
});

describe('the kept input stays bounded and exact', () => {
  it('lets go of a number above what was typed as all of it, once, and resends nothing', async () => {
    const r = await running();
    r.feed.write('ab');
    r.stream().applied(5);
    expect(r.warn).toHaveBeenCalledTimes(1);
    r.feed.write('cd');
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ inputApplied: 2 });
    expect(again.typed()).toBe('cd');
    expect(r.feed.getSnapshot().state).toBe('running');
  });

  it('does not grow what it keeps over 10,000 keystrokes that the host applied', async () => {
    const r = await running();
    const bytesOf = (): number => r.feed.keptPieces();
    let most = 0;
    for (let key = 1; key <= 10_000; key += 1) {
      r.feed.write('k');
      r.stream().applied(key);
      most = Math.max(most, bytesOf());
    }

    expect(most).toBeGreaterThanOrEqual(0);
    expect(most).toBeLessThan(200);
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ inputApplied: 10_000 });
    expect(again.typed()).toBe('');
  });

  it('fails the stream of a `ready` that does not say how much input was applied, and one that says it wrongly', async () => {
    for (const raw of [{ input_applied: undefined }, { input_applied: -1 }, { input_applied: 0.5 }]) {
      const r = await connecting();
      r.stream().ready({ raw });
      expect(r.feed.getSnapshot().state).toBe('failed');
    }
  });
});

describe('review of #763: the kept input, the settled input and the close', () => {
  it('lets go of every piece the host confirmed at once, not when it next compacts', async () => {
    const r = await running();
    for (let key = 1; key <= 10; key += 1) {
      r.feed.write('k');
    }

    expect(r.feed.keptPieces()).toBe(10);
    r.stream().applied(10);
    expect(r.feed.keptPieces()).toBe(0);
    r.feed.write('x');
    r.stream().applied(11);
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ inputApplied: 11 });
    expect(again.typed()).toBe('');
  });

  it('keeps the unconfirmed suffix of a piece the host confirmed part of', async () => {
    const r = await running();
    r.feed.write('abcdef');
    r.stream().applied(2);
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ inputApplied: 2 });
    expect(again.typed()).toBe('cdef');
  });

  it('is not settled while the host has not said it applied what was sent: a command on its way is not nothing', async () => {
    const r = await running();
    r.feed.write('ls\r');
    expect(r.feed.inputsSettled?.()).toBe(false);
    r.stream().applied(3);
    expect(r.feed.inputsSettled?.()).toBe(true);
  });

  it('leaves a terminal to the host\'s lease when it is closed after its stream opened and before `ready`: another stream may have taken it, and the capability close would end what that stream shows', async () => {
    const r = await connecting();
    await r.feed.close();
    expect(r.channels.of('close')).toEqual([]);
    expect(r.stream().sent().filter((frame) => frame.kind === 'close')).toEqual([]);
    expect(r.stream().closedByFeed()).toBe(true);
  });

  it('keeps acknowledging what the host sends while a close is in flight, so that the end is never held back for credit: the bytes read and not parsed, and every frame that comes', async () => {
    const r = await running();
    r.stream().output(0, 'abc');
    const closing = r.feed.close();
    await turns();
    expect(r.stream().acks().reduce((sum, bytes) => sum + bytes, 0)).toBe(3);
    r.stream().output(3, 'defgh');
    r.stream().gap(8, 20);
    r.stream().output(20, 'ij');
    expect(r.stream().acks().reduce((sum, bytes) => sum + bytes, 0)).toBe(10);
    r.stream().ended({ reason: 'closed', closed_by: 'request', last_offset: 22 });
    await closing;
  });
});

describe('the count of input applied is the writer\'s own (a host that counts for each writer)', () => {
  it('resends what it typed when the host\'s count for this writer does not include it, whatever another writer wrote meanwhile', async () => {
    const r = await running();
    r.feed.write('abc');
    r.stream().drop();
    const again = reconnect(r);
    // Another writer's 40 bytes were applied while this stream was down; the count the host reports for this writer is still 0.
    again.ready({ inputApplied: 0 });
    expect(again.typed()).toBe('abc');
  });
});

describe('the writer of a feed', () => {
  it('says one writer id in every attach of the feed: 32 lowercase hex digits, the same across its reconnects, and another for another feed', async () => {
    const r = await running();
    const first = r.stream().writer;
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    r.stream().drop();
    const again = reconnect(r);
    expect(again.writer).toBe(first);
    const other = await running();
    expect(other.stream().writer).toMatch(/^[0-9a-f]{32}$/);
    expect(other.stream().writer).not.toBe(first);
    const attached = attaching();
    expect(attached.stream().writer).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('review of #763, round 2', () => {
  it('credits at a close only what the stream delivered and nobody credited: not what the reader acknowledged, and not what an earlier stream delivered', async () => {
    const acked = await running();
    acked.stream().output(0, 'abcde');
    acked.feed.ack(5);
    acked.stream().output(5, 'fgh');
    const closing = acked.feed.close();
    expect(acked.stream().acks().reduce((sum, bytes) => sum + bytes, 0)).toBe(5 + 3);
    acked.stream().ended({ reason: 'closed', closed_by: 'request', last_offset: 8 });
    await closing;

    const old = await running();
    old.stream().output(0, 'abc');
    old.stream().drop();
    const again = reconnect(old);
    again.ready({ start: 3, end: 3 });
    again.output(3, 'de');
    const ending = old.feed.close();
    // The 3 bytes of the stream that is over are nobody's to credit to this one: only its own 2 are.
    expect(again.acks().reduce((sum, bytes) => sum + bytes, 0)).toBe(2);
    again.ended({ reason: 'closed', closed_by: 'request', last_offset: 5 });
    await ending;
  });

  it('holds no reference to a piece the host confirmed, before any compaction', async () => {
    const r = await running();
    const piece = 'p'.repeat(MAX_INPUT_BYTES);
    r.feed.write(piece);
    r.feed.write(piece);
    r.feed.write(piece);
    expect(r.feed.keptHeld()).toBe(3 * MAX_INPUT_BYTES);
    r.stream().applied(2 * MAX_INPUT_BYTES);
    expect(r.feed.keptHeld()).toBe(MAX_INPUT_BYTES);
    r.stream().applied(2 * MAX_INPUT_BYTES + 1000);
    expect(r.feed.keptHeld()).toBe(MAX_INPUT_BYTES - 1000);
  });

  it('makes a writer id where the platform has no crypto, in the same 32 lowercase hex digits', async () => {
    const real = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      const r = await running();
      expect(r.stream().writer).toMatch(/^[0-9a-f]{32}$/);
      const other = await running();
      expect(other.stream().writer).not.toBe(r.stream().writer);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real });
    }
  });

  it('says in its status when the fresh question of a take-back could not be asked, and not when it was answered', async () => {
    let reachable = false;
    const r = await running({}, { channels: { listed: async () => (reachable ? { id: 'term-1', attached: true } : Promise.reject(new Error('offline'))) } });
    r.stream().takenOver();
    r.stream().drop();
    await turns();
    await r.feed.refresh?.({ fresh: true });
    expect(r.feed.getSnapshot().detached).toMatchObject({ unwatched: true, askFailed: true });
    reachable = true;
    await r.feed.refresh?.({ fresh: true });
    expect(r.feed.getSnapshot().detached).toEqual({ by: 'taken-over', unwatched: true, free: false });
  });
});

describe('a host that does not know the feed\'s writer (`ready.writer_known: false`)', () => {
  it('drops what it typed and the host did not confirm when the feed had attached before, sends none of it, and tells the user that input typed while away may be lost', async () => {
    const r = await running();
    r.feed.write('abc');
    r.stream().drop();
    r.feed.write('def');
    const again = reconnect(r);
    again.ready({ inputApplied: 0, writerKnown: false });
    expect(again.typed()).toBe('');
    expect(r.feed.keptPieces()).toBe(0);
    expect(r.feed.inputsSettled?.()).toBe(true);
    expect(r.feed.getSnapshot().inputLost).toBe(true);
    expect(laneOf(r.feed.getSnapshot()).words).toBe('Input may be lost');
    expect(laneOf(r.feed.getSnapshot()).note).toMatch(/while the connection was away/);
    // The count starts again from the host's: what is typed now is kept and confirmed as usual, and the notice goes with the next thing typed.
    r.feed.write('g');
    expect(again.typed()).toBe('g');
    expect(r.feed.getSnapshot().inputLost).toBeUndefined();
    again.applied(1);
    again.drop();
    const third = reconnect(r);
    third.ready({ inputApplied: 1 });
    expect(third.typed()).toBe('');
  });

  it('does nothing extra on a first attach, which no host knows the writer of: what was typed before the stream was ready is sent, and nothing is said', async () => {
    const r = await connecting();
    r.feed.write('abc');
    r.stream().ready({ inputApplied: 0, writerKnown: false });
    expect(r.stream().typed()).toBe('abc');
    expect(r.feed.getSnapshot().inputLost).toBeUndefined();
    const attached = attaching();
    attached.feed.write('x');
    attached.stream().ready({ start: 0, end: 0, writerKnown: false });
    expect(attached.stream().typed()).toBe('x');
    expect(attached.feed.getSnapshot().inputLost).toBeUndefined();
  });

  it('resends what the host knows nothing of only a few times when it applies none of it (a program that never reads): then drops it and says so, instead of cycling', async () => {
    const r = await running();
    r.feed.write('abc');
    r.stream().drop();
    for (let round = 1; round <= 3; round += 1) {
      const again = reconnect(r, round === 1 ? 250 : 1_000);
      again.ready({ inputApplied: 0 });
      expect(again.typed(), `resend ${String(round)}`).toBe('abc');
      expect(r.feed.getSnapshot().inputLost).toBeUndefined();
      again.drop();
    }

    const last = reconnect(r, 4_000);
    last.ready({ inputApplied: 0 });
    expect(last.typed()).toBe('');
    expect(r.feed.getSnapshot().inputLost).toBe(true);
    expect(r.feed.keptPieces()).toBe(0);
  });

  it('counts a resend only when the host applied none of it: progress in between starts the count again', async () => {
    const r = await running();
    r.feed.write('abcdef');
    r.stream().drop();
    let applied = 0;
    for (let round = 1; round <= 6; round += 1) {
      const again = reconnect(r, round === 1 ? 250 : 1_000);
      again.ready({ inputApplied: applied });
      expect(again.typed()).not.toBe('');
      applied = Math.min(5, applied + 1);
      again.applied(applied);
      again.drop();
    }

    expect(r.feed.getSnapshot().inputLost).toBeUndefined();
  });
});

describe('the writer_known rule, pinned (review of the review)', () => {
  it('says nothing is lost when nothing was kept: a reconnect with an unknown writer after nothing was typed', async () => {
    const r = await running();
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ writerKnown: false });
    expect(r.feed.getSnapshot().inputLost).toBeUndefined();
    expect(laneOf(r.feed.getSnapshot()).words).toBe('');
  });

  it('keeps the words when nothing is typed: an empty write does not clear them, a real one does', async () => {
    const r = await running();
    r.feed.write('abc');
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ writerKnown: false });
    expect(r.feed.getSnapshot().inputLost).toBe(true);
    r.feed.write('');
    expect(r.feed.getSnapshot().inputLost).toBe(true);
    r.feed.write('x');
    expect(r.feed.getSnapshot().inputLost).toBeUndefined();
  });

  it('reads a ready that does not say `writer_known` as a known writer: what it did not confirm is sent again, and nothing is said', async () => {
    const r = await running();
    r.feed.write('abc');
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ inputApplied: 0, raw: { writer_known: undefined } });
    expect(again.typed()).toBe('abc');
    expect(r.feed.getSnapshot().inputLost).toBeUndefined();
  });

  it('starts counting from the count the host gives after it let go: a later `applied` is measured from there', async () => {
    const r = await running();
    r.feed.write('abc');
    r.stream().drop();
    const again = reconnect(r);
    again.ready({ inputApplied: 5, writerKnown: false });
    r.feed.write('x');
    expect(again.typed()).toBe('x');
    again.applied(6);
    expect(r.warn).not.toHaveBeenCalled();
    expect(r.feed.keptPieces()).toBe(0);
  });

  it('counts a resend only for bytes that were sent to a stream before: bytes no stream took (the socket died first) are not resends however many streams they wait through', async () => {
    const r = await running({}, { delays: [10, 10, 10, 10, 10, 10, 10, 10] });
    r.stream().drop();
    r.feed.write('abc');
    for (let round = 1; round <= 6; round += 1) {
      const again = reconnect(r, 10);
      again.die();
      again.ready({ inputApplied: 0 });
      expect(r.feed.getSnapshot().inputLost, `round ${String(round)}`).toBeUndefined();
      expect(again.typed()).toBe('');
    }
  });

  it('starts the resend count again when the `ready` itself says the host applied some: a slow reader that takes a little each time is not cut off', async () => {
    const r = await running();
    r.feed.write('abcdefghij');
    r.stream().drop();
    for (let round = 1; round <= 7; round += 1) {
      const again = reconnect(r, round === 1 ? 250 : 1_000);
      again.ready({ inputApplied: round });
      expect(r.feed.getSnapshot().inputLost, `round ${String(round)}`).toBeUndefined();
      expect(again.typed()).not.toBe('');
      again.drop();
    }
  });
});

// "New terminal here" (#695 step 3): the directory a new terminal opens in is the HOST's fact. While the shell runs it is `ChannelTerminalCwd` (where the shell is now: the tracked directory once shell integration is on), asked at the
// moment a person chooses the item and never kept, and for a terminal that ended or that this page lost it is the directory the host said the terminal started in (`session.cwd`). The page never works out a directory from what
// it typed or from what the screen shows.
describe('where a new terminal opened from this one starts (`directory`)', () => {
  const made = { launch: { command: ['/bin/zsh'], cwd: '/work' } } as const;

  it('is the directory the host says the shell is in now while it runs, and not the one it started in: the shell moved', async () => {
    const r = await running({}, { ...made, channels: { cwd: () => ({ path: '/usr' }) } });
    expect(await r.feed.directory?.()).toEqual({ state: 'known', path: '/usr', source: 'shell' });
  });

  it('asks the host at the moment it is called and never before: no call at the start, none on the stream, none with the time passing, and no timer of its own', async () => {
    const r = await running({}, { ...made });
    const timers = vi.getTimerCount();
    vi.advanceTimersByTime(600_000);
    expect(r.channels.of('cwd')).toEqual([]);
    expect(vi.getTimerCount()).toBe(timers);
    await r.feed.directory?.();
    expect(r.channels.of('cwd')).toEqual([{ kind: 'cwd', id: 'term-1' }]);
    expect(vi.getTimerCount()).toBe(timers);
  });

  it('is asked afresh every time, so that a shell that moved between two presses is where it is now: nothing is kept', async () => {
    let where = '/usr';
    const r = await running({}, { ...made, channels: { cwd: () => ({ path: where }) } });
    expect(await r.feed.directory?.()).toMatchObject({ path: '/usr' });
    where = '/var';
    expect(await r.feed.directory?.()).toMatchObject({ path: '/var' });
    expect(r.channels.of('cwd')).toHaveLength(2);
  });

  it('says unknown, with the host\'s reason, when the host cannot say where the shell is, and does not put the directory it started in in its place', async () => {
    const r = await running({}, { ...made, channels: { cwd: () => ({ reason: 'query-failed' }) } });
    expect(await r.feed.directory?.()).toEqual({ state: 'unknown', reason: 'query-failed' });
  });

  it('says unknown when the host\'s answer is neither a path nor a reason: an answer that cannot be read is no directory', async () => {
    for (const answer of [undefined, null, 'home', {}, { path: '' }, { path: 7 }]) {
      const r = await running({}, { ...made, channels: { cwd: () => answer } });
      expect(await r.feed.directory?.(), JSON.stringify(answer)).toEqual({ state: 'unknown', reason: 'unreadable' });
    }
  });

  it('says unknown, and never throws, when the question fails: a question that was not answered is not a directory', async () => {
    const r = await running({}, {
      ...made,
      channels: {
        cwd: () => {
          throw new Error('the host is not there');
        },
      },
    });
    expect(await r.feed.directory?.()).toEqual({ state: 'unknown', reason: 'unanswered' });
  });

  it('is the directory the answer to the call that made the terminal said, when its `ready` does not say: the page keeps the first thing the host said of where it started', async () => {
    const r = await running({ raw: { session: { id: 'term-1', shell: { path: '/bin/zsh', name: 'zsh' } } } }, { ...made });
    r.stream().ended({ reason: 'exited', exit_code: 0 });
    expect(await r.feed.directory?.()).toEqual({ state: 'known', path: '/work', source: 'start' });
  });

  it('is the directory the terminal started in once the host says it is not there any more: the shell ended between the last news and the question', async () => {
    const r = await running({ startedIn: '/work' }, {
      ...made,
      channels: {
        cwd: () => {
          throw goneError();
        },
      },
    });
    expect(await r.feed.directory?.()).toEqual({ state: 'known', path: '/work', source: 'start' });
  });

  it('is the directory the terminal started in once it ended, and the host is not asked: there is no shell to ask', async () => {
    const r = await running({ startedIn: '/work' }, { ...made, channels: { cwd: () => ({ path: '/usr' }) } });
    r.stream().ended({ reason: 'exited', exit_code: 0 });
    expect(await r.feed.directory?.()).toEqual({ state: 'known', path: '/work', source: 'start' });
    expect(r.channels.of('cwd')).toEqual([]);
  });

  it('is the directory it started in for a terminal this page lost to another tab, whose shell runs on: the page does not ask a terminal it no longer holds', async () => {
    const r = await running({ startedIn: '/work' }, { ...made, channels: { cwd: () => ({ path: '/usr' }) } });
    r.stream().takenOver();
    expect(await r.feed.directory?.()).toEqual({ state: 'known', path: '/work', source: 'start' });
    expect(r.channels.of('cwd')).toEqual([]);
  });

  it('is the directory the host\'s `ready` says the terminal started in, for a terminal a page found again after a reload that had ended: the page never saw it start', async () => {
    const r = attaching({ ended: true });
    r.stream().ready({ startedIn: '/srv', ended: { reason: 'exited', exit_code: 0 } });
    r.stream().ended({ reason: 'exited', exit_code: 0 });
    expect(await r.feed.directory?.()).toEqual({ state: 'known', path: '/srv', source: 'start' });
    expect(r.channels.of('cwd')).toEqual([]);
  });

  it('asks the host for a terminal a page found again that runs, with the directory of its `ready` as the fallback', async () => {
    const r = attaching({}, { channels: { cwd: () => ({ path: '/usr' }) } });
    r.stream().ready({ startedIn: '/srv' });
    expect(await r.feed.directory?.()).toEqual({ state: 'known', path: '/usr', source: 'shell' });
  });

  it('says unknown when the terminal ended and the host never said where it started: nothing is made up', async () => {
    const r = await running({ raw: { session: { id: 'term-1', shell: { path: '/bin/zsh', name: 'zsh' } } } }, { channels: { create: (id) => ({ id, shell: { name: 'zsh' } }) } });
    r.stream().ended({ reason: 'exited', exit_code: 0 });
    expect(await r.feed.directory?.()).toEqual({ state: 'unknown', reason: 'ended' });
  });

  it('says unknown for a terminal that could not be started, and asks the host nothing', async () => {
    const r = await connecting({
      channels: {
        create: async () => {
          throw new Error('refused');
        },
      },
    });
    expect(r.feed.getSnapshot().state).toBe('failed');
    expect(await r.feed.directory?.()).toEqual({ state: 'unknown', reason: 'ended' });
    expect(r.channels.of('cwd')).toEqual([]);
  });
});

// The status of a terminal that started in the home directory because the directory it was to start in was not known (`startNote`): the lane says so, and it stops saying so with the first thing typed, as the note about lost input does.
describe('a terminal that started in the home directory because the directory it was to open in was not known (`startNote`)', () => {
  const note = 'home-for-unknown-directory';

  it('says so while it starts and while it runs, with its program', async () => {
    const r = await connecting({ startNote: note });
    expect(r.feed.getSnapshot()).toEqual({ state: 'starting', startNote: note });
    r.stream().ready();
    expect(r.feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh', startNote: note });
  });

  it('says nothing of it for a terminal that was not given one', async () => {
    const r = await running();
    expect(r.feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh' });
  });

  it('stops saying so at the first thing typed, and tells its listeners once', async () => {
    const r = await connecting({ startNote: note });
    r.stream().ready();
    const before = r.wakes();
    r.feed.write('');
    expect(r.feed.getSnapshot().startNote).toBe(note);
    r.feed.write('ls');
    expect(r.feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh' });
    r.feed.write('a');
    expect(r.wakes() - before).toBe(1);
  });
});

describe('a terminal opened in the directory an ended terminal started in, which was removed since (`homeIfMissing`)', () => {
  const refused = () => Object.assign(new Error('cwd must be a directory that exists'), { code: 'INVALID_REQUEST' });
  const note = 'home-for-unknown-directory';

  it('is made again with no directory when the host refuses the directory, with the note, and fails nothing', async () => {
    let calls = 0;
    const r = await connecting({
      homeIfMissing: true,
      launch: { command: [], cwd: '/gone' },
      channels: {
        create: (id) => {
          calls += 1;
          if (calls === 1) {
            throw refused();
          }

          return { id, shell: { path: '/bin/zsh', name: 'zsh' } };
        },
      },
    });
    expect(r.channels.of('create').map((call) => call.cwd)).toEqual(['/gone', undefined]);
    r.stream().ready();
    expect(r.feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh', startNote: note });
  });

  it('fails as before for a feed that did not ask for it: a profile\'s directory that is missing is the person\'s to read', async () => {
    const r = await connecting({ launch: { command: [], cwd: '/gone' }, channels: { create: () => { throw refused(); } } });
    expect(r.feed.getSnapshot().state).toBe('failed');
    expect(r.channels.of('create')).toHaveLength(1);
  });

  it('does not make it again for another refusal', async () => {
    const r = await connecting({ homeIfMissing: true, launch: { command: [], cwd: '/gone' }, channels: { create: () => { throw Object.assign(new Error('x'), { code: 'SHELL_UNAVAILABLE' }); } } });
    expect(r.feed.getSnapshot().state).toBe('failed');
    expect(r.channels.of('create')).toHaveLength(1);
  });
});

describe('what clears the note of a terminal that started in the home directory (`startNote`)', () => {
  it('is what the person typed, and not what the emulator answered by itself', async () => {
    const r = await connecting({ startNote: 'home-for-unknown-directory' });
    r.stream().ready();
    r.feed.write('\u001b[1;1R', { reply: true });
    expect(r.feed.getSnapshot().startNote).toBe('home-for-unknown-directory');
    r.feed.write('ls');
    expect(r.feed.getSnapshot().startNote).toBeUndefined();
  });
});

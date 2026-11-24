import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAppearance } from './engine';
import { createExecFeed, type ExecAttach, type ExecFeed } from './execFeed';
import type { TerminalModes, TerminalReplay } from './feed';
import { FLOW, createScreen, type TerminalScreen } from './screen';
import { createScreenReaderChoice } from './screenReader';
import { fakeChannels, fakeEngineLoader, fakeTerminalFeed, type FakeChannels, type FakeEngine, type FakeStream } from './testing';

// The whole data path over the terminal channel: the page's feed over the fake host the test speaks for (`fakeChannels`, testing.ts), the screen over a fake emulator. What the feed owes the host's flow control is
// that every byte the emulator PARSED of what the shell wrote live is acknowledged, once, and no other (never a byte of a replay, never a gap, never what the emulator has not parsed yet), and what the screen owes
// the person is that the bytes reach the emulator once, in order, with the replay of a reattached terminal written first and muted and what a gap or a lost byte left behind brought to the screen by a reset. The host's
// own pacing is the host's (backend/pkg/terminal): a fake that paced would only test itself.

const MIB = 1_048_576;
const READ = 20_480;

const APPEARANCE: EngineAppearance = {
  theme: { background: '#000', foreground: '#fff', cursor: '#fff', cursorAccent: '#000', selectionBackground: '#222', selectionInactiveBackground: '#111', palette: Array.from({ length: 16 }, () => '#888') },
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.33,
};

const turns = async (count = 12): Promise<void> => {
  for (let turn = 0; turn < count; turn += 1) {
    await Promise.resolve();
  }
};

/** The bytes `[from, from + count)` of a counting sequence (0, 1, ... 250, 0, ...): a test can tell that every byte arrived, once, in order. */
const sequence = (from: number, count: number): Uint8Array => Uint8Array.from({ length: count }, (_, index) => (from + index) % 251);

type Wire = {
  readonly channels: FakeChannels;
  readonly feed: ExecFeed;
  readonly screen: TerminalScreen;
  readonly engine: () => FakeEngine;
  readonly stream: () => FakeStream;
  /** Runs the animation frames until none is asked for (the pump of the screen), and lets the calls settle. */
  readonly drain: () => Promise<void>;
  /** One frame only. */
  readonly frame: () => void;
  /** The frames asked for and not run yet. */
  readonly frames: () => number;
  /** The frames run so far, and the most bytes the emulator was given in any one of them. */
  readonly ran: () => number;
  readonly widest: () => number;
};

async function wire(options: { readonly auto?: boolean; readonly attach?: ExecAttach } = {}): Promise<Wire> {
  const channels = fakeChannels();
  const feed = createExecFeed({ channels, newId: () => 'term-1', warn: () => undefined, ...(options.attach === undefined ? {} : { attach: options.attach }) });
  const loader = fakeEngineLoader({ auto: options.auto ?? true });
  const element = document.createElement('div');
  const queue: Array<() => void> = [];
  const screen = createScreen({
    feed,
    load: loader.load,
    appearance: () => APPEARANCE,
    platform: 'mac',
    label: 'Terminal input, Terminal',
    descriptionId: 'hint-1',
    screenReader: createScreenReaderChoice(),
    frame: (callback) => {
      queue.push(callback);
      return () => {
        const at = queue.indexOf(callback);
        if (at >= 0) {
          queue.splice(at, 1);
        }
      };
    },
    observe: () => () => undefined,
    fontsReady: async () => Promise.resolve(),
    copy: async () => Promise.resolve(true),
    warn: () => undefined,
  });
  screen.mount(element);
  screen.show();
  await turns();
  let ran = 0;
  let widest = 0;
  const engineBytes = (): number => (loader.engines.at(-1)?.writes ?? []).reduce((sum, piece) => sum + (typeof piece === 'string' ? piece.length : piece.byteLength), 0);
  const frame = () => {
    const before = engineBytes();
    for (const callback of queue.splice(0)) {
      ran += 1;
      callback();
    }

    widest = Math.max(widest, engineBytes() - before);
  };

  return {
    channels,
    feed,
    screen,
    engine: () => {
      const made = loader.engines.at(-1);
      if (made === undefined) {
        throw new Error('no emulator was made');
      }

      return made;
    },
    stream: () => channels.stream(),
    frame,
    frames: () => queue.length,
    ran: () => ran,
    widest: () => widest,
    drain: async () => {
      for (let guard = 0; guard < 5_000; guard += 1) {
        frame();
        await turns(4);
        if (queue.length === 0) {
          return;
        }
      }

      throw new Error('the screen never stopped asking for frames');
    },
  };
}

/** What the emulator was given as bytes, in order, as one array (the text it was given besides, the reset and the modes of a replay, is not output). */
function written(engine: FakeEngine): Uint8Array {
  const pieces = engine.writes.filter((data): data is Uint8Array => typeof data !== 'string');
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }

  return out;
}

const same = (one: Uint8Array, other: Uint8Array): boolean => one.length === other.length && one.every((value, index) => value === other[index]);

/** The sum of the acknowledgements a stream carried. */
const acked = (stream: FakeStream): number => stream.acks().reduce((sum, count) => sum + count, 0);

/** Makes the terminal at the size the screen measured, and has the host say ready: a terminal the page made. */
async function made(w: Wire, ready: Parameters<FakeStream['ready']>[0] = {}): Promise<void> {
  w.feed.resize(100, 30);
  await turns();
  w.stream().ready(ready);
  await w.drain();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a terminal the page made', () => {
  it('turns the host\'s window on when the stream is ready, before any byte, and acknowledges what the emulator parsed of what the shell wrote, once, to the byte', async () => {
    const w = await wire();
    await made(w);
    expect(w.stream().acks()).toEqual([0]);
    const total = 5 * READ + 777;
    for (let offset = 0; offset < total; offset += READ) {
      w.stream().output(offset, sequence(offset, Math.min(READ, total - offset)));
    }

    await w.drain();
    expect(same(written(w.engine()), sequence(0, total))).toBe(true);
    expect(acked(w.stream())).toBe(total);
  });

  it('writes the first bytes of the shell as they are, though the shell wrote before the stream was open: nothing is replayed to the page that made the terminal, and nothing is muted', async () => {
    const w = await wire();
    await made(w, { end: 8 });
    w.stream().output(0, 'prompt$ ');
    await w.drain();
    expect(new TextDecoder().decode(written(w.engine()))).toBe('prompt$ ');
    expect(w.engine().resets()).toBe(0);
    expect(acked(w.stream())).toBe(8);
  });

  it('does NOT stall the shell when the panel is hidden: 10 MiB in a session that is not shown is parsed once in order and acknowledged to the end, in frames of a bounded share, and nothing is drawn', async () => {
    const w = await wire();
    await made(w);
    w.screen.hide();
    const total = 10 * MIB;
    for (let offset = 0; offset < total; offset += READ) {
      w.stream().output(offset, sequence(offset, Math.min(READ, total - offset)));
    }

    await w.drain();
    expect(same(written(w.engine()), sequence(0, total))).toBe(true);
    expect(acked(w.stream())).toBe(total);
    // The cost is a bounded share of each frame, and the GPU renderer was given up on hiding and never asked for again.
    expect(w.widest()).toBeLessThanOrEqual(FLOW.hiddenFrame + FLOW.slice);
    expect(w.engine().renderers.at(-1)).toBe('dom');
    // At rest it asks for nothing.
    expect(w.frames()).toBe(0);
  });

  it('acknowledges only what the emulator has parsed: nothing while it parses slowly, and then as fast as it parses, never ahead of it', async () => {
    const w = await wire({ auto: false });
    await made(w);
    const total = 4 * MIB;
    for (let offset = 0; offset < total; offset += READ) {
      w.stream().output(offset, sequence(offset, Math.min(READ, total - offset)));
    }

    w.frame();
    await turns();
    // Read and handed to the emulator, none parsed, none acknowledged: the host's window is waiting for the page.
    expect(w.engine().pendingWrites()).toBeGreaterThan(0);
    expect(w.stream().acks()).toEqual([0]);
    let parsed = 0;
    for (let guard = 0; guard < 2_000 && (acked(w.stream()) < total || w.frames() > 0); guard += 1) {
      w.frame();
      w.engine().complete();
      await turns();
      parsed = written(w.engine()).length;
      expect(acked(w.stream())).toBeLessThanOrEqual(parsed);
    }

    expect(same(written(w.engine()), sequence(0, total))).toBe(true);
    expect(acked(w.stream())).toBe(total);
  });
});

describe('a reload: a page takes a terminal over', () => {
  const REPLAY = 3 * READ + 11;

  /** A page that attaches to `term-1`, whose host kept `[1000, 1000 + REPLAY)` and had written to `1000 + REPLAY` when it was taken. */
  async function reattached(auto = true): Promise<Wire> {
    const w = await wire({ auto, attach: { id: 'term-1', program: 'zsh' } });
    w.stream().ready({ start: 1_000, end: 1_000 + REPLAY, size: { cols: 100, rows: 30 } });
    return w;
  }

  it('writes the replay first, muted, and then the live output, once and in order, and acknowledges the replay as it arrives and the live bytes as they are parsed', async () => {
    const w = await reattached();
    for (let offset = 0; offset < REPLAY; offset += READ) {
      w.stream().output(1_000 + offset, sequence(1_000 + offset, Math.min(READ, REPLAY - offset)));
    }

    const live = 2 * READ + 5;
    w.stream().output(1_000 + REPLAY, sequence(1_000 + REPLAY, live));
    await w.drain();
    expect(same(written(w.engine()), sequence(1_000, REPLAY + live))).toBe(true);
    expect(w.engine().resets()).toBe(1);
    expect(w.stream().acks()[0]).toBe(0);
    expect(acked(w.stream())).toBe(REPLAY + live);
    expect(w.feed.getSnapshot()).toEqual({ state: 'running', program: 'zsh' });
  });

  it('writes what was typed while the replay is applied after it, in order, and none of it before: it is the person\'s, and the shell has the replay first', async () => {
    const w = await reattached(false);
    w.stream().output(1_000, sequence(1_000, REPLAY));
    w.frame();
    await turns();
    w.engine().type('l');
    w.engine().type('s');
    expect(w.stream().typed()).toBe('');
    for (let guard = 0; guard < 400 && w.stream().typed() === ''; guard += 1) {
      w.frame();
      w.engine().complete();
      await turns();
    }

    expect(w.stream().typed()).toBe('ls');
    expect(acked(w.stream())).toBe(REPLAY);
  });

  it('is brought to a terminal of the size and the modes it has: the screen takes the replay\'s own, which the feed read from the host\'s ready', async () => {
    const w = await wire({ attach: { id: 'term-1' } });
    w.stream().ready({ start: 0, end: 4, size: { cols: 132, rows: 43 }, startSize: { cols: 80, rows: 24 }, modes: { alt_screen: true, bracketed_paste: true } });
    w.stream().output(0, 'vim!');
    await w.drain();
    expect(w.engine().text()).toContain('vim!');
    const resizes = w.engine().resizes;
    expect(resizes.some(([cols, rows]) => cols === 80 && rows === 24)).toBe(true);
    expect(resizes.at(-1)?.[0]).toBeGreaterThan(0);
  });
});

describe('a stream that dropped and was connected again', () => {
  /** A terminal the page made, 100 bytes of it written, and its stream dropped. */
  async function dropped(): Promise<{ readonly w: Wire; readonly first: FakeStream }> {
    const w = await wire();
    await made(w);
    w.stream().output(0, sequence(0, 100));
    await w.drain();
    const first = w.stream();
    first.drop();
    return { w, first };
  }

  it('asks from the exact offset the screen has, and continues: every byte once and in order, with no replay and no reset, and acknowledges to the new stream only what it delivered', async () => {
    const { w, first } = await dropped();
    expect(acked(first)).toBe(100);
    vi.advanceTimersByTime(250);
    const again = w.stream();
    expect(again).not.toBe(first);
    expect(again.fromOffset).toBe(100);
    again.ready({ start: 100, end: 100 });
    again.output(100, sequence(100, 60));
    await w.drain();
    expect(same(written(w.engine()), sequence(0, 160))).toBe(true);
    expect(w.engine().resets()).toBe(0);
    expect(again.acks()).toEqual([0, 60]);
  });

  it('brings the screen to what the host kept when it lost the bytes the page asked for: a reset, the replay, and then the live bytes, and acknowledges the replay as it arrives and the live bytes as they are parsed', async () => {
    const { w } = await dropped();
    vi.advanceTimersByTime(250);
    expect(w.channels.streams()).toHaveLength(2);
    const again = w.stream();
    again.ready({ start: 5_000, end: 5_040, lost: 4_900 });
    again.output(5_000, sequence(5_000, 40));
    again.output(5_040, sequence(5_040, 25));
    await w.drain();
    expect(w.engine().resets()).toBe(1);
    expect(same(written(w.engine()), Uint8Array.from([...sequence(0, 100), ...sequence(5_000, 65)]))).toBe(true);
    expect(again.acks()).toEqual([0, 40, 25]);
  });
});

describe('a gap: the host overwrote bytes the page did not take', () => {
  it('resets the emulator and continues at the byte after it, and acknowledges nothing for the bytes that are gone', async () => {
    const w = await wire();
    await made(w);
    w.stream().output(0, sequence(0, 50));
    await w.drain();
    w.stream().gap(50, 9_000);
    w.stream().output(9_000, sequence(9_000, 30));
    await w.drain();
    expect(w.engine().resets()).toBe(1);
    expect(same(written(w.engine()), Uint8Array.from([...sequence(0, 50), ...sequence(9_000, 30)]))).toBe(true);
    expect(acked(w.stream())).toBe(80);
  });
});

describe('the fake feed of the tests of the Terminal tool, as far as a replay that comes later needs it', () => {
  const modes: TerminalModes = { altScreen: false, bracketedPaste: false, applicationCursor: false, focusEvents: false, cursorHidden: false, mouseTracking: 0, mouseEncoding: 0, kittyKeyboard: [] };
  const replayOf = (text: string): TerminalReplay => ({ data: new TextEncoder().encode(text), startSize: { cols: 80, rows: 24 }, startModes: modes, size: { cols: 80, rows: 24 }, modes, end: text.length });

  it('has `takeReplay` only when it is asked to', () => {
    const plain = fakeTerminalFeed();
    expect(plain.takeReplay).toBeUndefined();
    const keyed = fakeTerminalFeed({ takeReplay: true });
    expect(keyed.takeReplay?.()).toBeUndefined();
  });

  it('gives a replay that is offered once, at any time, and gives no output before it is taken: the output it held and nobody read is dropped, the listeners are told at once even when a wake-up is pending', () => {
    const feed = fakeTerminalFeed({ takeReplay: true });
    const told = vi.fn();
    feed.subscribe(told);
    feed.push('old');
    expect(told).toHaveBeenCalledTimes(1);
    const replay = replayOf('ring');
    feed.offerReplay(replay);
    expect(told).toHaveBeenCalledTimes(2);
    expect(feed.replayTaken()).toBe(false);
    expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
    expect(feed.takeReplay?.()).toBe(replay);
    expect(feed.replayTaken()).toBe(true);
    expect(feed.takeReplay?.()).toBeUndefined();
    expect(feed.read()).toEqual({ chunks: [], bytes: 0 });
    feed.push('live');
    expect(told).toHaveBeenCalledTimes(3);
    expect(feed.read().bytes).toBe(4);
  });

  it('replaces a replay nobody took by the one offered after it, and gives a second replay after the first was taken', () => {
    const feed = fakeTerminalFeed({ takeReplay: true });
    const one = replayOf('one');
    const two = replayOf('two');
    const three = replayOf('three');
    feed.offerReplay(one);
    feed.offerReplay(two);
    expect(feed.takeReplay?.()).toBe(two);
    feed.offerReplay(three);
    expect(feed.replayTaken()).toBe(false);
    expect(feed.takeReplay?.()).toBe(three);
    expect(feed.replayTaken()).toBe(true);
  });

  it('refuses a replay it cannot give: a fake made without `takeReplay` or a replay has no `takeReplay`, so offering one throws before anything changes', () => {
    const feed = fakeTerminalFeed();
    const told = vi.fn();
    feed.subscribe(told);
    feed.push('held');
    const before = told.mock.calls.length;
    expect(() => {
      feed.offerReplay(replayOf('ring'));
    }).toThrow(/takeReplay/);
    expect(told).toHaveBeenCalledTimes(before);
    expect(feed.replayTaken()).toBe(false);
    expect(feed.read().bytes).toBe(4);
    const given = fakeTerminalFeed({ replay: replayOf('first') });
    expect(() => {
      given.offerReplay(replayOf('second'));
    }).not.toThrow();
  });
});

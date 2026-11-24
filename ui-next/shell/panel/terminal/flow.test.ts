import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAppearance } from './engine';
import { createExecFeed, listedOf } from './execFeed';
import type { TerminalFeedHandle, TerminalFeedSnapshot, TerminalModes, TerminalReplay } from './feed';
import { FLOW, createScreen } from './screen';
import { createScreenReaderChoice } from './screenReader';
import { fakeCreditHost, fakeEngineLoader, fakeTerminalFeed, type CreditHost, type FakeEngine, type HostPage } from './testing';

// The whole data path against a host that paces the shell by credit (docs/ui-next/status/T1-go.md 2.8.6; the host is modelled in `testing.ts`, `fakeCreditHost`): the page's feed over its transport, the screen
// over a fake emulator. What the host measured on real builds (docs/ui-next/status/T2a.md): a page that stops taking output (a web view that is busy) must make the shell WAIT at the host's mark and lose nothing, a
// page that reads must never be slower for it, and a session that is not shown goes on reading and acknowledging, so that a build in it is never stalled by the view. The terminal acknowledges every byte it parses and
// drops none, so these are the claims, and a fake host is where they can be counted exactly.

const MIB = 1_048_576;
const HIGH = MIB;
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

type Wire = {
  readonly host: CreditHost;
  readonly feed: ReturnType<typeof createExecFeed>;
  readonly screen: ReturnType<typeof createScreen>;
  readonly engine: () => FakeEngine;
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

async function wire(options: { readonly auto?: boolean } = {}): Promise<Wire> {
  const host = fakeCreditHost();
  const feed = createExecFeed({ transport: host.transport, newId: () => 'term-1', warn: () => undefined });
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
  const engineBytes = (): number =>
    (loader.engines.at(-1)?.writes ?? []).reduce((sum, piece) => sum + (typeof piece === 'string' ? piece.length : piece.byteLength), 0);
  const frame = () => {
    const before = engineBytes();
    for (const callback of queue.splice(0)) {
      ran += 1;
      callback();
    }

    widest = Math.max(widest, engineBytes() - before);
  };

  return {
    host,
    feed,
    screen,
    engine: () => {
      const made = loader.engines.at(-1);
      if (made === undefined) {
        throw new Error('no emulator was made');
      }

      return made;
    },
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

/** What the emulator was given, in order, as one array. */
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

/** Every byte, once, in the order the shell wrote it. */
function intact(engine: FakeEngine, host: CreditHost, total: number): boolean {
  const got = written(engine);
  if (got.length !== total) {
    return false;
  }

  for (let offset = 0; offset < total; offset += 1) {
    if (got[offset] !== host.byteAt(offset)) {
      return false;
    }
  }

  return true;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a terminal nobody reads (a web view that is busy, a feed with no screen): the shell waits, and nothing is lost', () => {
  it('stops the shell at the host\'s mark with no reader at all: the page holds the mark and one read and no more, however much the shell has to say, and the shell waits in its own write (the stalled web view of the host\'s measurements, bounded)', async () => {
    const host = fakeCreditHost();
    const feed = createExecFeed({ transport: host.transport, newId: () => 'term-1', warn: () => undefined });
    feed.resize(80, 24);
    await turns();
    expect(host.explicit()).toBe(true);
    host.produce(100 * MIB);
    expect(host.paused()).toBe(true);
    expect(host.delivered()).toBeGreaterThanOrEqual(HIGH);
    expect(host.delivered()).toBeLessThan(HIGH + READ);
    expect(host.mostUnacked()).toBeLessThan(HIGH + READ);
    expect(host.waiting()).toBe(100 * MIB - host.delivered());
    // What the page holds is what was delivered, all of it: nothing was dropped to stay within a bound.
    const held = feed.read();
    expect(held.bytes).toBe(host.delivered());
    expect(held.chunks.every((chunk, index) => chunk.every((value, at) => value === host.byteAt(index * READ + at)))).toBe(true);
  });

  it('is paced from the first prompt: the first call that turns flow on is made when the process exists, before any byte is read, so a terminal that was never shown holds the mark and no more', async () => {
    const host = fakeCreditHost();
    const feed = createExecFeed({ transport: host.transport, newId: () => 'term-1', warn: () => undefined });
    expect(host.explicit()).toBe(false);
    feed.resize(80, 24);
    await turns();
    expect(host.explicit()).toBe(true);
    expect(host.acks()).toEqual([0]);
  });

  it('does NOT stall the shell when the panel is hidden: `yes | head -c 50M` in a session that is not shown is read, parsed once in order and acknowledged to the end, in frames of a bounded share, and nothing is drawn', async () => {
    const w = await wire();
    expect(w.host.explicit()).toBe(true);
    w.screen.hide();
    const total = 50 * MIB;
    w.host.produce(total);
    await w.drain();
    expect(w.host.delivered()).toBe(total);
    expect(w.host.waiting()).toBe(0);
    expect(w.host.paused()).toBe(false);
    expect(intact(w.engine(), w.host, total)).toBe(true);
    // Every byte that was parsed was acknowledged, once, and the host never held more than its mark and one read that the page had not taken in.
    expect(w.host.acks().reduce((sum, bytes) => sum + bytes, 0)).toBe(total);
    expect(w.host.unacked()).toBe(0);
    expect(w.host.mostUnacked()).toBeLessThan(HIGH + READ);
    // The cost is a bounded share of each frame, and the GPU renderer was given up on hiding and never asked for again.
    expect(w.widest()).toBeLessThanOrEqual(FLOW.hiddenFrame + FLOW.slice);
    expect(w.ran()).toBeGreaterThanOrEqual(total / (FLOW.hiddenFrame + FLOW.slice));
    expect(w.engine().renderers.at(-1)).toBe('dom');
    // At rest it asks for nothing.
    expect(w.frames()).toBe(0);
  });

  it('holds the shell at the mark while the emulator parses slowly, and releases it only as fast as the emulator parses: the pace is the parse, not the read', async () => {
    const w = await wire({ auto: false });
    const total = 4 * MIB;
    w.host.produce(total);
    w.frame();
    await turns();
    // Read and handed over, none parsed, none acknowledged: the host is waiting at the mark.
    expect(w.host.paused()).toBe(true);
    expect(w.engine().pendingWrites()).toBeGreaterThan(0);
    expect(w.host.acks()).toEqual([0]);
    const before = w.host.delivered();
    w.engine().complete();
    await turns();
    // Half of what the host holds uncredited was parsed, and that is above the low mark: the shell still waits. It is released as the rest is read and parsed.
    expect(w.host.paused()).toBe(true);
    expect(w.host.unacked()).toBeLessThan(before);
    for (let guard = 0; guard < 400 && w.host.waiting() + w.engine().pendingWrites() + w.frames() > 0; guard += 1) {
      w.frame();
      w.engine().complete();
      await turns();
    }

    expect(w.host.waiting()).toBe(0);
    w.engine().complete();
    await turns();
    expect(intact(w.engine(), w.host, total)).toBe(true);
    expect(w.host.mostUnacked()).toBeLessThan(HIGH + READ);
  });
});

describe('a terminal somebody reads: nothing is slower for the pacing', () => {
  it('takes a flood of 24 MiB through the screen with every byte, once, in order, and never has the host hold more than the mark and one read that the page did not take in', async () => {
    const w = await wire();
    const total = 24 * MIB;
    w.host.produce(total);
    await w.drain();
    expect(w.host.delivered()).toBe(total);
    expect(w.host.waiting()).toBe(0);
    expect(intact(w.engine(), w.host, total)).toBe(true);
    expect(w.host.mostUnacked()).toBeLessThan(HIGH + READ);
    expect(w.host.acks().reduce((sum, bytes) => sum + bytes, 0)).toBe(total);
    expect(w.host.unacked()).toBe(0);
  });

  it('keeps the calls few: acknowledgements are sent one at a time and carry what was parsed meanwhile, never one call for each piece the emulator parsed', async () => {
    const w = await wire();
    const total = 8 * MIB;
    w.host.produce(total);
    await w.drain();
    const pieces = w.engine().writes.length;
    expect(pieces).toBeGreaterThan(100);
    // One call for each piece would be `pieces + 1` (the first call turns the flow on): these are a few for each frame, because one call is in flight and what the emulator parsed meanwhile is summed into the next.
    expect(w.host.acks().length).toBeLessThan(pieces / 2);
    expect(w.host.acks().reduce((sum, bytes) => sum + bytes, 0)).toBe(total);
  });

  it('acknowledges everything it parsed after the shell has nothing more to say: the host is told, and holds nothing uncredited at rest', async () => {
    const w = await wire();
    w.host.produce(100);
    await w.drain();
    expect(w.host.unacked()).toBe(0);
    expect(w.host.acks().reduce((sum, bytes) => sum + bytes, 0)).toBe(100);
  });
});

// ---- T2b: a terminal that outlives its page (docs/ui-next/status/T2-go.md) ---------------------------------------------------------------------------------------------------------------------------------
//
// The reload against the host of T2-go (`fakeCreditHost` with a page key: output with offsets in a ring, an attach that answers with a replay, `DETACHED`, a lease, what a shell that ended while no page was there leaves).
// A page is a feed over its window's transport and a reader that does what the screen does with the data: take the replay once, write it, then read, write and acknowledge the live output and never the replay. What
// is asked of the pair is the host's own promise (2.4 rules 5 and 6): the page that comes back holds the host's output from the start of what the host kept to the end of what the shell wrote, every byte ONCE and in
// ORDER, however the events and the answer of the attach fall (a counting sequence is the shell's output, so a byte lost, repeated or moved is seen), and it acknowledges only what it took from live events.

const KEY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

type Reader = {
  /** What the emulator holds, in order: the last replay (or nothing, for a feed that started the terminal), then the live output since. */
  readonly written: () => Uint8Array;
  /** The offset of the terminal's output where what the emulator holds begins: the origin of a feed that started the terminal, or where the last replay began (its end less its length). */
  readonly start: () => number | undefined;
  /** The offset the emulator is at: where what it holds began and every byte it was given since. */
  readonly end: () => number | undefined;
  /** The live bytes read, and acknowledged. */
  readonly live: () => number;
  readonly replays: () => number;
  readonly replay: () => TerminalReplay | undefined;
};

/**
 * What the screen does with a feed, as far as the data goes: when told, take the replay if there is one, then read the live output and acknowledge what was read (never the replay). A replay is written into a fresh
 * emulator, so what the reader held before it is gone; `origin` is the offset a feed that started its terminal begins at (0), where a feed that took it over has none until its replay is taken.
 */
function readerOf(feed: TerminalFeedHandle, origin?: number): Reader {
  const pieces: Uint8Array[] = [];
  let start: number | undefined = origin;
  let count = 0;
  let live = 0;
  let replays = 0;
  let taken: TerminalReplay | undefined;
  const drain = () => {
    const replay = feed.takeReplay?.();
    if (replay !== undefined) {
      replays += 1;
      taken = replay;
      start = replay.end - replay.data.length;
      count = replay.data.length;
      pieces.length = 0;
      pieces.push(replay.data);
    }

    for (let out = feed.read(); out.bytes > 0; out = feed.read()) {
      pieces.push(...out.chunks);
      count += out.bytes;
      live += out.bytes;
      feed.ack(out.bytes);
    }
  };

  feed.subscribe(drain);

  return {
    written: () => {
      const all = new Uint8Array(count);
      let at = 0;
      for (const piece of pieces) {
        all.set(piece, at);
        at += piece.length;
      }

      return all;
    },
    start: () => start,
    end: () => (start === undefined ? undefined : start + count),
    live: () => live,
    replays: () => replays,
    replay: () => taken,
  };
}

/** Whether the emulator was given exactly the shell's sequence from `start`: every byte once, in order. */
function matches(got: Uint8Array, host: CreditHost, start: number): boolean {
  for (let index = 0; index < got.length; index += 1) {
    if (got[index] !== host.byteAt(start + index)) {
      return false;
    }
  }

  return true;
}

/** Runs the promises until the condition holds, or fails saying what never happened. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let guard = 0; guard < 50_000; guard += 1) {
    if (condition()) {
      return;
    }

    await turns(2);
  }

  throw new Error(`it never happened: ${what}`);
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('a reload: the page goes, and a new one takes the terminal over (T2-go 2.4)', () => {
  const TOTAL = 6 * MIB;

  /** A page that started a terminal with a key, and reads it. */
  function started(host: CreditHost, size = { cols: 100, rows: 30 }) {
    const warn = vi.fn<(message: string, error?: unknown) => void>();
    const feed = createExecFeed({ transport: host.transport, newId: () => 'term-1', pageKey: KEY, warn });
    feed.resize(size.cols, size.rows);
    return { feed, reader: readerOf(feed), warn };
  }

  /** The page that comes back: it lists what its key finds, and takes the first terminal over. `late` is how many events were already waiting for this window when it asked. */
  async function comeBack(page: HostPage) {
    const listed = listedOf(await page.transport.list(KEY));
    const [first] = listed;
    if (first === undefined) {
      throw new Error('the host lists no terminal for the key');
    }

    const warn = vi.fn<(message: string, error?: unknown) => void>();
    const late = page.queued();
    const feed = createExecFeed({ transport: page.transport, pageKey: KEY, attach: first.program === undefined ? { id: first.id } : { id: first.id, program: first.program }, warn });
    return { feed, reader: readerOf(feed), warn, late, listed };
  }

  const finished = (host: CreditHost, reader: Reader): boolean => reader.end() === TOTAL && host.waiting() === 0 && host.unacked() === 0;

  it('keeps every byte once and in order across a reload in the middle of a flood: the new page is given what the host kept and then the live output, and holds the host\'s output byte for byte, with the shell paused while nobody had it', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    host.produce(TOTAL);
    await until(() => host.delivered() >= 2 * MIB, 'a third of the flood to be delivered');
    // pagehide: the page says it is leaving, and the window goes.
    first.feed.leave?.();
    host.home.die();
    expect(host.holder()).toMatchObject({ detached: true, owner: undefined });
    const held = host.delivered();
    await turns(50);
    // While detached the host's reader is held: it reads nothing more, and the shell waits in its own write.
    expect(host.delivered()).toBe(held);
    expect(host.waiting()).toBe(TOTAL - held);

    const back = await comeBack(host.page());
    const mark = host.acks().length;
    await until(() => finished(host, back.reader), 'the flood to reach the new page');
    const start = back.reader.start() ?? -1;
    expect(start).toBeGreaterThanOrEqual(0);
    expect(back.reader.replays()).toBe(1);
    expect(back.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
    expect(matches(back.reader.written(), host, start)).toBe(true);
    expect(back.reader.written()).toHaveLength(TOTAL - start);
    // The first page's emulator holds a prefix of the same output, and the two together lost nothing the host still had.
    expect(matches(first.reader.written(), host, 0)).toBe(true);
    expect(start).toBeLessThanOrEqual(first.reader.written().length);
    expect(host.delivered()).toBe(TOTAL);
    expect(host.paused()).toBe(false);
    expect(host.mostUnacked()).toBeLessThan(HIGH + READ);
    // Only live bytes were acknowledged by the new page: the replay was not, and nothing it dropped was.
    expect(host.acks().slice(mark).reduce((sum, bytes) => sum + bytes, 0)).toBe(back.reader.live());
    expect(back.warn).not.toHaveBeenCalled();
    expect(host.calls().map((call) => call.kind)).toEqual(['create', 'detach', 'list', 'attach']);
  });

  it('loses nothing and repeats nothing when the events the replay holds reach the page AFTER the answer: an event and a reply travel apart (7 in 2,051 reattaches in the field), and the events after the replay follow them', async () => {
    const host = fakeCreditHost();
    // The page that holds the terminal reads nothing: the host stops at its mark with a megabyte of events handed over, which every window hears.
    const warn = vi.fn<(message: string, error?: unknown) => void>();
    const held = createExecFeed({ transport: host.transport, newId: () => 'term-1', pageKey: KEY, warn });
    held.resize(100, 30);
    const page = host.page();
    page.hold();
    await turns();
    host.produce(TOTAL);
    await until(() => host.paused(), 'the host to stop at its mark');
    const back = await comeBack(page);
    // The events the host handed over before it answered are in the wire still: they will arrive after the answer, and lie below the end of the replay.
    expect(back.late).toBeGreaterThanOrEqual(50);
    await turns(8);
    expect(back.feed.getSnapshot().state).toBe('running');
    // The attach let the reader go: the host went on, and what it read after the answer is in the wire too, above the end of the replay.
    expect(page.queued()).toBeGreaterThan(back.late);
    const mark = host.acks().length;
    // The host handed them over before it answered, and they reach the page up to 2 ms after the answer (what the real host showed in 6, 3 and 11 of 400 attaches): whole events, all below the end of the replay, and
    // the live ones follow them. The clock is the fake one: the 2 ms are driven, not waited for.
    setTimeout(() => {
      page.release();
    }, 2);
    vi.advanceTimersByTime(2);
    await until(() => finished(host, back.reader), 'the flood to reach the new page');
    const start = back.reader.start() ?? -1;
    expect(matches(back.reader.written(), host, start)).toBe(true);
    expect(back.reader.written()).toHaveLength(TOTAL - start);
    // Only the live bytes were acknowledged: not the replay, and not one of the events it dropped.
    expect(host.acks().slice(mark).reduce((sum, bytes) => sum + bytes, 0)).toBe(back.reader.live());
    expect(back.warn).not.toHaveBeenCalled();
    expect(back.feed.getSnapshot().state).toBe('running');
    // The page that held the terminal was told it lost it, and neither detaches nor closes it.
    expect(held.getSnapshot()).toEqual({ state: 'ended', detached: { by: 'taken-over' }, program: 'sh' });
    await held.close();
    expect(host.calls().filter((call) => call.kind === 'close' || call.kind === 'detach')).toEqual([]);
    expect(host.holder()).toMatchObject({ attachment: 1, owner: 1, detached: false });
  });

  it('survives reload after reload: eight pages in a row each take the terminal over in the middle of the flood, and the last holds every byte of what the host kept, once and in order', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    host.produce(TOTAL);
    let feed: TerminalFeedHandle = first.feed;
    let reader = first.reader;
    let window: HostPage = host.home;
    for (let reload = 1; reload <= 8; reload += 1) {
      await until(() => host.delivered() >= (reload * TOTAL) / 10, `${String(reload)} tenths of the flood to be delivered`);
      feed.leave?.();
      // The window that is gone dies before the new page asks on every other reload, and after it on the others.
      const gone = window;
      window = host.page();
      if (reload % 2 === 0) {
        gone.die();
      }

      const back = await comeBack(window);
      gone.die();
      feed = back.feed;
      reader = back.reader;
      expect(back.warn).not.toHaveBeenCalled();
    }

    await until(() => finished(host, reader), 'the flood to reach the last page');
    const start = reader.start() ?? -1;
    expect(matches(reader.written(), host, start)).toBe(true);
    expect(reader.written()).toHaveLength(TOTAL - start);
    expect(host.delivered()).toBe(TOTAL);
    expect(host.holder()).toMatchObject({ attachment: 8, detached: false });
    expect(feed.getSnapshot().state).toBe('running');
  });

  it('has the replay start where the host\'s ring does when the flood outran it, and still joins exactly: the host says what it dropped, in the start of the replay', async () => {
    const host = fakeCreditHost({ ring: 256 * 1_024 });
    const first = started(host);
    await turns();
    host.produce(TOTAL);
    await until(() => host.delivered() >= 3 * MIB, 'half of the flood to be delivered');
    first.feed.leave?.();
    host.home.die();
    const back = await comeBack(host.page());
    await until(() => finished(host, back.reader), 'the flood to reach the new page');
    const start = back.reader.start() ?? -1;
    expect(start).toBeGreaterThan(MIB);
    expect(matches(back.reader.written(), host, start)).toBe(true);
    expect(back.reader.written()).toHaveLength(TOTAL - start);
  });

  it('leaves a full-screen program usable: the modes it set come back with the replay, the size is sent again by two numbered calls, and what is typed goes on from the number the host expects', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    first.feed.write('vim notes.txt\r');
    host.say('\u001b[?1049h\u001b[H\u001b[2Jnotes.txt  1,1  All');
    host.modes({ alt_screen: true, bracketed_paste: true, application_cursor: true, cursor_hidden: true, mouse_tracking: 5, mouse_encoding: 2 });
    await until(() => first.reader.live() > 0, 'the screen of the program to be read');
    first.feed.resize(120, 40);
    vi.advanceTimersByTime(200);
    await turns();
    first.feed.leave?.();
    host.home.die();
    expect(host.nextInput()).toBe(3);

    const back = await comeBack(host.page());
    await until(() => back.reader.replay() !== undefined, 'the replay to be taken');
    const replay = back.reader.replay();
    expect(text(replay?.data ?? new Uint8Array())).toContain('notes.txt  1,1  All');
    expect(replay?.modes).toEqual({ altScreen: true, bracketedPaste: true, applicationCursor: true, focusEvents: false, cursorHidden: true, mouseTracking: 5, mouseEncoding: 2, kittyKeyboard: [] });
    expect(replay?.startModes.altScreen).toBe(false);
    expect(replay?.size).toEqual({ cols: 120, rows: 40 });
    expect(replay?.startSize).toEqual({ cols: 100, rows: 30 });
    // The screen is already the size the host has, so a plain resize would send nothing: the program is made to draw itself again by two calls, one column short and then as it is.
    back.feed.redraw?.();
    back.feed.write('i');
    await turns();
    expect(host.inputs().slice(-3)).toEqual([
      { kind: 'resize', seq: 3, rows: 40, cols: 119 },
      { kind: 'resize', seq: 4, rows: 40, cols: 120 },
      { kind: 'write', seq: 5, text: 'i' },
    ]);
    expect(back.feed.getSnapshot().state).toBe('running');
    expect(back.warn).not.toHaveBeenCalled();
  });

  it('continues the count of the host\'s input queue after a reload: the page that came back is told the number the queue takes next, its first call has exactly that number, and every later call, the writes, the sizes and the two sizes of a redraw, the next one, so none is refused as stale and none is applied out of order', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    first.feed.write('ls\r');
    first.feed.write('pwd\r');
    await turns();
    first.feed.leave?.();
    host.home.die();
    expect(host.nextInput()).toBe(3);
    const back = await comeBack(host.page());
    await until(() => back.feed.getSnapshot().state === 'running', 'the terminal to be taken over');
    back.feed.write('a');
    back.feed.write('b');
    back.feed.redraw?.();
    back.feed.write('c');
    await turns(8);
    expect(host.inputs().slice(2)).toEqual([
      { kind: 'write', seq: 3, text: 'a' },
      { kind: 'write', seq: 4, text: 'b' },
      { kind: 'resize', seq: 5, rows: 30, cols: 99 },
      { kind: 'resize', seq: 6, rows: 30, cols: 100 },
      { kind: 'write', seq: 7, text: 'c' },
    ]);
    expect(host.nextInput()).toBe(8);
    expect(back.feed.getSnapshot().state).toBe('running');
    expect(back.warn).not.toHaveBeenCalled();
  });

  it('continues from the number the answer to the attach states and not from the one the listing stated: the window that holds the terminal types between the list and the attach, and the listed number would be refused as stale', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    first.feed.write('ls\r');
    await turns();
    // The page that comes back lists: the host's queue takes number 2 next.
    const page = host.page();
    const listing = (await page.transport.list(KEY)) as Array<{ readonly next_input_seq?: unknown }>;
    expect(listing[0]?.next_input_seq).toBe(2);
    // The window that still holds the terminal types twice before the attach: the queue takes number 4 next.
    first.feed.write('pwd\r');
    first.feed.write('date\r');
    await turns();
    expect(host.nextInput()).toBe(4);
    const [terminal] = listedOf(listing);
    const warn = vi.fn<(message: string, error?: unknown) => void>();
    const feed = createExecFeed({ transport: page.transport, pageKey: KEY, attach: { id: terminal?.id ?? '' }, warn });
    await until(() => feed.getSnapshot().state === 'running', 'the terminal to be taken over');
    feed.write('x');
    await turns(8);
    expect(host.inputs().at(-1)).toEqual({ kind: 'write', seq: 4, text: 'x' });
    expect(feed.getSnapshot().state).toBe('running');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('a page that lost the terminal, and how the terminal ended while it was away (T2-go 2.4 rules 7 and 8, 2.5)', () => {
  function started(host: CreditHost) {
    const warn = vi.fn<(message: string, error?: unknown) => void>();
    const feed = createExecFeed({ transport: host.transport, newId: () => 'term-1', pageKey: KEY, warn });
    feed.resize(100, 30);
    return { feed, reader: readerOf(feed), warn };
  }

  const statusOf = (feed: TerminalFeedHandle): TerminalFeedSnapshot => feed.getSnapshot();

  it('tells a page that is still alive when the lease it lost the terminal to ran out: the snapshot keeps `detached` and gains how it ended, and nothing was sent to the host for the terminal it lost', async () => {
    const host = fakeCreditHost();
    const page = started(host);
    await turns();
    host.say('hello\r\n');
    await turns();
    // The window that owns the terminal detaches it by a call of its own (not the feed's): the feed is told.
    await host.transport.detach('term-1', { pageKey: KEY });
    expect(statusOf(page.feed)).toEqual({ state: 'ended', detached: { by: 'requested' }, program: 'sh' });
    host.expire();
    expect(statusOf(page.feed)).toEqual({ state: 'ended', detached: { by: 'requested' }, exit: { closedBy: 'detach-timeout' }, program: 'sh' });
    await page.feed.close();
    expect(host.calls().filter((call) => call.kind === 'close')).toEqual([]);
    expect(text(page.reader.written())).toBe('hello\r\n');
  });

  it('is told by the host when a second page with the same key takes the terminal: the first stops, sends nothing for it, and the second goes on from the output', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    host.say('one ');
    await turns();
    const page = host.page();
    const feed = createExecFeed({ transport: page.transport, pageKey: KEY, attach: { id: 'term-1', program: 'sh' }, warn: () => undefined });
    const second = { feed, reader: readerOf(feed) };
    await until(() => second.feed.getSnapshot().state === 'running', 'the terminal to be taken over');
    expect(statusOf(first.feed)).toEqual({ state: 'ended', detached: { by: 'taken-over' }, program: 'sh' });
    host.say('two');
    await until(() => text(second.reader.written()) === 'one two', 'the second page to read the rest');
    // The page that lost it neither reads, writes, detaches nor closes; the terminal is the other page's.
    expect(text(first.reader.written())).toBe('one ');
    first.feed.write('x');
    first.feed.leave?.();
    await first.feed.close();
    expect(host.inputs()).toEqual([]);
    expect(host.calls().filter((call) => call.kind === 'close' || call.kind === 'detach')).toEqual([]);
    expect(host.holder()).toMatchObject({ attachment: 1, owner: 1, detached: false });
  });

  /** A terminal whose shell exited, with 'bye', while no page held it; a page that comes back takes it over and reads how it ended. */
  async function takenEnded(host: CreditHost) {
    const first = started(host);
    await turns();
    host.say('bye\r\n');
    await turns();
    first.feed.leave?.();
    host.home.die();
    host.exit(3);
    const page = host.page();
    const listing = (await page.transport.list(KEY)) as Array<{ readonly ended?: unknown }>;
    const feed = createExecFeed({ transport: page.transport, pageKey: KEY, attach: { id: 'term-1', program: 'sh' }, warn: () => undefined });
    const reader = readerOf(feed);
    await until(() => feed.getSnapshot().state === 'ended', 'the end to be read');
    return { feed, reader, listing };
  }

  it('shows how a shell ended that exited while no page held the terminal, with what it wrote, and closes the tab although the host does not dismiss it: the close of an ended terminal answers not-found on the real host, which is done, and the terminal stays listed, as ended, until its lease runs out', async () => {
    const host = fakeCreditHost();
    const { feed, reader, listing } = await takenEnded(host);
    expect(listing[0]?.ended).toMatchObject({ reason: 'exited', exit_code: 3 });
    expect(statusOf(feed)).toEqual({ state: 'ended', exit: { code: 3 }, program: 'sh' });
    expect(text(reader.written())).toBe('bye\r\n');
    await expect(feed.close()).resolves.toBeUndefined();
    expect(host.calls().filter((call) => call.kind === 'close')).toHaveLength(1);
    expect(listedOf(await host.page().transport.list(KEY))).toEqual([{ id: 'term-1', program: 'sh', attached: false, ended: true }]);
  });

  it('closes it the same way when the host dismisses an ended terminal as its contract says, and lists nothing afterwards', async () => {
    const host = fakeCreditHost({ dismissEnded: true });
    const { feed } = await takenEnded(host);
    await expect(feed.close()).resolves.toBeUndefined();
    expect(host.calls().filter((call) => call.kind === 'close')).toHaveLength(1);
    expect(listedOf(await host.page().transport.list(KEY))).toEqual([]);
  });

  it('has nothing to offer after the host restarted: the key finds no terminal, and a saved terminal that is asked for is refused, in the host\'s words, as a start that failed', async () => {
    const host = fakeCreditHost();
    const page = host.page();
    expect(listedOf(await page.transport.list(KEY))).toEqual([]);
    const feed = createExecFeed({ transport: page.transport, pageKey: KEY, attach: { id: 'term-1' }, warn: () => undefined });
    await until(() => feed.getSnapshot().state === 'failed', 'the host to refuse');
    expect(statusOf(feed)).toEqual({ state: 'failed', cause: { stage: 'start', message: 'Session term-1 not found' } });
    await feed.close();
    expect(host.calls().filter((call) => call.kind === 'close')).toEqual([]);
  });

  it('is refused a terminal it has no key for: the same words as for a terminal that is not there', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    first.feed.leave?.();
    host.home.die();
    const page = host.page();
    const feed = createExecFeed({ transport: page.transport, pageKey: 'another-key-of-another-page-0000', attach: { id: 'term-1' }, warn: () => undefined });
    await until(() => feed.getSnapshot().state === 'failed', 'the host to refuse');
    expect(statusOf(feed).cause?.message).toBe('Session term-1 not found');
  });
});

// ---- T2d: the events of a page drop and come back (docs/ui-next/status/T2b.md, "rejoin") -------------------------------------------------------------------------------------------------------------------------
//
// A window whose events connection dropped loses what the host emitted meanwhile for good: nothing is replayed to a socket that was down (`HostPage.disconnect`), while its calls still work. The page asks the host
// for what it lacks (`rejoin`: `AttachTerminal` from the offset it has), and the host answers from there (the start rounded down to a chunk of its ring) or, when its ring has moved past that offset, from the oldest
// byte it kept: a gap, which the page is handed as a replay for a fresh emulator. What is asked of the pair is the promise of a reload (2.4 rules 5 and 6): every byte ONCE and in ORDER, and only the live bytes
// acknowledged, the host's debt for what came before the attach having been forgotten by the attach.

describe('the events of a page drop and come back: the page asks the host for what it lost (`rejoin`, T2d)', () => {
  const TOTAL = 6 * MIB;
  const GONE = 'The terminal is not there any more: the host ended it while this window was away.';

  /** A page that started a terminal with a key in the window the host starts with, and reads it as a screen does, from its first byte. */
  function started(host: CreditHost) {
    const warn = vi.fn<(message: string, error?: unknown) => void>();
    const feed = createExecFeed({ transport: host.transport, newId: () => 'term-1', pageKey: KEY, warn });
    feed.resize(100, 30);
    return { feed, reader: readerOf(feed, 0), warn };
  }

  /** A page that took the terminal over in a window of its own, as a page does after a reload, and reads it as a screen does. */
  function tookOver(window: HostPage) {
    const warn = vi.fn<(message: string, error?: unknown) => void>();
    const feed = createExecFeed({ transport: window.transport, pageKey: KEY, attach: { id: 'term-1', program: 'sh' }, warn });
    return { feed, reader: readerOf(feed), warn };
  }

  const finished = (host: CreditHost, reader: Reader): boolean => reader.end() === TOTAL && host.waiting() === 0 && host.unacked() === 0;

  const sum = (counts: readonly number[]): number => counts.reduce((total, bytes) => total + bytes, 0);

  /**
   * The flood goes on, the window's events drop, and the host goes on reading until it stops at its mark, since nobody acknowledges what the page never heard: it has then delivered what the page did not hear, which
   * is the most of a megabyte. (The host may be at its mark when the events drop, until the acknowledgements in flight reach it: the wait is for the bytes that were lost, not for the pause.)
   */
  async function dropped(host: CreditHost, window: HostPage, reader: Reader, from: number) {
    host.produce(TOTAL);
    await until(() => host.delivered() >= from, 'the flood to be under way');
    const before = host.delivered();
    window.disconnect();
    await until(() => host.paused() && host.delivered() >= before + MIB / 2, 'the host to stop at its mark, with half a megabyte that the page did not hear');
    const heard = reader.end() ?? -1;
    expect(heard).toBeLessThan(host.delivered());
    return { heard, lost: host.delivered() };
  }

  it('asks for what it lost and is given it as ordinary output: a drop in the middle of a flood loses nothing and repeats nothing, the screen is handed no replay, and only what the host delivered after the attach is acknowledged', async () => {
    const host = fakeCreditHost();
    const page = started(host);
    await turns();
    const { heard, lost } = await dropped(host, host.home, page.reader, 2 * MIB);
    host.home.reconnect();
    const mark = host.acks().length;
    page.feed.rejoin?.();
    await until(() => finished(host, page.reader), 'the rest of the flood to reach the page');
    expect(host.replays()).toEqual([{ page: 0, from: heard, start: heard, end: lost }]);
    expect(page.reader.replays()).toBe(0);
    expect(page.reader.start()).toBe(0);
    expect(matches(page.reader.written(), host, 0)).toBe(true);
    expect(page.reader.written()).toHaveLength(TOTAL);
    // The host forgot what it was owed for everything below the end of the replay, so none of those bytes may be acknowledged: they were not the debt of the new attachment. What it delivered after, all of it was.
    expect(sum(host.acks().slice(mark))).toBe(TOTAL - lost);
    expect(host.mostUnacked()).toBeLessThan(HIGH + READ);
    expect(host.paused()).toBe(false);
    expect(page.warn).not.toHaveBeenCalled();
    expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
    expect(host.holder()).toMatchObject({ attachment: 1, detached: false, owner: 0 });
    expect(host.calls().map((call) => call.kind)).toEqual(['create', 'attach']);
  });

  it('does the same for a page that took the terminal over after a reload: the replay of its first attach stays what its screen started from, and the rejoin joins the rest to it', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    host.produce(TOTAL);
    await until(() => host.delivered() >= MIB, 'the flood to be under way');
    first.feed.leave?.();
    host.home.die();
    const window = host.page();
    const page = tookOver(window);
    await until(() => page.feed.getSnapshot().state === 'running', 'the terminal to be taken over');
    await until(() => host.delivered() >= 3 * MIB, 'the flood to go on to the new page');
    window.disconnect();
    await until(() => host.paused(), 'the host to stop at its mark');
    const lost = host.delivered();
    window.reconnect();
    const mark = host.acks().length;
    page.feed.rejoin?.();
    await until(() => finished(host, page.reader), 'the rest of the flood to reach the page');
    const [, again] = host.replays();
    expect(host.replays()).toHaveLength(2);
    expect(again?.start).toBe(again?.from);
    expect(page.reader.replays()).toBe(1);
    const start = page.reader.start() ?? -1;
    expect(start).toBe(host.replays()[0]?.start);
    expect(matches(page.reader.written(), host, start)).toBe(true);
    expect(page.reader.written()).toHaveLength(TOTAL - start);
    expect(sum(host.acks().slice(mark))).toBe(TOTAL - lost);
    expect(page.warn).not.toHaveBeenCalled();
    expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
  });

  it('takes the terminal back from a host that detached it while the events were away: the lease was running and the reader was held, and the attach lets the shell go on', async () => {
    const host = fakeCreditHost();
    const page = started(host);
    await turns();
    const { heard, lost } = await dropped(host, host.home, page.reader, 2 * MIB);
    // The terminal is detached while the events were away (its window was retired, or a detach of the page reached the host after the drop): its reader is held and its lease runs until a window attaches it.
    await host.transport.detach('term-1', { pageKey: KEY });
    expect(host.holder()).toMatchObject({ detached: true, owner: undefined });
    await turns(50);
    expect(host.delivered()).toBe(lost);
    host.home.reconnect();
    const mark = host.acks().length;
    page.feed.rejoin?.();
    await until(() => finished(host, page.reader), 'the rest of the flood to reach the page');
    expect(host.replays()).toEqual([{ page: 0, from: heard, start: heard, end: lost }]);
    expect(host.holder()).toMatchObject({ attachment: 1, detached: false, owner: 0 });
    expect(page.reader.replays()).toBe(0);
    expect(matches(page.reader.written(), host, 0)).toBe(true);
    expect(page.reader.written()).toHaveLength(TOTAL);
    expect(sum(host.acks().slice(mark))).toBe(TOTAL - lost);
    expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
  });

  it('hands the host\'s ring to the screen as a replay when it no longer reaches back to what the page has: the screen starts again from the ring, every byte of it once and in order, and only the live bytes are acknowledged', async () => {
    const host = fakeCreditHost({ ring: 128 * 1_024 });
    const page = started(host);
    await turns();
    const { heard } = await dropped(host, host.home, page.reader, 2 * MIB);
    host.home.reconnect();
    const mark = host.acks().length;
    page.feed.rejoin?.();
    await until(() => finished(host, page.reader), 'the rest of the flood to reach the page');
    const [replay] = host.replays();
    expect(host.replays()).toHaveLength(1);
    expect(replay?.from).toBe(heard);
    expect(replay?.start).toBeGreaterThan(heard);
    expect(page.reader.replays()).toBe(1);
    expect(page.reader.start()).toBe(replay?.start);
    expect(matches(page.reader.written(), host, replay?.start ?? -1)).toBe(true);
    expect(page.reader.written()).toHaveLength(TOTAL - (replay?.start ?? 0));
    expect(sum(host.acks().slice(mark))).toBe(TOTAL - (replay?.end ?? 0));
    expect(host.mostUnacked()).toBeLessThan(HIGH + READ);
    expect(page.warn).not.toHaveBeenCalled();
    expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
  });

  it('has the replay start where the host\'s ring does and still joins exactly, when the host keeps its ring in chunks of 64 KiB: the answer starts before the offset the page asked from, and the page skips what it has', async () => {
    const host = fakeCreditHost({ chunk: 65_536 });
    const page = started(host);
    await turns();
    const { heard, lost } = await dropped(host, host.home, page.reader, 2 * MIB + 12_345);
    host.home.reconnect();
    const mark = host.acks().length;
    page.feed.rejoin?.();
    await until(() => finished(host, page.reader), 'the rest of the flood to reach the page');
    const [replay] = host.replays();
    expect(replay?.from).toBe(heard);
    // The offset the page asked from is not on a boundary of the host's chunks, so the answer starts below it, and the page skips what it has.
    expect(heard % 65_536).not.toBe(0);
    expect(replay?.start).toBe(heard - (heard % 65_536));
    expect(replay?.end).toBe(lost);
    expect(page.reader.replays()).toBe(0);
    expect(matches(page.reader.written(), host, 0)).toBe(true);
    expect(page.reader.written()).toHaveLength(TOTAL);
    expect(sum(host.acks().slice(mark))).toBe(TOTAL - lost);
    expect(page.warn).not.toHaveBeenCalled();
  });

  it('is not told it lost the terminal by the host\'s echo of its own takeover, whether it reaches the page before the answer or after it, and drops the events the answer covers when they reach it late: nothing is lost, nothing is repeated', async () => {
    for (const when of ['before', 'after'] as const) {
      const host = fakeCreditHost();
      const page = started(host);
      await turns();
      const { lost } = await dropped(host, host.home, page.reader, 2 * MIB);
      host.home.reconnect();
      if (when === 'after') {
        host.home.hold();
      }

      const mark = host.acks().length;
      page.feed.rejoin?.();
      await turns(8);
      if (when === 'after') {
        // The echo of the takeover, and the output the host read once the attach had let it go, are in the wire still: they reach the page after the answer.
        expect(host.home.queued()).toBeGreaterThan(1);
        expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
        host.home.release();
      }

      await until(() => finished(host, page.reader), 'the rest of the flood to reach the page');
      expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
      expect(page.reader.replays()).toBe(0);
      expect(matches(page.reader.written(), host, 0)).toBe(true);
      expect(page.reader.written()).toHaveLength(TOTAL);
      expect(sum(host.acks().slice(mark))).toBe(TOTAL - lost);
      expect(page.warn).not.toHaveBeenCalled();
      expect(host.holder()).toMatchObject({ attachment: 1, owner: 0, detached: false });
    }
  });

  it('drops what the answer covers when it reaches the page after it, for a window whose events were late and not lost: the page asks again while the events of the gap wait in the wire, and they follow the answer', async () => {
    const host = fakeCreditHost();
    const page = started(host);
    await turns();
    host.produce(TOTAL);
    await until(() => host.delivered() >= 2 * MIB, 'the flood to be under way');
    // The wire is held: the host's events wait in it and nobody acknowledges them, so the host stops at its mark when it has put a megabyte in the wire.
    host.home.hold();
    await until(() => host.paused() && host.home.queued() > 40, 'the host to stop at its mark, with the events of a megabyte in the wire');
    const lost = host.delivered();
    const waiting = host.home.queued();
    expect(waiting).toBeGreaterThan(40);
    const mark = host.acks().length;
    page.feed.rejoin?.();
    await turns(8);
    expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
    // The events below the end of the answer wait in the wire still, and the ones the host read after the attach lie after them.
    expect(host.home.queued()).toBeGreaterThan(waiting);
    host.home.release();
    await until(() => finished(host, page.reader), 'the rest of the flood to reach the page');
    expect(page.reader.replays()).toBe(0);
    expect(matches(page.reader.written(), host, 0)).toBe(true);
    expect(page.reader.written()).toHaveLength(TOTAL);
    expect(sum(host.acks().slice(mark))).toBe(TOTAL - lost);
    expect(page.warn).not.toHaveBeenCalled();
    expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
  });

  it('fails in words when the host no longer has the terminal: it was detached while the events were away and its lease ran out, and the refusal says it is gone; what the page read stays readable', async () => {
    const host = fakeCreditHost();
    const page = started(host);
    await turns();
    host.say('hello\r\n');
    await turns();
    host.home.disconnect();
    await host.transport.detach('term-1', { pageKey: KEY });
    host.expire();
    host.home.reconnect();
    page.feed.rejoin?.();
    await until(() => page.feed.getSnapshot().state === 'failed', 'the host to refuse');
    expect(page.feed.getSnapshot()).toEqual({ state: 'failed', cause: { stage: 'session', message: GONE } });
    expect(text(page.reader.written())).toBe('hello\r\n');
    expect(host.calls().map((call) => call.kind)).toEqual(['create', 'detach', 'attach']);
    await expect(page.feed.close()).resolves.toBeUndefined();
  });

  it('shows how the shell ended when it exited while the events were away, with the output it wrote before: the missed output is read first, the state is `ended` with its code, and nothing is acknowledged for it', async () => {
    const host = fakeCreditHost();
    const page = started(host);
    await turns();
    host.say('hello\r\n');
    await turns();
    host.home.disconnect();
    host.say('bye\r\n');
    await turns();
    host.exit(3);
    host.home.reconnect();
    const mark = host.acks().length;
    page.feed.rejoin?.();
    await until(() => page.feed.getSnapshot().state === 'ended', 'the end to be read');
    expect(page.feed.getSnapshot()).toEqual({ state: 'ended', exit: { code: 3 }, program: 'sh' });
    expect(text(page.reader.written())).toBe('hello\r\nbye\r\n');
    expect(page.reader.replays()).toBe(0);
    expect(sum(host.acks().slice(mark))).toBe(0);
  });

  it('takes the terminal back from the page that took it while the events were away, and its input goes on from the host\'s number: no call is refused as stale, and the page that lost it is told', async () => {
    const host = fakeCreditHost();
    const page = started(host);
    await turns();
    page.feed.write('ls\r');
    host.say('one ');
    await turns();
    host.home.disconnect();
    // Another window takes the terminal: the host tells the window that held it, and that window hears nothing.
    const other = host.page();
    const taker = tookOver(other);
    await until(() => taker.feed.getSnapshot().state === 'running', 'the other window to take the terminal');
    taker.feed.write('pwd\r');
    await turns(8);
    expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
    host.say('two ');
    host.home.reconnect();
    page.feed.rejoin?.();
    await until(() => text(page.reader.written()) === 'one two ', 'the page to read what it missed');
    expect(taker.feed.getSnapshot()).toEqual({ state: 'ended', detached: { by: 'taken-over' }, program: 'sh' });
    page.feed.write('date\r');
    await turns(8);
    expect(host.inputs()).toEqual([
      { kind: 'write', seq: 1, text: 'ls\r' },
      { kind: 'write', seq: 2, text: 'pwd\r' },
      { kind: 'write', seq: 3, text: 'date\r' },
    ]);
    expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
    expect(host.holder()).toMatchObject({ attachment: 2, detached: false, owner: 0 });
    expect(page.warn).not.toHaveBeenCalled();
  });

  it('leaves a full-screen program usable when the page asks again: the screen is the size the host has, so what is typed goes on from the host\'s number, and a size that differs is sent', async () => {
    const host = fakeCreditHost();
    const page = started(host);
    await turns();
    page.feed.write('vim notes.txt\r');
    host.say('\u001b[?1049h\u001b[H\u001b[2Jnotes.txt  1,1  All');
    host.modes({ alt_screen: true, mouse_tracking: 5 });
    await until(() => page.reader.live() > 0, 'the screen of the program to be read');
    host.home.disconnect();
    host.say('x');
    await turns();
    page.feed.resize(120, 40);
    vi.advanceTimersByTime(200);
    await turns();
    host.home.reconnect();
    page.feed.rejoin?.();
    await until(() => text(page.reader.written()).endsWith('1,1  All' + 'x'), 'the page to read what it missed');
    page.feed.write('i');
    await turns(8);
    expect(host.inputs().slice(-2)).toEqual([
      { kind: 'resize', seq: 2, rows: 40, cols: 120 },
      { kind: 'write', seq: 3, text: 'i' },
    ]);
    expect(page.feed.getSnapshot()).toEqual({ state: 'running', program: 'sh' });
    expect(page.warn).not.toHaveBeenCalled();
  });
});

describe('a page that lost the terminal learns that the tab that took it has gone: it may be taken back (T2d)', () => {
  function started(host: CreditHost) {
    const warn = vi.fn<(message: string, error?: unknown) => void>();
    const feed = createExecFeed({ transport: host.transport, newId: () => 'term-1', pageKey: KEY, warn });
    feed.resize(100, 30);
    return { feed, reader: readerOf(feed, 0), warn };
  }

  /** A feed of another window that takes the terminal over, as the tab of that window does. */
  const takenBy = async (window: HostPage) => {
    const feed = createExecFeed({ transport: window.transport, pageKey: KEY, attach: { id: 'term-1', program: 'sh' }, warn: () => undefined });
    await until(() => feed.getSnapshot().state === 'running', 'the terminal to be taken over');
    return feed;
  };

  const lostFor = (feed: TerminalFeedHandle): TerminalFeedSnapshot => feed.getSnapshot();

  it('is told the terminal is free when the window that took it goes away (WebKit drops the detach of a closing tab, so the host says `window-retired` some seconds later), and takes it back by attaching again', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    host.say('one ');
    await turns();
    const window = host.page();
    await takenBy(window);
    expect(lostFor(first.feed)).toEqual({ state: 'ended', detached: { by: 'taken-over' }, program: 'sh' });
    window.die();
    expect(lostFor(first.feed)).toEqual({ state: 'ended', detached: { by: 'taken-over', free: true }, program: 'sh' });
    expect(host.holder()).toMatchObject({ attachment: 1, detached: true, owner: undefined });
    // The person takes it back: the tab opens a feed that attaches the terminal, in the window of the tab.
    const again = createExecFeed({ transport: host.transport, pageKey: KEY, attach: { id: 'term-1', program: 'sh' }, warn: () => undefined });
    const reader = readerOf(again);
    await until(() => again.getSnapshot().state === 'running', 'the terminal to be taken back');
    host.say('two');
    await until(() => text(reader.written()) === 'one two', 'the page to read the terminal');
    expect(host.holder()).toMatchObject({ attachment: 2, detached: false, owner: 0 });
    // The feed that lost the terminal neither detaches nor closes what the new one shows.
    await first.feed.close();
    expect(host.calls().filter((call) => call.kind === 'close' || call.kind === 'detach')).toEqual([]);
  });

  it('is told the terminal is free when the tab that took it lets go of it (a browser that delivers the detach says `requested` at once), and learns how the terminal ended when its lease runs out: free is dropped', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    const window = host.page();
    const taker = await takenBy(window);
    taker.leave?.();
    await turns();
    expect(lostFor(first.feed)).toEqual({ state: 'ended', detached: { by: 'taken-over', free: true }, program: 'sh' });
    host.expire();
    expect(lostFor(first.feed)).toEqual({ state: 'ended', detached: { by: 'taken-over' }, exit: { closedBy: 'detach-timeout' }, program: 'sh' });
  });

  it('does not hear of a third tab that attaches a terminal that is already free (the host sends no event for it), so `free` may be stale, and learns when a fourth takes it from the third', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    const second = await takenBy(host.page());
    second.leave?.();
    await turns();
    expect(lostFor(first.feed).detached).toEqual({ by: 'taken-over', free: true });
    await takenBy(host.page());
    expect(lostFor(first.feed).detached).toEqual({ by: 'taken-over', free: true });
    expect(host.holder()).toMatchObject({ attachment: 2, detached: false });
    await takenBy(host.page());
    expect(lostFor(first.feed).detached).toEqual({ by: 'taken-over' });
    expect(host.holder()).toMatchObject({ attachment: 3, detached: false });
  });

  it('stays as it was when the terminal is taken from the tab that took it by another tab: it is held, as it was', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    await takenBy(host.page());
    const lost = lostFor(first.feed);
    await takenBy(host.page());
    expect(lostFor(first.feed)).toBe(lost);
    expect(lost.detached).toEqual({ by: 'taken-over' });
  });

  it('learns by `refresh` that the tab that took the terminal released it while this page\'s events were down: the host lists the terminal as not held, the terminal is free, nothing is attached; and learns that a third tab holds it again', async () => {
    const host = fakeCreditHost();
    const first = started(host);
    await turns();
    const taker = await takenBy(host.page());
    expect(lostFor(first.feed)).toEqual({ state: 'ended', detached: { by: 'taken-over' }, program: 'sh' });
    // The page's events drop, and the tab that holds the terminal lets go of it: the host's `DETACHED` is lost to the page for good.
    host.home.disconnect();
    taker.leave?.();
    await turns();
    host.home.reconnect();
    expect(lostFor(first.feed).detached).toEqual({ by: 'taken-over' });
    await first.feed.refresh?.();
    expect(lostFor(first.feed)).toEqual({ state: 'ended', detached: { by: 'taken-over', free: true }, program: 'sh' });
    expect(host.calls().map((call) => call.kind)).toEqual(['create', 'attach', 'detach', 'list']);
    expect(host.holder()).toMatchObject({ attachment: 1, detached: true, owner: undefined });
    // Another tab takes it while the page is not listening, and the page asks again.
    host.home.disconnect();
    await takenBy(host.page());
    host.home.reconnect();
    expect(lostFor(first.feed).detached).toEqual({ by: 'taken-over', free: true });
    await first.feed.refresh?.();
    expect(lostFor(first.feed).detached).toEqual({ by: 'taken-over' });
    expect(host.calls().filter((call) => call.kind === 'attach')).toHaveLength(2);
  });
});

describe('the fake feed of the tests of the Terminal tool, as far as a rejoin and a replay that comes later need it (T2d)', () => {
  const modes: TerminalModes = { altScreen: false, bracketedPaste: false, applicationCursor: false, focusEvents: false, cursorHidden: false, mouseTracking: 0, mouseEncoding: 0, kittyKeyboard: [] };
  const replayOf = (text: string): TerminalReplay => ({ data: new TextEncoder().encode(text), startSize: { cols: 80, rows: 24 }, startModes: modes, size: { cols: 80, rows: 24 }, modes, end: text.length });

  it('has `rejoin` and `takeReplay` only when it is asked to, and counts the calls of `rejoin`', () => {
    const plain = fakeTerminalFeed();
    expect(plain.rejoin).toBeUndefined();
    expect(plain.takeReplay).toBeUndefined();
    const keyed = fakeTerminalFeed({ rejoin: true });
    expect(keyed.takeReplay?.()).toBeUndefined();
    expect(keyed.rejoins()).toBe(0);
    keyed.rejoin?.();
    keyed.rejoin?.();
    expect(keyed.rejoins()).toBe(2);
  });

  it('gives a replay that is offered once, at any time, and gives no output before it is taken: the output it held and nobody read is dropped, the listeners are told at once even when a wake-up is pending', () => {
    const feed = fakeTerminalFeed({ rejoin: true });
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
    const feed = fakeTerminalFeed({ rejoin: true });
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

  it('refuses a replay it cannot give: a fake made without `rejoin` or a replay has no `takeReplay`, so offering one throws before anything changes', () => {
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

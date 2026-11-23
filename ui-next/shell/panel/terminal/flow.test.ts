import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineAppearance } from './engine';
import { createExecFeed } from './execFeed';
import { FLOW, createScreen } from './screen';
import { createScreenReaderChoice } from './screenReader';
import { fakeCreditHost, fakeEngineLoader, type CreditHost, type FakeEngine } from './testing';

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

import { describe, expect, it, vi } from 'vitest';
import type { Platform } from '../../core/chords';
import type { EngineAppearance } from './engine';
import type { TerminalModes, TerminalReplay } from './feed';
import { FLOW, HIDDEN_TICK_MS, SCROLLBACK, clearScreenIn, createScreen, type TerminalScreen } from './screen';
import { createScreenReaderChoice, type ScreenReaderChoice } from './screenReader';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngine, type FakeEngineLoader, type FakeEngineOptions, type FakeTerminalFeed } from './testing';

// The screen of a terminal session: the one object between a feed and an emulator (docs/ui-next/status/T1.md, "The screen"). It loads the emulator when the session is first SHOWN and not before, draws what the feed
// holds one frame at a time and never more than the emulator can parse, follows the size of its host (one measure per frame, and a message to the feed only for a size that changed, and only once the GPU renderer is in
// place, so that the process starts at the size the person sees), and, while it is hidden, goes on reading, parsing and acknowledging (a build in a session that is not shown is never stalled by the view) in frames of a
// smaller share and draws nothing: no observer, no GPU context, no measure, and no frame once the feed has nothing more. A timer stands beside every frame it asks for, shown or hidden, for a window whose frames are
// suspended. Against a fake emulator and a fake clock.

const APPEARANCE: EngineAppearance = {
  theme: { background: '#000', foreground: '#fff', cursor: '#fff', cursorAccent: '#000', selectionBackground: '#222', selectionInactiveBackground: '#111', palette: Array.from({ length: 16 }, () => '#888') },
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.33,
};

type Rig = {
  readonly screen: TerminalScreen;
  readonly feed: FakeTerminalFeed;
  readonly loader: FakeEngineLoader;
  readonly host: HTMLElement;
  readonly engine: () => FakeEngine;
  /** Runs the animation frames that were asked for, as one frame of the browser does. */
  readonly frame: () => void;
  readonly frames: () => { readonly asked: number; readonly pending: number; readonly cancelled: number };
  /** Runs the timers that were asked for, as the clock reaching `HIDDEN_TICK_MS` does, with no frame: a window whose frames are suspended. */
  readonly tick: () => void;
  /** The timers the screen asked for (its `later`), with the delay each was asked for. */
  readonly timers: () => { readonly asked: number; readonly pending: number; readonly cancelled: number; readonly delays: readonly number[] };
  readonly observers: () => { readonly alive: number; readonly started: number };
  /** The host's size changed: what a ResizeObserver tells. */
  readonly resized: () => void;
  readonly copied: string[];
  /** Lets the asynchronous steps of the screen run. */
  readonly settle: () => Promise<void>;
  /** The window's one screen reader choice, as the screen is given it, and how many listeners the screen has on it now. */
  readonly reader: ScreenReaderChoice;
  readonly readerListeners: () => number;
  readonly fonts: { readonly release: () => void; readonly asked: () => readonly string[] };
  /** A reattached feed's replay arrives (the attach was still being answered when the screen asked), and the feed tells its listeners. */
  readonly arrive: (replay: TerminalReplay) => void;
  /** How many times the screen asked the feed to make a full-screen program paint again. */
  readonly redraws: () => number;
  /** How many replays the screen has taken from the feed. */
  readonly takes: () => number;
};

type RigOptions = {
  readonly platform?: Platform;
  readonly deferred?: boolean;
  readonly auto?: boolean;
  readonly fontsHeld?: boolean;
  readonly rendererReady?: Promise<void>;
  readonly copy?: (text: string) => Promise<boolean>;
  readonly screenReader?: boolean;
  readonly defaultTimer?: boolean;
  /** The queries the emulator answers when it parses them (`FakeEngineOptions.answers`). */
  readonly answers?: FakeEngineOptions['answers'];
  /**
   * The feed was reattached: it has `takeReplay` and holds `replay` until its reader takes it, and reads nothing before (what `takeReplay` is for, feed.ts). Without a `replay` the attach is still being answered, until `arrive`.
   * `redraw: false` is a feed that cannot make a program paint again.
   */
  readonly reattach?: { readonly replay?: TerminalReplay; readonly redraw?: boolean };
};

function rig(options: RigOptions = {}): Rig {
  const base = fakeTerminalFeed();
  let held: TerminalReplay | undefined = options.reattach?.replay;
  let attaching = options.reattach !== undefined && held === undefined;
  let takes = 0;
  let redraws = 0;
  const reattachedFeed: FakeTerminalFeed = {
    ...base,
    read: (max) => (held === undefined && !attaching ? base.read(max) : { chunks: [], bytes: 0 }),
    takeReplay: () => {
      const found = held;
      held = undefined;
      if (found !== undefined) {
        takes += 1;
      }

      return found;
    },
    ...(options.reattach?.redraw === false ? {} : { redraw: () => {
      redraws += 1;
    } }),
  };
  const feed = options.reattach === undefined ? base : reattachedFeed;
  const loader = fakeEngineLoader({ deferred: options.deferred === true, auto: options.auto ?? true, rendererReady: options.rendererReady, answers: options.answers });
  const host = document.createElement('div');
  const queue: Array<(() => void) | undefined> = [];
  let asked = 0;
  let cancelled = 0;
  const laterQueue: Array<{ readonly callback: () => void; readonly ms: number; live: boolean }> = [];
  let laterCancelled = 0;
  const observed = new Set<() => void>();
  let started = 0;
  const copied: string[] = [];
  const fontWaits: Array<() => void> = [];
  const fontsAsked: string[] = [];
  const reader = createScreenReaderChoice(options.screenReader);
  let readerHeard = 0;
  const screen = createScreen({
    feed,
    load: loader.load,
    appearance: () => APPEARANCE,
    platform: options.platform ?? 'mac',
    label: 'Terminal input, Terminal',
    descriptionId: 'hint-1',
    screenReader: {
      getSnapshot: reader.getSnapshot,
      subscribe: (listener) => {
        readerHeard += 1;
        const stop = reader.subscribe(listener);
        let live = true;
        return () => {
          if (live) {
            live = false;
            readerHeard -= 1;
            stop();
          }
        };
      },
    },
    frame: (callback) => {
      asked += 1;
      queue.push(callback);
      const at = queue.length - 1;
      return () => {
        if (queue[at] !== undefined) {
          queue[at] = undefined;
          cancelled += 1;
        }
      };
    },
    // `defaultTimer`: the screen is given no clock and uses the plain timer.
    later: options.defaultTimer === true ? undefined : (callback, ms) => {
      const timer = { callback, ms, live: true };
      laterQueue.push(timer);
      return () => {
        if (timer.live) {
          timer.live = false;
          laterCancelled += 1;
        }
      };
    },
    observe: (_element, callback) => {
      started += 1;
      observed.add(callback);
      return () => {
        observed.delete(callback);
      };
    },
    fontsReady: async (font) => {
      fontsAsked.push(font);
      return options.fontsHeld === true ? new Promise<void>((resolve) => {
        fontWaits.push(resolve);
      }) : Promise.resolve();
    },
    copy: options.copy ?? (async (text) => {
      copied.push(text);
      return Promise.resolve(true);
    }),
    warn: () => undefined,
  });
  return {
    screen,
    feed,
    loader,
    host,
    engine: () => {
      const made = loader.engines.at(-1);
      if (made === undefined) {
        throw new Error('no emulator was made');
      }

      return made;
    },
    frame: () => {
      const run = queue.splice(0);
      for (const callback of run) {
        callback?.();
      }
    },
    frames: () => ({ asked, pending: queue.filter((callback) => callback !== undefined).length, cancelled }),
    tick: () => {
      for (const timer of laterQueue.filter((one) => one.live)) {
        if (timer.live) {
          timer.live = false;
          timer.callback();
        }
      }
    },
    timers: () => ({ asked: laterQueue.length, pending: laterQueue.filter((one) => one.live).length, cancelled: laterCancelled, delays: laterQueue.map((one) => one.ms) }),
    observers: () => ({ alive: observed.size, started }),
    resized: () => {
      for (const callback of [...observed]) {
        callback();
      }
    },
    copied,
    reader,
    readerListeners: () => readerHeard,
    settle: async () => {
      for (let turn = 0; turn < 8; turn += 1) {
        await Promise.resolve();
      }
    },
    fonts: { release: () => {
      fontWaits.splice(0).forEach((resolve) => {
        resolve(); 
      }); 
    }, asked: () => fontsAsked },
    arrive: (replay) => {
      held = replay;
      attaching = false;
      base.wake();
    },
    redraws: () => redraws,
    takes: () => takes,
  };
}

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('before it is shown', () => {
  it('loads nothing, makes nothing, reads nothing and listens to nothing: a terminal that is not on screen costs no code and no time', async () => {
    const { screen, feed, loader, host, frames, observers, settle } = rig();
    screen.mount(host);
    await settle();
    expect(loader.loads()).toBe(0);
    expect(feed.listeners()).toBe(0);
    expect(feed.reads()).toBe(0);
    expect(frames().asked).toBe(0);
    expect(observers().started).toBe(0);
    expect(screen.getSnapshot()).toEqual({ ready: false, selected: false, error: undefined });
  });
});

describe('the first time it is shown', () => {
  it('asks for the emulator once, opens it in its host, sizes it to what fits, tells the feed that size at once, listens to the feed, and draws what it held in the next frame', async () => {
    const { screen, feed, loader, host, engine, frame, settle } = rig();
    screen.mount(host);
    feed.push('prompt $ ');
    screen.show();
    await settle();
    expect(loader.loads()).toBe(1);
    expect(engine().host()).toBe(host);
    expect(engine().options).toMatchObject({ scrollback: SCROLLBACK, appearance: APPEARANCE });
    expect(engine().resizes).toEqual([]);
    expect(feed.sizes()).toEqual([[80, 24]]);
    expect(feed.listeners()).toBe(1);
    expect(screen.getSnapshot().ready).toBe(true);
    expect(engine().text()).toBe('');
    frame();
    expect(engine().text()).toBe('prompt $ ');
  });

  it('sizes the emulator to the host\'s cells when they are not the ones it was made with, and tells the feed what the emulator is', async () => {
    const { screen, feed, loader, host, engine, settle } = rig();
    screen.mount(host);
    screen.show();
    await settle();
    engine().measured({ cols: 190, rows: 11 });
    screen.hide();
    screen.show();
    await settle();
    expect(engine().resizes).toEqual([[190, 11]]);
    expect(feed.sizes().at(-1)).toEqual([190, 11]);
  });

  it('waits for the fonts before it makes the emulator and measures it: the cells of a font that is not there yet are not the cells of the font', async () => {
    const { screen, host, loader, fonts, settle } = rig({ fontsHeld: true });
    screen.mount(host);
    screen.show();
    await settle();
    expect(loader.loads()).toBe(1);
    expect(loader.engines).toHaveLength(0);
    expect(fonts.asked()).toEqual(['12px monospace']);
    fonts.release();
    await settle();
    expect(loader.engines).toHaveLength(1);
    expect(screen.getSnapshot().ready).toBe(true);
  });

  it('names the input for a person who cannot see the screen, and takes the keys before the emulator does', async () => {
    const { screen, host, engine, settle } = rig();
    screen.mount(host);
    screen.show();
    await settle();
    expect(engine().labels).toEqual([['Terminal input, Terminal', 'hint-1']]);
    expect(engine().key({ key: 'a', code: 'KeyA' }).handled).toBe(true);
  });

  it('asks the code once however many times it is shown while it loads, and makes one emulator', async () => {
    const { screen, host, loader, settle } = rig({ deferred: true });
    screen.mount(host);
    screen.show();
    screen.show();
    screen.hide();
    screen.show();
    await settle();
    expect(loader.loads()).toBe(1);
    loader.release();
    await settle();
    expect(loader.engines).toHaveLength(1);
  });

  it('makes no emulator when it was hidden again before the code came: it makes it the next time it is shown', async () => {
    const { screen, host, loader, settle } = rig({ deferred: true });
    screen.mount(host);
    screen.show();
    screen.hide();
    loader.release();
    await settle();
    expect(loader.engines).toHaveLength(0);
    screen.show();
    await settle();
    expect(loader.engines).toHaveLength(1);
    expect(loader.loads()).toBe(1);
  });

  it('makes no emulator, and holds nothing, when it was disposed before the code came', async () => {
    const { screen, host, loader, feed, settle } = rig({ deferred: true });
    screen.mount(host);
    screen.show();
    screen.dispose();
    loader.release();
    await settle();
    expect(loader.engines).toHaveLength(0);
    expect(feed.listeners()).toBe(0);
  });

  it('says that it could not start when the code does not load, and tries again the next time it is shown', async () => {
    const { screen, host, loader, settle } = rig({ deferred: true });
    screen.mount(host);
    screen.show();
    loader.fail(new Error('Failed to fetch'));
    await settle();
    expect(screen.getSnapshot()).toEqual({ ready: false, selected: false, error: 'Failed to fetch' });
    screen.hide();
    screen.show();
    expect(screen.getSnapshot().error).toBeUndefined();
    loader.release();
    await settle();
    expect(loader.loads()).toBe(2);
    expect(loader.engines).toHaveLength(1);
    expect(screen.getSnapshot().ready).toBe(true);
  });

  it('draws with the GPU renderer while it is shown', async () => {
    const { screen, host, engine, settle } = rig();
    screen.mount(host);
    screen.show();
    await settle();
    expect(engine().renderers).toEqual(['gpu']);
  });
});

describe('what the process writes', () => {
  async function shown() {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    // The first show asks for a frame to draw what the feed held: it is the frame after it that these are about.
    r.frame();
    return r;
  }

  it('is drawn in the next frame, not in the event: a wake-up asks for ONE frame however many come', async () => {
    const { feed, engine, frame, frames } = await shown();
    const before = frames().asked;
    feed.push('a');
    feed.push('b');
    feed.wake();
    feed.wake();
    expect(engine().text()).toBe('');
    expect(frames().asked).toBe(before + 1);
    frame();
    expect(engine().text()).toBe('ab');
  });

  it('writes a frame\'s worth of small chunks as ONE call: a thousand events in a frame are one write', async () => {
    const { feed, engine, frame } = await shown();
    for (let index = 0; index < 1_000; index += 1) {
      feed.push('y\r\n');
    }

    frame();
    expect(engine().writes).toHaveLength(1);
    expect(engine().text()).toBe('y\r\n'.repeat(1_000));
  });

  it('cuts what is large into slices the emulator parses without a long task, in order, and none lost or repeated', async () => {
    const { feed, engine, frame } = await shown();
    const big = new Uint8Array(FLOW.slice * 3 + 17).map((_, index) => index & 0xff);
    feed.push(big);
    frame();
    const writes = engine().writes.map((data) => (typeof data === 'string' ? bytesOf(data) : data));
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const write of writes) {
      expect(write.length).toBeLessThanOrEqual(FLOW.slice);
    }

    expect(Uint8Array.from(writes.flatMap((write) => [...write]))).toEqual(big);
  });

  it('writes nothing for a frame in which nothing is held, and asks for no frame after it', async () => {
    const { feed, engine, frame, frames } = await shown();
    feed.push('a');
    frame();
    const writes = engine().writes.length;
    const asked = frames().asked;
    frame();
    expect(engine().writes).toHaveLength(writes);
    expect(frames().asked).toBe(asked);
  });

  it('takes no more than the emulator can parse: it stops at the bound of what is accepted and not parsed, leaves the rest in the feed, and goes on as the emulator parses', async () => {
    const r = rig({ auto: false });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    const piece = new Uint8Array(FLOW.slice);
    const pieces = FLOW.high / FLOW.slice;
    for (let index = 0; index < pieces * 3; index += 1) {
      r.feed.push(piece);
    }

    // Each frame takes its share (FLOW.frame) and asks for the next: frames until the bound of what is accepted and not parsed.
    for (let frame = 0; frame < pieces * 2; frame += 1) {
      r.frame();
    }

    expect(r.engine().writes).toHaveLength(pieces);
    expect(r.feed.read(0).chunks.length).toBeGreaterThan(0);
  });

  it('takes only its share of the held output in a frame, and asks for the next frame while the feed holds more: a frame that comes late is never one task for a backlog', async () => {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.frame();
    const piece = new Uint8Array(FLOW.slice);
    const total = (FLOW.frame / FLOW.slice) * 3;
    for (let index = 0; index < total; index += 1) {
      r.feed.push(piece);
    }

    const bytes = () => r.engine().writes.reduce((sum, write) => sum + (typeof write === 'string' ? write.length : write.byteLength), 0);
    const asked = r.frames().asked;
    r.frame();
    expect(bytes()).toBeLessThanOrEqual(FLOW.frame + FLOW.slice);
    expect(bytes()).toBeGreaterThanOrEqual(FLOW.frame);
    expect(r.frames().asked).toBe(asked + 1);
    r.frame();
    r.frame();
    expect(bytes()).toBe(total * FLOW.slice);
    // Drained: the frame that took the last share asks for no more.
    const after = r.frames().asked;
    r.frame();
    expect(r.frames().asked).toBe(after);
  });

  it('goes on drawing when the emulator has parsed what it accepted: the frame after the parse takes more', async () => {
    const r = rig({ auto: false });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    const piece = new Uint8Array(FLOW.slice);
    const pieces = FLOW.high / FLOW.slice;
    for (let index = 0; index < pieces * 2; index += 1) {
      r.feed.push(piece);
    }

    for (let frame = 0; frame < pieces * 2; frame += 1) {
      r.frame();
    }

    expect(r.engine().writes).toHaveLength(pieces);
    r.engine().complete();
    for (let frame = 0; frame < pieces * 2; frame += 1) {
      r.frame();
    }

    expect(r.engine().writes).toHaveLength(pieces * 2);
  });

  it('tells the feed how many bytes the emulator PARSED, and only then: not when it reads them, not when it hands them over, but when the emulator says it has parsed them (the host paces the shell on this count)', async () => {
    const r = rig({ auto: false });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.feed.push('hello');
    r.frame();
    expect(r.engine().writes).toHaveLength(1);
    expect(r.feed.acks()).toEqual([]);
    r.engine().complete();
    expect(r.feed.acks()).toEqual([5]);
  });

  it('acknowledges every byte it read exactly once, in the pieces it handed over, each when it is parsed: the sum is what the feed gave', async () => {
    const r = rig({ auto: false });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    const sizes = [FLOW.slice, FLOW.slice, 1_234];
    for (const size of sizes) {
      r.feed.push(new Uint8Array(size));
    }

    r.frame();
    r.engine().complete(1);
    expect(r.feed.acks()).toEqual([FLOW.slice]);
    r.engine().complete();
    expect(r.feed.acks()).toEqual([FLOW.slice, FLOW.slice, 1_234]);
    expect(r.feed.acks().reduce((sum, bytes) => sum + bytes, 0)).toBe(sizes.reduce((sum, bytes) => sum + bytes, 0));
  });

  it('acknowledges what the emulator parses after the screen was hidden: it took those bytes while it was shown, and the shell waits for their credit', async () => {
    const r = rig({ auto: false });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.feed.push('abc');
    r.frame();
    r.screen.hide();
    expect(r.feed.acks()).toEqual([]);
    r.engine().complete();
    expect(r.feed.acks()).toEqual([3]);
  });

  it('writes why no shell started into the screen, muted, so that what the host tried can be read and copied: the typed words, then the producer\'s own, once', async () => {
    const r = rig();
    r.feed.set({ state: 'failed', cause: { stage: 'start', code: 'SHELL_UNAVAILABLE', message: 'shell executable unavailable: tried the shell asked for "/bin/zsh": not found; $SHELL "/opt/none": not found' } });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.frame();
    expect(r.engine().text()).toBe('\u001b[0m\r\n\u001b[90m[No shell could be started]\u001b[0m\r\n\u001b[0m\r\n\u001b[90m[shell executable unavailable: tried the shell asked for "/bin/zsh": not found; $SHELL "/opt/none": not found]\u001b[0m\r\n');
    r.feed.wake();
    r.frame();
    expect(r.engine().writes).toHaveLength(2);
  });

  it('names the input again when the tab is renamed (the shell said its name): the emulator hears the new label, and one that is made after it is made with it', async () => {
    const r = rig({ deferred: true });
    r.screen.mount(r.host);
    r.screen.show();
    r.screen.rename('Terminal input, zsh');
    r.loader.release();
    await r.settle();
    expect(r.engine().labels).toEqual([['Terminal input, zsh', 'hint-1']]);
    r.screen.rename('Terminal input, bash');
    expect(r.engine().labels.at(-1)).toEqual(['Terminal input, bash', 'hint-1']);
    r.screen.rename('Terminal input, bash');
    expect(r.engine().labels).toHaveLength(2);
  });
});

describe('while it is hidden', () => {
  async function shown() {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.frame();
    return r;
  }

  const taken = (r: Rig) => r.feed.acks().reduce((sum, bytes) => sum + bytes, 0);

  it('lets go of what only a screen on show needs, the observer and the GPU context, and keeps its one listener on the feed: a hidden terminal goes on reading', async () => {
    const { screen, feed, engine, observers } = await shown();
    expect(feed.listeners()).toBe(1);
    screen.hide();
    expect(observers().alive).toBe(0);
    expect(engine().renderers.at(-1)).toBe('dom');
    expect(feed.listeners()).toBe(1);
  });

  it('goes on reading, parsing and acknowledging what the process writes while it is hidden, and draws nothing itself: a build in a session that is not shown is never stalled by the view (VS Code writes every chunk into the emulator and acknowledges it from the write callback whether or not the terminal is shown)', async () => {
    const r = await shown();
    r.screen.hide();
    r.feed.push('while hidden, one');
    r.feed.push('while hidden, two');
    r.frame();
    expect(r.engine().text()).toBe('while hidden, onewhile hidden, two');
    expect(taken(r)).toBe(34);
    expect(r.engine().renderers).toEqual(['gpu', 'dom']);
  });

  it('takes a smaller share of what the feed holds in a frame than it does when shown, and asks for the next frame while the feed holds more: a hidden flood costs the main thread a bounded part of every frame', async () => {
    const r = await shown();
    r.screen.hide();
    expect(FLOW.hiddenFrame).toBeLessThan(FLOW.frame);
    const piece = new Uint8Array(FLOW.slice);
    const total = (FLOW.hiddenFrame / FLOW.slice) * 3;
    for (let index = 0; index < total; index += 1) {
      r.feed.push(piece);
    }

    const asked = r.frames().asked;
    r.frame();
    expect(taken(r)).toBeGreaterThanOrEqual(FLOW.hiddenFrame);
    expect(taken(r)).toBeLessThanOrEqual(FLOW.hiddenFrame + FLOW.slice);
    expect(r.frames().asked).toBe(asked + 1);
    r.frame();
    r.frame();
    expect(taken(r)).toBe(total * FLOW.slice);
  });

  it('asks for no frame once the feed has nothing more: a hidden terminal at rest costs no timer and no frame', async () => {
    const r = await shown();
    r.screen.hide();
    r.feed.push('y\r\n');
    r.frame();
    const asked = r.frames().asked;
    r.frame();
    r.frame();
    expect(r.frames().asked).toBe(asked);
    expect(r.frames().pending).toBe(0);
    expect(r.timers().pending).toBe(0);
  });

  it('measures nothing and tells the feed no size while it is hidden: the panel has none', async () => {
    const r = await shown();
    r.screen.hide();
    const sizes = r.feed.sizes().length;
    r.engine().measured({ cols: 100, rows: 30 });
    r.resized();
    r.feed.push('y\r\n');
    r.frame();
    expect(r.engine().resizes).toEqual([]);
    expect(r.feed.sizes()).toHaveLength(sizes);
  });

  it('has what came while it was hidden in the emulator when it is shown again, written once and not drawn twice, and takes the GPU renderer back', async () => {
    const r = await shown();
    r.screen.hide();
    r.feed.push('while hidden\r\n');
    r.frame();
    const writes = r.engine().writes.length;
    r.screen.show();
    await r.settle();
    r.frame();
    expect(r.engine().text()).toBe('while hidden\r\n');
    expect(r.engine().writes).toHaveLength(writes);
    expect(r.engine().renderers).toEqual(['gpu', 'dom', 'gpu']);
    expect(r.feed.listeners()).toBe(1);
  });

  it('measures again when it is shown: the panel may have been another size when it left', async () => {
    const { screen, feed, engine, settle } = await shown();
    screen.hide();
    engine().measured({ cols: 100, rows: 30 });
    screen.show();
    await settle();
    expect(engine().resizes).toEqual([[100, 30]]);
    expect(feed.sizes().at(-1)).toEqual([100, 30]);
  });

  it('keeps the emulator: what it drew and its scrollback are its own, and hiding makes no new one', async () => {
    const { screen, loader, engine } = await shown();
    screen.hide();
    screen.show();
    expect(loader.engines).toHaveLength(1);
    expect(engine().disposed()).toBe(0);
  });
});

// A frame is what a window that draws gives, and a window that is minimized or covered gives none (the browser suspends its animation frames), whether the screen is shown or hidden. So the screen asks for a timer beside every
// frame it asks for, and whichever comes first runs the pump once and cancels the other: a build in a session must not stall for a window that cannot draw. The share is the one a frame of the screen takes: the shown one
// while it is shown, the smaller one while it is hidden.
describe('a timer beside every frame, for a window whose frames are suspended (minimized, covered): a build must not stall for it, shown or hidden', () => {
  async function shown() {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.frame();
    return r;
  }

  const taken = (r: Rig) => r.feed.acks().reduce((sum, bytes) => sum + bytes, 0);

  it('asks for ONE timer beside its frame while it is shown, however many chunks come, and the frame that comes first runs the pump once and cancels it', async () => {
    const r = await shown();
    const before = r.timers();
    r.feed.push('a');
    r.feed.push('b');
    r.feed.wake();
    expect(r.frames().pending).toBe(1);
    expect(r.timers()).toMatchObject({ asked: before.asked + 1, pending: 1, cancelled: before.cancelled });
    expect(r.timers().delays.at(-1)).toBe(HIDDEN_TICK_MS);
    r.frame();
    expect(r.engine().writes).toHaveLength(1);
    expect(r.engine().text()).toBe('ab');
    expect(r.timers()).toMatchObject({ pending: 0, cancelled: before.cancelled + 1 });
    // The timer that was not needed does not come, and nothing is parsed twice.
    const reads = r.feed.reads();
    r.tick();
    expect(r.feed.reads()).toBe(reads);
    expect(r.engine().writes).toHaveLength(1);
  });

  it('drains from the timer alone when the frames of a SHOWN screen are suspended: a shown share each time, in order, every byte acknowledged, and nothing pending at the end', async () => {
    const r = await shown();
    const piece = new Uint8Array(FLOW.slice);
    const total = (FLOW.frame / FLOW.slice) * 3;
    for (let index = 0; index < total; index += 1) {
      r.feed.push(piece);
    }

    expect(r.frames().pending).toBe(1);
    expect(r.timers().pending).toBe(1);
    const dropped = r.frames().cancelled;
    r.tick();
    // The share of a frame while shown is more than the hidden one.
    expect(taken(r)).toBeGreaterThanOrEqual(FLOW.frame);
    expect(taken(r)).toBeLessThanOrEqual(FLOW.frame + FLOW.slice);
    // The frame that waited beside the timer is cancelled, and the feed holds more: a new frame and a new timer.
    expect(r.frames().cancelled).toBe(dropped + 1);
    expect(r.frames().pending).toBe(1);
    expect(r.timers().pending).toBe(1);
    let before = taken(r);
    for (let guard = 0; guard < 20 && r.timers().pending > 0; guard += 1) {
      r.tick();
      expect(taken(r) - before).toBeLessThanOrEqual(FLOW.frame + FLOW.slice);
      before = taken(r);
    }

    expect(taken(r)).toBe(total * FLOW.slice);
    expect(r.frames().pending).toBe(0);
    expect(r.timers().pending).toBe(0);
  });

  it('asks for no frame and no timer at rest while it is shown: nothing is held, so nothing waits, and what is parsed leaves nothing behind', async () => {
    const r = await shown();
    expect(r.frames().pending).toBe(0);
    expect(r.timers().pending).toBe(0);
    r.feed.push('y\r\n');
    r.frame();
    expect(r.frames().pending).toBe(0);
    expect(r.timers().pending).toBe(0);
  });

  it('has ONE timer pending beside its frame while it is hidden and the feed holds output, and when only the timer comes it parses the hidden share, drops the frame that waited, and asks for both again: at the end nothing is pending', async () => {
    const r = await shown();
    r.screen.hide();
    const before = r.timers();
    const piece = new Uint8Array(FLOW.slice);
    const total = (FLOW.hiddenFrame / FLOW.slice) * 3;
    for (let index = 0; index < total; index += 1) {
      r.feed.push(piece);
    }

    // However many chunks came: one frame and one timer.
    expect(r.frames().pending).toBe(1);
    expect(r.timers()).toMatchObject({ asked: before.asked + 1, pending: 1, cancelled: before.cancelled });
    expect(r.timers().delays.at(-1)).toBe(HIDDEN_TICK_MS);
    // The frames never come; the timer does, and it takes the share a hidden frame takes.
    const dropped = r.frames().cancelled;
    r.tick();
    expect(taken(r)).toBeGreaterThanOrEqual(FLOW.hiddenFrame);
    expect(taken(r)).toBeLessThanOrEqual(FLOW.hiddenFrame + FLOW.slice);
    // The frame that waited beside it is cancelled, and the feed holds more: a new frame and a new timer.
    expect(r.frames().cancelled).toBe(dropped + 1);
    expect(r.frames().pending).toBe(1);
    expect(r.timers()).toMatchObject({ asked: before.asked + 2, pending: 1 });
    // Every share after it is the same, and the whole flood is parsed from the timer alone.
    let last = taken(r);
    for (let guard = 0; guard < 20 && r.timers().pending > 0; guard += 1) {
      r.tick();
      expect(taken(r) - last).toBeLessThanOrEqual(FLOW.hiddenFrame + FLOW.slice);
      last = taken(r);
    }

    expect(taken(r)).toBe(total * FLOW.slice);
    expect(r.frames().pending).toBe(0);
    expect(r.timers().pending).toBe(0);
  });

  it('keeps the timer that stood beside its frame when it is hidden: the frame was asked for while it was shown, and a window that suspends its frames may never run it, so the timer comes alone and takes the hidden share', async () => {
    const r = rig();
    r.screen.mount(r.host);
    r.feed.push('x');
    r.screen.show();
    await r.settle();
    expect(r.frames().pending).toBe(1);
    expect(r.timers()).toMatchObject({ asked: 1, pending: 1, delays: [HIDDEN_TICK_MS] });
    r.screen.hide();
    // Hiding asks for nothing: the pair that was asked for while it was shown is still the one.
    expect(r.timers()).toMatchObject({ asked: 1, pending: 1 });
    expect(r.frames().pending).toBe(1);
    r.tick();
    expect(r.engine().text()).toBe('x');
    expect(r.frames().pending).toBe(0);
    expect(r.timers().pending).toBe(0);
  });

  it('runs the pump once when the frame comes first while it is hidden, and the timer that stood beside it is cancelled: a frame and a timer for the same output are one parse', async () => {
    const r = await shown();
    r.screen.hide();
    const before = r.timers();
    r.feed.push('while hidden');
    expect(r.timers().pending).toBe(1);
    r.frame();
    expect(r.engine().writes).toHaveLength(1);
    expect(r.engine().text()).toBe('while hidden');
    expect(r.timers()).toMatchObject({ pending: 0, cancelled: before.cancelled + 1 });
    const reads = r.feed.reads();
    r.tick();
    expect(r.feed.reads()).toBe(reads);
    expect(r.engine().writes).toHaveLength(1);
    expect(taken(r)).toBe(12);
  });

  it('asks for no frame and no timer at rest while it is hidden: nothing is held, so nothing waits, and what is parsed leaves nothing behind', async () => {
    const r = await shown();
    r.screen.hide();
    const before = r.timers();
    expect(r.frames().pending).toBe(0);
    expect(r.timers().pending).toBe(0);
    r.feed.push('y\r\n');
    r.frame();
    expect(r.frames().pending).toBe(0);
    expect(r.timers()).toMatchObject({ asked: before.asked + 1, pending: 0, cancelled: before.cancelled + 1 });
  });

  it('keeps the frame and its timer when it is shown again: they are the same pair, nothing is asked for or cancelled, and the frame that comes draws and cancels the timer', async () => {
    const r = await shown();
    r.screen.hide();
    r.feed.push('x');
    const before = r.timers();
    expect(before.pending).toBe(1);
    r.screen.show();
    expect(r.timers()).toMatchObject({ asked: before.asked, pending: 1, cancelled: before.cancelled });
    expect(r.frames().pending).toBe(1);
    r.frame();
    expect(r.engine().text()).toBe('x');
    expect(r.timers()).toMatchObject({ pending: 0, cancelled: before.cancelled + 1 });
  });

  it.each(['shown', 'hidden'] as const)('leaves neither a frame nor a timer behind when it is disposed while it is %s', async (state) => {
    const r = await shown();
    if (state === 'hidden') {
      r.screen.hide();
    }

    r.feed.push('x');
    expect(r.frames().pending).toBe(1);
    expect(r.timers().pending).toBe(1);
    r.screen.dispose();
    expect(r.frames().pending).toBe(0);
    expect(r.timers().pending).toBe(0);
  });

  it.each(['shown', 'hidden'] as const)('is a plain timer when the screen is not given a clock: it goes on from it after HIDDEN_TICK_MS, with no frame, while it is %s', async (state) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const r = rig({ defaultTimer: true });
      r.screen.mount(r.host);
      r.screen.show();
      await r.settle();
      r.frame();
      if (state === 'hidden') {
        r.screen.hide();
      }

      r.feed.push('output');
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(HIDDEN_TICK_MS - 1);
      expect(r.engine().text()).toBe('');
      vi.advanceTimersByTime(1);
      expect(r.engine().text()).toBe('output');
      expect(vi.getTimerCount()).toBe(0);
      expect(r.frames().pending).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the size of the host', () => {
  async function shown() {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    return r;
  }

  it('is measured when the host changes and sent to the feed only when the cells changed', async () => {
    const { feed, engine, resized } = await shown();
    const sent = feed.sizes().length;
    resized();
    expect(feed.sizes()).toHaveLength(sent);
    engine().measured({ cols: 120, rows: 20 });
    resized();
    expect(engine().resizes).toEqual([[120, 20]]);
    expect(feed.sizes().at(-1)).toEqual([120, 20]);
    resized();
    expect(feed.sizes()).toHaveLength(sent + 1);
  });

  it('does nothing for a host that has no size: no fit at 0 px', async () => {
    const { feed, engine, resized } = await shown();
    const sent = feed.sizes().length;
    engine().measured(undefined);
    resized();
    expect(engine().resizes).toEqual([]);
    expect(feed.sizes()).toHaveLength(sent);
  });
});

describe('what the user types', () => {
  async function shown() {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    return r;
  }

  it('goes to the feed, as typed', async () => {
    const { feed, engine } = await shown();
    engine().type('ls\r');
    engine().type('\u0003');
    expect(feed.typed()).toEqual(['ls\r', '\u0003']);
  });

  it('is taken while the session starts or runs and refused once it is over: the emulator is told, so that a key press does nothing and nobody waits for a reply', async () => {
    const { feed, engine } = await shown();
    expect(engine().inputs.at(-1)).toBe(true);
    feed.set({ state: 'ended' });
    expect(engine().inputs.at(-1)).toBe(false);
  });

  it('is refused for a session that failed', async () => {
    const { feed, engine } = await shown();
    feed.set({ state: 'failed', cause: { stage: 'session', message: 'x' } });
    expect(engine().inputs.at(-1)).toBe(false);
  });
});

describe('the end of the process', () => {
  async function shown() {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    return r;
  }

  it('writes the last line into the transcript after the last of its output, muted, once: the scrollback tells how it ended', async () => {
    const { feed, engine, frame } = await shown();
    feed.push('bye\r\n');
    feed.set({ state: 'ended', exit: { code: 3 } });
    frame();
    expect(engine().text()).toBe('bye\r\n\u001b[0m\r\n\u001b[90m[Process exited with code 3]\u001b[0m\r\n');
    feed.wake();
    frame();
    expect(engine().text().match(/Process/g)).toHaveLength(1);
  });

  it('says only that the process ended when the producer does not say how', async () => {
    const { feed, engine, frame } = await shown();
    feed.set({ state: 'ended' });
    frame();
    expect(engine().text()).toContain('[Process ended]');
  });

  it('writes nothing for a session that failed or is still running', async () => {
    const one = await shown();
    one.feed.set({ state: 'failed', cause: { stage: 'session', message: 'x' } });
    one.frame();
    expect(one.engine().text()).toBe('');
    const two = await shown();
    two.feed.push('a');
    two.frame();
    expect(two.engine().text()).toBe('a');
  });

  it('writes the last line of a session that ended while it was hidden when it ends, not when the panel comes back: the scrollback already tells how it ended, and it is not written twice', async () => {
    const { screen, feed, engine, frame, settle } = await shown();
    screen.hide();
    feed.push('last\r\n');
    feed.set({ state: 'ended', exit: { code: 0 } });
    frame();
    const line = 'last\r\n\u001b[0m\r\n\u001b[90m[Process exited with code 0]\u001b[0m\r\n';
    expect(engine().text()).toBe(line);
    screen.show();
    await settle();
    frame();
    expect(engine().text()).toBe(line);
  });
});

describe('the keys', () => {
  async function shown(platform: Platform = 'mac') {
    const r = rig({ platform });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    return r;
  }

  it('takes plain typing and the chords the shell keeps, and leaves F6 and the window\'s chords alone: not handled by the emulator and not stopped, so the window sees them', async () => {
    const { engine } = await shown();
    expect(engine().key({ key: 'c', code: 'KeyC', ctrlKey: true })).toEqual({ handled: true, defaultPrevented: false });
    expect(engine().key({ key: 'F6', code: 'F6' })).toEqual({ handled: false, defaultPrevented: false });
    expect(engine().key({ key: 'j', code: 'KeyJ', metaKey: true })).toEqual({ handled: false, defaultPrevented: false });
    expect(engine().key({ key: 'Escape', code: 'Escape' })).toEqual({ handled: true, defaultPrevented: false });
  });

  it('copies the selection on Command C and stops the browser from doing anything else with it, and does nothing without a selection (Control C is the interrupt on a Mac, and Command C is never typed)', async () => {
    const { engine, copied, settle } = await shown();
    engine().select('hello');
    expect(engine().key({ key: 'c', code: 'KeyC', metaKey: true })).toEqual({ handled: false, defaultPrevented: true });
    await settle();
    expect(copied).toEqual(['hello']);
    engine().select('');
    expect(engine().key({ key: 'c', code: 'KeyC', metaKey: true })).toEqual({ handled: false, defaultPrevented: true });
    await settle();
    expect(copied).toEqual(['hello']);
  });

  it('pastes through the browser\'s own paste event: the emulator does not handle the key and the browser is not stopped', async () => {
    const { engine } = await shown();
    expect(engine().key({ key: 'v', code: 'KeyV', metaKey: true })).toEqual({ handled: false, defaultPrevented: false });
  });

  it('copies on Control C only while there is a selection on Windows and Linux, and sends the interrupt otherwise', async () => {
    const { engine, copied, settle } = await shown('other');
    expect(engine().key({ key: 'c', code: 'KeyC', ctrlKey: true })).toEqual({ handled: true, defaultPrevented: false });
    engine().select('abc');
    expect(engine().key({ key: 'c', code: 'KeyC', ctrlKey: true })).toEqual({ handled: false, defaultPrevented: true });
    await settle();
    expect(copied).toEqual(['abc']);
  });

  it('selects the output on Command A and clears it on Command K, and types neither: both products take Command K while the terminal has the focus', async () => {
    const { engine, feed } = await shown();
    expect(engine().key({ key: 'a', code: 'KeyA', metaKey: true })).toEqual({ handled: false, defaultPrevented: true });
    expect(engine().selectAlls()).toBe(1);
    expect(engine().key({ key: 'k', code: 'KeyK', metaKey: true })).toEqual({ handled: false, defaultPrevented: true });
    expect(engine().clears()).toBe(1);
    expect(feed.typed()).toEqual([]);
  });

  it('selects on Control Shift A elsewhere, and leaves Control A and Control K to the shell', async () => {
    const { engine } = await shown('other');
    expect(engine().key({ key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true })).toEqual({ handled: false, defaultPrevented: true });
    expect(engine().selectAlls()).toBe(1);
    expect(engine().key({ key: 'k', code: 'KeyK', ctrlKey: true })).toEqual({ handled: true, defaultPrevented: false });
    expect(engine().clears()).toBe(0);
  });

  it('sends the bytes a Mac IDE sends for Option and Command with the arrows and Backspace, once, and stops the key: the emulator\'s own encoding of it is never sent', async () => {
    const { engine, feed } = await shown();
    expect(engine().key({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true })).toEqual({ handled: false, defaultPrevented: true });
    expect(engine().key({ key: 'ArrowRight', code: 'ArrowRight', metaKey: true })).toEqual({ handled: false, defaultPrevented: true });
    expect(engine().key({ key: 'Backspace', code: 'Backspace', altKey: true })).toEqual({ handled: false, defaultPrevented: true });
    expect(feed.typed()).toEqual(['\u001bb', '\u0005', '\u0017']);
  });

  it('sends nothing for those keys once the session has ended, and does not touch them on Windows and Linux', async () => {
    const mac = await shown();
    mac.feed.set({ state: 'ended' });
    expect(mac.engine().key({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true })).toEqual({ handled: false, defaultPrevented: true });
    expect(mac.feed.typed()).toEqual([]);
    const other = await shown('other');
    expect(other.engine().key({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true })).toEqual({ handled: true, defaultPrevented: false });
    expect(other.feed.typed()).toEqual([]);
  });

  it('shows the bell on the screen, for each bell, and makes no sound: the host element changes its name for the one animation', async () => {
    const { engine, host } = await shown();
    expect(host.getAttribute('data-bell')).toBeNull();
    engine().ring();
    expect(host.getAttribute('data-bell')).toBe('a');
    engine().ring();
    expect(host.getAttribute('data-bell')).toBe('b');
    engine().ring();
    expect(host.getAttribute('data-bell')).toBe('a');
  });

  it('clears the screen a key came to, for the window that must not give Command K to its palette, and for no other element or a screen that is gone', async () => {
    const { engine, host, screen } = await shown();
    const inside = document.createElement('textarea');
    host.append(inside);
    expect(clearScreenIn(inside)).toBe(true);
    expect(engine().clears()).toBe(1);
    expect(clearScreenIn(document.createElement('div'))).toBe(false);
    expect(clearScreenIn(null)).toBe(false);
    expect(engine().clears()).toBe(1);
    screen.dispose();
    expect(clearScreenIn(inside)).toBe(false);
  });
});

describe('clear, copy and the selection', () => {
  async function shown() {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    return r;
  }

  it('clears the emulator', async () => {
    const { screen, engine } = await shown();
    screen.clear();
    expect(engine().clears()).toBe(1);
  });

  it('copies the selection and says whether it did; with no selection it copies nothing and says no', async () => {
    const { screen, engine, copied } = await shown();
    expect(await screen.copy()).toBe(false);
    expect(copied).toEqual([]);
    engine().select('some output');
    expect(await screen.copy()).toBe(true);
    expect(copied).toEqual(['some output']);
  });

  it('says that the clipboard refused when it does', async () => {
    const r = rig({ copy: async () => Promise.resolve(false) });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.engine().select('x');
    expect(await r.screen.copy()).toBe(false);
  });

  it('tells the one who reads its snapshot when there is a selection and when there is none, and only then', async () => {
    const { screen, engine } = await shown();
    const heard = vi.fn();
    screen.subscribe(heard);
    engine().select('a');
    expect(screen.getSnapshot().selected).toBe(true);
    engine().select('ab');
    engine().select('');
    expect(screen.getSnapshot().selected).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('keeps the same snapshot object until something in it changes', async () => {
    const { screen } = await shown();
    expect(screen.getSnapshot()).toBe(screen.getSnapshot());
  });

  it('puts the focus in the emulator when it is asked to, once it is there, and says whether it did', async () => {
    const r = rig();
    r.screen.mount(r.host);
    expect(r.screen.focus()).toBe(false);
    r.screen.show();
    await r.settle();
    expect(r.screen.focus()).toBe(true);
    expect(r.engine().focuses()).toBe(1);
  });
});

describe('the look of the screen', () => {
  it('is read again when the theme or the font changes, and applied to the live emulator: three changes make no new emulator and dispose none (the old terminal could do this too)', async () => {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.screen.refresh();
    r.screen.refresh();
    r.screen.refresh();
    expect(r.engine().appearances).toHaveLength(3);
    expect(r.loader.engines).toHaveLength(1);
    expect(r.engine().disposed()).toBe(0);
  });

  it('fits the grid again after a change of appearance: a new text size changes the cells the host holds while the host itself did not move, so no observer will say it', async () => {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    const before = r.feed.sizes().length;
    r.engine().measured({ cols: 150, rows: 20 });
    r.screen.refresh();
    expect(r.engine().resizes.at(-1)).toEqual([150, 20]);
    expect(r.feed.sizes().length).toBe(before + 1);
    expect(r.feed.sizes().at(-1)).toEqual([150, 20]);
    r.screen.refresh();
    expect(r.feed.sizes().length).toBe(before + 1);
  });

  it('is read once when there is no emulator yet: it is the one the emulator is made with', async () => {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.refresh();
    r.screen.show();
    await r.settle();
    expect(r.engine().appearances).toEqual([]);
  });
});

describe('the end of the screen', () => {
  it('disposes the emulator once, lets go of the feed, the observer and the frame, and is safe to dispose again', async () => {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.feed.push('a');
    r.screen.dispose();
    r.screen.dispose();
    expect(r.engine().disposed()).toBe(1);
    expect(r.feed.listeners()).toBe(0);
    expect(r.observers().alive).toBe(0);
    expect(r.frames().pending).toBe(0);
    expect(r.engine().listeners()).toBe(0);
  });

  it('does nothing when it is shown after it was disposed', async () => {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.dispose();
    r.screen.show();
    await r.settle();
    expect(r.loader.loads()).toBe(0);
  });
});

describe('the GPU renderer', () => {
  it('is followed by a new measure of the host once it is in place, and the feed is told nothing before it: its cells are not the DOM\'s, and the first size the feed gets, which starts the process, is the one the person sees', async () => {
    const ready = Promise.withResolvers<void>();
    const { screen, host, feed, engine, resized, settle } = rig({ rendererReady: ready.promise });
    screen.mount(host);
    screen.show();
    await settle();
    // The observer ticks and the emulator measures the DOM's cells while the renderer is on its way: neither the emulator nor the feed is given that size (a process started at it would be resized a moment later).
    engine().measured({ cols: 187, rows: 9 });
    resized();
    expect(feed.sizes()).toEqual([]);
    expect(engine().resizes).toEqual([]);
    // The GPU rounds its cells to whole device pixels: the host now fits another count.
    engine().measured({ cols: 193, rows: 9 });
    ready.resolve();
    await settle();
    expect(engine().resizes).toEqual([[193, 9]]);
    expect(feed.sizes()).toEqual([[193, 9]]);
  });

  it('is not measured for when the screen was hidden before it was in place', async () => {
    const ready = Promise.withResolvers<void>();
    const { screen, host, feed, engine, settle } = rig({ rendererReady: ready.promise });
    screen.mount(host);
    screen.show();
    await settle();
    engine().measured({ cols: 192, rows: 14 });
    screen.hide();
    ready.resolve();
    await settle();
    expect(engine().resizes).toEqual([]);
    expect(feed.sizes()).toEqual([]);
  });
});

describe('screen reader mode', () => {
  const shown = async (options: Parameters<typeof rig>[0] = {}) => {
    const r = rig(options);
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    return r;
  };

  it('makes the emulator in the mode the window has chosen, off for a person who never chose, so the emulator is as it was: nothing is changed once it is there', async () => {
    const off = await shown();
    expect(off.engine().options.screenReaderMode).toBe(false);
    expect(off.engine().screenReaderModes).toEqual([]);

    const on = await shown({ screenReader: true });
    expect(on.engine().options.screenReaderMode).toBe(true);
    expect(on.engine().screenReaderModes).toEqual([]);
  });

  it('follows the choice while it is on screen: one call to the emulator for each change, and none for a choice that did not change', async () => {
    const { reader, engine } = await shown();
    reader.set(true);
    expect(engine().screenReaderModes).toEqual([true]);
    reader.set(true);
    expect(engine().screenReaderModes).toEqual([true]);
    reader.toggle();
    expect(engine().screenReaderModes).toEqual([true, false]);
  });

  it('does nothing to a terminal that is hidden while the mode is off, and gives it the choice made meanwhile when it is shown again: a hidden panel is no work, and nobody hears a screen that is not there', async () => {
    const r = await shown();
    r.screen.hide();
    expect(r.readerListeners()).toBe(0);
    r.reader.set(true);
    r.reader.set(false);
    r.reader.set(true);
    expect(r.engine().screenReaderModes).toEqual([]);
    r.screen.show();
    expect(r.engine().screenReaderModes).toEqual([true]);
  });

  it('puts the emulator out of the mode while its screen is hidden and back in when it is shown: a hidden terminal has no accessibility layer, so no refresh of one that fires in a hidden panel (measured: 37 document mutations within a second of hiding it, from the emulator\'s own deferred refresh of the lines printed just before)', async () => {
    const r = await shown({ screenReader: true });
    r.screen.hide();
    expect(r.engine().screenReaderModes).toEqual([false]);
    r.screen.show();
    expect(r.engine().screenReaderModes).toEqual([false, true]);
    // A choice made while it is hidden is the one it comes back in, and a change that came back to what it has is nothing more.
    r.screen.hide();
    r.reader.set(false);
    r.reader.set(true);
    r.reader.set(false);
    expect(r.engine().screenReaderModes).toEqual([false, true, false]);
    r.screen.show();
    expect(r.engine().screenReaderModes).toEqual([false, true, false]);
  });

  it('gives the choice to an emulator that is made after it was chosen, and to one whose code was still loading when it was chosen: it is made in the mode that is true then', async () => {
    const r = rig({ deferred: true });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.reader.set(true);
    r.loader.release();
    await r.settle();
    expect(r.engine().options.screenReaderMode).toBe(true);
    expect(r.engine().screenReaderModes).toEqual([]);
  });

  it('listens to the choice only while it is on screen, and lets go of it when it is hidden and when it is disposed: no listener is left on the window\'s store', async () => {
    const r = rig();
    r.screen.mount(r.host);
    expect(r.readerListeners()).toBe(0);
    r.screen.show();
    await r.settle();
    expect(r.readerListeners()).toBe(1);
    r.screen.hide();
    expect(r.readerListeners()).toBe(0);
    r.screen.show();
    expect(r.readerListeners()).toBe(1);
    r.screen.dispose();
    expect(r.readerListeners()).toBe(0);
    r.reader.set(true);
    expect(r.engine().screenReaderModes).toEqual([]);
  });

  it('does not listen to the choice before the screen was first shown: a terminal that is not on screen has nothing to follow', async () => {
    const r = rig({ deferred: true });
    r.screen.mount(r.host);
    await r.settle();
    expect(r.readerListeners()).toBe(0);
  });
});

// A terminal the page took back after a reload (T2-go 2.4 rules 4 to 6; `takeReplay` in feed.ts). The feed gives the bytes the host kept, the size and the modes they were written under, and the size and the modes in force at
// their end, and it reads nothing until the screen has taken them. The screen brings a fresh emulator to where the host's terminal is, never lets what the emulator answers to the queries in those bytes reach the shell,
// acknowledges none of them, and goes on with the live output. The words for what the page lost, and for what it is taking back, are state.test.ts's.

const NO_MODES: TerminalModes = { altScreen: false, bracketedPaste: false, applicationCursor: false, focusEvents: false, cursorHidden: false, mouseTracking: 0, mouseEncoding: 0, kittyKeyboard: [] };

/** A full reset in band (RIS): the first thing a replay writes. */
const RESET = '\u001bc';

/**
 * What makes a fresh emulator draw its cursor, written right after the reset when the bytes start on the normal screen: a switch to the alternate screen and straight back. xterm draws no cursor before its first focus,
 * its first key or a switch of screen, and a restored terminal is none of them; the bounce clears nothing. It is not written when the bytes start on the alternate screen: the switch to it did that, and a bounce would
 * take the emulator off the screen it is on.
 */
const CURSOR = '\u001b[?47h\u001b[?47l';

const replayOf = (data: string | Uint8Array, patch: Partial<TerminalReplay> = {}): TerminalReplay => {
  const kept = typeof data === 'string' ? bytesOf(data) : data;
  return { data: kept, startSize: { cols: 80, rows: 24 }, startModes: NO_MODES, size: { cols: 80, rows: 24 }, modes: NO_MODES, end: kept.length, ...patch };
};

/** What the emulator was given as bytes: the replay's slices and the live output, not the reset and the modes (text). */
const bytesWritten = (engine: FakeEngine): readonly Uint8Array[] => engine.writes.filter((data): data is Uint8Array => typeof data !== 'string');

const lengthOf = (parts: readonly Uint8Array[]): number => parts.reduce((sum, part) => sum + part.length, 0);

const joined = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(lengthOf(parts));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

/** Mounts and shows a screen over a feed that was reattached, and lets the emulator come; the first frame is the test's. */
async function reattached(replay: TerminalReplay | undefined, options: RigOptions = {}): Promise<Rig> {
  const r = rig({ ...options, reattach: { ...options.reattach, ...(replay === undefined ? {} : { replay }) } });
  r.screen.mount(r.host);
  r.screen.show();
  await r.settle();
  return r;
}

describe('a replay: a terminal the page took back after a reload', () => {
  it('is applied before any live byte: the emulator is reset, it is written what the host kept, and then what came after, in order', async () => {
    const r = rig({ reattach: { replay: replayOf('kept 1\r\nkept 2\r\n') } });
    r.screen.mount(r.host);
    r.feed.push('live 1\r\n');
    r.screen.show();
    await r.settle();
    r.frame();
    expect(r.engine().text()).toBe(`${RESET}${CURSOR}kept 1\r\nkept 2\r\nlive 1\r\n`);
    expect(r.engine().resets()).toBe(1);
    expect(r.takes()).toBe(1);
  });

  it('is applied once, however often the screen is hidden and shown: the emulator keeps what it was brought to', async () => {
    const r = await reattached(replayOf('kept'));
    r.frame();
    r.screen.hide();
    r.screen.show();
    await r.settle();
    r.frame();
    r.feed.push('live');
    r.frame();
    expect(r.takes()).toBe(1);
    expect(r.engine().resets()).toBe(1);
    expect(r.engine().text()).toBe(`${RESET}${CURSOR}keptlive`);
  });

  it('sizes the emulator to the size the kept bytes were written under before the first byte is written: they are parsed at that size, from the first one', async () => {
    const r = await reattached(replayOf('kept', { startSize: { cols: 100, rows: 30 } }), { auto: false });
    r.frame();
    expect(r.engine().writes).toHaveLength(2);
    expect(r.engine().writeSizes).toEqual([[100, 30], [100, 30]]);
    expect(r.engine().resizes).toEqual([[100, 30]]);
  });

  it('does not resize an emulator that is the size the bytes were written under already', async () => {
    const r = await reattached(replayOf('kept', { startSize: { cols: 80, rows: 24 } }), { auto: false });
    r.frame();
    expect(r.engine().resizes).toEqual([]);
  });

  it('sizes the emulator to the size the host\'s terminal has only when the last slice is parsed, and then to what the panel measures', async () => {
    const r = await reattached(replayOf('kept', { startSize: { cols: 100, rows: 30 }, size: { cols: 120, rows: 40 } }), { auto: false });
    r.engine().measured({ cols: 90, rows: 20 });
    r.frame();
    expect(r.engine().resizes).toEqual([[100, 30]]);
    r.engine().complete();
    expect(r.engine().resizes).toEqual([[100, 30], [120, 40], [90, 20]]);
    expect(r.feed.sizes()).toEqual([[80, 24], [90, 20]]);
  });

  it('does not follow the panel while the replay is written: the emulator keeps the size the bytes were written under until the last of them is parsed, and takes the measure then', async () => {
    const r = await reattached(replayOf('kept', { startSize: { cols: 100, rows: 30 }, size: { cols: 120, rows: 40 } }), { auto: false });
    r.frame();
    r.engine().measured({ cols: 90, rows: 20 });
    r.resized();
    expect(r.engine().resizes).toEqual([[100, 30]]);
    expect(r.feed.sizes()).toEqual([[80, 24]]);
    r.engine().complete();
    expect(r.engine().resizes).toEqual([[100, 30], [120, 40], [90, 20]]);
    expect(r.feed.sizes()).toEqual([[80, 24], [90, 20]]);
  });

  describe('the modes the bytes were written under', () => {
    it.each<[string, Partial<TerminalModes>, string]>([
      ['no mode', {}, ''],
      ['the alternate screen', { altScreen: true }, '\u001b[?1049h'],
      ['mouse clicks', { mouseTracking: 1 }, '\u001b[?1000h'],
      ['mouse drags', { mouseTracking: 2 }, '\u001b[?1002h'],
      ['any mouse motion', { mouseTracking: 4 }, '\u001b[?1003h'],
      ['every kind of mouse tracking, the smallest first', { mouseTracking: 7 }, '\u001b[?1000h\u001b[?1002h\u001b[?1003h'],
      ['the UTF-8 mouse encoding', { mouseEncoding: 1 }, '\u001b[?1005h'],
      ['the SGR mouse encoding', { mouseEncoding: 2 }, '\u001b[?1006h'],
      ['the urxvt mouse encoding', { mouseEncoding: 3 }, '\u001b[?1015h'],
      ['bracketed paste', { bracketedPaste: true }, '\u001b[?2004h'],
      ['application cursor keys', { applicationCursor: true }, '\u001b[?1h'],
      ['focus events', { focusEvents: true }, '\u001b[?1004h'],
      ['a hidden cursor', { cursorHidden: true }, '\u001b[?25l'],
      ['the keyboard protocol\'s flags, one push for each, the bottom of the stack first', { kittyKeyboard: [1, 5, 9] }, '\u001b[>1u\u001b[>5u\u001b[>9u'],
      [
        'all of them, the alternate screen first (the keyboard stack is the screen\'s own)',
        { altScreen: true, mouseTracking: 2, mouseEncoding: 2, bracketedPaste: true, applicationCursor: true, focusEvents: true, cursorHidden: true, kittyKeyboard: [1, 5] },
        '\u001b[?1049h\u001b[?1002h\u001b[?1006h\u001b[?2004h\u001b[?1h\u001b[?1004h\u001b[?25l\u001b[>1u\u001b[>5u',
      ],
    ])('are switched on by the first write, right after the reset and the cursor: %s', async (_name, modes, expected) => {
      const r = await reattached(replayOf('kept', { startModes: { ...NO_MODES, ...modes } }));
      r.frame();
      // The cursor is made to draw by the bounce through the alternate screen, which a replay that starts on it has no use for.
      const cursor = modes.altScreen === true ? '' : CURSOR;
      expect(r.engine().writes[0]).toBe(`${RESET}${cursor}${expected}`);
      expect(r.engine().text()).toBe(`${RESET}${cursor}${expected}kept`);
    });

    it('are the ones at the START of the bytes: what is in force at their end is in the bytes already, and is not switched on again', async () => {
      const modes: TerminalModes = { ...NO_MODES, altScreen: true, mouseTracking: 7, bracketedPaste: true, kittyKeyboard: [3] };
      const r = await reattached(replayOf('kept', { modes }));
      r.frame();
      expect(r.engine().text()).toBe(`${RESET}${CURSOR}kept`);
    });

    it('are all in the first write, with the reset, and the bytes are the next: a replay of one slice is two writes', async () => {
      const r = await reattached(replayOf('kept', { startModes: { ...NO_MODES, bracketedPaste: true } }));
      r.frame();
      expect(r.engine().writes).toEqual([`${RESET}${CURSOR}\u001b[?2004h`, bytesOf('kept')]);
    });
  });

  describe('the cursor: xterm draws none before its first focus, key or switch of screen, and an emulator that was only written to is in that state', () => {
    const ALT: TerminalModes = { ...NO_MODES, altScreen: true };

    it('is made to draw by the bounce right after the reset, which clears nothing, before the bytes: the first write is the reset and the bounce, the next is the bytes', async () => {
      const r = await reattached(replayOf('kept'));
      r.frame();
      expect(r.engine().writes).toEqual([`${RESET}${CURSOR}`, bytesOf('kept')]);
    });

    it.each([
      ['starts and ends on the normal screen: the shell is at its prompt', NO_MODES, NO_MODES, true],
      ['starts and ends on the alternate screen: a full-screen program is on screen, and a bounce would take the emulator off its screen', ALT, ALT, false],
      ['starts on the alternate screen and leaves it in the bytes: the switch to it drew the cursor', ALT, NO_MODES, false],
      ['starts on the normal screen and goes to the alternate in the bytes: the bounce is on the empty normal screen, before them', NO_MODES, ALT, true],
    ])('is decided by the screen the bytes START on, which is the one the reset leaves the emulator on: a replay that %s', async (_name, startModes, modes, bounced) => {
      const r = await reattached(replayOf('kept', { startModes, modes }));
      r.frame();
      expect(r.engine().text()).toBe(`${RESET}${bounced ? CURSOR : '\u001b[?1049h'}kept`);
    });

    it('is written once for a replay of many slices, and the bytes are the replay\'s own, whole and in order: the bounce is not one of them', async () => {
      const kept = Uint8Array.from({ length: FLOW.slice * 2 + 3 }, (_, index) => index & 0xff);
      const r = await reattached(replayOf(kept));
      r.frame();
      expect(r.engine().writes.filter((data) => typeof data === 'string')).toEqual([`${RESET}${CURSOR}`]);
      expect(joined(bytesWritten(r.engine()))).toEqual(kept);
    });

    it('is written for a replay with no bytes too, and the live output follows it', async () => {
      const r = rig({ reattach: { replay: replayOf('') } });
      r.screen.mount(r.host);
      r.feed.push('live');
      r.screen.show();
      await r.settle();
      r.frame();
      expect(r.engine().text()).toBe(`${RESET}${CURSOR}live`);
    });

    it('is not acknowledged and not counted: the feed is told of the live bytes alone, each when it is parsed', async () => {
      const r = rig({ auto: false, reattach: { replay: replayOf('kept') } });
      r.screen.mount(r.host);
      r.feed.push('live!');
      r.screen.show();
      await r.settle();
      r.frame();
      r.engine().complete();
      expect(r.feed.acks()).toEqual([]);
      r.frame();
      r.engine().complete();
      expect(r.feed.acks()).toEqual([5]);
    });

    it('is parsed while what the emulator says is muted: an answer the emulator gave to the bounce is not heard, and a key typed after the replay is', async () => {
      const r = await reattached(replayOf('kept'), { answers: [['\u001b[?47l', 'what the emulator said']] });
      r.frame();
      expect(r.engine().emitted).toEqual(['what the emulator said']);
      expect(r.feed.typed()).toEqual([]);
      r.engine().type('ls\r');
      expect(r.feed.typed()).toEqual(['ls\r']);
    });

    it('leaves the join with the live output alone: nothing is written between the last byte the host kept and the first live byte, so an escape sequence or a character that the cut falls inside is the emulator\'s to finish (the host cuts at the end of a read, not at the end of a sequence)', async () => {
      const kept = Uint8Array.from([...bytesOf('plain \u001b[3'), 0xe2, 0x82]);
      const live = Uint8Array.from([0xac, ...bytesOf('1mred')]);
      const r = rig({ reattach: { replay: replayOf(kept) } });
      r.screen.mount(r.host);
      r.feed.push(live);
      r.screen.show();
      await r.settle();
      r.frame();
      expect(r.engine().writes).toEqual([`${RESET}${CURSOR}`, kept, live]);
    });
  });

  it('writes what the host kept in slices of at most a slice, in order and whole, and takes no more of it in a frame than a frame\'s share: the next frame goes on', async () => {
    const kept = Uint8Array.from({ length: FLOW.frame * 2 + FLOW.slice + 17 }, (_, index) => index & 0xff);
    const r = await reattached(replayOf(kept));
    r.frame();
    expect(lengthOf(bytesWritten(r.engine()))).toBe(FLOW.frame);
    r.frame();
    expect(lengthOf(bytesWritten(r.engine()))).toBe(FLOW.frame * 2);
    r.frame();
    const slices = bytesWritten(r.engine());
    expect(slices.length).toBeGreaterThanOrEqual(Math.ceil(kept.length / FLOW.slice));
    for (const slice of slices) {
      expect(slice.length).toBeLessThanOrEqual(FLOW.slice);
    }

    expect(joined(slices)).toEqual(kept);
    // Applied: no frame is asked for at rest.
    const asked = r.frames().asked;
    r.frame();
    expect(r.frames().asked).toBe(asked);
  });

  it('is applied to a screen that is hidden too, a hidden share at a time: it only parses, it measures nothing and tells the feed no size', async () => {
    const kept = new Uint8Array(FLOW.hiddenFrame * 2 + 5);
    const r = await reattached(replayOf(kept));
    r.screen.hide();
    const sizes = r.feed.sizes().length;
    r.frame();
    expect(lengthOf(bytesWritten(r.engine()))).toBe(FLOW.hiddenFrame);
    r.frame();
    r.frame();
    expect(lengthOf(bytesWritten(r.engine()))).toBe(kept.length);
    expect(r.engine().resets()).toBe(1);
    expect(r.engine().writes[0]).toBe(`${RESET}${CURSOR}`);
    expect(r.feed.sizes()).toHaveLength(sizes);
    expect(r.engine().renderers).toEqual(['gpu', 'dom']);
  });

  it('takes no more of it than the emulator can parse, as it does of live output: it stops at the bound of what is accepted and not parsed, and goes on as the emulator parses', async () => {
    const pieces = FLOW.high / FLOW.slice;
    const kept = new Uint8Array(FLOW.high + FLOW.slice * 3);
    const r = await reattached(replayOf(kept), { auto: false });
    for (let frame = 0; frame < pieces * 2; frame += 1) {
      r.frame();
    }

    expect(lengthOf(bytesWritten(r.engine()))).toBe(FLOW.high);
    r.engine().complete();
    for (let frame = 0; frame < pieces * 2; frame += 1) {
      r.frame();
    }

    expect(lengthOf(bytesWritten(r.engine()))).toBe(kept.length);
  });

  it('acknowledges none of it, and every byte that is live after it, once, when it is parsed', async () => {
    const r = rig({ auto: false, reattach: { replay: replayOf('kept '.repeat(40)) } });
    r.screen.mount(r.host);
    r.feed.push('live!');
    r.screen.show();
    await r.settle();
    r.frame();
    r.engine().complete();
    expect(r.feed.acks()).toEqual([]);
    r.frame();
    expect(r.feed.acks()).toEqual([]);
    r.engine().complete();
    expect(r.feed.acks()).toEqual([5]);
  });

  it('reads no live output until the last slice of the replay is parsed, and writes it then: what is live is the emulator\'s after the replay, and the size it has by then', async () => {
    const r = rig({ auto: false, reattach: { replay: replayOf('kept') } });
    r.screen.mount(r.host);
    r.feed.push('live');
    r.screen.show();
    await r.settle();
    r.frame();
    expect(r.engine().text()).toBe(`${RESET}${CURSOR}kept`);
    expect(r.feed.reads()).toBe(0);
    r.engine().complete();
    r.frame();
    expect(r.engine().text()).toBe(`${RESET}${CURSOR}keptlive`);
  });

  it('applies a replay with no bytes: the emulator is reset, sized and put in the modes, and the live output goes on', async () => {
    const startModes = { ...NO_MODES, bracketedPaste: true };
    const r = rig({ reattach: { replay: replayOf('', { startModes, startSize: { cols: 100, rows: 30 }, size: { cols: 100, rows: 30 } }) } });
    r.screen.mount(r.host);
    r.feed.push('live');
    r.screen.show();
    await r.settle();
    r.frame();
    expect(r.engine().text()).toBe(`${RESET}${CURSOR}\u001b[?2004hlive`);
    expect(r.engine().resizes).toEqual([[100, 30], [80, 24]]);
  });

  it('waits for a replay that is not here yet: it reads nothing, and applies it when it comes, before the live output the feed held meanwhile', async () => {
    const r = await reattached(undefined);
    r.frame();
    expect(r.engine().writes).toEqual([]);
    expect(r.takes()).toBe(0);
    r.feed.push('live\r\n');
    r.arrive(replayOf('kept\r\n'));
    r.frame();
    expect(r.engine().text()).toBe(`${RESET}${CURSOR}kept\r\nlive\r\n`);
    expect(r.takes()).toBe(1);
  });

  it('writes how the process ended after the replay, as it does after live output: a terminal that ended while no page was there is shown with its output and its end', async () => {
    const r = rig({ reattach: { replay: replayOf('bye\r\n') } });
    r.feed.set({ state: 'ended', exit: { code: 0 } });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.frame();
    expect(r.engine().text()).toBe(`${RESET}${CURSOR}bye\r\n\u001b[0m\r\n\u001b[90m[Process exited with code 0]\u001b[0m\r\n`);
  });

  it('lets go of a replay in the middle when the screen is disposed: the callbacks that come after change nothing', async () => {
    const r = await reattached(replayOf(new Uint8Array(FLOW.slice * 2), { startSize: { cols: 100, rows: 30 }, size: { cols: 80, rows: 24 } }), { auto: false });
    r.frame();
    const resizes = [...r.engine().resizes];
    const sizes = [...r.feed.sizes()];
    r.screen.dispose();
    r.engine().complete();
    expect(r.engine().resizes).toEqual(resizes);
    expect(r.feed.sizes()).toEqual(sizes);
    expect(r.redraws()).toBe(0);
  });

  describe('what the emulator says while it is replayed', () => {
    const QUERY = '\u001b[6n';
    const REPLY = '\u001b[12;7R';

    it('is not heard: the emulator answers the queries in the bytes it is replayed, and none of its answers reaches the feed (the program that asked is long past)', async () => {
      const r = await reattached(replayOf(`a${QUERY}b${QUERY}`), { answers: [[QUERY, REPLY]] });
      r.frame();
      expect(r.engine().emitted).toEqual([REPLY, REPLY]);
      expect(r.feed.typed()).toEqual([]);
    });

    it('is heard again once the replay is parsed: a query in the live output is answered to the shell, and so is a key', async () => {
      const r = rig({ answers: [[QUERY, REPLY]], reattach: { replay: replayOf(`old${QUERY}`) } });
      r.screen.mount(r.host);
      r.feed.push(`live${QUERY}`);
      r.screen.show();
      await r.settle();
      r.frame();
      expect(r.engine().emitted).toEqual([REPLY, REPLY]);
      expect(r.feed.typed()).toEqual([REPLY]);
      r.engine().type('ls\r');
      expect(r.feed.typed()).toEqual([REPLY, 'ls\r']);
    });

    it('is muted from the first byte of the replay until the callback of its LAST slice has fired, and not a byte longer', async () => {
      const r = await reattached(replayOf(new Uint8Array(FLOW.slice * 2 + 1)), { auto: false });
      r.frame();
      r.engine().type('while the first slice is accepted');
      expect(r.feed.typed()).toEqual([]);
      r.engine().complete(r.engine().pendingWrites() - 1);
      r.engine().type('with only the last slice left');
      expect(r.feed.typed()).toEqual([]);
      r.engine().complete();
      r.engine().type('after');
      expect(r.feed.typed()).toEqual(['after']);
    });

    it('is heard before the replay is taken, and by a screen that has no replay at all: nothing is muted that nobody replays', async () => {
      const r = rig();
      r.screen.mount(r.host);
      r.screen.show();
      await r.settle();
      r.engine().type('ls\r');
      expect(r.feed.typed()).toEqual(['ls\r']);
      const late = await reattached(undefined);
      late.engine().type('ls\r');
      expect(late.feed.typed()).toEqual(['ls\r']);
    });
  });

  describe('making a full-screen program paint again', () => {
    it('is asked of the feed when the size the panel has is the size the host\'s terminal has: a size that did not change sends nothing, and the program would not know that it must paint over the bytes it was replayed', async () => {
      const r = await reattached(replayOf('kept', { size: { cols: 80, rows: 24 } }));
      r.frame();
      expect(r.redraws()).toBe(1);
      expect(r.feed.sizes()).toEqual([[80, 24]]);
    });

    it('is not asked when the panel has another size: the feed tells the host the size, the host resizes the terminal, and the program paints by itself', async () => {
      const r = await reattached(replayOf('kept', { size: { cols: 120, rows: 40 } }));
      r.engine().measured({ cols: 100, rows: 30 });
      r.resized();
      r.frame();
      expect(r.redraws()).toBe(0);
      expect(r.feed.sizes()).toEqual([[80, 24], [100, 30]]);
      expect(r.engine().size()).toEqual({ cols: 100, rows: 30 });
    });

    it('waits for the first measure when the renderer is not in place yet: nothing is told before it, and the program is made to paint when the size is told', async () => {
      const ready = Promise.withResolvers<void>();
      const r = await reattached(replayOf('kept'), { rendererReady: ready.promise });
      r.frame();
      expect(r.engine().text()).toBe(`${RESET}${CURSOR}kept`);
      expect(r.redraws()).toBe(0);
      expect(r.feed.sizes()).toEqual([]);
      ready.resolve();
      await r.settle();
      expect(r.feed.sizes()).toEqual([[80, 24]]);
      expect(r.redraws()).toBe(1);
    });

    it('waits until the screen is shown when it was hidden for the replay: nothing is measured while it is hidden', async () => {
      const r = await reattached(replayOf('kept'));
      r.screen.hide();
      r.frame();
      expect(r.engine().text()).toBe(`${RESET}${CURSOR}kept`);
      expect(r.redraws()).toBe(0);
      r.screen.show();
      await r.settle();
      expect(r.redraws()).toBe(1);
    });

    it('is asked once: a later measure of the same size asks nothing', async () => {
      const r = await reattached(replayOf('kept'));
      r.frame();
      r.resized();
      r.engine().measured({ cols: 90, rows: 20 });
      r.resized();
      r.engine().measured({ cols: 80, rows: 24 });
      r.resized();
      expect(r.redraws()).toBe(1);
    });

    it('is not asked of a feed that cannot: the replay is applied all the same', async () => {
      const r = await reattached(replayOf('kept'), { reattach: { redraw: false } });
      r.frame();
      expect(r.redraws()).toBe(0);
      expect(r.engine().text()).toBe(`${RESET}${CURSOR}kept`);
    });

    it('is not asked of a feed that is over: a terminal that ended while no page held it is shown with its output and its end, and there is no program to paint', async () => {
      const r = rig({ reattach: { replay: replayOf('bye\r\n') } });
      r.feed.set({ state: 'ended', exit: { code: 0 } });
      r.screen.mount(r.host);
      r.screen.show();
      await r.settle();
      r.frame();
      expect(r.engine().text()).toContain('bye');
      expect(r.redraws()).toBe(0);
    });

    it('is not asked of a feed that lost the terminal to another tab meanwhile: the program is the other tab\'s, and it must not be made to paint by this one', async () => {
      const r = await reattached(replayOf('kept'));
      r.screen.hide();
      r.frame();
      r.feed.set({ state: 'ended', detached: { by: 'taken-over' } });
      r.screen.show();
      await r.settle();
      expect(r.redraws()).toBe(0);
    });
  });
});

describe('the end of a terminal this page lost', () => {
  async function shown() {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    return r;
  }

  it('writes the words the lane says as the last line, muted, once: the shell lives on, so it is not a process that ended', async () => {
    const { feed, engine, frame } = await shown();
    feed.push('typed\r\n');
    feed.set({ state: 'ended', detached: { by: 'taken-over' } });
    frame();
    expect(engine().text()).toBe('typed\r\n\u001b[0m\r\n\u001b[90m[Taken over by another tab]\u001b[0m\r\n');
    feed.wake();
    frame();
    expect(engine().writes).toHaveLength(2);
  });

  it('writes what the host says after it, once, when the lease runs out while this page is still there: the scrollback tells both', async () => {
    const { feed, engine, frame } = await shown();
    feed.set({ state: 'ended', detached: { by: 'requested' } });
    frame();
    feed.set({ exit: { closedBy: 'detach-timeout' } });
    frame();
    expect(engine().text()).toBe('\u001b[0m\r\n\u001b[90m[Detached]\u001b[0m\r\n\u001b[0m\r\n\u001b[90m[Process closed: no tab took it back in time]\u001b[0m\r\n');
    feed.wake();
    frame();
    expect(engine().writes).toHaveLength(2);
  });

  it('keeps input off', async () => {
    const { feed, engine } = await shown();
    feed.set({ state: 'ended', detached: { by: 'window-retired' } });
    expect(engine().inputs.at(-1)).toBe(false);
  });
});

describe('a start that no shell answered, with the shells the host tried', () => {
  it('writes the typed words and then one muted line for each shell it tried, in order, instead of its prose: the paths can be read and copied, one to a line', async () => {
    const r = rig();
    r.feed.set({
      state: 'failed',
      cause: {
        stage: 'start',
        code: 'SHELL_UNAVAILABLE',
        message: 'shell executable unavailable: tried the shell asked for "/bin/zsh": not found; $SHELL "/opt/none": not executable',
        tried: [
          { source: 'requested', path: '/bin/zsh', reason: 'not-found' },
          { source: 'environment', path: '/opt/none', reason: 'not-executable' },
        ],
      },
    });
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    r.frame();
    expect(r.engine().text()).toBe(
      '\u001b[0m\r\n\u001b[90m[No shell could be started]\u001b[0m\r\n\u001b[0m\r\n\u001b[90m[tried the shell asked for /bin/zsh: not found]\u001b[0m\r\n\u001b[0m\r\n\u001b[90m[tried $SHELL /opt/none: not executable]\u001b[0m\r\n',
    );
  });
});

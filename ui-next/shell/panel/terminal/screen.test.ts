import { describe, expect, it, vi } from 'vitest';
import type { Platform } from '../../core/chords';
import type { EngineAppearance } from './engine';
import { FLOW, SCROLLBACK, createScreen, type TerminalScreen } from './screen';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngine, type FakeEngineLoader, type FakeTerminalFeed } from './testing';

// The screen of a terminal session: the one object between a feed and an emulator (docs/ui-next/status/T1.md, "The screen"). It loads the emulator when the session is first SHOWN and not before, draws what the feed
// holds one frame at a time and never more than the emulator can parse, follows the size of its host (one measure per frame, and a message to the feed only for a size that changed), and, while it is hidden, does
// nothing at all: no listener on the feed, no frame, no observer, no GPU context, so the output of a hidden terminal is held by the feed and costs the main thread a push. Against a fake emulator and a fake clock.

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
  readonly observers: () => { readonly alive: number; readonly started: number };
  /** The host's size changed: what a ResizeObserver tells. */
  readonly resized: () => void;
  readonly copied: string[];
  /** Lets the asynchronous steps of the screen run. */
  readonly settle: () => Promise<void>;
  readonly fonts: { readonly release: () => void; readonly asked: () => readonly string[] };
};

function rig(options: { readonly platform?: Platform; readonly deferred?: boolean; readonly auto?: boolean; readonly fontsHeld?: boolean; readonly copy?: (text: string) => Promise<boolean> } = {}): Rig {
  const feed = fakeTerminalFeed();
  const loader = fakeEngineLoader({ deferred: options.deferred === true, auto: options.auto ?? true });
  const host = document.createElement('div');
  const queue: Array<(() => void) | undefined> = [];
  let asked = 0;
  let cancelled = 0;
  const observed = new Set<() => void>();
  let started = 0;
  const copied: string[] = [];
  const fontWaits: Array<() => void> = [];
  const fontsAsked: string[] = [];
  const screen = createScreen({
    feed,
    load: loader.load,
    appearance: () => APPEARANCE,
    platform: options.platform ?? 'mac',
    label: 'Terminal input, Terminal',
    descriptionId: 'hint-1',
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
    observers: () => ({ alive: observed.size, started }),
    resized: () => {
      for (const callback of [...observed]) {
        callback();
      }
    },
    copied,
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

    r.frame();
    const accepted = r.engine().writes.length;
    expect(accepted).toBe(pieces);
    expect(r.feed.read(0).chunks.length).toBeGreaterThan(0);
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

    r.frame();
    expect(r.engine().writes).toHaveLength(pieces);
    r.engine().complete();
    r.frame();
    expect(r.engine().writes).toHaveLength(pieces * 2);
  });

  it('says how many bytes were skipped before it draws what is left, in the muted words of the transcript: the output past the feed\'s bound is not lost without a word', async () => {
    const { feed, engine, frame } = await shown();
    feed.drop(150_000);
    feed.push('tail');
    frame();
    expect(engine().text()).toMatch(/^\u001b\[0m\r\n\u001b\[2m\[150 KB of output were skipped\]\u001b\[0m\r\n.*tail$/s);
    expect(engine().text().endsWith('tail')).toBe(true);
  });
});

describe('while it is hidden', () => {
  async function shown() {
    const r = rig();
    r.screen.mount(r.host);
    r.screen.show();
    await r.settle();
    return r;
  }

  it('lets go of everything: no listener on the feed, no frame asked for or waiting, no observer, no GPU context', async () => {
    const { screen, feed, engine, frames, observers } = await shown();
    feed.push('a');
    expect(frames().pending).toBe(1);
    screen.hide();
    expect(feed.listeners()).toBe(0);
    expect(frames().pending).toBe(0);
    expect(observers().alive).toBe(0);
    expect(engine().renderers.at(-1)).toBe('dom');
  });

  it('costs the main thread a push for output that comes while it is hidden: no read, no write, no frame, no measure', async () => {
    const { screen, feed, engine, frames, frame, resized } = await shown();
    screen.hide();
    const asked = frames().asked;
    const reads = feed.reads();
    const writes = engine().writes.length;
    for (let index = 0; index < 100; index += 1) {
      feed.push('y\r\n');
    }

    resized();
    frame();
    expect(frames().asked).toBe(asked);
    expect(feed.reads()).toBe(reads);
    expect(engine().writes).toHaveLength(writes);
  });

  it('draws what the feed held, once, when it is shown again, and takes the GPU renderer back', async () => {
    const { screen, feed, engine, frame } = await shown();
    screen.hide();
    feed.push('while hidden\r\n');
    screen.show();
    await Promise.resolve();
    frame();
    expect(engine().text()).toBe('while hidden\r\n');
    expect(engine().renderers).toEqual(['gpu', 'dom', 'gpu']);
    expect(feed.listeners()).toBe(1);
  });

  it('measures again when it is shown: the panel may have been another size when it left', async () => {
    const { screen, feed, engine } = await shown();
    screen.hide();
    engine().measured({ cols: 100, rows: 30 });
    screen.show();
    await Promise.resolve();
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
    expect(engine().text()).toBe('bye\r\n\u001b[0m\r\n\u001b[2m[Process exited with code 3]\u001b[0m\r\n');
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

  it('writes the line a session already ended when it is shown: a terminal that ended while hidden says so when it comes back', async () => {
    const { screen, feed, engine, frame } = await shown();
    screen.hide();
    feed.push('last\r\n');
    feed.set({ state: 'ended', exit: { code: 0 } });
    screen.show();
    await Promise.resolve();
    frame();
    expect(engine().text()).toBe('last\r\n\u001b[0m\r\n\u001b[2m[Process exited with code 0]\u001b[0m\r\n');
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

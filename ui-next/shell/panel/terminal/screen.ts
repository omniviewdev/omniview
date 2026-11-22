import type { Platform } from '../../core/chords';
import type { Engine, EngineAppearance, EngineLoader, EngineOptions } from './engine';
import type { TerminalFeedHandle, TerminalFeedSnapshot } from './feed';
import { keyOf, sequenceOf } from './keys';
import type { ScreenReaderSource } from './screenReader';
import { exitLine } from './state';

// The screen of a terminal session: the one object between a feed and an emulator (docs/ui-next/status/T1.md, "The screen"). It is framework-free and knows no xterm: it is written against `Engine`, and the body
// (`TerminalBody.tsx`) only gives it a host element and tells it whether it is on screen. The rules:
//
//   - NOTHING happens before the screen is first shown: the emulator's code is not asked for, no emulator is made, nothing listens (a terminal that is not on screen costs no code and no time);
//   - while it is shown, the feed wakes it once between two reads and it draws in the NEXT FRAME, never in the event; a frame takes only what the emulator can parse (`FLOW.high` bytes accepted and not parsed),
//     cut in slices the emulator parses without a long task (`FLOW.slice`), and what is more stays in the feed, whose bound is the one place output waits (docs/ui-next/optimisations.md HGO-34);
//   - the size of the host is measured by an observer (before paint, once a frame at most), the emulator follows it, and the feed is told only a size that changed (it settles the rest);
//   - while it is hidden it does nothing at all: no listener on the feed, no frame, no observer, no GPU context. The output of a hidden terminal is held by the feed and costs a push (MNR-X4);
//   - the window's screen reader choice is read when the emulator is made and followed while the screen is on screen, one call to the emulator for each change; a hidden screen listens to nothing, its emulator is out of the mode
//     while it is hidden (an accessibility layer refreshes itself a second after the lines it was given, which must not happen in a hidden panel), and the choice made meanwhile is taken when the screen is shown again;
//   - the emulator keeps its screen and its scrollback for the life of the session, and is disposed once, with the session.

/** Lines kept above the screen: 5,000, as the library's terminal keeps (LIB-21) and the old host's did not (it took the emulator's 1,000). The mock keeps 2,000 rows of transcript (`TERM_CAP`). */
export const SCROLLBACK = 5_000;

/**
 * The flow of output into the emulator: at most `high` bytes accepted and not yet parsed, in writes of at most `slice` bytes, and at most `frame` bytes taken in one frame (about 30 MB/s at 60 Hz, twice the fastest pty
 * the host measured). The last bound keeps the work of a frame to a few milliseconds whatever the frame's lateness: a frame that comes late on a busy machine takes its share and the next frame the next share, where
 * without it the backlog was one task of 150 ms (a long task, and a frame of 50 ms, measured in Chromium under load).
 */
export const FLOW = Object.freeze({ high: 4 << 20, slice: 64 << 10, frame: 512 << 10 });

/** The cells an emulator is made with, until the host is measured. */
const INITIAL = Object.freeze({ cols: 80, rows: 24 });

export type ScreenSnapshot = {
  /** The emulator exists and is drawing in the host. */
  readonly ready: boolean;
  /** Some of the output is selected. */
  readonly selected: boolean;
  /** Why the emulator could not start (its code did not load); it is tried again the next time the screen is shown. */
  readonly error: string | undefined;
};

export type ScreenDeps = {
  readonly feed: TerminalFeedHandle;
  /** Loads the emulator's code: asked for the first time the screen is shown, and again only after it failed. */
  readonly load: EngineLoader;
  /** The look of the screen now, read from around its host element: when the emulator is made and when `refresh` is called. */
  readonly appearance: (host: HTMLElement) => EngineAppearance;
  readonly platform: Platform;
  /** The name of the emulator's input and the id of the element that says how to leave it. */
  readonly label: string;
  readonly descriptionId: string;
  /** The window's screen reader choice (`screenReader.ts`): the emulator is made in the mode it holds, and follows it while the screen is on screen. */
  readonly screenReader: ScreenReaderSource;
  /** Asks for a frame; returns what cancels it. */
  readonly frame: (callback: () => void) => () => void;
  /** Observes the size of an element; returns what stops it. */
  readonly observe: (element: HTMLElement, callback: () => void) => () => void;
  /** Resolves when the font (a CSS `font` shorthand: size and family) is loaded, or is not going to be. */
  readonly fontsReady: (font: string) => Promise<void>;
  /** Puts text on the clipboard; says whether it could. */
  readonly copy: (text: string) => Promise<boolean>;
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
};

export type TerminalScreen = {
  /** The element the emulator draws in. Nothing else happens. */
  readonly mount: (host: HTMLElement) => void;
  /** The screen is on screen: the first time makes the emulator, every time listens to the feed and draws what it held. */
  readonly show: () => void;
  /** The screen is not on screen: it lets go of everything but the emulator's state. */
  readonly hide: () => void;
  /** Puts the keyboard in the emulator. False when it is not there or not on screen. */
  readonly focus: () => boolean;
  readonly clear: () => void;
  /** Copies the selection; says whether anything was copied. */
  readonly copy: () => Promise<boolean>;
  /** The theme or the font changed: read the appearance again and apply it to the emulator that is there. */
  readonly refresh: () => void;
  readonly dispose: () => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ScreenSnapshot;
};

/** What was skipped, in words a person reads: whole bytes, thousands, millions. */
function sizeWords(bytes: number): string {
  if (bytes < 1_000) {
    return `${String(bytes)} bytes`;
  }

  return bytes < 1_000_000 ? `${String(Math.round(bytes / 1_000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Text in the muted colour of the transcript's own lines, on a line of its own (the escape sequences are the emulator's: reset, bright black, reset). The palette's bright black is the theme's muted text; the emulator's dim style would be half the opacity of any colour, which no contrast rule can pass. */
const muted = (text: string): string => `\u001b[0m\r\n\u001b[90m${text}\u001b[0m\r\n`;

const takesInput = (status: TerminalFeedSnapshot): boolean => status.state === 'starting' || status.state === 'running';

const clearers = new WeakMap<Element, () => void>();

/**
 * Clears the screen that holds `target` (the element a key came to) and says whether there was one. Command K is the terminal's while it has the focus (VS Code and JetBrains agree, keys.ts `clear`), and it is also the
 * window's palette chord: the window asks this first.
 */
export function clearScreenIn(target: EventTarget | null): boolean {
  for (let node = target instanceof Element ? target : null; node !== null; node = node.parentElement) {
    const clear = clearers.get(node);
    if (clear !== undefined) {
      clear();
      return true;
    }
  }

  return false;
}

export function createScreen(deps: ScreenDeps): TerminalScreen {
  const { feed } = deps;
  const warn = deps.warn ?? ((message: string, error?: unknown) => {
    console.warn(message, error);
  });
  const listeners = new Set<() => void>();
  const stops: Array<() => void> = [];
  let snapshot: ScreenSnapshot = { ready: false, selected: false, error: undefined };
  let host: HTMLElement | undefined;
  let factory: ((options: EngineOptions) => Engine) | undefined;
  let engine: Engine | undefined;
  /** The screen reader mode the emulator has now. */
  let readerMode = false;
  let visible = false;
  let disposed = false;
  let loading = false;
  let stopFeed: (() => void) | undefined;
  let stopReader: (() => void) | undefined;
  let stopObserving: (() => void) | undefined;
  let cancelFrame: (() => void) | undefined;
  let told: { readonly cols: number; readonly rows: number } | undefined;
  let lastStatus: TerminalFeedSnapshot | undefined;
  let endWritten = false;
  let pending = 0;
  let blocked = false;

  const set = (change: Partial<ScreenSnapshot>) => {
    snapshot = { ...snapshot, ...change };
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const schedule = () => {
    if (visible && cancelFrame === undefined) {
      cancelFrame = deps.frame(pump);
    }
  };

  /** Writes what is held in slices the emulator parses without a long task, and counts what it has accepted and not parsed. */
  function send(emulator: Engine, chunks: readonly Uint8Array[]): void {
    let piece = new Uint8Array(FLOW.slice);
    let filled = 0;
    const flush = () => {
      if (filled === 0) {
        return;
      }

      const bytes = filled;
      pending += bytes;
      emulator.write(piece.subarray(0, bytes), () => {
        pending -= bytes;
        // The emulator took what it had: a frame that stopped at the bound goes on once half of it is parsed.
        if (blocked && pending < FLOW.high / 2) {
          blocked = false;
          schedule();
        }
      });
      piece = new Uint8Array(FLOW.slice);
      filled = 0;
    };

    for (const chunk of chunks) {
      for (let at = 0; at < chunk.length; ) {
        const take = Math.min(chunk.length - at, FLOW.slice - filled);
        piece.set(chunk.subarray(at, at + take), filled);
        filled += take;
        at += take;
        if (filled === FLOW.slice) {
          flush();
        }
      }
    }

    flush();
  }

  function pump(): void {
    cancelFrame = undefined;
    if (!visible || engine === undefined) {
      return;
    }

    let taken = 0;
    for (;;) {
      const room = FLOW.high - pending;
      if (room <= 0) {
        blocked = true;
        return;
      }

      const budget = Math.min(room, FLOW.frame - taken);
      if (budget <= 0) {
        // This frame's share is taken: what the feed still holds is the next frame's.
        schedule();
        return;
      }

      const out = feed.read(budget);
      if (out.dropped > 0) {
        engine.write(muted(`[${sizeWords(out.dropped)} of output were skipped]`));
      }

      if (out.chunks.length === 0) {
        break;
      }

      send(engine, out.chunks);
      taken += out.bytes;
    }

    // How the process ended is the last line of its output.
    const status = feed.getSnapshot();
    if (status.state === 'ended' && !endWritten) {
      endWritten = true;
      engine.write(muted(exitLine(status)));
    }
  }

  /** The feed told us something: a new status is applied, and whatever it is the output it holds is drawn in the next frame. */
  function heard(): void {
    const status = feed.getSnapshot();
    if (status !== lastStatus) {
      lastStatus = status;
      engine?.setInput(takesInput(status));
    }

    schedule();
  }

  /** Measures the host; the emulator follows it, and the feed is told only a size that changed. */
  function fit(): void {
    if (!visible || engine === undefined) {
      return;
    }

    const cells = engine.measure();
    if (cells === undefined) {
      return;
    }

    const now = engine.size();
    if (cells.cols !== now.cols || cells.rows !== now.rows) {
      engine.resize(cells.cols, cells.rows);
    }

    if (told?.cols !== cells.cols || told.rows !== cells.rows) {
      told = cells;
      feed.resize(cells.cols, cells.rows);
    }
  }

  function onKey(event: KeyboardEvent): boolean {
    const sequence = event.type === 'keydown' ? sequenceOf(event, deps.platform) : undefined;
    if (sequence !== undefined) {
      // A Mac IDE's own bytes for word and line movement (keys.ts): the emulator's encoding of the key is not sent.
      event.preventDefault();
      if (takesInput(feed.getSnapshot())) {
        feed.write(sequence);
      }

      return false;
    }

    switch (keyOf(event, deps.platform, engine?.hasSelection() === true)) {
      case 'terminal':
        return true;
      case 'leave':
      case 'app':
        return false;
      case 'paste':
        // The emulator must not also send the key: the browser's paste event reaches it.
        return false;
      case 'copy':
        event.preventDefault();
        if (event.type === 'keydown') {
          void copy();
        }

        return false;
      case 'selectAll':
        event.preventDefault();
        if (event.type === 'keydown') {
          engine?.selectAll();
        }

        return false;
      case 'clear':
        event.preventDefault();
        if (event.type === 'keydown') {
          engine?.clear();
        }

        return false;
    }
  }

  async function copy(): Promise<boolean> {
    const text = engine?.selection() ?? '';
    return text === '' ? false : deps.copy(text);
  }

  /** Gives the emulator the window's screen reader choice when it is not what the emulator has: the choice is read when the screen is shown and again whenever it changes while the screen is on screen. */
  function follow(): void {
    const mode = deps.screenReader.getSnapshot();
    if (engine !== undefined && mode !== readerMode) {
      readerMode = mode;
      engine.setScreenReaderMode(mode);
    }
  }

  /** Listens to the feed and the host, and draws what the feed holds. The emulator is there and the screen is on screen. */
  function attach(emulator: Engine): void {
    // The GPU's cells are not the DOM's (it rounds the cell to whole device pixels): once it is in place the host is measured again.
    void emulator.setRenderer('gpu').then(fit);
    if (host !== undefined) {
      stopObserving = deps.observe(host, fit);
    }

    follow();
    stopReader = deps.screenReader.subscribe(follow);
    stopFeed = feed.subscribe(heard);
    fit();
    heard();
  }

  function detach(): void {
    stopReader?.();
    stopReader = undefined;
    stopFeed?.();
    stopFeed = undefined;
    stopObserving?.();
    stopObserving = undefined;
    cancelFrame?.();
    cancelFrame = undefined;
  }

  function create(): void {
    if (factory === undefined || host === undefined) {
      return;
    }

    readerMode = deps.screenReader.getSnapshot();
    const made = factory({ cols: INITIAL.cols, rows: INITIAL.rows, scrollback: SCROLLBACK, appearance: deps.appearance(host), screenReaderMode: readerMode });
    engine = made;
    made.open(host);
    made.describe(deps.label, deps.descriptionId);
    made.setKeys(onKey);
    stops.push(
      made.onData((data) => {
        feed.write(data);
      }),
      made.onSelection(() => {
        const selected = made.hasSelection();
        if (selected !== snapshot.selected) {
          set({ selected });
        }
      }),
      // The emulator is silent: the host shows the bell, on the screen, and never makes a sound. Two names for the one animation restart it for each bell without a timer.
      made.onBell(() => {
        if (host !== undefined) {
          host.setAttribute('data-bell', host.getAttribute('data-bell') === 'a' ? 'b' : 'a');
        }
      }),
    );
    lastStatus = feed.getSnapshot();
    made.setInput(takesInput(lastStatus));
    set({ ready: true });
    attach(made);
  }

  async function start(): Promise<void> {
    const element = host;
    if (loading || element === undefined) {
      return;
    }

    loading = true;
    set({ error: undefined });
    try {
      factory ??= await deps.load();
      const { fontSize, fontFamily } = deps.appearance(element);
      await deps.fontsReady(`${String(fontSize)}px ${fontFamily}`);
    } catch (error) {
      loading = false;
      if (!disposed) {
        warn('[terminal] the terminal view could not be loaded', error);
        set({ error: error instanceof Error ? error.message : String(error) });
      }

      return;
    }

    loading = false;
    // Hidden again, or gone, while the code came: the next show makes the emulator.
    if (!disposed && visible && engine === undefined) {
      create();
    }
  }

  return {
    mount: (element) => {
      host = element;
      clearers.set(element, () => {
        engine?.clear();
      });
    },

    show: () => {
      if (disposed || visible) {
        return;
      }

      visible = true;
      if (engine === undefined) {
        void start();
      } else {
        attach(engine);
      }
    },

    hide: () => {
      if (!visible) {
        return;
      }

      visible = false;
      if (engine !== undefined) {
        detach();
        void engine.setRenderer('dom');
        // A hidden terminal has no accessibility layer: the emulator refreshes its layer a second at most after the lines it was given, so one printed just before the panel was hidden would be refreshed IN the hidden panel
        // (measured: 37 document mutations). It goes out of the mode here, once, and `follow` puts it back in when the screen is shown.
        if (readerMode) {
          readerMode = false;
          engine.setScreenReaderMode(false);
        }
      }
    },

    focus: () => {
      if (engine === undefined || !visible) {
        return false;
      }

      engine.focus();
      return true;
    },

    clear: () => {
      engine?.clear();
    },

    copy,

    refresh: () => {
      if (host !== undefined) {
        engine?.setAppearance(deps.appearance(host));
        // A new text size changes the cells that fit while the host's own rectangle did not move, so no observer says it: the grid is measured again (it sends nothing when the size is the same).
        fit();
      }
    },

    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      if (host !== undefined) {
        clearers.delete(host);
      }

      visible = false;
      detach();
      for (const stop of stops.splice(0)) {
        stop();
      }

      engine?.dispose();
      engine = undefined;
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: () => snapshot,
  };
}

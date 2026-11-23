import type { Engine, EngineAppearance, EngineLoader, EngineOptions, EngineRenderer } from './engine';
import type { TerminalFeedHandle, TerminalFeedSnapshot, TerminalOutput } from './feed';

// A feed for the tests of the Terminal tool: it has the contract of a real one (a reader that reads what is held, a wake-up once between two reads, a status that is the same object until it changes) and the
// counters a test asks for: how many listeners it has, how many times it was closed and read, what was typed, which sizes were asked for. Invented bytes; nothing here is a backend.

export type FakeTerminalFeed = TerminalFeedHandle & {
  /** Listeners now: every `subscribe` not yet answered by its unsubscribe. */
  readonly listeners: () => number;
  /** How many times `close` was called. */
  readonly closed: () => number;
  /** How many times `read` was called. */
  readonly reads: () => number;
  /** What was typed, in the order it was given. */
  readonly typed: () => readonly string[];
  /** The sizes asked for, as [columns, rows], in order. */
  readonly sizes: () => ReadonlyArray<readonly [number, number]>;
  /** A new status: only what is given changes, and every listener is told. */
  readonly set: (change: Partial<TerminalFeedSnapshot>) => void;
  /** Holds bytes for the reader (the text as UTF-8, or the bytes as they are), and wakes the listeners once, until the next read. */
  readonly push: (output: string | Uint8Array) => void;
  /** Says the bound dropped this many bytes before the next read (the reader is told once), and wakes the listeners like `push`. */
  readonly drop: (bytes: number) => void;
  /** Tells the listeners without changing anything: what a feed does when held output became readable. */
  readonly wake: () => void;
};

export type FakeTerminalFeedOptions = {
  readonly state?: TerminalFeedSnapshot['state'] | undefined;
  /** What `close` does; default: nothing. */
  readonly close?: (() => Promise<void> | void) | undefined;
};

/** A feed that is `running` (or in the state asked for) and holds nothing. */
export function fakeTerminalFeed(options: FakeTerminalFeedOptions = {}): FakeTerminalFeed {
  const listeners = new Set<() => void>();
  let subscribed = 0;
  let closed = 0;
  let reads = 0;
  let status: TerminalFeedSnapshot = { state: options.state ?? 'running' };
  let held: Uint8Array[] = [];
  let dropped = 0;
  let woken = false;
  const typed: string[] = [];
  const sizes: Array<readonly [number, number]> = [];

  const tell = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      subscribed += 1;
      let live = true;
      return () => {
        if (live) {
          live = false;
          listeners.delete(listener);
          subscribed -= 1;
        }
      };
    },
    getSnapshot: () => status,
    read: (max): TerminalOutput => {
      reads += 1;
      woken = false;
      let count = held.length;
      if (max !== undefined) {
        let sum = 0;
        count = 0;
        while (count < held.length && (count === 0 || sum < max)) {
          sum += held[count]?.length ?? 0;
          count += 1;
        }
      }

      const chunks = held.slice(0, count);
      held = held.slice(count);
      const lost = dropped;
      dropped = 0;
      return { chunks, bytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0), dropped: lost };
    },
    write: (text) => {
      typed.push(text);
    },
    resize: (cols, rows) => {
      sizes.push([cols, rows]);
    },
    close: (): Promise<void> | void => {
      closed += 1;
      return options.close?.();
    },
    listeners: () => subscribed,
    closed: () => closed,
    reads: () => reads,
    typed: () => typed,
    sizes: () => sizes,
    set: (change) => {
      status = { ...status, ...change };
      tell();
    },
    push: (output) => {
      held.push(typeof output === 'string' ? new TextEncoder().encode(output) : output);
      if (!woken) {
        woken = true;
        tell();
      }
    },
    drop: (bytes) => {
      dropped += bytes;
      if (!woken) {
        woken = true;
        tell();
      }
    },
    wake: tell,
  };
}

// ---- an emulator for the tests of the screen --------------------------------------------------------------------------------------------------------------------------------------------------------------


export type FakeEngine = Engine & {
  /** Every call of `write`, in order. */
  readonly writes: ReadonlyArray<Uint8Array | string>;
  /** What was written, as text. */
  readonly text: () => string;
  /** The `done` callbacks not yet called: what the emulator has accepted and not parsed. */
  readonly pendingWrites: () => number;
  /** Parses the oldest accepted writes: calls their callbacks. */
  readonly complete: (count?: number) => void;
  readonly resizes: ReadonlyArray<readonly [number, number]>;
  readonly renderers: readonly EngineRenderer[];
  readonly inputs: readonly boolean[];
  /** Every call of `setScreenReaderMode`, in order: the changes made after the emulator was made (what it was made with is `options.screenReaderMode`). */
  readonly screenReaderModes: readonly boolean[];
  readonly appearances: readonly EngineAppearance[];
  readonly labels: ReadonlyArray<readonly [string, string]>;
  readonly options: EngineOptions;
  readonly host: () => HTMLElement | undefined;
  readonly disposed: () => number;
  readonly clears: () => number;
  readonly selectAlls: () => number;
  readonly focuses: () => number;
  /** What the user typed. */
  readonly type: (data: string) => void;
  /** Selects text (or clears the selection with `''`) and tells the listeners. */
  readonly select: (text: string) => void;
  /** The program rang the bell: tells the listeners. */
  readonly ring: () => void;
  /** Runs the key handler on an event, as the emulator does, and says what it answered. */
  readonly key: (init: Partial<Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>>) => { readonly handled: boolean; readonly defaultPrevented: boolean };
  /** What the host measures now (`undefined`: no size). */
  readonly measured: (size: { readonly cols: number; readonly rows: number } | undefined) => void;
  readonly listeners: () => number;
};

export type FakeEngineOptions = {
  /** Parse every write at once (the default), or hold the callbacks until `complete`. */
  readonly auto?: boolean | undefined;
  /** What `setRenderer` waits for before it answers (default: nothing): a test holds it to see what the screen does in between. */
  readonly rendererReady?: Promise<void> | undefined;
};

export function fakeEngine(options: EngineOptions, config: FakeEngineOptions = {}): FakeEngine {
  const auto = config.auto ?? true;
  const writes: Array<Uint8Array | string> = [];
  const waiting: Array<(() => void) | undefined> = [];
  const resizes: Array<readonly [number, number]> = [];
  const renderers: EngineRenderer[] = [];
  const inputs: boolean[] = [];
  const screenReaderModes: boolean[] = [];
  const appearances: EngineAppearance[] = [];
  const labels: Array<readonly [string, string]> = [];
  const dataListeners = new Set<(data: string) => void>();
  const selectionListeners = new Set<() => void>();
  const bellListeners = new Set<() => void>();
  let keys: ((event: KeyboardEvent) => boolean) | undefined;
  let host: HTMLElement | undefined;
  let size = { cols: options.cols, rows: options.rows };
  let measured: { readonly cols: number; readonly rows: number } | undefined = { cols: options.cols, rows: options.rows };
  let selected = '';
  let disposed = 0;
  let clears = 0;
  let selectAlls = 0;
  let focuses = 0;
  let focused = false;

  return {
    options,
    writes,
    screenReaderModes,
    text: () => writes.map((data) => (typeof data === 'string' ? data : new TextDecoder().decode(data))).join(''),
    pendingWrites: () => waiting.filter((done) => done !== undefined).length,
    complete: (count = Number.POSITIVE_INFINITY) => {
      let left = count;
      for (let index = 0; index < waiting.length && left > 0; index += 1) {
        const done = waiting[index];
        if (done !== undefined) {
          waiting[index] = undefined;
          left -= 1;
          done();
        }
      }
    },
    resizes,
    renderers,
    inputs,
    appearances,
    labels,
    host: () => host,
    disposed: () => disposed,
    clears: () => clears,
    selectAlls: () => selectAlls,
    focuses: () => focuses,
    open: (element) => {
      host = element;
    },
    measure: () => measured,
    resize: (cols, rows) => {
      size = { cols, rows };
      resizes.push([cols, rows]);
    },
    size: () => size,
    write: (data, done) => {
      writes.push(data);
      if (auto) {
        done?.();
      } else {
        waiting.push(done);
      }
    },
    onData: (listener) => {
      dataListeners.add(listener);
      return () => {
        dataListeners.delete(listener);
      };
    },
    onSelection: (listener) => {
      selectionListeners.add(listener);
      return () => {
        selectionListeners.delete(listener);
      };
    },
    onBell: (listener) => {
      bellListeners.add(listener);
      return () => {
        bellListeners.delete(listener);
      };
    },
    setKeys: (handler) => {
      keys = handler;
    },
    setAppearance: (appearance) => {
      appearances.push(appearance);
    },
    setInput: (on) => {
      inputs.push(on);
    },
    setScreenReaderMode: (on) => {
      screenReaderModes.push(on);
    },
    setRenderer: async (renderer) => {
      renderers.push(renderer);
      await config.rendererReady;
    },
    describe: (label, descriptionId) => {
      labels.push([label, descriptionId]);
    },
    focus: () => {
      focuses += 1;
      focused = true;
    },
    hasFocus: () => focused,
    hasSelection: () => selected !== '',
    selection: () => selected,
    clear: () => {
      clears += 1;
    },
    selectAll: () => {
      selectAlls += 1;
    },
    dispose: () => {
      disposed += 1;
    },
    type: (data) => {
      for (const listener of [...dataListeners]) {
        listener(data);
      }
    },
    select: (text) => {
      selected = text;
      for (const listener of [...selectionListeners]) {
        listener();
      }
    },
    ring: () => {
      for (const listener of [...bellListeners]) {
        listener();
      }
    },
    key: (init) => {
      let defaultPrevented = false;
      const event = { type: 'keydown', key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init, preventDefault: () => {
        defaultPrevented = true;
      } } as unknown as KeyboardEvent;
      return { handled: keys?.(event) ?? true, defaultPrevented };
    },
    measured: (next) => {
      measured = next;
    },
    listeners: () => dataListeners.size + selectionListeners.size + bellListeners.size,
  };
}

export type FakeEngineLoader = {
  readonly load: EngineLoader;
  /** The emulators made so far. */
  readonly engines: readonly FakeEngine[];
  /** How many times the code was asked for. */
  readonly loads: () => number;
  /** Answers the asks of the code that are waiting (when the loader was made `deferred`). */
  readonly release: () => void;
  /** Makes the code fail to load. */
  readonly fail: (error: unknown) => void;
};

/** An emulator loader: immediate, or `deferred` until `release`. */
export function fakeEngineLoader(config: FakeEngineOptions & { readonly deferred?: boolean | undefined } = {}): FakeEngineLoader {
  const engines: FakeEngine[] = [];
  const waiting: Array<{ readonly resolve: (factory: (options: EngineOptions) => Engine) => void; readonly reject: (error: unknown) => void }> = [];
  let loads = 0;
  const factory = (options: EngineOptions): Engine => {
    const engine = fakeEngine(options, config);
    engines.push(engine);
    return engine;
  };

  return {
    engines,
    loads: () => loads,
    load: async () => {
      loads += 1;
      if (config.deferred !== true) {
        return Promise.resolve(factory);
      }

      return new Promise((resolve, reject) => {
        waiting.push({ resolve, reject });
      });
    },
    release: () => {
      for (const one of waiting.splice(0)) {
        one.resolve(factory);
      }
    },
    fail: (error) => {
      for (const one of waiting.splice(0)) {
        one.reject(error);
      }
    },
  };
}

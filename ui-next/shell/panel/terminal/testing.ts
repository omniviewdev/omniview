import type { Engine, EngineAppearance, EngineLoader, EngineOptions, EngineRenderer } from './engine';
import type { ExecTransport } from './execFeed';
import type { TerminalBusy, TerminalFeedHandle, TerminalFeedSnapshot, TerminalOutput } from './feed';

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
  /** The byte count of every `ack`, in order: what the screen told the feed it had parsed. */
  readonly acks: () => readonly number[];
  /** Tells the listeners without changing anything: what a feed does when held output became readable. */
  readonly wake: () => void;
};

export type FakeTerminalFeedOptions = {
  readonly state?: TerminalFeedSnapshot['state'] | undefined;
  /** What `close` does; default: nothing. */
  readonly close?: (() => Promise<void> | void) | undefined;
  /** What the feed answers when it is asked what runs in it; default: the feed cannot tell (it has no such member). */
  readonly busy?: (() => Promise<TerminalBusy>) | undefined;
};

/** A feed that is `running` (or in the state asked for) and holds nothing. */
export function fakeTerminalFeed(options: FakeTerminalFeedOptions = {}): FakeTerminalFeed {
  const listeners = new Set<() => void>();
  let subscribed = 0;
  let closed = 0;
  let reads = 0;
  let status: TerminalFeedSnapshot = { state: options.state ?? 'running' };
  let held: Uint8Array[] = [];
  const acks: number[] = [];
  let woken = false;
  const typed: string[] = [];
  /** The calls of the typing that the feed took: what `inputs` says. */
  let taken = 0;
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
      return { chunks, bytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0) };
    },
    write: (text) => {
      typed.push(text);
      // A real feed takes what is typed while the process starts or runs, and not a call with nothing in it, nor anything once it was closed or the session is over.
      if (text !== '' && closed === 0 && (status.state === 'starting' || status.state === 'running')) {
        taken += 1;
      }
    },
    resize: (cols, rows) => {
      sizes.push([cols, rows]);
    },
    close: (): Promise<void> | void => {
      closed += 1;
      return options.close?.();
    },
    ack: (bytes) => {
      acks.push(bytes);
    },
    ...(options.busy === undefined ? {} : { busy: options.busy }),
    listeners: () => subscribed,
    closed: () => closed,
    reads: () => reads,
    typed: () => typed,
    inputs: () => taken,
    sizes: () => sizes,
    acks: () => acks,
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

// ---- a host with the credit flow control, for the tests of the whole data path ---------------------------------------------------------------------------------------------------------------------------
//
// What backend/pkg/terminal/flow.go does, as far as a page can tell (docs/ui-next/status/T1-go.md 2.8.6): the host counts the bytes it delivered that nobody has credited; at the high mark it STOPS READING the pty, so
// the shell waits in its own write; it reads again when the count is down to the low mark. Until the client's first acknowledgement the transport credits what it took (here: at once, the page takes every event); from
// the first on only the client's acknowledgements credit. The bytes the shell writes are a counting sequence (0, 1, ... 250, 0, ...), so a test can tell that every byte arrived, once, in order.
// What the page types and the sizes it sends are recorded with their call numbers (`inputs`): the host puts them in order by the number, whatever order they reach it in, and nothing here changes their order.

/** An input call the page made, with the number it carried: a write as the text the host's pty would read, a size as the binding takes it (rows, then columns). */
export type HostInput =
  | { readonly kind: 'write'; readonly seq: number; readonly text: string }
  | { readonly kind: 'resize'; readonly seq: number; readonly rows: number; readonly cols: number };

export type CreditHost = {
  readonly transport: ExecTransport;
  /** The shell writes this many more bytes. What the host may read now it delivers (reads of at most 20,480 bytes); the rest waits in the pty. */
  readonly produce: (bytes: number) => void;
  /** Bytes the shell wrote that the host has not read: the shell, blocked in its own write. */
  readonly waiting: () => number;
  /** Bytes the host delivered to the page. */
  readonly delivered: () => number;
  /** Bytes it delivered that nobody credited, now, and the most that count ever was. */
  readonly unacked: () => number;
  readonly mostUnacked: () => number;
  /** The client's acknowledgements are the only credit: it made its first call. */
  readonly explicit: () => boolean;
  /** The host stopped reading the pty. */
  readonly paused: () => boolean;
  /** The count of every `AckTerminal` call, in order. */
  readonly acks: () => readonly number[];
  /** The byte a sequence has at this offset: what the shell wrote at it. */
  readonly byteAt: (offset: number) => number;
  /** Every input call the page made, in the order it made them, with its number. */
  readonly inputs: () => readonly HostInput[];
};

export type CreditHostOptions = {
  readonly high?: number;
  readonly low?: number;
  /** The size of one pty read. */
  readonly read?: number;
};

function base64Of(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 4_096) {
    text += String.fromCharCode(...bytes.subarray(at, at + 4_096));
  }

  return btoa(text);
}

export function fakeCreditHost(options: CreditHostOptions = {}): CreditHost {
  const high = options.high ?? 1_048_576;
  const low = options.low ?? 262_144;
  const readSize = options.read ?? 20_480;
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const acks: number[] = [];
  const inputs: HostInput[] = [];
  let session: string | undefined;
  let queued = 0;
  let delivered = 0;
  let unacked = 0;
  let most = 0;
  let explicit = false;
  let paused = false;
  let pumping = false;

  const byteAt = (offset: number): number => offset % 251;

  const pump = () => {
    // An acknowledgement that comes while the host is delivering (the page parses in the listener) is credited by the loop that is running.
    if (pumping) {
      return;
    }

    pumping = true;
    while (queued > 0 && !paused && session !== undefined) {
      const size = Math.min(readSize, queued);
      const chunk = new Uint8Array(size);
      for (let index = 0; index < size; index += 1) {
        chunk[index] = byteAt(delivered + index);
      }

      queued -= size;
      unacked += size;
      most = Math.max(most, unacked);
      delivered += size;
      for (const listener of [...(listeners.get(`core/exec/stream/stdout/${session}`) ?? [])]) {
        listener(base64Of(chunk));
      }

      // Until the client takes over the credit, the transport's is what counts, and the page took the event.
      if (!explicit) {
        unacked = Math.max(0, unacked - size);
      }

      if (unacked >= high) {
        paused = true;
      }
    }

    pumping = false;
  };

  const transport: ExecTransport = {
    create: async (id) => {
      session = id;
      pump();
      return Promise.resolve({ id, pid: 4242, shell: { path: '/bin/sh', name: 'sh' }, cwd: '/home/u', cols: 80, rows: 24 });
    },
    write: async (_id, seq, base64) => {
      inputs.push({ kind: 'write', seq, text: new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))) });
      return Promise.resolve();
    },
    resize: async (_id, seq, rows, cols) => {
      inputs.push({ kind: 'resize', seq, rows, cols });
      return Promise.resolve();
    },
    close: async () => Promise.resolve(),
    ack: async (_id, bytes) => {
      explicit = true;
      acks.push(bytes);
      unacked = Math.max(0, unacked - bytes);
      if (paused && unacked <= low) {
        paused = false;
      }

      pump();
      return Promise.resolve();
    },
    busy: async () => Promise.resolve({ state: 'idle' }),
    on: (name, listener) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => {
        set.delete(listener);
      };
    },
    describe: (error) => (error instanceof Error ? error.message : String(error)),
    isGone: () => false,
    codeOf: () => undefined,
  };

  return {
    transport,
    produce: (bytes) => {
      queued += bytes;
      pump();
    },
    waiting: () => queued,
    delivered: () => delivered,
    unacked: () => unacked,
    mostUnacked: () => most,
    explicit: () => explicit,
    paused: () => paused,
    acks: () => acks,
    inputs: () => inputs,
    byteAt,
  };
}

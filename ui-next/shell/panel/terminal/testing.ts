import type { Engine, EngineAppearance, EngineLoader, EngineOptions, EngineRenderer } from './engine';
import type { ExecTransport } from './execFeed';
import type { TerminalBusy, TerminalFeedHandle, TerminalFeedSnapshot, TerminalOutput, TerminalReplay } from './feed';

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
  /** How many times `leave` was called, and `redraw`. */
  readonly left: () => number;
  readonly redraws: () => number;
  /** The reader took the replay. */
  readonly replayTaken: () => boolean;
};

export type FakeTerminalFeedOptions = {
  readonly state?: TerminalFeedSnapshot['state'] | undefined;
  /** What `close` does; default: nothing. */
  readonly close?: (() => Promise<void> | void) | undefined;
  /** What the feed answers when it is asked what runs in it; default: the feed cannot tell (it has no such member). */
  readonly busy?: (() => Promise<TerminalBusy>) | undefined;
  /** A replay the feed holds for its reader, as a reattached feed does: `takeReplay` gives it once, and `read` gives nothing until it is taken. Default: none (the feed has no `takeReplay`). */
  readonly replay?: TerminalReplay | undefined;
  /** The feed has a `leave` (it started a terminal with a key, which outlives its page), counted by `left`. Default: it has none. */
  readonly leave?: boolean | undefined;
  /** The feed has a `redraw`, counted by `redraws`. Default: it has none. */
  readonly redraw?: boolean | undefined;
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
  let replayTaken = false;
  let left = 0;
  let redraws = 0;

  const tell = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  /** The reader takes the replay once: the second call finds none. */
  const takeReplay = (): TerminalReplay | undefined => {
    if (replayTaken) {
      return undefined;
    }

    replayTaken = true;
    return options.replay;
  };

  const leave = () => {
    left += 1;
  };

  const redraw = () => {
    redraws += 1;
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
      // A feed that holds a replay gives no live output before the reader has taken it (T2-go 2.4: the replay is written first, with the emulator's replies muted).
      if (options.replay !== undefined && !replayTaken) {
        return { chunks: [], bytes: 0 };
      }

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
    ...(options.replay === undefined ? {} : { takeReplay }),
    ...(options.leave === true ? { leave } : {}),
    ...(options.redraw === true ? { redraw } : {}),
    left: () => left,
    redraws: () => redraws,
    replayTaken: () => replayTaken,
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
  /** The size the emulator had when each write came, in the order of `writes`: a replay is written at the size its bytes were written under. */
  readonly writeSizes: ReadonlyArray<readonly [number, number]>;
  /** How many full resets (`ESC c`) were written as text: a replay starts from a fresh emulator, in band, in order with the bytes. */
  readonly resets: () => number;
  /** Everything the emulator sent to its listeners, in order: what the user typed and what it answered to a query it parsed, whether or not anything kept it. */
  readonly emitted: readonly string[];
};

export type FakeEngineOptions = {
  /** Parse every write at once (the default), or hold the callbacks until `complete`. */
  readonly auto?: boolean | undefined;
  /** What `setRenderer` waits for before it answers (default: nothing): a test holds it to see what the screen does in between. */
  readonly rendererReady?: Promise<void> | undefined;
  /**
   * The queries this emulator answers when it parses them, as a real one does: the query it finds in what it was written (as text) and the reply it sends to its listeners, once for each query found, when it PARSES
   * the write, just before the write's callback. Default: it answers nothing. A query cut between two writes is not found.
   */
  readonly answers?: ReadonlyArray<readonly [query: string, reply: string]> | undefined;
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
  const writeSizes: Array<readonly [number, number]> = [];
  const emitted: string[] = [];
  const answers = config.answers ?? [];
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

  const emit = (data: string) => {
    emitted.push(data);
    for (const listener of [...dataListeners]) {
      listener(data);
    }
  };

  const answer = (data: Uint8Array | string) => {
    if (answers.length === 0) {
      return;
    }

    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    for (const [query, reply] of answers) {
      for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) {
        emit(reply);
      }
    }
  };

  return {
    options,
    writes,
    writeSizes,
    emitted,
    resets: () => writes.reduce((sum, data) => sum + (typeof data === 'string' ? data.split('\u001bc').length - 1 : 0), 0),
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
      writeSizes.push([size.cols, size.rows]);
      // What a real emulator answers to a query it parses goes out as it parses the bytes, just before it says it has: a reply is the emulator's own output, in the middle of the stream.
      const parsed = () => {
        answer(data);
        done?.();
      };

      if (auto) {
        parsed();
      } else {
        waiting.push(done === undefined && answers.length === 0 ? undefined : parsed);
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
      emit(data);
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
// the first on only the client's acknowledgements credit. The bytes the shell writes are a counting sequence (0, 1, ... 250, 0, ...), so a test can tell that every byte arrived, once, in order; `say` writes the
// exact bytes a test gives. What the page types and the sizes it sends are recorded with their call numbers (`inputs`): the host puts them in order by the number, whatever order they reach it in, and nothing here
// changes their order.
//
// A terminal started with a page key is the host of docs/ui-next/status/T2-go.md (backend/pkg/terminal/reattach.go): its output comes as `{offset, data}` events and is kept in a ring of whole reads, so that a
// page that comes back is answered with a replay and the live output continues at its end; a window that goes away, or a page that leaves, DETACHES it (the reader is held, a lease runs: `expire` ends it); an attach
// takes it over for a new window, with the next attachment number, and tells the window that held it (`DETACHED`); a shell that ends by itself leaves its end and its output for a page that comes back (a
// tombstone), until `CloseSession` dismisses it. Every event goes to every window, as on the real host. A window is a `HostPage`: its events can be held (`hold`) and released, to put an event of the host on the far
// side of the answer of a call, as the field showed (7 in 2,051 reattaches: an event the replay holds reaches the page after the answer). The host's input queue counts the numbered calls and refuses a number it has
// passed (`SEQUENCE_STALE`), so a page that numbers from 1 after a reattach is seen; the answers to an attach and to a list state the number the queue takes next (`next_input_seq`, host #675: at least 1 while the terminal
// runs, 0 once it ended), the list's as of the list and the attach's as of the attach, since the window that holds the terminal can write between the two.

/** An input call the page made, with the number it carried: a write as the text the host's pty would read, a size as the binding takes it (rows, then columns). */
export type HostInput =
  | { readonly kind: 'write'; readonly seq: number; readonly text: string }
  | { readonly kind: 'resize'; readonly seq: number; readonly rows: number; readonly cols: number };

/** A call about the life of a terminal that a window made, in the order they reached the host. `page` is the index of the window (0 is the one the host starts with). */
export type HostCall =
  | { readonly kind: 'create'; readonly page: number; readonly pageKey: string | undefined }
  | { readonly kind: 'list'; readonly page: number; readonly pageKey: string }
  | { readonly kind: 'attach'; readonly page: number; readonly pageKey: string }
  | { readonly kind: 'detach'; readonly page: number; readonly pageKey: string }
  | { readonly kind: 'close'; readonly page: number };

/** The modes of a terminal as the host states them on the wire (`terminal.TerminalModes`). */
export type HostModes = {
  readonly known: boolean;
  readonly alt_screen: boolean;
  readonly bracketed_paste: boolean;
  readonly application_cursor: boolean;
  readonly focus_events: boolean;
  readonly cursor_hidden: boolean;
  readonly mouse_tracking: number;
  readonly mouse_encoding: number;
  readonly kitty_keyboard: readonly number[];
};

/** A window of the host: its own calls and its own events (every event goes to every window). */
export type HostPage = {
  readonly transport: ExecTransport;
  /** The events for this window wait, in order, until `release`: an event and the answer of a call travel apart, so an event the host handed over before it answered can reach the page after the answer. */
  readonly hold: () => void;
  /** Delivers what waited, in order, and delivers what comes from now on at once. */
  readonly release: () => void;
  /** The window goes away: it hears nothing more, and the host lets go of what it held (a terminal with a key is detached, `window-retired`; one without ends). */
  readonly die: () => void;
  /** How many events wait in this window's wire. */
  readonly queued: () => number;
};

export type CreditHost = {
  /** The window the host starts with (`home`, whose calls `transport` makes), and `page`, which opens another. */
  readonly transport: ExecTransport;
  readonly home: HostPage;
  readonly page: () => HostPage;
  /** The shell writes this many more bytes. What the host may read now it delivers (reads of at most 20,480 bytes); the rest waits in the pty. */
  readonly produce: (bytes: number) => void;
  /** The shell writes exactly this text (as UTF-8), after what it was already to write. */
  readonly say: (text: string) => void;
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
  /** The shell exits by itself, once the host has read all it wrote. A terminal with a key is kept, with its end and its output, until a page closes it. */
  readonly exit: (code?: number) => void;
  /** The lease of a detached terminal runs out: the host ends it (`closed_by: 'detach-timeout'`). */
  readonly expire: () => void;
  /** The modes in force at the end of the output, and, when given, the modes under which the oldest byte the host kept was written. */
  readonly modes: (now: Partial<HostModes>, atStart?: Partial<HostModes>) => void;
  /** Who holds the terminal: the number of the attachment, whether it is detached, and the window that owns it. */
  readonly holder: () => { readonly attachment: number; readonly detached: boolean; readonly owner: number | undefined };
  /** The offsets the host keeps of a terminal with a key: [start, end). */
  readonly kept: () => { readonly start: number; readonly end: number };
  /** Every call about the life of the terminal that reached the host, in order. */
  readonly calls: () => readonly HostCall[];
  /** The number the host's input queue expects next. */
  readonly nextInput: () => number;
};

export type CreditHostOptions = {
  readonly high?: number;
  readonly low?: number;
  /** The size of one pty read. */
  readonly read?: number;
  /** Bytes the host keeps of a terminal with a key, in whole reads, for a replay. Default: 1,310,720, as the host. */
  readonly ring?: number;
  /** The close of a terminal whose shell ended by itself dismisses it, as the host's contract says. Default: no, as the real host (it answers not-found and the terminal stays listed until its lease runs out). */
  readonly dismissEnded?: boolean;
};

function base64Of(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 4_096) {
    text += String.fromCharCode(...bytes.subarray(at, at + 4_096));
  }

  return btoa(text);
}

const noModes = (): HostModes => ({ known: true, alt_screen: false, bracketed_paste: false, application_cursor: false, focus_events: false, cursor_hidden: false, mouse_tracking: 0, mouse_encoding: 0, kitty_keyboard: [] });

/** What the shell has yet to write: a count of the sequence, or the bytes of a text. */
type Segment = { readonly kind: 'count'; left: number } | { readonly kind: 'bytes'; readonly data: Uint8Array; at: number };

/** One window's events: what listens, and what waits while the wire is held. */
type Wire = {
  readonly listeners: Map<string, Set<(data: unknown) => void>>;
  readonly queue: Array<readonly [string, unknown]>;
  holding: boolean;
  dead: boolean;
};

/** One read of the pty that the host kept for a replay. */
type Kept = { readonly offset: number; readonly bytes: Uint8Array };

/** What the host says of a terminal that is not there, or that a key does not open: the same words for both. */
const notThere = (id: string): Error => Object.assign(new Error(`Session ${id} not found`), { gone: true });

export function fakeCreditHost(options: CreditHostOptions = {}): CreditHost {
  const high = options.high ?? 1_048_576;
  const low = options.low ?? 262_144;
  const readSize = options.read ?? 20_480;
  const ringLimit = options.ring ?? 1_310_720;
  const dismissEnded = options.dismissEnded ?? false;
  const wires: Wire[] = [];
  const acks: number[] = [];
  const inputs: HostInput[] = [];
  const calls: HostCall[] = [];
  const segments: Segment[] = [];
  let ring: Kept[] = [];
  let ringBytes = 0;
  let session: string | undefined;
  let key: string | undefined;
  let owner: number | undefined;
  let attachment = 0;
  let detached = false;
  let ended: Record<string, unknown> | undefined;
  let size = { cols: 80, rows: 24 };
  let startSize = size;
  let modesNow = noModes();
  let modesStart = noModes();
  let nextInput = 1;
  let queued = 0;
  let delivered = 0;
  let unacked = 0;
  let most = 0;
  let explicit = false;
  let paused = false;
  let pumping = false;

  const byteAt = (offset: number): number => offset % 251;

  const deliverTo = (wire: Wire, name: string, data: unknown) => {
    for (const listener of [...(wire.listeners.get(name) ?? [])]) {
      listener(data);
    }
  };

  /** Every event goes to every window, as it does on the real host; a window whose wire is held keeps it for later. */
  const emit = (name: string, data: unknown) => {
    for (const wire of wires) {
      if (wire.dead) {
        continue;
      }

      if (wire.holding) {
        wire.queue.push([name, data]);
      } else {
        deliverTo(wire, name, data);
      }
    }
  };

  /** The next `count` bytes of what the shell wrote, in order: the bytes of a count are a function of their offset. */
  const take = (count: number): Uint8Array => {
    const chunk = new Uint8Array(count);
    let filled = 0;
    while (filled < count) {
      const head = segments[0];
      if (head === undefined) {
        break;
      }

      if (head.kind === 'count') {
        const piece = Math.min(count - filled, head.left);
        for (let index = 0; index < piece; index += 1) {
          chunk[filled + index] = byteAt(delivered + filled + index);
        }

        head.left -= piece;
        filled += piece;
        if (head.left === 0) {
          segments.shift();
        }
      } else {
        const piece = Math.min(count - filled, head.data.length - head.at);
        chunk.set(head.data.subarray(head.at, head.at + piece), filled);
        head.at += piece;
        filled += piece;
        if (head.at === head.data.length) {
          segments.shift();
        }
      }
    }

    return chunk;
  };

  /** The host reads the pty: nothing while it is paused for credit, nothing while a terminal with a key is detached (its reader is held), nothing once the shell has ended. */
  const readable = (): boolean => queued > 0 && !paused && session !== undefined && ended === undefined && !(key !== undefined && detached);

  const pump = () => {
    // An acknowledgement that comes while the host is delivering (the page parses in the listener) is credited by the loop that is running.
    if (pumping) {
      return;
    }

    pumping = true;
    while (readable()) {
      const count = Math.min(readSize, queued);
      const offset = delivered;
      const chunk = take(count);
      queued -= count;
      unacked += count;
      most = Math.max(most, unacked);
      delivered += count;
      if (key === undefined) {
        emit(`core/exec/stream/stdout/${String(session)}`, base64Of(chunk));
      } else {
        ring.push({ offset, bytes: chunk });
        ringBytes += count;
        while (ringBytes > ringLimit && ring.length > 1) {
          ringBytes -= ring.shift()?.bytes.length ?? 0;
        }

        emit(`core/exec/stream/output/${String(session)}`, { offset, data: base64Of(chunk) });
      }

      // Until the client takes over the credit, the transport's is what counts, and the page took the event.
      if (!explicit) {
        unacked = Math.max(0, unacked - count);
      }

      if (unacked >= high) {
        paused = true;
      }
    }

    pumping = false;
  };

  /** The terminal is over: every window hears it end. One that has a key and whose shell ended by itself is kept, with its output, for a page that comes back; any other end leaves nothing. */
  const finish = (end: Record<string, unknown>) => {
    emit(`core/exec/signal/CLOSE/${String(session)}`, end);
    if (key !== undefined && end.reason !== 'closed') {
      ended = end;
      return;
    }

    session = undefined;
    ring = [];
    ringBytes = 0;
    segments.length = 0;
    queued = 0;
  };

  const sessionInfo = (id: string): Record<string, unknown> => ({ id, pid: 4242, shell: { path: '/bin/sh', name: 'sh' }, cwd: '/home/u', cols: 80, rows: 24, lease_ms: key === undefined ? 0 : 300_000 });

  /** What a page needs of the terminal as it is now: the bytes the host kept and the sizes and modes they were written under, and where the live output continues. */
  const replayNow = (): Record<string, unknown> => {
    const data = new Uint8Array(ringBytes);
    let at = 0;
    for (const kept of ring) {
      data.set(kept.bytes, at);
      at += kept.bytes.length;
    }

    return { start: ring[0]?.offset ?? delivered, end: delivered, data: base64Of(data), start_size: { ...startSize }, start_modes: { ...modesStart }, size: { ...size }, modes: { ...modesNow } };
  };

  /** The input queue: a numbered call is refused when the number was passed, as the host refuses a number it applied or gave up. Number 0 is no number: arrival order. */
  const admit = (seq: number) => {
    if (seq > 0) {
      if (seq < nextInput) {
        throw Object.assign(new Error(`Sequence number ${String(seq)} was already applied or given up; the next expected is ${String(nextInput)}.`), { code: 'SEQUENCE_STALE' });
      }

      nextInput = seq + 1;
    }
  };

  const open = (index: number): HostPage => {
    const wire: Wire = { listeners: new Map(), queue: [], holding: false, dead: false };
    wires.push(wire);
    const transport: ExecTransport = {
      create: async (id, area, launch) => {
        calls.push({ kind: 'create', page: index, pageKey: launch?.pageKey });
        session = id;
        key = launch?.pageKey;
        owner = index;
        attachment = 0;
        detached = false;
        ended = undefined;
        size = { cols: area.cols, rows: area.rows };
        startSize = size;
        nextInput = 1;
        pump();
        return Promise.resolve(sessionInfo(id));
      },
      list: async (pageKey) => {
        calls.push({ kind: 'list', page: index, pageKey });
        if (session === undefined || key === undefined || key !== pageKey) {
          return Promise.resolve([]);
        }

        return Promise.resolve([
          {
            id: session,
            created_at: '2026-11-23T10:00:00Z',
            pid: 4242,
            shell: { path: '/bin/sh', name: 'sh' },
            labels: {},
            params: {},
            size: { ...size },
            attached: !detached,
            next_offset: delivered,
            replay_start: ring[0]?.offset ?? delivered,
            // As of the list: the window that holds the terminal can write before the attach, and the answer to the attach states the number to continue from.
            next_input_seq: ended === undefined ? nextInput : 0,
            lease_expires_unix_ms: detached ? 1 : 0,
            ...(ended === undefined ? {} : { ended }),
          },
        ]);
      },
      attach: async (id, request) => {
        calls.push({ kind: 'attach', page: index, pageKey: request.pageKey });
        if (request.fromOffset !== undefined) {
          throw new Error('this host does not model from_offset: a fresh emulator asks for none');
        }

        if (session !== id || key === undefined || key !== request.pageKey) {
          throw notThere(id);
        }

        if (ended === undefined) {
          // The page that held the terminal is told, with the number of the attachment that ended; the new page holds the next one. A terminal nobody held tells nobody.
          if (!detached && owner !== undefined && owner !== index) {
            emit(`core/exec/signal/DETACHED/${id}`, { by: 'taken-over', attachment });
          }

          attachment += 1;
          owner = index;
          detached = false;
          // The attach forgets what was owed for everything below the end of the replay, and lets the reader go.
          unacked = 0;
          paused = false;
        }

        const answer: Record<string, unknown> = {
          session: sessionInfo(id),
          replay: replayNow(),
          cwd: { path: '/home/u' },
          busy: { state: 'idle' },
          attachment,
          ...(ended === undefined ? {} : { ended }),
          // The number the input queue takes next as of this attach: at least 1 while the terminal runs, 0 for one that ended (it takes no input).
          next_input_seq: ended === undefined ? nextInput : 0,
        };
        pump();
        return Promise.resolve(answer);
      },
      detach: async (id, request) => {
        calls.push({ kind: 'detach', page: index, pageKey: request.pageKey });
        // The window that owns the terminal detaches it; the key detaches only a terminal that no window owns: a page that was displaced cannot detach what the page that took it shows.
        if (session !== id || key === undefined || key !== request.pageKey || (owner !== undefined && owner !== index)) {
          throw notThere(id);
        }

        if (!detached && ended === undefined) {
          detached = true;
          owner = undefined;
          emit(`core/exec/signal/DETACHED/${id}`, { by: 'requested', attachment });
        }

        return Promise.resolve({ lease_ms: 300_000, lease_expires_unix_ms: 1 });
      },
      write: async (_id, seq, base64) => {
        admit(seq);
        inputs.push({ kind: 'write', seq, text: new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))) });
        return Promise.resolve();
      },
      resize: async (_id, seq, rows, cols) => {
        admit(seq);
        inputs.push({ kind: 'resize', seq, rows, cols });
        size = { cols, rows };
        return Promise.resolve();
      },
      close: async (id) => {
        calls.push({ kind: 'close', page: index });
        // A terminal with no key has no history here: it is closed as it always was, with nothing to say.
        if (key === undefined) {
          return Promise.resolve();
        }

        if (session !== id) {
          throw notThere(id);
        }

        if (ended !== undefined) {
          // The host's own contract dismisses what a shell that ended by itself left. The real host does not (S1): the close of an ended terminal answers not-found, and the terminal stays listed until its lease runs out.
          if (!dismissEnded) {
            throw notThere(id);
          }

          session = undefined;
          ended = undefined;
          ring = [];
          ringBytes = 0;
        } else {
          finish({ reason: 'closed', closed_by: 'request', last_offset: delivered });
        }

        return Promise.resolve();
      },
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
        const set = wire.listeners.get(name) ?? new Set();
        set.add(listener);
        wire.listeners.set(name, set);
        return () => {
          set.delete(listener);
        };
      },
      describe: (error) => (error instanceof Error ? error.message : String(error)),
      isGone: (error) => typeof error === 'object' && error !== null && Reflect.get(error, 'gone') === true,
      codeOf: (error) => (typeof error === 'object' && error !== null && typeof Reflect.get(error, 'code') === 'string' ? String(Reflect.get(error, 'code')) : undefined),
      triedOf: () => undefined,
    };

    return {
      transport,
      hold: () => {
        wire.holding = true;
      },
      release: () => {
        wire.holding = false;
        for (const [name, data] of wire.queue.splice(0)) {
          if (!wire.dead) {
            deliverTo(wire, name, data);
          }
        }
      },
      die: () => {
        wire.dead = true;
        wire.queue.length = 0;
        if (session === undefined || owner !== index || detached || ended !== undefined) {
          return;
        }

        if (key === undefined) {
          finish({ reason: 'closed', closed_by: 'window', last_offset: delivered });
        } else {
          detached = true;
          owner = undefined;
          emit(`core/exec/signal/DETACHED/${session}`, { by: 'window-retired', attachment });
        }
      },
      queued: () => wire.queue.length,
    };
  };

  const first = open(0);

  return {
    transport: first.transport,
    home: first,
    page: () => open(wires.length),
    produce: (bytes) => {
      segments.push({ kind: 'count', left: bytes });
      queued += bytes;
      pump();
    },
    say: (text) => {
      const data = new TextEncoder().encode(text);
      segments.push({ kind: 'bytes', data, at: 0 });
      queued += data.length;
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
    exit: (code = 0) => {
      if (session === undefined || ended !== undefined) {
        throw new Error('no shell runs in this host');
      }

      if (queued > 0) {
        throw new Error('the shell exits when the host has read what it wrote: it has not');
      }

      finish({ reason: 'exited', exit_code: code, last_offset: delivered });
    },
    expire: () => {
      if (session === undefined || !detached || ended !== undefined) {
        throw new Error('no lease runs: the terminal is not detached');
      }

      finish({ reason: 'closed', closed_by: 'detach-timeout', last_offset: delivered });
    },
    modes: (now, atStart) => {
      modesNow = { ...modesNow, ...now };
      if (atStart !== undefined) {
        modesStart = { ...modesStart, ...atStart };
      }
    },
    holder: () => ({ attachment, detached, owner }),
    kept: () => ({ start: ring[0]?.offset ?? delivered, end: delivered }),
    calls: () => calls,
    nextInput: () => nextInput,
  };
}

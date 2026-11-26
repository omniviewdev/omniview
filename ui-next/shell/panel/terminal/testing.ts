import type { Engine, EngineAppearance, EngineLoader, EngineOptions, EngineRenderer, FindOptions, FindState, Finder, LinkHandler, LinkHover } from './engine';
import type { ChannelEvents, ChannelLink, TerminalChannels } from './channel';
import type { TerminalBusy, TerminalDirectory, TerminalFeedHandle, TerminalFeedSnapshot, TerminalOutput, TerminalReplay, TerminalRestart, TerminalShellAttempt } from './feed';

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
  /** What was written as the emulator's own reply to a query (`{ reply: true }`), as opposed to what the person typed. */
  readonly replies: () => readonly string[];
  /** The raw bytes of `writeBinary`, in the order they were given. */
  readonly binaries: () => readonly Uint8Array[];
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
  /** A replay arrives now, as when the host's ring no longer reaches back to what the screen has (a gap, a reconnect that lost bytes): the next `takeReplay` gives it once, `read` gives nothing until it is taken, the output held and unread is dropped (it is older), and the listeners are told. Throws, before anything changes, on a feed that has no `takeReplay` (made with neither `takeReplay` nor `replay`). */
  readonly offerReplay: (replay: TerminalReplay) => void;
  /** The reader took the replay that was offered last (or the one the feed was made with). */
  readonly replayTaken: () => boolean;
};

export type FakeTerminalFeedOptions = {
  readonly state?: TerminalFeedSnapshot['state'] | undefined;
  /** What `close` does; default: nothing. */
  readonly close?: (() => Promise<void> | void) | undefined;
  /** What the feed answers when it is asked what runs in it; default: the feed cannot tell (it has no such member). */
  readonly busy?: (() => Promise<TerminalBusy>) | undefined;
  /** What the feed answers when it is asked where a new terminal opened from it starts; default: the feed cannot tell (it has no such member). */
  readonly directory?: (() => Promise<TerminalDirectory>) | undefined;
  /** What the feed says a restart of it is made from (`restart`); default: the feed says nothing (it has no such member). A function is asked every time, as the real feed's is. */
  readonly restart?: TerminalRestart | (() => TerminalRestart | undefined) | undefined;
  /** A replay the feed holds for its reader, as a reattached feed does: `takeReplay` gives it once, and `read` gives nothing until it is taken. Default: none (the feed has no `takeReplay`, unless `takeReplay` says it has). */
  readonly replay?: TerminalReplay | undefined;
  /** The feed has a `leave`, counted by `left`. Default: it has none. */
  readonly leave?: boolean | undefined;
  /** The feed has a `redraw`, counted by `redraws`. Default: it has none. */
  readonly redraw?: boolean | undefined;
  /** The feed has a `takeReplay` that can be given a replay at any time (`offerReplay`), as a feed of the channel has. Default: it has none. */
  readonly takeReplay?: boolean | undefined;
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
  const replies: string[] = [];
  const binaries: Uint8Array[] = [];
  /** The calls of the typing that the feed took: what `inputs` says. */
  let taken = 0;
  const sizes: Array<readonly [number, number]> = [];
  /** The replay the reader has not taken: the one the feed was made with, or one offered since. */
  let waiting = options.replay;
  let offered = options.replay === undefined ? 0 : 1;
  let left = 0;
  let redraws = 0;

  const tell = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  /** The reader takes the replay that waits, once: the second call finds none. */
  const takeReplay = (): TerminalReplay | undefined => {
    const replay = waiting;
    waiting = undefined;
    return replay;
  };

  const offerReplay = (replay: TerminalReplay) => {
    // A feed with no `takeReplay` has nobody to give the replay to: offering one is a mistake of the test, and it is made before anything changes.
    if (options.replay === undefined && options.takeReplay !== true) {
      throw new Error('this fake feed has no `takeReplay`: make it with `takeReplay: true` or a `replay` before offering it one');
    }

    waiting = replay;
    offered += 1;
    // What the feed held and nobody read is older than the replay and would be written after it: it is dropped, as a real feed drops it.
    held = [];
    // A replay is something the reader must come for, whether or not a wake-up is pending: it is told at once.
    woken = true;
    tell();
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
      if (waiting !== undefined) {
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
    write: (text, writeOptions) => {
      typed.push(text);
      if (writeOptions?.reply === true) {
        replies.push(text);
      }

      // A real feed takes what is typed while the process starts or runs, and not a call with nothing in it, nor anything once it was closed or the session is over.
      if (text !== '' && closed === 0 && (status.state === 'starting' || status.state === 'running')) {
        taken += 1;
      }
    },
    writeBinary: (bytes) => {
      binaries.push(bytes);
      if (bytes.length > 0 && closed === 0 && (status.state === 'starting' || status.state === 'running')) {
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
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    ...(options.restart === undefined ? {} : { restart: typeof options.restart === 'function' ? options.restart : () => options.restart as TerminalRestart }),
    ...(options.replay === undefined && options.takeReplay !== true ? {} : { takeReplay }),
    ...(options.leave === true ? { leave } : {}),
    ...(options.redraw === true ? { redraw } : {}),
    left: () => left,
    redraws: () => redraws,
    offerReplay,
    replayTaken: () => offered > 0 && waiting === undefined,
    listeners: () => subscribed,
    closed: () => closed,
    reads: () => reads,
    typed: () => typed,
    replies: () => replies,
    binaries: () => binaries,
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
  /** The bytes of the writes the emulator has PARSED (their done callback ran), as against `writes`, which holds what it was handed. */
  readonly parsedBytes: () => number;
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
  /** What the user typed (or pasted): it reaches the listeners as the person's (`user`). */
  readonly type: (data: string) => void;
  /** Raw bytes the emulator sends for the person (a legacy mouse report): they reach the `onBinary` listeners. */
  readonly binary: (bytes: Uint8Array) => void;
  /** What the emulator says by itself, with no one typing (a focus report, an answer it was not asked for by a query it parsed): it reaches the listeners as the emulator's own, not the person's. */
  readonly say: (data: string) => void;
  /** Selects text (or clears the selection with `''`) and tells the listeners. */
  readonly select: (text: string) => void;
  /** The program rang the bell: tells the listeners. */
  readonly ring: () => void;
  /** Runs the key handler on an event (a keydown unless `type` says another), as the emulator does, and says what it answered. */
  readonly key: (init: Partial<Pick<KeyboardEvent, 'type' | 'key' | 'code' | 'keyCode' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>>) => { readonly handled: boolean; readonly defaultPrevented: boolean };
  /** How many key events the handler stopped from propagating (`stopPropagation`): what the window's own key handlers then do not see. */
  readonly keysStopped: () => number;
  /** What the host measures now (`undefined`: no size). */
  readonly measured: (size: { readonly cols: number; readonly rows: number } | undefined) => void;
  readonly listeners: () => number;
  /** The size the emulator had when each write came, in the order of `writes`: a replay is written at the size its bytes were written under. */
  readonly writeSizes: ReadonlyArray<readonly [number, number]>;
  /** How many full resets (`ESC c`) were written as text: a replay starts from a fresh emulator, in band, in order with the bytes. */
  readonly resets: () => number;
  /** Everything the emulator sent to its listeners, in order: what the user typed and what it answered to a query it parsed, whether or not anything kept it. */
  readonly emitted: readonly string[];
  /** Every step of the finder (`next` and `previous`), in order. */
  readonly finds: ReadonlyArray<{ readonly direction: 'next' | 'previous'; readonly query: string; readonly options: FindOptions }>;
  /** How many times the finder was cleared. */
  readonly findClears: () => number;
  /** How many times the emulator was asked for its finder (`find`). */
  readonly findAsks: () => number;
  /** The find stands here now: tells the listeners of the finder, as the emulator does after a step and when the output changes under it. */
  readonly found: (state: FindState) => void;
  /** How many listeners the finder has now. */
  readonly findListeners: () => number;
  /** The program has the mouse (mouse reporting is on), or lets go of it: what `mouseReporting` answers. */
  readonly mouseReports: (on: boolean) => void;
  /** The text `paste` was given, in order. */
  readonly pastes: readonly string[];
  /** The attributes the input has now: what the last `decorateInput` set. */
  readonly inputAttributes: () => Readonly<Record<string, string>>;
  /** The handler the screen gave the links (`undefined`: it asked for none). */
  readonly links: () => LinkHandler | undefined;
  /** The pointer is on a link, or leaves it (`undefined`): tells the handler, as the emulator does. */
  readonly linkHover: (hover: LinkHover | undefined) => void;
  /** A link is clicked: tells the handler, as the emulator does, with the event as it came. */
  readonly linkActivate: (uri: string, event: MouseEvent) => void;
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
  let parsedBytes = 0;
  const answers = config.answers ?? [];
  const dataListeners = new Set<(data: string, user: boolean) => void>();
  const selectionListeners = new Set<() => void>();
  const bellListeners = new Set<() => void>();
  const binaryListeners = new Set<(bytes: Uint8Array) => void>();
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
  let keysStopped = 0;
  const finds: Array<{ readonly direction: 'next' | 'previous'; readonly query: string; readonly options: FindOptions }> = [];
  const findListeners = new Set<(state: FindState) => void>();
  const pastes: string[] = [];
  let findClears = 0;
  let findAsks = 0;
  let mouse = false;
  let attributes: Readonly<Record<string, string>> = {};
  let linkHandler: LinkHandler | undefined;
  const finder: Finder = {
    next: (query, findOptions) => {
      finds.push({ direction: 'next', query, options: findOptions });
    },
    previous: (query, findOptions) => {
      finds.push({ direction: 'previous', query, options: findOptions });
    },
    clear: () => {
      findClears += 1;
    },
    onChange: (listener) => {
      findListeners.add(listener);
      return () => {
        findListeners.delete(listener);
      };
    },
  };

  const emit = (data: string, user: boolean) => {
    emitted.push(data);
    for (const listener of [...dataListeners]) {
      listener(data, user);
    }
  };

  const answer = (data: Uint8Array | string) => {
    if (answers.length === 0) {
      return;
    }

    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    for (const [query, reply] of answers) {
      for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) {
        emit(reply, false);
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
    parsedBytes: () => parsedBytes,
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
        parsedBytes += typeof data === 'string' ? 0 : data.length;
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
    onBinary: (listener) => {
      binaryListeners.add(listener);
      return () => {
        binaryListeners.delete(listener);
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
      emit(data, true);
    },
    binary: (bytes) => {
      for (const listener of [...binaryListeners]) {
        listener(bytes);
      }
    },
    say: (data) => {
      emit(data, false);
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
      }, stopPropagation: () => {
        keysStopped += 1;
      } } as unknown as KeyboardEvent;
      return { handled: keys?.(event) ?? true, defaultPrevented };
    },
    keysStopped: () => keysStopped,
    measured: (next) => {
      measured = next;
    },
    listeners: () => dataListeners.size + binaryListeners.size + selectionListeners.size + bellListeners.size,
    find: async () => {
      findAsks += 1;
      return Promise.resolve(finder);
    },
    mouseReporting: () => mouse,
    paste: (text) => {
      pastes.push(text);
    },
    decorateInput: (next) => {
      attributes = { ...next };
    },
    setLinks: (handler) => {
      linkHandler = handler;
    },
    finds,
    findClears: () => findClears,
    findAsks: () => findAsks,
    found: (state) => {
      for (const listener of [...findListeners]) {
        listener(state);
      }
    },
    findListeners: () => findListeners.size,
    mouseReports: (on) => {
      mouse = on;
    },
    pastes,
    inputAttributes: () => attributes,
    links: () => linkHandler,
    linkHover: (hover) => {
      linkHandler?.hover(hover);
    },
    linkActivate: (uri, event) => {
      linkHandler?.activate(uri, event);
    },
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

// ---- the terminal channel, for the tests of the feed and of the whole data path ----------------------------------------------------------------------------------------------------------------------------
//
// `TerminalChannels` (channel.ts) as the tests drive it: the test is the host. Every stream the feed opens is a `FakeStream` the test speaks on frame by frame (`ready`, `output`, `gap`, `applied`, `ended`, `takenOver`,
// `released`, `notFound`, `unsupported`, `drop`), and what the feed sent on it is recorded as frames (`sent`), in the order it sent them. The contract of channel.ts is kept as the real one keeps it: a stream is over after one of the
// five ends (`ended`, `released`, `notFound`, `unsupported`, `closed`) or after the feed closed it, and the host's frames after that, like the feed's, are mistakes of the test (the host's throw, the feed's are dropped and counted). `takenOver` is not an end: the
// stream stays open as a watcher, and the host's only frames on it are `released` or `ended` (protocol, section 8). The calls that answer (`create`, `close`, `dismiss`,
// `busy`, `list`, `listed`) are answered by what the test gives, and may be answered by a promise the test holds. Nothing here is a host: no ring, no credit, no timers.

/** What the feed sent on a stream, in order. `input` carries the bytes as text, as the shell would read them. */
export type SentFrame =
  | { readonly kind: 'input'; readonly bytes: Uint8Array; readonly text: string }
  | { readonly kind: 'resize'; readonly cols: number; readonly rows: number }
  | { readonly kind: 'ack'; readonly bytes: number }
  | { readonly kind: 'close' }
  | { readonly kind: 'detach' };

/** What the test says in a `ready`: what it leaves out is a terminal at the start of its output, 80 by 24, with nothing switched on. */
export type ReadyInit = {
  readonly start?: number;
  readonly end?: number;
  readonly lost?: number;
  readonly size?: { readonly cols: number; readonly rows: number };
  readonly startSize?: { readonly cols: number; readonly rows: number };
  /** The modes in force at `end`, in the host's words (`alt_screen`, ...). */
  readonly modes?: Readonly<Record<string, unknown>>;
  readonly startModes?: Readonly<Record<string, unknown>>;
  readonly shell?: string;
  /** The absolute path of the shell the host says started (`ready.session.shell.path`). Default: `/bin/<shell>`. */
  readonly shellPath?: string;
  /** The directory the host says the shell started in (`ready.session.cwd`). Default: `/home/u`. */
  readonly startedIn?: string;
  readonly ended?: unknown;
  /** The bytes of input the host has applied from the capability, across streams (`ready.input_applied`). Default: 0. */
  readonly inputApplied?: number;
  /** Whether the host had a count for this feed's writer before this attach (`ready.writer_known`). Default: true. */
  readonly writerKnown?: boolean;
  /** Whole members to put in the payload as they are, or `undefined` to leave a member out. */
  readonly raw?: Readonly<Record<string, unknown>>;
};

export type FakeStream = {
  /** The terminal this stream is for, and the offset the feed asked from (`undefined`: the feed had nothing). */
  readonly id: string;
  readonly fromOffset: number | undefined;
  /** The writer id the feed said in its attach (`undefined`: it said none). */
  readonly writer: string | undefined;
  /** The first frame of the host. */
  readonly ready: (init?: ReadyInit) => void;
  /** Output from `offset`, as the bytes or the text as UTF-8. */
  readonly output: (offset: number, data: string | Uint8Array) => void;
  readonly gap: (from: number, to: number) => void;
  /** `marks`: the marks of one frame, in the host's wire words (`kind`, `at`, `end`, `id`, `trust`, `command`, `cwd`, `exit`, `duration_ms`, `time_ms`, `redraw`). */
  readonly marks: (...marks: ReadonlyArray<Readonly<Record<string, unknown>>>) => void;
  /** `marks` with whatever the test makes of the frame: a host that breaks the protocol, past the fake's own envelope. */
  readonly rawMarks: (frame: unknown) => void;
  /** `title`: the title a program set and the host's word that a program runs (`title`, `program` of the frame, section 4b). */
  readonly title: (title: string, program: boolean) => void;
  /** `title` with whatever the test makes of the frame: a host that breaks the protocol. */
  readonly rawTitle: (frame: unknown) => void;
  /** `applied`: the bytes of input the host has applied from the capability, across streams, so far. */
  readonly applied: (total: number) => void;
  /** How the terminal ended: `terminal.End` as the host sends it. Default: the shell exited with code 0. */
  readonly ended: (end?: unknown) => void;
  /** Another stream took the terminal: this stream stays open as a watcher, which hears `released` or `ended` and nothing else. */
  readonly takenOver: () => void;
  /** Frames the host may never send, for a test of how the feed takes a host that breaks the protocol: they reach the feed with no check of the stream's state. */
  readonly raw: { readonly released: () => void; readonly title: (title: string, program: boolean) => void };
  /** `close-refused`: the stream's close ended nothing, it does not hold the terminal. The stream goes on (as a watcher). */
  readonly closeRefused: () => void;
  /** To a watcher: the terminal is running and free. The stream is over. */
  readonly released: () => void;
  /** The host speaks another version than the attach said (`{"v": version}`). The stream is over. */
  readonly unsupported: (version?: unknown) => void;
  readonly notFound: () => void;
  /** The stream ends without a word of the host: a connection that dropped. */
  readonly drop: () => void;
  /** What the feed sent on it, in order, and how many frames it tried to send after the stream was over. */
  readonly sent: () => readonly SentFrame[];
  readonly dropped: () => number;
  /** What the feed typed, as text, in order (the `input` frames joined). */
  readonly typed: () => string;
  /** The acknowledgements, in order. */
  readonly acks: () => readonly number[];
  /** Whether the stream is still open: no end came, and the feed did not close it. */
  readonly open: () => boolean;
  /** Whether the feed closed it (`ChannelLink.close`). */
  readonly closedByFeed: () => boolean;
  /** The socket dies after this many more input frames went: the next one is refused. */
  readonly dieAfterInputs: (frames: number) => void;
  /** The socket is dead before its close event: the next frame the feed sends finds it so, the stream ends as `closed` (once) and input is refused. */
  readonly die: () => void;
  /** What `ChannelLink.pending` says: the test sets it. */
  readonly setPending: (bytes: number) => void;
};

/** A call that is not a stream, in the order the feed made them. */
export type ChannelCall =
  | {
    readonly kind: 'create';
    readonly id: string;
    readonly cols: number;
    readonly rows: number;
    readonly leaseMs: number | undefined;
    readonly command?: readonly string[];
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly params?: Readonly<Record<string, string>>;
  }
  | { readonly kind: 'close'; readonly id: string }
  | { readonly kind: 'dismiss'; readonly id: string }
  | { readonly kind: 'busy'; readonly id: string }
  | { readonly kind: 'cwd'; readonly id: string }
  | { readonly kind: 'listed'; readonly id: string }
  | { readonly kind: 'list' };

export type FakeChannelsOptions = {
  /** What `create` answers (the host's session). Default: a session of a shell called `zsh`. A function may answer with a promise the test holds. */
  readonly create?: ((id: string) => unknown) | undefined;
  readonly close?: ((id: string) => Promise<void> | void) | undefined;
  readonly dismiss?: ((id: string) => Promise<void> | void) | undefined;
  readonly busy?: ((id: string) => unknown) | undefined;
  /** What `cwd` answers (`ChannelTerminalCwd`: `{ path }` or `{ reason }`). Default: `{ path: '/home/u' }`. A function may answer with a promise the test holds, or throw. */
  readonly cwd?: ((id: string) => unknown) | undefined;
  readonly list?: (() => unknown) | undefined;
  readonly listed?: ((id: string) => unknown) | undefined;
};

export type FakeChannels = TerminalChannels & {
  /** Every stream the feed opened, oldest first. */
  readonly streams: () => readonly FakeStream[];
  /** The newest stream; throws when the feed opened none (a mistake of the test). */
  readonly stream: () => FakeStream;
  readonly calls: () => readonly ChannelCall[];
  /** The calls of one kind. */
  readonly of: <K extends ChannelCall['kind']>(kind: K) => ReadonlyArray<Extract<ChannelCall, { readonly kind: K }>>;
};

/** An error of the host that `isGone` recognises. */
export const goneError = (): Error => Object.assign(new Error('Session not found'), { gone: true });

const PLAIN_MODES = { alt_screen: false, bracketed_paste: false, application_cursor: false, focus_events: false, cursor_hidden: false, mouse_tracking: 0, mouse_encoding: 0, kitty_keyboard: [] as number[] };

export function fakeChannels(options: FakeChannelsOptions = {}): FakeChannels {
  const streams: FakeStream[] = [];
  const calls: ChannelCall[] = [];
  const text = new TextDecoder();

  const connect = (id: string, fromOffset: number | undefined, events: ChannelEvents, writer?: string): ChannelLink => {
    const sent: SentFrame[] = [];
    let open = true;
    let byFeed = false;
    let dropped = 0;
    let pending = 0;
    let dead = false;
    let inputsLeft = Number.POSITIVE_INFINITY;
    let watching = false;
    const alive = (what: string): void => {
      if (!open) {
        throw new Error(`the test spoke on a stream that is over (${what})`);
      }
    };

    /** The host's frames of a stream it took the terminal from: only `released` and `ended`. */
    const holder = (what: string): void => {
      alive(what);
      if (watching) {
        throw new Error(`the test spoke on a watcher: the host sends it only released or ended (${what})`);
      }
    };

    const send = (frame: SentFrame): boolean => {
      if (open && dead) {
        finish();
        events.closed();
        return false;
      }

      if (open) {
        sent.push(frame);
        if (frame.kind === 'input') {
          inputsLeft -= 1;
          dead ||= inputsLeft <= 0;
        }

        return true;
      }

      dropped += 1;
      return false;
    };

    const finish = (): void => {
      open = false;
    };

    streams.push({
      id,
      fromOffset,
      writer,
      ready: (init = {}) => {
        holder('ready');
        const size = init.size ?? { cols: 80, rows: 24 };
        const payload: Record<string, unknown> = {
          v: 2,
          start: init.start ?? 0,
          end: init.end ?? init.start ?? 0,
          lost: init.lost ?? 0,
          input_applied: init.inputApplied ?? 0,
          writer_known: init.writerKnown ?? true,
          size,
          start_size: init.startSize ?? size,
          modes: { ...PLAIN_MODES, ...init.modes },
          start_modes: { ...PLAIN_MODES, ...init.startModes },
          cwd: { path: '/home/u' },
          busy: { state: 'idle' },
          session: { id, pid: 4242, shell: { path: init.shellPath ?? `/bin/${init.shell ?? 'zsh'}`, name: init.shell ?? 'zsh' }, cwd: init.startedIn ?? '/home/u', cols: size.cols, rows: size.rows, lease_ms: 300_000 },
          lease_ms: 300_000,
          ended: init.ended ?? null,
          ...init.raw,
        };
        for (const [name, value] of Object.entries(payload)) {
          if (value === undefined) {
            Reflect.deleteProperty(payload, name);
          }
        }

        events.ready(payload);
      },
      output: (offset, data) => {
        holder('output');
        events.output(offset, typeof data === 'string' ? new TextEncoder().encode(data) : data);
      },
      gap: (from, to) => {
        holder('gap');
        events.gap(from, to);
      },
      ended: (end = { reason: 'exited', exit_code: 0 }) => {
        alive('ended');
        finish();
        events.ended(end);
      },
      marks: (...marks) => {
        holder('marks');
        events.marks({ v: 1, marks });
      },
      rawMarks: (frame) => {
        holder('marks');
        events.marks(frame);
      },
      title: (title, program) => {
        holder('title');
        events.title({ v: 1, title, program });
      },
      rawTitle: (frame) => {
        holder('title');
        events.title(frame);
      },
      applied: (total) => {
        holder('applied');
        events.applied(total);
      },
      takenOver: () => {
        holder('taken-over');
        watching = true;
        events.takenOver();
      },
      raw: {
        released: () => {
          events.released();
        },
        title: (title, program) => {
          events.title({ v: 1, title, program });
        },
      },
      closeRefused: () => {
        alive('close-refused');
        events.closeRefused();
      },
      released: () => {
        alive('released');
        if (!watching) {
          throw new Error('the test sent released to a stream that holds the terminal');
        }

        finish();
        events.released();
      },
      unsupported: (version = 2) => {
        holder('unsupported');
        finish();
        events.unsupported(version);
      },
      notFound: () => {
        holder('not-found');
        finish();
        events.notFound();
      },
      drop: () => {
        alive('drop');
        finish();
        events.closed();
      },
      sent: () => sent,
      dropped: () => dropped,
      typed: () => sent.reduce((all, frame) => (frame.kind === 'input' ? all + frame.text : all), ''),
      acks: () => sent.flatMap((frame) => (frame.kind === 'ack' ? [frame.bytes] : [])),
      open: () => open,
      closedByFeed: () => byFeed,
      die: () => {
        dead = true;
      },
      dieAfterInputs: (frames) => {
        inputsLeft = frames;
      },
      setPending: (bytes) => {
        pending = bytes;
      },
    });

    return {
      input: (bytes) => {
        return send({ kind: 'input', bytes: bytes.slice(), text: text.decode(bytes) });
      },
      resize: (cols, rows) => {
        send({ kind: 'resize', cols, rows });
      },
      ack: (bytes) => {
        send({ kind: 'ack', bytes });
      },
      end: () => send({ kind: 'close' }),
      detach: () => {
        send({ kind: 'detach' });
      },
      close: () => {
        if (open) {
          byFeed = true;
          finish();
        }
      },
      pending: () => pending,
    };
  };

  return {
    create: async (id, launch) => {
      calls.push({
        kind: 'create',
        id,
        cols: launch.cols,
        rows: launch.rows,
        leaseMs: launch.leaseMs,
        ...(launch.command === undefined ? {} : { command: launch.command }),
        ...(launch.cwd === undefined ? {} : { cwd: launch.cwd }),
        ...(launch.env === undefined ? {} : { env: launch.env }),
        ...(launch.params === undefined ? {} : { params: launch.params }),
      });
      return options.create === undefined ? { id, shell: { path: '/bin/zsh', name: 'zsh' }, cwd: launch.cwd ?? '/home/u' } : options.create(id);
    },
    connect,
    close: async (id) => {
      calls.push({ kind: 'close', id });
      await options.close?.(id);
    },
    dismiss: async (id) => {
      calls.push({ kind: 'dismiss', id });
      await options.dismiss?.(id);
    },
    busy: async (id) => {
      calls.push({ kind: 'busy', id });
      return options.busy === undefined ? { state: 'idle' } : options.busy(id);
    },
    cwd: async (id) => {
      calls.push({ kind: 'cwd', id });
      return options.cwd === undefined ? { path: '/home/u' } : options.cwd(id);
    },
    list: async () => {
      calls.push({ kind: 'list' });
      return (options.list === undefined ? [] : options.list()) as readonly unknown[];
    },
    listed: async (id) => {
      calls.push({ kind: 'listed', id });
      return options.listed?.(id);
    },
    describe: (error) => (error instanceof Error ? error.message : String(error)),
    isGone: (error) => typeof error === 'object' && error !== null && Reflect.get(error, 'gone') === true,
    codeOf: (error) => {
      const code: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
      return typeof code === 'string' ? code : undefined;
    },
    triedOf: (error) => {
      const tried: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'tried') : undefined;
      return Array.isArray(tried) ? (tried as readonly TerminalShellAttempt[]) : undefined;
    },
    streams: () => streams,
    stream: () => {
      const latest = streams.at(-1);
      if (latest === undefined) {
        throw new Error('the feed opened no stream');
      }

      return latest;
    },
    calls: () => calls,
    of: <K extends ChannelCall['kind']>(kind: K) => calls.filter((call): call is Extract<ChannelCall, { readonly kind: K }> => call.kind === kind),
  };
}

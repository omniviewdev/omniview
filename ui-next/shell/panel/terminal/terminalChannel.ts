import { ExecClient } from '@omniviewdev/runtime/api';
import { parseAppError } from '@omniviewdev/runtime/ui/v1';
import { Stream } from '@wailsio/runtime';
import { isNativeWindow } from '../../core/native';
import { CHANNEL_MARKS_VERSION, CHANNEL_VERSION, type ChannelEvents, type ChannelLaunch, type ChannelLink, type TerminalChannels } from './channel';

// The one place that holds the capabilities of the terminals of this page and their streams (docs/ui-next/terminal-channel-protocol.md; the contract with the feed is `channel.ts`). A capability is what reaches a
// terminal, so it never leaves this file: it is not exported, not handed to the feed, and not in any note, error or address. It is kept in memory and in the sessionStorage of this tab (id to capability), which a reload keeps and no other window
// and no other caller can read, so that a page that reloads reaches the terminals it left. It is never given to the host's window service: `WindowClient.SaveState` keeps its slots on disk, and `GetState` and `ListStates`
// answer any window and any caller (protocol, section 2). The slot `terminal-capabilities` that an earlier build kept there is ignored: it is not read, and nothing is migrated from it. The window always starts: a storage that cannot
// be read or written leaves a page that works from memory, with a note that does not carry a capability. The binary framing of the stream is here too: the feed is handed bytes and parsed JSON, and sends bytes.

/** The key of the tab's sessionStorage that holds the terminals' capabilities, as a JSON object of the terminal's id to its capability. */
export const CAPABILITY_KEY = 'omniview.terminal-capabilities';

/** What a capability looks like: the host's are 43 characters of base64url. Anything else is not one the page keeps, and a capability that is not one cannot be put in the attach frame whole. */
const USABLE = /^[A-Za-z0-9_-]{16,256}$/;

/** The most capabilities one `ListChannelTerminals` takes. */
const MAX_LISTED = 1_024;

/** The type of the error the host answers for a capability that opens nothing (backend/pkg/apperror `SessionNotFound`, `ErrorTypes.SESSION_NOT_FOUND` in the runtime). */
const SESSION_NOT_FOUND = 'omniview:session/not-found';

/** The name of the stream that carries the terminals. It is in a URL, so it carries nothing secret. */
const STREAM = 'terminal';

// The frames (protocol section 4): one binary message each, a type byte first. Types below 0x80 are the page's, from 0x80 the host's.
const ATTACH = 0x01;
const INPUT = 0x02;
const RESIZE = 0x03;
const ACK = 0x04;
const DETACH = 0x05;
const CLOSE = 0x06;
const READY = 0x81;
const OUTPUT = 0x82;
const GAP = 0x83;
const ENDED = 0x84;
const TAKEN_OVER = 0x85;
const NOT_FOUND = 0x86;
const APPLIED = 0x87;
const RELEASED = 0x88;
const UNSUPPORTED = 0x89;
const CLOSE_REFUSED = 0x8a;
const MARKS = 0x8b;

/** What of a stream the channel uses: a WebSocket's, which is also the shape of the Wails stream. */
export type ChannelSocket = {
  binaryType: 'arraybuffer' | 'blob';
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: Uint8Array<ArrayBuffer>): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: Event) => void): void;
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: Event) => void): void;
};

/** What of `ExecClient` the channel uses. */
export type ChannelClient = {
  CreateTerminal(
    options: {
      readonly id: string;
      readonly tty: boolean;
      readonly command: string[];
      readonly labels: Record<string, string>;
      readonly params: Record<string, string>;
      readonly resource_plugin: string;
      readonly resource_key: string;
    },
    launch: { readonly channel: boolean; readonly cols: number; readonly rows: number; readonly lease_ms?: number; readonly cwd?: string; readonly env?: Readonly<Record<string, string>> },
  ): PromiseLike<unknown>;
  CloseChannelTerminal(capability: string): PromiseLike<unknown>;
  DismissChannelTerminal(capability: string): PromiseLike<unknown>;
  ChannelTerminalBusy(capability: string): PromiseLike<unknown>;
  ListChannelTerminals(capabilities: string[]): PromiseLike<unknown>;
};

/** A place to keep the capabilities as text. `read` answers nothing when nothing was saved; either call throws when the place cannot be used. */
export type CapabilityStorage = {
  readonly read: () => string | null | undefined;
  readonly write: (text: string) => void;
};

export type ChannelDeps = {
  readonly client: ChannelClient;
  /** Opens the stream called `name` (`Stream` of the Wails runtime). */
  readonly openStream: (name: string) => ChannelSocket;
  readonly storage: CapabilityStorage;
  /** Where a note goes (the console by default). A note never carries a capability. */
  readonly warn?: ((message: string) => void) | undefined;
  /** The capabilities already known, by terminal id: what a page that reloaded read from its tab's storage. */
  readonly saved?: Readonly<Record<string, string>> | undefined;
};

/** What of the page's global object the storage reads: the tab's `sessionStorage`, looked up at each call because merely reading it may be refused. */
export type StorageScope = { readonly sessionStorage: Pick<Storage, 'getItem' | 'setItem'> };

export function sessionCapabilityStorage(scope: StorageScope): CapabilityStorage {
  return {
    read: () => scope.sessionStorage.getItem(CAPABILITY_KEY) ?? undefined,
    write: (text) => {
      scope.sessionStorage.setItem(CAPABILITY_KEY, text);
    },
  };
}

const consoleWarn = (message: string): void => {
  console.warn(message);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What the host answers for a call that names a terminal this page holds no capability for: what a capability that opens nothing gets, in the same words, so that `isGone` knows it and the feed treats it alike. */
class TerminalGone extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  constructor() {
    super('The terminal is not there.');
    this.name = 'TerminalGone';
    this.type = SESSION_NOT_FOUND;
    this.title = 'Not found';
    this.status = 404;
    this.detail = 'The terminal is not there.';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function frameOf(type: number, payload?: Uint8Array): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(1 + (payload?.length ?? 0));
  frame[0] = type;
  if (payload !== undefined) {
    frame.set(payload, 1);
  }

  return frame;
}

/** Whole numbers in the range of a frame field. A value outside it is the nearest one inside, so that a frame is always one the host takes. */
const clamped = (value: number, least: number, most: number): number => Math.min(most, Math.max(least, Number.isFinite(value) ? Math.trunc(value) : least));

/** What the storage's text holds: the capabilities that can be used, and whether anything in it could not be. */
function slotOf(text: string): { readonly saved: Record<string, string>; readonly whole: boolean } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { saved: {}, whole: false };
  }

  if (!isRecord(value)) {
    return { saved: {}, whole: false };
  }

  const saved: Record<string, string> = {};
  let whole = true;
  for (const [id, cap] of Object.entries(value)) {
    if (typeof cap === 'string' && USABLE.test(cap)) {
      saved[id] = cap;
    } else {
      whole = false;
    }
  }

  return { saved, whole };
}

type Core = {
  readonly channels: TerminalChannels;
  /** Takes in the capabilities a storage held, those it does not know already. */
  readonly adopt: (saved: Readonly<Record<string, string>>) => void;
  readonly storage: CapabilityStorage;
  readonly warn: (message: string) => void;
};

function createCore(deps: ChannelDeps): Core {
  const { client, openStream, storage } = deps;
  const warn = deps.warn ?? consoleWarn;
  const caps = new Map<string, string>(Object.entries(deps.saved ?? {}));
  // Every capability this page has held, for as long as the page lives: what the words of an error are cleaned of, in case the host or the slot echoes one.
  const seen = new Set<string>(caps.values());
  const scrub = (text: string): string => [...seen].reduce((clean, cap) => clean.split(cap).join('the capability'), text);

  // The storage is written after every change, with the state at the change. A write that fails is a note: the terminals work from memory.
  const persist = (): void => {
    try {
      storage.write(JSON.stringify(Object.fromEntries(caps)));
    } catch (error) {
      warn(`The terminal capabilities could not be saved (${scrub(messageOf(error))}), so the terminals of this tab cannot be found again after a reload.`);
    }
  };

  /** Forgets a capability, if it is still the one held for the id. Says whether it was. */
  const drop = (id: string, cap: string): boolean => {
    if (caps.get(id) !== cap) {
      return false;
    }

    caps.delete(id);
    return true;
  };

  const forget = (id: string, cap: string): void => {
    if (drop(id, cap)) {
      persist();
    }
  };

  /**
   * An error of the host as it leaves this file: its public reading (`parseAppError`: type, title, status, detail, code, shells tried, suggestions) cleaned of every capability the page has held, in a new error
   * with no cause and no other field. The host never puts a capability in an error, but a place that echoes what it was given might, and the feed logs what it is handed.
   */
  const clean = (error: unknown): Error => {
    const read = parseAppError(error);
    const safe = JSON.parse(scrub(JSON.stringify(read))) as Record<string, unknown>;
    return Object.assign(new Error(scrub(messageOf(error))), safe);
  };

  const isGone = (error: unknown): boolean => parseAppError(error).type === SESSION_NOT_FOUND;

  /** A call that names a terminal: the host is asked with its capability, and a terminal the page holds none for is answered as the host answers a capability that opens nothing. */
  async function named<T>(id: string, call: (cap: string) => PromiseLike<T>, forgetAfter = false): Promise<T> {
    const cap = caps.get(id);
    if (cap === undefined) {
      throw new TerminalGone();
    }

    try {
      const answer = await call(cap);
      if (forgetAfter) {
        forget(id, cap);
      }

      return answer;
    } catch (error) {
      if (isGone(error)) {
        forget(id, cap);
      }

      throw clean(error);
    }
  }

  /** The host's listing of some capabilities, which is a list. */
  async function listing(capabilities: string[]): Promise<readonly unknown[]> {
    const answer = await Promise.resolve(client.ListChannelTerminals(capabilities)).catch((error: unknown) => {
      throw clean(error);
    });
    if (!Array.isArray(answer)) {
      throw new Error('The host did not answer the list of terminals with a list.');
    }

    return answer as readonly unknown[];
  }

  const idOf = (entry: unknown): string | undefined => (isRecord(entry) && typeof entry.id === 'string' ? entry.id : undefined);

  const channels: TerminalChannels = {
    create: async (id: string, launch: ChannelLaunch) => {
      const session = await Promise.resolve(
        client.CreateTerminal(
          { id, tty: true, command: launch.command === undefined ? [] : [...launch.command], labels: {}, params: {}, resource_plugin: '', resource_key: '' },
          {
            channel: true,
            cols: launch.cols,
            rows: launch.rows,
            ...(launch.leaseMs === undefined ? {} : { lease_ms: launch.leaseMs }),
            ...(launch.cwd === undefined ? {} : { cwd: launch.cwd }),
            ...(launch.env === undefined ? {} : { env: launch.env }),
          },
        ),
      ).catch((error: unknown) => {
        throw clean(error);
      });
      if (!isRecord(session)) {
        throw new Error('The host did not answer with a terminal.');
      }

      const { cap, ...rest } = session;
      if (typeof cap !== 'string' || !USABLE.test(cap)) {
        throw new Error('The host did not give the terminal a capability this page can keep.');
      }

      seen.add(cap);
      caps.set(id, cap);
      persist();
      return rest;
    },

    connect: (id, fromOffset, events, writer) => connect(id, fromOffset, events, writer),

    close: async (id) => {
      await named(id, async (cap) => client.CloseChannelTerminal(cap), true);
    },

    dismiss: async (id) => {
      await named(id, async (cap) => client.DismissChannelTerminal(cap), true);
    },

    busy: async (id) => named(id, async (cap) => client.ChannelTerminalBusy(cap)),

    list: async () => {
      const held = [...caps];
      if (held.length === 0) {
        return [];
      }

      // Nothing is forgotten until the host has answered every part of the question: a failed listing says nothing about the terminals.
      const answered: unknown[] = [];
      for (let from = 0; from < held.length; from += MAX_LISTED) {
        answered.push(...(await listing(held.slice(from, from + MAX_LISTED).map(([, cap]) => cap))));
      }

      const present = new Set(answered.map(idOf));
      let dropped = false;
      for (const [id, cap] of held) {
        if (!present.has(id) && drop(id, cap)) {
          dropped = true;
        }
      }

      if (dropped) {
        persist();
      }

      const asked = new Set(held.map(([id]) => id));
      return answered.filter((entry) => asked.has(idOf(entry) ?? ''));
    },

    listed: async (id) => {
      const cap = caps.get(id);
      if (cap === undefined) {
        return undefined;
      }

      return (await listing([cap])).find((entry) => idOf(entry) === id);
    },

    describe: (error) => scrub(parseAppError(error).detail),
    isGone,
    codeOf: (error) => parseAppError(error).code,
    // The tokens are the runtime's reading of the problem (`AppError.tried`, host #672): a token it does not know is `other` there, and is handed on as it is.
    triedOf: (error) => parseAppError(error).tried,
  };

  /** What a stream that has no terminal to reach does: nothing, and says so to nobody. */
  const NO_LINK: Omit<ChannelLink, 'close'> = {
    input: () => false,
    resize: () => undefined,
    ack: () => undefined,
    detach: () => undefined,
    end: () => false,
    pending: () => 0,
  };

  function connect(id: string, fromOffset: number | undefined, events: ChannelEvents, writer?: string): ChannelLink {
    const cap = caps.get(id);
    let socket: ChannelSocket | undefined;
    if (cap !== undefined) {
      try {
        socket = openStream(STREAM);
      } catch {
        socket = undefined;
      }
    }

    // A terminal the page has no capability for, or a stream that cannot be opened, ends at once: told after the feed has the link, never inside the call that made it.
    if (cap === undefined || socket === undefined) {
      let silenced = false;
      queueMicrotask(() => {
        if (!silenced) {
          if (cap === undefined) {
            events.notFound();
          } else {
            events.closed();
          }
        }
      });
      return {
        ...NO_LINK,
        close: () => {
          silenced = true;
        },
      };
    }

    const stream = socket;
    stream.binaryType = 'arraybuffer';
    let over = false;
    let open = stream.readyState === 1;
    let waiting: Array<Uint8Array<ArrayBuffer>> = [];
    let waitingBytes = 0;

    const listeners = {
      open: (): void => {
        open = true;
        const frames = waiting;
        waiting = [];
        waitingBytes = 0;
        for (const frame of frames) {
          send(frame);
        }
      },
      message: (event: Event): void => {
        receive((event as MessageEvent).data);
      },
      close: (): void => {
        finish('closed');
      },
      error: (): void => {
        finish('closed');
      },
    };

    const release = (): void => {
      over = true;
      waiting = [];
      waitingBytes = 0;
      for (const type of ['open', 'message', 'close', 'error'] as const) {
        stream.removeEventListener(type, listeners[type]);
      }

      try {
        stream.close();
      } catch {
        // A stream that cannot be closed is already gone.
      }
    };

    /** Ends the stream in exactly one of five ways, once, and lets it go before the feed is told. A terminal that was taken is not an end: the stream stays, as a watcher, until one of these comes. */
    function finish(how: 'ended' | 'released' | 'notFound' | 'unsupported' | 'closed', payload?: unknown): void {
      if (over) {
        return;
      }

      release();
      if (how === 'notFound' && cap !== undefined) {
        forget(id, cap);
      }

      if (how === 'ended') {
        events.ended(payload);
      } else if (how === 'unsupported') {
        events.unsupported(payload);
      } else {
        events[how]();
      }
    }

    /** Whether the frame was handed to the stream. One that waits for the stream to open is not sent yet, and is not refused. A stream that is closing or closed before its close event came is over: nothing is sent, and it ends as `closed`, once. */
    function send(frame: Uint8Array<ArrayBuffer>): boolean {
      if (over) {
        return false;
      }

      if (!open) {
        waiting.push(frame);
        waitingBytes += frame.length;
        return true;
      }

      if (stream.readyState !== 1) {
        finish('closed');
        return false;
      }

      try {
        stream.send(frame);
        return true;
      } catch {
        finish('closed');
        return false;
      }
    }

    function receive(data: unknown): void {
      if (over) {
        return;
      }

      if (Object.prototype.toString.call(data) !== '[object ArrayBuffer]') {
        finish('closed');
        return;
      }

      const buffer = data as ArrayBuffer;
      const view = new Uint8Array(buffer);
      const type = view[0];
      const json = (): { readonly value: unknown } | undefined => {
        try {
          return { value: JSON.parse(decoder.decode(view.subarray(1))) as unknown };
        } catch {
          return undefined;
        }
      };

      const numbers = new DataView(buffer);
      switch (type) {
        case READY: {
          const parsed = json();
          if (parsed === undefined) {
            finish('closed');
          } else {
            events.ready(parsed.value);
          }

          return;
        }

        case OUTPUT: {
          const offset = view.length < 9 ? undefined : Number(numbers.getBigUint64(1));
          if (offset === undefined || !Number.isSafeInteger(offset)) {
            finish('closed');
          } else {
            // A copy: the feed keeps the bytes, and the message's buffer is the transport's.
            events.output(offset, view.slice(9));
          }

          return;
        }

        case GAP: {
          const from = view.length === 17 ? Number(numbers.getBigUint64(1)) : undefined;
          const to = view.length === 17 ? Number(numbers.getBigUint64(9)) : undefined;
          if (from === undefined || to === undefined || !Number.isSafeInteger(from) || !Number.isSafeInteger(to)) {
            finish('closed');
          } else {
            events.gap(from, to);
          }

          return;
        }

        case ENDED: {
          const parsed = json();
          if (parsed === undefined) {
            finish('closed');
          } else {
            finish('ended', parsed.value);
          }

          return;
        }

        case APPLIED: {
          const total = view.length === 9 ? Number(numbers.getBigUint64(1)) : undefined;
          if (total === undefined || !Number.isSafeInteger(total)) {
            finish('closed');
          } else {
            events.applied(total);
          }

          return;
        }

        case MARKS: {
          const parsed = json();
          if (parsed === undefined) {
            finish('closed');
          } else {
            events.marks(parsed.value);
          }

          return;
        }

        case TAKEN_OVER:
          events.takenOver();
          return;
        case CLOSE_REFUSED:
          if (view.length === 1) {
            events.closeRefused();
          } else {
            finish('closed');
          }

          return;
        case RELEASED:
          finish('released');
          return;
        case UNSUPPORTED: {
          const parsed = json();
          if (parsed === undefined) {
            finish('closed');
          } else {
            finish('unsupported', typeof parsed.value === 'object' && parsed.value !== null ? Reflect.get(parsed.value, 'v') : undefined);
          }

          return;
        }

        case NOT_FOUND:
          finish('notFound');
          return;
        default:
          finish('closed');
      }
    }

    stream.addEventListener('open', listeners.open);
    stream.addEventListener('message', listeners.message);
    stream.addEventListener('close', listeners.close);
    stream.addEventListener('error', listeners.error);

    // The attach is the first frame and nothing goes before it. An offset of 0 is an offset: it is said when it is given, and not when the page has nothing.
    const request = { v: CHANNEL_VERSION, marks: CHANNEL_MARKS_VERSION, cap, ...(writer === undefined ? {} : { writer }), ...(fromOffset !== undefined && Number.isSafeInteger(fromOffset) && fromOffset >= 0 ? { from_offset: fromOffset } : {}) };
    send(frameOf(ATTACH, encoder.encode(JSON.stringify(request))));

    return {
      input: (bytes) => {
        return bytes.length === 0 || send(frameOf(INPUT, bytes));
      },
      resize: (cols, rows) => {
        const payload = new Uint8Array(4);
        const view = new DataView(payload.buffer);
        view.setUint16(0, clamped(cols, 1, 1_000));
        view.setUint16(2, clamped(rows, 1, 1_000));
        send(frameOf(RESIZE, payload));
      },
      ack: (bytes) => {
        const payload = new Uint8Array(4);
        new DataView(payload.buffer).setUint32(0, clamped(bytes, 0, 0xffff_ffff));
        send(frameOf(ACK, payload));
      },
      end: () => send(frameOf(CLOSE)),
      detach: () => {
        send(frameOf(DETACH));
      },
      close: () => {
        if (!over) {
          release();
        }
      },
      pending: () => (over ? 0 : waitingBytes + stream.bufferedAmount),
    };
  }

  return {
    channels,
    storage,
    warn,
    adopt: (saved) => {
      const before = caps.size;
      let added = 0;
      for (const [id, cap] of Object.entries(saved)) {
        if (!caps.has(id)) {
          caps.set(id, cap);
          seen.add(cap);
          added += 1;
        }
      }

      // A terminal made before the storage was read has already written a state without these.
      if (added > 0 && before > 0) {
        persist();
      }
    },
  };
}

/** Reads the storage and takes in what it holds. Never throws: a storage that cannot be read or used is a page with no terminals of an earlier page, and a note. */
function load(core: Core): TerminalChannels {
  let text: string | null | undefined;
  try {
    text = core.storage.read();
  } catch {
    // The words of the failure are the storage's own, and could carry what it was asked for: only a sentence of ours is said.
    core.warn('The saved terminal capabilities could not be read, so this tab starts with no terminals of an earlier page.');
    return core.channels;
  }

  if (text !== null && text !== undefined) {
    const { saved, whole } = slotOf(text);
    if (!whole) {
      core.warn('The saved terminal capabilities could not all be used, so this tab starts without the ones it could not read.');
    }

    core.adopt(saved);
  }

  return core.channels;
}

/** The terminal channels of a page, with no capability read from its storage (a test of the channels alone; the page's own are `loadAppTerminalChannels`). */
export function createTerminalChannels(deps: ChannelDeps): TerminalChannels {
  return createCore(deps).channels;
}

/** The terminal channels of a page, with the capabilities its storage kept. */
export function loadTerminalChannels(deps: ChannelDeps): TerminalChannels {
  return load(createCore(deps));
}

/** What of the page's global object the stream's opener reads. */
type StreamScope = {
  readonly location: { readonly protocol: string; readonly host: string };
  readonly WebSocket: new (url: string) => unknown;
};

/**
 * How the page opens a stream. In the app's own window it is the Wails runtime's `Stream`, over the native bridge. In a browser (server mode) the host serves the page and the page carries its own bundle of the runtime, not the
 * host's `/wails/runtime.js`: the prelude the host puts in front of that script is what makes `Stream` a WebSocket of the host's stream route there (`stream_prelude_server.go` of Wails), and without it the runtime falls back to
 * its HTTP poll. So in a browser the page opens that route itself, as the prelude does: by name only (the name is in the address, and carries nothing secret), binary frames as array buffers.
 */
export function streamOpener(scope: unknown, native: (name: string) => ChannelSocket): (name: string) => ChannelSocket {
  if (isNativeWindow(scope)) {
    return (name) => native(name);
  }

  const { location, WebSocket: Socket } = scope as StreamScope;
  return (name) => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new Socket(`${protocol}//${location.host}/wails/stream/ws?name=${encodeURIComponent(name)}`) as ChannelSocket;
    socket.binaryType = 'arraybuffer';
    return socket;
  };
}

let app: Core | undefined;

/** The page's own channels: the host's `ExecClient`, the Wails stream, and the sessionStorage of this tab. Made when first asked for; its capabilities are those of this page until `loadAppTerminalChannels` has read the storage. */
const appCore = (): Core => {
  app ??= createCore({ client: ExecClient, openStream: streamOpener(window, (name) => Stream(name)), storage: sessionCapabilityStorage(window) });
  return app;
};

export function appTerminalChannels(): TerminalChannels {
  return appCore().channels;
}

/** Reads this tab's storage into the page's channels, and answers them. The window calls it before it asks for the terminals it left. Never throws. */
export function loadAppTerminalChannels(): TerminalChannels {
  return load(appCore());
}

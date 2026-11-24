import { ExecClient, WindowClient } from '@omniviewdev/runtime/api';
import { Window } from '@omniviewdev/runtime/runtime';
import { parseAppError } from '@omniviewdev/runtime/ui/v1';
import { Stream } from '@wailsio/runtime';
import { isNativeWindow } from '../../core/native';
import { resolveWindowName, type WindowState } from '../../session';
import type { ChannelEvents, ChannelLaunch, ChannelLink, TerminalChannels } from './channel';

// The one place that holds the capabilities of the terminals of this page and their streams (docs/ui-next/terminal-channel-protocol.md; the contract with the feed is `channel.ts`). A capability is what reaches a
// terminal, so it never leaves this file: it is not exported, not handed to the feed, and not in any note, error or address. It is kept in memory and in a slot of the host's window state (the place the session and the
// notifications are kept: `shell/session`, `shell/notices`), so that a page that reloads reaches the terminals it left. The window always starts: a slot that cannot be read or written leaves a page that works from memory,
// with a note that does not carry a capability. The binary framing of the stream is here too: the feed is handed bytes and parsed JSON, and sends bytes.

/** The slot of a window that holds its terminals' capabilities, as a JSON object of the terminal's id to its capability (a slot of the host is JSON). */
export const CAPABILITY_SLOT = 'terminal-capabilities';

/** How long the slot may take to answer a read before the window goes on with no terminals. The slot is the host's own process, so an answer is milliseconds; this is the bound on a host that has hung. */
export const CAPABILITY_DEADLINE_MS = 2_000;

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
const READY = 0x81;
const OUTPUT = 0x82;
const GAP = 0x83;
const ENDED = 0x84;
const TAKEN_OVER = 0x85;
const NOT_FOUND = 0x86;

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
    launch: { readonly channel: boolean; readonly cols: number; readonly rows: number; readonly lease_ms?: number },
  ): PromiseLike<unknown>;
  CloseChannelTerminal(capability: string): PromiseLike<unknown>;
  DismissChannelTerminal(capability: string): PromiseLike<unknown>;
  ChannelTerminalBusy(capability: string): PromiseLike<unknown>;
  ListChannelTerminals(capabilities: string[]): PromiseLike<unknown>;
};

/** A place to keep the capabilities as the text of their slot. `read` answers `undefined` when nothing was saved. */
export type CapabilityStorage = {
  readonly read: () => Promise<string | undefined>;
  readonly write: (text: string) => Promise<void>;
};

export type ChannelDeps = {
  readonly client: ChannelClient;
  /** Opens the stream called `name` (`Stream` of the Wails runtime). */
  readonly openStream: (name: string) => ChannelSocket;
  readonly storage: CapabilityStorage;
  /** Where a note goes (the console by default). A note never carries a capability. */
  readonly warn?: ((message: string) => void) | undefined;
  /** The capabilities already known, by terminal id: what a page that reloaded read from its slot. */
  readonly saved?: Readonly<Record<string, string>> | undefined;
};

export type CapabilityStorageOptions = {
  /** The two calls of the host's window service, as the generated binding has them. */
  readonly client: WindowState;
  /** The name of the window this page is in (the runtime knows it). Asked for once, and again after a failure. */
  readonly name: () => Promise<string>;
};

export function capabilityStorage({ client, name }: CapabilityStorageOptions): CapabilityStorage {
  let named: Promise<string> | undefined;
  const windowName = async (): Promise<string> => {
    named ??= name().catch((error: unknown) => {
      named = undefined;
      throw error;
    });
    return named;
  };

  return {
    read: async () => (await client.GetState(await windowName()))[CAPABILITY_SLOT],
    write: async (text) => {
      await client.SaveState(await windowName(), CAPABILITY_SLOT, text);
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

/** What a slot's text holds: the capabilities that can be used, and whether anything in it could not be. */
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

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

/** What a call of the slot answers, or why there is none within the deadline. The words of a failure are the slot's own and may echo what it was given, so only a sentence of ours is kept. */
async function within<T>(call: () => Promise<T>): Promise<Outcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The app's TypeScript library (ES2023) has no `Promise.withResolvers`, so the deadline is made with the executor.
  const late = new Promise<Outcome<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, why: `it did not answer in ${String(CAPABILITY_DEADLINE_MS)} ms` });
    }, CAPABILITY_DEADLINE_MS);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(call)
        .then((value): Outcome<T> => ({ ok: true, value }))
        .catch((): Outcome<T> => ({ ok: false, why: 'it failed' })),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type Core = {
  readonly channels: TerminalChannels;
  /** Takes in the capabilities a slot held, those it does not know already. */
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

  // The slot is written after every change, one write at a time and in the order of the changes, each with the state at its change. A write that fails is a note: the terminals work from memory.
  let chain: Promise<void> = Promise.resolve();
  const persist = (): void => {
    const text = JSON.stringify(Object.fromEntries(caps));
    chain = chain.then(async () => {
      try {
        await storage.write(text);
      } catch (error) {
        warn(`The terminal capabilities could not be saved (${scrub(messageOf(error))}), so the terminals of this window cannot be found again after a reload.`);
      }
    });
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
          { id, tty: true, command: [], labels: {}, params: {}, resource_plugin: '', resource_key: '' },
          { channel: true, cols: launch.cols, rows: launch.rows, ...(launch.leaseMs === undefined ? {} : { lease_ms: launch.leaseMs }) },
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

    connect: (id, fromOffset, events) => connect(id, fromOffset, events),

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
    input: () => undefined,
    resize: () => undefined,
    ack: () => undefined,
    detach: () => undefined,
    pending: () => 0,
  };

  function connect(id: string, fromOffset: number | undefined, events: ChannelEvents): ChannelLink {
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

    /** Ends the stream in exactly one of four ways, once, and lets it go before the feed is told. */
    function finish(how: 'ended' | 'takenOver' | 'notFound' | 'closed', payload?: unknown): void {
      if (over) {
        return;
      }

      release();
      if (how === 'notFound' && cap !== undefined) {
        forget(id, cap);
      }

      if (how === 'ended') {
        events.ended(payload);
      } else {
        events[how]();
      }
    }

    function send(frame: Uint8Array<ArrayBuffer>): void {
      if (over) {
        return;
      }

      if (!open) {
        waiting.push(frame);
        waitingBytes += frame.length;
        return;
      }

      try {
        stream.send(frame);
      } catch {
        finish('closed');
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

        case TAKEN_OVER:
          finish('takenOver');
          return;
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
    const request = { v: 1, cap, ...(fromOffset !== undefined && Number.isSafeInteger(fromOffset) && fromOffset >= 0 ? { from_offset: fromOffset } : {}) };
    send(frameOf(ATTACH, encoder.encode(JSON.stringify(request))));

    return {
      input: (bytes) => {
        if (bytes.length > 0) {
          send(frameOf(INPUT, bytes));
        }
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

      // A terminal made before the slot was read has already written a slot without these.
      if (added > 0 && before > 0) {
        persist();
      }
    },
  };
}

/** Reads the slot, within the deadline and without ever rejecting, and takes in what it holds. */
async function load(core: Core): Promise<TerminalChannels> {
  const read = await within(core.storage.read);
  if (!read.ok) {
    core.warn(`The saved terminal capabilities could not be read (${read.why}), so this window starts with no terminals of an earlier page.`);
  } else if (read.value !== undefined) {
    const { saved, whole } = slotOf(read.value);
    if (!whole) {
      core.warn('The saved terminal capabilities could not all be used, so this window starts without the ones it could not read.');
    }

    core.adopt(saved);
  }

  return core.channels;
}

/** The terminal channels of a page, with the capabilities its slot kept. Never rejects: a slot that cannot be read or used is a page with no terminals of an earlier page, and a note. */
export function createTerminalChannels(deps: ChannelDeps): TerminalChannels {
  return createCore(deps).channels;
}

/** The terminal channels of a page, once the slot has been read. */
export async function loadTerminalChannels(deps: ChannelDeps): Promise<TerminalChannels> {
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

/** The name of the window this page is in, as the host's window service knows it (`resolveWindowName`): the key of its slots. */
const windowName = async (): Promise<string> => resolveWindowName({ name: async () => Window.Name(), list: async () => WindowClient.List() });

let app: Core | undefined;

/** The page's own channels: the host's `ExecClient`, the Wails stream, and the slot of this window. Made when first asked for; its capabilities are those of this page until `loadAppTerminalChannels` has read the slot. */
const appCore = (): Core => {
  app ??= createCore({ client: ExecClient, openStream: streamOpener(window, (name) => Stream(name)), storage: capabilityStorage({ client: WindowClient, name: windowName }) });
  return app;
};

export function appTerminalChannels(): TerminalChannels {
  return appCore().channels;
}

/** Reads this window's slot into the page's channels, and answers them. The window awaits it before it asks for the terminals it left. Never rejects, and is bounded. */
export async function loadAppTerminalChannels(): Promise<TerminalChannels> {
  return load(appCore());
}

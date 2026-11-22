import { decodeBase64, encodeInput } from './bytes';
import type { TerminalFeedHandle, TerminalFeedSnapshot, TerminalOutput } from './feed';
import { createHeldOutput } from './heldOutput';

// A pty session of the host's exec lane as a feed (docs/ui-next/status/T1.md, "The data path"). It is the one place the rules of a terminal's wire live, framework-free and without xterm:
//
//   - the id of the session is chosen HERE and every listener is in place before the process starts, so the first prompt cannot arrive before somebody listens (the old terminal attached after the call);
//   - what the process writes is held exactly as it came (base64 text, bounded, nothing decoded until a view reads) and wakes a listener once between two reads, so a flood costs a push per event and a
//     hidden terminal costs no more;
//   - what the user types goes in order with ONE call in flight (what is typed meanwhile is the next call);
//   - the size is settled: the first size of a running session goes at once, every later one once it stood still (`settleMs`), one call in flight and the newest wins, ROWS before COLUMNS;
//   - a close ends the process exactly once, and every listener is released on every way out (docs/ui-next/optimisations.md HLT-28).
//
// What a backend is, as far as this file is concerned, is `ExecTransport`: the host's local shell is `localShell.ts`, and a plugin's exec target is another transport over the same feed.

export type ExecTransport = {
  /** Starts the process under `id`. */
  readonly create: (id: string) => Promise<unknown>;
  /** Writes what the user typed, as base64. */
  readonly write: (id: string, base64: string) => Promise<unknown>;
  /** ROWS then COLUMNS, as the binding takes them (the old terminal had them swapped once, host #54). */
  readonly resize: (id: string, rows: number, cols: number) => Promise<unknown>;
  readonly close: (id: string) => Promise<unknown>;
  /** Listens to an event by name; returns what stops it. */
  readonly on: (name: string, listener: (data: unknown) => void) => () => void;
  /** An error of the backend, in a sentence. */
  readonly describe: (error: unknown) => string;
  /** Whether an error says the session is not there any more. */
  readonly isGone: (error: unknown) => boolean;
};

export type ExecFeedOptions = {
  readonly transport: ExecTransport;
  /** Makes the session's id. Default: a random UUID. */
  readonly newId?: (() => string) | undefined;
  /** The most it holds for a reader that is not reading, in bytes. Default: `HELD_BYTES`. */
  readonly limit?: number | undefined;
  /** How long a size has to stand still before it is sent, in milliseconds. Default: `SETTLE_MS`. */
  readonly settleMs?: number | undefined;
  /** Where the host says what it could not do. Default: the console. */
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
};

export type ExecFeed = TerminalFeedHandle & { readonly id: string };

/** What a feed holds for a reader that is not reading (a hidden terminal): four times the ring the backend replays on a reattach (1,000,000 bytes), a few seconds of a flood. Past it the oldest bytes go, counted. */
export const HELD_BYTES = 4 << 20;

/** How long a size stands still before it is sent: a drag of the splitter is one message. */
export const SETTLE_MS = 100;

/** The names of the events of a session (backend/pkg/plugin/exec/controller.go `dispatchOutput`). */
export const streamEvent = (id: string, target: 'stdout' | 'stderr'): string => `core/exec/stream/${target}/${id}`;
export const signalEvent = (id: string, signal: 'CLOSE' | 'ERROR'): string => `core/exec/signal/${signal}/${id}`;

const EMPTY: TerminalOutput = Object.freeze({ chunks: Object.freeze([]), bytes: 0, dropped: 0 });
const MAX_CELLS = 65_535;

/** The platform's `crypto`, which every engine the app runs in has, and a test environment may not. */
const platform: { readonly crypto?: Crypto | undefined } = globalThis;
let counter = 0;
function newUuid(): string {
  if (typeof platform.crypto?.randomUUID === 'function') {
    return platform.crypto.randomUUID();
  }

  counter += 1;
  return `term-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const consoleWarn = (message: string, error?: unknown): void => {
  if (error === undefined) {
    console.warn(message);
  } else {
    console.warn(message, error);
  }
};

/** What an ERROR signal says: a plain text as it is, an object by its title and message (what a plugin's exec error carries), nothing as nothing. */
function signalMessage(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }

  if (typeof data !== 'object' || data === null) {
    return '';
  }

  const title = Reflect.get(data, 'title');
  const message = Reflect.get(data, 'message');
  const parts = [title, message].filter((part): part is string => typeof part === 'string' && part.trim() !== '').map((part) => part.trim());
  return parts.map((part, index) => (index < parts.length - 1 && !/[.!?]$/.test(part) ? `${part}.` : part)).join(' ');
}

type Size = { readonly cols: number; readonly rows: number };

export function createExecFeed(options: ExecFeedOptions): ExecFeed {
  const { transport } = options;
  const id = (options.newId ?? newUuid)();
  const warn = options.warn ?? consoleWarn;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const held = createHeldOutput(options.limit ?? HELD_BYTES);
  const listeners = new Set<() => void>();
  const stops: Array<() => void> = [];
  const typed: string[] = [];
  let status: TerminalFeedSnapshot = { state: 'starting' };
  let created = false;
  let closing: Promise<void> | undefined;
  let woken = false;
  let warnedPayload = false;
  let writing = false;
  let wanted: Size | undefined;
  let delivered: Size | undefined;
  let resizing = false;
  let settling: ReturnType<typeof setTimeout> | undefined;

  const closed = (): boolean => closing !== undefined;

  const tell = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const release = () => {
    for (const stop of stops.splice(0)) {
      stop();
    }
  };

  const stopSettling = () => {
    if (settling !== undefined) {
      clearTimeout(settling);
      settling = undefined;
    }
  };

  /** The way out of a session that ended or failed: nothing is listened to, nothing is waited for, what was written stays readable. Once. */
  const over = (next: TerminalFeedSnapshot) => {
    if (closed() || status.state === 'ended' || status.state === 'failed') {
      return;
    }

    release();
    stopSettling();
    typed.length = 0;
    status = next;
    tell();
  };

  const onOutput = (data: unknown) => {
    if (closed()) {
      return;
    }

    if (typeof data !== 'string') {
      if (!warnedPayload) {
        warnedPayload = true;
        warn('[terminal] the backend sent output that is not text; it is ignored');
      }

      return;
    }

    held.push(data);
    if (!woken) {
      woken = true;
      tell();
    }
  };

  const flushTyped = () => {
    if (writing || !created || status.state !== 'running' || typed.length === 0) {
      return;
    }

    const text = typed.splice(0).join('');
    writing = true;
    transport.write(id, encodeInput(text)).then(
      () => {
        writing = false;
        flushTyped();
      },
      (error: unknown) => {
        writing = false;
        if (closed()) {
          return;
        }

        // A session that is not there takes nothing: it ended. Any other refusal leaves what was typed in doubt, and the session says so.
        over(transport.isGone(error) ? { state: 'ended' } : { state: 'failed', cause: { stage: 'input', message: transport.describe(error) } });
      },
    );
  };

  const sendSize = () => {
    if (resizing || !created || status.state !== 'running' || wanted === undefined) {
      return;
    }

    const size = wanted;
    if (delivered?.cols === size.cols && delivered.rows === size.rows) {
      return;
    }

    resizing = true;
    transport.resize(id, size.rows, size.cols).then(
      () => {
        resizing = false;
        delivered = size;
        // A size that came while this one was out and has been standing still since is sent now; one that is still settling waits for its own timer.
        if (settling === undefined) {
          sendSize();
        }
      },
      (error: unknown) => {
        resizing = false;
        if (!closed() && !transport.isGone(error)) {
          warn('[terminal] the size of the screen could not be sent', error);
        }
      },
    );
  };

  const outcome = async (): Promise<void> =>
    transport.create(id).then(
      () => {
        created = true;
        if (closed() || status.state !== 'starting') {
          return;
        }

        status = { state: 'running' };
        tell();
        sendSize();
        flushTyped();
      },
      (error: unknown) => {
        if (!closed()) {
          over({ state: 'failed', cause: { stage: 'start', message: transport.describe(error) } });
        }
      },
    );

  // Every listener first, then the process.
  stops.push(
    transport.on(streamEvent(id, 'stdout'), onOutput),
    transport.on(streamEvent(id, 'stderr'), onOutput),
    transport.on(signalEvent(id, 'CLOSE'), () => {
      over({ state: 'ended' });
    }),
    transport.on(signalEvent(id, 'ERROR'), (data) => {
      over({ state: 'failed', cause: { stage: 'session', message: signalMessage(data) } });
    }),
  );
  const starting = outcome();

  return {
    id,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: () => status,

    read: (max) => {
      woken = false;
      if (closed()) {
        return EMPTY;
      }

      const taken = held.take(max);
      return { chunks: taken.texts.map(decodeBase64), bytes: taken.bytes, dropped: taken.dropped };
    },

    write: (text) => {
      if (closed() || (status.state !== 'running' && status.state !== 'starting')) {
        return;
      }

      typed.push(text);
      flushTyped();
    },

    resize: (cols, rows) => {
      const size = { cols: Math.floor(cols), rows: Math.floor(rows) };
      if (closed() || !(size.cols >= 1 && size.cols <= MAX_CELLS && size.rows >= 1 && size.rows <= MAX_CELLS) || status.state === 'ended' || status.state === 'failed') {
        return;
      }

      wanted = size;
      if (!created || status.state !== 'running') {
        return;
      }

      if (delivered === undefined && !resizing) {
        sendSize();
        return;
      }

      stopSettling();
      settling = setTimeout(() => {
        settling = undefined;
        sendSize();
      }, settleMs);
    },

    close: async () => {
      if (closing !== undefined) {
        return closing;
      }

      release();
      stopSettling();
      held.clear();
      typed.length = 0;
      closing = starting.then(async () => {
        // A process that never started, or that ended on its own, has nothing to end.
        if (!created || status.state === 'ended') {
          return;
        }

        try {
          await transport.close(id);
        } catch (error) {
          if (!transport.isGone(error)) {
            throw error;
          }
        }
      });
      return closing;
    },
  };
}

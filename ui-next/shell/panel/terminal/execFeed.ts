import { base64Size, decodeBase64, encodeInput } from './bytes';
import type { TerminalBusy, TerminalClosedBy, TerminalExit, TerminalFeedCause, TerminalFeedHandle, TerminalFeedSnapshot, TerminalFeedStage, TerminalOutput } from './feed';
import { createHeldOutput } from './heldOutput';

// A pty session of the host's exec lane as a feed (docs/ui-next/status/T1.md, "The data path"; docs/ui-next/status/T2a.md for what the host's own shell tells). It is the one place the rules of a terminal's wire
// live, framework-free and without xterm:
//
//   - the id of the session is chosen HERE and every listener is in place before the process starts, so the first prompt cannot arrive before somebody listens (the old terminal attached after the call);
//   - what the process writes is held exactly as it came (base64 text, nothing dropped, nothing decoded until a view reads) and wakes a listener once between two reads, so a flood costs a push per event and a
//     hidden terminal costs no more. What bounds it is the HOST's flow control, not a bound here: the page turns it on with its first acknowledgement, the moment the process exists, and acknowledges every byte
//     the screen parses (`ack`); the host stops reading the pty when 1 MiB is delivered and not acknowledged, so a terminal nobody reads holds about that much and its shell waits, and loses nothing;
//   - what the user types goes out AT ONCE, each piece as its own call, and never waits for the answer of an earlier one: the HOST puts the calls in order, not this file. Every call of the session (a write or a size)
//     carries a number, from ONE counter that starts at 1 when the process exists; the number is taken when the call is first sent, a call that is sent again keeps it, and the host applies the calls in the order of the
//     numbers whatever order they reach it in (docs/ui-next/status/T1-go.md 2.4). A paste goes in calls of at most 64 KiB, and no more than 512 KiB and 32 calls are in flight at once: this WINDOW protects the host's own
//     bounds (it holds at most 1 MiB and 256 operations for a session, and refuses a call more than 64 past the number it waits for) and does not keep the order, which the numbers keep; what does not fit waits, and goes
//     together, in order, as calls are answered. A call the host refuses with `INPUT_BACKLOG` (the session is full: the call was not applied and took no number) is sent again with the same number after a short delay, for as
//     long as the session runs. What is typed before the process exists is held, and sent after it in order, with the first numbers;
//   - the size STARTS the process and is then settled: the process starts at the first size the view measured, so the shell lays out its first prompt for it and nothing is resized after it started (a session whose view never measures never starts); every later size goes once it stood still (`settleMs`: a drag is one message), at once as its own call and not waiting for another, ROWS before COLUMNS;
//   - what the host says of the process is read in ONE place each and kept in the status: the shell it started (the call's answer), how it ended (the typed CLOSE event: its code, its signal, who closed it), the code of
//     a refusal to start; and what runs in it is asked when it matters (`busy`: a close), never polled;
//   - a close ends the process exactly once, and every listener is released on every way out (docs/ui-next/optimisations.md HLT-28).
//
// What a backend is, as far as this file is concerned, is `ExecTransport`: the host's local shell is `localShell.ts`, and a plugin's exec target is another transport over the same feed.

export type ExecTransport = {
  /** Starts the process under `id` on a pty of `size`, the size the view measured: the shell lays out its first prompt for it. Answers with the session the backend made (the feed reads the shell's name from it). */
  readonly create: (id: string, size: Size) => Promise<unknown>;
  /**
   * Writes what the user typed, as base64, as call number `seq` of the session. The feed counts the calls (the writes and the sizes together, from 1, one number for each call; a call that is sent again keeps its number)
   * and sends each at once, without waiting for the one before: the order is the backend's to keep by the numbers, as the host's own shell does (docs/ui-next/status/T1-go.md 2.4), and a backend that applies calls in the
   * order they reach it must serialise them itself. A refusal with the code `INPUT_BACKLOG` asks for the same call again.
   */
  readonly write: (id: string, seq: number, base64: string) => Promise<unknown>;
  /** ROWS then COLUMNS, as the binding takes them (the old terminal had them swapped once, host #54); call number `seq`, as for `write`. */
  readonly resize: (id: string, seq: number, rows: number, cols: number) => Promise<unknown>;
  readonly close: (id: string) => Promise<unknown>;
  /**
   * Tells the backend that the screen took in this many more bytes of the session's output (`AckTerminal`, docs/ui-next/status/T1-go.md 2.8.6). The first call turns the backend's flow control on: from then on only
   * these calls credit what it delivered, and it stops sending at its high mark until they come.
   */
  readonly ack: (id: string, bytes: number) => Promise<unknown>;
  /** What runs in the session besides its shell (`IsBusy`): the backend's own answer, which the feed reads. */
  readonly busy: (id: string) => Promise<unknown>;
  /** Listens to an event by name; returns what stops it. */
  readonly on: (name: string, listener: (data: unknown) => void) => () => void;
  /** An error of the backend, in a sentence. */
  readonly describe: (error: unknown) => string;
  /** Whether an error says the session is not there any more. */
  readonly isGone: (error: unknown) => boolean;
  /** The typed code of an error of the backend (`SHELL_UNAVAILABLE`), when it has one. Nothing reads the words. */
  readonly codeOf: (error: unknown) => string | undefined;
};

export type ExecFeedOptions = {
  readonly transport: ExecTransport;
  /** Makes the session's id. Default: a random UUID. */
  readonly newId?: (() => string) | undefined;
  /** How long a size has to stand still before it is sent, in milliseconds. Default: `SETTLE_MS`. */
  readonly settleMs?: number | undefined;
  /** Where the host says what it could not do. Default: the console. */
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
};

export type ExecFeed = TerminalFeedHandle & { readonly id: string };

/** How long a size stands still before it is sent: a drag of the splitter is one message. */
export const SETTLE_MS = 100;

/** The most bytes of text one write call carries: a paste goes in calls of this size, each with its own number, so that no call is more than the host can take in (it holds at most 1 MiB for a session). */
export const CHUNK_BYTES = 65_536;

/**
 * The most bytes of writes that were sent and are not answered yet. It is a WINDOW that protects the host's own bound on what it holds for a session (1 MiB; past it the host refuses at once), and not an ordering queue:
 * the order is kept by the numbers, so a call goes out at once whatever is in flight, and only what does not fit in the window waits for room, in the order it was typed.
 */
export const WINDOW_BYTES = 524_288;

/**
 * The most calls (writes and sizes) that were sent and are not answered yet: the same window, for the host's other bounds. The host holds at most 256 operations for a session, and refuses a call more than 64 past the
 * number it waits for; a call is that far ahead only when more than 64 calls are out, and this keeps them to half as many. It matters more than it looks: a call refused because the host is full may never get in again (the
 * calls ahead of it can hold every place until the host gives its number up, after 2 s), so the windows stay below the host's bounds, which its answer to the call that made the session states (`limits`). What does not
 * fit waits, and goes together in one call, in order, as calls are answered.
 */
export const WINDOW_CALLS = 32;

/** How long a call the host refused for its backlog waits before it is sent again with the same number. The host gives up a number that does not come in 2,000 ms, far later than this. */
export const BACKLOG_RETRY_MS = 50;

/** How long a count of output that the host refused waits before the feed sends it again by itself: the host may have paused the shell for exactly that credit, and then no more output comes to carry it. */
export const ACK_RETRY_MS = 250;

/** The names of the events of a session (backend/pkg/plugin/exec/controller.go `dispatchOutput`). */
export const streamEvent = (id: string, target: 'stdout' | 'stderr'): string => `core/exec/stream/${target}/${id}`;
export const signalEvent = (id: string, signal: 'CLOSE' | 'ERROR'): string => `core/exec/signal/${signal}/${id}`;

const EMPTY: TerminalOutput = Object.freeze({ chunks: Object.freeze([]), bytes: 0 });
const IDLE: TerminalBusy = Object.freeze({ state: 'idle' });
const UNKNOWN: TerminalBusy = Object.freeze({ state: 'unknown' });
/** The most cells a size may have on a side: the host's own limit (`MaxDimension` in backend/pkg/terminal). The first size starts the process and the host refuses a larger one, and a feed whose start failed takes no later size. */
const MAX_CELLS = 1000;
/** The code of the host's refusal of a call because the session holds as much input as it may (429): the call was not applied and took no number, so the same call may be sent again (docs/ui-next/status/T1-go.md 2.4). */
const INPUT_BACKLOG = 'INPUT_BACKLOG';
const CLOSED_BY: readonly unknown[] = ['request', 'window', 'shutdown'] satisfies readonly TerminalClosedBy[];

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

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const worded = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** The shell the host started, by the name it gave in the answer to the call that started it (`terminal.Session.shell.name`); nothing when the answer does not say. */
function programOf(answer: unknown): string | undefined {
  if (typeof answer !== 'object' || answer === null) {
    return undefined;
  }

  const shell: unknown = Reflect.get(answer, 'shell');
  return typeof shell === 'object' && shell !== null ? worded(Reflect.get(shell, 'name')) : undefined;
}

/**
 * How a process ended, from the typed CLOSE payload (`terminal.End`, docs/ui-next/status/T1-go.md 2.2): the members of `exit` that it says, and nothing when it says none. Only an exit the page recognises says anything,
 * a capped drain included: a reason it does not know is a plain end, since the notice about what the host dropped belongs to a process whose end the page can state.
 */
function exitOf(data: Record<string, unknown>, reason: unknown): TerminalExit | undefined {
  if (reason !== 'exited' && reason !== 'signaled' && reason !== 'closed') {
    return undefined;
  }

  let exit: { -readonly [K in keyof TerminalExit]: TerminalExit[K] } = {};
  if (reason === 'exited') {
    const code = finite(Reflect.get(data, 'exit_code'));
    if (code !== undefined) {
      exit = { code };
    }
  } else if (reason === 'signaled') {
    const signal = worded(Reflect.get(data, 'signal'));
    if (signal !== undefined) {
      exit = { signal };
      const signalNumber = finite(Reflect.get(data, 'signal_number'));
      if (signalNumber !== undefined) {
        exit.signalNumber = signalNumber;
      }

      if (Reflect.get(data, 'core_dumped') === true) {
        exit.coreDumped = true;
      }
    }
  } else {
    const closedBy = Reflect.get(data, 'closed_by');
    if (CLOSED_BY.includes(closedBy)) {
      exit = { closedBy: closedBy as TerminalClosedBy };
    }
  }

  if (Reflect.get(data, 'drain_capped') === true) {
    exit.drainCapped = true;
    const dropped = finite(Reflect.get(data, 'dropped_bytes'));
    if (dropped !== undefined && dropped > 0) {
      exit.droppedBytes = dropped;
    }
  }

  return Object.keys(exit).length === 0 ? undefined : exit;
}

/**
 * What a CLOSE signal makes of the session: an end with what the host said of it, or a failure when the pty or the wait failed (the system's words). A payload the page cannot read (the older text, nothing, a
 * reason it does not know) is an end all the same, with nothing said of how.
 */
function endOf(data: unknown): TerminalFeedSnapshot {
  if (typeof data !== 'object' || data === null) {
    return { state: 'ended' };
  }

  const reason: unknown = Reflect.get(data, 'reason');
  if (reason === 'failed') {
    const failure: unknown = Reflect.get(data, 'failure');
    const message = typeof failure === 'object' && failure !== null ? Reflect.get(failure, 'message') : undefined;
    return { state: 'failed', cause: { stage: 'session', message: typeof message === 'string' ? message : '' } };
  }

  const exit = exitOf(data as Record<string, unknown>, reason);
  return exit === undefined ? { state: 'ended' } : { state: 'ended', exit };
}

/** What runs in the session, from the host's answer (`terminal.Foreground`, docs/ui-next/status/T1-go.md 2.3): anything the page cannot read is `unknown`, which a close treats as "ask". */
function busyOf(answer: unknown): TerminalBusy {
  if (typeof answer !== 'object' || answer === null) {
    return UNKNOWN;
  }

  const state: unknown = Reflect.get(answer, 'state');
  if (state === 'idle') {
    return IDLE;
  }

  if (state === 'busy') {
    const name = worded(Reflect.get(answer, 'name'));
    return name === undefined ? { state: 'busy' } : { state: 'busy', name };
  }

  return UNKNOWN;
}

let scratch: Uint8Array | undefined;

/**
 * How many UTF-16 units from the start of `text` make its first piece: the most that is at most `CHUNK_BYTES` bytes of UTF-8. A piece ends between characters, never inside one: a character of two units that was cut
 * in two would be written as two replacement characters.
 */
function pieceLength(text: string): number {
  // A unit is three bytes at the most (a pair of units, one four-byte character, is two a unit), so a text this short is a piece whole.
  if (text.length * 3 <= CHUNK_BYTES) {
    return text.length;
  }

  scratch ??= new Uint8Array(CHUNK_BYTES);
  // `encodeInto` stops where the next character does not fit. A window of `CHUNK_BYTES` units is at least that many bytes, so the window never ends the piece before the room does, and a pair of units it cuts is not taken.
  return new TextEncoder().encodeInto(text.length > CHUNK_BYTES ? text.slice(0, CHUNK_BYTES) : text, scratch).read;
}

export type Size = { readonly cols: number; readonly rows: number };

/** What `setTimeout` hands back: a number in a page, an object in Node, where the tests of this file also run. */
type Timer = ReturnType<typeof setTimeout>;

export function createExecFeed(options: ExecFeedOptions): ExecFeed {
  const { transport } = options;
  const id = (options.newId ?? newUuid)();
  const warn = options.warn ?? consoleWarn;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const held = createHeldOutput();
  const listeners = new Set<() => void>();
  const stops: Array<() => void> = [];
  /** The timers of the calls that wait to be sent again. */
  const retries = new Set<Timer>();
  let status: TerminalFeedSnapshot = { state: 'starting' };
  let created = false;
  let closing: Promise<void> | undefined;
  let woken = false;
  let warnedPayload = false;
  /** What the user typed that has not gone out yet, in order: it waits for the process to exist and, past the windows, for room. */
  let waiting = '';
  /** How many calls of `write` the feed took with something typed in them: what `inputs` says. */
  let typed = 0;
  /** The number the next call takes: ONE counter for the writes and the sizes of the session, from 1 (the host counts them the same way, docs/ui-next/status/T1-go.md 2.4). */
  let nextSeq = 1;
  /** Bytes of the writes that were sent and are not answered yet: what the window counts. */
  let flying = 0;
  /** Calls (writes and sizes) that were sent and are not answered yet: what the window of calls counts. */
  let calls = 0;
  let wanted: Size | undefined;
  let delivered: Size | undefined;
  let settling: Timer | undefined;
  let starting: Promise<void> | undefined;
  /** The backend has the first acknowledgement: its flow control is on. */
  let flowOn = false;
  let acking = false;
  /** Bytes the screen took in that the backend has not been told of yet. */
  let owed = 0;
  let warnedAck = false;
  /** The wait before a count the backend refused is sent again: ONE at a time, and none while a call is out. */
  let ackRetry: Timer | undefined;
  /** Nothing is left to credit: the backend said the session is not there, or would not turn its flow control on. */
  let stopped = false;

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

  const stopAckRetry = () => {
    if (ackRetry !== undefined) {
      clearTimeout(ackRetry);
      ackRetry = undefined;
    }
  };

  const stopRetrying = () => {
    for (const timer of retries) {
      clearTimeout(timer);
    }

    retries.clear();
    stopAckRetry();
  };

  /** Calls may be sent, and the answers of the calls that were sent matter: the process runs and nobody closed the feed. */
  const live = (): boolean => !closed() && status.state === 'running';

  /** Whether a call may go out now: the process runs, and fewer than `WINDOW_CALLS` calls are out. */
  const roomForCall = (): boolean => live() && calls < WINDOW_CALLS;

  /** The way out of a session that ended or failed: nothing is listened to, nothing is waited for, what was written stays readable. Once. */
  const over = (next: TerminalFeedSnapshot) => {
    if (closed() || status.state === 'ended' || status.state === 'failed') {
      return;
    }

    release();
    stopSettling();
    stopRetrying();
    waiting = '';
    status = next;
    tell();
  };

  const causeOf = (stage: TerminalFeedStage, error: unknown): TerminalFeedCause => {
    const message = transport.describe(error);
    const code = transport.codeOf(error);
    return code === undefined ? { stage, message } : { stage, message, code };
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

  /**
   * Sends one input call under the next number. The number is taken HERE, when the call is first sent, and every sending of it carries it: the host puts the calls in the order of their numbers, so this file never waits
   * for the answer of an earlier call. A call the host refuses with `INPUT_BACKLOG` was not applied and took no number: it is sent again, as it was, after a short delay, for as long as the session runs, and it stays in
   * the windows meanwhile. `bytes` is what the call adds to the window of bytes; `failed` says what any other refusal means.
   */
  const transmit = (bytes: number, send: (seq: number) => Promise<unknown>, failed: (error: unknown) => void) => {
    const seq = nextSeq;
    nextSeq += 1;
    flying += bytes;
    calls += 1;
    const attempt = () => {
      send(seq).then(
        () => {
          flying -= bytes;
          calls -= 1;
          flush();
        },
        (error: unknown) => {
          if (!live()) {
            return;
          }

          if (transport.codeOf(error) === INPUT_BACKLOG) {
            const timer = setTimeout(() => {
              retries.delete(timer);
              attempt();
            }, BACKLOG_RETRY_MS);
            retries.add(timer);
            return;
          }

          flying -= bytes;
          calls -= 1;
          failed(error);
          flush();
        },
      );
    };

    attempt();
  };

  /** Sends what the user typed, in order, in pieces of at most `CHUNK_BYTES`, for as long as the window has room for another piece. */
  const pump = () => {
    while (waiting !== '' && roomForCall() && flying + CHUNK_BYTES <= WINDOW_BYTES) {
      const length = pieceLength(waiting);
      const data = encodeInput(waiting.slice(0, length));
      waiting = waiting.slice(length);
      transmit(
        base64Size(data),
        async (seq) => transport.write(id, seq, data),
        (error) => {
          // A session that is not there takes nothing: it ended. Any other refusal leaves what was typed in doubt, and the session says so.
          over(transport.isGone(error) ? { state: 'ended' } : { state: 'failed', cause: causeOf('input', error) });
        },
      );
    }
  };

  /**
   * Tells the backend what the screen took in: ONE call in flight, and what was parsed meanwhile goes in the next, summed, so a flood is a few calls and every byte is told once. The first call turns the backend's
   * flow control on (it is made with the process, with nothing owed yet). A count the backend refuses once flow is on stays owed and goes again: with the next count the reader gives, or, when no output comes to carry
   * it (the host may be paused for exactly that credit, and a shell that is paused says nothing more), after `ACK_RETRY_MS` by itself, one wait at a time, until the host takes it, the feed is closed, or the session is
   * over or gone. A backend that refuses the FIRST call has no flow control to turn on (or would not): its transport's credit paces the shell, and a call for every parsed byte would help nobody, so none is made again.
   */
  const sendAck = () => {
    if (acking || stopped || closed() || !created || status.state !== 'running' || (flowOn && owed === 0)) {
      return;
    }

    // The call that goes out now stands in for a wait that was for the refused count: it carries it.
    stopAckRetry();
    const bytes = owed;
    owed = 0;
    acking = true;
    transport.ack(id, bytes).then(
      () => {
        acking = false;
        flowOn = true;
        sendAck();
      },
      (error: unknown) => {
        acking = false;
        if (closed() || transport.isGone(error)) {
          stopped = true;
          return;
        }

        if (!flowOn) {
          stopped = true;
          warn('[terminal] the host would not turn its flow control on; the shell is paced by what the transport takes', error);
          return;
        }

        owed += bytes;
        if (!warnedAck) {
          warnedAck = true;
          warn('[terminal] the host refused an acknowledgement of the output the screen took in; it may pause the shell', error);
        }

        // Nothing may come to carry the count (a paused shell writes nothing more), so it is sent again by itself, unless the session is over. A count may be sent twice (the host applied it and the answer was lost): the host clamps
        // what it is owed at zero, so a count replayed like that over-credits by at most the batch that failed and can never stall the shell.
        if (live()) {
          ackRetry ??= setTimeout(() => {
            ackRetry = undefined;
            sendAck();
          }, ACK_RETRY_MS);
        }
      },
    );
  };

  /** Sends the size the screen stands at, as its own call, when it is not the size the host has: the sizes are not held back by a call that is out. */
  const sendSize = () => {
    if (!roomForCall() || wanted === undefined) {
      return;
    }

    const size = wanted;
    if (delivered?.cols === size.cols && delivered.rows === size.rows) {
      return;
    }

    delivered = size;
    transmit(
      0,
      async (seq) => transport.resize(id, seq, size.rows, size.cols),
      (error) => {
        // A size the host refused tells nothing of the size it holds now (what it had before may be what an earlier refusal left it), so it is forgotten: whatever size is measured next is sent. A newer size that went out meanwhile
        // stands, since it is the one the host may have. The call that was refused is not repeated by itself, so a size that is still the one wanted waits to be measured again instead of going out at once from the `flush` that follows.
        if (delivered === size) {
          delivered = undefined;
          if (wanted === size) {
            wanted = undefined;
          }
        }

        // A session that is not there is told by its own close; the next size goes as it comes.
        if (!transport.isGone(error)) {
          warn('[terminal] the size of the screen could not be sent', error);
        }
      },
    );
  };

  /** Sends what can go now: a size that has stood still, then what the user typed. */
  const flush = () => {
    if (settling === undefined) {
      sendSize();
    }

    pump();
  };

  /** Starts the process on a pty of the size the view measured, so that nothing is resized after it started. Once. */
  const start = (size: Size) => {
    if (starting !== undefined || closed()) {
      return;
    }

    delivered = size;
    starting = transport.create(id, size).then(
      (answer: unknown) => {
        created = true;
        if (closed() || status.state !== 'starting') {
          return;
        }

        const program = programOf(answer);
        status = program === undefined ? { state: 'running' } : { state: 'running', program };
        tell();
        // A size that came while the process was starting waits for its own settling; one that has stood still is sent now, and then what was typed before the process existed: the first numbers are taken here.
        flush();
        // The backend's flow control is turned on with the process: a terminal that nobody reads is paced from its first prompt.
        sendAck();
      },
      (error: unknown) => {
        if (!closed()) {
          over({ state: 'failed', cause: causeOf('start', error) });
        }
      },
    );
  };

  // Every listener first, then the process.
  stops.push(
    transport.on(streamEvent(id, 'stdout'), onOutput),
    transport.on(streamEvent(id, 'stderr'), onOutput),
    transport.on(signalEvent(id, 'CLOSE'), (data) => {
      over(endOf(data));
    }),
    transport.on(signalEvent(id, 'ERROR'), (data) => {
      over({ state: 'failed', cause: { stage: 'session', message: signalMessage(data) } });
    }),
  );

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
      return { chunks: taken.texts.map(decodeBase64), bytes: taken.bytes };
    },

    ack: (bytes) => {
      const count = Number.isFinite(bytes) ? Math.floor(bytes) : 0;
      if (count < 1 || closed() || status.state === 'ended' || status.state === 'failed') {
        return;
      }

      owed += count;
      sendAck();
    },

    busy: async () => {
      if (closed() || status.state !== 'running') {
        return IDLE;
      }

      try {
        return busyOf(await transport.busy(id));
      } catch (error) {
        // A session the backend says is gone has nothing running in it; a question that failed is a question not answered.
        return transport.isGone(error) ? IDLE : UNKNOWN;
      }
    },

    write: (text) => {
      if (closed() || (status.state !== 'running' && status.state !== 'starting')) {
        return;
      }

      if (text !== '') {
        typed += 1;
      }

      waiting += text;
      pump();
    },

    inputs: () => typed,

    // Nothing typed waits for the process or for room, and none of it is in flight (a call the host refused for its backlog stays in flight until it is taken); a session that is over sends nothing more, so nothing is left to wait for.
    inputsSettled: () => closed() || status.state === 'ended' || status.state === 'failed' || (waiting === '' && flying === 0),

    resize: (cols, rows) => {
      const size = { cols: Math.floor(cols), rows: Math.floor(rows) };
      if (closed() || !(size.cols >= 1 && size.cols <= MAX_CELLS && size.rows >= 1 && size.rows <= MAX_CELLS) || status.state === 'ended' || status.state === 'failed') {
        return;
      }

      wanted = size;
      // The first size starts the process.
      if (starting === undefined) {
        start(size);
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
      stopRetrying();
      held.clear();
      waiting = '';
      closing = (starting ?? Promise.resolve()).then(async () => {
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

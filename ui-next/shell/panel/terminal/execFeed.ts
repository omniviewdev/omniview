import { MAX_INPUT_BYTES, type ChannelLink, type TerminalChannels } from './channel';
import type { TerminalBusy, TerminalClosedBy, TerminalExit, TerminalFeedCause, TerminalFeedHandle, TerminalFeedSnapshot, TerminalFeedStage, TerminalModes, TerminalOutput, TerminalReplay } from './feed';
import { createHeldOutput } from './heldOutput';

// A terminal of the host as a feed, over the terminal channel (docs/ui-next/terminal-channel-protocol.md; `channel.ts` is the contract with the one place that holds the capabilities and the streams). It is the one place the
// rules of a terminal's wire live, framework-free and without xterm:
//
//   - the id of the terminal is chosen HERE, and the terminal is made at the first size the view measured, so the shell lays out its first prompt for it and nothing is resized after it started (a terminal whose view never
//     measures is never made). The stream opens once the host has made it, and the feed is `running` when the host's `ready` says so;
//   - what the shell writes comes as bytes with offsets, in one ordered stream, and is held exactly as it came (nothing decoded, nothing dropped) and wakes a listener once between two reads, so a flood costs a push per frame and
//     a hidden terminal costs no more. What bounds it is the HOST's flow control: the first acknowledgement, of nothing, turns the host's window on as soon as the stream is ready, and the feed acknowledges every byte the
//     reader parsed of what the shell wrote LIVE. The bytes of a replay are credited as they arrive (the host counts every output frame against its window), a gap's never;
//   - what the user types goes out in input frames of at most `MAX_INPUT_BYTES`, in the order it was typed: the order is the stream's, so nothing is numbered, windowed or sent again. What is typed before the stream is
//     ready, or while it is connecting again, waits and goes after `ready`;
//   - the size STARTS the terminal and is then settled (`settleMs`: a drag is one frame), sent once the stream is ready, rows and columns together;
//   - the feed that MADE its terminal treats every byte as live: nothing is replayed to it and nothing is muted. A feed that ATTACHES (a page after a reload, a take-back) is given `[ready.start, ready.end)` as one replay for
//     a fresh emulator (`takeReplay`, taken once before any live output; `read` gives nothing until then), and the bytes after it are live;
//   - a stream that dropped is opened again from the offset the feed has applied up to, after 250 ms, one second and four seconds, and then the feed fails in words. The host answers with `lost` what of that it no longer has:
//     none, and the output continues; some, and the reader is given a fresh replay. A `gap` is the host saying the bytes in between were overwritten before they were sent: the reader is given a replay of nothing at its end,
//     which resets the emulator. What the reader parsed of a stream that is over is not credited to the next one (`forgiven`);
//   - the host's word that another stream took the terminal ends the feed for this page (`detached`), input off, and the terminal is told apart from one that ended: `refresh` asks the host whether it is free to take back. A
//     terminal the host does not know ends the feed in words; how a terminal ended (the typed `ended` frame) is read in ONE place and kept in the status;
//   - `leave` (the page is going) sends the detach frame; `redraw` makes a full-screen program draw itself again. A close ends the terminal exactly once (a terminal that ended by itself is dismissed instead), and every
//     listener and timer is released on every way out (docs/ui-next/optimisations.md HLT-28).

/** What takes a terminal over: its id, the shell the listing named, which names the session until the host says, and whether the listing said it had ended. The feed attaches at once; its id is the terminal's, and `newId` is not asked. */
export type ExecAttach = {
  readonly id: string;
  readonly program?: string | undefined;
  /** The host listed how the terminal ended: it is kept, with its output, until a page dismisses it. */
  readonly ended?: boolean | undefined;
};

export type ExecFeedOptions = {
  readonly channels: TerminalChannels;
  /** A terminal this page already has, taken over instead of made. Absent: the feed makes one, at the first size the view measures. */
  readonly attach?: ExecAttach | undefined;
  /** Makes the terminal's id. Default: a random UUID. */
  readonly newId?: (() => string) | undefined;
  /** How long a size has to stand still before it is sent, in milliseconds. Default: `SETTLE_MS`. */
  readonly settleMs?: number | undefined;
  /** Where the host says what it could not do. Default: the console. */
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
  /** How long the host keeps a terminal this feed made once no stream holds it, in milliseconds. Absent: the host's own. */
  readonly leaseMs?: number | undefined;
  /** How long the feed waits before it connects again after each stream that dropped; the feed fails when they are used up. Default: `RECONNECT_DELAYS_MS`. */
  readonly reconnectDelaysMs?: readonly number[] | undefined;
};

export type ExecFeed = TerminalFeedHandle & { readonly id: string };

/** How long a size stands still before it is sent: a drag of the splitter is one message. */
export const SETTLE_MS = 100;

/** How long the feed waits before it connects again, after the first, the second and the third stream that dropped without a word of the host (docs/ui-next/terminal-channel-protocol.md section 11). */
export const RECONNECT_DELAYS_MS: readonly number[] = [250, 1_000, 4_000];

const EMPTY: TerminalOutput = Object.freeze({ chunks: Object.freeze([]), bytes: 0 });
const IDLE: TerminalBusy = Object.freeze({ state: 'idle' });
const UNKNOWN: TerminalBusy = Object.freeze({ state: 'unknown' });
/** The most cells a size may have on a side: the host's own limit (`MaxDimension` in backend/pkg/terminal). The first size makes the terminal and the host refuses a larger one, and a feed whose start failed takes no later size. */
const MAX_CELLS = 1000;
const CLOSED_BY: readonly unknown[] = ['request', 'window', 'shutdown', 'detach-timeout'] satisfies readonly TerminalClosedBy[];
/** What the session says when the output of the terminal did not come in order: it never says where, since the person cannot do anything with an offset. */
const OUTPUT_GAP = 'Some of the terminal\'s output did not arrive.';
/** What the session says when the host's first frame was something the page cannot join the output to. */
const UNREADABLE_ATTACH = 'The terminal could not be taken over: the host\'s answer was not understood.';
/** What the session says when the host does not know the terminal: it ended while this window was away, or its capability is not valid any more. */
const TERMINAL_GONE = 'The terminal is not there any more: the host ended it while this window was away.';
/** What the session says when the stream of the terminal dropped and could not be opened again. The terminal may still run: a reload may find it. */
const CONNECTION_LOST = 'The connection to the terminal was lost.';

/** The platform's `crypto`, which every engine the app runs in has, and a test environment may not. */
const platform: { readonly crypto?: Crypto | undefined } = globalThis;
let counter = 0;

/** A new id for a terminal: a random UUID, or, where the platform has none, the clock and a counter, which is unique within a run. A terminal that outlives its page is named before it starts (the panel session that shows it takes the same id). */
export function newTerminalId(): string {
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
 * How many UTF-16 units from the start of `text` make its first piece: the most that is at most `MAX_INPUT_BYTES` bytes of UTF-8. A piece ends between characters, never inside one: a character of two units that was cut
 * in two would be written as two replacement characters.
 */
function pieceLength(text: string): number {
  // A unit is three bytes at the most (a pair of units, one four-byte character, is two a unit), so a text this short is a piece whole.
  if (text.length * 3 <= MAX_INPUT_BYTES) {
    return text.length;
  }

  scratch ??= new Uint8Array(MAX_INPUT_BYTES);
  // `encodeInto` stops where the next character does not fit. A window of `MAX_INPUT_BYTES` units is at least that many bytes, so the window never ends the piece before the room does, and a pair of units it cuts is not taken.
  return new TextEncoder().encodeInto(text.length > MAX_INPUT_BYTES ? text.slice(0, MAX_INPUT_BYTES) : text, scratch).read;
}

/** The two sizes are the same size: they have the same columns and the same rows, whichever measurement each came from. */
const sameSize = (one: Size, other: Size): boolean => one.cols === other.cols && one.rows === other.rows;

/** A size the host states: whole cells, at least one in each direction. Anything else is no size. */
function sizeOfWire(value: unknown): Size | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const cols = finite(Reflect.get(value, 'cols'));
  const rows = finite(Reflect.get(value, 'rows'));
  return cols !== undefined && rows !== undefined && Number.isInteger(cols) && Number.isInteger(rows) && cols >= 1 && rows >= 1 ? { cols, rows } : undefined;
}

/** The modes the host states (`terminal.TerminalModes`): what it does not say is off, and the stack of the keyboard protocol is at most 16 flags of whole numbers. */
function modesOf(value: unknown): TerminalModes {
  if (typeof value !== 'object' || value === null) {
    return { altScreen: false, bracketedPaste: false, applicationCursor: false, focusEvents: false, cursorHidden: false, mouseTracking: 0, mouseEncoding: 0, kittyKeyboard: [] };
  }

  const flag = (name: string): boolean => Reflect.get(value, name) === true;
  const count = (name: string): number => {
    const number = finite(Reflect.get(value, name));
    return number !== undefined && Number.isInteger(number) && number >= 0 ? number : 0;
  };

  const stack: unknown = Reflect.get(value, 'kitty_keyboard');
  const kitty = Array.isArray(stack) ? (stack as unknown[]).filter((entry): entry is number => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0).slice(0, 16) : [];
  return {
    altScreen: flag('alt_screen'),
    bracketedPaste: flag('bracketed_paste'),
    applicationCursor: flag('application_cursor'),
    focusEvents: flag('focus_events'),
    cursorHidden: flag('cursor_hidden'),
    mouseTracking: count('mouse_tracking'),
    mouseEncoding: count('mouse_encoding'),
    kittyKeyboard: kitty,
  };
}

/** The result of a session that ended, named by the shell it ran when it is known. */
function withProgram(result: TerminalFeedSnapshot, program: string | undefined): TerminalFeedSnapshot {
  return result.state === 'ended' && program !== undefined ? { ...result, program } : result;
}

/**
 * One terminal of what the host lists for a page key (`terminal.Listed`, T2-go 2.2), as far as the page needs it: its id, the shell it runs, whether a window holds it now (`attached`, when the host says), and `ended` when
 * the host lists how it ended: its shell ended while no page held it, and the host keeps it, with its output, for the rest of its lease. `ended` is left out for a terminal that runs.
 */
export type ListedTerminal = {
  readonly id: string;
  readonly program?: string | undefined;
  /** Whether a window holds the terminal now. A terminal that this page lost, and that no window holds, is free (`refresh`). Left out when the host does not say. */
  readonly attached?: boolean | undefined;
  readonly ended?: boolean | undefined;
};

/** The terminals the host listed for the page's key, in the order it gave them (by creation). What is not a terminal (no id) is left out, and an answer that is not a list lists none. */
export function listedOf(answer: unknown): readonly ListedTerminal[] {
  if (!Array.isArray(answer)) {
    return [];
  }

  const terminals: ListedTerminal[] = [];
  for (const item of answer as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const terminal: unknown = Reflect.get(item, 'id');
    if (typeof terminal !== 'string' || terminal.trim() === '') {
      continue;
    }

    const program = programOf(item);
    const attached: unknown = Reflect.get(item, 'attached');
    const ended: unknown = Reflect.get(item, 'ended');
    terminals.push({
      id: terminal,
      ...(program === undefined ? {} : { program }),
      ...(typeof attached === 'boolean' ? { attached } : {}),
      ...(typeof ended === 'object' && ended !== null ? { ended: true } : {}),
    });
  }

  return terminals;
}

export type Size = { readonly cols: number; readonly rows: number };

/** What `setTimeout` hands back: a number in a page, an object in Node, where the tests of this file also run. */
type Timer = ReturnType<typeof setTimeout>;

/** What the host's `ready` says, as far as the feed uses it. */
type Ready = {
  readonly start: number;
  readonly end: number;
  readonly lost: number;
  readonly size: Size;
  readonly startSize: Size;
  readonly modes: TerminalModes;
  readonly startModes: TerminalModes;
  readonly program: string | undefined;
  /** How the terminal ended, when the host's `ready` says it had: its `ended` frame follows the replay. */
  readonly ended: unknown;
};

/**
 * The host's first frame, read. Nothing is guessed: a frame that does not say where its bytes lie in the terminal's output (whole numbers, `end` not before `start`) or the size the terminal has cannot be joined exactly,
 * and is no answer. `start_size` defaults to the size when the host leaves it out, and the modes to nothing on.
 */
function readyOf(value: unknown): Ready | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const start = finite(Reflect.get(value, 'start'));
  const end = finite(Reflect.get(value, 'end'));
  const said: unknown = Reflect.get(value, 'lost');
  const lost = said === undefined ? 0 : finite(said);
  const size = sizeOfWire(Reflect.get(value, 'size'));
  if (start === undefined || end === undefined || lost === undefined || size === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(lost) || start < 0 || end < start || lost < 0) {
    return undefined;
  }

  const ended: unknown = Reflect.get(value, 'ended');
  return {
    start,
    end,
    lost,
    size,
    startSize: sizeOfWire(Reflect.get(value, 'start_size')) ?? size,
    modes: modesOf(Reflect.get(value, 'modes')),
    startModes: modesOf(Reflect.get(value, 'start_modes')),
    program: programOf(Reflect.get(value, 'session')),
    ended: typeof ended === 'object' && ended !== null ? ended : undefined,
  };
}

/** The bytes of the pieces, as one array. */
function joined(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}

/** The replay the host is still sending: `[start, end)`, as the pieces that came, and what the terminal was under when its first byte was written and is under at its end. */
type Gathering = {
  start: number;
  end: number;
  parts: Uint8Array[];
  startSize: Size;
  startModes: TerminalModes;
  readonly size: Size;
  readonly modes: TerminalModes;
};

/** What the host did with the terminal this feed shows, which decides what a close does with it: it is this page's to end (`ours`), it ended by itself and the host keeps its end until a page forgets it (`dismiss`), or it is not this page's (taken by another, gone, left for the page that comes back). */
type Fate = 'ours' | 'dismiss' | 'not-ours';

export function createExecFeed(options: ExecFeedOptions): ExecFeed {
  const { channels } = options;
  const attachTo = options.attach;
  const id = attachTo?.id ?? (options.newId ?? newTerminalId)();
  const warn = options.warn ?? consoleWarn;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const delays = options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
  const held = createHeldOutput();
  const encoder = new TextEncoder();
  const listeners = new Set<() => void>();
  const listed = attachTo?.program;
  let status: TerminalFeedSnapshot = listed === undefined ? { state: 'starting' } : { state: 'starting', program: listed };
  /** The host has the terminal: the call that made it was answered, or it is a terminal this page attaches to. A close of a terminal the host never made has nothing to end. */
  let created = attachTo !== undefined;
  let started = attachTo !== undefined;
  /** The call that makes the terminal, while it is out: a close waits for it, so that what the host made is ended. */
  let creating: Promise<void> | undefined;
  let createdProgram: string | undefined;
  let fate: Fate = 'ours';
  let closing: Promise<void> | undefined;
  let woken = false;
  let warnedRefresh = false;
  /** The page left the terminal for the page that comes back (`leave`): it is no longer this page's to write to, to size or to end. */
  let left = false;
  /** What the user typed that has not gone out yet, in order: it waits for the stream to be ready. */
  let waiting = '';
  /** How many calls of `write` the feed took with something typed in them: what `inputs` says. */
  let typed = 0;
  let wanted: Size | undefined;
  /** The size the host has: the one the terminal was made at, the host's own at `ready`, then the last one sent. */
  let delivered: Size | undefined;
  /** The size one cell off the one the screen stands at, owed to the host before that size (`redraw`). */
  let bounce: Size | undefined;
  let settling: Timer | undefined;
  /** The size and the modes the terminal was last said to be in: what a gap's replay brings the screen to. */
  let size: Size = { cols: 80, rows: 24 };
  let modes: TerminalModes = modesOf(undefined);

  /** The stream now open, or `undefined` while the feed waits to connect again, and the object that tells its events from those of a stream that was let go. */
  let link: ChannelLink | undefined;
  let connection: Record<string, unknown> | undefined;
  /** The stream has said `ready`: what the feed sends goes only now. */
  let streaming = false;
  /** How the terminal ended, when the host's `ready` said it had. */
  let readyEnded: unknown;
  let attempts = 0;
  let retry: Timer | undefined;
  /** The offset the feed has applied up to: what a stream that drops is connected again from. A terminal the feed made starts at 0; one it attaches to has nothing until its replay is complete. */
  let next: number | undefined = attachTo === undefined ? 0 : undefined;
  /** Where the next frame of the stream now open must start. */
  let cursor = 0;
  /** The replay of `[start, end)` that is still arriving, and the one that is complete and waits for the reader. */
  let gathering: Gathering | undefined;
  let awaiting: TerminalReplay | undefined;
  /** Bytes the screen took in that the host has not been told of yet. */
  let owed = 0;
  /** What the reader was given of live output and has not acknowledged: the output held unread, and the output read and not yet parsed. */
  let outstanding = 0;
  /** How many of the bytes the reader acknowledges next are bytes of a stream that is over: the host's window of the new stream started at nothing, so they are not passed on. */
  let forgiven = 0;
  let refreshing: Promise<void> | undefined;

  const closed = (): boolean => closing !== undefined;

  const finished = (): boolean => status.state === 'ended' || status.state === 'failed';

  const tell = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  /** Wakes the listeners once, until the reader has read. */
  const wake = () => {
    if (!woken) {
      woken = true;
      tell();
    }
  };

  /** The reader must come, whether or not a wake-up is pending: a replay waits for it. */
  const wakeForReplay = () => {
    woken = true;
    tell();
  };

  const stopSettling = () => {
    if (settling !== undefined) {
      clearTimeout(settling);
      settling = undefined;
    }
  };

  const stopRetry = () => {
    if (retry !== undefined) {
      clearTimeout(retry);
      retry = undefined;
    }
  };

  /** Nothing more is sent: the size that was settling, what was typed and waits, the connection that was to be made again, and a redraw that was owed. */
  const dropOutgoing = () => {
    stopSettling();
    stopRetry();
    waiting = '';
    bounce = undefined;
  };

  /** Lets go of the stream: its events are no longer heard, and the host is told the page is done with it unless the stream is over already. */
  const unlink = (close: boolean) => {
    connection = undefined;
    streaming = false;
    gathering = undefined;
    if (close) {
      link?.close();
    }

    link = undefined;
  };

  /** Frames may be sent now: the stream said ready, this page holds the terminal, and nobody closed the feed. */
  const usable = (): boolean => !closed() && !left && status.state === 'running' && streaming && link !== undefined;

  /** The way out of a session that ended or failed: nothing is listened to, nothing is waited for, what was written stays readable. Once. */
  const over = (result: TerminalFeedSnapshot, closeStream = false) => {
    if (closed() || finished()) {
      return;
    }

    unlink(closeStream);
    dropOutgoing();
    status = result;
    tell();
  };

  const causeOf = (stage: TerminalFeedStage, error: unknown): TerminalFeedCause => {
    const message = channels.describe(error);
    const code = channels.codeOf(error);
    const tried = channels.triedOf(error);
    return { stage, message, ...(code === undefined ? {} : { code }), ...(tried === undefined || tried.length === 0 ? {} : { tried }) };
  };

  /** The feed gives the stream up in words: what the host sent cannot be joined to what the screen shows. The terminal may still run, so a close ends it. */
  const failStream = (message: string, stage: TerminalFeedStage = 'session') => {
    over({ state: 'failed', cause: { stage, message } }, true);
  };

  /** Makes a terminal this page lost free, or held again: the snapshot changes, and the listeners are told, only when that changes something. */
  const setFree = (free: boolean) => {
    const current = status.detached;
    if (current === undefined || (current.free === true) === free) {
      return;
    }

    status = { ...status, detached: free ? { by: current.by, free } : { by: current.by } };
    tell();
  };

  /** Sends what the screen took in, as the reader gives it: one frame for each count, to the stream that delivered what it counts. */
  const sendAck = () => {
    if (owed > 0 && usable()) {
      const count = owed;
      owed = 0;
      link?.ack(count);
    }
  };

  /** Sends what the user typed, in order, in frames of at most `MAX_INPUT_BYTES`. */
  const pump = () => {
    while (waiting !== '' && usable()) {
      const length = pieceLength(waiting);
      const piece = encoder.encode(waiting.slice(0, length));
      waiting = waiting.slice(length);
      link?.input(piece);
    }
  };

  /** One size, as its own frame. */
  const sendResize = (target: Size) => {
    delivered = target;
    link?.resize(target.cols, target.rows);
  };

  /** Sends the size the screen stands at, when it is not the size the host has. A size owed for a redraw goes first. */
  const sendSize = () => {
    if (!usable()) {
      return;
    }

    if (bounce !== undefined) {
      const off = bounce;
      bounce = undefined;
      sendResize(off);
    }

    if (wanted === undefined || (delivered !== undefined && sameSize(delivered, wanted))) {
      return;
    }

    sendResize(wanted);
  };

  /** Sends what can go now: a size that has stood still, then what the user typed. */
  const flush = () => {
    if (settling === undefined) {
      sendSize();
    }

    pump();
  };

  /** The replay is complete: the reader is given it once, before any live output. The feed has applied up to its end. */
  const publish = (end: number, replay: Omit<TerminalReplay, 'end'>) => {
    awaiting = { ...replay, end };
    next = end;
    wakeForReplay();
  };

  const publishGathered = () => {
    const replay = gathering;
    gathering = undefined;
    if (replay !== undefined) {
      publish(cursor, { data: joined(replay.parts), startSize: replay.startSize, startModes: replay.startModes, size: replay.size, modes: replay.modes });
    }
  };

  const onReady = (said: unknown) => {
    const ready = readyOf(said);
    if (ready === undefined || streaming) {
      failStream(UNREADABLE_ATTACH, 'start');
      return;
    }

    // With bytes applied and none lost the output continues where it was; with nothing applied, or with bytes lost, the host's ring is a replay for a fresh screen.
    const resumed = next !== undefined && ready.lost === 0;
    if (resumed && ready.start !== next) {
      warn(`[terminal] the output of the terminal does not join: it continues at offset ${String(ready.start)} and the feed is at ${String(next)}`);
      failStream(OUTPUT_GAP);
      return;
    }

    streaming = true;
    attempts = 0;
    readyEnded = ready.ended;
    size = ready.size;
    modes = ready.modes;
    delivered = ready.size;
    cursor = ready.start;
    // The host's window for this stream starts at nothing: what the reader parsed of a stream that is over is not credited to it.
    owed = 0;
    if (!resumed) {
      outstanding = Math.max(0, outstanding - held.bytes());
      held.clear();
      awaiting = undefined;
      gathering = { start: ready.start, end: ready.end, parts: [], startSize: ready.startSize, startModes: ready.startModes, size: ready.size, modes: ready.modes };
    }

    forgiven = outstanding;
    if (status.state === 'starting') {
      const program = ready.program ?? createdProgram ?? status.program;
      status = program === undefined ? { state: 'running' } : { state: 'running', program };
      tell();
    }

    link?.ack(0);
    if (gathering !== undefined && ready.end === ready.start) {
      publishGathered();
    }

    flush();
    sendAck();
  };

  const onOutput = (offset: number, bytes: Uint8Array) => {
    if (!streaming) {
      failStream(UNREADABLE_ATTACH, 'start');
      return;
    }

    if (offset !== cursor || (gathering !== undefined && offset + bytes.length > gathering.end)) {
      warn(`[terminal] the output of the terminal does not join: a frame came at offset ${String(offset)} and the feed is at ${String(cursor)}`);
      failStream(OUTPUT_GAP);
      return;
    }

    if (bytes.length === 0) {
      return;
    }

    cursor += bytes.length;
    if (gathering !== undefined) {
      gathering.parts.push(bytes);
      // The host counts every output frame against its window, a replay's too: they are credited as they arrive, since the reader takes the replay only when it is complete (a replay larger than the window would never be).
      owed += bytes.length;
      sendAck();
      if (cursor === gathering.end) {
        publishGathered();
      }

      return;
    }

    next = cursor;
    outstanding += bytes.length;
    held.push(bytes);
    wake();
  };

  /** The host overwrote `[from, to)` before it sent it: what the screen shows cannot be continued, so it is brought to `to` by a replay of nothing, which resets it. */
  const onGap = (from: number, to: number) => {
    if (!streaming || from !== cursor || to < from) {
      warn(`[terminal] the output of the terminal does not join: a gap came from offset ${String(from)} and the feed is at ${String(cursor)}`);
      failStream(OUTPUT_GAP);
      return;
    }

    cursor = to;
    if (gathering !== undefined) {
      // The bytes gathered so far are not the terminal: the replay starts again at `to`, and is over when `to` is at its end or past it.
      gathering.parts = [];
      gathering.startSize = gathering.size;
      gathering.startModes = gathering.modes;
      gathering.start = to;
      if (to >= gathering.end) {
        gathering.end = to;
        publishGathered();
      }

      return;
    }

    // What the host delivered and the reader never got is credited at once, but for what a stream that is over delivered, which has nobody to credit.
    const dropped = held.bytes();
    held.clear();
    const read = outstanding - dropped;
    const older = Math.max(0, forgiven - read);
    forgiven -= older;
    owed += dropped - older;
    outstanding = read;
    publish(to, { data: new Uint8Array(0), startSize: size, startModes: modes, size, modes });
    sendAck();
  };

  const onEnded = (end: unknown) => {
    unlink(false);
    fate = 'dismiss';
    publishGatheredIfAny();
    const result = endOf(end);
    over(withProgram(result, status.program));
  };

  const publishGatheredIfAny = () => {
    if (gathering !== undefined) {
      publishGathered();
    }
  };

  /** Another stream took the terminal: it ends for this page, with input off, and is told apart from one that ended. */
  const onTakenOver = () => {
    unlink(false);
    fate = 'not-ours';
    const { program } = status;
    over(program === undefined ? { state: 'ended', detached: { by: 'taken-over' } } : { state: 'ended', program, detached: { by: 'taken-over' } });
  };

  const onNotFound = () => {
    unlink(false);
    fate = 'not-ours';
    over({ state: 'failed', cause: { stage: 'session', message: TERMINAL_GONE } });
  };

  const connectAgain = () => {
    retry = undefined;
    if (closed() || left || finished()) {
      return;
    }

    connect(next);
  };

  /** The stream ended with no word of the host: when the host had said the terminal ended that is its end, and otherwise it is connected again from the offset the feed has, and then given up in words. */
  const onClosed = () => {
    const midReplay = gathering !== undefined;
    unlink(false);
    // A terminal that had ended ends the feed only with its whole replay: a stream that dropped before that is connected again, from nothing.
    const hint = midReplay ? undefined : (readyEnded ?? (attachTo?.ended === true ? {} : undefined));
    if (hint !== undefined) {
      fate = 'dismiss';
      over(withProgram(endOf(hint), status.program));
      return;
    }

    const delay = delays[attempts];
    if (delay === undefined) {
      over({ state: 'failed', cause: { stage: 'session', message: CONNECTION_LOST } });
      return;
    }

    attempts += 1;
    retry = setTimeout(connectAgain, delay);
  };

  /** Opens a stream to the terminal from `from`, the offset the feed has applied up to (`undefined`: nothing). Every event is heard only while this stream is the one that is open. */
  function connect(from: number | undefined): void {
    const mine = {};
    connection = mine;
    const heard =
      <Args extends unknown[]>(listener: (...args: Args) => void) =>
        (...args: Args): void => {
          if (connection === mine && !closed()) {
            listener(...args);
          }
        };

    try {
      link = channels.connect(id, from, {
        ready: heard(onReady),
        output: heard(onOutput),
        gap: heard(onGap),
        ended: heard(onEnded),
        takenOver: heard(onTakenOver),
        notFound: heard(onNotFound),
        closed: heard(onClosed),
      });
    } catch (error) {
      connection = undefined;
      over({ state: 'failed', cause: causeOf('start', error) });
    }
  }

  /** Makes the terminal at the size the view measured, so that nothing is resized after it started. Once. */
  const start = (first: Size) => {
    started = true;
    delivered = first;
    creating = channels.create(id, { cols: first.cols, rows: first.rows, ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }) }).then(
      (answer: unknown) => {
        created = true;
        createdProgram = programOf(answer);
        if (!closed() && !left && status.state === 'starting') {
          connect(next);
        }
      },
      (error: unknown) => {
        if (!closed()) {
          over({ state: 'failed', cause: causeOf('start', error) });
        }
      },
    );
  };

  /**
   * Asks the host who holds a terminal this page LOST (`ListChannelTerminals` of its capability) and nothing more: it never attaches, never takes the terminal over and never throws. A terminal that no stream holds is
   * `free` (the tab that took it has let it go while this page was not told), and one that a stream holds is not; a terminal the host lists as ended is not free either, since nobody can take it back. A terminal the
   * host has no entry for, an entry that does not say, and a call that fails change nothing (a failure is said once). Only for a lost terminal whose end is not known, and one call at a time: a second call shares the one that is out.
   */
  const refresh = async (): Promise<void> => {
    if (closed() || status.detached === undefined || status.exit !== undefined) {
      return;
    }

    refreshing ??= (async () => {
      try {
        // The call is made inside the promise, so that a channel that throws instead of rejecting is a failure like any other.
        const entry = await new Promise<unknown>((resolve) => {
          resolve(channels.listed(id));
        });
        // What the page learned meanwhile stands: a feed that was closed, or whose terminal ended, has nothing to change.
        if (closed() || status.detached === undefined || status.exit !== undefined || typeof entry !== 'object' || entry === null) {
          return;
        }

        const ended: unknown = Reflect.get(entry, 'ended');
        const attached: unknown = Reflect.get(entry, 'attached');
        if (typeof ended === 'object' && ended !== null) {
          setFree(false);
        } else if (typeof attached === 'boolean') {
          setFree(!attached);
        }
      } catch (error) {
        if (!warnedRefresh) {
          warnedRefresh = true;
          warn('[terminal] the host could not say who holds the terminal this page lost', error);
        }
      } finally {
        refreshing = undefined;
      }
    })();
    await refreshing;
  };

  /** The page is going away, and its terminal is left for the page that comes back: the detach frame, once; nothing is sent or connected from now on, and a `close` after it does not end the terminal. */
  const leave = () => {
    if (left || closed() || finished()) {
      return;
    }

    left = true;
    link?.detach();
    unlink(false);
    dropOutgoing();
  };

  /** Makes a full-screen program draw itself again: the size one cell off and then the size the screen stands at (or the one the host has), at once and not waiting for the settling. A terminal of one cell has no size one cell off. */
  const redraw = () => {
    const real = wanted ?? delivered;
    if (!usable() || real === undefined) {
      return;
    }

    const off = real.cols > 1 ? { cols: real.cols - 1, rows: real.rows } : real.rows > 1 ? { cols: real.cols, rows: real.rows - 1 } : undefined;
    if (off === undefined) {
      return;
    }

    wanted = real;
    bounce = off;
    stopSettling();
    sendSize();
  };

  // A terminal this page already has is taken over at once, and not when a size is measured.
  if (attachTo !== undefined) {
    connect(undefined);
  }

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
      if (closed() || awaiting !== undefined || gathering !== undefined) {
        return EMPTY;
      }

      return held.take(max);
    },

    ack: (bytes) => {
      const count = Number.isFinite(bytes) ? Math.floor(bytes) : 0;
      if (count < 1 || closed() || left || finished()) {
        return;
      }

      outstanding = Math.max(0, outstanding - count);
      // The first bytes the reader acknowledges after a new stream are the ones the stream before it delivered: the host of the new one does not owe credit for them.
      const forgotten = Math.min(forgiven, count);
      forgiven -= forgotten;
      owed += count - forgotten;
      sendAck();
    },

    busy: async () => {
      if (closed() || left || status.state !== 'running') {
        return IDLE;
      }

      try {
        return busyOf(await channels.busy(id));
      } catch (error) {
        // A terminal the host says is gone has nothing running in it; a question that failed is a question not answered.
        return channels.isGone(error) ? IDLE : UNKNOWN;
      }
    },

    write: (text) => {
      if (closed() || left || (status.state !== 'running' && status.state !== 'starting')) {
        return;
      }

      if (text !== '') {
        typed += 1;
      }

      waiting += text;
      pump();
    },

    inputs: () => typed,

    // Nothing typed waits for the stream, and nothing sent waits in the link; a session that is over sends nothing more, so nothing is left to wait for.
    inputsSettled: () => closed() || finished() || (waiting === '' && (link?.pending() ?? 0) === 0),

    resize: (cols, rows) => {
      const target = { cols: Math.floor(cols), rows: Math.floor(rows) };
      if (closed() || left || !(target.cols >= 1 && target.cols <= MAX_CELLS && target.rows >= 1 && target.rows <= MAX_CELLS) || finished()) {
        return;
      }

      wanted = target;
      // The first size makes the terminal.
      if (!started) {
        start(target);
        return;
      }

      stopSettling();
      settling = setTimeout(() => {
        settling = undefined;
        sendSize();
      }, settleMs);
    },

    redraw,
    leave,
    refresh,

    // The reader takes the replay that waits, once, before any live output: what the host kept of the terminal's output when the page took it, what it kept after bytes the page asked for were lost, or nothing at the end of a gap.
    takeReplay: () => {
      const replay = awaiting;
      if (replay === undefined || closed()) {
        return undefined;
      }

      awaiting = undefined;
      return replay;
    },

    close: async () => {
      if (closing !== undefined) {
        return closing;
      }

      // A stream the page left is not closed here: the host closes it on the detach frame, and closing it first would lose the frame.
      unlink(true);
      dropOutgoing();
      held.clear();
      awaiting = undefined;
      closing = (creating ?? Promise.resolve()).then(async () => {
        // A terminal the host never made has nothing to end, nor has one this page lost to another, one the host does not know, or one it left for the page that comes back (ending it would end what the other page shows). One that ended by
        // itself is kept by the host, with its output, until a page forgets it: then the close dismisses it.
        if (!created || left || fate === 'not-ours') {
          return;
        }

        try {
          await (fate === 'dismiss' ? channels.dismiss(id) : channels.close(id));
        } catch (error) {
          if (!channels.isGone(error)) {
            throw error;
          }
        }
      });
      return closing;
    },
  };
}

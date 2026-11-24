import type { TerminalChannels } from './channel';
import { MAX_INPUT_BYTES } from './channel';
import type { TerminalBusy, TerminalClosedBy, TerminalExit, TerminalFeedCause, TerminalFeedHandle, TerminalFeedSnapshot, TerminalFeedStage, TerminalModes, TerminalOutput, TerminalReplay } from './feed';
import { createHeldOutput } from './heldOutput';

// A terminal of the host as a feed, over the terminal channel (docs/ui-next/terminal-channel-protocol.md; `channel.ts` is the contract with the one place that holds the capabilities and the streams). It is the one place the
// rules of a terminal's wire live, framework-free and without xterm:
//
//   - the id of the terminal is chosen HERE, and the terminal is made at the first size the view measured, so the shell lays out its first prompt for it and nothing is resized after it started (a terminal whose view never
//     measures is never made). The stream opens once the host has made it, and the feed is `running` when the host's `ready` says so;
//   - what the shell writes comes as bytes with offsets, in one ordered stream, and is held exactly as it came (nothing decoded, nothing dropped) and wakes a listener once between two reads, so a flood costs a push per frame and
//     a hidden terminal costs no more. What bounds it is the HOST's flow control: the first acknowledgement, of nothing, turns the host's window on as soon as the stream is ready, and the feed acknowledges every byte the
//     reader parsed of what the shell wrote LIVE. Never a byte of a replay and never a gap;
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

/** What the feed holds while the call that takes a terminal over is out: an output event, the end of the terminal, or the loss of it, as it came. */
type Heard = { readonly kind: 'output' | 'end' | 'detached'; readonly data: unknown };

export type Size = { readonly cols: number; readonly rows: number };

/** What `setTimeout` hands back: a number in a page, an object in Node, where the tests of this file also run. */
type Timer = ReturnType<typeof setTimeout>;

export function createExecFeed(options: ExecFeedOptions): ExecFeed {
  void [createHeldOutput, endOf, busyOf, pieceLength, sameSize, sizeOfWire, modesOf, withProgram, programOf, MAX_CELLS, OUTPUT_GAP, UNREADABLE_ATTACH, TERMINAL_GONE, CONNECTION_LOST, IDLE, UNKNOWN, SETTLE_MS, RECONNECT_DELAYS_MS, consoleWarn];
  const { channels } = options;
  const id = options.attach?.id ?? (options.newId ?? newTerminalId)();
  const status: TerminalFeedSnapshot = { state: 'starting' };
  const events = { ready: () => undefined, output: () => undefined, gap: () => undefined, ended: () => undefined, takenOver: () => undefined, notFound: () => undefined, closed: () => undefined };
  let made = false;
  if (options.attach !== undefined) {
    channels.connect(id, undefined, events);
  }

  return {
    id,
    subscribe: () => () => undefined,
    getSnapshot: () => status,
    read: () => EMPTY,
    ack: () => undefined,
    write: () => undefined,
    resize: (cols, rows) => {
      if (!made && options.attach === undefined) {
        made = true;
        void channels.create(id, { cols, rows, leaseMs: options.leaseMs }).then(() => channels.connect(id, 0, events));
      }
    },
    inputs: () => 0,
    inputsSettled: () => true,
    close: async () => undefined,
    takeReplay: (): TerminalReplay | undefined => undefined,
  };
}

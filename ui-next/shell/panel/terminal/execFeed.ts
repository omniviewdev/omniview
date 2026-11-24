import { base64Size, decodeBase64, encodeInput } from './bytes';
import type { TerminalBusy, TerminalClosedBy, TerminalDetached, TerminalExit, TerminalFeedCause, TerminalFeedHandle, TerminalFeedSnapshot, TerminalFeedStage, TerminalModes, TerminalOutput, TerminalReplay, TerminalShellAttempt } from './feed';
import { createHeldOutput } from './heldOutput';

// A pty session of the host's exec lane as a feed (docs/ui-next/status/T1.md, "The data path"; docs/ui-next/status/T2a.md for what the host's own shell tells). It is the one place the rules of a terminal's wire
// live, framework-free and without xterm:
//
//   - the id of the session is chosen HERE and every listener is in place before the process starts, so the first prompt cannot arrive before somebody listens (the old terminal attached after the call);
//   - what the process writes is held exactly as it came (base64 text, nothing dropped, nothing decoded until a view reads) and wakes a listener once between two reads, so a flood costs a push per event and a
//     hidden terminal costs no more. What bounds it is the HOST's flow control, not a bound here: the page turns it on with its first acknowledgement, the moment the process exists, and acknowledges every byte
//     the screen parses (`ack`); the host stops reading the pty when 1 MiB is delivered and not acknowledged, so a terminal nobody reads holds about that much and its shell waits, and loses nothing;
//   - what the user types goes out AT ONCE, each piece as its own call, and never waits for the answer of an earlier one: the HOST puts the calls in order, not this file. Every call of the session (a write or a size)
//     carries a number, from ONE counter that starts at 1 when the process exists, or, for a terminal this page took over, at the number the host's answer to the attach states (the terminal's input queue is the terminal's,
//     and an attach does not reset it); the number is taken when the call is first sent, a call that is sent again keeps it, and the host applies the calls in the order of the
//     numbers whatever order they reach it in (docs/ui-next/status/T1-go.md 2.4). A paste goes in calls of at most 64 KiB, and no more than 512 KiB and 32 calls are in flight at once: this WINDOW protects the host's own
//     bounds (it holds at most 1 MiB and 256 operations for a session, and refuses a call more than 64 past the number it waits for) and does not keep the order, which the numbers keep; what does not fit waits, and goes
//     together, in order, as calls are answered. A call the host refuses with `INPUT_BACKLOG` (the session is full: the call was not applied and took no number) is sent again with the same number after a short delay, for as
//     long as the session runs. What is typed before the process exists is held, and sent after it in order, with the first numbers;
//   - the size STARTS the process and is then settled: the process starts at the first size the view measured, so the shell lays out its first prompt for it and nothing is resized after it started (a session whose view never measures never starts); every later size goes once it stood still (`settleMs`: a drag is one message), at once as its own call and not waiting for another, ROWS before COLUMNS;
//   - what the host says of the process is read in ONE place each and kept in the status: the shell it started (the call's answer), how it ended (the typed CLOSE event: its code, its signal, who closed it), the code of
//     a refusal to start; and what runs in it is asked when it matters (`busy`: a close), never polled;
//   - a terminal that outlives its page (T2-go) has its page's key: the host sends its output with offsets and the feed joins it by them, DROPPING every event whose bytes it has, held or live, and failing in words when an event
//     lies above the offset it has (a gap that must not happen). A page that comes back TAKES the terminal over: it listens to the output, the end and the loss of the terminal first and holds them while the one call is out;
//     the answer gives the replay (the reader takes it once, before any live output), the number of the page's attachment, where the live output continues and the number the terminal's input takes next (an answer for a
//     terminal that runs that cannot state it is no answer: the count could not continue); the held events are then applied by offset, in order. Only
//     live bytes the reader read are acknowledged. The page is told when it loses the terminal (`DETACHED` with its number): the session ends for it, nothing is sent for the terminal any more (it must not detach or close
//     what another page shows), and the end of the terminal is still heard, to say why it ended. `leave` detaches the terminal for the page that comes back; `redraw` makes a full-screen program draw itself again;
//   - a close ends the process exactly once, and every listener is released on every way out (docs/ui-next/optimisations.md HLT-28).
//
// What a backend is, as far as this file is concerned, is `ExecTransport`: the host's local shell is `localShell.ts`, and a plugin's exec target is another transport over the same feed.

/** What starts a terminal besides its size (T2-go 2.1). */
export type ExecLaunch = {
  /** The page's key: the terminal then outlives the page for a lease, and its output comes with offsets, so that a page that comes back finds it and joins its output exactly. Absent: it ends with its window. */
  readonly pageKey?: string | undefined;
  /** How long the host keeps the terminal once no page holds it, in milliseconds. Absent: the host's own. */
  readonly leaseMs?: number | undefined;
};

/** What takes a terminal over (T2-go 2.2). */
export type ExecAttachRequest = {
  /** The key the terminal was started with. */
  readonly pageKey: string;
  /** The offset of the first byte the page does not have. Absent: the page has nothing, and gets all the host kept. */
  readonly fromOffset?: number | undefined;
};

export type ExecTransport = {
  /** Starts the process under `id` on a pty of `size`, the size the view measured: the shell lays out its first prompt for it. Answers with the session the backend made (the feed reads the shell's name from it). */
  readonly create: (id: string, size: Size, launch?: ExecLaunch) => Promise<unknown>;
  /** The terminals the backend holds for a page key: its own answer (`ListTerminals`), which `listedOf` reads. */
  readonly list: (pageKey: string) => Promise<unknown>;
  /**
   * Takes a terminal that outlived its page over (`AttachTerminal`): the answer has the replay of the output the backend kept, the number of this attachment, and how it ended when it had ended while no page held it. The feed
   * reads it. The terminal's events continue where the replay ends.
   */
  readonly attach: (id: string, request: ExecAttachRequest) => Promise<unknown>;
  /** Leaves a terminal for the page that comes back (`DetachTerminal`): the backend holds it for its lease instead of ending it. */
  readonly detach: (id: string, request: { readonly pageKey: string }) => Promise<unknown>;
  /**
   * Writes what the user typed, as base64, as call number `seq` of the session. The feed counts the calls (the writes and the sizes together, from 1, or from the number the host states for a terminal that was taken over;
   * one number for each call; a call that is sent again keeps its number) and sends each at once, without waiting for the one before: the order is the backend's to keep by the numbers, as the host's own shell does
   * (docs/ui-next/status/T1-go.md 2.4), and a backend that applies calls in the order they reach it must serialise them itself. A refusal with the code `INPUT_BACKLOG` asks for the same call again.
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
  /** The shells the backend tried before it refused to start one (`SHELL_UNAVAILABLE`), in the order it tried them, when the error carries them: tokens, not words. */
  readonly triedOf: (error: unknown) => readonly TerminalShellAttempt[] | undefined;
};

/** What every feed is given. */
type ExecFeedBase = {
  readonly transport: ExecTransport;
  /** Makes the session's id. Default: a random UUID. */
  readonly newId?: (() => string) | undefined;
  /** How long a size has to stand still before it is sent, in milliseconds. Default: `SETTLE_MS`. */
  readonly settleMs?: number | undefined;
  /** Where the host says what it could not do. Default: the console. */
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
};

/**
 * A terminal that outlived its page, taken over instead of started (T2-go 2.4): its id, and the shell the listing named, which names the session until the host's answer says. The feed listens first and takes it over at
 * once; its id is the terminal's, and `newId` is not asked.
 */
export type ExecAttach = { readonly id: string; readonly program?: string | undefined };

/**
 * A feed with no key behaves as it always did. With the page's key its terminal outlives the page for a lease: the output comes with offsets and is joined by them, the loss of the terminal to another page is told, and
 * `leave` detaches it. With `attach` as well it takes over a terminal the page already has, and gives the replay of what the host kept before the live output.
 */
export type ExecFeedOptions =
  | (ExecFeedBase & { readonly pageKey?: undefined; readonly attach?: undefined })
  | (ExecFeedBase & { readonly pageKey: string; readonly attach?: ExecAttach | undefined });

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

/** The names of the events of a session (backend/pkg/plugin/exec/controller.go `dispatchOutput`; a terminal with a key sends `output` with offsets and `DETACHED`, backend/pkg/plugin/exec/terminal.go). */
export const streamEvent = (id: string, target: 'stdout' | 'stderr' | 'output'): string => `core/exec/stream/${target}/${id}`;
export const signalEvent = (id: string, signal: 'CLOSE' | 'ERROR' | 'DETACHED'): string => `core/exec/signal/${signal}/${id}`;

const EMPTY: TerminalOutput = Object.freeze({ chunks: Object.freeze([]), bytes: 0 });
const IDLE: TerminalBusy = Object.freeze({ state: 'idle' });
const UNKNOWN: TerminalBusy = Object.freeze({ state: 'unknown' });
/** The most cells a size may have on a side: the host's own limit (`MaxDimension` in backend/pkg/terminal). The first size starts the process and the host refuses a larger one, and a feed whose start failed takes no later size. */
const MAX_CELLS = 1000;
/** The code of the host's refusal of a call because the session holds as much input as it may (429): the call was not applied and took no number, so the same call may be sent again (docs/ui-next/status/T1-go.md 2.4). */
const INPUT_BACKLOG = 'INPUT_BACKLOG';
const CLOSED_BY: readonly unknown[] = ['request', 'window', 'shutdown', 'detach-timeout'] satisfies readonly TerminalClosedBy[];
/** What the session says when output of a terminal with a key did not come in order (T2-go 2.4, rule 5): it never says where, since the person cannot do anything with an offset. */
const OUTPUT_GAP = 'Some of the terminal\'s output did not arrive.';
/** What the session says when the host answered the call that takes a terminal over with something the page cannot join the live output to. */
const UNREADABLE_ATTACH = 'The terminal could not be taken over: the host\'s answer was not understood.';

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

/** The two sizes are the same size: they have the same columns and the same rows, whichever measurement each came from. */
const sameSize = (one: Size, other: Size): boolean => one.cols === other.cols && one.rows === other.rows;

/** What a terminal's output event carries (T2-go 2.3): where its bytes lie in the terminal's output, the bytes as the text they came in, and how many bytes they are (counted from the text, not decoded). */
type Positioned = { readonly offset: number; readonly text: string; readonly length: number };

function positionedOf(data: unknown): Positioned | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const offset: unknown = Reflect.get(data, 'offset');
  const text: unknown = Reflect.get(data, 'data');
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || typeof text !== 'string') {
    return undefined;
  }

  const length = base64Size(text);
  return Number.isInteger(length) ? { offset, text, length } : undefined;
}

const DETACHED_BY: ReadonlyArray<TerminalDetached['by']> = ['taken-over', 'requested', 'window-retired'];

/**
 * What the event that says a page lost a terminal carries (T2-go 2.3): why, and the number of the attachment that ended. Nothing without a number is a loss this page can tell is its own. A reason this page does not
 * know is read as a release (`requested`): the terminal is no longer held, and that is what the page must act on.
 */
function detachmentOf(data: unknown): { readonly by: TerminalDetached['by']; readonly attachment: number } | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const attachment = finite(Reflect.get(data, 'attachment'));
  if (attachment === undefined || !Number.isInteger(attachment) || attachment < 0) {
    return undefined;
  }

  const by: unknown = Reflect.get(data, 'by');
  return { by: DETACHED_BY.find((token) => token === by) ?? 'requested', attachment };
}

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

/** What the host answered as a replay (`terminal.Replay`), kept as it came: the text is decoded when the reader takes it. */
type HeldReplay = {
  readonly text: string;
  readonly end: number;
  readonly startSize: Size;
  readonly startModes: TerminalModes;
  readonly size: Size;
  readonly modes: TerminalModes;
};

/** What the host answered to the call that takes a terminal over (`terminal.Attached`, T2-go 2.2), as far as the page uses it. */
type Attached = {
  readonly program: string | undefined;
  /** The number of this attachment: what a `DETACHED` event is compared with. */
  readonly attachment: number;
  readonly replay: HeldReplay;
  /** How the terminal ended, when it had ended while no page held it. */
  readonly ended: unknown;
  /**
   * The number the terminal's input queue takes next (`next_input_seq`, host #675), as of the attach: at least 1 for a terminal that runs, and the page's count of input calls continues from it. 0 for a terminal that ended,
   * which takes no input and whose number the page does not read.
   */
  readonly nextInputSeq: number;
};

/**
 * The answer to the call that takes a terminal over, read. Nothing is guessed: an answer without a replay that says where the live output continues, the text of its bytes and the sizes, or without the number of
 * the attachment, cannot be joined exactly (there is no offset to drop duplicates by, no number to know a loss by), and is no answer. Nor is the answer for a terminal that runs and does not state, as a whole number of at
 * least 1, the number its input queue takes next: the count of input calls could not continue (from 1 the calls would be refused as stale). The number is read here and nowhere else.
 */
function attachedOf(answer: unknown): Attached | undefined {
  if (typeof answer !== 'object' || answer === null) {
    return undefined;
  }

  const attachment = finite(Reflect.get(answer, 'attachment'));
  const replay: unknown = Reflect.get(answer, 'replay');
  if (attachment === undefined || !Number.isInteger(attachment) || attachment < 0 || typeof replay !== 'object' || replay === null) {
    return undefined;
  }

  const end = finite(Reflect.get(replay, 'end'));
  const text: unknown = Reflect.get(replay, 'data');
  const startSize = sizeOfWire(Reflect.get(replay, 'start_size'));
  const size = sizeOfWire(Reflect.get(replay, 'size'));
  if (end === undefined || !Number.isSafeInteger(end) || end < 0 || typeof text !== 'string' || !Number.isInteger(base64Size(text)) || startSize === undefined || size === undefined) {
    return undefined;
  }

  const base = {
    program: programOf(Reflect.get(answer, 'session')),
    attachment,
    replay: { text, end, startSize, startModes: modesOf(Reflect.get(replay, 'start_modes')), size, modes: modesOf(Reflect.get(replay, 'modes')) },
  };
  const ended: unknown = Reflect.get(answer, 'ended');
  if (typeof ended === 'object' && ended !== null) {
    // A terminal that ended takes no input: nothing is ever sent to it, so the number it states (0) is not read.
    return { ...base, ended, nextInputSeq: 0 };
  }

  const seq = finite(Reflect.get(answer, 'next_input_seq'));
  return seq !== undefined && Number.isSafeInteger(seq) && seq >= 1 ? { ...base, ended: undefined, nextInputSeq: seq } : undefined;
}

/**
 * One terminal of what the host lists for a page key (`terminal.Listed`, T2-go 2.2), as far as the page needs it: its id, the shell it runs, and `ended` when the host lists how it ended: its shell ended while no page held it,
 * and the host keeps it, with its output, for the rest of its lease. `ended` is left out for a terminal that runs.
 */
export type ListedTerminal = { readonly id: string; readonly program?: string | undefined; readonly ended?: boolean | undefined };

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
    const ended: unknown = Reflect.get(item, 'ended');
    terminals.push({ id: terminal, ...(program === undefined ? {} : { program }), ...(typeof ended === 'object' && ended !== null ? { ended: true } : {}) });
  }

  return terminals;
}

/** What the feed holds while the call that takes a terminal over is out: an output event, the end of the terminal, or the loss of it, as it came. */
type Heard = { readonly kind: 'output' | 'end' | 'detached'; readonly data: unknown };

export type Size = { readonly cols: number; readonly rows: number };

/** What `setTimeout` hands back: a number in a page, an object in Node, where the tests of this file also run. */
type Timer = ReturnType<typeof setTimeout>;

export function createExecFeed(options: ExecFeedOptions): ExecFeed {
  const { transport } = options;
  const key = options.pageKey;
  const attachTo = options.attach;
  const id = attachTo?.id ?? (options.newId ?? newTerminalId)();
  const warn = options.warn ?? consoleWarn;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const held = createHeldOutput();
  const listeners = new Set<() => void>();
  /** The listeners of the session but the one for its end. */
  const stops: Array<() => void> = [];
  /** The listener for the end of the session: a terminal this page lost goes on listening to it, to learn how it ended. */
  let stopEnd: (() => void) | undefined;
  /** The timers of the calls that wait to be sent again. */
  const retries = new Set<Timer>();
  const listed = attachTo?.program;
  let status: TerminalFeedSnapshot = listed === undefined ? { state: 'starting' } : { state: 'starting', program: listed };
  let created = false;
  let closing: Promise<void> | undefined;
  let woken = false;
  let warnedPayload = false;
  /** What the user typed that has not gone out yet, in order: it waits for the process to exist and, past the windows, for room. */
  let waiting = '';
  /** How many calls of `write` the feed took with something typed in them: what `inputs` says. */
  let typed = 0;
  /**
   * The number the next call takes: ONE counter for the writes and the sizes of the session (the host counts them the same way, docs/ui-next/status/T1-go.md 2.4). It starts at 1 for a process this feed started. A terminal
   * it took over has an input queue of its own that an attach does not reset, and a call numbered below the number the queue takes next is refused as stale: the count starts at the number the answer to the attach states,
   * which is current as of the attach. It is never the number of a listing (older: the window that held the terminal can write between the list and the attach), and never a guess.
   */
  let nextSeq = 1;
  /** Bytes of the writes that were sent and are not answered yet: what the window counts. */
  let flying = 0;
  /** Calls (writes and sizes) that were sent and are not answered yet: what the window of calls counts. */
  let calls = 0;
  let wanted: Size | undefined;
  let delivered: Size | undefined;
  /** The size one cell off the one the screen stands at, owed to the host before that size (`redraw`). */
  let bounce: Size | undefined;
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
  /** A terminal with a key: the offset of its output the feed has applied up to. The event that starts there is the next one; an event below it is bytes the feed has; one above it is a gap (T2-go 2.4, rule 5). */
  let next = 0;
  /** The number of the attachment this page holds: 0 for the page that started the terminal; for one that took it over, the answer's, and unknown until it comes. */
  let attachment: number | undefined = attachTo === undefined ? 0 : undefined;
  /** What was heard while the call that takes the terminal over was out, in the order it came: the page knows neither its number nor where the replay ends until the answer says (T2-go 2.4, rules 2, 3 and 8). */
  let heard: Heard[] | undefined = attachTo === undefined ? undefined : [];
  /** The replay the host answered, for the reader to take: `read` gives nothing until it has (T2-go 2.4, rule 4). */
  let awaiting: HeldReplay | undefined;
  /** The page left the terminal for the page that comes back (`leave`): it is no longer this page's to write to, to size or to end. */
  let left = false;

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

  /** Lets go of every listener but the one for the end of the session. */
  const releaseOutput = () => {
    for (const stop of stops.splice(0)) {
      stop();
    }
  };

  const release = () => {
    releaseOutput();
    stopEnd?.();
    stopEnd = undefined;
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

  /** Nothing more is sent: the size that was settling, what was typed and waits, the calls that wait to be sent again, and a redraw that was owed. */
  const dropOutgoing = () => {
    stopSettling();
    stopRetrying();
    waiting = '';
    bounce = undefined;
  };

  /** Calls may be sent, and the answers of the calls that were sent matter: the process runs, this page holds it, and nobody closed the feed. */
  const live = (): boolean => !closed() && !left && status.state === 'running';

  /** Whether a call may go out now: the process runs, and fewer than `WINDOW_CALLS` calls are out. */
  const roomForCall = (): boolean => live() && calls < WINDOW_CALLS;

  /**
   * The way out of a session that ended or failed: nothing is listened to, nothing is waited for, what was written stays readable. Once. A terminal this page lost keeps the listener for its end (`listening`): it is
   * told how the terminal ended, and lets that go too.
   */
  const over = (result: TerminalFeedSnapshot, listening = false) => {
    if (closed() || finished()) {
      return;
    }

    if (listening) {
      releaseOutput();
    } else {
      release();
    }

    dropOutgoing();
    status = result;
    tell();
  };

  const causeOf = (stage: TerminalFeedStage, error: unknown): TerminalFeedCause => {
    const message = transport.describe(error);
    const code = transport.codeOf(error);
    const tried = transport.triedOf(error);
    return { stage, message, ...(code === undefined ? {} : { code }), ...(tried === undefined || tried.length === 0 ? {} : { tried }) };
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
    wake();
  };

  /**
   * The output of a terminal with a key comes with its offset, and the feed joins it by offset (T2-go 2.4, rule 5): an event whose bytes the feed has (`offset + length <= next`) is dropped, ALWAYS, held or live: an event and
   * the answer of a call travel apart, so one the replay holds can come after it. The event at `next` is applied. One above it is a gap, and one that overlaps what the feed has and goes beyond it does not join: neither
   * must happen, and the session fails in words that say so, since a screen that went on would show output with a hole in it. Nothing here is acknowledged by itself: the reader acknowledges what it read, and what was dropped is
   * never read (rule 6).
   */
  const applyPositioned = (data: unknown) => {
    if (closed() || finished()) {
      return;
    }

    const event = positionedOf(data);
    if (event === undefined) {
      if (!warnedPayload) {
        warnedPayload = true;
        warn('[terminal] the backend sent output that is not an offset and text; it is ignored');
      }

      return;
    }

    if (event.offset + event.length <= next) {
      return;
    }

    if (event.offset !== next) {
      warn(`[terminal] the output of the terminal does not join: an event came at offset ${String(event.offset)} and the feed is at ${String(next)}`);
      over({ state: 'failed', cause: { stage: 'session', message: OUTPUT_GAP } });
      return;
    }

    next += event.length;
    held.push(event.text);
    wake();
  };

  /** This page lost the terminal: another page took it, or it was detached. It is no longer this page's to write to, to size or to end; the state is `ended` for this page, and the listener for the end of the terminal stays. */
  const lost = (by: TerminalDetached['by']) => {
    const program = status.program;
    over(program === undefined ? { state: 'ended', detached: { by } } : { state: 'ended', program, detached: { by } }, true);
  };

  /** The loss of a terminal, when it is this page's: every window gets the event, and the number of the attachment that ENDED says whose it is (T2-go 2.4, rule 8). Another page's loss is not this page's business. */
  const applyDetached = (data: unknown) => {
    if (closed() || finished() || attachment === undefined) {
      return;
    }

    const event = detachmentOf(data);
    if (event?.attachment === attachment) {
      lost(event.by);
    }
  };

  const applyEnd = (data: unknown) => {
    if (closed()) {
      return;
    }

    if (status.detached === undefined) {
      over(endOf(data));
      return;
    }

    // The page lost this terminal and went on listening for its end: that is how it ended, if the host says (the lease it was lost to ran out, or the shell exited), and the last listener goes.
    const end = endOf(data);
    release();
    if (end.exit !== undefined) {
      status = { ...status, exit: end.exit };
      tell();
    }
  };

  /** A listener of an event the page may have to hold: while the call that takes the terminal over is out, the event waits for the answer, in the order it came. */
  const hearing = (kind: Heard['kind'], apply: (data: unknown) => void) => (data: unknown) => {
    if (closed()) {
      return;
    }

    if (heard === undefined) {
      apply(data);
    } else {
      heard.push({ kind, data });
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
    if (acking || stopped || closed() || left || !created || status.state !== 'running' || (flowOn && owed === 0)) {
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

  /** One size, as its own call. A size the host refused tells nothing of the size it holds now, so it is forgotten, whatever measured it. */
  const sendResize = (size: Size) => {
    delivered = size;
    transmit(
      0,
      async (seq) => transport.resize(id, seq, size.rows, size.cols),
      (error) => {
        // A size the host refused tells nothing of the size it holds now (what it had before may be what an earlier refusal left it), so it is forgotten: whatever size is measured next is sent. A newer size that went out meanwhile
        // stands, since it is the one the host may have. The call that was refused is not repeated by itself, so a size that is still the one wanted waits to be measured again instead of going out at once from the `flush` that
        // follows. The size wanted is the same size as the one refused when it has the same columns and rows, whichever measurement it came from: a size measured again while the call was out is the same size.
        if (delivered === size) {
          delivered = undefined;
          if (wanted !== undefined && sameSize(wanted, size)) {
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

  /** Sends the size the screen stands at, as its own call, when it is not the size the host has: the sizes are not held back by a call that is out. A size owed for a redraw goes first. */
  const sendSize = () => {
    if (!roomForCall()) {
      return;
    }

    if (bounce !== undefined) {
      const off = bounce;
      bounce = undefined;
      sendResize(off);
    }

    if (wanted === undefined || !roomForCall() || (delivered !== undefined && sameSize(delivered, wanted))) {
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

  /** Starts the process on a pty of the size the view measured, so that nothing is resized after it started. Once. */
  const start = (size: Size) => {
    if (starting !== undefined || closed()) {
      return;
    }

    delivered = size;
    starting = (key === undefined ? transport.create(id, size) : transport.create(id, size, { pageKey: key })).then(
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

  /** What the host answered to the call that took the terminal over, applied (T2-go 2.4, rules 3 to 8). */
  const takeOver = (taken: Attached) => {
    attachment = taken.attachment;
    const program = taken.program ?? status.program;
    const named = (result: TerminalFeedSnapshot): TerminalFeedSnapshot => (result.state === 'ended' && program !== undefined ? { ...result, program } : result);
    awaiting = taken.replay;
    if (taken.ended !== undefined) {
      // The terminal had ended while no page held it: how it ended is what the page shows, with its output (the replay), and nothing live follows. `CloseSession` dismisses what the host kept of it.
      heard = undefined;
      over(named(endOf(taken.ended)));
      return;
    }

    next = taken.replay.end;
    delivered = taken.replay.size;
    // The terminal's input queue is the terminal's, and an attach does not reset it: the count continues from the number the answer states, which is current as of the attach (a listing's is older, since the window that held
    // the terminal can write between the list and the attach).
    nextSeq = taken.nextInputSeq;

    // What came while the call was out, in the order it came: what the replay holds is dropped, what continues it is applied, a loss of the terminal that is this page's ends the session, and so does the end of the
    // terminal. The session is named by the host's answer meanwhile, so that whatever it comes to carries the name.
    status = program === undefined ? { state: 'starting' } : { state: 'starting', program };
    const events = heard ?? [];
    heard = undefined;
    for (const event of events) {
      if (event.kind === 'output') {
        applyPositioned(event.data);
      } else if (event.kind === 'detached') {
        applyDetached(event.data);
      } else {
        applyEnd(event.data);
      }
    }

    if (status.state === 'starting') {
      status = program === undefined ? { state: 'running' } : { state: 'running', program };
      tell();
    }

    flush();
    sendAck();
  };

  /** Takes the terminal over: one call, with the key and no offset, since a fresh emulator has nothing. The terminal is there already, so nothing waits for a size. Once. */
  const attach = (target: ExecAttach, pageKey: string) => {
    starting = transport.attach(target.id, { pageKey }).then(
      (answer: unknown) => {
        // The host has handed the terminal to this window, whatever the page makes of the answer: a close ends it.
        created = true;
        if (closed()) {
          heard = undefined;
          return;
        }

        const taken = attachedOf(answer);
        if (taken === undefined) {
          heard = undefined;
          over({ state: 'failed', cause: { stage: 'start', message: UNREADABLE_ATTACH } });
          return;
        }

        takeOver(taken);
      },
      (error: unknown) => {
        heard = undefined;
        if (!closed()) {
          over({ state: 'failed', cause: causeOf('start', error) });
        }
      },
    );
  };

  /**
   * The page is going away, and its terminal is left for the page that comes back: detached, not closed. Once, while this page holds a running terminal that has a key; fire and forget. Every listener is let go and
   * nothing is sent from now on, and a `close` after it does not end the process, which is what the page that comes back finds.
   */
  const leave = () => {
    if (key === undefined || left || closed() || status.state !== 'running') {
      return;
    }

    left = true;
    release();
    dropOutgoing();
    const request = { pageKey: key };
    void (async () => {
      try {
        await transport.detach(id, request);
      } catch (error) {
        warn('[terminal] the terminal could not be left for the page that comes back', error);
      }
    })();
  };

  /** The reader takes what the host kept of the terminal's output, once, before any live output: decoded now, since a terminal that is never shown costs the text it holds and no more. */
  const takeReplay = (): TerminalReplay | undefined => {
    const replay = awaiting;
    if (replay === undefined || closed()) {
      return undefined;
    }

    awaiting = undefined;
    return { data: decodeBase64(replay.text), startSize: replay.startSize, startModes: replay.startModes, size: replay.size, modes: replay.modes, end: replay.end };
  };

  /**
   * Makes a full-screen program draw itself again: the size one cell off, and then the size the screen stands at (or, when it has measured none, the one the host has), as two numbered calls, each at once and not
   * waiting for the settling. A terminal of one cell has no size one cell off that is a size, and nothing is sent.
   */
  const redraw = () => {
    const real = wanted ?? delivered;
    if (!live() || real === undefined) {
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

  // Every listener first, then the process.
  if (key === undefined) {
    stops.push(
      transport.on(streamEvent(id, 'stdout'), onOutput),
      transport.on(streamEvent(id, 'stderr'), onOutput),
      transport.on(signalEvent(id, 'ERROR'), (data) => {
        over({ state: 'failed', cause: { stage: 'session', message: signalMessage(data) } });
      }),
    );
  } else {
    stops.push(transport.on(streamEvent(id, 'output'), hearing('output', applyPositioned)), transport.on(signalEvent(id, 'DETACHED'), hearing('detached', applyDetached)));
  }

  stopEnd = transport.on(signalEvent(id, 'CLOSE'), hearing('end', applyEnd));

  // A terminal that outlived its page is already there: it is taken over at once, and not when a size is measured.
  if (attachTo !== undefined && key !== undefined) {
    attach(attachTo, key);
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
      if (closed() || awaiting !== undefined) {
        return EMPTY;
      }

      const taken = held.take(max);
      return { chunks: taken.texts.map(decodeBase64), bytes: taken.bytes };
    },

    ack: (bytes) => {
      const count = Number.isFinite(bytes) ? Math.floor(bytes) : 0;
      if (count < 1 || closed() || left || finished()) {
        return;
      }

      owed += count;
      sendAck();
    },

    busy: async () => {
      if (closed() || left || status.state !== 'running') {
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

    // Nothing typed waits for the process or for room, and none of it is in flight (a call the host refused for its backlog stays in flight until it is taken); a session that is over sends nothing more, so nothing is left to wait for.
    inputsSettled: () => closed() || finished() || (waiting === '' && flying === 0),

    resize: (cols, rows) => {
      const size = { cols: Math.floor(cols), rows: Math.floor(rows) };
      if (closed() || left || !(size.cols >= 1 && size.cols <= MAX_CELLS && size.rows >= 1 && size.rows <= MAX_CELLS) || finished()) {
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

    redraw,

    ...(key === undefined ? {} : { leave }),
    ...(attachTo === undefined ? {} : { takeReplay }),

    close: async () => {
      if (closing !== undefined) {
        return closing;
      }

      release();
      dropOutgoing();
      held.clear();
      heard = undefined;
      awaiting = undefined;
      closing = (starting ?? Promise.resolve()).then(async () => {
        // A process that never started has nothing to end, nor has one that ended on its own, unless the host keeps what such a terminal left until a page closes it (a terminal with a key): then the close dismisses it. A
        // terminal this page left for the page that comes back, or lost to another, is not this page's to end: that would end what the other page shows.
        if (!created || left || status.detached !== undefined || (key === undefined && status.state === 'ended')) {
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

import { CHANNEL_VERSION, MAX_INPUT_BYTES, MAX_KEPT_INPUT_BYTES, MAX_MARKS, type ChannelLaunch, type ChannelLink, type TerminalChannels } from './channel';
import type { TerminalBusy, TerminalClosedBy, TerminalExit, TerminalFeedCause, TerminalFeedHandle, TerminalFeedSnapshot, TerminalFeedStage, TerminalMark, TerminalModes, TerminalOutput, TerminalReplay } from './feed';
import { commandNameOf, marksOf } from './marks';
import { createHeldOutput } from './heldOutput';

// A terminal of the host as a feed, over the terminal channel (docs/ui-next/terminal-channel-protocol.md; `channel.ts` is the contract with the one place that holds the capabilities and the streams). It is the one place the
// rules of a terminal's wire live, framework-free and without xterm:
//
//   - the id of the terminal is chosen HERE, and the terminal is made at the first size the view measured, so the shell lays out its first prompt for it and nothing is resized after it started (a terminal whose view never
//     measures is never made). The stream opens once the host has made it, and the feed is `running` when the host's `ready` says so;
//   - what the shell writes comes as bytes with offsets, in one ordered stream, and is held exactly as it came (nothing decoded, nothing dropped) and wakes a listener once between two reads, so a flood costs a push per frame and
//     a hidden terminal costs no more. What bounds it is the HOST's flow control: the first acknowledgement, of nothing, turns the host's window on as soon as the stream is ready, and the feed acknowledges every byte the
//     reader parsed of what the shell wrote LIVE. The bytes of a replay are credited as they arrive (the host counts every output frame against its window), a gap's never;
//   - what the user types goes out in input frames of at most `MAX_INPUT_BYTES`, in the order it was typed: the order is the stream's, so nothing is numbered or windowed. The feed KEEPS every byte it typed until the host says it
//     applied it (`ready.input_applied`, then each `applied`: the host's count of the input it wrote to the terminal, across streams) and, after the `ready` of a stream that was connected again, sends the bytes after that count, once
//     and in order, before anything typed since: no byte is typed twice and none is lost. What is typed before the stream is ready, or while it is connecting again, waits and goes after `ready`. The kept bytes are bounded (the
//     host's own queue, 1 MiB): a page that types more than the host has applied fails in words;
//   - the size STARTS the terminal and is then settled (`settleMs`: a drag is one frame), sent once the stream is ready, rows and columns together;
//   - the feed that MADE its terminal treats every byte as live: nothing is replayed to it and nothing is muted. A feed that ATTACHES (a page after a reload, a take-back) is given `[ready.start, ready.end)` as one replay for
//     a fresh emulator (`takeReplay`, taken once before any live output; `read` gives nothing until then), and the bytes after it are live;
//   - a stream that dropped is opened again from the offset the feed has applied up to, after 250 ms, one second and four seconds, and then the feed fails in words. The host answers with `lost` what of that it no longer has:
//     none, and the output continues; some, and the reader is given a fresh replay. A `gap` is the host saying the bytes in between were overwritten before they were sent: the reader is given a replay of nothing at its end,
//     which resets the emulator. What the reader parsed of a stream that is over is not credited to the next one (`forgiven`);
//   - the host's word that another stream took the terminal ends the feed for this page (`detached`), input off, and the stream stays open as a WATCHER: the host tells it `released` (the terminal is free to take back: `detached.free`,
//     at once, nothing is asked) or `ended` (how the terminal ended) and closes it. A watcher the host closes with no word (it watched longest of five, or the connection dropped) asks the host (`refresh`: asked again on the
//     schedule of a reconnect only while the host cannot be reached), which a take-back also does before it attaches. A host of another version (`unsupported`) and a terminal the host does not know end the feed in words; how a terminal ended (the typed `ended` frame) is read in ONE place and kept in the status;
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
  /** The shell, directory and environment the terminal is made with (`ChannelLaunch`). Absent: the host's own choices. */
  readonly launch?: Pick<ChannelLaunch, 'command' | 'cwd' | 'env'> | undefined;
  /** How long the feed waits before it connects again after each stream that dropped; the feed fails when they are used up. Default: `RECONNECT_DELAYS_MS`. */
  readonly reconnectDelaysMs?: readonly number[] | undefined;
};

export type ExecFeed = TerminalFeedHandle & {
  readonly id: string;
  /** How many pieces of typed input the feed holds (sent or not) that the host has not said it applied: a test holds it to a bound. */
  readonly keptPieces: () => number;
  /** How many bytes the pieces kept still reference, confirmed or not (a test holds a confirmed piece to be let go of at once). */
  readonly keptHeld: () => number;
};

/** How long a size stands still before it is sent: a drag of the splitter is one message. */
export const SETTLE_MS = 100;

/** How long the feed waits before it connects again, after the first, the second and the third stream that dropped without a word of the host (docs/ui-next/terminal-channel-protocol.md section 11). */
export const RECONNECT_DELAYS_MS: readonly number[] = [250, 1_000, 4_000];

const NO_BYTES = new Uint8Array(0);

/** How many streams in a row the kept input is sent to again with none of it applied, before it is let go of. The resend is at most `MAX_KEPT_INPUT_BYTES` (1 MiB) each time, under the host's 8 MiB lane cap, so a stream is never closed for it. */
const MAX_RESENDS = 3;

/** A new writer id: 16 random bytes as 32 lowercase hex digits. It is not a secret and opens nothing. */
function writerId(): string {
  const bytes = new Uint8Array(16);
  if (typeof platform.crypto?.getRandomValues === 'function') {
    platform.crypto.getRandomValues(bytes);
  } else {
    // Where the platform has no crypto (a test environment) the id is made from the clock and a counter and Math.random: unique within a run, and as unguessable as it needs to be (it opens nothing).
    counter += 1;
    let seed = Date.now() * 4096 + counter;
    for (let at = 0; at < bytes.length; at += 1) {
      bytes[at] = Math.floor(Math.random() * 256) ^ (seed & 0xff);
      seed = Math.floor(seed / 7);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

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
const INPUT_OVERFLOW = 'More was typed than the terminal has taken: the page keeps at most 1 MiB of input that the host has not said it applied, so the terminal was given up.';

/** What a host of another version of the stream says: the number when it gives one. */
const unsupportedWords = (version: unknown): string =>
  typeof version === 'number' && Number.isSafeInteger(version)
    ? `The terminal host speaks version ${String(version)} of the terminal channel and this page speaks version ${String(CHANNEL_VERSION)}, so the terminal cannot be reached.`
    : `The terminal host speaks another version of the terminal channel than this page (version ${String(CHANNEL_VERSION)}), so the terminal cannot be reached.`;
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
  /** The bytes of input the host has applied from this capability, across streams: the feed sends again what it kept after it. */
  readonly inputApplied: number;
  /** Whether the host had a count for this feed's writer before this attach; absent: known (a host that does not say cannot lose a count). */
  readonly writerKnown: boolean;
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
  const inputApplied = finite(Reflect.get(value, 'input_applied'));
  const size = sizeOfWire(Reflect.get(value, 'size'));
  if (start === undefined || end === undefined || lost === undefined || inputApplied === undefined || size === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(lost) || !Number.isSafeInteger(inputApplied) || start < 0 || end < start || lost < 0 || inputApplied < 0) {
    return undefined;
  }

  const ended: unknown = Reflect.get(value, 'ended');
  return {
    start,
    end,
    lost,
    inputApplied,
    writerKnown: Reflect.get(value, 'writer_known') !== false,
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
  let fate: Fate = attachTo?.ended === true ? 'dismiss' : 'ours';
  let closing: Promise<void> | undefined;
  let woken = false;
  let warnedRefresh = false;
  /** The page left the terminal for the page that comes back (`leave`): it is no longer this page's to write to, to size or to end. */
  let left = false;
  /**
   * What the user typed that the host has not said it applied, in order, in pieces of at most `MAX_INPUT_BYTES`: `kept[head..]`, `keptBytes` bytes. `sentTo` is how many of them the stream now open took (a stream
   * that is over took none that counts: after its successor's `ready` the feed sends from `head`). `applied` is the host's count of input applied up to the first kept byte; unknown until the first `ready`.
   */
  let kept: Uint8Array[] = [];
  let head = 0;
  let sentTo = 0;
  let keptBytes = 0;
  let applied: number | undefined;
  /** Some of the kept bytes were handed to a stream already: what the next `ready` has the feed send again is a resend. */
  let sentOnce = false;
  /** How many streams in a row had the kept bytes sent to them again with the host applying none of them. */
  let resends = 0;
  /** The feed has had a `ready` of its writer before: a host that then does not know the writer has lost its count. */
  let attachedBefore = false;
  /** The terminal was taken by another stream and this stream stays open as a watcher, which hears `released` or `ended`. */
  let watching = false;
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
  /** The stream now open has brought the terminal's whole replay, or continues the output with none to bring: what it said of the end is complete, and the connection is good. */
  let complete = false;
  /** Where the output the host advertised for the stream now open ends: a continuation is complete when the cursor is there. */
  let resumeEnd = 0;
  /** A stream of this feed said `ready` at least once. */
  /** The id this feed types under (16 random bytes, 32 lowercase hex digits): said in every attach, so that the host counts the input applied for this feed alone and the count in `ready` and `applied` is this feed's own. */
  const writer = writerId();
  /** A stream was ever opened for this feed: from then on another stream may have taken the terminal, and only the stream (or the lease) may end it. */
  let everConnected = false;
  let retry: Timer | undefined;
  /** The marks of the shell's integration taken so far, oldest first, the end offset of the last one, what a command start said runs (the producer's word), and the list the feed hands out until a mark comes. */
  let marks: TerminalMark[] = [];
  let markedEnd = -1;
  let running: { readonly name: string | undefined } | undefined;
  let markList: readonly TerminalMark[] | undefined;

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
  let refreshing: Promise<boolean> | undefined;
  /** A close in flight on the live stream: the host ends the terminal when this stream holds it and tells the stream (`ended`); a watcher is told `close-refused`. */
  let ending: (() => void) | undefined;

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
    kept = [];
    head = 0;
    sentTo = 0;
    keptBytes = 0;
    bounce = undefined;
  };

  /** Lets go of the stream: its events are no longer heard, and the host is told the page is done with it unless the stream is over already. */
  const unlink = (close: boolean) => {
    connection = undefined;
    streaming = false;
    watching = false;
    gathering = undefined;
    sentTo = head;
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
    if (current === undefined || current.free === free || (!free && current.free === undefined && current.unwatched !== true)) {
      return;
    }

    const base = current.unwatched === true ? { by: current.by, unwatched: true } : { by: current.by };
    status = { ...status, detached: free ? { ...base, free } : current.unwatched === true ? { ...base, free } : base };
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

  /** What the user typed, as text or as raw bytes: counted, kept and sent the same way. `empty` is a call with nothing in it, which is no typing. */
  const type = (empty: boolean, kept: () => boolean): void => {
    if (closed() || left || (status.state !== 'running' && status.state !== 'starting')) {
      return;
    }

    if (!empty) {
      typed += 1;
    }

    if (status.inputLost === true && !empty) {
      const { inputLost: _lost, ...rest } = status;
      status = rest;
      tell();
    }

    if (kept()) {
      pump();
    }
  };

  /** Sends what the user typed that the stream now open has not taken, in order, in frames of at most `MAX_INPUT_BYTES`. */
  const pump = () => {
    while (sentTo < kept.length && usable()) {
      const piece = kept[sentTo];
      // A link that refuses the bytes is over (it has told `closed`): they stay kept, to be sent after the next `ready`.
      if (piece === undefined || link?.input(piece) === false) {
        return;
      }

      sentTo += 1;
      sentOnce = true;
    }
  };

  /** Keeps what was typed, in pieces, within the bound. False: there is no more room, and the feed has given the terminal up. */
  const keep = (text: string): boolean => {
    let rest = text;
    while (rest !== '') {
      const length = pieceLength(rest);
      if (!keepPiece(encoder.encode(rest.slice(0, length)))) {
        return false;
      }

      rest = rest.slice(length);
    }

    return true;
  };

  /** Keeps raw bytes (a mouse report), in pieces of at most `MAX_INPUT_BYTES`, as `keep` keeps text: the same bound, the same order, the same resend. */
  const keepBinary = (bytes: Uint8Array): boolean => {
    for (let at = 0; at < bytes.length; at += MAX_INPUT_BYTES) {
      if (!keepPiece(bytes.slice(at, at + MAX_INPUT_BYTES))) {
        return false;
      }
    }

    return true;
  };

  /** Keeps one piece of at most `MAX_INPUT_BYTES`. False: there is no more room, and the feed has given the terminal up. */
  const keepPiece = (piece: Uint8Array): boolean => {
    if (keptBytes + piece.length > MAX_KEPT_INPUT_BYTES) {
      failStream(INPUT_OVERFLOW);
      return false;
    }

    // What waits for a stream goes in as few frames as it can: typing while the stream is away is one frame, as it was typed.
    const last = kept.length > sentTo ? kept[kept.length - 1] : undefined;
    if (last !== undefined && last.length + piece.length <= MAX_INPUT_BYTES) {
      const joinedPiece = new Uint8Array(last.length + piece.length);
      joinedPiece.set(last);
      joinedPiece.set(piece, last.length);
      kept[kept.length - 1] = joinedPiece;
    } else {
      kept.push(piece);
    }

    keptBytes += piece.length;

    return true;
  };

  /** Lets go of every byte kept, unconfirmed: the host's count is `total` from here on, and the user is told that input typed while away may be lost. */
  const dropKept = (total: number) => {
    const lost = keptBytes > 0;
    kept = [];
    head = 0;
    sentTo = 0;
    keptBytes = 0;
    sentOnce = false;
    resends = 0;
    applied = total;
    // Only input that was kept and is let go of may be lost: a reconnect after nothing was typed says nothing.
    if (lost) {
      status = { ...status, inputLost: true };
      tell();
    }
  };

  /** The host has applied input up to `total` (its count, across streams): the kept bytes up to it are let go. A number that does not grow changes nothing; one above what the feed typed is all of it, and said once. */
  const confirm = (total: number): number => {
    if (applied === undefined) {
      // The first `ready`: nothing this feed typed was before it.
      applied = total;
      return 0;
    }

    let drop = total - applied;
    if (drop <= 0) {
      return 0;
    }

    if (drop > keptBytes) {
      warn(`[terminal] the host says it applied ${String(total)} bytes of input and the feed typed ${String(applied + keptBytes)}`);
      drop = keptBytes;
    }

    applied += drop;
    keptBytes -= drop;
    let left = drop;
    while (left > 0) {
      const piece = kept[head];
      if (piece === undefined) {
        break;
      }

      if (piece.length <= left) {
        left -= piece.length;
        // The confirmed bytes are let go now, not when the array is next compacted.
        kept[head] = NO_BYTES;
        head += 1;
      } else {
        kept[head] = piece.subarray(left);
        left = 0;
      }
    }

    if (keptBytes === 0) {
      kept = [];
      head = 0;
      sentTo = 0;
      sentOnce = false;
      return drop;
    }

    sentTo = Math.max(sentTo, head);
    if (head >= 64 && head * 2 >= kept.length) {
      kept = kept.slice(head);
      sentTo -= head;
      head = 0;
    }

    return drop;
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
    complete = true;
    attempts = 0;
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
    if (!resumed) {
      forgetMarks(-1);
    }

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
    // What the host applied is not sent again; what it did not is, from the first kept byte, before anything typed since.
    if (!ready.writerKnown && attachedBefore) {
      // The host has no count for this feed's writer (it restarted, or forgot the writer): what it applied of the kept bytes is not known, and sending them again could type them twice. They are let go, and the user is told.
      dropKept(ready.inputApplied);
    } else {
      if (confirm(ready.inputApplied) > 0) {
        resends = 0;
      }

      // The same unconfirmed bytes sent to stream after stream with none applied (a program that never reads): sent a few times, then let go, so that the feed does not cycle with the host's lane cap closing each stream.
      if (keptBytes > 0 && sentOnce) {
        resends += 1;
        if (resends > MAX_RESENDS) {
          dropKept(ready.inputApplied);
        }
      }
    }

    attachedBefore = true;
    sentTo = head;
    // The first acknowledgement goes before anything else is sent, whatever a listener writes when it is told the feed is running. If it finds the socket dead the stream is over, and nothing more of this ready is read.
    const mine = connection;
    link?.ack(0);
    if (connection !== mine) {
      return;
    }

    readyEnded = ready.ended;
    resumeEnd = ready.end;
    // A continuation is complete when the cursor reaches the end the host advertised (at once when there is nothing to bring); a replay when it is whole.
    complete = resumed && ready.end === ready.start;
    if (complete) {
      attempts = 0;
    }

    if (status.state === 'starting') {
      const program = ready.program ?? createdProgram ?? status.program;
      status = program === undefined ? { state: 'running' } : { state: 'running', program };
      tell();
    }

    if (gathering !== undefined && ready.end === ready.start) {
      publishGathered();
    }

    flush();
    sendAck();
  };

  /** A continuation whose cursor has reached the end the host advertised is complete: the end it reported can be believed, and the connection is good. */
  const reached = () => {
    if (!complete && cursor >= resumeEnd) {
      complete = true;
      attempts = 0;
    }
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
      const mine = connection;
      sendAck();
      // The acknowledgement may have found the socket dead: the stream is over and the feed waits to connect again.
      if (connection !== mine || gathering === undefined) {
        return;
      }

      if (cursor === gathering.end) {
        publishGathered();
      }

      return;
    }

    next = cursor;
    outstanding += bytes.length;
    held.push(bytes);
    reached();
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
    forgetMarks(to);
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

    reached();
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
    if (watching) {
      // The terminal ended while another stream held it: this page learns how, and the end is not its to dismiss.
      unlink(false);
      const result = endOf(end);
      status = result.state === 'ended' ? { ...withProgram(result, status.program), ...(status.detached === undefined ? {} : { detached: { by: status.detached.by } }) } : result;
      tell();
      return;
    }

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

  /**
   * The marks of the shell's integration, in the order of the output. A mark is taken once: the host sends again the one that ends at the offset a stream came back from (it may have cut after the bytes and before the frame), so a mark
   * that ends at or before the last one taken is one the feed has. What runs is the host's word: a command start whose line the shell proved (`nonce`) is a command running until an end mark comes; a start that anything could have
   * printed is not (the host holds the nonce, the page never decides trust).
   */
  const onMarks = (frame: unknown) => {
    if (!streaming) {
      return;
    }

    let taken = false;
    for (const mark of marksOf(frame)) {
      if (mark.end <= markedEnd) {
        continue;
      }

      taken = true;
      markedEnd = mark.end;
      marks.push(mark);
      if (mark.kind === 'command-start' && mark.trust === 'nonce') {
        running = { name: commandNameOf(mark.command) };
      } else if (mark.kind === 'command-end') {
        running = undefined;
      }
    }

    if (marks.length > MAX_MARKS) {
      marks.splice(0, marks.length - MAX_MARKS / 2);
    }

    if (taken) {
      markList = undefined;
    }
  };

  /** The marks and what is known of what runs start over: the screen is brought afresh (a replay of the terminal, or a gap), so the marks of the screen that was are of lines that are not there. */
  const forgetMarks = (from: number) => {
    marks = [];
    markedEnd = from;
    running = undefined;
    markList = undefined;
  };

  /** The host says how much input it has applied: the kept bytes up to it are let go. */
  const onApplied = (total: number) => {
    if (!streaming) {
      failStream(UNREADABLE_ATTACH, 'start');
      return;
    }

    if (confirm(total) > 0) {
      resends = 0;
    }
  };

  /** Another stream took the terminal: the feed ends for this page, with input off, and is told apart from one that ended. The stream stays open as a watcher, which the host tells `released` or `ended`. */
  const onTakenOver = () => {
    if (closed() || finished()) {
      return;
    }

    fate = 'not-ours';
    watching = true;
    streaming = false;
    gathering = undefined;
    dropOutgoing();
    const { program } = status;
    status = program === undefined ? { state: 'ended', detached: { by: 'taken-over' } } : { state: 'ended', program, detached: { by: 'taken-over' } };
    tell();
  };

  /** The watcher is told the terminal runs and is free: it can be taken back at once. The stream is over. */
  const onReleased = () => {
    if (!watching) {
      failStream(UNREADABLE_ATTACH, 'start');
      return;
    }

    unlink(false);
    setFree(true);
  };

  const onUnsupported = (version: unknown) => {
    failStream(unsupportedWords(version), 'start');
  };

  const onNotFound = () => {
    unlink(false);
    fate = 'not-ours';
    over({ state: 'failed', cause: { stage: 'session', message: TERMINAL_GONE } });
  };

  /** The close on the stream was answered or the stream is over: the stream is let go of, and the close resolves. */
  const finishEnding = () => {
    unlink(true);
    ending?.();
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
    if (watching) {
      // The host closed the watcher with no word (it watched longest of five) or the connection dropped: nothing says when the terminal is free, so the host is asked, once.
      unlink(false);
      if (status.detached !== undefined && status.exit === undefined) {
        status = { ...status, detached: { ...status.detached, unwatched: true } };
        tell();
      }

      learn(0);
      return;
    }

    unlink(false);
    // A terminal that had ended ends the feed only with its whole replay: a stream that dropped before that (before `ready`, or part of the way) is connected again, from nothing.
    const hint = complete ? (readyEnded ?? (attachTo?.ended === true ? {} : undefined)) : undefined;
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
    everConnected = true;
    complete = false;
    readyEnded = undefined;
    const heard =
      <Args extends unknown[]>(listener: (...args: Args) => void) =>
        (...args: Args): void => {
          if (connection === mine && !closed()) {
            listener(...args);
          }
        };

    /** What can end the stream also ends a close in flight on it: the close is over, however it was answered. */
    const heardEnd =
      <Args extends unknown[]>(listener: (...args: Args) => void) =>
        (...args: Args): void => {
          if (connection === mine && ending !== undefined) {
            finishEnding();
          } else {
            heard(listener)(...args);
          }
        };

    try {
      link = channels.connect(id, from, {
        ready: heard(onReady),
        // While a close is in flight the bytes the host still sends are not the reader's, and are credited as they come: the host sends the end only after every byte, and sends bytes only against credit.
        output: (offset, bytes) => {
          if (connection === mine && ending !== undefined) {
            link?.ack(bytes.length);
          } else {
            heard(onOutput)(offset, bytes);
          }
        },
        gap: heard(onGap),
        applied: heard(onApplied),
        marks: heard(onMarks),
        ended: heardEnd(onEnded),
        takenOver: heard(onTakenOver),
        closeRefused: heardEnd(() => undefined),
        released: heardEnd(onReleased),
        unsupported: heardEnd(onUnsupported),
        notFound: heardEnd(onNotFound),
        closed: heardEnd(onClosed),
      }, writer);
    } catch (error) {
      connection = undefined;
      over({ state: 'failed', cause: causeOf('start', error) });
    }
  }

  /** Makes the terminal at the size the view measured, so that nothing is resized after it started. Once. */
  const start = (first: Size) => {
    started = true;
    delivered = first;
    creating = channels.create(id, { cols: first.cols, rows: first.rows, ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }), ...options.launch }).then(
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
  const ask = async (asking?: { readonly fresh?: boolean }): Promise<boolean> => {
    if (closed() || status.detached === undefined || status.exit !== undefined) {
      return true;
    }

    // A take-back needs an answer that began after its press: it waits for the listing that is out, and asks anew. A poll shares the one that is out.
    if (asking?.fresh === true && refreshing !== undefined) {
      await refreshing;
      if (closed() || status.detached === undefined || status.exit !== undefined) {
        return true;
      }
    }

    refreshing ??= (async () => {
      try {
        // The call is made inside the promise, so that a channel that throws instead of rejecting is a failure like any other.
        const entry = await new Promise<unknown>((resolve) => {
          resolve(channels.listed(id));
        });
        // What the page learned meanwhile stands: a feed that was closed, or whose terminal ended, has nothing to change.
        if (closed() || status.detached === undefined || status.exit !== undefined || typeof entry !== 'object' || entry === null) {
          return true;
        }

        const ended: unknown = Reflect.get(entry, 'ended');
        const attached: unknown = Reflect.get(entry, 'attached');
        if (typeof ended === 'object' && ended !== null) {
          setFree(false);
        } else if (typeof attached === 'boolean') {
          setFree(!attached);
        }

        return true;
      } catch (error) {
        if (!warnedRefresh) {
          warnedRefresh = true;
          warn('[terminal] the host could not say who holds the terminal this page lost', error);
        }

        return false;
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  };

  /** Whether the last fresh question of a take-back could not be asked: the lane says so, and the next press tries again. */
  const setAskFailed = (failed: boolean) => {
    const current = status.detached;
    if (current === undefined || (current.askFailed === true) === failed) {
      return;
    }

    const { askFailed: _was, ...rest } = current;
    status = { ...status, detached: failed ? { ...rest, askFailed: true } : rest };
    tell();
  };

  const refresh = async (asking?: { readonly fresh?: boolean }): Promise<void> => {
    const answered = await ask(asking);
    if (answered) {
      setAskFailed(false);
    } else if (asking?.fresh === true) {
      setAskFailed(true);
    }
  };

  /**
   * The host closed the watcher with no word, so nothing will say when the terminal is free: the host is asked. A question that could not be asked (the host was not reached) is asked again on the schedule of a reconnect
   * (250 ms, one second, four seconds) and then given up; one that was answered is final.
   */
  const learn = (attempt: number): void => {
    void ask().then((answered) => {
      const delay = delays[attempt];
      if (!answered && delay !== undefined && !closed() && status.detached?.free !== true) {
        retry = setTimeout(() => {
          retry = undefined;
          learn(attempt + 1);
        }, delay);
      }
    });
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
    keptPieces: () => kept.length,
    keptHeld: () => kept.reduce((sum, piece) => sum + piece.length, 0),

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

    marks: () => (markList ??= [...marks]),

    busy: async () => {
      if (closed() || left || status.state !== 'running') {
        return IDLE;
      }

      // The shell said a command is running: that is the fact, and the host is not asked (the process that holds the foreground is the shell itself while a builtin loops).
      if (running !== undefined) {
        return running.name === undefined ? { state: 'busy' } : { state: 'busy', name: running.name };
      }

      try {
        return busyOf(await channels.busy(id));
      } catch (error) {
        // A terminal the host says is gone has nothing running in it; a question that failed is a question not answered.
        return channels.isGone(error) ? IDLE : UNKNOWN;
      }
    },

    write: (text) => {
      type(text === '', () => keep(text));
    },

    writeBinary: (bytes) => {
      type(bytes.length === 0, () => keepBinary(bytes));
    },

    inputs: () => typed,

    // Nothing typed waits for a stream, and nothing sent waits in the link; a session that is over sends nothing more, so nothing is left to wait for.
    inputsSettled: () => closed() || finished() || (keptBytes === 0 && sentTo >= kept.length && (link?.pending() ?? 0) === 0),

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

      // Whether this feed holds a live stream to the terminal now, or made the terminal and never opened one (nobody else can hold it): only then is it this page's to end. A stream that dropped, is being connected again or is not ready may have been
      // taken by another tab meanwhile, and a close of the capability alone would end what that tab shows: it is left to the host's lease, until the host binds a close to the holder.
      const holding = (streaming && link !== undefined) || (attachTo === undefined && !everConnected);
      // A terminal this feed holds a live stream to is ended by the stream: the host ends it only if this stream still holds it (a page that was displaced without knowing is told `close-refused`), and tells the stream. The close of the
      // capability is for a terminal that was made and never attached: nobody else can hold it.
      if (fate === 'ours' && !left && streaming && link !== undefined && status.state === 'running') {
        const stream = link;
        // What the stream delivered and was not credited yet (what the reader has not parsed, and what it owes) is credited now: the discarded bytes would otherwise hold the end back.
        // (`owed` is always nothing here: a stream that is running credits what the reader parsed as it comes.)
        const uncredited = Math.max(0, outstanding - forgiven);
        closing = new Promise<void>((resolve) => {
          ending = resolve;
        });
        if (uncredited > 0) {
          stream.ack(uncredited);
        }

        dropOutgoing();
        held.clear();
        awaiting = undefined;
        if (!stream.end()) {
          finishEnding();
        }

        return closing;
      }

      unlink(true);
      dropOutgoing();
      held.clear();
      awaiting = undefined;
      closing = (creating ?? Promise.resolve()).then(async () => {
        // A terminal the host never made has nothing to end, nor has one this page lost to another, one the host does not know, or one it left for the page that comes back (ending it would end what the other page shows). One that ended by
        // itself is kept by the host, with its output, until a page forgets it: then the close dismisses it.
        if (!created || left || fate === 'not-ours' || (fate === 'ours' && !holding)) {
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

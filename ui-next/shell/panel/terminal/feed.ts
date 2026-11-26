import type { RouteInput } from '../../core/tabs';

// What the Terminal tool of the host reads and is told, in the host's own terms. A terminal session is a feed: a pty (or anything that speaks like one) that the host's registry owns from the moment
// a target is opened until the session goes. The feed is framework-free and holds no xterm: it holds BYTES (what the process wrote, until the view that draws them asks) and tells the registry what became of
// the process. The facts a producer may not know are optional members of the snapshot or of the handle, and everything that reads them has one path for the producer that knows and the one that does not
// (docs/ui-next/status/T1.md, "The producer's side"; docs/ui-next/status/T2a.md for what the host's own shell tells).

export type TerminalFeedState = 'starting' | 'running' | 'ended' | 'failed';

/** Where a failure happened: the session could not start, it broke after it ran, or what the user typed could not be delivered. */
export type TerminalFeedStage = 'start' | 'session' | 'input';

/**
 * Why a session failed: where, in the producer's own words, its typed code when it has one (`SHELL_UNAVAILABLE`: no shell could be started) and, for that code, the shells the host tried, in the order it tried them.
 * Nothing branches on the words; the code is what the host reads, and the tokens of an attempt are mapped to words by `state.ts`.
 */
export type TerminalFeedCause = { readonly stage: TerminalFeedStage; readonly message: string; readonly code?: string | undefined; readonly tried?: readonly TerminalShellAttempt[] | undefined };

/** One shell the host tried to start (host PR #672, `AppError.tried`): where it came from (`requested`, `environment`, `account`, `fallback`), its path, why it was not used (`not-found`, `not-executable`, `not-a-shell`, `other`) and the system's words for `other`. The tokens are the host's: one this page does not know is shown as it was given. */
export type TerminalShellAttempt = { readonly source: string; readonly path: string; readonly reason: string; readonly detail?: string | undefined };

/** Who ended a process the host ended: a close that was asked for, the window the shell belonged to, the host quitting, or the lease of a terminal that no page held running out (T2-go). */
export type TerminalClosedBy = 'request' | 'window' | 'shutdown' | 'detach-timeout';

/** How a process ended, when its producer says: the exit code, the signal that ended it, or who closed it, and what the host did with the output of a program that kept the terminal open. */
export type TerminalExit = {
  readonly code?: number | undefined;
  readonly signal?: string | undefined;
  readonly signalNumber?: number | undefined;
  readonly coreDumped?: boolean | undefined;
  readonly closedBy?: TerminalClosedBy | undefined;
  /** A program kept the terminal open after the shell exited, so the host stopped reading it. */
  readonly drainCapped?: boolean | undefined;
  /** The bytes the host read from it after that and did not keep. */
  readonly droppedBytes?: number | undefined;
};

/**
 * What runs in a session besides its shell, asked at the moment it matters (a close): `idle` is the shell at its prompt, `busy` is a program (named when its producer names it), `unknown` is a producer that
 * cannot tell, which a close treats as a program that may be running.
 */
export type TerminalBusy =
  | { readonly state: 'idle' }
  | { readonly state: 'busy'; readonly name?: string | undefined }
  | { readonly state: 'unknown' };

/** A size in cells. */
export type TerminalSize = { readonly cols: number; readonly rows: number };

/** The modes a terminal is in at an offset of its output (T2-go `TerminalModes`): what a reattach has to switch back on before it writes the bytes. `mouseTracking` is bits (1 click, 2 drag, 4 any motion), `mouseEncoding` is 0 X10, 1 UTF-8, 2 SGR, 3 urxvt. */
export type TerminalModes = {
  readonly altScreen: boolean;
  readonly bracketedPaste: boolean;
  readonly applicationCursor: boolean;
  readonly focusEvents: boolean;
  readonly cursorHidden: boolean;
  readonly mouseTracking: number;
  readonly mouseEncoding: number;
  /** The flag stack of the keyboard protocol of the screen showing, bottom first. */
  readonly kittyKeyboard: readonly number[];
};

/**
 * What a page that reattached to a terminal is given to bring a fresh emulator to where the terminal is: the bytes the host still kept, the size and the modes they were written under (`startSize`, `startModes`)
 * and the size and modes in force at their end (`size`, `modes`). The reader takes it once, before any live output, applies it with the emulator's replies to queries MUTED (they must not reach the shell), and
 * acknowledges none of it (T2-go 2.4, rules 4 and 6).
 */
export type TerminalReplay = {
  readonly data: Uint8Array;
  readonly startSize: TerminalSize;
  readonly startModes: TerminalModes;
  readonly size: TerminalSize;
  readonly modes: TerminalModes;
  /** The offset after the last byte of `data`: the live output continues there. */
  readonly end: number;
};

/** Why a session is no longer held by this page though its process lives on: another page took it (`taken-over`). */
export type TerminalDetached = {
  readonly by: 'taken-over';
  /**
   * The tab that took the terminal has let it go (the host's listing says no stream holds it): nobody holds the terminal now and its lease runs, so this page may take it back (T2d). Absent while another tab still holds it,
   * and once the terminal has ended.
   */
  readonly free?: boolean | undefined;
  /**
   * The host closed this page's watcher with no word (it watched longest of five, or the connection dropped), so the page can no longer be told when the terminal is free. It offers the way back anyway: the press asks the host first and
   * attaching takes the terminal. The lane does not say the taker has gone; only `free` says that.
   */
  readonly unwatched?: boolean | undefined;
  /** The last fresh question of a take-back could not be asked (the host was not reached): nothing was attached, and the lane says so. Cleared by the next answer. */
  readonly askFailed?: boolean | undefined;
};

/** Whether the way back is offered: the taker has gone (`free`), or the page can no longer be told (`unwatched`): then the button stays whatever the host last said, because nothing will tell the page when the holder leaves; the press asks the host anew and attaches only when it says nobody holds the terminal. */
export const offersTakeBack = (detached: TerminalDetached | undefined): boolean => detached?.free === true || detached?.unwatched === true;

/** The status of a feed: the same object until something in it changes. */
export type TerminalFeedSnapshot = {
  readonly state: TerminalFeedState;
  /** Why it failed. Only a failed feed has one. */
  readonly cause?: TerminalFeedCause | undefined;
  /** How the process ended. Known only once the feed has ended, and only when the producer says: an ended feed with none ended in a way nobody told us. */
  readonly exit?: TerminalExit | undefined;
  /** The program the session runs, as its producer names it (`zsh`), when it says. It names the tab, and the card's shell. */
  readonly program?: string | undefined;
  /** Set when this page lost a terminal that still runs (T2-go `DETACHED`): the state is `ended` for this page, the process is not. Input is off; nothing more comes. */
  readonly detached?: TerminalDetached | undefined;
  /** The host did not know this feed's writer when its stream came back (a host restart, an evicted writer), or applied none of what was resent: what was typed while the connection was away may be lost, and the lane says so until the next thing is typed. */
  readonly inputLost?: boolean | undefined;
};

/** What the process wrote since the last read, oldest first: its bytes (an escape sequence may be cut between two chunks, the emulator keeps its state). */
export type TerminalOutput = {
  readonly chunks: readonly Uint8Array[];
  readonly bytes: number;
};

/**
 * The session as the host holds it. `subscribe` tells a listener of every change of status, and, when output is held for a reader, once until that reader has read (so a flood is one wake-up between two
 * reads, never one per chunk). `close` ends the process, once: it releases every listener and what the feed holds in the backend. A `close` that rejects or throws is logged.
 */
export type TerminalFeedHandle = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => TerminalFeedSnapshot;
  /**
   * What is held, oldest first: all of it, or, given a count of bytes, whole chunks until that count is reached (at least one) and the rest stays for the next read: a reader that cannot take more now asks for
   * less. The producer's own pacing is the only bound on what waits here (the host's shell stops sending a process's output that nobody takes in: `ack`). A read that leaves output held does not wake the reader
   * again by itself: it knows, it asked for less.
   */
  readonly read: (max?: number) => TerminalOutput;
  /**
   * The reader parsed this many bytes of what it read: the process may be sent more. Credit follows PARSING, whether or not the screen is shown: a hidden terminal goes on reading, parsing and acknowledging, so a build in it
   * is never stalled by the view. Only a feed with NO reader at all (a web view that is busy, nobody listening) reads and acknowledges nothing, and the host answers that by pausing the shell at its mark, losing nothing.
   * A producer with no pacing ignores it.
   */
  readonly ack: (bytes: number) => void;
  /** What the user typed or pasted. Delivered in order; ignored once the session is over. */
  readonly write: (text: string) => void;
  /**
   * Raw bytes the emulator sends for the person (a legacy X10 mouse report: its three bytes after `ESC [ M` are the coordinates plus 32, and a byte above 127 is not UTF-8). They go the way typed text goes (kept until the host
   * applies them, sent again once after a cut, dropped when the host does not know the writer) and reach the shell as they are, never as UTF-8 of a character.
   */
  readonly writeBinary: (bytes: Uint8Array) => void;
  /**
   * How many calls of `write` the user's typing has made so far: it only goes up, and counts what the feed took (typing it ignored, and a call with nothing typed, are not counted). A close that asked what runs in the
   * session compares it before and after the answer: `idle` is true of the moment the host looked, and what was typed since may have started a program. A producer that does not count leaves it out, and then its `idle`
   * cannot be trusted: a close asks.
   */
  readonly inputs?: (() => number) | undefined;
  /**
   * Whether everything that was typed has reached the process: true when nothing typed waits to be sent and none of it is in flight (and for a session that is over, which sends nothing more). A close that asked what runs
   * reads it when it asks and again at the answer: typing that was on its way then may have started a program that the host's answer does not know. A producer that leaves it out says nothing of it, and `inputs` alone is read.
   */
  readonly inputsSettled?: (() => boolean) | undefined;
  /** The size of the screen, in cells. The feed settles bursts: one message to the process for a size that stood still. */
  readonly resize: (cols: number, rows: number) => void;
  /** What runs in the session besides its shell, asked now. A producer that cannot tell leaves it out, and a close asks. A producer that tells and cannot count the typing (`inputs`) is asked about all the same, but its `idle` is read as `unknown`. */
  readonly busy?: (() => Promise<TerminalBusy>) | undefined;
  readonly close: () => Promise<void> | void;
  /**
   * A replay waiting for the reader (a terminal taken over, one whose stream dropped and lost bytes the page asked for, or a gap: a replay of nothing, which resets the screen): taken once, before any live output is read; `read`
   * returns nothing until it is taken. A producer that has no such replay leaves it out.
   */
  readonly takeReplay?: (() => TerminalReplay | undefined) | undefined;
  /**
   * The page is going away (`pagehide`, the window is retired): the terminal is DETACHED, not closed, so that its shell lives on for its lease and the page that comes back finds it (the stream's detach frame). A feed this
   * page no longer holds, or whose terminal is over, does nothing here (and is closed by the caller as before). Fire and forget.
   */
  readonly leave?: (() => void) | undefined;
  /**
   * Makes a full-screen program draw itself again: the size is sent one cell off and then as it is, so that the pty signals a change twice (a replay brings an emulator to the bytes the program wrote and the program must paint
   * over them). A reader calls it after a replay when the size the host has is the size the screen already is, which a plain resize would not send. A producer that cannot leaves it out.
   */
  readonly redraw?: (() => void) | undefined;
  /**
   * Asks the host who holds a terminal this page LOST (the host's listing of its capability, no attach): a terminal that no stream holds now makes `detached.free` true (the tab that took it has let it go), one that a stream
   * holds makes it false, and one the host has no entry for is left as it is. It never attaches, never takes the terminal over and never throws. It is how a take-back checks that the terminal is still free before it attaches.
   * A feed that is not lost does nothing. A poll shares the listing that is out; `fresh` (a take-back) waits for it and asks again, so that its answer begins after the press. A producer that cannot leaves it out.
   */
  readonly refresh?: ((options?: { readonly fresh?: boolean }) => Promise<void>) | undefined;
};

/** What opens a terminal session: plain data and one function. Who supplies it (the host's own shell today) is not the registry's business. */
export type TerminalTarget = {
  /** The plugin that supplies the process, by the id it is installed under, or the host. The session is its, and ends with it unless it is the host's. */
  readonly plugin: string;
  /** Names what runs, as its supplier knows it. Presentation and identity apart, a press always opens a NEW process: two shells on one target are two sessions. */
  readonly id: string;
  /** What the tab is called; the shell cuts a long one (SCT1). */
  readonly title: string;
  /** The tab's title once the feed says more than the target knew when it was opened (`zsh`, from the program the producer names). Without it the title the target gave stays. */
  readonly retitle?: ((status: TerminalFeedSnapshot) => string | undefined) | undefined;
  /** The muted qualifier after the title, which the tab draws only to tell two sessions of one title apart (TI1). */
  readonly scope?: string | undefined;
  /** The resource the session belongs to: its display text, the word of the card's button, its glyph and its page. */
  readonly resource?: { readonly label: string; readonly kind?: string | undefined; readonly icon?: string | undefined; readonly route?: RouteInput | undefined } | undefined;
  /** Starts the process. Called once, when the session opens. */
  readonly open: () => TerminalFeedHandle;
  /**
   * The id of the panel session this target opens, which is also the id of its terminal: a session that comes back after a reload has the id it was saved with, so the registry finds the saved tab and gives it
   * its feed again instead of making a second one. Absent: the registry makes an id (a producer with nothing to reattach).
   */
  readonly sessionId?: string | undefined;
  /**
   * The terminal's shell had already ended when the host listed it: the host keeps its output for the rest of its lease, and the registry gives it only to a tab the person still has (a saved tab that holds its id).
   * One that no tab holds is not brought back (a tab that was closed would otherwise return with the next reload). Absent: the terminal runs.
   */
  readonly ended?: boolean | undefined;
};

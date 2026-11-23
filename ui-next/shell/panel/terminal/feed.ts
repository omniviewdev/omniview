import type { RouteInput } from '../../core/tabs';

// What the Terminal tool of the host reads and is told, in the host's own terms. A terminal session is a feed: a pty (or anything that speaks like one) that the host's registry owns from the moment
// a target is opened until the session goes. The feed is framework-free and holds no xterm: it holds BYTES (what the process wrote, until the view that draws them asks) and tells the registry what became of
// the process. The facts a producer may not know are optional members of the snapshot or of the handle, and everything that reads them has one path for the producer that knows and the one that does not
// (docs/ui-next/status/T1.md, "The producer's side"; docs/ui-next/status/T2a.md for what the host's own shell tells).

export type TerminalFeedState = 'starting' | 'running' | 'ended' | 'failed';

/** Where a failure happened: the session could not start, it broke after it ran, or what the user typed could not be delivered. */
export type TerminalFeedStage = 'start' | 'session' | 'input';

/** Why a session failed: where, in the producer's own words, and its typed code when it has one (`SHELL_UNAVAILABLE`: no shell could be started). Nothing branches on the words; the code is what the host reads. */
export type TerminalFeedCause = { readonly stage: TerminalFeedStage; readonly message: string; readonly code?: string | undefined };

/** Who ended a process the host ended: a close that was asked for, the window the shell belonged to, or the host quitting. */
export type TerminalClosedBy = 'request' | 'window' | 'shutdown';

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

/** The status of a feed: the same object until something in it changes. */
export type TerminalFeedSnapshot = {
  readonly state: TerminalFeedState;
  /** Why it failed. Only a failed feed has one. */
  readonly cause?: TerminalFeedCause | undefined;
  /** How the process ended. Known only once the feed has ended, and only when the producer says: an ended feed with none ended in a way nobody told us. */
  readonly exit?: TerminalExit | undefined;
  /** The program the session runs, as its producer names it (`zsh`), when it says. It names the tab, and the card's shell. */
  readonly program?: string | undefined;
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
};

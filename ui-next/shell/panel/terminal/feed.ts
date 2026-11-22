import type { RouteInput } from '../../core/tabs';

// What the Terminal tool of the host reads and is told, in the host's own terms. A terminal session is a feed: a pty (or anything that speaks like one) that the host's registry owns from the moment
// a target is opened until the session goes. The feed is framework-free and holds no xterm: it holds BYTES (what the process wrote, bounded, until the view that draws them asks) and tells the
// registry what became of the process. The facts a producer may not know are optional members of the snapshot, and everything that reads them has one path for the producer that knows and the one
// that does not (docs/ui-next/status/T1.md, "The producer's side").

export type TerminalFeedState = 'starting' | 'running' | 'ended' | 'failed';

/** Where a failure happened: the session could not start, it broke after it ran, or what the user typed could not be delivered. */
export type TerminalFeedStage = 'start' | 'session' | 'input';

export type TerminalFeedCause = { readonly stage: TerminalFeedStage; readonly message: string };

/** How a process ended, when its producer says: the exit code, or the signal that ended it. */
export type TerminalExit = { readonly code?: number | undefined; readonly signal?: string | undefined };

/** A program that runs in the session besides its shell, named when its producer names it. */
export type TerminalForeground = { readonly name?: string | undefined };

/** The status of a feed: the same object until something in it changes. */
export type TerminalFeedSnapshot = {
  readonly state: TerminalFeedState;
  /** Why it failed. Only a failed feed has one. */
  readonly cause?: TerminalFeedCause | undefined;
  /** How the process ended. Known only once the feed has ended, and only when the producer says: an ended feed with none ended in a way nobody told us. */
  readonly exit?: TerminalExit | undefined;
  /**
   * What runs in the session besides its shell, when the producer says: `false` is nothing (the shell is at its prompt), an object is a program. Absent: not known, which a close treats as a program that may be running.
   */
  readonly foreground?: false | TerminalForeground | undefined;
  /** The program the session runs, as its producer names it (`zsh`), when it says. */
  readonly program?: string | undefined;
};

/** What the process wrote since the last read, oldest first: its bytes (an escape sequence may be cut between two chunks, the emulator keeps its state), and how many bytes the bound dropped. */
export type TerminalOutput = {
  readonly chunks: readonly Uint8Array[];
  readonly bytes: number;
  /** Bytes dropped past the bound since the last read: the oldest ones. Reported once. */
  readonly dropped: number;
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
   * less, and the feed's own bound is the only place output waits. A read that leaves output held does not wake the reader again by itself: it knows, it asked for less.
   */
  readonly read: (max?: number) => TerminalOutput;
  /** What the user typed or pasted. Delivered in order; ignored once the session is over. */
  readonly write: (text: string) => void;
  /** The size of the screen, in cells. The feed settles bursts: one message to the process for a size that stood still. */
  readonly resize: (cols: number, rows: number) => void;
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
  /** The muted qualifier after the title, which the tab draws only to tell two sessions of one title apart (TI1). */
  readonly scope?: string | undefined;
  /** The resource the session belongs to: its display text, the word of the card's button, its glyph and its page. */
  readonly resource?: { readonly label: string; readonly kind?: string | undefined; readonly icon?: string | undefined; readonly route?: RouteInput | undefined } | undefined;
  /** Starts the process. Called once, when the session opens. */
  readonly open: () => TerminalFeedHandle;
};

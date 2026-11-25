import type { TerminalShellAttempt } from './feed';

// The contract between the feed of a terminal (`execFeed.ts`) and the one place that holds the terminals' capabilities and their streams (`terminalChannel.ts`), in the host's terms
// (docs/ui-next/terminal-channel-protocol.md). The feed never sees a capability: it names a terminal by its id, which is a label that opens nothing, and `terminalChannel.ts` finds the capability for it. The
// binary framing is `terminalChannel.ts`'s; the JSON a frame carries (`ready`, `ended`) is handed on parsed and unchecked, and the feed reads it, as it reads every answer of the host.

/** What one stream of a terminal tells the feed that opened it. Each is called in the order the host sent it; none after `ended`, `takenOver`, `notFound` or `closed`, and exactly one of those four ends the stream. */
export type ChannelEvents = {
  /** The first frame of the host (`0x81`), its JSON parsed: `start`, `end`, `lost`, `size`, `start_size`, `modes`, `start_modes`, `cwd`, `busy`, `session`, `lease_ms`, `ended`. */
  readonly ready: (ready: unknown) => void;
  /** `0x82`: the bytes of the terminal's output from `offset`. The array is the feed's to keep. */
  readonly output: (offset: number, bytes: Uint8Array) => void;
  /** `0x83`: the bytes `[from, to)` were overwritten before they were sent; the next output starts at `to`. */
  readonly gap: (from: number, to: number) => void;
  /** `0x84`: how the terminal ended (`terminal.End`, parsed), after its last byte. The stream is over. */
  readonly ended: (end: unknown) => void;
  /** `0x85`: another stream took the terminal. The stream is over; the capability is kept, so that the terminal can be taken back. */
  readonly takenOver: () => void;
  /** `0x86`, or no capability is held for the id: the terminal is not there for this page. The stream is over and the capability is forgotten. */
  readonly notFound: () => void;
  /** The stream ended without any of the four above (the connection dropped, the host closed it, a frame that could not be read). The terminal may still run: the feed may connect again from its offset. */
  readonly closed: () => void;
};

/** What the feed sends on a stream it opened. Frames sent before the stream is open wait, in order, behind the attach; frames sent after the stream is over are dropped. */
export type ChannelLink = {
  /** `0x02`: what was typed, at most `MAX_INPUT_BYTES` in one frame (the feed cuts larger pieces). False: the bytes were not sent because the stream is over (the link tells `closed`, once); the feed keeps them for the next stream. */
  readonly input: (bytes: Uint8Array) => boolean;
  /** `0x03`: the size, each from 1 to 1,000. */
  readonly resize: (cols: number, rows: number) => void;
  /** `0x04`: bytes of output the page parsed since its last acknowledgement. The first one, of nothing if need be, turns on the host's window for this stream. */
  readonly ack: (bytes: number) => void;
  /** `0x05`: the page is leaving; the host lets the terminal go at once (its lease runs) and closes the stream. */
  readonly detach: () => void;
  /** Closes the stream without a word: the host detaches the terminal as for any end of a stream. No event follows. */
  readonly close: () => void;
  /** Bytes sent and not yet handed to the transport (waiting for the stream to open, or in the transport's own buffer). */
  readonly pending: () => number;
};

/**
 * The size a terminal starts at, and how long the host keeps it once no stream holds it. `command` is the shell (its first element, a name or a path) and the arguments that follow it, `cwd` the directory it starts in and `env` what the
 * host adds to its environment: each absent when the person chose none, so that the host's own choice (the default shell, the home directory) applies.
 */
export type ChannelLaunch = {
  readonly cols: number;
  readonly rows: number;
  readonly leaseMs?: number | undefined;
  readonly command?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
};

/**
 * The terminals of this page, by id. The capabilities are held behind it and never handed out. Every call that names an id this page holds no capability for answers as the host does for a capability that opens nothing:
 * a rejection that `isGone` recognises.
 */
export type TerminalChannels = {
  /** Starts a channel terminal under `id` (`CreateTerminal` with `launch.channel`) and keeps its capability. Answers the host's session, without the capability. */
  readonly create: (id: string, launch: ChannelLaunch) => Promise<unknown>;
  /** Opens a stream to the terminal and attaches it, from `fromOffset` when the page has the bytes before it (absent: the page has nothing). */
  readonly connect: (id: string, fromOffset: number | undefined, events: ChannelEvents) => ChannelLink;
  /** Ends the terminal (`CloseChannelTerminal`) and forgets its capability. */
  readonly close: (id: string) => Promise<void>;
  /** Forgets the end a terminal left (`DismissChannelTerminal`) and its capability. */
  readonly dismiss: (id: string) => Promise<void>;
  /** What runs in the terminal (`ChannelTerminalBusy`): the host's answer, which the feed reads. */
  readonly busy: (id: string) => Promise<unknown>;
  /** The terminals this page holds a capability for that the host still has (`ListChannelTerminals`), as the host lists them (`terminal.ChannelListed`, by id). A capability the host answered nothing for is forgotten. */
  readonly list: () => Promise<readonly unknown[]>;
  /** The host's entry for one terminal, or `undefined` when it has none (`ListChannelTerminals` of one capability). Never attaches. */
  readonly listed: (id: string) => Promise<unknown>;
  /** An error of the host, in a sentence. */
  readonly describe: (error: unknown) => string;
  /** Whether an error says the terminal is not there (`omniview:session/not-found`). */
  readonly isGone: (error: unknown) => boolean;
  /** The typed code of an error of the host (`SHELL_UNAVAILABLE`), when it has one. Nothing reads the words. */
  readonly codeOf: (error: unknown) => string | undefined;
  /** The shells the host tried before it refused to start one (`SHELL_UNAVAILABLE`), as tokens: `source`, `path`, `reason`, `detail`. */
  readonly triedOf: (error: unknown) => readonly TerminalShellAttempt[] | undefined;
};

/** The most bytes one input frame carries (`channel_max_input_bytes` is 1 MiB; a paste goes in pieces of this size). */
export const MAX_INPUT_BYTES = 65_536;

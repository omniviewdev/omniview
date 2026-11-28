import type { TerminalShellAttempt } from './feed';

// The contract between the feed of a terminal (`execFeed.ts`) and the one place that holds the terminals' capabilities and their streams (`terminalChannel.ts`), in the host's terms
// (docs/ui-next/terminal-channel-protocol.md). The feed never sees a capability: it names a terminal by its id, which is a label that opens nothing, and `terminalChannel.ts` finds the capability for it. The
// binary framing is `terminalChannel.ts`'s; the JSON a frame carries (`ready`, `ended`) is handed on parsed and unchecked, and the feed reads it, as it reads every answer of the host.

/** What one stream of a terminal tells the feed that opened it. Each is called in the order the host sent it; none after `ended`, `released`, `notFound`, `unsupported` or `closed`, and exactly one of those five ends the stream. `takenOver` does not end it: the stream is then a watcher, which hears `released` or `ended` (each ends the stream), `closeRefused` for a `close` sent before the takeover was heard (`takenOver` then `closeRefused`; the stream stays), and nothing else from the host; it may also end as `closed` with no host frame (the host evicted it as the longest-watching of five, or the connection dropped). */
export type ChannelEvents = {
  /** The first frame of the host (`0x81`), its JSON parsed: `start`, `end`, `lost`, `input_applied`, `size`, `start_size`, `modes`, `start_modes`, `cwd`, `busy`, `session`, `lease_ms`, `ended`. */
  readonly ready: (ready: unknown) => void;
  /** `0x82`: the bytes of the terminal's output from `offset`. The array is the feed's to keep. */
  readonly output: (offset: number, bytes: Uint8Array) => void;
  /** `0x83`: the bytes `[from, to)` were overwritten before they were sent; the next output starts at `to`. */
  readonly gap: (from: number, to: number) => void;
  /** `0x84`: how the terminal ended (`terminal.End`, parsed), after its last byte. The stream is over. */
  readonly ended: (end: unknown) => void;
  /** `0x87`: the bytes of input the host has applied from the capability, across streams, so far (a number that never goes down). */
  readonly applied: (total: number) => void;
  /** `0x85`: another stream took the terminal. This stream stays open as a watcher: the host sends it no output and refuses what is sent on it, and tells it `released` or `ended` and closes it. The capability is kept, so that the terminal can be taken back. */
  readonly takenOver: () => void;
  /** `0x8a`: the stream's `close` ended nothing: it does not hold the terminal (another stream took it). The stream goes on, as a watcher. */
  readonly closeRefused: () => void;
  /** `0x8b`: the marks of the shell's integration (protocol section 4a), the frame's JSON parsed and unchecked: `{v: 1, marks: [...]}`. Sent only to a page that said `marks: 1` in its attach, after the bytes of each mark's sequence. */
  readonly marks: (frame: unknown) => void;
  /** `0x8c`: the title a program set and whether a program runs (protocol section 4b), the frame's JSON parsed and unchecked: `{v: 1, title, program}`. Sent only to a page that said `title: 1` in its attach, once when it attaches and whenever the pair changes. */
  readonly title: (frame: unknown) => void;
  /** `0x88`, to a watcher: the stream that held the terminal ended and the terminal runs and is free. The stream is over. */
  readonly released: () => void;
  /** `0x89`: the host speaks another version of the stream (its number, parsed from `{"v":n}` and unchecked). The stream is over; nothing is tried again. */
  readonly unsupported: (version: unknown) => void;
  /** `0x86`, or no capability is held for the id: the terminal is not there for this page. The stream is over and the capability is forgotten. */
  readonly notFound: () => void;
  /** The stream ended without any of the four above (the connection dropped, the host closed it, a frame that could not be read). The terminal may still run: the feed may connect again from its offset. */
  readonly closed: () => void;
};

/** What the feed sends on a stream it opened. Frames sent before the stream is open wait, in order, behind the attach; frames sent after the stream is over are dropped. */
export type ChannelLink = {
  /** `0x02`: what was typed, at most `MAX_INPUT_BYTES` in one frame (the feed cuts larger pieces). False: the bytes were not sent because the stream is over (the link tells `closed`, once); the feed keeps every byte it has not been told was applied and sends them again after the next `ready`. */
  readonly input: (bytes: Uint8Array) => boolean;
  /** `0x03`: the size, each from 1 to 1,000. */
  readonly resize: (cols: number, rows: number) => void;
  /** `0x04`: bytes of output the page parsed since its last acknowledgement. The first one, of nothing if need be, turns on the host's window for this stream. */
  readonly ack: (bytes: number) => void;
  /** `0x06`: ask that the terminal end, on this stream: it ends only when this stream holds the terminal, and the stream is then sent the rest of the output and `ended`; from a watcher it is answered `closeRefused`. False: the frame was not sent because the stream is over. */
  readonly end: () => boolean;
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
  /** What the page attaches to the terminal, which the host lists back with it (`params` of `CreateTerminal`): the tab the terminal belongs to, and what it was started with. Absent: nothing. */
  readonly params?: Readonly<Record<string, string>> | undefined;
};

/**
 * The terminals of this page, by id. The capabilities are held behind it and never handed out. Every call that names an id this page holds no capability for answers as the host does for a capability that opens nothing:
 * a rejection that `isGone` recognises.
 */
export type TerminalChannels = {
  /** Starts a channel terminal under `id` (`CreateTerminal` with `launch.channel`) and keeps its capability. Answers the host's session, without the capability. */
  readonly create: (id: string, launch: ChannelLaunch) => Promise<unknown>;
  /** Opens a stream to the terminal and attaches it, saying the feed's `writer` (32 lowercase hex digits, one for each feed, kept across its streams: the host counts input applied for each writer), from `fromOffset` when the page has the bytes before it (absent: the page has nothing). */
  readonly connect: (id: string, fromOffset: number | undefined, events: ChannelEvents, writer?: string) => ChannelLink;
  /** Ends the terminal (`CloseChannelTerminal`) and forgets its capability. */
  readonly close: (id: string) => Promise<void>;
  /** Forgets the end a terminal left (`DismissChannelTerminal`) and its capability. */
  readonly dismiss: (id: string) => Promise<void>;
  /** What runs in the terminal (`ChannelTerminalBusy`): the host's answer, which the feed reads. */
  readonly busy: (id: string) => Promise<unknown>;
  /** Which directory the shell of the terminal is in now (`ChannelTerminalCwd`): the host's answer, which the feed reads (`path`, or `reason` when the host cannot tell). */
  readonly cwd: (id: string) => Promise<unknown>;
  /** What a candidate link names on this machine (`ChannelTerminalResolveLink`): the host's answer, which the feed reads. */
  readonly resolveLink: (id: string, rowDirectory: string, text: string) => Promise<unknown>;
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

/** The version of the stream this page speaks (`attach.v`, protocol section 4). */
export const CHANNEL_VERSION = 2;

/** The version of the marks frame this page reads (`attach.marks`, protocol section 4a): the host sends the frame only to a page that says it. */
export const CHANNEL_MARKS_VERSION = 1;

/** The version of the title frame this page reads (`attach.title`, protocol section 4b): the host sends the frame only to a page that says it. */
export const CHANNEL_TITLE_VERSION = 1;

/** The most marks a feed keeps (the host keeps the newest 1,024 and at most twice that): the oldest go first. */
export const MAX_MARKS = 2048;

/** The most input the page keeps that the host has not said it applied (`channel_max_input_bytes`, the host's own queue): the bytes after the last `applied` are kept to be sent again after a reconnect, and a page that has typed more than this fails in words. */
export const MAX_KEPT_INPUT_BYTES = 1_048_576;

/** The most bytes one input frame carries (`channel_max_input_bytes` is 1 MiB; a paste goes in pieces of this size). */
export const MAX_INPUT_BYTES = 65_536;

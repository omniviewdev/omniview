// The real plugin host with NO plugin and a synthetic shell, for the Terminal probe (terminal-probe.mjs): `PluginHost` is the product's own, the Terminal tool in it is the product's own (the registry, the host's own
// shell target with its transport over the exec lane, the feed, the screen controller, xterm in its lazy chunk, the close guard and its dialog); only the far end is invented: the host's exec bindings (`ExecClient` and its
// events), answered by a pty that echoes what is typed, runs a few commands with known output and ends when told. A second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it.
//
// The far end speaks what the host's local terminal says (docs/ui-next/status/T1-go.md, section 2): the pty opens at the size the view measured and the create call answers a `terminal.Session` (the shell's path and
// name, the process id, the directory, the size, the limits); output reaches the page in events of at most 20,480 bytes under the host's CREDIT FLOW CONTROL (2.8.6: it counts the bytes it delivered that nobody credited,
// stops reading the pty at 1 MiB, so the shell WAITS, and reads again at 256 KiB; until the page's first `AckTerminal` call its receipt credits at once, from the first call on only its acknowledgements do); input
// reaches the shell through `WriteTerminal` and `ResizeTerminal`, each call carrying the number the page gave it, and the host puts the calls in the order of their numbers whatever order they arrive in (2.4); `IsBusy`
// answers `idle`, `busy` or `unknown` (2.3); the end of a session is a typed CLOSE event, the last event of the session, after everything the shell wrote (2.2); a start that fails is a typed error (2.5).
//
// The pty opens at the size the view measured (the host's `launch`), as the host's does. Commands (type them and press Enter):
//   hello           prints a known line                     size            prints "<rows> <cols>" of the pty (what the create call or the last resize said)
//   colors          prints the 16 colours of the palette    flood N [W]     prints N lines of W columns (default 80), in events of about 1,000 bytes, as the host's pty reads come; it writes while its pty has room and waits when the host stops reading
//   sleep N         runs N seconds (Ctrl+C ends it): `IsBusy` says `busy` and names `sleep` meanwhile
//   exit [code]     prints "logout" and ends: `exited`, with the code (default 0)         kill     ends: `signaled`, SIGKILL (9)        segv     ends: `signaled`, SIGSEGV (11), core dumped
//   quit            ends: `closed`, by the host quitting (`shutdown`)                       orphan   ends: `exited` 0, and the host says a program kept the terminal open and it dropped 4,096 bytes
//   fail            ends the session with an error signal
//   (anything else) prints "synthetic: command not found: <word>"
// A close the page asks for ends with `closed`, by `request`.
//
//   ?renderer=dom   the emulator keeps its DOM renderer (text a probe can read); the default is the GPU's while the terminal is on screen, as the product is
//   ?shell=<name>   the shell the create call says it started (`terminal.Session.shell.name`): default zsh
//   ?fail=<how>     the create call fails: `shell-unavailable` is the host's typed 422 (the detail names every path it tried), `start` is the host's typed start failure (500)
//   ?busy=<how>     what `IsBusy` answers while the shell runs: `unknown` is `{ state: 'unknown', reason: 'query-failed' }`, `hang` is no answer at all; by default `idle` at the prompt and `busy` while `sleep` runs
//   ?control=<name> the negative controls that perturb the far end or the emulator, each for the assertion of the probe it is named for: echo-slow, big-scrollback, leaky-heap (the emulator), the two of the screen reader
//                   switch, reader-claims (the emulator is never put in screen reader mode while the window says it is) and reader-stuck (it is put in it and never taken out of it), and
//                   flow-late     the create call answers after the shell's first output was delivered, so the page's first acknowledgement comes late (`flow.on`)
//                   ack-on-receipt the page's acknowledgements are replaced by one for each event, made when it is delivered and not when it is parsed, as a page that credits what it merely holds would (`flow.paced`)
//                   ack-lost      the credit that comes while the host is paused is lost, so a paused host never reads again (`flow.hidden`)
//                   drop-held     the emulator is never given two of the slices the page hands it, though they are acknowledged (`hidden.drain`)
//                   swap-held     the emulator is given the fifth slice after the sixth (`hidden.drain`)
//                   draw-hidden   every event delivered changes an attribute of the page, as a view that drew hidden output would (`hidden.draws`)
//                   ack-double    every parsed write is acknowledged twice (`flow.exact`)
//                   early-size    the emulator's renderer is said to be in place before it is, and something measures the host again once it is, as the first version of the product did (`resize.none`)
//                   size-off      the host opens the pty one column wider than it was asked to (`resize.cells`)
//                   arrival-order the host applies the input calls in the order they arrive and not in the order of their numbers (`order.echo`)
//                   resize-refused the host takes the number of a size call and refuses the call: it is not applied (`order.echo`)
//                   input-serial  what is typed waits for the answer of the call before it (`order.nowait`)
//                   seq-gap       the input calls are numbered with a number missing from the fourth on (`order.seq`)
//                   legacy-write  a write call is also made with the old call, `WriteSession` (`order.legacy`)
//                   no-shell-name the create call answers with no shell name (`title.shell`)
//                   exit-code-lost, signal-lost, closed-lost   the typed end of `exit`, `kill`, `quit` says no code, no signal, no one (`ended.code`, `ended.signal`, `ended.closed`)
//                   busy-always   `IsBusy` says a program named `sleep` runs, at the prompt too (`close.idle`)
//                   busy-nameless `IsBusy` says a program runs and does not name it (`close.busy`)
//                   unknown-idle  with `?busy=unknown`, `IsBusy` says `idle` (`close.unknown`)
//                   code-less     the host's refusal to find a shell has no `code`, only its words (`start.unavailable`)
//                   start-typed   the host's plain start failure carries the code of a missing shell (`start.failed`)
//
// `window.__pty` is what the probe reads and drives: `log` (what was created, refused, written, resized, closed, asked of `IsBusy`, what each input call was (`calls`: its kind, its number, its bytes, the instant the page made it, its place in the order
// of arrival, the instant the host applied it, its place in the order of application, and the instant it answered) and which old calls were made (`legacy`), what `size` printed, and the credit: `acks` (the count of every `AckTerminal` call, in order), `ackState` (what the page had done at each, and the
// sum acknowledged by then), `acked` (their sum), `delivered` (the bytes handed to the page), `maxUnacked` (the most bytes delivered and not credited at any instant), `paused()` (the host stopped reading) and `waiting()`
// (the bytes the shell wrote that the host has not delivered)), `out(id, text)` (the shell writes text now), `burst(id, events)` (the shell writes that many events of 1,000 bytes, each numbered, in one task), `net` (what
// the host does with the input calls: `latency`, the most a call takes to arrive in milliseconds, at random; `late`, the next calls of one kind that are slow to arrive, and how slow; `hold`, the next calls that the host is slow to apply),
// `end(id)` (the process exits), `ids()`. `window.__commits` lists every commit of the tree (React's profiler; the probe builds this entry with the profiling build of React DOM), `window.__engine` what the emulator was
// given and parsed (and, for a burst, whether the numbered events came in order).
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider } from '@omniviewdev/kit';
import { Profiler, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginHost } from '../../plugins/host/PluginHost';
import type { PluginEntry } from '../../plugins/host/pluginStore';
import type { PluginSource } from '../../plugins/host/contributions';
import { base64Size, decodeBase64, encodeInput } from '../panel/terminal/bytes';
import type { EngineLoader } from '../panel/terminal/engine';
import { signalEvent, streamEvent } from '../panel/terminal/execFeed';
import type { TerminalTarget } from '../panel/terminal/feed';
import { loadXtermEngine } from '../panel/terminal/loadEngine';
import { localShellTarget, restoreLocalTerminals, type EventsLike } from '../panel/terminal/localShell';
import { loadPageKey, terminalKeyStorage } from '../panel/terminal/pageKey';
import { loadSession, windowStorage, type WindowState } from '../session';

/** A program that holds the terminal's foreground besides the shell, until it ends (`sleep N`). */
type Job = { readonly name: string; readonly timer: ReturnType<typeof setTimeout> };

/** What the shell wrote, in the order it wrote it, until the host reads it: the bytes of one write (base64, as the event carries them), or the end of the session. */
type Item = { readonly kind: 'bytes'; readonly encoded: string; readonly size: number } | { readonly kind: 'close'; readonly payload: unknown };

type Pty = {
  rows: number;
  cols: number;
  /** The line the user is typing, as the pty's line discipline holds it. */
  line: string;
  job: Job | undefined;
  /** The shell is gone: it takes nothing. */
  gone: boolean;
  /** What the shell wrote that the host has not delivered, oldest first, from `head`; `waiting` is its bytes. */
  queue: Item[];
  head: number;
  waiting: number;
  /** The host's credit: bytes delivered and not credited, whether the page's own acknowledgements are the only credit now, and whether the host stopped reading the pty. */
  unacked: number;
  explicit: boolean;
  paused: boolean;
  pumping: boolean;
  /** What waits for the pty to have room for the shell's next write, and for everything written to be delivered. */
  roomWaiters: Array<() => void>;
  emptyWaiters: Array<() => void>;
  /** The host's order of the input: the number it expects next, the calls that came ahead of their turn, by number, each with what lets it go on, and whether a call that arrived is being applied now (the numbers after it wait for it). */
  next: number;
  early: Map<number, () => void>;
  applying: boolean;
  /** What lets go of the calls the host is slow with, when the pty closes. */
  holds: Set<() => void>;
  /** The page key the terminal was made with (T2-go 2.1): a terminal with one sends `output` events with offsets, and `offset` is the bytes it has written so far. */
  key: string | null;
  offset: number;
};

const params = new URLSearchParams(window.location.search);
const control = params.get('control');
const shellName = (params.get('shell') ?? 'zsh').replace(/[^A-Za-z0-9._-]/g, '') || 'zsh';
/** `?host=shared`: the far end is the probe's own host (terminal-host.mjs), which outlives this page and is shared by the others of the browser context. `?lines=1` keeps the numbered lines of a flood the emulator is given. */
const shared = params.get('host') === 'shared';
const trackLines = shared || params.get('lines') === '1';
/** `?key=off`: the page gives its terminals no key, as a page that could not make one would: a terminal with no key ends with its page and is never listed (T2-go 2.1). */
const keyed = params.get('key') !== 'off';
const failure = params.get('fail');
const busyMode = params.get('busy');
const ptys = new Map<string, Pty>();
const listeners = new Map<string, Set<(data: unknown) => void>>();

/** What the host says of its limits in the answer to the create call (`terminal.Session.limits`, T1-go.md 2.1). */
const LIMITS = {
  max_dimension: 1000,
  pending_ops: 256,
  pending_bytes: 1_048_576,
  seq_ahead: 64,
  gap_wait_ms: 2000,
  flow_high_bytes: 1_048_576,
  flow_low_bytes: 262_144,
  flow_stall_ms: 2000,
  flow_step_bytes: 262_144,
  flow_stall_ceiling_bytes: 8_388_608,
  hangup_grace_ms: 1500,
  drain_cap_ms: 3000,
  replay_bytes: 1_310_720,
  lease_default_ms: 300_000,
  lease_max_ms: 1_800_000,
} as const;

/** The most the host reads from the pty at once: an event of the host is the bytes of one read (T1-go.md 2.2). */
const READ_MAX = 20_480;
/** What the pty's own buffer holds before the shell's write blocks. Only a writer that waits for room (the flood) reads it. */
const PTY_ROOM = 65_536;
/** The most UTF-16 units one write of the shell has in one event: a unit is at most three bytes in UTF-8, so an event is never over one read. */
const PIECE_UNITS = Math.floor(READ_MAX / 3);
/** The bytes of one event of a burst, and how many digits of its number it starts with. */
const EVENT_BYTES = 1000;
const NUMBER_DIGITS = 7;

const SESSION_NOT_FOUND = 'omniview:session/not-found';

/** The shell the host could not find: its typed 422 and the words of its detail, which name every path it tried (T1-go.md 2.8.8). The probe knows the four paths. */
const UNAVAILABLE = {
  type: 'omniview:terminal/shell-unavailable',
  title: 'Shell not found',
  status: 422,
  detail: 'shell executable unavailable: tried the shell asked for "/bin/zsh": not found; $SHELL "/opt/none/zsh": not found; /bin/bash: not found; /bin/sh: not found',
  ...(control === 'code-less' ? {} : { code: 'SHELL_UNAVAILABLE' }),
};

/** A start the host could not make: the pty or the process (T1-go.md 2.5, `START_FAILED`, 500). */
const START_FAILED = {
  type: 'omniview:terminal/start-failed',
  title: 'Terminal failed to start',
  status: 500,
  detail: 'failed to start the terminal: the pty could not be opened',
  code: control === 'start-typed' ? 'SHELL_UNAVAILABLE' : 'START_FAILED',
};

/** What the host refuses an input call with when it cannot take its number (T1-go.md 2.4, 2.5): a number that was already applied or given up, and a number too far ahead. */
const stale = (seq: number, next: number): Record<string, unknown> => ({
  type: 'omniview:terminal/sequence-stale',
  title: 'Stale input sequence number',
  status: 409,
  detail: `Sequence number ${String(seq)} was already applied or given up; the next expected is ${String(next)}.`,
  code: 'SEQUENCE_STALE',
});
const ahead = (seq: number, next: number): Record<string, unknown> => ({
  type: 'omniview:terminal/sequence-ahead',
  title: 'Input sequence number too far ahead',
  status: 400,
  detail: `Sequence number ${String(seq)} is more than ${String(LIMITS.seq_ahead)} past the next expected, ${String(next)}.`,
  code: 'SEQUENCE_AHEAD',
});

/** What an error of the host is, as the page receives it: an error whose message is the JSON of the host's envelope. */
const refusal = (envelope: Record<string, unknown>): Error => new Error(JSON.stringify(envelope));
const notFound = (id: string): Error => refusal({ type: SESSION_NOT_FOUND, title: 'Session not found', status: 404, detail: `Session ${id} not found`, code: 'NOT_FOUND' });

/**
 * What the emulator was given and what it parsed, for the probe (`window.__engine`): the bytes accepted by `write` and the bytes whose callback has run, the instant of the last write, the instants of what the user typed, and
 * the renderers asked for in order. The GPU draws on a canvas: this is the only record of what reached it. `order` is what a burst checks: the numbered events (each starts with its number, 1,000 bytes after the one before)
 * are looked for where the emulator was given them, and `bad` counts the ones that were not where they belong. `measure` is the size the emulator would fit to the host now, which is the one a renderer in place gives.
 */
type Order = { readonly base: number; readonly events: number; checked: number; bad: number; first: { k: number; at: number; got: number } | null };
/** The numbered lines of a flood (`0000042 xxx`) as the emulator was given them: the last number, how many, and where one was skipped or repeated. */
type Lines = { last: number; count: number; carry: string; gaps: Array<{ after: number; got: number }>; dups: Array<{ after: number; got: number }>; resets: number };
const stats = {
  writes: 0,
  accepted: 0,
  parsed: 0,
  lastWriteAt: 0,
  typedAt: [] as number[],
  renderers: [] as string[],
  engines: 0,
  order: null as Order | null,
  lines: (trackLines ? { last: -1, count: 0, carry: '', gaps: [], dups: [], resets: 0 } : null) as Lines | null,
  grid: (): { cols: number; rows: number } => ({ cols: 0, rows: 0 }),
  measure: (): { cols: number; rows: number } | null => null,
};

/** One input call as the host saw it: the page made it at `at`, it arrived, the host applied it, and the host answered it. */
type Call = {
  kind: 'write' | 'resize';
  id: string;
  seq: number;
  size: number;
  at: number;
  arrivedAt: number | null;
  /** Its place in the order the calls arrived (1 is the first), and in the order the host applied them. */
  arrival: number | null;
  appliedAt: number | null;
  application: number | null;
  answeredAt: number | null;
  outcome: string;
};

const log = {
  created: [] as string[],
  /** The ids the host refused to start (`?fail=`). */
  refused: [] as string[],
  /** What every create call carried of its launch: the page key and the lease. */
  launches: [] as Array<{ id: string; pageKey: string | undefined; leaseMs: number | undefined }>,
  /** The terminals this page was asked to detach (`DetachTerminal`). */
  detached: [] as string[],
  writes: [] as string[],
  /** The size the pty was opened at by the create call and every size the host applied after it, in the order it applied them. */
  resizes: [] as Array<{ id: string; rows: number; cols: number; at: number }>,
  closed: [] as string[],
  floods: [] as Array<{ id: string; lines: number; bytes: number }>,
  /** The instant each flood began, where `floods` has one entry for each that ended: the probe asks for both, so that a flood that never started is not taken for one that is still running. A flood ends when everything it wrote was DELIVERED to the page. */
  floodStarts: [] as Array<{ id: string; at: number }>,
  /** The instant each write reached the shell (`performance.now()`): the end of an input's latency. */
  writeAt: [] as number[],
  /** Every `IsBusy` call: the question the close of a running terminal asks, once. */
  busy: [] as Array<{ id: string; at: number }>,
  /** Every input call, in the order the page made them. */
  calls: [] as Call[],
  /** The old calls the page made, if any: it numbers its calls now, and never makes them. */
  legacy: [] as string[],
  /** What `size` printed, in order: the pty's own idea of its size. */
  sizeReports: [] as Array<{ rows: number; cols: number }>,
  /** The count of every `AckTerminal` call, in order, what the page had done at the instant of each (the bytes the host had delivered, the emulator had been given and had parsed), the sum acknowledged by then, and their sum. */
  acks: [] as number[],
  ackState: [] as Array<{ id: string; count: number; at: number; exists: boolean; delivered: number; accepted: number; parsed: number; after: number }>,
  acked: 0,
  /** The bytes the host handed to the page, over every session, and the most it ever had delivered and not credited. */
  delivered: 0,
  maxUnacked: 0,
  /** Whether the host has stopped reading any session's pty. */
  paused: (): boolean => [...ptys.values()].some((pty) => pty.paused),
  /** The bytes the shell wrote that the host has not delivered, over every session. */
  waiting: (): number => [...ptys.values()].reduce((sum, pty) => sum + pty.waiting, 0),
};

/** What the probe changes about the host's handling of input: the most an input call takes to arrive (a random time up to it), the next calls of one kind that are slow to arrive, and the next calls the host is slow to apply (`Infinity` is never). */
const net = { latency: 0, late: null as { kind: 'write' | 'resize'; calls: number; ms: number } | null, hold: null as { calls: number; ms: number } | null };
let arrivals = 0;
let applications = 0;

const emit = (name: string, data: unknown): void => {
  for (const listener of [...(listeners.get(name) ?? [])]) {
    listener(data);
  }
};

/** What `?control=leaky-heap` keeps: every event the shell wrote, as a page that held on to its output would (the negative control of the probe's heap assertion). */
const leak: string[] = [];

// ---- the host's credit flow control ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Tells whoever waits for the pty that it has room, or is empty. */
function settle(pty: Pty): void {
  if (pty.waiting < PTY_ROOM) {
    for (const wake of pty.roomWaiters.splice(0)) {
      wake();
    }
  }

  if (pty.head >= pty.queue.length) {
    for (const wake of pty.emptyWaiters.splice(0)) {
      wake();
    }
  }
}

/**
 * The host reads the pty: what the shell wrote is delivered, in reads of at most 20,480 bytes, while the bytes delivered and not credited are under the high mark; at the mark it stops reading, so the shell waits,
 * and it reads again when the count is down to the low mark (`ack`). Until the page's first acknowledgement the transport credits what it delivered, the page having taken the event. `?control=ack-on-receipt` has the
 * page acknowledge each event as it is delivered, and not when it is parsed: what the page's own acknowledgements say is then ignored.
 */
function pump(id: string): void {
  const pty = ptys.get(id);
  if (pty === undefined || pty.pumping) {
    return;
  }

  // An acknowledgement that comes while the host is delivering is credited by the loop that is running.
  pty.pumping = true;
  try {
    while (!pty.paused && pty.head < pty.queue.length) {
      const item = pty.queue[pty.head];
      pty.head += 1;
      if (item === undefined) {
        break;
      }

      if (item.kind === 'close') {
        emit(signalEvent(id, 'CLOSE'), { ...(item.payload as Record<string, unknown>), last_offset: pty.offset });
        continue;
      }

      pty.waiting -= item.size;
      pty.unacked += item.size;
      log.maxUnacked = Math.max(log.maxUnacked, pty.unacked);
      log.delivered += item.size;
      if (pty.key === null) {
        emit(streamEvent(id, 'stdout'), item.encoded);
      } else {
        emit(`core/exec/stream/output/${id}`, { offset: pty.offset, data: item.encoded });
      }

      pty.offset += item.size;
      if (control === 'draw-hidden') {
        document.body.dataset.delivered = String(log.delivered);
      }

      if (!pty.explicit) {
        pty.unacked = Math.max(0, pty.unacked - item.size);
      } else if (control === 'ack-on-receipt') {
        void ack(id, item.size, false);
      }

      if (pty.unacked >= LIMITS.flow_high_bytes) {
        pty.paused = true;
      }
    }
  } finally {
    pty.pumping = false;
  }

  if (pty.head >= pty.queue.length) {
    pty.queue.length = 0;
    pty.head = 0;
  } else if (pty.head > 4096) {
    pty.queue.splice(0, pty.head);
    pty.head = 0;
  }

  settle(pty);
}

/** The shell writes `text`: it waits in the pty until the host reads it. */
const out = (id: string, text: string): void => {
  const pty = ptys.get(id);
  // A shell that is gone writes nothing: what it wrote before it ended is in the queue, and the end follows it.
  if (pty === undefined || pty.gone) {
    return;
  }

  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + PIECE_UNITS);
    // A pair of UTF-16 units is one character: a write is cut between characters.
    if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) {
      end -= 1;
    }

    const encoded = encodeInput(text.slice(at, end));
    if (control === 'leaky-heap') {
      leak.push(encoded);
    }

    const size = base64Size(encoded);
    pty.queue.push({ kind: 'bytes', encoded, size });
    pty.waiting += size;
    at = end;
  }

  pump(id);
};

/** The event a burst writes at index `k`: 1,000 bytes of twelve lines of 80 columns and one of 40, the first line starting with the number of the event, so that the page's copy of the stream can be checked for order. */
const burstEvent = (k: number): string => `${String(k).padStart(NUMBER_DIGITS, '0')} ${'x'.repeat(70)}\r\n${`${'x'.repeat(78)}\r\n`.repeat(11)}${'y'.repeat(38)}\r\n`;

/**
 * The shell writes `events` numbered events in one task, as a build that prints a great deal while the panel is not shown does: the host delivers what is under its mark in the same task, and the rest waits in the pty. The
 * emulator's wrapper then looks, for each event, at the number where the event ought to be in what it is given (`checkOrder`).
 */
function burst(id: string, events: number): { ms: number; delivered: number; paused: boolean; waiting: number } {
  const pty = ptys.get(id);
  if (pty === undefined) {
    return { ms: 0, delivered: 0, paused: false, waiting: 0 };
  }

  stats.order = { base: stats.accepted, events, checked: 0, bad: 0, first: null };
  const before = log.delivered;
  const started = performance.now();
  for (let k = 0; k < events; k += 1) {
    out(id, burstEvent(k));
  }

  return { ms: performance.now() - started, delivered: log.delivered - before, paused: pty.paused, waiting: pty.waiting };
}

/** Looks, in what the emulator is given, at where each event of the burst begins: its number must be there. A slice that cuts the number is not looked at (the next one begins in the middle of an event). */
function checkOrder(data: Uint8Array): void {
  const { order } = stats;
  if (order === null) {
    return;
  }

  const first = stats.accepted;
  for (let k = Math.max(0, Math.ceil((first - order.base) / EVENT_BYTES)); k < order.events; k += 1) {
    const at = order.base + k * EVENT_BYTES - first;
    if (at + NUMBER_DIGITS > data.length) {
      break;
    }

    order.checked += 1;
    let number = 0;
    let digits = true;
    for (let index = 0; index < NUMBER_DIGITS; index += 1) {
      const digit = (data[at + index] ?? 0) - 48;
      if (digit < 0 || digit > 9) {
        digits = false;
        break;
      }

      number = number * 10 + digit;
    }

    if (!digits || number !== k) {
      order.bad += 1;
      order.first ??= { k, at: first + at, got: digits ? number : -1 };
    }
  }
}

/** One acknowledgement of the log, and what the page had done at the instant of it. */
function record(id: string, bytes: number, exists: boolean): void {
  log.acks.push(bytes);
  log.acked += bytes;
  log.ackState.push({ id, count: bytes, at: performance.now(), exists, delivered: log.delivered, accepted: stats.accepted, parsed: stats.parsed, after: log.acked });
}

/** The host credits what the page acknowledged: `AckTerminal(id, bytes)`. The first call turns the page's credit on; a session that is gone is a 404. `fromPage` is false for what `?control=ack-on-receipt` does in its place. */
async function ack(id: string, bytes: number, fromPage = true): Promise<void> {
  const pty = ptys.get(id);
  if (fromPage && control === 'ack-on-receipt' && bytes > 0) {
    return Promise.resolve();
  }

  record(id, bytes, pty !== undefined);
  if (pty === undefined) {
    throw notFound(id);
  }

  pty.explicit = true;
  if (control === 'ack-lost' && pty.paused) {
    return Promise.resolve();
  }

  pty.unacked = Math.max(0, pty.unacked - bytes);
  if (pty.paused && pty.unacked <= LIMITS.flow_low_bytes) {
    pty.paused = false;
  }

  pump(id);
  return Promise.resolve();
}

// ---- the shell --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const PROMPT = '\u001b[32muser@synthetic\u001b[0m:\u001b[34m~\u001b[0m$ ';
const BANNER = `\u001b[90mSynthetic shell: hello, size, colors, flood N [W], sleep N, exit [code], kill, quit, fail\u001b[0m\r\n${PROMPT}`;

function colors(id: string): void {
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  for (const base of [30, 90]) {
    out(id, `${names.map((name, index) => `\u001b[${String(base + index)}m${name.padEnd(8)}\u001b[0m`).join(' ')}\r\n`);
  }

  out(id, '\u001b[1mbold\u001b[0m \u001b[2mdim\u001b[0m \u001b[3mitalic\u001b[0m \u001b[4munderline\u001b[0m \u001b[7minverse\u001b[0m\r\n');
}

/**
 * N lines of W columns, in events of about 1,000 bytes, a batch of events a task so the page is never held for the whole flood. The shell writes while its pty has room and waits when it does not (the host stopped
 * reading it: the page has not acknowledged enough), so a flood moves at the page's own pace. It ends when everything it wrote was DELIVERED: that is what `floods` records.
 */
function flood(id: string, lines: number, width: number): void {
  const pty = ptys.get(id);
  if (pty === undefined) {
    return;
  }

  const perEvent = Math.max(1, Math.floor(1000 / (width + 2)));
  log.floodStarts.push({ id, at: performance.now() });
  let next = 0;
  let bytes = 0;
  const step = (): void => {
    // The shell that ended writes no more, even while its pty is still there.
    if (!ptys.has(id) || pty.gone) {
      return;
    }

    for (let batch = 0; batch < 40 && next < lines && pty.waiting < PTY_ROOM; batch += 1) {
      const count = Math.min(perEvent, lines - next);
      let text = '';
      for (let at = 0; at < count; at += 1) {
        text += `${String(next + at).padStart(7, '0')} ${'x'.repeat(Math.max(0, width - 8))}\r\n`;
      }

      bytes += text.length;
      next += count;
      out(id, text);
    }

    if (next < lines) {
      if (pty.waiting >= PTY_ROOM) {
        pty.roomWaiters.push(() => {
          setTimeout(step, 0);
        });
      } else {
        setTimeout(step, 0);
      }

      return;
    }

    out(id, PROMPT);
    const ended = (): void => {
      log.floods.push({ id, lines, bytes });
    };

    if (pty.head >= pty.queue.length) {
      ended();
    } else {
      pty.emptyWaiters.push(ended);
    }
  };

  step();
}

function stopJob(pty: Pty): void {
  if (pty.job !== undefined) {
    clearTimeout(pty.job.timer);
    pty.job = undefined;
  }
}

/** The shell is gone, and the host says how as the last event of the session, after everything the shell wrote (T1-go.md 2.2). */
function finish(id: string, end: unknown): void {
  const pty = ptys.get(id);
  if (pty === undefined || pty.gone) {
    return;
  }

  pty.gone = true;
  stopJob(pty);
  letGo(pty);
  setTimeout(() => {
    if (ptys.get(id) === pty) {
      pty.queue.push({ kind: 'close', payload: end });
      pump(id);
    }
  }, 5);
}

/**
 * The pty closed, because the shell ended or the session was closed: what waits on it, for its turn or for a host that is slow with it, is let go, and each call that wakes finds the session gone and is refused. Nothing is applied
 * to a pty that is closed, and the numbers behind a call that was let go do not wait for it.
 */
function letGo(pty: Pty): void {
  for (const go of [...pty.early.values()]) {
    go();
  }

  for (const done of [...pty.holds]) {
    done();
  }
}

/** How the typed end of each command says it, and what each negative control takes out of it. */
const exited = (code: number): Record<string, unknown> => (control === 'exit-code-lost' ? { reason: 'exited' } : { reason: 'exited', exit_code: code });
const signaled = (signal: string, number: number, dumped: boolean): Record<string, unknown> =>
  control === 'signal-lost' ? { reason: 'signaled' } : { reason: 'signaled', signal, signal_number: number, ...(dumped ? { core_dumped: true } : {}) };
const closedBy = (who: 'request' | 'window' | 'shutdown'): Record<string, unknown> => (control === 'closed-lost' ? { reason: 'closed' } : { reason: 'closed', closed_by: who });

function run(id: string, pty: Pty, command: string): void {
  const [word = '', ...args] = command.trim().split(/\s+/);
  switch (word) {
    case '':
      break;
    case 'hello':
      out(id, 'hello from the synthetic shell\r\n');
      break;
    case 'size':
      log.sizeReports.push({ rows: pty.rows, cols: pty.cols });
      out(id, `${String(pty.rows)} ${String(pty.cols)}\r\n`);
      break;
    case 'colors':
      colors(id);
      break;
    case 'flood':
      flood(id, Number(args[0] ?? 1000), Number(args[1] ?? 80));
      return;
    case 'sleep': {
      const seconds = Number(args[0]);
      if (!(seconds >= 0)) {
        out(id, 'sleep: invalid time interval\r\n');
        break;
      }

      // The program holds the foreground; the shell gives its prompt back when it ends.
      pty.job = {
        name: 'sleep',
        timer: setTimeout(() => {
          pty.job = undefined;
          out(id, PROMPT);
        }, seconds * 1000),
      };
      return;
    }

    case 'exit':
      out(id, 'logout\r\n');
      finish(id, exited(Number(args[0] ?? 0)));
      return;
    case 'kill':
      finish(id, signaled('SIGKILL', 9, false));
      return;
    case 'segv':
      finish(id, signaled('SIGSEGV', 11, true));
      return;
    case 'quit':
      finish(id, closedBy('shutdown'));
      return;
    case 'orphan':
      out(id, 'logout\r\n');
      finish(id, { ...exited(0), drain_capped: true, dropped_bytes: 4096 });
      return;
    case 'fail':
      // A terminal with a key ends with a typed failure, as the host says it (T1-go.md 2.2: the end is the CLOSE event); the `ERROR` signal is the old way and is only heard for a terminal with no key.
      if (pty.key === null) {
        emit(signalEvent(id, 'ERROR'), { title: 'Connection lost', message: 'The shell stopped answering' });
      } else {
        finish(id, { reason: 'failed', failure: { stage: 'read', message: 'The shell stopped answering' } });
      }

      return;
    default:
      out(id, `synthetic: command not found: ${word}\r\n`);
  }

  out(id, PROMPT);
}

/** What the user typed, as the pty's line discipline would take it: echo, backspace, interrupt, a line at Enter. Escape sequences (arrows) are dropped. While a program holds the foreground only the interrupt reaches anything. */
function typed(id: string, pty: Pty, data: string): void {
  for (const ch of data.replace(/\u001b\[[0-9;?]*[A-Za-z~]/g, '').replace(/\u001b/g, '')) {
    if (pty.gone) {
      return;
    }

    if (ch === '\u0003') {
      pty.line = '';
      stopJob(pty);
      out(id, `^C\r\n${PROMPT}`);
    } else if (pty.job !== undefined) {
      continue;
    } else if (ch === '\r') {
      out(id, '\r\n');
      const line = pty.line;
      pty.line = '';
      run(id, pty, line);
    } else if (ch === '\u007f') {
      if (pty.line !== '') {
        pty.line = pty.line.slice(0, -1);
        out(id, '\b \b');
      }
    } else if (ch >= ' ') {
      pty.line += ch;
      out(id, ch);
    }
  }
}

// ---- the host's exec bindings ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** A wait of `ms` milliseconds. */
const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The call `seq` waits for its turn: the host puts the calls in the order of their numbers. A call that has arrived and is being applied (the host is slow with it) is waited for, however long it takes. Only a number that never
 * arrived is given up: when the host has waited `gap_wait_ms` for it with nothing being applied, it goes on with the lowest call it holds, and `next` never goes back (T1-go.md 2.4).
 */
async function turn(pty: Pty, seq: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = (): void => {
      clearTimeout(timer);
      pty.early.delete(seq);
      resolve();
    };

    const wake = (): void => {
      if (pty.early.get(seq) !== go) {
        return;
      }

      if (pty.applying) {
        // The number it waits for arrived and is being applied: the host waits for it, and looks again later.
        timer = setTimeout(wake, LIMITS.gap_wait_ms);
        return;
      }

      const lowest = Math.min(...pty.early.keys());
      pty.next = Math.max(pty.next, lowest);
      pty.early.get(lowest)?.();
    };

    timer = setTimeout(wake, LIMITS.gap_wait_ms);
    pty.early.set(seq, go);
  });
}

/** The host is slow with a call, for `ms` milliseconds (for good, for `Infinity`): the wait ends early when the pty closes. */
async function slowly(pty: Pty, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (): void => {
      clearTimeout(timer);
      pty.holds.delete(done);
      resolve();
    };

    if (ms !== Number.POSITIVE_INFINITY) {
      timer = setTimeout(done, ms);
    }

    pty.holds.add(done);
  });
}

/**
 * An input call as the host takes it (T1-go.md 2.4): it arrives after a random time up to `net.latency`, or after `net.late` for the calls set to be slow (the transport runs unawaited calls at the same time, and they do not
 * arrive in the order they were made), and the host applies it in the order of the numbers and answers when it has applied it. `net.hold` makes the host slow to apply a call, and so to answer it, and the calls behind it wait.
 * A number that is used, or that already waits for its turn, is refused (`SEQUENCE_STALE`) and the call that waits keeps its place. A call is applied only to the pty it was admitted to, and only while it is open: when the shell ends or
 * the session is closed the calls that wait are let go and refused (`letGo`). `?control=arrival-order` has the host apply in the order of arrival whatever the numbers say.
 */
async function input(kind: 'write' | 'resize', id: string, seq: number, size: number, apply: (pty: Pty) => void): Promise<void> {
  const call: Call = { kind, id, seq, size, at: performance.now(), arrivedAt: null, arrival: null, appliedAt: null, application: null, answeredAt: null, outcome: 'sent' };
  log.calls.push(call);
  let delay = net.latency > 0 ? Math.random() * net.latency : 0;
  const late = net.late;
  if (late !== null && late.kind === kind && late.calls > 0) {
    late.calls -= 1;
    delay = late.ms;
  }

  if (delay > 0) {
    await wait(delay);
  }

  arrivals += 1;
  call.arrivedAt = performance.now();
  call.arrival = arrivals;
  const pty = ptys.get(id);
  if (pty === undefined || pty.gone) {
    call.outcome = 'not-found';
    throw notFound(id);
  }

  // The call is admitted to this pty: when it closes while the call waits, for its turn or for a host that is slow with it, the call is not applied.
  const closed = (): boolean => ptys.get(id) !== pty || pty.gone;
  const ordered = seq >= 1 && control !== 'arrival-order';
  if (ordered) {
    // A number below the one the host expects, the one it is applying now, or one that already waits for its turn has been used.
    if (seq < pty.next || (pty.applying && seq === pty.next) || pty.early.has(seq)) {
      call.outcome = 'stale';
      throw refusal(stale(seq, pty.next));
    }

    if (seq > pty.next + LIMITS.seq_ahead) {
      call.outcome = 'ahead';
      throw refusal(ahead(seq, pty.next));
    }

    if (seq !== pty.next) {
      await turn(pty, seq);
      if (closed()) {
        call.outcome = 'not-found';
        throw notFound(id);
      }
    }

    pty.applying = true;
  }

  // `?control=resize-refused`: the host takes the number of a size call and refuses the call, which is not applied.
  if (control === 'resize-refused' && kind === 'resize') {
    call.outcome = 'refused';
    if (ordered) {
      pty.applying = false;
      pty.next = Math.max(pty.next, seq + 1);
      pty.early.get(pty.next)?.();
    }

    throw refusal(stale(seq, pty.next));
  }

  const slow = net.hold;
  if (slow !== null && slow.calls > 0) {
    slow.calls -= 1;
    await slowly(pty, slow.ms);
  }

  if (closed()) {
    pty.applying = false;
    call.outcome = 'not-found';
    throw notFound(id);
  }

  apply(pty);
  applications += 1;
  call.appliedAt = performance.now();
  call.application = applications;
  call.outcome = 'applied';
  if (ordered) {
    pty.applying = false;
    pty.next = Math.max(pty.next, seq + 1);
    pty.early.get(pty.next)?.();
  }

  call.answeredAt = performance.now();
}

/** `CreateTerminal`: the pty opens at the size the view measured, and the answer is the session (`terminal.Session`). A host that cannot start one says why, typed (`?fail=`). */
async function create(id: string, size: { readonly cols: number; readonly rows: number; readonly page_key?: string | undefined; readonly lease_ms?: number | undefined }): Promise<unknown> {
  if (failure === 'shell-unavailable') {
    log.refused.push(id);
    throw refusal(UNAVAILABLE);
  }

  if (failure === 'start') {
    log.refused.push(id);
    throw refusal(START_FAILED);
  }

  // A page key is 16 to 128 visible ASCII characters (T2-go 2.1): any other is refused, naming it, and nothing starts.
  log.launches.push({ id, pageKey: size.page_key, leaseMs: size.lease_ms });
  if (size.page_key !== undefined && !/^[\x21-\x7e]{16,128}$/.test(size.page_key)) {
    throw refusal({ type: 'omniview:resource/invalid-request', title: 'Invalid request', status: 400, detail: 'page_key: a page key is 16 to 128 visible ASCII characters, no space', code: 'INVALID_REQUEST' });
  }

  // `?control=size-off`: the host opens the pty one column wider than it was asked to.
  const cols = control === 'size-off' ? size.cols + 1 : size.cols;
  ptys.set(id, { rows: size.rows, cols, line: '', job: undefined, gone: false, queue: [], head: 0, waiting: 0, unacked: 0, explicit: false, paused: false, pumping: false, roomWaiters: [], emptyWaiters: [], next: 1, early: new Map(), applying: false, holds: new Set(), key: size.page_key ?? null, offset: 0 });
  log.resizes.push({ id, rows: size.rows, cols: size.cols, at: performance.now() });
  log.created.push(id);
  const first = new Promise<void>((resolve) => {
    setTimeout(() => {
      out(id, BANNER);
      resolve();
    }, 20);
  });
  if (control === 'flow-late') {
    await first;
  }

  return {
    id,
    created_at: new Date().toISOString(),
    pid: 4242,
    shell: { path: `/bin/${shellName}`, name: control === 'no-shell-name' ? '' : shellName },
    cwd: '/home/user',
    cols,
    rows: size.rows,
    environment: { source: 'launch', probe: { state: 'ok' } },
    limits: LIMITS,
    lease_ms: size.page_key === undefined ? 0 : LIMITS.lease_default_ms,
  };
}

/** `IsBusy`: what holds the terminal's foreground, asked when the person closes (T1-go.md 2.3). */
async function busy(id: string): Promise<unknown> {
  log.busy.push({ id, at: performance.now() });
  if (busyMode === 'hang') {
    return new Promise<never>(() => undefined);
  }

  const pty = ptys.get(id);
  if (pty === undefined || pty.gone) {
    throw notFound(id);
  }

  if (busyMode === 'unknown') {
    return control === 'unknown-idle' ? { state: 'idle' } : { state: 'unknown', reason: 'query-failed' };
  }

  if (control === 'busy-always') {
    return { state: 'busy', pgid: 4242, name: 'sleep' };
  }

  if (pty.job === undefined) {
    return { state: 'idle' };
  }

  return control === 'busy-nameless' ? { state: 'busy', pgid: 4242 } : { state: 'busy', pgid: 4242, name: pty.job.name };
}

/** What a write call does at the shell: the bytes it carries are typed. */
function writing(id: string, data: string): (pty: Pty) => void {
  return (pty) => {
    const text = new TextDecoder().decode(decodeBase64(data));
    log.writes.push(text);
    log.writeAt.push(performance.now());
    typed(id, pty, text);
  };
}

/** What a resize call does at the shell: the pty has the size. */
function resizing(id: string, rows: number, cols: number): (pty: Pty) => void {
  return (pty) => {
    log.resizes.push({ id, rows, cols, at: performance.now() });
    pty.rows = rows;
    pty.cols = cols;
  };
}

/**
 * The host's exec bindings, as the transport of the host's own shell calls them. The page numbers its input calls and sends them with `WriteTerminal` and `ResizeTerminal`, each at once, and the host puts them in the order of their
 * numbers. `WriteSession` and `ResizeSession` are the old calls: nothing makes them any more, and a page that does gets an error from them and leaves its call in `log.legacy`, which the probe asserts is empty.
 */
const localClient = {
  CreateTerminal: async (options: { readonly id: string }, launch: { readonly cols: number; readonly rows: number; readonly page_key?: string | undefined; readonly lease_ms?: number | undefined }) => create(options.id, launch),
  WriteTerminal: async (id: string, seq: number, data: string) => {
    // `?control=seq-gap`: a number is missing from the fourth call on. `?control=legacy-write`: the old call is made as well.
    if (control === 'legacy-write') {
      log.legacy.push(`WriteSession ${id}`);
    }

    await input('write', id, control === 'seq-gap' && seq > 3 ? seq + 1 : seq, base64Size(data), writing(id, data));
  },
  ResizeTerminal: async (id: string, seq: number, rows: number, cols: number) => {
    await input('resize', id, control === 'seq-gap' && seq > 3 ? seq + 1 : seq, 0, resizing(id, rows, cols));
  },
  WriteSession: async (id: string) => {
    log.legacy.push(`WriteSession ${id}`);
    throw new Error('WriteSession is the old call: input is sent with WriteTerminal, numbered');
  },
  ResizeSession: async (id: string) => {
    log.legacy.push(`ResizeSession ${id}`);
    throw new Error('ResizeSession is the old call: sizes are sent with ResizeTerminal, numbered');
  },
  // A close the page asked for: the host ends the session, and its CLOSE is delivered before the call returns, to whoever still listens (T1-go.md 2.2).
  CloseSession: async (id: string) => {
    log.closed.push(id);
    const pty = ptys.get(id);
    if (pty === undefined) {
      throw notFound(id);
    }

    stopJob(pty);
    ptys.delete(id);
    letGo(pty);
    emit(signalEvent(id, 'CLOSE'), closedBy('request'));
  },
  AckTerminal: ack,
  IsBusy: busy,
  // The terminals of this page live in it and end with it, so a reloaded page finds none: the T2-go host, with its ring, its leases and its tombstones, is `?host=shared`.
  ListTerminals: async (): Promise<unknown[]> => Promise.resolve([]),
  AttachTerminal: async (id: string): Promise<never> => Promise.reject(notFound(id)),
  DetachTerminal: async (id: string) => {
    log.detached.push(id);
    return Promise.resolve({ lease_ms: LIMITS.lease_default_ms, lease_expires_unix_ms: Date.now() + LIMITS.lease_default_ms });
  },
};

/**
 * `?host=shared`: the host's calls go to the probe's host (terminal-host.mjs) through the binding `window.__host`, and what the host emits comes back through `window.__hostEmit`. A page load is a window of its own (`windowId`), as
 * a page of server mode is: the host retires it when the page goes away. The host keeps the terminals, the window's state (the page key and the saved session) and the rest of the far end; the page keeps none of it.
 * The page-side negative controls of the reattach assertions are in the calls below: `key-in-url` (the page puts its key in the address), `ack-replay` (it credits the replay), `seq-restart` (the answer of the attach hands the
 * page 1 for the number the input queue takes next), `leave-lost` (the page never says it is leaving), and in the window's state `no-session` and `key-regen` (the session and the key are never kept).
 */
type HostBinding = (windowId: string, method: string, args: readonly unknown[]) => Promise<unknown>;

/** The probe's host (`?host=shared`): Playwright gives its binding to every page of the browser context. */
const injected: unknown = Reflect.get(window, '__host');
const hostBinding = typeof injected === 'function' ? (injected as HostBinding) : undefined;
const windowId = globalThis.crypto.randomUUID();
const hostCall = async (method: string, ...args: unknown[]): Promise<unknown> => {
  if (hostBinding === undefined) {
    throw new Error('the probe did not give this page its host (window.__host)');
  }

  return hostBinding(windowId, method, args);
};

type Launch = { readonly cols: number; readonly rows: number; readonly page_key?: string | undefined; readonly lease_ms?: number | undefined };
type Attach = { readonly page_key?: string | undefined; readonly from_offset?: number | undefined };
const remoteClient = {
  CreateTerminal: async (options: { readonly id: string }, launch: Launch) => {
    if (control === 'key-in-url' && launch.page_key !== undefined) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search === '' ? '?' : `${window.location.search}&`}k=${launch.page_key}`);
    }

    return hostCall('CreateTerminal', options, launch);
  },
  ListTerminals: async (pageKey: string) => hostCall('ListTerminals', pageKey),
  AttachTerminal: async (id: string, request: Attach) => {
    const answer = (await hostCall('AttachTerminal', id, request)) as { readonly replay: { readonly data: string } };
    if (control === 'ack-replay') {
      void hostCall('AckTerminal', id, base64Size(answer.replay.data));
    }

    return control === 'seq-restart' ? { ...answer, next_input_seq: 1 } : answer;
  },
  // A page that is going away says so with a request that outlives it (`keepalive`): a call made through the binding is dropped with the page in Chromium. The host's own does the same (T2b explore, 2.4).
  DetachTerminal: async (id: string, request: { readonly page_key?: string | undefined; readonly lease_ms?: number | undefined }) => {
    // `?control=leave-lost` is the negative control of the page that never says it is going; `?detach=off` is the scenario of a page that dies without saying it (a tab that was killed): the host notices later.
    if (control === 'leave-lost' || params.get('detach') === 'off') {
      return Promise.resolve({ lease_ms: 0, lease_expires_unix_ms: 0 });
    }

    const beacon: unknown = Reflect.get(window, '__hostBeacon');
    if (typeof beacon !== 'string') {
      return hostCall('DetachTerminal', id, request);
    }

    const response = await fetch(beacon, { method: 'POST', keepalive: true, body: JSON.stringify({ windowId, method: 'DetachTerminal', args: [id, request] }) });
    // The probe's own server answers `{ answer }` or `{ message }` (the error as the host's envelope text).
    const body = (await response.json()) as { readonly answer?: unknown; readonly message?: string };
    if (!response.ok) {
      throw new Error(body.message ?? 'DetachTerminal was refused');
    }

    return body.answer;
  },
  WriteTerminal: async (id: string, seq: number, data: string) => hostCall('WriteTerminal', id, seq, data),
  ResizeTerminal: async (id: string, seq: number, rows: number, cols: number) => hostCall('ResizeTerminal', id, seq, rows, cols),
  CloseSession: async (id: string) => hostCall('CloseSession', id),
  AckTerminal: async (id: string, bytes: number) => hostCall('AckTerminal', id, bytes),
  IsBusy: async (id: string) => hostCall('IsBusy', id),
};

const client = shared ? remoteClient : localClient;

/** The host's window service as the generated binding has it (`GetState`, `SaveState`): the slots of each window. `?host=shared` keeps them in the probe's host, which outlives the page, as the host's own state root does. */
const slots = new Map<string, Record<string, string | undefined>>();
const sharedState: WindowState = {
  GetState: async (name) => (await hostCall('GetState', name)) as Record<string, string | undefined>,
  SaveState: async (name, slot, json) => {
    if ((control === 'no-session' && slot === 'session') || (control === 'key-regen' && slot === 'terminal-page-key')) {
      return;
    }

    await hostCall('SaveState', name, slot, json);
  },
};
const localState: WindowState = {
  GetState: async (name) => Promise.resolve({ ...slots.get(name) }),
  SaveState: async (name, slot, json) => {
    slots.set(name, { ...slots.get(name), [slot]: json });
    return Promise.resolve();
  },
};
const windowState = shared ? sharedState : localState;
if (shared) {
  Object.assign(window, { __hostEmit: emit, __windowId: windowId });
}

const events: EventsLike = {
  On: (name, listener) => {
    const set = listeners.get(name) ?? new Set();
    const heard = (data: unknown): void => {
      listener({ data });
    };

    set.add(heard);
    listeners.set(name, set);
    return () => {
      set.delete(heard);
    };
  },
};

/** The page key the Terminal tool starts its terminals under: read from the window's state when the page mounts (`loadPageKey`, as the host's own screen reads it), and none for `?key=off`. */
let pageKey: string | undefined;

/** The product's own target for the host's shell (its tab is `Terminal` until the answer names the shell), over the invented far end, under the page's key. */
const target = (): TerminalTarget => localShellTarget({ client, events }, pageKey);

/** Burns the main thread for `ms` milliseconds: what a janky renderer or a slow handler does, for the probe's negative controls. */
const burn = (ms: number): void => {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // spin
  }
};

/**
 * The emulator is the product's own, wrapped to keep `stats`. `?renderer=dom` keeps its DOM renderer for the whole life of the terminal (the GPU's is never asked for): its rows are text a probe can read, where the
 * GPU's canvas is not; the default is the product's own, the GPU while the terminal is on screen. `?control=echo-slow` is the negative control of the probe's idle latency assertion: a handler that takes 80 ms for each
 * key typed until a flood starts (a flood's own latency, which a paced host makes larger on a busy machine, is not added to it, so that the control trips the idle assertion and never the flood's).
 * `?control=reader-claims` and `?control=reader-stuck` are the negative controls of the screen reader assertions: an emulator that ignores the window's choice (it is never in screen reader mode, so the printed
 * lines are not in the accessibility tree while the store and the description say they are) and one that ignores only the choice to turn it off (the lines stay in the tree). `?control=ack-double` is the one of the
 * probe's exact credit: a write whose callback runs twice, as a page that acknowledged everything twice, `?control=drop-held` the one of its drain: two slices the emulator is never given, though the page acknowledges
 * them, and `?control=swap-held` the one of its order: the fifth slice is given after the sixth. `?control=early-size` is the one of the first size: the renderer is said to be in place before it is, and the page's
 * own look at the host (a change of the root's attributes, which the screen answers by measuring) is made once the real one is, as the first version of the product measured again after the GPU came.
 */
let dropped = 0;
let slices = 0;
let swapped: (() => void) | undefined;
/** What `?control=input-serial` holds: the keys typed while a call was waiting for its answer, in the order they were typed, and whether they are being let go. */
const typedWaiting: Array<() => void> = [];
let letting = false;
const latin1 = new TextDecoder('latin1');

/** The numbered lines of a flood as the emulator is given them: each is the one after the last (a number skipped is a gap, one repeated a duplicate), and a full reset, which a replay begins with, starts the count again. */
function trackLine(lines: Lines, data: Uint8Array | string): void {
  if (typeof data === 'string') {
    if (data.includes('\u001bc')) {
      Object.assign(lines, { last: -1, carry: '' });
      lines.resets += 1;
    }

    return;
  }

  const parts = (lines.carry + latin1.decode(data)).split('\r\n');
  lines.carry = parts.pop() ?? '';
  for (const part of parts) {
    const found = /^(\d{7}) x/.exec(part);
    if (found === null) {
      continue;
    }

    const number = Number(found[1]);
    if (lines.last >= 0 && number <= lines.last) {
      lines.dups.push({ after: lines.last, got: number });
      continue;
    }

    if (lines.last >= 0 && number !== lines.last + 1) {
      lines.gaps.push({ after: lines.last, got: number });
    }

    lines.count += 1;
    lines.last = number;
  }
}

const load: EngineLoader = async () => {
  const create = await loadXtermEngine();
  return (options) => {
    // `?control=big-scrollback` is the negative control of the probe's scrollback cap: an emulator that keeps four times the lines. `?control=reader-claims` makes it in the mode the person did not choose (off) whatever the window says.
    const engine = create(control === 'big-scrollback' ? { ...options, scrollback: 20_000 } : control === 'reader-claims' ? { ...options, screenReaderMode: false } : options);
    stats.engines += 1;
    stats.grid = () => engine.size();
    stats.measure = () => engine.measure() ?? null;
    return {
      ...engine,
      write: (data, done) => {
        const size = typeof data === 'string' ? data.length : data.byteLength;
        const forward = (): void => {
          stats.writes += 1;
          stats.lastWriteAt = performance.now();
          if (typeof data !== 'string') {
            checkOrder(data);
          }

          if (stats.lines !== null) {
            trackLine(stats.lines, data);
          }

          stats.accepted += size;
          engine.write(data, () => {
            stats.parsed += size;
            done?.();
            if (control === 'ack-double') {
              done?.();
            }
          });
        };

        if (control === 'drop-held' && typeof data !== 'string' && size >= 65_536 && dropped < 2) {
          // The slice is taken for parsed and acknowledged and never reaches the emulator.
          dropped += 1;
          stats.parsed += size;
          done?.();
          return;
        }

        if (control === 'swap-held' && typeof data !== 'string' && size >= 32_768) {
          slices += 1;
          if (slices === 5) {
            swapped = forward;
            return;
          }

          forward();
          if (swapped !== undefined) {
            const later = swapped;
            swapped = undefined;
            later();
          }

          return;
        }

        forward();
      },
      onData: (listener) =>
        engine.onData((data) => {
          stats.typedAt.push(performance.now());
          if (control === 'echo-slow' && log.floodStarts.length === 0) {
            burn(80);
          }

          if (control === 'input-serial') {
            // What is typed waits for the call before it to be answered, as a page that sent its input one call at a time would: the keys are let go one at a time, each after the call before it was answered.
            typedWaiting.push(() => {
              listener(data);
            });
            if (!letting) {
              letting = true;
              const letGo = (): void => {
                const last = log.calls.at(-1);
                if (last?.outcome === 'sent') {
                  setTimeout(letGo, 5);
                  return;
                }

                typedWaiting.shift()?.();
                if (typedWaiting.length === 0) {
                  letting = false;
                  return;
                }

                setTimeout(letGo, 0);
              };

              letGo();
            }

            return;
          }

          listener(data);
        }),
      setScreenReaderMode: (on) => {
        if (control === 'reader-claims' || (control === 'reader-stuck' && !on)) {
          return;
        }

        engine.setScreenReaderMode(on);
      },
      setRenderer: async (renderer) => {
        stats.renderers.push(renderer);
        if (params.get('renderer') === 'dom') {
          return;
        }

        if (control === 'early-size' && renderer === 'gpu') {
          void engine.setRenderer(renderer).then(() => {
            const root = document.documentElement;
            root.setAttribute('data-ov-theme', root.getAttribute('data-ov-theme') ?? '');
          });
          return;
        }

        await engine.setRenderer(renderer);
      },
    };
  };
};

const NONE: readonly PluginEntry[] = [];
const plugins: PluginSource = { getSnapshot: () => NONE, subscribe: () => () => undefined };

const commits: Array<{ phase: string; actualDuration: number }> = [];
const chunkListeners = new Set<() => void>();
Object.assign(window, {
  __commits: commits,
  __engine: stats,
  __pty: {
    log,
    net,
    out: (id: string, text: string) => {
      out(id, text);
      chunkListeners.forEach((listener) => {
        listener();
      });
    },
    burst,
    ids: () => [...ptys.keys()],
    end: (id: string) => {
      finish(id, exited(0));
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    /** How many events `?control=leaky-heap` holds on to. */
    leaked: () => leak.length,
  },
});

/**
 * `?control=chunk-commit` is the negative control of the probe's "no React commit for an output chunk" assertion: a component of the page that renders for every chunk the shell writes, as a view that kept
 * the output in React state would.
 */
function ChunkCounter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const listener = () => {
      setCount((n) => n + 1);
    };

    chunkListeners.add(listener);
    return () => {
      chunkListeners.delete(listener);
    };
  }, []);
  return <span hidden>{count}</span>;
}

const root = document.getElementById('root');

/** The page is drawn once the window's session has been read (`?host=shared`: the real session, from the window's state), as the host's own screen draws it. */
async function mount(): Promise<void> {
  if (root === null) {
    return;
  }

  if (shared) {
    await hostCall('hello');
  }

  pageKey = keyed ? await loadPageKey(terminalKeyStorage({ client: windowState, name: async () => Promise.resolve('main') })) : undefined;
  const key = pageKey;
  const session = shared ? await loadSession(windowStorage({ client: windowState, name: async () => Promise.resolve('main') })) : undefined;
  createRoot(root).render(
    <ThemeProvider>
      <Profiler
        id="host"
        onRender={(_id, phase, actualDuration) => {
          commits.push({ phase, actualDuration });
        }}
      >
        {control === 'chunk-commit' ? <ChunkCounter /> : null}
        <PluginHost
          plugins={plugins}
          inventory="ready"
          link={{ plugin: params.get('plugin') ?? undefined, page: undefined, connection: undefined, params: {} }}
          onRetry={() => undefined}
          onRetryInventory={() => undefined}
          session={session}
          terminals={{ target, load, pageKey: key, restore: key === undefined ? undefined : async () => restoreLocalTerminals(key, { client, events }) }}
        />
      </Profiler>
    </ThemeProvider>,
  );
}

void mount();

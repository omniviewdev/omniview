// The real plugin host with NO plugin and a synthetic shell, for the Terminal probe (terminal-probe.mjs): `PluginHost` is the product's own, the Terminal tool in it is the product's own (the registry, the host's own
// shell target over the terminal channel, the feed, the screen controller, xterm in its lazy chunk, the close guard and its dialog); only the far end is invented: the host's terminal channel (`terminal-host.mjs`, which
// speaks docs/ui-next/terminal-channel-protocol.md: a capability from `CreateTerminal`, one stream for each terminal with the real binary frames, the ring, the window of acknowledgements, the holder, the lease), answered by a
// shell that echoes what is typed, runs a few commands with known output and ends when told. A second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it.
//
// The page speaks to the far end through `createTerminalChannels({ client, openStream, storage })`: `client` is the host's `ExecClient` calls by capability, `openStream` opens a stream that is a socket of this file (the frames
// of the protocol, in order, each handed to the page in a task of its own as a transport does), and `storage` is the window's own slot of capabilities. The far end is the page's own (`createHost` in the page: its terminals end with
// it) or, with `?host=shared`, the probe's host in its own process (terminal-serve.mjs), which outlives a reload and is shared by a second page.
//
// Commands of the shell (type them and press Enter):
//   hello           prints a known line                     size            prints "<rows> <cols>" of the pty (what the create call or the last resize frame said)
//   colors          prints the 16 colours of the palette    flood N [W]     prints N lines of W columns (default 80); it writes while its pty has room and waits when the host stops reading
//   sleep N         runs N seconds (Ctrl+C ends it): `ChannelTerminalBusy` says `busy` and names `sleep` meanwhile
//   exit [code]     prints "logout" and ends: `exited`, with the code (default 0)         kill     ends: `signaled`, SIGKILL (9)        segv     ends: `signaled`, SIGSEGV (11), core dumped
//   quit            ends: `closed`, by the host quitting (`shutdown`)                       orphan   ends: `exited` 0, and the host says a program kept the terminal open and it dropped 4,096 bytes
//   fail            ends the terminal with a typed failure
//   known           prints six lines of words that a find counts (`window.__known`)          dense [N [K]]   prints N lines (5,200) of K (6) occurrences of one word: more matches than a find shows
//   urls            prints an address that is a link and three lines that are not (`window.__urls`)     mouse-on / mouse-off   a program that asks for the mouse (every button, SGR encoding), and gives it back
//   (anything else) prints "synthetic: command not found: <word>"
// A close the page asks for ends with `closed`, by `request`.
//
//   ?renderer=dom   the emulator keeps its DOM renderer (text a probe can read); the default is the GPU's while the terminal is on screen, as the product is
//   ?shell=<name>   the shell the create call says it started (`terminal.Session.shell.name`): default zsh
//   ?fail=<how>     the create call fails: `shell-unavailable` is the host's typed 422 (the detail names every path it tried), `start` is the host's typed start failure (500)
//   ?busy=<how>     what `ChannelTerminalBusy` answers while the shell runs: `unknown` is `{ state: 'unknown', reason: 'query-failed' }`, `hang` is no answer at all; by default `idle` at the prompt and `busy` while `sleep` runs
//   ?control=<name> the negative controls that perturb the far end or the page's side of the stream, each for the assertion of the probe it is named for. The ones of the emulator: big-scrollback, leaky-heap, the two of the screen
//                   reader switch, reader-claims (the emulator is never put in screen reader mode while the window says it is) and reader-stuck (it is put in it and never taken out of it), early-size (the emulator's
//                   renderer is said to be in place before it is, and something measures the host again once it is, as the first version of the product did: `resize.none`), drop-held (the emulator is never given two of
//                   the slices the page hands it, though they are acknowledged: `hidden.drain`), swap-held (it is given the fifth slice after the sixth), ack-double (every parsed write is acknowledged twice: `flow.exact`),
//                   keys-dropped (a screen that drops what is typed while it writes a replay) and replies-as-keys (an engine that gives the emulator's answers to a query as keys): `reattach.rejoin-keys`.
//                   The ones of the stream: flow-late (the page's first acknowledgement, of nothing, is held until the emulator was given a byte: `flow.on`), ack-on-receipt (the page's acknowledgements are replaced by one
//                   for each frame, made when it is delivered and not when it is parsed: `flow.paced`), draw-hidden (every output frame delivered changes an attribute of the page: `hidden.draws`), input-serial (what is typed
//                   waits for the frame before it to be applied: `order.nowait`), ack-replay (the page acknowledges the replay: `reattach.exact`), leave-lost (the page never sends the detach frame: `reattach.leave`),
//                   cap-in-url (the capability is put in the address: `reattach.slot`), rejoin-from-zero (an attach that gives `from_offset` gives 0: `reattach.rejoin`).
//                   And the ones of the host (faults of `createHost`): size-off (the pty opens one column wider than it was asked to: `resize.cells`), resize-dropped (the host takes a resize frame and keeps its size: `order.echo`),
//                   no-shell-name, exit-code-lost, signal-lost, closed-lost, busy-always, busy-nameless, unknown-idle, code-less, start-typed, ack-lost (the credit that comes while the host's pump waits is lost: `flow.hidden`).
//                   The ones of T3a (find, the menu, the links): known-short (`known` prints four of its six lines: `find.count`) and cap-short (`dense` writes a thousand lines, which hold fewer matches than a find shows: `find.cap`) and mouse-never (the shell's
//                   `mouse-on` never asks for the mouse: `menu.mouse`) are faults of the host's shell; search-eager (the page asks for the find's lazy chunk when it loads: `find.lazy`), idle-commits (a component renders ten times a second: `find.idle`),
//                   open-twice (the stub of `openExternal` records each call twice: `links.activate`), open-given (the window gives `openExternal` although `?openExternal=off` says it cannot: `links.activate`) and reopen-forgets (the finder
//                   looks for nothing once it was cleared: a bar that is opened again does not search the text it kept: `find.keys`) are of the page; the emulator's own (count-case-ignored and the like) are in the wrapper of `load`.
//
// `window.__pty` is what the probe reads and drives: `log` (what was created, refused, written, resized, closed, asked of `ChannelTerminalBusy`, what each input or resize frame was (`calls`: its kind, the instant the page sent it
// and the host's own record of applying it) and what `size` printed, and the credit: `acks` (the count of every acknowledgement frame, in order), `ackState` (what the page had done at each, and the sum acknowledged by then), `acked` (their
// sum), `delivered` (the bytes the host handed to the stream), `maxUnacked` (the most bytes sent and not acknowledged at any instant once the window was on), `paused()` (the host stopped reading the shell) and `waiting()` (the bytes the shell wrote
// that the host has not handed to the stream)), `net` (what the stream does with the frames of the page: `latency`, the most a frame takes to arrive in milliseconds, at random but in order; and `hold`, the host being slow to apply the next
// frames), `out(id, text)` (the shell writes text now), `burst(id, events)` (the shell writes that many events of 1,000 bytes, each numbered, in one task), `end(id)` (the process exits), `ids()`. `window.__commits` lists every commit of the tree
// (React's profiler; the probe builds this entry with the profiling build of React DOM), `window.__engine` what the emulator was given and parsed (and, for a burst, whether the numbered events came in order).
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { MenuHost, ThemeProvider } from '@omniviewdev/kit';
import { Profiler, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginHost } from '../../plugins/host/PluginHost';
import type { PluginEntry } from '../../plugins/host/pluginStore';
import type { PluginSource } from '../../plugins/host/contributions';
import type { EngineLoader, FindOptions } from '../panel/terminal/engine';
import { loadXtermEngine } from '../panel/terminal/loadEngine';
import { attachLocalTerminal, localShellTarget, restoreLocalTerminals } from '../panel/terminal/localShell';
import { loadTerminalChannels, sessionCapabilityStorage, type ChannelClient, type ChannelSocket } from '../panel/terminal/terminalChannel';
import { loadSession, windowStorage, type WindowState } from '../session';
import { createHost, FRAME, fromBase64, KNOWN, toBase64, URLS } from './terminal-host.mjs';

const params = new URLSearchParams(window.location.search);
const control = params.get('control');
const shellName = (params.get('shell') ?? 'zsh').replace(/[^A-Za-z0-9._-]/g, '') || 'zsh';
/** `?host=shared`: the far end is the probe's own host (terminal-host.mjs), which outlives this page and is shared by the others of the browser context. `?lines=1` keeps the numbered lines of a flood the emulator is given. */
const shared = params.get('host') === 'shared';
const trackLines = shared || params.get('lines') === '1';
const failure = params.get('fail');
const busyMode = params.get('busy');

/** The negative controls that are a fault of the host itself: each is one way of getting the host wrong (`createHost`'s `faults`). */
const HOST_FAULTS: Readonly<Record<string, string>> = {
  'size-off': 'sizeOff',
  'resize-dropped': 'resizeIgnored',
  'no-shell-name': 'noShellName',
  'exit-code-lost': 'exitCodeLost',
  'signal-lost': 'signalLost',
  'closed-lost': 'closedLost',
  'busy-always': 'busyAlways',
  'busy-nameless': 'busyNameless',
  'unknown-idle': 'unknownIdle',
  'code-less': 'codeLess',
  'start-typed': 'startTyped',
  'ack-lost': 'ackLost',
  'known-short': 'knownShort',
  'cap-short': 'capShort',
  'mouse-never': 'mouseNever',
};

/** What yields to the event loop as a task of its own, never a timer (the probe counts timers) and never a microtask. */
const macrotask = ((): ((task: () => void) => void) => {
  const channel = new MessageChannel();
  const tasks: Array<() => void> = [];
  channel.port1.onmessage = () => {
    tasks.shift()?.();
  };

  return (task) => {
    tasks.push(task);
    channel.port2.postMessage(null);
  };
})();

const localHost = shared ? undefined : createHost({ shell: shellName, defer: macrotask, ...(failure === 'shell-unavailable' || failure === 'start' ? { fail: failure } : {}), ...(busyMode === 'unknown' || busyMode === 'hang' ? { busy: busyMode } : {}), faults: Object.fromEntries(Object.entries(HOST_FAULTS).filter(([name]) => name === control).map(([, fault]) => [fault, true])) });

// ---- the probe's host, when it is shared ------------------------------------------------------------------------------------------------------------------------------------------------------------------

type HostBinding = (windowId: string, method: string, args: readonly unknown[]) => Promise<unknown>;
type StreamBinding = (windowId: string, op: string, id: string, payload?: string) => Promise<void>;
const injected: unknown = Reflect.get(window, '__host');
const hostBinding = typeof injected === 'function' ? (injected as HostBinding) : undefined;
const streamInjected: unknown = Reflect.get(window, '__hostStream');
const streamBinding = typeof streamInjected === 'function' ? (streamInjected as StreamBinding) : undefined;
/** A page load is a page of its own: the probe's host names the streams it opened by it, and never hands the frames of an old load to a new one. */
const windowId = globalThis.crypto.randomUUID();

const callHost = async (method: string, args: readonly unknown[]): Promise<unknown> => {
  if (localHost !== undefined) {
    return localHost.call(method, args);
  }

  if (hostBinding === undefined) {
    throw new Error('the probe did not give this page its host (window.__host)');
  }

  return hostBinding(windowId, method, args);
};

// ---- the stream ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** What the stream of one terminal does at the other end: `send` a frame of the page, `close` the stream. What the host sends comes back through the two callbacks it was opened with. */
type Backend = { readonly send: (frame: Uint8Array) => void; readonly close: () => void };

const sockets = new Map<string, FixtureSocket>();
let socketSerial = 0;

/** The credit as the page made it, and what the probe reads of the stream: see the header (`window.__pty.log`). */
type Call = { readonly kind: 'write' | 'resize'; readonly size: number; readonly at: number; entry: { readonly outcome?: string; readonly appliedAt?: number | null; readonly application?: number | null } | undefined };
const calls: Call[] = [];
const credit = {
  acks: [] as number[],
  ackState: [] as Array<{ id: string; count: number; at: number; exists: boolean; delivered: number; accepted: number; parsed: number; after: number }>,
  acked: 0,
  received: 0,
  frames: 0,
};

/** What the probe changes about the stream: the most a frame of the page takes to arrive (a random time up to it, in order), and the next frames the host is slow to apply. */
const net = {
  latency: 0,
  get hold(): null {
    return null;
  },
  set hold(value: { calls: number; ms: number } | null) {
    if (value !== null) {
      localHost?.slow(value.calls, value.ms);
    }
  },
};

/** `window.__link` (shared host): the probe cuts the page's streams (`down()`: every stream is dropped and a stream opened meanwhile closes at once) and lets them be opened again (`up()`). */
const link = { up: true, dropped: 0, twice: false, writes: 0, listed: 0, listsFail: false, reached: new Map<string, number>() };

/** `window.__acks`: the probe holds the acknowledgement frames of the page from the moment it asks (`hold()`): they are in flight with no word until `release()`, when they are lost with the stream they were on or, after `accept()`, handed to the host late. */
const acks = { holding: false, accepting: false, held: [] as Array<{ socket: FixtureSocket; frame: Uint8Array }> };

/** The numbered lines the emulator is given while no byte is yet (`flow-late`): the first acknowledgement waits for the first write. */
let firstAck: (() => void) | undefined;

const leak: Uint8Array[] = [];

class FixtureSocket implements ChannelSocket {
  readonly id = String((socketSerial += 1));
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer';
  readyState = 0;
  bufferedAmount = 0;
  /** The terminal this stream carries, once the host's `ready` names it, and the offset the output has reached. */
  terminal: string | undefined;
  ready = false;
  readyEnd = 0;
  /** The bytes of the replay the page's acknowledgements are not allowed to credit (`?control=replay-unacked`). */
  withheld = 0;
  private readonly handlers: Record<'open' | 'message' | 'close' | 'error', Set<(event: Event) => void>> = { open: new Set(), message: new Set(), close: new Set(), error: new Set() };
  private readonly inbox: Array<{ readonly frame: Uint8Array } | { readonly close: true }> = [];
  private draining = false;
  private backend: Backend | undefined;
  /** The far end of a stream that was dropped: a frame that was in flight when it went can still reach the host, late, when the probe's fault says so. */
  private retired: Backend | undefined;
  private first = true;
  private lastArrival = Promise.resolve();

  constructor(open: (socket: FixtureSocket) => Backend | undefined) {
    sockets.set(this.id, this);
    macrotask(() => {
      if (!link.up) {
        this.over();
        return;
      }

      this.backend = open(this);
      if (this.backend === undefined) {
        this.over();
        return;
      }

      this.readyState = 1;
      this.emit('open', new Event('open'));
    });
  }

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: Event) => void): void {
    this.handlers[type].add(listener);
  }

  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: Event) => void): void {
    this.handlers[type].delete(listener);
  }

  /** What the host sent, in order, each frame in a task of its own. */
  push(item: { readonly frame: Uint8Array } | { readonly close: true }): void {
    this.inbox.push(item);
    if (!this.draining) {
      this.draining = true;
      macrotask(() => {
        this.drain();
      });
    }
  }

  /** The probe drops the stream: the transport is gone, and the host sees the stream end. */
  drop(): void {
    this.backend?.close();
    this.retired = this.backend;
    this.backend = undefined;
    this.inbox.length = 0;
    this.over();
  }

  /** What the page sends: the page's own faults first, then the order of the stream, after the time the frame takes to arrive. */
  send(data: Uint8Array<ArrayBuffer>): void {
    if (this.readyState !== 1) {
      return;
    }

    const type = data[0];
    if (this.first) {
      this.first = false;
      // `?control=rejoin-from-zero`: an attach that says where the page is says 0.
      if (control === 'rejoin-from-zero') {
        const request = JSON.parse(new TextDecoder().decode(data.subarray(1))) as { from_offset?: number };
        if (request.from_offset !== undefined) {
          request.from_offset = 0;
          const bytes = new TextEncoder().encode(JSON.stringify(request));
          data = new Uint8Array(1 + bytes.length);
          data[0] = FRAME.attach;
          data.set(bytes, 1);
        }
      }

      this.forward(data);
      // Armed by the probe's control `take-back-twice`, once, just before the press: the attach is made once more, as a button that attaches twice would make it.
      if (link.twice) {
        link.twice = false;
        const extra = new FixtureSocket((socket) => openBackend(socket));
        extra.push = () => undefined;
        macrotask(() => {
          extra.send(new Uint8Array(data));
        });
      }

      return;
    }

    if (type === FRAME.ack) {
      let bytes = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1);
      if (this.withheld > 0 && bytes > 0) {
        const kept = Math.min(bytes, this.withheld);
        this.withheld -= kept;
        bytes -= kept;
        if (bytes === 0) {
          return;
        }

        const rewritten = new Uint8Array(5);
        rewritten[0] = FRAME.ack;
        new DataView(rewritten.buffer).setUint32(1, bytes);
        data = rewritten;
      }

      // `?control=ack-on-receipt`: what the page acknowledges is ignored; the acknowledgement is made on receipt.
      if (control === 'ack-on-receipt' && bytes > 0) {
        return;
      }

      // `?control=flow-late`: the first acknowledgement, of nothing, waits until the emulator was given a byte.
      if (control === 'flow-late' && bytes === 0 && credit.acks.length === 0 && stats.accepted === 0) {
        firstAck = () => {
          this.sendAck(0);
        };

        return;
      }

      this.record(bytes);
      if (acks.holding) {
        acks.held.push({ socket: this, frame: new Uint8Array(data) });
        return;
      }
    }

    // `?control=leave-lost`: the page never says it is leaving.
    if (type === FRAME.detach && control === 'leave-lost') {
      return;
    }

    if (type === FRAME.input || type === FRAME.resize) {
      if (type === FRAME.input) {
        link.writes += 1;
      }

      calls.push({ kind: type === FRAME.input ? 'write' : 'resize', size: data.length - 1, at: performance.now(), entry: undefined });
    }

    this.forward(new Uint8Array(data));
  }

  /** Hands a frame to the far end, in order, after the time a frame takes to arrive. The frame is the host's from here on. */
  forward(frame: Uint8Array): void {
    const backend = this.backend ?? (acks.accepting ? this.retired : undefined);
    if (backend === undefined) {
      return;
    }

    const call = frame[0] === FRAME.input || frame[0] === FRAME.resize ? calls.at(-1) : undefined;
    const deliver = (): void => {
      backend.send(frame);
      if (call !== undefined && localHost !== undefined) {
        call.entry = localHost.log.frames.at(-1);
      }
    };

    if (net.latency > 0) {
      const wait = Math.random() * net.latency;
      this.lastArrival = this.lastArrival.then(
        async () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              deliver();
              resolve();
            }, wait);
          }),
      );
    } else {
      deliver();
    }
  }

  close(): void {
    this.backend?.close();
    this.backend = undefined;
    this.readyState = 3;
    sockets.delete(this.id);
  }

  private emit(type: 'open' | 'message' | 'close' | 'error', event: Event): void {
    for (const listener of [...this.handlers[type]]) {
      listener(event);
    }
  }

  private drain(): void {
    const item = this.inbox.shift();
    if (item === undefined) {
      this.draining = false;
      return;
    }

    if ('close' in item) {
      this.over();
    } else {
      this.arrive(item.frame);
    }

    if (this.inbox.length > 0) {
      macrotask(() => {
        this.drain();
      });
    } else {
      this.draining = false;
    }
  }

  /** A frame of the host reaches the page: what the probe records of it, the faults of the page's side, and the message. */
  private arrive(frame: Uint8Array): void {
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    if (frame[0] === FRAME.ready) {
      try {
        const ready = JSON.parse(new TextDecoder().decode(frame.subarray(1))) as { readonly end?: number; readonly session?: { readonly id?: string } };
        this.terminal = ready.session?.id;
        this.readyEnd = ready.end ?? 0;
      } catch {
        // The page says what it makes of a ready it cannot read.
      }

      this.ready = true;
    } else if (frame[0] === FRAME.output) {
      const offset = Number(view.getBigUint64(1));
      const size = frame.length - 9;
      credit.received += size;
      credit.frames += 1;
      if (this.terminal !== undefined) {
        link.reached.set(this.terminal, offset + size);
      }

      if (control === 'leaky-heap') {
        leak.push(frame);
      }

      if (control === 'draw-hidden') {
        document.body.dataset.delivered = String(credit.received);
      }

      // `?control=ack-on-receipt`: the page's acknowledgement is made as the frame is delivered, and not when it is parsed.
      if (control === 'ack-on-receipt' && offset >= this.readyEnd) {
        this.sendAck(size);
      }

      // `?control=replay-unacked`: the page never acknowledges the replay (what it acknowledges of the first bytes it was sent is kept back), though the host counts every frame it sent, the replay included, against its window.
      if (control === 'replay-unacked' && offset < this.readyEnd) {
        this.withheld += size;
      }
    } else if (frame[0] === FRAME.gap && this.terminal !== undefined) {
      link.reached.set(this.terminal, Number(view.getBigUint64(9)));
    }

    const data = new Uint8Array(frame).buffer;
    this.emit('message', new MessageEvent('message', { data }));
  }

  private over(): void {
    if (this.readyState === 3) {
      return;
    }

    this.readyState = 3;
    sockets.delete(this.id);
    this.emit('close', new Event('close'));
  }

  private sendAck(bytes: number): void {
    this.record(bytes);
    this.forward(this.frameOfAck(bytes));
  }

  private frameOfAck(bytes: number): Uint8Array {
    const frame = new Uint8Array(5);
    frame[0] = FRAME.ack;
    new DataView(frame.buffer).setUint32(1, bytes);
    return frame;
  }

  private record(bytes: number): void {
    credit.acks.push(bytes);
    credit.acked += bytes;
    credit.ackState.push({ id: this.terminal ?? '', count: bytes, at: performance.now(), exists: this.ready, delivered: localHost?.log.delivered ?? credit.received, accepted: stats.accepted, parsed: stats.parsed, after: credit.acked });
  }
}

/** Opens the far end of a stream: the page's own host, or the probe's, through its binding. */
function openBackend(socket: FixtureSocket): Backend | undefined {
  if (localHost !== undefined) {
    const stream = localHost.openStream(
      (frame: Uint8Array) => {
        socket.push({ frame });
      },
      () => {
        socket.push({ close: true });
      },
    );
    return {
      send: (frame) => {
        stream.send(frame);
      },
      close: () => {
        stream.close();
      },
    };
  }

  if (streamBinding === undefined) {
    return undefined;
  }

  const binding = streamBinding;
  let chain: Promise<void> = binding(windowId, 'open', socket.id);
  const queue = (op: string, payload?: string): void => {
    chain = chain.then(async () => binding(windowId, op, socket.id, payload)).catch(() => undefined);
  };

  return {
    send: (frame) => {
      // A page that is going away sends the one frame that must outlive it as a request that does too.
      const beacon: unknown = Reflect.get(window, '__hostBeacon');
      if (frame[0] === FRAME.detach && typeof beacon === 'string') {
        void fetch(beacon, { method: 'POST', keepalive: true, body: JSON.stringify({ windowId, id: socket.id, payload: toBase64(frame) }) }).catch(() => undefined);
        return;
      }

      queue('send', toBase64(frame));
    },
    close: () => {
      queue('close');
    },
  };
}

/** What the probe's host sent on the page's streams, in the order it sent it. */
Object.assign(window, {
  __hostFrames: (items: ReadonlyArray<{ readonly id: string; readonly frame?: string; readonly close?: true }>): void => {
    for (const item of items) {
      const socket = sockets.get(item.id);
      if (socket === undefined) {
        continue;
      }

      if (item.frame !== undefined) {
        socket.push({ frame: fromBase64(item.frame) });
      } else {
        socket.push({ close: true });
      }
    }
  },
});

const openStream = (): ChannelSocket => new FixtureSocket((socket) => openBackend(socket));

// ---- the host's calls ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const client: ChannelClient = {
  CreateTerminal: async (options, launch) => {
    const answer = await callHost('CreateTerminal', [options, launch]);
    // `?control=cap-in-url`: the capability is put in the address, where a reload, a log and a screenshot would keep it.
    if (control === 'cap-in-url' && typeof answer === 'object' && answer !== null && 'cap' in answer && typeof answer.cap === 'string') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search === '' ? '?' : `${window.location.search}&`}k=${answer.cap}`);
    }

    return answer;
  },
  CloseChannelTerminal: async (cap) => callHost('CloseChannelTerminal', [cap]),
  DismissChannelTerminal: async (cap) => callHost('DismissChannelTerminal', [cap]),
  ChannelTerminalBusy: async (cap) => callHost('ChannelTerminalBusy', [cap]),
  ListChannelTerminals: async (caps) => {
    try {
      // From the moment the probe arms it (`window.__link.failLists(true)`, its control `refresh-skipped`) the host's list cannot be had: the page cannot learn who holds a terminal it lost.
      if (link.listsFail) {
        throw new Error('the host could not answer the list');
      }

      return await callHost('ListChannelTerminals', [caps]);
    } finally {
      link.listed += 1;
    }
  },
};

/** The host's window service as the generated binding has it (`GetState`, `SaveState`): the slots of each window. `?host=shared` keeps them in the probe's host, which outlives the page, as the host's own state root does. */
const slots = new Map<string, Record<string, string | undefined>>();

/**
 * `?control=restore-forgets-open` and `?control=restore-forgets-closed`: what the window state says of the panel is changed as it is read, so that the saved session says the panel was closed (or open) whatever it was saved as,
 * as a restore that forgot the flag would have it.
 */
const withOpenFlag = (state: Record<string, string | undefined>, open: boolean): Record<string, string | undefined> => {
  const text = state.session;
  if (text === undefined) {
    return state;
  }

  try {
    const saved: unknown = JSON.parse(text);
    if (typeof saved === 'object' && saved !== null && 'panel' in saved && typeof saved.panel === 'object' && saved.panel !== null) {
      return { ...state, session: JSON.stringify({ ...saved, panel: { ...saved.panel, open } }) };
    }
  } catch {
    // A session that cannot be read is read as it is.
  }

  return state;
};

const sharedState: WindowState = {
  GetState: async (name) => {
    const state = (await callHost('GetState', [name])) as Record<string, string | undefined>;
    return control === 'restore-forgets-open' ? withOpenFlag(state, false) : control === 'restore-forgets-closed' ? withOpenFlag(state, true) : state;
  },
  SaveState: async (name, slot, json) => {
    if ((control === 'no-session' && slot === 'session')) {
      return;
    }

    await callHost('SaveState', [name, slot, json]);
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
  Object.assign(window, {
    __windowId: windowId,
    __link: {
      /** Every stream of the page is dropped (the transport is gone) and a stream opened meanwhile closes at once, until `up()`. Answers how far the output of each terminal had got. */
      down: (): Record<string, number> => {
        link.up = false;
        for (const socket of [...sockets.values()]) {
          link.dropped += 1;
          socket.drop();
        }

        return Object.fromEntries(link.reached);
      },
      up: (): void => {
        link.up = true;
      },
      arm: (on: boolean): void => {
        link.twice = on;
      },
      state: (): { up: boolean; dropped: number; writes: number; listed: number; streams: number; delivered: Record<string, number> } => ({ up: link.up, dropped: link.dropped, writes: link.writes, listed: link.listed, streams: sockets.size, delivered: Object.fromEntries(link.reached) }),
      failLists: (on: boolean): void => {
        link.listsFail = on;
      },
    },
    __acks: {
      hold: (): void => {
        acks.holding = true;
      },
      held: (): number => acks.held.length,
      accept: (): void => {
        acks.accepting = true;
      },
      release: (): void => {
        acks.holding = false;
        for (const held of acks.held.splice(0)) {
          // A frame that was in flight when its stream went is lost with it; the probe's fault makes the host take it late, from the stream it was on.
          if (acks.accepting) {
            held.socket.forward(held.frame);
          }
        }
      },
    },
  });
}


/**
 * What the emulator was given and what it parsed, for the probe (`window.__engine`): the bytes accepted by `write` and the bytes whose callback has run, the instant of the last write, the instants of what the user typed, and
 * the renderers asked for in order. The GPU draws on a canvas: this is the only record of what reached it. `order` is what a burst checks: the numbered events (each starts with its number, 1,000 bytes after the one before)
 * are looked for where the emulator was given them, and `bad` counts the ones that were not where they belong. `measure` is the size the emulator would fit to the host now, which is the one a renderer in place gives.
 */
type Order = { readonly base: number; readonly events: number; checked: number; bad: number; first: { k: number; at: number; got: number } | null };
/** The numbered lines of a flood (`0000042 xxx`) as the emulator was given them: the last number, how many, and where one was skipped or repeated. */
type Lines = { last: number; first: number; count: number; carry: string; gaps: Array<{ after: number; got: number }>; dups: Array<{ after: number; got: number }>; resets: number };
const stats = {
  writes: 0,
  accepted: 0,
  parsed: 0,
  lastWriteAt: 0,
  typedAt: [] as number[],
  renderers: [] as string[],
  engines: 0,
  order: null as Order | null,
  lines: (trackLines ? { last: -1, first: -1, count: 0, carry: '', gaps: [], dups: [], resets: 0 } : null) as Lines | null,
  grid: (): { cols: number; rows: number } => ({ cols: 0, rows: 0 }),
  measure: (): { cols: number; rows: number } | null => null,
};

/**
 * `window.__gate`: the probe holds back the end of the emulator's writes. The emulator is given the bytes and parses them, and the callback that says it has is kept until the probe lets it go, so that a replay takes as many
 * frames as the probe wants and a key typed meanwhile is typed while the screen is still writing. `keys` and `replies` count what the emulator says through `onData`: what the user typed, and what the emulator answered to a
 * query in the bytes it parsed (the engine says which it is).
 */
const gate = { closed: false, held: [] as Array<() => void>, keys: 0, replies: 0 };


/** The bytes of one event of a burst, and how many digits of its number it starts with. */
const EVENT_BYTES = 1000;
const NUMBER_DIGITS = 7;

/**
 * What the probe reads of the far end, in the shape the probe has always read it (`window.__pty.log`): the page's own far end keeps its records in its host (`createHost`'s `log`), and what the page did is the stream's.
 * A `?host=shared` page has no host of its own: what the probe reads of it is the probe's own host, in the probe's process.
 */
const log = {
  get created(): string[] {
    return (localHost?.log.created ?? []).map((entry: { id: string }) => entry.id);
  },
  /** The ids the host refused to start (`?fail=`). */
  get refused(): string[] {
    return localHost?.log.refused ?? [];
  },
  /** The terminals this page asked the host to close (`CloseChannelTerminal`). */
  get closed(): string[] {
    return localHost?.log.closed ?? [];
  },
  /** What the shell was typed, in the order the host applied it. */
  get writes(): string[] {
    return (localHost?.log.writes ?? []).map((entry: { data: string }) => entry.data);
  },
  /** The size the pty was opened at by the create call and every size the host applied after it, in the order it applied them. */
  get resizes(): Array<{ id: string; rows: number; cols: number }> {
    return localHost?.log.resizes ?? [];
  },
  /** The instant each write reached the shell (`performance.now()`): the end of an input's latency. */
  writeAt: localHost?.log.writeAt ?? [],
  /** Every `ChannelTerminalBusy` call: the question the close of a running terminal asks, once. */
  get busy(): Array<{ id: string | null; at: number }> {
    return localHost?.log.busy ?? [];
  },
  /** Every input and resize frame, in the order the page sent them, and the host's own record of applying each. */
  get calls(): Array<{ kind: 'write' | 'resize'; size: number; at: number; outcome: string; application: number | null; appliedAt: number | null }> {
    return calls.map((call) => ({ kind: call.kind, size: call.size, at: call.at, outcome: call.entry?.outcome === undefined || call.entry.outcome === 'received' ? 'sent' : call.entry.outcome, application: call.entry?.application ?? null, appliedAt: call.entry?.appliedAt ?? null }));
  },
  /** The streams the page opened, and the detach frames it sent. */
  get streams(): number {
    return localHost?.log.streams.length ?? 0;
  },
  get detaches(): number {
    return localHost?.log.detaches.length ?? 0;
  },
  /** What `size` printed, in order: the pty's own idea of its size. */
  get sizeReports(): Array<{ rows: number; cols: number }> {
    return localHost?.log.sizeReports ?? [];
  },
  /** How many prompts the shell has written: a probe that types a command waits for the next one (and for the page to have parsed what the host handed to the stream) before it reads the screen. */
  get prompts(): number {
    return localHost?.log.prompts ?? 0;
  },
  /** The count of every acknowledgement frame, in order, what the page had done at the instant of each (the bytes the host had handed to the stream, the emulator had been given and had parsed), the sum acknowledged by then, and their sum. */
  acks: credit.acks,
  ackState: credit.ackState,
  get acked(): number {
    return credit.acked;
  },
  /** The bytes the host handed to the stream, and the most it ever had sent and not acknowledged once the page's window was on. */
  /** How many output frames reached the page. */
  get receivedFrames(): number {
    return credit.frames;
  },
  get delivered(): number {
    return localHost?.log.delivered ?? credit.received;
  },
  get maxUnacked(): number {
    return localHost?.log.maxUnacked ?? 0;
  },
  /** The floods that ended (everything they wrote was handed to the stream), and the instant each began. */
  get floods(): Array<{ id: string; lines: number; bytes: number }> {
    return localHost?.log.floods ?? [];
  },
  get floodStarts(): Array<{ id: string; at: number }> {
    return localHost?.log.floodStarts ?? [];
  },
  /** Whether the host has stopped reading the shell, and the bytes the shell wrote that the host has not handed to the stream. */
  paused: (): boolean => localHost?.paused() ?? false,
  waiting: (): number => localHost?.waiting() ?? 0,
};

/** What a burst writes: the host writes the numbered events in one task, and the emulator's wrapper then looks, for each event, at the number where the event ought to be in what it is given (`checkOrder`). */
function burst(id: string, events: number): { ms: number; delivered: number; paused: boolean; waiting: number } {
  if (localHost === undefined) {
    return { ms: 0, delivered: 0, paused: false, waiting: 0 };
  }

  stats.order = { base: stats.accepted, events, checked: 0, bad: 0, first: null };
  const started = performance.now();
  const result = localHost.burst(id, events);
  return { ms: performance.now() - started, ...result };
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

/** Every address the window was asked to open outside itself, in order (`window.__opened`). */
const opened: string[] = [];
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
      Object.assign(lines, { last: -1, first: -1, carry: '' });
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

    if (lines.first < 0) {
      lines.first = number;
    }

    lines.count += 1;
    lines.last = number;
  }
}

const load: EngineLoader = async () => {
  const create = await loadXtermEngine();
  return (options) => {
    // `?control=big-scrollback` is the negative control of the probe's scrollback cap: an emulator that keeps four times the lines. `?control=reader-claims` makes it in the mode the person did not choose (off) whatever the window says.
    const engine = create(
      control === 'big-scrollback' ? { ...options, scrollback: 20_000 } : control === 'reader-claims' ? { ...options, screenReaderMode: false } : control === 'cap-unlimited' ? { ...options, findLimit: 1_000_000 } : options,
    );
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
          // `?control=flow-late`: the page's first acknowledgement was held until the emulator was given a byte.
          if (firstAck !== undefined) {
            const release = firstAck;
            firstAck = undefined;
            release();
          }

          engine.write(data, () => {
            const parsed = (): void => {
              stats.parsed += size;
              done?.();
              if (control === 'ack-double') {
                done?.();
              }
            };

            // The probe's gate holds the end of the write: the emulator has the bytes, and the screen is told that it has parsed them when the probe lets it.
            if (gate.closed) {
              gate.held.push(parsed);
            } else {
              parsed();
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
        engine.onData((data, user) => {
          stats.typedAt.push(performance.now());
          if (user) {
            gate.keys += 1;
          } else {
            gate.replies += 1;
          }

          // `?control=keys-dropped`: a screen that drops what is typed while it writes a replay loses the keys before it sees them.
          if (control === 'keys-dropped' && gate.closed && user) {
            return;
          }

          // `?control=replies-as-keys`: an engine that cannot tell what the emulator answers from what the user typed gives its answers to the screen as keys.
          const typed = control === 'replies-as-keys' ? true : user;
          if (control === 'echo-slow' && log.floodStarts.length === 0) {
            burn(80);
          }

          if (control === 'input-serial') {
            // What is typed waits for the call before it to be answered, as a page that sent its input one call at a time would: the keys are let go one at a time, each after the call before it was answered.
            typedWaiting.push(() => {
              listener(data, typed);
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

          listener(data, typed);
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
      // The find, the mouse, the paste, the trigger of the context menu and the links, and what each negative control does to them. `count-case-ignored`, `count-word-ignored` and `count-regex-ignored`: an emulator that reads a query
      // without one of the three switches of the find bar (`find.count`); `step-stuck`: a find that does not leave the match it is on (`find.count`); `cap-unlimited` (above): one with no highest count (`find.cap`);
      // `mouse-reporting-lost`: an emulator that never says the program has the mouse (`menu.mouse`); `paste-lost`: a paste that goes nowhere and `trigger-lost`: an input that never gets the attributes of the menu's trigger (`menu.open`);
      // `links-plain-follows`: a click that the emulator says had the modifier held, `links-hover-never`: a pointer that is never said to be on a link and `links-leave-never`: one that is never said to have left it (`links.activate`, `links.tooltip`).
      find: async () => {
        const finder = await engine.find();
        const read = (query: FindOptions): FindOptions => ({
          caseSensitive: control === 'count-case-ignored' ? false : query.caseSensitive,
          wholeWord: control === 'count-word-ignored' ? false : query.wholeWord,
          regex: control === 'count-regex-ignored' ? false : query.regex,
        });
        let last: string | undefined;
        /** `?control=reopen-forgets`: the finder has been cleared once (the bar was closed), and looks for nothing after it. */
        let cleared = false;
        return {
          ...finder,
          clear: () => {
            cleared = true;
            finder.clear();
          },
          next: (query, switches) => {
            if ((control === 'step-stuck' && query === last) || (control === 'reopen-forgets' && cleared)) {
              return;
            }

            last = query;
            finder.next(query, read(switches));
          },
          previous: (query, switches) => {
            if ((control === 'step-stuck' && query === last) || (control === 'reopen-forgets' && cleared)) {
              return;
            }

            last = query;
            finder.previous(query, read(switches));
          },
        };
      },
      mouseReporting: () => control !== 'mouse-reporting-lost' && engine.mouseReporting(),
      paste: (text) => {
        if (control !== 'paste-lost') {
          engine.paste(text);
        }
      },
      decorateInput: (attributes) => {
        if (control !== 'trigger-lost') {
          engine.decorateInput(attributes);
        }
      },
      setLinks: (handler) => {
        if (handler === undefined) {
          engine.setLinks(undefined);
          return;
        }

        engine.setLinks({
          activate: (uri, event) => {
            handler.activate(uri, control === 'links-plain-follows' ? new MouseEvent('click', { metaKey: true, ctrlKey: true }) : event);
          },
          hover: (hover) => {
            if (control === 'links-hover-never' || (control === 'links-leave-never' && hover === undefined)) {
              return;
            }

            handler.hover(hover);
          },
        });
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
  __gate: {
    close: (): void => {
      gate.closed = true;
    },
    open: (): void => {
      gate.closed = false;
      for (const parsed of gate.held.splice(0)) {
        parsed();
      }
    },
    held: (): number => gate.held.length,
    keys: (): number => gate.keys,
    replies: (): number => gate.replies,
  },
  __pty: {
    log,
    net,
    out: (id: string, text: string) => {
      localHost?.append(id, text);
      chunkListeners.forEach((listener) => {
        listener();
      });
    },
    burst,
    ids: () => localHost?.ids() ?? [],
    end: (id: string) => {
      localHost?.end(id);
    },
    /** How many frames `?control=leaky-heap` holds on to. */
    leaked: () => leak.length,
  },
  /** What the shell prints for `known` and `urls`, line by line, and the addresses the page was asked to open outside the window (`openExternal`). */
  __known: [...KNOWN],
  __urls: [...URLS],
  __opened: opened,
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

/** `?control=idle-commits`: a component that renders ten times a second for as long as the page lives, as a view that kept a clock would: a page that is at rest commits nothing. */
function IdleTicker() {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTicks((n) => n + 1);
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return <span hidden>{ticks}</span>;
}

/**
 * Every address the window was asked to open outside itself, in order (`window.__opened`): `openExternal` is what the Terminal tool is given to open a link. `?openExternal=off` gives it none, as a window that cannot open one has; `?control=open-twice`
 * records each call twice; `?control=open-given` gives it whatever `?openExternal=off` says. `?control=search-eager` asks for the find's lazy chunk when the page loads.
 */
const openExternal = async (url: string): Promise<void> => {
  opened.push(url);
  if (control === 'open-twice') {
    opened.push(url);
  }

  return Promise.resolve();
};

const givesOpenExternal = params.get('openExternal') !== 'off' || control === 'open-given';
if (control === 'search-eager') {
  void import('@xterm/addon-search');
}

const root = document.getElementById('root');

/** The page is drawn once the window's session and its terminals' capabilities have been read (`?host=shared`: the real ones, from the window's state), as the host's own screen draws it. */
async function mount(): Promise<void> {
  if (root === null) {
    return;
  }

  if (shared) {
    await callHost('hello', []);
  }

  // The capabilities are kept in this tab's sessionStorage and nowhere else. `?control=cap-forgotten`: what is written to it is dropped, as a page that never kept them would.
  const kept = sessionCapabilityStorage(window);
  // `?control=cap-in-state`: the capabilities are also saved in the window's state, as the first version kept them.
  const storage =
    control === 'cap-forgotten'
      ? { read: kept.read, write: () => undefined }
      : control === 'cap-in-state'
        ? {
          read: kept.read,
          write: (text: string) => {
            kept.write(text);
            void windowState.SaveState('main', 'terminal-capabilities', text);
          },
        }
        : kept;
  const channels = loadTerminalChannels({ client, openStream, storage });
  const session = shared ? await loadSession(windowStorage({ client: windowState, name: async () => Promise.resolve('main') })) : undefined;
  // The window's one menu host, as the app's entry mounts it (ui-next/main.tsx): the terminal's context menu opens on it, and without it a trigger is inert.
  createRoot(root).render(
    <ThemeProvider>
      <MenuHost>
        <Profiler
          id="host"
          onRender={(_id, phase, actualDuration) => {
            commits.push({ phase, actualDuration });
          }}
        >
          {control === 'chunk-commit' ? <ChunkCounter /> : null}
          {control === 'idle-commits' ? <IdleTicker /> : null}
          <PluginHost
            plugins={plugins}
            inventory="ready"
            link={{ plugin: params.get('plugin') ?? undefined, page: undefined, connection: undefined, params: {} }}
            onRetry={() => undefined}
            onRetryInventory={() => undefined}
            session={session}
            terminals={{ target: () => localShellTarget(channels), load, restore: async () => restoreLocalTerminals(channels), reattach: (id: string) => attachLocalTerminal(id, undefined, channels), ...(givesOpenExternal ? { openExternal } : {}) }}
          />
        </Profiler>
      </MenuHost>
    </ThemeProvider>,
  );
}

void mount();

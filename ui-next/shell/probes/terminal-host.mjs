// The far end of the Terminal tool as the host's terminal channel makes it (docs/ui-next/terminal-channel-protocol.md, backend/pkg/terminal/channel_serve.go): a capability that reaches a terminal, and ONE stream for each terminal. It is plain JavaScript
// with no dependency and no Node module, so that the same host runs in two places: inside the fixture page (`terminal-fixture.tsx`, the terminals that live and die with the page) and in the probe's own process
// (`?host=shared`, through `terminal-serve.mjs`), where it outlives a reload of the page and is shared by a second page of the browser context. The page speaks to it through `createTerminalChannels({ client, openStream, storage })`: `client`
// is `host.call` (`CreateTerminal`, `CloseChannelTerminal`, `ChannelTerminalBusy`, `ChannelTerminalCwd`, `ListChannelTerminals`, `DismissChannelTerminal`, and the window's `GetState` and `SaveState`), and `openStream` opens a stream of `host.openStream`.
//
// What it models of the host, each as the document states it:
//   - a terminal is made with `launch.channel` and answers the capability once (43 characters of base64url) in the answer of `CreateTerminal`; every call that takes a capability answers ONE error, `omniview:session/not-found`, whatever the reason it opens
//     nothing; a terminal is on its lease from the moment it is made and the first stream that shows the capability ends it (section 2);
//   - the frames of section 4, one binary message each: `attach` first and only once (at most 1,024 bytes), `ready` first from the host, `output` by offset (at most 64 KiB, and at most the credit that is left), `gap`, `ended`, `taken-over`, `not-found`, and of version 2 `applied`, `released`, `unsupported`; `input`, `resize`,
//     `ack` and `detach` from the page. A frame that is too short or too long for its type, an unknown type, one of the host's types or a second `attach` closes the stream with no answer (section 8);
//   - the ring of what the shell wrote (`channel_ring_bytes`: chunks that close at a boundary that is not inside an escape or a UTF-8 sequence, with absolute offsets), the size log and the modes a scanner reads from the output, exact at any offset: the replay of
//     a page that gives `from_offset` begins exactly there when the ring still has it, and `ready.lost` is the distance to the first byte it still has when it does not (section 5);
//   - the holder is the stream: a second stream with the capability takes the terminal (the first is sent `taken-over` and stays open as a watcher, and its input and acknowledgements are refused from then on; it is sent `released` when the stream that holds the terminal ends while the terminal runs, or `ended`, and is closed; at most four watch one terminal); the host counts the input it has applied across streams and tells the holder (`ready.input_applied`, `applied`); when the stream ends, however it ends, nobody holds the terminal and its lease
//     runs, and at the end of the lease it ends as a close does, `closed_by: 'detach-timeout'`, with nobody told (section 8);
//   - the pump never depends on the page (it reads the shell into the ring whatever the page does) but waits while a page that holds the terminal has more than `channel_high_bytes` unsent, until the sender has brought it down to `channel_low_bytes`; the first `ack`
//     turns the page's window on: it holds at most `channel_inflight_bytes` sent and not acknowledged (replay included), and a frame is cut to the credit that is left; an acknowledgement of a stream that does not hold the terminal counts for nothing (section 7);
//   - a shell that ends by itself leaves its end and its output until `DismissChannelTerminal`, its lease, or more than 16 kept ends (the oldest goes first); a terminal the host closed leaves nothing; the stream that holds an ending shell is sent every byte, then
//     `ended`, and is closed (section 9).
// The synthetic shell has the commands of the in-page fixture (hello, size, colors, flood, sleep, exit, kill, segv, quit, orphan, fail) and two more for the probe: `fullscreen` (a full-screen program: alternate screen, the mouse, bracketed paste, application
// cursor, focus events and a hidden cursor, redrawn on every resize) and `query` (a program that asks the terminal where its cursor is and what it is). `faults` are the negative controls' far end: each one is a single way of getting the host wrong, named for the
// assertion that must see it. Nothing in it is a clock the test waits on: leases are timers that a test shortens, and what is asserted is counted.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const LIMITS = Object.freeze({
  max_dimension: 1000,
  channel_ring_bytes: 8_388_608,
  channel_high_bytes: 1_048_576,
  channel_low_bytes: 262_144,
  channel_stall_ms: 2000,
  channel_inflight_bytes: 1_048_576,
  channel_frame_bytes: 65_536,
  channel_max_input_bytes: 1_048_576,
  lease_default_ms: 300_000,
  lease_max_ms: 1_800_000,
});

/** The most the host reads from the shell's pty at once, and what a chunk of the ring holds before it closes. */
export const READ_MAX = 65_536;
export const CHUNK = 65_536;
/** What the pty's own buffer holds before the shell's write blocks. Only a writer that waits for room (the flood) reads it. */
const PTY_ROOM = 65_536;
/** The ends of channel terminals the host keeps at once: more, and the oldest goes first. */
export const KEPT_ENDS = 16;
const MAX_ATTACH = 1024;
/** How many displaced streams watch one terminal: the one that has watched longest is closed when there are more. */
const WATCHERS = 4;
const PROMPT = '\u001b[32muser@synthetic\u001b[0m:\u001b[34m~\u001b[0m$ ';
const BANNER = `\u001b[90mSynthetic shell: hello, size, colors, flood N [W], sleep N, exit [code], kill, quit, fail\u001b[0m\r\n${PROMPT}`;

/** What `known` prints, a line each: words that a find has to count (other cases, a word inside another, a word between marks, a word that a pattern also takes). The probe reads the same lines from `window.__known`, so the text is in one place. */
export const KNOWN = Object.freeze(['alpha Alpha ALPHA alphabet', 'beta alpha_beta alpha-beta betalpha', 'gamma 123 alpha 456 alpha.', 'delta Delta DELTA delta delta', 'epsilon alpha, epsilon; alpha', 'zeta eta theta iota kappa']);
/** What `urls` prints, a line each: an address that is a link, a script and another scheme that no link opens, and a name that is only text. `window.__urls`. */
export const URLS = Object.freeze(['docs: https://example.com/docs/alpha for the docs', 'script: javascript:alert(1) in a line', 'ftp: ftp://example.com/file in a line', 'name: example.com in a line']);
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;

/** The types of the frames (protocol section 4): below 0x80 the page's, from 0x80 the host's. Version 2 added `applied`, `released` and `unsupported`. */
export const FRAME = Object.freeze({ attach: 0x01, input: 0x02, resize: 0x03, ack: 0x04, detach: 0x05, ready: 0x81, output: 0x82, gap: 0x83, ended: 0x84, takenOver: 0x85, notFound: 0x86, applied: 0x87, released: 0x88, unsupported: 0x89 });

// ---- the frames --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const withType = (type, payload) => {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);
  return frame;
};

const jsonFrame = (type, value) => withType(type, encoder.encode(JSON.stringify(value)));

const outputFrame = (offset, bytes) => {
  const frame = new Uint8Array(9 + bytes.length);
  frame[0] = FRAME.output;
  new DataView(frame.buffer).setBigUint64(1, BigInt(offset));
  frame.set(bytes, 9);
  return frame;
};

const appliedFrame = (total) => {
  const frame = new Uint8Array(9);
  frame[0] = FRAME.applied;
  new DataView(frame.buffer).setBigUint64(1, BigInt(total));
  return frame;
};

/** The one version of the stream this host speaks (`attach.v`). */
export const VERSION = 2;

const gapFrame = (from, to) => {
  const frame = new Uint8Array(17);
  frame[0] = FRAME.gap;
  const view = new DataView(frame.buffer);
  view.setBigUint64(1, BigInt(from));
  view.setBigUint64(9, BigInt(to));
  return frame;
};

/** The frames a page sends, as a test or a probe makes them. */
export const pageFrames = {
  attach: (cap, fromOffset, version = VERSION) => withType(FRAME.attach, encoder.encode(JSON.stringify({ v: version, cap, ...(fromOffset === undefined ? {} : { from_offset: fromOffset }) }))),
  input: (bytes) => withType(FRAME.input, typeof bytes === 'string' ? encoder.encode(bytes) : bytes),
  resize: (cols, rows) => {
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint16(0, cols);
    new DataView(payload.buffer).setUint16(2, rows);
    return withType(FRAME.resize, payload);
  },
  ack: (n) => {
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, n);
    return withType(FRAME.ack, payload);
  },
  detach: () => new Uint8Array([FRAME.detach]),
};

/** What a frame of the host says, read: `{ kind: 'ready', ready }`, `{ kind: 'output', offset, bytes }`, `{ kind: 'gap', from, to }`, `{ kind: 'ended', end }`, `{ kind: 'taken-over' }`, `{ kind: 'not-found' }`, `{ kind: 'applied', n }`, `{ kind: 'released' }`, `{ kind: 'unsupported', v }`. */
export function readFrame(frame) {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  switch (frame[0]) {
    case FRAME.ready:
      return { kind: 'ready', ready: JSON.parse(decoder.decode(frame.subarray(1))) };
    case FRAME.output:
      return { kind: 'output', offset: Number(view.getBigUint64(1)), bytes: frame.subarray(9) };
    case FRAME.gap:
      return { kind: 'gap', from: Number(view.getBigUint64(1)), to: Number(view.getBigUint64(9)) };
    case FRAME.ended:
      return { kind: 'ended', end: JSON.parse(decoder.decode(frame.subarray(1))) };
    case FRAME.takenOver:
      return { kind: 'taken-over' };
    case FRAME.notFound:
      return { kind: 'not-found' };
    case FRAME.applied:
      return { kind: 'applied', n: Number(view.getBigUint64(1)) };
    case FRAME.released:
      return { kind: 'released' };
    case FRAME.unsupported:
      return { kind: 'unsupported', v: JSON.parse(decoder.decode(frame.subarray(1))).v };
    default:
      return { kind: 'unknown', type: frame[0] };
  }
}

export const toBase64 = (bytes) => {
  let text = '';
  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(text);
};

export const fromBase64 = (text) => {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) bytes[at] = raw.charCodeAt(at);
  return bytes;
};

const concat = (parts) => {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

/** What an error of the host is, as the page receives it: an error whose message is the JSON of the host's envelope. */
const refusal = (type, title, status, code, detail) => new Error(JSON.stringify({ type, title, status, detail, code }));
/** Every call that names a terminal by its capability answers this, whatever the reason it opens nothing; its words hold nothing the caller sent. */
const gone = () => refusal('omniview:session/not-found', 'Session not found', 404, 'NOT_FOUND', 'No terminal is held by that capability.');
const invalid = (name, why) => refusal('omniview:resource/invalid-request', 'Invalid request', 400, 'INVALID_REQUEST', `${name}: ${why}`);

// ---- the modes a scanner reads from the output ------------------------------------------------------------------------------------------------------------------------------------------------------------

const noModes = () => ({ known: true, alt_screen: false, bracketed_paste: false, application_cursor: false, focus_events: false, cursor_hidden: false, mouse_tracking: 0, mouse_encoding: 0, kitty_keyboard: [] });

/**
 * Reads the modes the program has set from its output, a byte at a time, so that it is exact however the output is cut: alt screen (47, 1047, 1049), the mouse (9 and 1000 click, 1002 drag, 1003 any motion; 1005, 1006,
 * 1015 for the encoding), bracketed paste (2004), application cursor (1), focus events (1004), the cursor (25), DECSTR and RIS. `boundary` says whether the next byte starts something: not inside an escape or a UTF-8 sequence.
 */
export class Scanner {
  constructor() {
    this.modes = noModes();
    this.state = 'ground';
    this.params = '';
    this.private = false;
    this.bang = false;
    this.utf8 = 0;
  }

  clone() {
    const copy = new Scanner();
    copy.modes = { ...this.modes, kitty_keyboard: [...this.modes.kitty_keyboard] };
    Object.assign(copy, { state: this.state, params: this.params, private: this.private, bang: this.bang, utf8: this.utf8 });
    return copy;
  }

  get boundary() {
    return this.state === 'ground' && this.utf8 === 0;
  }

  feed(bytes) {
    for (const byte of bytes) this.step(byte);
  }

  step(byte) {
    switch (this.state) {
      case 'ground':
        if (byte === 0x1b) this.state = 'esc';
        else if (byte >= 0xc0) this.utf8 = byte >= 0xf0 ? 3 : byte >= 0xe0 ? 2 : 1;
        else if (byte >= 0x80 && this.utf8 > 0) this.utf8 -= 1;
        break;
      case 'esc':
        if (byte === 0x5b) Object.assign(this, { state: 'csi', params: '', private: false, bang: false });
        else if (byte === 0x5d || byte === 0x50 || byte === 0x5f || byte === 0x5e || byte === 0x58) this.state = 'string';
        else if (byte === 0x63) {
          this.modes = noModes();
          this.state = 'ground';
        } else if (byte < 0x20 || byte > 0x2f) this.state = 'ground';
        break;
      case 'string':
        if (byte === 0x07) this.state = 'ground';
        else if (byte === 0x1b) this.state = 'esc';
        break;
      case 'csi':
        if (byte === 0x3f && this.params === '') this.private = true;
        else if (byte >= 0x30 && byte <= 0x3b) this.params += String.fromCharCode(byte);
        else if (byte === 0x21) this.bang = true;
        else if (byte >= 0x20 && byte <= 0x2f) break;
        else if (byte >= 0x40 && byte <= 0x7e) {
          this.final(String.fromCharCode(byte));
          this.state = 'ground';
        } else this.state = 'ground';
        break;
      default:
        this.state = 'ground';
    }
  }

  final(letter) {
    const modes = this.modes;
    if (this.bang && letter === 'p') {
      // DECSTR: the cursor is shown again and the keys are the application's no more.
      modes.cursor_hidden = false;
      modes.application_cursor = false;
      return;
    }

    if (!this.private || (letter !== 'h' && letter !== 'l')) return;
    const on = letter === 'h';
    for (const text of this.params.split(';')) {
      const mode = Number(text);
      if (mode === 47 || mode === 1047 || mode === 1049) modes.alt_screen = on;
      else if (mode === 9 || mode === 1000) modes.mouse_tracking = on ? modes.mouse_tracking | 1 : modes.mouse_tracking & ~1;
      else if (mode === 1002) modes.mouse_tracking = on ? modes.mouse_tracking | 2 : modes.mouse_tracking & ~2;
      else if (mode === 1003) modes.mouse_tracking = on ? modes.mouse_tracking | 4 : modes.mouse_tracking & ~4;
      else if (mode === 1005 || mode === 1006 || mode === 1015) {
        const encoding = mode === 1005 ? 1 : mode === 1006 ? 2 : 3;
        modes.mouse_encoding = on ? encoding : modes.mouse_encoding === encoding ? 0 : modes.mouse_encoding;
      } else if (mode === 2004) modes.bracketed_paste = on;
      else if (mode === 1) modes.application_cursor = on;
      else if (mode === 1004) modes.focus_events = on;
      else if (mode === 25) modes.cursor_hidden = !on;
    }
  }
}

// ---- the ring ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * What the shell wrote: chunks with absolute offsets (a chunk closes at a boundary that is not inside an escape or a UTF-8 sequence), the size in force at each offset and the modes at the start of each chunk. When it holds more than
 * `limit` bytes the oldest chunks are overwritten, so `start` is always at a boundary, and `overwritten` counts what was lost: the output less what the ring holds.
 */
export class Ring {
  constructor(cols, rows, limit = LIMITS.channel_ring_bytes) {
    this.chunks = [];
    this.end = 0;
    this.held = 0;
    /** How many times a sequence that outgrew the budget was abandoned. */
    this.abandoned = 0;
    this.limit = limit;
    this.scanner = new Scanner();
    this.sizes = [{ offset: 0, cols, rows }];
  }

  get start() {
    return this.chunks.length === 0 ? this.end : this.chunks[0].start;
  }

  get overwritten() {
    return this.start;
  }

  record(bytes) {
    let chunk = this.chunks.at(-1);
    // A sequence that is still open when the chunk has outgrown the whole budget is abandoned: the scanner goes back to the ground state (as a terminal gives up an unterminated string of that length), so that the chunk can close at a
    // boundary and the ring can drop it. What the ring holds is then bounded whatever the shell writes, and a replay never starts inside a sequence.
    if (chunk !== undefined && chunk.length >= this.limit && !this.scanner.boundary) {
      this.scanner.state = 'ground';
      this.scanner.utf8 = 0;
      this.abandoned += 1;
    }

    if (chunk === undefined || (chunk.length >= CHUNK && this.scanner.boundary)) {
      chunk = { start: this.end, parts: [], length: 0, modes: this.scanner.clone(), flat: undefined };
      this.chunks.push(chunk);
    }

    chunk.parts.push(bytes);
    chunk.flat = undefined;
    chunk.length += bytes.length;
    this.held += bytes.length;
    this.end += bytes.length;
    this.scanner.feed(bytes);
    while (this.chunks.length > 1 && this.held > this.limit) this.held -= this.chunks.shift().length;
  }

  resize(cols, rows) {
    this.sizes.push({ offset: this.end, cols, rows });
  }

  sizeAt(offset) {
    let found = this.sizes[0];
    for (const entry of this.sizes) if (entry.offset <= offset) found = entry;
    return { cols: found.cols, rows: found.rows };
  }

  bytesOf(chunk) {
    chunk.flat ??= chunk.parts.length === 1 ? chunk.parts[0] : concat(chunk.parts);
    if (chunk.parts.length > 1) chunk.parts = [chunk.flat];
    return chunk.flat;
  }

  /** The bytes from `from` to `to` that the ring still holds, as one array. */
  read(from, to) {
    const out = [];
    for (const chunk of this.chunks) {
      const lo = Math.max(from, chunk.start);
      const hi = Math.min(to, chunk.start + chunk.length);
      if (lo < hi) out.push(this.bytesOf(chunk).subarray(lo - chunk.start, hi - chunk.start));
    }

    return out.length === 0 ? new Uint8Array(0) : concat(out);
  }

  /** The modes in force at `offset`: the scanner's state at the start of its chunk, read on to the offset. */
  modesAt(offset) {
    if (offset >= this.end) return { ...this.scanner.modes, kitty_keyboard: [...this.scanner.modes.kitty_keyboard] };
    const chunk = this.chunks.find((candidate) => offset >= candidate.start && offset < candidate.start + candidate.length) ?? this.chunks[0];
    const scanner = chunk.modes.clone();
    scanner.feed(this.read(chunk.start, offset));
    return scanner.modes;
  }

  /**
   * The ring no longer reaches back to `from` (the shell wrote more than the ring keeps while the page was away): the chunk that holds it and the ones before it are dropped, so that `start` is past it. At least one chunk stays,
   * which is the caller's to make sure of by writing past `from` first. Answers where the ring starts now.
   */
  trim(from) {
    while (this.chunks.length > 1 && this.chunks[0].start <= from) this.held -= this.chunks.shift().length;
    return this.start;
  }
}

/**
 * The number of the first numbered line (`0001234 xxx`) that a stretch of output holds whole, or null: the lines of a flood, by which a probe checks the page's copy of a stream. The last piece is a line still being written.
 * @param {Uint8Array} bytes
 */
export const firstNumbered = (bytes) => {
  const parts = new TextDecoder('latin1').decode(bytes).split('\r\n');
  parts.pop();
  for (const part of parts) {
    const found = /^(\d{7}) x/.exec(part);
    if (found !== null) return Number(found[1]);
  }

  return null;
};

/** A random capability: 32 random bytes, base64url without padding (43 characters). */
const newCapability = () => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

/** What yields to the event loop between two batches of a flood: a task of its own, never a microtask. */
const defaultDefer = (task) => {
  setTimeout(task, 0);
};

// ---- the host ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * @param {{ leaseMs?: number, ringBytes?: number, shell?: string, fail?: 'shell-unavailable' | 'start', busy?: 'unknown' | 'hang', defer?: (task: () => void) => void, faults?: Record<string, boolean> }} [options]
 *   `leaseMs` is the lease a terminal gets when its page does not say (the probe makes it short where it waits for one to run out); `ringBytes` is `channel_ring_bytes`; `fail` makes the create call fail as the host does (`shell-unavailable` is its
 *   typed 422, `start` its plain start failure); `busy` is what `ChannelTerminalBusy` answers while the shell runs (`unknown`, or no answer at all); `defer` is how a flood yields between two batches.
 */
export function createHost(options = {}) {
  const { stallMs = LIMITS.channel_stall_ms, leaseMs: defaultLease = LIMITS.lease_default_ms, ringBytes = LIMITS.channel_ring_bytes, shell = 'zsh', fail, busy: busyMode, defer = defaultDefer } = options;
  const faults = { ...options.faults };
  const limits = { ...LIMITS, channel_ring_bytes: ringBytes };
  const ptys = new Map();
  const byCap = new Map();
  /** The ends the host keeps (`kept`: by capability, in the order they ended): the output and how it ended. */
  const kept = new Map();
  const slots = new Map();
  const conns = new Set();
  /** What a probe asks of the host's records: what was called, which streams attached and to what, what the page sent and what the host applied, and what it sent. `delivered` counts every byte of output the host handed to a stream. */
  const log = {
    calls: [],
    /** What every `SaveState` call carried, in order: the window's slots are the page's own state, and a capability must never be in one. */
    saved: [],
    created: [],
    refused: [],
    closed: [],
    dismissed: [],
    busy: [],
    attaches: [],
    lists: [],
    frames: [],
    writes: [],
    writeAt: [],
    resizes: [],
    acks: [],
    detaches: [],
    taken: [],
    streams: [],
    floods: [],
    floodStarts: [],
    sizeReports: [],
    delivered: 0,
    acked: 0,
    maxUnacked: 0,
    reads: 0,
    /** How many prompts the shell has written: a probe that types a command waits for the next one before it reads the screen. */
    prompts: 0,
  };
  /** The holds a probe asks for on the `ready` of the next attach to a terminal (`holdReady`). */
  const holds = [];
  let serial = 0;
  let streamSerial = 0;
  let order = 0;

  const now = () => Date.now();
  const find = (cap) => (typeof cap === 'string' && CAPABILITY.test(cap) ? ptys.get(byCap.get(cap) ?? '') : undefined);

  // ---- the shell ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  /** The shell writes: it waits in the pty until the host reads it. */
  const out = (pty, text) => {
    if (pty.ended !== null || pty.finishing || pty.gone) return;
    if (typeof text === 'string' && text.endsWith(PROMPT)) log.prompts += 1;
    const bytes = typeof text === 'string' ? encoder.encode(text) : text;
    pty.queue.push(bytes);
    pty.waiting += bytes.length;
    // What the shell wrote in one task is read together, as one read of the pty gets what is there: a write for each frame of output would make a frame for each write.
    if (!pty.pumpScheduled) {
      pty.pumpScheduled = true;
      queueMicrotask(() => {
        pty.pumpScheduled = false;
        pump(pty);
      });
    }
  };

  const take = (pty, max) => {
    const parts = [];
    let have = 0;
    while (have < max && pty.queue.length > pty.head) {
      const first = pty.queue[pty.head];
      if (have + first.length <= max) {
        parts.push(first);
        have += first.length;
        // Consumed: the entry is let go now, and not when the queue is compacted.
        pty.queue[pty.head] = undefined;
        pty.head += 1;
      } else {
        parts.push(first.subarray(0, max - have));
        pty.queue[pty.head] = first.subarray(max - have);
        have = max;
      }
    }

    if (pty.head > 1024) {
      pty.queue.splice(0, pty.head);
      pty.head = 0;
    }

    pty.waiting -= have;
    if (parts.length === 0) return new Uint8Array(0);
    // A read that is a view of a larger write is copied: the ring keeps what it was given, and must not pin the whole allocation of a write it has mostly dropped.
    return parts.length === 1 ? parts[0].slice() : concat(parts);
  };

  const queued = (pty) => pty.queue.length - pty.head;

  /** What the holder has not been handed: the bytes the ring has that its cursor has not reached. */
  const unsent = (pty) => (pty.holder === null ? 0 : Math.max(0, pty.ring.end - pty.holder.cursor));

  /**
   * The pump: reads the shell into the ring whatever the page does. While a stream holds the terminal and more than `channel_high_bytes` wait unsent it waits (the shell blocks in its own write), until the sender has brought
   * the backlog down to `channel_low_bytes`; nobody holding the terminal, it never waits.
   */
  function pump(pty) {
    if (pty.pumping) return;
    pty.pumping = true;
    try {
      for (;;) {
        if (pty.gone) {
          clearTimeout(pty.stallTimer);
          pty.stallTimer = undefined;
          break;
        }

        const behind = unsent(pty);
        if (pty.paused ? behind > limits.channel_low_bytes : behind > limits.channel_high_bytes) {
          // The pump waits only for a page that is alive: one that made no progress (a frame the transport took, or an acknowledgement) within `channel_stall_ms` is let be, and the pump reads on (the ring overwrites, and the stream says so with a gap when it wakes).
          const idle = pty.holder === null ? Infinity : now() - pty.holder.progressAt;
          // `faults.ackLost`: the credit that comes while the pump waits is lost AND the host never gives up waiting: a host that paused never reads again.
          if (idle < stallMs || faults.ackLost) {
            pty.paused = true;
            // Under `ackLost` it waits on nothing: no timer is armed (a timer is work in a page that is at rest), the pump simply does not read again.
            if (!faults.ackLost) {
              clearTimeout(pty.stallTimer);
              pty.stallTimer = setTimeout(() => pump(pty), stallMs - idle + 1);
              pty.stallTimer.unref?.();
            }

            break;
          }
        }

        pty.paused = false;
        // Nothing waits any more: the stall wake is not needed (a timer left running would fire in a page that is at rest).
        if (pty.stallTimer !== undefined) {
          clearTimeout(pty.stallTimer);
          pty.stallTimer = undefined;
        }

        if (queued(pty) === 0) break;
        const bytes = take(pty, READ_MAX);
        pty.ring.record(bytes);
        log.reads += 1;
        if (pty.holder !== null) sendOutput(pty.holder);
      }
    } finally {
      pty.pumping = false;
    }

    if (queued(pty) === 0 && pty.finishing !== undefined && pty.holder === null) conclude(pty);
    settle(pty);
  }

  /** What waits for room in the pty and for everything written to be read and sent: the flood goes on when the host has read. */
  function settle(pty) {
    if (pty.waiting < PTY_ROOM) for (const wake of pty.room.splice(0)) wake();
    if (queued(pty) === 0 && unsent(pty) === 0) for (const wake of pty.empty.splice(0)) wake();
  }

  const stopJob = (pty) => {
    if (pty.job !== undefined) clearTimeout(pty.job.timer);
    pty.job = undefined;
  };

  /**
   * The shell is gone: what it wrote is read to the end and sent to the stream that holds the terminal, then `ended`, and the stream is closed. When the shell ended by itself the host keeps its end and its output (a kept
   * end, listed with `ended`) until it is dismissed, its lease would have run out or more than 16 ends are kept.
   */
  const finish = (pty, end) => {
    if (pty.finishing !== undefined || pty.ended !== null || pty.gone) return;
    pty.finishing = end;
    stopJob(pty);
    pty.program = undefined;
    for (const wake of pty.room.splice(0)) wake();
    pump(pty);
    if (pty.holder !== null) sendOutput(pty.holder);
  };

  /** Every byte the shell wrote has been read and sent: the end is told. */
  function conclude(pty) {
    if (pty.ended !== null || pty.gone) return;
    pty.ended = { ...pty.finishing, last_offset: pty.ring.end };
    const holder = pty.holder;
    pty.holder = null;
    clearTimeout(pty.lease);
    pty.lease = undefined;
    byCap.delete(pty.cap);
    ptys.delete(pty.id);
    pty.gone = true;
    // A shell that ended by itself leaves its end; one the host closed (a request, a shutdown, the lease) leaves nothing.
    if (pty.ended.reason !== 'closed') keep(pty);
    for (const go of pty.deferred.splice(0)) go();
    if (holder !== null) {
      holder.pty = null;
      deliver(holder, jsonFrame(FRAME.ended, pty.ended));
      shut(holder);
    }

    endWatchers(pty);
  }

  function keep(pty) {
    const entry = { id: pty.id, info: pty.info(), end: pty.ended, ring: pty.ring, createdAt: pty.createdAt, pid: pty.pid, size: { cols: pty.cols, rows: pty.rows }, leaseMs: pty.leaseMs, expires: now() + pty.leaseMs, timer: undefined };
    entry.timer = setTimeout(() => forgetEnd(pty.cap), pty.leaseMs);
    entry.timer.unref?.();
    kept.set(pty.cap, entry);
    // More than KEPT_ENDS ends are kept: the oldest goes first.
    while (kept.size > KEPT_ENDS) forgetEnd(kept.keys().next().value);
  }

  function forgetEnd(cap) {
    const entry = kept.get(cap);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    kept.delete(cap);
  }

  const exit = (pty, code) => finish(pty, { reason: 'exited', ...(faults.exitCodeLost ? {} : { exit_code: code }) });

  const flood = (pty, lines, width) => {
    const perEvent = Math.max(1, Math.floor(1000 / (width + 2)));
    let next = 0;
    let bytes = 0;
    log.floodStarts.push({ id: pty.id, at: now() });
    const step = () => {
      if (ptys.get(pty.id) !== pty || pty.ended !== null || pty.finishing) return;
      for (let batch = 0; batch < 40 && next < lines && pty.waiting < PTY_ROOM; batch += 1) {
        const count = Math.min(perEvent, lines - next);
        let text = '';
        for (let at = 0; at < count; at += 1) text += `${String(next + at).padStart(7, '0')} ${'x'.repeat(Math.max(0, width - 8))}\r\n`;
        bytes += text.length;
        next += count;
        out(pty, text);
      }

      if (next < lines) {
        if (pty.waiting >= PTY_ROOM) pty.room.push(() => defer(step));
        else defer(step);
        return;
      }

      out(pty, PROMPT);
      // A flood ends when everything it wrote was read and handed to the page that holds the terminal.
      const ended = () => {
        log.floods.push({ id: pty.id, lines, bytes });
      };

      if (queued(pty) === 0 && unsent(pty) === 0) ended();
      else pty.empty.push(ended);
    };

    step();
  };

  /** `events` numbered events of 1,000 bytes written in one task (a build that prints a great deal in a session that is not shown): the host reads what is under its mark in that task and the rest waits in the pty. */
  const burst = (pty, events) => {
    const before = log.delivered;
    for (let k = 0; k < events; k += 1) out(pty, `${String(k).padStart(7, '0')} ${'x'.repeat(70)}\r\n${`${'x'.repeat(78)}\r\n`.repeat(11)}${'y'.repeat(38)}\r\n`);
    pump(pty);
    return { delivered: log.delivered - before, paused: pty.paused, waiting: pty.waiting };
  };

  const frame = (pty) => {
    pty.program.frame += 1;
    const { rows, cols } = pty;
    let text = '\u001b[2J';
    text += `\u001b[1;1HFULLSCREEN frame ${String(pty.program.frame)} size ${String(rows)}x${String(cols)}`;
    for (let row = 2; row <= Math.min(rows, 6); row += 1) text += `\u001b[${String(row)};1Hrow ${String(row)} of the full-screen program`;
    out(pty, text);
  };

  const FULLSCREEN_ON = '\u001b[?1049h\u001b[?1000h\u001b[?1006h\u001b[?2004h\u001b[?1h\u001b[?1004h\u001b[?25l';
  const FULLSCREEN_OFF = '\u001b[?25h\u001b[?1004l\u001b[?1l\u001b[?2004l\u001b[?1006l\u001b[?1000l\u001b[?1049l';

  const run = (pty, command) => {
    const [word = '', ...args] = command.trim().split(/\s+/);
    switch (word) {
      case '':
        break;
      case 'hello':
        out(pty, 'hello from the synthetic shell\r\n');
        break;
      case 'size':
        log.sizeReports.push({ rows: pty.rows, cols: pty.ptyCols });
        out(pty, `${String(pty.rows)} ${String(pty.ptyCols)}\r\n`);
        break;
      case 'colors': {
        const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
        for (const base of [30, 90]) out(pty, `${names.map((name, index) => `\u001b[${String(base + index)}m${name.padEnd(8)}\u001b[0m`).join(' ')}\r\n`);
        out(pty, '\u001b[1mbold\u001b[0m \u001b[2mdim\u001b[0m \u001b[3mitalic\u001b[0m \u001b[4munderline\u001b[0m \u001b[7minverse\u001b[0m\r\n');
        break;
      }

      case 'known':
        out(pty, `${(faults.knownShort ? KNOWN.slice(0, 4) : KNOWN).join('\r\n')}\r\n`);
        break;
      case 'dense': {
        // N lines (5,200 by default) of K occurrences (6) of one word each, more matches than the highest count a find shows; `faults.capShort` writes a thousand lines, which is fewer.
        const count = faults.capShort ? 1000 : Number(args[0] ?? 5200);
        const each = Number(args[1] ?? 6);
        out(pty, Array.from({ length: count }, (_, line) => `${String(line).padStart(5, '0')} ${'needle '.repeat(each).trimEnd()}\r\n`).join(''));
        break;
      }

      case 'urls':
        out(pty, `${URLS.join('\r\n')}\r\n`);
        break;
      case 'mouse-on':
        // A program that asks for the mouse: every button, in the encoding that says the button in plain text. `faults.mouseNever`: the shell never asks.
        if (!faults.mouseNever) out(pty, '\u001b[?1000h\u001b[?1006h');
        break;
      case 'mouse-off':
        out(pty, '\u001b[?1000l\u001b[?1006l');
        break;
      case 'flood':
        flood(pty, Number(args[0] ?? 1000), Number(args[1] ?? 80));
        return;
      case 'sleep': {
        const seconds = Number(args[0]);
        if (!(seconds >= 0)) {
          out(pty, 'sleep: invalid time interval\r\n');
          break;
        }

        // The program holds the foreground; the shell gives its prompt back when it ends.
        pty.job = {
          name: 'sleep',
          timer: setTimeout(() => {
            pty.job = undefined;
            out(pty, PROMPT);
          }, seconds * 1000),
        };
        return;
      }

      case 'fullscreen':
        pty.program = { name: 'fullscreen', frame: 0 };
        out(pty, FULLSCREEN_ON);
        frame(pty);
        return;
      case 'query':
        out(pty, 'asking: \u001b[6n\u001b[c done\r\n');
        break;
      case 'exit':
        out(pty, 'logout\r\n');
        exit(pty, Number(args[0] ?? 0));
        return;
      case 'kill':
        finish(pty, { reason: 'signaled', ...(faults.signalLost ? {} : { signal: 'SIGKILL', signal_number: 9 }) });
        return;
      case 'segv':
        finish(pty, { reason: 'signaled', ...(faults.signalLost ? {} : { signal: 'SIGSEGV', signal_number: 11, core_dumped: true }) });
        return;
      case 'quit':
        finish(pty, { reason: 'closed', ...(faults.closedLost ? {} : { closed_by: 'shutdown' }) });
        return;
      case 'orphan':
        out(pty, 'logout\r\n');
        finish(pty, { reason: 'exited', ...(faults.exitCodeLost ? {} : { exit_code: 0 }), drain_capped: true, dropped_bytes: 4096 });
        return;
      case 'fail':
        finish(pty, { reason: 'failed', failure: { stage: 'read', message: 'The shell stopped answering' } });
        return;
      default:
        out(pty, `synthetic: command not found: ${word}\r\n`);
    }

    out(pty, PROMPT);
  };

  /** What the user typed, as the pty's line discipline takes it: echo, backspace, interrupt, a line at Enter. A full-screen program takes the keys itself (`q` leaves it). While a program holds the foreground only the interrupt reaches anything. */
  const typed = (pty, data) => {
    if (pty.program !== undefined) {
      if (data.includes('q')) {
        pty.program = undefined;
        out(pty, `${FULLSCREEN_OFF}\r\n${PROMPT}`);
      }

      return;
    }

    for (const ch of data.replace(/\u001b\[[0-9;?<>]*[A-Za-z~]/g, '').replace(/\u001bO[A-Z]/g, '').replace(/\u001b/g, '')) {
      if (pty.ended !== null || pty.finishing || pty.gone) return;
      if (ch === '\u0003') {
        pty.line = '';
        stopJob(pty);
        out(pty, `^C\r\n${PROMPT}`);
      } else if (pty.job !== undefined) continue;
      else if (ch === '\r') {
        out(pty, '\r\n');
        const line = pty.line;
        pty.line = '';
        run(pty, line);
      } else if (ch === '\u007f') {
        if (pty.line !== '') {
          pty.line = pty.line.slice(0, -1);
          out(pty, '\b \b');
        }
      } else if (ch >= ' ') {
        pty.line += ch;
        out(pty, ch);
      }
    }
  };

  // ---- the streams -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  /** Hands a frame to the page of a stream. A stream that is over is handed nothing. */
  function deliver(conn, bytes) {
    if (conn.over) return;
    conn.deliver(bytes);
  }

  /** The stream is over: the host's own close, after the frames it owed. The page is told with the close of its transport. */
  function shut(conn) {
    if (conn.over) return;
    conn.over = true;
    conns.delete(conn);
    if (conn.watched !== null) conn.watched.watchers = conn.watched.watchers.filter((other) => other !== conn);
    conn.watched = null;
    if (conn.pty !== null && conn.pty.holder === conn) release(conn.pty);
    conn.onClosed();
  }

  /** The streams that watch a terminal are told one frame and closed (`released`: the terminal runs and is free; `ended`: it ended), once. */
  function tellWatchers(pty, frame) {
    for (const watcher of pty.watchers.splice(0)) {
      watcher.watched = null;
      deliver(watcher, frame);
      shut(watcher);
    }
  }

  // `faults.releasedNever`: the host loses the fact that the terminal is free, and the watchers are left as they were, open, told nothing.
  const freeWatchers = (pty) => {
    if (!faults.releasedNever) tellWatchers(pty, new Uint8Array([FRAME.released]));
  };

  const endWatchers = (pty) => tellWatchers(pty, jsonFrame(FRAME.ended, pty.ended));

  /** A terminal that is gone with no word: its watchers are closed with no frame. */
  function dropWatchers(pty) {
    for (const watcher of pty.watchers.splice(0)) {
      watcher.watched = null;
      shut(watcher);
    }
  }

  /** Nobody holds the terminal: its lease runs, and what the shell writes goes into the ring with nobody to wait for. */
  function release(pty) {
    pty.holder = null;
    pty.paused = false;
    // The holder's stream ended while the terminal runs: it is free, and the streams that watch it are told, once. A terminal whose end is decided is never free: its watchers are told how it ended.
    if (pty.ended === null && !pty.gone && pty.finishing === undefined) {
      startLease(pty);
      freeWatchers(pty);
    }

    pump(pty);
  }

  function startLease(pty) {
    clearTimeout(pty.lease);
    pty.leaseExpires = now() + pty.leaseMs;
    pty.lease = setTimeout(() => expire(pty), pty.leaseMs);
    pty.lease.unref?.();
  }

  /** The lease ran out and no stream took the terminal: it ends as a close does (SIGHUP, then SIGKILL), and nobody is told. */
  function expire(pty) {
    if (pty.holder !== null || ptys.get(pty.id) !== pty || faults.leaseNever) return;
    pty.lease = undefined;
    closeTerminal(pty, 'detach-timeout');
  }

  /** A terminal the host closed leaves nothing: its capability opens nothing. The stream that holds it, if any, is sent what it was owed and the end, and closed. */
  function closeTerminal(pty, by) {
    if (pty.gone) return;
    // The close decides how the terminal ends: what a shell that was ending by itself still owed is flushed, and the natural end is not told.
    pty.closing = true;
    stopJob(pty);
    clearTimeout(pty.lease);
    while (queued(pty) > 0) pty.ring.record(take(pty, READ_MAX));
    const holder = pty.holder;
    if (holder !== null) sendOutput(holder, true);
    pty.gone = true;
    pty.ended = { reason: 'closed', closed_by: by, last_offset: pty.ring.end };
    ptys.delete(pty.id);
    byCap.delete(pty.cap);
    pty.holder = null;
    for (const wake of [...pty.room.splice(0), ...pty.empty.splice(0)]) wake();
    for (const go of pty.deferred.splice(0)) go();
    if (holder !== null) {
      holder.pty = null;
      deliver(holder, jsonFrame(FRAME.ended, pty.ended));
      shut(holder);
    }

    endWatchers(pty);
  }

  /**
   * The sender of one stream: what the ring has that the stream's cursor has not reached, in frames of at most `channel_frame_bytes` and, once the page has acknowledged (its window is on), at most the credit that is left of
   * `channel_inflight_bytes`; a frame never straddles the end of the replay; what the ring overwrote meanwhile is one `gap`. `flush` sends the end of a terminal that is closing whatever the window says.
   */
  function sendOutput(conn, flush = false) {
    const pty = conn.pty;
    if (pty === null || conn.over || conn.displaced || pty.holder !== conn || conn.held || conn.sending) return;
    conn.sending = true;
    try {
      const ring = pty.ring;
      for (;;) {
        if (conn.cursor < ring.start) {
          const to = ring.start;
          deliver(conn, gapFrame(conn.cursor, to));
          if (to >= conn.replayEnd) conn.replayEnd = 0;
          conn.cursor = to;
          continue;
        }

        if (conn.cursor >= ring.end) break;
        let n = Math.min(limits.channel_frame_bytes, ring.end - conn.cursor);
        if (conn.cursor < conn.replayEnd) n = Math.min(n, conn.replayEnd - conn.cursor);
        if (conn.explicit && !flush) {
          const credit = limits.channel_inflight_bytes - Math.min(conn.begun - conn.acked, limits.channel_inflight_bytes);
          if (credit <= 0) break;
          n = Math.min(n, credit);
        }

        const bytes = ring.read(conn.cursor, conn.cursor + n);
        // Counted before the frame is handed over: the page can acknowledge it before the hand-over returns.
        conn.begun += n;
        conn.progressAt = now();
        conn.progressAt = now();
        pty.unacked = conn.begun - conn.acked;
        if (conn.explicit) log.maxUnacked = Math.max(log.maxUnacked, conn.begun - conn.acked);
        conn.cursor += n;
        log.delivered += n;
        deliver(conn, outputFrame(conn.cursor - n, bytes));
      }
    } finally {
      conn.sending = false;
    }

    // The shell ended by itself and the stream that holds it has been handed every byte: the end is told.
    if (pty.finishing !== undefined && !pty.closing && !pty.gone && queued(pty) === 0 && conn.cursor >= pty.ring.end) {
      conclude(pty);
      return;
    }

    pump(pty);
  }

  /** The stream broke the protocol: it is closed with no answer once it has attached, and the terminal is detached as for any end of a stream. */
  function protocolError(conn, why) {
    log.frames.push({ stream: conn.id, kind: 'refused', why, at: now() });
    shut(conn);
  }

  /** The one answer of a stream that opens nothing, byte for byte the same whatever the reason. */
  function refuse(conn, why) {
    log.attaches.push({ stream: conn.id, id: null, from_offset: null, outcome: 'not-found', why, at: now() });
    deliver(conn, new Uint8Array([FRAME.notFound]));
    shut(conn);
  }

  function parseAttach(bytes) {
    if (bytes.length < 2 || bytes.length > MAX_ATTACH || bytes[0] !== FRAME.attach) return undefined;
    try {
      const request = JSON.parse(decoder.decode(bytes.subarray(1)));
      // A request that states no version (or 0) is malformed; another version is well formed and is answered `unsupported`, decided before any capability is looked at.
      if (typeof request !== 'object' || request === null || !Number.isSafeInteger(request.v) || request.v === 0 || typeof request.cap !== 'string' || request.cap === '') return undefined;
      const from = request.from_offset;
      if (from !== undefined && from !== null && (!Number.isSafeInteger(from) || from < 0)) return undefined;
      return { cap: request.cap, from: from ?? undefined, v: request.v };
    } catch {
      return undefined;
    }
  }

  const modesNow = (pty) => (faults.modesLost ? noModes() : pty.ring.modesAt(pty.ring.end));

  /** The first frame of a stream: the capability opens a terminal that runs, the kept end of one, or nothing. */
  function attach(conn, bytes) {
    const request = parseAttach(bytes);
    if (request === undefined) {
      refuse(conn, 'malformed');
      return;
    }

    if (request.v !== VERSION) {
      log.attaches.push({ stream: conn.id, id: null, from_offset: request.from ?? null, outcome: 'unsupported', v: request.v, at: now() });
      deliver(conn, jsonFrame(FRAME.unsupported, { v: VERSION }));
      shut(conn);
      return;
    }

    dispatchAttach(conn, request);
  }

  /** What a request that names a capability opens: a terminal that runs, the kept end of one, or nothing. */
  function dispatchAttach(conn, request) {
    const pty = find(request.cap);
    const end = kept.get(request.cap);
    if (pty !== undefined && !pty.finishing) {
      claim(conn, pty, request.from);
    } else if (end !== undefined) {
      serveEnded(conn, end, request.from);
    } else if (pty !== undefined) {
      // The shell is ending by itself while this stream attaches: the attach waits for the end to be decided, and then is served the kept end, or told nothing is there when a close won.
      pty.deferred.push(() => dispatchAttach(conn, request));
    } else if (faults.goneTransient) {
      log.attaches.push({ stream: conn.id, id: null, from_offset: request.from ?? null, outcome: 'closed-silent', at: now() });
      shut(conn);
    } else {
      refuse(conn, 'unknown');
    }
  }

  /** The ready of a terminal that runs, for the stream that takes it from `from`: the replay `[start, end)` and what it was written under, and what is in force at its end. */
  function readyOf(pty, conn, from) {
    const ring = pty.ring;
    const asked = from !== undefined;
    // `faults.gapHidden`: the ring no longer reaches back to where the page is, and the host says its replay starts there.
    const start = asked && from >= ring.start ? from : faults.gapHidden && asked ? from : ring.start;
    const lost = asked && from < ring.start && !faults.gapHidden ? ring.start - from : 0;
    return {
      v: VERSION,
      start,
      end: ring.end,
      lost,
      // What the host has admitted, and not only what it has written: the input the stream that held the terminal had queued is applied before anything this stream sends, so the page must not send it again.
      input_applied: pty.admitted,
      size: { cols: pty.cols, rows: pty.rows },
      start_size: ring.sizeAt(start),
      modes: modesNow(pty),
      start_modes: faults.modesLost ? noModes() : ring.modesAt(Math.max(start, ring.start)),
      cwd: { path: '/home/user' },
      busy: busyOf(pty),
      session: pty.info(),
      lease_ms: pty.leaseMs,
      ended: null,
    };
  }

  /**
   * One step under one lock in the real host, one task here: the stream takes the terminal. The stream that held it is sent `taken-over` and stays as a watcher, and from now on cannot type. A `from_offset` past the end of the output is not this terminal's:
   * the stream closes with no answer.
   */
  function claim(conn, pty, from) {
    if (from !== undefined && from > pty.ring.end) {
      log.attaches.push({ stream: conn.id, id: pty.id, from_offset: from, outcome: 'bad-offset', at: now() });
      shut(conn);
      return;
    }

    const previous = pty.holder;
    if (previous !== null) {
      previous.displaced = true;
      log.taken.push({ id: pty.id, from: previous.id, by: conn.id, at: now() });
      if (!faults.noTakenOver) {
        // The stream stays open as a watcher: it is sent no output and nothing it sends counts, and it is told `released` or `ended` and closed. At most four watch one terminal: the one that has watched longest is closed with no frame.
        deliver(previous, new Uint8Array([FRAME.takenOver]));
        previous.pty = null;
        previous.watched = pty;
        pty.watchers.push(previous);
        if (pty.watchers.length > WATCHERS) {
          const oldest = pty.watchers.shift();
          oldest.watched = null;
          shut(oldest);
        }
      }
    }

    clearTimeout(pty.lease);
    pty.lease = undefined;
    pty.holder = conn;
    conn.progressAt = now();
    pty.paused = false;
    conn.pty = pty;
    conn.terminal = pty.id;
    const ready = readyOf(pty, conn, from);
    conn.cursor = ready.start;
    conn.replayEnd = ready.end;
    conn.begun = 0;
    conn.acked = 0;
    conn.explicit = false;
    conn.told = ready.input_applied;
    const entry = { stream: conn.id, id: pty.id, from_offset: from ?? null, outcome: 'ready', start: ready.start, end: ready.end, lost: ready.lost, bytes: ready.end - ready.start, firstLine: firstNumbered(pty.ring.read(ready.start, Math.min(ready.end, ready.start + 800))), at: now(), writesAt: log.writes.length, framesAt: log.frames.length, order: (order += 1) };
    log.attaches.push(entry);
    const hold = holds.findIndex((candidate) => candidate.id === pty.id);
    const go = () => {
      if (conn.over) return;
      // `faults.replayGap`: the replay lacks its last bytes, which the stream then skips as if they were sent.
      if (faults.replayGap) conn.cursor = Math.max(conn.cursor, ready.end - 1000);
      deliver(conn, jsonFrame(FRAME.ready, ready));
      if (faults.unmutedReply) log.writes.push({ stream: conn.id, id: pty.id, data: '\u001b[1;1R', at: now() });
      conn.held = false;
      sendOutput(conn);
    };

    if (hold === -1) {
      go();
    } else {
      // The probe holds the ready: the host has taken the terminal over, and the page that attached waits for its answer.
      const [held] = holds.splice(hold, 1);
      conn.held = true;
      held.held = true;
      held.go = () => {
        held.held = false;
        go();
      };
    }

    pump(pty);
  }

  /** The kept end of a terminal: the ready (it says how it ended), what it wrote from the offset the page has, the end again, and the stream closes. Nobody holds a terminal that has ended and nothing is read from the page. */
  function serveEnded(conn, entry, from) {
    const ring = entry.ring;
    if (from !== undefined && from > ring.end) {
      log.attaches.push({ stream: conn.id, id: entry.id, from_offset: from, outcome: 'bad-offset', at: now() });
      shut(conn);
      return;
    }

    const asked = from !== undefined;
    const start = asked && from >= ring.start ? from : ring.start;
    const ready = { v: VERSION, start, end: ring.end, lost: asked && from < ring.start ? ring.start - from : 0, input_applied: 0, size: entry.size, start_size: ring.sizeAt(start), modes: ring.modesAt(ring.end), start_modes: ring.modesAt(Math.max(start, ring.start)), cwd: { reason: 'ended' }, busy: { state: 'unknown', reason: 'ended' }, session: entry.info, lease_ms: 0, ended: entry.end };
    log.attaches.push({ stream: conn.id, id: entry.id, from_offset: from ?? null, outcome: 'ended', start, end: ring.end, lost: ready.lost, bytes: ring.end - start, at: now(), writesAt: log.writes.length, framesAt: log.frames.length, order: (order += 1) });
    deliver(conn, jsonFrame(FRAME.ready, ready));
    for (let at = start; at < ring.end; ) {
      const to = Math.min(ring.end, at + limits.channel_frame_bytes);
      deliver(conn, outputFrame(at, ring.read(at, to)));
      at = to;
    }

    deliver(conn, jsonFrame(FRAME.ended, entry.end));
    shut(conn);
  }

  /** The stream that holds the terminal is told how much input the host has applied, when that is more than it was told (its `ready` included): never a number that goes down or repeats, and a watcher is told nothing. */
  function tellApplied(pty) {
    const holder = pty.holder;
    if (holder === null || holder.over || holder.displaced || holder.held || pty.applied <= holder.told) return;
    holder.told = pty.applied;
    deliver(holder, appliedFrame(pty.applied));
  }

  /** What a frame of an attached stream does. Frames of one stream are applied in order, one at a time; those of a stream that does not hold the terminal are refused. */
  function frameOf(conn, bytes) {
    const pty = conn.pty;
    const type = bytes[0];
    const entry = { stream: conn.id, id: conn.terminal ?? null, kind: undefined, bytes: bytes.length - 1, at: now(), appliedAt: null, application: null, outcome: 'received' };
    log.frames.push(entry);
    const typing = pty !== null && pty.holder === conn && !conn.displaced;
    switch (type) {
      case FRAME.input: {
        entry.kind = 'write';
        if (bytes.length - 1 > limits.channel_max_input_bytes) return protocolError(conn, 'input too long');
        if (bytes.length === 1) {
          entry.outcome = 'applied';
          return undefined;
        }

        if (!typing) {
          entry.outcome = 'refused';
          return undefined;
        }

        // Admitted: from here it is applied, and counted, whoever holds the terminal when its turn comes (what a displaced stream had admitted is applied before anything the new holder sends).
        const size = bytes.length - 1;
        pty.admitted += size;
        const apply = () => {
          const text = decoder.decode(bytes.subarray(1));
          log.writes.push({ stream: conn.id, id: pty.id, data: text, at: now() });
          log.writeAt.push(performance.now());
          typed(pty, text);
          pty.applied += size;
          tellApplied(pty);
        };

        applyFrame(entry, apply, () => !pty.gone, conn);
        return undefined;
      }

      case FRAME.resize: {
        entry.kind = 'resize';
        if (bytes.length !== 5) return protocolError(conn, 'resize size');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const cols = view.getUint16(1);
        const rows = view.getUint16(3);
        if (cols < 1 || rows < 1 || cols > limits.max_dimension || rows > limits.max_dimension) return protocolError(conn, 'resize range');
        if (!typing) {
          entry.outcome = 'refused';
          return undefined;
        }

        applyFrame(entry, () => {
          log.resizes.push({ stream: conn.id, id: pty.id, rows, cols, at: performance.now() });
          // `faults.resizeIgnored`: the host takes the frame and the pty keeps its size.
          if (faults.resizeIgnored) return 'ignored';
          // A program that is given the size it has draws nothing (vim does not): only a change makes it draw again.
          const changed = pty.rows !== rows || pty.cols !== cols;
          pty.rows = rows;
          pty.cols = cols;
          pty.ptyCols = faults.sizeOff ? cols + 1 : cols;
          pty.ring.resize(cols, rows);
          if (changed && pty.program !== undefined) frame(pty);
        }, () => pty.holder === conn && !conn.displaced, conn);
        return undefined;
      }

      case FRAME.ack: {
        entry.kind = 'ack';
        if (bytes.length !== 5) return protocolError(conn, 'ack size');
        const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
        entry.n = n;
        log.acks.push({ stream: conn.id, id: conn.terminal ?? null, bytes: n, attachesAt: log.attaches.length, at: now() });
        // An acknowledgement of a stream that does not hold the terminal counts for nothing (`faults.acksStale`: the host credits it to whoever holds the terminal now).
        const target = typing ? conn : faults.acksStale && conn.terminal !== undefined ? ptys.get(conn.terminal)?.holder : undefined;
        if (target === undefined || target === null || target.pty === null) {
          entry.outcome = 'refused';
          return undefined;
        }

        const credit = () => {
          entry.outcome = 'applied';
          // `faults.ackLost`: the credit that comes while the host's pump waits is lost, so a page that waited never gets the rest.
          if (faults.ackLost && target.pty !== null && target.pty.paused) return;
          if (target.pty === null) return;
          target.explicit = true;
          target.acked = Math.min(target.acked + n, target.begun);
          target.progressAt = now();
          log.acked += n;
          target.pty.unacked = target.begun - target.acked;
          const held = target.pty;
          sendOutput(target);
          pump(held);
        };

        // The frames of one stream are applied in order, one at a time: an acknowledgement behind an input that is held waits for it, as the real host reads it only once the input operation is done. Other streams go on.
        if (lag.queue !== undefined && lag.conns.has(conn)) {
          entry.outcome = 'held';
          lag.queue.push(credit);
        } else {
          credit();
        }

        return undefined;
      }

      case FRAME.detach:
        entry.kind = 'detach';
        if (bytes.length !== 1) return protocolError(conn, 'detach size');
        entry.outcome = 'applied';
        log.detaches.push({ stream: conn.id, id: conn.terminal ?? null, at: now() });
        shut(conn);
        return undefined;
      default:
        return protocolError(conn, `type ${String(type)}`);
    }
  }

  /**
   * Applies what a frame does to the shell at once, in the order the frames came, and records it. `lag` (a probe's `slow`) makes the host slow to apply the frames: the ones behind it wait, in order. `holds` says whether the stream
   * that sent the frame still holds the terminal when the frame is applied: a frame that waited and lost its right meanwhile (another stream took the terminal) is refused, as the real host refuses it.
   */
  function applyFrame(entry, apply, holds, conn) {
    const done = () => {
      if (!holds()) {
        entry.outcome = 'refused';
        return;
      }

      const result = apply();
      entry.appliedAt = performance.now();
      entry.application = (order += 1);
      entry.outcome = result ?? 'applied';
    };

    if (lag.queue !== undefined) {
      lag.queue.push(done);
      lag.conns.add(conn);
      return;
    }

    if (lag.next > 0) {
      lag.next -= 1;
      // Each hold is its own: its release drains its own queue once, and cancels its own timer.
      const queue = [done];
      let timer;
      const release_ = () => {
        clearTimeout(timer);
        if (lag.queue !== queue) return;
        lag.queue = undefined;
        lag.release = undefined;
        lag.conns = new Set();
        for (const task of queue) task();
      };

      lag.queue = queue;
      lag.conns = new Set([conn]);
      lag.release = release_;
      timer = lag.ms === Infinity ? undefined : setTimeout(release_, lag.ms);
      lag.timer = timer;
      return;
    }

    done();
  }

  /** The host is slow to apply the next `next` frames of any stream, for `ms` milliseconds: the frames behind them wait, in the order they came. */
  const lag = { conns: new Set(), next: 0, ms: 0, queue: undefined, release: undefined, timer: undefined };

  /**
   * Opens a stream. `deliver` takes each frame the host sends, in order; `onClosed` is called once, when the stream is over however it ended. Answers `{ id, send(frame), close() }`: `send` is a frame of the page, in order, and `close` is the page
   * (or its transport) going away.
   */
  function openStream(deliver_, onClosed = () => undefined) {
    streamSerial += 1;
    const conn = { progressAt: 0, id: streamSerial, deliver: deliver_, onClosed, over: false, pty: null, terminal: undefined, cursor: 0, replayEnd: 0, begun: 0, acked: 0, explicit: false, displaced: false, held: false, sending: false, attached: false, watched: null, told: 0 };
    conns.add(conn);
    log.streams.push({ id: conn.id, at: now() });
    return {
      id: conn.id,
      send: (frame) => {
        // `faults.acksStale`: an acknowledgement that was in flight when its stream was replaced still reaches the host, which credits it to whoever holds the terminal now.
        if (conn.over) {
          if (faults.acksStale && frame[0] === FRAME.ack) frameOf(conn, frame instanceof Uint8Array ? frame : new Uint8Array(frame));
          return;
        }

        const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
        if (!conn.attached) {
          conn.attached = true;
          attach(conn, bytes);
          return;
        }

        // A frame that is not the page's, a second attach, one too short or too long for its type: the stream closes, with no answer.
        if (bytes.length === 0 || bytes[0] >= 0x80 || bytes[0] === FRAME.attach) {
          protocolError(conn, bytes[0] === FRAME.attach ? 'second attach' : 'type');
          return;
        }

        frameOf(conn, bytes);
      },
      close: () => {
        if (conn.over) return;
        log.frames.push({ stream: conn.id, kind: 'close', at: now() });
        shut(conn);
      },
    };
  }

  // ---- the calls -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  /** What `terminal.Session` says, without the capability. */
  const infoOf = (pty) => ({
    id: pty.id,
    created_at: pty.createdAt,
    pid: pty.pid,
    shell: { path: `/bin/${shell}`, name: faults.noShellName ? '' : shell },
    cwd: '/home/user',
    cols: pty.cols,
    rows: pty.rows,
    environment: { source: 'launch', probe: { state: 'ok' } },
    limits,
    lease_ms: pty.leaseMs,
  });

  const create = (options_, launch = {}) => {
    if (fail === 'shell-unavailable') {
      log.refused.push(options_.id);
      throw refusal('omniview:terminal/shell-unavailable', 'Shell not found', 422, faults.codeLess ? undefined : 'SHELL_UNAVAILABLE', 'shell executable unavailable: tried the shell asked for "/bin/zsh": not found; $SHELL "/opt/none/zsh": not found; /bin/bash: not found; /bin/sh: not found');
    }

    if (fail === 'start') {
      log.refused.push(options_.id);
      throw refusal('omniview:terminal/start-failed', 'Terminal failed to start', 500, faults.startTyped ? 'SHELL_UNAVAILABLE' : 'START_FAILED', 'failed to start the terminal: the pty could not be opened');
    }

    if (launch.channel !== true) throw invalid('channel', 'a terminal of this host is made with launch.channel');
    if (ptys.has(options_.id)) throw refusal('omniview:resource/conflict', 'Already exists', 409, 'ALREADY_EXISTS', `A terminal session with id "${options_.id}" exists.`);
    const lease = launch.lease_ms ?? 0;
    if (typeof lease !== 'number' || lease < 0 || lease > LIMITS.lease_max_ms) throw invalid('lease_ms', 'a lease is 0 to 1,800,000 ms');
    const cols = launch.cols ?? 80;
    const rows = launch.rows ?? 24;
    if (!(cols >= 1 && cols <= 1000 && rows >= 1 && rows <= 1000)) throw invalid('cols', 'a size is 1 to 1,000 cells');
    serial += 1;
    const cap = newCapability();
    // `faults.sizeOff`: the pty is one column wider than it was asked to be, and says nothing of it: the host's own records (the session, the ready) keep the size that was asked, so that only what the shell reports is wrong.
    const wide = faults.sizeOff ? cols + 1 : cols;
    const pty = {
      id: options_.id,
      cap,
      holder: null,
      createdAt: new Date().toISOString(),
      pid: 4242 + serial,
      leaseMs: lease === 0 ? defaultLease : lease,
      lease: undefined,
      leaseExpires: 0,
      cols,
      ptyCols: wide,
      rows,
      ring: new Ring(cols, rows, ringBytes),
      queue: [],
      head: 0,
      waiting: 0,
      unacked: 0,
      /** Version 2: the bytes of input the host has admitted (applied, or queued ahead of the applied) and the bytes it has written to the shell, across streams; the streams that were displaced and wait (`watchers`, at most four). */
      admitted: 0,
      applied: 0,
      watchers: [],
      paused: false,
      pumping: false,
      room: [],
      empty: [],
      line: '',
      job: undefined,
      program: undefined,
      finishing: undefined,
      ended: null,
      gone: false,
      deferred: [],
      info: () => infoOf(pty),
    };
    ptys.set(pty.id, pty);
    byCap.set(cap, pty.id);
    // A new terminal is on its lease from the moment it is made: a page that dies before it opens the stream leaves no shell behind.
    startLease(pty);
    log.created.push({ id: pty.id, cap, lease_ms: lease, cols, rows });
    log.resizes.push({ stream: 0, id: pty.id, rows, cols, at: performance.now() });
    defer(() => out(pty, BANNER));
    return { ...infoOf(pty), cap };
  };

  const busyOf = (pty) => {
    if (busyMode === 'unknown') return faults.unknownIdle ? { state: 'idle' } : { state: 'unknown', reason: 'query-failed' };
    if (faults.busyAlways) return { state: 'busy', pgid: 4242, name: 'sleep' };
    if (pty.program !== undefined) return { state: 'busy', pgid: 4242, name: pty.program.name };
    if (pty.job === undefined) return { state: 'idle' };
    return faults.busyNameless ? { state: 'busy', pgid: 4242 } : { state: 'busy', pgid: 4242, name: pty.job.name };
  };

  const listed = (pty) => ({
    id: pty.id,
    created_at: pty.createdAt,
    pid: pty.pid,
    shell: { path: `/bin/${shell}`, name: shell },
    labels: {},
    params: {},
    size: { cols: pty.cols, rows: pty.rows },
    // `faults.attachedHidden`: the list always says that no stream holds a terminal.
    attached: !faults.attachedHidden && pty.holder !== null,
    next_offset: pty.ring.end,
    replay_start: pty.ring.start,
    lease_expires_unix_ms: pty.holder === null ? pty.leaseExpires : 0,
  });

  /** What a restart took away, which `faults.listGhost` goes on listing: a host that lists a terminal it no longer has. */
  const ghosts = new Map();

  const list = (caps) => {
    if (!Array.isArray(caps) || caps.length > 1024) throw invalid('capabilities', 'at most 1,024 capabilities');
    const answer = [];
    for (const cap of caps) {
      const pty = find(cap);
      const end = kept.get(cap);
      if (pty !== undefined) answer.push(listed(pty));
      else if (end !== undefined) {
        answer.push({ id: end.id, created_at: end.createdAt, pid: end.pid, shell: { path: `/bin/${shell}`, name: shell }, labels: {}, params: {}, size: end.size, attached: false, next_offset: end.ring.end, replay_start: end.ring.start, lease_expires_unix_ms: end.expires, ...(faults.tombstoneUnmarked ? {} : { ended: end.end }) });
      } else if (faults.listGhost && ghosts.has(cap)) answer.push(ghosts.get(cap));
    }

    return answer;
  };

  const dispatch = async (method, args) => {
    switch (method) {
      case 'CreateTerminal':
        return create(args[0], args[1]);
      case 'CloseChannelTerminal': {
        const pty = find(args[0]);
        if (pty === undefined) throw gone();
        log.closed.push(pty.id);
        closeTerminal(pty, 'request');
        return undefined;
      }

      case 'DismissChannelTerminal': {
        const end = kept.get(args[0]);
        if (end !== undefined) {
          log.dismissed.push(end.id);
          forgetEnd(args[0]);
          return undefined;
        }

        // A terminal that is alive is closed, not dismissed.
        const pty = find(args[0]);
        if (pty === undefined) throw gone();
        log.closed.push(pty.id);
        closeTerminal(pty, 'request');
        return undefined;
      }

      case 'ChannelTerminalBusy': {
        const pty = find(args[0]);
        log.busy.push({ id: pty?.id ?? null, at: performance.now() });
        if (busyMode === 'hang') return new Promise(() => undefined);
        if (pty === undefined) throw gone();
        return busyOf(pty);
      }

      case 'ChannelTerminalCwd': {
        const pty = find(args[0]);
        if (pty === undefined) throw gone();
        return { path: '/home/user' };
      }

      case 'ListChannelTerminals': {
        const answer = list(args[0]);
        log.lists.push({ asked: args[0].length, listed: answer.map((item) => ({ id: item.id, attached: item.attached, ended: item.ended !== undefined })) });
        return answer;
      }

      case 'GetState':
        return { ...slots.get(args[0]) };
      case 'SaveState':
        log.saved.push({ slot: args[1], text: String(args[2]) });
        slots.set(args[0], { ...slots.get(args[0]), [args[1]]: args[2] });
        return undefined;
      default:
        throw refusal('omniview:resource/invalid-request', 'Unknown call', 400, 'INVALID_REQUEST', `${method} is not a call of the fixture's host`);
    }
  };

  /** A client call, as a page makes it: the log keeps what was asked and what became of it. A capability is never kept in the log. */
  const call = async (method, args) => {
    const entry = { method, at: now(), outcome: undefined };
    log.calls.push(entry);
    try {
      const answer = await dispatch(method, args);
      entry.outcome = 'ok';
      return answer;
    } catch (error) {
      entry.outcome = 'refused';
      throw error;
    }
  };

  const ptyOf = (id) => {
    const pty = ptys.get(id);
    if (pty === undefined) throw new Error(`no terminal ${id}`);
    return pty;
  };

  return {
    LIMITS: limits,
    log,
    faults,
    call,
    openStream,
    /** The streams that are open now, and which terminal each holds. */
    streams: () => [...conns].map((conn) => ({ id: conn.id, terminal: conn.pty?.id ?? null, holder: conn.pty !== null && conn.pty.holder === conn })),
    /**
     * The `ready` of the NEXT attach to the terminal `id` is held until `release` is called: the host takes the terminal over at once, as it does, and the page that attached goes on waiting for its answer (it is reattaching). `held()` says
     * whether the attach has arrived and its answer is being held. The hold is for one attach.
     */
    holdReady: (id) => {
      const hold = { id, held: false, go: () => undefined };
      holds.push(hold);
      return { held: () => hold.held, release: () => hold.go() };
    },
    /** The host is slow to apply the next `calls` frames for `ms` milliseconds (`Infinity` is until `release()`); the frames behind them wait, in order. */
    slow: (calls, ms) => {
      lag.next = calls;
      lag.ms = ms;
    },
    release: () => lag.release?.(),
    /** The probe: the shell writes while no page is there, or while one is. */
    append: (id, text) => {
      const pty = ptyOf(id);
      out(pty, text);
      pump(pty);
    },
    flood: (id, lines, width) => flood(ptyOf(id), lines, width),
    burst: (id, events) => burst(ptyOf(id), events),
    type: (id, text) => {
      const pty = ptyOf(id);
      typed(pty, text);
      pump(pty);
    },
    end: (id, end) => finish(ptyOf(id), end ?? { reason: 'exited', exit_code: 0 }),
    /** Another client resizes the pty (the probe's own, which no fault touches): the size in force from here on, and the ring's size log says so. */
    setSize: (id, rows, cols) => {
      const pty = ptyOf(id);
      const changed = pty.rows !== rows || pty.cols !== cols;
      pty.rows = rows;
      pty.cols = cols;
      pty.ring.resize(cols, rows);
      if (changed && pty.program !== undefined) frame(pty);
    },
    /** The connection of the stream that holds the terminal drops (a blip of the transport): the terminal is detached, its lease runs, and nobody is told. */
    drop: (id) => {
      const holder = ptys.get(id)?.holder ?? null;
      if (holder !== null) shut(holder);
    },
    /** The terminal is gone with no word: a lease that ran out, or a close by another page, while this page was away. Its capability opens nothing from now on. */
    vanish: (id) => {
      const pty = ptys.get(id);
      if (pty === undefined) return;
      clearTimeout(pty.lease);
      stopJob(pty);
      ptys.delete(id);
      byCap.delete(pty.cap);
      pty.gone = true;
      const holder = pty.holder;
      pty.holder = null;
      for (const wake of [...pty.room.splice(0), ...pty.empty.splice(0)]) wake();
      if (holder !== null) {
        holder.pty = null;
        shut(holder);
      }

      dropWatchers(pty);
    },
    /** The host starts afresh: every terminal is gone, with no word (a restart, which a lease or a close is not); the kept ends go with it. */
    restart: () => {
      for (const pty of [...ptys.values()]) {
        ghosts.set(pty.cap, listed(pty));
        const holder = pty.holder;
        clearTimeout(pty.lease);
        stopJob(pty);
        pty.gone = true;
        pty.holder = null;
        byCap.delete(pty.cap);
        ptys.delete(pty.id);
        if (holder !== null) {
          holder.pty = null;
          shut(holder);
        }

        dropWatchers(pty);
      }

      for (const cap of [...kept.keys()]) forgetEnd(cap);
    },
    /** The ring no longer reaches back to `from`: answers where it starts now. */
    trimRing: (id, from) => ptyOf(id).ring.trim(from),
    /** Bytes the host has read into its ring that no page was given: a replay holds them. They take the offsets the ring has now. */
    plant: (id, text) => {
      ptyOf(id).ring.record(encoder.encode(text));
    },
    ids: () => [...ptys.keys()],
    /** The capability of a terminal, for a probe that checks where it was put: the host itself never says it again. */
    capabilityOf: (id) => ptyOf(id).cap,
    /** The ends the host keeps, by terminal. */
    keptEnds: () => [...kept.values()].map((entry) => ({ id: entry.id, end: entry.end, expires: entry.expires })),
    state: (id) => {
      const pty = ptys.get(id);
      if (pty === undefined) return undefined;
      return {
        holder: pty.holder?.id ?? null,
        watchers: pty.watchers.length,
        applied: pty.applied,
        admitted: pty.admitted,
        leaseExpires: pty.leaseExpires,
        start: pty.ring.start,
        end: pty.ring.end,
        overwritten: pty.ring.overwritten,
        paused: pty.paused,
        waiting: pty.waiting,
        unsent: unsent(pty),
        unacked: pty.unacked,
        cols: pty.cols,
        rows: pty.rows,
        program: pty.program?.name ?? null,
        frame: pty.program?.frame ?? 0,
        modes: pty.ring.modesAt(pty.ring.end),
        chunks: pty.ring.chunks.length,
        job: pty.job?.name ?? null,
      };
    },
    /** The ring's bytes from `from` to the end, as the host holds them. */
    bytes: (id, from) => ptyOf(id).ring.read(from ?? ptyOf(id).ring.start, ptyOf(id).ring.end),
    /** Bytes the shell wrote that the host has not handed to a stream: what waits in the pty and what the ring holds past the holder's cursor. */
    waiting: () => [...ptys.values()].reduce((sum, pty) => sum + pty.waiting + unsent(pty), 0),
    /** Whether the pump waits (the host stopped reading the shell) for any terminal. */
    paused: () => [...ptys.values()].some((pty) => pty.paused),
    stop: () => {
      for (const pty of ptys.values()) {
        clearTimeout(pty.lease);
        stopJob(pty);
      }

      for (const entry of kept.values()) clearTimeout(entry.timer);
      clearTimeout(lag.timer);
    },
  };
}

// The far end of the Terminal tool as T2-go makes it (docs/ui-next/status/T2-go.md): a host that outlives the page. It is plain Node with no dependency, so that the terminal probe holds ONE host for a whole browser
// context: it survives the reload of a page and is shared by a second page. The fixture page (terminal-fixture.tsx, `?host=shared`) forwards the host's calls to it and receives its events from it; the probe drives and
// reads it directly. The terminals that live in the page itself (the fixture without `?host=shared`) are the T2a probe's and stay as they are.
//
// What it models of the host, each as the document states it:
//   - a terminal made with `launch.page_key` (16 to 128 visible ASCII characters, no space; anything else is refused INVALID_REQUEST naming it) sends `core/exec/stream/output/<id>` as `{offset, data}` (offsets contiguous,
//     at most 20,480 bytes an event) and ends with a CLOSE that carries `last_offset`; one without a key sends `stdout` as T1 did and ends with its window (2.1, 2.3);
//   - the ring of what the host read: 20 chunks of 64 KiB with absolute offsets (a chunk closes at a boundary that is not inside an escape or a UTF-8 sequence), the size log, and the modes a scanner reads from the output,
//     exact at any offset (2.2);
//   - ListTerminals, AttachTerminal (the replay is one answer), DetachTerminal, and the events DETACHED and CLOSE (`closed_by: 'detach-timeout'`), with the attachment numbers (the creating page holds 0) (2.2, 2.3);
//   - a window that goes away detaches the keyed terminals it owns (a lease starts) and ends the others; the lease running out ends a terminal as a close does; a shell that ends while no page holds it leaves a tombstone (2.5);
//   - while no page holds a terminal the reader is held: nothing more is read than the read in flight, and the shell blocks in its own write;
//   - the credit flow control of T1 (2.8.6) and the numbered input of 2.4 (the host expects `next`; a number that is used is SEQUENCE_STALE; seq 0 is applied as it comes and does not move it; the answer of an attach and each
//     entry of the list say which number the queue takes next, `next_input_seq` (host #675): 1 or more on a terminal that runs, 0 on one that ended);
//   - the window's own state (the host's window service: `GetState`, `SaveState`), where the page keeps its key and its session.
// The synthetic shell has the commands of the in-page fixture (hello, size, colors, flood, sleep, exit, kill, segv, quit, orphan) and two more for the probe: `fullscreen` (a full-screen program: alternate screen, the mouse,
// bracketed paste, application cursor, focus events and a hidden cursor, redrawn on every resize) and `query` (a program that asks the terminal where its cursor is and what it is).
// `faults` are the negative controls' far end: each one is a single way of getting the host wrong, named for the assertion that must see it.

import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';

export const LIMITS = Object.freeze({
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
});

/** The most the host reads from the pty at once, and what a chunk of the ring holds before it closes. */
export const READ_MAX = 20_480;
export const CHUNK = 65_536;
const RING_CHUNKS = LIMITS.replay_bytes / CHUNK;
/** What the pty's own buffer holds before the shell's write blocks. */
const PTY_ROOM = 65_536;
const PROMPT = '\u001b[32muser@synthetic\u001b[0m:\u001b[34m~\u001b[0m$ ';
const BANNER = `\u001b[90mSynthetic shell: hello, size, colors, flood N [W], sleep N, exit [code], kill, quit, fullscreen, query\u001b[0m\r\n${PROMPT}`;
const USABLE_KEY = /^[\x21-\x7e]{16,128}$/;

/** What an error of the host is, as the page receives it: an error whose message is the JSON of the host's envelope. */
const refusal = (type, title, status, code, detail) => new Error(JSON.stringify({ type, title, status, detail, code }));
const notFound = (id) => refusal('omniview:session/not-found', 'Session not found', 404, 'NOT_FOUND', `Session ${id} not found`);
const invalid = (name, why) => refusal('omniview:resource/invalid-request', 'Invalid request', 400, 'INVALID_REQUEST', `${name}: ${why}`);
const stale = (seq, next) => refusal('omniview:terminal/sequence-stale', 'Stale input sequence number', 409, 'SEQUENCE_STALE', `Sequence number ${String(seq)} was already applied or given up; the next expected is ${String(next)}.`);
const ahead = (seq, next) => refusal('omniview:terminal/sequence-ahead', 'Input sequence number too far ahead', 400, 'SEQUENCE_AHEAD', `Sequence number ${String(seq)} is more than ${String(LIMITS.seq_ahead)} past the next expected, ${String(next)}.`);

// ---- the modes a scanner reads from the output ------------------------------------------------------------------------------------------------------------------------------------------------------------

const noModes = () => ({ known: true, alt_screen: false, bracketed_paste: false, application_cursor: false, focus_events: false, cursor_hidden: false, mouse_tracking: 0, mouse_encoding: 0, kitty_keyboard: [] });

/**
 * Reads the modes the program has set from its output, a byte at a time, so that it is exact however the output is cut: alt screen (47, 1047, 1049), the mouse (9 and 1000 click, 1002 drag, 1003 any motion; 1005, 1006, 1015
 * for the encoding), bracketed paste (2004), application cursor (1), focus events (1004), the cursor (25), DECSTR and RIS. `boundary` says whether the next byte starts something: not inside an escape or a UTF-8 sequence.
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

// ---- the ring ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** What the host read of the terminal's output: chunks with absolute offsets, the size in force at each offset and the modes at the start of each chunk. */
export class Ring {
  constructor(cols, rows) {
    this.chunks = [];
    this.end = 0;
    this.scanner = new Scanner();
    this.sizes = [{ offset: 0, cols, rows }];
  }

  get start() {
    return this.chunks.length === 0 ? this.end : this.chunks[0].start;
  }

  record(bytes) {
    let chunk = this.chunks.at(-1);
    if (chunk === undefined || (chunk.length >= CHUNK && this.scanner.boundary)) {
      chunk = { start: this.end, parts: [], length: 0, modes: this.scanner.clone() };
      this.chunks.push(chunk);
      if (this.chunks.length > RING_CHUNKS) this.chunks.shift();
    }

    chunk.parts.push(bytes);
    chunk.length += bytes.length;
    this.end += bytes.length;
    this.scanner.feed(bytes);
  }

  resize(cols, rows) {
    this.sizes.push({ offset: this.end, cols, rows });
  }

  sizeAt(offset) {
    let found = this.sizes[0];
    for (const entry of this.sizes) if (entry.offset <= offset) found = entry;
    return { cols: found.cols, rows: found.rows };
  }

  read(from, to) {
    const out = [];
    for (const chunk of this.chunks) {
      const bytes = Buffer.concat(chunk.parts);
      const lo = Math.max(from, chunk.start);
      const hi = Math.min(to, chunk.start + chunk.length);
      if (lo < hi) out.push(bytes.subarray(lo - chunk.start, hi - chunk.start));
    }

    return Buffer.concat(out);
  }

  /** The modes in force at `offset`: the scanner's state at the start of its chunk, read on to the offset. */
  modesAt(offset) {
    if (offset >= this.end) return { ...this.scanner.modes, kitty_keyboard: [...this.scanner.modes.kitty_keyboard] };
    const chunk = this.chunks.find((candidate) => offset >= candidate.start && offset < candidate.start + candidate.length) ?? this.chunks[0];
    const scanner = chunk.modes.clone();
    scanner.feed(this.read(chunk.start, offset));
    return scanner.modes;
  }
}

// ---- the host ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * @param {{ leaseMs?: number, gapMs?: number, writeBetween?: boolean, duplicates?: 'late' | 'early' | 'none', faults?: Record<string, boolean>, shell?: string, tombstoneClose?: 'not-found' | 'dismiss' }} [options]
 *   `leaseMs` is the lease a terminal gets when its page does not say (the probe makes it short where it waits for one to run out); `writeBetween` has another tab type between the list and the attach: after each answer of
 *   ListTerminals one empty write of `other-tab` takes the number the list has just said, so that the number of the list is true when it is made and stale when the page attaches, and the answer of the attach is the number now;
 *   `duplicates` is when an event the replay already holds is delivered again: after the answer (`late`: the race of T2-go 2.4 rule 5), before it, or never; `tombstoneClose` is what CloseSession answers for a terminal whose
 *   shell ended: that the session is not there, as the real host does (T2b explore, S1), or that it is dismissed.
 */
export function createHost(options = {}) {
  const { leaseMs: defaultLease = LIMITS.lease_default_ms, gapMs = LIMITS.gap_wait_ms, writeBetween = false, duplicates = 'late', shell = 'zsh', tombstoneClose = 'not-found' } = options;
  const faults = { ...options.faults };
  const windows = new Map();
  const ptys = new Map();
  const slots = new Map();
  const log = { calls: [], created: [], writes: [], acks: [], attaches: [], lists: [], events: [], resizes: [], duplicates: [] };
  /** The answers of attach calls the probe holds (`holdAttach`): the host has done the attach, and the answer waits. */
  const holds = [];
  let serial = 0;

  const emit = (name, data) => {
    const event = { name, at: Date.now() };
    if (!name.includes('/stream/output/') && !name.includes('/stream/stdout/')) event.data = data;
    log.events.push(event);
    for (const window of [...windows.values()]) window.deliver(name, data);
  };

  const modesOf = (pty, offset) => (faults.modesLost ? noModes() : pty.ring.modesAt(offset));

  // ---- the shell ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  /** The shell writes: it waits in the pty until the host reads it. */
  const out = (pty, text) => {
    if (pty.ended !== null || pty.finishing || pty.gone) return;
    const bytes = Buffer.from(text);
    pty.queue.push(bytes);
    pty.waiting += bytes.length;
    pump(pty);
  };

  const take = (pty, max) => {
    const parts = [];
    let have = 0;
    while (have < max && pty.queue.length > 0) {
      const head = pty.queue[0];
      if (have + head.length <= max) {
        parts.push(head);
        have += head.length;
        pty.queue.shift();
      } else {
        parts.push(head.subarray(0, max - have));
        pty.queue[0] = head.subarray(max - have);
        have = max;
      }
    }

    pty.waiting -= have;
    return Buffer.concat(parts);
  };

  /** One read of the host: what it read is in the ring, and goes to the page that holds the terminal. */
  const read = (pty, deliver) => {
    const bytes = take(pty, READ_MAX);
    const offset = pty.ring.end;
    pty.ring.record(bytes);
    pty.recent.push({ offset, length: bytes.length });
    if (pty.recent.length > 8) pty.recent.shift();
    if (!deliver) return;
    if (pty.key === null) emit(`core/exec/stream/stdout/${pty.id}`, bytes.toString('base64'));
    else emit(`core/exec/stream/output/${pty.id}`, { offset, data: bytes.toString('base64') });
    pty.delivered += bytes.length;
    pty.unacked += bytes.length;
    if (!pty.explicit) pty.unacked = Math.max(0, pty.unacked - bytes.length);
    if (pty.unacked >= LIMITS.flow_high_bytes) pty.paused = true;
  };

  function pump(pty) {
    if (pty.pumping) return;
    pty.pumping = true;
    try {
      while (pty.holder !== null && !pty.paused && pty.queue.length > 0 && !pty.gone) read(pty, true);
      if (pty.holder !== null && pty.queue.length === 0 && pty.finishing && !pty.gone) conclude(pty);
    } finally {
      pty.pumping = false;
    }

    settle(pty);
  }

  /** What waits for room in the pty and for everything written to be read: the flood goes on when the host has read. */
  const settle = (pty) => {
    if (pty.waiting < PTY_ROOM) for (const wake of pty.room.splice(0)) wake();
    if (pty.queue.length === 0) for (const wake of pty.empty.splice(0)) wake();
  };

  const stopJob = (pty) => {
    if (pty.job !== undefined) clearTimeout(pty.job.timer);
    pty.job = undefined;
    pty.program = undefined;
  };

  /**
   * The shell is gone: its output is read to the end, and the host says how it ended after it, to every window (whether or not a page holds the terminal). The terminal is kept, with its end and its output, for the rest of its
   * lease: a tombstone, listed with `ended` and held by nobody (T2b explore, Q3d). One with no key is not kept.
   */
  const finish = (pty, end) => {
    if (pty.finishing || pty.ended !== null) return;
    pty.finishing = end;
    stopJob(pty);
    letGo(pty);
    if (pty.holder === null) {
      while (pty.queue.length > 0) read(pty, false);
      conclude(pty);
      return;
    }

    pump(pty);
  };

  /** The end is told: everything the shell wrote has been read. */
  const conclude = (pty) => {
    pty.ended = { ...pty.finishing, last_offset: pty.ring.end };
    emit(`core/exec/signal/CLOSE/${pty.id}`, pty.ended);
    pty.holder = null;
    letGo(pty);
    if (pty.key === null) {
      pty.gone = true;
      ptys.delete(pty.id);
      return;
    }

    startLease(pty);
  };

  const exit = (pty, code) => finish(pty, { reason: 'exited', exit_code: code });

  const flood = (pty, lines, width) => {
    const perEvent = Math.max(1, Math.floor(1000 / (width + 2)));
    let next = 0;
    const step = () => {
      if (ptys.get(pty.id) !== pty || pty.ended !== null || pty.finishing) return;
      for (let batch = 0; batch < 40 && next < lines && pty.waiting < PTY_ROOM; batch += 1) {
        const count = Math.min(perEvent, lines - next);
        let text = '';
        for (let at = 0; at < count; at += 1) text += `${String(next + at).padStart(7, '0')} ${'x'.repeat(Math.max(0, width - 8))}\r\n`;
        next += count;
        out(pty, text);
      }

      if (next < lines) {
        if (pty.waiting >= PTY_ROOM) pty.room.push(() => setTimeout(step, 0));
        else setTimeout(step, 0);
        return;
      }

      out(pty, PROMPT);
    };

    step();
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
        out(pty, `${String(pty.rows)} ${String(pty.cols)}\r\n`);
        break;
      case 'colors':
        out(pty, '\u001b[31mred\u001b[0m \u001b[32mgreen\u001b[0m \u001b[1mbold\u001b[0m\r\n');
        break;
      case 'flood':
        flood(pty, Number(args[0] ?? 1000), Number(args[1] ?? 80));
        return;
      case 'sleep': {
        const seconds = Number(args[0]);
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
        finish(pty, { reason: 'signaled', signal: 'SIGKILL', signal_number: 9 });
        return;
      case 'segv':
        finish(pty, { reason: 'signaled', signal: 'SIGSEGV', signal_number: 11, core_dumped: true });
        return;
      case 'quit':
        finish(pty, { reason: 'closed', closed_by: 'shutdown' });
        return;
      case 'orphan':
        out(pty, 'logout\r\n');
        finish(pty, { reason: 'exited', exit_code: 0, drain_capped: true, dropped_bytes: 4096 });
        return;
      default:
        out(pty, `synthetic: command not found: ${word}\r\n`);
    }

    out(pty, PROMPT);
  };

  /** What the user typed, as the pty's line discipline takes it: echo, backspace, interrupt, a line at Enter. A full-screen program takes the keys itself (`q` leaves it). */
  const typed = (pty, data) => {
    if (pty.program !== undefined) {
      if (data.includes('q')) {
        pty.program = undefined;
        out(pty, `${FULLSCREEN_OFF}\r\n${PROMPT}`);
      }

      return;
    }

    for (const ch of data.replace(/\u001b\[[0-9;?<>]*[A-Za-z~]/g, '').replace(/\u001bO[A-Z]/g, '').replace(/\u001b/g, '')) {
      if (pty.ended !== null || pty.finishing) return;
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

  // ---- leases, windows ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  const startLease = (pty) => {
    clearTimeout(pty.lease);
    pty.leaseExpires = Date.now() + pty.leaseMs;
    pty.lease = setTimeout(() => expire(pty), pty.leaseMs);
    pty.lease.unref?.();
  };

  /** The lease ran out and no page took the terminal: it ends as a close does (SIGHUP, then SIGKILL), with one CLOSE. */
  const expire = (pty) => {
    if (pty.holder !== null || ptys.get(pty.id) !== pty) return;
    if (pty.ended !== null) {
      // The lease of a tombstone is over: the end and the output it kept are freed, and nothing is said.
      ptys.delete(pty.id);
      return;
    }

    pty.lease = undefined;
    stopJob(pty);
    ptys.delete(pty.id);
    pty.gone = true;
    letGo(pty);
    if (!faults.leaseSilent) emit(`core/exec/signal/CLOSE/${pty.id}`, { reason: 'closed', closed_by: 'detach-timeout', last_offset: pty.ring.end });
  };

  /** A page that held the terminal does not any more: nobody reads it, its lease runs, and the one read in flight is taken into the ring. */
  const release = (pty, by) => {
    const held = pty.holder;
    if (held === null) return;
    pty.holder = null;
    if (pty.queue.length > 0 && !pty.paused && !pty.gone) read(pty, false);
    if (pty.ended === null) startLease(pty);
    if (!(by === 'taken-over' && faults.noDetached)) emit(`core/exec/signal/DETACHED/${pty.id}`, { by, attachment: held });
  };

  const register = (id, deliver) => {
    windows.set(id, { id, deliver });
  };

  /** The window went away: the terminals it owns that have a key are detached and their leases start; the others end with it. */
  const retire = (id) => {
    windows.delete(id);
    for (const pty of [...ptys.values()]) {
      if (pty.owner !== id) continue;
      pty.owner = null;
      if (pty.key === null) finish(pty, { reason: 'closed', closed_by: 'window' });
      else release(pty, 'window-retired');
    }
  };

  /** What may touch a keyed terminal through the reattach calls: its owner window, or whoever has its key. */
  const reachable = (id, window, key) => {
    const pty = ptys.get(id);
    if (pty === undefined) throw notFound(id);
    if (pty.key === null) {
      if (pty.owner === window) throw refusal('omniview:terminal/not-reattachable', 'Not reattachable', 409, 'NOT_REATTACHABLE', `Session ${id} has no page key`);
      throw notFound(id);
    }

    if (pty.owner !== window && key !== pty.key) throw notFound(id);
    return pty;
  };

  // ---- the calls --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  const sessionOf = (pty, size = { cols: pty.cols, rows: pty.rows }) => ({
    id: pty.id,
    created_at: pty.createdAt,
    pid: pty.pid,
    shell: { path: `/bin/${shell}`, name: shell },
    cwd: '/home/user',
    cols: size.cols,
    rows: size.rows,
    environment: { source: 'launch', probe: { state: 'ok' } },
    limits: LIMITS,
    lease_ms: pty.key === null ? 0 : pty.leaseMs,
  });

  const create = (window, options, launch = {}) => {
    if (ptys.has(options.id)) throw refusal('omniview:resource/conflict', 'Already exists', 409, 'ALREADY_EXISTS', `A terminal session with id "${options.id}" exists.`);
    const key = launch.page_key;
    if (key !== undefined && !USABLE_KEY.test(key)) throw invalid('page_key', 'a page key is 16 to 128 visible ASCII characters, no space');
    const lease = launch.lease_ms ?? 0;
    if (typeof lease !== 'number' || lease < 0 || lease > LIMITS.lease_max_ms || (lease !== 0 && key === undefined)) throw invalid('lease_ms', 'a lease is 0 to 1,800,000 ms and needs a page key');
    const cols = launch.cols ?? 80;
    const rows = launch.rows ?? 24;
    serial += 1;
    const pty = {
      id: options.id,
      key: key ?? null,
      owner: window,
      holder: 0,
      attachments: 0,
      createdAt: new Date().toISOString(),
      pid: 4242 + serial,
      leaseMs: lease === 0 ? defaultLease : lease,
      lease: undefined,
      leaseExpires: 0,
      cols,
      rows,
      ring: new Ring(cols, rows),
      recent: [],
      queue: [],
      waiting: 0,
      delivered: 0,
      unacked: 0,
      explicit: false,
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
      next: 1,
      early: new Map(),
      applying: false,
      holds: new Set(),
    };
    ptys.set(pty.id, pty);
    log.created.push({ window, id: pty.id, key: key ?? null, lease_ms: lease, cols, rows });
    setTimeout(() => out(pty, BANNER), 20);
    return sessionOf(pty);
  };

  const listed = (pty) => ({
    id: pty.id,
    created_at: pty.createdAt,
    pid: pty.pid,
    shell: { path: `/bin/${shell}`, name: shell },
    labels: {},
    params: {},
    size: { cols: pty.cols, rows: pty.rows },
    attached: pty.holder !== null,
    next_offset: pty.ring.end,
    replay_start: pty.ring.start,
    lease_expires_unix_ms: pty.holder === null ? pty.leaseExpires : 0,
    // The number the input queue takes next: 1 or more on a terminal that runs, 0 on one that ended (the count is the queue's, and nothing is queued for a terminal that is gone).
    next_input_seq: pty.ended === null ? pty.next : 0,
    ...(pty.ended === null || faults.tombstoneUnmarked ? {} : { ended: pty.ended }),
  });

  /** What a restart took away, which `faults.listGhost` goes on listing: a host that lists a terminal it no longer has. */
  const ghosts = [];

  const list = (window, key) => {
    const live = [...ptys.values()]
      .filter((pty) => pty.key !== null && (pty.owner === window || pty.key === key))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.pid - b.pid)
      .map(listed);
    return faults.listGhost ? [...live, ...ghosts.filter((ghost) => ghost.key === key).map((ghost) => ghost.listed)] : live;
  };

  const replayOf = (pty, from) => {
    const ring = pty.ring;
    const start = from !== undefined && from !== null && from >= ring.start ? from : ring.start;
    let data = ring.read(start, ring.end);
    if (faults.replayGap) data = data.subarray(0, Math.max(0, data.length - 1000));
    const size = { cols: pty.cols, rows: pty.rows };
    return { start, end: ring.end, data: data.toString('base64'), start_size: ring.sizeAt(start), start_modes: modesOf(pty, start), size, modes: modesOf(pty, ring.end) };
  };

  const attach = (window, id, request = {}) => {
    const pty = reachable(id, window, request.page_key);
    if (request.from_offset !== undefined && request.from_offset !== null && request.from_offset > pty.ring.end) throw invalid('from_offset', 'past the end of the output');
    // A tombstone is given to the page as it is: its output and its end, the attachment number does not advance, nobody holds it, and its lease runs on (T2b explore, Q3d).
    const dead = pty.ended !== null;
    let previous = null;
    if (!dead) {
      clearTimeout(pty.lease);
      pty.lease = undefined;
      previous = pty.holder;
      pty.attachments += 1;
      pty.holder = pty.attachments;
      pty.owner = window;
      // The host forgets what the page that held it had not acknowledged: the credit counts from what it gives now.
      pty.unacked = 0;
      pty.paused = false;
      // The page that held it is told, with ITS number, and so is every other window, the new holder included: it holds the next number, so it is not concerned (T2-go 2.3).
      if (previous !== null && !faults.noDetached) emit(`core/exec/signal/DETACHED/${id}`, { by: 'taken-over', attachment: faults.ownNumber ? pty.holder : previous });
    }

    const last = pty.recent.at(-1);
    if (!dead && duplicates === 'early' && last !== undefined && last.offset >= pty.ring.start) emit(`core/exec/stream/output/${id}`, { offset: last.offset, data: pty.ring.read(last.offset, last.offset + last.length).toString('base64') });
    const replay = replayOf(pty, request.from_offset);
    const answer = {
      session: sessionOf(pty, pty.ring.sizeAt(0)),
      replay,
      cwd: dead ? { reason: 'ended' } : { path: '/home/user' },
      busy: dead ? { state: 'unknown', reason: 'ended' } : busyOf(pty),
      attachment: dead ? pty.attachments : pty.holder,
      ...(dead ? { ended: pty.ended } : {}),
      next_input_seq: dead ? 0 : pty.next,
    };
    log.attaches.push({ window, id, from_offset: request.from_offset ?? null, start: replay.start, end: replay.end, bytes: pty.ring.end - replay.start, attachment: answer.attachment, next_input_seq: answer.next_input_seq, dead, answered: Date.now() });
    if (dead) return answer;
    // What follows the answer: the reader is let go (the live output continues at `replay.end`), and an event the replay holds may still arrive, as an event and a reply travel apart.
    setTimeout(() => {
      if (ptys.get(id) !== pty) return;
      if (duplicates === 'late' && last !== undefined && last.offset >= replay.start) {
        const offset = faults.duplicateOffset ? replay.end : last.offset;
        emit(`core/exec/stream/output/${id}`, { offset, data: pty.ring.read(last.offset, last.offset + last.length).toString('base64') });
        log.duplicates.push({ window, id, offset, length: last.length });
      }

      if (faults.unmutedReply) log.writes.push({ window, id, seq: 0, data: '\u001b[1;1R' });
      pump(pty);
    }, 4);
    return answer;
  };

  const detach = (window, id, request = {}) => {
    const pty = reachable(id, window, request.page_key);
    // The window that OWNS the terminal detaches it; the key detaches only a terminal that no window owns.
    if (pty.owner !== null && pty.owner !== window) throw notFound(id);
    if (pty.holder !== null) {
      pty.owner = null;
      if (request.lease_ms !== undefined && request.lease_ms > 0) pty.leaseMs = Math.min(request.lease_ms, LIMITS.lease_max_ms);
      release(pty, 'requested');
    }

    return { lease_ms: pty.leaseMs, lease_expires_unix_ms: pty.leaseExpires };
  };

  const busyOf = (pty) => (pty.program !== undefined ? { state: 'busy', pgid: 4242, name: pty.program.name } : pty.job === undefined ? { state: 'idle' } : { state: 'busy', pgid: 4242, name: pty.job.name });

  const close = (id) => {
    const pty = ptys.get(id);
    if (pty === undefined) throw notFound(id);
    // The real host does not dismiss a terminal whose shell ended: it answers that the session is not there and keeps the tombstone until its lease is over (T2b explore, S1).
    if (pty.ended !== null && tombstoneClose === 'not-found') throw notFound(id);
    clearTimeout(pty.lease);
    stopJob(pty);
    ptys.delete(id);
    pty.gone = true;
    letGo(pty);
    emit(`core/exec/signal/CLOSE/${id}`, { reason: 'closed', closed_by: 'request', last_offset: pty.ring.end });
  };

  const ack = (id, bytes) => {
    const pty = ptys.get(id);
    if (pty === undefined) return;
    pty.explicit = true;
    pty.unacked = Math.max(0, pty.unacked - bytes);
    if (pty.paused && pty.unacked <= LIMITS.flow_low_bytes) {
      pty.paused = false;
      pump(pty);
    }
  };

  /** What waits on a pty that closed is let go: a call that waits for its turn is refused, and nothing is applied after. */
  function letGo(pty) {
    if (!pty.gone && pty.ended === null && !pty.finishing) return;
    for (const wake of [...pty.early.values()]) wake();
    pty.room.splice(0);
  }

  const turn = async (pty, seq) =>
    new Promise((resolve) => {
      let timer;
      const go = () => {
        clearTimeout(timer);
        pty.early.delete(seq);
        resolve();
      };

      const wake = () => {
        if (pty.early.get(seq) !== go) return;
        if (pty.applying) {
          timer = setTimeout(wake, gapMs);
          return;
        }

        const lowest = Math.min(...pty.early.keys());
        pty.next = Math.max(pty.next, lowest);
        pty.early.get(lowest)?.();
      };

      timer = setTimeout(wake, gapMs);
      pty.early.set(seq, go);
    });

  /** A numbered input call (T2-go 2.4 and T1-go 2.4): applied in the order of its number; `seq` 0 is applied as it comes. `call` is the entry of the log that says what became of it. */
  const input = async (call, id, seq, apply) => {
    call.seq = seq;
    call.outcome = 'sent';
    const pty = ptys.get(id);
    if (pty === undefined || pty.gone || pty.ended !== null) {
      call.outcome = 'not-found';
      throw notFound(id);
    }

    const ordered = seq >= 1;
    if (ordered) {
      if (seq < pty.next || (pty.applying && seq === pty.next) || pty.early.has(seq)) {
        call.outcome = 'stale';
        throw stale(seq, pty.next);
      }

      if (seq > pty.next + LIMITS.seq_ahead) {
        call.outcome = 'ahead';
        throw ahead(seq, pty.next);
      }

      if (seq !== pty.next) {
        await turn(pty, seq);
        if (ptys.get(id) !== pty || pty.gone || pty.ended !== null) {
          call.outcome = 'not-found';
          throw notFound(id);
        }
      }

      pty.applying = true;
    }

    apply(pty);
    call.outcome = 'applied';
    if (ordered) {
      pty.applying = false;
      pty.next = Math.max(pty.next, seq + 1);
      pty.early.get(pty.next)?.();
    }
  };

  const write = async (window, call, id, seq, data) =>
    input(call, id, seq, (pty) => {
      const text = Buffer.from(data, 'base64').toString();
      log.writes.push({ window, id, seq, data: text });
      typed(pty, text);
    });

  const resize = async (window, call, id, seq, rows, cols) =>
    input(call, id, seq, (pty) => {
      log.resizes.push({ window, id, seq, rows, cols });
      // `faults.resizeIgnored`: the host takes the call and the pty keeps its size.
      if (faults.resizeIgnored) return;
      // A program that is given the size it has draws nothing (vim does not): only a change makes it draw again.
      const changed = pty.rows !== rows || pty.cols !== cols;
      pty.rows = rows;
      pty.cols = cols;
      pty.ring.resize(cols, rows);
      if (changed && pty.program !== undefined) frame(pty);
    });

  /** `writeBetween`: a write of another tab, an empty one, takes the number the queue expects now. What the list has just said is stale by the time the page attaches. */
  const stray = (pty) => {
    const entry = { window: 'other-tab', method: 'WriteTerminal', id: pty.id, args: [], at: Date.now() };
    log.calls.push(entry);
    write('other-tab', entry, pty.id, pty.next, '').catch(() => undefined);
  };

  const dispatch = async (window, method, args, entry) => {
    switch (method) {
      case 'CreateTerminal':
        return create(window, args[0], args[1]);
      case 'ListTerminals': {
        const answer = list(window, args[0]);
        log.lists.push({ window, listed: answer.map((item) => ({ id: item.id, next_input_seq: item.next_input_seq })) });
        if (writeBetween) {
          for (const item of answer) {
            const pty = ptys.get(item.id);
            if (pty !== undefined && pty.ended === null && !pty.gone) stray(pty);
          }
        }

        return answer;
      }
      case 'AttachTerminal': {
        const answer = attach(window, args[0], args[1]);
        // The terminal is taken over now and the answer is on its way: the page that made the call is waiting for it, and every event the host sends meanwhile reaches it first.
        const at = holds.findIndex((hold) => hold.id === args[0]);
        if (at !== -1) {
          const [hold] = holds.splice(at, 1);
          hold.held = true;
          await hold.gate;
        }

        return answer;
      }

      case 'DetachTerminal':
        return detach(window, args[0], args[1]);
      case 'WriteTerminal':
        return write(window, entry, args[0], args[1], args[2]);
      case 'ResizeTerminal':
        return resize(window, entry, args[0], args[1], args[2], args[3]);
      case 'AckTerminal':
        log.acks.push({ window, id: args[0], bytes: args[1] });
        return ack(args[0], args[1]);
      case 'IsBusy': {
        const pty = ptys.get(args[0]);
        if (pty === undefined || pty.gone) throw notFound(args[0]);
        return busyOf(pty);
      }

      case 'CloseSession':
        return close(args[0]);
      case 'GetState':
        return { ...slots.get(args[0]) };
      case 'SaveState':
        slots.set(args[0], { ...slots.get(args[0]), [args[1]]: args[2] });
        return undefined;
      default:
        throw refusal('omniview:resource/invalid-request', 'Unknown call', 400, 'INVALID_REQUEST', `${method} is not a call of the fixture's host`);
    }
  };

  /** A client call, as a window makes it: the log keeps what was asked and what became of it. */
  const call = async (window, method, args) => {
    const entry = { window, method, id: typeof args[0] === 'string' ? args[0] : undefined, args: method === 'WriteTerminal' ? [] : args.slice(1), at: Date.now() };
    log.calls.push(entry);
    try {
      const answer = await dispatch(window, method, args, entry);
      entry.outcome ??= 'ok';
      return answer;
    } catch (error) {
      entry.outcome ??= 'refused';
      throw error;
    }
  };

  return {
    LIMITS,
    log,
    faults,
    register,
    retire,
    /** A window that is going away is sent no more events, though the host has not noticed that it is gone (`serveContext`'s sweep). */
    mute: (id) => {
      const window = windows.get(id);
      if (window !== undefined) window.deliver = () => undefined;
    },
    /**
     * The answer of the NEXT attach call for the terminal `id` is held until `release` is called: the host takes the terminal over at once, as it does, and the page that made the call goes on waiting for the answer (it is
     * reattaching, and does not know its own attachment number). `held()` says whether the call has arrived and its answer is being held. The hold is for one call: the calls after it are answered as they come.
     */
    holdAttach: (id) => {
      let release = () => undefined;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const hold = { id, gate, held: false };
      holds.push(hold);
      return {
        held: () => hold.held,
        release: () => {
          hold.held = false;
          release();
        },
      };
    },
    call,
    emit,
    /** Another client resizes the pty (the probe's own, which no fault touches): the size in force from here on, and the ring's size log says so. */
    setSize: (id, rows, cols) => {
      const pty = ptys.get(id);
      const changed = pty.rows !== rows || pty.cols !== cols;
      pty.rows = rows;
      pty.cols = cols;
      pty.ring.resize(cols, rows);
      if (changed && pty.program !== undefined) frame(pty);
    },
    /** The probe: the shell writes while no page is there, or while one is. */
    append: (id, text) => out(ptys.get(id), text),
    flood: (id, lines, width) => flood(ptys.get(id), lines, width),
    type: (id, text) => typed(ptys.get(id), text),
    end: (id, end) => finish(ptys.get(id), end ?? { reason: 'exited', exit_code: 0 }),
    /** The host starts afresh: every terminal is gone, with no word (a restart, which a lease or a close is not). */
    restart: () => {
      for (const pty of ptys.values()) {
        if (pty.key !== null) ghosts.push({ key: pty.key, listed: listed(pty) });
        clearTimeout(pty.lease);
        stopJob(pty);
        pty.gone = true;
        letGo(pty);
      }

      ptys.clear();
    },
    ids: () => [...ptys.keys()],
    windows: () => [...windows.keys()],
    state: (id) => {
      const pty = ptys.get(id);
      if (pty === undefined) return undefined;
      return {
        key: pty.key,
        owner: pty.owner,
        holder: pty.holder,
        attachments: pty.attachments,
        leaseExpires: pty.leaseExpires,
        start: pty.ring.start,
        end: pty.ring.end,
        next: pty.next,
        paused: pty.paused,
        unacked: pty.unacked,
        waiting: pty.waiting,
        ended: pty.ended,
        cols: pty.cols,
        rows: pty.rows,
        program: pty.program?.name ?? null,
        frame: pty.program?.frame ?? 0,
        modes: pty.ring.modesAt(pty.ring.end),
        chunks: pty.ring.chunks.length,
      };
    },
    /** The ring's bytes from `from` to the end, as the host holds them. */
    bytes: (id, from) => ptys.get(id).ring.read(from ?? ptys.get(id).ring.start, ptys.get(id).ring.end),
    stop: () => {
      for (const pty of ptys.values()) {
        clearTimeout(pty.lease);
        stopJob(pty);
      }
    },
  };
}

// ---- the host in a browser context ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Serves `host` to every page of a Playwright browser context: the page's `window.__host(windowId, method, args)` is a call of the host, and what the host emits is handed to the page by `window.__hostEmit(name, data)`.
 * A page load is a window (the id is made by the page when it loads, as a server-mode page is a new window); a window goes away when its page navigates to a blank page (the page is away), when a new window says hello for the same page
 * (the page loaded again), and when the page closes. Events are delivered in the order the host emitted them, and a call answers after the events the host had emitted before it were handed over, so that an event the host sent before its answer arrives before it.
 * @param {import('playwright').BrowserContext} context
 * @param {ReturnType<typeof createHost>} host
 */
export async function serveContext(context, host, { sweepMs = 0 } = {}) {
  const windowOf = new Map();
  const chains = new Map();
  const sweeps = new Set();
  // A window that goes away stops being sent events at once. The host takes it for gone when it notices (`sweepMs`: the real host sweeps every 2 s and retires a page after two sweeps without its socket, so 2 to 4 s; none by
  // default, as when the page says it is going), and until then it still owns what it held: a page that loads meanwhile finds its terminals attached.
  const retirePage = (page) => {
    const id = windowOf.get(page);
    if (id === undefined) return;
    windowOf.delete(page);
    chains.delete(id);
    host.mute(id);
    if (sweepMs <= 0) {
      host.retire(id);
      return;
    }

    const timer = setTimeout(() => {
      sweeps.delete(timer);
      host.retire(id);
    }, sweepMs);
    timer.unref?.();
    sweeps.add(timer);
  };

  const deliverTo = (page, id) => (name, data) => {
    const chain = (chains.get(id) ?? Promise.resolve()).then(async () => page.evaluate(([event, payload]) => window.__hostEmit?.(event, payload), [name, data]).catch(() => undefined));
    chains.set(id, chain);
  };

  await context.exposeBinding('__host', async ({ page }, windowId, method, args) => {
    if (method === 'hello') {
      if (windowOf.get(page) !== undefined && windowOf.get(page) !== windowId) retirePage(page);
      windowOf.set(page, windowId);
      host.register(windowId, deliverTo(page, windowId));
      return null;
    }

    const answer = await host.call(windowId, method, args);
    await chains.get(windowId);
    return answer;
  });
  // A call a page makes as it goes away must outlive the page: through the binding it is dropped with the page in Chromium. It goes as a keepalive request (as the real host's does), to a server of this process.
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    if (request.method === 'OPTIONS') {
      response.setHeader('access-control-allow-headers', '*');
      response.writeHead(204).end();
      return;
    }

    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const { windowId, method, args } = JSON.parse(Buffer.concat(chunks).toString());
      host.call(windowId, method, args).then(
        (answer) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ answer: answer ?? null })),
        (error) => response.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify({ message: error.message })),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await context.addInitScript(`window.__hostBeacon = 'http://127.0.0.1:${String(server.address().port)}/call';`);
  context.on('page', (page) => {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url() === 'about:blank') retirePage(page);
    });
    page.on('close', () => {
      retirePage(page);
    });
  });
  return {
    close: async () => {
      for (const timer of sweeps) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

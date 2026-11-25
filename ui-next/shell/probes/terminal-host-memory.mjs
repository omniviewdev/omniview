// What the real host's memory does under a flood on the terminal channel (docs/ui-next/terminal-channel-protocol.md, #693 acceptance: the host's resident set stays within 100 MiB of its start). A tool to run by hand, not a CI
// probe: its name does not end in `-probe.mjs`, so the probe table never lists it, and it asserts nothing about the host's memory: it measures and prints (it does check the bytes it receives, below). There is no browser: the page's end
// of the stream is written here by hand, with the frame table of the protocol written out again in literal numbers, over a plain TCP socket that speaks the WebSocket of the server build (`/wails/stream/ws?name=terminal`). The socket
// is a raw one on purpose: a reader that stalls has to stop reading the kernel's buffer, so that the host's `Send` really parks, and a WebSocket client library gives no such control.
//
// Every case starts a host of its own (a fresh HOME, a free port, no plugin installed, the pid of the child this tool spawned), makes a channel terminal through the bound call `CreateTerminal` (`launch.channel`, which answers the
// capability) with the user's shell, attaches with the capability, types `exec yes` into it (the host runs only known shells, so `yes` cannot be the terminal's command), and takes one sample a second of the host process's resident set (`ps -o rss= -p <pid>`) for --seconds, with the bytes the reader has received.
//
//   node ui-next/shell/probes/terminal-host-memory.mjs                                     the cases a, b, c and d, 30 s each, with 20 s of stall in d
//   node ui-next/shell/probes/terminal-host-memory.mjs --cases=a,d --seconds=10 --stall=5 --json=/tmp/hostmem.json
//
//   --cases=a,b,c,d  which cases to run, in that order
//   --seconds=30     the length of the sample window of every case
//   --stall=20       case d: seconds the reader stalls, after --stall-at seconds of reading
//   --stall-at=2     case d: seconds of reading before the stall begins
//   --limit-mib=100  the acceptance of #693: the most the resident set may pass its start by. The report says PASS or FAIL against it in the `memory` column, and the exit code does not depend on it; the `integrity` column (the flood ran, every byte and offset exact, exactly one gap in case d) does set the exit code
//   --server=<path>  the host's binary (default bin/Omniview-server, which `OMNIVIEW_UI=next GOWORK=off GOFLAGS= GOTOOLCHAIN=local task build:server` builds)
//   --json=<file>    every sample of every case, and the figures, as JSON
//
// The cases:
//   a  a healthy reader that reads everything and never sends `ack`: the host is paced only by the transport
//   b  a healthy reader that sends `ack` for every output frame (the first, `ack(0)`, right after `ready`, as the page does): the host holds at most `channel_inflight_bytes` of unacknowledged output
//   c  two terminals, two streams: the first is read and acknowledged, the second never reads a byte after its `ready` (the kernel's buffers fill, the host's `Send` parks and the pump stops waiting after `channel_stall_ms`)
//   d  a reader that reads for --stall-at seconds, stalls for --stall seconds (it stops reading the socket), then resumes: it must be given one `gap` and then every byte exactly
//
// What it checks of the bytes: `yes` in the pty writes `y`, carriage return, line feed (the pty's line discipline adds the return), so the byte at offset `o` of the output is `"y\r\n"[(o - F) % 3]`, where `F` is the offset of the first of three lines of `y` (what comes before it is the shell's prompt and the echo of the command). The reader holds every
// `output` frame to that, and to its offset being where the one before ended (or the `to` of a `gap` that came between). A byte that is not what that says, or an offset that does not follow, is counted under `badBytes` and `badOffsets`.
// `received + gaps = next offset` is the protocol's `sent + gap = end` seen from the page.
//
// The capability is never printed, logged or put in a URL: it is in the first frame of the stream and in the bodies of the calls, which go to a loopback port this tool chose.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const exec = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const MIB = 1024 * 1024;
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

const { values: flags } = parseArgs({
  options: {
    cases: { type: 'string', default: 'a,b,c,d' },
    seconds: { type: 'string', default: '30' },
    stall: { type: 'string', default: '20' },
    'stall-at': { type: 'string', default: '2' },
    'limit-mib': { type: 'string', default: '100' },
    server: { type: 'string', default: path.join(repo, 'bin/Omniview-server') },
    json: { type: 'string' },
  },
  strict: true,
});

function number(name, least) {
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value < least) throw new Error(`--${name} must be a number of at least ${String(least)}, it is ${JSON.stringify(flags[name])}`);
  return value;
}

const SECONDS = Math.floor(number('seconds', 1));
const STALL = number('stall', 1);
const STALL_AT = number('stall-at', 1);
const LIMIT_MIB = number('limit-mib', 0);
const CASES = { a: 'reads, never acknowledges', b: 'reads and acknowledges', c: 'two terminals, the second never reads', d: `reads ${String(STALL_AT)} s, stalls ${String(STALL)} s, resumes` };
const CASE_IDS = flags.cases.split(',').map((id) => id.trim());
for (const id of CASE_IDS) if (CASES[id] === undefined) throw new Error(`--cases names a, b, c and d, it has ${JSON.stringify(id)}`);
// The loop pauses at floor(stall-at) and resumes when `second - 1` reaches floor(stall-at) + ceil(stall): that tick has to be at most SECONDS - 1, so that a sample follows the resume.
if (CASE_IDS.includes('d') && Math.floor(STALL_AT) + Math.ceil(STALL) > SECONDS - 1) throw new Error(`--stall-at (${String(STALL_AT)}) and --stall (${String(STALL)}) leave no sample after the resume inside --seconds (${String(SECONDS)})`);

const EXEC_SERVICE = 'github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper';
const PROMPT = 'READY> ';
const FLOOD_MARK = Buffer.from('y\r\n'.repeat(3));
const PATTERN = Buffer.from('y\r\n'.repeat(1 << 16));

// The frame table of docs/ui-next/terminal-channel-protocol.md section 4, in literal numbers.
const ATTACH = 0x01;
const INPUT = 0x02;
const ACK = 0x04;
const READY = 0x81;
const OUTPUT = 0x82;
const GAP = 0x83;
const ENDED = 0x84;
const TAKEN_OVER = 0x85;
const NOT_FOUND = 0x86;

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => {
        resolve(port);
      });
    });
    probe.on('error', reject);
  });
}

async function uptime() {
  return (await exec('uptime')).stdout.trim();
}

/** The resident set of one process in KiB, as `ps -o rss= -p <pid>` says; null when the process is not there. */
async function rssOf(pid) {
  try {
    const value = Number.parseInt((await exec('ps', ['-o', 'rss=', '-p', String(pid)])).stdout.trim(), 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/** Every host this run started and has not seen exit: an interrupt stops them by pid. */
const live = new Set();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    for (const pid of live) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }

    process.exit(130);
  });
}

/** Starts the host over a fresh HOME with no plugin installed and waits until it answers; whatever fails stops the child by its pid first. */
async function startHost(work) {
  const home = path.join(work, 'home');
  await mkdir(path.join(home, '.omniview-feature-ui-next', 'plugins'), { recursive: true });
  // An empty HOME makes zsh ask its new-user questions; this file stops that and gives the prompt the tool waits for.
  await writeFile(path.join(home, '.zshrc'), `PS1='${PROMPT}'\n`);
  const port = await freePort();
  const { PATH, TMPDIR, LANG, USER } = process.env;
  const child = spawn(flags.server, [], {
    env: { PATH, TMPDIR, LANG, USER, HOME: home, OMNIVIEW_CHANNEL: 'feature-ui-next', WAILS_SERVER_HOST: '127.0.0.1', WAILS_SERVER_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      live.delete(child.pid);
      resolve({ code, signal });
    });
    child.once('error', () => {
      resolve({ code: null, signal: null });
    });
  });
  if (child.pid === undefined) throw new Error(`the host could not be started (OMNIVIEW_UI=next GOWORK=off GOFLAGS= GOTOOLCHAIN=local task build:server builds ${flags.server})`);
  live.add(child.pid);
  const host = { child, pid: child.pid, port, exited };
  const deadline = Date.now() + 60_000;
  try {
    for (;;) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('the host exited while starting');
      if (await fetch(`http://127.0.0.1:${String(port)}/`, { signal: AbortSignal.timeout(10_000) }).then((response) => response.ok, () => false)) return host;
      if (Date.now() >= deadline) throw new Error('the host did not answer in 60 s');
      await sleep(250);
    }
  } catch (error) {
    await stopHost(host);
    throw error;
  }
}

/** SIGTERM to the host by its pid, then SIGKILL by the same pid when it has not gone in 20 s. */
async function stopHost(host) {
  const before = Date.now();
  if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill('SIGTERM');
  let outcome = await Promise.race([host.exited, sleep(20_000).then(() => null)]);
  let killed = false;
  if (outcome === null) {
    killed = true;
    host.child.kill('SIGKILL');
    outcome = await Promise.race([host.exited, sleep(5000).then(() => null)]);
  }

  return { exit: outcome === null ? 'did not exit' : `code ${String(outcome.code)} signal ${String(outcome.signal)}`, killed, seconds: round((Date.now() - before) / 1000), gone: !isAlive(host.pid) };
}

/** A bound call as the page's runtime makes one, by name: the answer parsed, or an error with the method's name and the status (never the arguments, which can hold a capability). */
async function call(port, method, ...args) {
  const signal = AbortSignal.timeout(15_000);
  const response = await fetch(`http://127.0.0.1:${String(port)}/wails/runtime`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wails-client-id': 'host-memory' },
    body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `host-memory-${method}-${Date.now()}`, methodName: `${EXEC_SERVICE}.${method}`, args } }),
    signal,
  });
  const text = await response.text();
  if (response.status !== 200) throw new Error(`${method} was answered ${String(response.status)}: ${text.replaceAll(/[A-Za-z0-9_-]{43}/g, '<43 characters>')}`);
  return text === '' ? null : JSON.parse(text);
}

/** A channel terminal with the user's shell (the host runs no other program: a command that is not a known shell is refused `SHELL_UNSUPPORTED`): the answer carries the capability, which stays inside this tool. */
async function createChannelTerminal(port) {
  const session = await call(port, 'CreateTerminal', {}, { channel: true, cols: 100, rows: 30 });
  if (typeof session?.cap !== 'string' || session.cap.length === 0) throw new Error('CreateTerminal answered no capability');
  return session.cap;
}

/** One WebSocket frame to the host: a client's frame is masked. */
function clientFrame(payload) {
  const mask = randomBytes(4);
  const size = payload.length;
  const head = size < 126 ? Buffer.from([0x82, 0x80 | size]) : size < 65_536 ? Buffer.from([0x82, 0x80 | 126, size >> 8, size & 0xff]) : undefined;
  if (head === undefined) throw new Error('a frame of this tool is at most 64 KiB');
  const body = Buffer.allocUnsafe(size);
  for (let index = 0; index < size; index += 1) body[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([head, mask, body]);
}

/**
 * The page's end of one stream, over a raw socket. `reader` counts what the host sends and holds it to the pattern of `yes`; `ack` says whether it acknowledges; `pause` and `resume` stop and start reading the socket, which is the
 * stall: the kernel's buffers fill and the host's `Send` parks.
 */
async function openStream(port, cap, { ack }) {
  const socket = net.connect(port, '127.0.0.1');
  socket.setNoDelay(true);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const key = randomBytes(16).toString('base64');
  socket.write(`GET /wails/stream/ws?name=terminal HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  const stream = {
    socket,
    ack,
    received: 0,
    outputFrames: 0,
    gaps: [],
    next: null,
    head: [],
    seen: '',
    typed: false,
    floodStart: null,
    failure: null,
    badBytes: 0,
    badOffsets: 0,
    ended: null,
    closed: false,
    ready: null,
    events: [],
  };
  let pending = Buffer.alloc(0);
  let upgraded = false;
  let fragment = [];
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  readyPromise.catch(() => undefined);
  let floodResolve;
  stream.flooding = new Promise((resolve) => {
    floodResolve = resolve;
  });
  const send = (type, payload = Buffer.alloc(0)) => {
    if (!socket.destroyed) socket.write(clientFrame(Buffer.concat([Buffer.from([type]), payload])));
  };
  const onFrame = (frame) => {
    const type = frame[0];
    if (type === READY) {
      stream.ready = JSON.parse(frame.subarray(1).toString('utf8'));
      stream.next = stream.ready.start;
      if (stream.ack) {
        const zero = Buffer.alloc(4);
        send(ACK, zero);
      }

      readyResolve(stream.ready);
    } else if (type === OUTPUT) {
      const offset = Number(frame.readBigUInt64BE(1));
      const bytes = frame.subarray(9);
      stream.outputFrames += 1;
      if (offset !== stream.next) stream.badOffsets += 1;
      stream.next = offset + bytes.length;
      stream.received += bytes.length;
      if (!stream.typed) {
        // The shell is asked for `exec yes` once it has shown its prompt (the `.zshrc` of this case's HOME sets it): `exec` replaces the shell with `yes`, so that from the line it echoes the output is `y`, carriage return, line feed.
        stream.seen = (stream.seen + bytes.toString('latin1')).slice(-64);
        if (stream.seen.includes(PROMPT)) {
          stream.typed = true;
          send(INPUT, Buffer.from('exec yes\n'));
        }
      }

      if (stream.floodStart === null) {
        // Until `yes` has started the bytes are the shell's own (its prompt and the echo of the command): they are kept, and the flood begins at the first run of three lines of `y`.
        stream.head.push({ offset, bytes });
        const joined = Buffer.concat(stream.head.map((part) => part.bytes));
        const found = joined.indexOf(FLOOD_MARK);
        if (found >= 0) {
          // The offset of the byte at `found` of the joined head: the frames of the head follow each other (a bad offset is counted), so it is the first frame's offset plus `found`.
          stream.floodStart = stream.head[0].offset + found;
          floodResolve();
          const rest = joined.subarray(found);
          if (!PATTERN.subarray(0, rest.length).equals(rest)) stream.badBytes += rest.length;
          stream.head = [];
        }
      } else {
        const phase = (offset - stream.floodStart) % 3;
        if (!PATTERN.subarray(phase, phase + bytes.length).equals(bytes)) stream.badBytes += bytes.length;
      }

      if (stream.ack) {
        const n = Buffer.alloc(4);
        n.writeUInt32BE(bytes.length);
        send(ACK, n);
      }
    } else if (type === GAP) {
      const from = Number(frame.readBigUInt64BE(1));
      const to = Number(frame.readBigUInt64BE(9));
      if (from !== stream.next) stream.badOffsets += 1;
      stream.gaps.push({ from, to, bytes: to - from });
      stream.next = to;
    } else if (type === ENDED || type === TAKEN_OVER || type === NOT_FOUND) {
      stream.ended = { type: `0x${type.toString(16)}`, body: type === ENDED ? frame.subarray(1).toString('utf8') : '' };
      readyReject(new Error(`the host sent ${stream.ended.type} before ready was taken`));
    }
  };
  const parse = () => {
    for (;;) {
      if (pending.length < 2) return;
      const opcode = pending[0] & 0x0f;
      const fin = (pending[0] & 0x80) !== 0;
      let size = pending[1] & 0x7f;
      let at = 2;
      if (size === 126) {
        if (pending.length < 4) return;
        size = pending.readUInt16BE(2);
        at = 4;
      } else if (size === 127) {
        if (pending.length < 10) return;
        size = Number(pending.readBigUInt64BE(2));
        at = 10;
      }

      if (pending.length < at + size) return;
      const payload = pending.subarray(at, at + size);
      pending = pending.subarray(at + size);
      if (opcode === 8) {
        socket.end();
      } else if (opcode === 9) {
        socket.write(Buffer.concat([Buffer.from([0x8a, 0x80]), randomBytes(4)]));
      } else if (opcode === 2 || opcode === 0) {
        fragment.push(payload);
        if (fin) {
          const whole = fragment.length === 1 ? fragment[0] : Buffer.concat(fragment);
          fragment = [];
          onFrame(whole);
        }
      }
    }
  };
  socket.on('data', (chunk) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    if (!upgraded) {
      const end = pending.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = pending.subarray(0, end).toString('latin1');
      if (!/^HTTP\/1\.1 101 /.test(head)) {
        readyReject(new Error(`the stream was not upgraded: ${head.split('\r\n')[0]}`));
        socket.destroy();
        return;
      }

      const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      if (!head.includes(accept)) {
        readyReject(new Error('the upgrade answer has not the accept key of this request'));
        socket.destroy();
        return;
      }

      upgraded = true;
      pending = pending.subarray(end + 4);
      send(ATTACH, Buffer.from(JSON.stringify({ v: 1, cap })));
    }

    // A frame that cannot be parsed (a type byte alone where an offset is due) is the stream's failure: it is recorded, the open that waits for `ready` is refused, and the socket is destroyed, so that the exception never leaves the callback and `runCase` still stops its host.
    try {
      parse();
    } catch (error) {
      stream.failure = String(error?.message ?? error);
      readyReject(new Error(`the stream failed: ${stream.failure}`));
      socket.destroy();
    }
  });
  socket.on('close', () => {
    stream.closed = true;
    readyReject(new Error('the stream closed before ready'));
  });
  socket.on('error', (error) => {
    stream.events.push(String(error?.message ?? error));
  });
  stream.pause = () => socket.pause();
  stream.resume = () => socket.resume();
  stream.close = () => {
    socket.destroy();
  };
  // The caller has no handle until this returns, so a failed open destroys the socket itself; the timer is cleared on either outcome.
  const timer = new AbortController();
  try {
    stream.readyFrame = await Promise.race([readyPromise, delay(30_000, undefined, { signal: timer.signal }).then(() => {
      throw new Error('no ready in 30 s');
    })]);
  } catch (error) {
    socket.destroy();
    throw error;
  } finally {
    timer.abort();
  }

  return stream;
}

/** Waits for the first run of `yes` output on a stream, within 30 s: `ready` only says the terminal is attached, and a reader whose flood never started would sample an idle host. */
async function flooded(stream, what) {
  const timer = new AbortController();
  try {
    await Promise.race([stream.flooding, delay(30_000, undefined, { signal: timer.signal }).then(() => {
      throw new Error(`workload setup failed: no output of \`yes\` on ${what} in 30 s (the shell did not show the prompt \`${PROMPT.trim()}\`, or did not run \`exec yes\`)`);
    })]);
  } finally {
    timer.abort();
  }
}

const mib = (kib) => kib / 1024;

async function runCase(id) {
  const result = { id, title: CASES[id], uptimeBefore: await uptime(), samples: [], marks: {}, error: null, cleanup: null };
  console.log(`\ncase ${id}: ${result.title}\n  ${result.uptimeBefore}`);
  const work = await mkdtemp(path.join(os.tmpdir(), 'omniview-host-memory-'));
  let host;
  const streams = [];
  const caps = [];
  try {
    host = await startHost(work);
    result.hostPid = host.pid;
    const terminals = id === 'c' ? 2 : 1;
    for (let index = 0; index < terminals; index += 1) caps.push(await createChannelTerminal(host.port));
    const startKiB = await rssOf(host.pid);
    if (startKiB === null) throw new Error('the host has no resident set to read');
    result.samples.push({ second: 0, rssKiB: startKiB, received: 0, gaps: 0 });
    // The flood starts when the stream attaches (a new channel terminal is on its lease until then, and `yes` writes at once into the ring).
    const reader = await openStream(host.port, caps[0], { ack: id === 'b' || id === 'c' });
    streams.push(reader);
    if (id === 'c') {
      const stalled = await openStream(host.port, caps[1], { ack: false });
      streams.push(stalled);
      result.marks.stalledReaderReadyEnd = stalled.readyFrame.end;
    }

    // The sample window starts when every flood runs: `ready` is not that, and the second reader is stopped only once its own flood is confirmed.
    await flooded(reader, 'the first stream');
    if (id === 'c') {
      await flooded(streams[1], 'the second stream');
      streams[1].pause();
    }

    result.marks.readyLimits = reader.readyFrame.session?.limits ?? null;
    const origin = performance.now();
    let stalledAt = null;
    let resumedAt = null;
    for (let second = 1; second <= SECONDS; second += 1) {
      const due = origin + second * 1000;
      if (id === 'd') {
        if (stalledAt === null && second > STALL_AT) {
          reader.pause();
          stalledAt = second - 1;
        } else if (stalledAt !== null && resumedAt === null && second - 1 >= stalledAt + STALL) {
          reader.resume();
          resumedAt = second - 1;
        }
      }

      await sleep(due - performance.now());
      const rssKiB = await rssOf(host.pid);
      if (rssKiB === null) throw new Error(`the host was gone at second ${String(second)}`);
      const sample = { second, rssKiB, received: reader.received, gaps: reader.gaps.length };
      result.samples.push(sample);
      process.stdout.write(`  ${String(second).padStart(2)} s  rss ${mib(rssKiB).toFixed(1)} MiB  received ${(reader.received / MIB).toFixed(1)} MiB  gaps ${String(reader.gaps.length)}\n`);
    }

    for (const stream of streams) if (stream.failure !== null) throw new Error(`a stream failed: ${stream.failure}`);
    result.marks.stalledAtSecond = stalledAt;
    result.marks.resumedAtSecond = resumedAt;
    if (id === 'c') {
      // What the stalled reader holds in the kernel is read now, when it reads: one `gap` then the exact bytes is the same law as case d.
      streams[1].resume();
      await sleep(2000);
    }

    result.uptimeAfter = await uptime();
  } catch (error) {
    result.error = String(error?.stack ?? error).replaceAll(/[A-Za-z0-9_-]{43}/g, '<43 characters>');
    console.log(`  ERROR ${result.error}`);
  } finally {
    // Whatever happened, what the streams counted is kept: a case that failed halfway still reports its figures and its error.
    result.marks.streams = streams.map((stream) => ({
      received: stream.received,
      outputFrames: stream.outputFrames,
      gaps: stream.gaps,
      nextOffset: stream.next,
      readyStart: stream.ready?.start ?? null,
      readyEnd: stream.ready?.end ?? null,
      readyLost: stream.ready?.lost ?? null,
      floodStart: stream.floodStart,
      badBytes: stream.badBytes,
      badOffsets: stream.badOffsets,
      failure: stream.failure,
      ended: stream.ended,
      closed: stream.closed,
    }));
    for (const stream of streams) stream.close();
    if (host !== undefined) {
      for (const cap of caps) await call(host.port, 'CloseChannelTerminal', cap).catch(() => undefined);
      const stopped = await stopHost(host);
      result.cleanup = { ...stopped, pidLeft: isAlive(host.pid) };
      console.log(`  host ${String(host.pid)} stopped by its pid: ${stopped.exit}, ${String(stopped.seconds)} s${stopped.killed ? ', killed' : ''}${result.cleanup.pidLeft ? '; STILL ALIVE' : ''}`);
    }

    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => undefined);
  }

  return result;
}

/** What is wrong with the bytes a case received, apart from the memory: the flood did not start, a frame could not be parsed, a byte or an offset was not what `yes` and the protocol say, or case d had not exactly one gap. Empty is sound. The memory limit is not part of it. */
function integrity(result) {
  const streams = result.marks.streams ?? [];
  if (streams.length === 0) return ['no stream counters'];
  const problems = [];
  for (const [index, stream] of streams.entries()) {
    const name = `stream ${String(index + 1)}`;
    if (stream.failure !== null) problems.push(`${name} failed: ${stream.failure}`);
    if (stream.floodStart === null) problems.push(`${name} saw no flood`);
    if (stream.badBytes !== 0) problems.push(`${name} has ${String(stream.badBytes)} bad bytes`);
    if (stream.badOffsets !== 0) problems.push(`${name} has ${String(stream.badOffsets)} bad offsets`);
  }

  if (result.id === 'd' && streams[0].gaps.length !== 1) problems.push(`stream 1 had ${String(streams[0].gaps.length)} gaps, the stall of case d must give exactly one`);
  return problems;
}

function figures(result) {
  if (result.samples.length < 2) return undefined;
  const rss = result.samples.map((sample) => mib(sample.rssKiB));
  const start = rss[0];
  const max = Math.max(...rss);
  const end = rss.at(-1);
  const first = result.marks.streams?.[0];
  return {
    startMiB: round(start),
    maxMiB: round(max),
    endMiB: round(end),
    maxOverStartMiB: round(max - start),
    pass: max - start <= LIMIT_MIB,
    receivedMiB: first === undefined ? null : round(first.received / MIB),
    gaps: first?.gaps ?? null,
    badBytes: first?.badBytes ?? null,
    badOffsets: first?.badOffsets ?? null,
  };
}

function printReport(results) {
  console.log(`\n=== host resident set (ps -o rss= of the pid this tool started) under \`yes\` on the terminal channel; MiB = 1,048,576 bytes; limit: at most ${String(LIMIT_MIB)} MiB over the start; ${String(SECONDS)} s a case ===`);
  const rows = [['case', 'start', 'max', 'end', 'max-start', 'received MiB', 'gaps', 'bad bytes', 'bad offsets', 'memory', 'integrity']];
  for (const result of results) {
    const f = figures(result);
    const sound = integrity(result).length === 0 && result.error === null ? 'PASS' : 'FAIL';
    const count = (value) => (value === null ? '-' : String(value));
    rows.push(f === undefined ? [result.id, 'no samples', '', '', '', '', '', '', '', 'ERROR', sound] : [result.id, f.startMiB.toFixed(1), f.maxMiB.toFixed(1), f.endMiB.toFixed(1), f.maxOverStartMiB.toFixed(1), count(f.receivedMiB), f.gaps === null ? '-' : String(f.gaps.length), count(f.badBytes), count(f.badOffsets), f.pass ? 'PASS' : 'FAIL', sound]);
  }

  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  for (const row of rows) console.log(row.map((cell, column) => String(cell).padStart(widths[column])).join('  '));
  for (const result of results) {
    console.log(`\ncase ${result.id} (${result.title}), host pid ${String(result.hostPid)}`);
    console.log(`  ${result.uptimeBefore}`);
    for (const [index, stream] of (result.marks.streams ?? []).entries()) {
      const gaps = stream.gaps.map((gap) => `[${String(gap.from)}, ${String(gap.to)}) ${String(gap.bytes)} bytes`).join('; ');
      console.log(`  stream ${String(index + 1)}: ready start ${String(stream.readyStart)} end ${String(stream.readyEnd)} lost ${String(stream.readyLost)}; received ${String(stream.received)} bytes in ${String(stream.outputFrames)} frames; gaps ${String(stream.gaps.length)}${gaps === '' ? '' : ` (${gaps})`}; next offset ${String(stream.nextOffset)}; received + gaps = ${String(stream.received + stream.gaps.reduce((sum, gap) => sum + gap.bytes, 0))} (+ start ${String(stream.readyStart)}); bad bytes ${String(stream.badBytes)}, bad offsets ${String(stream.badOffsets)}; ended ${stream.ended === null ? 'no' : stream.ended.type}; closed ${String(stream.closed)}`);
    }

    if (result.marks.stalledAtSecond !== undefined && result.marks.stalledAtSecond !== null) console.log(`  stalled after second ${String(result.marks.stalledAtSecond)}, resumed after second ${String(result.marks.resumedAtSecond)}`);
    for (const problem of integrity(result)) console.log(`  INTEGRITY ${problem}`);
    if (result.error !== null) console.log(`  ERROR ${result.error.split('\n')[0]}`);
    if (result.cleanup !== null) console.log(`  cleanup: host ${result.cleanup.exit}${result.cleanup.killed ? ' (killed by pid)' : ''}${result.cleanup.pidLeft ? '; PID LEFT' : '; pid gone'}`);
  }
}

const results = [];
for (const id of CASE_IDS) results.push(await runCase(id));
printReport(results);
if (flags.json !== undefined) {
  await writeFile(flags.json, `${JSON.stringify({ seconds: SECONDS, limitMiB: LIMIT_MIB, results: results.map((result) => ({ ...result, figures: figures(result) ?? null })) }, null, 1)}\n`);
  console.log(`\nwritten: ${flags.json}`);
}

process.exitCode = results.some((result) => result.error !== null || integrity(result).length > 0 || result.cleanup?.pidLeft === true) ? 1 : 0;

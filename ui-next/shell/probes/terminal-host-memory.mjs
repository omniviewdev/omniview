// What the real host's memory does under a flood while the Terminal tool's page reads it (docs/ui-next/status/T1-go.md 2.8.6, and B-110 of the backend catalog), and what that flood costs the page. A tool to run by hand, not a CI
// probe: its name does not end in `-probe.mjs`, so the probe table never lists it, and it asserts nothing: it measures and prints. Every case starts a host of its own (a fresh HOME, a free port, no plugin installed) and a browser of
// its own, opens the window as the native app opens it, starts the host's shell from the Terminal tool, types a flood into it, and takes one sample a second of the host process's resident set (`ps -o rss= -p <pid>`, the pid of the
// process this tool spawned) together with what the page has parsed (the sum of the byte counts of the page's own `AckTerminal` calls: the screen sends one for every byte its emulator has parsed) and what the page costs (below). The
// page is never changed: the calls are read from the browser's request events, case 3 answers them from a route of the page, and the one thing this tool puts into the page is an observer of long tasks (Chromium).
//
//   node ui-next/shell/probes/terminal-host-memory.mjs                     the cases 1, 2, 3 and 5: 5 s of baseline and 25 s of flood each, in Chromium (about 1.5 minutes a case)
//   node ui-next/shell/probes/terminal-host-memory.mjs --cases=1,2,5 --seconds=10 --engine=webkit --json=/tmp/hostmem.json
//
//   --cases=1,2,3,5     which cases to run, in that order (4 is a variant of case 3, below)
//   --seconds=25        the length of the flood window of every case
//   --baseline=5        seconds of samples before the flood starts, with the terminal idle at its prompt
//   --hide-after=0.5    cases 2, 4 and 5: seconds after the flood starts at which the panel is hidden, or the second terminal is shown (the click takes a moment more on a busy page: the report says when it was confirmed; a hide that has not begun when the flood window ends never does)
//   --resume=6          cases 2, 4 and 5: seconds sampled after the flooded terminal is shown again (the flood goes on)
//   --settle=5          seconds sampled at least after the flood is stopped with Ctrl+C, and until the shell has no flood process and the page has parsed all it received (at most --drain)
//   --drain=90          the most seconds to wait for that. --seconds, --baseline and --drain are at least 1: a window that cannot take a sample (one a second, the first one second in) is refused before any host starts
//   --tail=30           seconds sampled after the terminal was closed
//   --flood=<command>   what is typed into the shell. The default, `seq -f %.0f 1 100000000`, does not end in any window this tool runs (the BSD `seq` of a Mac writes a line at a time: about 2.5 MB/s and 145,000 reads a second of
//                       17 bytes, measured through a pty) and gives a whole number to read back (without `-f` a tty makes it print `1.07444e+06` from a million on); `yes` is the other flood to run (about 72 MB/s in reads of
//                       about 1,000 bytes: the review's flood for B-110)
//   --engine=chromium   chromium or webkit (the engine's own browser, from the kit's probe library)
//   --rss-cap-mib=12288 a case stops its flood when the host's resident set passes this, and says so: a hide that is still waiting is cancelled, one that is in progress is given 2 s to show whether it took effect (not the 30 s of its confirmation), no resume sample is waited for, and Ctrl+C goes to the flooded terminal's own input after the terminal was put back on screen (5 s deadline) if it was off it
//   --pprof             starts the host with its pprof listener (OMNIVIEW_PPROF_PORT=0) and adds the Go runtime's memory figures to every sample (`heap?debug=1`, the runtime's MemStats); after the tail it asks for a garbage
//                       collection and takes three more samples, which say how much of the resident set was live. A listener that is idle changes nothing for the host, but a run with it is a run of its own: compare it with one without
//   --server=<path>     the host's binary (default bin/Omniview-server, which `OMNIVIEW_UI=next task build:server` builds)
//   --json=<file>       every sample of every case, and the figures, as JSON
//
// The cases:
//   1  the terminal is shown and the page does what the product does: it acknowledges every byte its emulator parses, so the host paces the shell by what the page took in
//   2  the panel is hidden right after the flood starts (the status bar's toggle). The product's hidden screen goes on reading, parsing and acknowledging, in smaller frames, and draws nothing, so the flood is credited as in case 1. (The
//      product's first version read nothing while hidden: the host paused the shell at 1 MiB and this case was flat, +124 MiB.) After the flood window the panel is shown again for --resume seconds
//   3  the terminal is shown, and the page's `AckTerminal` calls never reach the host: a route of the page answers each one with the host's own answer (`{}`), the first included, so the host never has its flow control turned
//      on and stays in transport-credit mode: the behaviour of a reader that keeps up and never acknowledges (B-110, row 7 of docs/ui-next/status/T1-go.md 2.8.6)
//   4  case 3 with the panel hidden right after the flood starts: the host in transport-credit mode and a hidden screen. With the product's first version, whose hidden screen read nothing, this was the control of case 3's route (the
//      shell stayed unpaused only if the calls were held back); now the hidden screen reads on, so it is one more figure and no control
//   5  two terminals: the flood runs in the first, and the second is shown with the panel visible, so the flooded session is one that is not on screen; after the flood window the first is shown again for --resume seconds
//
// What it reads, and what it does not: the host's resident set is the host process alone (not its shell, not its plugins). `parsed` is bytes the emulator has parsed, so it is the page's progress and not the shell's. A sample is stamped when
// it begins and the page's acknowledgements are counted at that instant, before its readings (tens of milliseconds) are awaited, so a rate is the change between two stamps. With `seq -f %.0f 1 <n>` as the flood (the one form whose every line
// is a whole number: a Mac's plain `seq` prints `1.07444e+06` from a million on) the tool also reads the last number back, from the emulator (select all, copy) and from the host's replay of the session (`AttachSession`), and holds the page's count
// to the bytes of `seq` up to the emulator's number. It reads them only once the stop phase has settled, the flood process gone and the page quiet for 2 s: `AttachSession` forgets the host's debt of what is in flight, so it is never called while
// anything flows, and a stop phase that ended at --drain before that reads neither and says so. A number is valid when it is a whole number from 1 to <n>; where there is none the report says "none valid" and makes no byte comparison. `ps`
// counts only the pages that are resident, and a Mac compresses what an idle process does not touch, so a resident set that falls after the flood may be the compressor and not the host giving memory back: the report also gives the physical
// footprint (`footprint -p`, compressed pages included) at the end of the baseline and of the flood and in every sample after it, and with --pprof the Go runtime's own figures.
//
// What the page costs, read once a second as cumulative figures whose differences the report prints (over the flood window less its first second, so the click that hides the panel and the start of the command are not in it).
// Chromium: `Performance.getMetrics` (TaskDuration: the seconds the page's main thread spent in tasks, which is what `busy` says; ScriptDuration: those in script; JSHeapUsedSize), `SystemInfo.getProcessInfo` (the CPU seconds of the
// renderer, GPU and browser processes) and the long tasks (over 50 ms) of a `PerformanceObserver` this tool installs before the page's own scripts. WebKit has none of these metrics, and it starts its web content process through
// launchd, so it is nobody's child and the other WebKit pages of a shared machine cannot be told from this one by name: the tool finds it by a pulse (three bursts of 700 ms of a busy loop in the page, 700 ms of rest between: the
// one process whose CPU seconds follow it) and reads its CPU seconds from `ps -o time=` (a resolution of 10 ms). When it cannot find exactly one, the WebKit cost is not reported.
import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const exec = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const MIB = 1024 * 1024;
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
/** A number for a table cell: `-` where it was not measured. */
const fixed = (value, digits = 0) => (value === null || value === undefined ? '-' : value.toFixed(digits));

const { values: flags } = parseArgs({
  options: {
    cases: { type: 'string', default: '1,2,3,5' },
    seconds: { type: 'string', default: '25' },
    baseline: { type: 'string', default: '5' },
    'hide-after': { type: 'string', default: '0.5' },
    resume: { type: 'string', default: '6' },
    settle: { type: 'string', default: '5' },
    drain: { type: 'string', default: '90' },
    tail: { type: 'string', default: '30' },
    flood: { type: 'string', default: 'seq -f %.0f 1 100000000' },
    engine: { type: 'string', default: 'chromium' },
    'rss-cap-mib': { type: 'string', default: '12288' },
    server: { type: 'string', default: path.join(repo, 'bin/Omniview-server') },
    json: { type: 'string' },
    pprof: { type: 'boolean', default: false },
  },
  strict: true,
});

function count(name) {
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a number of at least 0, it is ${JSON.stringify(flags[name])}`);
  return value;
}

/** A window the report is made of: it has to be long enough for a sample (one a second, the first one second in), or its phase has nothing to say and a figure of it would be read from a sample that is not there. Refused before any host starts. */
function sampled(name) {
  const value = count(name);
  if (value < 1) throw new Error(`--${name} must be at least 1: a sample is taken each second, the first one second in, and it is ${JSON.stringify(flags[name])}`);
  return value;
}

const FLOOD_SECONDS = sampled('seconds');
const BASELINE_SECONDS = sampled('baseline');
const HIDE_AFTER_SECONDS = count('hide-after');
const RESUME_SECONDS = count('resume');
const SETTLE_SECONDS = count('settle');
const DRAIN_SECONDS = sampled('drain');
const TAIL_SECONDS = count('tail');
const RSS_CAP_MIB = count('rss-cap-mib');
const FLOOD = flags.flood.trim();
const FLOOD_PROGRAM = FLOOD.split(/\s+/)[0];
/** `seq -f %.0f 1 <n>` is the one flood whose progress can be read back, because every line it prints is a whole number (a Mac's plain `seq` prints `1.07444e+06` from a million on, which no comparison can read). `SEQUENCE_END` is its <n>. */
const SEQUENCE_MATCH = /^seq -f %\.0f 1 (\d+)$/.exec(FLOOD);
const SEQUENCE = SEQUENCE_MATCH !== null;
const SEQUENCE_END = SEQUENCE ? Number(SEQUENCE_MATCH[1]) : 0;
if (ENGINES[flags.engine] === undefined) throw new Error(`--engine must be one of ${Object.keys(ENGINES).join(', ')}, it is ${JSON.stringify(flags.engine)}`);

/** The longest a call of the host that this tool makes for itself may take, from its request to the last byte of its answer. */
const CALL_MS = 15_000;
/** A hide that is in progress when the flood window ends: its click and its confirmation are given `HIDE_SETTLE_MS`, and the confirmation, which waits 30 s when nothing cuts it, is cut to a grace of `HIDE_GRACE_MS`. */
const HIDE_SETTLE_MS = 5000;
const HIDE_GRACE_MS = 2000;
/** The deadline for putting the flooded terminal back on screen, which Ctrl+C needs. */
const RESTORE_MS = 5000;

/** `terminals`: how many sessions the page has. `hide`: what takes the flooded one off the screen (`panel`: the status bar's toggle; `session`: the second terminal is shown), or false. `hold`: the page's acknowledgements do not reach the host. */
const CASES = {
  1: { title: 'shown, the page acknowledges what it parses', terminals: 1, hide: false, hold: false },
  2: { title: 'panel hidden right after the flood starts, its screen goes on parsing and acknowledging', terminals: 1, hide: 'panel', hold: false },
  3: { title: "shown, the page's AckTerminal calls never reach the host", terminals: 1, hide: false, hold: true },
  4: { title: "panel hidden right after the flood starts, and the page's AckTerminal calls never reach the host", terminals: 1, hide: 'panel', hold: true },
  5: { title: 'two terminals, the flood in the first, the second shown (the panel stays visible)', terminals: 2, hide: 'session', hold: false },
};
const CASE_IDS = flags.cases.split(',').map((id) => id.trim());
for (const id of CASE_IDS) if (CASES[id] === undefined) throw new Error(`--cases names 1, 2, 3, 4 and 5, it has ${JSON.stringify(id)}`);

const EXEC_SERVICE = 'github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper';

/** The id the host's bindings give a method (`$Call.ByID`): the 32-bit FNV-1a hash of its full name. The page's call carries that and not the name. */
function methodIdOf(service, method) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(`${service}.${method}`)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

const ACK_ID = methodIdOf(EXEC_SERVICE, 'AckTerminal');

/** The host's answer to a call that returns nothing, as read from the real host (status 200, application/json, the two characters `{}`): case 3 gives it to the page in the host's place. */
const ACK_ANSWER = { status: 200, contentType: 'application/json', body: '{}' };

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

/**
 * The physical footprint of one process in MiB, as macOS's `footprint -p <pid>` says it: what the kernel charges the process, compressed pages included, where `ps` reports only the pages that are resident. A Mac compresses what an
 * idle process does not touch, so a resident set that falls after a flood may be the compressor and not the process giving anything back. It walks the process's regions (about 80 ms) without stopping it, and is taken at the end of
 * the baseline and of the flood and in every sample after the flood, never in the middle of one. Null where the command does not exist or cannot say.
 */
async function footprintOf(pid) {
  try {
    const found = /Footprint:\s+([\d.]+)\s*(B|KB|MB|GB)\b/.exec((await exec('footprint', ['-p', String(pid)])).stdout);
    if (found === null) return null;
    return round(Number(found[1]) * { B: 1 / MIB, KB: 1 / 1024, MB: 1, GB: 1024 }[found[2]]);
  } catch {
    return null;
  }
}

/** `[[dd-]hh:]mm:ss.cc` as seconds. */
function cpuSeconds(text) {
  const [days, rest] = text.includes('-') ? text.split('-') : ['0', text];
  const parts = rest.split(':').map(Number);
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return Number(days) * 86_400 + seconds;
}

/** Every process of the machine: what `ps` says of its parent, size, state, cpu time and executable. */
async function processTable() {
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,rss=,stat=,time=,comm='], { maxBuffer: 32 * MIB });
  const rows = [];
  for (const line of stdout.split('\n')) {
    const found = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (found !== null) rows.push({ pid: Number(found[1]), ppid: Number(found[2]), rssKiB: Number(found[3]), stat: found[4], cpu: cpuSeconds(found[5]), comm: found[6] });
  }

  return rows;
}

/** The processes under `root`, children first by level, with `root` itself left out. */
function descendantsOf(table, root) {
  const found = [];
  const seen = new Set([root]);
  for (let queue = [root]; queue.length > 0; ) {
    const next = [];
    for (const row of table) {
      if (queue.includes(row.ppid) && !seen.has(row.pid)) {
        seen.add(row.pid);
        found.push(row);
        next.push(row.pid);
      }
    }

    queue = next;
  }

  return found;
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

/**
 * Starts the host as the seam does (a minimal environment, nothing ambient reaches it), over a fresh HOME with no plugin installed, and waits until it answers. Until it returns the handle this function is the only one that can stop
 * the child and close its log, so whatever makes it fail (a binary that cannot be started, a host that exits while starting or never answers, a pprof listener it does not announce) stops the child by its pid and closes the log
 * first, and the error it throws carries how that went (`cleanup`, in the shape of a finished case's).
 */
async function startHost(work) {
  const home = path.join(work, 'home');
  await mkdir(path.join(home, '.omniview-feature-ui-next', 'plugins'), { recursive: true });
  const port = await freePort();
  const logFile = path.join(work, 'host.log');
  const log = createWriteStream(logFile);
  // What goes wrong with the log or the child where nothing awaits it: an 'error' event that nobody listens for ends this process.
  const errors = [];
  log.on('error', (error) => {
    errors.push(error);
  });
  const { PATH, TMPDIR, LANG, USER } = process.env;
  let child;
  try {
    child = spawn(flags.server, [], {
      env: { PATH, TMPDIR, LANG, USER, HOME: home, OMNIVIEW_CHANNEL: 'feature-ui-next', WAILS_SERVER_HOST: '127.0.0.1', WAILS_SERVER_PORT: String(port), ...(flags.pprof ? { OMNIVIEW_PPROF_PORT: '0' } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    log.end();
    throw error;
  }

  // A binary that cannot be started (it is not there, it cannot be executed) is an 'error' event of the child and never an exit: the listener is in place before anything is awaited, and the exit promise settles for it, so that
  // nothing waits for a process that never ran.
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      live.delete(child.pid);
      resolve({ code, signal });
    });
    child.on('error', (error) => {
      errors.push(error);
      if (child.pid === undefined) resolve({ code: null, signal: null });
    });
  });
  if (child.pid !== undefined) live.add(child.pid);
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  const base = `http://127.0.0.1:${String(port)}`;
  const host = { child, pid: child.pid, base, logFile, log, exited, errors, pprof: undefined };
  try {
    if (child.pid === undefined) {
      await exited;
      throw new Error(`the host could not be started: ${String(errors[0]?.message ?? 'spawn failed')} (OMNIVIEW_UI=next task build:server builds it)`);
    }

    // Readiness: the host answers on its port, within 60 s, and no try waits more than 10 s, so that a server that accepts a connection and never answers cannot hold the loop past its deadline.
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`the host exited while starting (see ${logFile})`);
      if (await fetch(`${base}/`, { signal: AbortSignal.timeout(10_000) }).then((response) => response.ok, () => false)) break;
      if (Date.now() >= deadline) throw new Error(`the host did not answer in 60 s (see ${logFile})`);
      await sleep(250);
    }

    // Where its pprof listens is a question of its own, with its own deadline: a host that answers and does not say is not an unavailable server.
    if (flags.pprof) host.pprof = await pprofOrigin(logFile, child);
    return host;
  } catch (error) {
    // The handle is not returned, so nobody else can stop the host or close its log.
    const stopped = await stopHost(host).catch((failed) => ({ exit: `could not be stopped: ${String(failed?.message ?? failed)}`, killed: false, seconds: 0, gone: false, errors: [] }));
    const left = host.pid !== undefined && isAlive(host.pid) ? [host.pid] : [];
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { cleanup: { ...stopped, pidsLeft: left, hostStillListed: left.length > 0 } });
  }
}

/** What `promise` resolves with, or null once `ms` have passed; the timer is cleared as soon as `promise` settles, so that it does not hold this process up after the run. */
async function within(ms, promise) {
  const timer = new AbortController();
  try {
    return await Promise.race([promise, delay(ms, null, { signal: timer.signal })]);
  } finally {
    timer.abort();
  }
}

/** SIGTERM to the host by its pid, then SIGKILL by the same pid when it has not gone in 20 s, and the log is closed; says how it went. A host that never started has no pid and nothing to stop. */
async function stopHost(host) {
  const before = Date.now();
  const said = () => host.errors.map((error) => String(error?.message ?? error));
  if (host.pid === undefined) {
    host.log.end();
    return { exit: 'never started', killed: false, seconds: 0, gone: true, errors: said() };
  }

  if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill('SIGTERM');
  let outcome = await within(20_000, host.exited);
  let killed = false;
  if (outcome === null) {
    killed = true;
    host.child.kill('SIGKILL');
    outcome = await within(5000, host.exited);
  }

  host.log.end();
  return { exit: outcome === null ? 'did not exit' : `code ${String(outcome.code)} signal ${String(outcome.signal)}`, killed, seconds: round((Date.now() - before) / 1000, 1), gone: !isAlive(host.pid), errors: said() };
}

/**
 * The origin of the host's pprof listener: `OMNIVIEW_PPROF_PORT=0` picks a free port and the host says which in its log. It has its own 15 s, counted from when the host answers, and it ends at once if the host exits, so a host that
 * does not say is told apart from one that does not answer.
 */
async function pprofOrigin(logFile, child) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const found = /host pprof listening[^\n]*?"url":\s*"([^"]+)"/.exec(await readFile(logFile, 'utf8').catch(() => ''));
    if (found !== null) return new URL(found[1]).origin;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`the host exited before it said where its pprof listens (see ${logFile})`);
    if (Date.now() >= deadline) throw new Error(`the host answers but did not say where its pprof listens in 15 s (see ${logFile})`);
    await sleep(250);
  }
}

/** The Go runtime's memory figures from the host's pprof (`heap?debug=1` ends with the runtime's MemStats), sizes in MiB. `collect` runs a garbage collection first. Null when it cannot be read. */
async function memstats(origin, collect = false) {
  try {
    const text = await (await fetch(`${origin}/debug/pprof/heap?debug=1${collect ? '&gc=1' : ''}`, { signal: AbortSignal.timeout(5000) })).text();
    const stat = (name) => {
      const found = new RegExp(`^# ${name} = (\\d+)$`, 'm').exec(text);
      return found === null ? null : Number(found[1]);
    };
    const size = (name) => (stat(name) === null ? null : round(stat(name) / MIB, 1));
    return { heapAllocMiB: size('HeapAlloc'), heapInuseMiB: size('HeapInuse'), heapIdleMiB: size('HeapIdle'), heapReleasedMiB: size('HeapReleased'), heapSysMiB: size('HeapSys'), nextGCMiB: size('NextGC'), objects: stat('HeapObjects'), numGC: stat('NumGC') };
  } catch {
    return null;
  }
}

/**
 * A call of a bound method as the page's runtime makes one, by name, whatever answers: the status and the text. Used only to read, never while a flood runs. It has `CALL_MS` from its request to the last byte of its answer (the body is read
 * under the same signal), and what it raises, a refusal or the deadline, reaches the case, which stops the host and reports.
 */
async function call(base, method, ...args) {
  const signal = AbortSignal.timeout(CALL_MS);
  try {
    const response = await fetch(`${base}/wails/runtime`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wails-client-id': 'host-memory' },
      body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `host-memory-${method}-${Date.now()}`, methodName: `${EXEC_SERVICE}.${method}`, args } }),
      signal,
    });
    const text = await response.text();
    if (response.status !== 200) throw new Error(`${method} was answered ${String(response.status)}: ${text}`);
    return JSON.parse(text);
  } catch (error) {
    if (signal.aborted) throw new Error(`${method} did not answer within ${String(CALL_MS / 1000)} s, its request and the whole of its answer together`, { cause: error });
    throw error;
  }
}

/** The bytes `seq -f %.0f 1 n` writes into a terminal: each number, a carriage return and a line feed (the pty's line discipline adds the return). */
function seqBytes(n) {
  let total = 0;
  for (let digits = 1, low = 1; low <= n; digits += 1, low *= 10) {
    total += (Math.min(n, low * 10 - 1) - low + 1) * (digits + 2);
  }

  return total;
}

const plain = (text) => text.replace(/\u001b\[[0-9;?<>=]*[ -/]*[@-~]/g, '').replaceAll('\r', '');

/** The last line that is a whole number, which is how far `seq -f %.0f` got in a transcript: null when there is none, or when it is not a number `seq` could have printed (below 1, or past its end `end`), which is no final number to hold anything to. */
function lastNumber(text, end) {
  const numbers = plain(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
  const last = numbers.length === 0 ? null : Number(numbers.at(-1));
  return last !== null && Number.isSafeInteger(last) && last >= 1 && last <= end ? last : null;
}

/** The call of the host a request of the page makes, read from its body (a call carries the id of its method). */
function ackOf(request) {
  if (request.method() !== 'POST' || !request.url().endsWith('/wails/runtime')) return undefined;
  let body;
  try {
    body = JSON.parse(request.postData() ?? '');
  } catch {
    return undefined;
  }

  const wanted = body?.args;
  if (wanted?.methodID !== ACK_ID && wanted?.methodName !== `${EXEC_SERVICE}.AckTerminal`) return undefined;
  const [session, bytes] = wanted.args ?? [];
  return { session, bytes: Number(bytes) };
}

/** A test browser refuses the clipboard: the page's copy lands where this tool can read it. */
async function keepCopies(page) {
  await page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copied.push(text);
        },
      },
    });
  });
}

/** What the emulator holds, scrollback and screen, read as a person copies it: select all, copy. */
async function bufferOf(page, mac) {
  await page.evaluate(() => {
    window.__copied.length = 0;
  });
  await page.keyboard.press(mac ? 'Meta+a' : 'Control+Shift+A');
  await page.keyboard.press(mac ? 'Meta+c' : 'Control+Shift+C');
  for (let waited = 0; waited < 30_000; waited += 200) {
    if (await page.evaluate(() => window.__copied.length > 0)) return page.evaluate(() => window.__copied.at(-1));
    await sleep(200);
  }

  throw new Error('the copy of the emulator buffer did not arrive in 30 s');
}

/** Waits until `ready` answers true, polling every 200 ms. */
async function waitUntil(what, ready, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await sleep(200);
  }

  throw new Error(`timed out after ${String(ms)} ms waiting for ${what}`);
}

/** Sums the long tasks (over 50 ms) of the page's main thread, from before the page's own scripts: Chromium only (WebKit has no long task entries). */
const LONG_TASKS = `(() => {
  window.__long = { ms: 0, count: 0, max: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__long.ms += entry.duration;
        window.__long.count += 1;
        window.__long.max = Math.max(window.__long.max, entry.duration);
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    window.__long = null;
  }
})()`;

/**
 * What a Chromium page costs, as cumulative figures: what the page's own metrics say of its main thread (`Performance.getMetrics`: TaskDuration, ScriptDuration and ThreadTime in seconds, the JS heap in bytes), the CPU seconds the
 * browser says each of its processes used (`SystemInfo.getProcessInfo`), and the long tasks the observer summed (their total and count are cumulative; `longMax`, the longest one, is the longest since the sample before: a read takes it
 * and starts again). Each read has 0.9 s to answer, so a page whose main thread is saturated costs a sample that figure and not the whole sample.
 */
async function chromiumCost(browser, page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const system = await browser.newBrowserCDPSession();
  const soon = (promise) => Promise.race([promise.catch(() => null), sleep(900).then(() => null)]);
  return async () => {
    const [metrics, processes, long] = await Promise.all([
      soon(cdp.send('Performance.getMetrics')),
      soon(system.send('SystemInfo.getProcessInfo')),
      soon(
        page.evaluate(() => {
          const seen = window.__long;
          if (seen === null || seen === undefined) return null;
          const copy = { ms: seen.ms, count: seen.count, max: seen.max };
          seen.max = 0;
          return copy;
        }),
      ),
    ]);
    const m = Object.fromEntries((metrics?.metrics ?? []).map(({ name, value }) => [name, value]));
    const cpu = (type) => (processes === null ? null : processes.processInfo.filter((info) => info.type === type).reduce((sum, info) => sum + info.cpuTime, 0));
    return {
      heap: m.JSHeapUsedSize ?? null,
      task: m.TaskDuration ?? null,
      script: m.ScriptDuration ?? null,
      thread: m.ThreadTime ?? null,
      renderer: cpu('renderer'),
      gpu: cpu('GPU'),
      browser: cpu('browser'),
      longMs: long?.ms ?? null,
      longCount: long?.count ?? null,
      longMax: long?.max ?? null,
    };
  };
}

/** The web content processes of Playwright's WebKit: they are children of launchd, one for each page of every agent on this machine. */
const WEB_CONTENT = /\/ms-playwright\/webkit-[^/]*\/com\.apple\.WebKit\.WebContent/;

/**
 * The web content process of a WebKit page: the one whose CPU seconds follow a pulse this tool makes in the page, three bursts of 700 ms of a busy loop with 700 ms of rest between, sampled at each edge. It is the page's when every
 * burst gave it at least 0.45 s of CPU and every rest at most 0.25 s, and the only one when no other process of the machine does (a page that is busy all the time gains in the rests, and a quiet one in the bursts). Null when none or
 * more than one does, after a second try.
 */
async function webContentOf(page) {
  const candidates = async () => new Map((await processTable()).filter((row) => WEB_CONTENT.test(row.comm)).map((row) => [row.pid, row.cpu]));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const series = [await candidates()];
    const started = performance.now();
    const pulse = page.evaluate(async () => {
      const burn = (ms) => {
        const end = performance.now() + ms;
        let n = 0;
        while (performance.now() < end) n += Math.sqrt(n + 1);
        return n;
      };

      for (let burst = 0; burst < 3; burst += 1) {
        burn(700);
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    });
    for (let step = 1; step <= 6; step += 1) {
      await sleep(started + step * 700 - performance.now());
      series.push(await candidates());
    }

    await pulse;
    const fits = [...series[0].keys()].filter(
      (pid) =>
        series.every((seen) => seen.has(pid)) &&
        series.slice(1).every((seen, step) => {
          const gained = seen.get(pid) - series[step].get(pid);
          return step % 2 === 0 ? gained >= 0.45 : gained <= 0.25;
        }),
    );
    if (fits.length === 1) return fits[0];
    await sleep(1000);
  }

  return null;
}

/**
 * One sample: the host's resident set (and, when asked, its footprint), what the page has acknowledged so far, what it costs (Chromium's own metrics, or the CPU seconds of the page's web content process in WebKit), and what `ps`
 * says of the host's processes and of the flood's. A host that is gone ends the case.
 */
async function take(run, phase, second, withFootprint) {
  const at = performance.now();
  // What the page has acknowledged is counted at the instant the sample is stamped, before the readings are awaited (they take tens of milliseconds, in which the count moves): a rate between two samples is the change between two stamps.
  const acked = run.acks.bytes;
  const calls = run.acks.calls;
  const [rssKiB, table, metered, go, footprint] = await Promise.all([rssOf(run.pid), processTable(), run.costOf(), run.memstats(), withFootprint ? footprintOf(run.pid) : null]);
  if (rssKiB === null) throw new Error(`the host process ${String(run.pid)} was gone at ${String(round((at - run.origin) / 1000, 1))} s (${phase})`);
  const tree = descendantsOf(table, run.pid).filter((row) => !run.before.has(row.pid));
  for (const row of tree) run.seen.add(row.pid);
  const flood = tree.find((row) => path.basename(row.comm) === FLOOD_PROGRAM);
  const self = table.find((row) => row.pid === run.pid);
  const cost = run.webContent === undefined ? metered : { renderer: table.find((row) => row.pid === run.webContent)?.cpu ?? null };
  const sample = {
    phase,
    second,
    at: round((at - run.origin) / 1000, 2),
    rssKiB,
    acked,
    calls,
    heapMiB: cost?.heap == null ? null : round(cost.heap / MIB, 1),
    footprintMiB: footprint,
    go,
    cost,
    hostCpu: self?.cpu ?? null,
    flood: flood === undefined ? null : { stat: flood.stat, cpu: flood.cpu },
    tree: tree.map((row) => path.basename(row.comm)),
  };
  run.samples.push(sample);
  if (phase === 'flood' || phase === 'shown' || phase === 'resume') {
    if (rssKiB / 1024 > RSS_CAP_MIB) run.capped = true;
  }

  const last = run.samples.at(-2);
  const seconds = last === undefined ? 1 : Math.max(0.1, sample.at - last.at);
  const rate = last === undefined ? 0 : (sample.acked - last.acked) / MIB / seconds;
  const per = (key, scale) => (last?.cost?.[key] == null || cost?.[key] == null ? null : ((cost[key] - last.cost[key]) * scale) / seconds);
  const spent = cost === null ? '' : `  busy ${fixed(per('task', 1000)).padStart(4)} ms/s  renderer ${fixed(per('renderer', 100)).padStart(3)}%${cost.gpu == null ? '' : `  gpu ${fixed(per('gpu', 100)).padStart(3)}%`}`;
  console.log(`  case ${run.id} ${phase.padEnd(8)} ${String(second).padStart(3)} s  host ${round(rssKiB / 1024).toFixed(1).padStart(8)} MiB${footprint === null ? '' : ` (footprint ${footprint.toFixed(1)})`}  parsed ${rate.toFixed(1).padStart(6)} MiB/s${spent}  acks ${String(sample.calls).padStart(7)}  heap ${sample.heapMiB === null ? '-' : round(sample.heapMiB).toFixed(0).padStart(5)} MiB  flood ${sample.flood === null ? '-' : `${sample.flood.stat} cpu ${sample.flood.cpu.toFixed(1)}`}${go === null ? '' : `  go in use ${String(go.heapInuseMiB)} idle ${String(go.heapIdleMiB)} released ${String(go.heapReleasedMiB)} MiB, ${String(round(go.objects / 1e6, 2))}M objects, ${String(go.numGC)} GCs`}`);
  return sample;
}

/** The phases after the flood, in which every sample reads the footprint too. */
const AFTER_THE_FLOOD = ['stop', 'closing', 'closed', 'afterGc'];

/** A sample each second from `anchor`: the n-th is due n seconds after it. `until` may end the phase once `min` samples are in; `stop` ends it at once (a cap was passed). */
async function sampling(run, anchor, phase, { max, min = max, until = () => false, stop = () => false }) {
  for (let second = 1; second <= max; second += 1) {
    await sleep(anchor + second * 1000 - performance.now());
    const sample = await take(run, phase, second, AFTER_THE_FLOOD.includes(phase) || second === max);
    if (stop() || (second >= min && until(sample))) return;
  }
}

async function runCase(id) {
  const spec = CASES[id];
  const result = { id, title: spec.title, engine: flags.engine, uptimeBefore: await uptime(), uptimeAfter: null, hostPid: null, samples: [], marks: {}, notes: [], error: null, cleanup: null };
  const work = await mkdtemp(path.join(os.tmpdir(), `omniview-hostmem-${id}-`));
  console.log(`\ncase ${id}: ${spec.title} (${flags.engine})\n  ${result.uptimeBefore}`);
  const run = {
    id,
    pid: 0,
    origin: performance.now(),
    acks: { calls: 0, bytes: 0, held: 0, session: undefined, bySession: new Map() },
    samples: result.samples,
    before: new Set(),
    seen: new Set(),
    capped: false,
    costOf: async () => null,
    webContent: undefined,
    memstats: async () => null,
  };
  let host;
  let browser;
  let page;
  try {
    host = await startHost(work);
    run.pid = host.pid;
    if (host.pprof !== undefined) run.memstats = async () => memstats(host.pprof);
    result.hostPid = host.pid;
    console.log(`  host pid ${String(host.pid)} at ${host.base}, flood: ${FLOOD}`);
    browser = await launch(flags.engine);
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
    page.on('crash', () => pageErrors.push(`the page crashed at ${String(round((performance.now() - run.origin) / 1000, 1))} s`));
    page.on('console', (message) => {
      if (message.type() === 'error' || /^\[terminal\]/.test(message.text())) pageErrors.push(`console ${message.type()}: ${message.text().slice(0, 300)}`);
    });
    // What the page acknowledges is read from its own requests, which the browser reports without waiting for this process; nothing is changed.
    page.on('request', (request) => {
      const ack = ackOf(request);
      if (ack === undefined) return;
      run.acks.calls += 1;
      if (Number.isFinite(ack.bytes)) {
        run.acks.bytes += ack.bytes;
        run.acks.bySession.set(ack.session, (run.acks.bySession.get(ack.session) ?? 0) + ack.bytes);
      }

      run.acks.session ??= ack.session;
    });
    if (spec.hold) {
      await page.route('**/wails/runtime', async (route) => {
        try {
          if (ackOf(route.request()) !== undefined) {
            run.acks.held += 1;
            await route.fulfill(ACK_ANSWER);
          } else {
            await route.continue();
          }
        } catch {
          // the page went away with the call in the air
        }
      });
    }

    if (flags.engine === 'chromium') {
      await page.addInitScript(LONG_TASKS);
      run.costOf = await chromiumCost(browser, page);
    }

    // The window as the native app opens it, and one terminal from the tool's own button.
    await page.goto(`${host.base}/`, { waitUntil: 'load' });
    const toggle = page.locator('[data-shell-part="panelToggle"]');
    const tabs = page.locator('[data-shell-part="sessionTab"]');
    const tabButtons = page.locator('[data-shell-part="sessionTab"] [role="tab"]');
    /** The slot of the first terminal, the flooded one, whether it is shown or not; its own input; and the input of whichever terminal is on screen. */
    const floodBody = page.locator('[data-shell-part="panelBody"]:has(.xterm-screen)').first();
    const floodInput = floodBody.locator('.xterm-helper-textarea');
    const input = page.locator('[data-shell-part="panelBody"]:not([hidden]) .xterm-helper-textarea');
    await toggle.waitFor({ timeout: 30_000 });
    if (flags.engine === 'webkit') {
      run.webContent = (await webContentOf(page)) ?? undefined;
      result.marks.webContentPid = run.webContent ?? null;
      if (run.webContent === undefined) {
        result.notes.push("the page's web content process could not be told from the machine's other WebKit pages: no WebKit cost is reported");
        run.webContent = -1;
      }
    }

    await toggle.click();
    run.before = new Set(descendantsOf(await processTable(), host.pid).map((row) => row.pid));
    await page.locator('[data-shell-part="panelEmpty"]').getByRole('button', { name: 'New terminal', exact: true }).click();
    await input.waitFor({ timeout: 30_000 });
    const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
    await keepCopies(page);
    /** A terminal's first prompt is in and parsed: the page has acknowledged output of that session and has been quiet for 1.5 s. */
    const promptParsed = async (session) => {
      let quietSince = Date.now();
      let last = -1;
      await waitUntil(`the first prompt of ${session} to be parsed`, async () => {
        const bytes = run.acks.bySession.get(session) ?? 0;
        if (bytes !== last || bytes === 0) {
          last = bytes;
          quietSince = Date.now();
        }

        return Date.now() - quietSince > 1500;
      }, 30_000);
    };

    await waitUntil('the host to list the terminal', async () => ((await call(host.base, 'ListSessions')) ?? []).length === 1, 15_000);
    const [{ id: session }] = await call(host.base, 'ListSessions');
    await promptParsed(session);
    result.marks.sessionAcked = run.acks.session === session;
    result.marks.firstAckBytes = run.acks.bytes;

    // Case 5: a second terminal, which is shown; the first is selected again and takes the command, and is taken off the screen once the flood runs.
    if (spec.terminals === 2) {
      await page.locator('[data-shell-part="sessionAdd"] button').click();
      await waitUntil('the host to list the second terminal', async () => ((await call(host.base, 'ListSessions')) ?? []).length === 2, 15_000);
      const [second] = (await call(host.base, 'ListSessions')).map((one) => one.id).filter((one) => one !== session);
      await promptParsed(second);
      await tabButtons.nth(0).click();
      await floodBody.waitFor({ state: 'visible', timeout: 30_000 });
    }

    // The command is typed and not sent: the baseline is the terminal idle at its prompt with the line ready.
    await input.focus();
    await page.keyboard.type(FLOOD);
    run.origin = performance.now();
    await sampling(run, run.origin, 'baseline', { max: BASELINE_SECONDS });

    // The flood: Enter, and the window of samples starts there. The counts of the marks are of the bytes the page had acknowledged at that moment (the figures take away what it had before the flood).
    const start = performance.now();
    result.marks.ackedAtStart = run.acks.bytes;
    await page.keyboard.press('Enter');
    result.marks.floodStartedAt = round((start - run.origin) / 1000, 2);
    // The hide waits --hide-after seconds. One that has not begun when the flood window ends (the cap was passed, or the window is shorter than --hide-after) never does, and one that is in progress is not waited for beyond a moment: its
    // confirmation, which waits 30 s when nothing cuts it, would otherwise hold the interrupt up.
    const hide = new AbortController();
    /** Takes the flooded terminal off the screen: one click (the status bar's toggle, or the second terminal's tab), then a wait for its screen to be gone, which the end of the flood window cuts to a short grace. Says whether it was confirmed. */
    const takeOff = async () => {
      if (spec.hide === 'panel') await toggle.click({ timeout: 10_000 });
      else await tabButtons.nth(1).click({ timeout: 10_000 });
      let limit = Date.now() + 30_000;
      let grace;
      while (await floodBody.isVisible()) {
        if (hide.signal.aborted) {
          grace ??= Date.now() + HIDE_GRACE_MS;
          limit = Math.min(limit, grace);
        }

        if (Date.now() >= limit) return false;
        await sleep(50);
      }

      return true;
    };
    /** Puts it back: the toggle again (cases 2 and 4), or the first terminal's tab (case 5). `ms` is the deadline of the click and of the wait for its screen to be there. */
    const putBack = async (ms = 30_000) => {
      if (spec.hide === 'panel') await toggle.click({ timeout: ms });
      else await tabButtons.nth(0).click({ timeout: ms });
      await floodBody.waitFor({ state: 'visible', timeout: ms });
    };
    /**
     * Ctrl+C to the flooded terminal, and to no other: it is put back on screen first if it is not there, with a short deadline (a flood that a person wants stopped is not waited on for 30 s), its own input is focused, and the focus is checked
     * before the key is sent, so that a hide that lands late cannot send the interrupt to the terminal that took its place, or to nothing. One more try if the first did not get the focus. Says when the key was pressed.
     */
    const interrupt = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!(await floodBody.isVisible())) await putBack(RESTORE_MS);
        await floodInput.focus({ timeout: RESTORE_MS }).catch(() => undefined);
        if (await floodInput.evaluate((element) => document.activeElement === element, undefined, { timeout: RESTORE_MS }).catch(() => false)) {
          const pressed = performance.now();
          await page.keyboard.press('Control+c');
          return pressed;
        }
      }

      throw new Error('the flooded terminal could not take the keyboard, so Ctrl+C was not sent to it');
    };
    let hiding;
    if (spec.hide !== false) {
      hiding = (async () => {
        await delay(HIDE_AFTER_SECONDS * 1000, undefined, { signal: hide.signal }).catch(() => undefined);
        if (hide.signal.aborted) return;
        if (await takeOff()) {
          result.marks.hiddenAt = round((performance.now() - start) / 1000, 2);
          result.marks.ackedAtHidden = run.acks.bytes;
        }
      })().catch((error) => {
        result.notes.push(`the flooded terminal could not be taken off the screen: ${String(error?.message ?? error).split('\n')[0]}`);
      });
    }

    await sampling(run, start, 'flood', { max: FLOOD_SECONDS, stop: () => run.capped });
    if (run.capped) result.notes.push(`the flood was stopped early: the host passed ${String(RSS_CAP_MIB)} MiB`);
    hide.abort();
    if ((await within(HIDE_SETTLE_MS, hiding)) === null) result.notes.push(`the hide was still in progress ${String(HIDE_SETTLE_MS / 1000)} s after the flood window ended`);
    if (spec.hide !== false && result.marks.hiddenAt === undefined) result.notes.push('the flooded terminal was not confirmed off the screen before the flood window ended');

    // Cases 2, 4 and 5: the flooded terminal is shown again and the flood is checked for going on, from a sample taken when its screen is confirmed visible: the byte count and the page's cost of that window both start there. A run that passed
    // the cap does not wait for that.
    if (spec.hide !== false && !run.capped && result.marks.hiddenAt !== undefined) {
      await putBack();
      const shown = performance.now();
      const shownSample = await take(run, 'shown', 0, false);
      result.marks.shownAt = round(shownSample.at - result.marks.floodStartedAt, 2);
      result.marks.ackedAtShown = shownSample.acked;
      await sampling(run, shown, 'resume', { max: RESUME_SECONDS, stop: () => run.capped });
    }

    // The flood is stopped as a person stops it: Ctrl+C to the flooded terminal, which is put back on screen first (with a short deadline) if the cap or a hide left it off, and the page is given the time to parse what it had received.
    const stopping = await interrupt();
    result.marks.stoppedAt = round((stopping - start) / 1000, 2);
    let quiet = { bytes: run.acks.bytes, since: Date.now() };
    // Settled: the flood process is gone and the page has been quiet for 2 s, which is when what the page parsed can be held to what the shell printed.
    let settled = false;
    await sampling(run, stopping, 'stop', {
      max: DRAIN_SECONDS,
      min: SETTLE_SECONDS,
      until: (sample) => {
        if (run.acks.bytes !== quiet.bytes) quiet = { bytes: run.acks.bytes, since: Date.now() };
        settled = sample.flood === null && Date.now() - quiet.since >= 2000;
        return settled;
      },
    });
    const lastStop = run.samples.filter((sample) => sample.phase === 'stop').at(-1);
    result.marks.floodGone = lastStop.flood === null;
    result.marks.drainedAfter = lastStop.second;
    if (!result.marks.floodGone) result.notes.push(`the flood process (${FLOOD_PROGRAM}) was still there ${String(lastStop.second)} s after Ctrl+C`);
    result.marks.ackedAtStop = run.acks.bytes;

    // How far the shell got and how far the page parsed, read back once nothing is flowing: the emulator's last number and the host's replay's. `AttachSession` forgets the host's credit debt, so it is not called, and the emulator is not read
    // either, while the flood or the page's parse has not finished: a stop phase that ended at --drain before that leaves both unmeasured.
    if (SEQUENCE) {
      if (settled) {
        const emulator = lastNumber(await bufferOf(page, mac), SEQUENCE_END);
        const [, ring] = await call(host.base, 'AttachSession', session);
        const replay = lastNumber(Buffer.from(ring ?? '', 'base64').toString('utf8'), SEQUENCE_END);
        result.marks.lastNumberInEmulator = emulator;
        result.marks.lastNumberInHostReplay = replay;
        result.marks.bytesOfSeqToEmulatorNumber = emulator === null ? null : seqBytes(emulator);
      } else {
        result.marks.sequenceNotRead = "the flood or the page had not settled when the stop phase ended (--drain), and AttachSession would forget the host's credit debt of what is still in flight";
      }
    }

    // The terminals are closed as a person closes them, from the selected tab's button, one after the other. A question means the host said something still runs.
    const closing = (async () => {
      const dialog = page.getByRole('alertdialog', { name: 'Terminate session?' });
      let asked = false;
      for (let guard = 0; guard < 5; guard += 1) {
        const before = await tabs.count();
        if (before === 0) break;
        await page.locator('[data-shell-part="sessionTab"][data-selected] [data-shell-part="sessionClose"]').click();
        for (let waited = 0; waited < 15_000 && (await tabs.count()) >= before; waited += 100) {
          if (await dialog.isVisible()) {
            asked = true;
            await page.getByRole('button', { name: 'Terminate session', exact: true }).click();
          }

          await sleep(100);
        }
      }

      result.marks.closeAsked = asked;
      await waitUntil('the host to have no shell of this case left', async () => descendantsOf(await processTable(), host.pid).every((row) => run.before.has(row.pid)), 30_000);
    })();
    let closed = false;
    closing.then(() => { closed = true; }, () => { closed = true; });
    const closeStart = performance.now();
    await sampling(run, closeStart, 'closing', { max: 60, min: 1, until: () => closed });
    await closing;
    result.marks.closedAfter = round((performance.now() - closeStart) / 1000, 1);
    await sampling(run, performance.now(), 'closed', { max: TAIL_SECONDS });
    // With pprof: a garbage collection, asked for after the tail so that the tail is what the host did by itself, then what the resident set does.
    if (host.pprof !== undefined) {
      result.marks.afterCollection = await memstats(host.pprof, true);
      await sampling(run, performance.now(), 'afterGc', { max: 3 });
    }

    result.marks.pageErrors = pageErrors;
    result.uptimeAfter = await uptime();
  } catch (error) {
    result.error = String(error?.stack ?? error);
    // A host that could not be started was stopped by `startHost`, which says how it went.
    if (error?.cleanup !== undefined) result.cleanup = error.cleanup;
    console.log(`  ERROR ${result.error}`);
  } finally {
    // Whatever happened: the browser closes, the host is stopped by its pid, and what this case started is looked for.
    if (browser !== undefined) await browser.close().catch(() => undefined);
    if (host !== undefined) {
      const stopped = await stopHost(host);
      const table = await processTable();
      const left = [...run.seen, host.pid].filter((pid) => isAlive(pid));
      const omniview = table.filter((row) => path.basename(row.comm) === 'Omniview-server' && (row.pid === host.pid));
      result.cleanup = { ...stopped, pidsLeft: left, hostStillListed: omniview.length > 0 };
      const watchdog = (await readFile(host.logFile, 'utf8').catch(() => '')).split('\n').filter((line) => line.includes('no credit came for a terminal')).length;
      result.marks.watchdogWarnings = watchdog;
      console.log(`  host stopped (${stopped.exit}, ${String(stopped.seconds)} s${stopped.killed ? ', killed by pid' : ''}); processes of this case left: ${left.length === 0 ? 'none' : left.join(', ')}; watchdog warnings in the host log: ${String(watchdog)}`);
    }

    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => undefined);
  }

  return result;
}

const mib = (kib) => kib / 1024;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** The slope of a line through the points, per second. */
function slope(points) {
  if (points.length < 2) return 0;
  const x = mean(points.map(([t]) => t));
  const y = mean(points.map(([, v]) => v));
  let top = 0;
  let bottom = 0;
  for (const [t, v] of points) {
    top += (t - x) * (v - y);
    bottom += (t - x) ** 2;
  }

  return bottom === 0 ? 0 : top / bottom;
}

/**
 * What the page did between two samples, a second apiece at least: the bytes it parsed, and what that cost its main thread (`busy`: seconds in tasks, `script` of them in script, `long`: tasks of over 50 ms; Chromium) and the CPU of its
 * renderer (web content) and GPU processes, in percent of one core. `between` are the samples after `from` up to `to`, whose longest long tasks give the longest of the window. Whatever was not measured is null.
 */
function windowRates(from, to, between) {
  const seconds = to.at - from.at;
  const per = (key, scale) => (from.cost?.[key] == null || to.cost?.[key] == null ? null : ((to.cost[key] - from.cost[key]) * scale) / seconds);
  const parsedMiB = (to.acked - from.acked) / MIB;
  const busy = per('task', 1000);
  const renderer = per('renderer', 100);
  const longCount = from.cost?.longCount == null || to.cost?.longCount == null ? null : to.cost.longCount - from.cost.longCount;
  const rounded = (value, digits = 0) => (value === null ? null : round(value, digits));
  return {
    seconds: round(seconds, 1),
    parsedMiB: round(parsedMiB, 1),
    parsedMiBPerSecond: round(parsedMiB / seconds, 1),
    busyMsPerSecond: rounded(busy),
    scriptMsPerSecond: rounded(per('script', 1000)),
    longMsPerSecond: rounded(per('longMs', 1)),
    longTasks: longCount,
    longMaxMs: between.every((sample) => sample.cost?.longMax == null) ? null : round(Math.max(...between.map((sample) => sample.cost?.longMax ?? 0))),
    rendererPercent: rounded(renderer),
    gpuPercent: rounded(per('gpu', 100)),
    busyMsPerMiB: busy === null || parsedMiB < 0.5 ? null : round((busy * seconds) / parsedMiB, 0),
    rendererMsPerMiB: renderer === null || parsedMiB < 0.5 ? null : round((renderer * 10 * seconds) / parsedMiB, 0),
  };
}

/** The figures of a case, from its samples. Every count of bytes is of what the page acknowledged since the flood started. */
function figures(result) {
  const { samples, marks } = result;
  const of = (phase) => samples.filter((sample) => sample.phase === phase);
  const baseline = of('baseline');
  const flood = of('flood');
  if (baseline.length === 0 || flood.length === 0) return undefined;
  const baselineMiB = mean(baseline.map((sample) => mib(sample.rssKiB)));
  const rss = flood.map((sample) => mib(sample.rssKiB));
  const stop = of('stop');
  const closing = of('closing');
  const closed = of('closed');
  const resume = of('resume');
  const shown = of('shown')[0];
  const afterGc = of('afterGc');
  const heaps = samples.map((sample) => sample.heapMiB).filter((value) => value !== null);
  const rates = flood.map((sample, index) => (sample.acked - (index === 0 ? marks.ackedAtStart : flood[index - 1].acked)) / MIB);
  const parsed = (flood.at(-1).acked - marks.ackedAtStart) / MIB;
  const lastFlood = flood.slice(-6).filter((sample) => sample.flood !== null);
  // The interval off the screen runs from the moment the hide was confirmed to the last flood sample, and it is measured only when the hide was confirmed before that sample (a hide confirmed after it, as a run that passed the cap can
  // have, has no part of the flood window and no bytes in it).
  const hiddenAt = marks.hiddenAt === undefined ? null : marks.floodStartedAt + marks.hiddenAt;
  const hiddenFor = hiddenAt === null || hiddenAt >= flood.at(-1).at || marks.ackedAtHidden > flood.at(-1).acked ? null : flood.at(-1).at - hiddenAt;
  return {
    baselineMiB: round(baselineMiB),
    baselineRange: [round(Math.min(...baseline.map((sample) => mib(sample.rssKiB)))), round(Math.max(...baseline.map((sample) => mib(sample.rssKiB))))],
    floodPeakMiB: round(Math.max(...rss)),
    floodEndMiB: round(rss.at(-1)),
    growthMiB: round(rss.at(-1) - baselineMiB),
    slopeMiBPerSecond: round(slope(flood.map((sample) => [sample.second, mib(sample.rssKiB)])), 2),
    floodSecondsSampled: flood.length,
    parsedMiB: round(parsed),
    parsedMiBPerSecond: round(parsed / flood.length, 1),
    parsedPerSecond: rates.map((value) => round(value, 1)),
    peakAllMiB: round(Math.max(...samples.map((sample) => mib(sample.rssKiB)))),
    rssAtStopEndMiB: stop.length === 0 ? null : round(mib(stop.at(-1).rssKiB)),
    rssAtCloseEndMiB: closing.length === 0 ? null : round(mib(closing.at(-1).rssKiB)),
    rssAfterTailMiB: closed.length === 0 ? null : round(mib(closed.at(-1).rssKiB)),
    rssTailMinMiB: closed.length === 0 ? null : round(Math.min(...closed.map((sample) => mib(sample.rssKiB)))),
    rssAfterTheFlood: [...stop, ...closing, ...closed].map((sample) => round(mib(sample.rssKiB))),
    footprintMiB: {
      baseline: baseline.at(-1).footprintMiB,
      floodEnd: flood.at(-1).footprintMiB,
      afterStop: stop.at(-1)?.footprintMiB ?? null,
      afterClose: closing.at(-1)?.footprintMiB ?? null,
      afterTail: closed.at(-1)?.footprintMiB ?? null,
      afterCollection: afterGc.at(-1)?.footprintMiB ?? null,
    },
    pageHeapPeakMiB: heaps.length === 0 ? null : round(Math.max(...heaps)),
    pageHeapEndOfFloodMiB: flood.at(-1).heapMiB,
    hostCpuSecondsInFloodWindow: flood.at(-1).hostCpu === null || baseline.at(-1).hostCpu === null ? null : round(flood.at(-1).hostCpu - baseline.at(-1).hostCpu, 1),
    floodProcessCpuSecondsInLast5: lastFlood.length < 2 ? null : round(lastFlood.at(-1).flood.cpu - lastFlood[0].flood.cpu, 2),
    // What the page costs: idle at its prompt, in the flood window less its first second, and (cases 2, 4 and 5) after the flooded terminal was shown again, from the sample taken when its screen was confirmed visible to the last one: the window
    // that the resume byte count is of.
    cost: {
      idle: baseline.length > 1 ? windowRates(baseline[0], baseline.at(-1), baseline.slice(1)) : null,
      steady: flood.length > 1 ? windowRates(flood[0], flood.at(-1), flood.slice(1)) : null,
      resumed: shown === undefined || resume.length === 0 ? null : windowRates(shown, resume.at(-1), resume),
    },
    hidden: marks.hiddenAt === undefined ? null : hiddenFor === null ? { measured: false, at: marks.hiddenAt } : {
      measured: true,
      at: marks.hiddenAt,
      seconds: round(hiddenFor, 1),
      parsedMiB: round((flood.at(-1).acked - marks.ackedAtHidden) / MIB, 1),
      parsedMiBPerSecond: round((flood.at(-1).acked - marks.ackedAtHidden) / MIB / hiddenFor, 1),
      parsedBeforeMiB: round((marks.ackedAtHidden - marks.ackedAtStart) / MIB, 2),
    },
    resume: shown === undefined || resume.length === 0 ? null : {
      seconds: round(resume.at(-1).at - shown.at, 1),
      firstSeconds: round(resume[0].at - shown.at, 1),
      parsedFirstSecondMiB: round((resume[0].acked - shown.acked) / MIB, 1),
      parsedAfterShownMiB: round((resume.at(-1).acked - shown.acked) / MIB, 1),
    },
    go: baseline.at(-1).go === null ? null : {
      baseline: baseline.at(-1).go,
      floodEnd: flood.at(-1).go,
      afterTail: closed.at(-1)?.go ?? null,
      afterCollection: marks.afterCollection ?? null,
      rssAfterCollectionMiB: afterGc.length === 0 ? null : round(mib(afterGc.at(-1).rssKiB)),
    },
  };
}

function printReport(results) {
  console.log('\n=== host resident set under a flood, and what the page spent on it (MiB = 1,048,576 bytes; parsed = bytes the page acknowledged; growth = end of the flood window - mean of the baseline) ===');
  console.log(`engine ${flags.engine}, flood \`${FLOOD}\`, ${String(FLOOD_SECONDS)} s of flood after ${String(BASELINE_SECONDS)} s of baseline, host ${path.relative(repo, flags.server)}; busy, renderer and gpu are over the flood window less its first second`);
  const header = ['case', 'baseline', 'peak', 'end', 'growth', 'slope MiB/s', 'parsed MiB', 'MiB/s', 'busy ms/s', 'script ms/s', 'renderer %', 'gpu %', 'busy ms/MiB', 'cpu ms/MiB', 'after stop', 'after close'];
  const rows = [header];
  for (const result of results) {
    const f = figures(result);
    if (f === undefined) {
      rows.push([String(result.id), 'no samples', ...header.slice(2).map(() => '')]);
      continue;
    }

    const s = f.cost.steady;
    rows.push([String(result.id), f.baselineMiB.toFixed(1), f.floodPeakMiB.toFixed(1), f.floodEndMiB.toFixed(1), f.growthMiB.toFixed(1), f.slopeMiBPerSecond.toFixed(2), f.parsedMiB.toFixed(1), f.parsedMiBPerSecond.toFixed(1), fixed(s?.busyMsPerSecond), fixed(s?.scriptMsPerSecond), fixed(s?.rendererPercent), fixed(s?.gpuPercent), fixed(s?.busyMsPerMiB), fixed(s?.rendererMsPerMiB), f.rssAtStopEndMiB?.toFixed(1) ?? '-', f.rssAfterTailMiB?.toFixed(1) ?? '-']);
  }

  const widths = header.map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  for (const row of rows) console.log(row.map((cell, column) => cell.padStart(widths[column])).join('  '));
  for (const result of results) {
    const f = figures(result);
    console.log(`\ncase ${result.id} (${result.title})`);
    console.log(`  ${result.uptimeBefore}`);
    if (f !== undefined) {
      console.log(`  baseline ${f.baselineMiB} MiB (${f.baselineRange[0]} to ${f.baselineRange[1]}), flood peak ${f.floodPeakMiB}, end ${f.floodEndMiB}, growth ${f.growthMiB} MiB, ${f.slopeMiBPerSecond} MiB/s fitted; peak of the whole case ${f.peakAllMiB} MiB`);
      console.log(`  parsed ${f.parsedMiB} MiB (${f.parsedMiBPerSecond} MiB/s; each second: ${f.parsedPerSecond.join(' ')}); the host's cpu in the flood window ${String(f.hostCpuSecondsInFloodWindow)} s; cpu of ${FLOOD_PROGRAM} in the last 5 s of it ${String(f.floodProcessCpuSecondsInLast5)} s`);
      const describe = (label, w) => (w === null ? `${label} -` : `${label} (${String(w.seconds)} s): busy ${fixed(w.busyMsPerSecond)} ms/s (script ${fixed(w.scriptMsPerSecond)}), long tasks ${fixed(w.longMsPerSecond)} ms/s in ${fixed(w.longTasks)} (longest ${fixed(w.longMaxMs)} ms), renderer ${fixed(w.rendererPercent)}% of a core, gpu ${fixed(w.gpuPercent)}%, parsed ${fixed(w.parsedMiBPerSecond, 1)} MiB/s, per MiB parsed ${fixed(w.busyMsPerMiB)} ms busy and ${fixed(w.rendererMsPerMiB)} ms of renderer cpu`);
      console.log(`  page cost: ${describe('idle', f.cost.idle)}\n             ${describe('flood', f.cost.steady)}${f.cost.resumed === null ? '' : `\n             ${describe('shown again', f.cost.resumed)}`}`);
      console.log(`  after Ctrl+C (${String(result.marks.stoppedAt)} s): at the end of the stop phase ${String(f.rssAtStopEndMiB)} MiB (${String(result.marks.drainedAfter)} s, ${FLOOD_PROGRAM} ${result.marks.floodGone ? 'gone' : 'still there'}); the terminals closed in ${String(result.marks.closedAfter)} s${result.marks.closeAsked ? ' AFTER A QUESTION' : ' with no question'}; ${String(TAIL_SECONDS)} s later ${String(f.rssAfterTailMiB)} MiB (lowest ${String(f.rssTailMinMiB)})`);
      const fp = f.footprintMiB;
      if (fp.baseline !== null) console.log(`  the footprint (macOS: compressed pages included): baseline ${String(fp.baseline)}, end of the flood ${String(fp.floodEnd)}, end of the stop phase ${String(fp.afterStop)}, when the close was done ${String(fp.afterClose)}, ${String(TAIL_SECONDS)} s after it ${String(fp.afterTail)}${fp.afterCollection === null ? '' : `, 3 s after a forced collection ${String(fp.afterCollection)}`} MiB`);
      if (f.pageHeapPeakMiB !== null) console.log(`  the page's JS heap: peak ${f.pageHeapPeakMiB} MiB, at the end of the flood window ${String(f.pageHeapEndOfFloodMiB)} MiB`);
      if (f.go !== null) {
        const go = (label, stats) => (stats === null ? `${label} -` : `${label} in use ${String(stats.heapInuseMiB)}, idle ${String(stats.heapIdleMiB)}, released ${String(stats.heapReleasedMiB)}, live+garbage ${String(stats.heapAllocMiB)} MiB, ${String(round(stats.objects / 1e6, 2))}M objects, ${String(stats.numGC)} GCs`);
        console.log(`  the host's Go heap (pprof): ${go('baseline', f.go.baseline)}; ${go('end of the flood', f.go.floodEnd)}; ${go(`${String(TAIL_SECONDS)} s after the close`, f.go.afterTail)}; ${go('right after a forced collection', f.go.afterCollection)}; resident set 3 s after it ${String(f.go.rssAfterCollectionMiB)} MiB`);
      }

      if (f.hidden !== null) console.log(f.hidden.measured ? `  off the screen from ${String(f.hidden.at)} s (the page had parsed ${String(f.hidden.parsedBeforeMiB)} MiB by then) to the end of the flood window: parsed ${String(f.hidden.parsedMiB)} MiB in ${String(f.hidden.seconds)} s (${String(f.hidden.parsedMiBPerSecond)} MiB/s)` : `  off the screen: not measured, the hide was confirmed at ${String(f.hidden.at)} s, after the last flood sample, so the flood window has no interval of it`);
      if (f.resume !== null) console.log(`  shown again at ${String(result.marks.shownAt)} s: parsed ${String(f.resume.parsedFirstSecondMiB)} MiB in the first ${String(f.resume.firstSeconds)} s and ${String(f.resume.parsedAfterShownMiB)} MiB in ${String(f.resume.seconds)} s: the flood ${f.resume.parsedAfterShownMiB > 1 ? 'went on' : 'did NOT go on'}`);
    }

    if (SEQUENCE && (result.marks.sequenceNotRead !== undefined || result.marks.lastNumberInEmulator !== undefined)) {
      if (result.marks.sequenceNotRead !== undefined) {
        console.log(`  the last number of the flood: not measured (${result.marks.sequenceNotRead})`);
      } else {
        const { lastNumberInEmulator: emulator, lastNumberInHostReplay: replay, bytesOfSeqToEmulatorNumber: bytes } = result.marks;
        const acked = result.marks.ackedAtStop - result.marks.ackedAtStart;
        const number = (value) => (value === null ? 'none valid' : String(value));
        console.log(`  the last number in the emulator ${number(emulator)}${bytes === null ? '' : ` (${String(bytes)} bytes of seq)`}, in the host's replay ${number(replay)}; ${bytes === null ? 'the byte comparison is not made: the emulator has no valid final number' : `the page acknowledged ${String(acked)} bytes since the flood started (${String(acked - bytes)} more than the bytes of seq up to the emulator's number)`}`);
      }
    }

    if (result.marks.watchdogWarnings !== undefined) console.log(`  the host's log: ${String(result.marks.watchdogWarnings)} watchdog warnings`);
    if (result.marks.pageErrors?.length > 0) console.log(`  the page said: ${result.marks.pageErrors.slice(0, 5).join(' | ')}`);
    for (const note of result.notes) console.log(`  NOTE ${note}`);
    if (result.error !== null) console.log(`  ERROR ${result.error.split('\n')[0]}`);
    if (result.cleanup !== null) {
      const said = result.cleanup.errors?.length > 0 ? `; host errors: ${result.cleanup.errors.join(' | ')}` : '';
      console.log(`  cleanup: host ${result.cleanup.exit}${result.cleanup.killed ? ' (killed by pid)' : ''}, ${result.cleanup.pidsLeft.length === 0 ? 'no process of the case left' : `LEFT: ${result.cleanup.pidsLeft.join(', ')}`}${said}`);
    }
  }
}

const results = [];
for (const id of CASE_IDS) results.push(await runCase(id));
printReport(results);
if (flags.json !== undefined) {
  await writeFile(flags.json, `${JSON.stringify({ engine: flags.engine, flood: FLOOD, seconds: FLOOD_SECONDS, baseline: BASELINE_SECONDS, results: results.map((result) => ({ ...result, figures: figures(result) ?? null })) }, null, 1)}\n`);
  console.log(`\nwritten: ${flags.json}`);
}

process.exitCode = results.some((result) => result.error !== null || (result.cleanup?.pidsLeft.length ?? 0) > 0) ? 1 : 0;

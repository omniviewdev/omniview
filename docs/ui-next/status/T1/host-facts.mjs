// host-facts.mjs: what the real Go host's exec/terminal lane does today (T1, HostFacts). Facts only; builds nothing, edits nothing.
//
// Run (drop the .txt first; the file must sit in docs/ui-next/status/T1/ so the root node_modules resolve):
//   cp docs/ui-next/status/T1/host-facts.mjs.txt docs/ui-next/status/T1/host-facts.mjs
//   OMNIVIEW_UI=next task build:server                      # once: needs bin/Omniview-server
//   uptime                                                  # record the 1-minute load; wait if it is above ~30
//   node docs/ui-next/status/T1/host-facts.mjs              # all of q1..q12 (about 10-12 minutes; q8 waits 60 s, q11 floods 50 MB several times)
//   node docs/ui-next/status/T1/host-facts.mjs q4 q9        # only these (q11rss: only the host-memory part of q11, merged into q11)
//   rm docs/ui-next/status/T1/host-facts.mjs
// Do not set ENGINES, VIEWPORTS, NEGATIVE_CONTROL, REPORT or DIST: the script refuses to run with them set (a clean environment).
// Result: /Users/joshuapare/Notes/omniview/ui-migration/status/T1-assets/host-facts.json (keys merged per question, so a partial run updates only its own keys).
//
// What it asserts / records (every question is a section; numbers are recorded, a few facts are asserted and listed in `checks`):
//   a fresh host per section: bin/Omniview-server with the seam check's minimal environment (HOME = fresh temp dir, OMNIVIEW_CHANNEL=feature-ui-next, loopback, free port);
//   Node side: the exec service called over POST /wails/runtime, the window's event socket (/wails/events) read byte-exact with Node's global WebSocket;
//   page side: a throwaway esbuild bundle of @wailsio/runtime (+ js-base64) added to a blank same-origin page, in Chromium (--font-render-hinting=none) and WebKit, viewports 1440x900 / 1280x800;
//   every session the script opens is closed; the host is stopped by its own pid; descendants of that host are listed and any survivor (its own) is killed and reported.
//   q1 CreateTerminal; q2 events + floods (sha256 exact); q3 exit paths; q4 output lost at exit; q5 resize; q6 attach/detach; q7 input; q8 per-window release; q9 CloseSession;
//   q10 foreground process; q11 page-side floor of the event pipeline (+ host RSS under a stalled client); q12 environment and the rest.

import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const OUT = '/Users/joshuapare/Notes/omniview/ui-migration/status/T1-assets/host-facts.json';
const SERVER = path.join(ROOT, 'bin/Omniview-server');
const EXEC = 'github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper';
const req = createRequire(path.join(ROOT, 'package.json'));

for (const name of ['ENGINES', 'VIEWPORTS', 'NEGATIVE_CONTROL', 'REPORT', 'DIST']) {
  if (process.env[name] !== undefined) throw new Error(`${name} is set: run in a clean environment`);
}
if (!existsSync(SERVER)) throw new Error(`${SERVER} is missing: OMNIVIEW_UI=next task build:server`);

const wanted = process.argv.slice(2).map((a) => a.toLowerCase());
const all = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12'];
const run = wanted.length > 0 ? wanted : all;

const R = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
R.meta = {
  ...(R.meta ?? {}),
  node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  accountShell: spawnSync('/usr/bin/dscl', ['.', '-read', `/Users/${os.userInfo().username}`, 'UserShell']).stdout.toString().trim(),
  shellOfThisRun: spawnSync('sh', ['-c', 'echo $0; ps -o comm= -p $$']).stdout.toString().trim().split('\n'),
  playwright: req('playwright/package.json').version, runs: { ...(R.meta?.runs ?? {}) },
};
const save = () => writeFileSync(OUT, `${JSON.stringify(R, null, 1)}\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const pct = (a, p) => { if (a.length === 0) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const stat = (a, d = 2) => (a.length === 0 ? null : { n: a.length, min: +a.reduce((x, y) => (y < x ? y : x), Infinity).toFixed(d), p50: +pct(a, 50).toFixed(d), p95: +pct(a, 95).toFixed(d), max: +a.reduce((x, y) => (y > x ? y : x), -Infinity).toFixed(d), mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(d) });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const load1 = () => +os.loadavg()[0].toFixed(2);
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); if (!ok) console.log(`  CHECK FAILED: ${name} ${detail}`); };

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
    probe.on('error', reject);
  });
}

// ---------- host ----------
function descendants(pid) {
  const rows = spawnSync('ps', ['-axo', 'pid=,ppid=,comm=']).stdout.toString().trim().split('\n').map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m ? { pid: +m[1], ppid: +m[2], comm: m[3] } : null; }).filter(Boolean);
  const out = []; const queue = [pid];
  while (queue.length > 0) { const p = queue.shift(); for (const r of rows) if (r.ppid === p) { out.push(r); queue.push(r.pid); } }
  return out;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const rss = (pid) => +spawnSync('ps', ['-o', 'rss=', '-p', String(pid)]).stdout.toString().trim() || 0;

async function startHost() {
  const work = mkdtempSync(path.join(os.tmpdir(), 'hf-'));
  mkdirSync(path.join(work, 'home'));
  const port = await freePort();
  const { PATH, TMPDIR, LANG, USER } = process.env;
  const env = { PATH, TMPDIR, LANG, USER, HOME: path.join(work, 'home'), OMNIVIEW_CHANNEL: 'feature-ui-next', WAILS_SERVER_HOST: '127.0.0.1', WAILS_SERVER_PORT: String(port) };
  const child = spawn(SERVER, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = [];
  for (const s of [child.stdout, child.stderr]) s.on('data', (c) => lines.push(String(c)));
  let up = false;
  for (let i = 0; i < 240 && !up; i += 1) { try { up = (await fetch(`http://127.0.0.1:${port}/`)).ok; } catch { await sleep(250); } }
  if (!up) throw new Error(`host did not start:\n${lines.join('').slice(-1500)}`);
  return { child, pid: child.pid, base: `http://127.0.0.1:${port}`, port, work, home: env.HOME, env, log: () => lines.join(''), events: [] };
}

/** Stop the host by its own pid; list what was still running under it; kill survivors of that list (they are this script's own children). */
async function stopHost(h, label) {
  const before = descendants(h.pid);
  for (const e of h.events ?? []) e.close();
  h.child.kill('SIGTERM');
  await Promise.race([new Promise((r) => h.child.once('exit', r)), sleep(8000)]);
  if (alive(h.pid)) { h.child.kill('SIGKILL'); await sleep(300); }
  await sleep(300);
  const survivors = before.filter((d) => alive(d.pid));
  for (const s of survivors) { try { process.kill(s.pid, 'SIGKILL'); } catch { /* gone */ } }
  const rec = { label, hostPid: h.pid, descendantsAtStop: before.map((d) => `${d.pid}:${d.comm}`), survivorsKilledByScript: survivors.map((d) => `${d.pid}:${d.comm}`) };
  (R.meta.runs.cleanup ??= []).push(rec);
  return rec;
}

async function tryBound(base, method, ...args) {
  const t = now();
  const r = await fetch(`${base}/wails/runtime`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wails-client-id': 'hf' }, body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': `hf-${method}-${Math.random()}`, methodName: `${EXEC}.${method}`, args } }) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: r.status, text, json, ms: now() - t };
}
const b64 = (s) => Buffer.from(s).toString('base64');

// ---------- Node-side event socket ----------
class Events {
  constructor(h, clientId = `hf-${Math.random().toString(36).slice(2)}`) { this.h = h; this.sessions = new Map(); this.all = []; this.names = new Map(); this.clientId = clientId; this.frames = 0; this.bytesOnWire = 0; h.events.push(this); }
  async open() {
    this.ws = new WebSocket(`${this.h.base.replace('http', 'ws')}/wails/events?clientId=${this.clientId}`);
    this.ws.onmessage = (e) => this.onFrame(e.data);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    return this;
  }
  close() { try { this.ws.close(); } catch { /* closed */ } }
  onFrame(raw) {
    const t = now();
    const text = String(raw);
    this.frames += 1; this.bytesOnWire += text.length;
    let m; try { m = JSON.parse(text); } catch { return; }
    this.names.set(m.name.replace(/[0-9a-f-]{36}$/, '<id>'), (this.names.get(m.name.replace(/[0-9a-f-]{36}$/, '<id>')) ?? 0) + 1);
    const mm = m.name.match(/^core\/exec\/(stream|signal)\/([A-Za-z0-9]+)\/(.+)$/);
    if (!mm) { this.all.push({ t, name: m.name }); return; }
    const s = this.sessions.get(mm[3]);
    const buf = typeof m.data === 'string' ? Buffer.from(m.data, 'base64') : Buffer.from(JSON.stringify(m.data));
    const rec = { t, kind: mm[1], sig: mm[2], n: buf.length, raw: m.data, wire: text.length, keys: Object.keys(m) };
    if (s) s.onEvent(rec, buf);
    else this.all.push({ t, name: m.name, orphan: true, n: buf.length });
  }
}

class Term {
  constructor(h, ev, session) { this.h = h; this.ev = ev; this.session = session; this.id = session.id; this.events = []; this.chunks = []; this.total = 0; this.text = ''; this.textOn = true; this.closeAt = null; this.closes = 0; this.afterClose = 0; this.n = 0; ev.sessions.set(this.id, this); }
  /** The id is made here and the session is registered BEFORE the call, so no event of the new shell can arrive unseen (with an id the host makes, the first events can beat the answer: see q1.idMadeByHost). */
  static async create(h, ev, opts = {}, name = 'CreateTerminal') {
    const id = opts.id || randomUUID();
    const o = { tty: true, command: [], labels: {}, params: {}, ...opts, id };
    const t = new Term(h, ev, { id }); t.sentAt = now();
    const r = await tryBound(h.base, name, o);
    if (r.status !== 200) { ev.sessions.delete(id); throw new Error(`CreateTerminal ${r.status} ${r.text}`); }
    t.session = r.json; t.createMs = r.ms; t.createdAt = now(); return t;
  }
  onEvent(rec, buf) {
    this.events.push(rec);
    if (rec.kind === 'signal') { if (rec.sig === 'CLOSE') { this.closes += 1; this.closeAt ??= rec.t; this.closeBuf = buf; } rec.buf = buf; return; }
    if (this.closeAt !== null) this.afterClose += 1;
    this.total += buf.length; rec.end = this.total;
    this.chunks.push(buf);
    const lat = buf.toString('latin1');
    this.tailStr = ((this.tailStr ?? '') + lat).slice(-8192);
    this.streamEvents = (this.streamEvents ?? 0) + 1;
    { const last = buf[buf.length - 1]; if (last >= 0x80) { let i = buf.length - 1; while (i > 0 && (buf[i] & 0xc0) === 0x80) i -= 1; const lead = buf[i]; const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1; if (buf.length - i < need) this.utf8Splits = (this.utf8Splits ?? 0) + 1; } }
    if (this.textOn) this.text += lat; else { rec.raw = undefined; rec.keys = undefined; }
    this.lastT = rec.t; if (this.onData) { const f = this.onData; this.onData = null; f(rec.t); }
  }
  write(s) { return tryBound(this.h.base, 'WriteSession', this.id, Buffer.isBuffer(s) ? s.toString('base64') : b64(s)); }
  async waitText(re, from = 0, ms = 15000) {
    const end = now() + ms;
    while (now() < end) { const m = this.text.slice(from).match(re); if (m) return m; await sleep(2); }
    throw new Error(`timeout waiting for ${re} (tail ${JSON.stringify(this.text.slice(-200))})`);
  }
  async ready() { await this.waitText(/\x1b\[\?2004h/, 0, 20000); await sleep(20); return this; }
  /** Run one line and wait until the shell has printed the sentinel its own arithmetic made. */
  async runLine(cmd, ms = 20000) {
    const k = (Term.k = (Term.k ?? 1000) + 1); const from = this.text.length;
    await this.write(`${cmd}; echo @@D$((${k}*3))@@\n`);
    await this.waitText(new RegExp(`@@D${k * 3}@@`), from, ms);
    return this.text.slice(from);
  }
  async pid() { const o = await this.runLine('echo PID$$X'); return +o.match(/PID(\d+)X/)[1]; }
  async close() { return tryBound(this.h.base, 'CloseSession', this.id); }
}
async function newTerm(h, ev, opts, ready = true) { const t = await Term.create(h, ev, opts); if (ready) await t.ready(); return t; }

// ---------- browser side ----------
let BUNDLE = null;
async function bundle() {
  if (BUNDLE) return BUNDLE;
  const esbuild = req('esbuild');
  const out = await esbuild.build({ stdin: { contents: "import * as W from '@wailsio/runtime'; import { toUint8Array } from 'js-base64'; window.W = W; window.jsb64 = toUint8Array;", resolveDir: ROOT }, bundle: true, format: 'iife', write: false, minify: true });
  BUNDLE = out.outputFiles[0].text;
  return BUNDLE;
}

/** Code that runs in the page: one collector per session, a handler whose mode says what it does with each event. */
const PAGE_LIB = `
window.HF = (() => {
  const EXEC = ${JSON.stringify(EXEC)};
  const call = (m, ...a) => W.Call.ByName(EXEC + '.' + m, ...a);
  const enc = (s) => { const b = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(t); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
  const stat = (a) => a.length ? { n: a.length, min: a.reduce((x, y) => (y < x ? y : x), Infinity), p50: pct(a, 50), p95: pct(a, 95), max: a.reduce((x, y) => (y > x ? y : x), -Infinity), mean: a.reduce((x, y) => x + y, 0) / a.length } : null;
  const S = new Map();
  function sub(id, mode = 'text') {
    const s = { id, mode, text: '', n: 0, bytes: 0, tFirst: 0, tLast: 0, cost: [], sizes: [], strs: [], waiter: null, types: new Set(), keys: new Set(), blocked: false, closeSeen: 0, closeData: null };
    s.off = W.Events.On('core/exec/stream/stdout/' + id, (ev) => {
      const t0 = performance.now();
      s.types.add(typeof ev.data); s.keys.add(Object.keys(ev).join(','));
      const d = ev.data;
      if (s.n === 0) s.tFirst = t0;
      s.n += 1; s.tLast = t0;
      const len = d.length; s.bytes += (len * 3 >> 2) - (d.endsWith('==') ? 2 : d.endsWith('=') ? 1 : 0);
      const m = s.mode;
      if (m === 'text') { const x = atob(d); s.text += x; if (s.waiter && s.waiter.re.test(s.text.slice(s.waiter.from))) { const w = s.waiter; s.waiter = null; w.res(performance.now()); } }
      else if (m === 'fromBase64') { const u = Uint8Array.fromBase64(d); s.sink = u.length; }
      else if (m === 'atob') { const x = atob(d); const u = new Uint8Array(x.length); for (let i = 0; i < x.length; i++) u[i] = x.charCodeAt(i); s.sink = u.length; }
      else if (m === 'jsb64') { s.sink = jsb64(d).length; }
      else if (m === 'push') { s.strs.push(d); }
      else if (m === 'block5s') { if (!s.blocked) { s.blocked = true; const e = performance.now() + 5000; while (performance.now() < e); } }
      // 'count': nothing else
      s.sizes.push(len);
      s.cost.push(performance.now() - t0);
    });
    W.Events.On('core/exec/signal/CLOSE/' + id, (ev) => { s.closeSeen += 1; s.closeData = ev.data; s.closeT = performance.now(); });
    S.set(id, s); return s;
  }
  async function create(opts = {}) { const r = await call('CreateTerminal', { tty: true, command: [], labels: {}, params: {}, id: '', ...opts }); return r; }
  /** subscribe first, with an id made here, then create: nothing of the first output is lost */
  async function open(opts = {}, mode = 'text') { const id = crypto.randomUUID(); const s = sub(id, mode); s.session = await call('CreateTerminal', { tty: true, command: [], labels: {}, params: {}, ...opts, id }); return s; }
  function waitText(s, re, ms = 15000) {
    const from = s.text.length; re = new RegExp(re);
    return new Promise((res, rej) => { s.waiter = { re, from, res }; setTimeout(() => { if (s.waiter && s.waiter.re === re) { s.waiter = null; rej(new Error('timeout ' + re + ' tail ' + JSON.stringify(s.text.slice(-120)))); } }, ms); if (re.test(s.text.slice(from))) { s.waiter = null; res(performance.now()); } });
  }
  async function ready(s) { for (let i = 0; i < 4000; i++) { if (s.text.includes('\\x1b[?2004h')) return; await sleep(5); } throw new Error('no prompt'); }
  let kk = 5000;
  async function runLine(s, cmd, ms) { const k = ++kk; const from = s.text.length; const p = waitText(s, '@@D' + (k * 3) + '@@', ms); await call('WriteSession', s.id, enc(cmd + '; echo @@D$((' + k + '*3))@@\\n')); await p; return s.text.slice(from); }
  async function until(fn, ms = 30000) { const e = performance.now() + ms; while (performance.now() < e) { if (fn()) return true; await sleep(5); } return false; }
  /** rAF intervals while f() runs */
  function rafWatch() { const d = []; let last = performance.now(); let on = true; const loop = (t) => { if (!on) return; d.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); return () => { on = false; return d; }; }
  return { call, enc, sleep, pct, stat, S, sub, create, open, waitText, ready, runLine, until, rafWatch };
})();
`;

/** A blank page of the host's origin (/health: a JSON document, no app), the runtime bundle added. Not cross-origin isolated: COEP blocks the event WebSocket in Chromium, and so does a route-fulfilled document (both tried), so timers keep the engines' default grain (recorded as timerResolutionMs). */
async function openPage(browser, h, viewport = { width: 1440, height: 900 }, context = null) {
  const ctx = context ?? await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const logs = []; page.on('pageerror', (e) => logs.push(`pageerror ${e.message}`));
  await page.goto(`${h.base}/health`);
  await page.addScriptTag({ content: await bundle() });
  await page.addScriptTag({ content: PAGE_LIB });
  await page.waitForFunction(() => typeof window.HF === 'object');
  await sleep(600); // the runtime loads /wails/custom.js on its own, which connects the event socket
  page.hfLogs = logs;
  return page;
}
async function engines() {
  const pw = req('playwright');
  return { chromium: () => pw.chromium.launch({ args: ['--font-render-hinting=none'] }), webkit: () => pw.webkit.launch() };
}

const FLOODS = {
  yes200k: "yes | head -200000",
  b64_20mb: "head -c 20000000 /dev/zero | base64 -b 100 | head -c 20000000",
};

// ---------- sections ----------
const sections = {};

sections.q1 = async () => {
  const h = await startHost(); const ev = await new Events(h).open(); const out = {};
  try {
    const t = await Term.create(h, ev); out.createAnswer = { status: 200, json: t.session }; out.createMsFirst = +t.createMs.toFixed(2);
    const firstEventAt = new Promise((r) => { const iv = setInterval(() => { if (t.events.length) { clearInterval(iv); r(t.events[0].t); } }, 1); });
    await t.ready();
    out.msFromCreateReturnToFirstEvent = +(await firstEventAt - t.createdAt).toFixed(1);
    out.msFromCreateReturnToPromptReady = +(now() - t.createdAt).toFixed(1);
    out.firstEvents = t.events.slice(0, 6).map((e) => ({ kind: e.kind, sig: e.sig, bytes: e.n, text: Buffer.from(e.raw, 'base64').toString() }));
    const o = await t.runLine('stty size; echo "ARGV0=$0 SHELL=$SHELL TERM=$TERM HOME=$HOME PWD=$PWD COLUMNS=$COLUMNS LINES=$LINES"; ps -o comm=,args= -p $$');
    out.sttyAndEnv = o.replace(/\r/g, '').split('\n').slice(0, 6);
    check('q1: stty size before any resize is 27 72', /\n?27 72\r?\n/.test(o), JSON.stringify(o.slice(0, 80)));
    check('q1: session answer names no shell/program (command is [])', Array.isArray(t.session.command) && t.session.command.length === 0, JSON.stringify(t.session.command));
    // size fields on the options
    out.sizeFieldsOnOptions = {};
    for (const [k, extra] of Object.entries({ rows_cols: { rows: 40, cols: 100 }, size: { size: { rows: 40, cols: 100 } } })) {
      const r = await tryBound(h.base, 'CreateTerminal', { tty: true, command: [], labels: {}, params: {}, id: '', ...extra });
      out.sizeFieldsOnOptions[k] = { status: r.status, text: r.text.slice(0, 300) };
      if (r.status === 200) { const x = new Term(h, ev, r.json); await x.ready(); out.sizeFieldsOnOptions[k].sttyAfter = (await x.runLine('stty size')).replace(/\r/g, '').split('\n')[1]; await x.close(); }
    }
    check('q1: CreateTerminal takes no size (unknown member is rejected)', Object.values(out.sizeFieldsOnOptions).every((r) => r.status !== 200));
    // explicit command
    const t3 = await Term.create(h, ev, { command: ['/bin/bash'] }); await t3.waitText(/\$ /, 0, 15000).catch(() => {});
    await sleep(300); await t3.write('echo "B=$BASH_VERSION 0=$0"; ps -o args= -p $$\n'); await sleep(500);
    out.explicitCommandBash = { session: t3.session, output: t3.text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '').slice(-300) };
    await t3.close();
    const bad = await tryBound(h.base, 'CreateTerminal', { tty: true, command: ['/nonexistent/sh'], labels: {}, params: {}, id: '' });
    out.badCommand = { status: bad.status, text: bad.text.slice(0, 400) };
    const unsupported = await tryBound(h.base, 'CreateTerminal', { tty: true, command: ['/bin/cat'], labels: {}, params: {}, id: '' });
    out.unsupportedProgram = { status: unsupported.status, text: unsupported.text.slice(0, 400) };
    // call time distribution
    const ms = []; const prompt = [];
    for (let i = 0; i < 20; i += 1) { const x = await Term.create(h, ev); ms.push(x.createMs); await x.ready(); prompt.push(now() - x.createdAt); await x.close(); }
    out.createCallMs = stat(ms); out.promptReadyMsAfterCreateReturn = stat(prompt, 1);
    // an id made by the host: do the first events beat the answer (so a listener started from the answer misses them)?
    { const rec = { sessions: 30, eventsBeforeAnswerReturnedToCaller: [], eventsSeenByAListenerStartedFromTheAnswer: [] };
      for (let i = 0; i < rec.sessions; i += 1) {
        const evn = ev.all.length; const t0 = now();
        const r = await tryBound(h.base, 'CreateTerminal', { tty: true, command: [], labels: {}, params: {}, id: '' });
        const orphans = ev.all.filter((e, j) => j >= evn && e.orphan && e.name.endsWith(r.json.id));
        rec.eventsBeforeAnswerReturnedToCaller.push(orphans.length);
        const x = new Term(h, ev, r.json); await sleep(150); rec.eventsSeenByAListenerStartedFromTheAnswer.push(x.events.length);
        await x.close();
      }
      out.idMadeByHost = { sessions: rec.sessions, sessionsWhoseFirstEventsArrivedBeforeTheCallerHadTheId: rec.eventsBeforeAnswerReturnedToCaller.filter((n) => n > 0).length, eventsLostThatWay: rec.eventsBeforeAnswerReturnedToCaller.reduce((a, b) => a + b, 0), perSessionLost: rec.eventsBeforeAnswerReturnedToCaller.join(','), perSessionSeenAfter: rec.eventsSeenByAListenerStartedFromTheAnswer.join(','), note: 'lost = an event for a session id the caller did not know yet (arrived before the answer was handled); a caller-made id (options.id) subscribed first sees all of them' };
    }
    await t.close();
  } finally { await stopHost(h, 'q1'); }
  return out;
};

async function flood(t, cmd, label) {
  const prevText = t.textOn; t.textOn = false; // markers are found in the chunks instead of a 50 MB string
  const k = (Term.k = (Term.k ?? 1000) + 1);
  const bTag = `@@B${k * 7}@@`; const eTag = `@@E${k * 11}@@`;
  const mark = t.chunks.length; const t0 = now();
  await t.write(`echo @@B$((${k}*7))@@; ${cmd}; echo @@E$((${k}*11))@@\n`);
  const have = () => false;
  const deadline = now() + 180000;
  // poll cheaply: look only at the tail chunks for the end marker
  for (;;) {
    const tail = t.tailStr ?? '';
    if (tail.includes(`${eTag}\r\n`)) break;
    if (now() > deadline) throw new Error('flood timeout');
    await sleep(20);
  }
  t.textOn = prevText;
  const all = Buffer.concat(t.chunks);
  const b = all.lastIndexOf(`${bTag}\r\n`); const e = all.lastIndexOf(eTag);
  const body = all.subarray(b + bTag.length + 2, e);
  const received = Buffer.from(body.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  const startEnd = b + bTag.length + 2;
  const evs = t.events.filter((x) => x.kind === 'stream' && x.end !== undefined);
  const inside = evs.filter((x) => x.end > startEnd && x.end - x.n < e + eTag.length);
  const sizes = inside.map((x) => x.n);
  const dur = inside.length > 1 ? inside[inside.length - 1].t - inside[0].t : 0;
  const expected = spawnSync('sh', ['-c', cmd], { maxBuffer: 1 << 30 }).stdout;
  return {
    label, cmd, expectedBytes: expected.length, receivedBytesAfterCRLFfold: received.length, rawBytesOnPty: body.length, sha256Equal: sha(received) === sha(expected), eventCount: inside.length,
    eventBytes: stat(sizes, 0), eventsAtExactly20480: sizes.filter((s) => s === 20480).length, eventsOver20480: sizes.filter((s) => s > 20480).length,
    firstToLastEventMs: +dur.toFixed(1), eventsPerSecond: dur > 0 ? Math.round(inside.length / (dur / 1000)) : null, MBPerSecondRaw: dur > 0 ? +(body.length / 1e6 / (dur / 1000)).toFixed(2) : null,
    wallMsWriteToEndMarker: +(now() - t0).toFixed(1), duplicateOrMissing: sha(received) !== sha(expected),
    firstDiff: (() => { if (received.equals(expected)) return null; let i = 0; while (i < received.length && received[i] === expected[i]) i += 1; return { at: i, received: JSON.stringify(received.subarray(Math.max(0, i - 12), i + 60).toString('latin1')), expected: JSON.stringify(expected.subarray(Math.max(0, i - 12), i + 60).toString('latin1')) }; })(),
  };
}

sections.q2 = async () => {
  const h = await startHost(); const ev = await new Events(h).open(); const out = {};
  out.loadBefore = load1();
  try {
    const t = await newTerm(h, ev);
    out.promptEvents = t.events.slice(0, 5).map((e) => ({ name: `core/exec/${e.kind}/${e.sig}/<id>`, bytes: e.n, wireJsonChars: e.wire, frameKeys: e.keys }));
    await t.runLine('echo to-stdout; echo to-stderr 1>&2; ls /nonexistent-dir');
    out.stderrProbe = { note: 'the pty has one stream: stderr of every program in the shell lands in the same stdout event', distinctEventNamesSeen: Object.fromEntries(ev.names), ptyFrameKeys: [...new Set(t.events.map((e) => e.keys.join(',')))] };
    check('q2: only stdout stream events and no stderr event for a local shell', ![...ev.names.keys()].some((n) => /stderr/i.test(n)), JSON.stringify([...ev.names.keys()]));
    out.floods = {};
    for (const [label, cmd] of Object.entries(FLOODS)) { out.floods[label] = await flood(t, cmd, label); out.floods[label].loadAfter = load1(); check(`q2: ${label} arrives byte-exact (sha256)`, out.floods[label].sha256Equal); }
    { const rep = { runs: 15, mismatches: 0, diffs: [] };
      for (let i = 0; i < rep.runs; i += 1) { const r = await flood(t, FLOODS.yes200k, 'yes-repeat'); if (!r.sha256Equal) { rep.mismatches += 1; if (rep.diffs.length < 3) rep.diffs.push({ receivedBytes: r.receivedBytesAfterCRLFfold, rawBytesOnPty: r.rawBytesOnPty, firstDiff: r.firstDiff }); } }
      out.yes200kRepeat = rep; check('q2: yes200k repeated 15 times is byte-exact every time', rep.mismatches === 0, JSON.stringify(rep.diffs).slice(0, 300)); }
    out.closeCount = t.closes; await t.close(); await sleep(300); out.closeCountAfterCloseSession = t.closes;
  } finally { await stopHost(h, 'q2'); }
  // payload type as the page sees it, both engines
  out.pagePayload = {};
  const E = await engines();
  for (const name of ['chromium', 'webkit']) {
    const h2 = await startHost(); const b = await E[name]();
    try {
      const page = await openPage(b, h2);
      out.pagePayload[name] = await page.evaluate(async () => {
        const x = await HF.open(); const s = x.session; await HF.ready(x); await HF.runLine(x, 'echo hi');
        return { eventCtor: 'WailsEvent', dataTypes: [...x.types], keys: [...x.keys], hasFromBase64: typeof Uint8Array.fromBase64, hasToBase64: typeof Uint8Array.prototype.toBase64, crossOriginIsolated, visibility: document.visibilityState, timerResolutionMs: (() => { let a = performance.now(), b2 = a; while (b2 === a) b2 = performance.now(); return b2 - a; })(), sessionId: s.id };
      });
    } finally { await b.close(); await stopHost(h2, `q2-page-${name}`); }
  }
  return out;
};

sections.q3 = async () => {
  const h = await startHost(); const ev = await new Events(h).open(); const out = { ways: {} };
  try {
    const ways = { 'exit 3': 'exit 3\n', 'ctrl-D': '\u0004', 'kill -9 $$': 'kill -9 $$\n' };
    for (const [name, input] of Object.entries(ways)) {
      const t = await newTerm(h, ev);
      const mark = t.events.length; const tw = now();
      await t.write(input);
      const deadline = now() + 8000; while (t.closeAt === null && now() < deadline) await sleep(2);
      await sleep(700);
      const after = t.events.slice(mark).map((e) => ({ dtMs: +(e.t - tw).toFixed(1), name: `${e.kind}/${e.sig}`, bytes: e.n, payloadUtf8: JSON.stringify(Buffer.from(e.raw, 'base64').toString()), payloadBase64: e.raw, keys: e.keys.join(',') }));
      const calls = {};
      for (const m of ['GetSession', 'AttachSession', 'DetachSession', 'CloseSession']) { const r = await tryBound(h.base, m, t.id); calls[m] = { status: r.status, text: r.text }; }
      for (const m of ['WriteSession']) { const r = await tryBound(h.base, m, t.id, b64('x')); calls[m] = { status: r.status, text: r.text }; }
      { const r = await tryBound(h.base, 'ResizeSession', t.id, 30, 100); calls.ResizeSession = { status: r.status, text: r.text }; }
      { const r = await tryBound(h.base, 'ListSessions'); calls.ListSessions = { status: r.status, text: r.text, containsEndedSession: r.text.includes(t.id) }; }
      out.ways[name] = { eventsAfterInput: after, closeEvents: t.closes, stdoutAfterClose: t.afterClose, calls };
    }
    const log = h.log();
    out.hostLogLinesAboutExit = log.split('\n').filter((l) => /error waiting for command|session terminated|exit status|signal: killed/i.test(l)).map((l) => l.slice(0, 260));
    check('q3: exactly one CLOSE per ended session', Object.values(out.ways).every((w) => w.closeEvents === 1), JSON.stringify(Object.values(out.ways).map((w) => w.closeEvents)));
    out.exitInfoInPayloads = 'CLOSE payload is the fixed bytes "Session terminated" on every path; no exit code, no signal, nothing else carries one (see ways[*].calls)';
  } finally { await stopHost(h, 'q3'); }
  return out;
};

sections.q4 = async () => {
  const h = await startHost(); const ev = await new Events(h).open(); const out = { loadBefore: load1(), variants: {} };
  const variants = {
    tailOnly: { n: 100, cmd: () => `printf 'tail-marker-%s\\n' $RANDOM; exit` },
    afterAbout200KB: { n: 100, cmd: () => `yes xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx | head -c 200000; printf 'tail-marker-%s\\n' $RANDOM; exit` },
    controlSleepBeforeExit: { n: 30, cmd: () => `printf 'tail-marker-%s\\n' $RANDOM; sleep 0.3; exit` },
    execPrintf: { n: 100, cmd: () => `exec printf 'tail-marker-%s\\n' $RANDOM` },
    execAfter200KB: { n: 100, cmd: () => `exec sh -c "head -c 150000 /dev/zero | base64 -b 100; printf 'tail-marker-%s\\n' $RANDOM"` },
    after3MBThenExit: { n: 30, cmd: () => `head -c 2250000 /dev/zero | base64 -b 100; printf 'tail-marker-%s\\n' $RANDOM; exit` },
    tailOnlyWhileAnotherSessionFloods: { n: 40, floodOther: true, cmd: () => `printf 'tail-marker-%s\\n' $RANDOM; exit` },
    execPrintfWhileAnotherSessionFloods: { n: 40, floodOther: true, cmd: () => `exec printf 'tail-marker-%s\\n' $RANDOM` },
  };
  try {
    for (const [name, v] of Object.entries(variants)) {
      const rec = { runs: v.n, markerMissing: 0, closeMissing: 0, stdoutAfterClose: 0, markerAfterCloseOnly: 0, bytesOfMainBody: [], afterMs: [], promptMs: [] };
      let A = null; if (v.floodOther) { A = await newTerm(h, ev); A.textOn = false; await A.write('yes\n'); await sleep(500); }
      const one = async () => {
        const tc0 = now(); const t = await newTerm(h, ev); t.textOn = true; rec.promptMs.push(now() - tc0);
        const from = t.text.length; await t.write(`${v.cmd()}\n`);
        const dl = now() + 15000; while (t.closeAt === null && now() < dl) await sleep(2);
        await sleep(250);
        if (t.closeAt === null) { rec.closeMissing += 1; await t.close(); return; }
        const beforeClose = t.events.filter((e) => e.kind === 'stream' && e.t < t.closeAt).map((e) => Buffer.from(e.raw, 'base64').toString('latin1')).join('');
        const allText = t.text;
        const m = /tail-marker-\d+\r\n/; const got = m.test(beforeClose);
        if (!got) { rec.markerMissing += 1; if (m.test(allText)) rec.markerAfterCloseOnly += 1; }
        rec.stdoutAfterClose += t.afterClose > 0 ? 1 : 0;
        if (name === 'afterAbout200KB') rec.bytesOfMainBody.push((allText.match(/x{90}/g) ?? []).length * 90);
      };
      for (let i = 0; i < v.n; i += 5) await Promise.all(Array.from({ length: Math.min(5, v.n - i) }, one));
      if (A) { rec.floodingSessionEventsReceivedMeanwhile = A.streamEvents; await A.close(); }
      if (rec.promptMs.length) rec.newShellPromptReadyMs = stat(rec.promptMs, 1); delete rec.promptMs;
      rec.lossRatePercent = +(100 * rec.markerMissing / v.n).toFixed(1);
      if (rec.bytesOfMainBody.length) rec.bodyBytesSeenOf200000 = stat(rec.bytesOfMainBody, 0);
      delete rec.bytesOfMainBody; delete rec.afterMs; rec.loadAfter = load1();
      out.variants[name] = rec;
    }
    out.mechanism = 'backend/pkg/terminal/manager.go: handleWaitForCompletion (L209-214) calls terminateSession as soon as cmd.Wait returns; terminateSessionLocked (L402-414) closes the pty master (L407) while handleOutStream (L255-303) may not have read the last bytes yet. The race is real in the code; the variants above are what it costs in practice. All local sessions share ONE forwarding goroutine (controller.go runLocalMux L163-186, unbuffered outMux L43/L55), so a reader waits for every other session\'s emit.';
  } finally { await stopHost(h, 'q4'); }
  return out;
};

/* runs in the page (HF is the page library) */
const PAGE_RESIZE = async ({ n }) => {
  const x = await HF.open(); const s = x.session; await HF.ready(x);
  const res = { backToBack: [], awaited: null };
  for (let trial = 0; trial < n; trial++) {
    await Promise.all(Array.from({ length: 50 }, (_, i) => HF.call('ResizeSession', s.id, 10 + i, 20 + i)));
    const o = await HF.runLine(x, 'stty size'); const m = o.replace(/\r/g, '').split('\n')[1] ?? '';
    res.backToBack.push(m);
  }
  for (let i = 0; i < 50; i++) await HF.call('ResizeSession', s.id, 60 + i, 80 + i);
  const o2 = await HF.runLine(x, 'stty size'); res.awaited = o2.replace(/\r/g, '').split('\n')[1];
  await HF.call('CloseSession', s.id);
  return res;
};

sections.q5 = async () => {
  const h = await startHost(); const ev = await new Events(h).open(); const out = { loadBefore: load1() };
  try {
    const t = await newTerm(h, ev);
    const r0 = await tryBound(h.base, 'ResizeSession', t.id, 33, 117);
    out.resizeAnswer = { status: r0.status, text: r0.text, ms: +r0.ms.toFixed(2) };
    const o = await t.runLine('stty size; echo "COLUMNS=$COLUMNS LINES=$LINES"; tput cols; tput lines');
    out.afterResizeToRows33Cols117 = o.replace(/\r/g, '').split('\n').slice(0, 5);
    check('q5: stty size prints 33 117 (rows then cols)', /\n33 117\n/.test(o.replace(/\r/g, '')));
    // latency to the shell: zsh TRAPWINCH prints when the signal is delivered
    await t.runLine(`TRAPWINCH() { print -r -- "W:$LINES:$COLUMNS:$(stty size)" }`);
    const lat = [];
    for (let i = 0; i < 30; i += 1) {
      const rows = 20 + i, cols = 90 + i; const from = t.text.length;
      const r = await tryBound(h.base, 'ResizeSession', t.id, rows, cols); const tr = now();
      const dl = now() + 3000; let seen = false;
      while (!seen && now() < dl) { seen = t.text.slice(from).includes(`:${rows} ${cols}\r\n`); if (!seen) await sleep(1); }
      lat.push(seen ? now() - tr : NaN); if (r.status !== 200) throw new Error('resize failed');
      await sleep(30);
    }
    out.msFromResizeCallReturnedToShellKnowsIt = stat(lat.filter((x) => !Number.isNaN(x))); out.notSeenWithin3s = lat.filter(Number.isNaN).length;
    await t.runLine('unfunction TRAPWINCH');
    // events produced by a resize
    const before = t.events.length; await tryBound(h.base, 'ResizeSession', t.id, 40, 100); await sleep(600);
    out.eventsAfterResizeAtThePrompt = t.events.slice(before).map((e) => ({ name: `${e.kind}/${e.sig}`, bytes: e.n, text: JSON.stringify(Buffer.from(e.raw, 'base64').toString()) }));
    const before2 = t.events.length; await t.write('cat > /dev/null\n'); await sleep(300);
    const b3 = t.events.length; await tryBound(h.base, 'ResizeSession', t.id, 41, 101); await sleep(600);
    out.eventsAfterResizeWhileCatRuns = t.events.slice(b3).map((e) => ({ name: `${e.kind}/${e.sig}`, bytes: e.n }));
    await t.write('\u0004'); await sleep(200);
    // back to back from Node: not awaited, then awaited
    const finals = [];
    for (let trial = 0; trial < 20; trial += 1) {
      await Promise.all(Array.from({ length: 50 }, (_, i) => tryBound(h.base, 'ResizeSession', t.id, 10 + i, 20 + i)));
      const o2 = await t.runLine('stty size'); finals.push(o2.replace(/\r/g, '').split('\n')[1]);
    }
    out.node50NotAwaitedFinalSizes = { sent: 'rows 10+i cols 20+i for i in 0..49 (last = 59 69)', finals: Object.fromEntries(finals.reduce((m, f) => m.set(f, (m.get(f) ?? 0) + 1), new Map())) };
    for (let i = 0; i < 50; i += 1) await tryBound(h.base, 'ResizeSession', t.id, 60 + i, 80 + i);
    out.node50AwaitedFinal = { expected: '109 129', got: (await t.runLine('stty size')).replace(/\r/g, '').split('\n')[1] };
    check('q5: 50 awaited resizes end at the last size', out.node50AwaitedFinal.got === out.node50AwaitedFinal.expected, out.node50AwaitedFinal.got);
    const odd = {};
    for (const [k, args] of Object.entries({ negativeRows: [-1, 10], zeroZero: [0, 0], tooBig: [70000, 10], floatRows: [10.5, 10] })) { const r = await tryBound(h.base, 'ResizeSession', t.id, ...args); odd[k] = { status: r.status, text: r.text.slice(0, 200) }; }
    out.oddArguments = odd;
    await t.close();
  } finally { await stopHost(h, 'q5'); }
  out.pages = {};
  const E = await engines();
  for (const name of ['chromium', 'webkit']) {
    const h2 = await startHost(); const b = await E[name]();
    try {
      const page = await openPage(b, h2);
      const res = await page.evaluate(PAGE_RESIZE, { n: 20 });
      out.pages[name] = { backToBackNotAwaitedFinal: Object.fromEntries(res.backToBack.reduce((m, f) => m.set(f, (m.get(f) ?? 0) + 1), new Map())), awaitedFinal: res.awaited, expectedAwaited: '109 129' };
    } finally { await b.close(); await stopHost(h2, `q5-page-${name}`); }
  }
  return out;
};

sections.q6 = async () => {
  const h = await startHost(); const ev = await new Events(h).open(); const out = { loadBefore: load1() };
  try {
    const t = await newTerm(h, ev);
    const a1 = await tryBound(h.base, 'AttachSession', t.id);
    out.attachAnswerShape = { status: a1.status, isArray: Array.isArray(a1.json), length: a1.json?.length, element0: a1.json?.[0], element1Type: typeof a1.json?.[1], element1Base64Chars: a1.json?.[1]?.length, element1Utf8: JSON.stringify(Buffer.from(a1.json?.[1] ?? '', 'base64').toString()).slice(0, 200) };
    const g = await tryBound(h.base, 'GetSession', t.id); out.getSessionAfterAttach = g.json;
    const l = await tryBound(h.base, 'ListSessions'); out.listSessionsAfterAttach = l.json;
    // 3 MB
    await flood(t, 'head -c 2250000 /dev/zero | base64 -b 100', '3MB');
    const all = Buffer.concat(t.chunks);
    const a2 = await tryBound(h.base, 'AttachSession', t.id); const buf2 = Buffer.from(a2.json[1], 'base64');
    const a3 = await tryBound(h.base, 'AttachSession', t.id); const buf3 = Buffer.from(a3.json[1], 'base64');
    out.after3MB = { totalBytesReceivedByEvents: all.length, bufferBytes: buf2.length, bufferEqualsLast1000000OfReceived: buf2.equals(all.subarray(all.length - 1000000)), secondAttachSameBytes: buf2.equals(buf3), attachCallMs: +a2.ms.toFixed(1), attachAnswerJsonChars: a2.text.length };
    check('q6: buffer holds exactly the last 1,000,000 bytes', out.after3MB.bufferBytes === 1000000 && out.after3MB.bufferEqualsLast1000000OfReceived);
    // detach: do events stop?
    const d = await tryBound(h.base, 'DetachSession', t.id); out.detachAnswer = { status: d.status, json: d.json };
    const n0 = t.events.length; await t.runLine('echo after-detach-marker');
    out.eventsAfterDetach = { arrived: t.events.length - n0, containsMarker: t.text.includes('after-detach-marker\r\n') };
    check('q6: DetachSession does not stop events for a local session', out.eventsAfterDetach.arrived > 0);
    const g2 = await tryBound(h.base, 'GetSession', t.id); out.attachedAfterDetach = g2.json?.attached;
    // attach in the middle of a flood: how far apart are the buffer and the events
    t.textOn = false;
    const mark = t.total; await t.write('seq 1 600000\n');
    for (;;) { if (t.total - mark > 1500000) break; await sleep(2); }
    const a4 = await tryBound(h.base, 'AttachSession', t.id); const eventsTail = t.tailStr; const at = Buffer.from(a4.json[1], 'base64').toString('latin1');
    const lastNum = (s) => { const m = [...s.matchAll(/(\d+)\r\n/g)]; return m.length ? +m[m.length - 1][1] : null; };
    out.attachMidFlood = { bufferBytes: at.length, lastLineInBuffer: lastNum(at), lastLineInEventsWhenAttachReturned: lastNum(eventsTail), note: 'positive difference = events were ahead of the buffer when the call returned (a viewer that renders the buffer then live events would show a gap, not a repeat); negative = buffer ahead (a repeat)' };
    for (;;) { if ((t.tailStr ?? '').includes('600000\r\n')) break; await sleep(20); }
    t.textOn = true; await t.runLine('true');
    await t.close();
  } finally { await stopHost(h, 'q6'); }
  return out;
};

sections.q7 = async () => {
  const h = await startHost(); const ev = await new Events(h).open(); const out = { loadBefore: load1() };
  try {
    const t = await newTerm(h, ev);
    // canonical mode, echo off, cat
    await t.write('stty -echo; cat\n'); await sleep(300);
    const mb = 'é😀 naïve — 日本語 ✓\n'; const from = t.text.length; await t.write(mb); await t.waitText(/✓|\xe2\x9c\x93/, from, 5000).catch(() => {});
    await sleep(100);
    const got = Buffer.concat(t.chunks).toString('utf8');
    out.multibyte = { sent: JSON.stringify(mb), echoedIntact: got.includes(mb.replace(/\n$/, '')), sentBytes: Buffer.byteLength(mb) };
    check('q7: multibyte UTF-8 survives write and cat echo', out.multibyte.echoedIntact);
    // 100 KB single write with newlines
    const line = `${'0123456789'.repeat(9)}abcd\n`; const big = line.repeat(Math.ceil(102400 / line.length));
    const mark = t.total; t.textOn = false; const tw = now();
    const wr = await t.write(big);
    for (;;) { if (t.total - mark >= big.length + 10 && Buffer.concat(t.chunks.slice(-50)).toString('latin1').includes(line.trim())) { if (now() - (t.lastT ?? 0) > 150) break; } if (now() - tw > 30000) break; await sleep(10); }
    const echoed = Buffer.concat(t.chunks).subarray(mark).toString('latin1').replace(/\r\n/g, '\n');
    out.write100KBcanonical = { sentBytes: big.length, writeCallMs: +wr.ms.toFixed(1), writeStatus: wr.status, receivedBytes: echoed.length, identical: echoed === big, totalMsToLastEvent: +((t.lastT ?? 0) - tw).toFixed(1) };
    await t.write('\u0004'); await sleep(300); t.textOn = true;
    // raw mode: one 100 KB write without newline, then 1-byte RTT
    await t.write('stty raw -echo; cat\n'); await sleep(300);
    const noNl = 'x'.repeat(102400); const mark2 = t.total; const tw2 = now(); const wr2 = await t.write(noNl);
    for (;;) { if (t.total - mark2 >= noNl.length) break; if (now() - tw2 > 20000) break; await sleep(5); }
    out.write100KBrawNoNewline = { sentBytes: noNl.length, receivedBytes: t.total - mark2, totalMs: +(now() - tw2).toFixed(1), writeCallMs: +wr2.ms.toFixed(1) };
    // order of 100 not-awaited writes (raw mode: bytes come back at once)
    const mark3 = t.total; const L = (i) => `<${String(i).padStart(3, '0')}>`;
    await Promise.all(Array.from({ length: 100 }, (_, i) => t.write(L(i))));
    await sleep(500);
    const tail = Buffer.concat(t.chunks).subarray(mark3).toString('latin1'); const order = [...tail.matchAll(/<(\d{3})>/g)].map((m) => +m[1]);
    out.nodeOrder100NotAwaited = { received: order.length, inOrder: order.every((v, i) => i === 0 || v > order[i - 1]), firstTenReceived: order.slice(0, 10), inversions: order.reduce((c, v, i) => c + (i > 0 && v < order[i - 1] ? 1 : 0), 0) };
    // sequential awaited: order
    const mark4 = t.total; for (let i = 0; i < 100; i += 1) await t.write(L(i)); await sleep(300);
    const o4 = [...Buffer.concat(t.chunks).subarray(mark4).toString('latin1').matchAll(/<(\d{3})>/g)].map((m) => +m[1]);
    out.nodeOrder100Awaited = { received: o4.length, inOrder: o4.every((v, i) => i === 0 || v > o4[i - 1]) };
    // RTT, one byte, idle
    const rtt = []; const rttCall = [];
    for (let i = 0; i < 200; i += 1) {
      const p0 = new Promise((r) => { t.onData = r; }); const t0 = now(); const p = t.write('a');
      const tev = await p0; rtt.push(tev - t0); const r = await p; rttCall.push(r.ms); await sleep(5);
    }
    out.nodeRttOneByteMs = stat(rtt, 3); out.nodeWriteCallMs = stat(rttCall, 3);
    await t.close();
  } finally { await stopHost(h, 'q7-node'); }
  // UTF-8 split across events
  const h2 = await startHost(); const ev2 = await new Events(h2).open();
  try {
    const t = await newTerm(h2, ev2); t.textOn = false;
    await flood(t, "yes 'é😀日' | head -c 5000000", 'utf8');
    out.utf8SplitAcrossEvents = { streamEvents: t.streamEvents, eventsEndingInsideAMultibyteSequence: t.utf8Splits ?? 0, note: 'raw pty reads: a character can be cut between two events, so a TextDecoder needs {stream: true} or the bytes go to xterm as Uint8Array' };
    await t.close();
  } finally { await stopHost(h2, 'q7-utf8'); }
  // pages
  out.pages = {}; const E = await engines();
  for (const name of ['chromium', 'webkit']) {
    const h3 = await startHost(); const b = await E[name]();
    try {
      const page = await openPage(b, h3);
      out.pages[name] = await page.evaluate(async () => {
        const x = await HF.open(); const s = x.session; await HF.ready(x);
        await HF.call('WriteSession', s.id, HF.enc('stty raw -echo; cat\n')); await HF.sleep(300);
        const res = {};
        const L = (i) => '<' + String(i).padStart(3, '0') + '>';
        const from = x.text.length;
        await Promise.all(Array.from({ length: 100 }, (_, i) => HF.call('WriteSession', s.id, HF.enc(L(i)))));
        await HF.sleep(500);
        const order = [...x.text.slice(from).matchAll(/<(\d{3})>/g)].map((m) => +m[1]);
        res.order100NotAwaited = { received: order.length, inversions: order.reduce((c, v, i) => c + (i > 0 && v < order[i - 1] ? 1 : 0), 0), firstTen: order.slice(0, 10) };
        const rtt = [], callMs = [];
        for (let i = 0; i < 200; i++) {
          const from2 = x.text.length; const p = HF.waitText(x, 'a', 3000); const t0 = performance.now();
          const c = HF.call('WriteSession', s.id, HF.enc('a')); const tev = await p; rtt.push(tev - t0); await c; callMs.push(performance.now() - t0); await HF.sleep(5);
        }
        res.rttOneByteMs = HF.stat(rtt); res.writeCallPlusEventMs = HF.stat(callMs);
        res.timerResolutionMs = (() => { let a = performance.now(), b2 = a; while (b2 === a) b2 = performance.now(); return b2 - a; })(); res.crossOriginIsolated = crossOriginIsolated;
        await HF.call('WriteSession', s.id, HF.enc('\u0003')); await HF.call('CloseSession', s.id);
        return res;
      });
      out.pages[name].loadAfter = load1();
    } finally { await b.close(); await stopHost(h3, `q7-page-${name}`); }
  }
  return out;
};

sections.q8 = async () => {
  const out = { loadBefore: load1(), engines: {} }; const E = await engines();
  const h = await startHost(); const evNode = await new Events(h).open();
  try {
    for (const name of ['chromium', 'webkit']) {
      const b = await E[name](); const rec = {};
      try {
        const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
        const p1 = await openPage(b, h, undefined, ctx); const p2 = await openPage(b, h, undefined, ctx);
        const mk = async (page, label) => {
          const r = await page.evaluate(async (label) => { const x = await HF.open({ labels: { page: label } }); const s = x.session; await HF.ready(x); const o = await HF.runLine(x, 'echo PID$$X'); await HF.call('WriteSession', s.id, HF.enc('while :; do echo tick; sleep 1; done\n')); return { id: s.id, pid: +o.match(/PID(\d+)X/)[1] }; }, label);
          return r;
        };
        // page 2 counts every event of the session page 1 made
        const A = await mk(p1, 'p1-close');
        await p2.evaluate((id) => { window.__other = HF.sub(id, 'count'); }, A.id);
        const ticks = () => p2.evaluate(() => window.__other.n);
        const t0 = await ticks(); await sleep(2500); const t1 = await ticks();
        rec.closeCase = { sessionId: A.id, shellPid: A.pid, page2EventsInitially2500ms: t1 - t0 };
        await p1.close(); await sleep(3000);
        const list = await tryBound(h.base, 'ListSessions');
        rec.closeCase.afterPage1Closed = { listedByNode: list.text.includes(A.id), processAlive: alive(A.pid), ps: spawnSync('ps', ['-o', 'pid=,ppid=,stat=,comm=', '-p', String(A.pid)]).stdout.toString().trim(), page2EventsIn2500ms: null };
        const a = await ticks(); await sleep(2500); const a2 = await ticks(); rec.closeCase.afterPage1Closed.page2EventsIn2500ms = a2 - a;
        // reload
        const p3 = await openPage(b, h, undefined, ctx);
        const B = await mk(p3, 'p3-reload');
        await p2.evaluate((id) => { window.__other2 = HF.sub(id, 'count'); }, B.id);
        await p3.reload(); await sleep(1500);
        const list2 = await tryBound(h.base, 'ListSessions');
        const c0 = await p2.evaluate(() => window.__other2.n); await sleep(2500); const c1 = await p2.evaluate(() => window.__other2.n);
        rec.reloadCase = { sessionId: B.id, shellPid: B.pid, listedByNode: list2.text.includes(B.id), processAlive: alive(B.pid), page2EventsIn2500ms: c1 - c0, pageAfterReloadHasRuntime: await p3.evaluate(() => typeof window.W === 'undefined' ? 'no bundle (the reloaded page has no memory of the session)' : 'bundle') };
        rec.ids = [A, B];
        await p2.close(); await p3.close();
      } finally { await b.close(); }
      out.engines[name] = rec;
    }
    // does the host ever reap them? wait 60 s
    await sleep(60000);
    const list = await tryBound(h.base, 'ListSessions');
    for (const name of Object.keys(out.engines)) for (const s of out.engines[name].ids) { s.listedAfter60s = list.text.includes(s.id); s.aliveAfter60s = alive(s.pid); }
    out.sessionsListedAt60s = list.json?.length; out.loadAfter = load1();
    out.hostLogWebSocket = h.log().split('\n').filter((l) => /WebSocket client/.test(l)).map((l) => l.replace(/^\S+\s+/, '').slice(0, 120)).slice(-12);
    out.codeEvidence = {
      note: 'no code path ties exec sessions to a window: backend/window/* never imports plugin/exec, controller.go has no window or client hook; the broadcaster (wails websocket_server.go) sends every event to every connected socket',
      grep: spawnSync('sh', ['-c', `cd ${ROOT} && echo "files in backend/window that mention plugin/exec: $(grep -rl 'plugin/exec' backend/window | grep -v _test | wc -l | tr -d ' ')"; echo "release hooks in exec controller: $(grep -nE 'WindowClos|OnWindow|clientId|ClientID' backend/pkg/plugin/exec/controller.go | wc -l | tr -d ' ')"`]).stdout.toString().trim().split('\n'),
    };
    for (const name of Object.keys(out.engines)) for (const s of out.engines[name].ids) await tryBound(h.base, 'CloseSession', s.id);
    await sleep(500);
  } finally { await stopHost(h, 'q8'); }
  return out;
};

sections.q9 = async () => {
  const h = await startHost(); const ev = await new Events(h).open(); const out = { loadBefore: load1() };
  const psrow = (pid) => spawnSync('ps', ['-o', 'pid=,ppid=,pgid=,tpgid=,stat=,comm=', '-p', String(pid)]).stdout.toString().trim() || '(gone)';
  try {
    // foreground sleep + background sleep
    const t = await newTerm(h, ev); const shellPid = await t.pid();
    await t.runLine('sleep 301 &'); await t.write('sleep 300\n'); await sleep(500);
    const kids = descendants(shellPid);
    const fg = kids.find((k) => /sleep/.test(k.comm) && alive(k.pid)); const kidRows = kids.map((k) => ({ pid: k.pid, ps: psrow(k.pid) }));
    out.before = { shellPid, children: kidRows, shellRow: psrow(shellPid) };
    const tc = now(); const r = await t.close(); const tr = now();
    const gone = {}; const watch = [shellPid, ...kids.map((k) => k.pid)];
    const dl = now() + 5000; while (now() < dl && watch.some((p) => gone[p] === undefined)) { for (const p of watch) if (gone[p] === undefined && !alive(p)) gone[p] = +(now() - tr).toFixed(1); await sleep(1); }
    out.closeSession = { status: r.status, text: r.text, callMs: +(tr - tc).toFixed(1), msAfterReturnUntilGone: gone, stillAliveAfter5s: watch.filter((p) => alive(p)).map((p) => ({ pid: p, ps: psrow(p) })), closeEvents: t.closes };
    await sleep(500);
    const orphans = watch.filter((p) => alive(p)); out.orphansAfter = orphans.map((p) => ({ pid: p, ps: psrow(p) }));
    for (const p of orphans) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
    out.zombieCheck = spawnSync('sh', ['-c', `ps -axo pid=,ppid=,stat=,comm= | awk '$3 ~ /Z/ && ($2==${h.pid})'`]).stdout.toString().trim() || 'no zombie child of the host';
    // flood and close
    const t2 = await newTerm(h, ev); const shell2 = await t2.pid(); t2.textOn = false; const yesBefore = t2.total;
    await t2.write('yes\n'); while (t2.total - yesBefore < 2_000_000) await sleep(5);
    const kids2 = descendants(shell2);
    const yesPid = kids2.find((k) => /yes/.test(k.comm))?.pid;
    const n0 = t2.events.length; const tc2 = now(); const r2 = await t2.close(); const trr = now();
    await sleep(2500);
    const after = t2.events.slice(n0).filter((e) => e.kind === 'stream');
    out.closeDuringYesFlood = { yesPid, yesAliveAfter2500ms: yesPid ? alive(yesPid) : 'unknown', callMs: +(trr - tc2).toFixed(1), streamEventsReceivedAfterCallStarted: after.length, streamEventsAfterCallReturned: after.filter((e) => e.t > trr).length, msFromReturnToLastStreamEvent: after.length ? +(Math.max(...after.map((e) => e.t)) - trr).toFixed(1) : null, bytesAfterReturn: after.filter((e) => e.t > trr).reduce((s, e) => s + e.n, 0), closeEvents: t2.closes, closeEventMsAfterReturn: t2.closeAt ? +(t2.closeAt - trr).toFixed(1) : null, stdoutAfterClose: t2.afterClose };
    if (yesPid && alive(yesPid)) { try { process.kill(yesPid, 'SIGKILL'); } catch { /* gone */ } }
    // does a program that ignores SIGHUP survive?
    const t3 = await newTerm(h, ev); const shell3 = await t3.pid(); await t3.write("trap '' HUP; sleep 302\n"); await sleep(500);
    const sp = descendants(shell3).find((d) => /sleep/.test(d.comm)); await t3.close(); await sleep(1500);
    out.ignoresSighupForegroundSurvives = sp ? { pid: sp.pid, alive: alive(sp.pid) } : 'n/a'; if (sp && alive(sp.pid)) process.kill(sp.pid, 'SIGKILL');
  } finally { await stopHost(h, 'q9'); }
  return out;
};

sections.q10 = async () => {
  const h = await startHost(); const ev = await new Events(h).open(); const out = {};
  try {
    const t = await newTerm(h, ev); const pid = await t.pid();
    const ps = (p) => spawnSync('ps', ['-o', 'pid=,pgid=,tpgid=,stat=,comm=', '-p', String(p)]).stdout.toString().trim();
    out.idleShell = ps(pid);
    await t.write('sleep 300\n'); await sleep(500);
    const kid = descendants(pid).find((d) => /sleep/.test(d.comm));
    out.shellWhileSleepRuns = ps(pid); out.sleepRow = kid ? ps(kid.pid) : '(none)';
    const [, pgid, tpgid] = out.shellWhileSleepRuns.split(/\s+/);
    out.groundTruthFromPs = { shellPgid: +pgid, foregroundPgid: +tpgid, foregroundIsNotTheShell: +pgid !== +tpgid };
    const sessionFields = { get: (await tryBound(h.base, 'GetSession', t.id)).json, list: (await tryBound(h.base, 'ListSessions')).json };
    out.backendAnswersWhileSleepRuns = sessionFields;
    check('q10: no backend call carries a foreground-process field', !JSON.stringify(sessionFields).match(/foreground|pgid|pgrp|process|busy|running/i));
    const exec = await tryBound(h.base, 'GetHandlers'); out.getHandlersKeys = exec.text.slice(0, 120);
    await t.write('\u0003'); await sleep(200);
    await t.close();
  } finally { await stopHost(h, 'q10'); }
  out.proposal = 'Manager.ForegroundPID(sessionID) (int, error): under m.mux.RLock take ptyFile; pgrp, err := unix.IoctlGetInt(int(ptyFile.Fd()), unix.TIOCGPGRP); compare with the shell pid (cmd.Process.Pid is its own pgrp leader: Setsid by pty.Start); busy = pgrp != cmd.Process.Pid. Expose through Controller + ServiceWrapper (service_wrapper.go) as GetSessionForeground(sessionID).';
  out.codeSearch = spawnSync('sh', ['-c', `cd ${ROOT} && echo "foreground/pgrp calls in backend/pkg/terminal and backend/pkg/plugin/exec (non-test): $(grep -rnE 'TIOCGPGRP|Tcgetpgrp|Getpgid|Getpgrp|foreground' backend/pkg/terminal backend/pkg/plugin/exec --include=*.go | grep -v _test | wc -l | tr -d ' ')"; echo "Session fields (plugin-sdk exec/session.go L20-27): created_at labels params id command attached"`]).stdout.toString().trim().split('\n');
  // The proposed mechanism, tried on this machine with a throwaway Go program (not part of the product): ioctl TIOCGPGRP on the pty MASTER, as the backend holds it.
  const gdir = mkdtempSync(path.join(os.tmpdir(), 'hf-go-'));
  const goMod = readFileSync(path.join(ROOT, 'go.mod'), 'utf8'); const ver = (m) => goMod.match(new RegExp(`${m} (v[0-9.]+)`))[1];
  writeFileSync(path.join(gdir, 'go.mod'), 'module pgrp\n\ngo 1.22\n');
  writeFileSync(path.join(gdir, 'main.go'), `package main

import (
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/creack/pty"
	"golang.org/x/sys/unix"
)

func fg(f *os.File) (int, error) { return unix.IoctlGetInt(int(f.Fd()), unix.TIOCGPGRP) }

func main() {
	cmd := exec.Command("/bin/zsh", "-i", "-l")
	f, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 27, Cols: 72})
	if err != nil {
		panic(err)
	}
	go func() { b := make([]byte, 4096); for { if _, err := f.Read(b); err != nil { return } } }()
	time.Sleep(600 * time.Millisecond)
	a, e := fg(f)
	fmt.Println("idle: shell pid", cmd.Process.Pid, "tcgetpgrp(master)", a, e)
	f.Write([]byte("sleep 5\\n"))
	time.Sleep(600 * time.Millisecond)
	a, e = fg(f)
	fmt.Println("sleep running: tcgetpgrp(master)", a, e, "differs from shell pid:", a != cmd.Process.Pid)
	f.Write([]byte("\\x03"))
	time.Sleep(400 * time.Millisecond)
	a, e = fg(f)
	fmt.Println("after ctrl-c: tcgetpgrp(master)", a, e)
	f.Write([]byte("exit\\n"))
	cmd.Wait()
}
`);
  const goEnv = { ...process.env, GOFLAGS: '-mod=mod', GOPROXY: 'off', GOWORK: 'off' };
  const g1 = spawnSync('go', ['get', `github.com/creack/pty@${ver('creack/pty')}`, `golang.org/x/sys@${ver('golang.org/x/sys')}`], { cwd: gdir, env: goEnv });
  const g2 = spawnSync('go', ['run', '.'], { cwd: gdir, env: goEnv, timeout: 60000 });
  out.goTiocgpgrpProbeOnPtyMaster = { output: g2.stdout.toString().trim().split('\n'), stderr: g2.stderr.toString().slice(0, 300), getStderr: g1.stderr.toString().slice(0, 200) };
  check('q10: TIOCGPGRP on the master tells a foreground child from the idle shell', /differs from shell pid: true/.test(g2.stdout.toString()), g2.stderr.toString().slice(0, 200));
  return out;
};

async function q11impl(rssOnly) {
  const out = { loadBefore: load1(), engines: {} }; const E = await engines();
  const MODES = { yes2M: ['count', 'fromBase64', 'atob', 'jsb64', 'push'], b64_50MB: ['count', 'fromBase64', 'atob', 'push'] };
  const FL = { yes2M: 'yes | head -2000000', b64_50MB: 'head -c 40000000 /dev/zero | base64 -b 100 | head -c 50000000' };
  for (const name of rssOnly ? [] : ['chromium', 'webkit']) {
    const b = await E[name](); const rec = { runs: [] };
    try {
      const h = await startHost();
      try {
        const page = await openPage(b, h, name === 'chromium' ? { width: 1440, height: 900 } : { width: 1280, height: 800 });
        rec.env = await page.evaluate(() => ({ fromBase64: typeof Uint8Array.fromBase64, visibility: document.visibilityState, timerResolutionMs: (() => { let a = performance.now(), b2 = a; while (b2 === a) b2 = performance.now(); return b2 - a; })(), crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency }));
        // idle rAF baseline
        rec.rafIdleMs = await page.evaluate(async () => { const stop = HF.rafWatch(); await HF.sleep(2000); const d = stop(); return HF.stat(d.slice(2)); });
        // decode calibration: one 20 KB payload
        rec.calibration20480Bytes = await page.evaluate(() => {
          const raw = new Uint8Array(20480); for (let i = 0; i < raw.length; i++) raw[i] = (i * 31) & 255; let t = ''; for (let i = 0; i < raw.length; i += 0x2000) t += String.fromCharCode.apply(null, raw.subarray(i, i + 0x2000)); const s = btoa(t);
          const time = (f, n = 400) => { f(); const t0 = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t0) / n * 1000; };
          const out = { payloadBase64Chars: s.length, atobOnlyUs: time(() => atob(s)), atobLoopUs: time(() => { const x = atob(s); const u = new Uint8Array(x.length); for (let i = 0; i < x.length; i++) u[i] = x.charCodeAt(i); return u; }), jsbase64Us: time(() => jsb64(s)) };
          if (typeof Uint8Array.fromBase64 === 'function') out.fromBase64Us = time(() => Uint8Array.fromBase64(s));
          const frame = JSON.stringify({ name: 'core/exec/stream/stdout/00000000-0000-0000-0000-000000000000', data: s }); out.jsonParseOfFrameUs = time(() => JSON.parse(frame));
          return out;
        });
        for (const [fl, cmd] of Object.entries(FL)) for (const mode of MODES[fl]) {
          if (mode === 'fromBase64' && rec.env.fromBase64 !== 'function') continue;
          const load = load1();
          const r = await page.evaluate(async ({ cmd, mode }) => {
            const x = await HF.open(); const s0 = x.session; await HF.ready(x);
            x.mode = mode; x.n = 0; x.bytes = 0; x.cost = []; x.sizes = []; x.strs = [];
            const stop = HF.rafWatch(); const tw = performance.now();
            await HF.call('WriteSession', s0.id, HF.enc(cmd + '\n'));
            // end of flood = 1.5 s of silence after the first events
            let last = 0; for (;;) { await HF.sleep(250); if (x.n > 0 && x.n === last && performance.now() - x.tLast > 1500) break; last = x.n; if (performance.now() - tw > 170000) break; }
            const raf = stop(); const dur = x.tLast - x.tFirst; const costs = x.cost;
            const r = { events: x.n, bytes: x.bytes, durMs: dur, eventsPerSec: x.n / (dur / 1000), MBPerSec: x.bytes / 1e6 / (dur / 1000), handlerUs: { n: costs.length, p50: HF.pct(costs, 50) * 1000, p95: HF.pct(costs, 95) * 1000, mean: costs.reduce((a, c) => a + c, 0) / costs.length * 1000, totalMs: costs.reduce((a, c) => a + c, 0) }, sizes: HF.stat(x.sizes), rafMs: HF.stat(raf.slice(2)), rafFramesDuringFlood: raf.length, pushedChars: x.strs.reduce((a, c) => a + c.length, 0) };
            x.off(); await HF.call('CloseSession', s0.id); return r;
          }, { cmd, mode });
          r.handlerBusyFractionOfFlood = +(r.handlerUs.totalMs / r.durMs).toFixed(4); r.load1 = load; r.flood = fl; r.mode = mode;
          rec.runs.push(r); console.log(`  q11 ${name} ${fl} ${mode} ev=${r.events} ${r.eventsPerSec.toFixed(0)}/s ${r.MBPerSec.toFixed(1)}MB/s load=${load}`);
        }
        // hidden-tab probe
        const other = await b.newPage(); await other.goto('about:blank'); await other.bringToFront(); await sleep(300);
        rec.hiddenTabProbe = { visibilityOfFloodPageAfterBringToFrontOfAnother: await page.evaluate(() => document.visibilityState), note: 'headless: every page stays visible; a really hidden tab could not be produced, the push-only handler mode is the hidden-terminal path' };
        await other.close();
      } finally { await stopHost(h, `q11-${name}`); }
    } finally { await b.close(); }
    out.engines[name] = rec;
  }
  // host memory and CPU while a 50 MB flood runs: with no listener, with a fast listener (controls), with a stalled socket, with a page whose handler blocks the main thread for 5 s
  out.hostRss = {};
  const E2 = await engines();
  const cpuOf = (pid) => { const s = spawnSync('ps', ['-o', 'cputime=', '-p', String(pid)]).stdout.toString().trim(); const p = s.split(':').map(Number); return p.length ? p.reduce((a, v) => a * 60 + v, 0) : null; };
  for (const kind of ['noClient', 'fastNodeClient', 'pageBlocked5s-chromium', 'stalledRawSocketClient']) {
    const h = await startHost(); const rec = { rssKBBefore: rss(h.pid), samples: [], load1: load1() };
    let b; let sock; let fast;
    try {
      if (kind === 'fastNodeClient') fast = await new Events(h).open();
      if (kind === 'stalledRawSocketClient') {
        sock = net.connect(h.port, '127.0.0.1');
        await new Promise((r) => sock.once('connect', r));
        sock.write(`GET /wails/events?clientId=stalled HTTP/1.1\r\nHost: 127.0.0.1:${h.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
        await sleep(300); sock.pause();
      }
      let sid;
      if (kind === 'pageBlocked5s-chromium') {
        b = await E2.chromium(); const page = await openPage(b, h);
        sid = await page.evaluate(async () => { const x = await HF.open({}, 'text'); await HF.ready(x); x.mode = 'block5s'; return x.id; });
      } else { sid = (await tryBound(h.base, 'CreateTerminal', { tty: true, command: [], labels: {}, params: {}, id: '' })).json.id; await sleep(500); }
      await sleep(1000); rec.rssKBBefore = rss(h.pid); const cpu0 = cpuOf(h.pid);
      let stop = false; const t0 = performance.now(); const poll = (async () => { while (!stop) { rec.samples.push([Math.round(performance.now() - t0), rss(h.pid)]); await sleep(100); } })();
      for (let round = 1; round <= 2; round += 1) {
        const wr = await tryBound(h.base, 'WriteSession', sid, b64('head -c 40000000 /dev/zero | base64 -b 100 | head -c 50000000\n'));
        await sleep(round === 1 ? 10000 : 8000);
        rec[`rssKBAfterFlood${round}Plus${round === 1 ? 10 : 8}s`] = rss(h.pid);
      }
      rec.rssKBPeak = rec.samples.reduce((m, s) => (s[1] > m ? s[1] : m), 0); rec.hostCpuSecondsFor2Floods = +(cpuOf(h.pid) - cpu0).toFixed(2);
      if (fast) rec.fastClientFrames = fast.frames;
      if (sock) { sock.destroy(); await sleep(6000); rec.rssKBSixSecondsAfterClientGone = rss(h.pid); }
      stop = true; await poll; rec.samples = rec.samples.filter((_, i) => i % 10 === 0);
      rec.floodBytesNominal = 50_000_000; rec.floods = 2;
      await tryBound(h.base, 'CloseSession', sid);
    } finally { if (b) await b.close(); await stopHost(h, `q11-rss-${kind}`); }
    out.hostRss[kind] = rec;
  }
  out.loadAfter = load1();
  return out;
}
sections.q11 = () => q11impl(false);
/** only the host-memory part, merged into the stored q11 (the page floors are kept) */
sections.q11rss = async () => { const r = await q11impl(true); R.q11 = { ...(R.q11 ?? {}), hostRss: r.hostRss, hostRssRun: { loadBefore: r.loadBefore, loadAfter: r.loadAfter } }; return { merged: 'q11.hostRss', hostRssRun: R.q11.hostRssRun }; };

sections.q12 = async () => {
  const h = await startHost(); const ev = await new Events(h).open(); const out = {};
  try {
    const idA = randomUUID(); const evB = await new Events(h).open(); const mirror = new Term(h, evB, { id: idA });
    const t = await newTerm(h, ev, { id: idA, labels: { owner: 'host-facts', 'k two': 'v' }, params: { p: '1' } });
    out.sessionJson = t.session;
    out.idShape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(t.id) ? 'uuid v4' : t.id;
    const env = (await t.runLine('env | sort')).replace(/\r/g, '').split('\n').filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l));
    const names = env.map((l) => l.split('=')[0]);
    out.shellEnvNames = names; out.hostEnvNames = Object.keys(h.env);
    out.hostEnvVarsThatReachTheShell = Object.keys(h.env).filter((k) => names.includes(k));
    out.shellEnvKeyValues = Object.fromEntries(env.filter((l) => /^(HOME|PWD|SHELL|TERM|OMNIVIEW_[A-Z_]+|GOWORK|WAILS_SERVER_HOST|WAILS_SERVER_PORT|LANG|USER|SHLVL|TERM_PROGRAM|COLORTERM|LOGNAME)=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]));
    out.cwd = (await t.runLine('pwd')).replace(/\r/g, '').split('\n')[1]; out.homeOfHost = h.home;
    out.login = (await t.runLine('[[ -o login ]] && echo login-shell || echo not-login; [[ -o interactive ]] && echo interactive')).replace(/\r/g, '').split('\n').slice(1, 3);
    // duplicates and id reuse
    const a = await tryBound(h.base, 'CreateTerminal', { tty: true, command: [], labels: {}, params: {}, id: 'fixed-id' });
    const b2 = await tryBound(h.base, 'CreateTerminal', { tty: true, command: [], labels: {}, params: {}, id: 'fixed-id' });
    await sleep(500);
    const list = (await tryBound(h.base, 'ListSessions')).json;
    out.duplicateId = { first: a.status, second: b2.status, listedWithThatId: list.filter((s) => s.id === 'fixed-id').length, shellsUnderHost: descendants(h.pid).filter((d) => /zsh/.test(d.comm)).length };
    const cl = await tryBound(h.base, 'CloseSession', 'fixed-id'); await sleep(500);
    out.duplicateId.afterOneCloseShellsUnderHost = descendants(h.pid).filter((d) => /zsh/.test(d.comm)).length; out.duplicateId.closeStatus = cl.status;
    out.duplicateId.note = 'second create with the same id overwrites the maps (manager.go L172-177): the first shell can no longer be written to or closed; it ends only when the host exits';
    // two windows both get the events
    await sleep(50);
    await t.runLine('echo both-windows');
    await sleep(200);
    out.twoSocketsSameSession = { socketAGotBytes: t.total, socketBGotBytes: mirror.total, equal: Buffer.concat(t.chunks).equals(Buffer.concat(mirror.chunks)) };
    // event frame shape on the wire
    const e0 = t.events.find((e) => e.kind === 'stream'); out.wireFrame = { keys: e0.keys, dataType: typeof e0.raw, example: JSON.stringify({ name: `core/exec/stream/stdout/${t.id}`, data: e0.raw.slice(0, 20) + '...' }) };
    out.eventNamesSeenAll = Object.fromEntries(ev.names);
    // session metadata after attach
    await tryBound(h.base, 'AttachSession', t.id); out.listAfterAttach = (await tryBound(h.base, 'ListSessions')).json.map((s) => ({ id: s.id.slice(0, 8), attached: s.attached, command: s.command, labels: s.labels }));
    await t.close(); evB.close();
    out.hostLogMentions = h.log().split('\n').filter((l) => /ERROR|WARN/.test(l)).map((l) => l.replace(/^\S+\s+/, '').slice(0, 200)).slice(-12);
  } finally { await stopHost(h, 'q12'); }
  return out;
};

// ---------- run ----------
const status = [];
for (const q of run) {
  if (!sections[q]) { console.log(`unknown section ${q}`); continue; }
  const load = load1(); console.log(`== ${q} (1-min load ${load}) ==`); const t0 = now();
  checks.length = 0;
  try {
    R[q] = await sections[q]();
    R[q].checks = [...checks]; R[q].runMeta = { startedWithLoad1: load, endedWithLoad1: load1(), seconds: +((now() - t0) / 1000).toFixed(1), at: new Date().toISOString() };
    status.push(`${q} ok ${R[q].runMeta.seconds}s load ${load}`);
  } catch (e) {
    R[q] = { ...(R[q] ?? {}), error: String(e?.stack ?? e).slice(0, 1500) }; status.push(`${q} ERROR ${e?.message}`);
    console.log(`  ${q} failed: ${e?.stack}`);
  }
  save();
}
console.log(status.join('\n'));
const left = spawnSync('sh', ['-c', "ps -axo pid=,ppid=,comm= | grep -E 'Omniview-server' | grep -v grep"]).stdout.toString().trim();
console.log('Omniview-server processes on the machine now (others\' hosts may be listed):\n' + (left || '(none)'));
process.exit(0);

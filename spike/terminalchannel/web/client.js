// The spike's page: runs one scenario against one transport, in a native webview or in a browser, and reports.
//   ?transport=events|stream|ws|wssame|pull   &scenario=flood|echo|echoflood   &state=healthy|stalled|hidden
//   &seconds=60  &ack=1|0  &echo_n=300  &stall_after=3  &consume_us=0
import { Call, Events, Stream } from '/wails/runtime.js';

const q = new URLSearchParams(location.search);
const P = {
  transport: q.get('transport') || 'stream',
  scenario: q.get('scenario') || 'flood',
  state: q.get('state') || 'healthy',
  seconds: Number(q.get('seconds') || 20),
  ack: q.get('ack') !== '0',
  echoN: Number(q.get('echo_n') || 300),
  stallAfter: Number(q.get('stall_after') || 3),
  label: q.get('label') || '',
  kind: q.get('kind') || 'flood',
  work: Number(q.get('work_us') || 0),
};
const logEl = document.getElementById('log');
const log = (...a) => { const s = a.join(' '); console.log(s); logEl.textContent += '\n' + s; };

const PROBE = 'main.Probe.';
const EXEC = 'github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper.';
const call = (name, ...args) => Call.ByName(name, ...args);
const note = (m) => { if (q.get('notes') === '0') return; call(PROBE + 'Note', m).catch(() => {}); };
setInterval(() => note('vis ' + document.visibilityState + ' hidden=' + document.hidden + ' focus=' + document.hasFocus() + ' t=' + Math.round(performance.now())), 2000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const enc = new TextEncoder();

// ---- the measurement ------------------------------------------------------------------------------------------
const M = { bytes: 0, perSecond: [], t0: 0, lastBytes: 0, lag: 0, gaps: 0, errors: [], pending: 0, frames: 0 };
let work = 0;
const consume = (n) => {
  M.bytes += n;
  M.frames++;
  if (P.work) { const end = performance.now() + (n / 1048576) * P.work / 1000; while (performance.now() < end) { work++; } }
};
function tickers() {
  let last = performance.now();
  const lagTimer = setInterval(() => { const now = performance.now(); M.lag = Math.max(M.lag, now - last - 100); last = now; }, 100);
  const secTimer = setInterval(() => { M.perSecond.push(M.bytes - M.lastBytes); M.lastBytes = M.bytes; }, 1000);
  return () => { clearInterval(lagTimer); clearInterval(secTimer); };
}
if (q.get('hb') !== '0') setInterval(() => note('hb bytes=' + M.bytes + ' frames=' + M.frames + ' lag=' + Math.round(M.lag)), 1000);
window.addEventListener('error', (e) => note('window.error ' + e.message));
window.addEventListener('unhandledrejection', (e) => note('unhandledrejection ' + String(e.reason)));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

// ---- one terminal, as each transport reads it -----------------------------------------------------------------
// Every transport answers: { write(bytes), resize(rows, cols), onBytes(fn), close() }.
async function open(kind, transport) {
  const cols = 100; const rows = 30;
  const onBytes = [];
  const emit = (u8) => { for (const f of onBytes) f(u8); };
  let ackPending = 0;
  const T = { onBytes: (f) => onBytes.push(f), seq: 0, ended: null };

  if (transport === 'events') {
    const id = 't-ev-' + Math.random().toString(36).slice(2, 10);
    const script = { flood: 'read x; exec yes FLOODFLOODFLOODFLOODFLOODFLOODFLOOD', flood10: "read x; exec perl -e '$|=1; while(1){ print \"FLOODFLOODFLOODFLOOD\" x 50000, \"\\n\"; select(undef,undef,undef,0.1) }'", echo: 'stty raw -echo; exec cat', numbered: "read x; exec awk 'BEGIN{for(i=1;i<=3000000;i++)print i}'" }[kind];
    const key = 'page-key-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    await call(EXEC + 'CreateTerminal', { id, tty: true, command: ['sh', '-c', script], labels: {}, params: {}, resource_plugin: '', resource_key: '' }, { cols, rows, page_key: key });
    T.id = id;
    Events.On('core/exec/stream/output/' + id, (ev) => {
      const u8 = unb64(ev.data.data);
      emit(u8);
      ackPending += u8.length;
      if (P.ack && ackPending >= 65536) { const n = ackPending; ackPending = 0; call(EXEC + 'AckTerminal', id, n).catch((e) => M.errors.push(String(e))); }
    });
    T.write = (u8) => call(EXEC + 'WriteTerminal', id, ++T.seq, b64(u8));
    T.resize = (r, c) => call(EXEC + 'ResizeTerminal', id, ++T.seq, r, c);
    T.close = () => call(EXEC + 'CloseSession', id);
    return T;
  }

  const created = await call(PROBE + 'Create', kind, transport === 'wssame' ? 'ws' : transport, cols, rows);
  T.id = created.id; T.cap = created.cap;
  const cap = created.cap;

  if (transport === 'pull') {
    const cfg = await call(PROBE + 'Config');
    let off = 0; let stop = false;
    T.write = (u8) => call(PROBE + 'Write', cap, ++T.seq, b64(u8));
    T.resize = (r, c) => call(PROBE + 'Resize', cap, ++T.seq, r, c);
    T.close = async () => { stop = true; return call(PROBE + 'Close', cap); };
    T.start = async () => {
      (async () => {
        while (!stop) {
          let r;
          try { r = await call(PROBE + 'Read', cap, off, 262144, 2000); } catch (e) { M.errors.push(String(e)); break; }
          if (r.data) { const u8 = unb64(r.data); emit(u8); off = r.to; } else if (r.eof) break;
          if (r.eof) { T.ended = 'eof'; break; }
        }
      })();
    };
    return T;
  }

  // stream, ws, wssame: a connection that speaks frames
  let sock;
  if (transport === 'stream') {
    sock = Stream('term');
  } else {
    const cfg = await call(PROBE + 'Config');
    const url = transport === 'wssame' ? `ws://${location.host}/term` : `ws://127.0.0.1:${cfg.ws_port}/term`;
    sock = new WebSocket(url);
  }
  sock.binaryType = 'arraybuffer';
  await new Promise((resolve, reject) => { sock.addEventListener('open', resolve, { once: true }); sock.addEventListener('error', () => reject(new Error('socket error before open: ' + transport)), { once: true }); });
  sock.addEventListener('message', (ev) => {
    const u8 = new Uint8Array(ev.data);
    if (u8[0] === 1) {
      const body = u8.subarray(9);
      emit(body);
      ackPending += body.length;
      if (P.ack && ackPending >= 65536) { const n = ackPending; ackPending = 0; sock.send(cat(new Uint8Array([97]), u32(n))); }
    } else if (u8[0] === 2) { T.ended = new TextDecoder().decode(u8.subarray(1)); }
  });
  sock.addEventListener('close', () => { T.closed = true; });
  sock.send(enc.encode(JSON.stringify({ cap, from: 0 })));
  T.write = (u8) => { sock.send(cat(new Uint8Array([119]), u64(++T.seq), u8)); return Promise.resolve(); };
  T.resize = (r, c) => { const b = new Uint8Array(5); b[0] = 114; new DataView(b.buffer).setUint16(1, r); new DataView(b.buffer).setUint16(3, c); sock.send(b); return Promise.resolve(); };
  T.close = () => { sock.close(); return call(PROBE + 'Close', cap); };
  return T;
}

// ---- scenarios -----------------------------------------------------------------------------------------------
async function flood() {
  const T = await open(P.kind, P.transport);
  T.onBytes((u8) => consume(u8.length));
  if (T.start) await T.start();
  await sleep(300);
  M.t0 = performance.now();
  const stopTickers = tickers();
  note('flood: starting');
  await T.write(enc.encode('\n'));
  note('flood: go sent');
  if (P.state === 'stalled') {
    await sleep(P.stallAfter * 1000);
    const stalledFor = P.seconds - P.stallAfter;
    log('stalling', stalledFor);
    const end = performance.now() + stalledFor * 1000;
    while (performance.now() < end) { work++; }
  } else if (P.state === 'hidden') {
    await call(PROBE + 'Hide');
    await sleep(P.seconds * 1000);
  } else {
    await sleep(P.seconds * 1000);
  }
  const elapsed = (performance.now() - M.t0) / 1000;
  note('flood: measured ' + M.bytes + ' bytes in ' + elapsed.toFixed(1) + ' s');
  // Ctrl-C: how long until the foreground is the program's no more is a host measurement; here: how long until the
  // flood stops arriving after the interrupt
  const before = M.bytes;
  const tC = performance.now();
  await T.write(new Uint8Array([3]));
  note('flood: ctrl-c sent');
  let quiet = 0; let last = M.bytes; let stopAt = null;
  for (let i = 0; i < 400 && stopAt === null; i++) {
    await sleep(10);
    if (M.bytes === last) { quiet++; if (quiet >= 5) stopAt = performance.now() - tC - 50; } else { quiet = 0; last = M.bytes; }
  }
  stopTickers();
  note('flood: quiet after ctrl-c');
  const report = { ...P, build: (await call(PROBE + 'Config')).build, bytes: M.bytes, seconds_measured: elapsed, mbps: M.bytes / 1048576 / elapsed, perSecondMB: M.perSecond.map((n) => +(n / 1048576).toFixed(2)), lagMaxMs: Math.round(M.lag), frames: M.frames, ctrlCStopMs: stopAt === null ? null : Math.round(stopAt), bytesAfterCtrlC: M.bytes - before, errors: M.errors.slice(0, 5), ended: T.ended };
  try { await T.close(); } catch (e) { /* closed */ }
  return report;
}

async function echoOnce(T, n, withFlood) {
  const rtts = [];
  let waiter = null;
  T.onBytes((u8) => { if (waiter) { const w = waiter; waiter = null; w(performance.now()); } });
  for (let i = 0; i < n; i++) {
    const got = new Promise((r) => { waiter = r; });
    const t0 = performance.now();
    await T.write(new Uint8Array([120]));
    const t1 = await Promise.race([got, sleep(2000).then(() => null)]);
    if (t1 === null) { M.errors.push('echo timeout at ' + i); waiter = null; continue; }
    rtts.push(t1 - t0);
    await sleep(15);
  }
  return rtts;
}

async function echo(withFlood) {
  const E = await open('echo', P.transport);
  if (E.start) await E.start();
  let F = null; let floodBytes = 0;
  if (withFlood) {
    F = await open('flood', P.transport);
    F.onBytes((u8) => { floodBytes += u8.length; });
    if (F.start) await F.start();
    await sleep(300);
    await F.write(enc.encode('\n'));
    await sleep(1500);
  }
  await sleep(300);
  const rtts = await echoOnce(E, P.echoN, withFlood);
  const report = { ...P, build: (await call(PROBE + 'Config')).build, n: rtts.length, p50: pct(rtts, 0.5), p95: pct(rtts, 0.95), p99: pct(rtts, 0.99), max: rtts.length ? Math.max(...rtts) : null, mean: rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null, floodMB: floodBytes / 1048576, errors: M.errors.slice(0, 5) };
  try { if (F) { await F.write(new Uint8Array([3])); await F.close(); } await E.close(); } catch (e) { /* closed */ }
  return report;
}

(async () => {
  try {
    await sleep(Number(q.get('settle_ms') || 800));
    const report = P.scenario === 'flood' ? await flood() : P.scenario === 'echo' ? await echo(false) : await echo(true);
    log('REPORT', JSON.stringify(report));
    await call(PROBE + 'Report', JSON.stringify(report));
  } catch (e) {
    const report = { ...P, error: String(e && e.message || e) };
    log('FAILED', JSON.stringify(report));
    try { await call(PROBE + 'Report', JSON.stringify(report)); } catch (_) { /* nothing to tell */ }
  }
  if (q.get('quit') === '1') await call(PROBE + 'Quit');
})();

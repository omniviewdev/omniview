// Drives one scenario against the NATIVE build (a real WKWebView): node native.mjs --transport stream --state healthy ...
import fs from 'node:fs';
import { psAll, descendants, startHost, sleep } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']] : acc), []));
const transport = args.transport || 'stream';
const scenario = args.scenario || 'flood';
const state = args.state || 'healthy';
const seconds = Number(args.seconds || 20);
const ack = args.ack ?? '1';
const binary = args.binary || '/tmp/tcspike-native';
const outFile = args.out;
const pidsFile = args.pids || '/tmp/tcspike-pids.txt';
const query = new URLSearchParams({ transport, scenario, state, seconds: String(seconds), ack, echo_n: args.echo_n || '300', stall_after: args.stall_after || '3', label: args.label || '', kind: args.kind || 'flood', hb: args.hb ?? '1', notes: args.notes ?? '1', work_us: args.work_us || '0', settle_ms: '1500', quit: '1' });

const env = { PROBE_QUERY: query.toString(), PROBE_SAMPLE_MS: '5000' };
if (state !== 'hidden') env.PROBE_SHOWN = '1';
if (args.active) env.PROBE_ACTIVE = '1';
const host = startHost(binary, env, pidsFile);
const reports = []; const hostSamples = []; const notes = [];
host.onLine((l) => { if (l.startsWith('REPORT ')) reports.push(JSON.parse(l.slice(7))); if (l.startsWith('SAMPLE ')) hostSamples.push(l); if (l.startsWith('NOTE ')) notes.push(l); });
let exited = false; host.child.on('exit', () => { exited = true; });
const t0 = Date.now();
const budget = (seconds + Number(args.slack || 60)) * 1000;
const { rssOf, webkitServicePids } = await import('./lib.mjs');
const driverSamples = [];
const before = webkitServicePids();
let nextSample = 0;
while (!exited && Date.now() - t0 < budget && !(reports.length && Date.now() - t0 > 1000)) {
  await sleep(500);
  if (Date.now() - t0 >= nextSample) {
    nextSample += 5000;
    const procs = psAll();
    const wk = procs.filter((p) => !before.has(p.pid) && /WebKit\.(WebContent|Networking|GPU)/.test(p.command));
    driverSamples.push({ t: +((Date.now() - t0) / 1000).toFixed(1), hostRSS: +rssOf(procs.filter((p) => p.pid === host.child.pid)).toFixed(1), webkitRSS: +rssOf(wk).toFixed(1) });
  }
}
const kids = exited ? [] : descendants(host.child.pid).map((p) => p.pid);
if (!exited) { host.child.kill('SIGTERM'); await sleep(2500); if (host.child.exitCode === null) host.child.kill('SIGKILL'); }
await sleep(500);
const alive = kids.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
for (const pid of alive) { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* gone */ } }
const result = { args: { transport, scenario, state, seconds, ack, build: 'native' }, report: reports[0] || null, hostSamples, driverSamples, notes, leftover: alive, tail: host.lines.slice(-4) };
const text = JSON.stringify(result);
if (outFile) fs.appendFileSync(outFile, text + '\n'); else console.log(text);
process.exit(result.report ? 0 : 3);

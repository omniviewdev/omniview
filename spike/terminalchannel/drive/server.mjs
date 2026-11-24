// Drives one scenario against the SERVER build with a real browser: node server.mjs --transport stream --state healthy ...
import fs from 'node:fs';
import { require, psAll, descendants, rssOf, webkitServicePids, startHost, sleep } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']] : acc), []));
const transport = args.transport || 'stream';
const scenario = args.scenario || 'flood';
const state = args.state || 'healthy';
const seconds = Number(args.seconds || 20);
const browserName = args.browser || 'chromium';
const ack = args.ack ?? '1';
const port = Number(args.port || 34171 + Math.floor(Math.random() * 500));
const binary = args.binary || '/tmp/tcspike-server';
const outFile = args.out;
const pidsFile = args.pids || '/tmp/tcspike-pids.txt';
const sampleMs = 5000;

const { chromium, webkit } = require('playwright');
const host = startHost(binary, { PROBE_PORT: String(port), PROBE_SAMPLE_MS: String(sampleMs) }, pidsFile);
const reports = []; const hostSamples = []; const notes = [];
host.onLine((l) => { if (l.startsWith('REPORT ')) reports.push(JSON.parse(l.slice(7))); if (l.startsWith('SAMPLE ')) hostSamples.push(l); if (l.startsWith('NOTE ')) notes.push(l); });
let ready = false;
host.onLine((l) => { if (l.startsWith('SERVER-READY')) ready = true; });
for (let i = 0; i < 200 && !ready; i++) await sleep(100);
if (!ready) { console.error('host did not start', host.lines.slice(-5)); host.child.kill('SIGKILL'); process.exit(2); }

const before = webkitServicePids();
const type = browserName === 'webkit' ? webkit : chromium;
const browser = await type.launch({ headless: true });
fs.appendFileSync(pidsFile, `${new Date().toISOString()} driver ${process.pid} browser=${browserName}\n`);
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => logs.push('pageerror ' + String(e).slice(0, 200)));
const query = new URLSearchParams({ transport, scenario, state, seconds: String(seconds), ack, echo_n: args.echo_n || '300', stall_after: args.stall_after || '3', label: args.label || '', kind: args.kind || 'flood', hb: args.hb ?? '1', notes: args.notes ?? '1', work_us: args.work_us || '0', settle_ms: '1500' });
await page.goto(`http://127.0.0.1:${port}/?${query}`);

const browserSamples = [];
const t0 = Date.now();
const budget = (seconds + Number(args.slack || 60)) * 1000;
while (reports.length === 0 && Date.now() - t0 < budget) {
  await sleep(sampleMs);
  const procs = psAll();
  const mine = descendants(process.pid, procs).filter((p) => p.pid !== host.child.pid && !descendants(host.child.pid, procs).some((q) => q.pid === p.pid));
  const wk = procs.filter((p) => !before.has(p.pid) && /WebKit\.(WebContent|Networking|GPU)/.test(p.command));
  browserSamples.push({ t: +((Date.now() - t0) / 1000).toFixed(1), browserRSS: +(rssOf(mine) + rssOf(wk)).toFixed(1) });
}
const result = { args: { transport, scenario, state, seconds, browser: browserName, ack, build: 'server' }, report: reports[0] || null, hostSamples, notes, browserSamples, logs: logs.slice(-5) };

// leftovers: nothing the host started may outlive it
const kids = descendants(host.child.pid).map((p) => p.pid);
try { await browser.close(); } catch (_) { /* closed */ }
host.child.kill('SIGTERM');
await sleep(2500);
const alive = kids.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
for (const pid of alive) { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* gone */ } }
result.leftover = alive;
if (host.child.exitCode === null) { try { host.child.kill('SIGKILL'); } catch (_) { /* gone */ } }
const text = JSON.stringify(result);
if (outFile) fs.appendFileSync(outFile, text + '\n'); else console.log(text);
process.exit(result.report ? 0 : 3);

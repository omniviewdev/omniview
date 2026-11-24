// Shared by the drivers: process listing (RSS of a process tree, of the WebKit services), a recorded-pid child launcher.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';

export const require = createRequire('/Users/joshuapare/Repos/omniviewdev/omniview/package.json');

export function psAll() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return out.split('\n').filter(Boolean).map((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return m ? { pid: +m[1], ppid: +m[2], rss: +m[3] / 1024, command: m[4] } : null;
  }).filter(Boolean);
}

export function descendants(rootPid, procs = psAll()) {
  const kids = new Map();
  for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const out = []; const stack = [rootPid];
  while (stack.length) { const pid = stack.pop(); for (const k of kids.get(pid) || []) { out.push(k); stack.push(k.pid); } }
  return out;
}

export const rssOf = (procs) => procs.reduce((n, p) => n + p.rss, 0);

// the WebKit services are launched by launchd, not by the browser: the ones that did not exist before are ours
export function webkitServicePids() {
  return new Set(psAll().filter((p) => /com\.apple\.WebKit\.(WebContent|Networking|GPU)|WebKit\.WebContent|WebKitWebProcess|WebKitNetworkProcess/.test(p.command)).map((p) => p.pid));
}

export function startHost(binary, env, pidsFile) {
  const child = spawn(binary, [], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  if (pidsFile) fs.appendFileSync(pidsFile, `${new Date().toISOString()} host ${child.pid} ${binary}\n`);
  const lines = []; const listeners = [];
  let buf = '';
  const onData = (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      lines.push(line);
      for (const l of listeners) l(line);
    }
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  return { child, lines, onLine: (f) => listeners.push(f) };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

#!/usr/bin/env node
// Explicit PIDs only. Never launches, navigates, or changes the observed apps.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';

const { values } = parseArgs({ options: {
  pid: { type: 'string', multiple: true }, seconds: { type: 'string', default: '60' },
  interval: { type: 'string', default: '1' }, scenario: { type: 'string' }, out: { type: 'string' },
} });
const seconds = Number(values.seconds), interval = Number(values.interval);
if (!values.pid?.length || !values.scenario || !values.out || !Number.isFinite(seconds) || seconds < 1 || seconds > 3600 || !Number.isFinite(interval) || interval < 0.1 || interval > seconds) {
  throw new Error('Require --pid label=PID (repeatable), --scenario, --out; seconds 1..3600, interval 0.1..seconds');
}
const processes = values.pid.map((value) => {
  const match = /^([\w-]+)=(\d+)$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1 || Number(match[2]) > 2147483647) throw new Error(`Invalid PID selection: ${value}`);
  return { label: match[1], pid: Number(match[2]) };
});
if (new Set(processes.map(p => p.pid)).size !== processes.length || new Set(processes.map(p => p.label)).size !== processes.length) throw new Error('Labels and PIDs must be unique');
function ps(pid, format) {
  return execFileSync('/bin/ps', ['-p', String(pid), '-o', format], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
}
function cpuMilliseconds(value) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) throw new Error(`Unavailable cumulative CPU time: ${value}`);
  return ((Number(match[1] ?? 0) * 86400) + (Number(match[2] ?? 0) * 3600) + Number(match[3]) * 60 + Number(match[4])) * 1000;
}
function snapshot(process) {
  const started = performance.now();
  const row = ps(process.pid, 'pid=,lstart=,etime=,time=,rss=,stat=,comm=');
  const match = /^(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(row);
  if (!match || Number(match[1]) !== process.pid || match[6].includes('Z')) throw new Error(`Unavailable or exited process sample: ${row}`);
  const ageMs = cpuMilliseconds(match[3]);
  // lstart has second precision. Require an older process to exclude same-second reuse.
  if (ageMs < 2000) throw new Error(`Process is too new for unambiguous start identity: ${process.pid}; wait at least 2 seconds`);
  const startTime = match[2].replace(/\s+/g, ' ');
  if (process.startTime && startTime !== process.startTime) throw new Error(`PID reused during capture: ${process.pid}`);
  return { atMs: performance.now(), samplingMs: performance.now() - started, startTime, ageMs, cpuMs: cpuMilliseconds(match[4]), rssKiB: Number(match[5]), state: match[6], command: match[7] };
}
for (const process of processes) {
  const first = snapshot(process);
  process.startTime = first.startTime;
  process.samples = [first];
}
const started = performance.now();
while (performance.now() - started < seconds * 1000) {
  await delay(Math.min(interval * 1000, Math.max(0, seconds * 1000 - (performance.now() - started))));
  for (const process of processes) process.samples.push(snapshot(process));
}
for (const process of processes) {
  const first = process.samples[0], last = process.samples.at(-1);
  process.elapsedMs = last.atMs - first.atMs;
  process.cpuMs = last.cpuMs - first.cpuMs;
  if (process.cpuMs < 0) throw new Error('Cumulative CPU time moved backwards');
  process.meanCPUPercent = 100 * process.cpuMs / process.elapsedMs;
  process.intervalCPUPercent = process.samples.slice(1).map((sample, i) => 100 * (sample.cpuMs - process.samples[i].cpuMs) / (sample.atMs - process.samples[i].atMs));
}
const report = { schemaVersion: 1, at: new Date().toISOString(), scenario: values.scenario, platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0].model, seconds, interval, units: 'CPU percent of one logical core, from cumulative process time; RSS KiB, not retained heap', limits: 'No route, cluster, process ownership, or source-version attestation. Select and record these separately. ps CPU-time quantization limits short captures. Sampling overhead recorded. Missing/inaccessible processes fail rather than report zero.', processes };
await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

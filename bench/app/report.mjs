#!/usr/bin/env node
/**
 * Markdown summary of a bench/app results file: one table per scenario, one row
 * per step, medians across runs (the first column also shows min–max).
 *
 *   node bench/app/report.mjs [results.json]
 */
import fs from 'node:fs';
import path from 'node:path';

const COLUMNS = {
  readyMs: 'interactive',
  pluginReadyMs: 'plugin home shown',
  wallMs: 'wall',
  steps: 'actual steps',
  forwardSteps: 'forward viewport steps',
  perStepMs: 'wall / step',
  busyPerStepMs: 'busy / step',
  taskMs: 'main thread busy',
  scriptMs: 'script',
  layoutStyleMs: 'layout + style',
  blockingMs: 'TBT',
  longTasks: 'long tasks',
  renderMs: 'React render',
  commits: 'commits',
  maxCommitMs: 'slowest commit',
  heapMB: 'heap MB',
};

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (v) => (v == null ? '' : Math.abs(v) >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1));

/** A run is either flat metrics (cold start) or { step: metrics }. */
function steps(run) {
  const nested = Object.entries(run).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  return nested.length ? nested : [['', run]];
}

/** What this report may say about how a known workload delivers its Pod records. Any other id gets no such claim. */
const POD_DELIVERY = { 'whole-app/v1': 'a complete source-view collection of ' };

/**
 * Describe the workload from what the runner recorded. A result without a workload id is an unknown legacy
 * workload: it is never described as the current 5,000-record collection, whose size and delivery it may not share.
 */
function workloadLine(workload) {
  if (!workload?.id) {
    return 'Workload: unknown legacy workload (the runner recorded no workload id). Its Pod record count and delivery mode are not known, so it is not described as a recorded workload and must not be compared with one.';
  }
  const pods = workload.pods;
  const delivery = Object.hasOwn(POD_DELIVERY, workload.id) ? POD_DELIVERY[workload.id] : 'a corpus of ';
  const scroll = pods
    ? ` Pod scroll takes up to ${pods.scrollPages} viewport steps through ${delivery}${Number(pods.records).toLocaleString('en-US')} records, then resets. Actual steps include the reset; per-step timings use that count.`
    : '';
  return `Workload ${workload.id}:${scroll} Compare only matching workload ids and CPU throttles.`;
}

function frontendLine(frontend) {
  if (!frontend) return 'Frontend build configuration was not recorded for this result.';
  const reused = frontend.rebuilt === false ? ' It was reused from an earlier build, not rebuilt by this run.' : '';
  const overhead = frontend.reactDom === 'react-dom/profiling'
    ? ' React render, commit and slowest-commit columns include profiling overhead that a normal production build does not have.'
    : '';
  return `Frontend: ${frontend.reactDom} (${frontend.config}).${reused}${overhead}`;
}

/** `abc1234`, `abc1234 (dirty)` or `unknown`. A commit the runner did not identify is never shown as one. */
function sourceLabel(commit, dirty) {
  if (!commit || commit === 'unknown') return 'unknown';
  return `${commit}${dirty === true ? ' (dirty)' : dirty === null ? ' (dirty state unknown)' : ''}`;
}

export function summarize({ meta, results }) {
  const plugin = meta.plugin;
  const bundle = plugin?.bundle?.treeSHA256 ? `, bundle sha256 ${plugin.bundle.treeSHA256.slice(0, 12)}` : '';
  const out = [
    '### Whole-app profile (bench/app)',
    '',
    `Commit ${sourceLabel(meta.commit, meta.dirty)}, kubernetes plugin ${sourceLabel(meta.k8sPlugin, plugin?.checkout?.dirty)}${bundle}, Chromium ${meta.chromium}, ${meta.host}.`,
    `Median of ${meta.runs} runs, CPU throttle ${meta.cpuThrottle ?? 1}×, ms unless noted; first column also min–max. Startup times are from navigation start.`,
    workloadLine(meta.workload),
    frontendLine(meta.frontend),
    '',
  ];
  const notes = new Set();
  if (meta.hostSource?.state === 'unknown') notes.add(`host source is unknown: ${meta.hostSource.reason}`);
  if (!plugin) notes.add('kubernetes plugin commit was not verified as a separate checkout by the runner that wrote this result; it may name the host repository');
  else if (plugin.checkout?.state === 'unknown') notes.add(`kubernetes plugin source is unknown: ${plugin.checkout.reason}`);
  for (const [name, runs] of Object.entries(results)) {
    const byStep = new Map();
    for (const run of runs) {
      for (const [step, m] of steps(run)) {
        const metrics = { ...m, layoutStyleMs: (m.layoutMs ?? 0) + (m.styleMs ?? 0) };
        if (!byStep.has(step)) byStep.set(step, {});
        for (const k of Object.keys(COLUMNS)) if (typeof metrics[k] === 'number') (byStep.get(step)[k] ??= []).push(metrics[k]);
        if (m.following === false) notes.add(`${name}/${step}: the log view did not stay on the newest line while streaming`);
        for (const e of m.errors ?? []) notes.add(`${name}: page error "${e}"`);
        if (m.unhandled?.length) notes.add(`${name}: backend calls without a fixture: ${m.unhandled.join(', ')}`);
      }
      for (const e of run.errors ?? []) notes.add(`${name}: page error "${e}"`);
    }
    const cols = Object.keys(COLUMNS).filter((k) => [...byStep.values()].some((v) => v[k]));
    out.push(`**${name}**`, '', `| step | ${cols.map((k) => COLUMNS[k]).join(' | ')} |`, `|---|${cols.map(() => '--:').join('|')}|`);
    for (const [step, v] of byStep) {
      const cells = cols.map((k, i) => {
        if (!v[k]) return '';
        const m = fmt(median(v[k]));
        return i === 0 && v[k].length > 1 ? `${m} (${fmt(Math.min(...v[k]))}–${fmt(Math.max(...v[k]))})` : m;
      });
      out.push(`| ${step || name} | ${cells.join(' | ')} |`);
    }
    out.push('');
  }
  if (notes.size) out.push(...[...notes].map((n) => `- ${n}`), '');
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] ?? path.join(import.meta.dirname, 'results/latest.json');
  process.stdout.write(summarize(JSON.parse(fs.readFileSync(file, 'utf8'))));
}

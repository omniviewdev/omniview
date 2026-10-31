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

export function summarize({ meta, results }) {
  const out = [
    '### Whole-app profile (bench/app)',
    '',
    `Commit ${meta.commit}${meta.dirty ? ' (dirty)' : ''}, kubernetes plugin ${meta.k8sPlugin}, Chromium ${meta.chromium}, ${meta.host}.`,
    `Median of ${meta.runs} runs, ms unless noted; first column also min–max. Startup times are from navigation start.`,
    'V2 Pod scroll takes up to 30 viewport steps within the native page (currently capped at 256 records) from a 5k-pod corpus, then resets. Actual steps include the reset; per-step timings use that count. Older full-list baselines are not comparable.',
    '',
  ];
  const notes = new Set();
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

#!/usr/bin/env node
/**
 * Turn bench/render/results/latest.json into a Markdown table (stdout, and the
 * GitHub job summary when $GITHUB_STEP_SUMMARY is set). Exits 1 if a test
 * failed, a benchmark recorded no samples, or the report has no benchmarks.
 *
 *   node bench/render/report.mjs [results.json] [--title "..."]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const titleIdx = args.indexOf('--title');
const title = titleIdx >= 0 ? args.splice(titleIdx, 2)[1] : 'Render benchmarks';
const file = args[0] ?? path.join(import.meta.dirname, 'results/latest.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const ms = (v) => (v == null ? '–' : v >= 100 ? v.toFixed(0) : v.toFixed(1));
const lines = [`### ${title}`, '', '| Scenario | Bench | mean ms | median ms | p75 ms | p99 ms | ±% | n |', '|---|---|--:|--:|--:|--:|--:|--:|'];
lines.splice(2, 0, 'V2 Pod benchmarks measure the native page (currently capped at 256 records) from the named corpus. Scroll takes up to 30 viewport steps within that page, then resets; it stops at the real scroll boundary. Older full-list baselines are not comparable.', '');
const failed = [];

let benchmarkCount = 0;
for (const file of data.testResults) {
  if (file.status === 'failed') failed.push(file.name);
  for (const test of file.assertionResults) {
    const group = test.ancestorTitles.join(' > ') || path.basename(file.name);
    if (test.status === 'failed') failed.push(`${group} > ${test.title}`);
    for (const benchmark of test.benchmarks ?? []) {
      for (const task of benchmark.tasks) {
        benchmarkCount++;
        const b = task.latency;
        if (!b.samplesCount) failed.push(`${group} > ${task.name}`);
        lines.push(`| ${group} | ${task.name} | ${ms(b.mean)} | ${ms(b.p50)} | ${ms(b.p75)} | ${ms(b.p99)} | ${b.rme == null ? '–' : b.rme.toFixed(1)} | ${b.samplesCount ?? 0} |`);
      }
    }
  }
}
if (!benchmarkCount) failed.push('No benchmark results');
if (!data.success && !failed.length) failed.push('Vitest run failed');

if (failed.length) lines.push('', `**Failed tests or missing benchmark samples:** ${failed.join(', ')}`);
const out = lines.join('\n') + '\n';
process.stdout.write(out);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
process.exit(failed.length ? 1 : 0);

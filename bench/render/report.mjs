#!/usr/bin/env node
/**
 * Turn bench/render/results/latest.json into a Markdown table (stdout, and the
 * GitHub job summary when $GITHUB_STEP_SUMMARY is set). Exits 1 if a bench
 * recorded no samples, which is how tinybench reports a bench that threw.
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
const failed = [];

for (const f of data.files) {
  for (const g of f.groups) {
    const group = g.fullName.split(' > ').slice(1).join(' > ') || path.basename(f.filepath);
    for (const b of g.benchmarks) {
      if (!b.sampleCount) failed.push(`${group} > ${b.name}`);
      lines.push(`| ${group} | ${b.name} | ${ms(b.mean)} | ${ms(b.median)} | ${ms(b.p75)} | ${ms(b.p99)} | ${b.rme == null ? '–' : b.rme.toFixed(1)} | ${b.sampleCount ?? 0} |`);
    }
  }
}

if (failed.length) lines.push('', `**No samples (bench threw):** ${failed.join(', ')}`);
const out = lines.join('\n') + '\n';
process.stdout.write(out);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
process.exit(failed.length ? 1 : 0);

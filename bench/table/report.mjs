// Fills the markers of a baseline file with the tables the analysis computes, so that no number in it is typed by hand:
//   <!-- TABLES -->   every cell of analyze.mjs (engine, workload, CPU rate): the figures of each config with their spread
//   <!-- BUDGETS -->  the B2 readings of the chosen layout against its control and the reference
//   <!-- RULE -->     the steps of the decision rule as the analysis took them
//
//   node bench/table/report.mjs docs/ui-next/baseline/2026-11-16-table.md m1 bench/table/results/a11y/a11y.json
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { here } from './lib.mjs';

const [file, prefix, a11y, prefixB] = process.argv.slice(2);
const json = '/tmp/1a3b-analysis.json';
const output = execFileSync('node', [path.join(here, 'analyze.mjs'), prefix, '--a11y', a11y, '--json', json], { encoding: 'utf8', maxBuffer: 1 << 28 });
const tables = output.split('\n## rule')[0].trim();
const { rule } = JSON.parse(readFileSync(json, 'utf8'));
const cell = (value) => (value === null || value === undefined ? 'not run' : String(value));

const budgets = ['| engine | reading | chosen layout p95 (range) | control C p95 | reference R p95 | over C | absolute budget | verdict |', `|${' --- |'.repeat(8)}`];
for (const [engine, b] of Object.entries(rule.budgets ?? {})) {
  const range = (reading) => (reading.chosenRange === null ? 'not run' : `${reading.chosen} [${reading.chosenRange.join('-')}]`);
  if (b.b2a.chosen !== null) {
    budgets.push(`| ${engine} | B2a static scroll (W0) | ${range(b.b2a)} | ${cell(b.b2a.control)} | ${cell(b.b2a.reference)} | ${cell(b.b2a.excessOverControlMs)} ms | 16.7 | ${b.b2a.absolutePass ? 'kept (absolute)' : b.b2a.controlAbove ? `control above 16.7: relative reading ${b.b2a.relativePass ? 'kept' : 'missed'}` : 'missed'} |`);
  }

  if (b.b2b.chosen !== null) {
    budgets.push(`| ${engine} | B2b scroll with sparse live updates (W1) | ${range(b.b2b)} | ${cell(b.b2b.control)} | ${cell(b.b2b.reference)} | ${cell(b.b2b.excessOverControlMs)} ms | 33.4 | ${b.b2b.absolutePass ? 'kept' : 'missed'}; ${b.b2b.exceedsReference ? 'exceeds R (T1)' : 'does not exceed R'} |`);
  }

  if (b.b2c.chosen !== null) {
    budgets.push(`| ${engine} | B2c W1 at 4x CPU (report only) | ${range(b.b2c)} | ${cell(b.b2c.control)} | ${cell(b.b2c.reference)} | - | none | reported |`);
  }
}

const steps = (rule.steps ?? []).map((step) => `- ${step}`).join('\n');
let text = readFileSync(file, 'utf8');
// A second prefix (the 4x run of S and A only) fills <!-- TABLES-B -->.
const tablesB = prefixB === undefined ? '' : execFileSync('node', [path.join(here, 'analyze.mjs'), prefixB, '--a11y', a11y], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n## rule')[0].trim();
text = text.replace('<!-- TABLES -->', tables).replace('<!-- TABLES-B -->', tablesB).replace('<!-- BUDGETS -->', budgets.join('\n')).replace('<!-- RULE -->', steps);
writeFileSync(file, text);

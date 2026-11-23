// N27 proof tool (scratch): the table of a both-ways run: one row for each control, both columns, from the files the shards wrote; the summary of what it found, and the table as Markdown and JSON.
//   node scripts/ci/both-ways-table.mjs <directory with both-ways-<shard>-probe.json at any depth> <out directory>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [from, to] = process.argv.slice(2);
const rows = [];
const shards = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/^both-ways-\d+-probe\.json$/.test(entry.name)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      shards.push({ shard: parsed.shard, mode: parsed.mode, buildCache: parsed.buildCache });
      for (const row of parsed.rows) rows.push({ shard: parsed.shard, ...row });
    }
  }
};
walk(from);
rows.sort((a, b) => a.unit.localeCompare(b.unit) || rows.indexOf(a) - rows.indexOf(b));
const cell = (row, which) => {
  const way = row[which];
  if (way.na !== undefined) return 'n/a';
  if (way.problem !== undefined) return `problem: ${way.problem}`;
  return way.verdict;
};
const planted = rows.filter((row) => row.planted.verdict === 'detected').length;
const off = rows.filter((row) => row.off.verdict === 'not detected').length;
const na = rows.filter((row) => row.off.na !== undefined).length;
const wrong = rows.filter((row) => row.planted.verdict !== 'detected' || (row.off.na === undefined && row.off.verdict !== 'not detected'));
const lines = [
  `## Controls both ways (${rows.length} controls, ${shards.length} shards, mode ${[...new Set(shards.map((s) => s.mode))].join(',')})`,
  '',
  `Planted = detected: ${planted} of ${rows.length}. Assertion removed = not detected: ${off} of ${rows.length - na} (${na} controls are of probes that have no ASSERTION_OFF). Wrong: ${wrong.length}.`,
  '',
  '| Unit | Control | Planted | Assertion off |',
  '|---|---|---|---|',
  ...rows.map((row) => `| ${row.unit} | ${row.control} | ${cell(row, 'planted')} | ${cell(row, 'off')} |`),
  '',
];
mkdirSync(to, { recursive: true });
writeFileSync(path.join(to, 'controls-both-ways.md'), lines.join('\n'));
writeFileSync(path.join(to, 'controls-both-ways.json'), `${JSON.stringify({ shards, rows }, null, 1)}\n`);
console.log(lines.slice(0, 4).join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, { flag: 'a' });
for (const row of wrong) console.log(`::error title=control both ways::${row.unit} ${row.control}: planted ${cell(row, 'planted')}; off ${cell(row, 'off')}`);
process.exitCode = wrong.length === 0 && rows.length > 0 ? 0 : 1;

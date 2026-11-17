// The overscan and range-step sweep on the chosen layout (docs/ui-next/status/1a.3.md, rule 6): {6/3, 8/4, 10/4} on W1, paired like the matrix.
// "4 is the measured value and a different window logic must beat it" (T-02): 8/4 is the incumbent; another setting replaces it only when
// it BEATS it by the rule's own test (step 2: at least 7 of 9 pairs, the same share for more, and a median p95 lower by more than 5%) in at
// least one engine and the incumbent does not beat it in the other. Otherwise 8/4 stays.
//
//   node bench/table/run.mjs --engine webkit --workload w1 --configs s@6/3,s@8/4,s@10/4 --tag m2-webkit-sweep     (and chromium; --cpu 4 as -sweep-4x)
//   node bench/table/sweep.mjs m2 s
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { beats, figures, fmt, percent, readTrials } from './figures.mjs';

const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'string' } } });
const prefix = positionals[0] ?? 'm2';
const variant = positionals[1] ?? 's';
const incumbent = `${variant}@8/4`;
const challengers = [`${variant}@6/3`, `${variant}@10/4`];
const result = { prefix, variant, incumbent, cells: {}, verdict: {} };
const lines = [];

for (const [suffix, label] of [['sweep', '1x'], ['sweep-4x', '4x (report only)']]) {
  for (const engine of ['chromium', 'webkit']) {
    const trials = readTrials(`${prefix}-${engine}-${suffix}`);
    if (trials.length === 0) {
      continue;
    }

    const key = `${engine}/${label}`;
    const of = (config) => trials.filter((trial) => trial.config === config);
    result.cells[key] = Object.fromEntries([incumbent, ...challengers].map((config) => [config, figures(of(config))]));
    lines.push(`\n## ${key}`);
    lines.push('config | n | p50 | p95 | p99 | >20ms | work p50 | work mean | work p95 | work max | mounted | layout ms | script ms | task ms | holes');
    for (const [config, figs] of Object.entries(result.cells[key])) {
      lines.push([config, figs.trials, fmt(figs.p50), fmt(figs.p95), fmt(figs.p99), fmt(figs.over20), fmt(figs.workP50, 2), fmt(figs.workMean, 2), fmt(figs.workP95, 2), fmt(figs.workMax, 2), fmt(figs.mounted, 0), fmt(figs.layoutMs), fmt(figs.scriptMs), fmt(figs.taskMs), `${figs.holes}/${figs.scored}`].join(' | '));
    }

    for (const challenger of challengers) {
      const over = beats(of(challenger), of(incumbent));
      const under = beats(of(incumbent), of(challenger));
      result.verdict[`${key} ${challenger}`] = { challengerBeatsIncumbent: over.beats, incumbentBeatsChallenger: under.beats, pairs: over.pairs, challengerWins: over.wins, incumbentWins: under.wins, needed: over.needed, relativeP95: percent(over.relative) };
      lines.push(`${challenger} against ${incumbent}: ${over.pairs} pairs, wins ${over.wins} to ${under.wins} (needs ${over.needed}), median p95 ${percent(over.relative)}% ${over.beats ? '-> BEATS' : under.beats ? '-> is BEATEN' : '-> neither beats'}`);
    }
  }
}

for (const challenger of challengers) {
  const rows = Object.entries(result.verdict).filter(([key, value]) => key.endsWith(challenger) && key.includes('1x'));
  const wins = rows.filter(([, value]) => value.challengerBeatsIncumbent).length;
  const losses = rows.filter(([, value]) => value.incumbentBeatsChallenger).length;
  result.verdict[challenger] = wins > 0 && losses === 0 ? 'replaces the incumbent' : 'the incumbent stays';
  lines.push(`\n${challenger}: ${result.verdict[challenger]} (beats it in ${wins} engine(s) at 1x, beaten in ${losses})`);
}

process.stdout.write(`${lines.join('\n')}\n`);
if (args.json !== undefined) {
  writeFileSync(args.json, `${JSON.stringify(result, null, 2)}\n`);
}

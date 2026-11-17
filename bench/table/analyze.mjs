// Reads the trials of run.mjs and applies the decision rule of docs/ui-next/status/1a.3.md EXACTLY as it was committed before any
// measurement, with the lead's approved reading of B2 (B2a 16.7 ms kept; B2b 33.4 ms; B2c report-only; relative to the control C when C
// itself exceeds 16.7 ms in an engine). Nothing here is tuned after seeing numbers; where the rule's text leaves a choice, the choice is
// written next to the code that makes it and printed in the output.
//
//   node bench/table/analyze.mjs <prefix> [--a11y bench/table/results/a11y/a11y.json] [--json out.json]
//
// `prefix` is what matrix.sh was given (m1): the directories bench/table/results/<prefix>-<engine>-<workload>[-4x].
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { median } from '../app/stats.mjs';
import { beats, figures, fmt, percent, readTrials, round2 } from './figures.mjs';

const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { a11y: { type: 'string' }, json: { type: 'string' } } });
const prefix = positionals[0] ?? 'm1';
const ENGINES = ['chromium', 'webkit'];

// ---- every cell: one engine, workload and CPU rate ---------------------------------------------------------------------------------------

const out = { prefix, rule: {}, cells: {} };
const byConfig = {};
for (const engine of ENGINES) {
  for (const [workload, suffix, cpu] of [['w0', 'w0', 1], ['w1', 'w1', 1], ['w1', 'w1-4x', 4]]) {
    const trials = readTrials(`${prefix}-${engine}-${suffix}`);
    if (trials.length === 0) {
      continue;
    }

    const key = `${engine}/${workload}/${cpu}x`;
    byConfig[key] = {};
    out.cells[key] = {};
    for (const config of [...new Set(trials.map((trial) => trial.config))]) {
      const own = trials.filter((trial) => trial.config === config);
      byConfig[key][config] = own;
      out.cells[key][config] = figures(own);
    }
  }
}

const trialsOf = (engine, workload, cpu, config) => byConfig[`${engine}/${workload}/${cpu}x`]?.[config] ?? [];
const rule = out.rule;

// ---- step 1, the veto: accessibility, per candidate and engine ---------------------------------------------------------------------------

const a11y = args.a11y !== undefined && existsSync(args.a11y) ? JSON.parse(readFileSync(args.a11y, 'utf8')) : null;
const passes = (variant, engine) => (a11y === null ? null : a11y[engine]?.[variant]?.pass === true);
rule.veto = Object.fromEntries(['s', 'a'].map((variant) => [variant, Object.fromEntries(ENGINES.map((engine) => [engine, a11y === null ? null : { passes: passes(variant, engine), failures: a11y[engine]?.[variant]?.failures ?? null }]))]));

// ---- step 2, primary: W1 at 1x, 5,000 rows, rAF interval p95, paired, in each engine -----------------------------------------------------

rule.primary = {};
for (const engine of ENGINES) {
  const s = trialsOf(engine, 'w1', 1, 's');
  const a = trialsOf(engine, 'w1', 1, 'a');
  if (s.length > 0 && a.length > 0) {
    rule.primary[engine] = { aOverS: beats(a, s), sOverA: beats(s, a) };
  }
}

const engines = Object.keys(rule.primary);
rule.perEngine = Object.fromEntries(engines.map((engine) => [engine, rule.primary[engine].aOverS.beats ? 'A beats S' : rule.primary[engine].sOverA.beats ? 'S beats A' : 'tie']));

// The measure of step 4, always computed: the median frame work on W1 in each engine, A against S (the per-trial median over the frames of
// the scroll window, then the median over the trials), and the heavier frames beside it.
rule.frameWork = {};
for (const engine of engines) {
  const s = out.cells[`${engine}/w1/1x`].s;
  const a = out.cells[`${engine}/w1/1x`].a;
  const relative = (x, y) => (y === 0 || y === null || x === null ? null : x / y - 1);
  rule.frameWork[engine] = {
    medianS: s.workP50.median,
    medianA: a.workP50.median,
    aOverS: relative(a.workP50.median, s.workP50.median),
    meanS: s.workMean.median,
    meanA: a.workMean.median,
    meanAOverS: relative(a.workMean.median, s.workMean.median),
    p95S: s.workP95.median,
    p95A: a.workP95.median,
    p95AOverS: relative(a.workP95.median, s.workP95.median),
  };
}

const aBeats = engines.filter((engine) => rule.primary[engine].aOverS.beats);
const sBeats = engines.filter((engine) => rule.primary[engine].sOverA.beats);
const aPassesVeto = ENGINES.every((engine) => rule.veto.a[engine]?.passes === true);
rule.steps = [];
if (engines.length > 0) {
  let chosen;
  if (aBeats.length > 0 && sBeats.length === 0) {
    // Steps 3 and 5: A is not worse in either engine and beats S in at least one; it wins only if it passed the veto in both engines.
    chosen = aPassesVeto ? 'A' : 'S';
    rule.steps.push(aPassesVeto
      ? `steps 3 and 5: A beats S in ${aBeats.join(' and ')} and is not worse in the other; A passes the veto in both engines: A, with its roles; the plan's spacer pick is overturned by measurement`
      : `step 5: A beats S in ${aBeats.join(' and ')} but does not pass the veto in both engines: S is kept and the ladder runs on S`);
  } else if (sBeats.length > 0 && aBeats.length === 0) {
    chosen = 'S';
    rule.steps.push(`step 3: S beats A in ${sBeats.join(' and ')} and is not worse in the other: S`);
  } else if (aBeats.length > 0 && sBeats.length > 0) {
    // Step 3, the engines disagree: minimax on the relative difference of the median p95, the candidate whose worst engine result is better.
    const worstA = Math.max(...engines.map((engine) => rule.primary[engine].aOverS.relative));
    const worstS = Math.max(...engines.map((engine) => rule.primary[engine].sOverA.relative));
    chosen = worstA < worstS ? 'A' : 'S';
    rule.steps.push(`step 3, the engines disagree (A beats S in ${aBeats.join(', ')}; S beats A in ${sBeats.join(', ')}): worst relative median p95 of A over S ${percent(worstA)}%, of S over A ${percent(worstS)}%: ${chosen}`);
    if (chosen === 'A' && !aPassesVeto) {
      chosen = 'S';
      rule.steps.push('step 5: A does not pass the veto in both engines: S is kept');
    }
  } else {
    // Step 4, a tie: "compare the median frame work on W1 in both engines; a difference under 10% is a tie again, and a tie goes to S".
    // Reading taken (the text does not say what one engine over 10% and the other under means): a candidate is preferred when its median
    // frame work is lower by 10% or more in an engine and is not higher by 10% or more in the other; every other case is a tie, and goes to S.
    const differences = Object.fromEntries(engines.map((engine) => [engine, rule.frameWork[engine].aOverS]));
    const lower = Object.values(differences).filter((value) => value !== null && value <= -0.1).length;
    const higher = Object.values(differences).filter((value) => value !== null && value >= 0.1).length;
    const preferred = lower > 0 && higher === 0 ? 'A' : higher > 0 && lower === 0 ? 'S' : 'tie';
    chosen = preferred === 'A' && aPassesVeto ? 'A' : 'S';
    rule.steps.push(`step 4, a tie on the primary measure in ${engines.join(' and ')} (neither candidate wins ${Math.ceil((7 / 9) * rule.primary[engines[0]].aOverS.pairs)} of ${rule.primary[engines[0]].aOverS.pairs} pairs with a median p95 more than 5% lower); median frame work A over S: ${engines.map((engine) => `${engine} ${percent(differences[engine])}%`).join(', ')}: ${preferred === 'tie' ? 'a tie again' : `${preferred} is preferred`}${preferred === 'A' && !aPassesVeto ? ' but A does not pass the veto' : ''}, so ${chosen}`);
  }

  rule.chosen = chosen;
}

// ---- the B2 readings of the chosen layout, with the control and the reference ----------------------------------------------------------------

rule.budgets = {};
const pick = (rule.chosen ?? 'S').toLowerCase();
for (const engine of ENGINES) {
  const w0 = out.cells[`${engine}/w0/1x`];
  const w1 = out.cells[`${engine}/w1/1x`];
  const w14 = out.cells[`${engine}/w1/4x`];
  if (w0 === undefined && w1 === undefined) {
    continue;
  }

  const cadence = w0?.c?.idleP50.median ?? w1?.c?.idleP50.median ?? 16.7;
  const read = (cell) => ({
    chosen: cell?.[pick]?.p95.median ?? null,
    chosenRange: cell?.[pick] ? [cell[pick].p95.min, cell[pick].p95.max] : null,
    chosenWorkP95: cell?.[pick]?.workP95.median ?? null,
    control: cell?.c?.p95.median ?? null,
    reference: cell?.r?.p95.median ?? null,
    s: cell?.s?.p95.median ?? null,
    a: cell?.a?.p95.median ?? null,
  });
  const b2a = read(w0);
  const b2b = read(w1);
  const b2c = read(w14);
  const excess = (reading) => (reading.chosen !== null && reading.control !== null ? round2(reading.chosen - reading.control) : null);
  rule.budgets[engine] = {
    idleCadenceMs: cadence,
    b2a: { ...b2a, budget: 16.7, absolutePass: b2a.chosen !== null && b2a.chosen <= 16.7, controlAbove: (b2a.control ?? 0) > 16.7, excessOverControlMs: excess(b2a), relativePass: excess(b2a) !== null ? excess(b2a) <= cadence : null },
    b2b: { ...b2b, budget: 33.4, absolutePass: b2b.chosen !== null && b2b.chosen <= 33.4, excessOverControlMs: excess(b2b), relativePass: excess(b2b) !== null ? excess(b2b) <= cadence : null, exceedsReference: b2b.chosen !== null && b2b.reference !== null ? b2b.chosen > b2b.reference : null },
    b2c: { ...b2c, reportOnly: true },
  };
}

// ---- the previous sprint's finding: S against A, in the terms it was recorded in ----------------------------------------------------------------

rule.reproduction = {};
for (const [key, cell] of Object.entries(out.cells)) {
  if (cell.s === undefined || cell.a === undefined || !key.includes('/w1/')) {
    continue;
  }

  const rel = (x, y) => (x.median === null || y.median === null || y.median === 0 ? null : percent(x.median / y.median - 1));
  rule.reproduction[key] = {
    recorded: 'fixed rows in normal flow against absolute rows: live-update p95 +22.5%, layout +20.9% (bench/app/README.md:835-838)',
    sOverA: { p95: rel(cell.s.p95, cell.a.p95), workP50: rel(cell.s.workP50, cell.a.workP50), workMean: rel(cell.s.workMean, cell.a.workMean), workP95: rel(cell.s.workP95, cell.a.workP95), layoutMs: rel(cell.s.layoutMs, cell.a.layoutMs), styleMs: rel(cell.s.styleMs, cell.a.styleMs), scriptMs: rel(cell.s.scriptMs, cell.a.scriptMs), taskMs: rel(cell.s.taskMs, cell.a.taskMs) },
  };
}

// ---- print ----------------------------------------------------------------------------------------------------------------------------------

const lines = [];
const NAMES = { s: 'S spacer', a: 'A absolute', r: 'R old table', c: 'C control' };
for (const [key, cell] of Object.entries(out.cells)) {
  lines.push(`\n### ${key}\n`);
  lines.push('| config | n | idle p95 | rAF p50 | rAF p95 | rAF p99 | rAF max | frames over 20 ms | work p50 | work mean | work p95 | holes | mounted rows | layout ms | style ms | script ms | task ms | repeated | load max |');
  lines.push(`|${' --- |'.repeat(19)}`);
  for (const [config, figs] of Object.entries(cell)) {
    lines.push(`| ${[NAMES[config] ?? config, figs.trials, fmt(figs.idleP95), fmt(figs.p50), fmt(figs.p95), fmt(figs.p99), fmt(figs.max), fmt(figs.over20, 0), fmt(figs.workP50, 2), fmt(figs.workMean, 2), fmt(figs.workP95, 2), `${figs.holes}/${figs.scored}`, fmt(figs.mounted, 0), fmt(figs.layoutMs), fmt(figs.styleMs), fmt(figs.scriptMs), fmt(figs.taskMs), figs.repeated, figs.loadMax].join(' | ')} |`);
  }
}

lines.push('\n## rule');
lines.push(JSON.stringify(rule, null, 2));
process.stdout.write(`${lines.join('\n')}\n`);
if (args.json !== undefined) {
  writeFileSync(args.json, `${JSON.stringify(out, null, 2)}\n`);
}

void median;

// Reads the trials of the log bench and applies the budgets of docs/ui-next/status/P1b-2.md ("Decision rule and budgets", written 2026-11-19 BEFORE any measurement)
// exactly as they are written there. Nothing in this file is tuned after seeing numbers. Where the text of a budget leaves a choice (which statistic of the rounds
// judges it, how a "no frame over X" is read), the choice is made HERE, in the comments below, before the matrix ran, and the report prints it beside the verdict.
//
//   node bench/log/analyze.mjs <prefix> [--json out.json] [--markdown out.md]
//
// `prefix` is what matrix.sh was given (m1): the directories bench/log/results/<prefix>-<engine>-<follow|scroll|search|counts> and <prefix>-chromium-memory.
//
// The statistics, fixed before the matrix ran:
//   - One TRIAL is one round of one config: a fresh page, one measured window. Every figure of a trial is one number (a nearest-rank percentile of the frames of its window,
//     a count, a time). A CONFIG's figure is the MEDIAN over its rounds, with [min-max] beside it; n is the number of rounds.
//   - A budget on a time or a rate (rAF p95, commits a second, the time to search) is judged on the median over the rounds, and the worst round is printed with it.
//   - "No slice holds a frame longer than 8 ms" is a statement about every frame: it is judged on the WORST frame of every search of every round (strict), and the median of
//     the rounds' worst is printed beside it.
//   - "At most 48 rows" and every exact count (listeners, elements, writes at the root) are judged on every frame, strictly.
//   - A budget stated relative to the control ("the control's p95 plus 10%") compares the median p95 of the kit's rounds with the median p95 of the control's rounds; the median
//     of the per-round ratios (kit over control, same round, the order rotating) is printed with it.
//   - The follow budget names 10,000 lines a second; 100 (added at m3: a stream so slow that every mounted row is kept and moves one place a frame, which is what the list's row positions cost), 1,000 and 50,000 have no budget in the rule and are REPORTED (with the longest frame) and never judged.
//   - 60 commits a second is read as written: the median of the rounds' commits per second, at one decimal, at most 60.0. A frame rate above 60.0 would show; the figure beside
//     it (the most commits in any one frame, which the rule bounds by the frame rate) is the one that says whether the kit commits more than once a frame.
//   - The overscan rule ("10 against 30, the smaller wins unless the larger is faster by more than the noise") compares the median scroll p95: the larger wins only if its median
//     is lower by more than the larger of the two configs' interquartile ranges over the rounds.
//   - A trial that started or ended with a 1-minute load above --max-load (12) was run once more by the runner; both runs are kept in the file's `attempts`, only the last is
//     read, and the report counts the repeated ones and prints the highest load of any trial read.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { finiteSorted, median, quantileSorted } from '../app/stats.mjs';

const here = import.meta.dirname;
const ENGINES = ['chromium', 'webkit'];
export const BUDGETS = {
  followP95ChromiumMs: 16.7,
  followP95WebkitOverControl: 1.1,
  commitsPerSecond: 60,
  commitsPerFrame: 1,
  rowsMax: 48,
  heldMaxMBRatio: 2,
  oldViewerMBPer100k: 24,
  flatGrowthOfHeld: 0.1,
  searchTotalMs: 250,
  searchFrameMs: 8,
  scrollP95ChromiumMs: 16.7,
  scrollP95WebkitOverControl: 1.1,
};

// ---- reading -----------------------------------------------------------------------------------------------------------------------------

export function readTrials(tag) {
  const full = path.join(here, 'results', tag);
  // A run writes meta.json last: a cell without it is still running (or was cut short) and is not read.
  if (!existsSync(full) || !existsSync(path.join(full, 'meta.json'))) {
    return { trials: [], meta: null };
  }

  const trials = readdirSync(full)
    .filter((name) => name.startsWith('trial-'))
    .map((name) => JSON.parse(readFileSync(path.join(full, name), 'utf8')))
    .sort((a, b) => a.round - b.round);
  return { trials, meta: JSON.parse(readFileSync(path.join(full, 'meta.json'), 'utf8')) };
}

const readJson = (tag, name) => {
  const file = path.join(here, 'results', tag, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

// ---- statistics --------------------------------------------------------------------------------------------------------------------------

const r1 = (value) => (value === null || value === undefined || Number.isNaN(value) ? null : Math.round(value * 10) / 10);
const r2 = (value) => (value === null || value === undefined || Number.isNaN(value) ? null : Math.round(value * 100) / 100);

/** The median of the rounds, the extremes, the quartiles. */
export function spread(values) {
  const sorted = finiteSorted(values);
  if (sorted.length === 0) {
    return { n: 0, median: null, min: null, max: null, p25: null, p75: null, values: [] };
  }

  return { n: sorted.length, median: median(sorted), min: sorted[0], max: sorted.at(-1), p25: quantileSorted(sorted, 0.25), p75: quantileSorted(sorted, 0.75), values: sorted };
}

const iqr = (figure) => (figure.n === 0 ? 0 : figure.p75 - figure.p25);
const q = (values, p) => quantileSorted(finiteSorted(values), p);
const workOf = (trial) => finiteSorted((trial.frames.work ?? []).filter((value) => value !== null && !Number.isNaN(value)));
const intervalsOf = (trial) => finiteSorted(trial.frames.intervals ?? []);

const fmt = (figure, digits = 1, unit = '') => {
  if (figure === null || figure === undefined || figure.n === 0 || figure.median === null) {
    return 'not run';
  }

  const f = (value) => (Math.round(value * 10 ** digits) / 10 ** digits).toFixed(digits);
  return figure.min === figure.max ? `${f(figure.median)}${unit}` : `${f(figure.median)}${unit} [${f(figure.min)}-${f(figure.max)}]`;
};

const pct = (value) => (value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${(Math.round(value * 1000) / 10).toFixed(1)}%`);

// ---- one config of the follow and scroll runs --------------------------------------------------------------------------------------------

/** Every figure of a set of trials (one config in one engine and workload), each a spread over the rounds. */
export function figures(trials) {
  const loads = trials.flatMap((trial) => [trial.load?.before, trial.load?.after]).filter((value) => typeof value === 'number');
  return {
    trials: trials.length,
    idleP95: spread(trials.map((trial) => trial.idle?.intervals?.p95)),
    p50: spread(trials.map((trial) => q(intervalsOf(trial), 0.5))),
    p95: spread(trials.map((trial) => q(intervalsOf(trial), 0.95))),
    p99: spread(trials.map((trial) => q(intervalsOf(trial), 0.99))),
    max: spread(trials.map((trial) => Math.max(...intervalsOf(trial)))),
    over20: spread(trials.map((trial) => intervalsOf(trial).filter((value) => value > 20).length)),
    framesInWindow: spread(trials.map((trial) => trial.frames.window)),
    workP50: spread(trials.map((trial) => q(workOf(trial), 0.5))),
    workP95: spread(trials.map((trial) => q(workOf(trial), 0.95))),
    workMax: spread(trials.map((trial) => Math.max(...workOf(trial)))),
    commitsPerSecond: spread(trials.map((trial) => trial.commits?.perSecond)),
    commitsMaxInAFrame: spread(trials.map((trial) => trial.commits?.maxInAFrame)),
    commitsTotal: spread(trials.map((trial) => trial.commits?.total)),
    rowsMax: spread(trials.map((trial) => trial.rows?.max)),
    heapMB: spread(trials.map((trial) => trial.heapUsedMB)),
    emittedPerSecond: spread(trials.map((trial) => trial.source?.perSecond)),
    heldMax: spread(trials.map((trial) => trial.source?.heldMax)),
    droppedBySource: spread(trials.map((trial) => trial.source?.droppedBySource)),
    longFrames: spread(trials.map((trial) => trial.longFrames)),
    longTasks: spread(trials.map((trial) => trial.longTasks)),
    layoutMs: spread(trials.map((trial) => trial.cdp?.LayoutDuration)),
    styleMs: spread(trials.map((trial) => trial.cdp?.RecalcStyleDuration)),
    scriptMs: spread(trials.map((trial) => trial.cdp?.ScriptDuration)),
    taskMs: spread(trials.map((trial) => trial.cdp?.TaskDuration)),
    jumpP50: spread(trials.map((trial) => trial.jumps?.summary?.p50)),
    jumpP95: spread(trials.map((trial) => trial.jumps?.summary?.p95)),
    deliveredPages: spread(trials.map((trial) => trial.scroll?.deliveredPages)),
    followedAtEnd: trials.filter((trial) => trial.following?.final?.following === true && trial.following?.final?.atEnd === true).length,
    newestLineShown: trials.filter((trial) => trial.following?.final?.lastRowShowsNewestLine === true).length,
    heldAfterStop: spread(trials.map((trial) => trial.source?.heldAfterStop)),
    rootWrites: trials.reduce((total, trial) => total + (trial.rootWrites?.length ?? 0), 0),
    problems: trials.reduce((total, trial) => total + (trial.problems?.length ?? 0), 0),
    repeated: trials.filter((trial) => (trial.attempts ?? 1) > 1).length,
    highLoad: trials.filter((trial) => trial.highLoad === true).length,
    loadMax: loads.length === 0 ? null : Math.max(...loads),
    loadMin: loads.length === 0 ? null : Math.min(...loads),
    elementsPerRow: [...new Set(trials.flatMap((trial) => Object.keys(trial.shape?.elementsPerRow ?? {})))].sort(),
  };
}

const byConfig = (trials) => {
  const out = {};
  for (const trial of trials) {
    (out[trial.config] ??= []).push(trial);
  }

  return Object.fromEntries(Object.entries(out).map(([config, own]) => [config, { trials: own, figures: figures(own) }]));
};

/** The per-round ratio of two configs' figure, rounds paired by their number. */
const pairedRatio = (kit, control, pick) => {
  const ratios = [];
  for (const trial of kit) {
    const mate = control.find((other) => other.round === trial.round);
    const a = pick(trial);
    const b = mate === undefined ? null : pick(mate);
    if (a !== null && b !== null && b > 0) {
      ratios.push(a / b);
    }
  }

  return spread(ratios);
};

const p95Of = (trial) => q(intervalsOf(trial), 0.95);

// ---- the verdicts ------------------------------------------------------------------------------------------------------------------------

const verdictOf = (pass) => (pass === null ? 'not run' : pass ? 'PASS' : 'MISS');

/** The gate of a rAF p95 budget (B1 follow, B6 scroll): the limit and whether the kit's median is within it. A median that was never measured (null) is `null`, not a pass: `null <= limit` is true in JavaScript, and `null * 1.1` is 0. */
export function p95Gate(engine, kitMedian, controlMedian, chromiumLimitMs, webkitFactor) {
  const limit = engine === 'chromium' ? chromiumLimitMs : controlMedian === undefined || controlMedian === null ? null : controlMedian * webkitFactor;
  return { limit, pass: limit === null || kitMedian === undefined || kitMedian === null ? null : kitMedian <= limit };
}

/** B2: the median commits a second at most 60.0, and no trial with more than one commit in a frame (the rule bounds the commits by the frame rate; a rate alone does not say it). */
export function commitsPass(commitFigures) {
  const medianCommits = r1(commitFigures.commitsPerSecond.median);
  const mostInAFrame = commitFigures.commitsMaxInAFrame.max;
  return medianCommits === null || mostInAFrame === null ? null : medianCommits <= BUDGETS.commitsPerSecond && mostInAFrame <= BUDGETS.commitsPerFrame;
}

/** B3: at most 48 rows in any frame. A row count that was never measured (no trial of the shipped kit and no exact-count run) is not run, never a pass: the worst of nothing is 0. */
export function rowsPass({ measured, worst }) {
  return measured ? worst <= BUDGETS.rowsMax : null;
}

export function analyze(prefix) {
  const out = { prefix, engines: {}, budgets: [], notes: [] };
  for (const engine of ENGINES) {
    const follow = readTrials(`${prefix}-${engine}-follow`);
    const scroll = readTrials(`${prefix}-${engine}-scroll`);
    const search = readTrials(`${prefix}-${engine}-search`);
    const counts = readJson(`${prefix}-${engine}-counts`, 'counts.json');
    const cell = (out.engines[engine] = {
      follow: byConfig(follow.trials),
      scroll: byConfig(scroll.trials),
      search: search.trials,
      counts,
      meta: { follow: follow.meta, scroll: scroll.meta, search: search.meta },
    });
    void cell;
  }

  const memory = readTrials(`${prefix}-chromium-memory`);
  out.memory = memory.trials;
  out.memoryMeta = memory.meta;

  const add = (budget) => out.budgets.push(budget);
  const range = (figure, digits = 1, unit = '') => fmt(figure, digits, unit);

  for (const engine of ENGINES) {
    const cells = out.engines[engine];

    // B1, follow tail rAF p95.
    for (const rate of [100, 1000, 10_000, 50_000]) {
      const kit = cells.follow[`kit:${rate}`];
      const control = cells.follow[`control:${rate}`];
      if (kit === undefined) {
        continue;
      }

      const judged = rate === 10_000;
      const gate = p95Gate(engine, kit.figures.p95.median, control?.figures.p95.median, BUDGETS.followP95ChromiumMs, BUDGETS.followP95WebkitOverControl);
      const limit = gate.limit;
      const pass = judged ? gate.pass : null;
      add({
        id: `B1 follow @${rate.toLocaleString('en-US')}/s`,
        engine,
        budget: judged ? (engine === 'chromium' ? 'rAF interval p95 at most 16.7 ms' : 'rAF interval p95 at most the control\'s p95 plus 10%') : 'none written: reported with the longest frame',
        measured: `kit p95 ${range(kit.figures.p95, 1, ' ms')}; control ${control === undefined ? 'not run' : range(control.figures.p95, 1, ' ms')}; longest frame ${range(kit.figures.max, 1, ' ms')}${judged && engine === 'webkit' && control !== undefined ? `; per-round kit/control ${range(pairedRatio(kit.trials, control.trials, p95Of), 3)}` : ''}`,
        against: judged ? (limit === null ? 'no control' : `${r1(limit)} ms`) : '-',
        verdict: judged ? verdictOf(pass) : 'reported',
        n: kit.figures.trials,
        worst: kit.figures.p95.max,
      });
    }

    // B2, commits per second.
    for (const rate of [100, 1000, 10_000, 50_000]) {
      const kit = cells.follow[`kit:${rate}`];
      if (kit === undefined) {
        continue;
      }

      add({
        id: `B2 commits @${rate.toLocaleString('en-US')}/s`,
        engine,
        budget: 'React commits a second at most 60, at every rate (bounded by the frame rate, not the line rate)',
        measured: `${range(kit.figures.commitsPerSecond, 1, '/s')}; most in one frame ${range(kit.figures.commitsMaxInAFrame, 0)}; frames ${range(kit.figures.framesInWindow, 0)}`,
        against: '60.0',
        verdict: verdictOf(commitsPass(kit.figures)),
        n: kit.figures.trials,
        worst: kit.figures.commitsPerSecond.max,
      });
    }

    // B3, DOM rows: the kit as it ships (an overscan of 10). The kit at an overscan of 30 is an experiment of B7 and is not what the budget is about; its rows are reported beside.
    const shipped = (config) => config.trials.every((trial) => trial.variant === 'kit' && trial.overscan === 10);
    const experiment = (config) => config.trials.every((trial) => trial.variant === 'kit' && trial.overscan !== 10);
    const mostRows = (configs) => Math.max(0, ...Object.values(configs).filter(shipped).map((config) => config.figures.rowsMax.max ?? 0));
    const rowsWorst = Math.max(mostRows(cells.follow), mostRows(cells.scroll));
    const shippedTrials = [...Object.values(cells.follow), ...Object.values(cells.scroll)].filter(shipped).length;
    const rowsAt30 = Math.max(0, ...Object.values(cells.scroll).filter(experiment).map((config) => config.figures.rowsMax.max ?? 0));
    if (Object.keys(cells.follow).length > 0 || Object.keys(cells.scroll).length > 0) {
      const counted = cells.counts?.results?.map((result) => `${result.lines.toLocaleString('en-US')}: ${result.rowsAtEnd} at the end, ${result.rowsQuarter} a quarter down`).join('; ');
      const countedWorst = Math.max(0, ...(cells.counts?.results ?? []).flatMap((result) => [result.rowsAtEnd, result.rowsQuarter]));
      add({
        id: 'B3 DOM rows',
        engine,
        budget: 'rows mounted at most the viewport plus overscan and the step\'s slack (48 at this stage), at every rate and after 100,000 lines',
        measured: `most rows in any frame of any kit trial (follow at every rate, scroll): ${rowsWorst}${counted === undefined ? '' : `; the exact counts: ${counted}`}${rowsAt30 > 0 ? `; the experiment at an overscan of 30 (B7, not shipped): ${rowsAt30}` : ''}`,
        against: '48',
        verdict: verdictOf(rowsPass({ measured: shippedTrials > 0 || (cells.counts?.results?.length ?? 0) > 0, worst: Math.max(rowsWorst, countedWorst) })),
        n: '-',
        worst: Math.max(rowsWorst, countedWorst),
      });
    }

    // B5, search.
    if (cells.search.length > 0) {
      const totals = cells.search.map((trial) => (trial.literal.doneMs ?? Number.NaN) + (trial.regex.doneMs ?? Number.NaN));
      const total = spread(totals);
      const frameWorst = cells.search.map((trial) => Math.max(trial.literal.workMax ?? 0, trial.regex.workMax ?? 0, trial.none.workMax ?? 0, trial.typed.workMax ?? 0));
      const worstFrame = Math.max(...frameWorst);
      const timedOut = cells.search.filter((trial) => trial.literal.doneMs === null || trial.regex.doneMs === null).length;
      add({
        id: 'B5 search time',
        engine,
        budget: 'a literal and a simple regex over 100,000 lines finish within 250 ms in total',
        measured: `literal ${range(spread(cells.search.map((t) => t.literal.doneMs)), 1, ' ms')}; regex ${range(spread(cells.search.map((t) => t.regex.doneMs)), 1, ' ms')}; total ${range(total, 1, ' ms')}; no match (reported) ${range(spread(cells.search.map((t) => t.none.doneMs)), 1, ' ms')}; typed (reported) ${range(spread(cells.search.map((t) => t.typed.doneMs)), 1, ' ms')}${timedOut > 0 ? `; ${timedOut} timed out` : ''}`,
        against: '250 ms',
        verdict: verdictOf(timedOut === 0 && total.median !== null && total.median <= BUDGETS.searchTotalMs),
        n: cells.search.length,
        worst: total.max,
      });
      const overCount = frameWorst.filter((value) => value > BUDGETS.searchFrameMs).length;
      add({
        id: 'B5 search frame',
        engine,
        budget: 'no slice holds a frame longer than 8 ms (the frames of a search: literal, regex, no match and typed)',
        measured: `longest frame work of a search, per round: ${range(spread(frameWorst), 2, ' ms')}; rounds with a frame over 8 ms: ${overCount} of ${frameWorst.length}; rest (no search) ${range(spread(cells.search.map((t) => t.rest?.workMax)), 2, ' ms')}`,
        against: '8 ms, every frame of every round',
        verdict: verdictOf(overCount === 0),
        n: cells.search.length,
        worst: worstFrame,
      });
    }

    // B6, scroll.
    const kitScroll = cells.scroll.kit;
    const controlScroll = cells.scroll.control;
    if (kitScroll !== undefined) {
      const { limit, pass } = p95Gate(engine, kitScroll.figures.p95.median, controlScroll?.figures.p95.median, BUDGETS.scrollP95ChromiumMs, BUDGETS.scrollP95WebkitOverControl);
      add({
        id: 'B6 scroll 30 pages',
        engine,
        budget: engine === 'chromium' ? 'rAF interval p95 at most 16.7 ms' : 'rAF interval p95 at most the control\'s p95 plus 10%',
        measured: `kit p95 ${range(kitScroll.figures.p95, 1, ' ms')}; control ${controlScroll === undefined ? 'not run' : range(controlScroll.figures.p95, 1, ' ms')}; pages delivered ${range(kitScroll.figures.deliveredPages, 1)}; longest frame ${range(kitScroll.figures.max, 1, ' ms')}`,
        against: limit === null ? 'no control' : `${r1(limit)} ms`,
        verdict: verdictOf(pass),
        n: kitScroll.figures.trials,
        worst: kitScroll.figures.p95.max,
      });
    }

    // B7, overscan 10 against 30.
    const big = cells.scroll['kit/30'];
    if (kitScroll !== undefined && big !== undefined) {
      const noise = Math.max(iqr(kitScroll.figures.p95), iqr(big.figures.p95));
      const faster = kitScroll.figures.p95.median - big.figures.p95.median;
      add({
        id: 'B7 overscan 10 against 30',
        engine,
        budget: 'the smaller wins unless the larger is faster by more than the noise',
        measured: `scroll p95 at 10: ${range(kitScroll.figures.p95, 1, ' ms')}; at 30: ${range(big.figures.p95, 1, ' ms')}; the larger is faster by ${r2(faster)} ms against noise ${r2(noise)} ms (the larger IQR); frame work p95 ${range(kitScroll.figures.workP95, 2, ' ms')} against ${range(big.figures.workP95, 2, ' ms')}; one-page jump p95 ${range(kitScroll.figures.jumpP95, 1, ' ms')} against ${range(big.figures.jumpP95, 1, ' ms')}`,
        against: 'faster by more than the noise',
        verdict: faster > noise ? 'larger wins (10 loses)' : '10 stays',
        n: kitScroll.figures.trials,
        worst: null,
      });
    }

    // B8, B9: the exact counts of a real engine.
    const counts = cells.counts;
    if (counts !== null) {
      const sizes = counts.results;
      const added = sizes.map((result) => result.afterInteractions.adds);
      const inStage = sizes.map((result) => result.afterInteractions.inStageAdds);
      const equal = new Set(added).size === 1 && new Set(inStage).size === 1;
      const removedOnUnmount = sizes.map((result) => result.afterUnmount.inStageRemoves - result.afterInteractions.inStageRemoves);
      add({
        id: 'B8 listeners',
        engine,
        budget: 'no listener per row: the same number of listeners at 60, 1,000 and 100,000 lines',
        measured: `listeners added through mount, a fill, a scroll and a search at ${sizes.map((result) => result.lines.toLocaleString('en-US')).join(', ')} lines: ${added.join(', ')} (in the stage: ${inStage.join(', ')}); the stage's listeners taken back on unmount: ${removedOnUnmount.join(', ')}`,
        against: 'equal',
        verdict: verdictOf(equal),
        n: '-',
        worst: null,
      });
      const writes = sizes.reduce((total, result) => total + result.rootWrites.length + result.afterUnmount.rootCustomWrites, 0);
      add({
        id: 'B9 writes at the root',
        engine,
        budget: 'zero custom-property writes at the root (and no attribute write on <html> or <body> after the page was ready)',
        measured: `${writes} (attribute writes on <html> or <body> and custom properties set on either, through mount, fill, scroll, search and unmount at three sizes${out.engines[engine].follow['kit:10000'] === undefined ? '' : `; and ${figuresRootWrites(cells)} during the follow runs`})`,
        against: '0',
        verdict: verdictOf(writes === 0 && figuresRootWrites(cells) === 0),
        n: '-',
        worst: writes,
      });
      if (counts.commits !== null && counts.commits !== undefined) {
        add({
          id: 'B2 commit counter cross-check',
          engine,
          budget: 'the DevTools hook\'s commit count is React\'s own (the Profiler agrees)',
          measured: `hook ${counts.commits.hook}, Profiler ${counts.commits.profiler} over 3 s at 10,000 lines/s (profiling build); totals since load ${counts.commits.hookTotal} and ${counts.commits.profilerTotal}`,
          against: 'equal',
          verdict: verdictOf(counts.commits.hook === counts.commits.profiler),
          n: '-',
          worst: null,
        });
      }
    }
  }

  // B4, memory (Chromium only).
  if (out.memory.length > 0) {
    const held = spread(out.memory.map((trial) => trial.heldMB));
    const growth = spread(out.memory.map((trial) => trial.growthMB));
    const growthOfHeld = spread(out.memory.map((trial) => trial.growthOfHeld));
    const limit = BUDGETS.heldMaxMBRatio * BUDGETS.oldViewerMBPer100k;
    add({
      id: 'B4 memory at the cap',
      engine: 'chromium',
      budget: 'the heap after 100,000 lines held within 2 x the old viewer\'s 24 MB per 100,000 lines (48 MB), flat after another 1,000,000 lines (growth at most 10% of what is held)',
      measured: `held ${range(held, 1, ' MB')} (${range(spread(out.memory.map((t) => t.bytesPerLine)), 0, ' B')} a line); growth over ${range(spread(out.memory.map((t) => t.streamed / 1e6)), 2, ' million')} more lines ${range(growth, 1, ' MB')} = ${range(growthOfHeld, 3)} of held; DOM nodes before and after ${out.memory.map((t) => `${t.nodes[0]}/${t.nodes[1]}`).slice(0, 3).join(', ')}...; listeners before and after ${out.memory.map((t) => `${t.listeners[0]}/${t.listeners[1]}`).slice(0, 3).join(', ')}...`,
      against: '48 MB and 10% of held',
      verdict: verdictOf(held.median !== null && held.median <= limit && growthOfHeld.median !== null && growthOfHeld.median <= BUDGETS.flatGrowthOfHeld),
      n: out.memory.length,
      worst: held.max,
    });
  }

  return out;
}

function figuresRootWrites(cells) {
  return Object.values({ ...cells.follow, ...cells.scroll }).reduce((total, config) => total + config.figures.rootWrites, 0) + cells.search.reduce((total, trial) => total + (trial.rootWrites?.length ?? 0), 0);
}

// ---- the tables --------------------------------------------------------------------------------------------------------------------------

export function markdown(result) {
  const lines = [];
  lines.push('### The budgets', '', '| budget | engine | as written | measured: median [min-max] over the rounds | against | n | verdict |', `|${' --- |'.repeat(7)}`);
  for (const budget of result.budgets) {
    lines.push(`| ${budget.id} | ${budget.engine} | ${budget.budget} | ${budget.measured} | ${budget.against} | ${budget.n} | **${budget.verdict}** |`);
  }

  for (const engine of ENGINES) {
    const cells = result.engines[engine];
    if (Object.keys(cells.follow).length > 0) {
      lines.push('', `### ${engine}: following the tail of a full buffer (10 s measured, 3 s warm-up)`, '', '| config | n | idle p95 | rAF p50 | rAF p95 | rAF p99 | rAF max | frames over 20 ms | work p50 | work p95 | work max | commits/s | most commits in a frame | rows max | emitted/s | held max | at the end and following | newest line shown | long frames | heap MB | load max | repeated |', `|${' --- |'.repeat(22)}`);
      for (const [config, { figures: f }] of Object.entries(cells.follow)) {
        lines.push(`| ${config} | ${f.trials} | ${fmt(f.idleP95)} | ${fmt(f.p50)} | ${fmt(f.p95)} | ${fmt(f.p99)} | ${fmt(f.max)} | ${fmt(f.over20, 0)} | ${fmt(f.workP50, 2)} | ${fmt(f.workP95, 2)} | ${fmt(f.workMax, 2)} | ${config.startsWith('kit') ? fmt(f.commitsPerSecond) : 'no React'} | ${config.startsWith('kit') ? fmt(f.commitsMaxInAFrame, 0) : '-'} | ${fmt(f.rowsMax, 0)} | ${fmt(f.emittedPerSecond, 0)} | ${fmt(f.heldMax, 0)} | ${f.followedAtEnd} of ${f.trials} | ${f.newestLineShown} of ${f.trials} | ${fmt(f.longFrames, 0)} | ${fmt(f.heapMB)} | ${f.loadMax} | ${f.repeated} |`);
      }
    }

    if (Object.keys(cells.scroll).length > 0) {
      lines.push('', `### ${engine}: scrolling through 100,000 lines (30 pages by paced wheel input, then 30 one-page jumps)`, '', '| config | n | idle p95 | rAF p50 | rAF p95 | rAF p99 | rAF max | frames over 20 ms | work p50 | work p95 | work max | rows max | pages delivered | jump p50 | jump p95 | commits in the window | load max | repeated |', `|${' --- |'.repeat(18)}`);
      for (const [config, { figures: f, trials }] of Object.entries(cells.scroll)) {
        lines.push(`| ${config} | ${f.trials} | ${fmt(f.idleP95)} | ${fmt(f.p50)} | ${fmt(f.p95)} | ${fmt(f.p99)} | ${fmt(f.max)} | ${fmt(f.over20, 0)} | ${fmt(f.workP50, 2)} | ${fmt(f.workP95, 2)} | ${fmt(f.workMax, 2)} | ${fmt(f.rowsMax, 0)} | ${fmt(f.deliveredPages)} | ${fmt(f.jumpP50, 2)} | ${fmt(f.jumpP95, 2)} | ${config.startsWith('control') ? 'no React' : fmt(spread(trials.map((t) => t.commits?.total)), 0)} | ${f.loadMax} | ${f.repeated} |`);
      }
    }

    if (cells.search.length > 0) {
      lines.push('', `### ${engine}: searching a full buffer of 100,000 lines`, '', '| query | n | time to the final count (ms) | frames in the interaction | frame work p50 (ms) | frame work max (ms) | rAF max (ms) | long frames |', `|${' --- |'.repeat(8)}`);
      for (const [name, label] of [['literal', 'literal `connection reset`'], ['regex', 'regex `attempt [34]\\)`'], ['none', 'no match `zzzzqq`'], ['typed', 'literal typed, 80 ms a key (from the last key)']]) {
        const of = (pick) => spread(cells.search.map(pick));
        lines.push(`| ${label} | ${cells.search.length} | ${fmt(of((t) => t[name].doneMs))} | ${fmt(of((t) => t[name].frames), 0)} | ${fmt(of((t) => t[name].work?.p50), 2)} | ${fmt(of((t) => t[name].workMax), 2)} | ${fmt(of((t) => t[name].interval?.max))} | ${fmt(of((t) => t[name].longFrames), 0)} |`);
      }

      const rest = cells.search.map((t) => t.rest);
      lines.push(`| rest, no search (1.5 s) | ${cells.search.length} | - | ${fmt(spread(rest.map((r) => r.frames)), 0)} | ${fmt(spread(rest.map((r) => r.work?.p50)), 2)} | ${fmt(spread(rest.map((r) => r.workMax)), 2)} | ${fmt(spread(rest.map((r) => r.interval?.max)))} | ${fmt(spread(rest.map((r) => r.longFrames)), 0)} |`);
      lines.push('', `Matches found by the page's own count over the same seeded lines: literal ${cells.search[0].expected.literal.toLocaleString('en-US')} lines, regex ${cells.search[0].expected.regex.toLocaleString('en-US')} lines. Load: highest ${Math.max(...cells.search.flatMap((t) => [t.load.before, t.load.after]))}, repeated ${cells.search.filter((t) => t.attempts > 1).length}.`);
    }

    if (cells.counts !== null) {
      lines.push('', `### ${engine}: exact counts (the built kit, 596 px stage)`, '', '| lines | rows at the end | rows a quarter down | elements per mounted row (rows with that count) | elements in the document | listeners added, mount to search (in the stage) | taken back on unmount (in the stage) | attribute writes on html/body | custom properties on html/body |', `|${' --- |'.repeat(9)}`);
      for (const result of cells.counts.results) {
        lines.push(`| ${result.lines.toLocaleString('en-US')} | ${result.rowsAtEnd} | ${result.rowsQuarter} | ${Object.entries(result.shape.elementsPerRow).map(([elements, rows]) => `${elements}: ${rows}`).join(', ')} | ${result.shape.elementsInDocument} | ${result.afterInteractions.adds} (${result.afterInteractions.inStageAdds}) | ${result.afterUnmount.removes - result.afterInteractions.removes} (${result.afterUnmount.inStageRemoves - result.afterInteractions.inStageRemoves}) | ${result.rootWrites.length} | ${result.afterInteractions.rootCustomWrites} |`);
      }
    }
  }

  if (result.memory.length > 0) {
    const of = (pick) => spread(result.memory.map(pick));
    lines.push('', '### chromium: the heap at the cap (forced collections, CDP)', '', '| n | heap empty (MB) | heap at 100,000 lines held (MB) | held (MB) | per line (B) | heap after 1,000,000 more (MB) | growth (MB) | growth of held | nodes before / after | listeners before / after | newest line shown | load max |', `|${' --- |'.repeat(12)}`);
    lines.push(`| ${result.memory.length} | ${fmt(of((t) => t.h0MB))} | ${fmt(of((t) => t.h1MB))} | ${fmt(of((t) => t.heldMB))} | ${fmt(of((t) => t.bytesPerLine), 0)} | ${fmt(of((t) => t.h2MB))} | ${fmt(of((t) => t.growthMB))} | ${fmt(of((t) => t.growthOfHeld), 3)} | ${fmt(of((t) => t.nodes[0]), 0)} / ${fmt(of((t) => t.nodes[1]), 0)} | ${fmt(of((t) => t.listeners[0]), 0)} / ${fmt(of((t) => t.listeners[1]), 0)} | ${result.memory.filter((t) => t.final.lastRowShowsNewestLine).length} of ${result.memory.length} | ${Math.max(...result.memory.flatMap((t) => [t.load.before, t.load.after]))} |`);
  }

  return `${lines.join('\n')}\n`;
}

// ---- the compact summary that is committed (the raw per-frame arrays are not) ----------------------------------------------------------------

/** One number a round for the headline figures: enough to recompute every median and range printed, small enough to commit. */
export function summary(result) {
  const roundsOf = (trials, pick) => trials.map((trial) => pick(trial));
  const out = { prefix: result.prefix, budgets: result.budgets, engines: {} };
  for (const engine of ENGINES) {
    const cells = result.engines[engine];
    out.engines[engine] = {
      follow: Object.fromEntries(Object.entries(cells.follow).map(([config, { trials }]) => [config, {
        rounds: trials.map((trial) => trial.round),
        p95: roundsOf(trials, p95Of),
        max: roundsOf(trials, (trial) => Math.max(...intervalsOf(trial))),
        commitsPerSecond: roundsOf(trials, (trial) => trial.commits?.perSecond),
        commitsMaxInAFrame: roundsOf(trials, (trial) => trial.commits?.maxInAFrame),
        rowsMax: roundsOf(trials, (trial) => trial.rows?.max),
        load: roundsOf(trials, (trial) => [trial.load?.before, trial.load?.after]),
        attempts: roundsOf(trials, (trial) => trial.attempts),
      }])),
      scroll: Object.fromEntries(Object.entries(cells.scroll).map(([config, { trials }]) => [config, {
        rounds: trials.map((trial) => trial.round),
        p95: roundsOf(trials, p95Of),
        deliveredPages: roundsOf(trials, (trial) => trial.scroll?.deliveredPages),
        rowsMax: roundsOf(trials, (trial) => trial.rows?.max),
        load: roundsOf(trials, (trial) => [trial.load?.before, trial.load?.after]),
        attempts: roundsOf(trials, (trial) => trial.attempts),
      }])),
      search: cells.search.map((trial) => ({
        round: trial.round,
        literalMs: trial.literal.doneMs, regexMs: trial.regex.doneMs, noneMs: trial.none.doneMs, typedMs: trial.typed.doneMs,
        workMax: [trial.literal.workMax, trial.regex.workMax, trial.none.workMax, trial.typed.workMax],
        load: [trial.load.before, trial.load.after], attempts: trial.attempts,
      })),
      counts: cells.counts === null ? null : cells.counts.results.map((entry) => ({
        lines: entry.lines, rowsAtEnd: entry.rowsAtEnd, rowsQuarter: entry.rowsQuarter, elementsPerRow: entry.shape.elementsPerRow, listenersAdded: entry.afterInteractions.adds,
        listenersInStage: entry.afterInteractions.inStageAdds, takenBackInStage: entry.afterUnmount.inStageRemoves - entry.afterInteractions.inStageRemoves,
        rootWrites: entry.rootWrites.length, rootCustomWrites: entry.afterUnmount.rootCustomWrites,
      })),
      environment: cells.meta.follow?.environment ?? cells.meta.search?.environment ?? null,
      identity: cells.meta.follow?.identities ?? cells.meta.search?.identity ?? null,
    };
  }

  out.memory = result.memory.map((trial) => ({ round: trial.round, h0MB: trial.h0MB, h1MB: trial.h1MB, h2MB: trial.h2MB, heldMB: trial.heldMB, growthMB: trial.growthMB, growthOfHeld: trial.growthOfHeld, bytesPerLine: trial.bytesPerLine, streamed: trial.streamed, load: [trial.load.before, trial.load.after], attempts: trial.attempts }));
  return out;
}

// ---- CLI ---------------------------------------------------------------------------------------------------------------------------------

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.join(here, 'analyze.mjs')) {
  const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'string' }, markdown: { type: 'string' } } });
  const prefix = positionals[0];
  if (prefix === undefined) {
    throw new Error('usage: node bench/log/analyze.mjs <prefix> [--json out.json] [--markdown out.md]');
  }

  const result = analyze(prefix);
  const text = markdown(result);
  process.stdout.write(text);
  if (args.json !== undefined) {
    writeFileSync(args.json, `${JSON.stringify(summary(result))}\n`);
  }

  if (args.markdown !== undefined) {
    writeFileSync(args.markdown, text);
  }
}

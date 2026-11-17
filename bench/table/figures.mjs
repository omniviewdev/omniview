// What analyze.mjs and sweep.mjs read from the trials of run.mjs: one number per trial, summarised over the trials with its spread, and the
// paired comparison of the decision rule (docs/ui-next/status/1a.3.md, step 2).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { finiteSorted, median, quantileSorted } from '../app/stats.mjs';
import { here } from './lib.mjs';

export const round1 = (value) => (value === null || value === undefined ? null : Math.round(value * 10) / 10);
export const round2 = (value) => (value === null || value === undefined ? null : Math.round(value * 100) / 100);
export const percent = (value) => (value === null || value === undefined ? null : Math.round(value * 1000) / 10);

export function readTrials(directory) {
  const full = path.join(here, 'results', directory);
  // A run writes meta.json last: a cell without it is still running (or was cut short) and is not read.
  if (!existsSync(full) || !existsSync(path.join(full, 'meta.json'))) {
    return [];
  }

  return readdirSync(full)
    .filter((name) => name.startsWith('trial-'))
    .map((name) => JSON.parse(readFileSync(path.join(full, name), 'utf8')))
    .sort((a, b) => a.round - b.round);
}

/** median [min-max] and the quartiles of one number per trial. */
export function spread(values) {
  const sorted = finiteSorted(values);
  if (sorted.length === 0) {
    return { n: 0, median: null, min: null, max: null, p25: null, p75: null };
  }

  return { n: sorted.length, median: median(sorted), min: sorted[0], max: sorted.at(-1), p25: quantileSorted(sorted, 0.25), p75: quantileSorted(sorted, 0.75) };
}

/** The 95th percentile of a trial's frame intervals, by nearest rank over the frames of its scroll window. */
export const p95Of = (trial) => quantileSorted(finiteSorted(trial.frames.intervals), 0.95);

const cdp = (name) => (trial) => trial.cdp?.[name] ?? null;
const workOf = (trial) => finiteSorted(trial.frames.work.filter((value) => value !== null));
const sumOf = (values) => values.reduce((total, value) => total + value, 0);

/** All figures of one set of trials (one config in one engine, workload and CPU rate), each a spread over the trials. */
export function figures(trials) {
  const intervals = (trial) => finiteSorted(trial.frames.intervals);
  return {
    trials: trials.length,
    p50: spread(trials.map((trial) => quantileSorted(intervals(trial), 0.5))),
    p95: spread(trials.map(p95Of)),
    p99: spread(trials.map((trial) => quantileSorted(intervals(trial), 0.99))),
    max: spread(trials.map((trial) => Math.max(...trial.frames.intervals))),
    over20: spread(trials.map((trial) => trial.frames.intervals.filter((value) => value > 20).length)),
    over33: spread(trials.map((trial) => trial.frames.intervals.filter((value) => value > 33.4).length)),
    workP50: spread(trials.map((trial) => quantileSorted(workOf(trial), 0.5))),
    workMean: spread(trials.map((trial) => sumOf(workOf(trial)) / Math.max(1, workOf(trial).length))),
    workP95: spread(trials.map((trial) => quantileSorted(workOf(trial), 0.95))),
    workMax: spread(trials.map((trial) => Math.max(...workOf(trial)))),
    idleP50: spread(trials.map((trial) => trial.idle.intervals.p50)),
    idleP95: spread(trials.map((trial) => trial.idle.intervals.p95)),
    layoutMs: spread(trials.map(cdp('LayoutDuration'))),
    styleMs: spread(trials.map(cdp('RecalcStyleDuration'))),
    scriptMs: spread(trials.map(cdp('ScriptDuration'))),
    taskMs: spread(trials.map(cdp('TaskDuration'))),
    layouts: spread(trials.map(cdp('LayoutCount'))),
    styles: spread(trials.map(cdp('RecalcStyleCount'))),
    lateness95: spread(trials.map((trial) => trial.drive.lateness?.p95 ?? null)),
    holes: sumOf(trials.map((trial) => trial.coverage.holes)),
    scored: sumOf(trials.map((trial) => trial.coverage.scored)),
    mounted: spread(trials.map((trial) => trial.mounted.p50)),
    longTasks: sumOf(trials.map((trial) => trial.longTasks)),
    longFrames: sumOf(trials.map((trial) => trial.longFrames)),
    repeated: trials.filter((trial) => trial.attempts > 1).length,
    loadMax: Math.max(...trials.map((trial) => Math.max(trial.load.before, trial.load.after))),
    loadMedian: median(trials.map((trial) => trial.load.before)),
    deliveredPx: spread(trials.map((trial) => trial.scroll.deliveredPx)),
    mountToFirstRowMs: spread(trials.map((trial) => trial.info.mountToFirstRowMs)),
    elementsPerRow: trials[0]?.shape.elementsPerRow ?? null,
    rowHeight: trials[0]?.info.rowHeight ?? null,
  };
}

/** For each round in which both ran: whose p95 was lower (a tie splits the pair). */
export function pairs(trialsX, trialsY) {
  const byRound = new Map(trialsY.map((trial) => [trial.round, trial]));
  let winsX = 0;
  let winsY = 0;
  let count = 0;
  for (const x of trialsX) {
    const y = byRound.get(x.round);
    if (y === undefined) {
      continue;
    }

    count += 1;
    const a = p95Of(x);
    const b = p95Of(y);
    if (a < b) {
      winsX += 1;
    } else if (b < a) {
      winsY += 1;
    } else {
      winsX += 0.5;
      winsY += 0.5;
    }
  }

  return { pairs: count, winsX, winsY };
}

/**
 * Rule step 2. X BEATS Y in an engine when X wins at least 7 of 9 pairs (the same share for more trials: ceil(7/9 * pairs)) and its median
 * p95 is lower than Y's by more than 5%. X is WORSE than Y when Y beats X.
 */
export function beats(trialsX, trialsY) {
  const { pairs: count, winsX, winsY } = pairs(trialsX, trialsY);
  const needed = Math.ceil((7 / 9) * count);
  const medianX = median(trialsX.map(p95Of));
  const medianY = median(trialsY.map(p95Of));
  const lower = medianX !== null && medianY !== null && medianX < medianY * 0.95;
  return { pairs: count, wins: winsX, lost: winsY, needed, medianX, medianY, relative: medianX === null || medianY === null ? null : medianX / medianY - 1, beats: count > 0 && winsX >= needed && lower };
}

export const fmt = (value, digits = 1) => {
  if (value.median === null) {
    return '-';
  }

  const round = digits === 2 ? round2 : round1;
  return `${round(value.median)} [${round(value.min)}-${round(value.max)}]`;
};

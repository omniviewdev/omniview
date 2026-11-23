// The seconds of the probe units, from what the runner measured (N26).
//
//   node scripts/ci/probe-seconds.mjs [--runs <n>] [--write]
//
// Reads the shard logs of the last <n> (default 30) successful runs of ui-next-kit-probes.yml, on main and on pull requests, every attempt of each (a shard that failed on its drift and passed on the re-run is a sample, and the
// slowest one), and prints for each unit of scripts/ci/probe-units: the samples, min, median, 95th percentile and max of its real seconds, the seconds it lists, the seconds this script proposes, and the headroom between the max
// seen and the unit's failure threshold. The proposal is the 95th percentile rounded UP to 5 s: a unit fails past its seconds plus the larger of a quarter of them and 60 s (probe-shards.mjs, DRIFT_RATIO and
// DRIFT_FLOOR_SECONDS), so that margin sits above the runner's normal spread and not on the median.
//
// `--write` puts each proposal in the `seconds` of its unit in scripts/ci/probe-units/*.mjs, and changes nothing else in those files. A unit with fewer than --min-samples (default 5) samples is printed and never written.
//
// WHERE THE NUMBERS COME FROM. Each shard's log prints, after its units ran, the table '#### Kit probes shard <n>: seconds against the table' (`| Unit | Table s | This run s | Difference | |`): the seconds the drift gate itself
// held the unit to, one row for each unit that passed, by unit id. That is read here, and not the table 'Result | Seconds | Probe | Negative control | Step' printed just before it, whose rows are one run of a probe or a control
// each and name no unit. The ran-<shard>-probe.json artifacts the shards upload carry no seconds, so they are not read, and the workflow is untouched. A run before N25 (#656) has no such table and gives no sample. The job
// summary is not on the jobs API: the log is.
//
//   --runs <n>         how many successful runs (default 30)
//   --workflow <file>  the workflow (default ui-next-kit-probes.yml)
//   --repo <o/n>       the repository (default: the one this clone is of)
//   --logs <dir>       read shard logs saved as files (any depth, every file) instead of asking GitHub
//   --cache <dir>      keep what was read from each job log, so that a second run asks GitHub only for what is new
//   --min-samples <n>  fewest samples a unit needs to be proposed or written (default 5)
//   --few-samples <skip|max>  what to do with a unit that has fewer than --min-samples samples but at least one: `skip` (default) leaves it as listed; `max` lists its MAX observed rounded up to 5 s plus 15%, rounded up to 5 s again,
//                      so that a new unit sits well under its failure limit after its first run (a p95 of two or three samples is its max anyway, and a bad one)
//   --with-failed      also read the runs that ended in failure (a unit's seconds are in the log of a shard that failed for another unit; a unit that itself failed is never a sample)
//   --keep <id,id>     units whose samples are of another unit (its probe or controls changed since): printed, never proposed or written, until enough runs of the new one exist
//   --write            update `seconds` in the unit files
//   --root <dir>       another tree than this repository (the tests)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DRIFT_FLOOR_SECONDS, DRIFT_RATIO, REPO_ROOT, loadUnits } from './probe-shards.mjs';

export const DEFAULT_RUNS = 30;
export const DEFAULT_WORKFLOW = 'ui-next-kit-probes.yml';
export const DEFAULT_MIN_SAMPLES = 5;
/** The proposal is rounded up to a multiple of this many seconds. */
export const ROUND_SECONDS = 5;
export const PERCENTILE = 0.95;
/** A unit whose max is within this share of its threshold is named: its margin did not hold the runner's own spread. */
export const NEAR_THRESHOLD = 0.1;
/** A unit with few samples is listed at its max rounded up to ROUND_SECONDS, plus this share. */
export const FEW_SAMPLES_MARGIN = 0.15;

/** `--few-samples max`: the max seen rounded up to 5 s, plus 15 percent, rounded up to 5 s again. */
export const proposeFew = (max) => proposeSeconds(proposeSeconds(max) * (1 + FEW_SAMPLES_MARGIN));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// A line of a job log: an ISO timestamp, a space, the text (and colour escapes that a tool may have put in).
// eslint-disable-next-line no-control-regex
const clean = (line) => line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/^\ufeff?\d{4}-\d\d-\d\dT[\d:.]+Z /, '').replace(/\r$/, '');

const HEADING = /^#### Kit probes shard (\d+): seconds against the table$/;
const ROW = /^\|\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/;

/** The real seconds of each unit a shard's log reports: `[{ unit, seconds, shard }]`, from the table after the heading. A log without the table (a run before N25, a job that never got to run its units) gives none. */
export function parseUnitSeconds(log) {
  const found = [];
  let shard = null;
  let started = false;
  for (const raw of log.split('\n')) {
    const line = clean(raw);
    const heading = HEADING.exec(line);
    if (heading !== null) {
      shard = Number(heading[1]);
      started = false;
      continue;
    }
    if (shard === null) continue;
    // Between the heading and the first row: a blank line, the header row and its rule. After a row, anything that is not a row ends the table.
    if (!started && (line === '' || line.startsWith('| Unit |') || line.startsWith('|---'))) continue;
    const row = ROW.exec(line);
    if (row === null) {
      shard = null;
      started = false;
      continue;
    }
    started = true;
    found.push({ unit: row[1], seconds: Number(row[3]), shard });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The statistics
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** The `p` quantile of numbers by linear interpolation between the two nearest ranks (the usual definition: the median of 1, 2 is 1.5, and the max for p = 1). */
export function quantile(values, p) {
  if (values.length === 0) throw new Error('no values');
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * p;
  const lower = Math.floor(at);
  const upper = Math.ceil(at);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (at - lower);
}

/** `{ samples, min, median, p95, max }` of a unit's seconds (an empty list gives `samples: 0`). */
export function summarise(values) {
  if (values.length === 0) return { samples: 0 };
  return { samples: values.length, min: Math.min(...values), median: quantile(values, 0.5), p95: quantile(values, PERCENTILE), max: Math.max(...values) };
}

/** The 95th percentile rounded up to a multiple of ROUND_SECONDS (never under it: a value that is already a multiple stays). */
export const proposeSeconds = (p95) => Math.max(ROUND_SECONDS, Math.ceil(p95 / ROUND_SECONDS - 1e-9) * ROUND_SECONDS);

/** The most real seconds a unit that lists `seconds` may take and pass (the engine's rule: it fails past its seconds plus the larger of DRIFT_RATIO of them and DRIFT_FLOOR_SECONDS). */
export const thresholdOf = (seconds) => seconds + Math.max(DRIFT_FLOOR_SECONDS, DRIFT_RATIO * seconds);

/**
 * One row for each unit of the table, in the table's order: the statistics of its samples, what it lists, what is proposed (the listed value when it has fewer than `minSamples`), the failure threshold of each and the room under it.
 * `near` is true when the max seen is within NEAR_THRESHOLD of the threshold of the PROPOSED value (of the listed one when nothing is proposed).
 */
export function analyse({ units, samples, minSamples = DEFAULT_MIN_SAMPLES, keep = [], few = 'skip' }) {
  return units.map((unit) => {
    const stats = summarise(samples.get(unit.id) ?? []);
    const kept = keep.includes(unit.id);
    const plenty = stats.samples >= minSamples;
    const byMax = !plenty && few === 'max' && stats.samples > 0 && !kept;
    const enough = (plenty || byMax) && !kept;
    const proposed = enough ? (byMax ? proposeFew(stats.max) : proposeSeconds(stats.p95)) : unit.seconds;
    const row = { id: unit.id, file: unit.file, ...stats, listed: unit.seconds, proposed, enough, kept, byMax };
    row.thresholdListed = thresholdOf(unit.seconds);
    row.thresholdProposed = thresholdOf(proposed);
    if (stats.samples > 0) {
      row.headroomListed = row.thresholdListed - stats.max;
      row.headroomProposed = row.thresholdProposed - stats.max;
      row.near = stats.max > row.thresholdProposed * (1 - NEAR_THRESHOLD);
      row.nearListed = stats.max > row.thresholdListed * (1 - NEAR_THRESHOLD);
      row.failedListed = stats.max > row.thresholdListed;
    }
    return row;
  });
}

const fixed = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const percentChange = (from, to) => Math.round(((to - from) / from) * 100);

/** Markdown: the table of every unit, then what changes by more than 10 percent and which units are near their threshold. */
export function render(rows, { runs, jobs, skipped, missing = [] } = {}) {
  const lines = [];
  if (jobs !== undefined) lines.push(`Read ${jobs} shard logs${runs === undefined ? '' : ` of ${runs} runs`}${skipped > 0 ? ` (${skipped} without the table of seconds: ignored)` : ''}.`, '');
  lines.push('| Unit | Samples | Min | Median | p95 | Max | Listed | Proposed | Change | Limit (listed) | Headroom (listed) | Limit (proposed) | Headroom (proposed) |', '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
  for (const row of rows) {
    if (row.samples === 0) {
      lines.push(`| ${row.id} | 0 | | | | | ${row.listed} | ${row.listed} | | ${fixed(row.thresholdListed)} | | | |`);
      continue;
    }
    const change = row.proposed === row.listed ? '' : `${percentChange(row.listed, row.proposed) > 0 ? '+' : ''}${percentChange(row.listed, row.proposed)}%`;
    lines.push(
      `| ${row.id} | ${row.samples} | ${fixed(row.min)} | ${fixed(row.median)} | ${fixed(row.p95)} | ${fixed(row.max)} | ${row.listed} | ${row.proposed}${row.kept ? ' (kept)' : row.byMax ? ' (max + 15%, few samples)' : row.enough ? '' : ' (too few samples)'} | ${change} | ${fixed(row.thresholdListed)} | ${fixed(row.headroomListed)} | ${fixed(row.thresholdProposed)} | ${fixed(row.headroomProposed)} |`,
    );
  }
  const total = (key) => rows.reduce((sum, row) => sum + row[key], 0);
  lines.push('', `Listed seconds of all units: ${total('listed')}; proposed: ${total('proposed')}.`);
  const failing = rows.filter((row) => row.failedListed);
  if (failing.length > 0) lines.push('', `Over their failure threshold at least once with the listed value: ${failing.map((row) => `${row.id} (max ${fixed(row.max)} s, limit ${fixed(row.thresholdListed)} s)`).join(', ')}.`);
  const nearListed = rows.filter((row) => row.nearListed && !row.failedListed);
  if (nearListed.length > 0) lines.push('', `Within ${NEAR_THRESHOLD * 100}% of their failure threshold with the listed value: ${nearListed.map((row) => `${row.id} (max ${fixed(row.max)} s, limit ${fixed(row.thresholdListed)} s)`).join(', ')}.`);
  const near = rows.filter((row) => row.near);
  if (near.length > 0) lines.push('', `Within ${NEAR_THRESHOLD * 100}% of their failure threshold with the proposed value (a higher value, or a unit too variable for one: look at what it does): ${near.map((row) => `${row.id} (max ${fixed(row.max)} s, limit ${fixed(row.thresholdProposed)} s)`).join(', ')}.`);
  if (missing.length > 0) lines.push('', `Samples for units that are not in the table (ignored): ${missing.join(', ')}.`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The unit files
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const ID_OPEN = /\bid:\s*(['"`])([^'"`]+)\1/g;

/**
 * `source` with the `seconds` of the unit `id` set to `seconds`, and no other character changed: the first line `seconds: <digits>` after the unit's `id:` and before the next unit's. It throws when the unit or its `seconds` is not
 * there, or when its `seconds` line is not a plain number (it is then somebody's expression, and not for this script to rewrite).
 */
export function setSeconds(source, id, seconds) {
  const ids = [...source.matchAll(ID_OPEN)];
  const at = ids.findIndex((match) => match[2] === id);
  if (at === -1) throw new Error(`no unit "${id}"`);
  const from = ids[at].index + ids[at][0].length;
  const to = at + 1 < ids.length ? ids[at + 1].index : source.length;
  const slice = source.slice(from, to);
  // The field is a line of its own in a unit file (`    seconds: 154, // note`): a `seconds:` in a name, a string or a comment is not it.
  const line = /^[ \t]*seconds:.*$/m.exec(slice);
  if (line === null) throw new Error(`the unit "${id}" has no \`seconds\` line`);
  const plain = /^([ \t]*seconds:[ \t]*)(\d+)(?=[ \t]*(?:,|\}|\/\/|$))/.exec(line[0]);
  if (plain === null) throw new Error(`the unit "${id}" has no \`seconds\` that is a plain whole number: ${line[0].trim()}`);
  const field = { index: line.index, 0: plain[0], 1: plain[1], 2: plain[2] };
  const start = from + field.index + field[1].length;
  return `${source.slice(0, start)}${seconds}${source.slice(start + field[2].length)}`;
}

/** Writes each proposal that differs from the listed value into its unit file under `root`; returns `[{ id, file, from, to }]`. */
export function writeProposals(rows, root) {
  const changed = [];
  const byFile = new Map();
  for (const row of rows) {
    if (!row.enough || row.proposed === row.listed) continue;
    byFile.set(row.file, [...(byFile.get(row.file) ?? []), row]);
  }
  for (const [file, list] of byFile) {
    const full = path.join(root, file);
    let source = readFileSync(full, 'utf8');
    for (const row of list) {
      source = setSeconds(source, row.id, row.proposed);
      changed.push({ id: row.id, file, from: row.listed, to: row.proposed });
    }
    writeFileSync(full, source);
  }
  return changed;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The runs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Runs `gh` with these arguments and resolves with its standard output; rejects with its standard error. */
export function gh(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(`gh ${args.join(' ')}: ${Buffer.concat(err).toString('utf8').trim().split('\n')[0]}`))));
  });
}

/** Runs `task(item)` for every item, `width` at a time; resolves with the results in order. */
export async function pooled(items, width, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const mine = next;
      next += 1;
      results[mine] = await task(items[mine], mine);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return results;
}

/**
 * The samples of the last `runs` successful runs: `{ samples: Map<unit, number[]>, runs, jobs, skipped }`. Every attempt of each run is read (a shard that failed its drift and passed on the re-run gave a sample, the slowest), each
 * shard job once (a re-run that kept a job leaves it in the later attempt under the same id). A job that ended neither green nor red (cancelled, skipped) has no log of units and is not read. `ask(args)` is `gh`.
 */
export async function collect({ ask = gh, runs = DEFAULT_RUNS, workflow = DEFAULT_WORKFLOW, repo = '{owner}/{repo}', cache, width = 6, failed = false } = {}) {
  const list = async (status) => JSON.parse(await ask(['run', 'list', '--workflow', workflow, '--status', status, '--limit', String(runs), '--json', 'databaseId,attempt', ...(repo.startsWith('{') ? [] : ['--repo', repo])]));
  // A run that failed is read too when asked: a shard that failed its drift check or a probe of another unit still printed the seconds of the units that passed.
  const listed = [...new Map([...(await list('success')), ...(failed ? await list('failure') : [])].map((run) => [run.databaseId, run])).values()];
  const attempts = listed.flatMap((run) => Array.from({ length: run.attempt }, (_, index) => ({ run: run.databaseId, attempt: index + 1 })));
  const jobLists = await pooled(attempts, width, async ({ run, attempt }) => {
    const text = await ask(['api', `repos/${repo}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`, '--jq', '[.jobs[] | select(.name | startswith("Kit probes shard ")) | select(.conclusion == "success" or .conclusion == "failure") | .id]']);
    return JSON.parse(text);
  });
  const jobs = [...new Set(jobLists.flat())];
  const samples = new Map();
  let skipped = 0;
  if (cache !== undefined) mkdirSync(cache, { recursive: true });
  await pooled(jobs, width, async (job) => {
    const file = cache === undefined ? undefined : path.join(cache, `${job}.json`);
    let rows;
    if (file !== undefined && existsSync(file)) rows = JSON.parse(readFileSync(file, 'utf8'));
    else {
      rows = parseUnitSeconds(await ask(['api', '--allow-escape-sequences', `repos/${repo}/actions/jobs/${job}/logs`]));
      if (file !== undefined) writeFileSync(file, JSON.stringify(rows));
    }
    if (rows.length === 0) skipped += 1;
    for (const row of rows) samples.set(row.unit, [...(samples.get(row.unit) ?? []), row.seconds]);
  });
  return { samples, runs: listed.length, jobs: jobs.length, skipped };
}

/** The samples of shard logs saved as files under `dir`, at any depth. */
export function collectFiles(dir) {
  const samples = new Map();
  let jobs = 0;
  let skipped = 0;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        jobs += 1;
        const rows = parseUnitSeconds(readFileSync(file, 'utf8'));
        if (rows.length === 0) skipped += 1;
        for (const row of rows) samples.set(row.unit, [...(samples.get(row.unit) ?? []), row.seconds]);
      }
    }
  };
  walk(dir);
  return { samples, runs: undefined, jobs, skipped };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const USAGE = 'usage: node scripts/ci/probe-seconds.mjs [--runs <n>] [--workflow <file>] [--repo <owner/name>] [--logs <dir>] [--cache <dir>] [--min-samples <n>] [--few-samples skip|max] [--with-failed] [--keep <id,id>] [--write] [--root <dir>]';

export async function main(argv = process.argv.slice(2), { out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text), ask = gh } = {}) {
  const options = { runs: DEFAULT_RUNS, workflow: DEFAULT_WORKFLOW, repo: '{owner}/{repo}', minSamples: DEFAULT_MIN_SAMPLES, keep: [], few: 'skip', failed: false, write: false, root: REPO_ROOT, logs: undefined, cache: undefined };
  const wholeNumber = (text) => (/^[1-9]\d*$/.test(text ?? '') ? Number(text) : null);
  for (let i = 0; i < argv.length; i += 1) {
    const word = argv[i];
    const value = argv[i + 1];
    if (word === '--write') options.write = true;
    else if (word === '--with-failed') options.failed = true;
    else if (word === '--runs' || word === '--min-samples') {
      const n = wholeNumber(value);
      if (n === null) {
        err(`probe-seconds: ${word} needs a whole number above 0\n${USAGE}\n`);
        return 2;
      }
      options[word === '--runs' ? 'runs' : 'minSamples'] = n;
      i += 1;
    } else if (word === '--few-samples' && (value === 'skip' || value === 'max')) {
      options.few = value;
      i += 1;
    } else if (word === '--keep' && value !== undefined) {
      options.keep = value.split(',').filter((id) => id !== '');
      i += 1;
    } else if (['--workflow', '--repo', '--logs', '--cache', '--root'].includes(word) && value !== undefined) {
      options[word.slice(2)] = word === '--root' ? path.resolve(value) : value;
      i += 1;
    } else {
      err(`probe-seconds: unknown or incomplete argument ${word}\n${USAGE}\n`);
      return 2;
    }
  }

  const loaded = await loadUnits(options.root);
  if (loaded.problems.length > 0) {
    for (const problem of loaded.problems) err(`probe-seconds: ${problem.message}\n`);
    return 1;
  }
  let data;
  try {
    data = options.logs === undefined ? await collect({ ask, runs: options.runs, workflow: options.workflow, repo: options.repo, cache: options.cache, failed: options.failed }) : collectFiles(path.resolve(options.logs));
  } catch (error) {
    err(`probe-seconds: ${error.message.split('\n')[0]}\n`);
    return 1;
  }
  const known = new Set(loaded.units.map((unit) => unit.id));
  const missing = [...data.samples.keys()].filter((id) => !known.has(id)).sort();
  const unknownKeep = options.keep.filter((id) => !known.has(id));
  if (unknownKeep.length > 0) {
    err(`probe-seconds: --keep names no unit: ${unknownKeep.join(', ')}\n`);
    return 2;
  }
  const rows = analyse({ units: loaded.units, samples: data.samples, minSamples: options.minSamples, keep: options.keep, few: options.few });
  out(render(rows, { runs: data.runs, jobs: data.jobs, skipped: data.skipped, missing }));
  if (options.write) {
    const changed = writeProposals(rows, options.root);
    out(`\n${changed.length === 0 ? 'Nothing to write: every listed value is the proposal.' : `Wrote ${changed.length} unit${changed.length === 1 ? '' : 's'}: ${changed.map((entry) => `${entry.id} ${entry.from} -> ${entry.to}`).join(', ')}.`}\n`);
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

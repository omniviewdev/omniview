// The seconds of the probe units from the runner's logs (scripts/ci/probe-seconds.mjs): the log table is read by unit id, the statistics and the proposal are what the comment says, the threshold is the engine's own, and `--write`
// changes the `seconds` of a unit and nothing else in a unit file. No installed dependency and no network is needed: GitHub is a stand-in `ask`.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { DRIFT_FLOOR_SECONDS, DRIFT_RATIO, REPO_ROOT, driftFindings, loadUnits, renderDrift } from './probe-shards.mjs';
import { ROUND_SECONDS, analyse, collect, collectFiles, main, parseUnitSeconds, pooled, proposeSeconds, quantile, render, setSeconds, summarise, thresholdOf, writeProposals } from './probe-seconds.mjs';

const stamp = '2026-11-23T01:34:16.3408232Z ';
/** A shard log as the runner prints it: noise, the Result table, then the drift table of the engine itself (`renderDrift`). */
const log = (shard, rows) =>
  [
    `${stamp}##[group]Run node scripts/ci/probe-shards.mjs run`,
    `${stamp}### Kit probes shard ${shard}: 2 runs, all passed, 40 s`,
    `${stamp}| Result | Seconds | Probe | Negative control | Step |`,
    `${stamp}|---|--:|---|---|---|`,
    `${stamp}| pass | 27 | ui-next/shell/probes/logs-probe.mjs | toolbar-moved | Probe that the logs probe sees a toolbar that is wrong |`,
    `${stamp}`,
    ...renderDrift(shard, rows, { took: 408, planned: 427, ceiling: 614, units: rows.length })
      .split('\n')
      .map((line) => `${stamp}${line}`),
    `${stamp}##[group]Run actions/upload-artifact@v4`,
  ].join('\n');
const row = (id, table, took) => ({ id, table, took, delta: took - table, verdict: 'ok' });

test('parseUnitSeconds reads the drift table of the engine, by unit id, from a log with timestamps', () => {
  const text = log(9, [row('logs-controls-toolbar', 212, 227), row('settings-controls-perf', 180, 146), row('fonts', 35, 35)]);
  assert.deepEqual(parseUnitSeconds(text), [
    { unit: 'logs-controls-toolbar', seconds: 227, shard: 9 },
    { unit: 'settings-controls-perf', seconds: 146, shard: 9 },
    { unit: 'fonts', seconds: 35, shard: 9 },
  ]);
});

test('parseUnitSeconds reads the real output of renderDrift: over and under rows, a unit id with a dot and a digit', () => {
  const rows = [{ ...row('a.b-1', 100, 190), verdict: 'slower' }, { ...row('c', 200, 100), verdict: 'faster' }];
  assert.deepEqual(
    parseUnitSeconds(log(2, rows)).map((entry) => [entry.unit, entry.seconds]),
    [['a.b-1', 190], ['c', 100]],
  );
});

test('parseUnitSeconds takes the "This run" column and not the table\'s, ignores the Result table, colour escapes and CRLF, and reads several shards of one text', () => {
  const text = `${log(1, [row('x', 50, 61)])}\r\n${log(2, [row('y', 10, 12)])}`.replaceAll('| x |', '\u001b[0m| x |');
  assert.deepEqual(
    parseUnitSeconds(text).map((entry) => [entry.shard, entry.unit, entry.seconds]),
    [[1, 'x', 61], [2, 'y', 12]],
  );
});

test('parseUnitSeconds gives nothing for a log with no drift table (a run before N25, a shard that never ran its units) and for a Result table alone', () => {
  assert.deepEqual(parseUnitSeconds(''), []);
  assert.deepEqual(parseUnitSeconds(`${stamp}| Result | Seconds | Probe | Negative control | Step |\n${stamp}| pass | 27 | a.mjs |  | Step |`), []);
  assert.deepEqual(parseUnitSeconds(`${stamp}#### Kit probes shard 3: seconds against the table\n${stamp}\n${stamp}| Unit | Table s | This run s | Difference | |\n${stamp}|---|--:|--:|--:|---|\n${stamp}| fonts | 35 | 36 | 1 |  |\n${stamp}\n${stamp}| late | 1 | 2 | 1 |  |`), [{ unit: 'fonts', seconds: 36, shard: 3 }], 'a blank line after the rows ends the table');
});

test('quantile interpolates between ranks and is the max at 1 and the min at 0', () => {
  assert.equal(quantile([5], 0.95), 5);
  assert.equal(quantile([1, 2], 0.5), 1.5);
  assert.equal(quantile([3, 1, 2], 0.5), 2, 'unsorted input');
  assert.equal(quantile([1, 2, 3, 4], 0), 1);
  assert.equal(quantile([1, 2, 3, 4], 1), 4);
  assert.equal(quantile(Array.from({ length: 21 }, (_, i) => i), 0.95), 19);
  assert.throws(() => quantile([], 0.5));
});

test('summarise: samples, min, median, p95, max; no samples is samples 0', () => {
  const values = Array.from({ length: 21 }, (_, i) => 100 + i);
  assert.deepEqual(summarise(values), { samples: 21, min: 100, median: 110, p95: 119, max: 120 });
  assert.deepEqual(summarise([]), { samples: 0 });
});

test('proposeSeconds: the 95th percentile rounded UP to 5 s, a multiple stays, and never under 5', () => {
  assert.equal(proposeSeconds(113), 115);
  assert.equal(proposeSeconds(115), 115);
  assert.equal(proposeSeconds(115.0001), 120);
  assert.equal(proposeSeconds(168.4), 170);
  assert.equal(proposeSeconds(1.2), 5);
  assert.equal(proposeSeconds(0), 5);
});

test('thresholdOf is the engine\'s own: seconds plus the larger of a quarter and 60 s (checked against driftFindings at its boundary)', () => {
  assert.equal(DRIFT_RATIO, 0.25);
  assert.equal(DRIFT_FLOOR_SECONDS, 60);
  assert.equal(thresholdOf(20), 80);
  assert.equal(thresholdOf(113), 173);
  assert.equal(thresholdOf(240), 300);
  assert.equal(thresholdOf(400), 500);
  for (const seconds of [2, 20, 113, 240, 241, 400]) {
    const limit = thresholdOf(seconds);
    const units = [{ id: 'u', name: 'U', file: 'f.mjs', seconds }];
    const at = driftFindings(1, [{ unit: 'u', ok: true, seconds: Math.floor(limit) }], units);
    const over = driftFindings(1, [{ unit: 'u', ok: true, seconds: Math.floor(limit) + 1 }], units);
    assert.equal(at.failures.length, 0, `${seconds} s passes at ${limit}`);
    assert.equal(over.failures.length, 1, `${seconds} s fails over ${limit}`);
  }
});

const unit = (id, seconds, file = 'scripts/ci/probe-units/x.mjs') => ({ id, seconds, file });

test('analyse: the statistics, the proposal, both thresholds and the headroom of the max, in the table\'s order', () => {
  const samples = new Map([['a', [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 174]]]);
  const [a] = analyse({ units: [unit('a', 113)], samples });
  assert.equal(a.samples, 21);
  assert.equal(a.max, 174);
  assert.equal(a.listed, 113);
  assert.equal(a.thresholdListed, 173);
  assert.equal(a.headroomListed, -1, 'the PR #658 case: 174 s against a limit of 173');
  assert.equal(a.failedListed, true);
  assert.equal(a.nearListed, true);
  assert.equal(a.proposed, proposeSeconds(a.p95));
  assert.equal(a.headroomProposed, a.thresholdProposed - 174);
});

test('analyse: a unit with fewer samples than the least is kept at its listed value; one with none has no statistics', () => {
  const rows = analyse({ units: [unit('a', 50), unit('b', 60), unit('c', 70)], samples: new Map([['a', [200, 200, 200]], ['b', [61, 62, 63, 64, 65]]]), minSamples: 5 });
  assert.equal(rows[0].proposed, 50);
  assert.equal(rows[0].enough, false);
  assert.equal(rows[1].proposed, 65);
  assert.equal(rows[1].enough, true);
  assert.equal(rows[2].samples, 0);
  assert.equal(rows[2].proposed, 70);
  assert.equal(rows[2].near, undefined);
});

test('analyse: a kept unit is printed with its statistics and never proposed or written', () => {
  const samples = new Map([['a', [200, 200, 200, 200, 200, 200]], ['b', [200, 200, 200, 200, 200, 200]]]);
  const rows = analyse({ units: [unit('a', 24), unit('b', 36)], samples, keep: ['a'] });
  assert.equal(rows[0].kept, true);
  assert.equal(rows[0].proposed, 24);
  assert.equal(rows[0].samples, 6);
  assert.equal(rows[1].proposed, 200);
  assert.match(render(rows), /\| a \| 6 \| 200 \| 200 \| 200 \| 200 \| 24 \| 24 \(kept\)/);
  assert.equal(rows[0].enough, false, 'writeProposals skips a row that is not enough');
  assert.equal(rows[1].enough, true);
});

test('analyse: near is true when the max is within 10 percent of the threshold of the proposed value, and not at the line', () => {
  // proposed 100 -> limit 160; 0.9 x 160 = 144.
  const base = Array.from({ length: 99 }, () => 100);
  const at144 = analyse({ units: [unit('a', 100)], samples: new Map([['a', [...base, 144]]]) })[0];
  const over = analyse({ units: [unit('a', 100)], samples: new Map([['a', [...base, 145]]]) })[0];
  assert.equal(at144.proposed, 100);
  assert.equal(at144.near, false, '144 is exactly 90 percent: not within');
  assert.equal(over.near, true);
});

test('render: a row for every unit with its numbers, the total, the units over or near their threshold, and the samples of units the table does not have', () => {
  const rows = analyse({ units: [unit('a', 113), unit('b', 100), unit('c', 5)], samples: new Map([['a', [100, 101, 102, 103, 174]], ['b', [90, 91, 92, 93, 94]]]), minSamples: 5 });
  const text = render(rows, { runs: 30, jobs: 12, skipped: 2, missing: ['gone'] });
  assert.match(text, /Read 12 shard logs of 30 runs \(2 without the table of seconds: ignored\)/);
  assert.match(text, /\| a \| 5 \| 100 \| 102 \| /);
  assert.match(text, /\| c \| 0 \|/);
  assert.match(text, /Over their failure threshold at least once with the listed value: a \(max 174 s, limit 173 s\)/);
  assert.match(text, /Samples for units that are not in the table \(ignored\): gone/);
  assert.match(text, /Listed seconds of all units: 218; proposed: /);
});

const FILE = `// header comment: seconds: 999
export const units = [
  {
    id: 'one',
    name: 'The first, seconds: 5 in a name',
    script: 'a.mjs',
    env: { A: '1' },
    seconds: 154, // the runner's, run 44929041191
  },

  // seconds: 7 in a comment before the second
  {
    id: "two",
    name: 'The second',
    script: 'a.mjs',
    controls: ['x', 'y'],
    seconds:    113,
  },
];
`;

test('setSeconds changes the digits of one unit\'s `seconds` and not one other character', () => {
  const next = setSeconds(FILE, 'two', 120);
  assert.equal(next, FILE.replace('seconds:    113,', 'seconds:    120,'));
  const first = setSeconds(FILE, 'one', 5);
  assert.equal(first, FILE.replace('seconds: 154, //', 'seconds: 5, //'));
  assert.equal(setSeconds(FILE, 'one', 154), FILE, 'the same value is the same text');
});

test('setSeconds throws for a unit that is not there, for one with no plain number, and does not take the next unit\'s seconds', () => {
  assert.throws(() => setSeconds(FILE, 'three', 1), /no unit "three"/);
  assert.throws(() => setSeconds("export const units = [\n{\n id: 'a',\n seconds: 10 * 2,\n},\n];", 'a', 5), /plain whole number/);
  assert.throws(() => setSeconds("export const units = [\n{\n id: 'a',\n seconds: 1.5,\n},\n];", 'a', 5), /plain whole number/);
  assert.throws(() => setSeconds("export const units = [\n{\n id: 'a',\n seconds: SECONDS,\n},\n];", 'a', 5), /plain whole number/);
  assert.throws(() => setSeconds("export const units = [\n{\n id: 'a',\n name: 'x',\n},\n{\n id: 'b',\n seconds: 9,\n},\n];", 'a', 5), /no `seconds` line/);
});

/** A copy of the real unit directory in a temporary tree, to be written to. */
function copyOfTheTable() {
  const root = mkdtempSync(path.join(tmpdir(), 'probe-seconds-'));
  mkdirSync(path.join(root, 'scripts/ci'), { recursive: true });
  cpSync(path.join(REPO_ROOT, 'scripts/ci/probe-units'), path.join(root, 'scripts/ci/probe-units'), { recursive: true });
  return root;
}
const readUnitFiles = (root) => Object.fromEntries(readdirSync(path.join(root, 'scripts/ci/probe-units')).map((name) => [name, readFileSync(path.join(root, 'scripts/ci/probe-units', name), 'utf8')]));

test('writeProposals on a copy of the real table changes the seconds of the units it names and nothing else, in every unit file', async () => {
  const root = copyOfTheTable();
  const before = readUnitFiles(root);
  const { units } = await loadUnits(root);
  assert.ok(units.length > 30);
  // Every unit gets samples that propose 7 s over its listed value, so every file is written, including the ones with two units.
  const samples = new Map(units.map((entry) => [entry.id, Array.from({ length: 10 }, () => entry.seconds + 6)]));
  const rows = analyse({ units, samples });
  const changed = writeProposals(rows, root);
  assert.equal(changed.length, units.length);
  const after = readUnitFiles(root);
  // (the units are read from the text: a module that was imported once is not imported again from the same path)
  const written = new Map();
  for (const text of Object.values(after)) {
    const ids = [...text.matchAll(/^[ \t]*id: '([^']+)'/gm)].map((match) => match[1]);
    const values = [...text.matchAll(/^[ \t]*seconds: (\d+)/gm)].map((match) => Number(match[1]));
    assert.equal(ids.length, values.length);
    ids.forEach((id, index) => written.set(id, values[index]));
  }
  assert.equal(written.size, units.length);
  for (const entry of units) assert.equal(written.get(entry.id), proposeSeconds(entry.seconds + 6), entry.id);
  for (const [name, text] of Object.entries(before)) {
    const strip = (source) => source.replace(/(\bseconds:\s*)\d+/g, '$1N');
    assert.equal(strip(after[name]), strip(text), `${name}: only seconds changed`);
  }
});

test('writeProposals writes only a unit with enough samples whose proposal differs, and leaves a file it has nothing for as it was', async () => {
  const root = copyOfTheTable();
  const before = readUnitFiles(root);
  const { units } = await loadUnits(root);
  const target = units.find((entry) => entry.id === 'palette-plugins-controls');
  const settled = units.find((entry) => entry.seconds % ROUND_SECONDS === 0 && entry.file !== target.file && entry.id !== 'detail');
  const value = target.seconds + 12;
  const rows = analyse({
    units,
    samples: new Map([
      [target.id, Array.from({ length: 10 }, () => value)],
      ['detail', [1, 1, 1]],
      [settled.id, Array.from({ length: 10 }, () => settled.seconds)],
    ]),
  });
  const changed = writeProposals(rows, root);
  assert.deepEqual(changed, [{ id: target.id, file: target.file, from: target.seconds, to: proposeSeconds(value) }]);
  const after = readUnitFiles(root);
  const name = path.basename(target.file);
  for (const file of Object.keys(before)) {
    if (file === name) assert.equal(after[file], before[file].replace(`seconds: ${target.seconds},`, `seconds: ${proposeSeconds(value)},`));
    else assert.equal(after[file], before[file], file);
  }
});

const jobsOf = { 'runs/10/attempts/1': [101, 102], 'runs/10/attempts/2': [102, 103], 'runs/11/attempts/1': [201] };
const logOf = { 101: log(1, [row('a', 10, 12)]), 102: log(2, [row('b', 10, 30)]), 103: log(2, [row('b', 10, 14)]), 201: '2026-01-01T00:00:00Z nothing here' };

/** A stand-in for `gh`: the run list, the jobs of an attempt and a job's log. */
function fakeGh(calls = []) {
  return async (args) => {
    calls.push(args);
    if (args[0] === 'run') return JSON.stringify([{ databaseId: 10, attempt: 2 }, { databaseId: 11, attempt: 1 }]);
    const url = args.find((arg) => arg.startsWith('repos/'));
    const jobs = /runs\/(\d+)\/attempts\/(\d+)\/jobs/.exec(url);
    if (jobs) return JSON.stringify(jobsOf[`runs/${jobs[1]}/attempts/${jobs[2]}`]);
    const job = /jobs\/(\d+)\/logs/.exec(url);
    return logOf[job[1]];
  };
}

test('collect reads every attempt of every run once per job, asks for the successful runs of the workflow, and counts logs without the table', async () => {
  const calls = [];
  const result = await collect({ ask: fakeGh(calls), runs: 2, workflow: 'w.yml' });
  assert.deepEqual(calls[0].slice(0, 8), ['run', 'list', '--workflow', 'w.yml', '--status', 'success', '--limit', '2']);
  assert.deepEqual([...result.samples.entries()].map(([id, values]) => [id, values.sort((x, y) => x - y)]).sort(), [['a', [12]], ['b', [14, 30]]]);
  assert.equal(result.runs, 2);
  assert.equal(result.jobs, 4, 'job 102 is in two attempts and is read once');
  assert.equal(result.skipped, 1);
  assert.equal(calls.filter((args) => args.some((arg) => /jobs\/102\/logs/.test(arg))).length, 1);
  for (const args of calls.filter((entry) => entry[0] === 'api' && /logs/.test(entry.join(' ')))) assert.ok(args.includes('--allow-escape-sequences'));
});

test('collect with a cache asks for each job log once, across calls', async () => {
  const cache = path.join(mkdtempSync(path.join(tmpdir(), 'probe-seconds-cache-')), 'c');
  const first = [];
  const second = [];
  const one = await collect({ ask: fakeGh(first), runs: 2, cache });
  const two = await collect({ ask: fakeGh(second), runs: 2, cache });
  assert.equal(second.filter((args) => args.some((arg) => /\/logs$/.test(arg))).length, 0);
  assert.deepEqual([...two.samples].sort(), [...one.samples].sort());
  assert.equal(two.skipped, 1);
});

test('collect: a failed `gh` is an error with its first line', async () => {
  await assert.rejects(collect({ ask: async () => { throw new Error('gh run list: HTTP 401'); } }), /HTTP 401/);
});

test('pooled runs every item, keeps the order of the results and never exceeds its width', async () => {
  let live = 0;
  let most = 0;
  const results = await pooled([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
    live += 1;
    most = Math.max(most, live);
    await new Promise((resolve) => setTimeout(resolve, n));
    live -= 1;
    return n * 2;
  });
  assert.deepEqual(results, [10, 2, 8, 4, 6, 12, 14]);
  assert.ok(most <= 3 && most >= 2);
});

test('collectFiles reads saved logs at any depth', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'probe-seconds-logs-'));
  mkdirSync(path.join(dir, 'deep/er'), { recursive: true });
  writeFileSync(path.join(dir, 'one.txt'), log(1, [row('a', 10, 12)]));
  writeFileSync(path.join(dir, 'deep/er/two.log'), log(2, [row('a', 10, 20), row('b', 5, 6)]));
  writeFileSync(path.join(dir, 'empty.txt'), 'nothing');
  const result = collectFiles(dir);
  assert.deepEqual(result.samples.get('a').sort(), [12, 20]);
  assert.deepEqual(result.samples.get('b'), [6]);
  assert.equal(result.jobs, 3);
  assert.equal(result.skipped, 1);
});

test('main: prints the table, writes only with --write, and says what it wrote', async () => {
  const root = copyOfTheTable();
  const before = readUnitFiles(root);
  const logs = mkdtempSync(path.join(tmpdir(), 'probe-seconds-main-'));
  const { units } = await loadUnits(root);
  const target = units.find((entry) => entry.id === 'tooltip');
  const slow = target.seconds + 56;
  writeFileSync(path.join(logs, 'a.txt'), Array.from({ length: 6 }, () => log(1, [row('tooltip', target.seconds, slow)])).join('\n'));
  let text = '';
  const out = (chunk) => { text += chunk; };
  assert.equal(await main(['--root', root, '--logs', logs], { out }), 0);
  assert.match(text, new RegExp(`\\| tooltip \\| 6 \\| ${slow} \\| ${slow} \\| ${slow} \\| ${slow} \\| ${target.seconds} \\| ${proposeSeconds(slow)} \\|`));
  assert.doesNotMatch(text, /Wrote/);
  assert.deepEqual(readUnitFiles(root), before, 'nothing is written without --write');
  text = '';
  assert.equal(await main(['--root', root, '--logs', logs, '--write'], { out }), 0);
  assert.match(text, new RegExp(`Wrote 1 unit: tooltip ${target.seconds} -> ${proposeSeconds(slow)}\\.`));
  assert.equal(readUnitFiles(root)['tooltip.mjs'], before['tooltip.mjs'].replace(`seconds: ${target.seconds},`, `seconds: ${proposeSeconds(slow)},`));
  // Nothing to write when every proposal is what the file lists (a unit that lists a multiple of 5, with samples of exactly that).
  const settled = units.find((entry) => entry.seconds % ROUND_SECONDS === 0 && entry.id !== 'tooltip');
  const same = mkdtempSync(path.join(tmpdir(), 'probe-seconds-same-'));
  writeFileSync(path.join(same, 'a.txt'), Array.from({ length: 6 }, () => log(1, [row(settled.id, settled.seconds, settled.seconds)])).join('\n'));
  text = '';
  assert.equal(await main(['--root', root, '--logs', same, '--write'], { out }), 0);
  assert.match(text, /Nothing to write/);
});

test('main: a bad argument is exit 2 with the usage, and a table that does not load is exit 1', async () => {
  let text = '';
  const err = (chunk) => { text += chunk; };
  assert.equal(await main(['--runs', '0'], { err }), 2);
  assert.equal(await main(['--runs', 'many'], { err }), 2);
  assert.equal(await main(['--nope'], { err }), 2);
  assert.equal(await main(['--logs', mkdtempSync(path.join(tmpdir(), 'probe-seconds-keep-')), '--keep', 'no-such-unit'], { err }), 2);
  assert.match(text, /--keep names no unit: no-such-unit/);
  assert.equal(await main(['--logs'], { err }), 2);
  assert.match(text, /usage: node scripts\/ci\/probe-seconds\.mjs/);
  const empty = mkdtempSync(path.join(tmpdir(), 'probe-seconds-empty-'));
  assert.equal(await main(['--root', empty, '--logs', empty], { err }), 1);
});

test('main: runs and the cache go to collect (a stand-in gh), and the real table is read', async () => {
  const calls = [];
  let text = '';
  assert.equal(await main(['--runs', '2', '--workflow', 'w.yml', '--min-samples', '1'], { out: (chunk) => { text += chunk; }, ask: fakeGh(calls) }), 0);
  assert.deepEqual(calls[0].slice(0, 8), ['run', 'list', '--workflow', 'w.yml', '--status', 'success', '--limit', '2']);
  assert.match(text, /Read 4 shard logs of 2 runs/);
  assert.match(text, /Samples for units that are not in the table \(ignored\): a, b/);
});

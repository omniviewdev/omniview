// The shard table of the kit probes (scripts/ci/probe-shards.mjs): the completeness check that makes a forgotten probe impossible, the runner that executes one shard, and the contract of
// the workflow that fans the shards out (.github/workflows/ui-next-kit-probes.yml), including the job named `Kit probes` that is red unless every shard is green.
//
// Every "negative control" below feeds a check the mistake it exists for and asserts the check names it; each was also seen to go red with its check taken out (docs/ui-next/status/N24-K1.md).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import {
  BY_HAND,
  PROBE_DIRS,
  TABLE,
  WORKFLOW,
  checkTable,
  expandUnit,
  findProbeScripts,
  isProbeScript,
  planShard,
  readWorkflowShards,
  renderSummary,
  runShard,
} from './probe-shards.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const command = fileURLToPath(new URL('./probe-shards.mjs', import.meta.url));
const workflowText = readFileSync(path.join(repo, WORKFLOW), 'utf8');
const workflow = parse(workflowText);

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A scratch directory with `files` (path -> text) under it. */
function scratch(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'probe-shards-'));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const unit = (name, script, extra = {}) => ({ name, script, ...extra });

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What a probe script is, and where they are looked for
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('a probe script is a script named <thing>-probe, with or without a suffix; the libraries, tools and references of the directories are not', () => {
  for (const file of ['packages/kit/probes/fonts-probe.mjs', 'packages/kit/probes/kit-probe-bc.mjs', 'ui-next/shell/probes/palette-probe.mjs', 'ui-next/page/probes/new-thing-probe.mjs', 'ui-next/page/probes/x-probe.mts']) {
    assert.equal(isProbeScript(file), true, file);
  }
  for (const file of ['packages/kit/probes/probe-lib.mjs', 'ui-next/shell/probes/palette-perf.mjs', 'ui-next/shell/probes/harness.mjs', 'packages/kit/probes/mock-measure.mjs', 'packages/kit/probes/log-shots.mjs', 'packages/kit/probes/kit-probe.json', 'ui-next/shell/probes/fixture.tsx', 'ui-next/shell/probes/palette-fixture.html']) {
    assert.equal(isProbeScript(file), false, file);
  }
});

test('the probe scripts of the probe directories are found, nested ones too, and node_modules is not read', () => {
  const root = scratch({
    'packages/kit/probes/a-probe.mjs': '',
    'packages/kit/probes/probe-lib.mjs': '',
    'ui-next/shell/probes/b-probe.mjs': '',
    'ui-next/shell/probes/deeper/c-probe.mjs': '',
    'ui-next/shell/probes/node_modules/dep/d-probe.mjs': '',
    'ui-next/page/probes/e-probe.mjs': '',
    'ui-next/page/other/f-probe.mjs': '',
  });
  assert.deepEqual(findProbeScripts(root), ['packages/kit/probes/a-probe.mjs', 'ui-next/page/probes/e-probe.mjs', 'ui-next/shell/probes/b-probe.mjs', 'ui-next/shell/probes/deeper/c-probe.mjs']);
});

test('negative control: a probe directory that is gone is an error that names it, not an empty scan that finds nothing to complain about', () => {
  const root = scratch({ 'packages/kit/probes/a-probe.mjs': '', 'ui-next/page/probes/e-probe.mjs': '' });
  assert.throws(() => findProbeScripts(root), /ui-next\/shell\/probes/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The completeness check, on a small table
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const small = () => ({
  shards: [
    {
      id: '1',
      units: [
        unit('Probe a', 'packages/kit/probes/a-probe.mjs', { env: { REPORT: '$RUNNER_TEMP/a-probe.json' } }),
        unit('Probe that a sees', 'packages/kit/probes/a-probe.mjs', { controls: ['x', 'y'] }),
      ],
    },
    { id: '2', units: [unit('Probe b', 'ui-next/shell/probes/b-probe.mjs')] },
  ],
  byHand: [{ script: 'ui-next/page/probes/c-probe.mjs', reason: 'run by hand' }],
});
const FOUND = ['packages/kit/probes/a-probe.mjs', 'ui-next/shell/probes/b-probe.mjs', 'ui-next/page/probes/c-probe.mjs'];
const check = (changes = {}) => checkTable({ table: small(), found: FOUND, exists: () => true, workflowShards: ['1', '2'], ...changes });
const messages = (problems) => problems.map((problem) => problem.message);

test('a complete table has no problem', () => {
  assert.deepEqual(check(), []);
});

test('negative control: a probe file that is in no shard fails the check and the message names the file', () => {
  const problems = check({ found: [...FOUND, 'ui-next/shell/probes/new-probe.mjs'] });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, 'ui-next/shell/probes/new-probe.mjs');
  assert.match(problems[0].message, /ui-next\/shell\/probes\/new-probe\.mjs is a probe script and no shard runs it/);
  assert.match(problems[0].message, /BY_HAND/);
});

test('negative control: a probe file that only a by-hand entry names is still run by nobody in CI, and a by-hand entry cannot hide a probe a shard runs', () => {
  assert.deepEqual(check(), []);
  const both = small();
  both.byHand.push({ script: 'ui-next/shell/probes/b-probe.mjs', reason: 'also by hand' });
  const problems = check({ table: both });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /ui-next\/shell\/probes\/b-probe\.mjs is run by shard 2 and listed in BY_HAND/);
});

test('negative control: the units of one probe in two shards fail the check: a probe runs with its negative controls in one shard', () => {
  const split = small();
  split.shards[1].units.push(split.shards[0].units.pop());
  const problems = check({ table: split });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, 'packages/kit/probes/a-probe.mjs');
  assert.match(problems[0].message, /packages\/kit\/probes\/a-probe\.mjs is run by shards 1 and 2/);
});

test('negative control: a unit whose script is gone fails the check and names the file, the unit and the shard', () => {
  const problems = check({ exists: (file) => file !== 'ui-next/shell/probes/b-probe.mjs' });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, 'ui-next/shell/probes/b-probe.mjs');
  assert.match(problems[0].message, /ui-next\/shell\/probes\/b-probe\.mjs is named by the unit "Probe b" of shard 2 but does not exist/);
});

test('negative control: a by-hand entry whose script is gone fails the check and names the file', () => {
  const problems = check({ exists: (file) => file !== 'ui-next/page/probes/c-probe.mjs' });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /ui-next\/page\/probes\/c-probe\.mjs is named by BY_HAND but does not exist/);
});

test('negative control: a unit name used twice fails the check (a step runs once), in one shard or in two', () => {
  const twice = small();
  twice.shards[0].units.push(unit('Probe b', 'packages/kit/probes/a-probe.mjs'));
  const problems = messages(check({ table: twice }));
  assert.ok(problems.some((message) => /the unit "Probe b" is in shards 1 and 2/.test(message)), problems.join('\n'));
  const same = small();
  same.shards[0].units.push(unit('Probe a', 'packages/kit/probes/a-probe.mjs'));
  assert.ok(messages(check({ table: same })).some((message) => /the unit "Probe a" is twice in shard 1/.test(message)));
});

test('negative control: a shard with no unit fails the check', () => {
  const empty = small();
  empty.shards.push({ id: '3', units: [] });
  const problems = messages(check({ table: empty, workflowShards: ['1', '2', '3'] }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /shard 3 has no unit/);
});

test('negative control: controls that would run the probe zero times, twice the same control, or a control set by hand in env fail the check', () => {
  const none = small();
  none.shards[0].units[1].controls = [];
  assert.match(messages(check({ table: none }))[0], /the unit "Probe that a sees" of shard 1 has an empty controls list/);
  const dup = small();
  dup.shards[0].units[1].controls = ['x', 'x'];
  assert.match(messages(check({ table: dup }))[0], /the unit "Probe that a sees" of shard 1 lists the control "x" twice/);
  const manual = small();
  manual.shards[0].units[1].env = { NEGATIVE_CONTROL: 'x' };
  assert.match(messages(check({ table: manual }))[0], /the unit "Probe that a sees" of shard 1 sets NEGATIVE_CONTROL in env/);
});

test('negative control: a unit without a name or a script fails the check', () => {
  const broken = small();
  broken.shards[1].units.push({ script: 'ui-next/shell/probes/b-probe.mjs' }, { name: 'No script' });
  const problems = messages(check({ table: broken }));
  assert.ok(problems.some((message) => /unit 2 of shard 2 has no name/.test(message)), problems.join('\n'));
  assert.ok(problems.some((message) => /the unit "No script" of shard 2 has no script/.test(message)), problems.join('\n'));
});

test('negative control: the workflow must run the shards of the table and no others: a shard the matrix lacks would never run, a shard the table lacks runs nothing', () => {
  const lacking = messages(check({ workflowShards: ['1'] }));
  assert.equal(lacking.length, 1);
  assert.match(lacking[0], /shard 2 is in the table but not in the matrix of \.github\/workflows\/ui-next-kit-probes\.yml: its probes would never run/);
  const extra = messages(check({ workflowShards: ['1', '2', '3'] }));
  assert.equal(extra.length, 1);
  assert.match(extra[0], /the matrix of \.github\/workflows\/ui-next-kit-probes\.yml has shard 3, which the table does not have/);
  const unreadable = messages(check({ workflowShards: null }));
  assert.equal(unreadable.length, 1);
  assert.match(unreadable[0], /cannot find the matrix line `shard: \[1, 2, \.\.\.\]`/);
});

test('the matrix line of the workflow is read as written: quoted or not, with a trailing comment; two matrix lines or none is not readable', () => {
  assert.deepEqual(readWorkflowShards('      matrix:\n        shard: [1, 2, 3]\n'), ['1', '2', '3']);
  assert.deepEqual(readWorkflowShards("        shard: ['a', \"b\"]   # two\n"), ['a', 'b']);
  assert.equal(readWorkflowShards('        # shard: [1, 2]\n        other: [1]\n'), null);
  assert.equal(readWorkflowShards('        shard: [1]\n        shard: [2]\n'), null);
  assert.equal(readWorkflowShards('        shard:\n          - 1\n'), null);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The real table, the real tree and the real workflow
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function readableFile(file) {
  try {
    readFileSync(path.join(repo, file));
    return true;
  } catch {
    return false;
  }
}

const realCheck = (table = TABLE, found = findProbeScripts(repo)) => checkTable({ table, found, exists: readableFile, workflowShards: readWorkflowShards(workflowText) });

test('every probe script under the probe directories runs in exactly one shard (or is listed as run by hand), and the workflow runs the shards of the table', () => {
  const found = findProbeScripts(repo);
  for (const file of ['packages/kit/probes/kit-probe.mjs', 'ui-next/shell/probes/palette-probe.mjs', 'ui-next/page/probes/detail-probe.mjs', 'ui-next/page/probes/page-probe.mjs']) {
    assert.ok(found.includes(file), `the scan of the probe directories found ${found.length} scripts and not ${file}`);
  }
  const problems = realCheck();
  assert.deepEqual(messages(problems), []);
  const owners = new Map();
  for (const shard of TABLE.shards) for (const { script } of shard.units) owners.set(script, new Set([...(owners.get(script) ?? []), shard.id]));
  for (const file of found) {
    const shards = owners.get(file)?.size ?? 0;
    const byHand = BY_HAND.some((entry) => entry.script === file) ? 1 : 0;
    assert.equal(shards + byHand, 1, `${file} runs in ${shards} shards and ${byHand} by-hand entries`);
  }
});

test('the probe directories are the three the probes live in', () => {
  assert.deepEqual([...PROBE_DIRS], ['packages/kit/probes', 'ui-next/shell/probes', 'ui-next/page/probes']);
});

// The steps of the workflow when it ran every probe in one job, as `.github/workflows/ui-next-kit-probes.yml` had them at the split (origin/main e6729b1d plus the step of #559, 16 steps). A step may gain env and
// controls; it may not lose any, and may not leave CI: deleting a line here is the change that says a probe left CI, and a reviewer reads it. `$PROBE_DIST` and `$RUNNER_TEMP` are the runner's.
const STEPS_AT_THE_SPLIT = [
  { name: 'Probe the parts against the pinned mock reference', script: 'packages/kit/probes/kit-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/kit-probe.json' } },
  { name: 'Probe the table against the pinned mock reference', script: 'packages/kit/probes/table-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/table-probe.json' } },
  { name: 'Probe the fonts and the layout shift', script: 'packages/kit/probes/fonts-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/fonts-probe.json' } },
  { name: 'Probe the tooltip host', script: 'packages/kit/probes/tooltip-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/tooltip-probe.json' } },
  { name: 'Probe the shell frame against the pinned mock reference', script: 'ui-next/shell/probes/shell-probe.mjs', env: { REPORT: '$RUNNER_TEMP/shell-probe.json' } },
  { name: 'Probe the tab strip, the page host and the load against the pinned mock reference', script: 'ui-next/shell/probes/strip-probe.mjs', env: { REPORT: '$RUNNER_TEMP/strip-probe.json' } },
  { name: 'Probe the rail against the pinned mock reference', script: 'ui-next/shell/probes/rail-probe.mjs', env: { REPORT: '$RUNNER_TEMP/rail-probe.json' } },
  { name: 'Probe the bottom panel against the pinned mock reference', script: 'ui-next/shell/probes/panel-probe.mjs', env: { REPORT: '$RUNNER_TEMP/panel-probe.json' } },
  { name: 'Probe that the panel probe sees a panel that is wrong', script: 'ui-next/shell/probes/panel-probe.mjs', controls: ['panel-height', 'session-gap', 'toggle', 'tab-padding', 'shift', 'root-write'] },
  { name: 'Probe the Logs tool in a real engine', script: 'ui-next/shell/probes/logs-probe.mjs', env: { REPORT: '$RUNNER_TEMP/logs-probe.json' } },
  { name: 'Probe that the logs probe sees a feed that stopped, a wrong source and a list that moved', script: 'ui-next/shell/probes/logs-probe.mjs', controls: ['feed-stopped', 'source-label', 'column-moves'] },
  { name: 'Probe the log view against the pinned mock reference', script: 'packages/kit/probes/log-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/log-probe.json' } },
  {
    name: 'Probe that the log probe sees a log view that is wrong',
    script: 'packages/kit/probes/log-probe.mjs',
    env: { DIST: '$PROBE_DIST' },
    controls: ['row-height', 'time-column', 'filter-shift', 'strip-height', 'copy', 'keys', 'axe', 'source-tip'],
  },
  { name: 'Probe the detail page against the pinned mock reference', script: 'ui-next/page/probes/detail-probe.mjs' },
  { name: 'Probe the command palette against the pinned mock reference', script: 'ui-next/shell/probes/palette-probe.mjs', env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/palette-probe.json' } },
  {
    name: 'Probe that the palette probe sees a palette that is wrong',
    script: 'ui-next/shell/probes/palette-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['frame-width', 'row-height', 'foot-height', 'search-place', 'foot-gap', 'paint', 'hover-steals', 'no-restore'],
  },
];

/** What the table lost of STEPS_AT_THE_SPLIT: a step that is in no shard or in two, runs another script, lost an env entry or changed its value, or lost a control. One sentence each. */
function lost(table) {
  const sentences = [];
  for (const step of STEPS_AT_THE_SPLIT) {
    const carriers = table.shards.flatMap((shard) => shard.units.filter((candidate) => candidate.name === step.name).map((found) => ({ shard: shard.id, unit: found })));
    if (carriers.length !== 1) {
      sentences.push(`"${step.name}" runs in ${carriers.length} shards, not one`);
      continue;
    }
    const { unit: carried } = carriers[0];
    if (carried.script !== step.script) sentences.push(`"${step.name}" runs ${carried.script}, not ${step.script}`);
    for (const [key, value] of Object.entries(step.env ?? {})) {
      if (carried.env?.[key] !== value) sentences.push(`"${step.name}" lost ${key}=${value}`);
    }
    for (const control of step.controls ?? []) {
      if (!(carried.controls ?? []).includes(control)) sentences.push(`"${step.name}" lost the control ${control}`);
    }
  }
  return sentences;
}

test('every step of the one-job workflow runs in exactly one shard, with its script, its env (FONT_DELAY_MS included) and its negative controls', () => {
  assert.deepEqual(lost(TABLE), []);
});

test('negative control: the split is seen to lose a step, a control, an env entry or a script, and says which', () => {
  const copy = () => structuredClone(TABLE);
  const withoutDetail = copy();
  for (const shard of withoutDetail.shards) shard.units = shard.units.filter((candidate) => candidate.script !== 'ui-next/page/probes/detail-probe.mjs');
  assert.deepEqual(lost(withoutDetail), ['"Probe the detail page against the pinned mock reference" runs in 0 shards, not one']);

  const twice = copy();
  twice.shards[0].units.push(structuredClone(twice.shards[1].units[0]));
  assert.match(lost(twice)[0], /runs in 2 shards, not one/);

  const lessControl = copy();
  for (const shard of lessControl.shards) for (const candidate of shard.units) if (candidate.name.startsWith('Probe that the log probe')) candidate.controls = candidate.controls.filter((control) => control !== 'source-tip');
  assert.deepEqual(lost(lessControl), ['"Probe that the log probe sees a log view that is wrong" lost the control source-tip']);

  const noDelay = copy();
  for (const shard of noDelay.shards) for (const candidate of shard.units) if (candidate.name === 'Probe the command palette against the pinned mock reference') delete candidate.env.FONT_DELAY_MS;
  assert.deepEqual(lost(noDelay), ['"Probe the command palette against the pinned mock reference" lost FONT_DELAY_MS=40']);
});

test('negative control: a probe file added to a probe directory without a shard fails the real check and names the file; a probe deleted from the table fails it too', () => {
  const added = realCheck(TABLE, [...findProbeScripts(repo), 'ui-next/shell/probes/forgotten-probe.mjs']);
  assert.equal(added.length, 1);
  assert.match(added[0].message, /ui-next\/shell\/probes\/forgotten-probe\.mjs is a probe script and no shard runs it/);

  const removed = structuredClone(TABLE);
  for (const shard of removed.shards) shard.units = shard.units.filter((candidate) => candidate.script !== 'ui-next/shell/probes/rail-probe.mjs');
  const problems = realCheck(removed);
  assert.ok(problems.some((problem) => problem.file === 'ui-next/shell/probes/rail-probe.mjs' && /no shard runs it/.test(problem.message)), messages(problems).join('\n'));
});

test('a probe that CI never ran before the split is listed by hand with the reason, and nothing else is', () => {
  assert.deepEqual(BY_HAND.map((entry) => entry.script).sort(), ['packages/kit/probes/kit-probe-bc.mjs', 'packages/kit/probes/row-menu-probe.mjs', 'ui-next/page/probes/page-probe.mjs']);
  for (const entry of BY_HAND) assert.ok(entry.reason.length > 20, entry.script);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// One unit becomes runs; one shard becomes a plan
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const VARS = { RUNNER_TEMP: '/tmp/runner', PROBE_DIST: '/tmp/runner/ui-next-dist' };

test('a unit is one run, with its env expanded from the runner environment', () => {
  const runs = expandUnit(unit('Probe a', 'packages/kit/probes/a-probe.mjs', { env: { DIST: '$PROBE_DIST', REPORT: '${RUNNER_TEMP}/a-probe.json', FONT_DELAY_MS: '40' } }), VARS);
  assert.deepEqual(runs, [
    { label: 'Probe a', script: 'packages/kit/probes/a-probe.mjs', env: { DIST: '/tmp/runner/ui-next-dist', REPORT: '/tmp/runner/a-probe.json', FONT_DELAY_MS: '40' } },
  ]);
});

test('a unit with controls is one run for each, with NEGATIVE_CONTROL set to it and the unit env around it', () => {
  const runs = expandUnit(unit('Probe that a sees', 'packages/kit/probes/a-probe.mjs', { env: { DIST: '$PROBE_DIST' }, controls: ['x', 'y'] }), VARS);
  assert.deepEqual(
    runs.map((run) => [run.label, run.env]),
    [
      ['Probe that a sees (x)', { DIST: '/tmp/runner/ui-next-dist', NEGATIVE_CONTROL: 'x' }],
      ['Probe that a sees (y)', { DIST: '/tmp/runner/ui-next-dist', NEGATIVE_CONTROL: 'y' }],
    ],
  );
});

test('negative control: a variable the runner has not set is an error that names the unit and the variable, never an empty path', () => {
  assert.throws(() => expandUnit(unit('Probe a', 'packages/kit/probes/a-probe.mjs', { env: { REPORT: '$RUNNER_TEMP/a.json' } }), {}), /"Probe a".*\$RUNNER_TEMP is not set/);
  assert.throws(() => expandUnit(unit('Probe a', 'packages/kit/probes/a-probe.mjs', { env: { DIST: '$PROBE_DIST' } }), { RUNNER_TEMP: '/t', PROBE_DIST: '' }), /\$PROBE_DIST is not set/);
});

test('a shard is planned: its units in order, the number of runs, and whether it reads the ui-next build (only a unit that names $PROBE_DIST does)', () => {
  const table = small();
  table.shards[0].units[0].env = { DIST: '$PROBE_DIST' };
  const first = planShard(table, '1');
  assert.deepEqual(first.units.map((u) => u.name), ['Probe a', 'Probe that a sees']);
  assert.equal(first.runs, 3);
  assert.equal(first.dist, true);
  const second = planShard(table, '2');
  assert.equal(second.runs, 1);
  assert.equal(second.dist, false);
  assert.throws(() => planShard(table, '9'), /no shard 9 \(the shards are 1, 2\)/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Running a shard
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const PROBES = {
  'ui-next/shell/probes/ok-probe.mjs': "console.log('seen ' + JSON.stringify({ control: process.env.NEGATIVE_CONTROL ?? null, report: process.env.REPORT ?? null, font: process.env.FONT_DELAY_MS ?? null, cwd: process.cwd() }));\n",
  'ui-next/shell/probes/bad-probe.mjs': "console.log('about to fail'); console.error('check width differs by 3 px'); process.exit(3);\n",
  'ui-next/shell/probes/crash-probe.mjs': "throw new Error('the page did not load');\n",
};

function shardsTable() {
  return {
    shards: [
      {
        id: '1',
        units: [
          unit('First fine', 'ui-next/shell/probes/ok-probe.mjs', { env: { REPORT: '$RUNNER_TEMP/ok.json', FONT_DELAY_MS: '40' } }),
          unit('Then bad', 'ui-next/shell/probes/bad-probe.mjs'),
          unit('Control runs', 'ui-next/shell/probes/ok-probe.mjs', { controls: ['one', 'two'] }),
        ],
      },
      { id: '2', units: [unit('Crashes', 'ui-next/shell/probes/crash-probe.mjs')] },
    ],
    byHand: [],
  };
}

async function run(table, id, root) {
  const chunks = [];
  const results = await runShard(table, id, { root, env: { ...process.env, RUNNER_TEMP: '/tmp/runner' }, out: (text) => chunks.push(text) });
  return { results, log: chunks.join('') };
}

test('a shard runs every run of every unit in order, each in its own process at the repository root with its own env, and the passing ones are folded in log groups', async () => {
  const root = scratch(PROBES);
  const table = shardsTable();
  table.shards[0].units.splice(1, 1);
  const { results, log } = await run(table, '1', root);
  assert.deepEqual(results.map((result) => [result.label, result.ok]), [['First fine', true], ['Control runs (one)', true], ['Control runs (two)', true]]);
  assert.ok(results.every((result) => result.code === 0 && result.seconds >= 0));
  const seen = [...log.matchAll(/^seen (.*)$/gm)].map((match) => JSON.parse(match[1]));
  assert.deepEqual(seen.map(({ control, report, font }) => ({ control, report, font })), [
    { control: null, report: '/tmp/runner/ok.json', font: '40' },
    { control: 'one', report: null, font: null },
    { control: 'two', report: null, font: null },
  ]);
  assert.equal(realpathSync(seen[0].cwd), realpathSync(root));
  assert.deepEqual([...log.matchAll(/^::group::(.*)$/gm)].map((match) => match[1]), ['First fine', 'Control runs (one)', 'Control runs (two)']);
  assert.equal([...log.matchAll(/^::endgroup::$/gm)].length, 3);
  assert.doesNotMatch(log, /::error/);
});

test('negative control: a probe that exits non-zero fails the shard, names the unit and the shard in an error line, shows the last lines of its output, and the units after it still run', async () => {
  const root = scratch(PROBES);
  const { results, log } = await run(shardsTable(), '1', root);
  assert.deepEqual(results.map((result) => [result.label, result.ok]), [['First fine', true], ['Then bad', false], ['Control runs (one)', true], ['Control runs (two)', true]]);
  assert.equal(results[1].code, 3);
  assert.match(log, /^::error title=Kit probe failed \(shard 1\)::Then bad exited with code 3$/m);
  const failure = log.indexOf('::error title=Kit probe failed (shard 1)::Then bad');
  assert.ok(log.indexOf('::endgroup::', log.indexOf('::group::Then bad')) < failure, 'the error and the last lines come after the group closed, where a collapsed group does not hide them');
  const afterFailure = log.slice(failure);
  assert.match(afterFailure, /about to fail/);
  assert.match(afterFailure, /check width differs by 3 px/);
  assert.ok(log.indexOf('seen', failure) > failure, 'the controls after the failed unit ran');
});

test('negative control: a probe that throws (exit 1 with a stack) fails the shard like any other', async () => {
  const root = scratch(PROBES);
  const { results, log } = await run(shardsTable(), '2', root);
  assert.deepEqual(results.map((result) => [result.label, result.ok, result.code]), [['Crashes', false, 1]]);
  assert.match(log, /the page did not load/);
  assert.match(log, /^::error title=Kit probe failed \(shard 2\)::Crashes exited with code 1$/m);
});

test('a script that is not there fails the run (the check names it first, this is the second wall)', async () => {
  const root = scratch(PROBES);
  const table = { shards: [{ id: '1', units: [unit('Gone', 'ui-next/shell/probes/gone-probe.mjs')] }], byHand: [] };
  const { results } = await run(table, '1', root);
  assert.deepEqual(results.map((result) => [result.label, result.ok]), [['Gone', false]]);
});

test('the summary of a shard counts runs and failures, one row each with its seconds, and says which failed and how', () => {
  const text = renderSummary('3', [
    { label: 'Probe a', ok: true, code: 0, seconds: 171 },
    { label: 'Probe that a sees (x)', ok: false, code: 3, seconds: 12 },
    { label: 'Probe that a sees (y)', ok: false, code: null, signal: 'SIGKILL', seconds: 1 },
  ]);
  assert.match(text, /^### Kit probes shard 3: 3 runs, 2 failed, 184 s$/m);
  assert.match(text, /^\| pass \| 171 \| Probe a \|$/m);
  assert.match(text, /^\| \*\*fail\*\* \(exit 3\) \| 12 \| Probe that a sees \(x\) \|$/m);
  assert.match(text, /^\| \*\*fail\*\* \(SIGKILL\) \| 1 \| Probe that a sees \(y\) \|$/m);
  assert.match(renderSummary('1', [{ label: 'Probe a', ok: true, code: 0, seconds: 4 }]), /^### Kit probes shard 1: 1 run, all passed, 4 s$/m);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command CI runs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const cli = (root, ...args) => spawnSync('node', [command, '--root', root, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' } });

/** A tree with one empty file for every script the real table names, the by-hand ones, and a workflow with the matrix of the table. */
function treeOfTheTable() {
  const files = {};
  for (const shard of TABLE.shards) for (const { script } of shard.units) files[script] = '';
  for (const { script } of BY_HAND) files[script] = '';
  files[WORKFLOW] = `jobs:\n  shard:\n    strategy:\n      matrix:\n        shard: [${TABLE.shards.map((shard) => shard.id).join(', ')}]\n`;
  return scratch(files);
}

test('the check passes on a tree that holds the scripts of the table and a workflow with its matrix', () => {
  const result = cli(treeOfTheTable(), 'check');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /probe-shards: ok \(\d+ shards, \d+ steps, \d+ probe scripts in shards, \d+ by hand\)/);
});

test('negative control: the check command fails on a probe file added to a probe directory, with the file named on the error line (a GitHub annotation in CI)', () => {
  const root = treeOfTheTable();
  writeFileSync(path.join(root, 'ui-next/shell/probes/forgotten-probe.mjs'), '');
  const plain = cli(root, 'check');
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /probe-shards: ui-next\/shell\/probes\/forgotten-probe\.mjs is a probe script and no shard runs it/);
  const annotated = spawnSync('node', [command, '--root', root, 'check'], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
  assert.equal(annotated.status, 1);
  assert.match(annotated.stdout, /^::error file=ui-next\/shell\/probes\/forgotten-probe\.mjs,title=Kit probe is in no shard::/m);
});

test('negative control: the check command fails when the table has a shard the workflow does not run', () => {
  const root = treeOfTheTable();
  const lastShard = TABLE.shards.at(-1).id;
  writeFileSync(path.join(root, WORKFLOW), `        shard: [${TABLE.shards.slice(0, -1).map((shard) => shard.id).join(', ')}]\n`);
  const result = cli(root, 'check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`shard ${lastShard} is in the table but not in the matrix`));
});

test('the plan names the shard, its units and runs, says whether it reads the ui-next build, and writes that to $GITHUB_OUTPUT', () => {
  const root = treeOfTheTable();
  const output = path.join(root, 'github-output');
  for (const shard of TABLE.shards) {
    const result = spawnSync('node', [command, '--root', root, 'plan', shard.id], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Kit probes shard ${shard.id}: ${shard.units.length} steps`));
    for (const { name } of shard.units) assert.ok(result.stdout.includes(name), name);
  }
  const written = readFileSync(output, 'utf8').trim().split('\n');
  assert.equal(written.length, TABLE.shards.length);
  assert.ok(written.every((line) => line === 'dist=true' || line === 'dist=false'), written.join(' | '));
});

test('a shard that is not in the table, or a command that is not one, is a usage error (exit 2) that lists what there is', () => {
  const unknown = cli(treeOfTheTable(), 'run', '99');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /no shard 99 \(the shards are 1, /);
  const nothing = cli(treeOfTheTable());
  assert.equal(nothing.status, 2);
  assert.match(nothing.stderr, /usage: node scripts\/ci\/probe-shards\.mjs/);
});

test('the run command exits 1 when a probe of the shard fails and 0 when every probe passes, and appends the summary to $GITHUB_STEP_SUMMARY', () => {
  // The real table in a scratch tree where every probe is a script that exits at once: the panel probe with 5, the others with 0.
  const files = {};
  for (const shard of TABLE.shards) for (const { script } of shard.units) files[script] = script.endsWith('panel-probe.mjs') ? 'process.exit(5);\n' : 'process.exit(0);\n';
  const root = scratch(files);
  const summary = path.join(root, 'summary.md');
  const env = { ...process.env, RUNNER_TEMP: root, PROBE_DIST: path.join(root, 'dist'), GITHUB_STEP_SUMMARY: summary, GITHUB_ACTIONS: '' };
  const withPanel = TABLE.shards.find((shard) => shard.units.some((candidate) => candidate.script.endsWith('panel-probe.mjs'))).id;
  const without = TABLE.shards.find((shard) => shard.id !== withPanel).id;
  const failing = spawnSync('node', [command, '--root', root, 'run', withPanel], { encoding: 'utf8', env });
  assert.equal(failing.status, 1, failing.stdout + failing.stderr);
  assert.match(readFileSync(summary, 'utf8'), new RegExp(`### Kit probes shard ${withPanel}: \\d+ runs?, \\d+ failed`));
  const passing = spawnSync('node', [command, '--root', root, 'run', without], { encoding: 'utf8', env });
  assert.equal(passing.status, 0, passing.stdout + passing.stderr);
  assert.match(readFileSync(summary, 'utf8'), new RegExp(`### Kit probes shard ${without}: \\d+ runs?, all passed`));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The workflow
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const stepsOf = (job) => workflow.jobs[job].steps;

test('the shard job fans out over the shards of the table, none stops the others, each has a limit, and the file names its probes only through the table', () => {
  const job = workflow.jobs.shard;
  assert.equal(job.strategy['fail-fast'], false);
  assert.deepEqual(job.strategy.matrix.shard.map(String), TABLE.shards.map((shard) => shard.id));
  assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0);
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  const commands = stepsOf('shard').map((step) => step.run ?? '').join('\n');
  assert.match(commands, /node scripts\/ci\/probe-shards\.mjs check/);
  assert.match(commands, /node --test scripts\/ci\/probe-shards\.test\.mjs/);
  assert.match(commands, /node scripts\/ci\/probe-shards\.mjs plan "\$SHARD"/);
  assert.match(commands, /node scripts\/ci\/probe-shards\.mjs run "\$SHARD"/);
  assert.doesNotMatch(commands, /node (packages\/kit\/probes|ui-next\/(shell|page)\/probes)\//, 'a probe run from the workflow file is a probe no table knows');
  for (const step of stepsOf('shard')) {
    if (step.run?.includes('probe-shards.mjs plan') || step.run?.includes('probe-shards.mjs run')) assert.equal(step.env?.SHARD, '${{ matrix.shard }}');
  }
});

test('the workflow keeps the env the single job had, and runs again when the table, its runner or its test change', () => {
  assert.equal(workflow.env.OMNIVIEW_UI, 'next');
  assert.equal(workflow.env.NODE_VERSION, '26.13.0');
  for (const event of ['pull_request', 'push']) {
    const paths = workflow.on[event].paths;
    for (const entry of ['packages/kit/**', 'ui-next/**', 'packages/omniviewdev-runtime/**', 'pnpm-lock.yaml', '.github/workflows/ui-next-kit-probes.yml', 'scripts/ci/probe-shards.mjs', 'scripts/ci/probe-shards.test.mjs']) {
      assert.ok(paths.includes(entry), `${event} paths lack ${entry}`);
    }
  }
  assert.equal(workflow.on.push.branches[0], 'main');
  assert.ok('workflow_dispatch' in workflow.on);
});

test('every shard keeps the bounded, retried browser install of #557 and the browser cache, and builds the packages and, when its probes read it, ui-next', () => {
  const install = stepsOf('shard').find((step) => step.name === 'Install the browsers');
  assert.ok(install, 'the step "Install the browsers"');
  assert.match(install.run, /for attempt in 1 2; do/);
  assert.match(install.run, /timeout --kill-after=15 900 pnpm exec playwright install --with-deps chromium webkit/);
  assert.match(install.run, /DPkg::Lock::Timeout "600";/);
  assert.match(install.run, /::error::Playwright browser install failed twice"\n\s*exit 1\n?$/, 'two failed attempts fail the step');
  assert.match(install.run, /if timeout --kill-after=15 900 pnpm exec playwright install --with-deps chromium webkit; then\n\s*exit 0\n\s*fi/, 'a first attempt that passes ends the step');
  const cache = stepsOf('shard').find((step) => step.name === 'Cache the browsers');
  assert.equal(cache.with.key, '${{ runner.os }}-playwright-1.64.1-chromium-webkit');
  assert.ok(stepsOf('shard').some((step) => step.run?.includes('task packages')));
  const build = stepsOf('shard').find((step) => step.run?.includes('vite build'));
  assert.equal(build.if, "steps.plan.outputs.dist == 'true'");
  assert.match(build.run, /PROBE_DIST=\$RUNNER_TEMP\/ui-next-dist/);
  assert.equal(stepsOf('shard').find((step) => step.id === 'plan')?.name !== undefined, true);
});

test('the reports are kept per shard, under a name of their own, so that no shard uploads over another', () => {
  const upload = stepsOf('shard').find((step) => step.uses?.startsWith('actions/upload-artifact'));
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.name, 'kit-probe-reports-${{ matrix.shard }}');
});

test('the check named `Kit probes` is the aggregating job: the only job of that name, after every shard, run unless the whole run was cancelled, and no shard is called that', () => {
  const named = Object.entries(workflow.jobs).filter(([, job]) => job.name === 'Kit probes');
  assert.deepEqual(named.map(([id]) => id), ['probes']);
  const aggregator = workflow.jobs.probes;
  assert.equal(aggregator.needs, 'shard');
  assert.equal(aggregator.if, '${{ !cancelled() }}');
  assert.equal(aggregator.permissions.actions, 'read');
  assert.match(workflow.jobs.shard.name, /^Kit probes shard \$\{\{ matrix\.shard \}\}$/);
  assert.equal(stepsOf('probes').length, 1, 'the verdict is one step: nothing that can fail before it can decide it');
  assert.equal(stepsOf('probes')[0].env.RESULT, '${{ needs.shard.result }}');
});

// The gate: the `run:` of the aggregating job, executed by bash as the runner does (`bash -e <file>`), with `gh` replaced by a stand-in that answers from a canned job list through the real jq filter.
const gateScript = () => stepsOf('probes')[0].run;
const JOBS = {
  jobs: [
    { name: 'Kit probes shard 1', status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/9/job/1' },
    { name: 'Kit probes shard 2', status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/9/job/2' },
    { name: 'Kit probes shard 3', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/o/r/actions/runs/9/job/3' },
    { name: 'Kit probes shard 4', status: 'completed', conclusion: 'cancelled', html_url: 'https://github.com/o/r/actions/runs/9/job/4' },
    { name: 'Kit probes shard 5', status: 'completed', conclusion: 'skipped', html_url: 'https://github.com/o/r/actions/runs/9/job/5' },
    { name: 'Kit probes', status: 'in_progress', conclusion: null, html_url: 'https://github.com/o/r/actions/runs/9/job/6' },
  ],
};

function gate(result, { jobs = JOBS, ghFails = false, noGh = false } = {}) {
  assert.equal(spawnSync('jq', ['--version']).status, 0, 'jq is needed for this test (GitHub runners have it)');
  const directory = scratch({ 'jobs.json': JSON.stringify(jobs), 'gate.sh': gateScript() });
  const bin = path.join(directory, 'bin');
  mkdirSync(bin);
  if (!noGh) {
    writeFileSync(
      path.join(bin, 'gh'),
      ['#!/usr/bin/env bash', 'if [ -n "${FAKE_GH_FAILS:-}" ]; then echo "gh: HTTP 403: Resource not accessible by integration" >&2; exit 1; fi', 'filter=""', 'for ((i = 1; i <= $#; i++)); do if [ "${!i}" = "--jq" ]; then j=$((i + 1)); filter="${!j}"; fi; done', 'echo "gh $1 $2" >> "$FAKE_GH_LOG"', 'exec jq -r "$filter" "$FAKE_GH_JOBS"', ''].join('\n'),
    );
    chmodSync(path.join(bin, 'gh'), 0o755);
  }
  const env = {
    // Without the stand-in the PATH is the empty directory: no gh (the machine running this may have a real one, which must not be asked).
    PATH: noGh ? bin : `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: directory,
    RESULT: result,
    GH_TOKEN: 'token',
    GITHUB_REPOSITORY: 'o/r',
    GITHUB_RUN_ID: '9',
    GITHUB_RUN_ATTEMPT: '2',
    FAKE_GH_JOBS: path.join(directory, 'jobs.json'),
    FAKE_GH_LOG: path.join(directory, 'gh.log'),
    ...(ghFails ? { FAKE_GH_FAILS: '1' } : {}),
  };
  const outcome = spawnSync('/bin/bash', ['-e', path.join(directory, 'gate.sh')], { encoding: 'utf8', env });
  let called = '';
  try {
    called = readFileSync(env.FAKE_GH_LOG, 'utf8');
  } catch {
    // never called
  }
  return { ...outcome, output: `${outcome.stdout}${outcome.stderr}`, called };
}

test('the aggregator passes when every shard succeeded', () => {
  const outcome = gate('success');
  assert.equal(outcome.status, 0, outcome.output);
  assert.equal(outcome.called, '', 'a green run does not need the job list');
});

for (const result of ['failure', 'cancelled', 'skipped', '', 'startup_failure']) {
  test(`negative control: the aggregator fails when the shards finished as ${result === '' ? 'nothing at all' : result}`, () => {
    const outcome = gate(result);
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, new RegExp(`^::error title=Kit probes::the probe shards finished as '${result === '' ? 'unknown' : result}'`, 'm'));
  });
}

test('negative control: the aggregator names every shard that did not succeed, with how it ended and where, and none that did', () => {
  const outcome = gate('failure');
  assert.equal(outcome.status, 1, outcome.output);
  assert.match(outcome.output, /^::error title=Kit probes::Kit probes shard 3 finished as failure: https:\/\/github\.com\/o\/r\/actions\/runs\/9\/job\/3$/m);
  assert.match(outcome.output, /^::error title=Kit probes::Kit probes shard 4 finished as cancelled: /m);
  assert.match(outcome.output, /^::error title=Kit probes::Kit probes shard 5 finished as skipped: /m);
  assert.doesNotMatch(outcome.output, /shard 1 finished|shard 2 finished/);
  assert.doesNotMatch(outcome.output, /::error title=Kit probes::Kit probes finished/, 'the aggregator does not blame itself');
  assert.match(outcome.called, /^gh api repos\/o\/r\/actions\/runs\/9\/attempts\/2\/jobs/m, 'it reads the jobs of this attempt of this run');
});

test('negative control: the aggregator is red even when the job list cannot be read or gh is missing, and says so', () => {
  for (const options of [{ ghFails: true }, { noGh: true }]) {
    const outcome = gate('failure', options);
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, /^::error title=Kit probes::the probe shards finished as 'failure'/m);
    assert.match(outcome.output, /^::warning title=Kit probes::could not list the shards of this run/m);
  }
});

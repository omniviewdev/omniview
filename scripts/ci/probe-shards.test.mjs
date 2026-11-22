// The kit probes' units and their runner (scripts/ci/probe-shards.mjs): the table of units (one small file for each probe in scripts/ci/probe-units), the check that makes a forgotten probe impossible and a control that
// is never selected a failure of the table, the plan that selects the controls and packs the units into shards at run time, the runner that executes a shard and fails it when a unit drifted from its seconds, and the contract
// of the workflow that fans the shards out (.github/workflows/ui-next-kit-probes.yml), including the job named `Kit probes` that is red unless the plan and every shard are green.
//
// Every "negative control" below feeds a check the mistake it exists for and asserts the check names it; each was also seen to go red with its check taken out (docs/ui-next/status/N24-K1.md, N25.md).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { lowerBound, pack } from './probe-pack.mjs';
import { SHARED_HARNESS, contextOf, matches, selectControls } from './probe-select.mjs';
import {
  BY_HAND,
  DRIFT_FLOOR_SECONDS,
  DRIFT_RATIO,
  LIMIT_SECONDS,
  PROBE_DIRS,
  SETUP_P90_SECONDS,
  UNITS_DIRECTORY,
  WALL_BUDGET_SECONDS,
  WORKFLOW,
  checkUnits,
  driftFindings,
  expandUnit,
  findProbeScripts,
  isProbeScript,
  listFiles,
  loadUnits,
  main,
  matrixOf,
  planRun,
  readsDist,
  renderPlan,
  renderSummary,
  runShard,
} from './probe-shards.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const command = fileURLToPath(new URL('./probe-shards.mjs', import.meta.url));
const workflowText = readFileSync(path.join(repo, WORKFLOW), 'utf8');
const workflow = parse(workflowText);

// The environment a test hands to a child: the caller's, minus every variable a probe or this runner reads (a developer runs the probes with FONT_DELAY_MS=40 exported, AGENTS.md rule 17) and every one GitHub sets, so that what
// a test asserts does not depend on the shell it runs from.
const PROBE_VARIABLES = ['FONT_DELAY_MS', 'NEGATIVE_CONTROL', 'REPORT', 'DIST', 'PROBE_DIST', 'FIXTURE_DIST', 'FIXTURE_DIST_DEV', 'BUILD_CACHE', 'CHANGED_PATHS', 'GITHUB_ACTIONS', 'GITHUB_EVENT_NAME', 'GITHUB_RUN_ATTEMPT', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY'];
const callerEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !PROBE_VARIABLES.includes(key)));

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

const unit = (id, script, extra = {}) => ({ id, name: `Unit ${id}`, script, seconds: 40, paths: [script], file: `${UNITS_DIRECTORY}/${id}.mjs`, ...extra });
const messages = (problems) => problems.map((problem) => problem.message);

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

test('the probe directories are the three the probes live in', () => {
  assert.deepEqual([...PROBE_DIRS], ['packages/kit/probes', 'ui-next/shell/probes', 'ui-next/page/probes']);
});

test('the files of a tree are listed with "/" and relative to its root, sorted, and neither .git nor node_modules is read', () => {
  const root = scratch({ 'a/b.txt': '', 'c.txt': '', 'node_modules/x/y.js': '', '.git/HEAD': '', 'packages/kit/dist/index.js': '', 'ui-next/shell/Shell.tsx': '' });
  assert.deepEqual(listFiles(root), ['a/b.txt', 'c.txt', 'packages/kit/dist/index.js', 'ui-next/shell/Shell.tsx']);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The table is a directory of small files
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const UNIT_FILE = (units) => `export const units = ${JSON.stringify(units)};\n`;

test('every .mjs file of the units directory is read, in name order, and each unit is told which file declares it', async () => {
  const root = scratch({
    [`${UNITS_DIRECTORY}/b.mjs`]: UNIT_FILE([{ id: 'b', name: 'B', script: 'x', seconds: 1, paths: ['x'] }]),
    [`${UNITS_DIRECTORY}/a.mjs`]: UNIT_FILE([{ id: 'a1', name: 'A1', script: 'x', seconds: 1, paths: ['x'] }, { id: 'a2', name: 'A2', script: 'x', seconds: 1, paths: ['x'] }]),
  });
  const { units, problems } = await loadUnits(root);
  assert.deepEqual(problems, []);
  assert.deepEqual(units.map((entry) => [entry.id, entry.file]), [['a1', `${UNITS_DIRECTORY}/a.mjs`], ['a2', `${UNITS_DIRECTORY}/a.mjs`], ['b', `${UNITS_DIRECTORY}/b.mjs`]]);
});

test('negative control: a unit file that does not load, exports no list of units, exports something else, or is not an .mjs file is a problem that names the file; a directory that is gone is one too', async () => {
  const root = scratch({
    [`${UNITS_DIRECTORY}/broken.mjs`]: 'export const units = [;\n',
    [`${UNITS_DIRECTORY}/empty.mjs`]: 'export const other = 1;\n',
    [`${UNITS_DIRECTORY}/object.mjs`]: 'export const units = { id: "a" };\n',
    [`${UNITS_DIRECTORY}/none.mjs`]: 'export const units = [];\n',
    [`${UNITS_DIRECTORY}/notes.json`]: '{}',
    [`${UNITS_DIRECTORY}/ok.mjs`]: UNIT_FILE([{ id: 'ok', name: 'Ok', script: 'x', seconds: 1, paths: ['x'] }]),
  });
  const { units, problems } = await loadUnits(root);
  assert.deepEqual(units.map((entry) => entry.id), ['ok']);
  const said = messages(problems).join('\n');
  assert.match(said, /scripts\/ci\/probe-units\/broken\.mjs does not load/);
  assert.match(said, /scripts\/ci\/probe-units\/empty\.mjs exports no `units`/);
  assert.match(said, /scripts\/ci\/probe-units\/object\.mjs: `units` is not a list/);
  assert.match(said, /scripts\/ci\/probe-units\/none\.mjs declares no unit/);
  assert.match(said, /scripts\/ci\/probe-units\/notes\.json is not a unit file/);
  for (const problem of problems) assert.ok(problem.file?.startsWith(UNITS_DIRECTORY), problem.message);
  const gone = await loadUnits(scratch({}));
  assert.match(messages(gone.problems)[0], /scripts\/ci\/probe-units does not exist/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The completeness check, on a small table
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const A = 'packages/kit/probes/a-probe.mjs';
const B = 'ui-next/shell/probes/b-probe.mjs';
const C = 'ui-next/page/probes/c-probe.mjs';
const small = () => [
  unit('a', A, { env: { REPORT: '$RUNNER_TEMP/a-probe.json' }, paths: [A, 'packages/kit/src/components/A/**'] }),
  unit('a-controls', A, { controls: ['x', 'y'], paths: [A, 'packages/kit/src/components/A/**'] }),
  unit('b', B),
];
const FOUND = [A, B, C];
const FILES = [A, B, C, 'packages/kit/src/components/A/A.tsx'];
const check = (changes = {}) => checkUnits({ units: small(), byHand: [{ script: C, reason: 'run by hand' }], found: FOUND, exists: () => true, files: FILES, ...changes });

test('a complete table has no problem', () => {
  assert.deepEqual(check(), []);
});

test('negative control: a probe file that is in no unit fails the check and the message names the file', () => {
  const problems = check({ found: [...FOUND, 'ui-next/shell/probes/new-probe.mjs'] });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, 'ui-next/shell/probes/new-probe.mjs');
  assert.match(problems[0].message, /ui-next\/shell\/probes\/new-probe\.mjs is a probe script and no unit runs it/);
  assert.match(problems[0].message, /scripts\/ci\/probe-units/);
  assert.match(problems[0].message, /BY_HAND/);
});

test('negative control: a probe that a by-hand entry names is run by nobody in CI, and a by-hand entry cannot hide a probe a unit runs', () => {
  assert.deepEqual(check(), []);
  const problems = check({ byHand: [{ script: B, reason: 'also by hand' }] });
  assert.ok(messages(problems).some((message) => /ui-next\/shell\/probes\/b-probe\.mjs is run by unit "b" and listed in BY_HAND/.test(message)), messages(problems).join('\n'));
});

test('a probe\'s negative controls may be split into several units (N25), as long as the probe is one unit and each control is in one unit once', () => {
  const split = small();
  split.splice(2, 0, unit('a-controls-more', A, { controls: ['z'], paths: [A] }));
  assert.deepEqual(messages(check({ units: split })), []);
});

test('negative control: a probe that runs twice, a control in two units or twice in one fail the check, and the script and the units are named', () => {
  const twice = small();
  twice.push(unit('a-again', A, { paths: [A] }));
  const first = check({ units: twice });
  assert.equal(first.length, 1);
  assert.equal(first[0].file, A);
  assert.match(first[0].message, /packages\/kit\/probes\/a-probe\.mjs runs twice as a probe: the units "a" and "a-again"/);

  const control = small();
  control.push(unit('a-controls-again', A, { controls: ['y', 'q'], paths: [A] }));
  const second = check({ units: control });
  assert.equal(second.length, 1);
  assert.match(second[0].message, /control "y" of packages\/kit\/probes\/a-probe\.mjs is in two units: "a-controls" and "a-controls-again": each control runs once/);

  const same = small();
  same[1].controls = ['x', 'x'];
  assert.match(messages(check({ units: same }))[0], /the unit "a-controls" lists the control "x" twice/);
});

test('negative control: a unit whose script is gone fails the check and names the file, the unit and the file that declares it', () => {
  const problems = check({ exists: (file) => file !== B });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, B);
  assert.match(problems[0].message, /ui-next\/shell\/probes\/b-probe\.mjs is named by the unit "b" \(scripts\/ci\/probe-units\/b\.mjs\) but does not exist/);
});

test('negative control: a by-hand entry whose script is gone fails the check and names the file', () => {
  const problems = check({ exists: (file) => file !== C });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /ui-next\/page\/probes\/c-probe\.mjs is named by BY_HAND but does not exist/);
});

test('negative control: an id or a name used twice, an id that is not a lower-case word with hyphens, and a unit with no name, id or script fail the check', () => {
  const twice = small();
  twice.push(unit('b', B, { name: 'Another' }));
  assert.ok(messages(check({ units: twice })).some((message) => /the id "b" is used by two units \(scripts\/ci\/probe-units\/b\.mjs and scripts\/ci\/probe-units\/b\.mjs\)|the id "b" is used by two units/.test(message)));
  const sameName = small();
  sameName.push(unit('d', B, { name: 'Unit b' }));
  assert.ok(messages(check({ units: sameName })).some((message) => /the name "Unit b" is used by two units/.test(message)));
  for (const id of ['', 'Upper', 'two words', 'under_score', '-lead', 'trail-', 'a--b']) {
    const bad = small();
    bad[2].id = id;
    assert.ok(messages(check({ units: bad })).some((message) => /id .* is not/.test(message)), JSON.stringify(id));
  }
  const broken = small();
  broken.push({ id: 'e', script: B, seconds: 10, paths: [B], file: `${UNITS_DIRECTORY}/e.mjs` }, { id: 'f', name: 'F', seconds: 10, paths: [B], file: `${UNITS_DIRECTORY}/f.mjs` });
  const problems = messages(check({ units: broken }));
  assert.ok(problems.some((message) => /the unit "e" has no name/.test(message)), problems.join('\n'));
  assert.ok(problems.some((message) => /the unit "f" has no script/.test(message)), problems.join('\n'));
});

test('negative control: controls that would run the probe zero times, or a control set by hand in env, and an env value that is not a string, fail the check', () => {
  const none = small();
  none[1].controls = [];
  assert.match(messages(check({ units: none }))[0], /the unit "a-controls" has an empty controls list/);
  const manual = small();
  manual[1].env = { NEGATIVE_CONTROL: 'x' };
  assert.match(messages(check({ units: manual }))[0], /the unit "a-controls" sets NEGATIVE_CONTROL in env/);
  const number = small();
  number[2].env = { FONT_DELAY_MS: 40 };
  assert.match(messages(check({ units: number }))[0], /the unit "b" sets FONT_DELAY_MS to a number: an env value is a string/);
});

// What the planner needs of every unit: whole seconds, one unit at most the limit (a unit over it cannot be put in any shard: split it), and what a control is selected by.
test('negative control: seconds that are missing, not whole, not positive, a string, or over what one shard may hold fail the check; the unit over the limit is told to split', () => {
  for (const seconds of [undefined, 0, -4, 3.5, '40', null, Number.NaN]) {
    const bad = small();
    bad[2].seconds = seconds;
    assert.ok(messages(check({ units: bad })).some((message) => /the unit "b" has .* seconds: a whole, positive number of seconds/.test(message)), JSON.stringify(seconds));
  }
  const big = small();
  big[2].seconds = LIMIT_SECONDS + 1;
  assert.ok(messages(check({ units: big })).some((message) => /the unit "b" is 433 s, over the 432 s a shard may hold: split it/.test(message)));
  const exact = small();
  exact[2].seconds = LIMIT_SECONDS;
  assert.deepEqual(messages(check({ units: exact })), []);
});

test('negative control: a unit with no paths, a glob that cannot be read, a glob that matches no file of the tree, or a unit that does not list its own script fails the check; the declaration file needs no entry', () => {
  const none = small();
  delete none[1].paths;
  assert.match(messages(check({ units: none }))[0], /the unit "a-controls" declares no paths/);
  const empty = small();
  empty[1].paths = [];
  assert.match(messages(check({ units: empty }))[0], /the unit "a-controls" declares no paths/);
  const unreadable = small();
  unreadable[1].paths = [A, 'packages/kit/[src]/x'];
  assert.match(messages(check({ units: unreadable }))[0], /the unit "a-controls" has a path glob that cannot be read: .*bracket/);
  const nothing = small();
  nothing[1].paths = [A, 'packages/kit/src/components/Gone/**'];
  const problems = check({ units: nothing });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /the glob "packages\/kit\/src\/components\/Gone\/\*\*" of the unit "a-controls" \(scripts\/ci\/probe-units\/a-controls\.mjs\) matches no file of the tree: the path moved or was mistyped, and a control that is never selected proves nothing/);
  const own = small();
  own[2].paths = ['ui-next/shell/probes/elsewhere/**'];
  assert.ok(messages(check({ units: own, files: [...FILES, 'ui-next/shell/probes/elsewhere/x.mjs'] })).some((message) => /the unit "b" does not list its own script ui-next\/shell\/probes\/b-probe\.mjs in paths/.test(message)));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The real table, the real tree
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const REAL = await loadUnits(repo);
const UNITS = REAL.units;
const REAL_FILES = listFiles(repo);
const FOUND_ON_DISK = findProbeScripts(repo);
const exists = (file) => REAL_FILES.includes(file);
const realCheck = (units = UNITS, found = FOUND_ON_DISK) => checkUnits({ units, byHand: BY_HAND, found, exists, files: REAL_FILES });
const byId = (id) => UNITS.find((entry) => entry.id === id);
const idsOf = (list) => list.map((entry) => entry.id);

test('the real table loads without a problem and the real check passes: every probe script is in a unit, every glob matches a file, every unit has whole seconds under the limit', () => {
  assert.deepEqual(REAL.problems, []);
  assert.deepEqual(messages(realCheck()), []);
  for (const file of ['packages/kit/probes/kit-probe.mjs', 'ui-next/shell/probes/palette-probe.mjs', 'ui-next/page/probes/detail-probe.mjs', 'ui-next/page/probes/page-probe.mjs']) {
    assert.ok(FOUND_ON_DISK.includes(file), `the scan of the probe directories found ${FOUND_ON_DISK.length} scripts and not ${file}`);
  }
  for (const file of FOUND_ON_DISK) {
    const runs = UNITS.filter((entry) => entry.script === file);
    assert.equal(runs.filter((entry) => entry.controls === undefined).length <= 1, true, `${file} runs twice as a probe`);
    assert.ok(runs.length > 0 || BY_HAND.some((entry) => entry.script === file), `${file} runs in no unit`);
  }
});

test('negative control: a probe file added to a probe directory without a unit fails the real check and names the file; a unit deleted fails it too', () => {
  const added = realCheck(UNITS, [...FOUND_ON_DISK, 'ui-next/shell/probes/forgotten-probe.mjs']);
  assert.equal(added.length, 1);
  assert.match(added[0].message, /ui-next\/shell\/probes\/forgotten-probe\.mjs is a probe script and no unit runs it/);
  const removed = UNITS.filter((entry) => entry.script !== 'ui-next/shell/probes/rail-probe.mjs');
  assert.ok(realCheck(removed).some((problem) => problem.file === 'ui-next/shell/probes/rail-probe.mjs' && /no unit runs it/.test(problem.message)), messages(realCheck(removed)).join('\n'));
});

test('nothing is run by hand: BY_HAND is empty (the mechanism stays, with its check)', () => {
  assert.deepEqual(BY_HAND, []);
});

// The steps of the workflow when it ran every probe in one job (N24 K1, 16 steps), with the controls they had then. A step may gain env and controls; it may not lose any, and may not leave CI: deleting a line here is the change
// that says a probe left CI, and a reviewer reads it. Since N25 a probe's controls are several units, so a step is its probe's unit and the union of the controls of its units.
const STEPS_AT_THE_SPLIT = [
  { script: 'packages/kit/probes/kit-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/kit-probe.json' } },
  { script: 'packages/kit/probes/table-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/table-probe.json' } },
  { script: 'packages/kit/probes/fonts-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/fonts-probe.json' } },
  { script: 'packages/kit/probes/tooltip-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/tooltip-probe.json' } },
  { script: 'ui-next/shell/probes/shell-probe.mjs', env: { REPORT: '$RUNNER_TEMP/shell-probe.json' } },
  { script: 'ui-next/shell/probes/strip-probe.mjs', env: { REPORT: '$RUNNER_TEMP/strip-probe.json' } },
  { script: 'ui-next/shell/probes/rail-probe.mjs', env: { REPORT: '$RUNNER_TEMP/rail-probe.json' } },
  { script: 'ui-next/shell/probes/panel-probe.mjs', env: { REPORT: '$RUNNER_TEMP/panel-probe.json' } },
  { script: 'ui-next/shell/probes/panel-probe.mjs', controls: ['panel-height', 'session-gap', 'toggle', 'tab-padding', 'shift', 'root-write'] },
  { script: 'ui-next/shell/probes/logs-probe.mjs', env: { REPORT: '$RUNNER_TEMP/logs-probe.json' } },
  { script: 'ui-next/shell/probes/logs-probe.mjs', controls: ['feed-stopped', 'source-label', 'column-moves'] },
  { script: 'packages/kit/probes/log-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/log-probe.json' } },
  { script: 'packages/kit/probes/log-probe.mjs', env: { DIST: '$PROBE_DIST' }, controls: ['row-height', 'time-column', 'filter-shift', 'strip-height', 'copy', 'keys', 'axe', 'source-tip'] },
  { script: 'ui-next/page/probes/detail-probe.mjs' },
  { script: 'ui-next/shell/probes/palette-probe.mjs', env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/palette-probe.json' } },
  { script: 'ui-next/shell/probes/palette-probe.mjs', env: { FONT_DELAY_MS: '40' }, controls: ['frame-width', 'row-height', 'foot-height', 'search-place', 'foot-gap', 'paint', 'hover-steals', 'no-restore'] },
];

/** What the table lost of STEPS_AT_THE_SPLIT: a probe that has no unit, or a step that lost an env entry, or a control. One sentence each. */
function lost(units) {
  const sentences = [];
  for (const step of STEPS_AT_THE_SPLIT) {
    const carriers = units.filter((candidate) => candidate.script === step.script && (step.controls === undefined) === (candidate.controls === undefined));
    if (carriers.length === 0) {
      sentences.push(`${step.script} ${step.controls === undefined ? 'probe' : 'controls'} runs in no unit`);
      continue;
    }
    for (const [key, value] of Object.entries(step.env ?? {})) {
      for (const carried of carriers) if (carried.env?.[key] !== value) sentences.push(`${carried.id} lost ${key}=${value}`);
    }
    for (const control of step.controls ?? []) {
      if (!carriers.some((carried) => carried.controls.includes(control))) sentences.push(`${step.script} lost the control ${control}`);
    }
  }
  return sentences;
}

test('every step of the one-job workflow still runs: its probe, its env (FONT_DELAY_MS included) and each of its negative controls, wherever the controls are now', () => {
  assert.deepEqual(lost(UNITS), []);
});

test('negative control: the split is seen to lose a probe, a control, an env entry or a script, and says which', () => {
  const copy = () => structuredClone(UNITS);
  assert.deepEqual(lost(copy().filter((entry) => entry.script !== 'ui-next/page/probes/detail-probe.mjs')), ['ui-next/page/probes/detail-probe.mjs probe runs in no unit']);
  const lessControl = copy();
  for (const entry of lessControl) if (entry.id === 'log-controls') entry.controls = entry.controls.filter((control) => control !== 'source-tip');
  assert.deepEqual(lost(lessControl), ['packages/kit/probes/log-probe.mjs lost the control source-tip']);
  const noDelay = copy();
  for (const entry of noDelay) if (entry.id === 'palette') delete entry.env.FONT_DELAY_MS;
  assert.deepEqual(lost(noDelay), ['palette lost FONT_DELAY_MS=40']);
  const nowhere = copy();
  for (const entry of nowhere) if (entry.id === 'panel-controls-twins') entry.controls = [];
  assert.deepEqual(lost(nowhere), [], 'the original six controls of the panel probe are in the frame unit: only a control of the original steps is checked here');
  const panelFrame = copy();
  for (const entry of panelFrame) if (entry.id === 'panel-controls-frame') entry.controls = entry.controls.filter((control) => control !== 'toggle');
  assert.deepEqual(lost(panelFrame), ['ui-next/shell/probes/panel-probe.mjs lost the control toggle']);
});

// N25 step 3: the panel probe's controls were one unit of 480 s on the runner (run 44929041191), over the 432 s a shard may hold. They are three units and the fourteen controls are the same fourteen, each once.
const PANEL_CONTROLS = ['panel-height', 'session-gap', 'toggle', 'tab-padding', 'shift', 'root-write', 'held-hidden', 'held-done-hidden', 'held-moved', 'held-enabled', 'twin-moved', 'twin-lone-scope', 'twin-scope-kept', 'scope-name'];

test('the 480 s unit of the panel probe is three units that each fit, hold the same fourteen controls once each, in the same order, and add up to the 480 s it measured', () => {
  const parts = UNITS.filter((entry) => entry.script === 'ui-next/shell/probes/panel-probe.mjs' && entry.controls !== undefined);
  assert.deepEqual(idsOf(parts), ['panel-controls-frame', 'panel-controls-held', 'panel-controls-twins']);
  assert.deepEqual(parts.flatMap((entry) => entry.controls), PANEL_CONTROLS);
  assert.equal(parts.reduce((sum, entry) => sum + entry.seconds, 0), 480);
  for (const part of parts) {
    assert.ok(part.seconds <= LIMIT_SECONDS / 2, `${part.id} is ${part.seconds} s`);
    assert.equal(part.env, undefined, 'the controls had no env, and have none now');
  }
});

test('the two other units that filled a shard alone, the toast layer\'s controls (384 s) and the Logs probe\'s (382 s), are split the same way, with the controls they had, each once', () => {
  const toast = UNITS.filter((entry) => entry.script === 'ui-next/shell/probes/notices-probe.mjs' && entry.controls !== undefined);
  assert.deepEqual(idsOf(toast), ['notices-controls-toast', 'notices-controls-centre']);
  assert.equal(toast.flatMap((entry) => entry.controls).length, 34);
  assert.equal(toast.reduce((sum, entry) => sum + entry.seconds, 0), 384);
  const logs = UNITS.filter((entry) => entry.script === 'ui-next/shell/probes/logs-probe.mjs' && entry.controls !== undefined);
  assert.deepEqual(idsOf(logs), ['logs-controls-feed', 'logs-controls-toolbar']);
  assert.equal(logs.flatMap((entry) => entry.controls).length, 19);
  assert.equal(logs.reduce((sum, entry) => sum + entry.seconds, 0), 382);
  for (const entry of [...toast, ...logs]) assert.ok(entry.seconds <= 250, `${entry.id}`);
});

// The seconds of a unit are the runner's: run 44929041191 (the run of #647), every row of every shard summary, a control's row being one run and a unit the sum of its rows.
test('the seconds of every unit are those of run 44929041191 (the run that measured the ten shards at 4,379 s), and the two units of L4, which that run did not have, are the runner\'s first run of #650', () => {
  const runs = JSON.parse(readFileSync(path.join(repo, 'scripts/ci/probe-shards.runs.json'), 'utf8'));
  const base = runs.find((entry) => entry.run === '44929041191').seconds;
  for (const entry of UNITS) {
    if (entry.id === 'logs-open') assert.equal(entry.seconds, 20);
    else if (entry.id === 'logs-open-controls') assert.equal(entry.seconds, 12);
    else assert.equal(entry.seconds, base[entry.id], `${entry.id}: the table says ${entry.seconds} s, run 44929041191 says ${base[entry.id]} s`);
  }
  assert.equal(Object.values(base).reduce((sum, seconds) => sum + seconds, 0), 4379);
});

test('the limit is the wall budget of a job less the setup of a slow job: 9 minutes less the 90th percentile (108 s) is 432 s, and it is not raised', () => {
  assert.equal(WALL_BUDGET_SECONDS, 9 * 60);
  assert.equal(SETUP_P90_SECONDS, 108);
  assert.equal(LIMIT_SECONDS, 432);
});

// Every unit the table names has an own script among its globs, and the fixtures that script opens are in them: a fixture is what a control perturbs, and a change to it must select the control.
const FIXTURE_NAME = /[a-z-]*fixture\.html/g;
test('the fixture pages a probe script opens (and the module each loads) are among the globs of every unit of that probe', () => {
  const directory = (script) => script.slice(0, script.lastIndexOf('/'));
  for (const entry of UNITS) {
    const text = readFileSync(path.join(repo, entry.script), 'utf8');
    const names = new Set([...text.matchAll(FIXTURE_NAME)].map((match) => match[0]).filter((name) => REAL_FILES.includes(`${directory(entry.script)}/${name}`)));
    for (const name of names) {
      const html = `${directory(entry.script)}/${name}`;
      const module = /src="\.\/([^"]+\.tsx?)"/.exec(readFileSync(path.join(repo, html), 'utf8'))?.[1];
      for (const file of [html, ...(module === undefined ? [] : [`${directory(entry.script)}/${module}`])]) {
        assert.ok([...entry.paths, entry.file].some((glob) => matches(glob, file)), `${entry.id} opens ${name} and no path of it covers ${file}`);
      }
    }
  }
});

test('every .mjs a probe script imports from its own directories is among the globs of its units or is the shared harness (a helper two families use is in SHARED_HARNESS and so runs every control)', () => {
  for (const entry of UNITS) {
    const text = readFileSync(path.join(repo, entry.script), 'utf8');
    const directory = entry.script.slice(0, entry.script.lastIndexOf('/'));
    for (const match of text.matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+\.mjs)['"]/g)) {
      const resolved = path.posix.normalize(`${directory}/${match[1]}`);
      const covered = SHARED_HARNESS.includes(resolved) || [...entry.paths, entry.file].some((glob) => matches(glob, resolved));
      assert.ok(covered, `${entry.id}: ${entry.script} imports ${resolved}, which no path of the unit covers and the shared harness does not list`);
    }
  }
});

test('every file of the shared harness exists, and every probe script imports at least one of them (so that "the harness changed" is a change to every probe)', () => {
  for (const file of SHARED_HARNESS) assert.ok(REAL_FILES.includes(file), file);
});

test('the declaration of a unit is not among scripts/ci that run every control: a pull request that adds a probe or a control selects its own controls only', () => {
  const selection = selectControls({ units: UNITS, changed: [`${UNITS_DIRECTORY}/form.mjs`], context: contextOf({ event: 'pull_request', attempt: '1' }) });
  assert.equal(selection.everything, false);
  assert.deepEqual(selection.units.filter((entry) => entry.controls && entry.run).map((entry) => entry.id), ['form-controls']);
});

test('the full run packs into the fewest shards the limit allows, and every unit is in one', () => {
  const shards = pack(UNITS.map((entry) => ({ id: entry.id, seconds: entry.seconds })), LIMIT_SECONDS);
  assert.equal(shards.length, lowerBound(UNITS, LIMIT_SECONDS));
  assert.deepEqual(shards.flatMap((shard) => shard.units.map((entry) => entry.id)).sort(), idsOf(UNITS).sort());
  for (const shard of shards) assert.ok(shard.seconds <= LIMIT_SECONDS);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The plan: which controls, which shards
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const PULL = contextOf({ event: 'pull_request', attempt: '1' });
const FULL = contextOf({ event: 'push', attempt: '1' });
const plan = (changed, context = PULL, units = UNITS) => planRun({ units, changed, context });
const unitsOfPlan = (result) => result.shards.flatMap((shard) => shard.units.map((entry) => entry.id));

test('a full run puts every unit in a shard; a pull request puts every probe in and only the controls its paths reach', () => {
  const full = plan(['docs/ui-next/TRACKER.md'], FULL);
  assert.deepEqual(unitsOfPlan(full).sort(), idsOf(UNITS).sort());
  const docs = plan(['docs/ui-next/decisions.md']);
  assert.deepEqual(unitsOfPlan(docs).sort(), UNITS.filter((entry) => entry.controls === undefined).map((entry) => entry.id).sort(), 'the probes and nothing else');
  const form = plan(['packages/kit/src/components/Field/Field.tsx']);
  assert.deepEqual(unitsOfPlan(form).sort(), [...UNITS.filter((entry) => entry.controls === undefined).map((entry) => entry.id), 'form-controls'].sort());
});

test('the shards of a plan are numbered from 1 by length, longest first, hold the sum of their units\' seconds, say whether one of their units reads the ui-next build, and none is over the limit', () => {
  const result = plan(['ui-next/shell/notices/Centre.tsx']);
  assert.deepEqual(result.shards.map((shard) => shard.shard), result.shards.map((_, index) => index + 1));
  const seconds = result.shards.map((shard) => shard.seconds);
  assert.deepEqual(seconds, [...seconds].sort((a, b) => b - a));
  for (const shard of result.shards) {
    assert.equal(shard.seconds, shard.units.reduce((sum, entry) => sum + entry.seconds, 0));
    assert.ok(shard.seconds <= LIMIT_SECONDS);
    assert.equal(shard.dist, shard.units.some((entry) => readsDist(byId(entry.id))));
  }
});

test('the matrix is the one line of JSON the workflow reads: `{ include: [{ shard, units, seconds, dist }] }`, the units as ids joined by commas, in shard order', () => {
  const result = plan(['ui-next/shell/notices/Centre.tsx']);
  const matrix = matrixOf(result.shards);
  assert.deepEqual(Object.keys(matrix), ['include']);
  assert.equal(matrix.include.length, result.shards.length);
  matrix.include.forEach((entry, index) => {
    assert.deepEqual(Object.keys(entry), ['shard', 'units', 'seconds', 'dist']);
    assert.equal(entry.shard, index + 1);
    assert.equal(typeof entry.dist, 'boolean');
    assert.match(entry.units, /^[a-z0-9]+(?:-[a-z0-9]+)*(?:,[a-z0-9]+(?:-[a-z0-9]+)*)*$/);
    assert.deepEqual(entry.units.split(','), result.shards[index].units.map((candidate) => candidate.id));
  });
  assert.equal(JSON.stringify(matrix).includes('\n'), false);
});

test('a pull request that changes only documentation starts fewer shards than a full run, and one that changes the harness starts as many', () => {
  const docs = plan(['docs/ui-next/TRACKER.md']);
  const full = plan([], FULL);
  const harness = plan(['ui-next/shell/probes/harness.mjs']);
  assert.ok(docs.shards.length < full.shards.length, `${docs.shards.length} against ${full.shards.length}`);
  assert.equal(harness.shards.length, full.shards.length);
  assert.deepEqual(unitsOfPlan(harness).sort(), idsOf(UNITS).sort());
});

test('the plan keeps the units each as they were declared (ids, seconds, env), so that a shard runs exactly what the table says', () => {
  const result = plan([], FULL);
  const seen = result.shards.flatMap((shard) => shard.units);
  for (const entry of seen) assert.deepEqual(entry, { id: entry.id, seconds: byId(entry.id).seconds });
});

test('the summary of a plan says the mode and why, every control unit with whether it runs and why, the seconds saved, the paths that decided it, the paths no unit declares, and the shards with their units', () => {
  const result = plan(['ui-next/shell/notices/Centre.tsx', 'ui-next/plugins/e2e/seam.check.mjs', 'docs/ui-next/decisions.md']);
  const text = renderPlan(result, { units: UNITS, changed: ['ui-next/shell/notices/Centre.tsx', 'ui-next/plugins/e2e/seam.check.mjs', 'docs/ui-next/decisions.md'] });
  assert.match(text, /^### Kit probes plan: pull request, controls by change$/m);
  assert.match(text, /^\| Control unit \| Seconds \| Result \| Why \|$/m);
  assert.match(text, /^\| notices-controls-centre \| 170 \| runs \| `changed: ui-next\/shell\/notices\/Centre\.tsx matches ui-next\/shell\/notices\/\*\*` \|$/m);
  assert.match(text, /^\| panel-controls-frame \| 215 \| skipped \| `no changed path matches its paths` \|$/m);
  assert.match(text, /\*\*\d+ s\*\* of controls skipped/);
  assert.match(text, /ui-next\/plugins\/e2e\/seam\.check\.mjs/);
  assert.match(text, /^\| Shard \| Seconds \| Units \|$/m);
  assert.match(text, /^\| 1 \| \d+ \| /m);
  const full = renderPlan(plan([], FULL), { units: UNITS, changed: [] });
  assert.match(full, /^### Kit probes plan: full run$/m);
  assert.match(full, /a push to main/);
  assert.doesNotMatch(full, /\| skipped \|/);
});

test('negative control: a path with a backtick, a newline or a workflow command in its name cannot end the summary\'s code span, start a line or write a command', () => {
  const hostile = 'ui-next/shell/x`\n::error::forged.tsx';
  const text = renderPlan(plan([hostile]), { units: UNITS, changed: [hostile] });
  assert.equal(/^::/m.test(text), false, 'no line of the summary is a workflow command');
  assert.equal(text.includes(hostile), false);
  for (const line of text.split('\n')) assert.equal((line.match(/`/g) ?? []).length % 2, 0, `a code span of the summary is closed on its line: ${line}`);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// One unit becomes runs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const VARS = { RUNNER_TEMP: '/tmp/runner', PROBE_DIST: '/tmp/runner/ui-next-dist' };

test('a unit is one run, with its env expanded from the runner environment', () => {
  const runs = expandUnit(unit('a', A, { env: { DIST: '$PROBE_DIST', REPORT: '${RUNNER_TEMP}/a-probe.json', FONT_DELAY_MS: '40' } }), VARS);
  assert.deepEqual(runs, [{ label: 'Unit a', script: A, control: null, env: { DIST: '/tmp/runner/ui-next-dist', REPORT: '/tmp/runner/a-probe.json', FONT_DELAY_MS: '40' } }]);
});

test('a unit with controls is one run for each, with NEGATIVE_CONTROL set to it and the unit env around it', () => {
  const runs = expandUnit(unit('a-controls', A, { env: { DIST: '$PROBE_DIST' }, controls: ['x', 'y'] }), VARS);
  assert.deepEqual(
    runs.map((run) => [run.label, run.script, run.control, run.env]),
    [
      ['Unit a-controls (x)', A, 'x', { DIST: '/tmp/runner/ui-next-dist', NEGATIVE_CONTROL: 'x' }],
      ['Unit a-controls (y)', A, 'y', { DIST: '/tmp/runner/ui-next-dist', NEGATIVE_CONTROL: 'y' }],
    ],
  );
});

test('negative control: a variable the runner has not set is an error that names the unit and the variable, never an empty path', () => {
  assert.throws(() => expandUnit(unit('a', A, { env: { REPORT: '$RUNNER_TEMP/a.json' } }), {}), /"Unit a".*\$RUNNER_TEMP is not set/);
  assert.throws(() => expandUnit(unit('a', A, { env: { DIST: '$PROBE_DIST' } }), { RUNNER_TEMP: '/t', PROBE_DIST: '' }), /\$PROBE_DIST is not set/);
});

test('a unit reads the ui-next build only when its env names $PROBE_DIST', () => {
  assert.equal(readsDist(unit('a', A, { env: { DIST: '$PROBE_DIST' } })), true);
  assert.equal(readsDist(unit('a', A, { env: { DIST: '${PROBE_DIST}/x' } })), true);
  assert.equal(readsDist(unit('a', A, { env: { REPORT: '$RUNNER_TEMP/a.json' } })), false);
  assert.equal(readsDist(unit('a', A)), false);
  assert.equal(readsDist(unit('a', A, { env: { DIST: '$PROBE_DIST_OTHER' } })), false);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Running a shard
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const PROBES = {
  'ui-next/shell/probes/ok-probe.mjs': "console.log('seen ' + JSON.stringify({ control: process.env.NEGATIVE_CONTROL ?? null, report: process.env.REPORT ?? null, font: process.env.FONT_DELAY_MS ?? null, cwd: process.cwd() }));\n",
  'ui-next/shell/probes/bad-probe.mjs': "console.log('about to fail'); console.error('check width differs by 3 px'); process.exit(3);\n",
  'ui-next/shell/probes/crash-probe.mjs': "throw new Error('the page did not load');\n",
  'ui-next/shell/probes/slow-probe.mjs': "await new Promise((resolve) => setTimeout(resolve, 1100)); console.log('slow');\n",
};
const OK = 'ui-next/shell/probes/ok-probe.mjs';
const BAD = 'ui-next/shell/probes/bad-probe.mjs';
const CRASH = 'ui-next/shell/probes/crash-probe.mjs';
const SLOW = 'ui-next/shell/probes/slow-probe.mjs';

const first = () => [unit('first', OK, { name: 'First fine', env: { REPORT: '$RUNNER_TEMP/ok.json', FONT_DELAY_MS: '40' } }), unit('then-bad', BAD, { name: 'Then bad' }), unit('control-runs', OK, { name: 'Control runs', controls: ['one', 'two'] })];

async function run(units, id, root) {
  const chunks = [];
  const results = await runShard(units, id, { root, env: { ...callerEnv(), RUNNER_TEMP: '/tmp/runner' }, out: (text) => chunks.push(text) });
  return { results, log: chunks.join('') };
}

test('a shard runs every run of every unit in order, each in its own process at the repository root with its own env, and the passing ones are folded in log groups', async () => {
  const root = scratch(PROBES);
  const units = first();
  units.splice(1, 1);
  const { results, log } = await run(units, '1', root);
  assert.deepEqual(results.map((result) => [result.label, result.ok]), [['First fine', true], ['Control runs (one)', true], ['Control runs (two)', true]]);
  assert.deepEqual(results.map((result) => result.unit), ['first', 'control-runs', 'control-runs'], 'each result carries the id of its unit');
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
  const { results, log } = await run(first(), '1', root);
  assert.deepEqual(results.map((result) => [result.label, result.ok]), [['First fine', true], ['Then bad', false], ['Control runs (one)', true], ['Control runs (two)', true]]);
  assert.equal(results[1].code, 3);
  assert.match(log, /^::error title=Kit probe failed \(shard 1\)::Then bad \[ui-next\/shell\/probes\/bad-probe\.mjs\] exited with code 3$/m);
  const failure = log.indexOf('::error title=Kit probe failed (shard 1)::Then bad');
  assert.ok(log.indexOf('::endgroup::', log.indexOf('::group::Then bad')) < failure, 'the error and the last lines come after the group closed, where a collapsed group does not hide them');
  const afterFailure = log.slice(failure);
  assert.match(afterFailure, /about to fail/);
  assert.match(afterFailure, /check width differs by 3 px/);
  assert.ok(log.indexOf('seen', failure) > failure, 'the controls after the failed unit ran');
});

test('negative control: a probe that throws (exit 1 with a stack) fails the shard like any other', async () => {
  const root = scratch(PROBES);
  const { results, log } = await run([unit('crashes', CRASH, { name: 'Crashes' })], '2', root);
  assert.deepEqual(results.map((result) => [result.label, result.ok, result.code]), [['Crashes', false, 1]]);
  assert.match(log, /the page did not load/);
  assert.match(log, /^::error title=Kit probe failed \(shard 2\)::Crashes \[ui-next\/shell\/probes\/crash-probe\.mjs\] exited with code 1$/m);
});

// A control may run in another shard than its probe, so the line that says it failed must name both: the probe's script, the control, and the step that holds it.
test('negative control: a control that fails, alone in its shard, is named with its probe\'s script, its own name and its step, in the error line and in the summary', async () => {
  const root = scratch(PROBES);
  const { results, log } = await run([unit('bad-controls', BAD, { name: 'Probe that bad sees', controls: ['frame', 'gap'] })], '3', root);
  assert.deepEqual(results.map((result) => [result.label, result.script, result.control, result.ok]), [
    ['Probe that bad sees (frame)', BAD, 'frame', false],
    ['Probe that bad sees (gap)', BAD, 'gap', false],
  ]);
  assert.match(log, /^::error title=Kit probe failed \(shard 3\)::Probe that bad sees \(frame\) \[ui-next\/shell\/probes\/bad-probe\.mjs, negative control frame\] exited with code 3$/m);
  const summary = renderSummary('3', results);
  assert.match(summary, /^\| \*\*fail\*\* \(exit 3\) \| \d+ \| ui-next\/shell\/probes\/bad-probe\.mjs \| frame \| Probe that bad sees \|$/m);
  assert.match(summary, /^\| \*\*fail\*\* \(exit 3\) \| \d+ \| ui-next\/shell\/probes\/bad-probe\.mjs \| gap \| Probe that bad sees \|$/m);
});

test('a script that is not there fails the run (the check names it first, this is the second wall)', async () => {
  const root = scratch(PROBES);
  const { results } = await run([unit('gone', 'ui-next/shell/probes/gone-probe.mjs', { name: 'Gone' })], '1', root);
  assert.deepEqual(results.map((result) => [result.label, result.ok]), [['Gone', false]]);
});

test('the summary of a shard counts runs and failures, one row each with its seconds, the probe script, the control (none for the probe itself) and the step, and says which failed and how', () => {
  const text = renderSummary('3', [
    { label: 'Probe a', script: A, control: null, ok: true, code: 0, seconds: 171 },
    { label: 'Probe that a sees (x)', script: A, control: 'x', ok: false, code: 3, seconds: 12 },
    { label: 'Probe that a sees (y)', script: A, control: 'y', ok: false, code: null, signal: 'SIGKILL', seconds: 1 },
  ]);
  assert.match(text, /^### Kit probes shard 3: 3 runs, 2 failed, 184 s$/m);
  assert.match(text, /^\| Result \| Seconds \| Probe \| Negative control \| Step \|$/m);
  assert.match(text, /^\| pass \| 171 \| packages\/kit\/probes\/a-probe\.mjs \|  \| Probe a \|$/m);
  assert.match(text, /^\| \*\*fail\*\* \(exit 3\) \| 12 \| packages\/kit\/probes\/a-probe\.mjs \| x \| Probe that a sees \|$/m);
  assert.match(text, /^\| \*\*fail\*\* \(SIGKILL\) \| 1 \| packages\/kit\/probes\/a-probe\.mjs \| y \| Probe that a sees \|$/m);
  assert.match(renderSummary('1', [{ label: 'Probe a', script: A, control: null, ok: true, code: 0, seconds: 4 }]), /^### Kit probes shard 1: 1 run, all passed, 4 s$/m);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The drift of a unit from its seconds (N25 step 4): it FAILS the shard, with the new number in the message
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const ran = (id, seconds, extra = {}) => ({ label: id, unit: id, script: A, control: null, ok: true, code: 0, seconds, ...extra });
const ranControl = (id, which, seconds, extra = {}) => ran(id, seconds, { label: `${id} (${which})`, control: which, ...extra });
const TABLE = [unit('big', A, { seconds: 400 }), unit('mid', A, { seconds: 100 }), unit('small', A, { seconds: 28 }), unit('controls', A, { seconds: 40, controls: ['x', 'y'] })];
const drift = (results) => driftFindings('4', results, TABLE);

test('the margin is a quarter of a unit\'s seconds or 60 s, whichever is more: a unit over its seconds by more fails, and the message names the unit, its file, the seconds it took, the seconds in the table and the number to put there', () => {
  assert.equal(DRIFT_RATIO, 0.25);
  assert.equal(DRIFT_FLOOR_SECONDS, 60);
  const { failures, warnings } = drift([ran('big', 520)]);
  assert.equal(warnings.length, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^::error title=Kit probe unit seconds \(shard 4\)::Unit big \(big\) took 520 s on this runner, 400 s in scripts\/ci\/probe-units\/big\.mjs \(\+120 s, 30 percent; a unit fails past a quarter and 60 s over\): put `seconds: 520` there/);
  assert.equal(failures[0].includes('\n'), false, 'a workflow command is one line');
});

test('negative control: at the margin, or under it, or faster, a unit does not fail (a slow run is not a drift): 500 of 400 s, 160 of 100 s, 88 of 28 s', () => {
  assert.deepEqual(drift([ran('big', 500)]).failures, [], 'a quarter of 400 is 100 s: exactly at it');
  assert.deepEqual(drift([ran('mid', 160)]).failures, [], 'a quarter of 100 is 25 s and the floor is 60: exactly at the floor');
  assert.deepEqual(drift([ran('small', 88)]).failures, [], '60 s over 28 s is 214 percent, and exactly at the floor');
  assert.equal(drift([ran('big', 501)]).failures.length, 1);
  assert.equal(drift([ran('mid', 161)]).failures.length, 1);
  assert.equal(drift([ran('small', 89)]).failures.length, 1);
  assert.deepEqual(drift([ran('big', 300), ran('mid', 60)]).failures, []);
});

test('a unit that got much faster only warns, past the same margin, and says the number to put there so that the planner can use the room', () => {
  const { failures, warnings } = drift([ran('big', 290), ran('mid', 70)]);
  assert.deepEqual(failures, []);
  assert.equal(warnings.length, 1, '400 s to 290 s is more than a quarter and 60 s faster; 100 s to 70 s is not');
  assert.match(warnings[0], /^::warning title=Kit probe unit seconds \(shard 4\)::Unit big \(big\) took 290 s on this runner, 400 s in scripts\/ci\/probe-units\/big\.mjs \(-110 s, 28 percent; a unit warns past a quarter and 60 s under\): put `seconds: 290` there/);
  assert.deepEqual(drift([ran('big', 300)]).warnings, [], 'a quarter of 400 is 100 s: exactly at it');
});

test('the drift of a unit is the sum of its runs: controls that are each close are one failure when together they are over the margin', () => {
  const rows = (a, b) => [ranControl('controls', 'x', a), ranControl('controls', 'y', b)];
  assert.deepEqual(drift(rows(40, 44)).failures, [], '84 s of 40: 44 s over, under the floor');
  const { failures } = drift(rows(60, 50));
  assert.equal(failures.length, 1, '110 s of 40 s is 70 s over, each of the two runs being only 20 s and 10 s over its share');
  assert.match(failures[0], /Unit controls \(controls\) took 110 s/);
});

test('negative control: a unit with a run that failed is left out (the seconds of a probe that stopped early or hung say nothing of its cost), and a unit the table does not have is named', () => {
  assert.deepEqual(drift([ran('big', 900, { ok: false, code: 1 })]), { failures: [], warnings: [], rows: [] });
  assert.deepEqual(drift([ranControl('controls', 'x', 5), ranControl('controls', 'y', 900, { ok: false, code: 3 })]).failures, []);
  const unknown = drift([ran('zzz', 12)]);
  assert.equal(unknown.failures.length, 1);
  assert.match(unknown.failures[0], /^::error title=Kit probe unit seconds \(shard 4\)::the unit "zzz" ran in this shard and is not in the table/);
});

test('each unit of a shard is judged on its own, in the order of the results, and a message with a percent sign, a CR or an LF in a name stays one workflow command line', () => {
  const two = drift([ran('big', 600), ran('mid', 100), ran('small', 90)]);
  assert.deepEqual(two.failures.map((line) => /::Unit (\w+) \(/.exec(line)?.[1]), ['big', 'small']);
  const odd = [unit('odd', A, { name: 'Probe 100%\nof it', seconds: 20 })];
  const [line] = driftFindings('1', [ran('odd', 100)], odd).failures;
  assert.equal(line.includes('\n'), false);
  assert.match(line, /Probe 100%25%0Aof it \(odd\) took 100 s/);
});

test('the rows of the drift are one for each unit: its seconds in the table, on this runner, and how far it moved', () => {
  const { rows } = drift([ran('big', 450), ranControl('controls', 'x', 20), ranControl('controls', 'y', 30)]);
  assert.deepEqual(rows, [
    { id: 'big', name: 'Unit big', file: 'scripts/ci/probe-units/big.mjs', table: 400, took: 450, delta: 50, verdict: 'ok' },
    { id: 'controls', name: 'Unit controls', file: 'scripts/ci/probe-units/controls.mjs', table: 40, took: 50, delta: 10, verdict: 'ok' },
  ]);
});

// The data: the seconds of every unit in seven recent runs of the probes on main and on pull requests, with the units as they are now (a control's rows added up by the unit that holds it). The table's seconds are those of the first
// (run 44929041191), so the other six runs are what a run that is not the one that measured it looks like: none may fail, and the one that came closest, 45 s over on a slow machine, is the reason for the floor of 60 s.
const RUNS = JSON.parse(readFileSync(path.join(repo, 'scripts/ci/probe-shards.runs.json'), 'utf8'));

test('main starts green: in seven real runs (4,364 to 4,471 s of units) no unit fails against the table\'s seconds, and the slowest machine of them, a shard of 620 s, is a warning at most', () => {
  assert.equal(RUNS.length, 7);
  let compared = 0;
  for (const entry of RUNS) {
    const results = Object.entries(entry.seconds).map(([id, seconds]) => ran(id, seconds));
    const { failures } = driftFindings('0', results, UNITS);
    assert.deepEqual(failures, [], `run ${entry.run}`);
    compared += results.length;
  }
  assert.ok(compared >= 7 * 33, `${compared} unit runs compared`);
});

test('negative control: the margin catches a real drift in those runs, not only a made-up one: the toast layer\'s controls of the day before the table (301 s against 384 s) and the form controls (20 s against 36 s) are not what it is for, a unit 30 percent over on a quiet run is', () => {
  const quiet = RUNS[0].seconds;
  const slowed = Object.entries(quiet).map(([id, seconds]) => ran(id, id === 'notices' ? Math.round(seconds * 1.3) : seconds));
  const { failures } = driftFindings('0', slowed, UNITS);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /Probe the toast layer against the pinned mock reference \(notices\) took 472 s/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command CI runs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const cli = (root, ...args) => spawnSync('node', [command, '--root', root, ...args], { encoding: 'utf8', env: { ...callerEnv(), GITHUB_ACTIONS: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' } });

const GIT = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
const git = (root, ...args) => spawnSync('git', ['-C', root, ...GIT, ...args], { encoding: 'utf8' });

/** The files a scratch tree needs for the real units to pass the check: every file a glob of a unit matches, every probe script, and the workflow. Empty ones: the check reads names, not text. */
const NEEDED = REAL_FILES.filter((file) => !file.startsWith(`${UNITS_DIRECTORY}/`) && (isProbeScript(file) || UNITS.some((entry) => [...entry.paths, entry.script].some((glob) => matches(glob, file)))));
let baseTree;

/** A scratch tree that holds the real units and the files of NEEDED, a workflow file and a Git history of one commit (built once; each test copies it). */
function treeOfTheUnits(change = []) {
  if (baseTree === undefined) {
    const files = { [WORKFLOW]: 'name: x\n' };
    for (const file of NEEDED) files[file] = '';
    baseTree = scratch(files);
    mkdirSync(path.join(baseTree, UNITS_DIRECTORY), { recursive: true });
    for (const name of readdirSync(path.join(repo, UNITS_DIRECTORY))) writeFileSync(path.join(baseTree, UNITS_DIRECTORY, name), readFileSync(path.join(repo, UNITS_DIRECTORY, name)));
    git(baseTree, 'init', '-q', '-b', 'main');
    git(baseTree, 'add', '-A');
    git(baseTree, 'commit', '-q', '-m', 'base');
  }
  const root = mkdtempSync(path.join(tmpdir(), 'probe-shards-'));
  roots.push(root);
  assert.equal(spawnSync('cp', ['-R', `${baseTree}/.`, root]).status, 0);
  // HEAD^1 is the base and HEAD the merge commit a pull request is checked out as.
  for (const file of change) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `changed ${file}\n`);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'change');
  return root;
}

test('the plan command on a pull request writes the matrix and the summary: the controls its paths reach, the probes, and the shards that hold them', () => {
  const root = treeOfTheUnits(['ui-next/shell/notices/Centre.tsx']);
  const output = path.join(root, 'github-output');
  const summary = path.join(root, 'summary.md');
  const result = spawnSync('node', [command, '--root', root, 'plan', '--base', 'HEAD^1'], { encoding: 'utf8', env: { ...callerEnv(), GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary } });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const written = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const matrix = JSON.parse(written.matrix);
  const planned = matrix.include.flatMap((entry) => entry.units.split(','));
  assert.ok(planned.includes('notices-controls-centre') && planned.includes('notices-controls-toast'), planned.join(','));
  assert.equal(planned.includes('panel-controls-frame'), false);
  assert.ok(planned.includes('panel'), 'every probe runs');
  assert.equal(written.mode, 'by-change');
  assert.equal(Number(written.shards), matrix.include.length);
  assert.match(readFileSync(summary, 'utf8'), /^### Kit probes plan: pull request, controls by change$/m);
  assert.match(result.stdout, /controls by change/);
});

test('NEGATIVE: the plan command on a push, a schedule, a dispatch, a merge queue run and a re-run is a full run; so is a pull request whose diff Git cannot give', () => {
  const root = treeOfTheUnits(['ui-next/shell/notices/Centre.tsx']);
  const full = (env, ...args) => {
    const output = path.join(root, `out-${Math.random().toString(16).slice(2)}`);
    const result = spawnSync('node', [command, '--root', root, 'plan', ...args], { encoding: 'utf8', env: { ...callerEnv(), GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: output, ...env } });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const matrix = JSON.parse(readFileSync(output, 'utf8').split('\n').find((line) => line.startsWith('matrix=')).slice('matrix='.length));
    return { planned: matrix.include.flatMap((entry) => entry.units.split(',')), stdout: result.stdout };
  };
  for (const event of ['push', 'schedule', 'workflow_dispatch', 'merge_group']) {
    assert.deepEqual(full({ GITHUB_EVENT_NAME: event }, '--base', 'HEAD^1').planned.sort(), idsOf(UNITS).sort(), event);
  }
  assert.deepEqual(full({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ATTEMPT: '2' }, '--base', 'HEAD^1').planned.sort(), idsOf(UNITS).sort(), 're-run');
  const unreadable = full({ GITHUB_EVENT_NAME: 'pull_request' }, '--base', 'no-such-ref');
  assert.deepEqual(unreadable.planned.sort(), idsOf(UNITS).sort(), 'a diff that cannot be read');
  assert.match(unreadable.stdout, /could not be read/);
  assert.deepEqual(full({}, '--base', 'HEAD^1').planned.sort(), idsOf(UNITS).sort(), 'no event at all');
  const push = spawnSync('node', [command, '--root', root, 'plan', '--base', 'no-such-ref'], { encoding: 'utf8', env: { ...callerEnv(), GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1' } });
  assert.equal(push.status, 0, push.stderr);
  assert.equal(push.stderr, '', 'a run that is full anyway does not ask Git what changed, and says nothing of a base it cannot read');
});

test('a dispatch that lists changed paths rehearses the pull request that would change them: the same selection, said to be a rehearsal; an empty list is a full run', () => {
  const root = treeOfTheUnits();
  const plan = (changed) => {
    const output = path.join(root, `out-${Math.random().toString(16).slice(2)}`);
    const result = spawnSync('node', [command, '--root', root, 'plan'], { encoding: 'utf8', env: { ...callerEnv(), GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: output, CHANGED_PATHS: changed } });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const matrix = JSON.parse(readFileSync(output, 'utf8').split('\n').find((line) => line.startsWith('matrix=')).slice('matrix='.length));
    return { planned: matrix.include.flatMap((entry) => entry.units.split(',')), stdout: result.stdout };
  };
  const rehearsal = plan('packages/kit/src/log/time.ts\npackages/kit/src/log/logViewModel.ts\nscripts/ci/probe-units/logs-open.mjs\n');
  assert.match(rehearsal.stdout, /rehearsal/);
  assert.ok(rehearsal.planned.includes('logs-open-controls') && rehearsal.planned.includes('log-controls'));
  assert.equal(rehearsal.planned.includes('notices-controls-toast'), false);
  assert.deepEqual(plan('  \n').planned.sort(), idsOf(UNITS).sort());
});

test('the check passes on a tree that holds the scripts, the units and a workflow, and fails, naming the file, on a probe file nobody runs', () => {
  const root = treeOfTheUnits();
  const result = cli(root, 'check');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /probe-shards: ok \(\d+ units, \d+ control units, \d+ probe scripts, \d+ by hand\)/);
  writeFileSync(path.join(root, 'ui-next/shell/probes/forgotten-probe.mjs'), '');
  const plain = cli(root, 'check');
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /probe-shards: ui-next\/shell\/probes\/forgotten-probe\.mjs is a probe script and no unit runs it/);
  const annotated = spawnSync('node', [command, '--root', root, 'check'], { encoding: 'utf8', env: { ...callerEnv(), GITHUB_ACTIONS: 'true' } });
  assert.equal(annotated.status, 1);
  assert.match(annotated.stdout, /^::error file=ui-next\/shell\/probes\/forgotten-probe\.mjs,title=Kit probe is in no unit::/m);
});

test('a command that is not one, a run with no shard or no units, or a unit that is not in the table is a usage error (exit 2) that says what there is', () => {
  const root = treeOfTheUnits();
  const nothing = cli(root);
  assert.equal(nothing.status, 2);
  assert.match(nothing.stderr, /usage: node scripts\/ci\/probe-shards\.mjs/);
  assert.equal(cli(root, 'run', '1').status, 2);
  assert.equal(cli(root, 'bogus').status, 2);
  const unknown = cli(root, 'run', '1', 'form,no-such-unit');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /no unit "no-such-unit" \(the units are /);
  assert.equal(cli(root, 'run', '1', '').status, 2);
});

test('the run command exits 1 when a probe of the shard fails and 0 when every probe passes, and appends the summary to $GITHUB_STEP_SUMMARY', () => {
  // The real units in a scratch tree where every probe is a script that exits at once: the panel probe with 5, the others with 0.
  const files = {};
  for (const entry of UNITS) files[entry.script] = entry.script.endsWith('panel-probe.mjs') ? 'process.exit(5);\n' : 'process.exit(0);\n';
  for (const name of readdirSync(path.join(repo, UNITS_DIRECTORY))) files[`${UNITS_DIRECTORY}/${name}`] = readFileSync(path.join(repo, UNITS_DIRECTORY, name), 'utf8');
  const root = scratch(files);
  const summary = path.join(root, 'summary.md');
  const env = { ...callerEnv(), RUNNER_TEMP: root, PROBE_DIST: path.join(root, 'dist'), GITHUB_STEP_SUMMARY: summary, GITHUB_ACTIONS: '' };
  const failing = spawnSync('node', [command, '--root', root, 'run', '1', 'panel,rail'], { encoding: 'utf8', env });
  assert.equal(failing.status, 1, failing.stdout + failing.stderr);
  assert.match(readFileSync(summary, 'utf8'), /### Kit probes shard 1: 2 runs, 1 failed/);
  const passing = spawnSync('node', [command, '--root', root, 'run', '2', 'rail,shell'], { encoding: 'utf8', env });
  assert.equal(passing.status, 0, passing.stdout + passing.stderr);
  assert.match(readFileSync(summary, 'utf8'), /### Kit probes shard 2: 2 runs, all passed/);
});

test('the run command fails the shard when a unit drifted from its seconds, even though every probe passed, and names the unit and the number to put in the table', async () => {
  const root = scratch(PROBES);
  const table = [unit('slow', SLOW, { name: 'Slow probe', seconds: 0 })];
  const chunks = [];
  const code = await main(['--root', root, 'run', '1', 'slow'], { units: table, env: { ...callerEnv(), RUNNER_TEMP: '/tmp/runner' }, out: (text) => chunks.push(text), err: (text) => chunks.push(text), margin: { ratio: 0, floor: 0 } });
  const log = chunks.join('');
  assert.equal(code, 1, log);
  assert.match(log, /^### Kit probes shard 1: 1 run, all passed, 1 s$/m);
  assert.match(log, /^::error title=Kit probe unit seconds \(shard 1\)::Slow probe \(slow\) took 1 s on this runner, 0 s in/m);
  const quiet = [];
  const fine = await main(['--root', root, 'run', '1', 'slow'], { units: table, env: { ...callerEnv(), RUNNER_TEMP: '/tmp/runner' }, out: (text) => quiet.push(text), err: (text) => quiet.push(text) });
  assert.equal(fine, 0, quiet.join(''));
  assert.doesNotMatch(quiet.join(''), /::error/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The workflow
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const stepsOf = (job) => workflow.jobs[job].steps;

test('the plan job is the first job, runs on a plain runner, reads two commits of Git, installs the pinned Node from .tool-versions, checks the table, and writes the matrix the shards read', () => {
  const job = workflow.jobs.plan;
  assert.equal(job.name, 'Kit probes plan');
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] <= 10);
  assert.equal(job.needs, undefined, 'nothing is before it');
  assert.equal(job.container, undefined, 'it does not pull the CI image: it is on the critical path of every shard');
  assert.match(job.outputs.matrix, /steps\.plan\.outputs\.matrix/);
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], 2, 'HEAD^1 is the base of the merge commit a pull request is checked out as');
  assert.equal(checkout.with['persist-credentials'], false);
  const node = job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(node.with['node-version-file'], '.tool-versions', 'one home for the Node pin');
  assert.equal(node.with['node-version'], undefined);
  const planStep = job.steps.find((step) => step.id === 'plan');
  assert.match(planStep.run, /node scripts\/ci\/probe-shards\.mjs check/);
  assert.match(planStep.run, /node scripts\/ci\/probe-shards\.mjs plan --base HEAD\^1/);
  assert.ok(planStep.run.indexOf('probe-shards.mjs check') < planStep.run.indexOf('probe-shards.mjs plan'), 'the check first');
  assert.equal(planStep.env.CHANGED_PATHS, '${{ github.event.inputs.changed_paths }}', 'a dispatch input reaches the script through env, never into the shell text');
  assert.equal(job.steps.every((step) => !/\$\{\{[^}]*(?:inputs|github\.event\.pull_request\.title|head_ref)/.test(step.run ?? '')), true, 'no expression of anything a person typed is put in a command');
});

test('the shard job needs the plan, takes its matrix from the plan\'s output, none stops the others, each has a limit, and the file names its probes only through the table', () => {
  const job = workflow.jobs.shard;
  assert.equal(job.needs, 'plan');
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job.strategy.matrix, '${{ fromJSON(needs.plan.outputs.matrix) }}');
  assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0);
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.match(job.name, /^Kit probes shard \$\{\{ matrix\.shard \}\}$/);
  const commands = stepsOf('shard').map((step) => step.run ?? '').join('\n');
  assert.match(commands, /node scripts\/ci\/probe-shards\.mjs check/);
  assert.match(commands, /node --test scripts\/ci\/probe-\*\.test\.mjs/);
  assert.match(commands, /node scripts\/ci\/probe-shards\.mjs run "\$SHARD" "\$UNITS"/);
  assert.doesNotMatch(commands, /node (packages\/kit\/probes|ui-next\/(shell|page)\/probes)\//, 'a probe run from the workflow file is a probe no table knows');
  const runStep = stepsOf('shard').find((step) => step.run?.includes('probe-shards.mjs run'));
  assert.equal(runStep.env.SHARD, '${{ matrix.shard }}');
  assert.equal(runStep.env.UNITS, '${{ matrix.units }}');
  assert.equal(/\$\{\{ *matrix\./.test(runStep.run), false, 'the matrix reaches the command through env');
});

test('the workflow starts for the units, the engine and the table\'s tests, runs on main, every night and by hand, and the dispatch takes an optional list of changed paths', () => {
  assert.equal(workflow.env.OMNIVIEW_UI, 'next');
  assert.equal(workflow.env.NODE_VERSION, undefined, 'Node is the image\'s, checked against .tool-versions by the guard step: a second pin here is a second home');
  for (const event of ['pull_request', 'push']) {
    const paths = workflow.on[event].paths;
    for (const entry of ['packages/kit/**', 'ui-next/**', 'packages/omniviewdev-runtime/**', 'pnpm-lock.yaml', '.github/workflows/ui-next-kit-probes.yml', 'scripts/ci/probe-shards.mjs', 'scripts/ci/probe-shards.test.mjs', 'scripts/ci/probe-*', 'scripts/ci/probe-units/**', 'scripts/ci/changes.mjs', 'scripts/ci/check-image.mjs']) {
      assert.ok(paths.includes(entry), `${event} paths lack ${entry}`);
    }
    // `scripts/ci/probe-*` is the engine's modules, their tests and their data: a change to any of them starts the run that tests it.
    for (const file of ['scripts/ci/probe-select.mjs', 'scripts/ci/probe-pack.mjs', 'scripts/ci/probe-select.test.mjs', 'scripts/ci/probe-pack.test.mjs', 'scripts/ci/probe-select.prs.json', 'scripts/ci/probe-shards.runs.json']) {
      assert.ok(paths.some((glob) => matches(glob, file)), `${event} does not start for ${file}`);
    }
  }
  assert.equal(workflow.on.push.branches[0], 'main');
  assert.equal(workflow.on.schedule.length, 1, 'one nightly run');
  assert.match(workflow.on.schedule[0].cron, /^\d{1,2} \d{1,2} \* \* \*$/, 'every day, at a minute that is not the hour (the top of the hour is when GitHub drops scheduled runs)');
  assert.notEqual(workflow.on.schedule[0].cron.split(' ')[0], '0');
  assert.equal(workflow.on.workflow_dispatch.inputs.changed_paths.required, false);
  assert.equal(workflow.on.workflow_dispatch.inputs.changed_paths.default, '');
});

test('a push to main and the nightly run are never cancelled by another: only a pull request is, by a newer push to it (a commit\'s only full run is not thrown away), and every other run has a group of its own', () => {
  assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
  assert.equal(
    workflow.concurrency.group,
    "ui-next-kit-probes-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
    'the group of a pull request is its number; any other run has the id of the run in its group',
  );
  // What GitHub makes of that expression, for the events that matter.
  const group = (event, number, runId) => `ui-next-kit-probes-${event === 'pull_request' ? `pr-${number}` : `run-${runId}`}`;
  assert.equal(group('pull_request', 7, 100), group('pull_request', 7, 101), 'two runs of one pull request share a group, and the older is cancelled');
  assert.notEqual(group('pull_request', 7, 100), group('pull_request', 8, 100), 'two pull requests do not');
  assert.notEqual(group('push', 0, 100), group('push', 0, 101), 'two pushes to main do not: neither waits for the other or replaces it');
  assert.notEqual(group('schedule', 0, 100), group('workflow_dispatch', 0, 101), 'nor does the nightly run share one with a dispatch');
});

// The image (N24 B1): the shards run in the CI image by DIGEST, as `.github/ci/image.lock` pins it, with the credentials of a private package, and ask the guard whether it is the image of this checkout before they do anything
// else; the browser install (and its retry loop), the browser cache and the tool setup the image provides are gone. `imageProblems` says what a workflow lacks, one sentence each.
const lock = JSON.parse(readFileSync(path.join(repo, '.github/ci/image.lock'), 'utf8'));
const GUARD = /node scripts\/ci\/check-image\.mjs check --manifest \/opt\/ci\/manifest\.json/;
const IMAGE_PROVIDES = [/^actions\/setup-node@/, /^pnpm\/setup@/, /^arduino\/setup-task@/, /^actions\/setup-go@/];

function imageProblems(wf, pinned) {
  const problems = [];
  const job = wf.jobs.shard;
  const want = `${pinned.image}@${pinned.digest}`;
  if (job.container?.image !== want) problems.push(`the shard job pulls ${job.container?.image ?? 'no container'}, not ${want} (the digest of .github/ci/image.lock)`);
  if (job.container?.credentials?.username !== '${{ github.actor }}' || job.container?.credentials?.password !== '${{ secrets.GITHUB_TOKEN }}') problems.push('the container has no credentials block: the package is private');
  if (!String(job.container?.options ?? '').split(/\s+/).includes('--init')) problems.push('the container does not run with --init');
  if (job.permissions?.packages !== 'read' || job.permissions?.contents !== 'read') problems.push('the shard job does not hold packages: read (and contents: read): the token cannot pull a private package');
  const steps = job.steps;
  if (!/^chown "\$\(id -u\):\$\(id -g\)" "\$PWD"$/.test(steps[0]?.run ?? '')) problems.push('the first step is not the checkout directory ownership fix of the other container jobs');
  if (!steps[1]?.uses?.startsWith('actions/checkout@')) problems.push('the second step is not the checkout');
  const guard = steps.findIndex((step) => GUARD.test(step.run ?? ''));
  const install = steps.findIndex((step) => /pnpm install/.test(step.run ?? ''));
  if (guard === -1) problems.push('no step runs the guard against /opt/ci/manifest.json');
  else if (guard > 3 || guard > install) problems.push('the guard runs after the dependencies are installed or later than the fourth step: the image must be proven right first');
  for (const step of steps) {
    const label = step.name ?? step.uses ?? step.run?.split('\n')[0];
    if (IMAGE_PROVIDES.some((pattern) => pattern.test(step.uses ?? ''))) problems.push(`the step "${label}" sets up a tool the image holds`);
    if (/playwright install|--with-deps|apt-get|\bsudo\b/.test(step.run ?? '')) problems.push(`the step "${label}" installs what the image holds`);
    if (String(step.with?.path ?? '').includes('ms-playwright')) problems.push(`the step "${label}" caches browsers the image holds`);
  }
  return problems;
}

test('every shard runs in the CI image by digest, with the credentials, and proves it is the image of this checkout before anything else; nothing the image holds is installed again', () => {
  assert.deepEqual(imageProblems(workflow, lock), []);
});

test('negative control: the image contract names a tag, another digest, a missing credentials block, missing permissions, a late guard and every install the image replaces', () => {
  const copy = () => structuredClone(workflow);
  const mutate = (change) => {
    const wf = copy();
    change(wf.jobs.shard);
    return imageProblems(wf, lock).join('\n');
  };
  const zero = `sha256:${'0'.repeat(64)}`;
  assert.ok(mutate((job) => { job.container.image = `${lock.image}:ubuntu24-v1`; }).includes(`pulls ${lock.image}:ubuntu24-v1, not ${lock.image}@${lock.digest}`));
  assert.ok(mutate((job) => { job.container.image = `${lock.image}@${zero}`; }).includes(`pulls ${lock.image}@${zero}, not ${lock.image}@${lock.digest}`));
  assert.match(mutate((job) => { delete job.container.credentials; }), /no credentials block/);
  assert.match(mutate((job) => { job.container.options = ''; }), /--init/);
  assert.match(mutate((job) => { delete job.permissions.packages; }), /packages: read/);
  assert.match(mutate((job) => { job.steps = job.steps.filter((step) => !GUARD.test(step.run ?? '')); }), /no step runs the guard/);
  assert.match(mutate((job) => { const at = job.steps.findIndex((step) => GUARD.test(step.run ?? '')); job.steps.push(...job.steps.splice(at, 1)); }), /the guard runs after/);
  assert.match(mutate((job) => { job.steps.shift(); }), /ownership fix/);
  assert.match(mutate((job) => { job.steps.splice(2, 0, { name: 'Node', uses: 'actions/setup-node@v4' }); }), /sets up a tool the image holds/);
  assert.match(mutate((job) => { job.steps.splice(2, 0, { name: 'pnpm', uses: 'pnpm/setup@fa36a5ef7dcdefc3a7cb25655c122e00cf6e636e' }); }), /sets up a tool the image holds/);
  assert.match(mutate((job) => { job.steps.splice(2, 0, { name: 'Task', uses: 'arduino/setup-task@v2' }); }), /sets up a tool the image holds/);
  assert.match(mutate((job) => { job.steps.splice(2, 0, { name: 'Install the browsers', run: 'pnpm exec playwright install --with-deps chromium webkit' }); }), /installs what the image holds/);
  assert.match(mutate((job) => { job.steps.splice(2, 0, { name: 'libs', run: 'sudo apt-get install -y libx' }); }), /installs what the image holds/);
  assert.match(mutate((job) => { job.steps.splice(2, 0, { name: 'Cache the browsers', uses: 'actions/cache@v4', with: { path: '~/.cache/ms-playwright', key: 'k' } }); }), /caches browsers the image holds/);
});

test('every shard builds the packages and, when a unit of it reads it, ui-next (the plan says whether: `matrix.dist`)', () => {
  assert.ok(stepsOf('shard').some((step) => step.run?.includes('task packages')));
  const build = stepsOf('shard').find((step) => step.run?.includes('vite build'));
  assert.equal(build.if, 'matrix.dist == true');
  assert.match(build.run, /PROBE_DIST=\$RUNNER_TEMP\/ui-next-dist/);
});

test('the reports are kept per shard, under a name of their own, so that no shard uploads over another', () => {
  const upload = stepsOf('shard').find((step) => step.uses?.startsWith('actions/upload-artifact'));
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.name, 'kit-probe-reports-${{ matrix.shard }}');
});

test('the check named `Kit probes` is the aggregating job: the only job of that name, after the plan and every shard, run unless the whole run was cancelled, and no shard is called that', () => {
  const named = Object.entries(workflow.jobs).filter(([, job]) => job.name === 'Kit probes');
  assert.deepEqual(named.map(([id]) => id), ['probes']);
  const aggregator = workflow.jobs.probes;
  assert.deepEqual([...aggregator.needs].sort(), ['plan', 'shard']);
  assert.equal(aggregator.if, '${{ !cancelled() }}');
  assert.equal(aggregator.permissions.actions, 'read');
  assert.equal(stepsOf('probes').length, 1, 'the verdict is one step: nothing that can fail before it can decide it');
  assert.equal(stepsOf('probes')[0].env.PLAN_RESULT, '${{ needs.plan.result }}');
  assert.equal(stepsOf('probes')[0].env.SHARD_RESULT, '${{ needs.shard.result }}');
  assert.equal(stepsOf('probes')[0].env.EVENT, '${{ github.event_name }}');
});

// The gate: the `run:` of the aggregating job, executed by bash as the runner does (`bash -e <file>`), with `gh` replaced by a stand-in that answers from a canned job list through the real jq filter.
const gateScript = () => stepsOf('probes')[0].run;
const JOBS = {
  jobs: [
    { name: 'Kit probes plan', status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/9/job/0' },
    { name: 'Kit probes shard 1', status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/9/job/1' },
    { name: 'Kit probes shard 2', status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/9/job/2' },
    { name: 'Kit probes shard 3', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/o/r/actions/runs/9/job/3' },
    { name: 'Kit probes shard 4', status: 'completed', conclusion: 'cancelled', html_url: 'https://github.com/o/r/actions/runs/9/job/4' },
    { name: 'Kit probes shard 5', status: 'completed', conclusion: 'skipped', html_url: 'https://github.com/o/r/actions/runs/9/job/5' },
    { name: 'Kit probes', status: 'in_progress', conclusion: null, html_url: 'https://github.com/o/r/actions/runs/9/job/6' },
  ],
};

function gate({ plan: planResult = 'success', shard = 'success', event = 'pull_request' } = {}, { jobs = JOBS, ghFails = false, noGh = false } = {}) {
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
    PLAN_RESULT: planResult,
    SHARD_RESULT: shard,
    EVENT: event,
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

test('the aggregator passes when the plan and every shard succeeded', () => {
  const outcome = gate();
  assert.equal(outcome.status, 0, outcome.output);
  assert.equal(outcome.called, '', 'a green run does not need the job list');
});

for (const result of ['failure', 'cancelled', 'skipped', '', 'startup_failure']) {
  test(`negative control: the aggregator fails when the shards finished as ${result === '' ? 'nothing at all' : result}`, () => {
    const outcome = gate({ shard: result });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, new RegExp(`^::error title=Kit probes::the probe shards finished as '${result === '' ? 'unknown' : result}'`, 'm'));
  });
}

test('negative control: the aggregator fails when the plan did not succeed, whatever the shards did (they are skipped without a plan), and says that the plan is the one', () => {
  for (const result of ['failure', 'cancelled', 'skipped', '', 'startup_failure']) {
    const outcome = gate({ plan: result, shard: 'skipped' });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, new RegExp(`^::error title=Kit probes::the plan job finished as '${result === '' ? 'unknown' : result}', not as success: no shard could run`, 'm'));
  }
  assert.equal(gate({ plan: 'failure', shard: 'success' }).status, 1, 'a green shard result does not hide a plan that failed');
});

test('negative control: the aggregator names every shard that did not succeed, with how it ended and where, and none that did', () => {
  const outcome = gate({ shard: 'failure' });
  assert.equal(outcome.status, 1, outcome.output);
  assert.match(outcome.output, /^::error title=Kit probes::Kit probes shard 3 finished as failure: https:\/\/github\.com\/o\/r\/actions\/runs\/9\/job\/3$/m);
  assert.match(outcome.output, /^::error title=Kit probes::Kit probes shard 4 finished as cancelled: /m);
  assert.match(outcome.output, /^::error title=Kit probes::Kit probes shard 5 finished as skipped: /m);
  assert.doesNotMatch(outcome.output, /shard 1 finished|shard 2 finished/);
  assert.doesNotMatch(outcome.output, /::error title=Kit probes::Kit probes finished/, 'the aggregator does not blame itself');
  assert.doesNotMatch(outcome.output, /Kit probes plan finished/, 'the plan job is not a shard');
  assert.match(outcome.called, /^gh api repos\/o\/r\/actions\/runs\/9\/attempts\/2\/jobs/m, 'it reads the jobs of this attempt of this run');
});

test('negative control: the aggregator is red even when the job list cannot be read or gh is missing, and says so', () => {
  for (const options of [{ ghFails: true }, { noGh: true }]) {
    const outcome = gate({ shard: 'failure' }, options);
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, /^::error title=Kit probes::the probe shards finished as 'failure'/m);
    assert.match(outcome.output, /^::warning title=Kit probes::could not list the shards of this run/m);
  }
});

test('a failure on main or in the nightly run says so in words of its own (the full run found something a pull request did not look for), and a failure on a pull request does not', () => {
  for (const event of ['push', 'schedule', 'workflow_dispatch']) {
    const outcome = gate({ shard: 'failure', event });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, /^::error title=Kit probes \(full run\)::a push to main, the nightly run or a dispatch failed: these runs check every probe and every control/m, event);
  }
  const pull = gate({ shard: 'failure', event: 'pull_request' });
  assert.doesNotMatch(pull.output, /full run/);
});

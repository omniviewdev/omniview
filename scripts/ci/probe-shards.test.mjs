// The kit probes' units and their runner (scripts/ci/probe-shards.mjs): the table of units (one small file for each probe in scripts/ci/probe-units), the manifest that is its floor, the check that makes a forgotten probe and a
// dropped control a failure, the plan that packs EVERY unit into the fewest shards at run time (a plan of no shard is an error), the runner of a shard (a unit that drifts from its seconds fails it, and so does a shard past its
// ceiling), what each shard reports it ran, the verification of the whole run, and the contract of the workflow that fans the shards out (.github/workflows/ui-next-kit-probes.yml), including the job named `Kit probes`.
//
// Every "negative control" below feeds a check the mistake it exists for and asserts the check names it; each was also seen to go red with its check taken out (docs/ui-next/status/N24-K1.md, N25.md).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { lowerBound, pack } from './probe-pack.mjs';
import * as engine from './probe-shards.mjs';
import {
  BY_HAND,
  DRIFT_FLOOR_SECONDS,
  DRIFT_RATIO,
  LIMIT_SECONDS,
  MANIFEST,
  PROBE_DIRS,
  SETUP_P90_SECONDS,
  SHARD_CEILING_SECONDS,
  UNITS_DIRECTORY,
  WALL_BUDGET_SECONDS,
  WORKFLOW,
  checkUnits,
  driftFindings,
  expandUnit,
  findProbeScripts,
  isProbeScript,
  loadManifest,
  loadUnits,
  main,
  matrixOf,
  planRun,
  ranReport,
  readReports,
  readsDist,
  renderPlan,
  renderSummary,
  runShard,
  shardBuildCache,
  verifyRan,
} from './probe-shards.mjs';
import { parseBuilds } from './probe-builds.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const command = fileURLToPath(new URL('./probe-shards.mjs', import.meta.url));
const workflowText = readFileSync(path.join(repo, WORKFLOW), 'utf8');
const workflow = parse(workflowText);

// The environment a test hands to a child: the caller's, minus every variable a probe or this runner reads (a developer runs the probes with FONT_DELAY_MS=40 exported, AGENTS.md rule 17) and every one GitHub sets, so that what
// a test asserts does not depend on the shell it runs from.
const PROBE_VARIABLES = ['FONT_DELAY_MS', 'NEGATIVE_CONTROL', 'REPORT', 'DIST', 'PROBE_DIST', 'FIXTURE_DIST', 'FIXTURE_DIST_DEV', 'BUILD_CACHE', 'RUNNER_TEMP', 'GITHUB_ACTIONS', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY'];
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

const unit = (id, script, extra = {}) => ({ id, name: `Unit ${id}`, script, seconds: 40, file: `${UNITS_DIRECTORY}/${id}.mjs`, ...extra });
const messages = (problems) => problems.map((problem) => problem.message);
const sum = (list, pick = (entry) => entry) => list.reduce((total, entry) => total + pick(entry), 0);
const idsOf = (list) => list.map((entry) => entry.id);

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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The table is a directory of small files
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const UNIT_FILE = (units) => `export const units = ${JSON.stringify(units)};\n`;

test('every .mjs file of the units directory is read, in name order, and each unit is told which file declares it', async () => {
  const root = scratch({
    [`${UNITS_DIRECTORY}/b.mjs`]: UNIT_FILE([{ id: 'b', name: 'B', script: 'x', seconds: 1 }]),
    [`${UNITS_DIRECTORY}/a.mjs`]: UNIT_FILE([{ id: 'a1', name: 'A1', script: 'x', seconds: 1 }, { id: 'a2', name: 'A2', script: 'x', seconds: 1 }]),
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
    [`${UNITS_DIRECTORY}/entry.mjs`]: 'export const units = [null];\n',
    [`${UNITS_DIRECTORY}/notes.json`]: '{}',
    [`${UNITS_DIRECTORY}/ok.mjs`]: UNIT_FILE([{ id: 'ok', name: 'Ok', script: 'x', seconds: 1 }]),
  });
  const { units, problems } = await loadUnits(root);
  assert.deepEqual(units.map((entry) => entry.id), ['ok']);
  const said = messages(problems).join('\n');
  assert.match(said, /scripts\/ci\/probe-units\/broken\.mjs does not load/);
  assert.match(said, /scripts\/ci\/probe-units\/empty\.mjs exports no `units`/);
  assert.match(said, /scripts\/ci\/probe-units\/object\.mjs: `units` is not a list/);
  assert.match(said, /scripts\/ci\/probe-units\/none\.mjs declares no unit/);
  assert.match(said, /scripts\/ci\/probe-units\/entry\.mjs: unit 1 is not an object/);
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
const D = 'ui-next/page/probes/d-probe.mjs';
const small = () => [unit('a', A, { env: { REPORT: '$RUNNER_TEMP/a-probe.json' } }), unit('a-controls', A, { controls: ['x', 'y'], plants: 'page' }), unit('b', B)];
const FOUND = [A, B, C];
const FLOOR = { [A]: { probe: true, controls: ['x', 'y'] }, [B]: { probe: true, controls: [] } };
const check = (changes = {}) => checkUnits({ units: small(), byHand: [{ script: C, reason: 'run by hand' }], found: FOUND, exists: () => true, manifest: FLOOR, ...changes });

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
  split.splice(2, 0, unit('a-controls-more', A, { controls: ['z'], plants: 'page' }));
  assert.deepEqual(messages(check({ units: split })), []);
});

test('negative control: a probe that runs twice, a control in two units or twice in one fail the check, and the script and the units are named', () => {
  const twice = small();
  twice.push(unit('a-again', A));
  const first = check({ units: twice });
  assert.equal(first.length, 1);
  assert.equal(first[0].file, A);
  assert.match(first[0].message, /packages\/kit\/probes\/a-probe\.mjs runs twice as a probe: the units "a" and "a-again"/);

  const control = small();
  control.push(unit('a-controls-again', A, { controls: ['y', 'q'], plants: 'page' }));
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
  assert.ok(messages(check({ units: twice })).some((message) => /the id "b" is used by two units/.test(message)));
  const sameName = small();
  sameName.push(unit('d', B, { name: 'Unit b' }));
  assert.ok(messages(check({ units: sameName })).some((message) => /the name "Unit b" is used by two units/.test(message)));
  for (const id of ['', 'Upper', 'two words', 'under_score', '-lead', 'trail-', 'a--b']) {
    const bad = small();
    bad[2].id = id;
    assert.ok(messages(check({ units: bad })).some((message) => /id .* is not/.test(message)), JSON.stringify(id));
  }
  const broken = small();
  broken.push({ id: 'e', script: B, seconds: 10, file: `${UNITS_DIRECTORY}/e.mjs` }, { id: 'f', name: 'F', seconds: 10, file: `${UNITS_DIRECTORY}/f.mjs` });
  const problems = messages(check({ units: broken }));
  assert.ok(problems.some((message) => /the unit "e" has no name/.test(message)), problems.join('\n'));
  assert.ok(problems.some((message) => /the unit "f" has no script/.test(message)), problems.join('\n'));
});

test('negative control: controls that would run the probe zero times, or a control set by hand in env, and an env value that is not a string, fail the check', () => {
  const none = small();
  none[1].controls = [];
  assert.ok(messages(check({ units: none })).some((message) => /the unit "a-controls" has an empty controls list/.test(message)));
  const manual = small();
  manual[1].env = { NEGATIVE_CONTROL: 'x' };
  assert.match(messages(check({ units: manual }))[0], /the unit "a-controls" sets NEGATIVE_CONTROL in env/);
  const number = small();
  number[2].env = { FONT_DELAY_MS: 40 };
  assert.match(messages(check({ units: number }))[0], /the unit "b" sets FONT_DELAY_MS to a number: an env value is a string/);
});

// N27: a negative control runs on the build the shard shares unless it plants its fault in the SOURCE or at BUILD time, so every unit of controls says which it is, and a unit that plants at build time may not read a shared build.
test('negative control: a unit of controls that does not say where they plant their fault fails the check, and the message gives the two answers; a unit that is not of controls may not say it', () => {
  const undecided = small();
  delete undecided[1].plants;
  const problems = check({ units: undecided });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, `${UNITS_DIRECTORY}/a-controls.mjs`);
  assert.match(problems[0].message, /the unit "a-controls" has controls and does not say where they plant their fault \(plants\): "page" .* or "build"/);
  for (const plants of ['', 'source', 'Page', true, null, 3]) {
    const odd = small();
    odd[1].plants = plants;
    assert.ok(messages(check({ units: odd })).some((message) => /the unit "a-controls" says plants: .*: it is "page" or "build"/.test(message)), JSON.stringify(plants));
  }
  const probe = small();
  probe[0].plants = 'page';
  assert.match(messages(check({ units: probe }))[0], /the unit "a" says where its controls plant their fault and has no controls: only a unit of controls plants/);
});

test('negative control: a unit may not set the shared build itself (BUILD_CACHE) nor name a build of its own (FIXTURE_DIST, FIXTURE_DIST_DEV): the runner gives every process of a shard one directory, and the check names the variable', () => {
  for (const name of ['BUILD_CACHE', 'FIXTURE_DIST', 'FIXTURE_DIST_DEV']) {
    const own = small();
    own[1].env = { [name]: '$RUNNER_TEMP/mine' };
    const problems = messages(check({ units: own }));
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], new RegExp(`the unit "a-controls" sets ${name} in env: the shard runner gives every process of a shard the shared build directory`));
    const probe = small();
    probe[0].env = { ...probe[0].env, [name]: '$RUNNER_TEMP/mine' };
    assert.match(messages(check({ units: probe }))[0], new RegExp(`the unit "a" sets ${name} in env`));
  }
});

test('negative control: a unit that plants its faults at build time may not read a shared build: DIST in its env fails the check whatever it names, while a unit that plants in the page may read the shard\'s ui-next build', () => {
  const page = small();
  page[1].env = { DIST: '$PROBE_DIST' };
  assert.deepEqual(messages(check({ units: page })), [], 'a control that perturbs the page reads the shared ui-next build');
  for (const dist of ['$PROBE_DIST', '${PROBE_DIST}/x', '/tmp/somewhere']) {
    const build = small();
    build[1].plants = 'build';
    build[1].env = { DIST: dist };
    const problems = messages(check({ units: build }));
    assert.equal(problems.length, 1, `${dist}: ${problems.join('\n')}`);
    assert.match(problems[0], /the unit "a-controls" plants its faults at build time and sets DIST in env: a control that changes the build needs a build of its own, and must not read one that is shared/);
  }
  const clean = small();
  clean[1].plants = 'build';
  assert.deepEqual(messages(check({ units: clean })), [], 'a unit that plants at build time and reads no shared build is whole');
});

// What the planner needs of every unit: whole seconds, and one unit at most the limit (a unit over it cannot be put in any shard: split it).
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

test('negative control: a unit that still declares paths fails the check: since N25 every probe and every control runs on every run, and a list of paths would say otherwise', () => {
  const stale = small();
  stale[1].paths = [A];
  const problems = check({ units: stale });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, stale[1].file);
  assert.match(problems[0].message, /the unit "a-controls" declares paths: units carry no globs since N25, every probe and every control runs on every run/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The manifest is the floor: what CI proves can only be made smaller by a diff in the manifest
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the floor holds on a table that has everything the manifest lists, and the manifest is not a mirror: a probe or a control it does not list is not a problem, so two pull requests that add probes do not both edit it', () => {
  assert.deepEqual(check(), []);
  const more = [...small(), unit('d', D), unit('d-controls', D, { controls: ['p', 'q'], plants: 'page' })];
  assert.deepEqual(messages(check({ units: more, found: [...FOUND, D] })), []);
  const extra = small();
  extra[1].controls = ['x', 'y', 'z'];
  assert.deepEqual(check({ units: extra }), [], 'a control added to a probe that the manifest lists');
});

test('negative control: a control that the manifest lists and no unit runs fails the check, and the message names the control, the probe and the manifest and says how to remove it on purpose', () => {
  const lacking = small();
  lacking[1].controls = ['x'];
  const problems = check({ units: lacking });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, A);
  assert.equal(problems[0].title, 'Kit probe manifest');
  assert.match(problems[0].message, /the control "y" of packages\/kit\/probes\/a-probe\.mjs is in scripts\/ci\/probe-units\.manifest\.json and no unit runs it: a control was removed from CI/);
  assert.match(problems[0].message, /delete it from scripts\/ci\/probe-units\.manifest\.json in the same pull request/);
});

test('negative control: a probe that the manifest lists and no unit runs fails the check, even when its controls are still there; deleting its unit file is the same', () => {
  const noProbe = small().filter((entry) => entry.id !== 'a');
  const found = check({ units: noProbe });
  const problems = found.filter((problem) => problem.title === 'Kit probe manifest');
  assert.equal(problems.length, 1, messages(found).join(' | '));
  assert.match(problems[0].message, /the probe packages\/kit\/probes\/a-probe\.mjs is in scripts\/ci\/probe-units\.manifest\.json and no unit runs it: a probe was removed from CI/);
  assert.equal(problems[0].title, 'Kit probe manifest');
  assert.equal(problems[0].file, A);
  assert.equal(found.length, 2, 'and the probe script that only its controls run is the second problem: a probe nobody runs');
  const nothing = small().filter((entry) => entry.script !== A);
  const dropped = messages(check({ units: nothing, found: [B, C] })).filter((message) => message.includes(MANIFEST));
  assert.deepEqual(dropped.map((message) => /(?:control "(\w+)"|the probe)/.exec(message)?.[0]), ['the probe', 'control "x"', 'control "y"']);
});

test('a control may move to another unit of its probe, and the floor does not mind; a manifest entry that lists no probe asks for no probe unit (the check still wants one for every probe script of the tree)', () => {
  const moved = small();
  moved[1].controls = ['x'];
  moved.push(unit('a-controls-late', A, { controls: ['y'], plants: 'page' }));
  assert.deepEqual(check({ units: moved }), []);
  const controlsOnly = check({ manifest: { [A]: { probe: false, controls: ['x', 'y'] }, [B]: { probe: true, controls: [] } }, units: small().filter((entry) => entry.id !== 'a') });
  assert.deepEqual(messages(controlsOnly).filter((message) => message.includes(MANIFEST)), []);
  assert.equal(controlsOnly.length, 1);
  assert.match(controlsOnly[0].message, /no unit runs it as a probe/);
});

test('negative control: a control is the control of one probe: a unit of another probe that runs a control of the same name does not satisfy the manifest', () => {
  const swapped = [unit('a', A), unit('b', B), unit('b-controls', B, { controls: ['x', 'y'], plants: 'page' })];
  const problems = check({ units: swapped });
  assert.deepEqual(messages(problems).map((message) => /control "(\w+)"/.exec(message)?.[1]), ['x', 'y']);
});

test('without a manifest (it could not be read) the floor says nothing, and loadManifest says why it could not be read', () => {
  assert.deepEqual(check({ manifest: null, units: small().filter((entry) => entry.script !== A), found: [B, C] }), []);
  const shapes = {
    missing: undefined,
    notJson: '{ nope',
    array: '[]',
    scalar: '"x"',
    noProbeFlag: JSON.stringify({ [A]: { controls: [] } }),
    controlsNotList: JSON.stringify({ [A]: { probe: true, controls: 'x' } }),
    controlNotString: JSON.stringify({ [A]: { probe: true, controls: [1] } }),
    controlEmpty: JSON.stringify({ [A]: { probe: true, controls: [''] } }),
    entryNull: JSON.stringify({ [A]: null }),
  };
  for (const [what, text] of Object.entries(shapes)) {
    const read = loadManifest(scratch(text === undefined ? {} : { [MANIFEST]: text }));
    assert.equal(read.manifest, null, what);
    assert.equal(read.problems.length, 1, what);
    assert.equal(read.problems[0].file, MANIFEST);
    assert.equal(read.problems[0].title, 'Kit probe manifest');
  }
  const good = loadManifest(scratch({ [MANIFEST]: JSON.stringify(FLOOR) }));
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.manifest, FLOOR);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The real table, the real tree
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const REAL = await loadUnits(repo);
const UNITS = REAL.units;
const REAL_MANIFEST = loadManifest(repo);
const FOUND_ON_DISK = findProbeScripts(repo);
const exists = (file) => existsSync(path.join(repo, file));
const realCheck = (units = UNITS, found = FOUND_ON_DISK, manifest = REAL_MANIFEST.manifest) => checkUnits({ units, byHand: BY_HAND, found, exists, manifest });
const byId = (id) => UNITS.find((entry) => entry.id === id);
const controlUnits = UNITS.filter((entry) => entry.controls !== undefined);
const probeUnits = UNITS.filter((entry) => entry.controls === undefined);

test('the real table loads without a problem and the real check passes: every probe script is in a unit, every unit has whole seconds under the limit, and the manifest is still held', () => {
  assert.deepEqual(REAL.problems, []);
  assert.deepEqual(REAL_MANIFEST.problems, []);
  assert.ok(REAL_MANIFEST.manifest !== null);
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

test('every unit of controls of the real table says where its controls plant their fault, and every one says the page: the 219 controls were read one by one (the N27 status file), none plants in the source or at build time; and no unit sets a shared build', () => {
  const withControls = REAL.units.filter((entry) => entry.controls !== undefined);
  assert.ok(withControls.length >= 23, `${withControls.length} units of controls`);
  assert.ok(sum(withControls, (entry) => entry.controls.length) >= 219);
  for (const entry of withControls) assert.equal(entry.plants, 'page', `${entry.id} says plants: ${JSON.stringify(entry.plants)}`);
  for (const entry of REAL.units) {
    for (const name of ['BUILD_CACHE', 'FIXTURE_DIST', 'FIXTURE_DIST_DEV']) assert.equal(entry.env?.[name], undefined, `${entry.id} sets ${name}`);
    if (entry.controls === undefined) assert.equal(entry.plants, undefined, `${entry.id} is a probe and says where controls plant`);
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

// The floor is the 20 probes and 115 controls that CI proved when N25 began (the table of main at 7471b52f: the same sets, each once). A pull request that drops one edits the manifest AND these numbers; one that adds does neither.
const FLOOR_PROBES = 20;
const FLOOR_CONTROLS = 115;

test('the manifest lists at least the 20 probes and the 115 controls CI proved when the manifest was written, every script it names is a probe script of the tree, and the table runs every one of them', () => {
  const entries = Object.entries(REAL_MANIFEST.manifest);
  assert.ok(entries.filter(([, entry]) => entry.probe).length >= FLOOR_PROBES, 'a probe left the manifest');
  assert.ok(sum(entries, ([, entry]) => entry.controls.length) >= FLOOR_CONTROLS, 'a control left the manifest');
  for (const [script, entry] of entries) {
    assert.ok(FOUND_ON_DISK.includes(script), `${script} is in the manifest and is not a probe script of the tree`);
    assert.equal(new Set(entry.controls).size, entry.controls.length, `${script} lists a control twice`);
  }
  const ran = new Set(UNITS.flatMap((entry) => (entry.controls ?? []).map((control) => `${entry.script} ${control}`)));
  for (const [script, entry] of entries) for (const control of entry.controls) assert.ok(ran.has(`${script} ${control}`), `${script} ${control}`);
  assert.deepEqual(Object.keys(REAL_MANIFEST.manifest), [...Object.keys(REAL_MANIFEST.manifest)].sort(), 'the keys are sorted, so that two pull requests that add a probe edit different lines');
});

test('negative control: a probe script that only a unit of its controls runs is a probe nobody runs, and the check names it', () => {
  const onlyControls = small().filter((entry) => entry.id !== 'a');
  const problems = check({ units: onlyControls, manifest: null });
  assert.equal(problems.length, 1, messages(problems).join(' | '));
  assert.equal(problems[0].file, A);
  assert.match(problems[0].message, /packages\/kit\/probes\/a-probe\.mjs is a probe script and no unit runs it as a probe/);
});

test('negative control: every control the manifest lists, taken out of its unit, and every listed unit of the real table, taken out of the table, fails the real check and names what was dropped', () => {
  let controls = 0;
  for (const [script, listed] of Object.entries(REAL_MANIFEST.manifest)) {
    for (const control of listed.controls) {
      const without = UNITS.flatMap((candidate) => {
        if (candidate.script !== script || !(candidate.controls ?? []).includes(control)) return [candidate];
        const rest = candidate.controls.filter((name) => name !== control);
        return rest.length === 0 ? [] : [{ ...candidate, controls: rest }];
      });
      const said = messages(realCheck(without));
      assert.ok(said.some((message) => message.includes(`the control "${control}" of ${script} is in ${MANIFEST}`)), `${script} without ${control}: ${said.join(' | ')}`);
      controls += 1;
    }
  }
  assert.ok(controls >= FLOOR_CONTROLS, `${controls} controls tried`);
  for (const entry of UNITS) {
    const listed = REAL_MANIFEST.manifest[entry.script];
    const held = listed !== undefined && (entry.controls === undefined ? listed.probe : entry.controls.some((control) => listed.controls.includes(control)));
    if (!held) continue; // a unit the manifest does not list is not part of the floor: a pull request that adds one edits no manifest
    const said = messages(realCheck(UNITS.filter((candidate) => candidate.id !== entry.id)));
    const named = entry.controls === undefined ? `the probe ${entry.script} is in ${MANIFEST}` : `of ${entry.script} is in ${MANIFEST}`;
    assert.ok(said.some((message) => message.includes(named)), `${entry.id} deleted: ${said.join(' | ')}`);
  }
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
  const panelFrame = copy();
  for (const entry of panelFrame) if (entry.id === 'panel-controls-frame') entry.controls = entry.controls.filter((control) => control !== 'toggle');
  assert.deepEqual(lost(panelFrame), ['ui-next/shell/probes/panel-probe.mjs lost the control toggle']);
});

// N25: the panel probe's controls were one unit of 480 s on the runner (run 44929041191), over the 432 s a shard may hold. They are three units and the fourteen controls are the same fourteen, each once, in the same order.
const PANEL_CONTROLS = ['panel-height', 'session-gap', 'toggle', 'tab-padding', 'shift', 'root-write', 'held-hidden', 'held-done-hidden', 'held-moved', 'held-enabled', 'twin-moved', 'twin-lone-scope', 'twin-scope-kept', 'scope-name', 'late-early'];

test('the 480 s unit of the panel probe (run 44929041191) is three units that each fit, hold the same fourteen controls once each and the late-tool control (#660) last, in the same order, and the controls have no env', () => {
  const parts = UNITS.filter((entry) => entry.script === 'ui-next/shell/probes/panel-probe.mjs' && entry.controls !== undefined);
  assert.deepEqual(idsOf(parts), ['panel-controls-frame', 'panel-controls-held', 'panel-controls-twins']);
  assert.deepEqual(parts.flatMap((entry) => entry.controls), PANEL_CONTROLS);
  for (const part of parts) {
    // (N26: the seconds are the runner's 95th percentile, scripts/ci/probe-seconds.mjs; the frame controls are 220 s: each of the three stays under 60 percent of a shard.)
    assert.ok(part.seconds <= LIMIT_SECONDS * 0.6, `${part.id} is ${part.seconds} s`);
    assert.equal(part.env, undefined, 'the controls had no env, and have none now');
  }
});

test('the two other units that filled a shard alone, the toast layer\'s controls (384 s in that run) and the Logs probe\'s (382 s), are split the same way, with the controls they had, each once', () => {
  const toast = UNITS.filter((entry) => entry.script === 'ui-next/shell/probes/notices-probe.mjs' && entry.controls !== undefined);
  assert.deepEqual(idsOf(toast), ['notices-controls-toast', 'notices-controls-centre']);
  assert.equal(toast.flatMap((entry) => entry.controls).length, 34);
  const logs = UNITS.filter((entry) => entry.script === 'ui-next/shell/probes/logs-probe.mjs' && entry.controls !== undefined);
  assert.deepEqual(idsOf(logs), ['logs-controls-feed', 'logs-controls-toolbar']);
  assert.equal(logs.flatMap((entry) => entry.controls).length, 19);
  // (N26: the seconds are the runner's 95th percentile over its recent runs, scripts/ci/probe-seconds.mjs: the largest of the four is 255 s; each stays under 60 percent of a shard.)
  for (const entry of [...toast, ...logs]) assert.ok(entry.seconds <= LIMIT_SECONDS * 0.6, `${entry.id}`);
});

// The seconds of a unit are the runner's: run 44929041191 (the run of #647), every row of every shard summary, a control's row being one run and a unit the sum of its rows. The data of the seven runs the drift and the ceiling are replayed on.
const RUNS = JSON.parse(readFileSync(path.join(repo, 'scripts/ci/probe-shards.runs.json'), 'utf8'));
// N27: the table's seconds before the shared builds (N26's, from runs in which every control built its own fixtures) and two real runs of the shared layout, from which the table's seconds were then set (probe-shards.layout.json).
const LAYOUT = JSON.parse(readFileSync(path.join(repo, 'scripts/ci/probe-shards.layout.json'), 'utf8'));
const OLD_UNITS = UNITS.map((entry) => ({ ...entry, seconds: LAYOUT.oldLayoutSeconds[entry.id] }));

test('the limit a shard is PLANNED to is the wall budget of a job less the setup of a slow job: 9 minutes less the 90th percentile (108 s) is 432 s, and it is not raised', () => {
  assert.equal(WALL_BUDGET_SECONDS, 9 * 60);
  assert.equal(SETUP_P90_SECONDS, 108);
  assert.equal(LIMIT_SECONDS, 432);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The plan: every unit, in the fewest shards
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// A table that cannot be read leaves no plan, and the tests that need one fail one by one (the real-table test says why) instead of the file failing to load.
const PLAN = UNITS.length > 0 ? planRun({ units: UNITS }) : { shards: [] };
const planned = (result) => result.shards.flatMap((shard) => shard.units.map((entry) => entry.id));

test('the plan puts EVERY unit in exactly one shard, every probe and every control, none over the limit, and in the fewest shards the packing finds', () => {
  assert.deepEqual(planned(PLAN).sort(), idsOf(UNITS).sort());
  assert.equal(new Set(planned(PLAN)).size, UNITS.length, 'no unit twice');
  for (const shard of PLAN.shards) assert.ok(shard.seconds <= LIMIT_SECONDS, `shard ${shard.shard} is ${shard.seconds} s`);
  assert.equal(PLAN.shards.length, pack(UNITS.map((entry) => ({ id: entry.id, seconds: entry.seconds })), LIMIT_SECONDS).length);
  assert.ok(PLAN.shards.length >= lowerBound(UNITS, LIMIT_SECONDS), 'never fewer than the work over the limit');
  assert.ok(PLAN.shards.length <= lowerBound(UNITS, LIMIT_SECONDS) + 1, 'and at most one more');
});

test('the shards of a plan are numbered from 1 by length, longest first, hold the sum of their units\' seconds, and say whether one of their units reads the ui-next build', () => {
  assert.deepEqual(PLAN.shards.map((shard) => shard.shard), PLAN.shards.map((_, index) => index + 1));
  const seconds = PLAN.shards.map((shard) => shard.seconds);
  assert.deepEqual(seconds, [...seconds].sort((a, b) => b - a));
  for (const shard of PLAN.shards) {
    assert.equal(shard.seconds, sum(shard.units, (entry) => entry.seconds));
    assert.equal(shard.dist, shard.units.some((entry) => readsDist(byId(entry.id))));
    for (const entry of shard.units) assert.deepEqual(entry, { id: entry.id, seconds: byId(entry.id).seconds }, 'the plan keeps each unit\'s id and seconds as declared');
  }
  assert.ok(PLAN.shards.some((shard) => shard.dist) && PLAN.shards.some((shard) => !shard.dist), 'some shards read the build and some do not');
});

test('the matrix is the one line of JSON the workflow reads: `{ include: [{ shard, units, seconds, dist, engines }] }`, the units as ids joined by commas, in shard order', () => {
  const matrix = matrixOf(PLAN.shards);
  assert.deepEqual(Object.keys(matrix), ['include']);
  assert.equal(matrix.include.length, PLAN.shards.length);
  matrix.include.forEach((entry, index) => {
    assert.deepEqual(Object.keys(entry), ['shard', 'units', 'seconds', 'dist', 'engines']);
    assert.equal(entry.engines, '', 'a full run leaves the probes their own engines');
    assert.equal(entry.shard, index + 1);
    assert.equal(entry.dist, PLAN.shards[index].dist, 'the shard builds ui-next exactly when a unit of it reads the build');
    assert.equal(entry.seconds, PLAN.shards[index].seconds);
    assert.match(entry.units, /^[a-z0-9]+(?:-[a-z0-9]+)*(?:,[a-z0-9]+(?:-[a-z0-9]+)*)*$/);
    assert.deepEqual(entry.units.split(','), PLAN.shards[index].units.map((candidate) => candidate.id));
  });
  assert.equal(JSON.stringify(matrix).includes('\n'), false);
});

test('NEGATIVE: a table with no unit plans no shard and is an error, so an empty matrix is never emitted; a unit over the limit is an error that says to split it', () => {
  assert.throws(() => planRun({ units: [] }), /the plan has no shard/);
  assert.throws(() => planRun({ units: [unit('big', A, { seconds: LIMIT_SECONDS + 1 })] }), /"big".*433 s.*split it/);
  assert.equal(planRun({ units: [unit('one', A, { seconds: LIMIT_SECONDS })] }).shards.length, 1);
});

test('the summary of a plan says that every probe and every control runs, how many of each, how many seconds in how many shards, and holds every unit once', () => {
  const text = renderPlan(PLAN, UNITS);
  const controls = sum(controlUnits, (entry) => entry.controls.length);
  assert.match(text, /^### Kit probes plan$/m);
  assert.match(text, new RegExp(`Every probe and every control runs: ${probeUnits.length} probes and ${controlUnits.length} control units \\(${controls} controls\\), ${sum(UNITS, (entry) => entry.seconds)} s of units in ${PLAN.shards.length} shards of at most 432 s each\\.`));
  assert.match(text, /^\| Shard \| Seconds \| Units \|$/m);
  for (const entry of UNITS) assert.equal(text.split(new RegExp(`[ |,]${entry.id} ${entry.seconds}(?:,| \\|)`)).length - 1, 1, entry.id);
  assert.doesNotMatch(text, /skipped|by change/);
  assert.match(renderPlan(planRun({ units: [unit('one', A)] }), [unit('one', A)]), /1 probes? and 0 control units \(0 controls\), 40 s of units in 1 shard of at most 432 s each\./);
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

const SHARED = '/tmp/runner/probe-builds/0123456789abcdef';
const SHARED_VARIABLES = ['BUILD_CACHE', 'DIST', 'FIXTURE_DIST', 'FIXTURE_DIST_DEV'];

test('every run of a probe, and of a control that plants in the page, gets the shard\'s shared build directory; no run gets one when the shard has none', () => {
  const probe = expandUnit(unit('a', A, { env: { DIST: '$PROBE_DIST' } }), VARS, { buildCache: SHARED });
  assert.deepEqual(probe.map((run) => run.env), [{ DIST: '/tmp/runner/ui-next-dist', BUILD_CACHE: SHARED }]);
  const controls = expandUnit(unit('a-controls', A, { controls: ['x', 'y'], plants: 'page' }), VARS, { buildCache: SHARED });
  assert.deepEqual(controls.map((run) => run.env), [
    { NEGATIVE_CONTROL: 'x', BUILD_CACHE: SHARED },
    { NEGATIVE_CONTROL: 'y', BUILD_CACHE: SHARED },
  ]);
  assert.ok(controls.every((run) => run.unset === undefined));
  assert.deepEqual(expandUnit(unit('a-controls', A, { controls: ['x'], plants: 'page' }), VARS).map((run) => run.env), [{ NEGATIVE_CONTROL: 'x' }], 'no shared directory when the shard has none');
});

test('negative control: a unit that plants at build time gets no shared build, and the runner is told to take every variable that names a build out of the environment of its processes, whatever the shard\'s environment holds', () => {
  const runs = expandUnit(unit('a-controls', A, { controls: ['x', 'y'], plants: 'build' }), VARS, { buildCache: SHARED });
  assert.deepEqual(runs.map((run) => run.env), [{ NEGATIVE_CONTROL: 'x' }, { NEGATIVE_CONTROL: 'y' }], 'no BUILD_CACHE in what it runs with');
  for (const run of runs) assert.deepEqual([...run.unset].sort(), [...SHARED_VARIABLES].sort());
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

// What the processes of a shard are given to build with (N27). The probes print `probe-build: <kind>/<mode> built in <s> s (shared)` or `... reused`; the runner counts them for each run.
const BUILD_PROBES = {
  'ui-next/shell/probes/env-probe.mjs':
    "console.log('shared ' + JSON.stringify({ cache: process.env.BUILD_CACHE ?? null, dist: process.env.DIST ?? null, fixture: process.env.FIXTURE_DIST ?? null, fixtureDev: process.env.FIXTURE_DIST_DEV ?? null, control: process.env.NEGATIVE_CONTROL ?? null }));\n",
  'ui-next/shell/probes/building-probe.mjs':
    "process.stdout.write('probe-build: shell-fixtures/production bui');\nawait new Promise((resolve) => setTimeout(resolve, 40));\nprocess.stdout.write('lt in 7.5 s (shared)\\n');\nconsole.log('probe-build: shell-fixtures/development reused');\nconsole.log('probe-build: this is not a build line');\nprocess.stdout.write('probe-build: settings-fixture/production reused');\n",
};
const ENV_PROBE = 'ui-next/shell/probes/env-probe.mjs';
const BUILDING = 'ui-next/shell/probes/building-probe.mjs';

test('the processes of a shard are given its shared build directory, and a unit that plants at build time sees none of the variables that name a build, even when the shard\'s own environment holds them', async () => {
  const root = scratch(BUILD_PROBES);
  const units = [unit('page', ENV_PROBE, { name: 'Page controls', controls: ['a'], plants: 'page' }), unit('build', ENV_PROBE, { name: 'Build controls', controls: ['b'], plants: 'build' }), unit('plain', ENV_PROBE, { name: 'Plain probe' })];
  const chunks = [];
  const env = { ...callerEnv(), RUNNER_TEMP: '/tmp/runner', DIST: '/shard/dist', FIXTURE_DIST: '/shard/fixture', FIXTURE_DIST_DEV: '/shard/dev', BUILD_CACHE: '/shard/stale-cache' };
  const results = await runShard(units, '1', { root, env, out: (text) => chunks.push(text), buildCache: SHARED });
  assert.ok(results.every((result) => result.ok));
  const seen = [...chunks.join('').matchAll(/^shared (.*)$/gm)].map((match) => JSON.parse(match[1]));
  assert.deepEqual(seen, [
    { cache: SHARED, dist: '/shard/dist', fixture: '/shard/fixture', fixtureDev: '/shard/dev', control: 'a' },
    { cache: null, dist: null, fixture: null, fixtureDev: null, control: 'b' },
    { cache: SHARED, dist: '/shard/dist', fixture: '/shard/fixture', fixtureDev: '/shard/dev', control: null },
  ]);
  const without = [];
  await runShard(units.slice(0, 1), '1', { root, env: { ...callerEnv(), RUNNER_TEMP: '/tmp/runner' }, out: (text) => without.push(text) });
  assert.equal(JSON.parse(/^shared (.*)$/m.exec(without.join(''))[1]).cache, null, 'no shared directory when the runner has none');
});

test('the builds a probe says it made or read are counted for each run, a line that arrives in two pieces included, and a line that is not one is not', async () => {
  const root = scratch(BUILD_PROBES);
  const { results } = await run([unit('building', BUILDING, { name: 'Builds' })], '1', root);
  assert.deepEqual(results[0].builds, [
    { kind: 'shell-fixtures', mode: 'production', action: 'built', seconds: 7.5, shared: true },
    { kind: 'shell-fixtures', mode: 'development', action: 'reused', seconds: 0, shared: true },
    { kind: 'settings-fixture', mode: 'production', action: 'reused', seconds: 0, shared: true },
  ]);
  const quiet = await run([unit('quiet', ENV_PROBE, { name: 'Quiet' })], '1', root);
  assert.deepEqual(quiet.results[0].builds, []);
  assert.deepEqual(parseBuilds('probe-build: a/production reused\n'), [{ kind: 'a', mode: 'production', action: 'reused', seconds: 0, shared: true }]);
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
// The drift of a unit from its seconds fails the shard, with the new number in the message
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const ran = (id, seconds, extra = {}) => ({ label: id, unit: id, script: A, control: null, ok: true, code: 0, seconds, ...extra });
const ranControl = (id, which, seconds, extra = {}) => ran(id, seconds, { label: `${id} (${which})`, control: which, ...extra });
const TABLE = [unit('big', A, { seconds: 400 }), unit('mid', A, { seconds: 100 }), unit('small', A, { seconds: 28 }), unit('controls', A, { seconds: 40, controls: ['x', 'y'] })];
const drift = (results) => driftFindings('4', results, TABLE, { ceiling: Number.POSITIVE_INFINITY });

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

test('negative control: a unit with a run that failed is left out of the unit rows (the seconds of a probe that stopped early or hung say nothing of its cost), and a unit the table does not have is named', () => {
  const failed = drift([ran('big', 900, { ok: false, code: 1 })]);
  assert.deepEqual([failed.failures.filter((line) => line.includes('unit seconds')), failed.warnings, failed.rows], [[], [], []]);
  assert.deepEqual(drift([ranControl('controls', 'x', 5), ranControl('controls', 'y', 900, { ok: false, code: 3 })]).failures.filter((line) => line.includes('unit seconds')), []);
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

// The data: the seconds of every unit in seven recent runs of the probes on main and on pull requests, with the units as they are now (a control's rows added up by the unit that holds it), and which units each real shard job
// of the run held (`shards`, from the summaries of the run). The table's seconds are those of the first (run 44929041191), so the other six runs are what a run that is not the one that measured it looks like.
test('main before the shared builds started green: in seven real runs (4,364 to 4,471 s of units) no unit fails against the table\'s seconds of then (N26\'s)', () => {
  assert.equal(RUNS.length, 7);
  assert.ok(OLD_UNITS.every((entry) => Number.isInteger(entry.seconds)), 'the table of then has every unit of this one');
  let compared = 0;
  let nearest = 0;
  for (const entry of RUNS) {
    const results = Object.entries(entry.seconds).map(([id, seconds]) => ran(id, seconds));
    const { failures, rows } = driftFindings('0', results, OLD_UNITS, { ceiling: Number.POSITIVE_INFINITY });
    assert.deepEqual(failures, [], `run ${entry.run}`);
    for (const row of rows) nearest = Math.max(nearest, row.delta / Math.max(DRIFT_FLOOR_SECONDS, DRIFT_RATIO * row.table));
    compared += results.length;
  }
  assert.ok(compared >= 7 * 33, `${compared} unit runs compared`);
  assert.ok(nearest < 0.8, `the nearest unit used ${Math.round(nearest * 100)} percent of its margin: a quarter and 60 s are a third more than the worst of those runs asked for`);
});

test('the shared layout starts green: in two real runs of it (4,842 and 4,895 s of units, runs 45108262719 and 45108265400) no unit fails against the table\'s seconds, which were set from them (N27)', () => {
  assert.equal(LAYOUT.sharedLayoutRuns.length, 2);
  for (const entry of LAYOUT.sharedLayoutRuns) {
    const results = Object.entries(entry.seconds).map(([id, seconds]) => ran(id, seconds));
    assert.ok(results.length >= 47 && results.every((result) => UNITS.some((entry) => entry.id === result.unit)), `run ${entry.run} has the 47 units the table had then, and no other`);
    const { failures } = driftFindings('0', results, UNITS, { ceiling: Number.POSITIVE_INFINITY });
    assert.deepEqual(failures, [], `run ${entry.run}`);
  }
});

test('negative control: the margin catches a real drift in those runs, not only a made-up one: the toast layer 30 percent over its listed seconds on a quiet run fails, with its number', () => {
  const quiet = LAYOUT.sharedLayoutRuns[0].seconds;
  const listed = UNITS.find((entry) => entry.id === 'notices').seconds;
  const slowed = Object.entries(quiet).map(([id, seconds]) => ran(id, id === 'notices' ? Math.round(listed * 1.3) : seconds));
  const { failures } = driftFindings('0', slowed, UNITS, { ceiling: Number.POSITIVE_INFINITY });
  assert.equal(failures.length, 1);
  assert.match(failures[0], new RegExp(`Probe the toast layer against the pinned mock reference \\(notices\\) took ${Math.round(listed * 1.3)} s`));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The shard is held too: a ceiling on the REAL seconds of all its units
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
};

test('negative control: units that are each inside their margin and add up past the ceiling fail the shard and not a unit: eight units of 50 s, each 60 s over, are 880 s (the review of #656 found 866 s in a shard of 386)', () => {
  const eight = Array.from({ length: 8 }, (_, index) => unit(`u${index + 1}`, A, { seconds: 50 }));
  const results = eight.map((entry) => ran(entry.id, 110));
  const { failures, shard } = driftFindings('9', results, eight);
  assert.equal(shard.took, 880);
  assert.equal(shard.planned, 400);
  assert.equal(failures.length, 1, failures.join('\n'));
  assert.doesNotMatch(failures[0], /unit seconds/, 'every unit was inside its margin');
  assert.match(failures[0], new RegExp(`^::error title=Kit probe shard seconds \\(shard 9\\)::shard 9 took 880 s of units on this runner, over the ${SHARD_CEILING_SECONDS} s a shard may take \\(400 s in the table for its 8 units: u1 110 s of 50, `));
  assert.match(failures[0], /find which and put its new seconds in its file/);
  assert.equal(failures[0].includes('\n'), false);
});

test('the ceiling is on the whole shard and is exact: at it a shard passes, one second over it fails, a run that failed counts (its seconds were spent), and a shard of several units is one failure', () => {
  const units = [unit('p', A, { seconds: 100 }), unit('q', A, { seconds: 100 })];
  const at = driftFindings('1', [ran('p', 100), ran('q', 100)], units, { ceiling: 200 });
  assert.deepEqual(at.failures, []);
  assert.equal(at.shard.ceiling, 200);
  assert.equal(driftFindings('1', [ran('p', 100), ran('q', 101)], units, { ceiling: 200 }).failures.filter((line) => line.includes('shard seconds')).length, 1);
  const failedRun = driftFindings('1', [ran('p', 100), ran('q', 150, { ok: false, code: 1 })], units, { ceiling: 200 });
  assert.equal(failedRun.failures.filter((line) => line.includes('shard seconds')).length, 1, 'the seconds of a probe that failed are in the shard\'s');
  assert.equal(failedRun.failures.filter((line) => line.includes('unit seconds')).length, 0);
});

test('the shard\'s seconds and its ceiling are in the summary of the shard: the table of its units, and a line under it', () => {
  const eight = Array.from({ length: 8 }, (_, index) => unit(`u${index + 1}`, A, { seconds: 50 }));
  const { rows, shard } = driftFindings('9', eight.map((entry) => ran(entry.id, 110)), eight);
  const text = engine.renderDrift('9', rows, shard);
  assert.match(text, /^#### Kit probes shard 9: seconds against the table$/m);
  assert.match(text, new RegExp(`The shard took 880 s of units against 400 s in the table; it fails past ${SHARD_CEILING_SECONDS} s\\.`));
});

// The ceiling is derived, not picked: from every real shard job of the seven runs. A shard planned at the limit takes the limit times what its machine took against the table, and the ceiling is that for the worst machine seen,
// and a margin. `shards` of each run are the units one real shard job held (all on one machine), so the ratio of its real seconds to the table's seconds for the same units is how slow that machine was that day.
// The table seconds each ratio is taken against are the ones the units had when the ceiling was derived (run 44929041191's, and the first runner seconds of the two L4 units), kept with the data so that retiring or re-timing a unit does not change history or break the load of this file.
const LISTED = { ...RUNS.find((entry) => entry.run === '44929041191').seconds, 'logs-open': 20, 'logs-open-controls': 12 };
const RATIOS = RUNS.flatMap((entry) => entry.shards.map((ids) => ({ run: entry.run, ids, listed: sum(ids, (id) => LISTED[id]), real: sum(ids, (id) => entry.seconds[id]) }))).map((row) => ({ ...row, ratio: row.real / row.listed }));

test('the data of the ceiling is whole: the real shard jobs of each run hold every unit of the run once, and every unit has the seconds it was listed at', () => {
  assert.equal(RATIOS.length, 70, 'ten real shard jobs in each of seven runs');
  for (const entry of RUNS) {
    const held = entry.shards.flat();
    assert.deepEqual([...held].sort(), Object.keys(entry.seconds).sort(), `run ${entry.run}: the real shards hold the units of the run, each once`);
    for (const id of held) assert.ok(LISTED[id] !== undefined, `${id} has table seconds in the data`);
  }
});

test('the ceiling is the limit a shard is planned to times the worst machine of the 70 real shard jobs (real seconds over the table\'s) and a margin of 10 percent, and every one of those jobs, scaled to a shard planned at the limit, passes it', () => {
  const ratios = RATIOS.map((row) => row.ratio);
  const worst = Math.max(...ratios);
  assert.ok(engine.SHARD_SLOWDOWN_WORST >= worst && engine.SHARD_SLOWDOWN_WORST < worst + 0.001, `the worst machine took ${worst} times the table's seconds; SHARD_SLOWDOWN_WORST is ${engine.SHARD_SLOWDOWN_WORST}, that rounded up to three places`);
  assert.equal(engine.SHARD_CEILING_MARGIN, 0.1);
  assert.equal(SHARD_CEILING_SECONDS, Math.ceil(LIMIT_SECONDS * engine.SHARD_SLOWDOWN_WORST * (1 + engine.SHARD_CEILING_MARGIN)));
  for (const row of RATIOS) assert.ok(LIMIT_SECONDS * row.ratio <= SHARD_CEILING_SECONDS, `run ${row.run}: a shard of ${LIMIT_SECONDS} s on the machine of ${row.ids.join(', ')} (x${row.ratio.toFixed(3)}) is ${Math.round(LIMIT_SECONDS * row.ratio)} s`);
  // The numbers N25.md states.
  assert.equal(quantile(ratios, 0.5).toFixed(3), '1.003', 'median');
  assert.equal(quantile(ratios, 0.95).toFixed(3), '1.099', 'p95');
  assert.equal(worst.toFixed(3), '1.292', 'max');
  const second = [...ratios].sort((a, b) => b - a)[1];
  assert.ok(engine.SHARD_CEILING_MARGIN > worst / second - 1, 'the margin is more than the step from the worst machine to the second worst');
});

test('negative control: the ceiling is not a number that lets anything through: a shard planned at the limit on a machine 43 percent slow, one the seven runs never met, fails it, and one 41 percent slow passes', () => {
  const units = [unit('whole', A, { seconds: LIMIT_SECONDS })];
  assert.equal(driftFindings('1', [ran('whole', Math.round(LIMIT_SECONDS * 1.43))], units, { ratio: 10, floor: 1000 }).failures.length, 1);
  assert.deepEqual(driftFindings('1', [ran('whole', Math.round(LIMIT_SECONDS * 1.41))], units, { ratio: 10, floor: 1000 }).failures, []);
  assert.ok(SHARD_CEILING_SECONDS < 2 * LIMIT_SECONDS, 'under twice the limit');
});

test('the job timeout leaves a shard at its ceiling, on the slowest setup of the 70 shard jobs, time to finish and say why it failed, and is not much more: that is a hang', () => {
  assert.equal(engine.SETUP_MAX_SECONDS, 137, 'the slowest setup of the 70 shard jobs (median 87.5 s, 90th percentile 105 s)');
  const needed = Math.ceil((SHARD_CEILING_SECONDS + engine.SETUP_MAX_SECONDS) / 60);
  // The timeout is an expression of the plan's scope (N30): 15 minutes for a full run, 38 for a pull request's longer shards.
  const [, longer, usual] = /^\$\{\{ needs\.plan\.outputs\.scope == 'pr' && (\d+) \|\| (\d+) \}\}$/.exec(workflow.jobs.shard['timeout-minutes']);
  for (const [timeout, ceiling] of [[Number(usual), SHARD_CEILING_SECONDS], [Number(longer), engine.PR_SHARD_CEILING_SECONDS]]) {
    const required = Math.ceil((ceiling + engine.SETUP_MAX_SECONDS) / 60);
    assert.ok(timeout >= required, `a shard at its ceiling of ${ceiling} s with a setup of ${engine.SETUP_MAX_SECONDS} s takes ${required} minutes and the job is killed at ${timeout}`);
    assert.ok(timeout <= required + 3, `${timeout} minutes is more than ${required} and 3: past that a shard that hangs is told from a slow one too late`);
  }

  assert.equal(Number(usual), 15);
  assert.equal(Number(longer), 38);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What a shard reports it ran, and the verification of the whole run
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** The runs a shard made of `units`, all passing (`ok` false for the ids in `fail`), as `runShard` gives them. */
function resultsOf(units, fail = []) {
  return units.flatMap((entry) => (entry.controls ?? [null]).map((control) => ({ label: control === null ? entry.name : `${entry.name} (${control})`, unit: entry.id, script: entry.script, control, ok: !fail.includes(entry.id), code: fail.includes(entry.id) ? 1 : 0, seconds: 1 })));
}

/** What every shard of the real plan would report, when all of it ran and passed. */
const allReports = () => PLAN.shards.map((shard) => ranReport(shard.shard, resultsOf(shard.units.map((entry) => byId(entry.id)))));
const verify = (changes = {}) => verifyRan({ units: UNITS, reports: allReports(), shards: String(PLAN.shards.length), ...changes });

test('a shard reports each unit it ran: whether every run of it passed, how many runs it made and which controls', () => {
  const report = ranReport('3', resultsOf([unit('p', A), unit('q', A, { controls: ['x', 'y'] }), unit('r', B)], ['r']));
  assert.deepEqual(report, {
    shard: 3,
    units: [
      { id: 'p', ok: true, runs: 1, controls: [] },
      { id: 'q', ok: true, runs: 2, controls: ['x', 'y'] },
      { id: 'r', ok: false, runs: 1, controls: [] },
    ],
  });
  const partly = ranReport(1, [...resultsOf([unit('q', A, { controls: ['x', 'y'] })]).map((result, index) => (index === 1 ? { ...result, ok: false } : result))]);
  assert.equal(partly.units[0].ok, false, 'a unit passed only when every one of its runs did');
});

test('a run in which every unit ran once and passed, in as many shards as the plan made, has no problem', () => {
  assert.deepEqual(verify(), []);
});

test('negative control: a shard that never reported is a problem that names it, with how many shards the plan made, whatever the other shards said', () => {
  const reports = allReports().filter((report) => report.shard !== 3);
  const problems = verify({ reports });
  assert.ok(problems.some((message) => new RegExp(`^the plan made ${PLAN.shards.length} shards and shard 3 did not report`).test(message)), problems.join('\n'));
  assert.ok(problems.some((message) => /^the unit "[a-z-]+" ran in no shard$/.test(message)), 'and the units it held ran in no shard');
  assert.ok(verify({ reports: allReports().filter((report) => report.shard > 2) }).some((message) => /shards 1 and 2 did not report/.test(message)));
});

test('negative control: a unit that ran in no shard is named, so a plan that was short, or a unit that dropped out of the matrix, is red', () => {
  const reports = allReports().map((report) => ({ ...report, units: report.units.filter((entry) => entry.id !== 'palette') }));
  assert.deepEqual(verify({ reports }), ['the unit "palette" ran in no shard']);
  const short = allReports().slice(0, 3);
  const problems = verify({ reports: short, shards: '3' });
  assert.equal(problems.filter((message) => /ran in no shard/.test(message)).length, UNITS.length - short.flatMap((report) => report.units).length);
});

test('negative control: a unit that failed, that ran twice, that lacked a control, that made another number of runs, or that is not in the table is named', () => {
  const edit = (change) => {
    const reports = structuredClone(allReports());
    change(reports);
    return verify({ reports });
  };
  const holding = (reports, id) => reports.flatMap((report) => report.units).find((entry) => entry.id === id);
  assert.deepEqual(edit((reports) => { holding(reports, 'panel').ok = false; }).map((message) => message.replace(/ in shard \d+/, '')), ['the unit "panel" did not pass']);
  assert.match(edit((reports) => { reports[0].units.push(structuredClone(holding(reports, 'panel'))); })[0], /^the unit "panel" ran in 2 shards \(\d+ and \d+\): a unit runs once$/);
  assert.match(edit((reports) => { holding(reports, 'panel-controls-twins').controls.pop(); })[0], /^the unit "panel-controls-twins" ran in shard \d+ without the control late-early$/);
  assert.match(edit((reports) => { holding(reports, 'panel-controls-frame').controls = []; })[0], /without the controls panel-height, session-gap, toggle, tab-padding, shift, root-write$/);
  assert.ok(edit((reports) => { holding(reports, 'kit').runs = 2; }).some((message) => /^the unit "kit" made 2 runs in shard \d+ and the table has 1$/.test(message)));
  assert.ok(edit((reports) => { holding(reports, 'panel-controls-frame').runs = 5; }).some((message) => /^the unit "panel-controls-frame" made 5 runs in shard \d+ and the table has 6$/.test(message)));
  assert.deepEqual(edit((reports) => { reports[0].units.push({ id: 'zzz', ok: true, runs: 1, controls: [] }); }), ['a shard ran the unit "zzz", which the table does not have']);
});

test('negative control: a plan of no shard, or of one nobody can read, is a problem whatever was reported: an empty or unreadable plan runs nothing', () => {
  for (const shards of ['', '0', 'abc', '-1', '1.5', undefined, 'null', '1e1', '0x10', ' 3 ', '3.0']) {
    const problems = verify({ shards });
    assert.ok(problems.some((message) => /^the plan says ".*" shards: a run has at least one shard, and an empty or unreadable plan runs nothing$/.test(message)), `${shards}: ${problems.join(' | ')}`);
  }
  assert.ok(verify({ reports: [], shards: '0' }).length > 1);
});

test('negative control: a report that is not one, one that comes twice, and a shard the plan did not make are named', () => {
  assert.ok(verify({ reports: [...allReports(), null] }).some((message) => /^a shard report is not \{ shard, units \}: null$/.test(message)));
  assert.ok(verify({ reports: [...allReports(), { shard: 'x', units: [] }] }).some((message) => /^a shard report is not \{ shard, units \}/.test(message)));
  assert.ok(verify({ reports: [...allReports(), { shard: 1, units: [] }] }).some((message) => /^shard 1 reported twice$/.test(message)));
  assert.ok(verify({ reports: [...allReports(), { shard: PLAN.shards.length + 1, units: [] }] }).some((message) => new RegExp(`^shard ${PLAN.shards.length + 1} reported and the plan made ${PLAN.shards.length} shards$`).test(message)));
});

test('the reports are read from a directory at any depth (each artifact is a directory of its own), only files named ran-<n>-probe.json count, and a file that is not JSON is a problem', () => {
  const root = scratch({
    'kit-probe-reports-1/ran-1-probe.json': JSON.stringify({ shard: 1, units: [] }),
    'kit-probe-reports-1/kit-probe.json': '{"not":"a report"}',
    'kit-probe-reports-2/deeper/ran-2-probe.json': JSON.stringify({ shard: 2, units: [] }),
    'ran-3-probe.json': JSON.stringify({ shard: 3, units: [] }),
    'kit-probe-reports-4/ran-4-probe.json': '{ nope',
    'kit-probe-reports-5/ran-x-probe.json': '{}',
  });
  const { reports, problems } = readReports(root);
  assert.deepEqual(reports.map((report) => report.shard).sort(), [1, 2, 3]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^ran-4-probe\.json is not JSON/);
  assert.throws(() => readReports(path.join(root, 'nowhere')), /ENOENT/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command CI runs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const cli = (root, args, env = {}) => spawnSync('node', [command, '--root', root, ...args], { encoding: 'utf8', env: { ...callerEnv(), GITHUB_ACTIONS: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', ...env } });
const outputs = (file) => Object.fromEntries(readFileSync(file, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

let baseTree;

/** A scratch tree that holds the real unit files, the manifest and an (empty) script for every probe of the tree, which is all the check reads (built once; each test copies it). */
function treeOfTheUnits() {
  if (baseTree === undefined) {
    const files = { [MANIFEST]: readFileSync(path.join(repo, MANIFEST), 'utf8') };
    for (const file of FOUND_ON_DISK) files[file] = '';
    for (const name of readdirSync(path.join(repo, UNITS_DIRECTORY))) files[`${UNITS_DIRECTORY}/${name}`] = readFileSync(path.join(repo, UNITS_DIRECTORY, name), 'utf8');
    baseTree = scratch(files);
  }
  const root = mkdtempSync(path.join(tmpdir(), 'probe-shards-'));
  roots.push(root);
  cpSync(baseTree, root, { recursive: true });
  return root;
}

test('the check passes on a tree that holds the scripts, the units and the manifest, and fails, naming the file, on a probe file nobody runs', () => {
  const root = treeOfTheUnits();
  const result = cli(root, ['check']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const controls = sum(controlUnits, (entry) => entry.controls.length);
  assert.match(result.stdout, new RegExp(`^probe-shards: ok \\(${UNITS.length} units, ${controlUnits.length} control units, ${controls} controls, ${new Set(UNITS.map((entry) => entry.script)).size} probe scripts, 0 by hand\\)$`, 'm'));
  writeFileSync(path.join(root, 'ui-next/shell/probes/forgotten-probe.mjs'), '');
  const plain = cli(root, ['check']);
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /probe-shards: ui-next\/shell\/probes\/forgotten-probe\.mjs is a probe script and no unit runs it/);
  const annotated = cli(root, ['check'], { GITHUB_ACTIONS: 'true' });
  assert.equal(annotated.status, 1);
  assert.match(annotated.stdout, /^::error file=ui-next\/shell\/probes\/forgotten-probe\.mjs,title=Kit probe is in no unit::/m);
});

test('negative control: the check fails, on the command, when a control or a probe that the manifest lists leaves a unit file, or the manifest cannot be read; deleting it from the manifest too is a diff and passes', () => {
  const dropped = treeOfTheUnits();
  const file = path.join(dropped, UNITS_DIRECTORY, 'rail.mjs');
  rmSync(file);
  const missingProbe = cli(dropped, ['check']);
  assert.equal(missingProbe.status, 1);
  assert.match(missingProbe.stderr, /the probe ui-next\/shell\/probes\/rail-probe\.mjs is in scripts\/ci\/probe-units\.manifest\.json and no unit runs it: a probe was removed from CI/);
  assert.match(missingProbe.stderr, /ui-next\/shell\/probes\/rail-probe\.mjs is a probe script and no unit runs it/);
  const manifest = JSON.parse(readFileSync(path.join(dropped, MANIFEST), 'utf8'));
  delete manifest['ui-next/shell/probes/rail-probe.mjs'];
  writeFileSync(path.join(dropped, MANIFEST), JSON.stringify(manifest));
  rmSync(path.join(dropped, 'ui-next/shell/probes/rail-probe.mjs'));
  assert.equal(cli(dropped, ['check']).status, 0, 'a probe removed with its manifest entry and its script is a decision somebody wrote down');

  const lacking = treeOfTheUnits();
  const text = readFileSync(path.join(lacking, UNITS_DIRECTORY, 'form.mjs'), 'utf8');
  assert.ok(text.includes("'secret-attribute'"));
  writeFileSync(path.join(lacking, UNITS_DIRECTORY, 'form.mjs'), text.replace(", 'secret-attribute'", ''));
  const missingControl = cli(lacking, ['check']);
  assert.equal(missingControl.status, 1);
  assert.match(missingControl.stderr, /the control "secret-attribute" of packages\/kit\/probes\/form-probe\.mjs is in scripts\/ci\/probe-units\.manifest\.json and no unit runs it/);

  const unreadable = treeOfTheUnits();
  rmSync(path.join(unreadable, MANIFEST));
  const noManifest = cli(unreadable, ['check']);
  assert.equal(noManifest.status, 1);
  assert.match(noManifest.stderr, /scripts\/ci\/probe-units\.manifest\.json cannot be read/);
});

test('the plan command writes the matrix and the number of shards to $GITHUB_OUTPUT and the plan to the job summary and to the log, and plans every unit', () => {
  const root = treeOfTheUnits();
  const output = path.join(root, 'github-output');
  const summary = path.join(root, 'summary.md');
  const result = cli(root, ['plan'], { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const written = outputs(output);
  const matrix = JSON.parse(written.matrix);
  assert.deepEqual(matrix.include.flatMap((entry) => entry.units.split(',')).sort(), idsOf(UNITS).sort());
  assert.equal(Number(written.shards), matrix.include.length);
  assert.equal(written.shards, String(PLAN.shards.length));
  assert.deepEqual(Object.keys(written).sort(), ['matrix', 'scope', 'shards']);
  assert.equal(written.scope, 'full');
  assert.match(readFileSync(summary, 'utf8'), /^### Kit probes plan$/m);
  assert.match(result.stdout, /Every probe and every control runs/);
});

test('NEGATIVE: the plan command fails, and writes no matrix, for a table with no unit, a unit file that does not load or declares none, a table that does not check, or an output it cannot write', () => {
  const empty = scratch({ [`${UNITS_DIRECTORY}/.keep`]: '' });
  rmSync(path.join(empty, UNITS_DIRECTORY, '.keep'));
  const output = path.join(empty, 'github-output');
  const none = cli(empty, ['plan'], { GITHUB_OUTPUT: output });
  assert.equal(none.status, 1, none.stdout);
  assert.match(none.stderr, /probe-shards: the plan has no shard/);
  assert.equal(existsSync(output), false, 'an empty matrix is never written');

  for (const [what, file, text] of [
    ['a unit file that does not load', 'rail.mjs', 'export const units = [;\n'],
    ['a unit file that declares no unit', 'rail.mjs', 'export const units = [];\n'],
    ['a unit file that exports nothing', 'rail.mjs', 'export const other = 1;\n'],
  ]) {
    const root = treeOfTheUnits();
    writeFileSync(path.join(root, UNITS_DIRECTORY, file), text);
    const out = path.join(root, 'github-output');
    const result = cli(root, ['plan'], { GITHUB_OUTPUT: out });
    assert.equal(result.status, 1, `${what}: ${result.stdout}`);
    assert.match(result.stderr, /scripts\/ci\/probe-units\/rail\.mjs/, what);
    assert.equal(existsSync(out), false, `${what}: a plan that cannot read its table writes no matrix (it would be a short one)`);
    const ran = cli(root, ['run', '1', 'form'], { RUNNER_TEMP: root });
    assert.equal(ran.status, 1, `${what}: a shard that cannot read its table runs nothing: ${ran.stdout}`);
    assert.match(ran.stderr, /scripts\/ci\/probe-units\/rail\.mjs/, what);
    assert.equal(existsSync(path.join(root, 'ran-1-probe.json')), false, 'and reports nothing');
  }

  const unwritable = treeOfTheUnits();
  mkdirSync(path.join(unwritable, 'a-directory'));
  const cannot = cli(unwritable, ['plan'], { GITHUB_OUTPUT: path.join(unwritable, 'a-directory') });
  assert.equal(cannot.status, 1);
  assert.match(cannot.stderr, /could not write the outputs/);
});

test('a command that is not one, a run with no shard or no units, a verify with no reports or no number of shards, or a unit that is not in the table is a usage error (exit 2) that says what there is', () => {
  const root = treeOfTheUnits();
  const nothing = cli(root, []);
  assert.equal(nothing.status, 2);
  assert.match(nothing.stderr, /usage: node scripts\/ci\/probe-shards\.mjs/);
  assert.equal(cli(root, ['run', '1']).status, 2);
  assert.equal(cli(root, ['bogus']).status, 2);
  assert.equal(cli(root, ['verify']).status, 2);
  assert.equal(cli(root, ['verify', '--shards', '3']).status, 2);
  assert.equal(cli(root, ['verify', '--reports', root]).status, 2);
  assert.equal(cli(root, ['plan', 'extra']).status, 2);
  const unknown = cli(root, ['run', '1', 'form,no-such-unit']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /no unit "no-such-unit" \(the units are /);
  assert.equal(cli(root, ['run', '1', '']).status, 2);
  assert.match(cli(root, ['run', '1', 'form,form']).stderr, /the unit "form" is listed twice/);
});

test('the run command exits 1 when a probe of the shard fails and 0 when every probe passes, appends the summary to $GITHUB_STEP_SUMMARY and writes what the shard ran to ran-<shard>-probe.json in $RUNNER_TEMP', () => {
  // The real units in a scratch tree where every probe is a script that exits at once: the panel probe with 5, the others with 0.
  const files = {};
  for (const entry of UNITS) files[entry.script] = entry.script.endsWith('panel-probe.mjs') ? 'process.exit(5);\n' : 'process.exit(0);\n';
  for (const name of readdirSync(path.join(repo, UNITS_DIRECTORY))) files[`${UNITS_DIRECTORY}/${name}`] = readFileSync(path.join(repo, UNITS_DIRECTORY, name), 'utf8');
  const root = scratch(files);
  const summary = path.join(root, 'summary.md');
  const env = { RUNNER_TEMP: root, PROBE_DIST: path.join(root, 'dist'), GITHUB_STEP_SUMMARY: summary };
  const failing = cli(root, ['run', '1', 'panel,rail'], env);
  assert.equal(failing.status, 1, failing.stdout + failing.stderr);
  assert.match(readFileSync(summary, 'utf8'), /### Kit probes shard 1: 2 runs, 1 failed/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'ran-1-probe.json'), 'utf8')), {
    shard: 1,
    units: [
      { id: 'panel', ok: false, runs: 1, controls: [] },
      { id: 'rail', ok: true, runs: 1, controls: [] },
    ],
  });
  const passing = cli(root, ['run', '2', 'rail,shell'], env);
  assert.equal(passing.status, 0, passing.stdout + passing.stderr);
  assert.match(readFileSync(summary, 'utf8'), /### Kit probes shard 2: 2 runs, all passed/);
  const report = JSON.parse(readFileSync(path.join(root, 'ran-2-probe.json'), 'utf8'));
  assert.deepEqual(report.units.map((entry) => entry.id), ['rail', 'shell']);
  const controls = cli(root, ['run', '3', 'tour-controls'], env);
  assert.equal(controls.status, 0, controls.stdout + controls.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'ran-3-probe.json'), 'utf8')).units, [{ id: 'tour-controls', ok: true, runs: byId('tour-controls').controls.length, controls: byId('tour-controls').controls }]);
});

test('the run command gives the shard a shared build directory under $RUNNER_TEMP/probe-builds that the key of its tree names, says so, puts the builds of the shard in its summary, and reports what it ran exactly as before', () => {
  const files = {
    ...BUILD_PROBES,
    'ui-next/index.html': '<html></html>',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    [`${UNITS_DIRECTORY}/env.mjs`]: UNIT_FILE([{ id: 'env', name: 'Env probe', script: ENV_PROBE, seconds: 5 }]),
    [`${UNITS_DIRECTORY}/building.mjs`]: UNIT_FILE([
      { id: 'building', name: 'Building probe', script: BUILDING, seconds: 5 },
      { id: 'building-controls', name: 'Building controls', script: BUILDING, controls: ['x', 'y'], plants: 'page', seconds: 5 },
    ]),
  };
  const root = scratch(files);
  const temp = mkdtempSync(path.join(tmpdir(), 'probe-shards-temp-'));
  roots.push(temp);
  const summary = path.join(temp, 'summary.md');
  const env = { RUNNER_TEMP: temp, GITHUB_STEP_SUMMARY: summary };
  const result = cli(root, ['run', '4', 'env,building,building-controls'], env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const expected = shardBuildCache({ root, env: { ...callerEnv(), ...env } });
  assert.equal(path.dirname(expected), path.join(temp, 'probe-builds'));
  assert.match(path.basename(expected), /^[0-9a-f]{16}$/);
  assert.equal(JSON.parse(/^shared (.*)$/m.exec(result.stdout)[1]).cache, expected, 'the process was given the directory the key names');
  assert.match(result.stdout, new RegExp(`^probe-shards: the processes of shard 4 share their builds in ${expected.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  const text = readFileSync(summary, 'utf8');
  assert.match(text, /^#### Kit probes shard 4: builds$/m);
  assert.match(text, /\| shell-fixtures\/production \| 3 \| 0 \| 23 \|/);
  assert.match(text, /\| shell-fixtures\/development \| 0 \| 3 \| 0 \|/);
  assert.match(text, /\| settings-fixture\/production \| 0 \| 3 \| 0 \|/, 'a last line with no newline after it is read too');
  assert.match(text, /3 builds took 23 s and 6 reads reused them/);
  for (const part of [/^#### Kit probes shard 4: builds$/m, /\| shell-fixtures\/production \| 3 \| 0 \| 23 \|/, /3 builds took 23 s and 6 reads reused them/]) assert.match(result.stdout, part, 'the log of the shard says it too, not only the job summary');
  assert.deepEqual(JSON.parse(readFileSync(path.join(temp, 'ran-4-probe.json'), 'utf8')), {
    shard: 4,
    units: [
      { id: 'env', ok: true, runs: 1, controls: [] },
      { id: 'building', ok: true, runs: 1, controls: [] },
      { id: 'building-controls', ok: true, runs: 2, controls: ['x', 'y'] },
    ],
  });
  // The tree changes: the directory changes, so a build of the old tree is not found.
  writeFileSync(path.join(root, 'ui-next/index.html'), '<html>changed</html>');
  assert.notEqual(shardBuildCache({ root, env: { ...callerEnv(), ...env } }), expected);
});

test('the run command fails the shard when a unit drifted from its seconds, even though every probe passed, and names the unit and the number to put in the table', async () => {
  const root = scratch(PROBES);
  const table = [unit('slow', SLOW, { name: 'Slow probe', seconds: 0 })];
  const chunks = [];
  const code = await main(['--root', root, 'run', '1', 'slow'], { units: table, env: { ...callerEnv(), RUNNER_TEMP: root }, out: (text) => chunks.push(text), err: (text) => chunks.push(text), margin: { ratio: 0, floor: 0 } });
  const log = chunks.join('');
  assert.equal(code, 1, log);
  assert.match(log, /^### Kit probes shard 1: 1 run, all passed, \d+ s$/m);
  assert.match(log, /^::error title=Kit probe unit seconds \(shard 1\)::Slow probe \(slow\) took \d+ s on this runner, 0 s in/m);
  const quiet = [];
  const fine = await main(['--root', root, 'run', '1', 'slow'], { units: table, env: { ...callerEnv(), RUNNER_TEMP: root }, out: (text) => quiet.push(text), err: (text) => quiet.push(text) });
  assert.equal(fine, 0, quiet.join(''));
  assert.doesNotMatch(quiet.join(''), /::error/);
});

test('the run command fails the shard when the shard took more than its ceiling, even though every unit was inside its margin, and says so with the numbers', async () => {
  const root = scratch(PROBES);
  const table = [unit('slow', SLOW, { name: 'Slow probe', seconds: 1 })];
  const chunks = [];
  const code = await main(['--root', root, 'run', '1', 'slow'], { units: table, env: { ...callerEnv(), RUNNER_TEMP: root }, out: (text) => chunks.push(text), err: (text) => chunks.push(text), margin: { ceiling: 0 } });
  const log = chunks.join('');
  assert.equal(code, 1, log);
  assert.doesNotMatch(log, /unit seconds/);
  assert.match(log, /^::error title=Kit probe shard seconds \(shard 1\)::shard 1 took \d+ s of units on this runner, over the 0 s a shard may take/m);
});

test('verify on the command: it passes for the reports of a whole run and says what ran, and it fails, naming each, for a shard that did not report, a unit that did not pass, an empty plan and a directory that is not there', () => {
  const root = treeOfTheUnits();
  const reports = path.join(root, 'reports');
  for (const report of allReports()) {
    mkdirSync(path.join(reports, `kit-probe-reports-${report.shard}`), { recursive: true });
    writeFileSync(path.join(reports, `kit-probe-reports-${report.shard}`, `ran-${report.shard}-probe.json`), JSON.stringify(report));
  }
  const summary = path.join(root, 'summary.md');
  const controls = sum(controlUnits, (entry) => entry.controls.length);
  const good = cli(root, ['verify', '--reports', reports, '--shards', String(PLAN.shards.length)], { GITHUB_STEP_SUMMARY: summary });
  assert.equal(good.status, 0, good.stderr + good.stdout);
  assert.match(good.stdout, new RegExp(`^probe-shards: ok \\(${probeUnits.length} probes and ${controls} controls, in ${UNITS.length} units, ran once and passed, in ${PLAN.shards.length} shards\\)$`, 'm'));
  const written = readFileSync(summary, 'utf8');
  assert.match(written, new RegExp(`${probeUnits.length} probes and ${controls} controls`));
  assert.match(written, /^\| Shard \| Units that ran \|$/m);
  for (const shard of PLAN.shards) assert.ok(written.includes(`| ${shard.shard} | ${shard.units.map((entry) => entry.id).join(', ')} |`), `the summary lists what shard ${shard.shard} ran`);

  rmSync(path.join(reports, 'kit-probe-reports-4'), { recursive: true });
  const missing = cli(root, ['verify', '--reports', reports, '--shards', String(PLAN.shards.length)]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /the plan made \d+ shards and shard 4 did not report/);
  const annotated = cli(root, ['verify', '--reports', reports, '--shards', String(PLAN.shards.length)], { GITHUB_ACTIONS: 'true' });
  assert.match(annotated.stdout, /^::error title=Kit probes::the plan made \d+ shards and shard 4 did not report/m);

  const empty = cli(root, ['verify', '--reports', reports, '--shards', '']);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /the plan says "" shards/);
  const nowhere = cli(root, ['verify', '--reports', path.join(root, 'nowhere'), '--shards', '3']);
  assert.equal(nowhere.status, 1);
  assert.match(nowhere.stderr, /cannot read the reports in /);

  const broken = treeOfTheUnits();
  writeFileSync(path.join(broken, UNITS_DIRECTORY, 'rail.mjs'), 'export const units = [;\n');
  const unreadable = cli(broken, ['verify', '--reports', reports, '--shards', '3']);
  assert.equal(unreadable.status, 1, 'a table that cannot be read is not a table that has nothing to verify');
  assert.match(unreadable.stderr, /scripts\/ci\/probe-units\/rail\.mjs/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The workflow
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const stepsOf = (job) => workflow.jobs[job].steps;
const stepNamed = (job, name) => stepsOf(job).find((step) => step.name?.startsWith(name));

test('the plan job is the first job, runs on a plain runner, installs the pinned Node from .tool-versions, checks the table, packs every unit and writes the matrix and the number of shards the others read', () => {
  const job = workflow.jobs.plan;
  assert.equal(job.name, 'Kit probes plan');
  assert.equal(job['runs-on'], 'ubuntu-slim', 'the smallest runner: it reads two commits and runs two scripts (N30)');
  assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] <= 10);
  assert.equal(job.needs, undefined, 'nothing is before it');
  assert.equal(job.if, undefined, 'it runs on every event: a plan that is skipped is a run with no shard');
  assert.equal(job['continue-on-error'], undefined);
  assert.equal(job.container, undefined, 'it does not pull the CI image: it is on the critical path of every shard');
  assert.deepEqual(Object.keys(job.outputs).sort(), ['matrix', 'reason', 'scope', 'shards']);
  assert.equal(job.outputs.matrix, '${{ steps.plan.outputs.matrix }}');
  assert.equal(job.outputs.shards, '${{ steps.plan.outputs.shards }}');
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['persist-credentials'], false);
  const node = job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(node.with['node-version-file'], '.tool-versions', 'one home for the Node pin');
  assert.equal(node.with['node-version'], undefined);
  const planStep = job.steps.find((step) => step.id === 'plan');
  assert.match(planStep.run, /node scripts\/ci\/probe-shards\.mjs check/);
  assert.match(planStep.run, /node scripts\/ci\/probe-shards\.mjs --scope "\$SCOPE" --reason "\$REASON" plan/);
  assert.ok(planStep.run.indexOf('probe-shards.mjs check') < planStep.run.indexOf('probe-shards.mjs --scope'), 'the check first');
  assert.doesNotMatch(planStep.run, /--base|changed|CHANGED/, 'the plan does not read the diff itself: scripts/ci/ci-scope.mjs, the one place, does');
  const scopeStep = job.steps.find((step) => step.id === 'scope');
  assert.equal(scopeStep.run, 'node scripts/ci/ci-scope.mjs');
  assert.equal(checkout.with['fetch-depth'], 2, 'the diff of a pull request is two commits');
  assert.equal(planStep.env.SCOPE, '${{ steps.scope.outputs.scope }}');
  assert.equal(job.outputs.scope, '${{ steps.plan.outputs.scope }}');
});

test('the shard job needs the plan, takes its matrix from the plan\'s output, none stops the others, each has a limit, and the file names its probes only through the table', () => {
  const job = workflow.jobs.shard;
  assert.equal(job.needs, 'plan');
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job.strategy.matrix, '${{ fromJSON(needs.plan.outputs.matrix) }}');
  assert.match(String(job['timeout-minutes']), /^\$\{\{ needs\.plan\.outputs\.scope == 'pr' && \d+ \|\| \d+ \}\}$/, 'a limit for each scope');
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.match(job.name, /^Kit probes shard \$\{\{ matrix\.shard \}\}$/);
  const commands = stepsOf('shard').map((step) => step.run ?? '').join('\n');
  assert.match(commands, /node scripts\/ci\/probe-shards\.mjs check/);
  assert.match(commands, /node --test scripts\/ci\/probe-\*\.test\.mjs/);
  assert.doesNotMatch(commands, /node (packages\/kit\/probes|ui-next\/(shell|page)\/probes)\//, 'a probe run from the workflow file is a probe no table knows');
  const runStep = stepNamed('shard', 'Run the units of this shard');
  assert.equal(runStep.run, 'node scripts/ci/probe-shards.mjs --scope "$SCOPE" run "$SHARD" "$UNITS"', 'the shard\'s step is the command and nothing after it: no `|| true`');
  assert.equal(runStep.env.SCOPE, '${{ needs.plan.outputs.scope }}');
  assert.equal(runStep.env.SHARD, '${{ matrix.shard }}');
  assert.equal(runStep.env.UNITS, '${{ matrix.units }}');
  assert.equal(/\$\{\{ *matrix\./.test(runStep.run), false, 'the matrix reaches the command through env');
});

test('nothing in the workflow can turn a failure into a pass: no continue-on-error on a job or a step, no `|| true`, no `set +e`, and the plan and the shards run on every event', () => {
  const code = workflowText.replace(/^\s*#.*$/gm, '');
  assert.equal(/continue-on-error/.test(code), false, 'continue-on-error');
  assert.equal(/\|\|\s*true\b/.test(code), false, 'a command that swallows its failure with `|| true`');
  assert.equal(/set \+e/.test(code), false, '`set +e`');
  for (const [id, job] of Object.entries(workflow.jobs)) {
    assert.equal(job['continue-on-error'], undefined, id);
    for (const step of job.steps) assert.equal(step['continue-on-error'], undefined, `${id}: ${step.name ?? step.uses}`);
  }
  assert.equal(workflow.jobs.plan.if, undefined);
  assert.equal(workflow.jobs.shard.if, undefined);
  // The steps that are conditional are these and no other: a step that is skipped (`if: false`, or a condition that is never true) is a check that does not run.
  const conditional = Object.entries(workflow.jobs).flatMap(([id, job]) => job.steps.filter((step) => step.if !== undefined).map((step) => `${id}: ${step.name}: ${step.if}`));
  assert.deepEqual(conditional, ['shard: Build ui-next once, for the units of this shard that read it: matrix.dist == true', 'shard: Keep the reports: always()']);
});

test('N34 (the owner\'s order): the workflow runs every night and by hand and on nothing else: not on a pull request and not on a push to main, and the nightly run is the full one (every probe and every control, both engines)', () => {
  assert.equal(workflow.env.OMNIVIEW_UI, 'next');
  assert.equal(workflow.env.NODE_VERSION, undefined, 'Node is the image\'s, checked against .tool-versions by the guard step: a second pin here is a second home');
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.schedule, [{ cron: '17 3 * * *' }]);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.scope.options, ['full', 'pr']);
  assert.equal(workflow.on.workflow_dispatch.inputs.scope.default, 'full');
});

test('N34: a run of the probes is never cancelled by a newer one, and the runs are grouped by the ref they ran on', () => {
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.concurrency.group, 'ui-next-kit-probes-${{ github.ref }}');
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

test('the reports are kept per shard, under a name of their own, whatever the shard did, replacing what an earlier attempt of the run uploaded, and the file the shard writes about itself is among them', () => {
  const upload = stepsOf('shard').find((step) => step.uses?.startsWith('actions/upload-artifact'));
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.name, 'kit-probe-reports-${{ matrix.shard }}');
  assert.equal(upload.with.overwrite, true, 'a re-run of a shard uploads the same name again: without this the upload fails and the run can never go green, or the verdict reads the first attempt\'s file');
  // `ran-<shard>-probe.json` is written to $RUNNER_TEMP, which the upload's glob reads.
  assert.equal(upload.with.path, '${{ runner.temp }}/*-probe.json');
  assert.ok('ran-12-probe.json'.endsWith('-probe.json'), 'the glob is `*-probe.json`: the file named ran-<shard>-probe.json is one of the files it matches');
});

test('the check named `Kit probes` is the aggregating job: the only job of that name, after the plan and every shard, run whatever happened (a cancelled run leaves a check, not an absence), and no shard is called that', () => {
  const named = Object.entries(workflow.jobs).filter(([, job]) => job.name === 'Kit probes');
  assert.deepEqual(named.map(([id]) => id), ['probes']);
  const aggregator = workflow.jobs.probes;
  assert.deepEqual([...aggregator.needs].sort(), ['plan', 'shard']);
  assert.equal(aggregator.if, '${{ always() }}');
  assert.equal(aggregator.permissions.actions, 'read');
  assert.equal(aggregator.permissions.contents, 'read');
  assert.ok(Number.isInteger(aggregator['timeout-minutes']) && aggregator['timeout-minutes'] <= 10);
  assert.equal(aggregator.container, undefined);
  const checkout = aggregator.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['persist-credentials'], false, 'the verdict reads the units of the checkout it runs in');
  assert.equal(aggregator.steps.find((step) => step.uses?.startsWith('actions/setup-node@')).with['node-version-file'], '.tool-versions');
  const results = stepNamed('probes', 'Require the plan and every probe shard');
  assert.equal(results.env.PLAN_RESULT, '${{ needs.plan.result }}');
  assert.equal(results.env.SHARD_RESULT, '${{ needs.shard.result }}');
  assert.ok(stepsOf('probes').indexOf(results) < stepsOf('probes').indexOf(stepNamed('probes', 'Require every unit')), 'the results first, then what ran');
});

test('the verdict step reads the number of shards the PLAN made, downloads every artifact of the shards\' reports by the name they were uploaded under, and runs verify on them', () => {
  const step = stepNamed('probes', 'Require every unit of the table to have run and passed');
  assert.equal(step.env.PLAN_SHARDS, '${{ needs.plan.outputs.shards }}');
  assert.equal(step.env.SCOPE, '${{ needs.plan.outputs.scope }}');
  assert.equal(step.env.GH_TOKEN, '${{ github.token }}');
  const upload = stepsOf('shard').find((entry) => entry.uses?.startsWith('actions/upload-artifact'));
  const prefix = upload.with.name.replace('${{ matrix.shard }}', '');
  assert.match(step.run, new RegExp(`gh run download "\\$GITHUB_RUN_ID" --pattern '${prefix}\\*' --dir "\\$RUNNER_TEMP/reports"`));
  assert.match(step.run, /node scripts\/ci\/probe-shards\.mjs --scope "\$SCOPE" --reason "\$REASON" verify --reports "\$RUNNER_TEMP\/reports" --shards "\$PLAN_SHARDS"/);
  assert.equal(/\$\{\{/.test(step.run), false, 'nothing of the run reaches the command but through env');
});

// The verdict, run: the `run:` of its second step, executed by bash as the runner does (`bash -e <file>`), at the root of this repository (so that it reads the real units), with `gh` replaced by a stand-in that
// puts canned artifacts where `gh run download` would, one directory for each.
function verdictStep() {
  return stepNamed('probes', 'Require every unit of the table to have run and passed').run;
}

function verdict({ reports = allReports(), shards = String(PLAN.shards.length), scope = 'full' } = {}) {
  const directory = scratch({ 'gate.sh': verdictStep() });
  const artifacts = path.join(directory, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  for (const report of reports) {
    mkdirSync(path.join(artifacts, `kit-probe-reports-${report.shard}`), { recursive: true });
    writeFileSync(path.join(artifacts, `kit-probe-reports-${report.shard}`, `ran-${report.shard}-probe.json`), JSON.stringify(report));
  }
  const bin = path.join(directory, 'bin');
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, 'gh'),
    ['#!/usr/bin/env bash', 'echo "gh $*" >> "$FAKE_GH_LOG"', 'if [ "$1 $2" != "run download" ]; then exit 3; fi', 'dir=""', 'for ((i = 1; i <= $#; i++)); do if [ "${!i}" = "--dir" ]; then j=$((i + 1)); dir="${!j}"; fi; done', 'mkdir -p "$dir"', 'cp -R "$FAKE_ARTIFACTS"/. "$dir"/', ''].join('\n'),
  );
  chmodSync(path.join(bin, 'gh'), 0o755);
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: directory,
    RUNNER_TEMP: path.join(directory, 'temp'),
    PLAN_SHARDS: shards,
    SCOPE: scope,
    REASON: 'a test',
    GH_TOKEN: 'token',
    GITHUB_RUN_ID: '9',
    FAKE_ARTIFACTS: artifacts,
    FAKE_GH_LOG: path.join(directory, 'gh.log'),
  };
  const outcome = spawnSync('/bin/bash', ['-e', path.join(directory, 'gate.sh')], { encoding: 'utf8', env, cwd: repo });
  return { ...outcome, output: `${outcome.stdout}${outcome.stderr}`, called: readFileSync(env.FAKE_GH_LOG, 'utf8') };
}

test('the verdict step passes when every shard the plan made reported every unit of the table passing, and asks GitHub for the artifacts of this run', () => {
  const outcome = verdict();
  assert.equal(outcome.status, 0, outcome.output);
  assert.match(outcome.output, /probe-shards: ok \(\d+ probes and \d+ controls/);
  assert.match(outcome.called, /^gh run download 9 --pattern kit-probe-reports-\* --dir .*\/temp\/reports$/m);
});

test('negative control: the verdict step fails for a shard that never reported, a plan that was short, a unit that failed, a plan nobody can read, and artifacts that are not there', () => {
  const dropped = verdict({ reports: allReports().filter((report) => report.shard !== 2) });
  assert.equal(dropped.status, 1, dropped.output);
  assert.match(dropped.output, /the plan made \d+ shards and shard 2 did not report/);

  const short = verdict({ reports: allReports().slice(0, 4), shards: '4' });
  assert.equal(short.status, 1, 'a plan of four shards of eleven that all passed: the table says what had to run');
  assert.match(short.output, /the unit "[a-z-]+" ran in no shard/);

  const failing = allReports();
  failing[0].units[0].ok = false;
  const failed = verdict({ reports: failing });
  assert.equal(failed.status, 1, failed.output);
  assert.match(failed.output, /the unit "[a-z-]+" did not pass in shard 1/);

  for (const shards of ['', '0', 'many']) {
    const unreadable = verdict({ shards });
    assert.equal(unreadable.status, 1, `${JSON.stringify(shards)}: ${unreadable.output}`);
    assert.match(unreadable.output, /the plan says ".*" shards/);
  }

  const nothing = verdict({ reports: [] });
  assert.equal(nothing.status, 1, nothing.output);
});

// The gate: the `run:` of the aggregating job's first step, executed by bash as the runner does (`bash -e <file>`), with `gh` replaced by a stand-in that answers from a canned job list through the real jq filter.
const gateScript = () => stepNamed('probes', 'Require the plan and every probe shard').run;
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

function gate({ plan: planResult = 'success', shard = 'success' } = {}, { jobs = JOBS, ghFails = false, noGh = false } = {}) {
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A bound in milliseconds is held against what the runner read (the notices probe's `centre open`)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// The centre opens in a time that depends on the machine: 9 to 11 ms (WebKit) on a laptop, 16 to 27 on the runner's virtual machines and 35 and 38 on a slow one, the medians that failed pull request #650 once against a bound of two
// frames (33.3 ms). N25 first scaled the bound by a calibration measured in the same page, and the independent review showed that a regression in the page's CSS inflates that calibration as much as it slows the open (a 7 to 9
// times slower open passed). So the bound is a CONSTANT for each engine, and it is held to the runner's record: the medians of every run that printed them (ui-next/shell/probes/runner-centre-open.json, from the job logs of
// this workflow) and a margin above the worst of them. The probe has the constant and prints every sample whatever it finds.
const noticesProbe = () => readFileSync(path.join(repo, 'ui-next/shell/probes/notices-probe.mjs'), 'utf8');
const centreRecord = () => JSON.parse(readFileSync(path.join(repo, 'ui-next/shell/probes/runner-centre-open.json'), 'utf8'));
const openBound = (text) => {
  const found = /^const OPEN_BOUND_MS = \{ chromium: (\d+(?:\.\d+)?), webkit: (\d+(?:\.\d+)?) \};$/m.exec(text);
  return found === null ? null : { chromium: Number(found[1]), webkit: Number(found[2]) };
};
const BOUND_MARGIN = 1.5;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 === 1 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
const centreReads = (record, engineName) => record.runs.flatMap((entry) => Object.entries(entry.centre).filter(([key]) => key.startsWith(`${engineName} `)).map(([, read]) => read));

test('the centre-open bound of the notices probe is a constant for each engine: no calibration, no scale, and every sample still printed', () => {
  const text = noticesProbe();
  assert.ok(openBound(text) !== null, 'the probe has `const OPEN_BOUND_MS = { chromium: <ms>, webkit: <ms> };`');
  assert.doesNotMatch(text, /calibrat|SCALE_CAP|CALIBRATION_REFERENCE/i, 'a bound that is measured in the page can be inflated by the regression it is meant to catch (review of #656, S5)');
  assert.match(text, /console\.log\(`centre open \$\{where\}: \$\{JSON\.stringify\(times\)\} ms, median \$\{middle\} ms of \$\{budget\}/, 'every sample is printed, with the median and the bound');
  assert.match(text, /if \(middle >= budget\)/);
});

test('the bound of each engine is 1.5 times the worst median the runner has read, rounded up, over every run of the record: the slow virtual machine of #650 (38 and 13.4 ms) passes, with room', () => {
  const bound = openBound(noticesProbe());
  assert.ok(bound !== null);
  const record = centreRecord();
  assert.ok(record.runs.length >= 17, `${record.runs.length} runs in the record`);
  for (const engineName of ['webkit', 'chromium']) {
    const reads = centreReads(record, engineName);
    assert.ok(reads.length >= 34, `${engineName}: ${reads.length} medians`);
    for (const read of reads) assert.equal(median(read.samples), read.median, `${engineName}: the median of ${JSON.stringify(read.samples)} is not ${read.median}`);
    const medians = reads.map((read) => read.median);
    const worst = Math.max(...medians);
    assert.equal(bound[engineName], Math.ceil(worst * BOUND_MARGIN), `${engineName}: the worst median of the record is ${worst} ms (median ${median(medians)}, 95th percentile ${quantile(medians, 0.95)}), the bound ${bound[engineName]} ms`);
    for (const read of reads) assert.ok(read.median < bound[engineName], `${engineName}: a median of ${read.median} ms fails the bound of ${bound[engineName]} ms`);
  }
  assert.ok(Math.max(...centreReads(record, 'webkit').map((read) => read.median)) >= 38, 'the record holds the median that failed #650 (38 ms): without it the bound has no worst case behind it');
});

test('the bound still catches the review\'s regression: it is under the open of the global-CSS repro in both engines (74 and 35 ms on a laptop), and the control `centre-slow-open` is longer than the bound, so that it fails on any machine', () => {
  const text = noticesProbe();
  const bound = openBound(text);
  assert.ok(bound !== null);
  assert.ok(bound.webkit < 74 && bound.chromium < 35, 'the review\'s repro (2,500 pairs of selectors every element is matched against) is 6.8 and 9.4 times the laptop\'s open, and fails');
  const busy = /^const SLOW_OPEN_MS = (\d+);$/m.exec(text);
  assert.ok(busy !== null, 'the control\'s busy loop is a named constant');
  assert.ok(Number(busy[1]) >= Math.max(bound.chromium, bound.webkit), `a busy loop of ${busy[1]} ms in the click is over the bound of either engine`);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The scope of a run (N30): a pull request runs the probes in WebKit and no negative control; main, the nightly run and a manual run run everything
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('a pull request\'s scope is the probes and no negative control, in fewer, longer shards; a full run is the table', () => {
  const probes = engine.unitsOfScope(UNITS, 'pr');
  assert.ok(probes.length > 0 && probes.every((entry) => entry.controls === undefined));
  assert.equal(probes.length, UNITS.filter((entry) => entry.controls === undefined).length);
  assert.deepEqual(engine.unitsOfScope(UNITS, 'full'), UNITS);
  const pr = planRun({ units: probes, limit: engine.PR_LIMIT_SECONDS });
  const full = planRun({ units: UNITS });
  assert.deepEqual(pr.shards.flatMap((shard) => shard.units.map((entry) => entry.id)).sort(), probes.map((entry) => entry.id).sort());
  assert.ok(pr.shards.length <= full.shards.length / 2, `${pr.shards.length} shards for a pull request against ${full.shards.length} for a full run`);
  for (const shard of pr.shards) assert.ok(shard.seconds <= engine.PR_LIMIT_SECONDS);
  assert.deepEqual(matrixOf(pr.shards, { engines: engine.PR_ENGINES }).include.map((entry) => entry.engines), pr.shards.map(() => 'webkit'));
});

test('the plan command for a pull request writes the scope, plans no control unit, tells the shards the engine, and says so in the summary', () => {
  const root = treeOfTheUnits();
  const output = path.join(root, 'github-output');
  const summary = path.join(root, 'summary.md');
  const result = cli(root, ['--scope', 'pr', '--reason', '3 changed files, none of them test infrastructure', 'plan'], { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const written = outputs(output);
  assert.equal(written.scope, 'pr');
  const matrix = JSON.parse(written.matrix);
  assert.deepEqual(matrix.include.flatMap((entry) => entry.units.split(',')).sort(), UNITS.filter((entry) => entry.controls === undefined).map((entry) => entry.id).sort());
  for (const entry of matrix.include) assert.equal(entry.engines, 'webkit');
  assert.match(result.stdout, /Pull request scope \(3 changed files, none of them test infrastructure\): the probes in WebKit, the negative controls are NOT run on pull requests/);
});

test('the verdict of a pull request requires the probes only, passes without a control, and says in its own line that the controls were not run; the verdict of a full run still requires them', async () => {
  const root = treeOfTheUnits();
  const probes = engine.unitsOfScope(UNITS, 'pr');
  const pr = planRun({ units: probes, limit: engine.PR_LIMIT_SECONDS });
  const reports = pr.shards.map((shard) => ranReport(shard.shard, resultsOf(shard.units.map((entry) => byId(entry.id)))));
  const reportsDir = path.join(root, 'reports');
  for (const report of reports) {
    mkdirSync(path.join(reportsDir, `kit-probe-reports-${report.shard}`), { recursive: true });
    writeFileSync(path.join(reportsDir, `kit-probe-reports-${report.shard}`, `ran-${report.shard}-probe.json`), JSON.stringify(report));
  }

  const summary = path.join(root, 'summary.md');
  const ok = cli(root, ['--scope', 'pr', '--reason', 'a docs change', 'verify', '--reports', reportsDir, '--shards', String(pr.shards.length)], { GITHUB_STEP_SUMMARY: summary });
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.match(ok.stdout, /probe-shards: ok \(\d+ probes and 0 controls, in \d+ units, ran once and passed, in \d+ shards \(WebKit\)\)/);
  assert.match(ok.stdout, /probe-shards: not run on pull requests: \d+ negative controls in \d+ units were NOT RUN on this pull request/);
  assert.match(readFileSync(summary, 'utf8'), /\*\*Not run on pull requests:\*\*/);
  // The same reports against the full table are red: the controls did not run, and a run that was meant to have them is not whole.
  const full = cli(root, ['verify', '--reports', reportsDir, '--shards', String(pr.shards.length)]);
  assert.equal(full.status, 1, 'the full scope requires every control unit');
  // A pull request's verdict still fails for a probe that did not pass, and for a shard that never reported.
  const failing = structuredClone(reports);
  failing[0].units[0].ok = false;
  writeFileSync(path.join(reportsDir, `kit-probe-reports-${failing[0].shard}`, `ran-${failing[0].shard}-probe.json`), JSON.stringify(failing[0]));
  const failed = cli(root, ['--scope', 'pr', 'verify', '--reports', reportsDir, '--shards', String(pr.shards.length)]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /did not pass in shard 1/);
  // The passing report is put back, so that the next assertion is about the missing shard and nothing else.
  writeFileSync(path.join(reportsDir, `kit-probe-reports-${reports[0].shard}`, `ran-${reports[0].shard}-probe.json`), JSON.stringify(reports[0]));
  assert.equal(cli(root, ['--scope', 'pr', 'verify', '--reports', reportsDir, '--shards', String(pr.shards.length)]).status, 0, 'with every report back it passes again');
  const missing = cli(root, ['--scope', 'pr', 'verify', '--reports', reportsDir, '--shards', String(pr.shards.length + 1)]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, new RegExp(`shard ${String(pr.shards.length + 1)} did not report`));
});

test('a pull request\'s shard runs its probes with ENGINES=webkit, does not warn about a probe that is faster than its two-engine seconds, and fails past its own ceiling', () => {
  const results = [{ label: 'a', unit: 'a', ok: true, seconds: 10 }];
  const units = [{ id: 'a', name: 'A', file: 'f.mjs', seconds: 200 }];
  assert.equal(driftFindings('1', results, units).warnings.length, 1, 'a full run warns for a unit that is far under its seconds');
  assert.equal(driftFindings('1', results, units, { warnFaster: false }).warnings.length, 0);
  assert.equal(driftFindings('1', [{ ...results[0], seconds: 261 }], units, { warnFaster: false }).failures.length, 1, 'slower is still a failure');
  assert.equal(engine.PR_ENGINES, 'webkit');
  assert.equal(engine.PR_SHARD_CEILING_SECONDS, Math.ceil(engine.PR_LIMIT_SECONDS * 1.3));
  const text = readFileSync(path.join(repo, 'scripts/ci/probe-shards.mjs'), 'utf8');
  assert.match(text, /const shardEnv = scope === 'pr' \? \{ \.\.\.env, ENGINES: PR_ENGINES \} : env;/);
});

test('a pull request\'s scope is decided in one place: the plan reads the output of scripts/ci/ci-scope.mjs, and the shards and the verdict read the plan\'s', () => {
  const scope = workflow.jobs.plan.steps.find((step) => step.id === 'scope');
  assert.equal(scope.run, 'node scripts/ci/ci-scope.mjs');
  assert.equal(scope.env.SCOPE_INPUT, '${{ inputs.scope }}');
  assert.equal(scope.env.PR_LABELS, undefined, 'a label does not change the scope (a manual run does)');
  const text = workflowText.replace(/^\s*#.*$/gm, '');
  assert.equal(/github\.event\.pull_request\.labels/.test(text), false);
  assert.equal(/steps\.scope\.outputs\.scope/.test(text), true);
  assert.equal(/github\.event_name == 'pull_request'/.test(text), false, 'the workflow no longer runs on a pull request (N34)');
});

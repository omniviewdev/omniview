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

test('the matrix is the one line of JSON the workflow reads: `{ include: [{ shard, units, seconds, dist }] }`, the units as ids joined by commas, in shard order', () => {
  const matrix = matrixOf(PLAN.shards);
  assert.deepEqual(Object.keys(matrix), ['include']);
  assert.equal(matrix.include.length, PLAN.shards.length);
  matrix.include.forEach((entry, index) => {
    assert.deepEqual(Object.keys(entry), ['shard', 'units', 'seconds', 'dist']);
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The shard is held too: a ceiling on the REAL seconds of all its units
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

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
  assert.deepEqual(Object.keys(written).sort(), ['matrix', 'shards']);
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

test('the verdict step reads the number of shards the PLAN made, downloads every artifact of the shards\' reports by the name they were uploaded under, and runs verify on them', () => {
  const step = stepNamed('probes', 'Require every unit of the table to have run and passed');
  assert.equal(step.env.PLAN_SHARDS, '${{ needs.plan.outputs.shards }}');
  assert.equal(step.env.GH_TOKEN, '${{ github.token }}');
  const upload = stepsOf('shard').find((entry) => entry.uses?.startsWith('actions/upload-artifact'));
  const prefix = upload.with.name.replace('${{ matrix.shard }}', '');
  assert.match(step.run, new RegExp(`gh run download "\\$GITHUB_RUN_ID" --pattern '${prefix}\\*' --dir "\\$RUNNER_TEMP/reports"`));
  assert.match(step.run, /node scripts\/ci\/probe-shards\.mjs verify --reports "\$RUNNER_TEMP\/reports" --shards "\$PLAN_SHARDS"/);
  assert.equal(/\$\{\{/.test(step.run), false, 'nothing of the run reaches the command but through env');
});

// The verdict, run: the `run:` of its second step, executed by bash as the runner does (`bash -e <file>`), at the root of this repository (so that it reads the real units), with `gh` replaced by a stand-in that
// puts canned artifacts where `gh run download` would, one directory for each.
function verdictStep() {
  return stepNamed('probes', 'Require every unit of the table to have run and passed').run;
}

function verdict({ reports = allReports(), shards = String(PLAN.shards.length) } = {}) {
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A bound in milliseconds is held against what the runner read (the notices probe's `centre open`)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------


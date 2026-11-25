// The seam check's shards (scripts/ci/seam-shards.mjs, scripts/ci/seam-units.mjs, .github/workflows/ui-next-seam.yml): the table against the check, the plan, what a shard's logs say it ran, the seconds, the verdict, and the workflow
// that carries them. No network: the check is read, and run only for its own list (`SEAM_LIST=1`), which needs the repository's dependencies as the shards have them.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import {
  CHECK,
  ENGINES,
  JOB_TIMEOUT_MINUTES,
  LIMIT_SECONDS,
  PHASE_START_SECONDS,
  SHARD_CEILING_SECONDS,
  checkUnits,
  driftFindings,
  listFromCheck,
  listFromText,
  loadUnits,
  main,
  matrixOf,
  parseControlRuns,
  parseDetected,
  parsePhases,
  planRun,
  ranReport,
  ranUnits,
  readReports,
  renderPlan,
  verifyRan,
} from './seam-shards.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { units: UNITS } = await loadUnits(repo);
const LIST = listFromCheck(repo);
const copy = () => structuredClone(UNITS);
const stamp = '2026-11-25T02:11:09.1234567Z ';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What the check has
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the text the plan reads is what the check says of itself: SEAM_LIST=1 prints the same phases and the same control runs', () => {
  const ran = spawnSync(process.execPath, [path.join(repo, CHECK)], { cwd: repo, env: { ...process.env, SEAM_LIST: '1' }, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(JSON.parse(ran.stdout), LIST);
});

// The counts of the check move with every scenario and control added to it (that is the point of the plan: it names what is missing), so they are read from the check and only a FLOOR is pinned: the phases and the controls it had
// when N29 split it. A deletion shows as a number under the floor; an addition is not a test failure.
const CONTROLS_IN_CHECK = LIST.controls.reduce((sum, entry) => sum + entry.proves.length, 0);
const PHASES_IN_CHECK = LIST.phases.length;
test('the check has at least the phases and the controls it had when N29 split it (26 phases, 104 controls in 29 runs)', () => {
  assert.ok(LIST.phases.length >= 26);
  assert.ok(LIST.controls.length >= 29);
  assert.ok(CONTROLS_IN_CHECK >= 104);
  // The controls of a table are one run for the whole table; every other one is a run of its own, the settings controls among them (`SEAM_CONTROL=settings` does not detect `settings-reach`).
  assert.deepEqual(LIST.controls.filter((entry) => entry.proves.length > 1).map((entry) => entry.run), ['process', 'failed-load', 'plugins-page', 'connections', 'problems-operations', 'ports', 'terminal-reconnect', 'terminal-isolation']);
  assert.ok(LIST.controls.some((entry) => entry.run === 'settings-reach'));
  assert.ok(!LIST.controls.some((entry) => entry.run === 'settings'));
});

test('the check selects its phases from one list: PHASE_IDS is the key order of the table the loop runs, and a selected run ends in its own line', () => {
  const text = readFileSync(path.join(repo, CHECK), 'utf8');
  assert.equal(text.split('await phase(id, name, phases[id])').length - 1, 1, 'one call runs every phase');
  assert.match(text, /assert\.deepEqual\(Object\.keys\(phases\), PHASE_IDS/);
  assert.match(text, /throw new Error\(`SEAM_PHASES names phases the check does not have/);
  assert.equal(text.split('console.log(`SEAM-PHASE ${engine} ${name} ').length - 1, 1, 'a phase that passed prints one line, the one `parsePhases` reads');
  // No wait for a host to exit leaves an 8 s timer behind (N29: the 8 s every run of a control waited for at its end).
  assert.equal(/setTimeout\(resolve, 8000\)/.test(text), false);
  assert.equal(text.split('untilExited(').length - 1, 13, 'the twelve waits (the twelfth is the one of scenario w that waits for its host to be gone before it asks whether a forward still listens) and the helper\'s own definition');
});

test('listFromText reads the phase list and the control tables, and says what is missing', () => {
  const text = [
    'const CONTROLS = {',
    "  'a-control': /x/,",
    "  'settings-one': /y/,",
    '};',
    'const PROCESS_CONTROLS = {',
    "  'p1': /x/,",
    '  bare: /x/,',
    '};',
    'const FAILED_CONTROLS = {',
    "  'f1': /x/,",
    '};',
    'const PAGE_CONTROLS = {',
    "  'g1': /x/,",
    '};',
    'const CONNECTIONS_CONTROLS = {',
    "  'c1': /x/,",
    '};',
    'const PT_CONTROLS = {',
    "  't1': /x/,",
    '};',
    'const RECONNECT_CONTROLS = {',
    "  'r1': /x/,",
    '};',
    'const ISOLATION_CONTROLS = {',
    "  'i1': /x/,",
    '};',
    'const PORTS_CONTROLS = {',
    "  'w1': /x/,",
    '};',
    'const PHASE_IDS = [',
    "  'one',",
    "  'two-b',",
    '];',
  ].join('\n');
  assert.deepEqual(listFromText(text), {
    phases: ['one', 'two-b'],
    controls: [
      { run: 'a-control', proves: ['a-control'] },
      { run: 'settings-one', proves: ['settings-one'] },
      { run: 'process', proves: ['p1', 'bare'] },
      { run: 'failed-load', proves: ['f1'] },
      { run: 'plugins-page', proves: ['g1'] },
      { run: 'connections', proves: ['c1'] },
      { run: 'problems-operations', proves: ['t1'] },
      { run: 'ports', proves: ['w1'] },
      { run: 'terminal-reconnect', proves: ['r1'] },
      { run: 'terminal-isolation', proves: ['i1'] },
    ],
  });
  assert.throws(() => listFromText(text.replace('const PHASE_IDS = [', 'const OTHER = [')), /no `const PHASE_IDS = \[` list/);
  assert.throws(() => listFromText(`${text}\nconst DOCKS_CONTROLS = {\n  'x': /y/,\n};`), /a table of negative controls that the plan does not know: DOCKS_CONTROLS/);
  assert.throws(() => listFromText(text.replace('const PT_CONTROLS = {', 'const OTHER = {')), /no `const PT_CONTROLS = \{` block/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The table against the check
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the table has every phase and every control run of the check once, and nothing else', () => {
  assert.deepEqual(checkUnits({ units: UNITS, list: LIST }), []);
});

test('NEGATIVE: a phase of the check that no unit has is named, and so is one that two have; a phase a unit has and the check lacks too', () => {
  const lost = copy();
  lost.find((unit) => unit.id === 'terminal-find').phases = ['session-x'];
  const problems = checkUnits({ units: lost, list: LIST });
  assert.ok(problems.some((message) => /the phase "terminal-find" of .* is in no unit/.test(message)), problems.join('\n'));
  assert.ok(problems.some((message) => /runs the phase "session-x", which .* does not have/.test(message)));
  const twice = copy();
  twice.find((unit) => unit.id === 'session').phases.push('rail');
  assert.ok(checkUnits({ units: twice, list: LIST }).some((message) => /the phase "rail" is in 2 units \(pages, session\)/.test(message)));
});

test('NEGATIVE: a control run of the check that no unit has is named with the controls it proves, one that two have is named, and one the check lacks is named', () => {
  const lost = copy();
  const unit = lost.find((entry) => entry.id === 'controls-plugins-page');
  unit.runs = [];
  lost.push({ id: 'controls-x', runs: ['no-such-run'], seconds: 10 });
  const problems = checkUnits({ units: lost, list: LIST });
  assert.ok(problems.some((message) => /`SEAM_CONTROL=plugins-page` of .* \(.*second-list.*\) is in no unit/.test(message)), problems.join('\n'));
  assert.ok(problems.some((message) => /has no run, or one that is not a name/.test(message)));
  assert.ok(problems.some((message) => /runs `SEAM_CONTROL=no-such-run`, which .* does not have/.test(message)));
  const twice = copy();
  twice.find((entry) => entry.id === 'controls-kept').runs.push('settings-reach');
  assert.ok(checkUnits({ units: twice, list: LIST }).some((message) => /the negative control run `settings-reach` is in 2 units \(controls-kept, controls-settings-slow\)/.test(message)));
});

test('NEGATIVE: a scenario added to the check and to no unit is red: one more phase and one more control in the check text', () => {
  const grown = { phases: [...LIST.phases, 'terminal-resize'], controls: [...LIST.controls, { run: 'terminal-resize-wrong', proves: ['terminal-resize-wrong'] }] };
  const problems = checkUnits({ units: UNITS, list: grown });
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems[0], /the phase "terminal-resize" .* is in no unit/);
  assert.match(problems[1], /terminal-resize-wrong/);
});

test('NEGATIVE: a unit that does not hold together is named: no id, a twin id, no seconds, too many seconds, both phases and runs, neither, a name that is not one', () => {
  const bad = [
    { id: 'A B', phases: ['x'], seconds: 10 },
    { id: 'one', phases: ['x'], seconds: 10 },
    { id: 'one', phases: ['y'], seconds: 10 },
    { id: 'two', phases: ['z'] },
    { id: 'three', phases: ['q'], seconds: 1.5 },
    { id: 'four', phases: ['w'], seconds: LIMIT_SECONDS },
    { id: 'five', phases: ['a'], runs: ['b'], seconds: 10 },
    { id: 'six', seconds: 10 },
    { id: 'seven', runs: [3], seconds: 10 },
    null,
  ];
  const problems = checkUnits({ units: bad, list: { phases: [], controls: [] } });
  for (const pattern of [/needs an id/, /is declared twice/, /has undefined seconds/, /has 1.5 seconds/, /is 420 s, over the 405 s a shard may hold/, /is either `phases/, /has no run, or one that is not a name/, /is not an object/]) {
    assert.ok(problems.some((message) => pattern.test(message)), `${String(pattern)} in ${problems.join('\n')}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the plan runs every unit once, in shards that each stay at or under the limit, and the fewest: four', () => {
  const shards = planRun({ units: UNITS });
  assert.deepEqual(shards.flatMap((shard) => shard.units.map((entry) => entry.id)).sort(), UNITS.map((unit) => unit.id).sort());
  for (const shard of shards) assert.ok(shard.seconds <= LIMIT_SECONDS, `shard ${shard.shard}: ${shard.seconds} s`);
  const total = UNITS.reduce((sum, unit) => sum + unit.seconds, 0);
  assert.equal(shards.length, 4, `${total} s of units`);
  assert.ok(total > 2 * (LIMIT_SECONDS - PHASE_START_SECONDS), 'two shards could not hold the table');
  assert.deepEqual(shards.map((shard) => shard.shard), [1, 2, 3, 4]);
});

test('a shard\'s phases are those of its units and its controls the runs of its units; the start of the host is added to a shard that has phases only', () => {
  const units = [
    { id: 'a', phases: ['p1', 'p2'], seconds: 100 },
    { id: 'b', runs: ['r1', 'r2'], seconds: 200 },
    { id: 'c', runs: ['r3'], seconds: 300 },
  ];
  const shards = planRun({ units, limit: 410 });
  assert.equal(shards.length, 2);
  const withPhases = shards.find((shard) => shard.phases.length > 0);
  assert.deepEqual(withPhases.phases, ['p1', 'p2']);
  assert.equal(withPhases.seconds, withPhases.units.reduce((sum, entry) => sum + entry.seconds, 0) + PHASE_START_SECONDS);
  const only = shards.find((shard) => shard.phases.length === 0);
  assert.equal(only.seconds, only.units.reduce((sum, entry) => sum + entry.seconds, 0));
  assert.deepEqual(shards.flatMap((shard) => shard.controls).sort(), ['r1', 'r2', 'r3']);
});

test('NEGATIVE: a table with no unit plans no shard, and a unit over the limit is an error', () => {
  assert.throws(() => planRun({ units: [] }), /the plan has no shard/);
  assert.throws(() => planRun({ units: [{ id: 'big', phases: ['x'], seconds: LIMIT_SECONDS }] }), /over the/);
});

test('the matrix is every shard in every engine, with the phases in the check\'s order and the runs in the unit\'s', () => {
  const shards = planRun({ units: UNITS });
  const matrix = matrixOf(shards, LIST.phases);
  assert.equal(matrix.include.length, ENGINES.length * shards.length);
  for (const engine of ENGINES) assert.deepEqual(matrix.include.filter((entry) => entry.engine === engine).map((entry) => entry.shard), [1, 2, 3, 4]);
  for (const entry of matrix.include) {
    const ids = entry.phases === '' ? [] : entry.phases.split(',');
    assert.deepEqual(ids, [...ids].sort((a, b) => LIST.phases.indexOf(a) - LIST.phases.indexOf(b)), 'in the check\'s order');
    assert.equal(typeof entry.units, 'string');
    assert.equal(typeof entry.controls, 'string');
  }

  assert.deepEqual(matrix.include.filter((entry) => entry.engine === 'webkit').flatMap((entry) => entry.phases.split(',').filter(Boolean)).sort(), [...LIST.phases].sort());
  assert.deepEqual(matrix.include.filter((entry) => entry.engine === 'chromium').flatMap((entry) => entry.controls.split(' ').filter(Boolean)).sort(), LIST.controls.map((entry) => entry.run).sort());
});

test('the plan states what it plans', () => {
  const text = renderPlan(planRun({ units: UNITS }), UNITS, LIST);
  assert.match(text, new RegExp(`${String(PHASES_IN_CHECK)} phases and ${String(CONTROLS_IN_CHECK)} controls, ${String(UNITS.length)} units, \\d+ s listed in 4 shards of at most 420 s each`));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What a shard's logs say
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('parsePhases reads the lines the check prints for one engine, with a timestamp or without, and nothing else', () => {
  const log = [
    `${stamp}SEAM-PHASE webkit rail 3.5`,
    'SEAM-PHASE webkit kept 10.2',
    'SEAM-PHASE chromium kept 9.0',
    '\u001b[32mSEAM-PHASE webkit logs 7\u001b[0m',
    'xSEAM-PHASE webkit twins 1',
    'SEAM-PHASE webkit Bad_Name 1',
    '  SEAM-PHASE webkit indented 1',
    'SEAM-PHASE webkit failed 1.2 s',
  ].join('\n');
  assert.deepEqual(parsePhases(log, 'webkit'), [{ id: 'rail', seconds: 3.5 }, { id: 'kept', seconds: 10.2 }, { id: 'logs', seconds: 7 }]);
  assert.deepEqual(parsePhases(log, 'chromium'), [{ id: 'kept', seconds: 9 }]);
});

test('parseDetected reads the controls a run detected in one engine, and not one that was NOT DETECTED or one removed on purpose', () => {
  const log = [
    `${stamp}NEGATIVE CONTROL "pid-pattern": detected in webkit: webkit: the process the host names is the fixture plugin's own`,
    'NEGATIVE CONTROL "frame-text": detected in webkit: webkit: the host\'s plugin/unloaded carries',
    'NEGATIVE CONTROL "rail-fine": NOT DETECTED in webkit',
    'NEGATIVE CONTROL "page-drawn": failed in webkit, but not the assertion it is named for: x',
    'NEGATIVE CONTROL "tool-stays": NOT DETECTED in webkit with its assertion removed, as it must be',
    'NEGATIVE CONTROL "session-live": detected in webkit with its assertion removed, by x',
    'NEGATIVE CONTROL "two-pages": detected in chromium: other engine',
    'runtime-4xx NEGATIVE CONTROL "x": detected in webkit: not at the start',
  ].join('\n');
  assert.deepEqual(parseDetected(log, 'webkit'), ['pid-pattern', 'frame-text']);
  assert.deepEqual(parseDetected(log, 'chromium'), ['two-pages']);
});

test('parseControlRuns reads the rows the step wrote', () => {
  assert.deepEqual(parseControlRuns('process\tdetected\t57\nconnections\tNOT DETECTED\t39\n\n'), [
    { run: 'process', ok: true, seconds: 57 },
    { run: 'connections', ok: false, seconds: 39 },
  ]);
});

/** Logs of a shard that ran every unit it was given, as the check and the step write them. */
function logsOf(units, engine, { seconds = 10 } = {}) {
  const seam = [];
  const controlRuns = [];
  const controlLogs = new Map();
  for (const unit of units) {
    for (const phase of unit.phases ?? []) seam.push(`SEAM-PHASE ${engine} ${phase} ${String(seconds)}`);
    for (const run of unit.runs ?? []) {
      controlRuns.push({ run, ok: true, seconds });
      controlLogs.set(run, LIST.controls.find((entry) => entry.run === run).proves.map((name) => `NEGATIVE CONTROL "${name}": detected in ${engine}: x`).join('\n'));
    }
  }

  return { seamLog: seam.join('\n'), controlRuns, controlLogs };
}

test('ranUnits: a phase unit is ok when each of its phases printed its line, and its seconds are theirs added up; a control unit when each run was detected and named every control it proves', () => {
  const units = UNITS.filter((unit) => ['pages', 'controls-process', 'controls-kept'].includes(unit.id));
  const ran = ranUnits({ units, list: LIST, engine: 'webkit', ...logsOf(units, 'webkit', { seconds: 2 }) });
  assert.deepEqual(ran.map((entry) => [entry.id, entry.ok]), [['pages', true], ['controls-kept', true], ['controls-process', true]].sort((a, b) => units.findIndex((u) => u.id === a[0]) - units.findIndex((u) => u.id === b[0])));
  assert.equal(ran.find((entry) => entry.id === 'pages').seconds, 26);
  assert.deepEqual(ran.find((entry) => entry.id === 'controls-process').controls.length, 10);
  assert.equal(ran.find((entry) => entry.id === 'controls-kept').seconds, 10);
});

test('NEGATIVE ranUnits: a phase that did not print, a run that was not detected, a control the run did not name, a run that never ran and a log of the other engine each fail the unit', () => {
  const units = UNITS.filter((unit) => ['pages', 'controls-process', 'controls-kept'].includes(unit.id));
  const base = logsOf(units, 'webkit');
  const okOf = (logs, engine = 'webkit') => Object.fromEntries(ranUnits({ units, list: LIST, engine, ...logs }).map((entry) => [entry.id, entry.ok]));
  assert.deepEqual(okOf(base), { pages: true, 'controls-kept': true, 'controls-process': true });
  assert.equal(okOf({ ...base, seamLog: base.seamLog.replace('SEAM-PHASE webkit toasts 10', '') }).pages, false);
  assert.equal(okOf({ ...base, seamLog: '' }).pages, false, 'a shard that ran no scenario');
  assert.equal(okOf({ ...base, controlRuns: base.controlRuns.map((run) => (run.run === 'process' ? { ...run, ok: false } : run)) })['controls-process'], false);
  const logs = new Map(base.controlLogs);
  logs.set('process', logs.get('process').replace(/^NEGATIVE CONTROL "sidebar-reset".*$/m, ''));
  assert.equal(okOf({ ...base, controlLogs: logs })['controls-process'], false, 'one of the ten controls of the table did not say detected');
  assert.equal(okOf({ ...base, controlRuns: base.controlRuns.filter((run) => run.run !== 'close-twice') })['controls-kept'], false);
  assert.deepEqual(okOf(base, 'chromium'), { pages: false, 'controls-kept': false, 'controls-process': false });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The seconds are held
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const unitOf = (seconds) => [{ id: 'u', phases: ['x'], seconds }];

test('driftFindings: a unit fails past its seconds and the larger of a quarter and 60 s, warns the same under, and says nothing of one that did not pass', () => {
  const run = (took, ok = true) => driftFindings({ engine: 'webkit', shard: 1, ran: [{ id: 'u', ok, seconds: took, phases: [], controls: [] }], units: unitOf(20), ceiling: 1e9 });
  assert.equal(run(80).failures.length, 0, '20 s fails past 80 s, not at it');
  assert.equal(run(81).failures.length, 1);
  assert.match(run(81).failures[0], /u took 81 s on this runner, 20 s in scripts\/ci\/seam-units\.mjs \(\+61 s; a unit fails past a quarter and 60 s over\): put `seconds: 81` there/);
  assert.equal(driftFindings({ engine: 'webkit', shard: 1, ran: [{ id: 'u', ok: true, seconds: 100 }], units: unitOf(200), ceiling: 1e9 }).failures.length, 0, '200 s fails past 260, and 100 is 100 under: warns');
  assert.equal(driftFindings({ engine: 'webkit', shard: 1, ran: [{ id: 'u', ok: true, seconds: 100 }], units: unitOf(200), ceiling: 1e9 }).warnings.length, 1);
  assert.equal(driftFindings({ engine: 'webkit', shard: 1, ran: [{ id: 'u', ok: true, seconds: 100 }], units: unitOf(400), ceiling: 1e9 }).failures.length, 0);
  assert.equal(run(500, false).failures.length, 0);
  const quarter = driftFindings({ engine: 'webkit', shard: 1, ran: [{ id: 'u', ok: true, seconds: 501 }], units: unitOf(400), ceiling: 1e9 });
  assert.equal(quarter.failures.length, 1, '400 s fails past 500 s: a quarter is more than 60 s');
});

test('driftFindings: a unit that is not in the table fails, and the shard fails past its ceiling with every unit named', () => {
  const unknown = driftFindings({ engine: 'chromium', shard: 2, ran: [{ id: 'ghost', ok: true, seconds: 5 }], units: UNITS });
  assert.match(unknown.failures[0], /the unit "ghost" ran in this shard and is not in scripts\/ci\/seam-units\.mjs/);
  const ran = [{ id: 'pages', ok: true, seconds: 300 }, { id: 'settings', ok: true, seconds: 247 }];
  const over = driftFindings({ engine: 'webkit', shard: 3, ran, units: UNITS });
  assert.equal(over.shard.took, 547);
  assert.equal(over.failures.filter((line) => /Seam shard seconds/.test(line)).length, 1);
  assert.match(over.failures.find((line) => /Seam shard seconds/.test(line)), /pages 300 s of 85, settings 247 s of 75/);
  assert.equal(driftFindings({ engine: 'webkit', shard: 3, ran: [{ id: 'pages', ok: true, seconds: 85 }, { id: 'settings', ok: true, seconds: 75 }], units: UNITS }).failures.length, 0);
});

test('the ceiling is the limit and the slowest machine the kit probes saw, and a job takes it to the end on the slowest setup', () => {
  assert.equal(SHARD_CEILING_SECONDS, 546);
  const setupSlowest = 260;
  assert.ok(setupSlowest + SHARD_CEILING_SECONDS + PHASE_START_SECONDS < JOB_TIMEOUT_MINUTES * 60, 'the job can fail on the ceiling and say so');
  assert.ok(setupSlowest + SHARD_CEILING_SECONDS < 14 * 60, 'the slowest job is not more than 14 minutes: the seam ran 17 to 25');
  assert.ok(175 + LIMIT_SECONDS < 10 * 60, 'a job planned at the limit takes under ten minutes on the usual setup');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** What every shard of a full, green run would write. */
function greenReports() {
  const shards = planRun({ units: UNITS });
  const reports = [];
  for (const engine of ENGINES) {
    for (const shard of shards) {
      const mine = shard.units.map((entry) => UNITS.find((unit) => unit.id === entry.id));
      const ran = ranUnits({ units: mine, list: LIST, engine, ...logsOf(mine, engine) });
      reports.push(ranReport(engine, shard.shard, ran));
    }
  }

  return { shards: shards.length, reports };
}

const verify = (reports, shards, extra = {}) => verifyRan({ units: UNITS, list: LIST, reports, shards, ...extra });

test('a run in which every phase and every control ran once and passed in both engines has no problem', () => {
  const { shards, reports } = greenReports();
  assert.equal(reports.length, 8);
  assert.deepEqual(verify(reports, shards), []);
  assert.deepEqual(verify(reports, String(shards)), [], 'the plan\'s count is a string in the workflow');
});

test('NEGATIVE: a shard that never reported, one that reported twice, one the plan did not make, and an engine that is missing are each named', () => {
  const { shards, reports } = greenReports();
  const without = reports.filter((report) => !(report.engine === 'chromium' && report.shard === 2));
  assert.ok(verify(without, shards).some((message) => message === 'chromium: shard 2 of 4 did not report'));
  assert.ok(verify(without, shards).some((message) => /chromium: the unit ".*" did not run/.test(message)));
  assert.ok(verify([...reports, reports[0]], shards).some((message) => /webkit: shard 1 reported 2 times/.test(message)));
  assert.ok(verify([...reports, { ...reports[0], shard: 9 }], shards).some((message) => /a report is of shard 9, and the plan made 4/.test(message)));
  assert.ok(verify(reports.filter((report) => report.engine === 'webkit'), shards).some((message) => message === 'chromium: shard 1 of 4 did not report'));
  assert.deepEqual(verify(reports, 0), ['the plan says 0 shards: a plan of no shard is no plan']);
  assert.equal(verify(reports, undefined).length, 1);
  assert.equal(verify([], shards).length > 6, true);
});

test('NEGATIVE: a shard that ran no scenario is red: every unit of it did not pass, and the phases and controls it should have shown are missing', () => {
  const { shards, reports } = greenReports();
  const emptied = reports.map((report) => (report.engine === 'webkit' && report.shard === 1 ? { ...report, units: report.units.map((entry) => ({ ...entry, ok: false, phases: [], controls: [], seconds: 0 })) } : report));
  const problems = verify(emptied, shards);
  assert.ok(problems.some((message) => /^webkit: the unit ".*" did not pass \(shard 1\)$/.test(message)));
  assert.ok(problems.some((message) => /^webkit: the phase ".*" of ui-next\/plugins\/e2e\/seam\.check\.mjs did not run$/.test(message)) || problems.some((message) => /^webkit: the control ".*" of .* was not detected$/.test(message)));
  const none = reports.map((report) => (report.shard === 1 ? { ...report, units: [] } : report));
  assert.ok(verify(none, shards).some((message) => /the unit ".*" did not run/.test(message)));
});

test('NEGATIVE: a unit that passed without a phase or a control it should have shown, a unit that ran twice and a unit the table does not have are each named', () => {
  const { shards, reports } = greenReports();
  const edit = (change) => reports.map((report) => ({ ...report, units: report.units.map((entry) => change(entry, report)) }));
  assert.ok(verify(edit((entry, report) => (report.engine === 'webkit' && entry.id === 'pages' ? { ...entry, phases: entry.phases.filter((id) => id !== 'centre') } : entry)), shards).some((message) => message === 'webkit: the unit "pages" passed without the phase "centre"'));
  assert.ok(verify(edit((entry, report) => (report.engine === 'chromium' && entry.id === 'controls-process' ? { ...entry, controls: entry.controls.filter((name) => name !== 'rail-fine') } : entry)), shards).some((message) => message === 'chromium: the unit "controls-process" passed without the control "rail-fine" detected'));
  const twice = reports.map((report) => (report.engine === 'webkit' && report.shard === 1 ? { ...report, units: [...report.units, ...report.units.slice(0, 1)] } : report));
  assert.ok(verify(twice, shards).some((message) => /webkit: the unit ".*" ran 2 times/.test(message)));
  const extra = reports.map((report) => (report.shard === 1 ? { ...report, units: [...report.units, { id: 'stowaway', ok: true, seconds: 1, phases: [], controls: [] }] } : report));
  assert.ok(verify(extra, shards).some((message) => /the shard 1 ran "stowaway", which is not a unit of scripts\/ci\/seam-units\.mjs/.test(message)));
});

test('NEGATIVE: a scenario that is in the check and in no report is red whatever the units say: one more phase and one more control', () => {
  const { shards, reports } = greenReports();
  const grown = { phases: [...LIST.phases, 'terminal-resize'], controls: [...LIST.controls, { run: 'terminal-resize-wrong', proves: ['terminal-resize-wrong'] }] };
  const problems = verify(reports, shards, { list: grown });
  assert.ok(problems.some((message) => message === 'webkit: the phase "terminal-resize" of ui-next/plugins/e2e/seam.check.mjs did not run'));
  assert.ok(problems.some((message) => message === 'chromium: the control "terminal-resize-wrong" of ui-next/plugins/e2e/seam.check.mjs was not detected'));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const capture = () => {
  const lines = { out: '', err: '' };
  return { lines, io: { out: (text) => { lines.out += text; }, err: (text) => { lines.err += text; } } };
};

test('check and plan, on this repository: ok, and the plan writes the matrix and the number of shards where the workflow reads them', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'seam-plan-'));
  const output = path.join(dir, 'output');
  const summary = path.join(dir, 'summary');
  const checked = capture();
  assert.equal(await main(['check'], { env: {}, ...checked.io }), 0);
  assert.match(checked.lines.out, new RegExp(`seam-shards: ok \\(${String(PHASES_IN_CHECK)} phases, ${String(CONTROLS_IN_CHECK)} controls, in ${String(UNITS.length)} units\\)`));
  const planned = capture();
  assert.equal(await main(['plan'], { env: { GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, ...planned.io }), 0);
  const written = readFileSync(output, 'utf8');
  assert.match(written, /^matrix=\{"include":\[/);
  assert.match(written, /\nshards=4\n$/);
  assert.equal(JSON.parse(/^matrix=(.*)$/m.exec(written)[1]).include.length, 8);
  assert.match(readFileSync(summary, 'utf8'), /### Seam plan/);
});

test('bad arguments are exit 2 with the usage, and a table that does not load or disagrees with the check is exit 1', async () => {
  for (const argv of [[], ['nope'], ['report'], ['report', '--engine', 'webkit'], ['verify', '--reports', 'x'], ['check', 'extra']]) {
    const bad = capture();
    assert.equal(await main(argv, { env: {}, ...bad.io }), 2, argv.join(' '));
    assert.match(bad.lines.err, /usage: node scripts\/ci\/seam-shards\.mjs check/);
  }

  const root = mkdtempSync(path.join(tmpdir(), 'seam-root-'));
  mkdirSync(path.join(root, 'ui-next/plugins/e2e'), { recursive: true });
  mkdirSync(path.join(root, 'scripts/ci'), { recursive: true });
  const missing = capture();
  assert.equal(await main(['check', '--root', root], { env: {}, ...missing.io }), 1);
  assert.match(missing.lines.err, /scripts\/ci\/seam-units\.mjs does not exist/);
  writeFileSync(path.join(root, 'scripts/ci/seam-units.mjs'), 'export const units = [{ id: "only", phases: ["a"], seconds: 10 }];\n');
  writeFileSync(path.join(root, CHECK), readFileSync(path.join(repo, CHECK), 'utf8'));
  const disagree = capture();
  assert.equal(await main(['check', '--root', root], { env: {}, ...disagree.io }), 1);
  assert.match(disagree.lines.err, /the phase "healthy" of ui-next\/plugins\/e2e\/seam\.check\.mjs is in no unit/);
  assert.match(disagree.lines.err, /is in no unit of scripts\/ci\/seam-units\.mjs: it would never run in CI/);
  const annotated = capture();
  assert.equal(await main(['check', '--root', root], { env: { GITHUB_ACTIONS: 'true' }, ...annotated.io }), 1);
  assert.match(annotated.lines.out, /^::error title=Seam units::/m);
  writeFileSync(path.join(root, CHECK), 'no list here\n');
  const nolist = capture();
  assert.equal(await main(['check', '--root', root], { env: {}, ...nolist.io }), 1);
  assert.match(nolist.lines.err, /has no `const PHASE_IDS = \[` list/);
});

/** The logs a shard of this plan leaves in a directory, for `report`. */
function writeLogs(dir, units, engine, { drop = [] } = {}) {
  const logs = logsOf(units, engine, { seconds: 3 });
  writeFileSync(path.join(dir, `seam-${engine}.log`), `${logs.seamLog}\n`);
  const kept = logs.controlRuns.filter((run) => !drop.includes(run.run));
  writeFileSync(path.join(dir, `seam-controls-${engine}.tsv`), kept.map((run) => `${run.run}\t${run.ok ? 'detected' : 'NOT DETECTED'}\t${String(run.seconds)}`).join('\n'));
  for (const run of kept) writeFileSync(path.join(dir, `control-${engine}-${run.run}.log`), `${logs.controlLogs.get(run.run)}\n`);
}

test('report: reads the logs of a shard, writes what it ran where the verdict reads it, and the verdict of the whole run is the eight reports', async () => {
  const shards = planRun({ units: UNITS });
  const root = mkdtempSync(path.join(tmpdir(), 'seam-run-'));
  const reports = path.join(root, 'reports');
  for (const engine of ENGINES) {
    for (const shard of shards) {
      const dir = path.join(root, `${engine}-${String(shard.shard)}`);
      mkdirSync(dir, { recursive: true });
      const mine = shard.units.map((entry) => UNITS.find((unit) => unit.id === entry.id));
      writeLogs(dir, mine, engine);
      const quiet = capture();
      const status = await main(['report', '--engine', engine, '--shard', String(shard.shard), '--units', shard.units.map((entry) => entry.id).join(','), '--dir', dir], { env: { GITHUB_STEP_SUMMARY: path.join(dir, 'summary') }, ...quiet.io });
      // Every unit of these logs took 3 s a phase or run, far under the table's seconds: warnings, and no failure.
      assert.equal(status, 0, `${engine} ${String(shard.shard)}: ${quiet.lines.out}${quiet.lines.err}`);
      assert.match(quiet.lines.out, new RegExp(`### Seam ${engine}, shard ${String(shard.shard)}: ${String(shard.units.length)} of ${String(shard.units.length)} units passed`));
      mkdirSync(path.join(reports, `seam-ran-${engine}-${String(shard.shard)}`), { recursive: true });
      writeFileSync(path.join(reports, `seam-ran-${engine}-${String(shard.shard)}`, `seam-ran-${engine}-${String(shard.shard)}.json`), readFileSync(path.join(dir, `seam-ran-${engine}-${String(shard.shard)}.json`)));
    }
  }

  const read = readReports(reports);
  assert.equal(read.reports.length, 8);
  assert.deepEqual(read.problems, []);
  const verified = capture();
  assert.equal(await main(['verify', '--reports', reports, '--shards', '4'], { env: { GITHUB_STEP_SUMMARY: path.join(root, 'verdict') }, ...verified.io }), 0, verified.lines.err);
  assert.match(verified.lines.out, new RegExp(`seam-shards: ok \\(${String(PHASES_IN_CHECK)} phases and ${String(CONTROLS_IN_CHECK)} controls, in ${String(UNITS.length)} units, ran once and passed in webkit and chromium, in 4 shards each\\)`));
  assert.match(readFileSync(path.join(root, 'verdict'), 'utf8'), /\| webkit \| 1 \|/);

  // The same run with one shard of one engine gone is red, and with a plan that says five shards is red.
  const gone = capture();
  const { rmSync } = await import('node:fs');
  rmSync(path.join(reports, 'seam-ran-chromium-2'), { recursive: true });
  assert.equal(await main(['verify', '--reports', reports, '--shards', '4'], { env: {}, ...gone.io }), 1);
  assert.match(gone.lines.err, /chromium: shard 2 of 4 did not report/);
  const annotated = capture();
  assert.equal(await main(['verify', '--reports', reports, '--shards', '4'], { env: { GITHUB_ACTIONS: 'true' }, ...annotated.io }), 1);
  assert.match(annotated.lines.out, /^::error title=Seam check::chromium: shard 2 of 4 did not report$/m);
  const short = capture();
  assert.equal(await main(['verify', '--reports', reports, '--shards', '5'], { env: {}, ...short.io }), 1);
  assert.match(short.lines.err, /shard 5 of 5 did not report/);
  const missingDir = capture();
  assert.equal(await main(['verify', '--reports', path.join(root, 'nowhere'), '--shards', '4'], { env: {}, ...missingDir.io }), 1);
  assert.match(missingDir.lines.err, /cannot read the reports/);
});

test('NEGATIVE report: a shard whose logs are missing, or whose control run was left out, writes a report that is red and says which unit did not pass; a slow unit is red with the number', async () => {
  const shard = planRun({ units: UNITS })[0];
  const mine = shard.units.map((entry) => UNITS.find((unit) => unit.id === entry.id));
  const ids = shard.units.map((entry) => entry.id).join(',');
  const empty = mkdtempSync(path.join(tmpdir(), 'seam-empty-'));
  const none = capture();
  assert.equal(await main(['report', '--engine', 'webkit', '--shard', '1', '--units', ids, '--dir', empty], { env: {}, ...none.io }), 1);
  assert.match(none.lines.out, /::error title=Seam unit webkit shard 1::the unit ".*" did not pass/);
  assert.ok(existsSync(path.join(empty, 'seam-ran-webkit-1.json')), 'a report is written for the verdict to read even when nothing ran');
  const report = JSON.parse(readFileSync(path.join(empty, 'seam-ran-webkit-1.json'), 'utf8'));
  assert.equal(report.units.every((entry) => entry.ok === false), true);

  const runs = mine.flatMap((unit) => unit.runs ?? []);
  assert.ok(runs.length > 0);
  const dir = mkdtempSync(path.join(tmpdir(), 'seam-left-out-'));
  writeLogs(dir, mine, 'chromium', { drop: [runs[0]] });
  const left = capture();
  assert.equal(await main(['report', '--engine', 'chromium', '--shard', '1', '--units', ids, '--dir', dir], { env: {}, ...left.io }), 1);
  assert.match(left.lines.out, /::error title=Seam unit chromium shard 1::the unit ".*" did not pass: controls detected/);

  const slow = mkdtempSync(path.join(tmpdir(), 'seam-slow-'));
  const phaseUnit = UNITS.find((unit) => unit.id === 'terminal-find');
  writeFileSync(path.join(slow, 'seam-webkit.log'), 'SEAM-PHASE webkit terminal-find 96\n');
  const over = capture();
  assert.equal(await main(['report', '--engine', 'webkit', '--shard', '2', '--units', 'terminal-find', '--dir', slow], { env: {}, ...over.io }), 1);
  assert.match(over.lines.out, new RegExp(`::error title=Seam unit seconds webkit shard 2::terminal-find took 96 s on this runner, ${String(phaseUnit.seconds)} s in scripts/ci/seam-units\\.mjs .*put \`seconds: 96\` there`));
  const unknown = capture();
  assert.equal(await main(['report', '--engine', 'webkit', '--shard', '1', '--units', 'nope', '--dir', slow], { env: {}, ...unknown.io }), 2);
  assert.equal((await main(['report', '--engine', 'firefox', '--shard', '1', '--units', ids, '--dir', slow], { env: {}, ...capture().io })), 2);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The workflow
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const WORKFLOW = parse(readFileSync(path.join(repo, '.github/workflows/ui-next-seam.yml'), 'utf8'));
const stepOf = (job, start) => WORKFLOW.jobs[job].steps.find((step) => typeof step.name === 'string' && step.name.startsWith(start));

test('a shard\'s steps: the tests, the host build, the phases only when it has any, the controls only when it has any, then the report and its upload whatever happened', () => {
  const names = WORKFLOW.jobs.seam.steps.map((step) => step.name ?? step.uses);
  const at = (start) => names.findIndex((name) => name.startsWith(start));
  assert.ok(at('Install dependencies') < at('Check the units and the tests of the plan') && at('Check the units and the tests of the plan') < at('Build the host'));
  assert.ok(at('Build the host') < at('The seam (') && at('The seam (') < at("The seam's negative controls") && at("The seam's negative controls") < at('Hold the seconds') && at('Hold the seconds') < at('Keep what the shard ran'));
  const seam = stepOf('seam', 'The seam (');
  assert.equal(seam.if, "${{ matrix.phases != '' }}");
  assert.equal(seam.env.SEAM_PHASES, '${{ matrix.phases }}');
  assert.equal(seam.env.ENGINES, '${{ matrix.engine }}');
  const controls = stepOf('seam', "The seam's negative controls");
  assert.equal(controls.if, "${{ matrix.controls != '' }}");
  assert.equal(controls.env.CONTROLS, '${{ matrix.controls }}');
  assert.match(controls.run, /for control in \$CONTROLS; do/);
  assert.match(controls.run, /seam-controls-\$ENGINES\.tsv/);
  assert.match(controls.run, /control-\$ENGINES-\$control\.log/);
  const report = stepOf('seam', 'Hold the seconds');
  assert.equal(report.if, '${{ !cancelled() }}', 'a shard that was cancelled (its timeout, a cancelled run) leaves no report that says it passed');
  assert.match(report.run, /seam-shards\.mjs report --engine "\$ENGINE" --shard "\$SHARD" --units "\$UNITS" --dir "\$RUNNER_TEMP"/);
  const keep = WORKFLOW.jobs.seam.steps.find((step) => step.name === 'Keep what the shard ran');
  assert.equal(keep.if, '${{ !cancelled() }}');
  assert.equal(keep.with.name, 'seam-ran-${{ matrix.engine }}-${{ matrix.shard }}');
  assert.equal(keep.with.overwrite, true);
  assert.equal(keep.with.path, '${{ runner.temp }}/seam-ran-*.json');
  assert.match(WORKFLOW.jobs.seam.steps.find((step) => step.name === 'Check the units and the tests of the plan').run, /seam-shards\.mjs check\n.*node --test scripts\/ci\/seam-\*\.test\.mjs/);
});

test('the step that names the scenario that failed is the one the shards run: its program is the awk of the one scenario functions are held to', () => {
  const seam = stepOf('seam', 'The seam (');
  assert.match(seam.run, /letter="\$\(awk -v n="\$line" '[^']+' "\$check"\)"/);
  assert.match(seam.run, /exit 1\s*$/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The workflow, again: what the review of #718 asked to hold (N1, N5, N6, N7) and what N30 and N34 changed
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('N1: nothing in the seam, probe and main-red workflows can hide a failed job: no continue-on-error on a job or a step', () => {
  for (const file of ['ui-next-seam.yml', 'ui-next-kit-probes.yml', 'ci-main-red.yml']) {
    const text = readFileSync(path.join(repo, '.github/workflows', file), 'utf8').replace(/^\s*#.*$/gm, '');
    assert.equal(/continue-on-error/.test(text), false, `${file}: continue-on-error`);
    const workflow = parse(text);
    for (const [id, job] of Object.entries(workflow.jobs)) {
      assert.equal(job['continue-on-error'], undefined, `${file}: ${id}`);
      for (const step of job.steps ?? []) assert.equal(step['continue-on-error'], undefined, `${file}: ${id}: ${step.name ?? step.uses}`);
    }
  }
});

test('N5: a shard that was cancelled (its timeout, a cancelled run) leaves no report: the report and the upload do not run for it, and the verdict is red for the shard that did not report', () => {
  for (const name of ['Hold the seconds', 'Keep what the shard ran']) {
    const step = WORKFLOW.jobs.seam.steps.find((entry) => entry.name?.startsWith(name));
    assert.equal(step.if, '${{ !cancelled() }}', name);
  }

  assert.equal(/always\(\)/.test(JSON.stringify(WORKFLOW.jobs.seam.steps)), false, 'no step of a shard runs when the job was cancelled');
});

test('N6: no annotation title has a comma or a colon (a workflow command takes the comma as the end of a property)', async () => {
  const source = readFileSync(path.join(repo, 'scripts/ci/seam-shards.mjs'), 'utf8');
  const titles = [...source.matchAll(/title=([^:]*?)::/g)].map((match) => match[1]);
  assert.ok(titles.length >= 5, titles.join(' | '));
  for (const title of titles) assert.equal(/[,;]/.test(title), false, title);
  const lines = driftFindings({ engine: 'webkit', shard: 2, ran: [{ id: 'pages', ok: true, seconds: 999 }], units: UNITS }).failures;
  assert.ok(lines.length > 0);
  for (const line of lines) assert.match(line, /^::error title=Seam (?:unit seconds|shard seconds) webkit shard 2::/);
});


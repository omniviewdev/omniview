// The seam check's shards (N29): the phases and negative controls of ui-next/plugins/e2e/seam.check.mjs, packed at run time into the fewest jobs of one engine, held to their seconds, and verified as a whole.
//
//   node scripts/ci/seam-shards.mjs check                                               exit 1, one line per problem: a phase or a control the check has and no unit runs, one that a unit names and the check lacks, one that two units run
//   node scripts/ci/seam-shards.mjs plan                              packs the units into the fewest shards under LIMIT_SECONDS; writes `matrix=<json>` (one entry for each engine and shard) and `shards=<n>` to $GITHUB_OUTPUT
//   node scripts/ci/seam-shards.mjs report --engine <e> --shard <n> --units <id>,<id>   after a shard ran: reads the logs in $RUNNER_TEMP, writes seam-ran-<engine>-<shard>.json, holds each unit and the shard to their seconds
//   node scripts/ci/seam-shards.mjs verify --reports <dir> --shards <n>  what the shards reported against the table, for both engines: every phase and every control, once, passed, in as many shards as the plan made
//   --root <dir>                                                                        another tree than this repository (the tests)
//
// WHY. The seam is the only check that drives the real host with a browser, and it ran in one job for each engine: setup, the whole seam (10 minutes, one host, one scenario after the other) and then every negative control
// (9 to 10 minutes, a Node process for each, each starting a host and building the fixture plugins again): 17 to 25 minutes against a job limit of 25, with a scenario added about every other day. The run is now the same work in
// as many jobs of one engine as it takes to keep each under LIMIT_SECONDS: nothing is selected, nothing is dropped, and the job that keeps the name `Seam check` fails unless every phase and every control ran once, passed, in each
// engine.
//
// THE UNITS (scripts/ci/seam-units.mjs). A unit is the phases of one run of the check (`phases: [...]`, `SEAM_PHASES=<id>,<id>`: it starts one host, so a unit is a few phases that share it) or some runs of the negative controls
// (`runs: [...]`, one `SEAM_CONTROL=<run>` after the other: a run is one control for the plain ones, every control of a table for the scenarios that have one), each with the `seconds` it takes on the runner. The check says which phases
// and runs exist (`PHASE_IDS` and the control tables; `SEAM_LIST=1` prints them): `check` fails for a phase or a run that no unit has, so a scenario added to the check and to no unit is red in the plan job, and the verdict repeats it.
//
// THE SECONDS ONLY PACK THE SHARDS (as the kit probes' do, rule 25): a unit that took more or less than its seconds by the larger of a quarter of them and 60 s is a warning with the number to put in the file, never a failure
// (the seam runs at night only, N34, where nothing keeps the seconds current; the job's timeout is the one wall). A phase's seconds are the check's own (`SEAM-PHASE <engine> <id> <seconds>`, one line for each phase that passed);
// a control run's are the step's.
//
// THE VERDICT. Each shard writes what it ran, from its logs, and `verify` reads them all: both engines, every shard of the plan, every phase and every control of the table once, passed. A shard that never reported, one that ran
// no phase, one that was cancelled by the job's timeout, and a scenario that is in no unit are all red.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pack } from './probe-pack.mjs';
import { DRIFT_FLOOR_SECONDS, DRIFT_RATIO } from './probe-shards.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CHECK = 'ui-next/plugins/e2e/seam.check.mjs';
export const UNITS_FILE = 'scripts/ci/seam-units.mjs';
export const ENGINES = ['webkit', 'chromium'];

/** What a shard's work may add up to, in the units' listed seconds. The job is this plus its setup (container, install, packages, the host build: about 175 s, the slowest 260) plus the start of the phases' host. */
export const LIMIT_SECONDS = 420;
/** The start of the one host that the phases of a shard share (the check's fixture plugins are built and the host starts): the plan leaves it out of every shard's limit, so the limit is the shard's. */
export const PHASE_START_SECONDS = 15;
export { DRIFT_FLOOR_SECONDS, DRIFT_RATIO };

const firstLine = (text) => String(text).split('\n')[0].slice(0, 300);
const escapeData = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const whole = (value) => Math.round(value);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What the check has (read from its text: the plan job has no dependencies installed; a test holds this to `SEAM_LIST=1`, which is the check's own answer)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const blockOf = (text, name) => {
  const block = new RegExp(`^const ${name} = \\{\\n([\\s\\S]*?)^\\};$`, 'm').exec(text);
  if (block === null) throw new Error(`${CHECK} has no \`const ${name} = {\` block`);
  return block[1];
};
// A key is quoted when it has a hyphen (`'rail-fine': /.../`) and bare when it is one word (`reopened: /.../`).
const keysOf = (block) => [...block.matchAll(/^ {2}(?:'([a-z0-9-]+)'|([a-z][a-zA-Z0-9]*)): /gm)].map((match) => match[1] ?? match[2]);

/** `{ phases: [id], controls: [{ run, proves: [name] }] }` from the text of the check, in the shape `SEAM_LIST=1` prints. */
export function listFromText(text) {
  // A table of controls the plan does not know is a table of controls no job would run: name it here and in SEAM_LIST (the check prints which run makes it) before it can be added.
  const KNOWN_TABLES = ['CONTROLS', 'SETTINGS_PARTS', 'PROCESS_CONTROLS', 'FAILED_CONTROLS', 'PAGE_CONTROLS', 'CONNECTIONS_CONTROLS', 'PT_CONTROLS', 'PORTS_CONTROLS', 'RECONNECT_CONTROLS', 'ISOLATION_CONTROLS', 'PROFILE_CONTROLS', 'WHERE_CONTROLS', 'INTEGRATION_CONTROLS'];
  const unknown = [...text.matchAll(/^const ([A-Z][A-Z_]*_CONTROLS) = \{$/gm)].map((match) => match[1]).filter((name) => !KNOWN_TABLES.includes(name));
  if (unknown.length > 0) throw new Error(`${CHECK} has a table of negative controls that the plan does not know: ${unknown.join(', ')} (add it to listFromText in scripts/ci/seam-shards.mjs and to SEAM_LIST in the check, and its run to a unit of ${UNITS_FILE})`);
  const phases = /^const PHASE_IDS = \[\n([\s\S]*?)^\];$/m.exec(text);
  if (phases === null) throw new Error(`${CHECK} has no \`const PHASE_IDS = [\` list`);
  const ids = [...phases[1].matchAll(/^ {2}'([a-z0-9-]+)',$/gm)].map((match) => match[1]);
  const alone = keysOf(blockOf(text, 'CONTROLS'));
  const groups = [
    ['process', keysOf(blockOf(text, 'PROCESS_CONTROLS'))],
    ['failed-load', keysOf(blockOf(text, 'FAILED_CONTROLS'))],
    ['plugins-page', keysOf(blockOf(text, 'PAGE_CONTROLS'))],
    ['connections', keysOf(blockOf(text, 'CONNECTIONS_CONTROLS'))],
    ['problems-operations', keysOf(blockOf(text, 'PT_CONTROLS'))],
    ['ports', keysOf(blockOf(text, 'PORTS_CONTROLS'))],
    ['terminal-reconnect', keysOf(blockOf(text, 'RECONNECT_CONTROLS'))],
    ['terminal-isolation', keysOf(blockOf(text, 'ISOLATION_CONTROLS'))],
    ['terminal-profile', keysOf(blockOf(text, 'PROFILE_CONTROLS'))],
    ['terminal-where', keysOf(blockOf(text, 'WHERE_CONTROLS'))],
    ['terminal-integration', keysOf(blockOf(text, 'INTEGRATION_CONTROLS'))],
  ];
  return { phases: ids, controls: [...alone.map((name) => ({ run: name, proves: [name] })), ...groups.map(([run, proves]) => ({ run, proves }))] };
}

export const listFromCheck = (root = REPO_ROOT) => listFromText(readFileSync(path.join(root, CHECK), 'utf8'));

/** The unit table, `{ units, problems }`. */
export async function loadUnits(root = REPO_ROOT) {
  const file = path.join(root, UNITS_FILE);
  if (!existsSync(file)) return { units: [], problems: [`${UNITS_FILE} does not exist`] };
  let loaded;
  try {
    loaded = await import(pathToFileURL(file).href);
  } catch (error) {
    return { units: [], problems: [`${UNITS_FILE} does not load: ${firstLine(error.message)}`] };
  }
  if (!Array.isArray(loaded.units)) return { units: [], problems: [`${UNITS_FILE} exports no list \`units\``] };
  return { units: loaded.units, problems: [] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** One sentence for each problem of the table against the check: a unit that holds together, every phase and every control run of the check in exactly one unit, nothing the check lacks. */
export function checkUnits({ units, list }) {
  const problems = [];
  const ids = new Set();
  const phaseHome = new Map();
  const runHome = new Map();
  for (const [index, unit] of units.entries()) {
    const where = `${UNITS_FILE}: unit ${typeof unit?.id === 'string' ? `"${unit.id}"` : String(index + 1)}`;
    if (unit === null || typeof unit !== 'object') {
      problems.push(`${where} is not an object`);
      continue;
    }

    if (typeof unit.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(unit.id)) problems.push(`${where} needs an id of lower-case words and digits`);
    else if (ids.has(unit.id)) problems.push(`${where} is declared twice`);
    else ids.add(unit.id);
    if (!Number.isInteger(unit.seconds) || unit.seconds < 1) problems.push(`${where} has ${JSON.stringify(unit.seconds)} seconds: a whole, positive number is needed`);
    else if (unit.seconds > LIMIT_SECONDS - PHASE_START_SECONDS) problems.push(`${where} is ${unit.seconds} s, over the ${LIMIT_SECONDS - PHASE_START_SECONDS} s a shard may hold: split it`);
    const { phases, runs } = unit;
    if ((phases === undefined) === (runs === undefined)) {
      problems.push(`${where} is either \`phases: [...]\` (one run of the check) or \`runs: [...]\` (runs of its negative controls)`);
      continue;
    }

    const names = phases ?? runs;
    if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== 'string')) problems.push(`${where} has no ${phases === undefined ? 'run' : 'phase'}, or one that is not a name`);
    else for (const name of names) (phases === undefined ? runHome : phaseHome).set(name, [...((phases === undefined ? runHome : phaseHome).get(name) ?? []), unit.id]);
  }

  for (const phase of list.phases) {
    const homes = phaseHome.get(phase) ?? [];
    if (homes.length === 0) problems.push(`the phase "${phase}" of ${CHECK} is in no unit of ${UNITS_FILE}: it would never run in CI`);
    else if (homes.length > 1) problems.push(`the phase "${phase}" is in ${homes.length} units (${homes.join(', ')}): a phase runs once`);
  }

  for (const phase of phaseHome.keys()) if (!list.phases.includes(phase)) problems.push(`${UNITS_FILE} runs the phase "${phase}", which ${CHECK} does not have`);
  const known = list.controls.map((entry) => entry.run);
  for (const run of known) {
    const homes = runHome.get(run) ?? [];
    if (homes.length === 0) problems.push(`the negative control run \`SEAM_CONTROL=${run}\` of ${CHECK} (${list.controls.find((entry) => entry.run === run).proves.join(', ')}) is in no unit of ${UNITS_FILE}: it would never run in CI`);
    else if (homes.length > 1) problems.push(`the negative control run \`${run}\` is in ${homes.length} units (${homes.join(', ')}): a control runs once`);
  }

  for (const run of runHome.keys()) if (!known.includes(run)) problems.push(`${UNITS_FILE} runs \`SEAM_CONTROL=${run}\`, which ${CHECK} does not have`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The shards of a run: every unit packed into the fewest shards under the limit (the start of the shard's host left out of the limit). `[{ shard, units: [{ id, seconds }], seconds, phases: [id], controls: [run] }]`, numbered from 1,
 * the longest first. A table with no unit plans no shard and is an error: an empty matrix is never emitted.
 */
export function planRun({ units, limit = LIMIT_SECONDS }) {
  const packed = pack(units.map((unit) => ({ id: unit.id, seconds: unit.seconds })), limit - PHASE_START_SECONDS);
  if (packed.length === 0) throw new Error('the plan has no shard: the table has no unit, and a run that runs nothing must not look green');
  return packed.map((shard, index) => {
    const mine = shard.units.map((entry) => units.find((unit) => unit.id === entry.id));
    // The phases run in the order the check has them, whatever order the units came in.
    return {
      shard: index + 1,
      units: shard.units,
      seconds: shard.seconds + (mine.some((unit) => unit.phases !== undefined) ? PHASE_START_SECONDS : 0),
      phases: mine.flatMap((unit) => unit.phases ?? []),
      controls: mine.flatMap((unit) => unit.runs ?? []),
    };
  });
}

/** `{ include: [{ engine, shard, units, phases, controls, seconds }] }`: every engine runs every shard. `phases` and `controls` are strings for the job's environment (`SEAM_PHASES`, and the runs of `SEAM_CONTROL` one after the other). */
export function matrixOf(shards, order) {
  const include = [];
  for (const engine of ENGINES) {
    for (const shard of shards) {
      const phases = order === undefined ? shard.phases : [...shard.phases].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      include.push({ engine, shard: shard.shard, units: shard.units.map((unit) => unit.id).join(','), phases: phases.join(','), controls: shard.controls.join(' '), seconds: shard.seconds });
    }
  }

  return { include };
}

export function renderPlan(shards, units, list) {
  const total = units.reduce((sum, unit) => sum + unit.seconds, 0);
  const phases = units.filter((unit) => unit.phases !== undefined).reduce((sum, unit) => sum + unit.phases.length, 0);
  const controls = list.controls.reduce((sum, entry) => sum + entry.proves.length, 0);
  const lines = [
    '### Seam plan',
    '',
    `Every phase and every control runs, in each of ${ENGINES.join(' and ')}: ${phases} phases and ${controls} controls, ${units.length} units, ${total} s listed in ${shards.length} shard${shards.length === 1 ? '' : 's'} of at most ${LIMIT_SECONDS} s each (the shard's work, its start included).`,
    '',
    '| Shard | Seconds | Units |',
    '|---|--:|---|',
  ];
  for (const shard of shards) lines.push(`| ${shard.shard} | ${shard.seconds} | ${shard.units.map((entry) => `${entry.id} ${entry.seconds}`).join(', ')} |`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What a shard ran, from its logs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** The phases that passed in a log of the seam step, `[{ id, seconds }]`, for one engine: the check prints `SEAM-PHASE <engine> <id> <seconds>` after each (and a log line may carry a timestamp or a colour). */
export function parsePhases(log, engine) {
  const found = [];
  for (const raw of log.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split('\n')) {
    const match = /^(?:\S+Z )?SEAM-PHASE (webkit|chromium) ([a-z0-9-]+) (\d+(?:\.\d+)?)\s*$/.exec(raw);
    if (match !== null && match[1] === engine) found.push({ id: match[2], seconds: Number(match[3]) });
  }

  return found;
}

/** The controls a log of a control run says were detected, for one engine (`NEGATIVE CONTROL "<name>": detected in <engine>`; a control removed on purpose says `NOT DETECTED`, and is not one). */
export function parseDetected(log, engine) {
  const names = [];
  for (const raw of log.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split('\n')) {
    const match = /^(?:\S+Z )?NEGATIVE CONTROL "([a-z0-9-]+)": detected in (webkit|chromium)(?::| with its assertion removed)/.exec(raw);
    if (match !== null && match[2] === engine && !/with its assertion removed/.test(raw)) names.push(match[1]);
  }

  return names;
}

/** The rows of the control runs a shard's step wrote, one line each: `<run><TAB><detected|NOT DETECTED><TAB><seconds>`. */
export function parseControlRuns(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [run, verdict, seconds] = line.split('\t');
      return { run, ok: verdict === 'detected', seconds: Number(seconds) };
    });
}

/**
 * What the shard ran: for each unit it was given, `{ id, ok, seconds, phases, controls }`. A phase unit is ok when every phase it names printed its line; its seconds are those lines added up. A control unit is ok when each of its runs
 * was detected and its log names every control the check says that run proves (`list`); its seconds are the runs' added up. `phases` and `controls` are what was seen (the verdict compares them with the check), not what was asked.
 */
export function ranUnits({ units, list, engine, seamLog, controlRuns, controlLogs }) {
  const phases = parsePhases(seamLog, engine);
  return units.map((unit) => {
    if (unit.phases !== undefined) {
      const seen = unit.phases.map((id) => phases.find((phase) => phase.id === id)).filter((phase) => phase !== undefined);
      return { id: unit.id, ok: seen.length === unit.phases.length, seconds: seen.reduce((sum, phase) => sum + phase.seconds, 0), phases: seen.map((phase) => phase.id), controls: [] };
    }

    let ok = true;
    let seconds = 0;
    const controls = [];
    for (const name of unit.runs) {
      const run = controlRuns.find((entry) => entry.run === name);
      const proves = list.controls.find((entry) => entry.run === name)?.proves ?? [];
      const detected = run === undefined ? [] : parseDetected(controlLogs.get(name) ?? '', engine).filter((control) => proves.includes(control));
      ok &&= run !== undefined && run.ok && proves.length > 0 && proves.every((control) => detected.includes(control));
      seconds += run?.seconds ?? 0;
      controls.push(...new Set(detected));
    }

    return { id: unit.id, ok, seconds, phases: [], controls };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The seconds of each unit
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The drift of each unit that passed from its seconds: `{ warnings, rows, shard }`. A unit warns when it took more than `max(floor, ratio of its seconds)` over or under its seconds, with the number to put in its file. A unit
 * that did not pass says nothing of the cost (a phase that stopped early). No drift fails a shard.
 */
export function driftFindings({ engine, shard, ran, units, ratio = DRIFT_RATIO, floor = DRIFT_FLOOR_SECONDS }) {
  const title = `Seam unit seconds ${engine} shard ${shard}`;
  const warnings = [];
  const rows = [];
  for (const entry of ran) {
    if (!entry.ok) continue;
    const unit = units.find((candidate) => candidate.id === entry.id);
    const took = whole(entry.seconds);
    const delta = took - unit.seconds;
    const margin = Math.max(floor, ratio * unit.seconds);
    const verdict = delta > margin ? 'slower' : -delta > margin ? 'faster' : 'ok';
    rows.push({ id: unit.id, table: unit.seconds, took, delta, verdict });
    if (verdict === 'ok') continue;
    // A unit may be listed at LIMIT_SECONDS less PHASE_START_SECONDS at most (checkUnits): past it the number to put there is that, which gives the unit a shard of its own, or the unit is split.
    const most = LIMIT_SECONDS - PHASE_START_SECONDS;
    const advice = took > most ? `it took more than the ${most} s a unit may be listed at: split it, or put \`seconds: ${most}\` there and it has a shard of its own` : `put \`seconds: ${took}\` there`;
    warnings.push(`::warning title=${title}::${escapeData(`${unit.id} took ${took} s on this runner, ${unit.seconds} s in ${UNITS_FILE} (${delta > 0 ? '+' : '-'}${Math.abs(delta)} s; a unit warns past a quarter and ${floor} s ${verdict === 'slower' ? 'over' : 'under'}): ${advice}`)}`);
  }

  const took = whole(ran.reduce((sum, entry) => sum + entry.seconds, 0));
  const planned = ran.reduce((sum, entry) => sum + (units.find((candidate) => candidate.id === entry.id)?.seconds ?? 0), 0);
  return { warnings, rows, shard: { took, planned } };
}

export function renderRan({ engine, shard, ran, drift }) {
  const lines = [`### Seam ${engine}, shard ${shard}: ${ran.filter((entry) => entry.ok).length} of ${ran.length} units passed, ${drift.shard.took} s`, '', '| Unit | Result | Table s | This run s | Difference |', '|---|---|--:|--:|--:|'];
  for (const entry of ran) {
    const row = drift.rows.find((candidate) => candidate.id === entry.id);
    lines.push(`| ${entry.id} | ${entry.ok ? 'pass' : '**did not pass**'} | ${row?.table ?? ''} | ${whole(entry.seconds)} | ${row === undefined ? '' : `${row.delta > 0 ? '+' : ''}${row.delta}${row.verdict === 'ok' ? '' : row.verdict === 'slower' ? ' **over**' : ' under'}`} |`);
  }

  lines.push('', `The shard's units took ${drift.shard.took} s against ${drift.shard.planned} s in the table.`);
  return `${lines.join('\n')}\n`;
}

/** What a shard reports of itself (`seam-ran-<engine>-<shard>.json`): `{ engine, shard, units: [{ id, ok, seconds, phases, controls }] }`. */
export const ranReport = (engine, shard, ran) => ({ engine, shard: Number(shard), units: ran });

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Every `seam-ran-<engine>-<n>.json` under `dir`, at any depth (each artifact is a directory of its own). */
export function readReports(dir) {
  const reports = [];
  const problems = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/^seam-ran-(?:webkit|chromium)-\d+\.json$/.test(entry.name)) {
        try {
          reports.push(JSON.parse(readFileSync(file, 'utf8')));
        } catch (error) {
          problems.push(`${entry.name} is not JSON: ${firstLine(error.message)}`);
        }
      }
    }
  };
  walk(dir);
  return { reports, problems };
}

/**
 * What is wrong with a run, one sentence each: `reports` are what the shards wrote, `shards` the number the plan made. Every engine must have a report for each of the plan's shards, once; every unit of the table must have run once in
 * each engine, passed, and shown every phase and every control it proves; and the phases and controls seen, over the whole engine, must be exactly the check's (`list`).
 */
export function verifyRan({ units, list, reports, shards, engines = ENGINES }) {
  const problems = [];
  const expected = Number(shards);
  if (!Number.isInteger(expected) || expected < 1) {
    problems.push(`the plan says ${JSON.stringify(shards)} shards: a plan of no shard is no plan`);
    return problems;
  }

  for (const engine of engines) {
    const mine = reports.filter((report) => report?.engine === engine);
    const numbers = mine.map((report) => report.shard);
    for (let shard = 1; shard <= expected; shard += 1) {
      const count = numbers.filter((number) => number === shard).length;
      if (count === 0) problems.push(`${engine}: shard ${shard} of ${expected} did not report`);
      else if (count > 1) problems.push(`${engine}: shard ${shard} reported ${count} times`);
    }

    for (const number of new Set(numbers)) if (!Number.isInteger(number) || number < 1 || number > expected) problems.push(`${engine}: a report is of shard ${String(number)}, and the plan made ${expected}`);
    const ran = mine.flatMap((report) => (Array.isArray(report.units) ? report.units.map((entry) => ({ ...entry, shard: report.shard })) : []));
    for (const unit of units) {
      const runs = ran.filter((entry) => entry.id === unit.id);
      if (runs.length === 0) problems.push(`${engine}: the unit "${unit.id}" did not run`);
      else if (runs.length > 1) problems.push(`${engine}: the unit "${unit.id}" ran ${runs.length} times (shards ${runs.map((entry) => entry.shard).join(', ')})`);
      else if (runs[0].ok !== true) problems.push(`${engine}: the unit "${unit.id}" did not pass (shard ${runs[0].shard})`);
      else {
        for (const phase of unit.phases ?? []) if (!(runs[0].phases ?? []).includes(phase)) problems.push(`${engine}: the unit "${unit.id}" passed without the phase "${phase}"`);
        for (const run of unit.runs ?? []) {
          for (const name of list.controls.find((entry) => entry.run === run)?.proves ?? []) if (!(runs[0].controls ?? []).includes(name)) problems.push(`${engine}: the unit "${unit.id}" passed without the control "${name}" detected`);
        }
      }
    }

    for (const entry of ran) if (!units.some((unit) => unit.id === entry.id)) problems.push(`${engine}: the shard ${entry.shard} ran "${entry.id}", which is not a unit of ${UNITS_FILE}`);
    const seenPhases = ran.flatMap((entry) => entry.phases ?? []);
    for (const phase of list.phases) if (!seenPhases.includes(phase)) problems.push(`${engine}: the phase "${phase}" of ${CHECK} did not run`);
    const seenControls = ran.flatMap((entry) => entry.controls ?? []);
    for (const { proves } of list.controls) for (const name of proves) if (!seenControls.includes(name)) problems.push(`${engine}: the control "${name}" of ${CHECK} was not detected`);
  }

  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const USAGE = [
  'usage: node scripts/ci/seam-shards.mjs check',
  '       node scripts/ci/seam-shards.mjs plan',
  '       node scripts/ci/seam-shards.mjs report --engine <webkit|chromium> --shard <n> --units <id>,<id>',
  '       node scripts/ci/seam-shards.mjs verify --reports <dir> --shards <n>',
  '       (--root <dir>: another tree than this repository)',
].join('\n');

export async function main(argv = process.argv.slice(2), { env = process.env, out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text) } = {}) {
  const options = { root: REPO_ROOT };
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (['--root', '--engine', '--shard', '--units', '--reports', '--shards', '--dir'].includes(argv[i]) && argv[i + 1] !== undefined) {
      options[argv[i].slice(2)] = argv[i] === '--root' ? path.resolve(argv[i + 1]) : argv[i + 1];
      i += 1;
    } else words.push(argv[i]);
  }

  const [verb] = words;
  const needs = { check: [], plan: [], report: ['engine', 'shard', 'units'], verify: ['reports', 'shards'] };
  if (words.length !== 1 || !Object.hasOwn(needs, verb) || needs[verb].some((key) => options[key] === undefined || options[key] === '')) {
    err(`${USAGE}\n`);
    return 2;
  }

  const loaded = await loadUnits(options.root);
  const problem = (message) => {
    if (env.GITHUB_ACTIONS === 'true') out(`::error title=Seam units::${escapeData(message)}\n`);
    else err(`seam-shards: ${message}\n`);
  };
  if (loaded.problems.length > 0) {
    for (const message of loaded.problems) problem(message);
    return 1;
  }

  const units = loaded.units;
  let list;
  try {
    list = listFromCheck(options.root);
  } catch (error) {
    problem(error.message);
    return 1;
  }

  if (verb === 'check' || verb === 'plan' || verb === 'verify') {
    const problems = checkUnits({ units, list });
    for (const message of problems) problem(message);
    if (problems.length > 0) return 1;
  }

  if (verb === 'check') {
    out(`seam-shards: ok (${list.phases.length} phases, ${list.controls.reduce((sum, entry) => sum + entry.proves.length, 0)} controls, in ${units.length} units)\n`);
    return 0;
  }

  if (verb === 'plan') {
    let shards;
    try {
      shards = planRun({ units });
    } catch (error) {
      err(`seam-shards: ${error.message}\n`);
      return 1;
    }

    const text = renderPlan(shards, units, list);
    out(text);
    const matrix = matrixOf(shards, list.phases);
    try {
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nshards=${shards.length}\n`);
    } catch (error) {
      err(`seam-shards: could not write the outputs: ${firstLine(error.message)}\n`);
      return 1;
    }

    return 0;
  }

  if (verb === 'verify') {
    let read;
    try {
      read = readReports(path.resolve(options.reports));
    } catch (error) {
      err(`seam-shards: cannot read the reports in ${options.reports}: ${firstLine(error.message)}\n`);
      return 1;
    }

    const problems = [...read.problems, ...verifyRan({ units, list, reports: read.reports, shards: options.shards, engines: ENGINES })];
    for (const message of problems) {
      if (env.GITHUB_ACTIONS === 'true') out(`::error title=Seam check::${escapeData(message)}\n`);
      else err(`seam-shards: ${message}\n`);
    }

    if (problems.length > 0) return 1;
    const what = `${list.phases.length} phases and ${list.controls.reduce((sum, entry) => sum + entry.proves.length, 0)} controls, in ${units.length} units, ran once and passed in ${ENGINES.join(' and ')}, in ${options.shards} shards each`;
    out(`seam-shards: ok (${what})\n`);
    if (env.GITHUB_STEP_SUMMARY) {
      try {
        const rows = [...read.reports].sort((a, b) => a.engine.localeCompare(b.engine) || a.shard - b.shard).map((report) => `| ${report.engine} | ${report.shard} | ${report.units.map((entry) => entry.id).join(', ')} |`);
        appendFileSync(env.GITHUB_STEP_SUMMARY, `### Seam check\n\nEvery phase and every control of the check ran once and passed: ${what}.\n\n| Engine | Shard | Units that ran |\n|---|--:|---|\n${rows.join('\n')}\n\n`);
      } catch (error) {
        err(`seam-shards: could not write the summary: ${firstLine(error.message)}\n`);
        return 1;
      }
    }

    return 0;
  }

  // report
  const { engine, shard } = options;
  if (!ENGINES.includes(engine) || !/^\d+$/.test(shard)) {
    err(`seam-shards: the engine is webkit or chromium and the shard a number, not ${JSON.stringify(engine)} and ${JSON.stringify(shard)}\n`);
    return 2;
  }

  const dir = options.dir ?? env.RUNNER_TEMP;
  if (dir === undefined || dir === '') {
    err('seam-shards: report reads the logs in $RUNNER_TEMP (or --dir)\n');
    return 2;
  }

  const table = new Map(units.map((unit) => [unit.id, unit]));
  const chosen = [];
  for (const id of options.units.split(',')) {
    if (!table.has(id)) {
      err(`seam-shards: no unit "${id}"\n`);
      return 2;
    }

    chosen.push(table.get(id));
  }

  const readIf = (name) => (existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), 'utf8') : '');
  const controlRuns = parseControlRuns(readIf(`seam-controls-${engine}.tsv`));
  const controlLogs = new Map(controlRuns.map((run) => [run.run, readIf(`control-${engine}-${run.run}.log`)]));
  const ran = ranUnits({ units: chosen, list, engine, seamLog: readIf(`seam-${engine}.log`), controlRuns, controlLogs });
  const drift = driftFindings({ engine, shard, ran, units });
  const text = renderRan({ engine, shard, ran, drift });
  out(`\n${text}\n`);
  for (const line of drift.warnings) out(`${line}\n`);
  for (const entry of ran.filter((candidate) => !candidate.ok)) out(`::error title=Seam unit ${engine} shard ${shard}::${escapeData(`the unit "${entry.id}" did not pass: ${table.get(entry.id).phases !== undefined ? `phases seen ${entry.phases.join(', ') || 'none'} of ${table.get(entry.id).phases.join(', ')}` : `controls detected ${entry.controls.join(', ') || 'none'} in the runs ${table.get(entry.id).runs.join(', ')}`}`)}\n`);
  try {
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
    writeFileSync(path.join(dir, `seam-ran-${engine}-${shard}.json`), `${JSON.stringify(ranReport(engine, shard, ran), null, 2)}\n`);
  } catch (error) {
    err(`seam-shards: could not write what this shard ran: ${firstLine(error.message)}\n`);
    return 1;
  }

  return ran.every((entry) => entry.ok) ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

// The kit probes' units, the check that no probe is left out, the plan that decides at run time which controls run and which shard runs what, and the runner of a shard (N24 K1 to K3, then N25).
//
//   node scripts/ci/probe-shards.mjs check                       exit 1, one line per problem: a probe script that no unit runs, a unit that does not hold together, a glob that matches no file
//   node scripts/ci/probe-shards.mjs plan [--base <ref>]         what this run runs: selects the controls, packs the units into the fewest shards, writes `matrix=<json>` to $GITHUB_OUTPUT and the summary to the job summary
//   node scripts/ci/probe-shards.mjs run <shard> <unit>,<unit>   runs the units of one shard, one after the other, and exits 1 when any run failed or a unit took more than its seconds allow
//   --root <dir>                                                 another tree than this repository (the tests)
//
// THE TABLE IS A DIRECTORY. One file for each probe in scripts/ci/probe-units/<probe>.mjs exports `units`: the unit that runs the probe and the units that run its negative controls (a probe's controls may be several
// units, each one run once). A unit is `{ id, name, script, env?, controls?, seconds, paths }`: its id (the word the plan and the matrix use), its name (the step it replaced), the probe script, the env it runs with (`$RUNNER_TEMP`
// and `$PROBE_DIST` are expanded from the runner's environment; a variable that is not set is an error), the controls it runs (one run each, with NEGATIVE_CONTROL set to it), the seconds it takes on the runner, and the globs
// that select it. It declares no shard: no pull request chooses where a unit runs, so two that add units cannot conflict on that, and a PR that adds a probe adds a file.
//
// WHICH CONTROLS RUN (scripts/ci/probe-select.mjs). A pull request runs every probe and the controls whose globs its changed paths match; everything else is a full run (a push to main, the nightly run, a re-run, a diff that
// cannot be read, a change to what every control depends on). The summary of the plan says which control ran, which was skipped, and why.
//
// WHICH SHARD (scripts/ci/probe-pack.mjs). The selected units are packed at run time into the fewest shards that each stay under LIMIT_SECONDS, as even as that allows; the matrix of the shard jobs is the plan's output.
//
// THE SECONDS ARE THE RUNNER'S AND ARE HELD. After a shard ran, each unit's real seconds are compared with the unit's `seconds`: past DRIFT_RATIO and DRIFT_FLOOR_SECONDS over, the shard FAILS and the message has the
// number to put in the unit's file; past the same margin under, it warns. So the pull request that slowed a unit updates one number, and a shard cannot silently pass its limit again (K3 found shard 5 at 562 s on the runner
// against 489 s in the table: a warning nobody acted on).
//
// ADDING A PROBE. Write `<thing>-probe.mjs` in one of PROBE_DIRS and a file for it in scripts/ci/probe-units: a unit for the probe, and one for its negative controls. Run `node scripts/ci/probe-shards.mjs check`: it fails, naming
// the file, for a probe that no unit runs. Put the seconds of the first run of the unit in `seconds` (the summary of its shard prints them). A probe CI is not to run goes in BY_HAND with the reason.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { changedPaths } from './changes.mjs';
import { pack } from './probe-pack.mjs';
import { contextOf, globToRegExp, matches, selectControls, show } from './probe-select.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The directories whose probe scripts must each be run by a unit. */
export const PROBE_DIRS = ['packages/kit/probes', 'ui-next/shell/probes', 'ui-next/page/probes'];

/** The workflow that runs the shards. */
export const WORKFLOW = '.github/workflows/ui-next-kit-probes.yml';

/** The table: one file for each probe, each exporting `units`. */
export const UNITS_DIRECTORY = 'scripts/ci/probe-units';

/** Probe scripts CI does not run: each is run by hand, and is listed here, with the reason, so that "no unit runs it" is a decision someone wrote down and not something nobody noticed. Empty since N24 K2. */
export const BY_HAND = [];

/** The wall time a shard job is held to: 9 minutes, the job (its setup and its probes) from start to end. */
export const WALL_BUDGET_SECONDS = 540;
/** The 90th percentile of a shard job's setup (the job minus its probes' step) on the 56 shard jobs of 8 runs (median 88 s, maximum 118 s; docs/ui-next/status/N24-K3.md). */
export const SETUP_P90_SECONDS = 108;
/** The most unit seconds a shard may hold: the budget less the setup, so that a shard at its seconds and a slow (90th percentile) setup is a job of 9 minutes. It moves only with that data, never to make a table fit. */
export const LIMIT_SECONDS = WALL_BUDGET_SECONDS - SETUP_P90_SECONDS;

/**
 * A unit that took more than this over its `seconds` fails its shard (a quarter of them)...
 * ...and more than this many seconds more. The two together are the margin: a quarter of the unit's seconds or this many seconds, whichever is more. Seven runs of 2026-11-21 and 22 (4,364 to 4,471 s of units, 235 unit runs)
 * against the seconds of run 44929041191: the most any unit took over them was 45 s (the controls of the log view on a slow machine, 166 s for 121 s; a unit is many short runs that each build the fixtures, and the shards of that
 * run took 30 percent more than the rest), and the floor is that and a third: 60 s. With 45 s none fails and the nearest is at the margin; with 30 s two do (docs/ui-next/status/N25.md has the data; probe-shards.test.mjs replays it).
 */
export const DRIFT_RATIO = 0.25;
export const DRIFT_FLOOR_SECONDS = 60;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Which files are probe scripts, and what the tree holds
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** A probe script is named `<thing>-probe.mjs`, or `<thing>-probe-<suffix>.mjs`: not `probe-lib.mjs`, the fixtures, the helpers, the mock measurers or the dev tools that share its directory. */
export const isProbeScript = (file) => /(?:^|\/)[^/]*-probe(?:-[^/]*)?\.[cm]?[jt]s$/.test(file);

/** Every probe script of `dirs` under `root`, repository-relative with `/`, sorted. A directory that is not there is an error: a renamed directory must not turn the scan into an empty one that finds nothing to complain about. */
export function findProbeScripts(root, dirs = PROBE_DIRS) {
  const found = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && isProbeScript(child)) found.push(child);
    }
  };
  for (const dir of dirs) {
    try {
      walk(dir);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`the probe directory ${dir} does not exist: update PROBE_DIRS in scripts/ci/probe-shards.mjs`);
      throw error;
    }
  }
  return found.sort();
}

/** Every file of the tree under `root`, repository-relative with `/`, sorted: what a glob must match at least once. Neither `.git` nor `node_modules` is read. */
export function listFiles(root) {
  const files = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else files.push(child);
    }
  };
  walk('');
  return files.sort();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const firstLine = (text) => String(text).split('\n')[0].slice(0, 300);

/**
 * The units of the table: every `.mjs` file of scripts/ci/probe-units under `root`, in name order, each unit copied with `file` (the file that declares it). `problems` says what could not be read, one sentence each, with the
 * file. A directory that is not there is a problem, not an empty table.
 */
export async function loadUnits(root = REPO_ROOT) {
  const units = [];
  const problems = [];
  const add = (message, file) => problems.push(file === undefined ? { message, title: 'Kit probe units' } : { message, file, title: 'Kit probe units' });
  let names;
  try {
    names = readdirSync(path.join(root, UNITS_DIRECTORY)).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    add(`${UNITS_DIRECTORY} does not exist: the units of the kit probes are one .mjs file for each probe in it`);
    return { units, problems };
  }
  for (const name of names) {
    const file = `${UNITS_DIRECTORY}/${name}`;
    if (!name.endsWith('.mjs')) {
      add(`${file} is not a unit file: the units are .mjs files that export \`units\``, file);
      continue;
    }
    let loaded;
    try {
      loaded = await import(pathToFileURL(path.join(root, file)).href);
    } catch (error) {
      add(`${file} does not load: ${firstLine(error.message)}`, file);
      continue;
    }
    if (loaded.units === undefined) add(`${file} exports no \`units\``, file);
    else if (!Array.isArray(loaded.units)) add(`${file}: \`units\` is not a list`, file);
    else if (loaded.units.length === 0) add(`${file} declares no unit`, file);
    else {
      loaded.units.forEach((entry, index) => {
        if (entry === null || typeof entry !== 'object') add(`${file}: unit ${index + 1} is not an object`, file);
        else units.push({ ...entry, file });
      });
    }
  }
  return { units, problems };
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const say = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const quoted = (ids) => say(ids.map((id) => `"${id}"`));

/**
 * The problems of a table, as `{ message, file?, title }`, one sentence each, each naming the file or the unit it is about.
 *   units    the units `loadUnits` gave
 *   byHand   `[{ script, reason }]`: probe scripts CI does not run
 *   found    the probe scripts that are on disk under the probe directories (findProbeScripts)
 *   exists   whether a repository-relative file is on disk
 *   files    every file of the tree (listFiles): what the globs of a unit must match
 */
export function checkUnits({ units, byHand = BY_HAND, found, exists, files }) {
  const problems = [];
  const add = (message, file, title = 'Kit probe units') => problems.push(file === undefined ? { message, title } : { message, file, title });

  const ids = new Map();
  const names = new Map();
  const probes = new Map();
  const controls = new Map();
  const scriptUnits = new Map();
  for (const unit of units) {
    const where = `the unit "${unit.id}"`;
    if (typeof unit.id !== 'string' || !ID.test(unit.id)) {
      add(`the id ${JSON.stringify(unit.id)} of a unit of ${unit.file} is not a lower-case word (letters and digits) or words joined by single hyphens: it is what the plan and the matrix call the unit`, unit.file);
      continue;
    }
    ids.set(unit.id, [...(ids.get(unit.id) ?? []), unit.file]);
    if (typeof unit.name !== 'string' || unit.name === '') add(`${where} has no name: a unit is named as the workflow step it replaced (${unit.file})`, unit.file);
    else names.set(unit.name, [...(names.get(unit.name) ?? []), unit.id]);

    if (typeof unit.script !== 'string' || unit.script === '') {
      add(`${where} has no script (${unit.file})`, unit.file);
    } else {
      scriptUnits.set(unit.script, [...(scriptUnits.get(unit.script) ?? []), unit.id]);
      if (unit.controls === undefined) probes.set(unit.script, [...(probes.get(unit.script) ?? []), unit.id]);
      if (!exists(unit.script)) add(`${unit.script} is named by ${where} (${unit.file}) but does not exist: the probe was renamed or deleted; update ${unit.file}`, unit.script);
    }

    for (const [key, value] of Object.entries(unit.env ?? {})) {
      if (typeof value !== 'string') add(`${where} sets ${key} to a ${typeof value}: an env value is a string`);
    }
    if (unit.env !== undefined && 'NEGATIVE_CONTROL' in unit.env) add(`${where} sets NEGATIVE_CONTROL in env: a negative control is listed in controls, which sets it`);
    if (unit.controls !== undefined) {
      if (!Array.isArray(unit.controls) || unit.controls.length === 0) {
        add(`${where} has an empty controls list: it would run the probe zero times`);
      } else {
        const seen = new Set();
        for (const control of unit.controls) {
          if (seen.has(control)) add(`${where} lists the control "${control}" twice`);
          seen.add(control);
          const key = `${unit.script}\u0000${control}`;
          controls.set(key, [...(controls.get(key) ?? []), unit.id]);
        }
      }
    }

    if (!Number.isInteger(unit.seconds) || unit.seconds < 1) add(`${where} has ${JSON.stringify(unit.seconds)} seconds: a whole, positive number of seconds is needed to plan it (the runner's, from the summary of its shard)`);
    else if (unit.seconds > LIMIT_SECONDS) add(`${where} is ${unit.seconds} s, over the ${LIMIT_SECONDS} s a shard may hold: split it (${unit.file})`);

    if (!Array.isArray(unit.paths) || unit.paths.length === 0) {
      add(`${where} declares no paths: a unit with no globs would never be selected (${unit.file})`, unit.file);
    } else {
      for (const glob of unit.paths) {
        try {
          globToRegExp(glob);
        } catch (error) {
          add(`${where} has a path glob that cannot be read: ${error.message}`, unit.file);
          continue;
        }
        if (!files.some((file) => matches(glob, file))) {
          add(`the glob ${JSON.stringify(glob)} of ${where} (${unit.file}) matches no file of the tree: the path moved or was mistyped, and a control that is never selected proves nothing`, unit.file);
        }
      }
      if (typeof unit.script === 'string' && unit.script !== '') {
        const readable = unit.paths.filter((glob) => {
          try {
            globToRegExp(glob);
            return true;
          } catch {
            return false;
          }
        });
        if (!readable.some((glob) => matches(glob, unit.script))) add(`${where} does not list its own script ${unit.script} in paths: a change to the probe must select it`, unit.file);
      }
    }
  }

  for (const [id, declaring] of ids) if (declaring.length > 1) add(`the id "${id}" is used by two units (${say(declaring)}): an id is one unit`);
  for (const [name, byName] of names) if (byName.length > 1) add(`the name "${name}" is used by two units (${quoted(byName)}): a name is one step`);
  for (const [script, list] of probes) if (list.length > 1) add(`${script} runs twice as a probe: the units ${quoted(list)}: a probe runs once`, script);
  for (const [key, list] of controls) {
    if (list.length > 1) {
      const [script, control] = key.split('\u0000');
      add(`the control "${control}" of ${script} is in two units: ${quoted(list)}: each control runs once`, script);
    }
  }

  const held = new Set();
  for (const entry of byHand) {
    held.add(entry.script);
    if (!exists(entry.script)) add(`${entry.script} is named by BY_HAND but does not exist: the probe was renamed or deleted; update scripts/ci/probe-shards.mjs`, entry.script);
  }
  for (const [script, list] of scriptUnits) {
    if (held.has(script)) add(`${script} is run by unit${list.length > 1 ? 's' : ''} ${quoted(list)} and listed in BY_HAND: a probe is run by a unit or by hand, not both`, script);
  }
  for (const file of found) {
    if (!scriptUnits.has(file) && !held.has(file)) {
      add(
        `${file} is a probe script and no unit runs it: add a unit for it to a file of ${UNITS_DIRECTORY} (and a unit for its negative controls), or list it in BY_HAND with the reason CI does not run it`,
        file,
        'Kit probe is in no unit',
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// One unit is runs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** `$NAME` and `${NAME}` in `value`, from `vars`; a name that is not set (or empty) is an error, never an empty string inside a path. */
export function expandEnv(value, vars, where) {
  return value.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (match, braced, bare) => {
    const got = vars[braced ?? bare];
    if (got === undefined || got === '') throw new Error(`${where} sets an env value to ${JSON.stringify(value)}, and ${match} is not set`);
    return got;
  });
}

/** The runs of a unit: one, or one for each of its controls (with NEGATIVE_CONTROL), each with the unit's env expanded from `vars`. */
export function expandUnit(unit, vars) {
  const where = `the unit "${unit.name}"`;
  const env = Object.fromEntries(Object.entries(unit.env ?? {}).map(([key, value]) => [key, expandEnv(value, vars, where)]));
  if (unit.controls === undefined) return [{ label: unit.name, script: unit.script, control: null, env }];
  return unit.controls.map((control) => ({ label: `${unit.name} (${control})`, script: unit.script, control, env: { ...env, NEGATIVE_CONTROL: control } }));
}

/** Does the unit read the ui-next build in $PROBE_DIST (the shard builds it only then)? */
export const readsDist = (unit) => Object.values(unit.env ?? {}).some((value) => /\$(?:\{PROBE_DIST\}|PROBE_DIST\b)/.test(value));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * What a run does: the controls selected by `changed` and `context` (probe-select.mjs), every probe, and the units packed into the fewest shards under `limit`. `shards` is `[{ shard, units: [{ id, seconds }], seconds, dist }]`
 * numbered from 1, the longest first; `dist` says whether a unit of it reads the ui-next build.
 */
export function planRun({ units, changed, context, limit = LIMIT_SECONDS }) {
  const selection = selectControls({ units, changed, context });
  const running = new Set(selection.units.filter((entry) => entry.run).map((entry) => entry.id));
  const selected = units.filter((unit) => running.has(unit.id));
  const packed = pack(selected.map((unit) => ({ id: unit.id, seconds: unit.seconds })), limit);
  const dist = new Set(selected.filter(readsDist).map((unit) => unit.id));
  const shards = packed.map((shard, index) => ({ shard: index + 1, units: shard.units, seconds: shard.seconds, dist: shard.units.some((entry) => dist.has(entry.id)) }));
  return { selection, shards, changed: Array.isArray(changed) ? new Set(changed).size : null };
}

/** The matrix the shard jobs read: `{ include: [{ shard, units, seconds, dist }] }`, the units as their ids joined by commas. */
export function matrixOf(shards) {
  return { include: shards.map((shard) => ({ shard: shard.shard, units: shard.units.map((entry) => entry.id).join(','), seconds: shard.seconds, dist: shard.dist })) };
}

const SHOWN = 12;
const cell = (text) => String(text).replaceAll('|', '\\|');
const code = (text) => `\`${cell(text)}\``;

/** The summary of a plan (Markdown): the mode and why, every control unit and whether it runs, the paths that decided it, and the shards. */
export function renderPlan(result) {
  const { selection, shards } = result;
  const lines = [`### Kit probes plan: ${selection.mode === 'full' ? 'full run' : 'pull request, controls by change'}`, ''];
  const probes = selection.units.filter((entry) => !entry.controls);
  const controls = selection.units.filter((entry) => entry.controls);
  const skipped = controls.filter((entry) => !entry.run);
  lines.push(`${selection.mode === 'full' ? 'Every probe and every control runs' : 'Every probe runs, and the controls the changed paths reach'} (${selection.reason}).`, '');
  const total = controls.reduce((sum, entry) => sum + entry.seconds, 0);
  lines.push(`${probes.length} probes (always) and ${controls.length} control units: ${controls.length - skipped.length} run, ${skipped.length} skipped${result.changed === null ? '' : `, of ${result.changed} changed path${result.changed === 1 ? '' : 's'}`}. **${selection.skippedSeconds} s** of controls skipped, of ${total} s.`, '');
  lines.push('| Control unit | Seconds | Result | Why |', '|---|--:|---|---|');
  for (const entry of controls) lines.push(`| ${entry.id} | ${entry.seconds} | ${entry.run ? 'runs' : 'skipped'} | ${code(entry.why)} |`);
  lines.push('');
  const list = (title, items) => {
    if (items.length === 0) return;
    lines.push(`${title}`, '');
    for (const item of items.slice(0, SHOWN)) lines.push(`- ${item}`);
    if (items.length > SHOWN) lines.push(`- (${items.length - SHOWN} more)`);
    lines.push('');
  };
  list('These paths made every control run:', selection.forced.map((entry) => `${code(entry.path)}: ${cell(entry.why)}`));
  list('Paths of the new UI that no unit declares (they select nothing):', selection.undeclared.map((file) => code(show(file))));
  if (selection.ignored.length > 0) lines.push(`${selection.ignored.length} changed path${selection.ignored.length === 1 ? ' is' : 's are'} read by no probe (documentation, Markdown, tests of vitest).`, '');
  lines.push(`${shards.length} shard${shards.length === 1 ? '' : 's'}, at most ${LIMIT_SECONDS} s of units each:`, '', '| Shard | Seconds | Units |', '|---|--:|---|');
  for (const shard of shards) lines.push(`| ${shard.shard} | ${shard.seconds} | ${shard.units.map((entry) => `${entry.id} ${entry.seconds}`).join(', ')} |`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Running a shard
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const TAIL_BYTES = 16 * 1024;
const TAIL_LINES = 40;

/** A workflow command's message: `%`, CR and LF are the three characters it cannot carry. */
const escapeData = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

function runOne(run, { id, root, env, out, node }) {
  return new Promise((resolve) => {
    out(`::group::${run.label}\n`);
    const started = performance.now();
    let tail = '';
    let last = '\n';
    const forward = (chunk) => {
      const text = chunk.toString('utf8');
      if (text === '') return;
      out(text);
      last = text.at(-1);
      tail = (tail + text).slice(-TAIL_BYTES);
    };
    let settled = false;
    const finish = (code, signal, problem) => {
      if (settled) return;
      settled = true;
      const seconds = (performance.now() - started) / 1000;
      if (last !== '\n') out('\n');
      out('::endgroup::\n');
      const ok = code === 0 && problem === undefined;
      if (!ok) {
        const how = problem ?? (signal ? `was killed by ${signal}` : `exited with code ${code}`);
        // A control may run in another shard than its probe: the line names the probe's script and the control as well as the step.
        out(`::error title=Kit probe failed (shard ${id})::${escapeData(`${run.label} [${run.script}${run.control === null ? '' : `, negative control ${run.control}`}] ${how}`)}\n`);
        const lines = tail.split('\n');
        if (lines.at(-1) === '') lines.pop();
        out(`Last lines of its output:\n${lines.slice(-TAIL_LINES).map((line) => `  ${line}`).join('\n')}\n`);
      }
      resolve({ label: run.label, script: run.script, control: run.control, ok, code, signal: signal ?? null, seconds });
    };
    const child = spawn(node, [path.join(root, run.script)], { cwd: root, env: { ...env, ...run.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', (error) => finish(null, null, `could not start: ${error.message}`));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/** Runs every run of every unit given, one at a time, to the end: the results are `{ label, unit, script, control, ok, code, signal, seconds }` in order (`unit` is the id of the unit the run belongs to). A failure does not stop the shard. */
export async function runShard(units, id, { root = REPO_ROOT, env = process.env, out = (text) => process.stdout.write(text), node = process.execPath } = {}) {
  const results = [];
  for (const unit of units) {
    for (const run of expandUnit(unit, env)) results.push({ ...(await runOne(run, { id, root, env, out, node })), unit: unit.id });
  }
  return results;
}

const whole = (value) => Math.round(value);
const outcome = (result) => (result.ok ? 'pass' : `**fail** (${result.signal ? result.signal : `exit ${result.code}`})`);

/** The job summary of a shard (Markdown): the counts, and a row for each run with its seconds, the probe script it ran, the negative control (empty for the probe itself) and the step that holds it. */
export function renderSummary(id, results) {
  const failed = results.filter((result) => !result.ok).length;
  const total = whole(results.reduce((sum, result) => sum + result.seconds, 0));
  const runs = `${results.length} run${results.length === 1 ? '' : 's'}`;
  const head = `### Kit probes shard ${id}: ${runs}, ${failed === 0 ? 'all passed' : `${failed} failed`}, ${total} s`;
  const text = (value) => String(value ?? '').replaceAll('|', '\\|');
  const step = (result) => (result.control && result.label.endsWith(` (${result.control})`) ? result.label.slice(0, -` (${result.control})`.length) : result.label);
  const rows = results.map((result) => `| ${outcome(result)} | ${whole(result.seconds)} | ${text(result.script)} | ${text(result.control)} | ${text(step(result))} |`);
  return [head, '', '| Result | Seconds | Probe | Negative control | Step |', '|---|--:|---|---|---|', ...rows, ''].join('\n');
}

/**
 * The drift of each unit of the shard from its seconds: `{ failures, warnings, rows }`. A unit's seconds on this runner are those of its runs added up (a unit with a run that failed is left out: the seconds of a probe that
 * stopped early or hung say nothing of its cost). It FAILS when it took more than `max(floor, ratio of its seconds)` over its seconds, with the number to put in its file in the message; it only warns when it took more than
 * that under. A unit the table does not have fails: a run that is not in the table is a table that is out of date.
 */
export function driftFindings(id, results, units, { ratio = DRIFT_RATIO, floor = DRIFT_FLOOR_SECONDS } = {}) {
  const ran = new Map();
  for (const result of results) {
    if (result.unit === undefined) continue;
    const entry = ran.get(result.unit) ?? { seconds: 0, ok: true };
    entry.seconds += result.seconds;
    entry.ok &&= result.ok;
    ran.set(result.unit, entry);
  }
  const title = `Kit probe unit seconds (shard ${id})`;
  const quarter = ratio === 0.25 ? 'a quarter' : `${whole(ratio * 100)} percent`;
  const failures = [];
  const warnings = [];
  const rows = [];
  for (const [unitId, entry] of ran) {
    if (!entry.ok) continue;
    const unit = units.find((candidate) => candidate.id === unitId);
    if (unit === undefined) {
      failures.push(`::error title=${title}::${escapeData(`the unit "${unitId}" ran in this shard and is not in the table (${UNITS_DIRECTORY}): the plan and the table disagree`)}`);
      continue;
    }
    const took = whole(entry.seconds);
    const delta = took - unit.seconds;
    const margin = Math.max(floor, ratio * unit.seconds);
    const verdict = delta > margin ? 'slower' : -delta > margin ? 'faster' : 'ok';
    rows.push({ id: unit.id, name: unit.name, file: unit.file, table: unit.seconds, took, delta, verdict: verdict === 'ok' ? 'ok' : verdict });
    if (verdict === 'ok') continue;
    const percent = whole((Math.abs(delta) / unit.seconds) * 100);
    const lead = `${unit.name} (${unit.id}) took ${took} s on this runner, ${unit.seconds} s in ${unit.file} (${delta > 0 ? '+' : '-'}${Math.abs(delta)} s, ${percent} percent`;
    if (verdict === 'slower') {
      failures.push(`::error title=${title}::${escapeData(`${lead}; a unit fails past ${quarter} and ${floor} s over): put \`seconds: ${took}\` there, and the next run packs the shards with it`)}`);
    } else {
      warnings.push(`::warning title=${title}::${escapeData(`${lead}; a unit warns past ${quarter} and ${floor} s under): put \`seconds: ${took}\` there so that the planner can use the room`)}`);
    }
  }
  return { failures, warnings, rows };
}

/** The seconds of each unit of a shard against the table's (Markdown). */
export function renderDrift(id, rows) {
  const lines = [`#### Kit probes shard ${id}: seconds against the table`, '', '| Unit | Table s | This run s | Difference | |', '|---|--:|--:|--:|---|'];
  for (const row of rows) lines.push(`| ${cell(row.id)} | ${row.table} | ${row.took} | ${row.delta > 0 ? '+' : ''}${row.delta} | ${row.verdict === 'ok' ? '' : row.verdict === 'slower' ? '**over**' : 'under'} |`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const USAGE = 'usage: node scripts/ci/probe-shards.mjs [--root <repository>] check | plan [--base <ref>] [--head <ref>] | run <shard> <unit>,<unit>,...';

export async function main(
  argv = process.argv.slice(2),
  { units: given, byHand = BY_HAND, env = process.env, out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text), margin = {} } = {},
) {
  let root = REPO_ROOT;
  let base = 'HEAD^1';
  let head = 'HEAD';
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1] !== undefined) root = path.resolve(argv[(i += 1)]);
    else if (argv[i] === '--base' && argv[i + 1] !== undefined) base = argv[(i += 1)];
    else if (argv[i] === '--head' && argv[i + 1] !== undefined) head = argv[(i += 1)];
    else words.push(argv[i]);
  }
  const [verb, shard, ids] = words;
  const arity = { check: 1, plan: 1, run: 3 };
  if (!Object.hasOwn(arity, verb) || words.length !== arity[verb] || (verb === 'run' && (shard === undefined || ids === undefined || ids === ''))) {
    err(`${USAGE}\n`);
    return 2;
  }

  const loaded = given === undefined ? await loadUnits(root) : { units: given, problems: [] };
  const units = loaded.units;

  if (verb === 'check') {
    let found;
    try {
      found = findProbeScripts(root);
    } catch (error) {
      err(`probe-shards: ${error.message}\n`);
      return 1;
    }
    const problems = [...loaded.problems, ...checkUnits({ units, byHand, found, exists: (file) => existsSync(path.join(root, file)), files: listFiles(root) })];
    for (const problem of problems) {
      if (env.GITHUB_ACTIONS === 'true') out(`::error ${problem.file === undefined ? '' : `file=${problem.file},`}title=${problem.title}::${escapeData(problem.message)}\n`);
      else err(`probe-shards: ${problem.message}\n`);
    }
    if (problems.length > 0) return 1;
    const scripts = new Set(units.map((unit) => unit.script));
    out(`probe-shards: ok (${units.length} units, ${units.filter((unit) => unit.controls !== undefined).length} control units, ${scripts.size} probe scripts, ${byHand.length} by hand)\n`);
    return 0;
  }

  if (loaded.problems.length > 0) {
    for (const problem of loaded.problems) err(`probe-shards: ${problem.message}\n`);
    return 1;
  }

  if (verb === 'plan') {
    const event = env.GITHUB_EVENT_NAME;
    let context = contextOf({ event, attempt: env.GITHUB_RUN_ATTEMPT });
    let changed = null;
    const typed = String(env.CHANGED_PATHS ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '');
    if (event === 'workflow_dispatch' && typed.length > 0) {
      // A dispatch that lists paths rehearses the pull request that would change them (the same selection, on the runner, without a pull request).
      context = { mode: 'by-change', reason: `a rehearsal of a pull request that changes the ${typed.length} path${typed.length === 1 ? '' : 's'} of the dispatch input` };
      changed = typed;
    } else if (context.mode === 'by-change') {
      try {
        changed = changedPaths({ root, base, head, env });
      } catch (error) {
        const message = show(error.message);
        err(`probe-shards: ${message}\n`);
        if (env.GITHUB_ACTIONS === 'true') out(`::warning title=Kit probes plan::${escapeData(`${message}: every control runs`)}\n`);
      }
    }
    let result;
    try {
      result = planRun({ units, changed, context });
    } catch (error) {
      err(`probe-shards: ${error.message}\n`);
      return 1;
    }
    const text = renderPlan(result);
    out(text);
    const matrix = matrixOf(result.shards);
    try {
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nshards=${matrix.include.length}\nmode=${result.selection.mode}\n`);
    } catch (error) {
      err(`probe-shards: could not write the outputs: ${show(error.message)}\n`);
      return 1;
    }
    return 0;
  }

  // run
  const wanted = ids.split(',');
  const table = new Map(units.map((unit) => [unit.id, unit]));
  const chosen = [];
  for (const unitId of wanted) {
    if (!table.has(unitId)) {
      err(`probe-shards: no unit "${unitId}" (the units are ${[...table.keys()].join(', ')})\n`);
      return 2;
    }
    if (chosen.includes(table.get(unitId))) {
      err(`probe-shards: the unit "${unitId}" is listed twice\n`);
      return 2;
    }
    chosen.push(table.get(unitId));
  }
  let results;
  try {
    results = await runShard(chosen, shard, { root, env, out });
  } catch (error) {
    err(`probe-shards: ${error.message}\n`);
    return 1;
  }
  const summary = renderSummary(shard, results);
  const found = driftFindings(shard, results, units, margin);
  const drift = renderDrift(shard, found.rows);
  out(`\n${summary}\n${drift}\n`);
  for (const line of [...found.warnings, ...found.failures]) out(`${line}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n${drift}\n`);
  return results.every((result) => result.ok) && found.failures.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

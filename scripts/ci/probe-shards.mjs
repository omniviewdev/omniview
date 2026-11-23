// The kit probes' units, the check that no probe is left out, the plan that packs the units into shards at run time, the runner of a shard and the verification of the whole run (N24 K1 to K3, then N25).
//
//   node scripts/ci/probe-shards.mjs check                                 exit 1, one line per problem: a probe script that no unit runs, a unit that does not hold together, a probe or a control the manifest lists and the table lacks
//   node scripts/ci/probe-shards.mjs plan                                  packs every unit into the fewest shards under LIMIT_SECONDS; writes `matrix=<json>` and `shards=<n>` to $GITHUB_OUTPUT and the plan to the job summary; fails when it would plan no shard
//   node scripts/ci/probe-shards.mjs run <shard> <unit>,<unit>,...         runs the units of one shard, one after the other; exits 1 when a run failed, a unit took more than its seconds allow or the shard passed its ceiling;
//                                                                          writes ran-<shard>-probe.json to $RUNNER_TEMP: the units it ran, whether each passed and the controls it ran
//   node scripts/ci/probe-shards.mjs verify --reports <dir> --shards <n>   what the shards reported against the table: every unit, every control, once, passed, in as many shards as the plan made
//   --root <dir>                                                           another tree than this repository (the tests)
//
// EVERY PROBE AND EVERY CONTROL RUNS ON EVERY RUN. N25 first ran the controls by the paths a pull request changed, and dropped that after an independent review (docs/ui-next/status/N25.md): a control can go inert through a path no unit
// lists while the probe and the kit's tests stay green, nothing reads the one run that would notice, and a pull request that touches only the new UI saves 9 percent on average. What is kept is what does not depend on it.
//
// THE TABLE IS A DIRECTORY. One file for each probe in scripts/ci/probe-units/<probe>.mjs exports `units`: the unit that runs the probe and the units that run its negative controls (a probe's controls may be several units, each control
// run once). A unit is `{ id, name, script, env?, controls?, seconds }`: its id (the word the plan and the matrix use), its name (the step it replaced), the probe script, the env it runs with (`$RUNNER_TEMP` and `$PROBE_DIST` are expanded
// from the runner's environment; a variable that is not set is an error), the controls it runs (one run each, with NEGATIVE_CONTROL set to it) and the seconds it takes on the runner. It declares no shard: no pull request chooses where
// a unit runs, so two that add units cannot conflict on that, and a pull request that adds a probe adds a file.
//
// THE MANIFEST IS THE FLOOR. scripts/ci/probe-units.manifest.json lists every probe script that runs as a probe and every control of each: what CI proves. `check` fails when the manifest lists a probe or a control that no unit runs, so
// a deleted control or probe is a diff in the manifest that a reviewer reads, and not a line that left a unit file. It is not a mirror: a unit that is not in it is not an error, so two pull requests that add probes do not both edit it.
//
// WHICH SHARD (scripts/ci/probe-pack.mjs). Every unit is packed at run time into the fewest shards that each stay under LIMIT_SECONDS, as even as that allows; the matrix of the shard jobs is the plan's output.
//
// THE SECONDS ARE THE RUNNER'S AND ARE HELD. After a shard ran, each unit's real seconds are compared with the unit's `seconds`: past DRIFT_RATIO and DRIFT_FLOOR_SECONDS over, the shard FAILS and the message has the number to put in
// the unit's file; past the same margin under, it warns. And the SHARD is held: the real seconds of all its units added up may not pass SHARD_CEILING_SECONDS, so that units that are each just inside their margin cannot make a shard
// of 866 s (K3 found shard 5 at 562 s on the runner against 489 s in the table: a warning nobody acted on).
//
// THE WHOLE RUN IS VERIFIED. Each shard writes what it ran; the job named `Kit probes` reads them all and compares them with the table of its own checkout: every unit, every control of it, once, passed, in as many shards as the plan
// made. A plan that was short, a shard that never reported and a unit that dropped out of the matrix are red, whatever the shards' own results said.
//
// THE BUILDS ARE SHARED (N27). Every process of a shard (a probe is a process, and so is each negative control) is given one BUILD_CACHE, `<runner temp>/probe-builds/<key>`, where the key is the hash of everything that can change what
// a build makes (scripts/ci/probe-builds.mjs: the tree, the lockfile, node, the build variables). The first process that needs a build of the fixtures makes it there and the others read it (packages/kit/probes/build-cache.mjs), where
// each used to build its own: about 120 builds of the same fixtures in a full run. That is sound for a control that plants its fault in the loaded page or in what the probe reads of it, which every control does (`plants: 'page'`, a
// unit of controls says it; docs/ui-next/status/N27.md has the 219 read one by one): the page it loads is the clean build's, as it was. A unit that says `plants: 'build'` (a control that plants its fault in the source, or at build
// time) is given no shared build and the variables that name one are taken out of its processes' environment (`unset` of a run), so that it builds its own. A build never sees the control: it is not in the environment it is given.
//
// ADDING A PROBE. Write `<thing>-probe.mjs` in one of PROBE_DIRS and a file for it in scripts/ci/probe-units: a unit for the probe, and one for its negative controls (`plants`: where they plant their fault). Run `node scripts/ci/probe-shards.mjs check`: it fails, naming the file,
// for a probe that no unit runs. Put the seconds of the first run of the unit in `seconds` (the summary of its shard prints them), and after its first CI runs set them with `node scripts/ci/probe-seconds.mjs --write` (the 95th percentile of the runner's recent runs). Add the probe and its controls to the manifest to keep them from being deleted unseen. A probe CI is not
// to run goes in BY_HAND with the reason.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pack } from './probe-pack.mjs';
import { parseBuilds, renderBuilds, shardBuildCache, summariseBuilds } from './probe-builds.mjs';

export { shardBuildCache };

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The directories whose probe scripts must each be run by a unit. */
export const PROBE_DIRS = ['packages/kit/probes', 'ui-next/shell/probes', 'ui-next/page/probes'];

/** The workflow that runs the shards. */
export const WORKFLOW = '.github/workflows/ui-next-kit-probes.yml';

/** The table: one file for each probe, each exporting `units`. */
export const UNITS_DIRECTORY = 'scripts/ci/probe-units';

/** The floor of what CI proves: `{ "<probe script>": { "probe": true, "controls": ["<control>", ...] } }`. */
export const MANIFEST = 'scripts/ci/probe-units.manifest.json';

/** Probe scripts CI does not run: each is run by hand, and is listed here, with the reason, so that "no unit runs it" is a decision someone wrote down and not something nobody noticed. Empty since N24 K2. */
export const BY_HAND = [];

/** The wall time a shard job is held to when it is PLANNED: 9 minutes, the job (its setup and its units) from start to end. */
export const WALL_BUDGET_SECONDS = 540;
/** The 90th percentile of a shard job's setup (the job minus its units' step) on the 70 shard jobs of 7 runs (median 87.5 s; docs/ui-next/status/N24-K3.md and N25.md). */
export const SETUP_P90_SECONDS = 108;
/** The slowest setup of those 70 shard jobs: what the job's timeout must leave room for when a shard runs to its ceiling (the workflow test pins that). */
export const SETUP_MAX_SECONDS = 137;
/** The most unit seconds a shard may be PLANNED to hold: the budget less the setup, so that a shard at its seconds and a slow (90th percentile) setup is a job of 9 minutes. It moves only with that data, never to make a table fit. */
export const LIMIT_SECONDS = WALL_BUDGET_SECONDS - SETUP_P90_SECONDS;

/**
 * A unit fails its shard when it took more than DRIFT_RATIO of its `seconds` over them (a quarter) AND more than DRIFT_FLOOR_SECONDS over them: that is, past its seconds plus the larger of the two, `max(ratio x seconds, floor)`, not
 * their sum. The same margin under only warns. Seven runs of 2026-11-21 and 22 (4,364 to 4,471 s of units, 235 unit runs) against the seconds of run 44929041191: the most any unit took over them was 45 s (the controls of the log
 * view on a slow machine, 166 s for 121 s; a unit is many short runs that each build the fixtures), and the floor is that and a third: 60 s. With 45 s none fails and the nearest is at the margin; with 30 s two do
 * (docs/ui-next/status/N25.md has the data; probe-shards.test.mjs replays it).
 */
export const DRIFT_RATIO = 0.25;
export const DRIFT_FLOOR_SECONDS = 60;

/**
 * The ceiling on the real seconds of a whole SHARD, which no unit's own margin can bound: units that are each just inside it add up to 866 s in a shard planned at 386 s (the independent review of #656, `drift-bounds.mjs`).
 * It is DERIVED from the runner, not picked. The seven runs of scripts/ci/probe-shards.runs.json hold the 70 real shard jobs of the ten-shard table, each job's units on one machine; the real seconds of a job over the table's
 * seconds for the units it held says how slow that machine was: median 1.003, 95th percentile 1.099, worst 1.292 (shard 3 of run 44932913868, 567 s for 439 s; the second worst is 1.222, the step from one to the other is 5.7
 * percent). A shard planned at the limit (432 s) on the worst machine takes 558 s; the margin is 10 percent more, over that step, so that a machine as much slower than the worst as the worst is than the second still passes: 614 s.
 * Every one of the 70 jobs, scaled to a shard planned at the limit, passes it (probe-shards.test.mjs replays them). The job's timeout leaves a shard at the ceiling, on the slowest setup, time to end and say why it failed
 * (SETUP_MAX_SECONDS; the workflow test pins it).
 */
export const SHARD_SLOWDOWN_WORST = 1.292;
export const SHARD_CEILING_MARGIN = 0.1;
export const SHARD_CEILING_SECONDS = Math.ceil(LIMIT_SECONDS * SHARD_SLOWDOWN_WORST * (1 + SHARD_CEILING_MARGIN));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Which files are probe scripts
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The table and the manifest
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

/** The manifest, `{ manifest, problems }`: `manifest` is null when the file cannot be read or has another shape, and `problems` says which. */
export function loadManifest(root = REPO_ROOT) {
  const problems = [];
  const add = (message) => problems.push({ message, file: MANIFEST, title: 'Kit probe manifest' });
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, MANIFEST), 'utf8'));
    const bad =
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.values(parsed).some((entry) => entry === null || typeof entry !== 'object' || typeof entry.probe !== 'boolean' || !Array.isArray(entry.controls) || entry.controls.some((control) => typeof control !== 'string' || control === ''));
    if (bad) add(`${MANIFEST} is not { "<probe script>": { "probe": true or false, "controls": ["<control>", ...] } }`);
    else return { manifest: parsed, problems };
  } catch (error) {
    add(`${MANIFEST} cannot be read: ${firstLine(error.message)}`);
  }
  return { manifest: null, problems };
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const say = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const quoted = (ids) => say(ids.map((id) => `"${id}"`));

/**
 * The problems of a table, as `{ message, file?, title }`, one sentence each, each naming the file or the unit it is about.
 *   units     the units `loadUnits` gave
 *   byHand    `[{ script, reason }]`: probe scripts CI does not run
 *   found     the probe scripts that are on disk under the probe directories (findProbeScripts)
 *   exists    whether a repository-relative file is on disk
 *   manifest  the floor `loadManifest` gave, or null when it could not be read (loadManifest says why)
 */
export function checkUnits({ units, byHand = BY_HAND, found, exists, manifest = null }) {
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
    if ('paths' in unit) add(`${where} declares paths: units carry no globs since N25, every probe and every control runs on every run (${unit.file})`, unit.file);
    for (const name of ['BUILD_CACHE', 'FIXTURE_DIST', 'FIXTURE_DIST_DEV']) {
      if (unit.env !== undefined && name in unit.env) add(`${where} sets ${name} in env: the shard runner gives every process of a shard the shared build directory (BUILD_CACHE), and no unit names a build of its own (${unit.file})`, unit.file);
    }
    if (unit.controls === undefined) {
      if ('plants' in unit) add(`${where} says where its controls plant their fault and has no controls: only a unit of controls plants (${unit.file})`, unit.file);
    } else if (unit.plants === undefined) {
      add(
        `${where} has controls and does not say where they plant their fault (plants): "page" when every control perturbs the loaded page or what the probe reads of it, so that the build the shard shares serves it, or "build" when a control plants its fault in the source or at build time and needs a build of its own (${unit.file})`,
        unit.file,
      );
    } else if (unit.plants !== 'page' && unit.plants !== 'build') {
      add(`${where} says plants: ${JSON.stringify(unit.plants)}: it is "page" or "build" (${unit.file})`, unit.file);
    } else if (unit.plants === 'build' && unit.env !== undefined && 'DIST' in unit.env) {
      add(`${where} plants its faults at build time and sets DIST in env: a control that changes the build needs a build of its own, and must not read one that is shared (${unit.file})`, unit.file);
    }
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
    // A probe is a unit WITHOUT controls: a script that only has units of controls runs its controls and never the probe itself.
    if (!probes.has(file) && !held.has(file)) {
      add(
        `${file} is a probe script and no unit runs it as a probe (a unit of its controls alone does not run the probe): add a unit for it to a file of ${UNITS_DIRECTORY} (and a unit for its negative controls), or list it in BY_HAND with the reason CI does not run it`,
        file,
        'Kit probe is in no unit',
      );
    }
  }

  // The floor: what the manifest lists, the table must still run. A control may move to another unit of its probe; it may not leave.
  if (manifest !== null) {
    const edit = `If that is the change, delete it from ${MANIFEST} in the same pull request, so that the removal is a diff a reviewer reads`;
    for (const [script, entry] of Object.entries(manifest)) {
      const mine = units.filter((unit) => unit.script === script);
      if (entry.probe && !mine.some((unit) => unit.controls === undefined)) add(`the probe ${script} is in ${MANIFEST} and no unit runs it: a probe was removed from CI. ${edit}`, script, 'Kit probe manifest');
      const have = new Set(mine.flatMap((unit) => (Array.isArray(unit.controls) ? unit.controls : [])));
      for (const control of entry.controls) {
        if (!have.has(control)) add(`the control "${control}" of ${script} is in ${MANIFEST} and no unit runs it: a control was removed from CI. ${edit}`, script, 'Kit probe manifest');
      }
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

/** The variables that name a build a probe reads: BUILD_CACHE is the shared directory the runner sets, DIST the kit probes' ui-next build, FIXTURE_DIST and FIXTURE_DIST_DEV a build that exists (a person's run). A unit that plants at build time reads none of them. */
export const SHARED_BUILD_VARIABLES = ['BUILD_CACHE', 'DIST', 'FIXTURE_DIST', 'FIXTURE_DIST_DEV'];

/**
 * The runs of a unit: one, or one for each of its controls (with NEGATIVE_CONTROL), each with the unit's env expanded from `vars` and, when the shard has a shared build (`buildCache`), BUILD_CACHE set to it. A unit that plants at
 * build time (`plants: 'build'`) gets none, and each of its runs says `unset`: the variables that name a build, which the runner takes out of the environment of its process, so that it builds its own and reads no shared one.
 */
export function expandUnit(unit, vars, { buildCache } = {}) {
  const where = `the unit "${unit.name}"`;
  const own = unit.plants === 'build';
  const env = { ...Object.fromEntries(Object.entries(unit.env ?? {}).map(([key, value]) => [key, expandEnv(value, vars, where)])), ...(buildCache !== undefined && !own ? { BUILD_CACHE: buildCache } : {}) };
  const unset = own ? { unset: [...SHARED_BUILD_VARIABLES] } : {};
  if (unit.controls === undefined) return [{ label: unit.name, script: unit.script, control: null, env, ...unset }];
  return unit.controls.map((control) => ({ label: `${unit.name} (${control})`, script: unit.script, control, env: { ...env, NEGATIVE_CONTROL: control }, ...unset }));
}

/** Does the unit read the ui-next build in $PROBE_DIST (the shard builds it only then)? */
export const readsDist = (unit) => Object.values(unit.env ?? {}).some((value) => /\$(?:\{PROBE_DIST\}|PROBE_DIST\b)/.test(value));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * What a run does: every unit, packed into the fewest shards under `limit`. `shards` is `[{ shard, units: [{ id, seconds }], seconds, dist }]` numbered from 1, the longest first; `dist` says whether a unit of it reads the ui-next
 * build. A table with no unit plans no shard and is an error: an empty matrix is never emitted, and what GitHub does with one is not relied on.
 */
export function planRun({ units, limit = LIMIT_SECONDS }) {
  const packed = pack(units.map((unit) => ({ id: unit.id, seconds: unit.seconds })), limit);
  if (packed.length === 0) throw new Error('the plan has no shard: the table has no unit, and a run that runs nothing must not look green');
  const dist = new Set(units.filter(readsDist).map((unit) => unit.id));
  const shards = packed.map((shard, index) => ({ shard: index + 1, units: shard.units, seconds: shard.seconds, dist: shard.units.some((entry) => dist.has(entry.id)) }));
  return { shards };
}

/** The matrix the shard jobs read: `{ include: [{ shard, units, seconds, dist }] }`, the units as their ids joined by commas. */
export function matrixOf(shards) {
  return { include: shards.map((shard) => ({ shard: shard.shard, units: shard.units.map((entry) => entry.id).join(','), seconds: shard.seconds, dist: shard.dist })) };
}

/** The summary of a plan (Markdown): the counts, and every shard with its units. */
export function renderPlan({ shards }, units) {
  const controlUnits = units.filter((unit) => unit.controls !== undefined);
  const controls = controlUnits.reduce((sum, unit) => sum + unit.controls.length, 0);
  const work = units.reduce((sum, unit) => sum + unit.seconds, 0);
  const lines = [
    '### Kit probes plan',
    '',
    `Every probe and every control runs: ${units.length - controlUnits.length} probes and ${controlUnits.length} control units (${controls} controls), ${work} s of units in ${shards.length} shard${shards.length === 1 ? '' : 's'} of at most ${LIMIT_SECONDS} s each.`,
    '',
    '| Shard | Seconds | Units |',
    '|---|--:|---|',
  ];
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
    // The builds the process says it made or read (`probe-build: ...`), a line that arrives in two pieces joined.
    const builds = [];
    let carry = '';
    const forward = (chunk) => {
      const text = chunk.toString('utf8');
      if (text === '') return;
      out(text);
      last = text.at(-1);
      tail = (tail + text).slice(-TAIL_BYTES);
      const lines = (carry + text).split('\n');
      carry = lines.pop();
      builds.push(...parseBuilds(lines.join('\n')));
    };
    let settled = false;
    const finish = (code, signal, problem) => {
      if (settled) return;
      settled = true;
      const seconds = (performance.now() - started) / 1000;
      builds.push(...parseBuilds(carry));
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
      resolve({ label: run.label, script: run.script, control: run.control, ok, code, signal: signal ?? null, seconds, builds });
    };
    // A unit that plants at build time reads no shared build: the variables that name one are taken out of the shard's environment too, whatever it holds.
    const childEnv = { ...env, ...run.env };
    for (const name of run.unset ?? []) delete childEnv[name];
    const child = spawn(node, [path.join(root, run.script)], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', (error) => finish(null, null, `could not start: ${error.message}`));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/**
 * Runs every run of every unit given, one at a time, to the end: the results are `{ label, unit, script, control, ok, code, signal, seconds, builds }` in order (`unit` is the id of the unit the run belongs to; `builds` the builds the
 * process said it made or read). `buildCache` is the directory the processes of the shard share their builds in (every unit but those that plant at build time is given it). A failure does not stop the shard.
 */
export async function runShard(units, id, { root = REPO_ROOT, env = process.env, out = (text) => process.stdout.write(text), node = process.execPath, buildCache } = {}) {
  const results = [];
  for (const unit of units) {
    for (const run of expandUnit(unit, env, { buildCache })) results.push({ ...(await runOne(run, { id, root, env, out, node })), unit: unit.id });
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
 * The drift of each unit of the shard from its seconds, and of the shard from its ceiling: `{ failures, warnings, rows, shard }`. A unit's seconds on this runner are those of its runs added up (a unit with a run that failed is left
 * out of the unit rows: the seconds of a probe that stopped early or hung say nothing of its cost). It FAILS when it took more than `max(floor, ratio of its seconds)` over its seconds, with the number to put in its file in the
 * message; it only warns when it took more than that under. A unit the table does not have fails: a run that is not in the table is a table that is out of date. The SHARD fails when all its runs added up (a failed one too) passed
 * `ceiling`, with the numbers of every unit in the message.
 */
export function driftFindings(id, results, units, { ratio = DRIFT_RATIO, floor = DRIFT_FLOOR_SECONDS, ceiling = SHARD_CEILING_SECONDS } = {}) {
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
    rows.push({ id: unit.id, name: unit.name, file: unit.file, table: unit.seconds, took, delta, verdict });
    if (verdict === 'ok') continue;
    const percent = whole((Math.abs(delta) / unit.seconds) * 100);
    const lead = `${unit.name} (${unit.id}) took ${took} s on this runner, ${unit.seconds} s in ${unit.file} (${delta > 0 ? '+' : '-'}${Math.abs(delta)} s, ${percent} percent`;
    if (verdict === 'slower') {
      failures.push(`::error title=${title}::${escapeData(`${lead}; a unit fails past ${quarter} and ${floor} s over): put \`seconds: ${took}\` there, and the next run packs the shards with it`)}`);
    } else {
      warnings.push(`::warning title=${title}::${escapeData(`${lead}; a unit warns past ${quarter} and ${floor} s under): put \`seconds: ${took}\` there so that the planner can use the room`)}`);
    }
  }

  const took = whole(results.reduce((sum, result) => sum + result.seconds, 0));
  const planned = [...ran.keys()].reduce((sum, unitId) => sum + (units.find((candidate) => candidate.id === unitId)?.seconds ?? 0), 0);
  const shard = { took, planned, ceiling, units: ran.size };
  if (took > ceiling) {
    const parts = [...ran.entries()].map(([unitId, entry]) => `${unitId} ${whole(entry.seconds)} s of ${units.find((candidate) => candidate.id === unitId)?.seconds ?? '?'}`);
    failures.push(
      `::error title=Kit probe shard seconds (shard ${id})::${escapeData(
        `shard ${id} took ${took} s of units on this runner, over the ${ceiling} s a shard may take (${planned} s in the table for its ${ran.size} unit${ran.size === 1 ? '' : 's'}: ${parts.join(', ')}): a shard is planned at ${LIMIT_SECONDS} s at most, so a machine or a probe that is more than ${whole((ceiling / LIMIT_SECONDS - 1) * 100)} percent slow got past the margin of each unit; find which and put its new seconds in its file (${UNITS_DIRECTORY})`,
      )}`,
    );
  }
  return { failures, warnings, rows, shard };
}

const cell = (text) => String(text).replaceAll('|', '\\|');

/** The seconds of each unit of a shard against the table's, and the shard's against its ceiling (Markdown). */
export function renderDrift(id, rows, shard) {
  const lines = [`#### Kit probes shard ${id}: seconds against the table`, '', '| Unit | Table s | This run s | Difference | |', '|---|--:|--:|--:|---|'];
  for (const row of rows) lines.push(`| ${cell(row.id)} | ${row.table} | ${row.took} | ${row.delta > 0 ? '+' : ''}${row.delta} | ${row.verdict === 'ok' ? '' : row.verdict === 'slower' ? '**over**' : 'under'} |`);
  lines.push('', `The shard took ${shard.took} s of units against ${shard.planned} s in the table; it fails past ${shard.ceiling} s.`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What a shard ran, and the verification of the whole run
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** What a shard reports of itself: `{ shard, units: [{ id, ok, runs, controls }] }`, for each unit whether every run passed, how many runs it made and which controls it ran. */
export function ranReport(shard, results) {
  const units = new Map();
  for (const result of results) {
    if (result.unit === undefined) continue;
    const entry = units.get(result.unit) ?? { id: result.unit, ok: true, runs: 0, controls: [] };
    entry.ok &&= result.ok;
    entry.runs += 1;
    if (result.control !== null && result.control !== undefined) entry.controls.push(result.control);
    units.set(result.unit, entry);
  }
  return { shard: Number.isInteger(Number(shard)) ? Number(shard) : shard, units: [...units.values()] };
}

/** Every `ran-<n>-probe.json` under `dir`, parsed, at any depth (each artifact is a directory of its own). A directory that is not there is an error for the caller. */
export function readReports(dir) {
  const reports = [];
  const problems = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/^ran-\d+-probe\.json$/.test(entry.name)) {
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
 * The problems of a whole run, one sentence each: what the shards reported against the table of this checkout (`units`) and the number of shards the plan made (`shards`, as the plan's output gave it). Every unit must have run once, in a
 * shard that was planned, passed, with every control it has; no shard may be missing, nor any unit be one the table does not have; and a plan of no shard, or of one that cannot be read, runs nothing.
 */
export function verifyRan({ units, reports, shards }) {
  const problems = [];
  const planned = /^\d+$/.test(String(shards)) ? Number(shards) : Number.NaN;
  if (!Number.isInteger(planned) || planned < 1) problems.push(`the plan says "${shards}" shards: a run has at least one shard, and an empty or unreadable plan runs nothing`);

  const seen = new Map();
  for (const report of reports) {
    if (report === null || typeof report !== 'object' || !Number.isInteger(report.shard) || !Array.isArray(report.units)) {
      problems.push(`a shard report is not { shard, units }: ${JSON.stringify(report)?.slice(0, 120)}`);
      continue;
    }
    if (seen.has(report.shard)) problems.push(`shard ${report.shard} reported twice`);
    seen.set(report.shard, report);
  }
  if (planned >= 1) {
    const missing = [];
    for (let n = 1; n <= planned; n += 1) if (!seen.has(n)) missing.push(n);
    if (missing.length > 0) problems.push(`the plan made ${planned} shards and ${missing.length === 1 ? 'shard' : 'shards'} ${say(missing)} did not report: its units did not run, or the shard stopped before it could say`);
    for (const n of seen.keys()) if (n > planned) problems.push(`shard ${n} reported and the plan made ${planned} shards`);
  }

  const where = new Map();
  for (const [n, report] of seen) {
    for (const entry of report.units) where.set(entry.id, [...(where.get(entry.id) ?? []), { shard: n, entry }]);
  }
  const known = new Set(units.map((unit) => unit.id));
  for (const unit of units) {
    const found = where.get(unit.id) ?? [];
    if (found.length === 0) {
      problems.push(`the unit "${unit.id}" ran in no shard`);
      continue;
    }
    if (found.length > 1) problems.push(`the unit "${unit.id}" ran in ${found.length} shards (${say(found.map((one) => one.shard))}): a unit runs once`);
    const { shard, entry } = found[0];
    if (entry.ok !== true) problems.push(`the unit "${unit.id}" did not pass in shard ${shard}`);
    const expected = unit.controls?.length ?? 1;
    if (unit.controls !== undefined) {
      const ran = new Set(entry.controls ?? []);
      const lacking = unit.controls.filter((control) => !ran.has(control));
      if (lacking.length > 0) problems.push(`the unit "${unit.id}" ran in shard ${shard} without the control${lacking.length === 1 ? '' : 's'} ${lacking.join(', ')}`);
    }
    if (entry.runs !== expected) problems.push(`the unit "${unit.id}" made ${entry.runs} runs in shard ${shard} and the table has ${expected}`);
  }
  for (const id of where.keys()) if (!known.has(id)) problems.push(`a shard ran the unit "${id}", which the table does not have`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const USAGE = 'usage: node scripts/ci/probe-shards.mjs [--root <repository>] check | plan | run <shard> <unit>,<unit>,... | verify --reports <directory> --shards <n>';

export async function main(
  argv = process.argv.slice(2),
  { units: given, byHand = BY_HAND, env = process.env, out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text), margin = {} } = {},
) {
  let root = REPO_ROOT;
  let reportsDir;
  let planned;
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1] !== undefined) root = path.resolve(argv[(i += 1)]);
    else if (argv[i] === '--reports' && argv[i + 1] !== undefined) reportsDir = argv[(i += 1)];
    else if (argv[i] === '--shards' && argv[i + 1] !== undefined) planned = argv[(i += 1)];
    else words.push(argv[i]);
  }
  const [verb, shard, ids] = words;
  const arity = { check: 1, plan: 1, run: 3, verify: 1 };
  if (!Object.hasOwn(arity, verb) || words.length !== arity[verb] || (verb === 'run' && (shard === undefined || ids === undefined || ids === '')) || (verb === 'verify' && (reportsDir === undefined || planned === undefined))) {
    err(`${USAGE}\n`);
    return 2;
  }

  const loaded = given === undefined ? await loadUnits(root) : { units: given, problems: [] };
  const units = loaded.units;
  const controlsOf = units.reduce((sum, unit) => sum + (unit.controls?.length ?? 0), 0);

  if (verb === 'check') {
    let found;
    try {
      found = findProbeScripts(root);
    } catch (error) {
      err(`probe-shards: ${error.message}\n`);
      return 1;
    }
    const { manifest, problems: manifestProblems } = loadManifest(root);
    const problems = [...loaded.problems, ...manifestProblems, ...checkUnits({ units, byHand, found, exists: (file) => existsSync(path.join(root, file)), manifest })];
    for (const problem of problems) {
      if (env.GITHUB_ACTIONS === 'true') out(`::error ${problem.file === undefined ? '' : `file=${problem.file},`}title=${problem.title}::${escapeData(problem.message)}\n`);
      else err(`probe-shards: ${problem.message}\n`);
    }
    if (problems.length > 0) return 1;
    const scripts = new Set(units.map((unit) => unit.script));
    out(`probe-shards: ok (${units.length} units, ${units.filter((unit) => unit.controls !== undefined).length} control units, ${controlsOf} controls, ${scripts.size} probe scripts, ${byHand.length} by hand)\n`);
    return 0;
  }

  if (loaded.problems.length > 0) {
    for (const problem of loaded.problems) err(`probe-shards: ${problem.message}\n`);
    return 1;
  }

  if (verb === 'plan') {
    let result;
    try {
      result = planRun({ units });
    } catch (error) {
      err(`probe-shards: ${error.message}\n`);
      return 1;
    }
    const text = renderPlan(result, units);
    out(text);
    const matrix = matrixOf(result.shards);
    try {
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\nshards=${matrix.include.length}\n`);
    } catch (error) {
      err(`probe-shards: could not write the outputs: ${firstLine(error.message)}\n`);
      return 1;
    }
    return 0;
  }

  if (verb === 'verify') {
    let read;
    try {
      read = readReports(path.resolve(reportsDir));
    } catch (error) {
      err(`probe-shards: cannot read the reports in ${reportsDir}: ${firstLine(error.message)}\n`);
      return 1;
    }
    const problems = [...read.problems, ...verifyRan({ units, reports: read.reports, shards: planned })];
    for (const message of problems) {
      if (env.GITHUB_ACTIONS === 'true') out(`::error title=Kit probes::${escapeData(message)}\n`);
      else err(`probe-shards: ${message}\n`);
    }
    if (problems.length > 0) return 1;
    const probes = units.filter((unit) => unit.controls === undefined).length;
    const what = `${probes} probes and ${controlsOf} controls, in ${units.length} units, ran once and passed, in ${read.reports.length} shards`;
    out(`probe-shards: ok (${what})\n`);
    // The verdict's own summary: what was required and what each shard ran, so that a reader of the check sees the run was whole without opening a shard.
    if (env.GITHUB_STEP_SUMMARY) {
      const rows = [...read.reports].sort((a, b) => a.shard - b.shard).map((report) => `| ${report.shard} | ${report.units.map((entry) => entry.id).join(', ')} |`);
      try {
        appendFileSync(env.GITHUB_STEP_SUMMARY, `### Kit probes\n\nEvery probe and every control of the table ran once and passed: ${what}.\n\n| Shard | Units that ran |\n|---|---|\n${rows.join('\n')}\n\n`);
      } catch (error) {
        err(`probe-shards: could not write the summary: ${firstLine(error.message)}\n`);
        return 1;
      }
    }
    return 0;
  }

  // run
  const table = new Map(units.map((unit) => [unit.id, unit]));
  const chosen = [];
  for (const unitId of ids.split(',')) {
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
  let buildCache;
  try {
    buildCache = shardBuildCache({ root, env });
  } catch (error) {
    err(`probe-shards: cannot name the directory this shard shares its builds in: ${firstLine(error.message)}\n`);
    return 1;
  }
  out(`probe-shards: the processes of shard ${shard} share their builds in ${buildCache}\n`);
  let results;
  try {
    results = await runShard(chosen, shard, { root, env, out, buildCache });
  } catch (error) {
    err(`probe-shards: ${error.message}\n`);
    return 1;
  }
  const summary = renderSummary(shard, results);
  const found = driftFindings(shard, results, units, margin);
  const drift = renderDrift(shard, found.rows, found.shard);
  const built = renderBuilds(shard, summariseBuilds(results.flatMap((result) => result.builds ?? [])));
  const builds = built === '' ? '' : `${built}\n`;
  out(`\n${summary}\n${drift}\n${builds}`);
  for (const line of [...found.warnings, ...found.failures]) out(`${line}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n${drift}\n${builds}`);
  if (env.RUNNER_TEMP) {
    try {
      mkdirSync(env.RUNNER_TEMP, { recursive: true });
      writeFileSync(path.join(env.RUNNER_TEMP, `ran-${shard}-probe.json`), `${JSON.stringify(ranReport(shard, results), null, 2)}\n`);
    } catch (error) {
      err(`probe-shards: could not write what this shard ran: ${firstLine(error.message)}\n`);
      return 1;
    }
  }
  return results.every((result) => result.ok) && found.failures.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

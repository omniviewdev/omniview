// The checks that no longer run on a pull request, run where the author is (N34, the owner's order of 2026-11-25): one command each, a thin wrapper over what CI runs at night.
//
//   node scripts/ci/local-checks.mjs probes <unit>,<unit> | --changed    the kit probes: the units named (or those the diff against origin/main touches) and the controls of the same probe scripts,
//                                                                        in WebKit and Chromium: `scripts/ci/probe-shards.mjs run`, which is what a nightly shard runs
//   node scripts/ci/local-checks.mjs seam <unit>,<unit> | --all          the seam: the phases of the units named and the controls of the units named, in WebKit and Chromium, as a nightly shard runs them
//   --dry                                                                print what would run and run nothing
//   --no-build                                                           skip the builds (the workspace packages, the ui-next build, the host): they are already there
//
//   task local:probes -- <unit>,<unit>        task local:seam -- <unit>,<unit>        (the same, through Task)
//
// The result goes in the pull request's description, with the command (docs/ui-next/AGENTS.md, rule 25): the units that ran, and that they passed. The merger runs the same on the merged tree.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { UNITS_DIRECTORY, loadUnits } from './probe-shards.mjs';
import { units as seamUnits } from './seam-units.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The probe units a list of changed files touches: a unit file, the unit of a probe script, and for any other file of a probes directory the units whose script names it (over-included on purpose). `unknown` is what it cannot place. */
export function probeUnitsOf(files, units, read = () => null) {
  const chosen = new Set();
  const unknown = [];
  for (const file of files) {
    const own = units.filter((unit) => unit.file === file || unit.script === file);
    if (own.length > 0) {
      for (const unit of own) chosen.add(unit.id);
    } else if (/(?:^|\/)probes\//.test(file)) {
      const name = path.posix.basename(file);
      const reading = units.filter((unit) => (read(unit.script) ?? '').includes(name));
      if (reading.length === 0) unknown.push(file);
      for (const unit of reading) chosen.add(unit.id);
    } else if (file.startsWith('scripts/ci/') || file === 'packages/kit/package.json') {
      if (!file.startsWith(`${UNITS_DIRECTORY}/`) || !file.endsWith('.mjs')) unknown.push(file);
    }
  }

  return { ids: [...chosen].sort(), unknown };
}

/** The ids with every unit that runs a probe script one of them runs: the probe and its controls go together. */
export const withSiblings = (ids, units) => {
  const scripts = new Set(units.filter((unit) => ids.includes(unit.id)).map((unit) => unit.script));
  return units.filter((unit) => scripts.has(unit.script)).map((unit) => unit.id);
};

/** What a seam run does for the units named: `{ phases, runs }`. A unit has `phases` (one run of the check for them) or `runs` (one `SEAM_CONTROL` each). */
export function seamPlanOf(ids, table = seamUnits) {
  const known = new Map(table.map((unit) => [unit.id, unit]));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) throw new Error(`no seam unit ${missing.map((id) => JSON.stringify(id)).join(', ')} (the units are ${[...known.keys()].join(', ')})`);
  const chosen = ids.map((id) => known.get(id));
  return { phases: chosen.flatMap((unit) => unit.phases ?? []), runs: chosen.flatMap((unit) => unit.runs ?? []) };
}

// What the shell the author runs it from may have left over (AGENTS 35): the selectors of the seam and the engine come from the invocation, never from the environment.
export const INHERITED = ['SEAM_PHASES', 'SEAM_CONTROL', 'SEAM_ONLY', 'SEAM_REMOVE', 'ENGINES'];
export const cleanEnv = (base = process.env) => Object.fromEntries(Object.entries(base).filter(([name]) => !INHERITED.includes(name)));

const sh = (command, args, { dry, env = {}, cwd = REPO } = {}) => {
  process.stdout.write(`+ ${Object.entries(env).map(([key, value]) => `${key}=${value} `).join('')}${command} ${args.join(' ')}\n`);
  if (dry) return 0;
  return spawnSync(command, args, { cwd, env: { ...cleanEnv(), ...env }, stdio: 'inherit' }).status ?? 1;
};

const changedFiles = () => {
  const base = spawnSync('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
  if (base === '') throw new Error('no merge base with origin/main: fetch it, or name the units');
  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', base], { cwd: REPO, encoding: 'utf8' }).stdout;
  return diff.split('\n').filter((line) => line !== '');
};

export async function main(argv = process.argv.slice(2)) {
  const [verb, ...rest] = argv;
  const flags = new Set(rest.filter((word) => word.startsWith('--')));
  const names = rest.filter((word) => !word.startsWith('--')).flatMap((word) => word.split(',')).filter((word) => word !== '');
  const dry = flags.has('--dry');
  const build = !flags.has('--no-build');
  if (verb === 'probes') {
    const { units } = await loadUnits(REPO);
    let ids = names;
    if (flags.has('--changed')) {
      const found = probeUnitsOf(changedFiles(), units, (file) => (existsSync(path.join(REPO, file)) ? readFileSync(path.join(REPO, file), 'utf8') : null));
      if (found.unknown.length > 0) process.stdout.write(`local-checks: not placed in a unit (a shared file: name the units, or every unit with --all): ${found.unknown.join(', ')}\n`);
      ids = found.ids;
    }
    if (flags.has('--all')) ids = units.map((unit) => unit.id);
    const unknown = ids.filter((id) => !units.some((unit) => unit.id === id));
    if (ids.length === 0 || unknown.length > 0) {
      process.stderr.write(`${unknown.length > 0 ? `no unit ${unknown.join(', ')}. ` : 'no unit to run. '}usage: local-checks.mjs probes <unit>,<unit> | --changed | --all  [--dry] [--no-build]\nunits: ${units.map((unit) => unit.id).join(' ')}\n`);
      return 2;
    }
    const run = withSiblings(ids, units).map((id) => id);
    const temp = dry ? path.join(tmpdir(), 'local-probes') : mkdtempSync(path.join(tmpdir(), 'local-probes-'));
    process.stdout.write(`local-checks: ${run.length} units, both engines: ${run.join(', ')}\n`);
    // The probes read the NEXT UI: without OMNIVIEW_UI the build is the stable one.
    if (build) {
      if (sh('task', ['packages'], { dry, env: { OMNIVIEW_UI: 'next' } }) !== 0) return 1;
      if (sh('pnpm', ['exec', 'vite', 'build'], { dry, env: { OMNIVIEW_UI: 'next', OMNIVIEW_BUILD_OUTPUT_DIRECTORY: path.join(temp, 'ui-next-dist') } }) !== 0) return 1;
    }
    // With --no-build nothing was built into the temporary directory: the units read the caller's PROBE_DIST (or their own default).
    return sh('node', ['scripts/ci/probe-shards.mjs', 'run', 'local', run.join(',')], { dry, env: build ? { RUNNER_TEMP: temp, PROBE_DIST: path.join(temp, 'ui-next-dist') } : { RUNNER_TEMP: temp } });
  }

  if (verb === 'seam') {
    const all = flags.has('--all');
    const ids = all ? seamUnits.map((unit) => unit.id) : names;
    let plan;
    try {
      if (ids.length === 0) throw new Error('name the units, or --all');
      plan = seamPlanOf(ids);
    } catch (error) {
      process.stderr.write(`local-checks: ${error.message}\nusage: local-checks.mjs seam <unit>,<unit> | --all  [--dry] [--no-build]\nunits: ${seamUnits.map((unit) => unit.id).join(' ')}\n`);
      return 2;
    }
    const check = 'ui-next/plugins/e2e/seam.check.mjs';
    if (build) {
      if (sh('task', ['packages'], { dry, env: { OMNIVIEW_UI: 'next' } }) !== 0) return 1;
      if (sh('task', ['build:server'], { dry, env: { OMNIVIEW_UI: 'next', GOWORK: 'off', GOFLAGS: '', GOTOOLCHAIN: 'local' } }) !== 0) return 1;
    }
    // Every selected run runs, whatever failed before it; the first failure is the answer.
    let status = 0;
    const keep = (code) => { status ||= code; };
    for (const engine of ['webkit', 'chromium']) {
      if (plan.phases.length > 0) keep(sh('node', [check], { dry, env: { ENGINES: engine, SEAM_PHASES: plan.phases.join(',') } }));
      for (const control of plan.runs) keep(sh('node', [check], { dry, env: { ENGINES: engine, SEAM_CONTROL: control } }));
    }
    return status;
  }

  process.stderr.write('usage: node scripts/ci/local-checks.mjs probes <unit>,<unit> | --changed | --all  |  seam <unit>,<unit> | --all   [--dry] [--no-build]\n');
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();

// How much of the browser checks a run does (N30): the ONE place that says whether a run is a full one or a pull request's.
//
//   node scripts/ci/ci-scope.mjs            reads the event and the diff; writes `scope=<pr|full>` and `reason=<text>` to $GITHUB_OUTPUT and the job summary
//   --base <rev>                            what the diff is taken against (default HEAD^1: the pull request is checked out as a merge commit, as scripts/ci/changes.mjs reads it)
//   --for probes|seam                       the workflow that asks (N33): the files that only the OTHER workflow reads do not count, and for the probes a pull request whose test-infrastructure files are all per-unit files
//                                           (scripts/ci/ci-scope-units.mjs) is `pr` with `full_units`: the units that get the full treatment, every negative control in both engines, on the pull request
//
// `full` is everything: every probe and every negative control in both engines (WebKit and Chromium), the seam's controls and both of its engines. `pr` is what a pull request gets: the probes and the seam's scenarios, in WebKit (the
// desktop application's engine), and NOT the negative controls. The controls and the second engine run on every push to main, every night and on request (`workflow_dispatch`), and on a pull
// request that changes the test infrastructure itself: the files below. A control can go inert through a change to the product that no probe sees; that is the accepted cost of not running 370 of them on every pull request, and the
// run on main is where it is found (`scripts/ci/main-red.mjs` opens the issue).
//
// FAIL CLOSED (N33: and for a unit, only what a unit file, the manifest and the layout record, a probe script and the files only it reads change is attributed to a unit): a diff that cannot be read, an empty one, an event this script does not know and a path it cannot classify are all `full`.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { attribute } from './ci-scope-units.mjs';
import { loadUnits } from './probe-shards.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The files whose change makes a pull request a full run: [pattern, what it is]. A path matches when any pattern does. */
export const INFRASTRUCTURE = [
  [/^scripts\/ci\//, 'the CI scripts (the probe and seam tables, plans and tests)'],
  [/^\.github\//, 'a workflow, the CI image or an action'],
  // The dependencies and the toolchains the checks run on: a browser (Playwright), Node, pnpm and Go change what every probe and the seam are measured by (N31).
  [/(?:^|\/)Taskfile\.ya?ml$/, 'a Taskfile: the tasks every build and check runs'],
  [/^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|package\.json|go\.mod|go\.sum|go\.work|go\.work\.sum|\.tool-versions)$/, 'the lockfile, the module files or the toolchain versions'],
  [/^ui-next\/plugins\/e2e\//, 'the seam check'],
  [/^ui-next\/plugins\/fixture\//, 'the seam\'s fixture plugins'],
  [/^ui-next\/(?:.*\/)?e2e\//, 'an end-to-end check of the new UI'],
  [/^(?:packages\/kit|ui-next(?:\/[^/]+)?)\/probes\//, 'a probe, its control or its harness'],
  [/(?:^|\/)probes\//, 'a probe, its control or its harness'],
];

/**
 * The files that only the OTHER workflow reads (N33), by the workflow that asks: the probes never read the seam's scenarios and plans, nor the seam's check of `main-red`; the seam never reads a probe, its units, its manifest or its layout
 * record. A change of such a file is no reason for the other workflow's run to be full. The seam's fixture plugins (ui-next/plugins/fixture) ARE read by probes and stay infrastructure for both.
 */
export const OTHER_WORKFLOWS = {
  probes: [/^scripts\/ci\/(?:seam-|main-red)/, /^ui-next\/(?:.*\/)?e2e\//],
  seam: [/(?:^|\/)probes\//, /^scripts\/ci\/probe-units\//, /^scripts\/ci\/probe-units\.manifest\.json$/, /^scripts\/ci\/probe-shards\.layout\.json$/],
};

/** A file name as text for a log and a summary: every control character (a newline, a carriage return, an escape) becomes `?`, so that a name cannot write a line of its own (a workflow command, a Markdown heading). */
export const printable = (text) => String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?');

/** The first changed file that is test infrastructure, `{ file, what }`, or null. */
export function infrastructureIn(files) {
  for (const file of files) {
    for (const [pattern, what] of INFRASTRUCTURE) if (pattern.test(file)) return { file, what };
  }

  return null;
}

/**
 * The scope of a run: `{ scope, reason, units?, why? }`. `event` is GITHUB_EVENT_NAME, `files` the changed paths of a pull request (null when the diff could not be read), `input` the scope a person asked for on
 * `workflow_dispatch` ('pr' runs the pull request's scope, for the proof that it does not catch what the main run does; 'full' or nothing is full), `unitsInput` the units a person asks the full treatment of on such a run (ids, with
 * commas), `target` the workflow that asks (`probes` or `seam`: the files only the other one reads do not count) and `attribute` (for `probes`) the function that ties test-infrastructure files to the units that own them
 * (scripts/ci/ci-scope-units.mjs): a `pr` scope then comes with `units`, the units that get every control in both engines, and `why`, the files that put them there.
 */
export function scopeOf({ event, files = null, input = '', unitsInput = '', target = '', attribute: attributeFiles = null }) {
  if (event === 'workflow_dispatch') {
    if (input !== 'pr') return { scope: 'full', reason: 'a manual run' };
    const units = unitsInput.split(',').map((id) => id.trim()).filter((id) => id !== '');
    return { scope: 'pr', reason: `a manual run that asked for the pull request scope${units.length === 0 ? '' : ` and the full treatment of ${units.join(', ')}`}`, units, why: units.length === 0 ? [] : [{ file: 'the manual run', units, what: 'asked for' }] };
  }
  if (event === 'push') return { scope: 'full', reason: 'a push to main' };
  if (event === 'schedule') return { scope: 'full', reason: 'the nightly run' };
  if (event !== 'pull_request') return { scope: 'full', reason: `the event ${JSON.stringify(event)}, which this script does not know` };
  if (files === null) return { scope: 'full', reason: 'the changed files could not be read' };
  if (files.length === 0) return { scope: 'full', reason: 'the diff is empty' };
  const others = OTHER_WORKFLOWS[target] ?? [];
  const counted = files.filter((file) => !others.some((pattern) => pattern.test(file)));
  const infrastructure = counted.filter((file) => infrastructureIn([file]) !== null);
  const left = files.length - counted.length;
  const elsewhere = left === 0 ? '' : `, ${left} of them read by the ${target === 'probes' ? 'seam' : 'kit probes'} only`;
  if (infrastructure.length === 0) return { scope: 'pr', reason: `${files.length} changed file${files.length === 1 ? '' : 's'}, none of them test infrastructure${elsewhere}`, units: [], why: [] };
  const found = infrastructureIn(infrastructure);
  if (target === 'probes' && attributeFiles !== null) {
    const owned = attributeFiles(infrastructure);
    if (owned.ok) {
      const names = owned.units.length === 0 ? 'no unit' : `${owned.units.length} unit${owned.units.length === 1 ? '' : 's'} (${owned.units.join(', ')})`;
      return { scope: 'pr', reason: `${infrastructure.length} per-unit file${infrastructure.length === 1 ? '' : 's'} change ${names}, which run${owned.units.length === 1 ? 's' : ''} with every control in both engines; the other units run as on any pull request`, units: owned.units, why: owned.why };
    }

    return { scope: 'full', reason: `${printable(owned.file)} changes ${infrastructureIn([owned.file])?.what ?? found.what}: ${owned.reason}` };
  }

  return { scope: 'full', reason: `${printable(found.file)} changes ${found.what}` };
}

/** The paths a pull request changes, from git, or null when git cannot say. */
export function changedFiles(base = 'HEAD^1', run = spawnSync) {
  const ran = run('git', ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (ran.error !== undefined || ran.status !== 0 || typeof ran.stdout !== 'string') return null;
  return ran.stdout.split('\0').filter((file) => file !== '');
}

/** The text of a file in a revision of the repository, null when it is not there (a file that was added or deleted). */
export function showAt(rev, file, run = spawnSync) {
  const ran = run('git', ['show', `${rev}:${file}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return ran.error !== undefined || ran.status !== 0 || typeof ran.stdout !== 'string' ? null : ran.stdout;
}

export async function main(argv = process.argv.slice(2), { env = process.env, out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text), run: givenRun, root = REPO, units: given } = {}) {
  const run = givenRun ?? ((command, args, options) => spawnSync(command, args, { ...options, cwd: root }));
  let base = 'HEAD^1';
  let target = '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base' && argv[i + 1] !== undefined) base = argv[(i += 1)];
    else if (argv[i] === '--for' && ['probes', 'seam'].includes(argv[i + 1])) target = argv[(i += 1)];
    else {
      err('usage: node scripts/ci/ci-scope.mjs [--base <rev>] [--for probes|seam]\n');
      return 2;
    }
  }

  const event = env.GITHUB_EVENT_NAME ?? '';
  const files = event === 'pull_request' ? changedFiles(base, run) : null;
  let attributeFiles = null;
  if (target === 'probes' && files !== null) {
    let loaded;
    try {
      loaded = given === undefined ? await loadUnits(root) : { units: given, problems: [] };
    } catch {
      loaded = { units: [], problems: ['the units do not load'] };
    }
    // A table that does not load attributes nothing: the run is full.
    if (loaded.problems.length === 0) {
      const readHead = (file) => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : null);
      attributeFiles = (list) => attribute({ files: list, units: loaded.units, readHead, readBase: (file) => showAt(base, file, run) });
    } else attributeFiles = (list) => ({ ok: false, file: list[0], reason: 'the table of units does not load' });
  }

  const result = scopeOf({ event, files, input: env.SCOPE_INPUT ?? '', unitsInput: env.FULL_UNITS_INPUT ?? '', target, attribute: attributeFiles });
  const units = result.units ?? [];
  out(`ci-scope: ${result.scope} (${result.reason})\n`);
  try {
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `scope=${result.scope}\nreason=${result.reason.replaceAll('\n', ' ')}\nfull_units=${units.join(',')}\n`);
    if (env.GITHUB_STEP_SUMMARY) {
      const treatment = units.length === 0 ? '' : `\n**Full treatment (every negative control, both engines) on this pull request:** ${units.map((id) => `\`${id}\``).join(', ')}\n\n${(result.why ?? []).map((entry) => `- ${printable(entry.file)}: ${entry.what}${entry.units.length === 0 ? '' : ` (${entry.units.join(', ')})`}`).join('\n')}\n\n`;
      appendFileSync(env.GITHUB_STEP_SUMMARY, `### Scope of this run: ${result.scope}\n\n${result.scope === 'pr' ? 'WebKit, no negative controls (they run on main, every night, and on a pull request that changes test infrastructure)' : 'everything: both engines and every negative control'}. Because ${result.reason}.\n${treatment}\n`);
    }
  } catch (error) {
    err(`ci-scope: could not write the outputs: ${String(error.message).split('\n')[0]}\n`);
    return 1;
  }

  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();

// How much of the browser checks a run does (N30): the ONE place that says whether a run is a full one or a pull request's.
//
//   node scripts/ci/ci-scope.mjs            reads the event and the diff; writes `scope=<pr|full>` and `reason=<text>` to $GITHUB_OUTPUT and the job summary
//   --base <rev>                            what the diff is taken against (default HEAD^1: the pull request is checked out as a merge commit, as scripts/ci/changes.mjs reads it)
//
// `full` is everything: every probe and every negative control in both engines (WebKit and Chromium), the seam's controls and both of its engines. `pr` is what a pull request gets: the probes and the seam's scenarios, in WebKit (the
// desktop application's engine), and NOT the negative controls. The controls and the second engine run on every push to main, every night and on request (`workflow_dispatch`), and on a pull
// request that changes the test infrastructure itself: the files below. A control can go inert through a change to the product that no probe sees; that is the accepted cost of not running 370 of them on every pull request, and the
// run on main is where it is found (`scripts/ci/main-red.mjs` opens the issue).
//
// FAIL CLOSED: a diff that cannot be read, an empty one, an event this script does not know and a path it cannot classify are all `full`.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The files whose change makes a pull request a full run: [pattern, what it is]. A path matches when any pattern does. */
export const INFRASTRUCTURE = [
  [/^scripts\/ci\//, 'the CI scripts (the probe and seam tables, plans and tests)'],
  [/^\.github\//, 'a workflow, the CI image or an action'],
  [/^ui-next\/plugins\/e2e\//, 'the seam check'],
  [/^ui-next\/plugins\/fixture\//, 'the seam\'s fixture plugins'],
  [/^ui-next\/(?:.*\/)?e2e\//, 'an end-to-end check of the new UI'],
  [/^(?:packages\/kit|ui-next(?:\/[^/]+)?)\/probes\//, 'a probe, its control or its harness'],
  [/(?:^|\/)probes\//, 'a probe, its control or its harness'],
];

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
 * The scope of a run: `{ scope, reason }`. `event` is GITHUB_EVENT_NAME, `files` the changed paths of a pull request (null when the diff could not be read), `input` the scope a person asked for on
 * `workflow_dispatch` ('pr' runs the pull request's scope, for the proof that it does not catch what the main run does; 'full' or nothing is full).
 */
export function scopeOf({ event, files = null, input = '' }) {
  if (event === 'workflow_dispatch') return input === 'pr' ? { scope: 'pr', reason: 'a manual run that asked for the pull request scope' } : { scope: 'full', reason: 'a manual run' };
  if (event === 'push') return { scope: 'full', reason: 'a push to main' };
  if (event === 'schedule') return { scope: 'full', reason: 'the nightly run' };
  if (event !== 'pull_request') return { scope: 'full', reason: `the event ${JSON.stringify(event)}, which this script does not know` };
  if (files === null) return { scope: 'full', reason: 'the changed files could not be read' };
  if (files.length === 0) return { scope: 'full', reason: 'the diff is empty' };
  const found = infrastructureIn(files);
  if (found !== null) return { scope: 'full', reason: `${printable(found.file)} changes ${found.what}` };
  return { scope: 'pr', reason: `${files.length} changed file${files.length === 1 ? '' : 's'}, none of them test infrastructure` };
}

/** The paths a pull request changes, from git, or null when git cannot say. */
export function changedFiles(base = 'HEAD^1', run = spawnSync) {
  const ran = run('git', ['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (ran.error !== undefined || ran.status !== 0 || typeof ran.stdout !== 'string') return null;
  return ran.stdout.split('\0').filter((file) => file !== '');
}

export function main(argv = process.argv.slice(2), { env = process.env, out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text), run = spawnSync } = {}) {
  let base = 'HEAD^1';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base' && argv[i + 1] !== undefined) base = argv[(i += 1)];
    else {
      err('usage: node scripts/ci/ci-scope.mjs [--base <rev>]\n');
      return 2;
    }
  }

  const event = env.GITHUB_EVENT_NAME ?? '';
  const result = scopeOf({ event, files: event === 'pull_request' ? changedFiles(base, run) : null, input: env.SCOPE_INPUT ?? '' });
  out(`ci-scope: ${result.scope} (${result.reason})\n`);
  try {
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `scope=${result.scope}\nreason=${result.reason.replaceAll('\n', ' ')}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Scope of this run: ${result.scope}\n\n${result.scope === 'pr' ? 'WebKit, no negative controls (they run on main, every night, and on a pull request that changes test infrastructure)' : 'everything: both engines and every negative control'}. Because ${result.reason}.\n\n`);
  } catch (error) {
    err(`ci-scope: could not write the outputs: ${String(error.message).split('\n')[0]}\n`);
    return 1;
  }

  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();

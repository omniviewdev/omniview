// ONE GitHub issue for what is red on main (N30): `.github/workflows/ci-main-red.yml` runs this when a workflow that checks main (the probes, the seam, the Pods check, the benchmarks, the profile, the macOS build) ends on main or in
// the nightly run. A pull request runs less than main does (WebKit, no negative control: scripts/ci/ci-scope.mjs), so what only main runs can go red after a merge, and nothing would say so: a mail to whoever pushed is all GitHub does.
//
//   node scripts/ci/main-red.mjs        reads the finished run from the environment (below); creates, updates or closes the issue labelled `ci-main-red`
//
// There is ONE issue. Its body holds one row for each workflow that is red: the first run that failed and the commit range since the last green run of that workflow on main (the first bad commit is in it), and the latest failure.
// A workflow that fails again keeps its first range and updates its latest; one that goes green leaves the table; when the table is empty the issue is closed with a comment. The state lives in the body, in a comment
// (`<!-- ci-main-red {...} -->`), so that a person can edit the text around it and nothing else reads GitHub's search.
//
// Environment: GH_TOKEN, GITHUB_REPOSITORY, WORKFLOW_NAME, WORKFLOW_ID, CONCLUSION, HEAD_SHA, HEAD_BRANCH, EVENT, RUN_ID, RUN_URL, RUN_CREATED_AT.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LABEL = 'ci-main-red';
export const TITLE = 'CI is red on main';
const MARK = /<!-- ci-main-red (\{[\s\S]*?\}) -->/;
/** A run that ended like this is red; `success` is green; anything else (cancelled, skipped, neutral) says nothing about main. */
export const RED = ['failure', 'timed_out', 'startup_failure'];

export const emptyState = () => ({ workflows: {} });

/** The state in an issue body, or an empty one: a body that was edited into nonsense starts again (the next failure writes it back). */
export function parseState(body) {
  const found = MARK.exec(body ?? '');
  if (found === null) return emptyState();
  try {
    const parsed = JSON.parse(found[1]);
    return parsed !== null && typeof parsed === 'object' && parsed.workflows !== null && typeof parsed.workflows === 'object' ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

const short = (sha) => String(sha ?? '').slice(0, 8);

/**
 * The state after a workflow failed on main. `run` is `{ sha, url, at, event }`, `good` the last green run of the same workflow before it, `{ sha, url }`, or null when none is on record, `commits` the subjects of the range.
 * A workflow already in the table keeps its FIRST failure and its range, and takes this run as its latest.
 */
export function applyFailure(state, name, run, good, commits = []) {
  const next = structuredClone(state);
  const known = next.workflows[name];
  if (known === undefined) next.workflows[name] = { first: run, good, commits, latest: run };
  else known.latest = run;
  return next;
}

/** The state after a workflow went green on main: its row leaves. */
export function applyRecovery(state, name) {
  const next = structuredClone(state);
  delete next.workflows[name];
  return next;
}

export const isEmpty = (state) => Object.keys(state.workflows).length === 0;

/** The body of the issue: what is red and since which commits, then the state. */
export function renderBody(state, { repository = '' } = {}) {
  const lines = ['Workflows that check main and are red. This issue is kept by `scripts/ci/main-red.mjs` (one issue; it closes when every row is green). A pull request does not run the negative controls or Chromium, so a failure here may be a regression that no pull request could show: the commit range names where to look.', ''];
  for (const [name, row] of Object.entries(state.workflows)) {
    lines.push(`## ${name}`, '');
    lines.push(`- First failure: ${row.first.event === 'schedule' ? 'the nightly run' : `the run on ${short(row.first.sha)}`} at ${row.first.at ?? 'an unknown time'} ([run](${row.first.url})).`);
    if (row.good === null || row.good === undefined) lines.push('- Last green run on main: none on record, so the first bad commit cannot be named; start from the commits of main up to this one.');
    else if (row.good.sha === row.first.sha) lines.push(`- Last green run on main: the same commit ${short(row.good.sha)} ([run](${row.good.url})): the failure is not in a commit, it is in the run (a flake, the runner or something outside the repository).`);
    else lines.push(`- Last green run on main: ${short(row.good.sha)} ([run](${row.good.url})). **The first bad commit is in the range** ${repository === '' ? `\`${short(row.good.sha)}..${short(row.first.sha)}\`` : `[\`${short(row.good.sha)}..${short(row.first.sha)}\`](https://github.com/${repository}/compare/${row.good.sha}...${row.first.sha})`}.`);
    if (row.commits?.length > 0) lines.push('', ...row.commits.slice(0, 30).map((subject) => `  - ${subject}`), ...(row.commits.length > 30 ? [`  - … ${row.commits.length - 30} more`] : []));
    if (row.latest.sha !== row.first.sha || row.latest.url !== row.first.url) lines.push('', `- Still failing at ${short(row.latest.sha)} (${row.latest.event === 'schedule' ? 'the nightly run' : 'a push'}, ${row.latest.at ?? 'an unknown time'}): [run](${row.latest.url}).`);
    lines.push('');
  }

  lines.push(`<!-- ci-main-red ${JSON.stringify(state)} -->`);
  return `${lines.join('\n')}\n`;
}

/** `gh` with these arguments: stdout on success, an error with its first line of stderr otherwise. */
export function gh(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(`gh ${args.slice(0, 3).join(' ')}: ${Buffer.concat(err).toString('utf8').trim().split('\n')[0]}`))));
    child.stdin.end(input ?? '');
  });
}

/** The last green run of the workflow on main that was created before this one, `{ sha, url }` or null. */
export async function lastGreen({ ask, repository, workflowId, before, runId }) {
  const text = await ask(['api', `repos/${repository}/actions/workflows/${workflowId}/runs?branch=main&status=success&per_page=30`, '--jq', '[.workflow_runs[] | {id, sha: .head_sha, url: .html_url, at: .created_at}]']);
  const runs = JSON.parse(text).filter((run) => String(run.id) !== String(runId) && (before === undefined || before === '' || run.at < before));
  return runs.length === 0 ? null : { sha: runs[0].sha, url: runs[0].url };
}

/** The subjects of the commits in `good..bad` (newest first), or [] when GitHub cannot say. */
export async function rangeSubjects({ ask, repository, good, bad }) {
  if (good === null || good.sha === bad) return [];
  try {
    const text = await ask(['api', `repos/${repository}/compare/${good.sha}...${bad}`, '--jq', '[.commits[] | "\\(.sha[0:8]) \\(.commit.message | split("\\n")[0])"] | reverse']);
    return JSON.parse(text);
  } catch {
    return [];
  }
}

/** The open issue that carries the label (the lowest number when there are several), `{ number, body }` or null. */
export async function findIssue({ ask, repository }) {
  const text = await ask(['issue', 'list', '--repo', repository, '--label', LABEL, '--state', 'open', '--json', 'number,body', '--limit', '20']);
  const issues = JSON.parse(text).sort((a, b) => a.number - b.number);
  return issues[0] ?? null;
}

export async function ensureLabel({ ask, repository }) {
  try {
    await ask(['label', 'create', LABEL, '--repo', repository, '--color', 'B60205', '--description', 'A workflow that checks main is red (scripts/ci/main-red.mjs)']);
  } catch {
    // It exists already, or the token cannot make it: the issue is made with it either way, and says so if it cannot.
  }
}

/**
 * What to do for a finished run: `{ action, message }`. A run that is not on main, or that ended neither red nor green, changes nothing. Everything goes through `ask` (`gh`), so a test gives it a stand-in.
 */
export async function handle({ env, ask = gh }) {
  const { WORKFLOW_NAME: name, CONCLUSION: conclusion, HEAD_SHA: sha, HEAD_BRANCH: branch, EVENT: event = '', RUN_URL: url = '', RUN_ID: runId = '', RUN_CREATED_AT: at = '', WORKFLOW_ID: workflowId = '', GITHUB_REPOSITORY: repository } = env;
  if (!name || !sha || !repository) throw new Error('main-red: WORKFLOW_NAME, HEAD_SHA and GITHUB_REPOSITORY are needed');
  if (branch !== 'main') return { action: 'none', message: `${name} ended on ${branch}, not on main` };
  const red = RED.includes(conclusion);
  if (!red && conclusion !== 'success') return { action: 'none', message: `${name} ended as ${conclusion}: it says nothing about main` };

  const issue = await findIssue({ ask, repository });
  const state = parseState(issue?.body);
  if (!red) {
    if (state.workflows[name] === undefined) return { action: 'none', message: `${name} is green and was not in the issue` };
    const next = applyRecovery(state, name);
    if (isEmpty(next)) {
      await ask(['issue', 'comment', String(issue.number), '--repo', repository, '--body', `${name} is green again at ${sha} ([run](${url})): nothing on main is red. Closing.`]);
      await ask(['issue', 'close', String(issue.number), '--repo', repository]);
      return { action: 'closed', message: `#${issue.number} closed` };
    }

    await ask(['issue', 'edit', String(issue.number), '--repo', repository, '--body-file', '-'], { input: renderBody(next, { repository }) });
    return { action: 'updated', message: `#${issue.number}: ${name} is green again, the others are still red` };
  }

  const run = { sha, url, at, event };
  const known = state.workflows[name] !== undefined;
  let good = null;
  let commits = [];
  if (!known) {
    good = await lastGreen({ ask, repository, workflowId, before: at, runId });
    commits = await rangeSubjects({ ask, repository, good, bad: sha });
  }

  const next = applyFailure(state, name, run, good, commits);
  const body = renderBody(next, { repository });
  if (issue === null) {
    await ensureLabel({ ask, repository });
    const made = await ask(['issue', 'create', '--repo', repository, '--title', TITLE, '--label', LABEL, '--body-file', '-'], { input: body });
    return { action: 'created', message: `${made.trim()}: ${name} is red` };
  }

  await ask(['issue', 'edit', String(issue.number), '--repo', repository, '--body-file', '-'], { input: body });
  return { action: 'updated', message: `#${issue.number}: ${name} is red${known ? ' (still)' : ''}` };
}

export async function main({ env = process.env, out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text), ask = gh } = {}) {
  try {
    const result = await handle({ env, ask });
    out(`main-red: ${result.action}: ${result.message}\n`);
    return 0;
  } catch (error) {
    err(`main-red: ${String(error.message).split('\n')[0]}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();

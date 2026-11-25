// The ci-main-red issue (scripts/ci/main-red.mjs, .github/workflows/ci-main-red.yml): what it writes, when it creates, updates and closes the one issue, and that it ignores what is not main's.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { LABEL, RED, TIMEOUT_ANNOTATION, TITLE, applyFailure, applyRecovery, emptyState, handle, isEmpty, lastGreen, parseState, rangeSubjects, renderBody } from './main-red.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const R = 'o/r';
const run = (sha, extra = {}) => ({ sha, url: `https://github.com/o/r/actions/runs/${sha}`, at: '2026-11-25T03:00:00Z', event: 'push', ...extra });
const good = { sha: 'g00dg00dg00d', url: 'https://github.com/o/r/actions/runs/1' };

test('a failure puts a row in the state with its first run, the last green run and the commits between; a second failure keeps the first and takes the latest', () => {
  const first = applyFailure(emptyState(), 'UI next seam check', run('bad11111'), good, ['bad11111 break it', 'abc12345 fine']);
  assert.deepEqual(Object.keys(first.workflows), ['UI next seam check']);
  assert.equal(first.workflows['UI next seam check'].first.sha, 'bad11111');
  assert.equal(first.workflows['UI next seam check'].latest.sha, 'bad11111');
  const again = applyFailure(first, 'UI next seam check', run('bad22222'), null, []);
  assert.equal(again.workflows['UI next seam check'].first.sha, 'bad11111', 'the first failure and its range stay');
  assert.deepEqual(again.workflows['UI next seam check'].good, good);
  assert.equal(again.workflows['UI next seam check'].latest.sha, 'bad22222');
  assert.equal(first.workflows['UI next seam check'].latest.sha, 'bad11111', 'the earlier state is not changed');
  const other = applyFailure(again, 'Render Benchmarks', run('bad33333'), null, []);
  assert.deepEqual(Object.keys(other.workflows), ['UI next seam check', 'Render Benchmarks']);
  assert.equal(isEmpty(applyRecovery(applyRecovery(other, 'Render Benchmarks'), 'UI next seam check')), true);
  assert.equal(isEmpty(other), false);
});

test('the body names the commit range of the first failure and survives a round trip through the issue', () => {
  const state = applyFailure(emptyState(), 'UI next kit probes', run('bad11111bad11111', { event: 'schedule' }), good, ['bad11111 x']);
  const body = renderBody(state, { repository: R });
  assert.match(body, /## UI next kit probes/);
  assert.match(body, /First failure: the nightly run at 2026-11-25T03:00:00Z/);
  assert.match(body, /\*\*The first bad commit is in the range\*\* \[`g00dg00d\.\.bad11111`\]\(https:\/\/github\.com\/o\/r\/compare\/g00dg00dg00d\.\.\.bad11111bad11111\)/);
  assert.match(body, /- bad11111 x/);
  assert.deepEqual(parseState(body), state);
  assert.deepEqual(parseState('edited by a person, no state'), emptyState());
  assert.deepEqual(parseState('<!-- ci-main-red {not json} -->'), emptyState());
  assert.deepEqual(parseState('<!-- ci-main-red {"workflows": 3} -->'), emptyState());
  assert.deepEqual(parseState(undefined), emptyState());
  const nogood = renderBody(applyFailure(emptyState(), 'W', run('bad'), null), { repository: R });
  assert.match(nogood, /none on record, so the first bad commit cannot be named/);
  const same = renderBody(applyFailure(emptyState(), 'W', run('same'), { sha: 'same', url: 'u' }), { repository: R });
  assert.match(same, /the failure is not in a commit, it is in the run/);
  const still = renderBody(applyFailure(applyFailure(emptyState(), 'W', run('bad11111'), good), 'W', run('bad22222', { at: '2026-11-26T03:00:00Z' }), null), { repository: R });
  assert.match(still, /Still failing at bad22222 \(a push, 2026-11-26T03:00:00Z\)/);
  const long = renderBody(applyFailure(emptyState(), 'W', run('b'), good, Array.from({ length: 35 }, (_, i) => `c${String(i)} s`)), { repository: R });
  assert.match(long, /… 5 more/);
});

/** A stand-in for `gh` with a small state: the issues, the runs of the workflow and the commits of a range; every call is recorded. */
function fakeGh({ issues = [], runs = [], commits = [], failCompare = false, failLabel = false, jobs = [], annotations = {} } = {}) {
  const calls = [];
  const ask = async (args, { input } = {}) => {
    calls.push({ args, input });
    const [first, second] = args;
    if (first === 'issue' && second === 'list') return JSON.stringify(issues);
    if (first === 'issue' && second === 'create') return 'https://github.com/o/r/issues/77\n';
    if (first === 'issue') return '';
    if (first === 'label') {
      if (failLabel) throw new Error('gh label create: already exists');
      return '';
    }
    if (first === 'api' && /\/actions\/runs\/\d+\/jobs/.test(args[1])) return JSON.stringify(jobs.map((conclusion, index) => ({ id: index + 1, conclusion })));
    const annotated = args.find((argument) => /\/check-runs\/\d+\/annotations/.test(argument));
    if (first === 'api' && annotated !== undefined) {
      calls.at(-1).paginated = args.includes('--paginate');
      return (annotations[/check-runs\/(\d+)\//.exec(annotated)[1]] ?? []).map((message) => JSON.stringify(message)).join('\n');
    }
    if (first === 'api' && /\/actions\/workflows\/\d+\/runs/.test(args[1])) return JSON.stringify(runs);
    if (first === 'api' && /\/compare\//.test(args[1])) {
      if (failCompare) throw new Error('gh api: 404');
      return JSON.stringify(commits);
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  return { ask, calls };
}
const env = (extra = {}) => ({ WORKFLOW_NAME: 'UI next seam check', WORKFLOW_ID: '42', CONCLUSION: 'failure', HEAD_SHA: 'bad11111bad11111', HEAD_BRANCH: 'main', HEAD_REPOSITORY: R, EVENT: 'push', RUN_ID: '900', RUN_URL: 'https://github.com/o/r/actions/runs/900', RUN_CREATED_AT: '2026-11-25T03:00:00Z', GITHUB_REPOSITORY: R, ...extra });
const goodRuns = [
  { id: 900, sha: 'bad11111bad11111', url: 'u900', at: '2026-11-25T03:00:00Z', event: 'push', repo: R },
  { id: 850, sha: 'manual', url: 'u850', at: '2026-11-24T12:00:00Z', event: 'workflow_dispatch', repo: R },
  { id: 800, sha: 'f00df00df00d', url: 'u800', at: '2026-11-24T03:00:00Z', event: 'push', repo: R },
  { id: 750, sha: 'fork', url: 'u750', at: '2026-11-23T12:00:00Z', event: 'push', repo: 'someone/fork' },
  { id: 700, sha: 'older', url: 'u700', at: '2026-11-23T03:00:00Z', event: 'schedule', repo: R },
];

test('a red workflow on main with no issue creates THE issue, with the label, naming the range since the last green run before this one', async () => {
  const gh = fakeGh({ runs: goodRuns, commits: ['bad11111 the change', 'c0ffee00 another'] });
  const result = await handle({ env: env(), ask: gh.ask });
  assert.equal(result.action, 'created');
  assert.match(result.message, /issues\/77/);
  const create = gh.calls.find((call) => call.args[0] === 'issue' && call.args[1] === 'create');
  assert.deepEqual(create.args.slice(0, 8), ['issue', 'create', '--repo', R, '--title', TITLE, '--label', LABEL]);
  assert.match(create.input, /g00d|f00df00d/);
  assert.match(create.input, /`f00df00d\.\.bad11111`/, 'the last green run before this one, not this run itself');
  assert.match(create.input, /- bad11111 the change/);
  assert.ok(gh.calls.some((call) => call.args[0] === 'label' && call.args[2] === LABEL), 'the label is made first');
  assert.ok(gh.calls.filter((call) => call.args[0] === 'issue' && call.args[1] === 'create').length === 1);
});

test('the label that cannot be made does not stop the issue, and a compare that fails gives no list of commits and still names the range', async () => {
  const gh = fakeGh({ runs: goodRuns, failLabel: true, failCompare: true });
  const result = await handle({ env: env(), ask: gh.ask });
  assert.equal(result.action, 'created');
  const create = gh.calls.find((call) => call.args[0] === 'issue' && call.args[1] === 'create');
  assert.match(create.input, /`f00df00d\.\.bad11111`/);
  assert.equal(/^  - /m.test(create.input), false);
});

test('a second red workflow, or the same one again, updates the ONE issue; the lowest-numbered issue is the one when there are several', async () => {
  const first = applyFailure(emptyState(), 'Render Benchmarks', run('old11111'), good, []);
  const gh = fakeGh({ issues: [{ number: 12, body: renderBody(first, { repository: R }) }, { number: 5, body: renderBody(first, { repository: R }) }], runs: goodRuns, commits: [] });
  const result = await handle({ env: env(), ask: gh.ask });
  assert.equal(result.action, 'updated');
  const edit = gh.calls.find((call) => call.args[1] === 'edit');
  assert.deepEqual(edit.args.slice(0, 4), ['issue', 'edit', '5', '--repo']);
  assert.deepEqual(Object.keys(parseState(edit.input).workflows), ['Render Benchmarks', 'UI next seam check']);
  assert.equal(gh.calls.some((call) => call.args[1] === 'create'), false);
  const again = fakeGh({ issues: [{ number: 5, body: edit.input }], runs: goodRuns });
  const second = await handle({ env: env({ HEAD_SHA: 'bad22222', RUN_ID: '901', EVENT: 'schedule' }), ask: again.ask });
  assert.match(second.message, /still/);
  const state = parseState(again.calls.find((call) => call.args[1] === 'edit').input);
  assert.equal(state.workflows['UI next seam check'].first.sha, 'bad11111bad11111');
  assert.equal(state.workflows['UI next seam check'].latest.sha, 'bad22222');
  assert.equal(again.calls.some((call) => call.args[0] === 'api'), false, 'a workflow already red is not looked up again');
});

test('a workflow that goes green leaves the issue; the issue is closed, with a comment, when none is left; a green workflow that was not in it changes nothing', async () => {
  const both = applyFailure(applyFailure(emptyState(), 'Render Benchmarks', run('a'), good, []), 'UI next seam check', run('b'), good, []);
  const gh = fakeGh({ issues: [{ number: 5, body: renderBody(both, { repository: R }) }] });
  const updated = await handle({ env: env({ CONCLUSION: 'success' }), ask: gh.ask });
  assert.equal(updated.action, 'updated');
  assert.deepEqual(Object.keys(parseState(gh.calls.find((call) => call.args[1] === 'edit').input).workflows), ['Render Benchmarks']);
  const last = fakeGh({ issues: [{ number: 5, body: gh.calls.find((call) => call.args[1] === 'edit').input }] });
  const closed = await handle({ env: env({ WORKFLOW_NAME: 'Render Benchmarks', CONCLUSION: 'success' }), ask: last.ask });
  assert.equal(closed.action, 'closed');
  assert.deepEqual(last.calls.map((call) => call.args.slice(0, 2).join(' ')).filter((word) => word.startsWith('issue c')), ['issue comment', 'issue close']);
  const none = fakeGh({ issues: [] });
  assert.equal((await handle({ env: env({ CONCLUSION: 'success' }), ask: none.ask })).action, 'none');
  assert.equal(none.calls.some((call) => call.args[1] === 'create' || call.args[1] === 'edit' || call.args[1] === 'close'), false);
});

test('a run that is not on main, or that ended skipped or neutral, changes nothing; timed out and startup failure are red', async () => {
  for (const extra of [{ HEAD_BRANCH: 'ui-next/some-branch' }, { CONCLUSION: 'skipped' }, { CONCLUSION: 'neutral' }, { CONCLUSION: 'action_required' }]) {
    const gh = fakeGh();
    assert.equal((await handle({ env: env(extra), ask: gh.ask })).action, 'none', JSON.stringify(extra));
    assert.deepEqual(gh.calls, [], 'nothing is asked of GitHub');
  }

  for (const conclusion of ['failure', 'timed_out', 'startup_failure']) assert.equal((await handle({ env: env({ CONCLUSION: conclusion }), ask: fakeGh({ runs: goodRuns }).ask })).action, 'created', conclusion);
  assert.deepEqual(RED, ['failure', 'timed_out', 'startup_failure']);
  await assert.rejects(handle({ env: { CONCLUSION: 'failure' }, ask: fakeGh().ask }), /WORKFLOW_NAME, HEAD_SHA and GITHUB_REPOSITORY are needed/);
});

test('lastGreen takes only a push or the nightly run of this repository before this one (not a manual run, not a fork\'s), and says null for none; rangeSubjects is empty for no range', async () => {
  const gh = fakeGh({ runs: goodRuns });
  assert.deepEqual(await lastGreen({ ask: gh.ask, repository: R, workflowId: '42', before: '2026-11-24T00:00:00Z', runId: '1' }), { sha: 'older', url: 'u700' });
  assert.deepEqual(await lastGreen({ ask: gh.ask, repository: R, workflowId: '42', before: '2026-11-25T03:00:00Z', runId: '900' }), { sha: 'f00df00df00d', url: 'u800' });
  assert.equal(await lastGreen({ ask: gh.ask, repository: R, workflowId: '42', before: '2020-01-01T00:00:00Z', runId: '1' }), null);
  assert.deepEqual(await rangeSubjects({ ask: gh.ask, repository: R, good: null, bad: 'x' }), []);
  assert.deepEqual(await rangeSubjects({ ask: gh.ask, repository: R, good: { sha: 'x' }, bad: 'x' }), []);
});

test('the workflow runs on the completion of the workflows that check main, only for main, with the permission to write the one issue and nothing else, one at a time', () => {
  const workflow = parse(readFileSync(path.join(repo, '.github/workflows/ci-main-red.yml'), 'utf8'));
  assert.deepEqual(workflow.on.workflow_run.types, ['completed']);
  assert.deepEqual([...workflow.on.workflow_run.workflows].sort(), ['Main Windows build', 'Main macOS universal', 'Render Benchmarks', 'UI next Pods cluster check', 'UI next kit probes', 'UI next seam check', 'Whole-App Profile']);
  assert.deepEqual(workflow.permissions, { actions: 'read', contents: 'read', issues: 'write' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const job = workflow.jobs.issue;
  assert.match(job.if, /workflow_run\.head_branch == 'main'/);
  assert.match(job.if, /workflow_run\.head_repository\.full_name == github\.repository/, 'a fork\'s branch called main is not main');
  assert.match(job.if, /contains\(fromJSON\('\["push", "schedule"\]'\), github\.event\.workflow_run\.event\)/, 'a push or the nightly run, not a manual or a pull request run');
  assert.match(job.if, /"failure", "timed_out", "startup_failure", "cancelled"/, 'a cancelled run is read from its jobs');
  assert.equal(job['runs-on'], 'ubuntu-slim');
  const step = job.steps.at(-1);
  assert.equal(step.run, 'node scripts/ci/main-red.mjs');
  for (const name of ['WORKFLOW_NAME', 'WORKFLOW_ID', 'CONCLUSION', 'HEAD_SHA', 'HEAD_BRANCH', 'HEAD_REPOSITORY', 'EVENT', 'RUN_ID', 'RUN_URL', 'RUN_CREATED_AT', 'GH_TOKEN']) assert.ok(step.env[name], name);
  // Every workflow it listens to has that name, and runs on main (a push or the nightly run).
  for (const [file, name] of [['ui-next-kit-probes.yml', 'UI next kit probes'], ['ui-next-seam.yml', 'UI next seam check'], ['ui-next-pods.yml', 'UI next Pods cluster check'], ['render-bench.yml', 'Render Benchmarks'], ['app-profile.yml', 'Whole-App Profile'], ['main-macos-universal.yml', 'Main macOS universal'], ['main-windows.yml', 'Main Windows build']]) {
    const listened = parse(readFileSync(path.join(repo, '.github/workflows', file), 'utf8'));
    assert.equal(listened.name, name, file);
    assert.ok('push' in listened.on || 'schedule' in listened.on, `${file} runs on main or at night`);
  }
});

test('S1: only a push to this repository\'s main or its nightly run counts, red or green: a fork\'s branch called main, a manual run (it may have asked for the pull request scope) and a pull request\'s run change nothing', async () => {
  const red = applyFailure(emptyState(), 'UI next seam check', run('bad11111'), good, []);
  const open = [{ number: 5, body: renderBody(red, { repository: R }) }];
  for (const extra of [{ HEAD_REPOSITORY: 'someone/fork' }, { HEAD_REPOSITORY: '' }, { EVENT: 'workflow_dispatch' }, { EVENT: 'pull_request' }, { EVENT: '' }, { EVENT: 'workflow_run' }]) {
    for (const conclusion of ['success', 'failure']) {
      const gh = fakeGh({ issues: open, runs: goodRuns });
      const result = await handle({ env: env({ ...extra, CONCLUSION: conclusion, HEAD_SHA: 'new22222' }), ask: gh.ask });
      assert.equal(result.action, 'none', `${JSON.stringify(extra)} ${conclusion}`);
      assert.deepEqual(gh.calls, [], 'GitHub is not asked, nothing is written');
    }
  }

  for (const event of ['push', 'schedule']) assert.notEqual((await handle({ env: env({ EVENT: event, CONCLUSION: 'success', RUN_CREATED_AT: '2026-11-26T03:00:00Z' }), ask: fakeGh({ issues: open }).ask })).action, 'none', event);
});

test('S1: a run older than the newest the issue has seen for that workflow changes nothing: a re-run of an old commit cannot clear a newer failure or move it back', async () => {
  const red = applyFailure(emptyState(), 'UI next seam check', run('bad22222', { at: '2026-11-26T03:00:00Z' }), good, []);
  const open = [{ number: 5, body: renderBody(red, { repository: R }) }];
  for (const conclusion of ['success', 'failure']) {
    const gh = fakeGh({ issues: open, runs: goodRuns });
    const result = await handle({ env: env({ CONCLUSION: conclusion, RUN_CREATED_AT: '2026-11-25T03:00:00Z' }), ask: gh.ask });
    assert.equal(result.action, 'none', conclusion);
    assert.match(result.message, /older/);
    assert.equal(gh.calls.some((call) => call.args[1] === 'edit' || call.args[1] === 'close'), false);
  }

  const newer = fakeGh({ issues: open });
  assert.equal((await handle({ env: env({ CONCLUSION: 'success', RUN_CREATED_AT: '2026-11-27T03:00:00Z' }), ask: newer.ask })).action, 'closed');
});

test('S2: a run that ended cancelled is red when a job of it failed or timed out (a shard that hit its timeout cancels the run), and nothing when it was only superseded', async () => {
  const hang = fakeGh({ runs: goodRuns, jobs: ['success', 'cancelled', 'failure', 'success'] });
  const result = await handle({ env: env({ CONCLUSION: 'cancelled' }), ask: hang.ask });
  assert.equal(result.action, 'created');
  assert.ok(hang.calls.some((call) => /\/actions\/runs\/900\/jobs/.test(call.args[1] ?? '')), 'the jobs of the run are read');
  assert.equal((await handle({ env: env({ CONCLUSION: 'cancelled' }), ask: fakeGh({ runs: goodRuns, jobs: ['timed_out', 'cancelled'] }).ask })).action, 'created');
  const superseded = fakeGh({ jobs: ['success', 'cancelled', 'cancelled', 'skipped'] });
  const none = await handle({ env: env({ CONCLUSION: 'cancelled' }), ask: superseded.ask });
  assert.equal(none.action, 'none');
  assert.match(none.message, /superseded/);
  assert.equal(superseded.calls.some((call) => call.args[0] === 'issue'), false);
  assert.equal((await handle({ env: env({ CONCLUSION: 'cancelled' }), ask: fakeGh({ jobs: [] }).ask })).action, 'none');
});

test('a change to main-red.mjs or its test starts the run whose shards run that test, and a label is not a trigger', () => {
  const seam = parse(readFileSync(path.join(repo, '.github/workflows/ui-next-seam.yml'), 'utf8'));
  for (const event of ['pull_request', 'push']) assert.ok(seam.on[event].paths.includes('scripts/ci/main-red*'), `${event} does not start for scripts/ci/main-red*`);
  const shard = seam.jobs.seam.steps.find((step) => step.name === 'Check the units and the tests of the plan');
  assert.match(shard.run, /scripts\/ci\/main-red\.test\.mjs/);
  assert.equal(seam.on.pull_request.types, undefined, 'the default types: no `labeled` run for a label that changes nothing');
});

test('S1 of #726: a job that reached its timeout (cancelled, with the annotation of a timeout) makes a cancelled run red, so a hang of a single-job workflow opens the issue; a plain cancel with another annotation does not', async () => {
  const hang = fakeGh({ runs: goodRuns, jobs: ['cancelled'], annotations: { 1: ['The job has exceeded the maximum execution time of 30m0s'] } });
  const result = await handle({ env: env({ WORKFLOW_NAME: 'Main Windows build', CONCLUSION: 'cancelled' }), ask: hang.ask });
  assert.equal(result.action, 'created');
  assert.ok(hang.calls.some((call) => /\/check-runs\/1\/annotations/.test(call.args.join(' '))), 'the annotations of the cancelled job are read');
  const manual = fakeGh({ jobs: ['success', 'cancelled'], annotations: { 2: ['The run was canceled by @someone.', 'Node.js 20 is deprecated'] } });
  assert.equal((await handle({ env: env({ CONCLUSION: 'cancelled' }), ask: manual.ask })).action, 'none');
  const second = fakeGh({ runs: goodRuns, jobs: ['success', 'cancelled', 'cancelled'], annotations: { 3: ['The job has exceeded the maximum execution time of 1m0s'] } });
  assert.equal((await handle({ env: env({ CONCLUSION: 'cancelled' }), ask: second.ask })).action, 'created', 'any job of the run');
  // N33 (CodeRabbit on #728): the annotations of every page are read, and a message with a newline is one message.
  const many = Array.from({ length: 80 }, (_, index) => `Node.js 20 is deprecated (${index})\nsecond line`);
  const late = fakeGh({ runs: goodRuns, jobs: ['cancelled'], annotations: { 1: [...many, 'The job has exceeded the maximum execution time of 30m0s'] } });
  assert.equal((await handle({ env: env({ CONCLUSION: 'cancelled' }), ask: late.ask })).action, 'created', 'a timeout annotation past the first page is found');
  assert.equal(late.calls.find((call) => call.args.some((argument) => /annotations/.test(argument))).paginated, true);
  assert.equal(TIMEOUT_ANNOTATION.test('The job has exceeded the maximum execution time of 1m0s'), true);
});

test('S1 of #726: the workflows that only main runs (the Windows build, the macOS build) end in a verdict job that fails closed when their job did not succeed, so that a hang is a failed job and not only a cancelled one', () => {
  for (const [file, job] of [['main-windows.yml', 'build-windows'], ['main-macos-universal.yml', 'build-universal']]) {
    const workflow = parse(readFileSync(path.join(repo, '.github/workflows', file), 'utf8'));
    const verdict = workflow.jobs.verdict;
    assert.ok(verdict, `${file} has a verdict job`);
    assert.deepEqual([].concat(verdict.needs), [job], file);
    assert.equal(verdict.if, '${{ always() }}', file);
    assert.equal(verdict['runs-on'], 'ubuntu-slim', file);
    assert.equal(verdict.steps.length, 1);
    assert.equal(verdict.steps[0].env.RESULT, `\${{ needs.${job}.result }}`);
    const outcome = (result) => spawnSync('/bin/bash', ['-e', '-c', verdict.steps[0].run], { env: { PATH: process.env.PATH, RESULT: result }, encoding: 'utf8' });
    assert.equal(outcome('success').status, 0, file);
    for (const result of ['failure', 'cancelled', 'skipped', '', 'timed_out']) assert.equal(outcome(result).status, 1, `${file}: ${JSON.stringify(result)}`);
    for (const [id, other] of Object.entries(workflow.jobs)) assert.equal(other['continue-on-error'], undefined, `${file}: ${id}`);
  }
});

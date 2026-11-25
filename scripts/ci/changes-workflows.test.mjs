// The two workflows that read the path classifier (.github/workflows/pr.yml, pr-checks.yml): which job reads which flag, the repository guard that runs on every pull request, and the two gates
// (`UI checks`, `e2e-tests`) that stay green when the classifier skipped their parts and red in every other case.
//
// The classifier itself is tested in changes.test.mjs, which needs no installed dependency and runs in the repository guard. This file reads the workflows with `yaml`, so it runs where the
// dependencies are installed (the job `UI lint and kit contracts`). Every "negative control" feeds the gate or the table the mistake it exists for; each was also seen to go red with the
// rule it names taken out (docs/ui-next/status/N24-D1.md).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { ALWAYS, GATED } from './changes.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const WORKFLOWS = { 'pr.yml': '.github/workflows/pr.yml', 'pr-checks.yml': '.github/workflows/pr-checks.yml' };
const text = Object.fromEntries(Object.entries(WORKFLOWS).map(([name, file]) => [name, readFileSync(path.join(repo, file), 'utf8')]));
const workflow = Object.fromEntries(Object.entries(text).map(([name, source]) => [name, parse(source)]));

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const jobOf = (file, id) => workflow[file].jobs[id];
const stepsOf = (file, id) => jobOf(file, id).steps ?? [];
const needsOf = (job) => (Array.isArray(job.needs) ? job.needs : job.needs === undefined ? [] : [job.needs]);
const SKIP = { host: "${{ needs.changes.outputs.skip_host != 'true' }}", ui: "${{ needs.changes.outputs.skip_ui != 'true' }}", windows: "${{ needs.changes.outputs.skip_windows != 'true' }}" };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The table and the workflows agree
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('every job of the two workflows is either gated by a flag of the table or one of the jobs that always run: none is left to chance', () => {
  for (const file of Object.keys(WORKFLOWS)) {
    const listed = [...GATED, ...ALWAYS].filter((entry) => entry.workflow === file).map((entry) => entry.job).sort();
    assert.deepEqual(Object.keys(workflow[file].jobs).sort(), listed, `${file}: a job that is not in scripts/ci/changes.mjs (GATED or ALWAYS), or a listed job that is gone`);
  }
});

test('each gated job waits for the classifier and runs unless its flag is "true": the check is `!= \'true\'`, so that a classifier that wrote nothing skips nothing', () => {
  for (const entry of GATED) {
    const job = jobOf(entry.workflow, entry.job);
    assert.ok(job, `${entry.workflow}: ${entry.job}`);
    assert.ok(needsOf(job).includes('changes'), `${entry.job} must need the classifier`);
    assert.equal(job.if, SKIP[entry.flag], `${entry.workflow}: ${entry.job}`);
  }
  assert.deepEqual(needsOf(jobOf('pr-checks.yml', 'ui-runtime-contract')).sort(), ['c02-corpus', 'changes']);
});

test('NEGATIVE: no job runs only when a flag says "run": the classifier writes skip flags, and `== \'true\'` on one would skip a job whose flag is missing', () => {
  for (const file of Object.keys(WORKFLOWS)) {
    for (const [id, job] of Object.entries(workflow[file].jobs)) {
      const conditions = [job.if, ...(job.steps ?? []).map((step) => step.if)].filter((value) => typeof value === 'string');
      for (const condition of conditions) {
        if (!/needs\.changes\.outputs/.test(condition)) continue;
        assert.match(condition, /needs\.changes\.outputs\.skip_(host|ui|windows) != 'true'/, `${file}: ${id}: ${condition}`);
        assert.doesNotMatch(condition, /==/, `${file}: ${id}: ${condition}`);
        assert.doesNotMatch(condition, /outputs\.class/, `${file}: ${id}: a job is gated by a flag, never by the name of a class`);
      }
    }
  }
});

test('the classifier is the same job in both workflows: a checkout of two commits, the pinned Node, the script, and three outputs, of which two are skip flags', () => {
  const [one, other] = ['pr.yml', 'pr-checks.yml'].map((file) => jobOf(file, 'changes'));
  assert.deepEqual(one, other, 'the same job twice, so that both workflows classify one change the same way');
  assert.equal(one.name, 'Changed paths');
  assert.equal(one['runs-on'], 'ubuntu-slim', 'the smallest runner: the job reads two commits and runs one script (N30)');
  assert.equal(one['timeout-minutes'], 5);
  assert.equal(one.needs, undefined);
  assert.equal(one.if, undefined, 'the classifier runs on every pull request');
  assert.deepEqual(Object.keys(one.outputs).sort(), ['class', 'skip_host', 'skip_ui', 'skip_windows']);
  for (const name of ['class', 'skip_host', 'skip_ui', 'skip_windows']) assert.equal(one.outputs[name], `\${{ steps.classify.outputs.${name} }}`);
  const [checkout, node, classify] = one.steps;
  assert.equal(checkout.uses, 'actions/checkout@v4');
  assert.equal(checkout.with['fetch-depth'], 2, 'HEAD^1 is the base of the merge commit: two commits are all it needs');
  assert.equal(node.uses, 'actions/setup-node@v4');
  assert.equal(node.with['node-version'], '${{ env.NODE_VERSION }}');
  assert.equal(classify.id, 'classify');
  assert.equal(classify.run, 'node scripts/ci/changes.mjs --base HEAD^1');
  assert.equal(one.steps.length, 3);
  for (const file of Object.keys(WORKFLOWS)) assert.equal(workflow[file].env.NODE_VERSION, '26.13.0');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The repository guard
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the repository guard runs on every pull request, with nothing before it: no needs, no condition, two commits of history, the tracked-outputs guard and the classifier\'s own tests', () => {
  const guard = jobOf('pr-checks.yml', 'repo-guard');
  assert.equal(guard.name, 'Repo guard');
  assert.equal(guard.needs, undefined);
  assert.equal(guard.if, undefined);
  assert.equal(guard['timeout-minutes'], 5);
  assert.equal(guard['runs-on'], 'ubuntu-latest');
  assert.equal(guard.steps[0].uses, 'actions/checkout@v4');
  assert.equal(guard.steps[0].with['fetch-depth'], 2);
  const commands = guard.steps.map((step) => step.run ?? '').join('\n');
  assert.match(commands, /node --test scripts\/check-tracked-outputs\.test\.mjs/);
  assert.match(commands, /node scripts\/check-tracked-outputs\.mjs --base HEAD\^1/);
  assert.match(commands, /node --test scripts\/ci\/changes\.test\.mjs/, 'a classifier that skipped its own tests would be a classifier nobody checks');
  assert.ok(guard.steps.every((step) => !step.run?.includes('pnpm')), 'the guard needs node and git, not an install: it is the 15-second job');
});

test('the tracked-outputs guard runs in the repository guard and nowhere else, and Go checks no longer fetches history for it', () => {
  for (const file of Object.keys(WORKFLOWS)) {
    for (const [id, job] of Object.entries(workflow[file].jobs)) {
      const uses = (job.steps ?? []).some((step) => /check-tracked-outputs/.test(step.run ?? ''));
      assert.equal(uses, file === 'pr-checks.yml' && id === 'repo-guard', `${file}: ${id}`);
    }
  }
  const checkout = stepsOf('pr-checks.yml', 'go-checks').find((step) => step.uses?.startsWith('actions/checkout'));
  assert.equal(checkout.with?.['fetch-depth'], undefined);
});

test('the workflow tests run where the dependencies are installed, before the build: in the job that lints', () => {
  const commands = stepsOf('pr-checks.yml', 'ui-lint').map((step) => step.run ?? '');
  const at = commands.findIndex((command) => /node --test scripts\/ci\/changes-workflows\.test\.mjs/.test(command));
  assert.ok(at > 0, 'a step runs them');
  assert.ok(at < commands.findIndex((command) => /task packages/.test(command)), 'before the packages are built');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What the other jobs keep
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the jobs that were there keep their names, so that no check is renamed by this change', () => {
  const names = (file) => Object.fromEntries(Object.entries(workflow[file].jobs).map(([id, job]) => [id, job.name]));
  assert.deepEqual(names('pr-checks.yml'), {
    changes: 'Changed paths',
    'repo-guard': 'Repo guard',
    'release-packaging-checks': 'Release packaging contracts',
    'windows-connection-profiles': 'Windows connection profiles',
    'go-checks': 'Go checks',
    'go-lint': 'Go lint',
    'bindings-check': 'Bindings freshness',
    'c02-corpus': 'C02 error transport corpus',
    'ui-build': 'UI build',
    'ui-lint': 'UI lint and kit contracts',
    'ui-component-tests': 'UI component tests',
    'ui-runtime-contract': 'UI runtime contract',
    'ui-checks': 'UI checks',
  });
  assert.deepEqual(names('pr.yml'), {
    changes: 'Changed paths',
    'e2e-application': undefined,
    'e2e-tests': 'e2e-tests',
    'build-artifacts': 'build-artifacts (${{ matrix.platform }})',
    'build-artifacts-windows': 'build-artifacts (windows/amd64)',
  });
  assert.equal(jobOf('pr.yml', 'e2e-application').uses, './.github/workflows/e2e-runner.yml');
  assert.equal(jobOf('pr.yml', 'e2e-application').with.base, '${{ github.event.pull_request.base.sha }}');
  assert.deepEqual(jobOf('pr.yml', 'build-artifacts').strategy.matrix.include.map((entry) => entry.platform), ['linux/amd64'], 'Windows is a job of its own: the new UI keeps it while the Linux build is skipped; there is no macOS build on a pull request (N30: main-macos-universal.yml builds it on every push to main)');
});

// The Windows build is not an entry of the matrix any more, so that the new UI can keep it while the macOS and Linux builds are skipped. Its steps are the matrix job's, and a step changed in one and not the other fails here.
const MACOS_ONLY = /\n\s*if \[\[ "\$RUNNER_OS" == macOS \]\]; then\n[^\n]*\n\s*fi/;
const asWindows = (text) => text.replace(MACOS_ONLY, '').replaceAll('${{ matrix.build-tags }}', 'production').replaceAll('${{ matrix.extra-ldflags }}', '-H windowsgui');

test('the Windows build is the matrix job\'s steps for Windows, step by step: the same actions, versions and commands, the Windows flags, no step of its own', () => {
  const matrix = stepsOf('pr.yml', 'build-artifacts').filter((step) => step.name !== 'Match checkout directory ownership to container user' && step.name !== 'Create macOS .app bundle');
  const all = stepsOf('pr.yml', 'build-artifacts-windows');
  const reactCompiler = all.findIndex((step) => step.name === 'Check native Windows React compiler admission');
  assert.equal(all[reactCompiler - 1]?.name, 'Build workspace packages');
  assert.equal(all[reactCompiler].run, 'node --test scripts/react-compiler.test.mjs');
  assert.equal(all[reactCompiler].if, undefined, 'the job is Windows only: the step has no condition');
  assert.ok(!matrix.some((step) => step.name === 'Check native Windows React compiler admission'), 'and the matrix job, which has no Windows entry, has no such step');
  const windows = all.filter((step, index) => index !== reactCompiler);
  assert.deepEqual(windows.map((step) => step.name), matrix.map((step) => step.name), 'the same steps, in the same order, with the macOS and container ones left out');
  for (const [index, step] of windows.entries()) {
    const twin = matrix[index];
    assert.equal(step.uses, twin.uses, step.name);
    assert.deepEqual(step.with, twin.with, step.name);
    assert.equal(step.shell, twin.shell, step.name);
    if (step.run !== undefined) assert.equal(step.run.trim(), asWindows(twin.run).trim(), step.name);
  }
  const job = jobOf('pr.yml', 'build-artifacts-windows');
  assert.equal(job['runs-on'], 'windows-latest');
  assert.equal(job['timeout-minutes'], 30);
  assert.equal(job.container, undefined);
  assert.deepEqual(job.env, { GOWORK: 'off' });
  assert.match(stepsOf('pr.yml', 'build-artifacts-windows').find((step) => step.name === 'Build Omniview').run, /-ldflags "-w -s -H windowsgui /);
});

test('the checks that start for the new UI\'s own tooling are the ones that read it: the kit probes for the probe table and its test, the Pods check for its scripts', () => {
  const paths = (file) => parse(readFileSync(path.join(repo, `.github/workflows/${file}`), 'utf8')).on.pull_request.paths;
  for (const entry of ['scripts/ci/probe-shards.mjs', 'scripts/ci/probe-shards.test.mjs']) assert.ok(paths('ui-next-kit-probes.yml').includes(entry), `the kit probes workflow does not start for ${entry}`);
  assert.ok(paths('ui-next-pods.yml').includes('scripts/ui-next-pods/**'), 'the Pods workflow does not start for its scripts');
  // and the UI jobs, which read the rest of the tooling (scripts/ui-next-bundle.mjs, bench/table, bench/log), are not skipped for the new UI
  assert.deepEqual(GATED.filter((entry) => entry.flag === 'ui').map((entry) => entry.job).filter((job) => !needsOf(jobOf('pr-checks.yml', job)).includes('changes')), []);
});

test('the display names of the table are the names of the jobs', () => {
  for (const entry of GATED) {
    const name = jobOf(entry.workflow, entry.job).name;
    if (name === undefined) assert.equal(entry.check, entry.job, 'a reusable-workflow call has no name: its check is named by its id');
    else assert.ok(name === entry.check || name.startsWith(`${entry.check} (`), `${entry.job}: ${name} is not ${entry.check}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The gates, run by bash as the runner does
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

assert.equal(spawnSync('jq', ['--version']).status, 0, 'jq is needed for these tests (GitHub runners have it)');

/** Runs a step as the runner does (`bash -e <file>`) with `env`, and returns what it would see: exit status, output, and the job summary it wrote. */
function runStep(step, env) {
  const directory = mkdtempSync(path.join(tmpdir(), 'changes-gate-'));
  roots.push(directory);
  writeFileSync(path.join(directory, 'step.sh'), step.run);
  const summary = path.join(directory, 'summary.md');
  const outcome = spawnSync('/bin/bash', ['-e', path.join(directory, 'step.sh')], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: directory, GITHUB_STEP_SUMMARY: summary, ...env } });
  let written = '';
  try {
    written = readFileSync(summary, 'utf8');
  } catch {
    // no summary
  }
  return { ...outcome, output: `${outcome.stdout}${outcome.stderr}`, summary: written };
}

/** Runs the verdict of a gate job, its first step, with `env` for exactly the variables the workflow gives it (each is an expression of the `needs` context: the test stands for the runner). */
function runGate(file, id, env) {
  const [step] = stepsOf(file, id);
  const resolved = {};
  for (const [name, value] of Object.entries(step.env ?? {})) {
    const match = /^\$\{\{ (needs\.[A-Za-z0-9_.-]+|toJSON\(needs\)) \}\}$/.exec(value);
    assert.ok(match, `${id}: env ${name} is ${value}`);
    resolved[name] = env[name];
  }
  assert.deepEqual(Object.keys(resolved).sort(), Object.keys(env).sort(), `${id}: the test feeds the step what the workflow gives it, and nothing else`);
  return runStep(step, resolved);
}

/** The parts of the UI gate, from the table: the jobs of the UI flag. */
const UI_PARTS = GATED.filter((entry) => entry.flag === 'ui' && entry.workflow === 'pr-checks.yml').map((entry) => entry.job);

/** `toJSON(needs)` of the UI gate: the classifier's result and outputs, and each part's result. `null` leaves a job, or the classifier's outputs, out altogether. */
function uiNeeds({ changes = 'success', skip = 'false', klass = 'all', parts = {} } = {}) {
  const needs = {};
  if (changes !== null) needs.changes = { result: changes, outputs: skip === null ? {} : { class: klass, skip_host: 'x', skip_ui: skip } };
  for (const part of UI_PARTS) {
    const result = part in parts ? parts[part] : 'success';
    if (result !== null) needs[part] = { result, outputs: part === 'c02-corpus' ? { c02_corpus_name: result === 'success' ? 'c02-error-corpus-1' : '' } : {} };
  }
  return JSON.stringify(needs);
}
const uiGate = (options) => runGate('pr-checks.yml', 'ui-checks', { NEEDS: uiNeeds(options) });
const allSkipped = Object.fromEntries(UI_PARTS.map((part) => [part, 'skipped']));

test('the check named `UI checks` is the one gate job: the only job of that name, after the classifier and every UI part, run unless the whole run was cancelled', () => {
  const named = Object.entries(workflow['pr-checks.yml'].jobs).filter(([, job]) => job.name === 'UI checks');
  assert.deepEqual(named.map(([id]) => id), ['ui-checks']);
  const gate = jobOf('pr-checks.yml', 'ui-checks');
  assert.deepEqual([...needsOf(gate)].sort(), ['changes', ...UI_PARTS].sort());
  assert.equal(gate.if, '${{ !cancelled() }}');
  assert.equal(gate.steps.length, 1);
  assert.equal(gate.steps[0].env.NEEDS, '${{ toJSON(needs) }}');
});

test('UI checks passes when every part succeeded', () => {
  const outcome = uiGate();
  assert.equal(outcome.status, 0, outcome.output);
  for (const part of UI_PARTS) assert.match(outcome.summary, new RegExp(`\\| ${part} \\| success \\|`));
});

for (const result of ['failure', 'cancelled', 'skipped']) {
  test(`NEGATIVE: UI checks fails when a part finished as ${result} and the classifier did not skip the UI jobs, and names that part and no other`, () => {
    for (const part of UI_PARTS) {
      const outcome = uiGate({ parts: { [part]: result } });
      assert.equal(outcome.status, 1, `${part}: ${outcome.output}`);
      assert.match(outcome.output, new RegExp(`^::error::${part} finished as ${result}$`, 'm'));
      for (const other of UI_PARTS.filter((name) => name !== part)) assert.doesNotMatch(outcome.output, new RegExp(`::error::${other} `));
    }
  });
}

test('NEGATIVE: a code path does not reach the skip: with the UI jobs not skipped by path, UI checks fails when all of them were skipped', () => {
  for (const options of [{ skip: 'false' }, { skip: null }, { skip: '' }, { skip: 'yes' }, { skip: 'TRUE' }, { skip: '1' }]) {
    const outcome = uiGate({ ...options, parts: allSkipped });
    assert.equal(outcome.status, 1, `${JSON.stringify(options)}: ${outcome.output}`);
    for (const part of UI_PARTS) assert.match(outcome.output, new RegExp(`^::error::${part} finished as skipped$`, 'm'));
    assert.doesNotMatch(outcome.summary, /skipped by path/);
  }
});

test('UI checks passes, saying why, when the classifier skipped the UI jobs and every part was skipped: a documentation-only change', () => {
  const outcome = uiGate({ skip: 'true', klass: 'docs', parts: allSkipped });
  assert.equal(outcome.status, 0, outcome.output);
  for (const part of UI_PARTS) assert.match(outcome.summary, new RegExp(`\\| ${part} \\| skipped by path: docs \\|`));
  assert.match(outcome.summary, /\| changes \| success \|/);
  assert.doesNotMatch(outcome.output, /::error::/);
});

test('NEGATIVE: a skip by path hides nothing else: a part that ran and failed, or was cancelled, fails the gate even when the classifier said skip', () => {
  for (const result of ['failure', 'cancelled']) {
    const outcome = uiGate({ skip: 'true', klass: 'docs', parts: { ...allSkipped, 'ui-lint': result } });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, new RegExp(`^::error::ui-lint finished as ${result}$`, 'm'));
    assert.doesNotMatch(outcome.output, /::error::ui-build/);
  }
  const ran = uiGate({ skip: 'true', klass: 'docs', parts: { ...allSkipped, 'ui-lint': 'success' } });
  assert.equal(ran.status, 0, 'a part that ran and succeeded is a success whatever the classifier said');
  assert.match(ran.summary, /\| ui-lint \| success \|/);
});

test('NEGATIVE: UI checks fails when the classifier did not succeed, whatever the parts say: nothing says whether they had to run', () => {
  for (const changes of ['failure', 'cancelled', 'skipped', null]) {
    for (const parts of [{}, allSkipped]) {
      const outcome = uiGate({ changes, skip: 'true', klass: 'docs', parts });
      assert.equal(outcome.status, 1, `${changes} ${JSON.stringify(parts)}: ${outcome.output}`);
      assert.match(outcome.output, /::error::changes finished as (failure|cancelled|skipped|unknown)/);
    }
  }
});

test('NEGATIVE: UI checks fails on no parts at all, on a missing part and on a result nobody knows', () => {
  assert.equal(runGate('pr-checks.yml', 'ui-checks', { NEEDS: '{}' }).status, 1);
  assert.equal(runGate('pr-checks.yml', 'ui-checks', { NEEDS: JSON.stringify({ changes: { result: 'success', outputs: { skip_ui: 'true', class: 'docs' } } }) }).status, 1);
  assert.equal(uiGate({ parts: { 'ui-build': null } }).status, 0, 'the gate reads the parts it is given: the table test above holds the workflow to its `needs`');
  assert.equal(uiGate({ parts: { 'ui-build': 'startup_failure' } }).status, 1);
  assert.equal(uiGate({ parts: { 'ui-build': 'something-new' } }).status, 1);
  assert.equal(uiGate({ parts: { 'ui-build': '' } }).status, 1);
  assert.equal(uiGate({ skip: 'true', klass: 'docs', parts: { ...allSkipped, 'ui-build': 'startup_failure' } }).status, 1);
});

const E2E = { CHANGES: 'success', SKIP: 'false', RESULT: 'success' };
const e2eGate = (env) => runGate('pr.yml', 'e2e-tests', { ...E2E, ...env });

test('the check named `e2e-tests` keeps its name and its place: after the classifier and the suite, run even when the suite did not', () => {
  const gate = jobOf('pr.yml', 'e2e-tests');
  assert.equal(gate.name, 'e2e-tests');
  assert.deepEqual(needsOf(gate), ['changes', 'e2e-application']);
  assert.equal(gate.if, 'always()');
  assert.equal(gate['timeout-minutes'], 1);
  assert.equal(gate.steps.length, 2);
  // e2e/scripts/cache-primer.test.mjs finds the verdict by this name, runs it as a shell script and ends its block at the next step: the name stays, and a step follows.
  assert.equal(gate.steps[0].name, 'Require canonical suite or explicit prose-only success');
  assert.deepEqual(gate.steps[0].env, {
    CHANGES: '${{ needs.changes.result }}',
    SKIP: '${{ needs.changes.outputs.skip_host }}',
    RESULT: '${{ needs.e2e-application.result }}',
  });
  assert.equal(gate.steps[1].name, 'Say why the suite was skipped');
  assert.equal(gate.steps[1].if, "${{ needs.e2e-application.result == 'skipped' }}", 'it runs only after the verdict passed, and says something only when the suite was skipped');
  assert.deepEqual(gate.steps[1].env, { CLASS: '${{ needs.changes.outputs.class }}' });
});

test('e2e-tests passes when the suite succeeded', () => {
  assert.equal(e2eGate({}).status, 0);
  assert.equal(e2eGate({ SKIP: 'true', RESULT: 'success' }).status, 0, 'a suite that ran and passed is a pass whatever the classifier said');
});

test('the verdict keeps the contract that e2e/scripts/cache-primer.test.mjs pins: given only the result of the suite, it accepts a successful one and nothing else', () => {
  const [verdict] = jobOf('pr.yml', 'e2e-tests').steps;
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '', 'unavailable']) assert.equal(runStep(verdict, { RESULT: result }).status === 0, result === 'success', result);
});

for (const result of ['failure', 'cancelled', 'skipped', '', 'startup_failure']) {
  test(`NEGATIVE: e2e-tests fails when the suite finished as ${result === '' ? 'nothing at all' : result} and the classifier did not skip it`, () => {
    for (const skip of ['false', '', 'yes', 'TRUE']) {
      const outcome = e2eGate({ SKIP: skip, RESULT: result });
      assert.equal(outcome.status, 1, `${skip}: ${outcome.output}`);
      assert.match(outcome.output, /^::error::/m);
    }
  });
}

test('e2e-tests passes when the classifier skipped the suite and it was skipped, and the step after it says why', () => {
  const [, message] = jobOf('pr.yml', 'e2e-tests').steps;
  for (const klass of ['docs', 'new-ui']) {
    assert.equal(e2eGate({ SKIP: 'true', RESULT: 'skipped' }).status, 0, klass);
    const said = runStep(message, { CLASS: klass });
    assert.equal(said.status, 0, said.output);
    assert.match(said.output, new RegExp(`e2e skipped by path: ${klass}`));
    assert.match(said.summary, new RegExp(`skipped by path: ${klass}`));
  }
});

test('NEGATIVE: a skip by path hides nothing else: e2e-tests fails when a suite that was meant to be skipped ran and failed or was cancelled', () => {
  for (const result of ['failure', 'cancelled', 'startup_failure']) {
    const outcome = e2eGate({ SKIP: 'true', RESULT: result });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, new RegExp(`^::error::e2e-application finished as ${result} `, 'm'));
  }
});

test('NEGATIVE: e2e-tests fails when the classifier did not succeed and the suite was skipped: a skip then proves nothing', () => {
  for (const changes of ['failure', 'cancelled', 'skipped', '']) {
    for (const env of [{ SKIP: 'true', RESULT: 'skipped' }, { SKIP: '', RESULT: 'skipped' }]) {
      const outcome = e2eGate({ CHANGES: changes, ...env });
      assert.equal(outcome.status, 1, `${changes} ${JSON.stringify(env)}: ${outcome.output}`);
      assert.match(outcome.output, /^::error::e2e-application finished as skipped \(the changed-path classification: (failure|cancelled|skipped|unknown),/m);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The seam workflow names the scenario that failed (.github/workflows/ui-next-seam.yml, the step "The seam")
//
// A failed run of the seam is annotated with the id of the last marker (`// <id>.` or ` * <id>.` in a doc comment) above the line of the failing scenario function, and the function. The step's own awk program is run here, over
// the check and over a small file: until O1b-2 it knew the letters a to n, so scenario o (`checkToasts`) was reported as the last marker before it, `i`, and a scenario with a digit (h2) could not be named at all.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const SEAM_WORKFLOW = parse(readFileSync(path.join(repo, '.github/workflows/ui-next-seam.yml'), 'utf8'));
const SEAM_CHECK = path.join(repo, 'ui-next/plugins/e2e/seam.check.mjs');
const SEAM_STEP = Object.values(SEAM_WORKFLOW.jobs).flatMap((job) => job.steps ?? []).find((step) => typeof step.name === 'string' && step.name.startsWith('The seam ('));
/** The program of the step, as it is written in it. */
const LABEL_PROGRAM = /letter="\$\(awk -v n="\$line" '([^']+)' "\$check"\)"/.exec(SEAM_STEP?.run ?? '')?.[1];
/** The program the step had before O1b-2: the letters a to n, one character. */
const LETTERS_A_TO_N = String.raw`NR > n { exit } match($0, /^[ ]*(\/\/|\*|\/\*\*) [a-n]\. [A-Za-z]/) { s = $0; sub(/^[ ]*(\/\/|\*|\/\*\*) /, "", s); l = substr(s, 1, 1) } END { print l }`;

/** What a program names for a failure at `line` of `file`. */
function labelAt(program, file, line) {
  const ran = spawnSync('awk', ['-v', `n=${String(line)}`, program, file], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

/** A small check of the shape the real one has: doc comments with a marker, scenario functions after them, and one line of work in each (`await <id>;`). */
function sampleCheck() {
  const dir = mkdtempSync(path.join(tmpdir(), 'seam-label-'));
  roots.push(dir);
  const file = path.join(dir, 'seam.check.mjs');
  const scenarios = ['a', 'n', 'o', 'h2', 'q', 'z'];
  const lines = ['// the header of the check', ''];
  for (const id of scenarios) {
    lines.push('/**', ` * ${id}. the scenario ${id}, in a page of its own.`, ' */', `async function check${id.toUpperCase()}(page) {`, `  await ${id};`, '}', '');
  }

  writeFileSync(file, `${lines.join('\n')}\n`);
  return { file, at: (id) => lines.indexOf(`  await ${id};`) + 1 };
}

test('the seam workflow has a step that names the scenario, with the program that reads the check', () => {
  assert.ok(SEAM_STEP, 'the step "The seam (<engine>)" is in a job of ui-next-seam.yml');
  assert.ok(LABEL_PROGRAM, 'the step has `letter="$(awk -v n="$line" \'<program>\' "$check")"`');
});

test('a scenario is named by the id of its own marker: a letter past n, and a letter with a digit', () => {
  const sample = sampleCheck();
  for (const id of ['a', 'n', 'o', 'h2', 'q', 'z']) assert.equal(labelAt(LABEL_PROGRAM, sample.file, sample.at(id)), id, `a failure inside scenario ${id}`);
});

test('NEGATIVE: the program the step had named scenario o as the marker before it, and h2 as nothing of its own: the case this test is for', () => {
  const sample = sampleCheck();
  assert.equal(labelAt(LETTERS_A_TO_N, sample.file, sample.at('o')), 'n', 'the old program stops at n: o was reported as n (as `checkToasts` was reported as i)');
  assert.equal(labelAt(LETTERS_A_TO_N, sample.file, sample.at('h2')), 'n', 'and a marker with a digit was not a marker at all');
  assert.notEqual(labelAt(LETTERS_A_TO_N, sample.file, sample.at('o')), labelAt(LABEL_PROGRAM, sample.file, sample.at('o')));
});

test('every scenario function of the seam check is named by the marker of its own doc comment, whatever the letter', () => {
  const lines = readFileSync(SEAM_CHECK, 'utf8').split('\n');
  const found = [];
  const wrong = [];
  for (const [index, text] of lines.entries()) {
    if (!/^async function check[A-Z]\w*\(/.test(text) || lines[index - 1]?.trim() !== '*/') continue;
    // The doc block above the function, and the first marker in it.
    let start = index - 1;
    while (start > 0 && /^\s*(\/\*\*|\*)/.test(lines[start - 1] ?? '')) start -= 1;
    const marker = lines.slice(start, index).map((line) => /^\s*\*\s+([a-z][0-9]*)\.\s+[A-Za-z]/.exec(line)?.[1]).find((id) => id !== undefined);
    if (marker === undefined) continue;
    found.push(marker);
    const named = labelAt(LABEL_PROGRAM, SEAM_CHECK, index + 2);
    if (named !== marker) wrong.push(`${text.slice(0, 40)} (line ${String(index + 1)}): the doc comment says ${marker}, the step says ${named}`);
  }

  assert.deepEqual(wrong, []);
  assert.ok(found.length >= 10, `the scenario functions with a marker: ${found.join(', ')}`);
  assert.ok(found.some((id) => id > 'n' && id.length === 1), `a scenario past n is in the check: ${found.join(', ')}`);
  assert.ok(found.some((id) => /\d/.test(id)), `a scenario with a digit is in the check: ${found.join(', ')}`);
});

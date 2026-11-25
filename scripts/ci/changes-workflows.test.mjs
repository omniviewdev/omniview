// The two workflows that read the path classifier (.github/workflows/pr.yml, pr-checks.yml): which job reads which flag, the repository guard that runs on every pull request, and the two gates
// (`UI checks`, `e2e-tests`) that stay green when the classifier skipped their parts and red in every other case.
//
// The classifier itself is tested in changes.test.mjs, which needs no installed dependency and runs in the repository guard. This file reads the workflows with `yaml`, so it runs where the
// dependencies are installed (the job `UI lint and kit contracts`). Every "negative control" feeds the gate or the table the mistake it exists for; each was also seen to go red with the
// rule it names taken out (docs/ui-next/status/N24-D1.md).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { ALWAYS, GATED } from './changes.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const WORKFLOWS = { 'pr.yml': '.github/workflows/pr.yml', 'pr-checks.yml': '.github/workflows/pr-checks.yml' };
// The path classifier and its table belong to PR Checks; pr.yml is the nightly workflow (N34).
const TABLE_FILES = ['pr-checks.yml'];
const text = Object.fromEntries(Object.entries(WORKFLOWS).map(([name, file]) => [name, readFileSync(path.join(repo, file), 'utf8')]));
const workflow = Object.fromEntries(Object.entries(text).map(([name, source]) => [name, parse(source)]));

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const jobOf = (file, id) => workflow[file].jobs[id];
const stepsOf = (file, id) => jobOf(file, id).steps ?? [];
const needsOf = (job) => (Array.isArray(job.needs) ? job.needs : job.needs === undefined ? [] : [job.needs]);
const SKIP = { host: "${{ needs.changes.outputs.skip_host != 'true' }}", ui: "${{ needs.changes.outputs.skip_ui != 'true' }}", code: "${{ needs.changes.outputs.skip_code != 'true' }}" };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The table and the workflows agree
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('every job of PR Checks is either gated by a flag of the table or one of the jobs that always run: none is left to chance', () => {
  for (const file of TABLE_FILES) {
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
});

test('NEGATIVE: no job runs only when a flag says "run": the classifier writes skip flags, and `== \'true\'` on one would skip a job whose flag is missing', () => {
  for (const file of Object.keys(WORKFLOWS)) {
    for (const [id, job] of Object.entries(workflow[file].jobs)) {
      const conditions = [job.if, ...(job.steps ?? []).map((step) => step.if)].filter((value) => typeof value === 'string');
      for (const condition of conditions) {
        if (!/needs\.changes\.outputs/.test(condition)) continue;
        assert.match(condition, /needs\.changes\.outputs\.skip_(host|ui|code) != 'true'/, `${file}: ${id}: ${condition}`);
        assert.doesNotMatch(condition, /==/, `${file}: ${id}: ${condition}`);
        assert.doesNotMatch(condition, /outputs\.class/, `${file}: ${id}: a job is gated by a flag, never by the name of a class`);
      }
    }
  }
});

test('the classifier job: a checkout of two commits, the pinned Node, the script, and four outputs, the class and three skip flags', () => {
  const one = jobOf('pr-checks.yml', 'changes');
  assert.equal(one.name, 'Changed paths');
  assert.equal(one['runs-on'], 'ubuntu-slim', 'the smallest runner: the job reads two commits and runs one script (N30)');
  assert.equal(one['timeout-minutes'], 5);
  assert.equal(one.needs, undefined);
  assert.equal(one.if, undefined, 'the classifier runs on every pull request');
  assert.deepEqual(Object.keys(one.outputs).sort(), ['class', 'skip_code', 'skip_host', 'skip_ui']);
  for (const name of ['class', 'skip_code', 'skip_host', 'skip_ui']) assert.equal(one.outputs[name], `\${{ steps.classify.outputs.${name} }}`);
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

test('the workflow tests run where the dependencies are installed, before the packages are built: in the job that builds and lints', () => {
  const commands = stepsOf('pr-checks.yml', 'ui-build').map((step) => step.run ?? '');
  const at = commands.findIndex((command) => /node --test scripts\/ci\/\*\.test\.mjs/.test(command));
  assert.ok(at > 0, 'a step runs them');
  assert.ok(at < commands.findIndex((command) => /task packages/.test(command)), 'before the packages are built');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What the other jobs keep
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// The Windows build is not a job of a pull request (N31): main-windows.yml builds it at night and on request.
test('the Windows build runs at night and on request, on Windows, and is not a job of a pull request', () => {
  const windows = parse(readFileSync(path.join(repo, '.github/workflows/main-windows.yml'), 'utf8'));
  assert.equal(workflow['pr.yml'].jobs['build-artifacts-windows'], undefined);
  assert.deepEqual(Object.keys(windows.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.equal(windows.concurrency['cancel-in-progress'], false);
  const job = windows.jobs['build-windows'];
  assert.deepEqual([job.name, job['runs-on'], job['timeout-minutes'], job.container], ['build-artifacts (windows/amd64)', 'windows-latest', 30, undefined]);
  assert.match(job.steps.find((step) => step.name === 'Build Omniview').run, /-ldflags "-w -s -H windowsgui /);
});

test('the checks that start for the new UI\'s own tooling are the ones that read it: the Pods check for its scripts; the kit probes do not start on a pull request at all (N34, the owner\'s order)', () => {
  const on = (file) => parse(readFileSync(path.join(repo, `.github/workflows/${file}`), 'utf8')).on;
  assert.equal(on('ui-next-pods.yml').pull_request, undefined, 'the Pods cluster check is a nightly check (N34)');
  assert.equal(on('ui-next-kit-probes.yml').pull_request, undefined, 'no probe job, plan or aggregate is on a pull request');
  assert.equal(on('ui-next-kit-probes.yml').push, undefined, 'and none on a push to main');
  // and the UI jobs, which read the rest of the tooling (scripts/ui-next-bundle.mjs, bench/table, bench/log), are not skipped for the new UI
  assert.deepEqual(GATED.filter((entry) => entry.flag === 'ui').map((entry) => entry.job).filter((job) => !needsOf(jobOf('pr-checks.yml', job)).includes('changes')), []);
});

test('N34: nothing waits on a probe result: no workflow lists the kit probes in a `needs`, a `workflow_run` or a gate, and the nightly run stays in the list of `ci-main-red`', () => {
  const directory = path.join(repo, '.github/workflows');
  for (const file of readdirSync(directory).filter((name) => /\.ya?ml$/.test(name) && name !== 'ui-next-kit-probes.yml' && name !== 'ci-main-red.yml')) {
    const text = readFileSync(path.join(directory, file), 'utf8');
    const workflow = parse(text);
    assert.equal(/Kit probes|ui-next-kit-probes/.test(JSON.stringify(workflow.on ?? {})), false, `${file}: a trigger names the probes`);
    for (const [id, job] of Object.entries(workflow.jobs ?? {})) assert.equal(/kit-probes|Kit probes/i.test(JSON.stringify(job.needs ?? [])), false, `${file}: ${id} needs the probes`);
    assert.equal(/needs\.[a-z-]*probe/i.test(text), false, `${file} reads a probe job's result`);
  }
  assert.ok(parse(readFileSync(path.join(directory, 'ci-main-red.yml'), 'utf8')).on.workflow_run.workflows.includes('UI next kit probes'), 'the nightly probes stay in the list');
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
const UI_PARTS = GATED.filter((entry) => (entry.flag === 'ui' || entry.flag === 'code') && entry.workflow === 'pr-checks.yml').map((entry) => entry.job);

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
    const outcome = uiGate({ skip: 'true', klass: 'docs', parts: { ...allSkipped, 'ui-build': result } });
    assert.equal(outcome.status, 1, outcome.output);
    assert.match(outcome.output, new RegExp(`^::error::ui-build finished as ${result}$`, 'm'));
    assert.doesNotMatch(outcome.output, /::error::c02-corpus/);
  }
  const ran = uiGate({ skip: 'true', klass: 'docs', parts: { ...allSkipped, 'ui-build': 'success' } });
  assert.equal(ran.status, 0, 'a part that ran and succeeded is a success whatever the classifier said');
  assert.match(ran.summary, /\| ui-build \| success \|/);
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The merged jobs (N31): seven jobs where there were thirteen, and every check of the six that were merged still runs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const commandsOf = (id) => stepsOf('pr-checks.yml', id).map((step) => `${step.run ?? ''}\n${step.uses ?? ''}`).join('\n');

test('N34: PR Checks is eight jobs and runs what the IDE needs (build, vet, tests, bindings, lint, type-check, component tests, the contracts); the old jobs\' checks are not gone, they are here or in the nightly workflow', () => {
  assert.deepEqual(Object.keys(workflow['pr-checks.yml'].jobs), ['changes', 'repo-guard', 'go-checks', 'go-lint', 'c02-corpus', 'ui-build', 'ui-test', 'ui-checks']);
  const mustRun = {
    'go-checks': ['scripts/go-test-failures.test.mjs', 'task check:fmt-check', 'task check:go-build', 'task check:go-vet', 'task check:go-test GO_BUILD', 'task check:go-test-devcontrol', 'scripts/install-wails-cli.sh', 'task check:bindings-check', 'scripts/wails-tool.test.mjs'],
    'go-lint': ['git worktree add --detach', 'golangci/golangci-lint-action@v9'],
    // the C02 corpus and the UI runtime contract
    'c02-corpus': ['task check:c02-corpus', 'task check:c02-runtime', 'scripts/wails-call.test.mjs', 'scripts/vitest-failures.test.mjs', 'vitest/vitest.mjs run --configLoader runner', 'scripts/vitest-failures.mjs "Runtime contract='],
    // UI build, UI lint and kit contracts
    'ui-build': ['scripts/react-compiler.test.mjs', 'task check:ui-build', 'scripts/ui-flavour.test.mjs', 'node --test scripts/ci/*.test.mjs', 'task packages', 'task check:ui-typecheck', 'task check:ui-lint', '@omniviewdev/kit run generate:check', '@omniviewdev/kit run test', '@omniviewdev/kit run api:check', '@omniviewdev/runtime run api:check'],
    // UI component tests
    'ui-test': ['task packages', 'ui/utils/ageClock.test.tsx', 'pnpm test --reporter', 'scripts/vitest-failures.mjs "Component tests='],
  };
  for (const [id, commands] of Object.entries(mustRun)) for (const command of commands) assert.ok(commandsOf(id).includes(command), `${id} lost: ${command}`);
  // What left the pull request is in the nightly workflow, whole.
  const nightly = (id) => stepsOf('pr.yml', id).map((step) => `${step.run ?? ''}\n${step.uses ?? ''}`).join('\n');
  for (const command of ['build/homebrew/update-cask.test.mjs', 'bash -n build/darwin/build-universal.sh', 'bash -n build/darwin/verify-release-package.sh']) assert.ok(nightly('release-contracts').includes(command), `release-contracts lost: ${command}`);
  for (const command of ['Test released-SDK connection profiles', 'go test']) assert.ok(JSON.stringify(stepsOf('pr.yml', 'windows-connection-profiles')).includes(command), `windows-connection-profiles lost: ${command}`);
  for (const id of ['go-checks', 'go-lint', 'c02-corpus', 'ui-build', 'ui-test']) assert.equal(/homebrew|build-universal/.test(commandsOf(id)), false, `${id} still runs a release contract`);
});

test('N31: a group that comes after another in a merged job runs whatever happened before it (`!cancelled()`), so that one push shows every failing group as separate jobs did, and a cancelled job runs nothing more', () => {
  // The exact condition of each step after the first group; the exceptions are named: the steps that name failures (`failure()` and `always()`: diagnostics), the lint (it needs its source), the package build (it has nothing to do after the build step made them).
  const EXCEPTIONS = {
    'go-checks: Name the failed Go tests in the job summary': 'failure()',
    'ui-build: Build the workspace packages': "${{ !cancelled() && steps.frontend-build.outcome != 'success' }}",
    'ui-test: Name the failed vitest tests in the job summary': 'always()',
    'go-lint: Lint': "${{ !cancelled() && steps.lint-source.outcome == 'success' }}",
  };
  for (const [id, first] of [['go-checks', 'Install pinned private Wails CLI'], ['ui-build', 'Test the CI scripts'], ['ui-test', 'Component tests']]) {
    const steps = stepsOf('pr-checks.yml', id);
    const at = steps.findIndex((step) => step.name === first);
    assert.ok(at > 0, `${id}: ${first}`);
    for (const step of steps.slice(at)) {
      const want = EXCEPTIONS[`${id}: ${step.name}`] ?? '${{ !cancelled() }}';
      assert.equal(step.if, want, `${id}: the condition of "${step.name}"`);
    }
  }

  const build = stepsOf('pr-checks.yml', 'ui-build').find((step) => step.name === 'Build');
  assert.equal(build.id, 'frontend-build', 'the package build after it reads the outcome of this step');

  const lint = stepsOf('pr-checks.yml', 'go-lint').find((step) => step.name === 'Lint');
  assert.match(lint.if, /steps\.lint-source\.outcome == 'success'/, 'the lint reads its source: it does not run on a checkout that was not made');
  for (const id of ['go-checks', 'go-lint', 'c02-corpus', 'ui-build', 'ui-test']) assert.equal(jobOf('pr-checks.yml', id)['continue-on-error'], undefined, id);
  assert.ok(jobOf('pr-checks.yml', 'go-checks')['timeout-minutes'] >= 20 && jobOf('pr-checks.yml', 'ui-build')['timeout-minutes'] >= 20, 'a merged job is the sum of the jobs it replaced');
});

test('N34: a pull request runs PR Checks and nothing of the nightly workflow: no e2e, no Linux build, no Windows tests, no release contracts, and the nightly workflow is not triggered by a pull request', () => {
  assert.deepEqual(Object.keys(workflow['pr.yml'].on).sort(), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(Object.keys(workflow['pr-checks.yml'].on), ['pull_request']);
  assert.deepEqual(Object.keys(workflow['pr.yml'].jobs), ['windows-connection-profiles', 'release-contracts', 'cache-primer-go', 'cache-primer-ui', 'e2e-application', 'e2e-tests', 'build-artifacts']);
  assert.equal(Object.hasOwn(workflow['pr.yml'].jobs, 'build-artifacts-windows'), false);
  assert.equal(Object.keys(workflow['pr-checks.yml'].jobs).length, 8, 'the most a pull request runs: the classifier, the guard, Go (build and tests, lint), the corpus, the UI (build, tests) and the gate');
  assert.equal(workflow['pr.yml'].concurrency['cancel-in-progress'], false);
});

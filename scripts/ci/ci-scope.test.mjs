// The scope of a run (scripts/ci/ci-scope.mjs): which runs are full, which are a pull request's, and that nothing it cannot read or classify is a pull request's.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { INFRASTRUCTURE, changedFiles, infrastructureIn, main, printable, scopeOf } from './ci-scope.mjs';

const pr = (files, extra = {}) => scopeOf({ event: 'pull_request', files, ...extra });

test('main, the nightly run and a manual run are full; a manual run can ask for the pull request scope, to show what it does not catch', () => {
  assert.equal(scopeOf({ event: 'push' }).scope, 'full');
  assert.equal(scopeOf({ event: 'schedule' }).scope, 'full');
  assert.equal(scopeOf({ event: 'workflow_dispatch' }).scope, 'full');
  assert.equal(scopeOf({ event: 'workflow_dispatch', input: 'full' }).scope, 'full');
  assert.equal(scopeOf({ event: 'workflow_dispatch', input: 'pr' }).scope, 'pr');
  assert.match(scopeOf({ event: 'push' }).reason, /push to main/);
});

test('a pull request that changes none of the test infrastructure gets the pull request scope', () => {
  const result = pr(['ui-next/shell/Rail.tsx', 'packages/kit/src/Chip/Chip.tsx', 'backend/pkg/plugin/x.go', 'docs/ui-next/AGENTS.md']);
  assert.equal(result.scope, 'pr');
  assert.match(result.reason, /4 changed files, none of them test infrastructure/);
  assert.match(pr(['a.go']).reason, /1 changed file, none/);
});

test('a change to the test infrastructure is a full run, naming the file: the CI scripts, a workflow, the seam, its fixtures, an end-to-end check, a probe, a control, a harness', () => {
  for (const file of [
    'scripts/ci/probe-units/panel.mjs',
    'scripts/ci/seam-units.mjs',
    'scripts/ci/changes.mjs',
    '.github/workflows/ui-next-seam.yml',
    '.github/ci/image.lock',
    'ui-next/plugins/e2e/seam.check.mjs',
    'ui-next/plugins/fixture/build.mjs',
    'ui-next/shell/e2e/something.mjs',
    'ui-next/page/e2e/x/y.mjs',
    'packages/kit/probes/kit-probe.mjs',
    'packages/kit/probes/mock-reference.json',
    'ui-next/shell/probes/harness.mjs',
    'ui-next/shell/probes/palette-probe.mjs',
    'ui-next/page/probes/lib.mjs',
    'ui-next/x/probes/y.mjs',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package.json',
    'go.mod',
    'go.sum',
    'go.work',
    '.tool-versions',
    'Taskfile.yml',
    'build/Taskfile.yml',
    'packages/kit/Taskfile.yaml',
  ]) {
    const result = pr(['ui-next/shell/Rail.tsx', file]);
    assert.equal(result.scope, 'full', file);
    assert.ok(result.reason.startsWith(file), result.reason);
  }
});

test('NEGATIVE: a path that only looks like test infrastructure is not: a name that contains the words, a docs file about them', () => {
  for (const file of ['scripts/ci-notes.md', 'scripts/cinema/x.mjs', 'docs/ui-next/probes.md', 'ui-next/shell/Probes.tsx', 'ui-next/plugins/e2e-notes.md', 'github/workflows/x.yml', 'packages/kit/src/probes-list.ts', 'packages/kit/package.json', 'go.mod.bak', 'docs/go.mod', 'Taskfile.yml.bak', 'docs/MyTaskfile.yml']) {
    assert.equal(infrastructureIn([file]), null, file);
  }
});

test('FAIL CLOSED: a diff that cannot be read, an empty diff and an event that is not known are full runs', () => {
  assert.deepEqual([pr(null).scope, pr(null).reason], ['full', 'the changed files could not be read']);
  assert.deepEqual([pr([]).scope, pr([]).reason], ['full', 'the diff is empty']);
  assert.equal(scopeOf({ event: 'issue_comment' }).scope, 'full');
  assert.equal(scopeOf({ event: '' }).scope, 'full');
  assert.equal(scopeOf({ event: 'pull_request' }).scope, 'full', 'no files at all is an unreadable diff');
});

test('a label does not change the scope: ci:full is not a way in (a manual run is), and an injected name cannot write a log line', () => {
  assert.equal(pr(['ui-next/a.tsx'], { labels: ['ci:full'] }).scope, 'pr');
  const name = 'scripts/ci/x\n::warning title=forged::injected\r\u001b[31m';
  const result = pr(['ui-next/a.tsx', name]);
  assert.equal(result.scope, 'full');
  assert.equal(/[\n\r\u001b]/.test(result.reason), false, JSON.stringify(result.reason));
  assert.ok(result.reason.startsWith('scripts/ci/x?::warning title=forged::injected??[31m changes'), result.reason);
  assert.equal(printable('a\nb\rc\td'), 'a?b?c?d');
  assert.equal(printable('plain/é/名.mjs'), 'plain/é/名.mjs');
});

test('every pattern of the list says what it is, and the first match is the one named', () => {
  assert.ok(INFRASTRUCTURE.length >= 6);
  for (const [pattern, what] of INFRASTRUCTURE) {
    assert.ok(pattern instanceof RegExp);
    assert.ok(typeof what === 'string' && what.length > 5);
  }

  assert.deepEqual(infrastructureIn(['a.ts', 'scripts/ci/x.mjs', '.github/y']), { file: 'scripts/ci/x.mjs', what: 'the CI scripts (the probe and seam tables, plans and tests)' });
});

test('changedFiles reads git\'s NUL-separated names, and says null when git fails or is not there', () => {
  const ok = (stdout) => () => ({ status: 0, stdout, error: undefined });
  assert.deepEqual(changedFiles('HEAD^1', ok('a/b.ts\0c d.go\0\0')), ['a/b.ts', 'c d.go']);
  assert.deepEqual(changedFiles('HEAD^1', ok('')), []);
  assert.equal(changedFiles('HEAD^1', () => ({ status: 128, stdout: '', error: undefined })), null);
  assert.equal(changedFiles('HEAD^1', () => ({ status: null, stdout: null, error: new Error('no git') })), null);
  let seen;
  changedFiles('abc', (command, args) => { seen = [command, ...args]; return { status: 0, stdout: '' }; });
  assert.deepEqual(seen, ['git', 'diff', '--name-only', '--no-renames', '-z', 'abc', 'HEAD']);
});

test('main writes the scope and the reason where the workflow reads them, and the summary says what each scope is', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-scope-'));
  const output = path.join(dir, 'out');
  const summary = path.join(dir, 'sum');
  let text = '';
  const ran = (stdout) => () => ({ status: 0, stdout });
  assert.equal(await main([], { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, out: (chunk) => { text += chunk; }, run: ran('ui-next/a.tsx\0') }), 0);
  assert.equal(readFileSync(output, 'utf8'), 'scope=pr\nreason=1 changed file, none of them test infrastructure\nfull_units=\n');
  assert.match(readFileSync(summary, 'utf8'), /Scope of this run: pr\n\nWebKit, no negative controls/);
  assert.match(text, /ci-scope: pr/);
  const injected = path.join(dir, 'out2');
  const summaryTwo = path.join(dir, 'sum2');
  let log = '';
  assert.equal(await main([], { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: injected, GITHUB_STEP_SUMMARY: summaryTwo }, out: (chunk) => { log += chunk; }, run: ran('scripts/ci/x\n::warning title=forged::y\0') }), 0);
  assert.equal(log.split('\n').some((line) => line.startsWith('::')), false, 'no line of the log is a workflow command');
  assert.equal(readFileSync(summaryTwo, 'utf8').split('\n').some((line) => line.startsWith('::')), false);
  assert.match(readFileSync(injected, 'utf8'), /^scope=full\nreason=scripts\/ci\/x\?::warning title=forged::y changes /);
  const broken = path.join(dir, 'out3');
  assert.equal(await main([], { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: broken }, out: () => {}, run: () => ({ status: 1, stdout: '' }) }), 0);
  assert.match(readFileSync(broken, 'utf8'), /^scope=full\nreason=the changed files could not be read\nfull_units=\n$/);
  let err = '';
  assert.equal(await main(['--nope'], { env: {}, err: (chunk) => { err += chunk; } }), 2);
  assert.match(err, /usage: node scripts\/ci\/ci-scope\.mjs/);
  assert.equal(await main([], { env: { GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: path.join(dir, 'no-such-dir/out') }, out: () => {}, err: () => {} }), 1, 'an output that cannot be written is an error');
});

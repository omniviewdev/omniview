// The scope of a run (scripts/ci/ci-scope.mjs): which runs are full, which are a pull request's, and that nothing it cannot read or classify is a pull request's.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { INFRASTRUCTURE, changedFiles, infrastructureIn, main, scopeOf } from './ci-scope.mjs';

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
  const result = pr(['ui-next/shell/Rail.tsx', 'packages/kit/src/Chip/Chip.tsx', 'backend/pkg/plugin/x.go', 'docs/ui-next/status/N30.md']);
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
  ]) {
    const result = pr(['ui-next/shell/Rail.tsx', file]);
    assert.equal(result.scope, 'full', file);
    assert.ok(result.reason.startsWith(file), result.reason);
  }
});

test('NEGATIVE: a path that only looks like test infrastructure is not: a name that contains the words, a docs file about them', () => {
  for (const file of ['scripts/ci-notes.md', 'scripts/cinema/x.mjs', 'docs/ui-next/status/probes.md', 'ui-next/shell/Probes.tsx', 'ui-next/plugins/e2e-notes.md', 'github/workflows/x.yml', 'packages/kit/src/probes-list.ts']) {
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

test('the label ci:full makes a pull request a full run', () => {
  assert.equal(pr(['ui-next/a.tsx'], { labels: ['ci:full'] }).scope, 'full');
  assert.match(pr(['ui-next/a.tsx'], { labels: ['x', 'ci:full'] }).reason, /ci:full/);
  assert.equal(pr(['ui-next/a.tsx'], { labels: ['ci:bench'] }).scope, 'pr');
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

test('main writes the scope and the reason where the workflow reads them, and the summary says what each scope is', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-scope-'));
  const output = path.join(dir, 'out');
  const summary = path.join(dir, 'sum');
  let text = '';
  const ran = (stdout) => () => ({ status: 0, stdout });
  assert.equal(main([], { env: { GITHUB_EVENT_NAME: 'pull_request', PR_LABELS: '[]', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, out: (chunk) => { text += chunk; }, run: ran('ui-next/a.tsx\0') }), 0);
  assert.equal(readFileSync(output, 'utf8'), 'scope=pr\nreason=1 changed file, none of them test infrastructure\n');
  assert.match(readFileSync(summary, 'utf8'), /Scope of this run: pr\n\nWebKit, no negative controls/);
  assert.match(text, /ci-scope: pr/);
  const full = path.join(dir, 'out2');
  assert.equal(main([], { env: { GITHUB_EVENT_NAME: 'pull_request', PR_LABELS: '["ci:full"]', GITHUB_OUTPUT: full }, out: () => {}, run: ran('ui-next/a.tsx\0') }), 0);
  assert.match(readFileSync(full, 'utf8'), /^scope=full\nreason=the label ci:full\n$/);
  const broken = path.join(dir, 'out3');
  assert.equal(main([], { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: broken }, out: () => {}, run: () => ({ status: 1, stdout: '' }) }), 0);
  assert.match(readFileSync(broken, 'utf8'), /^scope=full\nreason=the changed files could not be read\n$/);
  let err = '';
  assert.equal(main(['--nope'], { env: {}, err: (chunk) => { err += chunk; } }), 2);
  assert.match(err, /usage: node scripts\/ci\/ci-scope\.mjs/);
  assert.equal(main([], { env: { GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: path.join(dir, 'no-such-dir/out') }, out: () => {}, err: () => {} }), 1, 'an output that cannot be written is an error');
});

test('PR_LABELS that is not a list is no label, and a label that is not a string is ignored: the label can only add scope', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-scope-labels-'));
  for (const labels of ['not json', '{"a":1}', 'null', '[1,2]']) {
    const output = path.join(dir, `o${labels.length}`);
    main([], { env: { GITHUB_EVENT_NAME: 'pull_request', PR_LABELS: labels, GITHUB_OUTPUT: output }, out: () => {}, run: () => ({ status: 0, stdout: 'ui-next/a.tsx\0' }) });
    assert.match(readFileSync(output, 'utf8'), /^scope=pr\n/, labels);
  }
});

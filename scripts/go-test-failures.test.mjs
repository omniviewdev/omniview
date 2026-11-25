// The failed-test summary (scripts/go-test-failures.mjs): fed `go test -json` streams of the shapes CI has produced (a failed assertion, a panic that killed the test binary,
// a package that did not build) and the command itself, which must print nothing when nothing failed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { failures, render, renderSkips } from './go-test-failures.mjs';

const script = fileURLToPath(new URL('./go-test-failures.mjs', import.meta.url));
const PKG = 'github.com/omniviewdev/omniview/internal/example';

const event = (Action, extra = {}) => JSON.stringify({ Time: '2026-11-19T21:43:08Z', Action, Package: PKG, ...extra });
const out = (Test, Output) => event('output', { Test, Output: `${Output}\n` });
const stream = (...events) => events.join('\n');

test('a stream with no failure says nothing', () => {
  const text = stream(event('run', { Test: 'TestA' }), out('TestA', '=== RUN   TestA'), event('pass', { Test: 'TestA' }), event('pass'));
  assert.equal(render(failures(text)), '');
});

test('a failed test is named with its package and what it printed, without the framework lines', () => {
  const text = stream(
    event('run', { Test: 'TestShutdown' }),
    out('TestShutdown', '=== RUN   TestShutdown'),
    out('TestShutdown', '    provider_test.go:264: shutdown did not cancel query'),
    out('TestShutdown', '--- FAIL: TestShutdown (0.00s)'),
    event('fail', { Test: 'TestShutdown' }),
    event('fail'),
  );
  const markdown = render(failures(text), '1');
  assert.match(markdown, /^### Go tests failed \(run attempt 1\)/);
  assert.match(markdown, /- `internal\/example` \*\*TestShutdown\*\*/);
  assert.match(markdown, /provider_test\.go:264: shutdown did not cancel query/);
  assert.doesNotMatch(markdown, /=== RUN|--- FAIL/);
  assert.match(markdown, /flake/);
});

test('a parent test is not listed beside its failed subtest', () => {
  const text = stream(
    event('run', { Test: 'TestTable' }),
    event('run', { Test: 'TestTable/ok' }),
    event('pass', { Test: 'TestTable/ok' }),
    event('run', { Test: 'TestTable/bad' }),
    out('TestTable/bad', '    table_test.go:9: wrong'),
    event('fail', { Test: 'TestTable/bad' }),
    event('fail', { Test: 'TestTable' }),
    event('fail'),
  );
  const { failed } = failures(text);
  assert.deepEqual(failed.map((test) => test.test), ['TestTable/bad']);
});

test('a panic that killed the binary names the test that printed it, not the tests that were only waiting', () => {
  const text = stream(
    event('run', { Test: 'TestWaiting' }),
    event('pause', { Test: 'TestWaiting' }),
    event('run', { Test: 'TestBoom' }),
    out('TestBoom', 'panic: runtime error: invalid memory address or nil pointer dereference'),
    out('TestBoom', 'goroutine 7 [running]:'),
    event('fail'),
  );
  const markdown = render(failures(text));
  assert.match(markdown, /\*\*TestBoom\*\* \(the test binary died while it ran\)/);
  assert.match(markdown, /panic: runtime error/);
  assert.doesNotMatch(markdown, /TestWaiting/);
});

test('a package that died with no panic text lists the tests that never finished', () => {
  const text = stream(event('run', { Test: 'TestStuck' }), out('TestStuck', '=== RUN   TestStuck'), event('fail'));
  assert.match(render(failures(text)), /\*\*TestStuck\*\* \(the test binary died while it ran\)/);
});

test('a package that did not build is named with the compiler output', () => {
  const text = stream(
    JSON.stringify({ ImportPath: `${PKG} [${PKG}.test]`, Action: 'build-output', Output: 'example_test.go:3:2: undefined: nope\n' }),
    JSON.stringify({ ImportPath: `${PKG} [${PKG}.test]`, Action: 'build-fail' }),
    event('fail', { FailedBuild: `${PKG} [${PKG}.test]` }),
  );
  const markdown = render(failures(text));
  assert.match(markdown, /`internal\/example` failed without a failed test/);
  assert.match(markdown, /undefined: nope/);
});

test('lines that are not JSON are ignored and long output is bounded', () => {
  const rows = Array.from({ length: 40 }, (_, i) => out('TestLong', `    line ${i} ${'x'.repeat(400)}`));
  const text = stream('plain text from the task runner', ...rows, event('fail', { Test: 'TestLong' }), event('fail'));
  const markdown = render(failures(text));
  assert.match(markdown, /line 0 /);
  assert.doesNotMatch(markdown, /line 11 /);
  assert.ok(markdown.split('\n').every((row) => row.length < 400));
});

test('a parent that said something of its own is listed beside its failed subtest', () => {
  const text = stream(
    event('run', { Test: 'TestTable' }),
    event('run', { Test: 'TestTable/bad' }),
    out('TestTable/bad', '    table_test.go:9: wrong'),
    event('fail', { Test: 'TestTable/bad' }),
    out('TestTable', '    --- FAIL: TestTable/bad (0.00s)'),
    out('TestTable', '    table_test.go:20: cleanup failed'),
    event('fail', { Test: 'TestTable' }),
    event('fail'),
  );
  const markdown = render(failures(text));
  assert.match(markdown, /\*\*TestTable\/bad\*\*/);
  assert.match(markdown, /\*\*TestTable\*\*[^]*table_test\.go:20: cleanup failed/);
  assert.doesNotMatch(markdown, /--- FAIL/);
});

test('a panic is named even when another test of the package already failed', () => {
  const text = stream(
    out('TestAssert', '    a_test.go:5: not equal'),
    event('fail', { Test: 'TestAssert' }),
    event('run', { Test: 'TestBoom' }),
    out('TestBoom', 'panic: runtime error: index out of range'),
    event('fail'),
  );
  const markdown = render(failures(text));
  assert.match(markdown, /\*\*TestAssert\*\*/);
  assert.match(markdown, /\*\*TestBoom\*\* \(the test binary died while it ran\)/);
  assert.match(markdown, /panic: runtime error: index out of range/);
});

test('a package that failed to build because of a dependency is named with the dependency\'s compiler output', () => {
  const dependency = 'github.com/omniviewdev/omniview/internal/dep';
  const text = stream(
    JSON.stringify({ ImportPath: dependency, Action: 'build-output', Output: 'dep.go:3:2: undefined: nope\n' }),
    JSON.stringify({ ImportPath: dependency, Action: 'build-fail' }),
    event('fail', { FailedBuild: dependency }),
  );
  const markdown = render(failures(text));
  assert.match(markdown, /`internal\/example` failed without a failed test \(`internal\/dep` did not build\)/);
  assert.match(markdown, /dep\.go:3:2: undefined: nope/);
});

test('the panic row stays in the excerpt however long the stack after it is', () => {
  const stack = Array.from({ length: 30 }, (_, i) => out('TestBoom', `main.frame${i}()`));
  const text = stream(event('run', { Test: 'TestBoom' }), out('TestBoom', 'a log line before the crash'), out('TestBoom', 'panic: boom'), ...stack, event('fail'));
  const markdown = render(failures(text));
  assert.match(markdown, /panic: boom/);
  assert.match(markdown, /main\.frame0\(\)/);
  assert.doesNotMatch(markdown, /main\.frame20\(\)|a log line before the crash/);
});

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_RUN_ATTEMPT: '2' } });
}

test('the command prints the summary of a file, and nothing for a clean stream or a missing file', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'go-test-failures-'));
  roots.push(root);
  const failing = path.join(root, 'failing.jsonl');
  writeFileSync(failing, stream(out('TestA', '    a_test.go:1: nope'), event('fail', { Test: 'TestA' }), event('fail')));
  const clean = path.join(root, 'clean.jsonl');
  writeFileSync(clean, stream(event('pass', { Test: 'TestA' }), event('pass')));

  const named = run(failing);
  assert.equal(named.status, 0);
  assert.match(named.stdout, /### Go tests failed \(run attempt 2\)/);
  assert.match(named.stdout, /\*\*TestA\*\*/);
  assert.equal(run(clean).stdout, '');
  const skipped = path.join(root, 'skipped.jsonl');
  writeFileSync(skipped, stream(out('TestA', '    a_test.go:1: slow: many shells'), event('skip', { Test: 'TestA' }), event('pass')));
  assert.match(run(skipped).stdout, /### Go tests skipped[\s\S]*\| slow \| 1 \|/);
  const missing = run(path.join(root, 'absent.jsonl'));
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout, '');
});

test('skipped tests are counted by the reason they gave, and none skipped says nothing', () => {
  const skipped = (name, message) => [out(name, `    a_test.go:9: ${message}`), out(name, `--- SKIP: ${name} (0.00s)`), event('skip', { Test: name })];
  const text = stream(...skipped('TestA', 'slow: dev workspace, real git worktrees'), ...skipped('TestB', 'slow: two hundred real shells'), ...skipped('TestC', 'no bash on this machine'), event('pass', { Test: 'TestD' }), event('pass'));
  const markdown = renderSkips(failures(text).skipped);
  assert.match(markdown, /^### Go tests skipped/);
  assert.match(markdown, /\| slow \| 2 \|/);
  assert.match(markdown, /\| no bash on this machine \| 1 \|/);
  assert.equal(renderSkips(failures(stream(event('pass', { Test: 'TestD' }), event('pass'))).skipped), '');
  assert.equal(render(failures(text)), '');
});

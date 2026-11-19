// The guard of the build outputs in the tree (scripts/check-tracked-outputs.mjs): the pure rules, and the command itself in a throwaway git repository, where each
// mistake it exists for is made for real (the deletion of dist/.gitkeep committed, a regenerated icon committed alone) and must fail with its one clear line.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkOutputs, KEEP } from './check-tracked-outputs.mjs';

const script = fileURLToPath(new URL('./check-tracked-outputs.mjs', import.meta.url));
const TREE = [KEEP, 'main.go', 'build/appicon.png', 'build/darwin/icons.icns', 'build/windows/icon.ico', 'build/darwin/Info.plist', 'build/config.yml'];

test('a right tree has no problem', () => {
  assert.deepEqual(checkOutputs({ tracked: TREE, present: true, changed: [] }), []);
});

test('dist/.gitkeep missing from the tree says why and how to restore it', () => {
  const problems = checkOutputs({ tracked: TREE.filter((file) => file !== KEEP), present: false });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /dist\/\.gitkeep is not in the tree/);
  assert.match(problems[0], /all:dist/);
  assert.match(problems[0], /git checkout -- dist\/\.gitkeep/);
});

test('dist/.gitkeep tracked but deleted on disk (what a frontend build leaves) is told apart from a committed deletion', () => {
  const problems = checkOutputs({ tracked: TREE, present: false });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /tracked but missing from the working tree/);
});

test('another tracked file under dist/ is a build output that was force-added', () => {
  const problems = checkOutputs({ tracked: [...TREE, 'dist/index.html', 'dist/assets/entry.js'], present: true });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /dist\/index\.html is tracked/);
});

test('a generator output changed alone fails; with its input, or when it is hand-edited and unprotected, it passes', () => {
  assert.equal(checkOutputs({ tracked: TREE, present: true, changed: ['build/darwin/icons.icns'] }).length, 1);
  assert.equal(checkOutputs({ tracked: TREE, present: true, changed: ['build/windows/icon.ico', 'main.go'] }).length, 1);
  assert.match(checkOutputs({ tracked: TREE, present: true, changed: ['build/windows/icon.ico'] })[0], /common:generate:icons/);
  assert.deepEqual(checkOutputs({ tracked: TREE, present: true, changed: ['build/darwin/icons.icns', 'build/windows/icon.ico', 'build/appicon.png'] }), []);
  assert.deepEqual(checkOutputs({ tracked: TREE, present: true, changed: ['build/darwin/Info.plist', 'build/config.yml', 'main.go'] }), []);
});

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.stderr}`);
  return result;
}

/** A throwaway repository holding TREE, with one commit. */
function repository() {
  const root = mkdtempSync(path.join(tmpdir(), 'tracked-outputs-'));
  roots.push(root);
  run('git', ['init', '-q', '-b', 'main'], root);
  run('git', ['config', 'user.email', 'guard@example.invalid'], root);
  run('git', ['config', 'user.name', 'guard'], root);
  for (const file of TREE) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `${file}\n`);
  }
  run('git', ['add', '-A'], root);
  run('git', ['commit', '-q', '-m', 'base'], root);
  return root;
}

const guard = (root, ...args) => spawnSync('node', [script, '--root', root, ...args], { encoding: 'utf8' });

test('the command passes on a right repository, with and without a change under review', () => {
  const root = repository();
  assert.equal(guard(root).status, 0);
  writeFileSync(path.join(root, 'main.go'), 'package main\n');
  run('git', ['commit', '-q', '-am', 'a change'], root);
  assert.equal(guard(root, '--base', 'HEAD^1').status, 0);
});

test('NEGATIVE CONTROL: a commit that deletes dist/.gitkeep fails the command with the one clear line', () => {
  const root = repository();
  run('git', ['rm', '-q', KEEP], root);
  run('git', ['commit', '-q', '-m', 'build output swept into a commit'], root);
  const result = guard(root, '--base', 'HEAD^1');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /dist\/\.gitkeep is not in the tree/);
  assert.match(result.stderr, /git checkout -- dist\/\.gitkeep/);
});

test('NEGATIVE CONTROL: dist/.gitkeep deleted by a build and not yet committed fails with the restore hint', () => {
  const root = repository();
  rmSync(path.join(root, KEEP));
  const result = guard(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tracked but missing from the working tree/);
});

test('NEGATIVE CONTROL: a regenerated icon committed without its input fails; with its input it passes', () => {
  const root = repository();
  writeFileSync(path.join(root, 'build/darwin/icons.icns'), 'regenerated by a local build\n');
  run('git', ['commit', '-q', '-am', 'icons rewritten by a build'], root);
  const result = guard(root, '--base', 'HEAD^1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /build\/darwin\/icons\.icns changed without build\/appicon\.png/);

  writeFileSync(path.join(root, 'build/appicon.png'), 'a new icon\n');
  run('git', ['commit', '-q', '-am', 'the icon and what is made from it'], root);
  assert.equal(guard(root, '--base', 'HEAD~2').status, 0);
});

test('a base that cannot be read is one clear line, not a pass', () => {
  const root = repository();
  const result = guard(root, '--base', 'no-such-ref');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot read the base no-such-ref/);
});

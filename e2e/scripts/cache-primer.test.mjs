import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { toolEnvironment } from './execution.mjs';

const workflow = name => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
const shared = workflow('e2e-runner.yml');
const pr = workflow('pr.yml');
const main = workflow('main-native-cache.yml');
function step(source, name) {
  const marker = `      - name: ${name}\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, name);
  const end = source.indexOf('\n      - name:', start + marker.length);
  return source.slice(start, end === -1 ? undefined : end);
}
function script(block) {
  const literal = '        run: |\n';
  const start = block.indexOf(literal);
  if (start !== -1) return block.slice(start + literal.length).split('\n').filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');
  const inline = block.match(/^        run: (.+)$/m);
  assert.ok(inline, 'step must expose its real executable shell contract');
  return inline[1];
}
function shell(block, env = {}) {
  return spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', script(block)], { env: { ...toolEnvironment(process.env), ...env }, encoding: 'utf8' });
}

test('main primer skips native preparation only for both exact lookup hits, never a fallback or missing output', () => {
  const arena = mkdtempSync(join(tmpdir(), 'omniview-main-cache-decision-'));
  const decision = step(shared, 'Decide native preparation');
  try {
    for (const cacheOnly of ['true', 'false']) for (const goHit of ['true', 'false', '', 'True']) for (const pnpmHit of ['true', 'false', '', '1']) {
      const output = join(arena, 'output');
      rmSync(output, { force: true });
      const child = shell(decision, { CACHE_ONLY: cacheOnly, SELECTION: 'full', GO_HIT: goHit, PNPM_HIT: pnpmHit, GITHUB_OUTPUT: output });
      assert.equal(child.status, 0, child.stderr);
      const skip = cacheOnly === 'true' && goHit === 'true' && pnpmHit === 'true';
      assert.equal(readFileSync(output, 'utf8'), `required=${!skip}\n`);
    }
    const output = join(arena, 'prose');
    assert.equal(shell(decision, { CACHE_ONLY: 'false', SELECTION: 'none', GITHUB_OUTPUT: output }).status, 0);
    assert.equal(readFileSync(output, 'utf8'), 'required=false\n');
  } finally { rmSync(arena, { recursive: true, force: true }); }
});

test('canonical workflow completion refuses missing, skipped, failed or cancelled operations except proven skips', () => {
  const completion = step(shared, 'Require completed canonical operation or proven skip');
  for (const outcome of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const child = shell(completion, { CACHE_ONLY: 'false', SELECTION: 'full', SELECTION_OUTCOME: 'success', PREPARATION: 'true', CANONICAL_OUTCOME: outcome });
    assert.equal(child.status === 0, outcome === 'success', outcome);
  }
  assert.equal(shell(completion, { CACHE_ONLY: 'false', SELECTION: 'none', SELECTION_OUTCOME: 'success', PREPARATION: 'false', CANONICAL_OUTCOME: 'skipped' }).status, 0);
  for (const outcome of ['failure', 'cancelled', 'skipped', '']) assert.notEqual(shell(completion, { CACHE_ONLY: 'false', SELECTION: 'none', SELECTION_OUTCOME: outcome, PREPARATION: 'false' }).status, 0);
  assert.equal(shell(completion, { CACHE_ONLY: 'true', SELECTION: 'cache-only', PREPARATION: 'false', GO_HIT: 'true', PNPM_HIT: 'true' }).status, 0);
  for (const hit of ['false', '', '1']) assert.notEqual(shell(completion, { CACHE_ONLY: 'true', SELECTION: 'cache-only', PREPARATION: 'false', GO_HIT: hit, PNPM_HIT: 'true' }).status, 0);
});

test('one reusable application execution feeds the exact always-evaluated fail-closed e2e-tests check', () => {
  assert.equal(pr.split('uses: ./.github/workflows/e2e-runner.yml').length - 1, 1);
  assert.match(pr, /  e2e-tests:\n    name: e2e-tests\n    needs: e2e-application\n    if: always\(\)/);
  assert.doesNotMatch(pr, /run\.mjs|continue-on-error/);
  const gate = step(pr, 'Require canonical suite or explicit prose-only success');
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '', 'unavailable']) assert.equal(shell(gate, { RESULT: result }).status === 0, result === 'success', result);
});

test('trusted push-main primer shares exact payload keys without PR promotion or application-output caching', () => {
  assert.match(main, /push:\n    branches: \[main\]/);
  assert.match(main, /group: main-native-cache-\$\{\{ github.ref \}\}/);
  assert.match(main, /cancel-in-progress: false/);
  assert.match(main, /uses: .\/.github\/workflows\/e2e-runner.yml\n    with:\n      cache-only: true/);
  assert.match(shared, /github.event_name == 'push' && github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(main + shared, /workflow_run|download-artifact|actions\/cache@/);
  for (const [lookup, restore, key] of [
    ['Look up exact main pnpm payload', 'Restore standalone native pnpm content store', 'pnpm'],
    ['Look up exact main Go payloads', 'Restore native Go module and compiler payloads', 'go'],
  ]) {
    const lookupStep = step(shared, lookup);
    assert.match(lookupStep, /lookup-only: true/);
    assert.doesNotMatch(lookupStep, /restore-keys:/);
    const exactKey = `key: \u0024{{ steps.cache-keys.outputs.${key} }}`;
    assert.ok(lookupStep.includes(exactKey));
    assert.ok(step(shared, restore).includes(exactKey));
  }
  for (const name of ['Save native pnpm payload independently of application assertions', 'Save native Go payloads independently of application assertions']) {
    const save = step(shared, name);
    assert.match(save, /steps.canonical.outcome == 'success'/);
    assert.doesNotMatch(save, /\.owner.json|node_modules|playwright|application\/|build-cohort|profiles|\/bin|HOME/);
  }
  assert.match(step(shared, 'Install Linux dependencies'), /node scripts\/verify-apt-archives.mjs/);
});

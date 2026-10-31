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
function shell(block, env = {}, cwd) {
  return spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', script(block)], { cwd, env: { ...toolEnvironment(process.env), ...env }, encoding: 'utf8' });
}

test('main primer skips native preparation only for all three exact lookup hits, never a fallback or missing output', () => {
  const arena = mkdtempSync(join(tmpdir(), 'omniview-main-cache-decision-'));
  const decision = step(shared, 'Decide native preparation');
  try {
    for (const cacheOnly of ['true', 'false']) for (const goHit of ['true', 'false', '', 'True']) for (const pnpmHit of ['true', 'false', '', '1']) for (const browserHit of ['true', 'false', '', '1']) {
      const output = join(arena, 'output');
      rmSync(output, { force: true });
      const child = shell(decision, { CACHE_ONLY: cacheOnly, SELECTION: 'full', GO_HIT: goHit, PNPM_HIT: pnpmHit, BROWSER_HIT: browserHit, GITHUB_OUTPUT: output });
      assert.equal(child.status, 0, child.stderr);
      const skip = cacheOnly === 'true' && goHit === 'true' && pnpmHit === 'true' && browserHit === 'true';
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
  assert.equal(shell(completion, { CACHE_ONLY: 'true', SELECTION: 'cache-only', PREPARATION: 'false', GO_HIT: 'true', PNPM_HIT: 'true', BROWSER_HIT: 'true' }).status, 0);
  for (const key of ['GO_HIT', 'PNPM_HIT', 'BROWSER_HIT']) for (const hit of ['false', '', '1']) assert.notEqual(shell(completion, { CACHE_ONLY: 'true', SELECTION: 'cache-only', PREPARATION: 'false', GO_HIT: 'true', PNPM_HIT: 'true', BROWSER_HIT: 'true', [key]: hit }).status, 0);
});

test('stable e2e-tests gate accepts only a successful canonical result', () => {
  const gate = step(pr, 'Require canonical suite or explicit prose-only success');
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '', 'unavailable']) assert.equal(shell(gate, { RESULT: result }).status === 0, result === 'success', result);
});


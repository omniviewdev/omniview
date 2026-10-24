import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { assertStandaloneBootstrap, applicationBudget, repositoryCommit, toolEnvironment } from './execution.mjs';

test('tool environment drops ambient credentials, autoconnect and module/workspace overrides', () => {
  const env = toolEnvironment({ PATH: '/tools', HOME: '/human', CI: '1', AWS_ACCESS_KEY_ID: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', KUBECONFIG: '/human/kube', GOOGLE_APPLICATION_CREDENTIALS: '/human/cloud', AZURE_CLIENT_SECRET: 'secret', GH_TOKEN: 'secret', NODE_OPTIONS: '--require=/human/hook', NODE_PATH: '/human/modules', OMNIVIEW_WORKSPACE_FILE: '/human/workspace.json', PNPM_CONFIG_WORKSPACE_DIR: '/human/root', GOFLAGS: '-modfile=/human/go.mod', GOWORK: '/human/go.work', SDK_SOURCE: '/human/sdk', GIT_CONFIG_GLOBAL: '/human/gitconfig', OMNIVIEW_E2E_PNPM_EXECUTABLE: '/tools/pnpm' });
  assert.equal(env.PATH, '/tools');
  assert.equal(env.CI, '1');
  assert.equal(env.OMNIVIEW_E2E_PNPM_EXECUTABLE, '/tools/pnpm');
  assert.equal(env.GOWORK, 'off');
  assert.equal(env.GOFLAGS, '');
  for (const key of ['HOME', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'KUBECONFIG', 'GOOGLE_APPLICATION_CREDENTIALS', 'AZURE_CLIENT_SECRET', 'GH_TOKEN', 'NODE_OPTIONS', 'NODE_PATH', 'OMNIVIEW_WORKSPACE_FILE', 'PNPM_CONFIG_WORKSPACE_DIR', 'SDK_SOURCE']) assert.equal(env[key], undefined, key);
  assert.notEqual(env.GIT_CONFIG_GLOBAL, '/human/gitconfig');
});
test('standalone bootstrap refuses enclosing managed manifests before package manager execution', () => {
  const arena = mkdtempSync(join(tmpdir(), 'omniview-e2e-bootstrap-'));
  try {
    const host = join(arena, 'host');
    mkdirSync(host);
    assert.doesNotThrow(() => assertStandaloneBootstrap(host));
    // Even a malformed manifest is managed/ambiguous: never install around it.
    writeFileSync(join(arena, 'workspace.json'), '{');
    assert.throws(() => assertStandaloneBootstrap(host), /managed.*standalone/i);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('application deadline subtracts all preparation and reserves owned teardown time', () => {
  assert.deepEqual(applicationBudget(1000, 151000), { deadline: 601000, remainingMs: 450000, globalTimeoutMs: 390000, cleanupReserveMs: 60000 });
  assert.throws(() => applicationBudget(1000, 541000), /budget/);
  assert.throws(() => applicationBudget(1000, 601001), /budget/);
});
test('source identity refuses an empty submodule resolving to the parent repository', () => {
  const arena = mkdtempSync(join(tmpdir(), 'omniview-e2e-repository-'));
  const env = toolEnvironment(process.env);
  const git = (...args) => execFileSync('git', ['-C', arena, '-c', 'user.name=E2E', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { env, encoding: 'utf8' }).trim();
  try {
    git('init', '--initial-branch=main');
    writeFileSync(join(arena, 'README.md'), 'source\n');
    git('add', '.'); git('commit', '-m', 'source');
    assert.equal(repositoryCommit(arena, env), git('rev-parse', 'HEAD'));
    const emptySubmodule = join(arena, 'empty-submodule');
    mkdirSync(emptySubmodule);
    assert.throws(() => repositoryCommit(emptySubmodule, env), /repository root/);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});

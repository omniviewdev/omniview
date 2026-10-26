import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertStandaloneBootstrap, applicationBudget, commandTimeout, preparationStarted, repositoryCommit, runnerOptions, toolEnvironment } from './execution.mjs';

test('tool environment drops ambient credentials, autoconnect and module/workspace overrides', () => {
  const env = toolEnvironment({ PATH: '/tools', HOME: '/human', CI: '1', AWS_ACCESS_KEY_ID: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', KUBECONFIG: '/human/kube', GOOGLE_APPLICATION_CREDENTIALS: '/human/cloud', AZURE_CLIENT_SECRET: 'secret', GH_TOKEN: 'secret', NODE_OPTIONS: '--require=/human/hook', NODE_PATH: '/human/modules', OMNIVIEW_WORKSPACE_FILE: '/human/workspace.json', PNPM_CONFIG_WORKSPACE_DIR: '/human/root', GOFLAGS: '-modfile=/human/go.mod', GOWORK: '/human/go.work', SDK_SOURCE: '/human/sdk', GIT_CONFIG_GLOBAL: '/human/gitconfig', OMNIVIEW_E2E_PNPM_EXECUTABLE: '/tools/pnpm', GOCACHE: '/human/compiler', GOMODCACHE: '/human/modules', GOPATH: '/human/go', OMNIVIEW_E2E_TOOL_CACHE_ROOT: '/human/cache' });
  assert.equal(env.PATH, '/tools');
  assert.equal(env.CI, '1');
  assert.equal(env.OMNIVIEW_E2E_PNPM_EXECUTABLE, '/tools/pnpm');
  assert.equal(env.GOWORK, 'off');
  assert.equal(env.GOFLAGS, '');
  for (const key of ['HOME', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'KUBECONFIG', 'GOOGLE_APPLICATION_CREDENTIALS', 'AZURE_CLIENT_SECRET', 'GH_TOKEN', 'NODE_OPTIONS', 'NODE_PATH', 'OMNIVIEW_WORKSPACE_FILE', 'PNPM_CONFIG_WORKSPACE_DIR', 'SDK_SOURCE', 'GOCACHE', 'GOMODCACHE', 'GOPATH', 'OMNIVIEW_E2E_TOOL_CACHE_ROOT']) assert.equal(env[key], undefined, key);
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
  assert.deepEqual(applicationBudget(1000, 151000), { deadline: 601000, remainingMs: 450000, interruptAfterMs: 390000, cleanupReserveMs: 60000 });
  assert.throws(() => applicationBudget(1000, 541000), /budget/);
  assert.throws(() => applicationBudget(1000, 601001), /budget/);
});
test('workflow provisioning is charged to the same inclusive deadline and cannot supply a future or malformed start', () => {
  assert.equal(preparationStarted(151000), 151000);
  assert.equal(preparationStarted(151000, '1000'), 1000);
  assert.equal(commandTimeout(preparationStarted(151000, '1000'), 151000, 180000), 180000);
  assert.equal(commandTimeout(preparationStarted(591000, '1000'), 591000, 180000), 10000);
  for (const value of ['', '151001', '-1', '1.5', '1e3', 'NaN', 'Infinity', ' 1000']) assert.throws(() => preparationStarted(151000, value), /preparation start/);
});
test('interactive sessions outlive acceptance while each command keeps a fresh bound', () => {
  assert.equal(applicationBudget(1000, 901000, { interactive: true }), null);
  assert.equal(commandTimeout(1000, 901000, 30000, true), 30000);
  assert.equal(commandTimeout(1000, 901000, 60000, true), 60000);
  assert.equal(commandTimeout(1000, 591000, 30000, false), 10000);
  assert.throws(() => commandTimeout(1000, 901000, 30000, false), /budget/);
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
test('selection-only CLI works without package managers or browser dependencies and emits CI gating output', () => {
  const arena = mkdtempSync(join(tmpdir(), 'omniview-e2e-selection-'));
  const scripts = join(arena, 'e2e/scripts');
  mkdirSync(scripts, { recursive: true });
  try {
    for (const name of ['run.mjs', 'execution.mjs', 'select-tests.mjs', 'application.mjs', 'cohort.mjs', 'tool-cache.mjs', 'browser-dependencies.mjs']) copyFileSync(fileURLToPath(new URL(name, import.meta.url)), join(scripts, name));
    mkdirSync(join(arena, 'scripts'));
    copyFileSync(fileURLToPath(new URL('../../scripts/wails-tool.mjs', import.meta.url)), join(arena, 'scripts/wails-tool.mjs'));
    const output = join(arena, 'github-output');
    const stdout = execFileSync(process.execPath, [join(scripts, 'run.mjs'), '--full', '--select'], { env: { ...toolEnvironment(process.env), PATH: '', GITHUB_OUTPUT: output, OMNIVIEW_WAILS_TOOL_CAPABILITY: '{}' }, encoding: 'utf8' });
    assert.match(stdout, /E2E selection:.*\"kind\":\"full\"/);
    assert.equal(readFileSync(output, 'utf8'), 'kind=full\nrequires_application=true\n');
    const report = JSON.parse(readFileSync(join(arena, 'e2e/playwright-report/selection.json'), 'utf8'));
    assert.equal(report.operation, 'selection');
    assert.deepEqual(report.phases, []);
    assert.equal(existsSync(join(arena, '.local')), false);
    assert.equal(existsSync(join(arena, 'node_modules')), false);
    for (const pattern of ['/A17/ii', '[']) {
      assert.throws(() => execFileSync(process.execPath, [join(scripts, 'run.mjs'), '--full', '--select', '--grep', pattern], { env: { ...toolEnvironment(process.env), PATH: '' }, encoding: 'utf8', stdio: 'pipe' }));
    }
    const focused = execFileSync(process.execPath, [join(scripts, 'run.mjs'), '--full', '--select', '--grep', '/probe/i'], { env: { ...toolEnvironment(process.env), PATH: '' }, encoding: 'utf8' });
    assert.match(focused, /\"kind\":\"focused\"/);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});

test('cache-only preparation is an explicit exclusive mode, never a filtered acceptance run', () => {
  assert.equal(runnerOptions(['--cache-only']).cacheOnly, true);
  assert.equal(runnerOptions([]).cacheOnly, undefined);
  for (const args of [
    ['--cache-only', '--changed'], ['--cache-only', '--full'],
    ['--cache-only', '--base', 'main'], ['--cache-only', '--grep', 'probe'],
    ['--cache-only', '--ui'], ['--cache-only', '--observe'],
    ['--cache-only', '--select'], ['--cache-only', '--list'],
    ['--cache-only', '--report'], ['--cache-only', '--init-tool-cache'],
  ]) assert.throws(() => runnerOptions(args), /cache-only.*alone/i);
  assert.throws(() => runnerOptions(['--unknown']), /Unsupported argument/);
});

test('cache-only refuses missing explicit cache ownership before dependency or application preparation', () => {
  const arena = mkdtempSync(join(tmpdir(), 'omniview-cache-only-mode-'));
  const scripts = join(arena, 'e2e/scripts');
  mkdirSync(scripts, { recursive: true });
  try {
    for (const name of ['run.mjs', 'execution.mjs', 'select-tests.mjs', 'application.mjs', 'cohort.mjs', 'tool-cache.mjs', 'browser-dependencies.mjs']) copyFileSync(fileURLToPath(new URL(name, import.meta.url)), join(scripts, name));
    mkdirSync(join(arena, 'scripts'));
    copyFileSync(fileURLToPath(new URL('../../scripts/wails-tool.mjs', import.meta.url)), join(arena, 'scripts/wails-tool.mjs'));
    assert.throws(() => execFileSync(process.execPath, [join(scripts, 'run.mjs'), '--cache-only'], { env: { ...toolEnvironment(process.env), PATH: '' }, stdio: 'pipe' }), error => {
      assert.match(error.stderr.toString(), /cache-only requires OMNIVIEW_E2E_TOOL_CACHE_ROOT/);
      return true;
    });
    const report = JSON.parse(readFileSync(join(arena, 'e2e/playwright-report/invocation.json'), 'utf8'));
    assert.equal(report.operation, 'cache-only');
    assert.equal(report.succeeded, false);
    assert.equal(report.applicationAcceptance, false);
    assert.deepEqual(report.phases, []);
    assert.equal(existsSync(join(arena, 'node_modules')), false);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});

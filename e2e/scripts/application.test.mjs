import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applicationEnvironment, discoveredSpecs, forceRegExp, prepareViteCacheDirectory, requiresApplication, validateApplicationDescriptor, validateApplicationSelection, validateOwnedDirectory, validateStoppedProof } from './application.mjs';
import { chmodSync, lstatSync, mkdtempSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('grep admission uses Playwright 1.64 forceRegExp semantics before preparation', () => {
  assert.equal(forceRegExp('/A17/i').test('a17'), true);
  assert.equal(forceRegExp('PROBE').flags, 'gi');
  assert.throws(() => forceRegExp('/A17/ii'), SyntaxError);
  assert.throws(() => forceRegExp('['), SyntaxError);
});

test('profile children receive private configuration and no ambient credentials', () => {
  const env = applicationEnvironment({ PATH: '/tools', HOME: '/human', AWS_SECRET_ACCESS_KEY: 'secret', KUBECONFIG: '/human/config', GOWORK: '/human/go.work', NODE_AUTH_TOKEN: 'secret' }, '/private/profile');
  assert.equal(env.HOME, '/private/profile');
  assert.equal(env.KUBECONFIG, '/private/profile/.kube/config');
  assert.equal(env.GOWORK, 'off');
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.NODE_AUTH_TOKEN, undefined);
});

test('broker admits only the two invocation-owned profiles and a real frontend mode', () => {
  assert.deepEqual(validateApplicationSelection({ name: 'profile-a', liveFrontend: false }), { name: 'profile-a', liveFrontend: false });
  for (const selection of [{ name: '../foreign' }, { name: 'third' }, { name: 'profile-a', liveFrontend: 'true' }]) {
    assert.throws(() => validateApplicationSelection(selection));
  }
});

test('focused layering resolves genuine Playwright root-relative discovery files', () => {
  // Playwright 1.64 JSON reports spec.file relative to config.rootDir, not
  // relative to the directory containing playwright.config.ts.
  const config = { rootDir: '/owned/e2e/tests' };
  const report = { config, suites: [{ suites: [{ specs: [{ file: 'integration/published-consumers.spec.ts', tests: [{}] }] }] }] };
  const files = discoveredSpecs(report, '/owned/e2e');
  assert.deepEqual(files, ['tests/integration/published-consumers.spec.ts']);
  assert.equal(requiresApplication(files), false);
  assert.throws(() => discoveredSpecs({ config, suites: [] }, '/owned/e2e'), /no tests/);
  assert.throws(() => discoveredSpecs({ ...report, errors: [{ message: 'import failed' }] }, '/owned/e2e'), /discovery/);
});

test('focused discovery refuses invalid roots and traversal before classifying files', () => {
  const suites = [{ specs: [{ file: 'integration/published-consumers.spec.ts', tests: [{}] }] }];
  for (const rootDir of [undefined, null, 42, '', 'tests', '/foreign/tests', '/owned/e2e', '/owned/e2e/tests/../tests']) {
    assert.throws(() => discoveredSpecs({ config: { rootDir }, suites }, '/owned/e2e'), /root/);
  }
  assert.throws(() => discoveredSpecs({ suites }, '/owned/e2e'), /root/);
  for (const file of [undefined, 42, '', '../outside.spec.ts', 'integration/../../outside.spec.ts', 'integration/../workspaces/consumers.spec.ts', '/foreign/spec.ts']) {
    assert.throws(() => discoveredSpecs({ config: { rootDir: '/owned/e2e/tests' }, suites: [{ specs: [{ file, tests: [{}] }] }] }, '/owned/e2e'), /outside/);
  }
});


test('broker ownership admission rejects public and redirected directories without repairing them', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'omniview-application-directory-')));
  const alias = `${directory}-alias`;
  try {
    validateOwnedDirectory(directory);
    symlinkSync(directory, alias, 'dir');
    assert.throws(() => validateOwnedDirectory(alias), /private/);
    chmodSync(directory, 0o755);
    assert.throws(() => validateOwnedDirectory(directory), /private/);
  } finally {
    rmSync(alias, { force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CI application requirement fails closed unless all nonempty selected paths are tooling integration', () => {
  assert.equal(requiresApplication(['tests/integration']), false);
  assert.equal(requiresApplication(['tests/integration/published-consumers.spec.ts']), false);
  for (const specs of [undefined, [], ['tests/workspaces'], ['tests/integration', 'tests/layout'], ['tests/integration-other']]) assert.equal(requiresApplication(specs), true);
});

test('server admission uses authenticated backend-ready plus observed browser before any page can emit window-ready', () => {
  const expected = { workspaceID: 'owned-uuid', stateRoot: '/owned/state', generation: 'owned-generation', pid: 123, startIdentity: 'kernel-start', binary: '/owned/server', browser: 'http://127.0.0.1:31000/' };
  const descriptor = { schemaVersion: 1, kind: 'development', workspaceID: expected.workspaceID, instanceID: expected.workspaceID, stateRoot: expected.stateRoot, generation: expected.generation, readiness: 'backend-ready', process: { pid: expected.pid, executable: expected.binary, startIdentity: 'kernel-start', workspaceID: expected.workspaceID, generation: expected.generation, role: 'host' }, endpoints: { browser: expected.browser }, plugins: null };
  assert.deepEqual(validateApplicationDescriptor(descriptor, expected).plugins, []);
  for (const changed of [{ readiness: 'starting' }, { generation: 'old' }, { stateRoot: '/foreign' }, { endpoints: { browser: 'http://127.0.0.1:32000/' } }]) assert.throws(() => validateApplicationDescriptor({ ...descriptor, ...changed }, expected));
  const live = { ...expected, vite: 'http://127.0.0.1:31001' };
  // Browser readiness can arrive before the host observes the Vite endpoint.
  for (const vite of [undefined, null, 'http://127.0.0.1:32001']) {
    assert.throws(() => validateApplicationDescriptor({ ...descriptor, endpoints: { ...descriptor.endpoints, vite } }, live), /ready/);
  }
  assert.equal(validateApplicationDescriptor({ ...descriptor, endpoints: { ...descriptor.endpoints, vite: live.vite } }, live).endpoints.vite, live.vite);
});

test('retirement requires the actual owned lifecycle proof for the exact captured child', () => {
  const identity = { pid: 123, startIdentity: 'kernel-start', executable: '/owned/app', workspaceID: 'A', generation: 'generation', role: 'host', source: '/owned/artifact' };
  assert.doesNotThrow(() => validateStoppedProof({ process: identity, childrenEmpty: true }, identity));
  assert.throws(() => validateStoppedProof({ process: identity, childrenEmpty: false }, identity));
  assert.throws(() => validateStoppedProof({ process: { ...identity, startIdentity: 'foreign' }, childrenEmpty: true }, identity));
});

test('alternate Vite receives an existing private canonical cache directory', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'omniview-vite-private-')));
  try {
    const cache = prepareViteCacheDirectory(home);
    assert.equal(cache, join(home, 'vite-cache'));
    assert.equal(realpathSync(cache), cache);
    assert.equal(lstatSync(cache).isDirectory(), true);
    assert.equal(lstatSync(cache).mode & 0o777, 0o700);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

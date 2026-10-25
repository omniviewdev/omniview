import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePinnedWailsTool, validatePinnedWailsTool, validateWailsBuildInfo } from './wails-tool.mjs';

const host = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const adapter = join(host, 'scripts/wails-tool.mjs');
let arena, root, capability, environment;
before(() => {
  arena = realpathSync(mkdtempSync(join(tmpdir(), 'omniview-wails-tool-test-')));
  root = join(arena, 'host');
  mkdirSync(root, { mode: 0o700 });
  copyFileSync(join(host, 'go.mod'), join(root, 'go.mod'));
  copyFileSync(join(host, 'go.sum'), join(root, 'go.sum'));
  const bootstrapCache = process.env.GOCACHE || execFileSync('go', ['env', 'GOCACHE'], { env: { ...process.env, GOWORK: 'off', GOFLAGS: '' }, encoding: 'utf8' }).trim();
  environment = { ...process.env, GOWORK: 'off', GOFLAGS: '', GOCACHE: bootstrapCache };
  // This is a real pinned stock installation, not a synthetic executable or
  // --version response. All its build cost belongs to this test invocation.
  capability = preparePinnedWailsTool({ root, directory: join(arena, 'tool'), bootstrapGoCache: bootstrapCache, env: environment });
});
after(() => { if (arena) rmSync(arena, { recursive: true, force: true }); });

// Removing native build-info authentication must break this real executable boundary.
test('actual stock pinned native executable is authenticated and invoked without a shell', () => {
  const tool = validatePinnedWailsTool(capability, { root, env: environment });
  assert.equal(dirname(tool), join(arena, 'tool'));
  assert.equal(lstatSync(tool).mode & 0o777, 0o500);
  const direct = execFileSync(tool, ['version'], { env: environment, encoding: 'utf8' });
  const child = spawnSync(process.execPath, [adapter, '--root', root, '--capability', capability, '--', 'version'], { env: environment, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, direct);
});

test('explicit missing or malformed capability is refused without executing a fallback', () => {
  for (const value of ['', '{}', 'not-json']) {
    const child = spawnSync(process.execPath, [adapter, '--root', root, '--capability', value, '--', 'version'], { env: environment, encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Wails tool/);
  }
});

test('selected host pin changes invalidate a previously prepared executable', () => {
  const modfile = join(root, 'go.mod');
  const original = readFileSync(modfile, 'utf8');
  try {
    writeFileSync(modfile, original.replace(/github.com\/wailsapp\/wails\/v3 v\S+/, 'github.com/wailsapp/wails/v3 v3.0.0-beta.29'));
    assert.throws(() => validatePinnedWailsTool(capability, { root, env: environment }), /pin/);
  } finally { writeFileSync(modfile, original); }
});

test('missing replaced and symlinked tools cannot reuse the original capability', () => {
  const tool = validatePinnedWailsTool(capability, { root, env: environment });
  const saved = `${tool}.saved`;
  renameSync(tool, saved);
  try {
    assert.throws(() => validatePinnedWailsTool(capability, { root, env: environment }));
    copyFileSync(saved, tool);
    chmodSync(tool, 0o500);
    assert.throws(() => validatePinnedWailsTool(capability, { root, env: environment }), /identity/);
    rmSync(tool);
    symlinkSync(saved, tool);
    assert.throws(() => validatePinnedWailsTool(capability, { root, env: environment }), /canonical|regular/);
  } finally { rmSync(tool, { force: true }); renameSync(saved, tool); }
});

test('copied attestation and non-private executable ownership are refused', () => {
  const descriptor = JSON.parse(capability);
  const copy = join(arena, 'copied');
  mkdirSync(copy, { mode: 0o700 });
  copyFileSync(descriptor.executable, join(copy, 'wails3'));
  chmodSync(join(copy, 'wails3'), 0o500);
  assert.throws(() => validatePinnedWailsTool(JSON.stringify({ ...descriptor, directory: copy, executable: join(copy, 'wails3') }), { root, env: environment }), /identity/);
  chmodSync(descriptor.executable, 0o700);
  try { assert.throws(() => validatePinnedWailsTool(capability, { root, env: environment }), /private|mode/); }
  finally { chmodSync(descriptor.executable, 0o500); }
});

test('foreign platform and ownership attestations cannot authorize an actual tool', () => {
  const descriptor = JSON.parse(capability);
  assert.throws(() => validatePinnedWailsTool(JSON.stringify({ ...descriptor, platform: 'win32' }), { root, env: environment }), /foreign/);
  assert.throws(() => validatePinnedWailsTool(JSON.stringify({ ...descriptor, executableIdentity: { ...descriptor.executableIdentity, uid: String(process.getuid() + 1) } }), { root, env: environment }), /identity/);
});

test('real foreign-platform and wrong-module Go executables fail native stock build-info authentication', () => {
  const source = join(arena, 'main.go');
  writeFileSync(source, 'package main\nfunc main() {}\n');
  const binary = join(arena, 'unrelated-go-tool');
  execFileSync('go', ['build', '-o', binary, source], { env: { ...environment, CGO_ENABLED: '0', GOOS: process.platform === 'darwin' ? 'darwin' : 'linux', GOARCH: process.arch === 'arm64' ? 'arm64' : 'amd64' } });
  assert.throws(() => validateWailsBuildInfo(binary, JSON.parse(capability).version, { env: environment }), /stock|module|command/);
  execFileSync('go', ['build', '-o', binary, source], { env: { ...environment, CGO_ENABLED: '0', GOOS: process.platform === 'darwin' ? 'linux' : 'darwin', GOARCH: process.arch === 'arm64' ? 'arm64' : 'amd64' } });
  assert.throws(() => validateWailsBuildInfo(binary, JSON.parse(capability).version, { env: environment }), /native|platform/);
});

test('changed executable bytes fail even when the capability is otherwise original', () => {
  const descriptor = JSON.parse(capability);
  chmodSync(descriptor.executable, 0o700);
  writeFileSync(descriptor.executable, '#!/bin/sh\necho counterfeit\n');
  chmodSync(descriptor.executable, 0o500);
  assert.throws(() => validatePinnedWailsTool(capability, { root, env: environment }), /identity|digest|native/);
});

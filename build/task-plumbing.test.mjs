import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function dryRun(environment, ...args) {
  const result = spawnSync('task', ['--dry', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env, GOWORK: 'off', GOFLAGS: '', GO_MODFILE: '', SDK_SOURCE: '',
      DEV: '', SERVER: '', RELEASE: '', WAILS_MCP: '', EXTRA_TAGS: '', BUILD_FLAGS: '',
      ...environment,
    },
  });
  assert.equal(result.error, undefined);
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
  return output;
}
function tags(flags) {
  const match = flags.match(/-tags (?:'([^']*)'|"([^"]*)"|([^\s'"]+))/);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').split(',').filter(Boolean).sort();
}
function backendCommand(output) {
  const match = output.match(/\bgo build ([^\n]+)/);
  assert.ok(match, output);
  return match[1];
}
function bindingFlags(output) {
  const match = output.match(/^BINDING_FLAGS=(.+)$/m);
  assert.ok(match, output);
  return match[1];
}

test('release package excludes ambient and caller-supplied control/MCP build tags', () => {
  const output = dryRun({
    DEV: 'true', WAILS_MCP: '1', EXTRA_TAGS: 'mcp,devcontrol', BUILD_FLAGS: '-tags mcp,devcontrol',
  }, 'package', 'BUILD_FLAGS=-tags mcp,devcontrol');
  assert.deepEqual(tags(backendCommand(output)), ['production']);
  assert.deepEqual(tags(bindingFlags(output)), ['production']);
});

test('explicit release bindings exclude ambient and caller-supplied control/MCP build tags', () => {
  const output = dryRun({
    WAILS_MCP: '1', EXTRA_TAGS: 'mcp,devcontrol', BUILD_FLAGS: '-tags mcp,devcontrol',
  }, 'bindings', 'RELEASE=true', 'DEV=true', 'BUILD_FLAGS=-tags mcp,devcontrol');
  assert.deepEqual(tags(bindingFlags(output)), ['production']);
});

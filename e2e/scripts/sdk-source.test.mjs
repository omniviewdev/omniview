import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveKubernetesSourceRef, resolveSDKSource } from './sdk-source.mjs';

const hash = '427ef1da1f1db4f5787d384af3ae183ff31b0cd3';

test('resolves the host SDK module commit with an isolated Go environment', () => {
  const env = { GOWORK: '/workspace/go.work', GOFLAGS: '-mod=vendor', OTHER: 'value' };
  const result = resolveSDKSource('/host', env, (command, args, options) => {
    assert.equal(command, 'go');
    assert.deepEqual(args, ['mod', 'download', '-json', 'github.com/omniviewdev/plugin-sdk']);
    assert.deepEqual(options, {
      cwd: '/host',
      env: { ...env, GOWORK: 'off', GOFLAGS: '', GOPROXY: 'direct' },
      encoding: 'utf8',
      timeout: 120_000,
    });
    return JSON.stringify({ Origin: { Hash: hash } });
  });
  assert.equal(result, hash);
});

test('reads the cached module info when Go omits Origin from download output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-info-'));
  try {
    const info = join(dir, 'sdk.info');
    writeFileSync(info, JSON.stringify({ Origin: { Hash: hash } }));
    assert.equal(resolveSDKSource('/host', {}, () => JSON.stringify({ Info: info })), hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects missing or malformed SDK commit metadata', () => {
  for (const metadata of [{}, { Origin: { Hash: 'abc' } }, { Origin: { Hash: hash.toUpperCase() } }]) {
    assert.throws(() => resolveSDKSource('/host', {}, () => JSON.stringify(metadata)), {
      message: 'SDK module download metadata has no full Origin.Hash',
    });
  }
});

test('preserves command and metadata parsing failures as causes', () => {
  const cause = new Error('go failed');
  assert.throws(() => resolveSDKSource('/host', {}, () => { throw cause; }), {
    message: 'Failed to resolve SDK source from host go.mod', cause,
  });
  assert.throws(() => resolveSDKSource('/host', {}, () => '{'), error => {
    assert.equal(error.message, 'Invalid SDK module download metadata');
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test('reads only a full pinned Kubernetes commit from the host', () => {
  const root = mkdtempSync(join(tmpdir(), 'kubernetes-ref-'));
  try {
    mkdirSync(join(root, '.github'));
    const pin = join(root, '.github/kubernetes-ref');
    writeFileSync(pin, `${hash}\n`);
    assert.equal(resolveKubernetesSourceRef(root), hash);
    for (const invalid of ['main', 'abc', hash.toUpperCase(), `${hash}\n${hash}`]) {
      writeFileSync(pin, invalid);
      assert.throws(() => resolveKubernetesSourceRef(root), { message: 'Kubernetes source pin must be a full lowercase commit SHA' });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

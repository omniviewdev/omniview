import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { workspaceViteCacheDirectory, workspaceVitePort, workspaceViteRoots } from '../src/workspace';
import { omniviewExternals } from '../src/index';
import type { UserConfig } from 'vite';

test('selected filesystem roots are explicit canonical directories', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'omniview vite roots ')));
  try {
    assert.deepEqual(workspaceViteRoots(JSON.stringify([root, root])), [root]);
    assert.equal(workspaceViteRoots(undefined), undefined);
    for (const raw of ['[]', '{}', '["/"]', '["../sibling"]', '["/tmp/*"]']) {
      assert.throws(() => workspaceViteRoots(raw));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('managed HMR ports are actual integer listener ports', () => {
  assert.equal(workspaceVitePort('12345'), 12345);
  assert.equal(workspaceVitePort(undefined), undefined);
  for (const raw of ['0', '65536', '123abc', '1.5', '']) {
    assert.throws(() => workspaceVitePort(raw));
  }
});

test('managed plugin rejects a conflicting websocket listener before server startup', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'omniview hmr lease ')));
  const previousRoots = process.env.OMNIVIEW_VITE_ALLOWED_ROOTS;
  const previousPort = process.env.OMNIVIEW_VITE_PORT;
  process.env.OMNIVIEW_VITE_ALLOWED_ROOTS = JSON.stringify([root]);
  process.env.OMNIVIEW_VITE_PORT = '18080';
  const configure = (config: UserConfig) => {
    const hook = omniviewExternals().config;
    if (typeof hook !== 'function') throw new Error('Expected callable plugin configuration hook');
    return hook.call({} as never, config, { command: 'serve', mode: 'development' });
  };
  try {
    assert.throws(() => configure({
      server: { port: 18080, hmr: { port: 18081, clientPort: 18080 } },
    }), /HMR conflicts with its owned loopback endpoint/);
    const matching: UserConfig = {
      server: { port: 18080, hmr: { port: 18080, clientPort: 18080 } },
    };
    await configure(matching);
    assert.equal(typeof matching.server?.hmr, 'object');
    if (typeof matching.server?.hmr === 'object') {
      assert.equal(matching.server.hmr.port, 18080);
      assert.equal(matching.server.hmr.clientPort, 18080);
    }
  } finally {
    if (previousRoots === undefined) delete process.env.OMNIVIEW_VITE_ALLOWED_ROOTS;
    else process.env.OMNIVIEW_VITE_ALLOWED_ROOTS = previousRoots;
    if (previousPort === undefined) delete process.env.OMNIVIEW_VITE_PORT;
    else process.env.OMNIVIEW_VITE_PORT = previousPort;
    rmSync(root, { recursive: true, force: true });
  }
});

test('managed cache is existing canonical storage, not a relative default', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'omniview cache capability ')));
  try {
    assert.equal(workspaceViteCacheDirectory(root), root);
    assert.equal(workspaceViteCacheDirectory(undefined), undefined);
    for (const raw of ['', '.', '../cache', path.parse(root).root, path.join(root, 'missing')]) {
      assert.throws(() => workspaceViteCacheDirectory(raw));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('plugin build uses controlled output and refuses conflicting caller destinations', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'omniview controlled build ')));
  const previousCache = process.env.OMNIVIEW_VITE_CACHE_DIRECTORY;
  const previousOutput = process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY;
  process.env.OMNIVIEW_VITE_CACHE_DIRECTORY = root;
  process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY = path.join(root, 'owned sibling output');
  const configure = (config: UserConfig) => {
    const hook = omniviewExternals().config;
    if (typeof hook !== 'function') throw new Error('Expected callable plugin configuration hook');
    return hook.call({} as never, config, { command: 'build', mode: 'production' });
  };
  try {
    const matching: UserConfig = { root, cacheDir: root, build: { outDir: 'dist' } };
    await configure(matching);
    assert.equal(matching.cacheDir, root);
    assert.equal(matching.build?.outDir, process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY);
    assert.throws(() => configure({ root, cacheDir: path.join(root, 'foreign cache') }), /cache conflicts/);
    assert.throws(() => configure({ root, build: { outDir: 'foreign distribution' } }), /distribution path conflicts/);
  } finally {
    if (previousCache === undefined) delete process.env.OMNIVIEW_VITE_CACHE_DIRECTORY;
    else process.env.OMNIVIEW_VITE_CACHE_DIRECTORY = previousCache;
    if (previousOutput === undefined) delete process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY;
    else process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY = previousOutput;
    rmSync(root, { recursive: true, force: true });
  }
});

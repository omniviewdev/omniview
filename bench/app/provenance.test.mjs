import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { harnessFiles, harnessIdentity, MANIFEST_NAME, readBuildManifest, uiPackageProvenance, writeBuildManifest } from './provenance.mjs';

function scratch(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-bench-provenance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return fs.realpathSync(directory);
}

function write(root, name, text) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('a build manifest is trusted only while the bundle it recorded is the bundle present', (t) => {
  const dist = path.join(scratch(t), 'dist');
  write(dist, 'index.html', '<html></html>');
  write(dist, 'assets/a.js', 'a');
  assert.equal(readBuildManifest(dist).state, 'absent');

  const written = writeBuildManifest(dist, { react: 'normal', minify: { setting: 'app', effective: false } });
  assert.equal(written.bundle.files, 2, 'the manifest itself is not part of the hash it records');
  const verified = readBuildManifest(dist);
  assert.equal(verified.state, 'verified');
  assert.equal(verified.manifest.react, 'normal');
  assert.equal(verified.manifest.minify.effective, false);

  write(dist, 'assets/a.js', 'changed after the build');
  const changed = readBuildManifest(dist);
  assert.equal(changed.state, 'unverified');
  assert.match(changed.reason, /differs/);
});

test('an unreadable manifest is unverified, never trusted', (t) => {
  const dist = path.join(scratch(t), 'dist');
  write(dist, 'index.html', '<html></html>');
  write(dist, MANIFEST_NAME, 'not json');
  const result = readBuildManifest(dist);
  assert.equal(result.state, 'unverified');
  assert.match(result.reason, /unreadable/);
});

test('shared UI packages are identified by where they really resolve, not by their declared range', (t) => {
  const base = scratch(t);
  const appRoot = path.join(base, 'host');
  const linked = path.join(base, 'ui', 'packages', 'base-ui');
  const store = path.join(appRoot, 'node_modules', '.pnpm', 'ai-ui@6.1.12', 'node_modules', '@omniviewdev', 'ai-ui');
  write(linked, 'package.json', JSON.stringify({ name: '@omniviewdev/base-ui', version: '0.17.1' }));
  write(linked, 'dist/index.js', 'export {}');
  write(store, 'package.json', JSON.stringify({ name: '@omniviewdev/ai-ui', version: '6.1.12' }));
  write(store, 'dist/index.js', 'export {}');
  write(appRoot, 'package.json', JSON.stringify({ dependencies: { '@omniviewdev/base-ui': '~0.17.1', '@omniviewdev/ai-ui': '~6.1.12' } }));
  fs.mkdirSync(path.join(appRoot, 'node_modules', '@omniviewdev'), { recursive: true });
  fs.symlinkSync(linked, path.join(appRoot, 'node_modules', '@omniviewdev', 'base-ui'));
  fs.symlinkSync(store, path.join(appRoot, 'node_modules', '@omniviewdev', 'ai-ui'));

  const ui = uiPackageProvenance(appRoot, ['@omniviewdev/base-ui', '@omniviewdev/ai-ui', '@omniviewdev/editors']);
  const baseUi = ui['@omniviewdev/base-ui'];
  assert.equal(baseUi.source, 'linked-checkout');
  assert.equal(baseUi.version, '0.17.1');
  assert.equal(baseUi.declared, '~0.17.1');
  assert.equal(baseUi.realPath, linked);
  assert.equal(baseUi.dist.files, 1);
  assert.match(baseUi.dist.treeSHA256, /^[0-9a-f]{64}$/);
  assert.equal(baseUi.git.state, 'unknown', 'a directory outside any git checkout has no git identity');

  assert.equal(ui['@omniviewdev/ai-ui'].source, 'package-store');
  assert.equal(ui['@omniviewdev/ai-ui'].git, undefined, 'a store copy never borrows the host repository identity');
  assert.equal(ui['@omniviewdev/editors'].state, 'unresolved');
  assert.equal(ui['@omniviewdev/editors'].declared, null);
});

test('the dist hash of a linked package changes when its built bytes change', (t) => {
  const base = scratch(t);
  const appRoot = path.join(base, 'host');
  const linked = path.join(base, 'ui', 'base-ui');
  write(linked, 'package.json', JSON.stringify({ version: '0.17.1' }));
  write(linked, 'dist/index.js', 'one');
  write(appRoot, 'package.json', '{}');
  fs.mkdirSync(path.join(appRoot, 'node_modules', '@omniviewdev'), { recursive: true });
  fs.symlinkSync(linked, path.join(appRoot, 'node_modules', '@omniviewdev', 'base-ui'));
  const names = ['@omniviewdev/base-ui'];
  const before = uiPackageProvenance(appRoot, names)[names[0]].dist.treeSHA256;
  write(linked, 'dist/index.js', 'two');
  assert.notEqual(uiPackageProvenance(appRoot, names)[names[0]].dist.treeSHA256, before);
});

test('the harness hash covers the files that execute and ignores tests, receipts and results', (t) => {
  const root = scratch(t);
  write(root, 'bench/app/run.mjs', 'run');
  write(root, 'bench/app/report.mjs', 'the report reads results and never changes a measurement');
  write(root, 'bench/app/page/capture.ts', 'capture');
  write(root, 'bench/render/fixtures/metrics.ts', 'metrics');
  write(root, 'bench/app/run.test.mjs', 'a test');
  write(root, 'bench/app/results/latest.json', '{}');
  write(root, 'bench/app/cluster-performance-2026-11-09.json', '{}');
  write(root, 'bench/app/dist/index.js', 'build output');
  write(root, 'bench/render/k8s-pod-table.bench.tsx', 'a bench');
  assert.deepEqual(harnessFiles(root), ['bench/app/page/capture.ts', 'bench/app/run.mjs', 'bench/render/fixtures/metrics.ts']);

  const first = harnessIdentity(root);
  assert.equal(first.files, 3);
  write(root, 'bench/app/run.test.mjs', 'another test');
  assert.equal(harnessIdentity(root).treeSHA256, first.treeSHA256);
  write(root, 'bench/app/page/capture.ts', 'an edited capture');
  assert.notEqual(harnessIdentity(root).treeSHA256, first.treeSHA256);
});

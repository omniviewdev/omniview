import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pluginAssetDirectory, requirePluginBundle } from './plugin-bundle.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-bench-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('an explicit empty plugin directory does not bypass bundle preparation', () => {
  assert.throws(() => pluginAssetDirectory('/host', ''), /OV_K8S_PLUGIN_DIST/);
  assert.throws(() => pluginAssetDirectory('/host', '   '), /OV_K8S_PLUGIN_DIST/);
});

test('relative external assets resolve from the host root', () => {
  assert.equal(pluginAssetDirectory('/host', '../kubernetes/ui/dist/assets'), '/kubernetes/ui/dist/assets');
});

test('missing, empty, and directory entries are not usable plugin bundles', (t) => {
  const assets = fixture(t);
  assert.throws(() => requirePluginBundle(assets), /entry\.js/);
  fs.writeFileSync(path.join(assets, 'entry.js'), '');
  assert.throws(() => requirePluginBundle(assets), /entry\.js/);
  fs.rmSync(path.join(assets, 'entry.js'));
  fs.mkdirSync(path.join(assets, 'entry.js'));
  assert.throws(() => requirePluginBundle(assets), /entry\.js/);
});

test('a nonempty regular entry is accepted without changing it', (t) => {
  const assets = fixture(t);
  const entry = path.join(assets, 'entry.js');
  fs.writeFileSync(entry, 'System.register([], function () {});');
  requirePluginBundle(assets);
  assert.equal(fs.readFileSync(entry, 'utf8'), 'System.register([], function () {});');
});

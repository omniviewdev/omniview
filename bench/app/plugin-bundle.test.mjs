import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  gitSourceIdentity,
  hashPluginBundle,
  pluginAssetDirectory,
  pluginCheckoutIdentity,
  pluginMetadataFile,
  requirePluginBundle,
} from './plugin-bundle.mjs';

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

test('default bundle follows the external Kubernetes checkout', (t) => {
  const previous = process.env.KUBERNETES_SOURCE;
  t.after(() => {
    if (previous === undefined) delete process.env.KUBERNETES_SOURCE;
    else process.env.KUBERNETES_SOURCE = previous;
  });
  process.env.KUBERNETES_SOURCE = '../selected-kubernetes';
  assert.equal(pluginAssetDirectory('/host'), '/selected-kubernetes/ui/dist/assets');
  process.env.KUBERNETES_SOURCE = ' ';
  assert.throws(() => pluginAssetDirectory('/host'), /KUBERNETES_SOURCE/);
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

test('relative plugin metadata resolves from the host root, as the Vite config does', () => {
  // Relative traversal stays rooted at the selected host on every platform.
  assert.equal(pluginMetadataFile('/host', '../kubernetes/plugin.json'), path.resolve('/host', '../kubernetes/plugin.json'));
  assert.equal(pluginMetadataFile('/host', '/elsewhere/plugin.json'), path.resolve('/elsewhere/plugin.json'));
  assert.throws(() => pluginMetadataFile('/host', ''), /OV_K8S_PLUGIN_METADATA/);
  assert.throws(() => pluginMetadataFile('/host', '  '), /OV_K8S_PLUGIN_METADATA/);
});

test('the bundle hash covers every served file by path and content, not only entry.js', (t) => {
  const assets = fixture(t);
  fs.mkdirSync(path.join(assets, 'chunks'));
  fs.writeFileSync(path.join(assets, 'entry.js'), 'entry');
  fs.writeFileSync(path.join(assets, 'chunks', 'view.js'), 'view');
  const first = hashPluginBundle(assets);
  assert.equal(first.files, 2);
  assert.equal(first.bytes, 'entry'.length + 'view'.length);
  assert.equal(first.entrySHA256, createHash('sha256').update('entry').digest('hex'));
  assert.deepEqual(hashPluginBundle(assets), first);

  fs.writeFileSync(path.join(assets, 'chunks', 'view.js'), 'VIEW');
  const edited = hashPluginBundle(assets);
  assert.equal(edited.entrySHA256, first.entrySHA256);
  assert.notEqual(edited.treeSHA256, first.treeSHA256);

  fs.renameSync(path.join(assets, 'chunks', 'view.js'), path.join(assets, 'chunks', 'other.js'));
  assert.notEqual(hashPluginBundle(assets).treeSHA256, edited.treeSHA256);
});

// Real git in throwaway repositories, isolated from the developer's git configuration.
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'bench',
  GIT_AUTHOR_EMAIL: 'bench@example.invalid',
  GIT_COMMITTER_NAME: 'bench',
  GIT_COMMITTER_EMAIL: 'bench@example.invalid',
};

function git(directory, ...args) {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', env: gitEnv });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(directory, files) {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.writeFileSync(path.join(directory, name), content);
  }
  git(directory, 'add', '--all');
  git(directory, 'commit', '--quiet', '--message', 'fixture');
}

function repository(t, files) {
  const directory = fixture(t);
  git(directory, 'init', '--quiet');
  commit(directory, files);
  return directory;
}

test('a plugin directory inside the host repository is not identified by the host commit', (t) => {
  // An uninitialized plugins/kubernetes submodule: git resolves the enclosing host repository.
  const host = repository(t, { 'README.md': 'host' });
  const plugin = path.join(host, 'plugins/kubernetes');
  fs.mkdirSync(path.join(plugin, 'ui/dist/assets'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'plugin.json'), '{}');
  fs.writeFileSync(path.join(plugin, 'ui/dist/assets/entry.js'), 'entry');
  const identity = pluginCheckoutIdentity({
    hostRoot: host,
    metadataFile: path.join(plugin, 'plugin.json'),
    assets: path.join(plugin, 'ui/dist/assets'),
  });
  assert.equal(identity.state, 'unknown');
  assert.match(identity.reason, /host repository/);
  assert.equal(identity.head, undefined);
});

test('a separate plugin checkout is identified by its own commit, dirty state and tracked diff', (t) => {
  const host = repository(t, { 'README.md': 'host' });
  const plugin = path.join(host, 'plugins/kubernetes');
  fs.mkdirSync(plugin, { recursive: true });
  git(plugin, 'init', '--quiet');
  commit(plugin, { 'plugin.json': '{"id":"kubernetes"}' });
  fs.mkdirSync(path.join(plugin, 'ui/dist/assets'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'ui/dist/assets/entry.js'), 'entry');
  const inputs = {
    hostRoot: host,
    metadataFile: path.join(plugin, 'plugin.json'),
    assets: path.join(plugin, 'ui/dist/assets'),
  };

  const clean = pluginCheckoutIdentity(inputs);
  assert.equal(clean.state, 'identified');
  assert.equal(clean.head, git(plugin, 'rev-parse', 'HEAD'));
  assert.notEqual(clean.head, git(host, 'rev-parse', 'HEAD'));
  assert.equal(clean.dirty, false);

  // Untracked files are outside this identity, as in real-resource.mjs.
  fs.writeFileSync(path.join(plugin, 'notes.txt'), 'scratch');
  assert.equal(pluginCheckoutIdentity(inputs).dirty, false);

  fs.writeFileSync(path.join(plugin, 'plugin.json'), '{"id":"changed"}');
  const dirty = pluginCheckoutIdentity(inputs);
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.head, clean.head);
  assert.notEqual(dirty.trackedDiffSHA256, clean.trackedDiffSHA256);
});

test('inputs that do not prove a plugin checkout are unknown', (t) => {
  const loose = fixture(t);
  fs.mkdirSync(path.join(loose, 'assets'));
  fs.writeFileSync(path.join(loose, 'plugin.json'), '{}');
  fs.writeFileSync(path.join(loose, 'assets/entry.js'), 'entry');
  assert.match(
    pluginCheckoutIdentity({ hostRoot: loose, metadataFile: path.join(loose, 'plugin.json'), assets: path.join(loose, 'assets') }).reason,
    /not inside a git checkout/,
  );

  const plugin = repository(t, { 'README.md': 'plugin' });
  fs.mkdirSync(path.join(plugin, 'assets'));
  fs.writeFileSync(path.join(plugin, 'plugin.json'), '{}');
  fs.writeFileSync(path.join(plugin, 'assets/entry.js'), 'entry');
  assert.match(
    pluginCheckoutIdentity({ hostRoot: loose, metadataFile: path.join(plugin, 'plugin.json'), assets: path.join(plugin, 'assets') }).reason,
    /not a tracked file/,
  );

  git(plugin, 'add', 'plugin.json');
  git(plugin, 'commit', '--quiet', '--message', 'metadata');
  assert.match(
    pluginCheckoutIdentity({ hostRoot: loose, metadataFile: path.join(plugin, 'plugin.json'), assets: path.join(loose, 'assets') }).reason,
    /outside the repository/,
  );
});

test('a failed git lookup is unknown, not an exception or an empty commit', (t) => {
  const repo = repository(t, { 'plugin.json': '{}', 'assets/entry.js': 'entry' });
  const missingGit = { executable: path.join(repo, 'no-such-git') };
  assert.equal(gitSourceIdentity(repo, missingGit).state, 'unknown');
  assert.equal(
    pluginCheckoutIdentity({ hostRoot: repo, metadataFile: path.join(repo, 'plugin.json'), assets: path.join(repo, 'assets') }, missingGit).state,
    'unknown',
  );
  assert.equal(gitSourceIdentity(path.join(repo, 'does-not-exist')).state, 'unknown');
  assert.equal(gitSourceIdentity(fixture(t)).state, 'unknown');
});

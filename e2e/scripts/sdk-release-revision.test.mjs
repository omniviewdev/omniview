import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/sdk-release-revision.sh', import.meta.url));

test('the E2E SDK revision is the commit of the plugin-sdk release tag that go.mod requires', () => {
  const arena = mkdtempSync(join(tmpdir(), 'omniview-sdk-release-'));
  const git = (cwd, ...args) => {
    const child = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout.trim();
  };
  try {
    const sdk = join(arena, 'plugin-sdk');
    git(arena, 'init', '-q', sdk);
    git(sdk, 'config', 'commit.gpgsign', 'false');
    const commit = message => {
      git(sdk, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', message);
      return git(sdk, 'rev-parse', 'HEAD');
    };
    const released = commit('v0.8.0');
    git(sdk, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'tag', '-a', 'v0.8.0', '-m', 'release');
    const lightweight = commit('v0.8.1');
    git(sdk, 'tag', 'v0.8.1');
    commit('unreleased');

    const run = modfile => {
      const path = join(arena, 'go.mod');
      writeFileSync(path, modfile);
      return spawnSync('/bin/bash', [script, path], { encoding: 'utf8', env: { ...process.env, OMNIVIEW_PLUGIN_SDK_REPOSITORY: sdk } });
    };
    const block = version => `module example.com/host\n\ngo 1.26\n\nrequire (\n\tgithub.com/other/dep v1.2.3\n\tgithub.com/omniviewdev/plugin-sdk ${version}\n)\n`;

    let child = run(block('v0.8.0'));
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), released, 'annotated tag resolves to the tagged commit, not the tag object');

    child = run(`module example.com/host\n\nrequire github.com/omniviewdev/plugin-sdk v0.8.1 // indirect\n`);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), lightweight, 'single-line require and lightweight tag');

    for (const [name, modfile] of [
      ['pseudo-version', block('v0.7.3-0.20261030014826-32a3358caa78')],
      ['pre-release', block('v0.9.0-rc.1')],
      ['unpublished tag', block('v9.9.9')],
      ['replace directive', `${block('v0.8.0')}\nreplace github.com/omniviewdev/plugin-sdk => ../plugin-sdk\n`],
      ['replace block', `${block('v0.8.0')}\nreplace (\n\tgithub.com/omniviewdev/plugin-sdk v0.8.0 => ../plugin-sdk\n)\n`],
      ['missing require', 'module example.com/host\n\nrequire github.com/other/dep v1.2.3\n'],
    ]) {
      child = run(modfile);
      assert.notEqual(child.status, 0, name);
      assert.equal(child.stdout, '', `${name}: no revision is printed`);
    }
  } finally { rmSync(arena, { recursive: true, force: true }); }
});

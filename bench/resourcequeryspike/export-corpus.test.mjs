import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const selected = 'da0c53be2da636d3833b7ca1e73f8a6c8d26b5c7';
const launcher = process.env.OMNIVIEW_P01_BASELINE_ENV;
const source = resolve(process.env.OMNIVIEW_P01_SDK ?? resolve(here, '../../../plugin-sdk'));
function run(binary, args, cwd) {
  const p = spawnSync(binary, args, { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.equal(p.status, 0, `${binary}: ${p.error ?? p.stderr}`);
  return p.stdout;
}

test('export builds committed SDK inputs and preserves dirty caller checkout', async () => {
  assert.ok(launcher, 'set OMNIVIEW_P01_BASELINE_ENV to the reviewed launcher');
  const owned = await mkdtemp(join(tmpdir(), 'p01-export-regression-'));
  const sdk = join(owned, 'sdk');
  const git = (...args) => run(launcher, ['git', '-c', `core.hooksPath=${devNull}`, ...args], owned);
  try {
    git('clone', '--no-local', '--no-hardlinks', '--no-checkout', '--', source, sdk);
    git('-C', sdk, 'checkout', '--detach', selected);
    const modPath = join(sdk, 'go.mod');
    const dirtyMod = `${await readFile(modPath, 'utf8')}\ninvalid-directive committed-input-regression\n`;
    await writeFile(modPath, dirtyMod);
    const untracked = join(sdk, 'internal/resourceconformance/p01_untracked.go');
    const ignored = join(sdk, 'internal/resourceconformance/p01_ignored.go');
    const poison = 'package resourceconformance\nfunc init(){panic("caller checkout must not execute")}\n';
    await writeFile(untracked, poison);
    await writeFile(join(sdk, '.git/info/exclude'), '/internal/resourceconformance/p01_ignored.go\n');
    await writeFile(ignored, poison);
    const statusBefore = git('-C', sdk, 'status', '--porcelain=v1', '--untracked-files=all');
    // Exercise the real CLI with its outputs confined to this owned directory.
    const script = join(owned, 'export-corpus.mjs');
    await copyFile(join(here, 'export-corpus.mjs'), script);
    run(launcher, ['node', script, sdk, launcher], owned);
    const corpus = await readFile(join(owned, 'corpus.json'));
    const provenance = JSON.parse(await readFile(join(owned, 'corpus-provenance.json'), 'utf8'));
    assert.equal(createHash('sha256').update(corpus).digest('hex'), 'a9d39f6e56aef5d8b2568332d9d93b5dd602e6fe96f5342abf0f4b1e8e50b1a0');
    assert.equal(provenance.selectedSDK, selected);
    assert.equal(provenance.corpusSHA256, createHash('sha256').update(corpus).digest('hex'));
    assert.equal(provenance.temporaryExporterRemoved, true);
    assert.equal(provenance.privateCheckoutRemoved, true);
    assert.equal(git('-C', sdk, 'status', '--porcelain=v1', '--untracked-files=all'), statusBefore);
    assert.equal(await readFile(modPath, 'utf8'), dirtyMod);
    assert.equal(await readFile(untracked, 'utf8'), poison);
    assert.equal(await readFile(ignored, 'utf8'), poison);
  } finally {
    await rm(owned, { recursive: true });
  }
});

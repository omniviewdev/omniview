import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyAptArchives } from './verify-apt-archives.mjs';

function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'omniview-apt-verifier-')));
  t.after(() => rmSync(directory, { recursive: true }));
  const filename = join(directory, 'sample_1%3a2.0-1_all.deb');
  const content = Buffer.from('indexed package payload');
  writeFileSync(filename, content);
  const metadata = `Package: sample\nVersion: 1:2.0-1\nArchitecture: all\nSize: ${content.length}\nSHA256: ${createHash('sha256').update(content).digest('hex')}\n`;
  return { directory, filename, content, metadata };
}

test('authenticates indexed payloads with encoded epochs without modifying them', async t => {
  const f = fixture(t);
  assert.equal(await verifyAptArchives(f.directory, f.metadata), 1);
  assert.deepEqual(readFileSync(f.filename), f.content);
});

test('rejects same-length altered bytes before native installation', async t => {
  const f = fixture(t);
  const changed = Buffer.from(f.content);
  changed[0] ^= 0xff;
  writeFileSync(f.filename, changed);
  await assert.rejects(verifyAptArchives(f.directory, f.metadata), /differs from authenticated indexes/);
  assert.deepEqual(readFileSync(f.filename), changed);
});

test('rejects an unindexed package or architecture even when its bytes match', async t => {
  const f = fixture(t);
  await assert.rejects(verifyAptArchives(f.directory, f.metadata.replace('Architecture: all', 'Architecture: amd64')), /absent from authenticated indexes/);
  await assert.rejects(verifyAptArchives(f.directory, f.metadata.replace('Package: sample', 'Package: other')), /absent from authenticated indexes/);
});

test('rejects a cached symlink rather than hashing its target', async t => {
  const f = fixture(t);
  rmSync(f.filename);
  const target = join(f.directory, 'external-payload');
  writeFileSync(target, f.content);
  symlinkSync(target, f.filename);
  await assert.rejects(verifyAptArchives(f.directory, f.metadata), /not the indexed regular file/);
  assert.deepEqual(readFileSync(target), f.content);
});

test('rejects a redirected cache directory', async t => {
  const f = fixture(t);
  const alias = `${f.directory}-alias`;
  t.after(() => rmSync(alias));
  symlinkSync(f.directory, alias);
  await assert.rejects(verifyAptArchives(alias, f.metadata), /canonical directory/);
});

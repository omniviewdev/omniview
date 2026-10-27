import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareAptArchives, verifyAptArchives } from './verify-apt-archives.mjs';

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

function candidateFixture(t) {
  const f = fixture(t);
  const directory = join(f.directory, 'cache');
  mkdirSync(directory, { mode: 0o755 });
  const filename = join(directory, basename(f.filename));
  copyFileSync(f.filename, filename);
  return { ...f, arena: f.directory, directory, filename };
}

const newerMetadata = f => f.metadata.replace('Version: 1:2.0-1', 'Version: 1:3.0-1');
const obsoleteFirst = 'Package: aaa\nVersion: 2\nArchitecture: all\nSize: 3\nSHA256: ' + createHash('sha256').update('new').digest('hex') + '\n\n';

test('index rotation reuses every still-indexed verified payload without replacing its directory', async t => {
  const f = candidateFixture(t);
  const inode = lstatSync(f.directory).ino;
  const report = await prepareAptArchives(f.directory, f.metadata);
  assert.deepEqual(report, { count: 1, retainedDirectory: null });
  assert.equal(lstatSync(f.directory).ino, inode);
  assert.deepEqual(readFileSync(f.filename), f.content);
});

test('obsolete known versions retain the entire owned bundle and start an empty archive directory', async t => {
  const f = candidateFixture(t);
  const extra = Buffer.from('another indexed payload');
  const extraFilename = 'extra_1_all.deb';
  writeFileSync(join(f.directory, extraFilename), extra);
  const metadata = `Package: extra\nVersion: 1\nArchitecture: all\nSize: ${extra.length}\nSHA256: ${createHash('sha256').update(extra).digest('hex')}\n\n` + newerMetadata(f);
  const inode = lstatSync(f.directory).ino;
  const report = await prepareAptArchives(f.directory, metadata);
  assert.equal(report.count, 0);
  assert.equal(lstatSync(report.retainedDirectory).ino, inode);
  assert.notEqual(lstatSync(f.directory).ino, inode);
  assert.equal(lstatSync(f.directory).uid, process.getuid());
  assert.deepEqual(readFileSync(join(report.retainedDirectory, basename(f.filename))), f.content);
  assert.deepEqual(readFileSync(join(report.retainedDirectory, extraFilename)), extra);
  assert.equal(existsSync(f.filename), false, 'no obsolete archive enters the fresh active directory');
  assert.deepEqual(readdirSync(f.directory), []);
});

test('strict verifier still rejects obsolete versions rather than performing preparation', async t => {
  const f = candidateFixture(t);
  await assert.rejects(verifyAptArchives(f.directory, newerMetadata(f)), /absent from authenticated indexes/);
  assert.deepEqual(readFileSync(f.filename), f.content);
  assert.deepEqual(readdirSync(f.arena).filter(name => name.startsWith('cache.unindexed-')), []);
});

test('an obsolete first entry cannot hide later indexed tampering or invalid bundle data', async t => {
  for (const kind of ['tamper', 'symlink', 'unknown-package', 'unknown-architecture', 'malformed-metadata', 'unknown-entry']) {
    await t.test(kind, async context => {
      const f = candidateFixture(context);
      writeFileSync(join(f.directory, 'aaa_1_all.deb'), 'old');
      let metadata = f.metadata;
      let error;
      if (kind === 'tamper') {
        const changed = Buffer.from(f.content); changed[0] ^= 0xff;
        writeFileSync(f.filename, changed);
        error = /differs from authenticated indexes/;
      } else if (kind === 'symlink') {
        rmSync(f.filename);
        symlinkSync(join(f.arena, basename(f.filename)), f.filename);
        error = /not the indexed regular file/;
      } else if (kind === 'unknown-package') {
        metadata = metadata.replace('Package: sample', 'Package: other');
        error = /absent from authenticated indexes/;
      } else if (kind === 'unknown-architecture') {
        metadata = metadata.replace('Architecture: all', 'Architecture: arm64');
        error = /absent from authenticated indexes/;
      } else if (kind === 'malformed-metadata') {
        metadata = metadata.replace(/SHA256: [a-f0-9]+/, 'SHA256: invalid');
        error = /authenticated.*metadata/;
      } else {
        writeFileSync(join(f.directory, 'foreign-data'), 'must not move');
        error = /unknown.*entry/i;
      }
      const inode = lstatSync(f.directory).ino;
      await assert.rejects(prepareAptArchives(f.directory, obsoleteFirst + metadata), error);
      assert.equal(lstatSync(f.directory).ino, inode, 'a bad bundle is not turned into a successful cold preparation');
      assert.equal(readFileSync(join(f.directory, 'aaa_1_all.deb'), 'utf8'), 'old');
      assert.deepEqual(readdirSync(f.arena).filter(name => name.startsWith('cache.unindexed-')), []);
    });
  }
});

test('held installed-state records do not shadow authenticated cached archives', async t => {
  const f = candidateFixture(t);
  const held = 'Package: sample\nVersion: 1:1.0-1\nArchitecture: all\nStatus: hold ok installed\nSize: 23\n\n';
  const inode = lstatSync(f.directory).ino;
  const report = await prepareAptArchives(f.directory, held + f.metadata);
  assert.deepEqual(report, { count: 1, retainedDirectory: null });
  assert.equal(lstatSync(f.directory).ino, inode);
  assert.deepEqual(readFileSync(f.filename), f.content);
});

test('installed-status-only metadata cannot authorize cached bytes absent from fresh indexes', async t => {
  const f = candidateFixture(t);
  const installed = 'Package: sample\nVersion: 1:2.0-1\nArchitecture: all\nStatus: install ok installed\nSize: 23\n\n';
  const report = await prepareAptArchives(f.directory, installed + newerMetadata(f));
  assert.equal(report.count, 0);
  assert.equal(existsSync(f.filename), false);
  assert.deepEqual(readFileSync(join(report.retainedDirectory, basename(f.filename))), f.content);
});

test('public, redirected or unknown cache namespaces are refused without moving their data', async t => {
  const f = candidateFixture(t);
  chmodSync(f.directory, 0o777);
  await assert.rejects(prepareAptArchives(f.directory, newerMetadata(f)), /owned|writ/i);
  assert.deepEqual(readFileSync(f.filename), f.content);
  chmodSync(f.directory, 0o755);
  symlinkSync(f.directory, join(f.arena, 'alias'));
  await assert.rejects(prepareAptArchives(join(f.arena, 'alias'), newerMetadata(f)), /canonical/i);
  symlinkSync(f.arena, join(f.directory, 'partial'));
  await assert.rejects(prepareAptArchives(f.directory, newerMetadata(f)), /partial/i);
  assert.deepEqual(readFileSync(f.filename), f.content);
});

test('directory replacement during verification never moves the replacement or its unknown data', async t => {
  const f = candidateFixture(t);
  const pending = prepareAptArchives(f.directory, newerMetadata(f));
  const original = join(f.arena, 'original');
  renameSync(f.directory, original);
  mkdirSync(f.directory, { mode: 0o755 });
  writeFileSync(join(f.directory, 'foreign-data'), 'leave replacement untouched');
  await assert.rejects(pending, /changed during/i);
  assert.equal(readFileSync(join(f.directory, 'foreign-data'), 'utf8'), 'leave replacement untouched');
  assert.deepEqual(readFileSync(join(original, basename(f.filename))), f.content);
});

test('backend preparation CLI handles a missing old version without treating a metadata command failure as staleness', t => {
  const f = candidateFixture(t);
  const tools = join(f.arena, 'tools');
  mkdirSync(tools);
  // External apt-cache is unavailable on Darwin; the real CLI and filesystem
  // boundaries run here, not an installation or Linux runtime substitute.
  const aptCache = join(tools, 'apt-cache');
  writeFileSync(aptCache, `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args.length !== 2 || args[0] !== 'show' || args[1] !== 'sample') process.exit(100);\nprocess.stdout.write(${JSON.stringify(newerMetadata(f))});\n`, { mode: 0o700 });
  const cli = fileURLToPath(new URL('./verify-apt-archives.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [cli, f.directory], { env: { ...process.env, PATH: tools }, stdio: 'pipe' }));
  assert.deepEqual(readFileSync(f.filename), f.content);
  assert.deepEqual(readdirSync(f.arena).filter(name => name.startsWith('cache.unindexed-')), []);
  execFileSync(process.execPath, [cli, f.directory, '--prepare'], { env: { ...process.env, PATH: tools }, stdio: 'pipe' });
  assert.deepEqual(readdirSync(f.directory), []);
  const retained = readdirSync(f.arena).find(name => name.startsWith('cache.unindexed-'));
  assert.deepEqual(readFileSync(join(f.arena, retained, 'archives', basename(f.filename))), f.content);
  copyFileSync(join(f.arena, retained, 'archives', basename(f.filename)), f.filename);
  writeFileSync(aptCache, `#!${process.execPath}\nprocess.exit(42);\n`, { mode: 0o700 });
  assert.throws(() => execFileSync(process.execPath, [cli, f.directory, '--prepare'], { env: { ...process.env, PATH: tools }, stdio: 'pipe' }));
  assert.deepEqual(readFileSync(f.filename), f.content);
  assert.equal(readdirSync(f.arena).filter(name => name.startsWith('cache.unindexed-')).length, 1);
});

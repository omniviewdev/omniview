import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, realpath, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyCandidate } from './verify-candidate.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const expected = { hostCommit: 'a'.repeat(40), kubernetesCommit: 'b'.repeat(40), version: 'v0.36.0' };

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'candidate-transport-test-')));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = Buffer.from('transport fixture; structural archive checks belong to canonical Go producer');
  const protocol = Buffer.from(JSON.stringify({ protocol: 'workspace', versions: ['12.14.0'], atomicDist: true, peers: true, runtime: true }));
  const proof = {
    schemaVersion: 1,
    archive: 'kubernetes-linux_amd64.tar.gz',
    archiveSHA256: sha(archive),
    backendSHA256: sha('backend fixture'),
    assetFiles: 1,
    platform: 'linux/amd64',
    commits: { host: expected.hostCommit, sdk: 'c'.repeat(40), kubernetes: expected.kubernetesCommit },
    sdk: { module: 'github.com/omniviewdev/plugin-sdk', version: 'v0.20.0', commit: 'c'.repeat(40), sum: `h1:${'A'.repeat(43)}=`, goModSum: `h1:${'B'.repeat(43)}=` },
    npmVersion: '0.36.0',
    versionTransform: 'package.json .version = npmVersion',
    packages: ['providers', 'runtime', 'vite-plugin'].map(name => ({ package: `@omniviewdev/${name}`, path: `packages/omniviewdev-${name}/package.json`, beforeVersion: '0.35.0', version: '0.36.0', beforeSHA256: sha(`${name} before`), afterSHA256: sha(`${name} after`) })),
    linkEvidenceSHA256: sha(protocol),
  };
  await writeFile(join(directory, proof.archive), archive);
  await writeFile(join(directory, 'link-protocol.json'), protocol);
  const save = () => writeFile(join(directory, 'candidate.json'), JSON.stringify(proof));
  await save();
  return { directory, proof, save };
}

test('candidate transport binds actual bytes to exact cohort and npm transform', async t => {
  const { directory, proof } = await fixture(t);
  const verified = await verifyCandidate(directory, expected);
  assert.equal(verified.archiveSHA256, proof.archiveSHA256);
  assert.equal(verified.npmVersion, '0.36.0');
});

for (const [name, mutate] of Object.entries({
  'different host commit': proof => { proof.commits.host = 'd'.repeat(40); },
  'different Kubernetes commit': proof => { proof.commits.kubernetes = 'd'.repeat(40); },
  'arbitrary SDK checkout': proof => { proof.sdk.commit = 'd'.repeat(40); },
  'missing SDK module checksum': proof => { delete proof.sdk.sum; },
  'missing canonical backend hash': proof => { delete proof.backendSHA256; },
  'frontend-only receipt': proof => { proof.assetFiles = 0; },
  'different npm stamp': proof => { proof.packages[1].version = '0.35.0'; },
  'duplicate package stamp': proof => { proof.packages[1] = proof.packages[0]; },
  'missing protocol digest': proof => { delete proof.linkEvidenceSHA256; },
  'different archive name': proof => { proof.archive = '../unverified.tar.gz'; },
})) {
  test(`candidate proof refuses ${name}`, async t => {
    const { directory, proof, save } = await fixture(t);
    mutate(proof);
    await save();
    await assert.rejects(verifyCandidate(directory, expected), /Incomplete candidate proof/);
  });
}

test('candidate transport fails on replaced bytes, missing evidence and unproved pnpm', async t => {
  const { directory, proof, save } = await fixture(t);
  const archive = join(directory, proof.archive);
  const original = await readFile(archive);
  await writeFile(archive, 'changed after publication');
  await assert.rejects(verifyCandidate(directory, expected), /archive digest/);
  await writeFile(archive, original);
  const report = join(directory, 'link-protocol.json');
  await writeFile(report, '{}');
  await assert.rejects(verifyCandidate(directory, expected), /protocol report digest/);
  proof.linkEvidenceSHA256 = sha('{}');
  await save();
  await assert.rejects(verifyCandidate(directory, expected), /pinned pnpm protocol report/);
  await unlink(report);
  await assert.rejects(verifyCandidate(directory, expected), /ENOENT/);
});

test('candidate transport refuses symlinks and oversized inputs before streaming', async t => {
  const { directory, proof } = await fixture(t);
  const archive = join(directory, proof.archive);
  const foreign = join(directory, 'foreign');
  await writeFile(foreign, 'foreign bytes');
  await unlink(archive);
  await symlink(foreign, archive);
  await assert.rejects(verifyCandidate(directory, expected), /bounded canonical regular file/);
  await unlink(archive);
  await writeFile(archive, '');
  await truncate(archive, 1024 * 1024 * 1024 + 1);
  await assert.rejects(verifyCandidate(directory, expected), /bounded canonical regular file/);
  await writeFile(join(directory, 'candidate.json'), Buffer.alloc(1024 * 1024 + 1, ' '));
  await assert.rejects(verifyCandidate(directory, expected), /bounded canonical regular file/);
});

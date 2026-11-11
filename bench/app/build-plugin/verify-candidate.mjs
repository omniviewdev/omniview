import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const archiveName = 'kubernetes-linux_amd64.tar.gz';
const jsonLimit = 1024 * 1024;
const archiveLimit = 1024 * 1024 * 1024;
const commit = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const digest = /^[a-f0-9]{64}$/;
const moduleSum = /^h1:[A-Za-z0-9+/]{43}=$/;
const packages = ['providers', 'runtime', 'vite-plugin'];

async function regularFile(filename, limit) {
  const info = await lstat(filename);
  if (!info.isFile() || info.size > limit || await realpath(filename) !== filename) {
    throw new Error(`Candidate input is not a bounded canonical regular file: ${filename}`);
  }
}

async function boundedJSON(filename) {
  await regularFile(filename, jsonLimit);
  const raw = await readFile(filename);
  if (raw.length > jsonLimit) throw new Error('Candidate JSON exceeds size bound');
  return { raw, value: JSON.parse(raw.toString('utf8')) };
}

function requireProof(condition, message) {
  if (!condition) throw new Error(`Incomplete candidate proof: ${message}`);
}

// This verifies transport/provenance, not native wire negotiation. The unchanged
// archive smoke and chunk-retirement tests run only after these exact bytes pass.
export async function verifyCandidate(directory, expected) {
  requireProof(isAbsolute(directory) && resolve(directory) === directory, 'canonical artifact directory');
  const version = expected.version.replace(/^v/, '');
  requireProof(commit.test(expected.hostCommit) && commit.test(expected.kubernetesCommit) && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(version), 'exact host/plugin commits and npm version');
  const { value: proof } = await boundedJSON(join(directory, 'candidate.json'));
  requireProof(proof.schemaVersion === 1 && proof.archive === archiveName && proof.platform === 'linux/amd64', 'archive schema/platform');
  requireProof(digest.test(proof.archiveSHA256) && digest.test(proof.backendSHA256) && digest.test(proof.linkEvidenceSHA256) && Number.isInteger(proof.assetFiles) && proof.assetFiles > 0, 'canonical producer hashes and frontend output');
  requireProof(proof.commits?.host === expected.hostCommit && proof.commits?.kubernetes === expected.kubernetesCommit && commit.test(proof.commits?.sdk), 'requested source cohort');
  requireProof(proof.sdk?.module === 'github.com/omniviewdev/plugin-sdk' && /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(proof.sdk?.version) && proof.sdk?.commit === proof.commits.sdk && moduleSum.test(proof.sdk?.sum) && moduleSum.test(proof.sdk?.goModSum), 'published host-selected SDK identity');
  requireProof(proof.npmVersion === version && proof.versionTransform === 'package.json .version = npmVersion' && Array.isArray(proof.packages) && proof.packages.length === packages.length, 'npm version transform');
  for (const name of packages) {
    const stamps = proof.packages.filter(stamp => stamp.package === `@omniviewdev/${name}`);
    requireProof(stamps.length === 1, `unique ${name} stamp`);
    const stamp = stamps[0];
    requireProof(stamp.path === `packages/omniviewdev-${name}/package.json` && stamp.version === version && typeof stamp.beforeVersion === 'string' && stamp.beforeVersion.length > 0 && digest.test(stamp.beforeSHA256) && digest.test(stamp.afterSHA256), `${name} version provenance`);
  }
  const { raw, value: protocol } = await boundedJSON(join(directory, 'link-protocol.json'));
  requireProof(createHash('sha256').update(raw).digest('hex') === proof.linkEvidenceSHA256, 'protocol report digest');
  requireProof(protocol.protocol === 'workspace' && Array.isArray(protocol.versions) && protocol.versions.length === 1 && protocol.versions[0] === '12.14.0' && protocol.atomicDist === true && protocol.peers === true && protocol.runtime === true, 'actual pinned pnpm protocol report');
  const archive = join(directory, archiveName);
  await regularFile(archive, archiveLimit);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(archive)) {
    size += chunk.length;
    if (size > archiveLimit) throw new Error('Candidate archive exceeds size bound');
    hash.update(chunk);
  }
  requireProof(size > 0 && hash.digest('hex') === proof.archiveSHA256, 'archive digest');
  return proof;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const names = new Set(['directory', 'host-ref', 'kubernetes-ref', 'version']);
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index].replace(/^--/, '');
    if (!names.has(key) || options[key] || !process.argv[index + 1]) throw new Error('Expected --directory, --host-ref, --kubernetes-ref and --version');
    options[key] = process.argv[index + 1];
  }
  if (Object.keys(options).length !== names.size) throw new Error('All candidate verification arguments are required');
  const proof = await verifyCandidate(options.directory, { hostCommit: options['host-ref'], kubernetesCommit: options['kubernetes-ref'], version: options.version });
  console.log(`Verified ${proof.archive} SHA-256 ${proof.archiveSHA256}; native wire proof remains a separate gate.`);
}

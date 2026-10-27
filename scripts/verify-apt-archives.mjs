import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const versionPattern = /^[0-9][0-9A-Za-z.+:~\-]*$/;
class ObsoleteAptArchiveError extends Error {}

function archiveIdentity(filename) {
  const match = /^([a-z0-9][a-z0-9+.-]*)_([^_]+)_([a-z0-9][a-z0-9-]*)\.deb$/.exec(filename);
  if (!match) throw Error(`Invalid cached package filename: ${filename}`);
  const version = decodeURIComponent(match[2]);
  if (!versionPattern.test(version)) throw new Error('Invalid cached package version');
  return { name: match[1], version, architecture: match[3] };
}

// Metadata comes from apt's freshly authenticated package indexes, never cache.
export async function verifyAptArchives(directory, metadata) {
  if (resolve(directory) !== realpathSync(directory) || !lstatSync(directory).isDirectory()) throw new Error('Package cache must be a canonical directory');
  const archives = readdirSync(directory).filter(name => name.endsWith('.deb')).sort().map(filename => ({ filename, ...archiveIdentity(filename) }));
  if (!archives.length) return 0;
  for (const archive of archives) {
    const info = lstatSync(resolve(directory, archive.filename));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Cached package is not the indexed regular file: ${archive.filename}`);
  }
  metadata ??= execFileSync('apt-cache', ['show', ...new Set(archives.map(item => item.name))], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const records = metadata.split(/\n\s*\n/).filter(Boolean).map(block => Object.fromEntries(block.split('\n').filter(line => /^(Package|Version|Architecture|SHA256|Size|Filename|Status): /.test(line)).map(line => {
    const separator = line.indexOf(': ');
    return [line.slice(0, separator), line.slice(separator + 2).trim()];
  }))).filter(record => {
    // apt-cache also emits dpkg's installed-state-only records. They are not
    // authenticated index evidence and must never authorize archive bytes.
    return !(record.Status && !record.Filename && !record.SHA256);
  });
  for (const record of records) {
    if (!/^[a-z0-9][a-z0-9+.-]*$/.test(record.Package ?? '') || !versionPattern.test(record.Version ?? '') || !/^[a-z0-9][a-z0-9-]*$/.test(record.Architecture ?? '') || !/^[a-f0-9]{64}$/.test(record.SHA256 ?? '') || !/^[0-9]+$/.test(record.Size ?? '')) throw new Error('Invalid authenticated package metadata');
  }
  const obsolete = [];
  for (const archive of archives) {
    const known = records.some(record => record.Package === archive.name && record.Architecture === archive.architecture);
    if (!known) throw new Error(`Cached package is absent from authenticated indexes: ${archive.filename}`);
    const expected = records.find(record => record.Package === archive.name && record.Version === archive.version && record.Architecture === archive.architecture);
    if (!expected) {
      obsolete.push(archive.filename);
      continue;
    }
    const path = resolve(directory, archive.filename);
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== Number(expected.Size)) throw new Error(`Cached package is not the indexed regular file: ${archive.filename}`);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    const after = lstatSync(path);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || digest.digest('hex') !== expected.SHA256) throw new Error(`Cached package differs from authenticated indexes: ${archive.filename}`);
  }
  // Inspect every candidate first: an obsolete version cannot mask later
  // indexed corruption, an unknown package/architecture, or invalid metadata.
  if (obsolete.length) throw new ObsoleteAptArchiveError(`Cached package is absent from authenticated indexes: ${obsolete.join(', ')}`);
  return archives.length;
}

export async function prepareAptArchives(directory, metadata) {
  if (typeof process.getuid !== 'function') throw new Error('Package cache preparation requires Unix ownership verification');
  if (resolve(directory) !== directory || realpathSync(directory) !== directory) throw new Error('Package cache must be a canonical directory');
  const before = lstatSync(directory, { bigint: true });
  if (!before.isDirectory() || before.uid !== BigInt(process.getuid()) || (before.mode & 0o022n) !== 0n) throw new Error('Package cache must be an owned directory without group/other write access');
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.deb')) throw new Error(`Unknown package cache entry: ${entry}`);
  }
  const unchanged = () => {
    const after = lstatSync(directory, { bigint: true });
    if (realpathSync(directory) !== directory || before.dev !== after.dev || before.ino !== after.ino || before.uid !== after.uid || before.mode !== after.mode || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('Package cache changed during verification');
  };
  try {
    const count = await verifyAptArchives(directory, metadata);
    unchanged();
    return { count, retainedDirectory: null };
  } catch (error) {
    if (!(error instanceof ObsoleteAptArchiveError)) throw error;
    unchanged();
    const retainedDirectory = join(mkdtempSync(`${directory}.unindexed-`), 'archives');
    unchanged();
    renameSync(directory, retainedDirectory);
    mkdirSync(directory, { mode: Number(before.mode & 0o777n) });
    return { count: 0, retainedDirectory };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prepare = process.argv[3] === '--prepare';
  if (process.argv.length !== 3 && !(process.argv.length === 4 && prepare)) throw new Error('Usage: verify-apt-archives.mjs DIRECTORY [--prepare]');
  const report = prepare ? await prepareAptArchives(process.argv[2]) : { count: await verifyAptArchives(process.argv[2]), retainedDirectory: null };
  if (report.retainedDirectory) console.log(`Obsolete archive candidate retained at ${report.retainedDirectory}; active archive directory starts empty`);
  console.log(`Verified ${report.count} cached Linux package archives against authenticated indexes`);
}

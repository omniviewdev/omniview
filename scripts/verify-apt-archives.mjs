import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function archiveIdentity(filename) {
  const match = /^([a-z0-9][a-z0-9+.-]*)_([^_]+)_([a-z0-9][a-z0-9-]*)\.deb$/.exec(filename);
  if (!match) throw Error(`Invalid cached package filename: ${filename}`);
  const version = decodeURIComponent(match[2]);
  if (!/^[0-9][0-9A-Za-z.+:~\-]*$/.test(version)) throw Error('Invalid cached package version');
  return { name: match[1], version, architecture: match[3] };
}

// Metadata comes from apt's freshly authenticated package indexes, never cache.
export async function verifyAptArchives(directory, metadata) {
  if (resolve(directory) !== realpathSync(directory) || !lstatSync(directory).isDirectory()) throw Error('Package cache must be a canonical directory');
  const archives = readdirSync(directory).filter(name => name.endsWith('.deb')).map(filename => ({ filename, ...archiveIdentity(filename) }));
  if (!archives.length) return 0;
  metadata ??= execFileSync('apt-cache', ['show', '--no-all-versions', ...new Set(archives.map(item => `${item.name}=${item.version}`))], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const records = metadata.split(/\n\s*\n/).filter(Boolean).map(block => Object.fromEntries(block.split('\n').filter(line => /^(Package|Version|Architecture|SHA256|Size): /.test(line)).map(line => {
    const separator = line.indexOf(': ');
    return [line.slice(0, separator), line.slice(separator + 2).trim()];
  })));
  for (const archive of archives) {
    const expected = records.find(record => record.Package === archive.name && record.Version === archive.version && record.Architecture === archive.architecture);
    if (!expected || !/^[a-f0-9]{64}$/.test(expected.SHA256 ?? '') || !/^[0-9]+$/.test(expected.Size ?? '')) throw Error(`Cached package is absent from authenticated indexes: ${archive.filename}`);
    const path = resolve(directory, archive.filename);
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== Number(expected.Size)) throw Error(`Cached package is not the indexed regular file: ${archive.filename}`);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    const after = lstatSync(path);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || digest.digest('hex') !== expected.SHA256) throw Error(`Cached package differs from authenticated indexes: ${archive.filename}`);
  }
  return archives.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = await verifyAptArchives(process.argv[2]);
  console.log(`Verified ${count} cached Linux package archives against authenticated indexes`);
}

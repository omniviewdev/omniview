import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const kind = 'omniview-e2e-native-tool-cache-v2';
const entries = ['.owner.json', 'go-mod', 'bootstrap-go-build', 'pnpm-store', 'playwright-browsers'];
function fail(reason) { throw Error(`E2E tool cache ${reason}; choose a fresh owned cache path, never adopt or repair unknown contents`); }
function absolute(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) fail('requires an absolute canonical cache path');
  for (let index = 0; index < path.length; index++) {
    const code = path.charCodeAt(index);
    if (code < 32 || code === 127) fail('requires a cache path without control characters');
  }
}
function requireCacheOwnershipSupport() {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') fail('Windows cache ownership verification is unavailable');
}
function identity(info) { return { dev: String(info.dev), ino: String(info.ino), uid: String(info.uid) }; }
function same(a, b) {
  const left = identity(a), right = identity(b);
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid;
}
function exactIdentity(value) {
  return value && Object.keys(value).sort().join(',') === 'dev,ino,uid' && Object.values(value).every(part => typeof part === 'string' && /^(0|[1-9][0-9]*)$/.test(part));
}
function privateDirectory(path) {
  const info = lstatSync(path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path || (process.getuid && info.uid !== BigInt(process.getuid())) || (process.platform !== 'win32' && (info.mode & 0o777n) !== 0o700n)) fail('directory must be private, owned and canonical');
  return info;
}
function prospective(path) {
  const tail = [];
  let parent = resolve(path);
  for (;;) {
    try { return join(realpathSync(parent), ...tail); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      tail.unshift(basename(parent));
      parent = next;
    }
  }
}
function contains(root, path) {
  const child = relative(root, path);
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
function rejectEnclosingBoundaries(root) {
  for (let directory = prospective(root); ; directory = dirname(directory)) {
    for (const marker of ['workspace.json', '.omniview-profile.json', '.workspace-owner.json', '.omniview-dev/repositories.json']) {
      try {
        lstatSync(join(directory, marker));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      fail('must not enter a marked workspace, collection or profile boundary');
    }
    try {
      const metadata = lstatSync(join(directory, '.omniview-dev'));
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail('collection boundary metadata is redirected or malformed');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (dirname(directory) === directory) return;
  }
}
function rejectOverlap(root, protectedRoots) {
  rejectEnclosingBoundaries(root);
  for (const path of protectedRoots) {
    const protectedRoot = prospective(path);
    if (contains(root, protectedRoot) || contains(protectedRoot, root)) fail('must not overlap selected sources, collections or protected profiles');
  }
}
function paths(root) {
  return { root, goModCache: join(root, 'go-mod'), bootstrapGoCache: join(root, 'bootstrap-go-build'), pnpmStore: join(root, 'pnpm-store', '12.14.0'), playwrightBrowsers: join(root, 'playwright-browsers') };
}
function readOwner(root, info) {
  const path = join(root, '.owner.json');
  let before;
  try { before = lstatSync(path, { bigint: true }); } catch { fail('ownership marker is missing or incomplete'); }
  if (!before.isFile() || before.isSymbolicLink() || before.size > 4096n || (process.getuid && before.uid !== BigInt(process.getuid())) || (process.platform !== 'win32' && (before.mode & 0o777n) !== 0o600n)) fail('ownership marker is not a private regular file');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let owner;
  try {
    if (!same(before, fstatSync(fd, { bigint: true }))) fail('ownership marker changed during open');
    try { owner = JSON.parse(readFileSync(fd, 'utf8')); } catch { fail('ownership marker is invalid'); }
  } finally { closeSync(fd); }
  if (owner?.schemaVersion !== 1 || owner.kind !== kind || owner.root !== root || !exactIdentity(owner.directory) || !same(owner.directory, info) || Object.keys(owner).sort().join(',') !== 'directory,kind,root,schemaVersion') fail('ownership differs from the actual directory');
}
export function readToolCache(root, { protectedRoots = [] } = {}) {
  requireCacheOwnershipSupport();
  absolute(root);
  rejectOverlap(root, protectedRoots);
  const original = privateDirectory(root);
  readOwner(root, original);
  const actual = readdirSync(root);
  if (actual.length !== entries.length || actual.some(name => !entries.includes(name))) fail('contains unknown top-level data');
  const cache = paths(root);
  for (const path of [cache.goModCache, cache.bootstrapGoCache, join(root, 'pnpm-store'), cache.pnpmStore, cache.playwrightBrowsers]) privateDirectory(path);
  if (!same(original, privateDirectory(root))) fail('directory changed during validation');
  return cache;
}
export function initializeToolCache(root, { protectedRoots = [] } = {}) {
  requireCacheOwnershipSupport();
  absolute(root);
  rejectOverlap(root, protectedRoots);
  const parent = dirname(root);
  const info = lstatSync(parent, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(parent) !== parent || info.uid !== BigInt(process.getuid()) || (info.mode & 0o022n) !== 0n) fail('requires an existing owned canonical parent without group/other write access');
  try { mkdirSync(root, { mode: 0o700 }); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return readToolCache(root, { protectedRoots });
  }
  const directory = privateDirectory(root);
  const cache = paths(root);
  for (const path of [cache.goModCache, cache.bootstrapGoCache, join(root, 'pnpm-store'), cache.pnpmStore, cache.playwrightBrowsers]) mkdirSync(path, { mode: 0o700 });
  // This marker records only actual cache-directory creation identity. It is
  // never a managed installation receipt, source attestation or build proof.
  const fd = openSync(join(root, '.owner.json'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify({ schemaVersion: 1, kind, root, directory: identity(directory) })}\n`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  return readToolCache(root, { protectedRoots });
}
export function retirePreparationHome(privateRoot, env, { toolCache, deadline = Date.now() + 180_000 } = {}) {
  absolute(privateRoot);
  privateDirectory(privateRoot);
  const home = join(privateRoot, 'home');
  privateDirectory(home);
  if (env.HOME !== home || env.GOPATH !== join(home, 'go')) fail('cannot retire a different private preparation HOME');
  if (toolCache) {
    const actual = readToolCache(toolCache.root, { protectedRoots: [privateRoot] });
    if (env.GOMODCACHE !== actual.goModCache) fail('module-cache environment differs from its explicit owner');
    // Persistent native caches are retained. In particular, never run go clean
    // against the configured shared module cache or recursively retire its root.
  } else {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error('Inclusive E2E budget exhausted before private module-cache retirement');
    // Pin cleanup to this HOME even if a caller supplied an ambient GOMODCACHE.
    // Native Go handles its own read-only extracted module directories.
    const child = spawnSync('go', ['clean', '-modcache'], { env: { ...env, GOWORK: 'off', GOFLAGS: '', GOPATH: join(home, 'go'), GOMODCACHE: join(home, 'go', 'pkg', 'mod') }, stdio: 'inherit', timeout: Math.min(180_000, remaining) });
    if (child.error || child.status !== 0) throw Error('Private Go module-cache retirement failed; preparation HOME retained');
  }
  rmSync(privateRoot, { recursive: true });
}

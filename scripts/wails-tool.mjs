import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = 'github.com/wailsapp/wails/v3';
const commandPath = `${modulePath}/cmd/wails3`;
function fail(reason) { throw Error(`Wails tool ${reason}`); }
function nativePlatform() {
  const os = { darwin: 'darwin', linux: 'linux' }[process.platform];
  const arch = { arm64: 'arm64', x64: 'amd64' }[process.arch];
  if (!os || !arch || typeof process.getuid !== 'function') fail('native platform ownership verification is unavailable');
  return { os, arch };
}
function absolute(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || /[\x00-\x1f\x7f]/.test(path)) fail('requires an absolute canonical path');
}
function identity(info) {
  const owner = { dev: String(info.dev), ino: String(info.ino), uid: String(info.uid) };
  return info.isDirectory() ? owner : { ...owner, size: String(info.size), mtimeNs: String(info.mtimeNs) };
}
function same(expected, info) { return JSON.stringify(expected) === JSON.stringify(identity(info)); }
function directoryInfo(path) {
  absolute(path);
  const info = lstatSync(path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path || info.uid !== BigInt(process.getuid()) || (info.mode & 0o777n) !== 0o700n) fail('directory must be private, owned and canonical');
  return info;
}
function fileInfo(path) {
  absolute(path);
  const info = lstatSync(path, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== path) fail('executable must be a canonical regular file');
  if (info.uid !== BigInt(process.getuid()) || (info.mode & 0o777n) !== 0o500n || info.nlink !== 1n) fail('executable must have private owned mode 0500 and no hard links');
  return info;
}
function executableBytes(path, expected) {
  const info = fileInfo(path);
  if (expected && !same(expected, info)) fail('executable identity changed');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!same(identity(info), fstatSync(fd, { bigint: true }))) fail('executable identity changed during open');
    const bytes = readFileSync(fd);
    if (!same(identity(info), fstatSync(fd, { bigint: true }))) fail('executable identity changed during read');
    return { bytes, info };
  } finally { closeSync(fd); }
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function goEnvironment(env) {
  const { os, arch } = nativePlatform();
  return { ...env, GOWORK: 'off', GOFLAGS: '', GO111MODULE: 'on', GOOS: os, GOARCH: arch };
}
function command(command, args, { env, cwd, execute }) {
  if (execute) return execute(command, args, { env, cwd });
  const child = spawnSync(command, args, { env, cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  if (child.error || child.status !== 0) fail(`${command} failed: ${child.error?.message ?? child.stderr}`);
  return child.stdout.trim();
}
function selectedPin(root, env, execute) {
  absolute(root);
  if (realpathSync(root) !== root) fail('selected host root is not canonical');
  const selected = JSON.parse(command('go', ['list', `-modfile=${join(root, 'go.mod')}`, '-m', '-json', modulePath], { cwd: root, env: goEnvironment(env), execute }));
  if (selected.Path !== modulePath || selected.Replace || typeof selected.Version !== 'string' || !/^v3\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(selected.Version)) fail('selected host does not have a stock immutable Wails pin');
  const sum = readFileSync(join(root, 'go.sum'), 'utf8').split('\n').find(line => line.startsWith(`${modulePath} ${selected.Version} h1:`))?.split(' ')[2];
  if (!sum) fail('selected stock module pin has no source checksum');
  return { version: selected.Version, sum };
}
function nativeHeader(bytes) {
  const { os, arch } = nativePlatform();
  let valid = false;
  if (os === 'darwin' && bytes.length >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf) {
    valid = bytes.readUInt32LE(4) === (arch === 'arm64' ? 0x100000c : 0x1000007) && bytes.readUInt32LE(12) === 2;
  } else if (os === 'linux' && bytes.length >= 64 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    valid = bytes[4] === 2 && bytes[5] === 1 && [2, 3].includes(bytes.readUInt16LE(16)) && bytes.readUInt16LE(18) === (arch === 'arm64' ? 183 : 62);
  }
  if (!valid) fail('executable is not a native platform executable');
}
export function validateWailsBuildInfo(executable, version, { env = process.env, execute, sum } = {}) {
  nativeHeader(readFileSync(executable));
  const lines = command('go', ['version', '-m', executable], { env: goEnvironment(env), execute }).split(/\r?\n/).map(line => line.trim().split(/\s+/));
  const path = lines.filter(parts => parts[0] === 'path');
  const mod = lines.filter(parts => parts[0] === 'mod');
  const { os, arch } = nativePlatform();
  if (path.length !== 1 || path[0][1] !== commandPath || mod.length !== 1 || mod[0][1] !== modulePath || mod[0][2] !== version || !mod[0][3]?.startsWith('h1:') || (sum && mod[0][3] !== sum) || lines.some(parts => parts[0] === '=>')) fail('build info does not match the stock pinned module command');
  for (const setting of [`GOOS=${os}`, `GOARCH=${arch}`]) {
    if (!lines.some(parts => parts[0] === 'build' && parts[1] === setting)) fail('build info is not native platform');
  }
}
export function validatePinnedWailsTool(capability, { root, env = process.env, execute } = {}) {
  nativePlatform();
  let value;
  try { value = JSON.parse(capability); } catch { fail('capability is missing or malformed'); }
  if (value?.schemaVersion !== 1 || value.platform !== process.platform || value.arch !== process.arch || typeof value.version !== 'string' || typeof value.sum !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest ?? '')) fail('capability is malformed or foreign');
  const directory = directoryInfo(value.directory);
  if (!same(value.directoryIdentity, directory)) fail('directory identity changed');
  if (value.executable !== join(value.directory, 'wails3')) fail('capability executable is outside its private directory');
  const actual = executableBytes(value.executable, value.executableIdentity);
  if (digest(actual.bytes) !== value.digest) fail('executable digest changed');
  if (root) {
    const pin = selectedPin(root, env, execute);
    if (pin.version !== value.version || pin.sum !== value.sum) fail('capability differs from the actual selected stock host pin');
  }
  validateWailsBuildInfo(value.executable, value.version, { env, execute, sum: value.sum });
  if (!same(value.executableIdentity, fileInfo(value.executable)) || !same(value.directoryIdentity, directoryInfo(value.directory))) fail('capability identity changed during authentication');
  return value.executable;
}
export function preparePinnedWailsTool({ root, directory, bootstrapGoCache, env = process.env, execute }) {
  nativePlatform();
  absolute(bootstrapGoCache);
  absolute(directory);
  const pin = selectedPin(root, env, execute);
  // Exclusive creation: a restored executable/receipt is never accepted as proof
  // of this invocation's genuine install. Only native Go cache entries may reuse.
  mkdirSync(directory, { mode: 0o700 });
  directoryInfo(directory);
  const buildEnv = { ...goEnvironment(env), GOCACHE: bootstrapGoCache, GOBIN: directory, CGO_ENABLED: '0' };
  command('go', ['install', `${commandPath}@${pin.version}`], { cwd: root, env: buildEnv, execute });
  const executable = join(directory, 'wails3');
  chmodSync(executable, 0o500);
  const actual = executableBytes(executable);
  validateWailsBuildInfo(executable, pin.version, { env: buildEnv, execute, sum: pin.sum });
  const capability = JSON.stringify({ schemaVersion: 1, directory, directoryIdentity: identity(directoryInfo(directory)), executable, executableIdentity: identity(actual.info), digest: digest(actual.bytes), version: pin.version, sum: pin.sum, platform: process.platform, arch: process.arch });
  validatePinnedWailsTool(capability, { root, env: buildEnv, execute });
  return capability;
}
function main(args) {
  const options = {};
  let index = 0;
  for (; index < args.length && args[index] !== '--'; index += 2) {
    const name = { '--root': 'root', '--capability': 'capability' }[args[index]];
    if (!name || options[name] !== undefined || args[index + 1] === undefined) fail('invalid adapter arguments');
    options[name] = args[index + 1];
  }
  if (!options.root || options.capability === undefined || args[index] !== '--' || index + 1 === args.length) fail('explicit capability, host root and command arguments are required');
  const executable = validatePinnedWailsTool(options.capability, { root: options.root });
  const child = spawnSync(executable, args.slice(index + 1), { env: goEnvironment(process.env), stdio: 'inherit' });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`Wails tool: ${error.message}`); process.exitCode = 1; }
}

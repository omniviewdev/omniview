import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { updateCask } from './update-cask.mjs';

// This exercises actual release bytes through Homebrew, not a stand-in binary.
// Use only on disposable CI machines; Homebrew owns its global bin directory.
if (process.platform !== 'darwin' || process.env.CI !== 'true') {
  throw new Error('Homebrew lifecycle checks require a disposable macOS CI runner (CI=true)');
}
const [archiveArgument, caskFile, ...extra] = process.argv.slice(2);
if (!archiveArgument || !caskFile || extra.length) throw new Error('Usage: node check-cask.mjs DMG CASK');
const archive = path.resolve(archiveArgument);
const original = await readFile(caskFile, 'utf8');
const hash = createHash('sha256');
for await (const chunk of createReadStream(archive)) hash.update(chunk);
const sha = hash.digest('hex');
const execute = promisify(execFile);
const environment = { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_DEVELOPER: '1' };
async function brew(...args) {
  console.log(`brew ${args.join(' ')}`);
  const result = await execute('brew', args, { env: environment, maxBuffer: 16 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.stdout.trim();
}
async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
const prefix = await brew('--prefix');
const link = path.join(prefix, 'bin', 'omniview-dev');
assert.equal(await exists(link), false, 'Refuse to replace an existing CLI');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'omniview-brew-'));
const appdir = path.join(temporary, 'Applications');
await mkdir(appdir);
const tap = 'omniviewdev/packaging-check';
const token = 'omniview-packaging-check';
const qualified = `${tap}/${token}`;
let tapped = false;
let installed = false;
const server = createServer((request, response) => {
  if (request.url !== '/Omniview_check.dmg') { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'application/x-apple-diskimage');
  createReadStream(archive).on('error', (error) => response.destroy(error)).pipe(response);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
try {
  await brew('tap-new', '--no-git', tap);
  tapped = true;
  const repository = await brew('--repository', tap);
  const candidate = path.join(repository, 'Casks', `${token}.rb`);
  await mkdir(path.dirname(candidate), { recursive: true });
  const url = `http://127.0.0.1:${server.address().port}/Omniview_check.dmg`;
  function render(version) {
    return updateCask(original, version, sha)
      .replace(/^cask "omniview(?:-nightly)?" do$/m, `cask "${token}" do`)
      .replace(/^  url "[^"\r\n]+"$/m, `  url "${url}"`);
  }
  async function publish(version, legacy = false) {
    let cask = render(version);
    assert.ok(cask.includes(`  url "${url}"`), 'Cask download URL must point to the release archive server');
    if (legacy) cask = cask.replace(/^  binary .*\n/m, '');
    await writeFile(candidate, cask);
    await execute('ruby', ['-c', candidate]);
  }
  async function checkInstalled(version) {
    assert.equal(await realpath(link), await realpath(path.join(appdir, 'Omniview.app', 'Contents', 'MacOS', 'omniview-dev')));
    const result = await execute(link, ['--help'], { env: { ...environment, PATH: `${prefix}/bin:${environment.PATH}` } });
    assert.match(result.stdout, /omniview-dev/);
    assert.match(result.stdout, /workspace/);
    const resolved = await execute('/bin/sh', ['-c', 'command -v omniview-dev'], { env: { ...environment, PATH: `${prefix}/bin:${environment.PATH}` } });
    assert.equal(resolved.stdout.trim(), link);
    // Installed-cask listing uses the token, not the tap-qualified install name.
    assert.equal(await brew('list', '--cask', '--versions', token), `${token} ${version}`);
  }
  async function install() {
    // Mark before invoking Homebrew so a partially failed install is cleaned up.
    installed = true;
    await brew('install', '--cask', `--appdir=${appdir}`, qualified);
  }
  async function uninstall() {
    await brew('uninstall', '--cask', qualified);
    installed = false;
    assert.equal(await exists(link), false, 'Uninstall must remove the CLI link');
    assert.equal(await exists(path.join(appdir, 'Omniview.app')), false);
  }

  await publish('0.0.0-ci.2');
  await install();
  await checkInstalled('0.0.0-ci.2');
  await uninstall();

  await publish('0.0.0-ci.1', true);
  await install();
  assert.equal(await exists(link), false, 'Legacy app-only casks must not supply a CLI');
  await publish('0.0.0-ci.2');
  await brew('upgrade', '--cask', `--appdir=${appdir}`, qualified);
  await checkInstalled('0.0.0-ci.2');

  await publish('0.0.0-ci.3');
  await brew('upgrade', '--cask', `--appdir=${appdir}`, qualified);
  await checkInstalled('0.0.0-ci.3');
  await uninstall();
} finally {
  let cleanupError;
  if (installed) {
    try { await brew('uninstall', '--cask', qualified); } catch (error) { cleanupError = error; }
  }
  if (tapped) {
    try { await brew('untap', '--force', tap); } catch (error) { cleanupError ??= error; }
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
  if (cleanupError) throw cleanupError;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { missingLinuxPackages, prepareLinuxDependencies } from './browser-dependencies.mjs';

const missing = 'Missing system dependencies (2):\n  fonts-ipafont-gothic\n  fonts-freefont-ttf';
const installed = 'All system dependencies are installed.';
const ready = { stdout: installed, stderr: '', status: 0 };
const absent = { stdout: missing, stderr: '', status: 1 };
const playwrightCLI = '/pinned/cli.js';

test('pinned Playwright simulation parses packages and rejects malformed or unsafe recipes', () => {
  assert.deepEqual(missingLinuxPackages(installed), []);
  assert.deepEqual(missingLinuxPackages(missing), ['fonts-ipafont-gothic', 'fonts-freefont-ttf']);
  assert.deepEqual(missingLinuxPackages('Missing system dependencies (1):\n  libnss3:amd64'), ['libnss3:amd64']);
  for (const value of ['', 'apt-get update && apt-get install fonts-freefont-ttf', 'Missing system dependencies (1):\n  fonts-one\n  fonts-two', 'Missing system dependencies (1):\n  --allow-unauthenticated', 'Missing system dependencies (1):\n  fonts-one;touch /tmp/foreign', 'Missing system dependencies (2):\n  fonts-one\n  fonts-one', 'warning\n' + installed]) {
    assert.throws(() => missingLinuxPackages(value), /dependency simulation/);
  }
});

test('preinstalled image fails on missing native libraries without package-manager fallback', () => {
  assert.throws(() => prepareLinuxDependencies({ playwrightCLI, preinstalled: true, execute(command) {
    assert.equal(command, 'pkg-config');
    throw Error('native library unavailable');
  } }), /Preinstalled Linux image is missing native GTK4, WebKit6 or Wayland/);
});

test('preinstalled image reports missing browser packages without package-manager fallback', () => {
  assert.throws(() => prepareLinuxDependencies({ playwrightCLI, preinstalled: true, execute(command) {
    if (command === 'pkg-config') return '';
    assert.equal(command, process.execPath, 'preinstalled mode must never invoke apt or sudo');
    return absent;
  } }), /missing Playwright system dependencies: fonts-ipafont-gothic, fonts-freefont-ttf/);
});

test('unsupported warnings, malformed output and inconsistent statuses fail before provisioning', () => {
  for (const result of [
    { status: 1, stdout: missing, stderr: 'BEWARE: your OS is not officially supported' },
    { status: 1, stdout: '', stderr: 'Unable to locate package' },
    { status: 1, stdout: installed, stderr: '' },
    { status: 0, stdout: missing, stderr: '' },
    { status: 2, stdout: missing, stderr: '' },
    { status: 1, stdout: 'unknown package-manager failure', stderr: '' },
  ]) {
    for (const preinstalled of [false, true]) {
      assert.throws(() => prepareLinuxDependencies({ playwrightCLI, preinstalled, execute(command) {
        if (command === 'pkg-config') return '';
        assert.equal(command, process.execPath, 'invalid simulation must never authorize apt');
        return result;
      } }), /dependency simulation/);
    }
  }
});

test('browser-only local preparation leaves an already prepared host untouched', () => {
  prepareLinuxDependencies({ playwrightCLI, native: false, execute(command) {
    assert.equal(command, process.execPath, 'no package manager is needed');
    return ready;
  } });
});

for (const uid of [0, 1000]) test(`local UID${uid} installs missing browser packages and requires genuine revalidation`, context => {
  context.mock.method(process, 'getuid', () => uid);
  const packages = new Set();
  let refreshed = false;
  prepareLinuxDependencies({ playwrightCLI, execute(command, args) {
    if (command === process.execPath) return packages.size ? ready : absent;
    assert.equal(command, uid === 0 ? 'apt-get' : 'sudo');
    if (args.includes('update')) refreshed = true;
    else {
      assert.ok(refreshed, 'refresh authenticated indexes before installing');
      for (const name of args.slice(args.indexOf('--no-install-recommends') + 1)) packages.add(name);
    }
  } });
  assert.deepEqual([...packages], ['libgtk-4-dev', 'libwebkitgtk-6.0-dev', 'libwayland-dev', 'build-essential', 'pkg-config', 'fonts-ipafont-gothic', 'fonts-freefont-ttf']);
});

test('local preparation rejects dependencies still missing after installation', () => {
  assert.throws(() => prepareLinuxDependencies({ playwrightCLI, native: false, execute(command) {
    return command === process.execPath ? absent : '';
  } }), /remain missing after provisioning/);
});

test('post-install warnings and inconsistent status cannot claim readiness', () => {
  for (const result of [{ ...ready, stderr: 'unsupported platform' }, { ...ready, status: 1 }]) {
    let installedPackages = false;
    assert.throws(() => prepareLinuxDependencies({ playwrightCLI, native: false, execute(command, args) {
      if (command === process.execPath) return installedPackages ? result : absent;
      if (args.includes('install')) installedPackages = true;
    } }), /dependency simulation/);
  }
});

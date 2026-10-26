import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { missingLinuxPackages, prepareLinuxDependencies } from './browser-dependencies.mjs';

const missing = 'Missing system dependencies (2):\n  fonts-ipafont-gothic\n  fonts-freefont-ttf';
const installed = 'All system dependencies are installed.';

beforeEach(context => { context.mock.method(process, 'getuid', () => 1000); });

test('pinned Playwright simulation identifies actual missing packages without interpreting shell input', () => {
  assert.deepEqual(missingLinuxPackages(installed), []);
  assert.deepEqual(missingLinuxPackages(missing), ['fonts-ipafont-gothic', 'fonts-freefont-ttf']);
  assert.deepEqual(missingLinuxPackages('Missing system dependencies (1):\n  libnss3:amd64'), ['libnss3:amd64']);
  for (const value of ['', 'apt-get update && apt-get install fonts-freefont-ttf', 'Missing system dependencies (1):\n  fonts-one\n  fonts-two', 'Missing system dependencies (1):\n  --allow-unauthenticated', 'Missing system dependencies (1):\n  fonts-one;touch /tmp/foreign', 'Missing system dependencies (2):\n  fonts-one\n  fonts-one', 'warning\n' + installed]) {
    assert.throws(() => missingLinuxPackages(value), /dependency simulation/);
  }
});

test('one authenticated APT transaction installs native prerequisites and genuinely missing browser fonts before revalidation', () => {
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes('--dry-run')) return options.capture === 'result' ? { stdout: missing, stderr: '', status: 1 } : installed;
    return '';
  };
  const report = prepareLinuxDependencies({ execute, playwrightCLI: '/pinned/cli.js', archiveDirectory: '/owned/apt' });
  assert.equal(calls[0].command, process.execPath);
  assert.match(calls[0].args[0], /verify-apt-archives\.mjs$/);
  assert.equal(calls[0].args[1], '/owned/apt');
  assert.deepEqual(calls[1].options.acceptedExitCodes, [0, 1], 'only the missing-package simulation permits its documented nonzero status');
  assert.deepEqual(calls[2], { command: 'sudo', args: ['apt-get', '-o', 'Dir::Cache::archives=/owned/apt', 'install', '-y', '--no-install-recommends', 'libgtk-4-dev', 'libwebkitgtk-6.0-dev', 'libwayland-dev', 'build-essential', 'pkg-config', 'fonts-ipafont-gothic', 'fonts-freefont-ttf'], options: undefined });
  assert.deepEqual(calls[3], { command: process.execPath, args: ['/pinned/cli.js', 'install-deps', '--dry-run', 'chromium'], options: { capture: true } });
  assert.equal(calls.length, 4, 'no second apt update/install or browser download is hidden inside Linux provisioning');
  assert.deepEqual(report.missingBrowserPackages, ['fonts-ipafont-gothic', 'fonts-freefont-ttf']);
});

test('unprepared standalone Linux refreshes indexes inside its invocation and installs the same complete recipe', () => {
  const calls = [];
  prepareLinuxDependencies({ playwrightCLI: '/pinned/cli.js', execute: (command, args, options) => {
    calls.push({ command, args });
    return args.includes('--dry-run') ? options.capture === 'result' ? { stdout: installed, stderr: '', status: 0 } : installed : '';
  } });
  assert.deepEqual(calls[0], { command: 'sudo', args: ['apt-get', 'update'] });
  assert.deepEqual(calls[2], { command: 'sudo', args: ['apt-get', 'install', '-y', '--no-install-recommends', 'libgtk-4-dev', 'libwebkitgtk-6.0-dev', 'libwayland-dev', 'build-essential', 'pkg-config'] });
});

test('browser-only runs do not acquire native application libraries when browser dependencies already exist', () => {
  const calls = [];
  prepareLinuxDependencies({ playwrightCLI: '/pinned/cli.js', native: false, execute: (command, args, options) => {
    calls.push({ command, args });
    return args.includes('--dry-run') ? options.capture === 'result' ? { stdout: installed, stderr: '', status: 0 } : installed : '';
  } });
  assert.equal(calls.some(call => call.args.includes('install') && call.command === 'sudo'), false);
});

test('archive, simulation, installation and post-install validation failures stop provisioning without retry or claimed readiness', () => {
  for (const failure of [0, 1, 2, 3]) {
    let calls = 0;
    assert.throws(() => prepareLinuxDependencies({ playwrightCLI: '/pinned/cli.js', archiveDirectory: '/owned/apt', execute: (_command, args, options) => {
      if (calls++ === failure) throw Error('actual dependency operation failed');
      return args.includes('--dry-run') ? options.capture === 'result' ? { stdout: missing, stderr: '', status: 1 } : installed : '';
    } }), /actual dependency operation failed/);
    assert.equal(calls, failure + 1);
  }
  let calls = 0;
  assert.throws(() => prepareLinuxDependencies({ playwrightCLI: '/pinned/cli.js', archiveDirectory: '/owned/apt', execute: (_command, args) => {
    calls++;
    return args.includes('--dry-run') ? { stdout: 'unknown package-manager failure', stderr: '', status: 1 } : '';
  } }), /dependency simulation/);
  assert.equal(calls, 2, 'malformed simulation output never reaches apt install');
});

test('unsupported platform warnings, resolver failures and inconsistent simulation statuses never authorize installation', () => {
  for (const result of [
    { status: 1, stdout: missing, stderr: 'BEWARE: your OS is not officially supported' },
    { status: 1, stdout: '', stderr: 'Unable to locate package' },
    { status: 1, stdout: installed, stderr: '' },
    { status: 0, stdout: missing, stderr: '' },
    { status: 2, stdout: missing, stderr: '' },
  ]) {
    let calls = 0;
    assert.throws(() => prepareLinuxDependencies({ playwrightCLI: '/pinned/cli.js', archiveDirectory: '/owned/apt', execute: (_command, args) => {
      calls++;
      return args.includes('--dry-run') ? result : '';
    } }), /dependency simulation/);
    assert.equal(calls, 2);
  }
});

for (const [uid, command, prefix] of [[0, 'apt-get', []], [1000, 'sudo', ['apt-get']]]) test(`Linux UID${uid} provisions update and install with the available privilege boundary`, context => {
  context.mock.method(process, 'getuid', () => uid);
  const calls = [];
  prepareLinuxDependencies({ playwrightCLI: '/pinned/cli.js', execute: (command, args, options) => {
    if (uid === 0 && command === 'sudo') throw Error('sudo is not installed in this root runner');
    calls.push({ command, args });
    return args.includes('--dry-run') ? options.capture === 'result' ? { stdout: installed, stderr: '', status: 0 } : installed : '';
  } });
  const apt = calls.filter(call => call.command === 'sudo' || call.command === 'apt-get');
  assert.deepEqual(apt, [
    { command, args: [...prefix, 'update'] },
    { command, args: [...prefix, 'install', '-y', '--no-install-recommends', 'libgtk-4-dev', 'libwebkitgtk-6.0-dev', 'libwayland-dev', 'build-essential', 'pkg-config'] },
  ]);
});

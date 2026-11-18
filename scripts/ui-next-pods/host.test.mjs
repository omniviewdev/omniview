import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'host.sh');

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('host.sh stop ends a host that ignores SIGTERM and frees its pid file', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'host-stop-'));
  fs.mkdirSync(path.join(work, 'stubborn'));
  // A stand-in for a host that ignores SIGTERM; it prints once it holds the trap, so the signal cannot arrive before it.
  const child = spawn('bash', ['-c', 'trap "" TERM; echo ready; while true; do sleep 0.2; done'], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise((resolve) => child.stdout.once('data', resolve));
    fs.writeFileSync(path.join(work, 'stubborn', 'host.pid'), `${String(child.pid)}\n`);
    const result = spawnSync('bash', [script, 'stop', 'stubborn'], { env: { ...process.env, OMNIVIEW_E2E_WORK: work }, timeout: 30_000 });
    assert.equal(result.status, 0, String(result.stderr));
    assert.ok(!fs.existsSync(path.join(work, 'stubborn', 'host.pid')), 'the pid file is removed once the host is gone');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(!alive(child.pid), 'the host must not outlive stop');
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(work, { recursive: true, force: true });
  }
});

// `start` against a stand-in host. The script finds the host binary from its own place (`<root>/scripts/ui-next-pods/host.sh` -> `<root>/bin/Omniview-server`),
// so the test copies it into a throwaway root that holds a stub which listens on the port it is given and writes down the environment it was started with.
const STUB = `#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const seen = { home: process.env.HOME, channel: process.env.OMNIVIEW_CHANNEL, host: process.env.WAILS_SERVER_HOST, port: process.env.WAILS_SERVER_PORT, kubeconfig: process.env.KUBECONFIG ?? null };
fs.writeFileSync(path.join(process.env.HOME, '..', 'seen.json'), JSON.stringify(seen));
http.createServer((request, response) => response.end('ok')).listen(Number(process.env.WAILS_SERVER_PORT), '127.0.0.1');
`;

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'host-start-'));
  const root = path.join(base, 'root');
  fs.mkdirSync(path.join(root, 'scripts', 'ui-next-pods'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'));
  fs.copyFileSync(script, path.join(root, 'scripts', 'ui-next-pods', 'host.sh'));
  fs.writeFileSync(path.join(root, 'bin', 'Omniview-server'), STUB, { mode: 0o755 });
  const work = path.join(base, 'work');
  const kubeconfig = path.join(base, 'kubeconfig');
  fs.writeFileSync(kubeconfig, 'apiVersion: v1\nkind: Config\n');
  const run = (...args) =>
    spawnSync('bash', [path.join(root, 'scripts', 'ui-next-pods', 'host.sh'), ...args], { env: { ...process.env, OMNIVIEW_E2E_WORK: work }, encoding: 'utf8', timeout: 60_000 });
  // A plugin as its archive lays it out: plugin.yaml, bin/plugin, assets/.
  const plugin = (id, { assets = ['entry.js', 'entry.js.map', 'chunk-abc.js'] } = {}) => {
    const dir = path.join(base, `plugin-${id}`);
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'plugin.yaml'), `id: ${id}\nversion: 1.2.3\nname: Some plugin\n`);
    fs.writeFileSync(path.join(dir, 'bin', 'plugin'), '#!/bin/sh\n', { mode: 0o755 });
    for (const name of assets) fs.writeFileSync(path.join(dir, 'assets', name), `// ${name}\n`);
    return dir;
  };
  return { base, work, kubeconfig, run, plugin, seen: (name) => JSON.parse(fs.readFileSync(path.join(work, name, 'seen.json'), 'utf8')) };
}

test('host.sh start installs the plugin directory whole under the id its plugin.yaml names, and starts the host on a private profile', async () => {
  const { base, work, kubeconfig, run, plugin, seen } = setup();
  const port = await freePort();
  try {
    const dir = plugin('acme-tools');
    const started = run('start', 'with-plugin', String(port), kubeconfig, dir);
    assert.equal(started.status, 0, `${started.stdout}${started.stderr}`);

    const installed = path.join(work, 'with-plugin', 'home', '.omniview-feature-ui-next', 'plugins', 'acme-tools');
    assert.deepEqual(fs.readdirSync(installed).sort(), ['assets', 'bin', 'plugin.yaml']);
    // `assets/` is installed with everything in it (the bundle, its map and its chunks), not recreated empty.
    assert.deepEqual(fs.readdirSync(path.join(installed, 'assets')).sort(), ['chunk-abc.js', 'entry.js', 'entry.js.map']);
    assert.equal(fs.readFileSync(path.join(installed, 'assets', 'entry.js'), 'utf8'), '// entry.js\n');
    assert.equal(fs.readFileSync(path.join(installed, 'plugin.yaml'), 'utf8'), fs.readFileSync(path.join(dir, 'plugin.yaml'), 'utf8'));
    assert.ok(fs.statSync(path.join(installed, 'bin', 'plugin')).mode & 0o100, 'the plugin binary stays executable');

    // The kubeconfig is a private copy under the profile's HOME, and the host sees nothing of the caller's environment but what the script sets.
    const home = path.join(work, 'with-plugin', 'home');
    assert.equal(fs.readFileSync(path.join(home, '.kube', 'config'), 'utf8'), fs.readFileSync(kubeconfig, 'utf8'));
    assert.equal(fs.statSync(path.join(home, '.kube', 'config')).mode & 0o777, 0o600);
    assert.deepEqual(seen('with-plugin'), { home, channel: 'feature-ui-next', host: '127.0.0.1', port: String(port), kubeconfig: null });
  } finally {
    run('stop', 'with-plugin');
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('host.sh start installs a plugin that has no bundle as it is: an empty assets/ stays empty', async () => {
  const { base, work, kubeconfig, run, plugin } = setup();
  const port = await freePort();
  try {
    const started = run('start', 'without-bundle', String(port), kubeconfig, plugin('kubernetes', { assets: [] }));
    assert.equal(started.status, 0, `${started.stdout}${started.stderr}`);
    const installed = path.join(work, 'without-bundle', 'home', '.omniview-feature-ui-next', 'plugins', 'kubernetes');
    assert.deepEqual(fs.readdirSync(path.join(installed, 'assets')), []);
    assert.ok(fs.existsSync(path.join(installed, 'plugin.yaml')));
  } finally {
    run('stop', 'without-bundle');
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('host.sh start with none installs no plugin', async () => {
  const { base, work, kubeconfig, run } = setup();
  const port = await freePort();
  try {
    const started = run('start', 'without-plugin', String(port), kubeconfig, 'none');
    assert.equal(started.status, 0, `${started.stdout}${started.stderr}`);
    assert.ok(!fs.existsSync(path.join(work, 'without-plugin', 'home', '.omniview-feature-ui-next')), 'no plugin state root is made');
  } finally {
    run('stop', 'without-plugin');
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('host.sh start refuses a directory that is not a plugin, and an id the host would not accept, before it starts anything', async () => {
  const { base, work, kubeconfig, run, plugin } = setup();
  const port = await freePort();
  try {
    const empty = path.join(base, 'empty');
    fs.mkdirSync(empty);
    const noManifest = run('start', 'bad', String(port), kubeconfig, empty);
    assert.notEqual(noManifest.status, 0);
    assert.match(noManifest.stderr, /holds no plugin\.yaml/);

    const noBinary = plugin('no-binary');
    fs.rmSync(path.join(noBinary, 'bin'), { recursive: true });
    assert.match(run('start', 'bad', String(port), kubeconfig, noBinary).stderr, /holds no bin\/plugin/);

    const odd = plugin('odd');
    fs.writeFileSync(path.join(odd, 'plugin.yaml'), 'id: ../escape\nversion: 1.2.3\n');
    const badId = run('start', 'bad', String(port), kubeconfig, odd);
    assert.notEqual(badId.status, 0);
    assert.match(badId.stderr, /invalid plugin id/);
    assert.ok(!fs.existsSync(path.join(work, 'bad', 'host.pid')), 'no host was started');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

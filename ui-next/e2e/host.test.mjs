import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

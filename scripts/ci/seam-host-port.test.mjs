// The start of the host in the seam check (ui-next/plugins/e2e/hostStart.mjs): the port the check picks is probed and released before the host binds it, so another process can take it in between. When the host says it lost
// the port, the start is tried again on another one, a bounded number of times, and for nothing else. These tests run the helper with fake starts, and once against a real collision.
import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';

import { PORT_LOST, startWithPortRetry } from '../../ui-next/plugins/e2e/hostStart.mjs';

/** What the host prints when it cannot bind its port (Wails, `application_server.go`). */
const WAILS_LINE = 'wails app exited with error: failed to listen on 127.0.0.1:36287: bind: address already in use';
const collision = (port, built) => Object.assign(new Error(`the host exited while starting:\n${WAILS_LINE.replace('36287', String(port))}`), built === undefined ? {} : { built });
const noPause = async () => {};

/** A `freePort` that hands out the given ports in order, and a `start` that follows a script of outcomes, each recording what it was called with. */
function harness({ ports = [], outcomes }) {
  const calls = [];
  const logs = [];
  const queue = [...ports];
  const freed = [];
  return {
    calls,
    logs,
    freed,
    options: {
      freePort: async () => {
        const next = queue.shift();
        assert.notEqual(next, undefined, 'freePort was asked for more ports than the test gave');
        freed.push(next);
        return next;
      },
      log: (line) => logs.push(line),
      pause: noPause,
      async start(port, built) {
        calls.push({ port, built });
        const outcome = outcomes[calls.length - 1];
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    },
  };
}

test('the regex matches the real output of a host that lost its port, and the plain error text', () => {
  assert.match(WAILS_LINE, PORT_LOST);
  assert.match('listen EADDRINUSE: address already in use 127.0.0.1:4000', PORT_LOST);
  assert.doesNotMatch('the host did not answer in 60 s', PORT_LOST);
  assert.doesNotMatch('failed to listen on 127.0.0.1:36287: permission denied', PORT_LOST);
});

test('a host that starts the first time is not retried and nothing is logged', async () => {
  const run = harness({ outcomes: [{ base: 'http://127.0.0.1:4001' }] });
  const host = await startWithPortRetry({ port: 4001, ...run.options });
  assert.deepEqual(host, { base: 'http://127.0.0.1:4001' });
  assert.deepEqual(run.calls, [{ port: 4001, built: undefined }]);
  assert.deepEqual(run.logs, []);
  assert.deepEqual(run.freed, []);
});

test('a collision is retried on another port, with the build the failed attempt made, and says so in one line', async () => {
  const built = [{ id: 'fixture-a-ok' }];
  const run = harness({ ports: [4002], outcomes: [collision(4001, built), { base: 'http://127.0.0.1:4002' }] });
  const host = await startWithPortRetry({ port: 4001, attempts: 5, ...run.options });
  assert.deepEqual(host, { base: 'http://127.0.0.1:4002' });
  assert.deepEqual(run.calls, [{ port: 4001, built: undefined }, { port: 4002, built }]);
  assert.equal(run.calls[1].built, built, 'the build is the same value, not a copy: the plugins are not built again');
  assert.deepEqual(run.logs, ['seam: the host lost port 4001 (address already in use), attempt 1 of 5; trying 4002']);
});

test('an error that is not a lost port is thrown at once, unchanged, and nothing is retried', async () => {
  const failure = new Error('the host did not answer in 60 s:\nstarting');
  const run = harness({ ports: [4002], outcomes: [failure, { base: 'never' }] });
  await assert.rejects(startWithPortRetry({ port: 4001, ...run.options }), (error) => error === failure);
  assert.equal(run.calls.length, 1);
  assert.deepEqual(run.logs, []);

  const later = new Error('the host exited while starting:\npanic: boom');
  const second = harness({ ports: [4002, 4003], outcomes: [collision(4001), later, { base: 'never' }] });
  await assert.rejects(startWithPortRetry({ port: 4001, ...second.options }), (error) => error === later);
  assert.equal(second.calls.length, 2, 'a collision is retried, the next failure of another kind is not');
});

test('a port that is lost every time ends after the attempts, with the ports tried and the cause', async () => {
  const outcomes = [collision(4001), collision(4002), collision(4003)];
  const run = harness({ ports: [4002, 4003], outcomes });
  await assert.rejects(startWithPortRetry({ port: 4001, attempts: 3, ...run.options }), (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, `the host could not get a port in 3 tries (4001, 4002, 4003): ${outcomes[2].message}`);
    assert.equal(error.cause, outcomes[2]);
    return true;
  });
  assert.equal(run.calls.length, 3);
  assert.deepEqual(run.freed, [4002, 4003], 'no port is asked for after the last attempt');
  assert.equal(run.logs.length, 2);
  assert.match(run.logs[1], /^seam: the host lost port 4002 \(address already in use\), attempt 2 of 3; trying 4003$/);
});

test('a restart that keeps its port tries that same port again, after a pause, and never asks for another', async () => {
  const built = [{ id: 'fixture-a-ok' }];
  const run = harness({ outcomes: [collision(4001, built), collision(4001, built), { base: 'http://127.0.0.1:4001' }] });
  let pauses = 0;
  const host = await startWithPortRetry({ port: 4001, keepPort: true, ...run.options, pause: async () => void (pauses += 1) });
  assert.deepEqual(host, { base: 'http://127.0.0.1:4001' });
  assert.deepEqual(run.calls, [{ port: 4001, built: undefined }, { port: 4001, built }, { port: 4001, built }]);
  assert.deepEqual(run.freed, []);
  assert.equal(pauses, 2);
  assert.deepEqual(run.logs, [
    'seam: the host lost port 4001 (address already in use), attempt 1 of 5; trying it again',
    'seam: the host lost port 4001 (address already in use), attempt 2 of 5; trying it again',
  ]);
});

test('the success path sets no timer', async () => {
  const set = globalThis.setTimeout;
  let timers = 0;
  globalThis.setTimeout = (...args) => {
    timers += 1;
    return set(...args);
  };
  try {
    const run = harness({ outcomes: [{ base: 'ok' }] });
    await startWithPortRetry({ port: 4001, ...run.options, pause: undefined });
  } finally {
    globalThis.setTimeout = set;
  }

  assert.equal(timers, 0);
});

/** The probe the check uses to pick a port (`freePort` in seam.check.mjs): listen on port 0, read the port, release it. */
function probePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

test('a port that a real server holds is given up for one that really listens', async () => {
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const taken = holder.address().port;
  const listeners = [];
  try {
    const logs = [];
    // Like the host: bind the port, and say what the operating system said when it cannot.
    const start = (port) =>
      new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', (error) => reject(new Error(`the host exited while starting:\nfailed to listen on 127.0.0.1:${String(port)}: ${error.message}`)));
        server.listen(port, '127.0.0.1', () => {
          listeners.push(server);
          resolve({ port });
        });
      });
    const host = await startWithPortRetry({ port: taken, freePort: probePort, start, log: (line) => logs.push(line), pause: noPause });
    assert.notEqual(host.port, taken);
    assert.ok(listeners[0].listening, 'the server of the second attempt listens');
    assert.equal(listeners[0].address().port, host.port);
    assert.equal(logs.length, 1);
    assert.match(logs[0], new RegExp(`^seam: the host lost port ${String(taken)} \\(address already in use\\), attempt 1 of 5; trying ${String(host.port)}$`));
  } finally {
    await Promise.all([holder, ...listeners].map((server) => new Promise((resolve) => server.close(resolve))));
  }
});

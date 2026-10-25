import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpuDelta, frameBytes, requireInstance, unavailable } from './resource-measurements.mjs';

test('CPU samples report elapsed main thread work rather than process CPU', () => {
  assert.deepEqual(cpuDelta({ TaskDuration: 1, ScriptDuration: 2 }, { TaskDuration: 1.125, ScriptDuration: 2.025 }), {
    taskMs: 125, scriptMs: 24.99999999999991, layoutMs: 0, styleMs: 0,
  });
});
test('binary websocket data uses base64 decoded bytes, text uses UTF8 bytes', () => {
  assert.equal(frameBytes({ opcode: 1, payloadData: '雪' }), 3);
  assert.equal(frameBytes({ opcode: 2, payloadData: 'AAEC' }), 3);
});
test('instance selection rejects another generation or source and non-loopback endpoints', () => {
  const expected = { workspaceID: 'mine', generation: 2, stateRoot: '/private/state', hostSource: '/source' };
  const actual = { ...expected, endpoints: { browser: 'http://127.0.0.1:1234' } };
  assert.equal(requireInstance(actual, expected), 'http://127.0.0.1:1234/');
  for (const changed of [{ generation: 3 }, { hostSource: '/other' }, { endpoints: { browser: 'https://example.com' } }]) {
    assert.throws(() => requireInstance({ ...actual, ...changed }, expected));
  }
});
test('unavailable metrics cannot be mistaken for measured zero', () => {
  assert.deepEqual(unavailable('no query API'), { available: false, reason: 'no query API' });
});

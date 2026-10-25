export function cpuDelta(before, after) {
  const delta = (key) => ((after[key] ?? 0) - (before[key] ?? 0)) * 1000;
  return { taskMs: delta('TaskDuration'), scriptMs: delta('ScriptDuration'), layoutMs: delta('LayoutDuration'), styleMs: delta('RecalcStyleDuration') };
}
export function frameBytes(frame) {
  return Buffer.byteLength(frame.payloadData, frame.opcode === 1 ? 'utf8' : 'base64');
}
export const unavailable = (reason) => ({ available: false, reason });
export function requireInstance(instance, expected) {
  for (const field of ['workspaceID', 'generation', 'stateRoot', 'hostSource']) {
    if (!expected[field] || instance[field] !== expected[field]) throw new Error(`Instance ${field} mismatch`);
  }
  const endpoint = new URL(instance.endpoints.browser);
  if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Expected real loopback browser endpoint');
  return endpoint.href;
}

import { connect } from 'node:net';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// This client is verification tooling; it does not expose another application command.
export async function hostResourceMetrics(path, instance, forcedGC = false) {
  if (resolve(path) !== path || await realpath(dirname(path)) !== dirname(path)) throw new Error('Metrics socket parent is redirected');
  const parent = await lstat(dirname(path)), leaf = await lstat(path);
  if (!parent.isDirectory() || (parent.mode & 0o777) !== 0o700 || parent.uid !== process.getuid() || !leaf.isSocket() || (leaf.mode & 0o777) !== 0o600 || leaf.uid !== process.getuid()) throw new Error('Metrics socket is not private and owned');
  const { promise, resolve: accept, reject } = Promise.withResolvers();
  const socket = connect({ path });
  const chunks = [];
  let bytes = 0;
  socket.setTimeout(2000, () => socket.destroy(new Error('Metrics sample timeout')));
  socket.once('error', reject);
  socket.once('connect', () => socket.end(`${JSON.stringify({ operation: forcedGC ? 'gc-snapshot' : 'snapshot', workspaceID: instance.workspaceID, generation: instance.generation })}\n`));
  socket.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 8192) socket.destroy(new Error('Metrics sample exceeds response bound'));
    else chunks.push(chunk);
  });
  socket.once('end', () => {
    try {
      const sample = JSON.parse(Buffer.concat(chunks).toString());
      if (sample.workspaceID !== instance.workspaceID || sample.generation !== instance.generation || sample.stateRoot !== instance.stateRoot || JSON.stringify(sample.process) !== JSON.stringify(instance.process) || sample.forcedGC !== forcedGC) throw new Error('Metrics host identity mismatch');
      accept(sample);
    } catch (error) { reject(error); }
  });
  try { return await promise; } finally { socket.destroy(); }
}

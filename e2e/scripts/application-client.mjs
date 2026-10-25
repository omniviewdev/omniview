import { createConnection } from 'node:net';
import { isAbsolute } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';

export function applicationRequest(request) {
  const path = process.env.OMNIVIEW_E2E_LAUNCH_SOCKET;
  if (!path || !isAbsolute(path)) return Promise.reject(Error('Invocation-owned application broker is required'));
  const directory = lstatSync(dirname(path));
  const endpoint = lstatSync(path);
  if (realpathSync(dirname(path)) !== dirname(path) || !directory.isDirectory() || !endpoint.isSocket() || (directory.mode | endpoint.mode) & 0o077 || (process.getuid && (directory.uid !== process.getuid() || endpoint.uid !== process.getuid()))) return Promise.reject(Error('Application broker must be canonical, private and owned'));
  const { promise, resolve, reject } = Promise.withResolvers();
  const socket = createConnection(path);
  socket.setEncoding('utf8');
  socket.setTimeout(60_000, () => socket.destroy(Error('Owned application request timed out')));
  let data = '';
  let settled = false;
  socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
  socket.on('data', chunk => {
    data += chunk;
    if (data.length > 1024 * 1024) socket.destroy(Error('Application response exceeded bound'));
  });
  socket.once('error', reject);
  socket.once('end', () => {
    try {
      const response = JSON.parse(data);
      settled = true;
      if (!response.ok) reject(Error(response.error)); else resolve(response.result);
    } catch { reject(Error('Invalid owned application response')); }
  });
  socket.once('close', () => { if (!settled) reject(Error('Application broker disconnected')); });
  return promise.finally(() => socket.destroy());
}

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createLogger, createServer } from 'vite';

// Vite #22847: a pre-listen transform must not start an optimization that
// races with initialization resetting the optimizer's metadata.
test('does not optimize discovered dependencies before server initialization', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.vite-optimizer-test-'));
  const errors = [];
  const logger = createLogger('error');
  logger.error = message => { errors.push(message); };
  const buildStarted = Promise.withResolvers();
  const buildFinished = Promise.withResolvers();
  let server;
  try {
    await writeFile(path.join(root, 'entry.js'), "import * as React from 'react'; export default React;\n");
    server = await createServer({
      configFile: false,
      root,
      customLogger: logger,
      server: { port: 0 },
      optimizeDeps: {
        force: true,
        entries: ['entry.js'],
        esbuildOptions: {
          plugins: [{
            name: 'observe-dependency-optimization',
            setup(build) {
              build.onStart(() => { buildStarted.resolve(); });
              build.onEnd(() => { buildFinished.resolve(); });
            },
          }],
        },
      },
    });
    await server.transformRequest('/entry.js');
    assert.equal(await Promise.race([buildStarted.promise.then(() => true), delay(350, false)]), false);
    await server.listen();
    assert.equal(await Promise.race([buildFinished.promise.then(() => true), delay(10_000, false)]), true);
    await server.environments.client.waitForRequestsIdle();
    assert.deepEqual(errors, []);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

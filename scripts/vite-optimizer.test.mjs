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
    await writeFile(path.join(root, 'scan.js'), 'export default 0;\n');
    server = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, '.vite-cache'),
      customLogger: logger,
      server: { port: 0 },
      optimizeDeps: {
        force: true,
        entries: ['scan.js'],
        esbuildOptions: {
          plugins: [{
            name: 'observe-dependency-optimization',
            setup(build) {
              if (!build.initialOptions.outdir) return;
              build.onStart(() => { buildStarted.resolve(); });
              build.onEnd(() => { buildFinished.resolve(); });
            },
          }],
        },
      },
    });
    const transformed = await server.transformRequest('/entry.js');
    const optimizedUrl = transformed?.code.match(/["']([^"']*\/react\.js\?v=[^"']+)["']/)?.[1];
    assert.ok(optimizedUrl, 'pre-listen transform must reference the optimized dependency');
    assert.equal(await Promise.race([buildStarted.promise.then(() => true), delay(350, false)]), false);
    await server.listen();
    assert.equal(await Promise.race([buildFinished.promise.then(() => true), delay(10_000, false)]), true);
    const response = await fetch(new URL(optimizedUrl, server.resolvedUrls.local[0]));
    assert.equal(response.status, 200, await response.text());
    assert.ok(server.environments.client.depsOptimizer.metadata.optimized.react, 'react optimization must be committed');
    await server.environments.client.waitForRequestsIdle();
    assert.deepEqual(errors, []);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

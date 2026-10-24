import { createServer } from 'node:net';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { ApplicationWorkspace } from './application';

// Harness transaction tests, not plugin/provider acceptance. Product persistence
// is exercised through the real application settings UI in consumers.spec.ts.
for (const failure of ['none', 'unaccepted', 'incomplete', 'not-persisted'] as const) {
  test(`application baseline reset requires accepted, completed and persisted mutation (${failure})`, async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'omniview-setting-reset-')));
    const socketPath = join(directory, 'control.sock');
    const names = ['OMNIVIEW_E2E_LAUNCH_SOCKET', 'OMNIVIEW_E2E_MODE', 'OMNIVIEW_E2E_APPLICATION'] as const;
    const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
    let value = 0;
    let pending: unknown;
    const calls: string[] = [];
    const server = createServer(socket => {
      socket.setEncoding('utf8');
      let input = '';
      socket.on('data', (chunk: string) => {
        input += chunk;
        if (!input.endsWith('\n')) {
          return;
        }

        const request = JSON.parse(input) as { command: string; params: { value?: unknown } };
        calls.push(request.command);
        let result: unknown;
        if (request.command === 'settings.get') {
          result = { status: 'succeeded', result: value };
        }

        if (request.command === 'settings.set') {
          pending = request.params.value;
          result = failure === 'unaccepted' ? { status: 'failed' } : { status: 'accepted', operationID: 'reset' };
        }

        if (request.command === 'operation.wait') {
          if (failure === 'none') {
            value = pending as number;
          }

          result = { status: failure === 'incomplete' ? 'pending' : 'succeeded', operationID: 'reset' };
        }

        socket.end(`${JSON.stringify({ ok: true, result })}\n`);
      });
    });
    const listening = Promise.withResolvers<void>();
    server.once('error', listening.reject);
    server.listen(socketPath, listening.resolve);
    await listening.promise;
    await chmod(socketPath, 0o600);
    process.env.OMNIVIEW_E2E_LAUNCH_SOCKET = socketPath;
    process.env.OMNIVIEW_E2E_MODE = 'owned';
    process.env.OMNIVIEW_E2E_APPLICATION = 'harness-transaction-unit-test';
    try {
      const workspace = new ApplicationWorkspace('profile-a', false);
      await workspace.rememberSetting({ scope: 'plugin', pluginID: 'workspace-probe', id: 'probe_counter' });
      value = 23;
      if (failure === 'none') {
        await workspace.restoreSettings();
        expect(value).toBe(0);
        expect(calls).toEqual(['settings.get', 'settings.get', 'settings.set', 'operation.wait', 'settings.get']);
      } else {
        await expect(workspace.restoreSettings()).rejects.toThrow();
        await expect(workspace.control('settings.get', {})).rejects.toThrow('healthy invocation-owned');
        expect(value).toBe(23);
      }
    } finally {
      const closed = Promise.withResolvers<void>();
      server.close(() => {
        closed.resolve(); 
      });
      await closed.promise;
      for (const name of names) {
        const value = before[name];
        if (value === undefined) {
          Reflect.deleteProperty(process.env, name);
        } else {
          process.env[name] = value;
        }
      }

      await rm(directory, { recursive: true, force: true });
    }
  });
}

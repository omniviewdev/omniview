import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { test, expect } from '../fixtures/app.fixture';
import { callBinding, Service } from '../fixtures/wails';
import { chooseSetting, openSettingsCategory, restartApp, saveSettings, settingRow } from '../fixtures/helpers';
import { cli } from '../fixtures/workspace';

// These scenarios do not route/mock bindings. A broken backend, wrong profile,
// stale generation or missing event transport must fail instead of looking ready.
test.describe('Owned workspace integration', () => {
  test('confirms the named backend identity and captures the real browser surface', async ({ appPage, workspace }, testInfo) => {
    const descriptor = await workspace.verify();
    await expect(appPage).toHaveTitle(`Omniview — DEV · ${descriptor.displayName}`);
    const chip = appPage.getByRole('button', { name: `DEV · ${descriptor.displayName} — instance details`, exact: true });
    await expect(chip).toBeVisible();
    await chip.click();
    const dialog = appPage.getByRole('dialog');
    await expect(dialog.getByText('Identity confirmed by the host.', { exact: true })).toBeVisible();
    await expect(dialog.getByText(descriptor.instanceID, { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText(descriptor.generation, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await appPage.screenshot({ path: testInfo.outputPath('named-workspace.png'), fullPage: true });
  });

  test('delivers real Wails events over the backend WebSocket to the existing app dispatcher', async ({ appPage, context }) => {
    const receiver = await context.newPage();
    const session = await context.newCDPSession(receiver);
    try {
      const socketReady = receiver.waitForEvent('websocket', socket => new URL(socket.url()).pathname === '/wails/events');
      const handshake = Promise.withResolvers<number>();
      let eventsRequestID: string | undefined;
      session.on('Network.webSocketCreated', ({ requestId, url }) => {
        if (new URL(url).pathname === '/wails/events') {
          eventsRequestID = requestId;
        }
      });
      session.on('Network.webSocketHandshakeResponseReceived', ({ requestId, response }) => {
        if (requestId === eventsRequestID) {
          handshake.resolve(response.status);
        }
      });
      await session.send('Network.enable');
      await receiver.goto('/');
      const socket = await socketReady;
      expect(await handshake.promise).toBe(101);
      const event = `omniview:e2e/${randomUUID()}`;
      const marker = randomUUID();
      await expect.poll(async () => receiver.evaluate(() => typeof window._wails?.dispatchWailsEvent)).toBe('function');
      await receiver.evaluate(event => {
        const runtime = window._wails;
        if (!runtime || typeof runtime.dispatchWailsEvent !== 'function') {
          throw new Error('The app runtime dispatcher is unavailable');
        }

        const original = runtime.dispatchWailsEvent;
        const { promise, resolve } = Promise.withResolvers<unknown>();
        window.e2eEvent = promise;
        // Passively observe the already-loaded dispatcher. Always forward the
        // original argument, receiver, result and exceptions without alteration.
        const observe = function (this: unknown, message: unknown): unknown {
          const result = original.call(this, message);
          if (message && typeof message === 'object' && 'name' in message && message.name === event && 'data' in message) {
            resolve(message.data);
          }

          return result;
        };

        runtime.dispatchWailsEvent = observe;
        window.e2eRestoreEventDispatcher = () => {
          if (runtime.dispatchWailsEvent === observe) {
            runtime.dispatchWailsEvent = original;
          }

          delete window.e2eRestoreEventDispatcher;
          delete window.e2eEvent;
        };
      }, event);
      const frame = socket.waitForEvent('framereceived', { predicate: message => String(message.payload).includes(marker) });
      await appPage.evaluate(async ({ event, marker }) => {
        const clientID = window._wails?.clientId;
        if (!clientID) {
          throw new Error('The sender app runtime client ID is unavailable');
        }

        // Stock Events.Emit uses POST /wails/runtime, objectNames.Events=3,
        // EventsEmit=0 and args={name,data}; this is the real backend transport.
        // Do not import another runtime or invoke a local dispatcher as a sender.
        const response = await fetch('/wails/runtime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-wails-client-id': clientID },
          body: JSON.stringify({ object: 3, method: 0, args: { name: event, data: { marker } } }),
        });
        if (!response.ok) {
          throw new Error(`Backend event emission failed (${response.status})`);
        }
      }, { event, marker });
      await frame;
      expect(await receiver.evaluate(async () => window.e2eEvent)).toEqual({ marker });
    } finally {
      try {
        if (!receiver.isClosed()) {
          await receiver.evaluate(() => window.e2eRestoreEventDispatcher?.());
        }
      } finally {
        await session.detach();
        await receiver.close();
      }
    }
  });

  test('saves through the actual UI binding and keeps profile B unchanged', async ({ appPage, workspace, profiles }, testInfo) => {
    test.setTimeout(30 * 60_000);
    const other = await profiles.open('profile-b');
    const a = await workspace.verify();
    const b = await other.workspace.verify();
    expect(a.workspaceID).not.toBe(b.workspaceID);
    expect(a.stateRoot).not.toBe(b.stateRoot);
    expect(a.endpoints.browser).not.toBe(b.endpoints.browser);
    expect(a.endpoints.control).not.toBe(b.endpoints.control);
    const beforeB = await callBinding(other.page.request, Service.settings, 'GetSettingValue', 'terminal.fontSize');
    const beforeA = await callBinding(appPage.request, Service.settings, 'GetSettingValue', 'terminal.fontSize');
    const next = beforeA === 17 ? 18 : 17;
    await openSettingsCategory(appPage, 'Terminal');
    await settingRow(appPage, 'terminal.fontSize').getByRole('spinbutton').fill(String(next));
    await saveSettings(appPage);
    expect(await callBinding(appPage.request, Service.settings, 'GetSettingValue', 'terminal.fontSize')).toBe(next);
    expect(await callBinding(other.page.request, Service.settings, 'GetSettingValue', 'terminal.fontSize')).toEqual(beforeB);
    await appPage.reload();
    await openSettingsCategory(appPage, 'Terminal');
    await expect(settingRow(appPage, 'terminal.fontSize').getByRole('spinbutton')).toHaveValue(String(next));
    for (const [page, descriptor, label, theme] of [
      [appPage, a, 'Solarized Dark', 'solarized-dark'],
      [other.page, b, 'Void', 'void'],
    ] as const) {
      await openSettingsCategory(page, 'Appearance');
      await chooseSetting(page, 'appearance.theme', label);
      await expect.poll(async () => callBinding(page.request, Service.settings, 'GetSettingValue', 'appearance.theme')).toBe(theme);
      await expect(page.locator('html')).toHaveAttribute('data-ov-theme', theme);
      // Backend visibility can precede the UI binding's completion and cache
      // write. Reload only once the actual browser has persisted its paint hint.
      await expect.poll(async () => page.evaluate(() => {
        const key = window.__OMNIVIEW_BOOTSTRAP__?.storageKey('ov-theme-bootstrap-v1');
        return key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
      })).toEqual({ schemaVersion: 1, themeId: theme });
      // Observe the first actual rendering opportunity, without modifying app
      // identity, storage, HTML, runtime bindings, or response bodies.
      await page.addInitScript(() => {
        requestAnimationFrame(() => {
          window.e2eFirstFrame = { instanceID: window.__OMNIVIEW_BOOTSTRAP__?.identity.instanceID, theme: document.documentElement.getAttribute('data-ov-theme') };
        });
      });
      await page.reload();
      await expect.poll(async () => page.evaluate(() => window.e2eFirstFrame)).toEqual({ instanceID: descriptor.instanceID, theme });
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await testInfo.attach(`${theme}-first-frame.json`, { body: JSON.stringify(await page.evaluate(() => window.e2eFirstFrame)), contentType: 'application/json' });
    }

    await other.page.screenshot({ path: testInfo.outputPath('profile-b-unchanged.png'), fullPage: true });
  });

  test('rejects stale generation and wrong UUID mutations before changing settings', async ({ workspace, request }) => {
    const before = await callBinding(request, Service.settings, 'GetSettingValue', 'terminal.fontSize');
    for (const target of [{ generation: randomUUID() }, { workspaceID: randomUUID() }]) {
      const result = await workspace.control('settings.set', { scope: 'host', id: 'terminal.fontSize', value: 19 }, target);
      expect(result.error?.code).toBe('stale_target');
    }

    expect(await callBinding(request, Service.settings, 'GetSettingValue', 'terminal.fontSize')).toEqual(before);
  });

  test('authenticates custom-root control through authoritative UUID runtime, ignoring adjacent discovery', async ({ workspace }) => {
    const descriptor = await workspace.verify();
    const paths = await cli<{ workspaceID: string; stateRoot: string; runtimeRoot: string }>(['workspace', 'paths', ...workspace.selection()]);
    expect(paths.workspaceID).toBe(descriptor.workspaceID);
    expect(paths.stateRoot).toBe(descriptor.stateRoot);
    const adjacentRuntime = join(dirname(descriptor.stateRoot), 'runtime');
    expect(paths.runtimeRoot).not.toBe(adjacentRuntime);
    let foreignRequests = 0;
    // This is an adversarial real foreign listener, not a substitute backend:
    // successful verification must authenticate the actual owned Wails host.
    const foreign = createServer((_request, response) => {
      foreignRequests++;
      response.writeHead(403);
      response.end('Wrong runtime authority');
    });
    const listening = once(foreign, 'listening');
    foreign.listen(0, '127.0.0.1');
    await listening;
    let created = false;
    const files: string[] = [];
    try {
      const address = foreign.address();
      if (!address || typeof address === 'string') {
        throw new Error('Foreign fixture listener did not obtain a TCP endpoint');
      }

      await mkdir(adjacentRuntime, { mode: 0o700 });
      created = true;
      const hash = createHash('sha256').update(`${descriptor.workspaceID}\0${descriptor.generation}`).digest('hex');
      const tokenFile = join(adjacentRuntime, `control-token-${hash}.secret`);
      await writeFile(tokenFile, randomUUID() + randomUUID(), { mode: 0o600, flag: 'wx' });
      files.push(tokenFile);
      const discoveryFile = join(adjacentRuntime, 'discovery.json');
      await writeFile(discoveryFile, JSON.stringify({ ...descriptor, tokenFile, endpoints: { ...descriptor.endpoints, control: `http://127.0.0.1:${address.port}/v1/control` } }), { mode: 0o600, flag: 'wx' });
      files.push(discoveryFile);
      const actual = await workspace.control('instance.inspect', {});
      expect(actual.error).toBeUndefined();
      expect(actual.status).toBe('succeeded');
      expect(actual.workspaceID).toBe(descriptor.workspaceID);
      expect(actual.generation).toBe(descriptor.generation);
      expect(foreignRequests).toBe(0);
    } finally {
      try {
        for (const file of files.reverse()) {
          await unlink(file);
        }

        if (created) {
          await rmdir(adjacentRuntime);
        }
      } finally {
        const closed = once(foreign, 'close');
        foreign.close();
        await closed;
      }
    }
  });

  test('keeps durable settings and browser storage across an owned supervisor restart', async ({ appPage, workspace }, testInfo) => {
    test.setTimeout(30 * 60_000);
    const before = await workspace.verify();
    await callBinding(appPage.request, Service.settings, 'SetSetting', 'terminal.fontSize', 16);
    const marker = randomUUID();
    await appPage.evaluate(value => {
      localStorage.setItem(window.__OMNIVIEW_BOOTSTRAP__!.storageKey('e2e-marker')!, value); 
    }, marker);
    const after = await restartApp(appPage, workspace);
    expect(after.workspaceID).toBe(before.workspaceID);
    expect(after.instanceID).toBe(before.instanceID);
    expect(after.generation).not.toBe(before.generation);
    // Browser persistence is origin-bound; sticky allocation must retain the URL.
    expect(after.endpoints.browser).toBe(before.endpoints.browser);
    expect(await callBinding(appPage.request, Service.settings, 'GetSettingValue', 'terminal.fontSize')).toBe(16);
    expect(await appPage.evaluate(() => localStorage.getItem(window.__OMNIVIEW_BOOTSTRAP__!.storageKey('e2e-marker')!))).toBe(marker);
    await appPage.screenshot({ path: testInfo.outputPath('restarted-workspace.png'), fullPage: true });
  });
});

// These probes belong to this test module, not the application's global API.
type AcceptanceWindow = Window & {
  e2eEvent?: Promise<unknown>;
  e2eRestoreEventDispatcher?: () => void;
  _wails?: { clientId?: string; dispatchWailsEvent?: (message: unknown) => unknown };
  e2eFirstFrame?: { instanceID: string | undefined; theme: string | null };
  __OMNIVIEW_BOOTSTRAP__?: { identity: { instanceID: string }; storageKey(key: string): string | null };
};

declare const window: AcceptanceWindow;

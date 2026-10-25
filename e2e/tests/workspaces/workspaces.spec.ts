import { test, expect } from '../fixtures/app.fixture';
import { callBinding, Service } from '../fixtures/wails';
import { chooseSetting, openSettingsCategory, saveSettings, settingRow } from '../fixtures/helpers';

test.describe('Owned application profiles', () => {
  test('confirms mandatory DEV identity against the actual backend UUID and generation', async ({ appPage, workspace }) => {
    const descriptor = await workspace.verify();
    expect(descriptor.kind).toBe('development');
    expect(descriptor.endpoints.vite).toBeNull();
    await expect(appPage).toHaveTitle(`Omniview — DEV · ${descriptor.displayName}`);
    const chip = appPage.getByRole('button', { name: `DEV · ${descriptor.displayName} — instance details`, exact: true });
    await expect(chip).toBeVisible();
    await chip.click();
    const dialog = appPage.getByRole('dialog');
    await expect(dialog.getByText('Identity confirmed by the host.', { exact: true })).toBeVisible();
    await expect(dialog.getByText(descriptor.instanceID, { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText(descriptor.generation, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  test('saves host settings through UI, persists reload and isolates profile themes including first paint', async ({ appPage, workspace, profiles }, testInfo) => {
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
    for (const [page, descriptor, label, theme] of [[appPage, a, 'Solarized Dark', 'solarized-dark'], [other.page, b, 'Void', 'void']] as const) {
      await openSettingsCategory(page, 'Appearance');
      await chooseSetting(page, 'appearance.theme', label);
      await expect.poll(async () => callBinding(page.request, Service.settings, 'GetSettingValue', 'appearance.theme')).toBe(theme);
      await expect(page.locator('html')).toHaveAttribute('data-ov-theme', theme);
      await expect.poll(async () => page.evaluate(() => {
        const key = window.__OMNIVIEW_BOOTSTRAP__?.storageKey('ov-theme-bootstrap-v1');
        return key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
      })).toEqual({ schemaVersion: 1, themeId: theme });
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
  });
});

// Exercise the genuinely different asset route once, not a second backend,
// settings, Kubernetes or compiler-conformance matrix.
test.describe('Alternate live frontend delivery', () => {
  test.use({ liveFrontend: true });
  test('loads the actual live asset route and reconnects the same owned origin', async ({ page, workspace }) => {
    const descriptor = await workspace.verify();
    expect(descriptor.endpoints.vite).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    const optimizerFailures: string[] = [];
    let documents = 0;
    page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        documents++;
      }
    });
    page.on('response', response => {
      if (response.status() >= 400 && new URL(response.url()).pathname.includes('/.vite/deps/')) {
        optimizerFailures.push(`${response.status()} ${response.statusText()} ${response.url()}`);
      }
    });
    await page.goto(`${workspace.browserURL()}#/_plugin/workspace-probe/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page).toHaveTitle(`Omniview — DEV · ${descriptor.displayName}`);
    await expect(page.getByRole('heading', { name: 'Workspace Probe', exact: true })).toBeVisible();
    expect(optimizerFailures, 'Cold module graph must load without optimizer failures').toEqual([]);
    expect(documents, 'Cold startup must not require an optimizer-triggered reload').toBe(1);
    const socket = page.waitForEvent('websocket', socket => new URL(socket.url()).pathname === '/wails/events');
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect((await socket).isClosed()).toBe(false);
    await expect(page.getByRole('heading', { name: 'Workspace Probe', exact: true })).toBeVisible();
    expect((await workspace.verify()).generation).toBe(descriptor.generation);
  });
});

type AcceptanceWindow = Window & {
  e2eFirstFrame?: { instanceID: string | undefined; theme: string | null };
  __OMNIVIEW_BOOTSTRAP__?: { identity: { instanceID: string }; storageKey(key: string): string | null };
};
declare const window: AcceptanceWindow;

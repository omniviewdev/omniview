import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app.fixture';
import { openSettingsWindow, openSettingsCategory, saveSettings, settingRow, chooseSetting } from '../fixtures/helpers';
import { callBinding, hostSettingsValues, mockBindings, Service } from '../fixtures/wails';

async function storedValue(page: Page, id: string): Promise<unknown> {
  return (await hostSettingsValues(page.request))[id];
}

test.describe('Settings', () => {
  test('a targeted category opens without navigating the main window', async ({ appPage: page }) => {
    await expect(page).toHaveURL(/#\/$/);
    const mainURL = page.url();
    const settings = await openSettingsWindow(page, '/settings?category=terminal');
    await expect(settingRow(settings, 'terminal.fontSize')).toBeVisible();
    await expect(settingRow(settings, 'editor.fontSize')).toBeHidden();
    expect(page.url()).toBe(mainURL);
  });

  test('saves a text setting to the backend and shows it after a reload', async ({ appPage }) => {
    const settings = await openSettingsCategory(appPage, 'Developer Settings');
    const input = settingRow(settings, 'developer.marketplace_url').getByRole('textbox');
    await input.fill('https://marketplace.e2e.test');
    await saveSettings(settings);

    expect(await storedValue(settings, 'developer.marketplace_url')).toBe('https://marketplace.e2e.test');

    await settings.reload();
    await settings.getByRole('option', { name: 'Developer Settings', exact: true }).click();
    await expect(settingRow(settings, 'developer.marketplace_url').getByRole('textbox'))
      .toHaveValue('https://marketplace.e2e.test');
  });

  test('saves a number setting as a number', async ({ appPage }) => {
    const settings = await openSettingsCategory(appPage, 'Terminal');
    await settingRow(settings, 'terminal.fontSize').getByRole('spinbutton').fill('17');
    await saveSettings(settings);

    expect(await storedValue(settings, 'terminal.fontSize')).toBe(17);
  });

  test('saves a toggle setting', async ({ appPage }) => {
    const before = await storedValue(appPage, 'editor.minimapEnabled');
    const settings = await openSettingsCategory(appPage, 'Editor');

    const toggle = settingRow(settings, 'editor.minimapEnabled').getByRole('checkbox');
    await expect(toggle).toBeChecked({ checked: before === true });
    await toggle.click();
    await saveSettings(settings);

    expect(await storedValue(settings, 'editor.minimapEnabled')).toBe(!before);
    await expect(toggle).toBeChecked({ checked: !before });
  });

  test('saves a select setting', async ({ appPage }) => {
    const settings = await openSettingsCategory(appPage, 'Terminal');
    await chooseSetting(settings, 'terminal.cursorStyle', 'Underline');
    await saveSettings(settings);

    expect(await storedValue(settings, 'terminal.cursorStyle')).toBe('underline');
  });

  test('saves several edits in one go', async ({ appPage }) => {
    const settings = await openSettingsCategory(appPage, 'Terminal');
    await settingRow(settings, 'terminal.fontSize').getByRole('spinbutton').fill('13');
    await chooseSetting(settings, 'terminal.cursorStyle', 'Bar');
    await saveSettings(settings);

    expect(await storedValue(settings, 'terminal.fontSize')).toBe(13);
    expect(await storedValue(settings, 'terminal.cursorStyle')).toBe('bar');
  });

  test('Discard puts back the stored values and saves nothing', async ({ appPage }) => {
    const before = await storedValue(appPage, 'developer.gopath');
    if (before !== null && before !== undefined && typeof before !== 'string') {
      throw new Error('Stored developer.gopath must be a string');
    }

    const settings = await openSettingsCategory(appPage, 'Developer Settings');

    const input = settingRow(settings, 'developer.gopath').getByRole('textbox');
    await input.fill('/tmp/e2e-discarded');
    await settings.getByRole('button', { name: 'Discard' }).click();

    await expect(input).toHaveValue(before ?? '');
    expect(await storedValue(settings, 'developer.gopath')).toBe(before);
  });

  test('switching category keeps each page to its own settings', async ({ appPage }) => {
    const settings = await openSettingsCategory(appPage, 'Terminal');
    await expect(settingRow(settings, 'terminal.fontSize')).toBeVisible();

    await settings.getByRole('option', { name: 'Editor', exact: true }).click();
    await expect(settingRow(settings, 'editor.fontSize')).toBeVisible();
    await expect(settingRow(settings, 'terminal.fontSize')).toBeHidden();
  });

  test('saves a log shipping mode and independent telemetry endpoints', async ({ appPage }) => {
    const settings = await openSettingsCategory(appPage, 'Telemetry');
    await chooseSetting(settings, 'telemetry.logs_format', 'Loki');
    await settingRow(settings, 'telemetry.endpoint_otlp').getByRole('textbox').fill('https://traces.example.test/v1/traces');
    await settingRow(settings, 'telemetry.endpoint_otlp_logs').getByRole('textbox').fill('https://logs.example.test/otlp/v1/logs');
    await settingRow(settings, 'telemetry.endpoint_loki').getByRole('textbox').fill('https://loki.example.test/loki/api/v1/push');
    await saveSettings(settings);

    expect(await storedValue(settings, 'telemetry.logs_format')).toBe('loki');
    expect(await storedValue(settings, 'telemetry.endpoint_otlp')).toBe('https://traces.example.test/v1/traces');
    expect(await storedValue(settings, 'telemetry.endpoint_otlp_logs')).toBe('https://logs.example.test/otlp/v1/logs');
    expect(await storedValue(settings, 'telemetry.endpoint_loki')).toBe('https://loki.example.test/loki/api/v1/push');

    await chooseSetting(settings, 'telemetry.logs_format', 'OpenTelemetry (OTLP)');
    await saveSettings(settings);
    expect(await storedValue(settings, 'telemetry.logs_format')).toBe('otlp');
    expect(await storedValue(settings, 'telemetry.endpoint_loki')).toBe('https://loki.example.test/loki/api/v1/push');
  });

  test('shows telemetry connection settings without a development plugin', async ({ page }) => {
    await page.goto('/');
    const plugins = await callBinding<Array<Record<string, unknown>>>(page.request, Service.plugins, 'ListPlugins');
    const settings = await openSettingsWindow(page, undefined, async (settingsPage) => {
      await mockBindings(settingsPage, Service.plugins, {
        ListPlugins: plugins.map((plugin) => ({ ...plugin, devMode: false })),
      });
    });
    await settings.getByRole('option', { name: 'Telemetry', exact: true }).click();
    await expect(settingRow(settings, 'telemetry.enabled')).toBeVisible();
    for (const id of ['endpoint_otlp', 'endpoint_pyroscope', 'auth_header', 'auth_value']) {
      await expect(settingRow(settings, `telemetry.${id}`)).toBeVisible();
    }
  });

  test('shows telemetry connection settings with a development plugin', async ({ page }) => {
    await page.goto('/');
    const plugins = await callBinding<Array<Record<string, unknown>>>(page.request, Service.plugins, 'ListPlugins');
    expect(plugins.some((plugin) => plugin.id === 'workspace-probe')).toBe(true);
    const settings = await openSettingsWindow(page, undefined, async (settingsPage) => {
      await mockBindings(settingsPage, Service.plugins, {
        ListPlugins: plugins.map((plugin) => ({ ...plugin, devMode: plugin.id === 'workspace-probe' })),
      });
    });
    await settings.getByRole('option', { name: 'Telemetry', exact: true }).click();
    for (const id of ['endpoint_otlp', 'endpoint_pyroscope', 'auth_header', 'auth_value']) {
      await expect(settingRow(settings, `telemetry.${id}`)).toBeVisible();
    }
  });
});

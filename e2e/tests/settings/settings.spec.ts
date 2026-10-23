import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app.fixture';
import { goTo, openSettingsCategory, saveSettings, settingRow, chooseSetting } from '../fixtures/helpers';
import { fakePlugin } from '../fixtures/plugins';
import { callBinding, mockBindings, Service } from '../fixtures/wails';

type Category = {
  id: string;
  label: string;
  settings: Record<string, { label: string; devOnly?: boolean }> | null;
};

async function category(page: Page, id: string): Promise<Category> {
  return callBinding<Category>(page.request, Service.settings, 'GetCategory', id);
}

async function storedValue(page: Page, id: string): Promise<unknown> {
  return callBinding(page.request, Service.settings, 'GetSettingValue', id);
}

const nav = (page: Page) => page.getByRole('navigation').filter({ hasText: 'Appearance' });

test.describe('Settings', () => {
  test('lists every core category plus Extensions', async ({ appPage }) => {
    const categories = await callBinding<Category[]>(appPage.request, Service.settings, 'GetCategories');
    expect(categories.length).toBeGreaterThan(0);

    await goTo(appPage, '/settings');
    for (const { label } of categories) {
      await expect(nav(appPage).getByText(label, { exact: true })).toBeVisible();
    }

    await expect(nav(appPage).getByText('Extensions', { exact: true })).toBeVisible();
  });

  test('every category shows each of its settings with a control', async ({ appPage }) => {
    const categories = await callBinding<Category[]>(appPage.request, Service.settings, 'GetCategories');

    for (const { id, label } of categories) {
      const { settings } = await category(appPage, id);
      await openSettingsCategory(appPage, label);

      const visible = Object.entries(settings ?? {}).filter(([, s]) => !s.devOnly);
      for (const [key] of visible) {
        await expect(settingRow(appPage, `${id}.${key}`), `${id}.${key}`).toBeVisible();
      }
    }
  });

  test('a category can be opened directly from the URL', async ({ page }) => {
    await page.goto('/#/settings?category=terminal');
    await expect(page.getByText('Customize the behavior of the terminal')).toBeVisible();
    await expect(settingRow(page, 'terminal.fontSize')).toBeVisible();
  });

  test('Save Changes only appears once something is edited', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Terminal');
    await expect(appPage.getByRole('button', { name: 'Save Changes' })).toBeHidden();

    await settingRow(appPage, 'terminal.fontSize').getByRole('spinbutton').fill('15');
    await expect(appPage.getByRole('button', { name: 'Save Changes' })).toBeVisible();
    await expect(appPage.getByRole('button', { name: 'Discard' })).toBeVisible();
  });

  test('saves a text setting to the backend and shows it after a reload', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Developer Settings');
    const input = settingRow(appPage, 'developer.marketplace_url').getByRole('textbox');
    await input.fill('https://marketplace.e2e.test');
    await saveSettings(appPage);

    expect(await storedValue(appPage, 'developer.marketplace_url')).toBe('https://marketplace.e2e.test');

    await appPage.reload();
    await openSettingsCategory(appPage, 'Developer Settings');
    await expect(settingRow(appPage, 'developer.marketplace_url').getByRole('textbox'))
      .toHaveValue('https://marketplace.e2e.test');
  });

  test('saves a number setting as a number', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Terminal');
    await settingRow(appPage, 'terminal.fontSize').getByRole('spinbutton').fill('17');
    await saveSettings(appPage);

    expect(await storedValue(appPage, 'terminal.fontSize')).toBe(17);
  });

  test('saves a toggle setting', async ({ appPage }) => {
    const before = await storedValue(appPage, 'editor.minimapEnabled');
    await openSettingsCategory(appPage, 'Editor');

    const toggle = settingRow(appPage, 'editor.minimapEnabled').getByRole('checkbox');
    await expect(toggle).toBeChecked({ checked: before === true });
    await toggle.click();
    await saveSettings(appPage);

    expect(await storedValue(appPage, 'editor.minimapEnabled')).toBe(!before);
    await expect(toggle).toBeChecked({ checked: !before });
  });

  test('saves a select setting', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Terminal');
    await chooseSetting(appPage, 'terminal.cursorStyle', 'Underline');
    await saveSettings(appPage);

    expect(await storedValue(appPage, 'terminal.cursorStyle')).toBe('underline');
    await expect(settingRow(appPage, 'terminal.cursorStyle').getByRole('combobox')).toContainText('Underline');
  });

  test('saves several edits in one go', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Terminal');
    await settingRow(appPage, 'terminal.fontSize').getByRole('spinbutton').fill('13');
    await chooseSetting(appPage, 'terminal.cursorStyle', 'Bar');
    await saveSettings(appPage);

    expect(await storedValue(appPage, 'terminal.fontSize')).toBe(13);
    expect(await storedValue(appPage, 'terminal.cursorStyle')).toBe('bar');
  });

  test('Discard puts back the stored values and saves nothing', async ({ appPage }) => {
    const before = await storedValue(appPage, 'developer.gopath');
    if (before !== null && before !== undefined && typeof before !== 'string') {
      throw new Error('Stored developer.gopath must be a string');
    }

    await openSettingsCategory(appPage, 'Developer Settings');

    const input = settingRow(appPage, 'developer.gopath').getByRole('textbox');
    await input.fill('/tmp/e2e-discarded');
    await appPage.getByRole('button', { name: 'Discard' }).click();

    await expect(input).toHaveValue(before ?? '');
    await expect(appPage.getByRole('button', { name: 'Save Changes' })).toBeHidden();
    expect(await storedValue(appPage, 'developer.gopath')).toBe(before);
  });

  test('switching category keeps each page to its own settings', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Terminal');
    await expect(settingRow(appPage, 'terminal.fontSize')).toBeVisible();

    await nav(appPage).getByText('Editor', { exact: true }).click();
    await expect(settingRow(appPage, 'editor.fontSize')).toBeVisible();
    await expect(appPage.getByText('terminal.fontSize', { exact: true })).toBeHidden();
  });

  test('hides developer-only settings unless a plugin runs in dev mode', async ({ page }) => {
    await page.goto('/');
    await openSettingsCategory(page, 'Telemetry');
    await expect(settingRow(page, 'telemetry.enabled')).toBeVisible();
    await expect(page.getByText('telemetry.endpoint_otlp', { exact: true })).toBeHidden();
  });

  test('shows developer-only settings when a plugin runs in dev mode', async ({ page }) => {
    await mockBindings(page, Service.plugins, { ListPlugins: [fakePlugin(1, { devMode: true, devPath: '/tmp/e2e' })] });
    await page.goto('/');
    await openSettingsCategory(page, 'Telemetry');
    await expect(settingRow(page, 'telemetry.endpoint_otlp')).toBeVisible();
  });

  test('lists installed plugins in their own nav section', async ({ page }) => {
    await mockBindings(page, Service.plugins, { ListPlugins: [fakePlugin(1), fakePlugin(2)] });
    await page.goto('/#/settings');

    await expect(nav(page).getByText('Plugins', { exact: true })).toBeVisible();
    await expect(nav(page).getByText('E2E Plugin 1', { exact: true })).toBeVisible();
    await expect(nav(page).getByText('E2E Plugin 2', { exact: true })).toBeVisible();
  });

  test('the Extensions page opens', async ({ appPage }) => {
    await goTo(appPage, '/settings');
    await nav(appPage).getByText('Extensions', { exact: true }).click();
    await expect(appPage.getByText('Extension Points', { exact: true })).toBeVisible();
  });
});

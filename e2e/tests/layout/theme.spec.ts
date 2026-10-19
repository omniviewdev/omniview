import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app.fixture';
import {
  backgroundOf, chooseSetting, isNeutralDark, isSolarizedDark, openSettingsCategory, settingRow, shell,
} from '../fixtures/helpers';
import { callBinding, Service } from '../fixtures/wails';

const REGIONS = ['header', 'rail', 'main', 'footer'] as const;

async function storedValue(page: Page, id: string): Promise<unknown> {
  return callBinding(page.request, Service.settings, 'GetSettingValue', id);
}

test.describe('Theme', () => {
  test('Void paints the whole shell in neutral dark grays', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(appPage, 'appearance.theme', 'Void');

    const regions = shell(appPage);
    for (const region of REGIONS) {
      await expect.poll(async () => isNeutralDark(await backgroundOf(regions[region])), {
        message: `${region} background follows Void`,
      }).toBe(true);
    }
  });

  test('switching to Solarized Dark repaints every shell region immediately', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(appPage, 'appearance.theme', 'Solarized Dark');

    const regions = shell(appPage);
    for (const region of REGIONS) {
      await expect.poll(async () => isSolarizedDark(await backgroundOf(regions[region])), {
        message: `${region} background follows Solarized Dark`,
      }).toBe(true);
    }

    await expect(appPage.getByRole('button', { name: 'Save Changes' })).toBeHidden();
  });

  test('Solarized Dark persists immediately and switching to Void restores neutral colors', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(appPage, 'appearance.theme', 'Solarized Dark');
    await expect.poll(async () => storedValue(appPage, 'appearance.theme')).toBe('solarized-dark');

    await appPage.reload();
    await expect(appPage.getByTestId('app-shell')).toBeVisible();
    await expect.poll(async () => isSolarizedDark(await backgroundOf(shell(appPage).header))).toBe(true);

    await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(appPage, 'appearance.theme', 'Void');
    await expect.poll(async () => storedValue(appPage, 'appearance.theme')).toBe('void');

    const regions = shell(appPage);
    for (const region of REGIONS) {
      await expect.poll(async () => isNeutralDark(await backgroundOf(regions[region])), {
        message: `${region} background follows Void`,
      }).toBe(true);
    }
  });

  test('theme selection updates the picker immediately without draft actions', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(appPage, 'appearance.theme', 'Solarized Dark');

    await expect(settingRow(appPage, 'appearance.theme').getByRole('combobox')).toContainText('Solarized Dark');
    await expect.poll(async () => isSolarizedDark(await backgroundOf(shell(appPage).header))).toBe(true);
    await expect(appPage.getByRole('button', { name: 'Save Changes' })).toBeHidden();
    await expect(appPage.getByRole('button', { name: 'Discard' })).toBeHidden();
  });
});

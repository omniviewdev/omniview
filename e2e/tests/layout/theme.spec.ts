import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app.fixture';
import {
  backgroundOf, chooseSetting, isNeutralDark, isSolarizedDark, openSettingsCategory, shell,
} from '../fixtures/helpers';
import { hostSettingsValues } from '../fixtures/wails';

const REGIONS = ['header', 'main', 'footer'] as const;

async function storedValue(page: Page, id: string): Promise<unknown> {
  return (await hostSettingsValues(page.request))[id];
}

test.describe('Theme', () => {
  test('Void paints the whole shell in neutral dark grays', async ({ appPage }) => {
    const settings = await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(settings, 'appearance.theme', 'Void');

    const regions = shell(appPage);
    for (const region of REGIONS) {
      await expect.poll(async () => isNeutralDark(await backgroundOf(regions[region])), {
        message: `${region} background follows Void`,
      }).toBe(true);
    }
  });

  test('switching to Solarized Dark repaints every shell region immediately', async ({ appPage }) => {
    const settings = await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(settings, 'appearance.theme', 'Solarized Dark');

    const regions = shell(appPage);
    for (const region of REGIONS) {
      await expect.poll(async () => isSolarizedDark(await backgroundOf(regions[region])), {
        message: `${region} background follows Solarized Dark`,
      }).toBe(true);
    }
  });

  test('Solarized Dark persists immediately and switching to Void restores neutral colors', async ({ appPage }) => {
    let settings = await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(settings, 'appearance.theme', 'Solarized Dark');
    await expect.poll(async () => storedValue(appPage, 'appearance.theme')).toBe('solarized-dark');

    await appPage.reload();
    await expect(appPage.getByTestId('app-shell')).toBeVisible();
    for (const region of REGIONS) {
      await expect.poll(async () => isSolarizedDark(await backgroundOf(shell(appPage)[region]))).toBe(true);
    }

    settings = await openSettingsCategory(appPage, 'Appearance');
    await settings.reload();
    await expect(settings.getByRole('radio', { name: 'Solarized Dark', exact: true })).toBeChecked();
    await chooseSetting(settings, 'appearance.theme', 'Void');
    await expect.poll(async () => storedValue(appPage, 'appearance.theme')).toBe('void');

    const regions = shell(appPage);
    for (const region of REGIONS) {
      await expect.poll(async () => isNeutralDark(await backgroundOf(regions[region])), {
        message: `${region} background follows Void`,
      }).toBe(true);
    }
  });

});

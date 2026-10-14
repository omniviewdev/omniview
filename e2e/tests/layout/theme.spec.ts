import { test, expect } from '../fixtures/app.fixture';
import {
  backgroundOf, chooseSetting, isNeutralDark, isSolarizedDark, openSettingsCategory, saveSettings, shell,
} from '../fixtures/helpers';

const REGIONS = ['header', 'rail', 'main', 'footer'] as const;

test.describe('Theme', () => {
  test('Default paints the whole shell in neutral dark grays', async ({ appPage }) => {
    const regions = shell(appPage);
    for (const region of REGIONS) {
      expect(isNeutralDark(await backgroundOf(regions[region])), `${region} background`).toBe(true);
    }
  });

  test('switching to Solarized repaints every shell region without a reload', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(appPage, 'appearance.theme', 'Solarized');
    await saveSettings(appPage);

    const regions = shell(appPage);
    for (const region of REGIONS) {
      await expect.poll(async () => isSolarizedDark(await backgroundOf(regions[region])), {
        message: `${region} background follows Solarized`,
      }).toBe(true);
    }
  });

  test('Solarized survives a reload and switching back restores Default', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(appPage, 'appearance.theme', 'Solarized');
    await saveSettings(appPage);

    await appPage.reload();
    await expect(appPage.getByTestId('app-shell')).toBeVisible();
    await expect.poll(async () => isSolarizedDark(await backgroundOf(shell(appPage).header))).toBe(true);

    await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(appPage, 'appearance.theme', 'Default');
    await saveSettings(appPage);

    const regions = shell(appPage);
    for (const region of REGIONS) {
      await expect.poll(async () => isNeutralDark(await backgroundOf(regions[region])), {
        message: `${region} background back to Default`,
      }).toBe(true);
    }
  });

  test('discarding a theme change leaves the theme alone', async ({ appPage }) => {
    await openSettingsCategory(appPage, 'Appearance');
    await chooseSetting(appPage, 'appearance.theme', 'Solarized');
    await appPage.getByRole('button', { name: 'Discard' }).click();

    await expect(appPage.getByRole('button', { name: 'Save Changes' })).toBeHidden();
    expect(isNeutralDark(await backgroundOf(shell(appPage).header))).toBe(true);
  });
});

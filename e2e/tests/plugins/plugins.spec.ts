import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app.fixture';
import { expectPageDoesNotScroll, shell } from '../fixtures/helpers';
import { fakeListing, fakePlugin } from '../fixtures/plugins';
import { BindingError, mockBindings, Service } from '../fixtures/wails';

const LISTINGS = [fakeListing('zeta-tools'), fakeListing('alpha-tools'), fakeListing('mid-tools', { official: true })];

type Calls = Record<string, unknown[][]>;

/**
 * Serves the plugins page from fakes: installed plugins, a marketplace, and
 * the detail calls. Install and uninstall are recorded, never performed.
 */
async function fakeMarketplace(
  page: Page,
  { installed = [] as unknown[], listings = LISTINGS as unknown[] | BindingError } = {},
): Promise<Calls> {
  const calls: Calls = { InstallPluginVersion: [], UninstallPlugin: [] };
  await mockBindings(page, Service.plugins, {
    ListPlugins: installed,
    ListAvailablePlugins: listings,
    GetPluginReadme: (args: unknown[]) => `# ${String(args[0])} readme\n\nRendered from **markdown**.`,
    GetPluginReviews: [],
    GetPluginReleaseHistory: [],
    InstallPluginVersion: (args: unknown[]) => {
      calls.InstallPluginVersion.push(args);
      return null;
    },
    UninstallPlugin: (args: unknown[]) => {
      calls.UninstallPlugin.push(args);
      return installed.find((p) => (p as { id: string }).id === args[0]) ?? null;
    },
  });
  return calls;
}

const nav = (page: Page) => shell(page).main.locator('a[href^="#/plugins/"]');
// The legacy Modal renders role="presentation"; base-ui's renders role="dialog".
const confirmDialog = (page: Page, text: string) =>
  page.locator('[role="dialog"], [role="presentation"]').filter({ hasText: text }).last();
const search = (page: Page) => page.getByPlaceholder('Search Extensions in Marketplace');

test.describe('Plugins page', () => {
  test('shows the empty state with nothing installed', async ({ page }) => {
    await fakeMarketplace(page, { listings: [] });
    await page.goto('/#/plugins');

    await expect(page.getByText('No plugins installed')).toBeVisible();
    await expect(page.getByText('No plugins found')).toBeVisible();
    await expect(page.getByText('Select a plugin to view details, or browse the Marketplace.')).toBeVisible();
  });

  test('says so when the marketplace cannot be reached', async ({ page }) => {
    await fakeMarketplace(page, { listings: new BindingError('dial tcp: no route to host') });
    await page.goto('/#/plugins');

    await expect(page.getByText('Could not reach marketplace')).toBeVisible();
  });

  test('lists installed plugins and marketplace listings sorted by name', async ({ page }) => {
    await fakeMarketplace(page, { installed: [fakePlugin(1), fakePlugin(2)] });
    await page.goto('/#/plugins');

    await expect(nav(page)).toHaveCount(5);
    await expect(nav(page)).toHaveText([
      /E2E Plugin 1/, /E2E Plugin 2/, /Alpha Tools/, /Mid Tools/, /Zeta Tools/,
    ]);
  });

  test('search filters both sections', async ({ page }) => {
    await fakeMarketplace(page, { installed: [fakePlugin(1)] });
    await page.goto('/#/plugins');

    await search(page).fill('alpha');
    await expect(nav(page)).toHaveCount(1);
    await expect(nav(page)).toHaveText([/Alpha Tools/]);
    await expect(page.getByText('No matching installed plugins')).toBeVisible();

    await search(page).fill('');
    await expect(nav(page)).toHaveCount(4);
  });

  test('collapsing a section hides its plugins', async ({ page }) => {
    await fakeMarketplace(page, { installed: [fakePlugin(1)] });
    await page.goto('/#/plugins');

    const installedEntry = nav(page).filter({ hasText: 'E2E Plugin 1' });
    await expect(installedEntry).toBeVisible();
    const header = page.getByRole('navigation').getByText('Installed', { exact: true });
    await header.click();
    await expect(installedEntry).toBeHidden();
    await header.click();
    await expect(installedEntry).toBeVisible();
  });

  test('opens a marketplace plugin with its rendered readme', async ({ page }) => {
    await fakeMarketplace(page);
    await page.goto('/#/plugins');

    await nav(page).filter({ hasText: 'Mid Tools' }).click();
    await expect(page).toHaveURL(/#\/plugins\/mid-tools$/);
    await expect(page.getByRole('heading', { name: 'mid-tools readme' })).toBeVisible();
    await expect(page.getByText('Marketplace listing for mid-tools').last()).toBeVisible();
    await expect(page.getByText('Official', { exact: true }).last()).toBeVisible();
  });

  test('an unknown plugin id shows Plugin not found', async ({ page }) => {
    await fakeMarketplace(page);
    await page.goto('/#/plugins/does-not-exist');

    await expect(page.getByText('Plugin not found')).toBeVisible();
  });

  test('Install asks the backend for the latest version', async ({ page }) => {
    const calls = await fakeMarketplace(page);
    await page.goto('/#/plugins');

    await nav(page).filter({ hasText: 'Alpha Tools' }).getByText('Install', { exact: true }).click();
    await expect.poll(() => calls.InstallPluginVersion).toEqual([['alpha-tools', '1.2.3']]);
  });

  test('uninstalling an installed plugin asks first, then returns to the list', async ({ page }) => {
    const calls = await fakeMarketplace(page, { installed: [fakePlugin(1)] });
    await page.goto('/#/plugins/e2e-plugin-1');

    await page.getByRole('button', { name: 'Uninstall' }).click();
    const dialog = confirmDialog(page, 'Uninstall E2E Plugin 1?');
    await expect(dialog).toBeVisible();
    expect(calls.UninstallPlugin).toEqual([]);

    await dialog.getByRole('button', { name: 'Uninstall' }).click();
    await expect.poll(() => calls.UninstallPlugin).toEqual([['e2e-plugin-1']]);
    await expect(page).toHaveURL(/#\/plugins$/);
  });

  test('cancelling the uninstall dialog leaves the plugin alone', async ({ page }) => {
    const calls = await fakeMarketplace(page, { installed: [fakePlugin(1)] });
    await page.goto('/#/plugins/e2e-plugin-1');

    await page.getByRole('button', { name: 'Uninstall' }).click();
    const dialog = confirmDialog(page, 'Uninstall E2E Plugin 1?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(calls.UninstallPlugin).toEqual([]);
    await expect(page).toHaveURL(/#\/plugins\/e2e-plugin-1$/);
  });

  test('a long marketplace scrolls inside the nav, not the page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await fakeMarketplace(page, {
      listings: Array.from({ length: 40 }, (_, i) => fakeListing(`tool-${String(i).padStart(2, '0')}`)),
    });
    await page.goto('/#/plugins');

    await expect(nav(page)).toHaveCount(40);
    await expectPageDoesNotScroll(page);
    await nav(page).last().scrollIntoViewIfNeeded();
    await expect(nav(page).last()).toBeInViewport();
    await expectPageDoesNotScroll(page);
  });
});

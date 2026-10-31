import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app.fixture';
import { shell } from '../fixtures/helpers';
import { fakePlugin } from '../fixtures/plugins';
import { mockBindings, Service } from '../fixtures/wails';

// The profile restores page tabs across tests, so counts are relative.
const pageTabs = (page: Page) => page.getByRole('tablist', { name: 'Page tabs' }).getByRole('tab');

/** The "+" once the plugin inventory has loaded with two or more plugins. */
async function menuLauncher(page: Page) {
  const plus = shell(page).header.getByRole('button', { name: 'New tab', exact: true });
  await expect(plus).toHaveAttribute('aria-haspopup', 'menu');
  return plus;
}

test.describe('New-tab launcher', () => {
  test('the header "+" lists every plugin and opens the chosen one on its home page in a new tab', async ({ page }) => {
    await mockBindings(page, Service.plugins, { ListPlugins: [fakePlugin(1), fakePlugin(2), fakePlugin(3)] });
    await page.goto('/');
    const plus = await menuLauncher(page);
    const before = await pageTabs(page).count();

    await plus.click();
    const menu = page.getByRole('menu', { name: 'New tab' });
    await expect(menu.getByRole('menuitem')).toHaveCount(3);
    await menu.getByRole('menuitem', { name: /E2E Plugin 2/ }).click();

    await expect(menu).toBeHidden();
    await expect(pageTabs(page)).toHaveCount(before + 1);
    await expect(page).toHaveURL(/#\/_plugin\/e2e-plugin-2$/);
  });

  test('Ctrl+T opens the menu, and type-ahead with Enter picks a plugin', async ({ page }) => {
    await mockBindings(page, Service.plugins, { ListPlugins: [fakePlugin(1), fakePlugin(2, { metadata: { ...fakePlugin(2).metadata, name: 'Zeta' } })] });
    await page.goto('/');
    await menuLauncher(page);
    const before = await pageTabs(page).count();

    await page.keyboard.press('Control+t');
    await expect(page.getByRole('menu', { name: 'New tab' })).toBeVisible();
    await page.keyboard.press('z');
    await page.keyboard.press('Enter');

    await expect(pageTabs(page)).toHaveCount(before + 1);
    await expect(page).toHaveURL(/#\/_plugin\/e2e-plugin-2$/);
  });

  test('with one plugin, Ctrl+T opens it directly', async ({ page }) => {
    await mockBindings(page, Service.plugins, { ListPlugins: [fakePlugin(1)] });
    await page.goto('/');
    await expect(shell(page).header.getByRole('button', { name: 'New E2E Plugin 1 tab' })).toBeEnabled();
    const before = await pageTabs(page).count();

    await page.keyboard.press('Control+t');

    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(pageTabs(page)).toHaveCount(before + 1);
    await expect(page).toHaveURL(/#\/_plugin\/e2e-plugin-1$/);
  });
});

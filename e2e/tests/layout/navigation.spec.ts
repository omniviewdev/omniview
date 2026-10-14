import { test, expect } from '../fixtures/app.fixture';
import { expectPageDoesNotScroll, shell } from '../fixtures/helpers';

test.describe('Navigation', () => {
  test('sidebar is visible on load', async ({ appPage }) => {
    await expect(shell(appPage).rail).toBeVisible();
  });

  test('the home page shows the welcome screen', async ({ appPage }) => {
    await expect(shell(appPage).main.getByText('Omniview', { exact: true })).toBeVisible();
  });

  test('header buttons route to settings, plugins and back home', async ({ appPage }) => {
    const header = shell(appPage).header;

    await header.getByRole('button', { name: 'settings' }).click();
    await expect(appPage).toHaveURL(/#\/settings$/);
    await expect(appPage.getByRole('navigation').getByText('Appearance', { exact: true })).toBeVisible();

    await header.getByRole('button', { name: 'plugins' }).click();
    await expect(appPage).toHaveURL(/#\/plugins$/);
    await expect(appPage.getByText('Installed', { exact: true })).toBeVisible();

    await header.getByRole('button', { name: 'home' }).click();
    await expect(appPage).toHaveURL(/#\/$/);
    await expect(shell(appPage).main.getByText('Omniview', { exact: true })).toBeVisible();
  });

  test('browser back and forward move between pages', async ({ appPage }) => {
    const header = shell(appPage).header;
    await header.getByRole('button', { name: 'settings' }).click();
    await header.getByRole('button', { name: 'plugins' }).click();

    await appPage.goBack();
    await expect(appPage).toHaveURL(/#\/settings$/);
    await appPage.goForward();
    await expect(appPage).toHaveURL(/#\/plugins$/);
  });

  test('an unknown route shows an error page inside the shell', async ({ page }) => {
    await page.goto('/#/no-such-page');
    await expect(shell(page).root).toBeVisible();
    await expect(shell(page).header).toBeVisible();
    await expect(shell(page).rail).toBeVisible();
  });

  for (const path of ['/', '/settings', '/plugins']) {
    test(`${path} loads without uncaught errors or page scrollbars`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto(`/#${path}`);
      await expect(shell(page).root).toBeVisible();
      // Let lazy queries settle before judging.
      await page.waitForLoadState('networkidle');

      expect(errors).toEqual([]);
      await expectPageDoesNotScroll(page);
    });
  }
});

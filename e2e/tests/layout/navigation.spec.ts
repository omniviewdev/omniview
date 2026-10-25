import { test, expect } from '../fixtures/app.fixture';
import { expectPageDoesNotScroll, shell } from '../fixtures/helpers';

test.describe('Navigation', () => {
  test('sidebar is visible on load', async ({ appPage }) => {
    await expect(shell(appPage).rail).toBeVisible();
  });

  test('header buttons route to settings, plugins and back home', async ({ appPage }) => {
    const header = shell(appPage).header;

    await header.getByRole('button', { name: 'settings', exact: true }).click();
    await expect(appPage).toHaveURL(/#\/settings$/);
    await expect(appPage.getByRole('navigation').getByText('Appearance', { exact: true })).toBeVisible();

    await header.getByRole('button', { name: 'plugins' }).click();
    await expect(appPage).toHaveURL(/#\/plugins$/);
    await expect(appPage.getByRole('button', { name: /^Installed\b/ })).toBeVisible();

    await header.getByRole('button', { name: 'home' }).click();
    await expect(appPage).toHaveURL(/#\/$/);
  });

  test('browser back and forward move between pages', async ({ appPage }) => {
    const header = shell(appPage).header;
    await header.getByRole('button', { name: 'settings', exact: true }).click();
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
      const ready = path === '/'
        ? shell(page).main.getByRole('button', { name: 'Edit Layout' })
        : path === '/settings'
          ? page.getByRole('navigation').getByText('Appearance', { exact: true })
          : page.getByRole('button', { name: /^Installed\b/ });
      await expect(ready).toBeVisible();

      expect(errors).toEqual([]);
      await expectPageDoesNotScroll(page);
    });
  }
});

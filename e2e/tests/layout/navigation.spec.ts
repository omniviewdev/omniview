import { test, expect } from '../fixtures/app.fixture';
import { expectPageDoesNotScroll, shell } from '../fixtures/helpers';
import { fakeListing } from '../fixtures/plugins';
import { mockBindings, Service } from '../fixtures/wails';

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

  test.describe('nested marketplace routes', () => {
    let errors: string[];

    test.beforeEach(async ({ page }) => {
      errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await mockBindings(page, Service.plugins, {
        ListPlugins: [],
        ListAvailablePlugins: [fakeListing('alpha-tools'), fakeListing('beta-tools')],
        GetPluginReadme: (args: unknown[]) => `# ${String(args[0])} readme`,
        GetPluginReviews: [],
        GetPluginReleaseHistory: [],
      });
    });

    test.afterEach(() => {
      expect(errors).toEqual([]);
    });

    test('back and forward restore the selected detail and marketplace index', async ({ page }) => {
      await page.goto('/#/plugins');
      const main = shell(page).main;
      const alpha = main.getByRole('link', { name: /Alpha Tools/ });
      const beta = main.getByRole('link', { name: /Beta Tools/ });
      const alphaReadme = main.getByRole('heading', { name: 'alpha-tools readme', exact: true });
      const betaReadme = main.getByRole('heading', { name: 'beta-tools readme', exact: true });

      await alpha.click();
      await expect(page).toHaveURL(/#\/plugins\/alpha-tools$/);
      await expect(alphaReadme).toBeVisible();
      await beta.click();
      await expect(page).toHaveURL(/#\/plugins\/beta-tools$/);
      await expect(betaReadme).toBeVisible();
      await expect(alphaReadme).toHaveCount(0);

      await page.goBack();
      await expect(page).toHaveURL(/#\/plugins\/alpha-tools$/);
      await expect(alphaReadme).toBeVisible();
      await expect(betaReadme).toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(/#\/plugins$/);
      await expect(main.getByText('Select a plugin to view details, or browse the Marketplace.')).toBeVisible();
      await expect(alphaReadme).toHaveCount(0);
      await expect(alpha).toBeVisible();
      await expect(beta).toBeVisible();

      await page.goForward();
      await expect(page).toHaveURL(/#\/plugins\/alpha-tools$/);
      await expect(alphaReadme).toBeVisible();
      await page.goForward();
      await expect(page).toHaveURL(/#\/plugins\/beta-tools$/);
      await expect(betaReadme).toBeVisible();
      await expect(alphaReadme).toHaveCount(0);
    });

    test('a detail deep link survives reload and recovers from an unknown plugin', async ({ page }) => {
      await page.goto('/#/plugins/alpha-tools');
      const main = shell(page).main;
      const readme = main.getByRole('heading', { name: 'alpha-tools readme', exact: true });
      await expect(readme).toBeVisible();
      await expect(main.getByRole('link', { name: /Beta Tools/ })).toBeVisible();

      await page.reload();
      await expect(page).toHaveURL(/#\/plugins\/alpha-tools$/);
      await expect(readme).toBeVisible();
      await expect(shell(page).header).toBeVisible();
      await expect(shell(page).rail).toBeVisible();

      await page.goto('/#/plugins/does-not-exist');
      await expect(main.getByText('Plugin not found', { exact: true })).toBeVisible();
      await expect(readme).toHaveCount(0);
      await main.getByRole('link', { name: /Alpha Tools/ }).click();
      await expect(page).toHaveURL(/#\/plugins\/alpha-tools$/);
      await expect(readme).toBeVisible();
      await expect(main.getByText('Plugin not found', { exact: true })).toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(/#\/plugins\/does-not-exist$/);
      await expect(main.getByText('Plugin not found', { exact: true })).toBeVisible();
    });
  });
});

import { test, expect } from '../fixtures/app.fixture';
import { expectPageDoesNotScroll, settingsWindowPage, settingRow, shell } from '../fixtures/helpers';
import { fakeListing } from '../fixtures/plugins';
import { callBinding, mockBindings, Service } from '../fixtures/wails';

test.describe('Navigation', () => {
  test('header opens one retained Settings window without changing the workspace', async ({ appPage }) => {
    const header = shell(appPage).header;
    const workspaceURL = appPage.url();
    const tabs = await appPage.getByRole('tab').allTextContents();
    await header.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = await settingsWindowPage(appPage);
    await expect(settings.getByRole('option', { name: 'Appearance', exact: true })).toBeVisible();
    await expect(shell(settings).root).toHaveCount(0);
    await expect(shell(settings).header).toHaveCount(0);
    await expect(shell(settings).footer).toHaveCount(0);
    await expect(appPage).toHaveURL(workspaceURL);
    expect(await appPage.getByRole('tab').allTextContents()).toEqual(tabs);

    const nativeWindows = (await callBinding<Array<{ name: string; kind: string }>>(
      appPage.request, Service.windows, 'List',
    )).filter(window => window.kind === 'settings').map(({ name, kind }) => ({ name, kind }));
    expect(nativeWindows).toHaveLength(1);
    await settings.getByRole('option', { name: 'Developer Settings', exact: true }).click();
    const draft = settingRow(settings, 'developer.gopath').getByRole('textbox');
    await draft.fill('/tmp/e2e-retained-settings-draft');
    const root = await settings.locator('[data-visible]').elementHandle();
    expect(root).not.toBeNull();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect.poll(async () => (await callBinding<{ visible: boolean }>(
      appPage.request, Service.windows, 'GetSettingsState',
    )).visible).toBe(false);
    await expect(settings.locator('[data-visible]')).toHaveAttribute('data-visible', 'false');
    await header.getByRole('button', { name: 'Settings', exact: true }).click();
    expect(await settingsWindowPage(appPage)).toBe(settings);
    await expect(settings.locator('[data-visible]')).toHaveAttribute('data-visible', 'true');
    expect(await root.evaluate(node => node.isConnected && node === document.querySelector('[data-visible]'))).toBe(true);
    await expect(draft).toHaveValue('/tmp/e2e-retained-settings-draft');
    expect((await callBinding<Array<{ name: string; kind: string }>>(
      appPage.request, Service.windows, 'List',
    )).filter(window => window.kind === 'settings').map(({ name, kind }) => ({ name, kind }))).toEqual(nativeWindows);
    await expect(appPage).toHaveURL(workspaceURL);
    expect(await appPage.getByRole('tab').allTextContents()).toEqual(tabs);
    await settings.getByRole('button', { name: 'Discard', exact: true }).click();

    await header.getByRole('button', { name: 'plugins' }).click();
    await expect(appPage).toHaveURL(/#\/plugins$/);
    await expect(appPage.getByRole('button', { name: /^Installed\b/ })).toBeVisible();
    await header.getByRole('button', { name: 'home' }).click();
    await expect(appPage).toHaveURL(/#\/$/);
  });

  test('Settings never enters workspace back and forward history', async ({ appPage }) => {
    const header = shell(appPage).header;
    await header.getByRole('button', { name: 'plugins' }).click();
    await expect(appPage).toHaveURL(/#\/plugins$/);
    await header.getByRole('button', { name: 'Settings', exact: true }).click();
    await settingsWindowPage(appPage);
    await expect(appPage).toHaveURL(/#\/plugins$/);
    await header.getByRole('button', { name: 'home' }).click();
    await expect(appPage).toHaveURL(/#\/$/);
    await appPage.goBack();
    await expect(appPage).toHaveURL(/#\/plugins$/);
    await appPage.goBack();
    await expect(appPage).toHaveURL(/#\/$/);
    await appPage.goForward();
    await expect(appPage).toHaveURL(/#\/plugins$/);
    await appPage.goForward();
    await expect(appPage).toHaveURL(/#\/$/);
  });

  test('an unknown route shows an error page inside the shell', async ({ page }) => {
    await page.goto('/#/no-such-page');
    await expect(shell(page).root).toBeVisible();
    await expect(shell(page).header).toBeVisible();
    await expect(shell(page).main).toBeVisible();
  });

  for (const path of ['/', '/plugins']) {
    test(`${path} loads without uncaught errors or page scrollbars`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto(`/#${path}`);
      await expect(shell(page).root).toBeVisible();
      if (path === '/') {
        // The native main window retains its tabs across browser documents.
        await shell(page).header.getByRole('button', { name: 'home', exact: true }).click();
      }

      const ready = path === '/'
        ? shell(page).main.getByRole('button', { name: 'Edit Layout' })
        : page.getByRole('button', { name: /^Installed\b/ });
      await expect(ready).toBeVisible();

      expect(errors).toEqual([]);
      await expectPageDoesNotScroll(page);
    });
  }

  test('Settings loads without workspace shell, uncaught errors or document overflow', async ({ appPage }) => {
    const errors: string[] = [];
    await shell(appPage).header.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = await settingsWindowPage(appPage, async auxiliary => {
      auxiliary.on('pageerror', error => errors.push(error.message));
    });
    await expect(settings.getByRole('option', { name: 'Appearance', exact: true })).toBeVisible();
    await expect(shell(settings).root).toHaveCount(0);
    await expectPageDoesNotScroll(settings);
    expect(errors).toEqual([]);
  });

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
      await expect(shell(page).main).toBeVisible();

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

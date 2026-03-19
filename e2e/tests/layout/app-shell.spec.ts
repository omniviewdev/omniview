import { test, expect } from '../fixtures/app.fixture';

test.describe('App Shell', () => {
  test('loads without errors', async ({ appPage }) => {
    await expect(appPage.locator('[data-testid="app-shell"]')).toBeVisible();
  });

  test('header is visible', async ({ appPage }) => {
    await expect(appPage.locator('[data-testid="app-header"]')).toBeVisible();
  });

  test('sidebar is visible', async ({ appPage }) => {
    await expect(appPage.locator('[data-testid="app-sidebar"]')).toBeVisible();
  });

  test('main content area is visible', async ({ appPage }) => {
    await expect(appPage.locator('[data-testid="app-main-content"]')).toBeVisible();
  });

  test('footer is visible', async ({ appPage }) => {
    await expect(appPage.locator('[data-testid="app-footer"]')).toBeVisible();
  });
});

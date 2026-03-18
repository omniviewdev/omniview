import { test, expect } from '../fixtures/app.fixture';

test.describe('App Shell', () => {
  test('loads without errors', async ({ appPage }) => {
    // Verify the app shell rendered (fixture already waited for it)
    await expect(appPage.locator('[data-testid="app-shell"]')).toBeVisible();
  });

  test('has no console errors on initial load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15_000 });

    // Filter out known benign errors if needed
    expect(errors).toEqual([]);
  });
});

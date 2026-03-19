import { test, expect } from '../fixtures/app.fixture';

test.describe('Navigation', () => {
  test('sidebar is visible on load', async ({ appPage }) => {
    await expect(appPage.locator('[data-testid="app-sidebar"]')).toBeVisible();
  });
});

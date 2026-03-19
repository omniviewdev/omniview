import { test, expect } from '../fixtures/app.fixture';

test.describe('Bottom Drawer', () => {
  test('drag handle is present', async ({ appPage }) => {
    // This data-testid already exists in the codebase
    const handle = appPage.locator('[data-testid="bottom-drawer-drag-handle"]');
    // The drawer may be collapsed by default — just verify the handle exists in DOM
    await expect(handle).toBeAttached();
  });
});

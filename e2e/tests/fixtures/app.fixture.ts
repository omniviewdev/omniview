import { test as base, type Page } from '@playwright/test';

type AppFixtures = {
  appPage: Page;
};

export const test = base.extend<AppFixtures>({
  appPage: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15_000 });
    await use(page);
  },
});

export { expect } from '@playwright/test';

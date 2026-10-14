import { test, expect } from '../fixtures/app.fixture';
import { expectNoVisibleScrollbars, expectPageDoesNotScroll, shell } from '../fixtures/helpers';
import { fakePlugin } from '../fixtures/plugins';
import { mockBindings, Service } from '../fixtures/wails';

test.describe('Plugin rail', () => {
  test('lists one entry per plugin, linking to its page', async ({ page }) => {
    await mockBindings(page, Service.plugins, { ListPlugins: [fakePlugin(1), fakePlugin(2), fakePlugin(3)] });
    await page.goto('/');

    const rail = shell(page).rail;
    const entries = rail.getByRole('link');
    await expect(entries).toHaveCount(3);
    await expect(rail.getByRole('link', { name: 'E2E Plugin 2' })).toHaveAttribute('href', '#/_plugin/e2e-plugin-2');
  });

  test('marks the open plugin as the current page', async ({ page }) => {
    await mockBindings(page, Service.plugins, { ListPlugins: [fakePlugin(1), fakePlugin(2)] });
    await page.goto('/#/_plugin/e2e-plugin-2');

    const rail = shell(page).rail;
    await expect(rail.getByRole('link', { name: 'E2E Plugin 2' })).toHaveAttribute('aria-current', 'page');
    await expect(rail.getByRole('link', { name: 'E2E Plugin 1' })).not.toHaveAttribute('aria-current', 'page');
  });

  test('scrolls a long plugin list without showing a scrollbar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await mockBindings(page, Service.plugins, {
      ListPlugins: Array.from({ length: 30 }, (_, i) => fakePlugin(i + 1)),
    });
    await page.goto('/');

    const rail = shell(page).rail;
    await expect(rail.getByRole('link')).toHaveCount(30);

    // The list really is taller than the rail, so it has to scroll...
    const { scrollHeight, clientHeight } = await rail.evaluate((el) => ({
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);
    await rail.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(rail.getByRole('link', { name: 'E2E Plugin 30' })).toBeInViewport();

    // ...but neither the rail nor the window shows a scrollbar for it.
    await expect(rail).toHaveCSS('scrollbar-width', 'none');
    await expectNoVisibleScrollbars(rail);
    await expectPageDoesNotScroll(page);
  });

  test('keeps entries the full rail width with nothing overflowing sideways', async ({ page }) => {
    await mockBindings(page, Service.plugins, { ListPlugins: [fakePlugin(1)] });
    await page.goto('/');

    const rail = shell(page).rail;
    const entry = rail.getByRole('link', { name: 'E2E Plugin 1' });
    await expect(entry).toBeVisible();

    const railInner = await rail.evaluate((el) => ({ width: el.clientWidth, overflow: el.scrollWidth - el.clientWidth }));
    expect((await entry.boundingBox())!.width).toBeCloseTo(railInner.width, 0);
    expect(railInner.overflow).toBe(0);
  });
});

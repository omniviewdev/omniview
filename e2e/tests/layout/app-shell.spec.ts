import { test, expect } from '../fixtures/app.fixture';
import { expectPageDoesNotScroll, shell } from '../fixtures/helpers';

// Borders and subpixel rounding can shift an edge by one pixel.
function expectWithinPixel(actual: number, expected: number) {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(1);
}

test.describe('App Shell', () => {
  test('loads without errors', async ({ appPage }) => {
    await expect(shell(appPage).root).toBeVisible();
  });

  test('header is visible', async ({ appPage }) => {
    await expect(shell(appPage).header).toBeVisible();
  });

  test('sidebar is visible', async ({ appPage }) => {
    await expect(shell(appPage).rail).toBeVisible();
  });

  test('main content area is visible', async ({ appPage }) => {
    await expect(shell(appPage).main).toBeVisible();
  });

  test('footer is visible', async ({ appPage }) => {
    await expect(shell(appPage).footer).toBeVisible();
  });

  test('regions tile the window: header on top, rail left, footer at the bottom', async ({ appPage }) => {
    const { header, rail, main, footer } = shell(appPage);
    const viewport = appPage.viewportSize()!;
    const [h, r, m, f] = await Promise.all([header, rail, main, footer].map(async (l) => (await l.boundingBox())!));

    expect(h.y).toBe(0);
    expectWithinPixel(h.width, viewport.width);
    expectWithinPixel(f.y + f.height, viewport.height);
    expectWithinPixel(f.width, viewport.width);

    expect(r.x).toBe(0);
    expectWithinPixel(r.y, h.y + h.height);
    expectWithinPixel(r.y + r.height, f.y);

    expectWithinPixel(m.x, r.x + r.width);
    expectWithinPixel(m.y, h.y + h.height);
    expectWithinPixel(m.x + m.width, viewport.width);
    expectWithinPixel(m.y + m.height, f.y);
  });

  for (const size of [{ width: 900, height: 600 }, { width: 1920, height: 1080 }]) {
    test(`fits a ${size.width}x${size.height} window without page scrollbars`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(shell(page).root).toBeVisible();

      const box = (await shell(page).root.boundingBox())!;
      expectWithinPixel(box.width, size.width);
      expectWithinPixel(box.height, size.height);
      await expectPageDoesNotScroll(page);
    });
  }

  test('footer tooltips open above the shell', async ({ appPage }) => {
    await shell(appPage).footer.getByRole('button', { name: 'Notifications' }).hover();
    const tooltip = appPage.getByText('Notifications', { exact: true });
    await expect(tooltip).toBeVisible();

    // Whatever is painted at the tooltip's centre must be the tooltip itself.
    const box = (await tooltip.boundingBox())!;
    const onTop = await tooltip.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x, y)), [
      box.x + box.width / 2, box.y + box.height / 2,
    ]);
    expect(onTop).toBe(true);
  });
});

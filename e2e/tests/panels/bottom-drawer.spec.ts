import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app.fixture';
import { expectPageDoesNotScroll } from '../fixtures/helpers';

// Collapsed height of the drawer (its tab strip) and the height a new tab opens it to.
const MINIMIZED = 32;
const DEFAULT_EXPANDED = 550;

function drawer(page: Page) {
  const handle = page.getByTestId('bottom-drawer-drag-handle');
  const root = handle.locator('..');
  return {
    handle,
    root,
    tabs: page.getByRole('tablist', { name: 'Bottom drawer tabs' }).getByRole('tab'),
    newTerminal: page.getByRole('button', { name: 'New terminal' }),
    height: async () => (await root.boundingBox())!.height,
  };
}

async function openTerminal(page: Page) {
  const d = drawer(page);
  const before = await d.tabs.count();
  await d.newTerminal.click();
  await expect(d.tabs).toHaveCount(before + 1);
  return d;
}

/** Drags the drawer's top edge to the given distance from the bottom of the window. */
async function dragDrawerTo(page: Page, heightFromBottom: number) {
  const d = drawer(page);
  const box = (await d.handle.boundingBox())!;
  const viewport = page.viewportSize()!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, viewport.height - heightFromBottom, { steps: 8 });
  await page.mouse.up();
}

test.describe('Bottom Drawer', () => {
  test('starts minimized to its tab strip with no tabs', async ({ appPage }) => {
    const d = drawer(appPage);
    await expect(d.handle).toBeAttached();
    await expect(d.tabs).toHaveCount(0);
    expect(await d.height()).toBeCloseTo(MINIMIZED, 0);
    await expect(appPage.getByRole('button', { name: 'Expand' })).toBeDisabled();
  });

  test('opening a terminal adds a tab and expands the drawer', async ({ appPage }) => {
    const d = await openTerminal(appPage);
    await expect(d.tabs.first()).toHaveAttribute('aria-selected', 'true');
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);
    await expectPageDoesNotScroll(appPage);
  });

  test('minimize and expand restore the previous height', async ({ appPage }) => {
    const d = await openTerminal(appPage);
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);

    await appPage.getByRole('button', { name: 'Minimize' }).click();
    await expect.poll(d.height).toBeCloseTo(MINIMIZED, 0);

    await appPage.getByRole('button', { name: 'Expand' }).click();
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);
  });

  test('full screen fills the window and toggles back', async ({ appPage }) => {
    const d = await openTerminal(appPage);
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);

    await appPage.getByRole('button', { name: 'Full screen' }).click();
    const viewportHeight = appPage.viewportSize()!.height;
    await expect(appPage.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
    // The drawer is sized to the window but clipped by the shell's content area.
    await expect.poll(async () => d.root.evaluate((el) => parseInt(el.style.height, 10))).toBe(viewportHeight);

    await appPage.getByRole('button', { name: 'Exit full screen' }).click();
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);
    await expectPageDoesNotScroll(appPage);
  });

  test('dragging the top edge resizes the drawer', async ({ appPage }) => {
    const d = await openTerminal(appPage);
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);

    await dragDrawerTo(appPage, 300);
    const resized = await d.height();
    expect(resized).toBeLessThan(DEFAULT_EXPANDED - 100);
    expect(resized).toBeGreaterThan(200);
    await expectPageDoesNotScroll(appPage);
  });

  test('dragging it nearly shut snaps it to minimized', async ({ appPage }) => {
    const d = await openTerminal(appPage);
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);

    await dragDrawerTo(appPage, 50);
    await expect.poll(d.height).toBeCloseTo(MINIMIZED, 0);
    await expect(appPage.getByRole('button', { name: 'Expand' })).toBeEnabled();
  });

  test('double-clicking the edge toggles between minimized and expanded', async ({ appPage }) => {
    const d = await openTerminal(appPage);
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);

    await d.handle.dblclick();
    await expect.poll(d.height).toBeCloseTo(MINIMIZED, 0);
    await d.handle.dblclick();
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);
  });

  // Known bug: tabs are restored from ListSessions after the drawer has already
  // resolved its startup state with zero tabs, so the restored tab auto-expands
  // it to the default height instead of the saved one (ticket omn-u6pg).
  test.fixme('remembers its resized height across a reload', async ({ appPage }) => {
    const d = await openTerminal(appPage);
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);
    await dragDrawerTo(appPage, 300);
    const resized = await d.height();

    await appPage.reload();
    // The terminal session survives the reload and comes back as a tab.
    await expect(d.tabs).toHaveCount(1);
    await expect.poll(d.height).toBeCloseTo(resized, 0);
  });

  test('closing the last tab collapses the drawer', async ({ appPage }) => {
    const d = await openTerminal(appPage);
    await expect.poll(d.height).toBeCloseTo(DEFAULT_EXPANDED, 0);

    await d.tabs.first().getByLabel('Close tab').click();
    await expect(d.tabs).toHaveCount(0);
    await expect.poll(d.height).toBeCloseTo(MINIMIZED, 0);
  });

  test('switches between terminal tabs', async ({ appPage }) => {
    await openTerminal(appPage);
    const d = await openTerminal(appPage);

    await expect(d.tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await d.tabs.nth(0).click();
    await expect(d.tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(d.tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
  });
});

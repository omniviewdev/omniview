import { expect, type Locator, type Page } from '@playwright/test';

/** The shell's fixed regions, by the test ids CoreLayout puts on them. */
export const shell = (page: Page) => ({
  root: page.getByTestId('app-shell'),
  header: page.getByTestId('app-header'),
  rail: page.getByTestId('app-sidebar'),
  main: page.getByTestId('app-main-content'),
  footer: page.getByTestId('app-footer'),
});


export type Rgb = [number, number, number];

export async function backgroundOf(locator: Locator): Promise<Rgb> {
  const color = await locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!match) {
    throw new Error(`unexpected background color ${color}`);
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** A dark, near-neutral gray, as in the Default dark theme. */
export function isNeutralDark([r, g, b]: Rgb): boolean {
  return Math.max(r, g, b) < 64 && Math.max(r, g, b) - Math.min(r, g, b) <= 12;
}

/** The dark blue-green of Solarized dark's base03/base02 range. */
export function isSolarizedDark([r, g, b]: Rgb): boolean {
  return r < 40 && g > r + 25 && b > g;
}

/** Navigates within the hash router without reloading the app. */
export async function goTo(page: Page, path: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash; 
  }, `#${path}`);
  await expect(page).toHaveURL(new RegExp(`#${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
}

/**
 * Asserts that an element does not show a scrollbar: it either does not
 * overflow, or it overflows with its scrollbar hidden (no gutter).
 */
export async function expectNoVisibleScrollbars(locator: Locator): Promise<void> {
  const metrics = await locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const borderX = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    return {
      verticalGutter: el.getBoundingClientRect().width - borderX - el.clientWidth,
      horizontalGutter: el.getBoundingClientRect().height - borderY - el.clientHeight,
    };
  });
  expect(metrics.verticalGutter, 'vertical scrollbar gutter').toBeLessThan(1);
  expect(metrics.horizontalGutter, 'horizontal scrollbar gutter').toBeLessThan(1);
}

/** Asserts that the document itself does not scroll in either direction. */
export async function expectPageDoesNotScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight };
  });
  expect(overflow, 'document overflow').toEqual({ x: 0, y: 0 });
}

/** Opens a core settings category from the settings nav. */
export async function openSettingsCategory(page: Page, label: string): Promise<void> {
  await goTo(page, '/settings');
  await page.getByRole('navigation').getByText(label, { exact: true }).click();
  await expect(page.getByText(label, { exact: true }).nth(1)).toBeVisible();
}

/**
 * The row of a single setting on a core settings page, found by its full id
 * (for example `appearance.theme`), which the page prints under the label.
 */
export function settingRow(page: Page, id: string): Locator {
  return page
    .getByText(id, { exact: true })
    .locator('xpath=ancestor::*[.//input or .//*[@role="combobox"] or .//*[@role="switch"] or .//*[@role="checkbox"]][1]');
}

/** Picks an option from a select-type setting. */
export async function chooseSetting(page: Page, id: string, option: string): Promise<void> {
  await settingRow(page, id).getByRole('combobox').click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

export async function saveSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeHidden();
}


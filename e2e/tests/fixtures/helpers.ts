import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { bindWindowContext, callBinding, Service } from './wails';

const settingsPages = new WeakMap<BrowserContext, Page>();

/** The shell's fixed regions, by the test ids CoreLayout puts on them. */
export const shell = (page: Page) => ({
  root: page.getByTestId('app-shell'),
  header: page.getByTestId('app-header'),
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

/**
 * Attach a browser document to Settings only after the real backend registered it.
 * Native show/focus operations cannot create a Playwright tab in server mode.
 */
export async function settingsWindowPage(
  mainPage: Page,
  beforeNavigate?: (settings: Page) => Promise<void>,
): Promise<Page> {
  await expect.poll(async () => (await callBinding<Array<{ name: string; kind: string }>>(mainPage.request, Service.windows, 'List'))
    .some(window => window.name === 'settings' && window.kind === 'settings'),
  { message: 'Settings must be registered by the real window service' }).toBe(true);
  const context = mainPage.context();
  const existing = settingsPages.get(context);
  if (existing && !existing.isClosed()) {
    if (beforeNavigate) {
      throw new Error('Settings setup must precede its first navigation');
    }

    await expect(existing.getByRole('searchbox', { name: 'Search settings' })).toBeVisible();
    return existing;
  }

  const settings = await context.newPage();
  await bindWindowContext(settings, 'settings');
  await beforeNavigate?.(settings);
  await settings.goto('/#/');
  await expect(settings.getByRole('searchbox', { name: 'Search settings' })).toBeVisible();
  settingsPages.set(context, settings);
  return settings;
}

/** Request the real singleton, then attach its retained browser document. */
export async function openSettingsWindow(
  mainPage: Page,
  target = '',
  beforeNavigate?: (settings: Page) => Promise<void>,
): Promise<Page> {
  await callBinding(mainPage.request, Service.windows, 'OpenSettings', target);
  return settingsWindowPage(mainPage, beforeNavigate);
}

/** Open a core category in the dedicated Settings document. */
export async function openSettingsCategory(page: Page, label: string): Promise<Page> {
  const settings = await openSettingsWindow(page);
  await settings.getByRole('option', { name: label, exact: true }).click();
  return settings;
}

/** Finds a core setting row by stable identity, independent of its visible label or help. */
export function settingRow(page: Page, id: string): Locator {
  return page.locator(`[data-setting-id=${JSON.stringify(id)}]`);
}

/** Picks an option from a select-type setting. */
export async function chooseSetting(page: Page, id: string, option: string): Promise<void> {
  if (id === 'appearance.theme') {
    await settingRow(page, id).getByRole('radio', { name: option, exact: true }).click();
  } else {
    await settingRow(page, id).getByRole('combobox').selectOption({ label: option });
  }
}

export async function saveSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeHidden();
}


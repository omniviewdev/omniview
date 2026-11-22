// The screenshots of the Settings probe (SHOTS=<dir>): the picture a person looks at, taken by the probe on the real Settings, WebKit, Void, with the page's own fonts, and set beside the picture it is compared with.
//
//   probe-window.png              the Settings window's content (1060 x 640), on its General page: the new window                      probe-window-vs-old.png     it beside the original application's General page (OLD_PNG)
//   probe-sheet-over-shell.png    the sheet over the window's shell (1440 x 900), on Terminal with one value changed (its Reset)          probe-page-vs-mock.png      the page beside the mock's Terminal page (MOCK_URL: the mock served, as mock-settings-measure.mjs does)
//   probe-states.png              loading, could not load and nothing to show, in the sheet, side by side
// A figure beside another is composed in a page of the engine, so no image library is needed. Without MOCK_URL the mock's side is left out; without OLD_PNG's file the original's is.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sleep, WINDOW_SIZES } from './settings-lib.mjs';
import { openFixture } from './settings-lib.mjs';

const OLD_PNG = process.env.OLD_PNG ?? '/Users/joshuapare/Notes/omniview/ui-migration/status/ST1-assets/old-settings-general-webkit.png';
const enc = (value) => encodeURIComponent(JSON.stringify(value));
const still = async (page) => {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(2, 2);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await sleep(300);
};

/** One image beside another, labelled, as a picture of its own: a page of the engine lays them out and takes it. */
async function beside(env, file, figures) {
  const context = await env.browser.newContext({ viewport: { width: 400, height: 300 } });
  try {
    const page = await context.newPage();
    const images = figures.map(({ label, buffer }) => `<figure style="margin:0"><img style="display:block;max-width:none" src="data:image/png;base64,${buffer.toString('base64')}"><figcaption style="font:600 14px system-ui;color:#ddd;padding:6px 0">${label}</figcaption></figure>`).join('');
    await page.setContent(`<body style="margin:0;padding:12px;background:#111;display:flex;gap:12px;align-items:flex-start">${images}</body>`);
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: file, fullPage: true });
  } finally {
    await context.close();
  }
}

export async function shotsSection(env) {
  if (env.shots === undefined || env.engine !== 'webkit' || !env.first) return;
  const out = (name) => path.join(env.shots, name);

  // The window beside the original.
  const win = await openFixture(env, `case=window&request=${enc({ requestId: 1, target: '/settings?category=general', visible: true })}`, { viewport: WINDOW_SIZES['1060x640'], fonts: 'none' });
  await win.page.waitForSelector('[data-settings-part="window"][data-visible="true"] [data-settings-row]');
  await still(win.page);
  const windowPng = await win.page.screenshot({ path: out('probe-window.png') });
  await win.context.close();
  if (existsSync(OLD_PNG)) await beside(env, out('probe-window-vs-old.png'), [{ label: 'the original application (WebKit, 1060 x 639)', buffer: readFileSync(OLD_PNG) }, { label: 'the new Settings window (WebKit, 1060 x 640)', buffer: windowPng }]);

  // The sheet over the shell.
  const values = enc({ 'terminal.cursorBlink': false });
  const sheet = await openFixture(env, `case=sheet&values=${values}`, { fonts: 'none' });
  await sheet.page.locator('[data-shell-part="settings"]').click();
  await sheet.page.waitForSelector('dialog[open] [data-settings-row]');
  await sheet.page.locator('[data-settings-part="nav"] [data-settings-page="terminal"]').click();
  await sleep(200);
  await still(sheet.page);
  const sheetPng = await sheet.page.screenshot({ path: out('probe-sheet-over-shell.png') });
  await sheet.context.close();

  // The page beside the mock's.
  if (process.env.MOCK_URL !== undefined) {
    const context = await env.browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(process.env.MOCK_URL, { waitUntil: 'load' });
      await sleep(3000);
      await page.evaluate(() => Shell.settings.open('terminal'));
      await sleep(2000);
      await still(page);
      const mockPng = await page.screenshot({ path: out('probe-mock-settings.png') });
      await beside(env, out('probe-page-vs-mock.png'), [{ label: 'the mock\'s Settings tab, Terminal (WebKit, 1440 x 900)', buffer: mockPng }, { label: 'the new sheet, Terminal (WebKit, 1440 x 900)', buffer: sheetPng }]);
    } finally {
      await context.close();
    }
  }

  // The three states of the body, in the sheet.
  const states = [];
  for (const [label, query, ready] of [
    ['loading', 'case=sheet&host=held', '[data-settings-state="loading"]'],
    ['could not load', 'case=sheet&host=down', '[data-settings-state="failed"]'],
    ['nothing to show', 'case=sheet&host=empty', '[data-settings-state="empty"]'],
  ]) {
    const opened = await openFixture(env, query, { viewport: { width: 1100, height: 700 }, fonts: 'none' });
    await opened.page.locator('[data-shell-part="settings"]').click();
    await opened.page.waitForSelector(`dialog[open] ${ready}`);
    await still(opened.page);
    states.push({ label, buffer: await opened.page.screenshot() });
    await opened.context.close();
  }

  await beside(env, out('probe-states.png'), states);
}

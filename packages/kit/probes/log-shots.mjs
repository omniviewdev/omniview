// Screenshots of the LogView examples for the status file (docs/ui-next/status/P1b-2.md), taken from the real `ui-next` parts page in WebKit at 1440 x 900, in the
// page's default theme (void): streaming with follow-tail, a search with matches, a marker where the feed dropped lines, a failed stream with its cause.
//
//   node packages/kit/probes/log-shots.mjs            builds ui-next (or DIST=<dir>, an existing build), serves it, writes the PNGs
//   SHOTS_DIR=<dir>  where they go (default: ~/Notes/omniview/ui-migration/status/P1b-2-assets); ENGINE=chromium for the other engine
//
// A dev tool, not a check: it asserts only that each example is on the page and has rows (or its notice). Needs Playwright's browsers and the BUILT kit.
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './probe-lib.mjs';
import { buildUiNext, serve } from './serve.mjs';

const OUT = process.env.SHOTS_DIR ?? path.join(os.homedir(), 'Notes/omniview/ui-migration/status/P1b-2-assets');
const ENGINE = process.env.ENGINE ?? 'webkit';
// [file, example, ms to let it run first]: the streaming example gets time to bring lines and to follow them.
const SHOTS = [
  ['streaming-follow-tail', 'LogView/Streaming', 3000],
  ['search-with-matches', 'LogView/Search', 600],
  ['dropped-lines-marker', 'LogView/DroppedLines', 600],
  ['failed-with-cause', 'LogView/Failed', 600],
  ['paused', 'LogView/Paused', 600],
  ['failed-before-any-line', 'LogView/FailedBeforeAnyLine', 600],
];

mkdirSync(OUT, { recursive: true });
const dist = buildUiNext();
const { server, partsUrl } = await serve(dist);
const browser = await launch(ENGINE);
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(partsUrl);
  await page.waitForSelector('[data-example="LogView/Streaming"]');
  // The parts page lays examples in 200 px columns; a log is read wide, so for the picture each LogView example spans the row.
  await page.addStyleTag({ content: '[data-example^="LogView/"] { grid-column: 1 / -1; }' });
  await page.evaluate(() => document.fonts.ready);
  for (const [file, example, wait] of SHOTS) {
    const figure = page.locator(`[data-example="${example}"]`);
    await figure.scrollIntoViewIfNeeded();
    await page.waitForTimeout(wait);
    const rows = await figure.locator('[role="row"][data-n]').count();
    const alert = await figure.locator('[role="alert"], [role="status"]').count();
    if (rows === 0 && alert === 0) throw new Error(`${example}: no rows and no notice`);
    await figure.screenshot({ path: path.join(OUT, `${ENGINE}-${file}.png`) });
    console.log(`${example}: ${rows} rows -> ${ENGINE}-${file}.png`);
  }
} finally {
  await browser.close();
  server.close();
}

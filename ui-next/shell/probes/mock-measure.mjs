// Measures the design mock's own frame: the REFERENCE the shell is compared with (shell-probe.mjs).
//
//   1. Serve the mock: a CommonJS copy of its server.js with `root` set to the mock directory (the lab's package.json says "type": "module").
//      The mock is `app/OmniviewNativeLab/frontend/mock` of the private repository omniviewdev/design-lab at tag spec-baseline-2026-11-16
//      (mock tree c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0).
//   2. MOCK_URL=http://127.0.0.1:<port>/ node ui-next/shell/probes/mock-measure.mjs
//
// The route is the plan's appendix B (see MOCK_OPEN in packages/kit/probes/mock-screen.mjs), opened in a freshly loaded page (resizing a page that had rendered
// once left the table blank). The font is normalized on both sides (Inter is not delivered; a missing font changes text widths, which are not
// what is compared). Per engine, viewport and context the page is read with targets.mjs and the result is written to mock-shell.json.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, VIEWPORTS, normalizeFont, setContext, sleep } from '../../../packages/kit/probes/probe-lib.mjs';
import { MOCK_OPEN } from '../../../packages/kit/probes/mock-screen.mjs';
import { readSide, readStates } from './lib.mjs';
import { CONTEXTS, THEME_MAP } from './targets.mjs';

const URL = process.env.MOCK_URL ?? 'http://127.0.0.1:49455/';
const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';

const data = {};
const themes = {};
const states = {};
for (const [engineName, engine] of Object.entries(ENGINES)) {
  const browser = await engine.launch();
  data[engineName] = {};
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    data[engineName][viewportName] = {};
    for (const [contextName, context] of Object.entries(CONTEXTS)) {
      // A fresh page for every reading: the mock does not redraw cleanly when its size or its text size changes after it rendered.
      const page = await (await browser.newContext({ viewport })).newPage();
      await page.goto(URL, { waitUntil: 'load' });
      await sleep(3000);
      await page.evaluate(MOCK_OPEN);
      await sleep(3500);
      await normalizeFont(page, { rootVar: '--int-font-ui' });
      await setContext(page, { ...context, flavour: 'mock' });
      await sleep(500);
      data[engineName][viewportName][contextName] = await readSide(page, 'mock');
      const missing = Object.entries(data[engineName][viewportName][contextName]).filter(([, reading]) => reading === null).map(([name]) => name);
      console.log(engineName, viewportName, contextName, missing.length === 0 ? 'ok' : `MISSING ${missing.join(', ')}`);
      await page.context().close();
    }
  }
  // Colours in each of the nine themes, at the default size and density: the mock flips its palette by an attribute on <html>.
  themes[engineName] = {};
  const page = await (await browser.newContext({ viewport: VIEWPORTS['1440x900'] })).newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(3000);
  await page.evaluate(MOCK_OPEN);
  await sleep(3500);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  for (const [themeId, mockTheme] of Object.entries(THEME_MAP)) {
    await page.evaluate((id) => (id === null ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', id)), mockTheme);
    await sleep(300);
    themes[engineName][themeId] = await readSide(page, 'mock');
    console.log(engineName, 'theme', themeId, 'ok');
  }
  // The paint of the tree rows and the tab in each state, in the default theme.
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await sleep(300);
  states[engineName] = await readStates(page, 'mock');
  console.log(engineName, 'states ok');
  await browser.close();
}

const file = path.join(here, 'mock-shell.json');
writeFileSync(file, `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, contexts: CONTEXTS, data, themes, states })}\n`);
console.log('wrote', file);

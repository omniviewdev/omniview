// Measures the design mock's form controls: the REFERENCE the kit's form parts (Field, TextInput, NumberInput, Toggle, Select, SecretInput) are
// compared with by form-probe.mjs. It reuses probe-lib.mjs and the case table of form-cases.mjs unchanged.
//
//   1. Serve the mock (a CommonJS copy of its server.js with `root` set to the mock directory; the lab's package.json says "type": "module"):
//      the mock is `app/OmniviewNativeLab/frontend/mock` of the private repository omniviewdev/design-lab at tag spec-baseline-2026-11-16
//      (mock tree c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0).
//   2. MOCK_URL=http://127.0.0.1:<port>/ node packages/kit/probes/mock-form-measure.mjs
//
// Every case of form-cases.mjs is staged (the mock's own helpers rendered into a neutral full-screen stage, as mock-measure-bc.mjs does), measured
// in WebKit and Chromium, in Void and in Light (`data-theme="light"` on <html>), at rest and in the states the case names, with real focus and the
// pointer; and read by parts. The stage does not depend on the viewport, so 1440 x 900 stands for the 1280 x 800 run too. A row case (`H.settingRow`) puts its own
// `.settings-page .setting-list` inside the stage, where the settings page puts a row, and is 880 px wide there (the page's own maximum). Writes mock-form.json:
// { meta, engines: { [engine]: { [theme]: { [case]: { primary: { [state]: summary }, parts: { [part]: node } } } } } }.
//
// Environment: ENGINE=webkit|chromium (comma list), ONLY=<regexp on a case id>: a debug run that writes nothing but mock-form.partial.json into the
// output directory. RAW=<dir>: the output directory.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { awaitFonts, launch, measure, settle, sleep, summarize } from './probe-lib.mjs';
import { CASES, MOCK_TREE, THEMES, readCase } from './form-cases.mjs';

const URL = process.env.MOCK_URL ?? 'http://127.0.0.1:49231/';
const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = process.env.RAW;
const OUT = RAW ?? here;
if (RAW) mkdirSync(RAW, { recursive: true });
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const engines = process.env.ENGINE ? process.env.ENGINE.split(',') : ['webkit', 'chromium'];
const STAGE_CSS = 'position:fixed;inset:0;z-index:99999;padding:40px;background:var(--int-bg-island)';

async function loadMock(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(3000);
  const ok = await page.evaluate(() => typeof window.H === 'object' && typeof window.ICONS === 'object' && typeof window.Shell === 'object');
  if (!ok) throw new Error('mock did not expose H / ICONS / Shell');
  await awaitFonts(page);
  return { page, context, errors };
}

const stage = (page, expr) =>
  page.evaluate(
    ({ expr, css }) => {
      let box = document.getElementById('probe-stage');
      if (box === null) {
        box = document.createElement('div');
        box.id = 'probe-stage';
        box.style.cssText = css;
        document.body.appendChild(box);
      }

      box.innerHTML = new Function('H', `return ${expr};`)(window.H);
    },
    { expr, css: STAGE_CSS },
  );

const mockParts = (parts) =>
  Object.fromEntries(Object.entries(parts ?? {}).map(([name, spec]) => [name, typeof spec === 'string' ? spec : { selector: spec.mock, pseudo: spec.pseudo }]));

const out = {};
for (const engine of engines) {
  const browser = await launch(engine);
  const { page, context, errors } = await loadMock(browser);
  out[engine] = {};
  for (const [theme, { mock }] of Object.entries(THEMES)) {
    await page.evaluate((value) => (value === null ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', value)), mock);
    await settle(page);
    out[engine][theme] = {};
    for (const c of CASES) {
      if (only !== null && !only.test(c.id)) continue;
      await stage(page, c.mock);
      await awaitFonts(page);
      if (c.wait !== undefined) await sleep(c.wait);
      const record = {};
      if (c.states !== undefined && c.states.length > 0) {
        const states = await measure(page, page.locator(c.mockRoot).first(), { states: c.states });
        record.primary = Object.fromEntries(Object.entries(states).map(([state, rec]) => [state, summarize(rec, { withOutline: state === 'focus' })]));
      }

      if (c.parts !== undefined) record.parts = await page.evaluate(readCase, { root: c.mockRoot, parts: mockParts(c.parts) });
      out[engine][theme][c.id] = record;
      console.log(`${engine} ${theme} ${c.id}`);
    }
  }

  if (errors.length > 0) console.log(`${engine} page errors: ${errors.join(' | ')}`);
  await context.close();
  await browser.close();
}

const meta = {
  source: `app/OmniviewNativeLab/frontend/mock of omniviewdev/design-lab at tag spec-baseline-2026-11-16 (mock tree ${MOCK_TREE})`,
  stage: 'fixed full-screen div #probe-stage, padding 40px, background var(--int-bg-island); 1440 x 900 (the stage does not depend on the viewport)',
  themes: Object.fromEntries(Object.entries(THEMES).map(([id, { mock }]) => [id, mock === null ? 'no data-theme' : `data-theme="${mock}"`])),
  tolerance: 'x and width 1 px, y and height 0.5 px, strings exact',
};
const file = path.join(OUT, only === null && !process.env.ENGINE ? 'mock-form.json' : 'mock-form.partial.json');
writeFileSync(file, `${JSON.stringify({ meta, engines: out })}\n`);
console.log(`wrote ${file}`);

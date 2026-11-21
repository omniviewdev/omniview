// Measures the design mock's tab strip with long titles and with twin tabs: the REFERENCE the shell's strip is compared with for where a title is cut and for the text that tells two tabs apart (step S3, demo findings D4 and D8).
//
// What it measures, per engine (webkit, chromium) and viewport (1440x900, 1280x800), in a freshly loaded page, with the mock's default context (font normalized as mock-measure.mjs does): the cases of strip-text-cases.mjs, each drawn by the
// mock's own `H.tabStrip` in the place of the strip of its top row (the first tab on screen), and for every tab: the face, the tab button, the glyph, the content, the title and its two parts, the head's text and whether it is cut,
// the tail's text width against the room it was given, and the qualifier (the muted text that tells a twin apart) with its text.
//
// Serve the mock first, or leave MOCK_URL out and the script serves it itself (MOCK_DIR, default: the lab's frontend/mock) on port 49474:
//   MOCK_URL=http://127.0.0.1:49471/ node ui-next/shell/probes/mock-strip-text-measure.mjs
// Writes mock-strip-text.json: { mockTree, viewports, cases, data: { <engine>: { <viewport>: { <case id>: [tab...] } } } }, a tab: { face, button, lead, content, title, head, headCut, headText, tail, tailText, tailBox, qualifier, qualifierText },
// rectangles [x, y, w, h] in px, 0.01; a part the tab does not draw is null.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';
import { MOCK_OPEN } from '../../../packages/kit/probes/mock-screen.mjs';
import { TEXT_CASES } from './strip-text-cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const started = Date.now();

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-strip-text-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49474' }, stdio: 'ignore' });
  url = 'http://127.0.0.1:49474/';
  await sleep(1500);
}

/** Runs in the mock's page: the strip is drawn again by `H.tabStrip` from the case's pages, and every tab is read. */
const READ = `((pages) => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)]; };
  const tabs = pages.map((page, index) => ({ id: 't' + index, title: page.title, icon: 'LuBox', ...(page.scope === undefined ? {} : { scope: page.scope }) }));
  document.querySelector('.tabstrip').outerHTML = H.tabStrip(tabs, { active: 't0' });
  const textWidth = (el) => { if (!el) return null; const range = document.createRange(); range.selectNodeContents(el); return r2(range.getBoundingClientRect().width); };
  return [...document.querySelectorAll('.tabstrip .tab-item')].map((face) => {
    const q = (selector) => face.querySelector(selector);
    const head = q('.tab__head');
    const tail = q('.tab__tail');
    const qualifier = q('.tab__scope');
    return {
      face: rect(face), button: rect(q('[role=tab]')), lead: rect(q('.tab__lead svg')), content: rect(q('.tab__content')), title: rect(q('.tab__title')),
      head: rect(head), headCut: head ? head.scrollWidth > head.clientWidth : null, headText: head ? textWidth(head) : null,
      tail: rect(tail), tailText: tail ? textWidth(tail.firstElementChild) : null,
      qualifier: rect(qualifier), qualifierText: qualifier ? qualifier.textContent : null,
    };
  });
})`;

const data = {};
let failed = false;
for (const [engineName, engine] of Object.entries(ENGINES)) {
  const browser = await engine.launch(engineName === 'chromium' ? { args: ['--font-render-hinting=none'] } : {});
  data[engineName] = {};
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    data[engineName][viewportName] = {};
    // One freshly loaded page for each viewport (the mock does not redraw cleanly when it is resized after it rendered); each case then draws its strip again in the place of the one before it, which is markup the mock's
    // own `H.tabStrip` returns whole.
    const page = await (await browser.newContext({ viewport })).newPage();
    await page.goto(url, { waitUntil: 'load' });
    await sleep(3000);
    await page.evaluate(MOCK_OPEN);
    await sleep(3500);
    await normalizeFont(page, { rootVar: '--int-font-ui' });
    for (const { id, pages } of TEXT_CASES) {
      const reading = await page.evaluate(`${READ}(${JSON.stringify(pages)})`);
      await sleep(200);
      if (reading.length !== pages.length) {
        console.log('MISSING tabs', engineName, viewportName, id, reading.length, 'of', pages.length);
        failed = true;
      }
      data[engineName][viewportName][id] = reading;
    }
    // The first case again: a strip drawn again reads as the one the page drew first.
    const again = await page.evaluate(`${READ}(${JSON.stringify(TEXT_CASES[0].pages)})`);
    if (JSON.stringify(again) !== JSON.stringify(data[engineName][viewportName][TEXT_CASES[0].id])) {
      console.log('DIFFERENT when drawn again', engineName, viewportName, TEXT_CASES[0].id);
      failed = true;
    }
    await page.context().close();
    console.log(engineName, viewportName, Object.keys(data[engineName][viewportName]).length, 'cases');
  }
  await browser.close();
}

const file = path.join(here, 'mock-strip-text.json');
writeFileSync(file, `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, cases: TEXT_CASES, note: 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. The mock default context, the font normalized (Helvetica, Arial). The first tab of a case is on screen.', data })}\n`);
server?.kill();
console.log('wrote', file, statSync(file).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
if (failed) {
  console.log('FAILED: a case did not draw the tabs it was given');
  process.exit(1);
}

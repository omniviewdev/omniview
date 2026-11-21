// Measures the design mock's sidebar tree with long names: the REFERENCE the shell's tree is compared with for the room a label gets beside its count (step S3, demo finding D7).
//
// What it measures, per engine (webkit, chromium) and viewport (1440x900, 1280x800), in a FRESH page per reading, with the mock's default context (font normalized as mock-measure.mjs does):
//   the mock's own `H.tree` (`rootDisclosure: 'end'`, the navigation the mock's resource sidebar uses) put in the place of the tree of its resource sidebar, with one open group of entries: every label of LABELS beside every count of
//   COUNTS, the labels neutral words (this folder names no plugin) whose widths in the normalized font are chosen so that they fall on either side of the rooms the mock and the shell give a label.
//   For each row: the row, the glyph, the label's box (the room it was given), the width of its text, whether it is cut (scrollWidth over clientWidth, as the mock's own clipped-cell tooltip asks), and the count's box and text.
// The sidebar's own box is read as well: the mock's sidebar is 244 px wide at both viewports (its default `--split-sidebar`; the user may drag it, the shell's is fixed).
//
// Serve the mock first, or leave MOCK_URL out and the script serves it itself (MOCK_DIR, default: the lab's frontend/mock) on port 49473:
//   MOCK_URL=http://127.0.0.1:49481/ node ui-next/shell/probes/mock-sidebar-measure.mjs
// Writes mock-sidebar.json: { mockTree, viewports, labels, counts, data: { <engine>: { <viewport>: { sidebar, rows: { '<label index>-<count index>': { row, glyph, label, text, cut, count, countText } } } } } }, rectangles [x, y, w, h] in px, 0.01.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';
import { MOCK_OPEN } from '../../../packages/kit/probes/mock-screen.mjs';
import { NAMES_COUNTS, NAMES_LABELS } from './names.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const started = Date.now();

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-sidebar-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49473' }, stdio: 'ignore' });
  url = 'http://127.0.0.1:49473/';
  await sleep(1500);
}

/** Runs in the mock's page: the tree of the resource sidebar is replaced by the mock's own `H.tree` of the cases, and every row is read. */
const READ = `((cases) => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)]; };
  const nodes = [{ id: 'g', label: 'Group', icon: 'LuLayers', children: cases.map(({ id, label, count }) => ({ id, label, icon: 'LuBox', count })) }];
  const old = document.querySelector('.frame__sidebar .tree');
  old.outerHTML = H.tree(nodes, { id: 'names-probe', label: 'Names', open: ['g'], rootDisclosure: 'end' });
  const sidebar = document.querySelector('.frame__sidebar');
  const rows = {};
  for (const { id } of cases) {
    const row = document.querySelector('.tree__row[data-key="' + id + '"]');
    const label = row.querySelector('.tree__label');
    const count = row.querySelector('.tree__count');
    const range = document.createRange();
    range.selectNodeContents(label);
    rows[id] = { row: rect(row), glyph: rect(row.querySelector('.tree__icon')), label: rect(label), text: r2(range.getBoundingClientRect().width), cut: label.scrollWidth > label.clientWidth, count: rect(count), countText: count?.textContent ?? null };
  }
  return { sidebar: rect(sidebar), rows };
})`;

const data = {};
let failed = false;
for (const [engineName, engine] of Object.entries(ENGINES)) {
  const browser = await engine.launch(engineName === 'chromium' ? { args: ['--font-render-hinting=none'] } : {});
  data[engineName] = {};
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    const page = await (await browser.newContext({ viewport })).newPage();
    await page.goto(url, { waitUntil: 'load' });
    await sleep(3000);
    await page.evaluate(MOCK_OPEN);
    await sleep(3500);
    await normalizeFont(page, { rootVar: '--int-font-ui' });
    const cases = NAMES_LABELS.flatMap((label, l) => NAMES_COUNTS.map((count, c) => ({ id: `${String(l)}-${String(c)}`, label, count: count.text })));
    data[engineName][viewportName] = await page.evaluate(`${READ}(${JSON.stringify(cases)})`);
    const missing = Object.entries(data[engineName][viewportName].rows).filter(([, row]) => row.row === null || row.label === null || row.count === null).map(([id]) => id);
    if (missing.length > 0) {
      console.log('MISSING', engineName, viewportName, missing.join(', '));
      failed = true;
    }
    console.log(engineName, viewportName, Object.keys(data[engineName][viewportName].rows).length, 'rows', JSON.stringify(data[engineName][viewportName].sidebar));
    await page.context().close();
  }
  await browser.close();
}

const file = path.join(here, 'mock-sidebar.json');
writeFileSync(file, `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, labels: NAMES_LABELS, counts: NAMES_COUNTS, note: 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. The mock default context, the font normalized (Helvetica, Arial). A count is the text the mock was given.', data })}\n`);
server?.kill();
console.log('wrote', file, statSync(file).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
if (failed) {
  console.log('FAILED: a row of the mock was not read');
  process.exit(1);
}

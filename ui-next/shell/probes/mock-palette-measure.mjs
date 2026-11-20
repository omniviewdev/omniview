// Measures the design mock's command palette: the REFERENCE the shell's palette is built to (slice C1b, palette-probe.mjs).
//
// What it measures, per engine (webkit, chromium), viewport (1440x900, 1280x800, decision A15) and scene (SCENES of palette-targets.mjs: closed, empty, scoped, query, none, noneScoped,
// commands), in a FRESH page per scene, with the mock's default context (no text scale, default density; font normalized as mock-rail-measure.mjs does): the mock's list page of a connection
// is opened (MOCK_OPEN), the scene is driven with the mock's own API (`Shell.search.open({ scope: null })` unscoped, `Shell.search.open()` scoped to the tab on screen; the typing is real key
// presses into the focused `#pq`, 30 ms apart; a `>` typed first selects the Commands kind), the page settles (700 ms after the last key; the mock's providers answer 150 ms after the last
// keystroke), the pointer is put away at (1, 1) (hovering a row moves the mock's active row), and every part (PARTS and SEARCH of palette-targets.mjs) is read as rectangles and as paint
// (STYLES) by `readParts` and `readStyles` of palette-targets.mjs, with side 'mock'. Each scene is checked to have drawn what it says (the frame, the chips, the note, the selected kind,
// the rows, exactly one active row); the script exits non-zero with the scene's name when it did not.
//
// Serve the mock first: a CommonJS copy of its server.js with `root` set to the mock directory (see mock-strip-measure.mjs), e.g.
//   sed 's#const root=__dirname#const root="<mock dir>"#' <mock dir>/server.js > /tmp/server.cjs && PORT=49471 node /tmp/server.cjs
// Without MOCK_URL the script serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) on port 49475.
// Run:  MOCK_URL=http://127.0.0.1:49471/ node ui-next/shell/probes/mock-palette-measure.mjs        (3 to 5 minutes)
// Writes mock-palette.json. With SHOTS=<dir> it writes a screenshot of each scene there instead (mock-<scene>-<engine>-<viewport>.png) and leaves the pinned file alone.
//
// mock-palette.json: { mockTree, viewports, note,
//   data: { <engine>: { <viewport>: { <scene>: { parts: { <part>: [[x, y, w, h]...] } (px, 0.01), styles: { <name or name#index>: { prop: value } } } } } } }
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';
import { MOCK_OPEN } from '../../../packages/kit/probes/mock-screen.mjs';
import { PARTS, SCENES, SEARCH, readParts, readStyles } from './palette-targets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const ALL = [...PARTS, ...SEARCH];
const started = Date.now();
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** How each scene is driven: how the mock's palette is opened (null: not at all), and what is typed after it. */
const DRIVE = {
  closed: { open: null, type: '' },
  empty: { open: '{ scope: null }', type: '' },
  scoped: { open: '', type: '' },
  query: { open: '{ scope: null }', type: 'ods' },
  none: { open: '{ scope: null }', type: 'zzzzqq' },
  noneScoped: { open: '', type: 'zzzzqq' },
  commands: { open: '{ scope: null }', type: '>' },
};

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory.
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-palette-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49475' }, stdio: 'ignore' });
  url = 'http://127.0.0.1:49475/';
  await sleep(1500);
}

/** What the page drew, to check a scene against: counts and flags. */
const FACTS = `(() => {
  const frame = document.querySelector('.dlg.palette');
  const q = (s) => (frame ? frame.querySelectorAll(s).length : 0);
  const kinds = frame ? [...frame.querySelectorAll('.pq-kinds [role="tab"]')] : [];
  return {
    frame: frame !== null,
    chips: q('.pq-chip'),
    note: q('.pq-note'),
    rows: q('.it.dest'),
    active: q('.it.dest.on'),
    selectedKind: kinds.filter((tab) => tab.getAttribute('aria-selected') === 'true').map((tab) => tab.textContent.trim()),
    focusedInput: document.activeElement?.id === 'pq',
  };
})()`;

/** What a scene must have drawn: the list of the problems (empty when it drew what it says). */
function check(scene, facts) {
  const problems = [];
  if (scene === 'closed') {
    if (facts.frame) problems.push('the palette is open');
    return problems;
  }
  if (!facts.frame) problems.push('.dlg.palette does not exist');
  const chips = scene === 'scoped' || scene === 'noneScoped' ? 2 : 0;
  if (facts.chips !== chips) problems.push(`.pq-chip count ${facts.chips}, expected ${chips}`);
  const note = scene === 'none' || scene === 'noneScoped';
  if (note !== (facts.note > 0)) problems.push(`.pq-note ${facts.note > 0 ? 'present' : 'missing'}, expected ${note ? 'present' : 'absent'}`);
  if (scene === 'commands' && facts.selectedKind.join() !== 'Commands') problems.push(`selected kind is [${facts.selectedKind}], expected Commands`);
  if (scene !== 'commands' && facts.selectedKind.join() !== 'All') problems.push(`selected kind is [${facts.selectedKind}], expected All`);
  if (facts.rows < 1) problems.push('no .it.dest row');
  if (facts.active !== 1) problems.push(`${facts.active} active rows (.it.dest.on), expected 1`);
  if (!facts.focusedInput) problems.push('#pq does not have the focus');
  return problems;
}

async function drive(browser, viewport, scene) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(url, { waitUntil: 'load' });
  await sleep(3000);
  await page.evaluate(MOCK_OPEN);
  await sleep(3500);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  const { open, type } = DRIVE[scene];
  if (open !== null) {
    await page.evaluate(`Shell.search.open(${open})`);
    await page.waitForSelector('.dlg.palette #pq', { timeout: 5000 });
    await sleep(500);
    if (type !== '') await page.keyboard.type(type, { delay: 30 });
    await sleep(700);
  }
  await page.mouse.move(1, 1);
  await sleep(250);
  return page;
}

const data = {};
let failed = false;
try {
  for (const [engineName, engine] of Object.entries(ENGINES)) {
    const browser = await engine.launch(engineName === 'chromium' ? { args: ['--font-render-hinting=none'] } : {});
    try {
      data[engineName] = {};
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        data[engineName][viewportName] = {};
        for (const { name: scene } of SCENES) {
          const page = await drive(browser, viewport, scene);
          const parts = await readParts(page, ALL, 'mock');
          const styles = await readStyles(page, ALL, 'mock');
          const facts = await page.evaluate(FACTS);
          const problems = check(scene, facts);
          const needed = scene === 'closed' ? ['search', 'searchGlyph', 'searchHint'] : ['frame', 'foot', 'search'];
          for (const part of needed) if (parts[part].length === 0) problems.push(`part ${part} not found`);
          if (problems.length > 0) {
            console.log('MISSING', engineName, viewportName, scene, problems.join('; '));
            failed = true;
          }
          data[engineName][viewportName][scene] = { parts, styles };
          console.log(engineName, viewportName, scene, `${facts.rows} rows`, `${facts.chips} chips`, problems.length === 0 ? 'ok' : 'FAILED');
          if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `mock-${scene}-${engineName}-${viewportName}.png`) });
          await page.context().close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  // The mock's server is this script's own child: it goes whether the run finished or threw.
  server?.kill();
}

const note = 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. Mock default context, on the list page of a connection. Scenes: closed; empty (open with no scope); scoped (open from the tab); query (`ods`, no scope: it matches the tab on screen and a page of two connections); none and noneScoped (`zzzzqq`, no scope and scoped); commands (`>` typed first, no scope). Read 700 ms after the last key, the pointer at (1, 1). Styles are named `<part>` or `<part>#<index>`.';
const file = path.join(here, 'mock-palette.json');
// A reference that failed its own checks is not written: the committed one stays what it was measured as.
if (!SHOTS && !failed) writeFileSync(file, `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, note, data })}\n`);
console.log(SHOTS || failed ? (SHOTS ? `wrote screenshots to ${SHOTS}` : 'wrote nothing') : `wrote ${file} ${statSync(file).size} bytes`, Math.round((Date.now() - started) / 1000), 's');
if (failed) {
  console.log('FAILED: a scene did not draw what it says, or a part was not found');
  process.exit(1);
}

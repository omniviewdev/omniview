// Measures the design mock's toast layer: the REFERENCE the shell's toasts are built to (slice O1b-1, the notices probe).
//
// What it measures, per engine (webkit, chromium), viewport (1440x900, 1280x800) and scene (SCENES of notices-targets.mjs: info, failure, cap), in a FRESH page per scene, with the mock's default
// context (no text scale, default density; font normalized as mock-rail-measure.mjs does): the mock's Nodes list page of a connection is opened (OPEN below), the toast gate is switched off (`Shell.toasts.configure
// ({ focusGate: false })`: a headless page has no focus and the mock drops a timed toast raised then), the pointer is put away at (1, 1), the scene is raised with the mock's own API (`Shell.notify` for a message,
// `Shell.ops.begin` then `fail` for the failure with its Retry), the page waits 150 ms (the 90 ms enter fade is over), and every part (PARTS of notices-targets.mjs) is read as rectangles and as paint (STYLES) by
// `readParts` and `readStyles` of notices-targets.mjs, with side 'mock'. Each scene is checked to have drawn what it says (the toasts, their words and severity, the one action, the summary first) and to
// stand at the HOME placement (`Shell.toasts.placement.mode === 'default'`, no data-place on the host); the script exits non-zero with the scene's name when it did not. A toast closes itself after 7 s:
// the read is done within about a second of raising it.
//
// Serve the mock first: a CommonJS copy of its server.js with `root` set to the mock directory (see mock-strip-measure.mjs), e.g.
//   sed 's#const root=__dirname#const root="<mock dir>"#' <mock dir>/server.js > /tmp/server.cjs && PORT=49471 node /tmp/server.cjs
// Without MOCK_URL the script serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) on port 49475.
// Run:  MOCK_URL=http://127.0.0.1:49471/ node ui-next/shell/probes/mock-notices-measure.mjs        (3 to 5 minutes; check `uptime` first: a loaded machine moves the timings)
// Writes mock-notices.json. With SHOTS=<dir> it writes a screenshot of each scene there instead (mock-<scene>-<engine>-<viewport>.png) and leaves the pinned file alone.
//
// mock-notices.json: { mockTree, viewports, note,
//   data: { <engine>: { <viewport>: { <scene>: { parts: { <part>: [[x, y, w, h]...] } (px, 0.01), styles: { <name or name#index>: { prop: value } } } } } } }
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';
import { MOCK_OPEN_NODES } from '../../../packages/kit/probes/mock-screen.mjs';
import { PARTS, SCENES, readParts, readStyles } from './notices-targets.mjs';

/**
 * The page the scenes are raised on: the mock's list page of a connection that has no row button under the stack's home box (MOCK_OPEN_NODES of mock-screen.mjs, which names the screen), so that the stack stands at HOME at both
 * viewports and the reading is the toast's and not the mock's placement rule's.
 */
const OPEN = MOCK_OPEN_NODES;

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const started = Date.now();
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** How each scene is raised, with the mock's own API (evaluated in the page). The words are fixed: the shell uses the same strings. */
const DRIVE = {
  info: `Shell.notify({ title: 'Connection added', message: 'prod-east is ready to use.', severity: 'info', source: { plugin: 'p1' } });`,
  failure: `Shell.ops.begin({ title: 'Timed out', initiator: 'system', source: { plugin: 'p1' }, onRetry: () => {} }).fail({ message: 'The cluster did not complete the request in time.' });`,
  cap: `['info', 'success', 'warning', 'error', 'info'].forEach((severity, i) => Shell.notify({ title: 'Notice ' + (i + 1), severity, source: { plugin: 'p' + (i + 1) } }));`,
};

/** What each scene must have drawn: the toast count, the first toast's marker, the words, the severities, the action buttons. */
const EXPECT = {
  info: { toasts: 1, titles: ['Connection added'], messages: ['prod-east is ready to use.'], severities: ['info'], actions: [] },
  failure: { toasts: 1, titles: ['Timed out'], messages: ['The cluster did not complete the request in time.'], severities: ['error'], actions: ['Retry'] },
  // The summary toast carries one action button ("Show", it opens the centre); the two newest toasts have none.
  cap: { toasts: 3, summary: true, titles: null, messages: null, severities: null, actions: ['Show'] },
};

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory.
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-notices-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49475' }, stdio: 'ignore' });
  url = 'http://127.0.0.1:49475/';
  await sleep(1500);
}

/** What the page drew, to check a scene against. */
const FACTS = `(() => {
  const toasts = [...document.querySelectorAll('.notify-host > .notify[data-surface="toast"]')];
  const text = (el, s) => el.querySelector(s)?.textContent.trim() ?? null;
  const host = document.querySelector('.notify-host');
  return {
    toasts: toasts.length,
    keys: toasts.map((t) => t.getAttribute('data-notify')),
    titles: toasts.map((t) => text(t, '.notify__title')),
    messages: toasts.map((t) => text(t, '.notify__message:not(.notify__reason)')),
    severities: toasts.map((t) => t.getAttribute('data-severity')),
    actions: toasts.map((t) => [...t.querySelectorAll('.notify__actions button')].map((b) => b.textContent.trim())),
    primary: toasts.map((t) => [...t.querySelectorAll('.notify__actions button')].map((b) => b.matches('[data-variant="primary"], .primary, .btn--primary') || /primary/.test(b.className))),
    hidden: toasts.filter((t) => t.hidden || t.offsetParent === null && getComputedStyle(t).position !== 'fixed').length,
    mode: Shell.toasts.placement.mode,
    place: host ? host.getAttribute('data-place') : null,
    list: Shell.toasts.list().length,
  };
})()`;

/** What a scene must have drawn: the list of the problems (empty when it drew what it says). */
function check(scene, facts) {
  const want = EXPECT[scene];
  const problems = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (facts.mode !== 'default') problems.push(`placement mode ${facts.mode}, not default`);
  if (facts.place !== null) problems.push(`host data-place ${facts.place}`);
  if (facts.toasts !== want.toasts) problems.push(`${facts.toasts} toasts, not ${want.toasts}`);
  if (want.summary && facts.keys[0] !== '__summary') problems.push(`first toast is ${facts.keys[0]}, not __summary`);
  if (!want.summary && facts.keys.includes('__summary')) problems.push('a summary toast');
  if (want.titles && !same(facts.titles, want.titles)) problems.push(`titles ${JSON.stringify(facts.titles)}`);
  if (want.messages && !same(facts.messages, want.messages)) problems.push(`messages ${JSON.stringify(facts.messages)}`);
  if (want.severities && !same(facts.severities, want.severities)) problems.push(`severities ${JSON.stringify(facts.severities)}`);
  if (scene === 'cap') {
    if (facts.titles[0] !== '3 more notifications') problems.push(`summary title ${JSON.stringify(facts.titles[0])}`);
    if (!same(facts.titles.slice(1), ['Notice 4', 'Notice 5'])) problems.push(`newest toasts ${JSON.stringify(facts.titles.slice(1))}`);
  }
  if (!same(facts.actions.flat(), want.actions)) problems.push(`action buttons ${JSON.stringify(facts.actions)}`);
  if (scene === 'failure' && !facts.primary.flat()[0]) problems.push('Retry is not primary');
  return problems;
}

async function drive(browser, viewport, scene) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(url, { waitUntil: 'load' });
  await sleep(3000);
  await page.evaluate(OPEN);
  await sleep(3500);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  await page.evaluate(`Shell.toasts.configure({ focusGate: false })`);
  await page.mouse.move(1, 1);
  await page.evaluate(DRIVE[scene]);
  await sleep(150);
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
          const parts = await readParts(page, PARTS, 'mock');
          const styles = await readStyles(page, PARTS, 'mock');
          const facts = await page.evaluate(FACTS);
          const problems = check(scene, facts);
          for (const part of ['layer', 'host', 'toast']) if (parts[part].length === 0) problems.push(`part ${part} not found`);
          if (problems.length > 0) {
            console.log('MISSING', engineName, viewportName, scene, problems.join('; '));
            failed = true;
          }
          data[engineName][viewportName][scene] = { parts, styles };
          console.log(engineName, viewportName, scene, `${facts.toasts} toasts`, problems.length === 0 ? 'ok' : 'FAILED');
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

const note = 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. Mock default context, on the list page of a connection, the stack at HOME (placement mode default). Scenes: info (one message toast); failure (a failed operation with its Retry, primary); cap (five messages: the summary toast above the two newest). Read 150 ms after raising (the enter fade is over), the pointer at (1, 1). Styles are named `<part>` or `<part>#<index>`.';
const file = path.join(here, 'mock-notices.json');
// A reference that failed its own checks is not written: the committed one stays what it was measured as.
if (!SHOTS && !failed) writeFileSync(file, `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, note, data })}\n`);
console.log(SHOTS || failed ? (SHOTS ? `wrote screenshots to ${SHOTS}` : 'wrote nothing') : `wrote ${file} ${statSync(file).size} bytes`, Math.round((Date.now() - started) / 1000), 's');
if (failed) process.exit(1);

// Probes the shell's rail against the design mock's, in WebKit and Chromium at 1440 x 900 and 1280 x 800 (decision A15; 1030 x 720 is retired).
// The shell is read on the fixture (fixture.tsx `?case=injected`: the real `Shell` with the registration of the mock's reference screen, whose rail has three entries, the first of them
// current); the mock's reference is mock-rail.json, made by mock-rail-measure.mjs from the mock's own two rails: the first plugin screen's (three tools, 16 px glyphs) and the second's
// (the rail of ch12 section 4: 20 px glyphs, its first tool open).
//
//   node ui-next/shell/probes/rail-probe.mjs        builds the fixture (OMNIVIEW_UI=next) into a temp dir, serves it, probes it
//
//   FIXTURE_DIST=<dir>   probe an existing build      FONT_DELAY_MS=40   as a runner serves fonts      ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800   (defaults: both of each)
//   REPORT=<file>   the full report as JSON      SHOTS=<dir>   a screenshot per engine and viewport
//
// What it checks, per engine and viewport:
//   geometry   the track, every entry's target (37 x 40, from the track's left edge), its face (30 x 30, 5 px in) and its glyph, against the mock within 1 px: the glyph's rectangle against the
//              second screen's (20 px), its centre against both screens' (the same centre at 16 px and at 20 px); the entry that holds the tab stop; the tip that opens at once
//   paint      the face's fill, outline and radius, and the entry's colour, exactly, in the states rest (current entry, other entry), hover, hover over the current entry (it stays pressed), a keyboard
//              focus, the current entry focused (the accent), and the current entry while the sidebar, the region it opens, has the focus
// What it does not compare: where the tip opens. The mock opens a rail tip to the right of the tool; the kit's tooltip host opens below its trigger and `tip` has no side option
// (docs/ui-next/status/S2a.md, "Known differences"). Exit code 1 when anything else differs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';
import { NATIVE_VIEWPORTS, buildFixtures, open, serveFixtures, sleep } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(path.join(here, 'mock-rail.json'), 'utf8'));
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(NATIVE_VIEWPORTS).join(',')).split(',');
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const report = { geometry: {}, states: {}, notes: [] };
const fail = (where, what) => failures.push(`${where}: ${what}`);
const ENTRIES = 3;
const url = (origin) => `${origin}/shell/probes/fixture.html?case=injected`;

// ---------------------------------------------------------------------------------------------------------------------------
// The shell's side of the mock's reading: the same names, from the shell's own markup.
const READ = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  };
  const rail = document.querySelector('[data-shell-part="rail"]');
  const buttons = rail === null ? [] : [...rail.querySelectorAll('button')];
  return {
    track: rect(rail),
    buttons: buttons.map(rect),
    glyphs: buttons.map((button) => rect(button.querySelector('svg'))),
    faces: buttons.map((button) => rect(button.firstElementChild)),
    open: buttons.map((button) => button.getAttribute('aria-current') === 'true'),
    stops: buttons.map((button) => button.tabIndex),
    tip: buttons.map((button) => ({ delay: button.getAttribute('data-ov-tip-delay'), text: button.getAttribute('data-ov-tip') })),
  };
};

const centre = ([x, y, w, h]) => [x + w / 2, y + h / 2];

/** Compares the shell's reading with the mock's two: the largest difference, and a line for each beyond the tolerance. */
function compareGeometry(mock, shell, where, tolerance = 1) {
  let worst = 0;
  const near = (name, a, b, keys = [0, 1, 2, 3]) => {
    if (a === null || a === undefined || b === null || b === undefined) {
      fail(`geometry ${where}`, `${name}: the shell does not draw it`);
      return;
    }
    for (const k of keys) {
      const delta = Math.round(Math.abs(a[k] - b[k]) * 100) / 100;
      worst = Math.max(worst, delta);
      if (delta > tolerance) fail(`geometry ${where}`, `${name}[${'xywh'[k]}]: mock ${a[k]} shell ${b[k]} (off by ${delta})`);
    }
  };
  if (shell.buttons.length !== ENTRIES) fail(`geometry ${where}`, `${shell.buttons.length} entries, the reference screen has ${ENTRIES}`);
  near('track', mock.tools.track, shell.track);
  near('track (second screen)', mock.second.track, shell.track);
  for (let index = 0; index < ENTRIES; index += 1) {
    const name = `entry ${index + 1}`;
    near(`${name} target`, mock.tools.buttons[index], shell.buttons[index]);
    near(`${name} target (second screen)`, mock.second.buttons[index], shell.buttons[index]);
    near(`${name} face`, mock.second.faces[index], shell.faces[index]);
    // The glyph is the second screen's (20 px); both screens' glyphs share one centre.
    near(`${name} glyph`, mock.second.glyphs[index], shell.glyphs[index]);
    near(`${name} glyph centre`, [...centre(mock.tools.glyphs[index]), 0, 0], [...centre(shell.glyphs[index]), 0, 0], [0, 1]);
  }
  const stops = mock.second.stops.slice(0, ENTRIES);
  if (shell.stops.join() !== stops.join()) fail(`geometry ${where}`, `tab stops ${shell.stops.join()}, the mock's rail has ${stops.join()}`);
  if (JSON.stringify(shell.open) !== JSON.stringify(mock.second.open.slice(0, ENTRIES))) fail(`geometry ${where}`, `open marks ${shell.open.join()}, the mock's rail has ${mock.second.open.slice(0, ENTRIES).join()}`);
  shell.tip.forEach((entry, index) => {
    if (entry.delay !== mock.second.tip[index].delay) fail(`geometry ${where}`, `entry ${index + 1} opens its tip after "${entry.delay}", the mock after "${mock.second.tip[index].delay}"`);
  });
  return worst;
}

async function geometry(browser, engine, viewportName, viewport, origin) {
  const where = `${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, url(origin), viewport);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  await sleep(250);
  const shell = await page.evaluate(READ);
  const worst = compareGeometry(reference.data[engine][viewportName], shell, where);
  report.geometry[where] = { worst, entries: shell.buttons.length, track: shell.track, buttons: shell.buttons, glyphs: shell.glyphs, faces: shell.faces, errors };
  for (const error of errors) fail(`errors ${where}`, error);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `rail-${engine}-${viewportName}.png`) });
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The paint of the current entry and of another one in each state, read as the mock's reading is (mock-rail-measure.mjs, PAINT): the face is the entry's first child here, the mock's `::before`.
const PAINT = (el) => {
  const cs = getComputedStyle(el);
  const face = getComputedStyle(el.firstElementChild);
  return {
    matches: { hover: el.matches(':hover'), focus: el.matches(':focus'), focusVisible: el.matches(':focus-visible') },
    color: cs.color,
    face: { backgroundColor: face.backgroundColor, outline: { style: face.outlineStyle, width: face.outlineWidth, color: face.outlineColor, offset: face.outlineOffset }, borderRadius: face.borderTopLeftRadius },
  };
};

const STATES = ['rest', 'hover', 'openHover', 'focus', 'openFocus', 'regionFocus'];

async function states(browser, engine, viewportName, viewport, origin) {
  const { page, context } = await open(browser, url(origin), viewport);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  await sleep(250);
  const buttons = await page.$$('[data-shell-part="rail"] button');
  const [current, other] = [buttons[0], buttons[1]];
  const read = async () => ({
    open: await current.evaluate((el, paint) => new Function(`return (${paint})`)()(el), PAINT.toString()),
    other: await other.evaluate((el, paint) => new Function(`return (${paint})`)()(el), PAINT.toString()),
  });
  const mine = {};
  for (const state of STATES) {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.mouse.move(1, 1);
    if (state === 'hover' || state === 'openHover') {
      const box = await (state === 'hover' ? other : current).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    } else if (state === 'focus' || state === 'openFocus') {
      // A key press first, so the engines treat the focus as the keyboard's (focus-visible).
      await page.keyboard.press('Shift');
      await (state === 'focus' ? other : current).evaluate((el) => el.focus());
    } else if (state === 'regionFocus') {
      await page.evaluate(() => document.querySelector('[data-shell-region="sidebar"] [role="treeitem"][tabindex="0"]')?.focus());
    }
    await sleep(250);
    mine[state] = await read();
  }
  await page.mouse.move(1, 1);
  report.states[`${engine} ${viewportName}`] = mine;

  const mock = reference.states[engine][viewportName];
  for (const state of STATES) {
    for (const part of ['open', 'other']) {
      const got = mine[state][part];
      const wanted = mock[state][part];
      const where = `states ${engine} ${viewportName} ${part === 'open' ? 'the current entry' : 'another entry'} ${state}`;
      // The state is really the state: the engines agree with the mock on what is hovered and what has the keyboard's focus.
      for (const key of ['hover', 'focus', 'focusVisible']) {
        if (got.matches[key] !== wanted.matches[key]) fail(where, `matches :${key} ${got.matches[key]}, the mock's is ${wanted.matches[key]}`);
      }
      if (got.color !== wanted.color) fail(where, `colour ${got.color}, the mock's is ${wanted.color}`);
      if (got.face.backgroundColor !== wanted.face.backgroundColor) fail(where, `face fill ${got.face.backgroundColor}, the mock's is ${wanted.face.backgroundColor}`);
      if (got.face.borderRadius !== wanted.face.borderRadius) fail(where, `face radius ${got.face.borderRadius}, the mock's is ${wanted.face.borderRadius}`);
      // An outline that is not drawn has no width in some engines and 3 px in others: it is the style that says it is not there.
      if (got.face.outline.style !== wanted.face.outline.style) {
        fail(where, `face outline ${got.face.outline.style}, the mock's is ${wanted.face.outline.style}`);
      } else if (wanted.face.outline.style !== 'none') {
        for (const key of ['width', 'color', 'offset']) {
          if (got.face.outline[key] !== wanted.face.outline[key]) fail(where, `face outline ${key} ${got.face.outline[key]}, the mock's is ${wanted.face.outline[key]}`);
        }
      }
    }
  }
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
const production = await serveFixtures(buildFixtures('production'));
for (const engineName of engineNames) {
  const browser = await (engineName === 'chromium' ? ENGINES.chromium.launch({ args: ['--font-render-hinting=none'] }) : ENGINES[engineName].launch());
  for (const viewportName of viewportNames) {
    const viewport = NATIVE_VIEWPORTS[viewportName];
    await geometry(browser, engineName, viewportName, viewport, production.origin);
    await states(browser, engineName, viewportName, viewport, production.origin);
    console.log(engineName, viewportName, 'done');
  }
  await browser.close();
}

production.server.close();
report.notes.push('The mock opens a rail tip to the right of its tool; the kit tooltip host opens below its trigger (no side option on `tip`): not compared.');
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ geometryWorst: Object.fromEntries(Object.entries(report.geometry).map(([key, value]) => [key, value.worst])), notes: report.notes }, null, 1));
if (failures.length > 0) {
  console.error(`\n${failures.length} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}
console.log('\nrail probe: no failures');

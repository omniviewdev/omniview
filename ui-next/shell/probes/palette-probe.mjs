// Probes the shell's command palette against the design mock's, in WebKit and Chromium at 1440 x 900 and 1280 x 800 (decision A15; 1030 x 720 is retired).
// The palette is read on the fixture (palette-fixture.tsx: the real `Shell`, the real palette view and model, the real tab model, over invented sources); the mock's reference is mock-palette.json,
// made by mock-palette-measure.mjs from the mock's own palette in seven scenes (closed, empty, scoped, query, none, noneScoped, commands).
//
//   node ui-next/shell/probes/palette-probe.mjs        builds the fixtures (OMNIVIEW_UI=next) into temp dirs, serves them, probes them
//
//   FIXTURE_DIST=<dir> FIXTURE_DIST_DEV=<dir>   probe existing builds (production, and development for the commit counts)     FONT_DELAY_MS=40   as a runner serves fonts
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800   (defaults: both of each)      AXE=<axe.min.js>      REPORT=<file>   the full report as JSON      SHOTS=<dir>   a screenshot per scene
//   PLATFORM='Linux x86_64'   (geometry only) the pages say so in `navigator.platform`, so the keys are written as that platform writes them: the Command sign and K on a Mac, Ctrl+K elsewhere
//   NEGATIVE_CONTROL=<name>   perturb ONE measured value in the page (frame-width, row-height, foot-height, search-place, foot-gap, paint, hover-steals, no-restore, and for the plugins' providers slow-blocks, quick-late,
//                             focus-moves, extra-commit, plugin-shift, closed-work, stale-shown, for a sidebar's keywords alias-ignored, alias-loose, and for the connection a row says connection-key; see PERTURBATIONS), run the section that must
//                             see it, and exit 0 when it did and 1 when it did not (Chromium at 1440 x 900 unless ENGINES and VIEWPORTS say otherwise)
//   ASSERTION_OFF=<regex>     drops the failures whose line matches, as if the assertion that says them were not there: a control is shown to depend on its assertion by running it with its own pattern
//                             (PERTURBATIONS[<name>].expected) here, and it must then print NOT DETECTED (the rule for a negative control)
//   PARTS=<a,b>               (section plugins) runs only those parts of it (timeline, typing, focus, commits, shift, closed, states, aliases, connection): a developer's shortcut, never a CI step
//
// What it checks, per engine and viewport:
//   geometry   the seven scenes of the mock (the closed field; open with nothing typed; narrowed to the tab's place, with its two chips; a query that matches in two sections; one that matches
//              nothing, with and without the chips; the Commands kind): the Search control, its glyph and its key hint; the frame, the glyph, the input, the kinds and each kind, the list, the note, the
//              status band and the footer; the first group's heading and rows (the glyph, the name, the context and the trailing columns), and the keys of the footer, against the mock within 1 px.
//              Words differ (the mock's plugins are not the fixture's), so what is compared is what the words do not decide: the boxes, the columns every row of a group shares, and where each text starts
//              What each comparison is of is counted in the report (`geometryClasses`, in the log): `full` boxes (x, y, width and height), `content` boxes (an axis follows the scene's words or rows) and `keys` boxes
//              (an axis follows the TEXT OF A KEY: the Search control, its glyph and its hint, and the footer's keys). A key is written for the platform (the Command sign and K on a Mac, Ctrl+K on Linux and Windows)
//              and the mock was measured on a Mac, so the widths of those boxes are not compared on any platform: their heights, edges and gaps are. `keyWidths` keeps both widths (a Linux page here gives the
//              runner's widths exactly) and `keyFonts` (Chromium) the fonts that draw the keys, as the evidence of why
//   paint      the fill, edge, colour, radius and weight of the frame, the input, the kinds, the heading, the active row and another, the context, the glyph, the band, the footer, its keys and the Search
//              control, exactly
//   keyboard   with real key presses: the chord opens it and the focus is in the input; Down, Up, PageDown, PageUp, Home, End; Enter opens and Command or Control Enter opens in the background; Escape
//              closes and the focus goes back to the control that had it (and to the page when that control is gone); a press outside closes; Tab never leaves the dialog; the page behind it is inert
//              (the engine's own modal), and a click on it does nothing; hover moves the active row only when the pointer really moved (a list that scrolls under a still pointer does not take the keyboard's row)
//   states     the empty state, the no-result state, the per-provider error line with its Retry, the folded `+N` and the Sources list, the sentence in the live region
//   a11y       axe-core on the open palette in each of those
//   perf       (palette-perf.mjs) open to first paint, keystroke to rows painted with 1,000 host rows registered, one commit per keystroke at most, no layout shift outside the palette, and a closed
//              palette that holds one listener and no timer
//   plugins    (palette-plugins.mjs, over palette-plugins-fixture.tsx: the host's own wiring of the fixture plugin's providers) what a plugin's providers do to the palette: the order things happen in with a slow provider
//              present (typing never waits, the fast providers' rows paint first, the 5,000-row answer comes to 20), a key pressed while the slow provider works, the row the user moved to when a late section arrives, one
//              commit per key and per answer, no layout shift outside the palette, a closed palette that does no provider work, and the states with axe: a provider that rejects, answers what is not a list, never
//              answers, is deaf to its signal or has a row that is not valid, and a plugin that leaves while the palette is open; and (C1e) a page found by the keyword its sidebar entry carries: first in the list, ahead of a loose
//              match in a title, nothing of the keyword drawn, and a plain Enter opens it
// Exit code 1 when anything differs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';
import { AXE, NATIVE_VIEWPORTS, buildFixtures, open, serveFixtures, sleep } from './harness.mjs';
import { PARTS, SEARCH, STYLES, readParts, readStyles } from './palette-targets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(path.join(here, 'mock-palette.json'), 'utf8'));
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(NATIVE_VIEWPORTS).join(',')).split(',');
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const report = { geometry: {}, geometryClasses: {}, keyWidths: {}, keyFonts: {}, paint: {}, keyboard: {}, states: {}, a11y: {}, perf: {}, plugins: {}, notes: [] };
const OFF = process.env.ASSERTION_OFF === undefined ? undefined : new RegExp(process.env.ASSERTION_OFF);
const fail = (where, what) => {
  const line = `${where}: ${what}`;
  if (OFF === undefined || !OFF.test(line)) failures.push(line);
};

const ALL = [...PARTS, ...SEARCH];
const fixtureUrl = (origin, query = '') => `${origin}/shell/probes/palette-fixture.html${query === '' ? '' : `?${query}`}`;

// ---------------------------------------------------------------------------------------------------------------------------
// The scenes, driven the way a user drives them: the chord, then keys. The mock's reference was made in a fresh page for each, and so is this.
const isMac = (page) => page.evaluate(() => /mac/i.test(navigator.platform));
const chordOf = async (page) => ((await isMac(page)) ? 'Meta+k' : 'Control+k');

async function openPalette(page) {
  await page.keyboard.press(await chordOf(page));
  await page.waitForSelector('dialog[open]');
  await sleep(120);
}

const SCENES = {
  closed: async () => undefined,
  empty: async (page) => openPalette(page),
  scoped: async (page) => {
    await page.evaluate(() => {
      window.__scoped = true;
    });
    await openPalette(page);
  },
  query: async (page) => {
    await openPalette(page);
    await page.keyboard.type('wid', { delay: 30 });
  },
  none: async (page) => {
    await openPalette(page);
    await page.keyboard.type('zzzzqq', { delay: 30 });
  },
  noneScoped: async (page) => {
    await page.evaluate(() => {
      window.__scoped = true;
    });
    await openPalette(page);
    await page.keyboard.type('zzzzqq', { delay: 30 });
  },
  commands: async (page) => {
    await openPalette(page);
    await page.keyboard.type('>', { delay: 30 });
  },
};

/** Opens a fresh page on the fixture, normalises the font as the mock's reference was, drives one scene and puts the pointer away (a hover moves the active row). */
async function scenePage(browser, origin, viewport, scene, query = '') {
  const opened = await open(browser, fixtureUrl(origin, query), viewport);
  await normalizeFont(opened.page, { rootVar: '--ov-font-ui' });
  await sleep(200);
  await SCENES[scene](opened.page);
  await opened.page.mouse.move(1, 1);
  await sleep(700);
  return opened;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Comparing a scene with the mock's reading. A rectangle is [x, y, w, h].
const round = (value) => Math.round(value * 100) / 100;

function compareScene(where, scene, mock, shell) {
  const problems = [];
  // What each comparison is OF, so that nothing is loosened without being counted. `full`: every one of the box's x, y, width and height. `content`: a box some axis of which follows the words or the rows of the
  // scene, which the mock's are not the fixture's (the chips and the input beside them, the first group, the context column). `keys`: a box some axis of which follows the TEXT OF A KEY, which is written for the
  // platform (the Command sign and K on a Mac, Ctrl+K on Linux and Windows) and cannot be the mock's on a runner: the Search control and its hint, the footer's keys, and in the commands scene the columns the widest
  // chord decides. The names go to the report, and so do the two widths that `keys` leaves out (`widths`), as the evidence of why.
  const classes = { full: [], content: [], keys: [] };
  const widths = {};
  let worst = 0;
  const near = (name, a, b, keys = [0, 1, 2, 3], tolerance = 1, kind = keys.length === 4 ? 'full' : 'content') => {
    if (a === undefined || a === null) return;
    classes[kind].push(name);
    if (b === undefined || b === null) {
      problems.push(`${name}: the shell does not draw it (the mock's is ${JSON.stringify(a)})`);
      return;
    }
    for (const key of keys) {
      const delta = round(Math.abs(a[key] - b[key]));
      worst = Math.max(worst, delta);
      if (delta > tolerance) problems.push(`${name}[${'xywh'[key]}]: mock ${a[key]} shell ${b[key]} (off by ${delta})`);
    }
  };
  const first = (side, name, index = 0) => side[name]?.[index] ?? null;

  // The Search control is there in every scene. Its width, its hint's and the footer keys' follow the text of a key, which is written for the platform: the mock was measured on a Mac (the Command sign and K),
  // a Linux runner writes Ctrl+K, and the first runner run was off by up to 157 px at the fifth key with every other box at 0 px. So for these the probe compares what the text does not decide: the heights,
  // where each part ends or starts, and the gaps between the parts.
  const rightEdge = (rect) => (rect === null ? null : [round(rect[0] + rect[2]), rect[1], 0, rect[3]]);
  const inside = (outer, part) => (outer === null || part === null ? null : [round(part[0] - outer[0]), round(part[1] - outer[1]), part[2], part[3]]);
  const gapAfter = (a, b) => (a === null || b === null ? null : [round(b[0] - (a[0] + a[2])), 0, 0, 0]);
  const keyWidth = (name, a, b) => {
    if (a !== null && b !== null) widths[name] = [a[2], b[2]];
  };
  const [mockSearch, shellSearch] = [first(mock, 'search'), first(shell, 'search')];
  const [mockGlyph, shellGlyph] = [first(mock, 'searchGlyph'), first(shell, 'searchGlyph')];
  const [mockHint, shellHint] = [first(mock, 'searchHint'), first(shell, 'searchHint')];
  near('search right edge', rightEdge(mockSearch), rightEdge(shellSearch), [0, 1, 3], 1, 'keys');
  near('search glyph from the control\'s left edge', inside(mockSearch, mockGlyph), inside(shellSearch, shellGlyph), [0, 1, 2, 3], 1, 'keys');
  near('search hint right edge', rightEdge(mockHint), rightEdge(shellHint), [0, 1, 3], 1, 'keys');
  near('search hint gap after the glyph', gapAfter(mockGlyph, mockHint), gapAfter(shellGlyph, shellHint), [0], 1, 'keys');
  keyWidth('search control', mockSearch, shellSearch);
  keyWidth('search hint', mockHint, shellHint);
  if (scene === 'closed') {
    if (shell.frame.length > 0) problems.push('the palette is drawn while it is closed');
    return { problems, worst, classes, widths };
  }

  // The regions that do not depend on the results: their boxes are fixed by the frame (S72: nothing moves when a source answers late).
  for (const name of ['frame', 'glyph', 'glyphSvg', 'kinds', 'results', 'band', 'foot']) near(name, first(mock, name), first(shell, name));
  const kinds = mock.kind.length;
  if (shell.kind.length !== kinds) problems.push(`${shell.kind.length} kinds, the mock's has ${kinds}`);
  for (let index = 0; index < kinds; index += 1) near(`kind ${index + 1}`, mock.kind[index], shell.kind[index]);

  // The chips and the input beside them: the widths follow the words, so the boxes are compared by what they leave to the input.
  const mockChips = first(mock, 'chips');
  const drawn = mockChips !== null && mockChips[2] > 0;
  if (drawn !== shell.chips.length > 0) {
    problems.push(`${shell.chips.length > 0 ? 'chips are drawn' : 'no chips are drawn'}, the mock's scene has ${drawn ? 'them' : 'none'}`);
  }

  const input = first(shell, 'input');
  if (drawn && shell.chips.length > 0) {
    near('chips', mockChips, first(shell, 'chips'), [0, 1, 3]);
    if (shell.chip.length !== mock.chip.length) problems.push(`${shell.chip.length} chips, the mock's has ${mock.chip.length}`);
    for (let index = 0; index < Math.min(mock.chip.length, shell.chip.length); index += 1) {
      near(`chip ${index + 1}`, mock.chip[index], shell.chip[index], [1, 3]);
      if (index === 0) near('chip 1', mock.chip[0], shell.chip[0], [0]);
      else {
        const gapMock = round(mock.chip[index][0] - (mock.chip[index - 1][0] + mock.chip[index - 1][2]));
        const gapShell = round(shell.chip[index][0] - (shell.chip[index - 1][0] + shell.chip[index - 1][2]));
        if (Math.abs(gapMock - gapShell) > 1) problems.push(`chip ${index + 1}: ${gapShell} px after the one before, the mock's is ${gapMock}`);
      }
    }
    // What the chips leave to the input: it starts where they end, and runs to the end of the row.
    const leaves = (side) => round(first(side, 'input')[0] - (first(side, 'chips')[0] + first(side, 'chips')[2]));
    if (input !== null && Math.abs(leaves(mock) - leaves(shell)) > 1) problems.push(`the input starts ${leaves(shell)} px after the chips, the mock's ${leaves(mock)}`);
    near('input', first(mock, 'input'), input, [1, 3]);
    const end = (side) => round(first(side, 'input')[0] + first(side, 'input')[2]);
    if (input !== null && Math.abs(end(mock) - end(shell)) > 1) problems.push(`the input ends at ${end(shell)}, the mock's at ${end(mock)}`);
  } else {
    near('input', first(mock, 'input'), input);
  }

  // The note, when there is one: the same box.
  if (mock.note.length > 0) near('note', first(mock, 'note'), first(shell, 'note'));
  else if (shell.note.length > 0) problems.push('the shell draws a note the mock does not');

  // The first group: its heading, and its first row with the columns the rows of a group share.
  near('group 1', first(mock, 'group'), first(shell, 'group'), [0, 1, 2]);
  near('heading 1', first(mock, 'label'), first(shell, 'label'));
  near('row 1', first(mock, 'row'), first(shell, 'row'));
  near('row 1 glyph', first(mock, 'rowIcon'), first(shell, 'rowIcon'));
  // The name's width and the context column's x follow the widest chord of the trailing column: the fixture's is plain ASCII of the mock's width (palette-fixture.tsx), so both are compared in full in every scene.
  near('row 1 name', first(mock, 'rowText'), first(shell, 'rowText'));
  // The context and the trailing column are on some rows only. The context column starts where the group's columns put it. The trailing cells end at one edge, the column's, whatever they hold (a
  // chevron, a chord, a word); where one starts depends on the first row that has one.
  if (mock.rowBody.length > 0) near('context column', first(mock, 'rowBody'), first(shell, 'rowBody'), [0, 2, 3]);
  else if (shell.rowBody.length > 0) problems.push('the shell draws a context column the mock does not');
  const edge = (rect) => (rect === null ? null : [round(rect[0] + rect[2]), rect[3]]);
  if (mock.rowMeta.length > 0) near('trailing column right edge', edge(first(mock, 'rowMeta')), edge(first(shell, 'rowMeta')), [0, 1]);
  else if (shell.rowMeta.length > 0) problems.push('the shell draws a trailing column the mock does not');

  // The keys of the footer: the same pairs, in the same places. A key's width is the width of its text (above): its height, where the first starts and the gap from one to the next are compared.
  if (shell.hint.length !== mock.hint.length) problems.push(`${shell.hint.length} keys in the footer, the mock's has ${mock.hint.length}`);
  for (let index = 0; index < Math.min(shell.hint.length, mock.hint.length); index += 1) {
    near(`footer key ${index + 1}`, mock.hint[index], shell.hint[index], [1, 3], 1, 'keys');
    keyWidth(`footer key ${index + 1}`, mock.hint[index], shell.hint[index]);
    if (index === 0) near('footer key 1', mock.hint[0], shell.hint[0], [0], 1, 'keys');
    else near(`footer key ${index + 1} gap`, gapAfter(mock.hint[index - 1], mock.hint[index]), gapAfter(shell.hint[index - 1], shell.hint[index]), [0], 1, 'keys');
  }

  return { problems, worst, classes, widths };
}

/** The paint of one scene: every entry of STYLES that both sides have, compared exactly. Entries the scene has no part for are left out on both sides. */
function compareStyles(mock, shell) {
  const problems = [];
  for (const [name, wanted] of Object.entries(mock)) {
    const got = shell[name];
    if (got === undefined) {
      problems.push(`${name}: the shell does not draw it`);
      continue;
    }
    for (const [prop, value] of Object.entries(wanted)) {
      if (got[prop] !== value) problems.push(`${name} ${prop}: mock ${value} shell ${got[prop]}`);
    }
  }
  return problems;
}

/** The nodes whose text is a key: the Search control's hint, a key of the footer, and a chord in the trailing cell of a row. The commands scene has all three. */
const KEY_NODES = { 'search hint': '[data-shell-part="search"] kbd', 'footer key': '[data-palette-part="hint"] kbd', 'chord in a row': '[data-palette-part="meta"] kbd' };

/** The fonts the engine really drew those nodes' text with, from the DevTools protocol (Chromium only: WebKit does not say): the kit's own faces are `bundled`, any other is `system`. */
async function platformFontsOf(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: 0 });
    const found = {};
    for (const [name, selector] of Object.entries(KEY_NODES)) {
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (nodeId === 0) {
        found[name] = null;
        continue;
      }

      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      found[name] = fonts.map((font) => `${font.familyName} (${font.isCustomFont ? 'bundled' : 'system'}) for ${String(font.glyphCount)} glyphs`);
    }

    return found;
  } finally {
    await session.detach();
  }
}

async function geometry(browser, engine, viewportName, viewport, origin, only) {
  const rows = reference.data[engine][viewportName];
  for (const scene of only ?? Object.keys(SCENES)) {
    const where = `${engine} ${viewportName} ${scene}`;
    const { page, context, errors } = await scenePage(browser, origin, viewport, scene);
    const shellParts = await readParts(page, ALL, 'shell');
    const shellStyles = await readStyles(page, ALL, 'shell');
    const result = compareScene(where, scene, rows[scene].parts, shellParts);
    for (const problem of result.problems) fail(`geometry ${where}`, problem);
    const paint = compareStyles(rows[scene].styles, shellStyles);
    for (const problem of paint) fail(`paint ${where}`, problem);
    report.geometry[where] = { worst: result.worst, problems: result.problems.length };
    report.geometryClasses[where] = Object.fromEntries(Object.entries(result.classes).map(([kind, names]) => [kind, names.length]));
    if (scene === 'closed' || scene === 'empty' || scene === 'commands') report.keyWidths[where] = result.widths;
    report.paint[where] = { problems: paint.length };
    if (engine === 'chromium' && scene === 'commands') {
      // Which fonts draw the keys: in this page, whose font the probe set to Helvetica and Arial as the mock's reference was measured, and in a page with the product's own font stack, which is what a person sees
      // (the kit bundles the Command, Option, Shift, Control and Return signs in 'Int UI Inter', so nothing falls back to the machine's fonts).
      report.keyFonts[`${where}, the probe's font (Helvetica, Arial)`] = await platformFontsOf(page);
      const own = await open(browser, fixtureUrl(origin), viewport);
      await own.page.evaluate(() => document.fonts.ready.then(() => undefined));
      await sleep(300);
      await SCENES.commands(own.page);
      await sleep(500);
      report.keyFonts[`${where}, the product's own font stack`] = await platformFontsOf(own.page);
      await own.context.close();
    }
    for (const error of errors) fail(`errors ${where}`, error);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `palette-${scene}-${engine}-${viewportName}.png`) });
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// What a person does with it, with real key presses and a real pointer.
const input = (page) => page.locator('dialog[open] [role=combobox]');
const dialogOpen = (page) => page.evaluate(() => document.querySelector('dialog[open]') !== null);
const activeTitle = (page) =>
  page.evaluate(() => {
    const active = document.querySelector('dialog [role=option][aria-selected="true"]');
    return active?.getAttribute('aria-label') ?? null;
  });
const activeId = (page) => page.evaluate(() => document.querySelector('dialog [role=option][aria-selected="true"]')?.id ?? null);
const focusDescription = (page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    return { tag: active?.tagName ?? null, role: active?.getAttribute('role') ?? null, label: active?.getAttribute('aria-label') ?? null, part: active?.getAttribute('data-shell-part') ?? null, inDialog: active?.closest('dialog') !== null && active?.closest('dialog') !== undefined };
  });

async function keyboard(browser, engine, viewportName, viewport, origin, control) {
  const where = `${engine} ${viewportName}`;
  const notes = {};
  const { page, context, errors } = await open(browser, fixtureUrl(origin), viewport);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  await sleep(200);
  const mac = await isMac(page);
  const mod = mac ? 'Meta' : 'Control';
  // WebKit on macOS skips buttons with Tab (Alt+Tab reaches them: the window's own setting, which the native app turns on, N22); everywhere else Tab reaches every control.
  const TAB = engine === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  // The page's own control: the pages of the other tabs are kept, hidden, with the same words, so only the one that is drawn.
  const pageControl = page.locator('main button:visible', { hasText: 'A control in the page' });

  // Opens from the page's own control with the chord: the focus is in the input, the dialog is the engine's modal, and Escape gives the focus back where it was.
  await pageControl.focus();
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector('dialog[open]');
  await sleep(150);
  const first = await focusDescription(page);
  if (first.role !== 'combobox') fail(`keyboard ${where}`, `the focus is not in the input when it opens: ${JSON.stringify(first)}`);
  const modal = await page.evaluate(() => document.querySelector('dialog[open]')?.matches(':modal') ?? false);
  if (!modal) fail(`keyboard ${where}`, 'the dialog is not the engine\'s modal (:modal)');
  await page.keyboard.press('Escape');
  await sleep(200);
  if (control === 'no-restore') {
    // The perturbation: the focus is taken from where it went, as a palette that did not give it back would leave it.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  }

  const back = await page.evaluate(() => ({ open: document.querySelector('dialog[open]') !== null, tag: document.activeElement?.tagName ?? null, text: document.activeElement?.textContent ?? '' }));
  if (back.open || back.text !== 'A control in the page') fail(`keyboard ${where}`, `Escape did not give the focus back to the control that had it: ${JSON.stringify(back)}`);

  // Opens from the Search control with a click: Escape gives the focus back to it, whatever the engine does with a press on a button.
  await page.locator('[data-shell-part="search"]').click();
  await page.waitForSelector('dialog[open]');
  await page.keyboard.press('Escape');
  await sleep(200);
  const search = await focusDescription(page);
  if (search.part !== 'search') fail(`keyboard ${where}`, `after Escape the focus is ${JSON.stringify(search)}, not on the Search control that opened it`);

  // The chord from nowhere, and its toggle.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector('dialog[open]');
  await page.keyboard.press(`${mod}+k`);
  await sleep(150);
  if (await dialogOpen(page)) fail(`keyboard ${where}`, 'the chord did not close it (a toggle)');
  const afterToggle = await focusDescription(page);
  if (afterToggle.tag === 'BODY') fail(`keyboard ${where}`, 'the toggle left the focus on the body');

  // The arrows, the page keys, Home and End: the active row moves, the focus stays in the input.
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector('dialog[open]');
  await page.keyboard.type('>', { delay: 30 });
  await sleep(150);
  const rowsCount = await page.evaluate(() => document.querySelectorAll('dialog [role=option]').length);
  const at = () => page.evaluate(() => [...document.querySelectorAll('dialog [role=option]')].findIndex((row) => row.getAttribute('aria-selected') === 'true'));
  const steps = [];
  // The input is a combobox: after every movement it names the row that is selected (`aria-activedescendant`), which is what a screen reader reads.
  const names = () =>
    page.evaluate(() => {
      const selected = [...document.querySelectorAll('dialog [role=option]')].find((row) => row.getAttribute('aria-selected') === 'true');
      return selected !== undefined && selected.id !== '' && document.querySelector('dialog input')?.getAttribute('aria-activedescendant') === selected.id;
    });
  const step = async (key, label) => {
    await page.keyboard.press(key);
    await sleep(60);
    steps.push([label, await at()]);
    if (!(await names())) fail(`keyboard ${where}`, `after ${label} the input's aria-activedescendant does not name the selected row`);
  };
  await step('ArrowDown', 'down');
  await step('ArrowDown', 'down');
  await step('ArrowUp', 'up');
  await step('PageDown', 'page down');
  await step('PageUp', 'page up');
  await step('End', 'end');
  await step('Home', 'home');
  await step('ArrowUp', 'up from the first (wraps)');
  const want = [1, 2, 1, 9, 1, rowsCount - 1, 0, rowsCount - 1];
  steps.forEach(([label, index], position) => {
    if (index !== want[position]) fail(`keyboard ${where}`, `${label}: the active row is ${index}, wanted ${want[position]}`);
  });
  notes.steps = steps;
  const focusAfter = await focusDescription(page);
  if (focusAfter.role !== 'combobox') fail(`keyboard ${where}`, `the focus left the input: ${JSON.stringify(focusAfter)}`);
  // The active row is in view whenever the keyboard moved it.
  const inView = await page.evaluate(() => {
    const list = document.querySelector('dialog [data-palette-part="results"]');
    const row = document.querySelector('dialog [role=option][aria-selected="true"]');
    if (list === null || row === null) return false;
    const a = list.getBoundingClientRect();
    const b = row.getBoundingClientRect();
    return b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
  });
  if (!inView) fail(`keyboard ${where}`, 'the active row is not in view after the keyboard moved it');

  // Tab is not taken: it moves between the controls of the dialog and never to the page behind it.
  await page.keyboard.press('Home');
  const tabs = [];
  for (let press = 0; press < 8; press += 1) {
    await page.keyboard.press(TAB);
    const described = await focusDescription(page);
    tabs.push(described.role ?? described.tag);
    if (!described.inDialog && described.tag !== 'BODY') fail(`keyboard ${where}`, `Tab reached the page behind the palette: ${JSON.stringify(described)}`);
  }
  notes.tab = tabs;
  if (!tabs.includes('combobox') || !tabs.includes('tab')) fail(`keyboard ${where}`, `Tab did not move between the input and the kinds: ${tabs.join(', ')}`);
  await page.keyboard.press('Escape');

  // The page behind is inert: a click outside closes, and does not reach the control behind it.
  await page.evaluate(() => {
    window.__clicks = 0;
    for (const button of document.querySelectorAll('[data-shell-part="window"] main button')) {
      button.addEventListener('click', () => {
        window.__clicks += 1;
      });
    }
  });
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector('dialog[open]');
  const target = await pageControl.boundingBox();
  const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName ?? null, [target.x + target.width / 2, target.y + target.height / 2]);
  if (under !== 'DIALOG') fail(`keyboard ${where}`, `a point over the page behind the palette hits ${under}, not the dialog: the page is not inert`);
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
  await sleep(150);
  const clicks = await page.evaluate(() => window.__clicks);
  if (await dialogOpen(page)) fail(`keyboard ${where}`, 'a press outside the palette did not close it');
  if (clicks !== 0) fail(`keyboard ${where}`, `a press outside the palette reached the page behind it (${clicks} clicks)`);

  // Hover: the pointer moves the active row only when it really moved; a list that scrolls under a still pointer does not take the keyboard's row.
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector('dialog[open]');
  await page.keyboard.type('>', { delay: 30 });
  await sleep(150);
  const rowBox = async (index) => page.evaluate((i) => {
    const row = document.querySelectorAll('dialog [role=option]')[i];
    const b = row.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, index);
  const third = await rowBox(3);
  await page.mouse.move(third.x - 20, third.y, { steps: 2 });
  await page.mouse.move(third.x, third.y, { steps: 3 });
  await sleep(100);
  const hovered = await at();
  if (hovered !== 3) fail(`keyboard ${where}`, `a pointer that moved onto the fourth row left the active row at ${hovered}`);
  await page.keyboard.press('ArrowDown');
  await sleep(60);
  const moved = await at();
  if (moved !== 4) fail(`keyboard ${where}`, `Down after a hover went to row ${moved}, wanted the row after the hovered one (4)`);
  // The list scrolls under the pointer, which does not move: the keyboard keeps its row.
  await page.mouse.wheel(0, 120);
  await sleep(300);
  const scrolled = await at();
  if (scrolled !== 4 && control !== 'hover-steals') fail(`keyboard ${where}`, `the list scrolled under a still pointer and the active row went from 4 to ${scrolled}`);
  if (control === 'hover-steals') {
    // The perturbation: a pointer move at the same place, as an engine's synthetic one after a scroll, taken for a move.
    await page.evaluate(() => {
      const row = document.querySelectorAll('dialog [role=option]')[0];
      row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1, clientY: 1, pointerType: 'mouse' }));
      row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 2, clientY: 2, pointerType: 'mouse' }));
    });
    const stolen = await at();
    if (stolen !== 4) fail(`keyboard ${where}`, `the list scrolled under a still pointer and the active row went from 4 to ${stolen}`);
  }
  await page.mouse.move(1, 1);

  // Enter opens, and Command or Control Enter opens in the background (S64).
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector('dialog[open]');
  await page.keyboard.press('#');
  await sleep(120);
  const before = await page.evaluate(() => ({ order: window.__tabs.getSnapshot().order.length, active: window.__tabs.getSnapshot().active }));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(`${mod}+Enter`);
  await sleep(150);
  const background = await page.evaluate(() => ({ order: window.__tabs.getSnapshot().order.length, active: window.__tabs.getSnapshot().active }));
  if (background.order !== before.order + 1) fail(`keyboard ${where}`, `${mod}+Enter opened ${background.order - before.order} tabs, wanted 1`);
  if (background.active !== before.active) fail(`keyboard ${where}`, `${mod}+Enter in the background changed the tab on screen`);
  if (await dialogOpen(page)) fail(`keyboard ${where}`, `${mod}+Enter left the palette open`);
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector('dialog[open]');
  await page.keyboard.press('#');
  await sleep(120);
  await page.keyboard.press('ArrowDown');
  const place = () =>
    page.evaluate(() => {
      const state = window.__tabs.getSnapshot();
      return JSON.stringify([state.order.length, state.active, state.active === null ? null : state.tabs[state.active]?.location.route]);
    });
  const beforeEnter = await place();
  await page.keyboard.press('Enter');
  await sleep(150);
  const entered = await page.evaluate(() => window.__tabs.getSnapshot().order.length);
  if (await dialogOpen(page)) fail(`keyboard ${where}`, 'Enter left the palette open');
  if ((await place()) === beforeEnter) fail(`keyboard ${where}`, 'Enter on the selected destination opened nothing: the tab on screen and the strip are as they were');
  notes.enter = { before: before.order, background: background.order, entered };

  report.keyboard[where] = notes;
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The states a user can be in, and what each says to a screen reader.
/** axe over the document, or over the part of it a selector names (the closed window has findings of the page that are the shell's, not the palette's: its top row is what this step adds to it). */
async function axeOf(page, axe, within = null) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: axe });
  return page.evaluate(async (selector) => {
    const result = await window.axe.run(selector === null ? document : document.querySelector(selector), { resultTypes: ['violations'] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, first: v.nodes[0]?.html.slice(0, 140) }));
  }, within);
}

async function states(browser, engine, viewportName, viewport, origin, axe) {
  const where = `${engine} ${viewportName}`;
  const found = {};
  const check = async (label, page, within = null) => {
    const violations = await axeOf(page, axe, within);
    found[label] = violations;
    for (const violation of violations) fail(`a11y ${where} ${label}`, `${violation.id} (${violation.impact}, ${violation.nodes}): ${violation.first}`);
  };

  // The scenes: each is checked by axe. The closed window is checked in its top row, where the Search control is.
  for (const scene of ['closed', 'empty', 'scoped', 'query', 'none', 'noneScoped', 'commands']) {
    const { page, context, errors } = await scenePage(browser, origin, viewport, scene);
    await check(scene, page, scene === 'closed' ? '[data-shell-region="topRow"]' : null);
    for (const error of errors) fail(`errors ${where} ${scene}`, error);
    await context.close();
  }

  // The error line: a provider that fails is said in the band with a Retry, the others answer, and the sentence is told.
  {
    const { page, context } = await open(browser, fixtureUrl(origin, 'case=runs'), viewport);
    await normalizeFont(page, { rootVar: '--ov-font-ui' });
    await sleep(200);
    await openPalette(page);
    await page.keyboard.type('wid', { delay: 30 });
    await sleep(700);
    const band = await page.evaluate(() => {
      const element = document.querySelector('dialog [data-palette-part="band"]');
      return { text: element?.textContent ?? '', buttons: [...(element?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label') ?? button.textContent) };
    });
    if (!band.text.includes('Pages: Unavailable')) fail(`states ${where}`, `the band does not say which source failed: ${JSON.stringify(band)}`);
    if (!band.buttons.some((label) => label.startsWith('Retry '))) fail(`states ${where}`, `the band has no Retry: ${JSON.stringify(band)}`);
    if (!band.buttons.includes('+2 more, show all 5 sources')) fail(`states ${where}`, `five failed sources do not fold into +N: ${JSON.stringify(band)}`);
    const bandRect = await page.evaluate(() => document.querySelector('dialog [data-palette-part="band"]').getBoundingClientRect().toJSON());
    const resultsRect = await page.evaluate(() => document.querySelector('dialog [data-palette-part="results"]').getBoundingClientRect().toJSON());
    if (bandRect.height !== 24 || resultsRect.height !== 341) fail(`states ${where}`, `a run changed the frame: the band is ${bandRect.height} high and the list ${resultsRect.height}`);
    await check('runs', page);
    await page.locator('dialog [data-palette-part="band"] button', { hasText: '+2' }).click();
    await sleep(200);
    const sources = await page.evaluate(() => ({ list: document.querySelector('dialog [role=listbox]')?.getAttribute('aria-label'), rows: document.querySelectorAll('dialog [role=option]').length, focus: document.activeElement?.getAttribute('role') }));
    if (sources.list !== 'Sources' || sources.rows !== 5) fail(`states ${where}`, `the +N link did not show the five sources: ${JSON.stringify(sources)}`);
    if (sources.focus !== 'combobox') fail(`states ${where}`, `the focus is not in the input after the +N link left: ${JSON.stringify(sources)}`);
    await check('sources', page);
    await page.keyboard.press('Escape');
    await sleep(120);
    const results = await page.evaluate(() => ({ open: document.querySelector('dialog[open]') !== null, list: document.querySelector('dialog [role=listbox]')?.getAttribute('aria-label') }));
    if (!results.open || results.list !== 'Results') fail(`states ${where}`, `Escape in the Sources list did not come back to the results: ${JSON.stringify(results)}`);
    await context.close();
  }

  // The sentence in the live region: told once the results have been still.
  {
    const { page, context } = await open(browser, fixtureUrl(origin), viewport);
    await normalizeFont(page, { rootVar: '--ov-font-ui' });
    await sleep(200);
    await openPalette(page);
    await page.keyboard.type('wid', { delay: 30 });
    const early = await page.evaluate(() => document.querySelector('dialog [role=status]')?.textContent ?? null);
    await sleep(800);
    const told = await page.evaluate(() => ({ text: document.querySelector('dialog [role=status]')?.textContent ?? null, live: document.querySelector('dialog [role=status]')?.getAttribute('aria-live'), announced: window.__announced.slice() }));
    if (early !== '') fail(`states ${where}`, `the live region said "${early}" before the results had been still`);
    if (told.live !== 'polite' || told.text === '' || told.announced.length !== 1) fail(`states ${where}`, `the sentence was not told once, politely: ${JSON.stringify(told)}`);
    found.sentence = told;
    await context.close();
  }

  report.a11y[where] = found;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The negative controls: one perturbation of one measured value, made in the page after it loaded (or, for the keys, in what is pressed). The probe must see it. With NEGATIVE_CONTROL the exit
// code is 0 when it did.
const PERTURBATIONS = {
  'frame-width': { css: '[data-palette-part="frame"] { inline-size: 643px !important; }', sections: ['geometry'], scenes: ['empty'], expected: /^geometry .* empty: frame\[w\]/ },
  'row-height': { css: '[data-palette-part="row"] { block-size: 26px !important; min-block-size: 26px !important; }', sections: ['geometry'], scenes: ['empty'], expected: /^geometry .* empty: row 1\[h\]/ },
  'foot-height': { css: '[data-palette-part="foot"] { block-size: 36px !important; }', sections: ['geometry'], scenes: ['empty'], expected: /^geometry .* empty: foot\[h\]/ },
  'search-place': { css: '[data-shell-part="search"] { transform: translateX(-4px) !important; }', sections: ['geometry'], scenes: ['closed'], expected: /^geometry .* closed: search right edge\[x\]/ },
  'foot-gap': { css: '[data-palette-part="hint"] + [data-palette-part="hint"] { margin-inline-start: 8px !important; }', sections: ['geometry'], scenes: ['empty'], expected: /^geometry .* empty: footer key 2 gap\[x\]/ },
  paint: { css: '[data-palette-part="row"][aria-selected="true"] { background-color: rgb(1, 2, 3) !important; }', sections: ['geometry'], scenes: ['empty'], expected: /^paint .* empty: row#0 backgroundColor/ },
  'hover-steals': { sections: ['keyboard'], expected: /^keyboard .*: the list scrolled under a still pointer/ },
  'no-restore': { sections: ['keyboard'], expected: /^keyboard .*: Escape did not give the focus back/ },
  // The plugins' providers (palette-plugins.mjs): each perturbation makes the page do what the assertion named is there to see, and runs only the part (`parts`) it perturbs.
  'slow-blocks': { sections: ['plugins'], parts: ['typing'], expected: /^[^:]+: plugins typing: a key pressed while the slow provider worked waited/ },
  'quick-late': { sections: ['plugins'], parts: ['timeline'], expected: /^[^:]+: plugins timeline: the fast provider's rows did not paint before the slow one's/ },
  'focus-moves': { sections: ['plugins'], parts: ['focus'], expected: /^[^:]+: plugins focus: the active row moved when a late section arrived/ },
  'extra-commit': { sections: ['plugins'], parts: ['commits'], development: true, expected: /^[^:]+: plugins commits: .* made 2 commits/ },
  'plugin-shift': { sections: ['plugins'], parts: ['shift'], expected: /^[^:]+: plugins shift: \d+ moves outside the palette/ },
  'closed-work': { sections: ['plugins'], parts: ['closed'], expected: /^[^:]+: plugins closed: a provider was asked before the palette had been opened/ },
  'stale-shown': { sections: ['plugins'], parts: ['states'], expected: /^[^:]+: plugins states: \d+ rows of an answer that came after the provider was told to stop are on screen/ },
  // The sidebar's keywords (C1e; palette-plugins.mjs, part `aliases`): the page a keyword names is not found at all, or is found and ranks as a plain keyword did and comes after a loose match in a title.
  'alias-ignored': { sections: ['plugins'], parts: ['aliases'], expected: /^[^:]+: plugins aliases: the keyword "gz" does not find the page it names/ },
  'alias-loose': { sections: ['plugins'], parts: ['aliases'], expected: /^[^:]+: plugins aliases: the page a keyword names is not the first row/ },
  // The connection a row says (C1f; palette-plugins.mjs, part `connection`): a palette that says the key a route carries (a source of the host's own with the key in a row) is seen, in the text drawn or the accessible name.
  'connection-key': { sections: ['plugins'], parts: ['connection'], expected: /^[^:]+: plugins connection: the key of the connection is drawn/ },
};
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);

// ---------------------------------------------------------------------------------------------------------------------------
/** SECTIONS=geometry,keyboard,states,perf,plugins runs some of them: the default is the first four. The plugins' section is palette-plugins-probe.mjs (the same code, a script of its own so that CI runs it in a shard of its own). */
const SECTIONS = (process.env.SECTIONS ?? 'geometry,keyboard,states,perf').split(',');
const wants = (section) => (CONTROL === '' ? SECTIONS.includes(section) : PERTURBATIONS[CONTROL].sections.includes(section));
const production = await serveFixtures(buildFixtures('production'));
// React's development build is for the commit counts: the perf section's, and the plugins section's (not one of its negative controls that does not count commits).
const needsDevelopment = wants('perf') || (wants('plugins') && (CONTROL === '' || PERTURBATIONS[CONTROL].development === true));
const development = needsDevelopment ? await serveFixtures(buildFixtures('development')) : null;
const axe = readFileSync(AXE, 'utf8');
const css = CONTROL === '' ? undefined : PERTURBATIONS[CONTROL].css;
/** PLATFORM='Linux x86_64' makes every page of the geometry section say so (`navigator.platform`), which is what decides how the keys are written (a Mac: the Command sign and K; elsewhere: Ctrl+K). */
const PLATFORM = process.env.PLATFORM;

for (const engineName of CONTROL === '' ? engineNames : [process.env.ENGINES === undefined ? 'chromium' : engineNames[0]]) {
  const browser = await launch(engineName);
  for (const viewportName of CONTROL === '' ? viewportNames : [process.env.VIEWPORTS === undefined ? '1440x900' : viewportNames[0]]) {
    const viewport = NATIVE_VIEWPORTS[viewportName];
    if (wants('geometry')) {
      if (css !== undefined || PLATFORM !== undefined) {
        // The perturbation is a stylesheet added to every page of the section before it is read; the platform is said before the page's own scripts run.
        const original = browser.newContext.bind(browser);
        browser.newContext = async (options) => {
          const context = await original(options);
          if (css !== undefined) {
            await context.addInitScript((text) => {
              document.addEventListener('DOMContentLoaded', () => {
                const style = document.createElement('style');
                style.textContent = text;
                document.head.append(style);
              });
            }, css);
          }

          if (PLATFORM !== undefined) {
            await context.addInitScript((value) => {
              Object.defineProperty(navigator, 'platform', { get: () => value, configurable: true });
            }, PLATFORM);
          }

          return context;
        };
      }
      await geometry(browser, engineName, viewportName, viewport, production.origin, CONTROL === '' ? undefined : PERTURBATIONS[CONTROL].scenes);
    }
    if (wants('keyboard')) await keyboard(browser, engineName, viewportName, viewport, production.origin, CONTROL);
    if (wants('states')) await states(browser, engineName, viewportName, viewport, production.origin, axe);
    if (wants('perf')) {
      const { perf } = await import('./palette-perf.mjs');
      await perf({ browser, engine: engineName, viewportName, viewport, production, development, report, fail });
    }
    if (wants('plugins')) {
      const { plugins } = await import('./palette-plugins.mjs');
      await plugins({ browser, engine: engineName, viewportName, viewport, production, development, report, fail, control: CONTROL, only: CONTROL === '' ? process.env.PARTS?.split(',') : PERTURBATIONS[CONTROL].parts, axe, shots: SHOTS });
    }
    console.log(engineName, viewportName, 'done');
  }
  await browser.close();
}

production.server.close();
development?.server.close();
report.notes.push('The palette\'s input has no focus ring (the mock has none) and its placeholder is the browser\'s own colour, as the mock\'s: a different one would need the lead\'s approval.');
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      geometryWorst: Object.fromEntries(Object.entries(report.geometry).map(([key, value]) => [key, value.worst])),
      // What each scene's comparisons are of (the same in every engine and viewport): full boxes, boxes that follow the scene's words or rows, and boxes that follow the text of a key.
      geometryClasses: Object.fromEntries(Object.entries(report.geometryClasses).filter(([key]) => key.startsWith(`${engineNames[0]} ${viewportNames[0]} `)).map(([key, value]) => [key.split(' ').slice(2).join(' '), value])),
      // The two widths (the mock's, then the shell's) of what the keys' classes leave out: they are the evidence that the text differs, not the layout.
      keyWidths: report.keyWidths,
      keyFonts: report.keyFonts,
      perf: report.perf,
      plugins: report.plugins,
      notes: report.notes,
    },
    null,
    1,
  ),
);
if (CONTROL !== '') {
  const detected = failures.filter((line) => PERTURBATIONS[CONTROL].expected.test(line));
  console.log(detected.length > 0 ? `\nNEGATIVE CONTROL "${CONTROL}": detected (${detected.length} differences, e.g. ${detected[0]})` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${failures.length} other failures)`);
  process.exit(detected.length > 0 ? 0 : 1);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

console.log('\npalette probe: no failures');

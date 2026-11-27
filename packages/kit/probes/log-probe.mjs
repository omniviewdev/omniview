// Probes the kit's LogView against the design mock's Logs tool body, in WebKit and Chromium at 1440 x 900 and 1280 x 800: the parity probe of the log view.
// Its reference is mock-log.json (made by mock-log-measure.mjs, which says how a record reads); kit-probe.mjs does the same for the parts, table-probe.mjs for the table.
//
//   node packages/kit/probes/log-probe.mjs        # builds ui-next (OMNIVIEW_UI=next) into a temp dir, serves it, probes it
//
//   DIST=<dir>                 probe an existing ui-next build instead of building (the page imports the BUILT kit: `pnpm --filter @omniviewdev/kit run build` first)
//   ENGINES=webkit,chromium    VIEWPORTS=1440x900,1280x800      (defaults: both of each)
//   ONLY=<regex>               only the sections whose name matches: geometry, find, keys, copy, sources, axe (a pattern that matches none of them stops the run: it cannot read as a pass)
//   REPORT=<file>              write the full report as JSON
//   SHOTS=<dir>                a screenshot of the staged log per engine and viewport
//   AXE=<path>                 axe.min.js (default: the kit's axe-core)
//   NEGATIVE_CONTROL=<name>    perturb ONE measured value in the page (row-height, time-column, filter-shift, strip-height, copy, keys, axe, source-tip) and run the one section that must see it, in one
//                              engine at one viewport (chromium 1440x900 unless ENGINES or VIEWPORTS say otherwise), twice: without the perturbation and with it. It is detected, printed as
//                              "detected" with exit 0 (the panel probe's convention, so a CI loop over the controls passes only when every one is seen), only when the assertion the control
//                              names is made and agrees without the perturbation and fails with it, and nothing threw; "NOT DETECTED" lists what kept it from being one, with exit 1. Run it
//                              after changing this file: a probe that cannot fail proves nothing.
//   FONT_DELAY_MS=40           serve every font file that late (serve.mjs): what a runner does, which a local server hides
//
// What it compares. The fixtures are kit examples of LogView.parity.examples.tsx (the parts page shows them): the lines of the mock's own measurement (`L.lines` of
// mock-log-measure.mjs: a level cycle of ten, an ANSI span on line 4, a 450-character line 10, `request` on every third) in a feed that makes them once. The probe stages
// the example the way the mock lays its Logs tool out (a box of the size of the tool: 1390 x 229 at 1440 x 900, 1230 x 199 at 1280 x 800), puts the page in the UTC clock and
// the mock's normalised UI face (`--ov-font-ui` Helvetica, as the table and shell probes do), waits for the real fonts, and reads the log with page-side functions of its own that
// answer in the mock's schema:
//
//   geometry   the regions (filter row 39 px, the list, the status strip 28 px), the header (25 px, columns 112 and 96, the message the rest), the first three rows (24 px, their
//              cells, the clock, the level's glyph and word, the text), the paint of one row per level (the 2 px edge of a warning and an error), the ANSI span, the rows in view at the
//              end of the log (follow), the strip's words and paint, and the filter row's controls (the field with its glyph and its count lane, Match case, Use regular expression,
//              Previous, Next, the level choices)
//   find       the filter row in five states (empty, matches, no results, invalid pattern, empty again): the count lane's words and colour, `aria-invalid`, and that no control moved:
//              0 px, as the mock's own measurement says (FBR1: a lane of fixed width); then Enter, Shift+Enter and Escape in the field, against the mock's (which match is current, what
//              the lane says, where the focus is)
//   keys       the whole Tab sequence from the field to the first stop outside the log and back (the field, the toggles, the level choice, the list: one stop each, the list named), and in
//              the list ArrowDown, ArrowUp, PageDown, PageUp, Home, End and the arrow at the last row, as real key presses, against the mock's (which row is active, which rows are in view, whether it follows)
//   copy       the `copy` event of the list with real keys, with a line selected (each platform's chord: at least one must deliver): it yields the line as plain text (a clock, a level and
//              the text) and is prevented, with nothing else on the clipboard; with a range (click, Shift+click) it yields rows 96 to 98 exactly, in order; and text the reader dragged over
//              inside a row, while a row is selected, is left to the browser (the event is not prevented and carries no text of the log's)
//   sources    the Source column of a log that follows several sources (L2), on the `Sources` fixture of the parity examples (three sources: `app`, `sidecar` and one whose id is the name, too long for the cell), staged, against the mock's own
//              measurement of its Source column (MOCK_SOURCE: 168 px, the chip 10 px in, 3 px down and 18 px high, its name 19 px in, an 8 px swatch with a 2 px radius, a name that does not fit fills the cell), the hue of each
//              source's place in the series, and the kit's tooltip rule on a real hover: the one tooltip of the window shows the whole name of a name that is cut, and nothing for one that fits
//   axe        axe-core over the staged log in the states above and over every log example of the parts page: no serious or critical violation
//
// Rectangles are the mock's, to half a pixel in y and one pixel in x and width (its own runs assert they do not depend on the engine except where KNOWN_DEVIATIONS says so);
// every string (colour, border, padding, font, shadow) must be equal. Exit code 1 when anything outside KNOWN_DEVIATIONS differs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, awaitFonts, launch, normalizeFont, settle, sleep } from './probe-lib.mjs';
import { buildUiNext, serve } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mock = JSON.parse(readFileSync(path.join(here, 'mock-log.json'), 'utf8'));
const AXE = process.env.AXE ?? createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
// A negative control runs the one section that must see it, in one engine at one viewport (a CI loop over seven of them stays short), unless ENGINES or VIEWPORTS say otherwise.
const engineNames = (process.env.ENGINES ?? (CONTROL === '' ? Object.keys(ENGINES).join(',') : 'chromium')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? (CONTROL === '' ? Object.keys(VIEWPORTS).join(',') : '1440x900')).split(',');
const SECTIONS = ['geometry', 'find', 'keys', 'copy', 'sources', 'axe'];
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** px. y and heights are the mock's own; x and widths follow the text measure. */
const TOL = { x: 1, y: 0.5, w: 1, h: 0.5 };
/** A cell is compared by its column (x and width): its y and height are the row's. The mock's cells are table cells as high as their row; the kit's are as high as their content and centred in it, and neither paints (the row does). What is drawn in a cell is compared by its own rectangle. */
const COLUMN = { x: 1, y: Infinity, w: 1, h: Infinity };
/** The box of a run of text (a Range): an engine boxes a text run by the font's own ascent and descent, so its height is read to a pixel and a half. */
const TEXT = { x: 1, y: 1, w: 1, h: 1.5 };

// The fixtures' lines are the mock's own (`L.lines` of mock-log-measure.mjs) and the session is named as the mock names the one it measured: that is what the log and its list are called.
const LABEL = 'Omniview host logs';
/** The Tab stops of the log, in order, each as [role, name]: the field, the toggles and steps (one stop: a roving row), the level choice (one stop) and the list (one stop). */
const TAB_STOPS = [['input', 'Search logs'], ['button', 'Match case'], ['radio', 'All'], ['grid', `Log lines, ${LABEL}`]];
const MOCK_LEVELS = ['info', 'warn', 'error', 'info', 'debug', 'info', 'warn', 'info', 'debug', 'info'];
const MESSAGE_98 = 'worker 2 reconciled 97 objects';
/** Row `row` (from 1) as the list copies it: the clock (the probe's page is in UTC), the level padded to five, the source of the line (the parity fixtures' feed names `source/main`; a copy carries the source of every line that has one, as the mock's `lineText` does) and two spaces, and the text, without the escape sequence that line 4 holds. */
const copyLine = (row) => {
  const index = row - 1;
  let text = index % 3 === 0 ? `request ${index} served in ${10 + ((index * 7) % 90)} ms` : `worker ${index % 5} reconciled ${index} objects`;
  if (index === 3) text = `Applied retry budget to upstream ${index}`;
  if (index === 9) text = `request ${index} ${'very-long-message-segment '.repeat(18)}end`;
  return `${new Date(Date.UTC(2026, 0, 15, 10, 0, 0) + index * 1013).toISOString().slice(11, 23)} ${MOCK_LEVELS[index % 10].toUpperCase().padEnd(5)} source/main  ${text}`;
};
const wanted = (section) => (CONTROL !== '' ? CONTROLS[CONTROL]?.section === section : only === null || only.test(section));

// ---------------------------------------------------------------------------------------------------------------------------
// What differs on purpose, each with its reason and its approval. A deviation not listed here fails the probe. An entry matches a check by its `id` (a RegExp over the check's name, which the
// report prints), by `engines` when it holds for some engines only, and by `when` (a predicate over the check) so that it accepts the one difference it describes and no other; an entry that
// matches nothing in a full run is reported as unused, so a deviation that was fixed does not stay listed. `approval` says who accepted the difference and where it is written; "none" says it is
// a question for the lead (docs/ui-next/AGENTS.md: a difference from the mock is the owner's to accept, and the migration does not redesign).

/** A rectangle that agrees with the mock's but for one edge (0 x, 1 y, 2 width, 3 height) moved by `by`: nothing else may differ. */
const movedBy = (edge, by, tol = TOL) => ({ mock, kit }) => mock != null && kit != null && [0, 1, 2, 3].every((i) => Math.abs(kit[i] - mock[i] - (i === edge ? by : 0)) <= [tol.x, tol.y, tol.w, tol.h][i]);

const KNOWN_DEVIATIONS = [
  {
    id: 'no-time-button',
    match: /^geometry\.filters\.time$/,
    when: ({ kit }) => kit === null,
    approval: 'none: a scope split by the lead (docs/ui-next/optimisations.md HLT-13 "Later slice: logs and terminal in the panel"; status/P1b-2.md "Not in this step"), not an approval of the finished screen',
    reason: 'The mock\'s filter row ends with a "Go to time" button (the old viewer\'s Jump to time, HLT-13). It is a toolbar action of the panel, not of the view: the kit\'s filter row ends with the level choice. P1b-3 must show the control, and this entry goes then.',
  },
  {
    id: 'search-field-lane',
    match: /^(geometry\.filters|find\.(rest|match|none|invalid|empty))\.lane$/,
    when: movedBy(0, -19),
    approval: 'the design\'s own part, not a ruling on the find bar: SearchField (row 1a.6a, PR #522; design 14 P4) draws a clear button inside the end of the field while it holds text and keeps its room whether or not it is drawn, and the mock\'s find field has none. Asked of the lead whether the find bar takes the mock\'s lane',
    reason: 'The room of the 24 px clear button (plus its 2 px edge and air: 28 px) is reserved at the end of the field, so the count lane stands 19 px further from the edge than the mock\'s (28 px against its 9 px control text inset). The lane is 100 px wide and moves nothing in any state (find.movement, 0 px).',
  },
  {
    id: 'search-field-lane-webkit',
    match: /^geometry\.filters\.seg(\.|$)/,
    engines: ['webkit'],
    // 19 px in macOS WebKit; in Linux WebKit (the Playwright image, arm64) the last button of the level choice reads 17.99 px (1.01 from 19, the overlapping 1 px borders laid out in fractions), so the x is read to a pixel and a half.
    when: movedBy(0, 19, { x: 1.5, y: 0.5, w: 1, h: 0.5 }),
    approval: 'the same decision as search-field-lane (the room of the clear button), and a dependence the mock itself has: see the reason',
    reason: 'The same 19 px. In WebKit (inferred from the numbers below, not measured separately) a flex group is as wide as the intrinsic width of its input (padding included) and not its flex basis, so the level choice that follows the find group stands as far right as the input\'s padding makes it. The mock has the same CSS and the same dependence (its level choice stands at x = 442.61 in WebKit and 432 in Chromium at 1440 x 900, mock-log.json, seg); its input has 19 px less padding at the end than the field\'s (the lane\'s own room, above), so the kit\'s stands 19 px further right in WebKit. In Chromium nothing moves.',
  },
  {
    id: 'mock-message-offset',
    match: /^geometry\.(row\d\.message\.textRect|ansi\.rect)$/,
    when: movedBy(1, 2, { x: 1, y: 0.5, w: 1, h: 1.5 }),
    approval: 'none: a defect of the mock\'s CSS, asked of the lead whether the kit repeats it',
    reason: 'The mock\'s message cell is a `td` that `.plog__scroll .cell-prose` makes `display: block` (shell-panel.css 106 and 112), which drops the vertical centring of a table cell: its text stands 2 px above the centre of the row while its clock and its level are centred. The kit centres all three.',
  },
  {
    id: 'no-operation-lane',
    match: /^geometry\.strip\.stat\.(rect|textRect)$/,
    when: ({ mock, kit }) => mock != null && kit != null && Math.abs(kit[0] - 12) <= 0.5 && Math.abs(kit[1] - mock[1]) <= 0.5 && Math.abs(kit[3] - mock[3]) <= 1.5,
    approval: 'none: a scope split (the panel owns session operations, P1b-3), not an approval of the finished screen',
    reason: 'The mock\'s status strip starts with the session\'s operation lane (`.ptool__operation`, flex 1 1 240px: what a session\'s start, stop or retry says while it runs) and a state lane of 24ch before the count, both empty at rest, which push the count to x = 903 at 1440 x 900. The view\'s strip has neither lane (session operations are P1b-3\'s): its count starts at the strip\'s inset, x = 12. This entry goes when the strip gets the lane.',
  },
  {
    id: 'mock-follow-after-page-up',
    match: /^keys\.PageUp\.follow$/,
    when: ({ mock, kit }) => mock === true && kit === false,
    approval: 'the mock is wrong, by its own rule: asked of the lead whether the kit repeats it',
    reason: 'After PageUp from the end of the log the mock\'s view shows lines 93 to 98 of 100 and its strip still says Following (mock-log.json, selected.keys.PageUp, after: follow true). Its own rule says a reader who scrolls up stops following (shell-panel.js 1902, S120: "Auto-pause"), but its keys scroll the list with a programmatic offset that the scroll handler skips as its own (`mine`, 1897), so only the wheel and Home turn follow off. A view that is above the end while the next line pulls it back to the end is the defect S120 names. The kit leaves follow when the view is not at the end, as the wheel does, and says Scrolled back.',
  },
  {
    id: 'long-lines-scroll-sideways',
    match: /^geometry\.long\.scrollsSideways$/,
    when: ({ mock, kit }) => mock === false && kit === true,
    approval: 'none: the wrap mode is deferred (status/P1b-2.md, by the lead), so a long line is shown whole by scrolling; asked of the lead',
    reason: 'The mock clips a message longer than the list to one line with an ellipsis (`.plog__table td { white-space: nowrap; text-overflow: ellipsis; overflow: hidden }`, shell-panel.css 106) and says the whole line in a tooltip; its list never scrolls sideways; it also offers Wrap lines (113). Neither the wrap mode nor the tooltip is built (a wrapped list that is not verified in a real engine is not shipped), so that a long line can be read at all the kit\'s list scrolls sideways, its rows staying one line high. The widths of what the list shows are read as far as the list is wide.',
  },
];

// ---------------------------------------------------------------------------------------------------------------------------
// The page: the stage and the negative controls. The stage is what the mock's Logs tool is: a box of the tool's size at the top left, the figure's caption hidden.
const STAGE_CSS = `
[data-probe-stage] { position: fixed; inset-block-start: 0; inset-inline-start: 0; z-index: 99999; box-sizing: border-box; margin: 0; padding: 0; border: 0; border-radius: 0; background: var(--ov-bg-island); display: block; overflow: hidden; width: var(--probe-w); height: var(--probe-h); }
[data-probe-stage] > figcaption { display: none; }
[data-probe-stage] > div, [data-probe-stage] > div > div { display: block; width: 100%; max-width: none; height: 100%; margin: 0; border: 0; border-radius: 0; }
`;

// The negative controls: one perturbation of one measured value, made in the page after it loaded. Each names the assertion that must fail when it is made (`expect`, over the id of a check;
// `says`, when the failure's reading must hold a word) and the section that makes it. A control is detected only when, at the same engine and viewport, (1) the section runs without the
// perturbation and that assertion is among the checks made and agreed, and (2) with it the assertion fails and nothing threw: a fixture that did not mount, a page error and a missing example are
// setup errors, not detections, and an unrelated mismatch is not the control's.
const CONTROLS = {
  'row-height': { css: '[data-probe-stage] [role="row"][data-n] { height: 25px !important; }', expect: /^geometry\.row1\.rect$/, section: 'geometry' },
  'time-column': { css: '[data-probe-stage] [data-ov-column="time"] { flex-basis: 120px !important; }', expect: /^geometry\.head\.Time\.rect$/, section: 'geometry' },
  'filter-shift': { css: '[data-probe-stage] [role="group"][aria-label="Log filters"]:has([data-ov-lane]:not(:empty)) [role="radiogroup"] { margin-inline-start: 2px !important; }', expect: /^find\.movement$/, section: 'find' },
  'strip-height': { css: '[data-probe-stage] [role="group"][aria-label="Session status"] { height: 29px !important; flex-basis: 29px !important; }', expect: /^geometry\.regions\.status$/, section: 'geometry' },
  copy: { script: () => document.addEventListener('copy', (event) => event.stopImmediatePropagation(), true), expect: /^copy\.delivered$/, section: 'copy' },
  keys: { script: () => window.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') event.stopImmediatePropagation(); }, true), expect: /^keys\.ArrowDown\.activeN$/, section: 'keys' },
  axe: { script: () => { const button = document.createElement('button'); button.setAttribute('data-probe-injected', ''); document.querySelector('[data-probe-stage]')?.append(button); }, expect: /^axe\.rest$/, says: 'button-name', section: 'axe' },
  'source-tip': { css: '[data-probe-stage] [data-ov-clip] { pointer-events: none !important; }', expect: /^sources\.tip\.cut$/, section: 'sources' },
};

// A selection that names nothing must not read as a pass: an unknown engine, viewport, section or control stops the run before a browser opens.
for (const [what, names, known] of [['ENGINES', engineNames, Object.keys(ENGINES)], ['VIEWPORTS', viewportNames, Object.keys(VIEWPORTS)]]) {
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`${what} names ${unknown.join(', ')}, which is not one of ${known.join(', ')}`);
}

if (only !== null && !SECTIONS.some((section) => only.test(section))) throw new Error(`ONLY=${process.env.ONLY} matches none of the sections: ${SECTIONS.join(', ')}`);
if (CONTROL !== '' && CONTROLS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL=${CONTROL} is not one of ${Object.keys(CONTROLS).join(', ')}`);

/** Page side (self-contained: it is serialised into the page). Installs window.__lp: the stage and the readers, which answer in the schema of mock-log.json. */
function installLib() {
  const r2 = (v) => Math.round(v * 100) / 100;
  const shown = (el) => el instanceof Element && el.getClientRects().length > 0;
  const L = { r2, shown };
  const figure = (name) => document.querySelector(`[data-example="LogViewParity/${name}"]`);

  /** Pins the example's figure to the stage: the size of the mock's tool. */
  L.stage = (name, width, height) => {
    for (const el of document.querySelectorAll('[data-probe-stage]')) {
      el.removeAttribute('data-probe-stage');
      el.style.removeProperty('--probe-w');
      el.style.removeProperty('--probe-h');
    }

    const fig = figure(name);
    if (fig === null) throw new Error(`no example LogViewParity/${name} on the page`);
    fig.setAttribute('data-probe-stage', '');
    fig.style.setProperty('--probe-w', `${width}px`);
    fig.style.setProperty('--probe-h', `${height}px`);
    return true;
  };

  L.root = () => document.querySelector('[data-probe-stage] [role="group"][aria-label^="Log, "]');
  const parts = () => {
    const root = L.root();
    const q = (selector) => root.querySelector(selector);
    const input = q('input[type="search"]');
    return {
      root,
      filters: q('[role="group"][aria-label="Log filters"]'),
      grid: q('[role="grid"]'),
      header: q('[role="row"][aria-rowindex="1"]'),
      strip: q('[role="group"][aria-label="Session status"]'),
      input,
      field: input?.parentElement ?? null,
      glyph: input?.parentElement?.querySelector('svg') ?? null,
      lane: q('[data-ov-lane]'),
      options: q('[role="group"][aria-label="Search options"]'),
      seg: q('[role="radiogroup"][aria-label="Minimum level"]'),
    };
  };
  L.parts = parts;

  const STYLE = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'textAlign', 'whiteSpace', 'fontVariantNumeric', 'backgroundColor', 'borderBottomWidth', 'borderBottomColor', 'borderTopWidth', 'borderTopColor', 'position', 'boxShadow'];
  const style = (el, names = STYLE) => {
    if (!shown(el)) return null;
    const cs = getComputedStyle(el);
    return Object.fromEntries(names.map((name) => [name, cs[name]]));
  };
  const pickStyle = (el, names) => style(el, names);
  const rel = (el, origin) => {
    if (!shown(el)) return null;
    const b = el.getBoundingClientRect();
    return [r2(b.x - origin.x), r2(b.y - origin.y), r2(b.width), r2(b.height)];
  };
  /** What can be seen of a rectangle read from the list's content: the list scrolls sideways where a line is longer than it (the mock clips the line to the list), so a width is read as far as the list's own. */
  const seen = (rect, width) => (rect === null ? null : [rect[0], rect[1], r2(Math.max(0, Math.min(rect[2], width - rect[0]))), rect[3]]);
  /** The rectangle of the text an element holds (its Range): where the glyphs are, not the box. */
  const textRect = (el, origin) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const b = range.getBoundingClientRect();
    return b.width === 0 && b.height === 0 ? null : [r2(b.x - origin.x), r2(b.y - origin.y), r2(b.width), r2(b.height)];
  };

  // The filter row's controls, in the mock's names. `o` is the root's rectangle.
  const controls = (o) => {
    const p = parts();
    const buttons = [...(p.options?.querySelectorAll('button') ?? [])];
    const named = (label) => buttons.find((b) => b.getAttribute('aria-label') === label) ?? null;
    return {
      filters: rel(p.filters, o),
      field: rel(p.field, o),
      input: rel(p.input, o),
      glyph: rel(p.glyph, o),
      lane: rel(p.lane, o),
      toggles: ['Match case', 'Use regular expression'].map((name) => ({ name, rect: rel(named(name), o), pressed: named(name)?.getAttribute('aria-pressed') ?? null })),
      steps: ['Previous match', 'Next match'].map((name) => ({ name, rect: rel(named(name), o) })),
      seg: rel(p.seg, o),
      segButtons: [...(p.seg?.querySelectorAll('button') ?? [])].map((b) => ({ label: b.textContent, rect: rel(b, o), checked: b.getAttribute('aria-checked') })),
      time: null,
    };
  };

  L.findState = () => {
    const p = parts();
    const o = p.root.getBoundingClientRect();
    return {
      ...controls(o),
      value: p.input.value,
      laneText: p.lane?.textContent ?? '',
      laneColor: p.lane === null ? null : getComputedStyle(p.lane).color,
      ariaInvalid: p.input.getAttribute('aria-invalid'),
      describedIsLane: p.input.getAttribute('aria-describedby') === p.lane?.id,
      focused: document.activeElement === p.input,
    };
  };

  /** Everything the list scenario reads, at the end of the log (follow on). */
  L.readList = () => {
    const p = parts();
    const o = p.root.getBoundingClientRect();
    const scrollBox = p.grid.getBoundingClientRect();
    const headBottom = p.header.getBoundingClientRect().bottom;
    const rows = [...p.grid.querySelectorAll('[role="row"][data-n]')].filter((row) => {
      const b = row.getBoundingClientRect();
      return b.bottom > headBottom && b.top < scrollBox.bottom;
    });
    const stat = p.strip.querySelector('span:not([class*="state"])');
    const stripText = stat?.textContent ?? p.strip.textContent;
    const stripStyle = style(p.strip, [...STYLE, 'height']);
    // The strip shares the viewer's background; compare the visible paint to the mock, including any paint on the strip itself.
    if (stripStyle.backgroundColor === 'rgba(0, 0, 0, 0)') stripStyle.backgroundColor = getComputedStyle(p.strip.parentElement).backgroundColor;
    return {
      tool: [r2(o.width), r2(o.height)],
      regions: { filters: rel(p.filters, o), scroll: rel(p.grid, o), status: rel(p.strip, o) },
      scroll: { scrollTop: p.grid.scrollTop, scrollHeight: p.grid.scrollHeight, clientHeight: p.grid.clientHeight },
      viewportRows: {
        count: rows.length,
        firstN: Number(rows[0]?.dataset.n ?? 0),
        lastN: Number(rows.at(-1)?.dataset.n ?? 0),
        first: rows[0] ? rel(rows[0], o) : null,
        last: rows.at(-1) ? rel(rows.at(-1), o) : null,
        headBottom: r2(headBottom - o.y),
      },
      strip: { rect: rel(p.strip, o), text: stripText.trim(), style: stripStyle, statRect: rel(stat, o), statTextRect: stat === null ? null : textRect(stat, o), statStyle: style(stat, ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'fontVariantNumeric', 'textAlign']) },
      filters: controls(o),
      following: p.strip.textContent.includes('Following'),
    };
  };

  /** The header and the rows, with the list scrolled to its first line (the mock's rows are read relative to its table, which scrolls under the sticky head). */
  L.readTop = async () => {
    const p = parts();
    p.grid.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const o = p.root.getBoundingClientRect();
    const canvas = p.grid.firstElementChild;
    const c = canvas.getBoundingClientRect();
    const room = p.grid.clientWidth;
    const cells = [...p.header.querySelectorAll('[role="columnheader"]')];
    const rowOf = (n) => p.grid.querySelector(`[role="row"][data-n="${n}"]`);
    const rowInfo = (n) => {
      const row = rowOf(n);
      if (row === null) return null;
      const [time, level, text] = [...row.querySelectorAll('[role="gridcell"]')];
      const glyph = level.querySelector('svg');
      const word = [...level.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim() !== '');
      let wordRect = null;
      if (word) {
        const range = document.createRange();
        range.selectNodeContents(word);
        const b = range.getBoundingClientRect();
        wordRect = [r2(b.x - c.x), r2(b.y - c.y), r2(b.width), r2(b.height)];
      }
      const cellStyle = (el) => style(el, ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'paddingLeft', 'paddingRight', 'whiteSpace', 'fontVariantNumeric', 'textAlign']);
      return {
        n,
        rect: seen(rel(row, c), room),
        boxShadow: getComputedStyle(row).boxShadow,
        background: getComputedStyle(row).backgroundColor,
        tds: [time, level, text].map((cell) => ({ rect: seen(rel(cell, c), room), style: cellStyle(cell) })),
        time: { text: time.textContent, rect: textRect(time, c) },
        level: { glyph: rel(glyph, c), glyphColor: glyph ? getComputedStyle(glyph).color : null, word: wordRect, wordText: word?.textContent.trim() ?? '', wordColor: getComputedStyle(level).color },
        message: { rect: seen(rel(text, c), room), text: text.textContent, textRect: textRect(text, c), style: cellStyle(text) },
      };
    };
    const span = rowOf(4)?.querySelector('[data-ov-hue]');
    const long = rowOf(10);
    return {
      head: {
        rect: seen(rel(p.header, o), room),
        position: getComputedStyle(p.header).position,
        top: getComputedStyle(p.header).insetBlockStart,
        // The mock paints the header's ground and its bottom border on each of its cells; the kit paints them once, on the header row that holds the cells: the cell is read with the row's.
        cells: cells.map((cell) => ({ text: cell.textContent, rect: seen(rel(cell, o), room), style: { ...style(cell), ...pickStyle(p.header, ['backgroundColor', 'borderBottomWidth', 'borderBottomColor']) } })),
      },
      rows: [1, 2, 3].map(rowInfo),
      levels: { info: rowInfo(1), warn: rowInfo(2), error: rowInfo(3), debug: rowInfo(5) },
      ansi: span ? { n: 4, hue: span.dataset.ovHue, text: span.textContent, color: getComputedStyle(span).color, rect: textRect(span, c) } : null,
      long: long ? { n: 10, chars: long.querySelector('[role="gridcell"]:last-child').textContent.length, rect: seen(rel(long, c), room), scrollWidth: p.grid.scrollWidth, clientWidth: p.grid.clientWidth } : null,
    };
  };

  /** The rows in view, their active one and whether the strip says it follows: what a key moved. */
  L.where = () => {
    const p = parts();
    const headBottom = p.header.getBoundingClientRect().bottom;
    const scrollBottom = p.grid.getBoundingClientRect().bottom;
    const rows = [...p.grid.querySelectorAll('[role="row"][data-n]')].filter((row) => {
      const b = row.getBoundingClientRect();
      return b.bottom > headBottom && b.top < scrollBottom;
    });
    const activeId = p.grid.getAttribute('aria-activedescendant');
    const active = activeId === null ? null : document.getElementById(activeId);
    return {
      activeElement: document.activeElement === p.grid ? 'grid' : document.activeElement === p.input ? 'input' : (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? null),
      activeN: active === null ? null : Number(active.dataset.n),
      selected: [...p.grid.querySelectorAll('[role="row"][aria-selected="true"]')].map((row) => Number(row.dataset.n)),
      current: [...p.grid.querySelectorAll('[role="row"][data-ov-current="true"]')].map((row) => Number(row.dataset.n)),
      firstN: Number(rows[0]?.dataset.n ?? 0),
      lastN: Number(rows.at(-1)?.dataset.n ?? 0),
      follow: p.strip.textContent.includes('Following'),
      scrollTop: p.grid.scrollTop,
      lane: p.lane?.textContent ?? '',
    };
  };

  /** The Tab stops of the log, in document order, as the keyboard visits them: what each is. */
  L.describeFocus = () => {
    const el = document.activeElement;
    if (!(el instanceof Element)) return null;
    return {
      role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
      name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? '',
      inLog: L.root()?.contains(el) ?? false,
    };
  };

  /** Where a pointer can press a row: inside the part of it that is in the list, under the sticky header and above the list's foot (a row can be half out of view). Null when none of it is. */
  L.rowPoint = (n) => {
    const p = parts();
    const row = p.grid.querySelector(`[role="row"][data-n="${n}"]`);
    if (row === null) return null;
    const cell = row.querySelector('[role="gridcell"]:last-child').getBoundingClientRect();
    const box = p.grid.getBoundingClientRect();
    const top = Math.max(cell.top, p.header.getBoundingClientRect().bottom, box.top);
    const bottom = Math.min(cell.bottom, box.bottom);
    return bottom - top >= 4 ? { x: Math.min(cell.left + 40, box.right - 2), y: (top + bottom) / 2 } : null;
  };

  /** Where the words of a row's message start, inside the part of the row that can be pressed: a pointer that goes down here and moves along the row selects them. Null when the row has none in the list. */
  L.textStart = (n) => {
    const point = L.rowPoint(n);
    const cell = document.querySelector(`[data-probe-stage] [role="row"][data-n="${n}"] [role="gridcell"]:last-child`);
    if (point === null || cell === null) return null;
    const range = document.createRange();
    range.selectNodeContents(cell);
    return { x: range.getBoundingClientRect().x + 1, y: point.y };
  };

  /** Records the `copy` events that reach the document, after the log's own handler ran: what it put on the clipboard, and whether it prevented the default. */
  L.watchCopy = () => {
    window.__copies = [];
    document.addEventListener('copy', (event) => {
      const data = event.clipboardData;
      window.__copies.push({ types: [...(data?.types ?? [])], plain: data?.getData('text/plain') ?? null, html: data?.getData('text/html') ?? null, prevented: event.defaultPrevented, target: event.target instanceof Element ? (event.target.getAttribute('role') ?? event.target.tagName) : null });
    });
    return true;
  };

  window.__lp = L;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Comparisons. A check is `{ id, mock, kit, kind }`; `compare` says whether the two agree, and the report prints both when they do not.
const rectsAgree = (a, b, tol = TOL) => {
  if (a === null || b === null || a === undefined || b === undefined) return a == null && b == null;
  return Math.abs(a[0] - b[0]) <= tol.x && Math.abs(a[1] - b[1]) <= tol.y && Math.abs(a[2] - b[2]) <= tol.w && Math.abs(a[3] - b[3]) <= tol.h;
};
const agree = (check) => (check.kind === 'rect' ? rectsAgree(check.mock, check.kit, check.tol) : check.kind === 'number' ? Math.abs(check.mock - check.kit) <= (check.tol ?? 0.5) : JSON.stringify(check.mock) === JSON.stringify(check.kit));

const rect = (id, mockValue, kitValue, tol) => ({ id, kind: 'rect', mock: mockValue, kit: kitValue, tol });
const equal = (id, mockValue, kitValue) => ({ id, kind: 'equal', mock: mockValue, kit: kitValue });
const pick = (object, keys) => (object === null || object === undefined ? null : Object.fromEntries(keys.map((key) => [key, object[key]])));

/** The checks of the list scenario: the mock's `list` (per engine and viewport) against what the kit read. */
function geometryChecks(m, kit, top) {
  const checks = [];
  const L = m.list;
  checks.push(rect('geometry.regions.filters', L.regions.filters, kit.regions.filters));
  checks.push(rect('geometry.regions.scroll', L.regions.scroll, kit.regions.scroll));
  checks.push(rect('geometry.regions.status', L.regions.status, kit.regions.status));
  checks.push(equal('geometry.scroll.scrollTop', L.scroll.scrollTop, kit.scroll.scrollTop));
  checks.push(equal('geometry.scroll.scrollHeight', L.scroll.scrollHeight, kit.scroll.scrollHeight));
  checks.push(equal('geometry.viewportRows.count', L.viewportRows.count, kit.viewportRows.count));
  checks.push(equal('geometry.viewportRows.firstN', L.viewportRows.firstN, kit.viewportRows.firstN));
  checks.push(equal('geometry.viewportRows.lastN', L.viewportRows.lastN, kit.viewportRows.lastN));
  checks.push(rect('geometry.viewportRows.first', L.viewportRows.first, kit.viewportRows.first));
  checks.push(rect('geometry.viewportRows.last', L.viewportRows.last, kit.viewportRows.last));
  checks.push(equal('geometry.follow', true, kit.following));

  // The strip.
  checks.push(rect('geometry.strip.rect', L.strip.rect, kit.strip.rect));
  checks.push(equal('geometry.strip.text', L.strip.stat.text, kit.strip.text));
  for (const name of ['paddingLeft', 'paddingRight', 'borderTopWidth', 'borderTopColor', 'color', 'backgroundColor', 'height']) {
    checks.push(equal(`geometry.strip.style.${name}`, L.strip.style[name], kit.strip.style[name]));
  }
  for (const name of ['fontSize', 'lineHeight', 'fontWeight', 'color', 'fontVariantNumeric']) {
    checks.push(equal(`geometry.strip.stat.${name}`, L.strip.stat.style[name], kit.strip.statStyle[name]));
  }
  checks.push(rect('geometry.strip.stat.rect', L.strip.stat.rect, kit.strip.statRect));
  checks.push(rect('geometry.strip.stat.textRect', L.strip.stat.textRect, kit.strip.statTextRect, TEXT));

  // The filter row's controls at rest.
  const F = L.filters;
  const K = kit.filters;
  checks.push(rect('geometry.filters.field', F.field, K.field));
  checks.push(rect('geometry.filters.glyph', F.glyph, K.glyph));
  checks.push(rect('geometry.filters.lane', F.lane, K.lane));
  F.toggles.forEach((toggle, index) => checks.push(rect(`geometry.filters.toggle.${toggle.name}`, toggle.rect, K.toggles[index]?.rect ?? null)));
  F.steps.forEach((step, index) => checks.push(rect(`geometry.filters.step.${step.name}`, step.rect, K.steps[index]?.rect ?? null)));
  checks.push(equal('geometry.filters.segLabels', F.segButtons.map((b) => b.label), K.segButtons.map((b) => b.label)));
  F.segButtons.forEach((button, index) => checks.push(rect(`geometry.filters.seg.${button.label}`, button.rect, K.segButtons[index]?.rect ?? null)));
  checks.push(rect('geometry.filters.seg', F.seg, K.seg));
  if (F.time !== null) checks.push(rect('geometry.filters.time', F.time.rect, K.time));

  // The header.
  checks.push(rect('geometry.head.rect', L.head.rect, top.head.rect));
  checks.push(equal('geometry.head.position', L.head.position, top.head.position));
  checks.push(equal('geometry.head.top', L.head.top, top.head.top));
  const headMock = L.head.cells.filter((cell) => cell.rect !== null);
  headMock.forEach((cell, index) => {
    const kitCell = top.head.cells[index];
    checks.push(equal(`geometry.head.${cell.text}.text`, cell.text, kitCell?.text ?? null));
    checks.push(rect(`geometry.head.${cell.text}.rect`, cell.rect, kitCell?.rect ?? null, COLUMN));
    for (const name of ['fontSize', 'lineHeight', 'fontWeight', 'color', 'paddingLeft', 'paddingRight', 'backgroundColor', 'borderBottomWidth', 'borderBottomColor']) {
      checks.push(equal(`geometry.head.${cell.text}.${name}`, cell.style[name], kitCell?.style?.[name] ?? null));
    }
  });

  // Rows 1 to 3: the row, its cells (the source column is hidden in the mock and absent in the kit), the clock, the level, the text.
  L.rows.forEach((row, index) => {
    const k = top.rows[index];
    const id = `geometry.row${row.n}`;
    checks.push(rect(`${id}.rect`, row.rect, k?.rect ?? null));
    const mockCells = row.tds.filter((td) => td.rect !== null);
    mockCells.forEach((td, cell) => {
      const name = ['time', 'level', 'message'][cell];
      checks.push(rect(`${id}.${name}.cell`, td.rect, k?.tds[cell]?.rect ?? null, COLUMN));
      for (const prop of ['fontSize', 'lineHeight', 'color', 'paddingLeft', 'paddingRight']) {
        if (name === 'message' && (prop === 'fontSize' || prop === 'lineHeight')) continue;
        // The clock is drawn in a muted `.dim` span inside the mock's cell, whose own colour is the text colour: the clock's colour is the span's (`time.color` below).
        if (name === 'time' && prop === 'color') continue;
        checks.push(equal(`${id}.${name}.cell.${prop}`, td.style[prop], k?.tds[cell]?.style?.[prop] ?? null));
      }
    });
    checks.push(equal(`${id}.time.text`, row.time.text, k?.time.text ?? null));
    checks.push(rect(`${id}.time.rect`, row.time.rect, k?.time.rect ?? null));
    checks.push(equal(`${id}.time.color`, row.time.style.color, k?.tds[0].style.color ?? null));
    checks.push(equal(`${id}.time.fontVariantNumeric`, row.time.style.fontVariantNumeric, k?.tds[0].style.fontVariantNumeric ?? null));
    checks.push(rect(`${id}.level.glyph`, row.level.glyph, k?.level.glyph ?? null));
    checks.push(rect(`${id}.level.word`, row.level.word, k?.level.word ?? null, TEXT));
    checks.push(equal(`${id}.level.wordText`, row.level.wordText, k?.level.wordText ?? null));
    checks.push(equal(`${id}.level.glyphColor`, row.level.glyphStyle.color, k?.level.glyphColor ?? null));
    checks.push(equal(`${id}.message.text`, row.message.monoText, k?.message.text ?? null));
    checks.push(rect(`${id}.message.textRect`, row.message.mono, k?.message.textRect ?? null, TEXT));
    checks.push(equal(`${id}.message.fontSize`, row.message.monoStyle.fontSize, k?.message.style.fontSize ?? null));
    checks.push(equal(`${id}.message.color`, row.message.monoStyle.color, k?.message.style.color ?? null));
  });

  // One row per level: the 2 px edge of a warning and an error, the colours of the glyph and the word.
  for (const level of ['info', 'warn', 'error', 'debug']) {
    const row = L.levels[level];
    const k = top.levels[level];
    checks.push(rect(`geometry.level.${level}.rect`, row.rect, k?.rect ?? null));
    checks.push(equal(`geometry.level.${level}.edge`, row.firstTdBoxShadow, k?.boxShadow ?? null));
    checks.push(equal(`geometry.level.${level}.background`, row.trBackground, k?.background ?? null));
    checks.push(equal(`geometry.level.${level}.wordText`, row.wordText, k?.level.wordText ?? null));
    checks.push(equal(`geometry.level.${level}.glyphColor`, row.glyphStyle.color, k?.level.glyphColor ?? null));
    checks.push(equal(`geometry.level.${level}.wordColor`, row.levelWordStyle.color, k?.level.wordColor ?? null));
  }

  // The ANSI span: the amber of the mock's `.plog__a`, on the words it covers.
  checks.push(equal('geometry.ansi.text', L.special.ansi.text, top.ansi?.text ?? null));
  checks.push(equal('geometry.ansi.color', L.special.ansi.style.color, top.ansi?.color ?? null));
  checks.push(rect('geometry.ansi.rect', L.special.ansi.rect, top.ansi?.rect ?? null, TEXT));
  checks.push(equal('geometry.long.chars', L.special.long.chars, top.long?.chars ?? null));
  checks.push(rect('geometry.long.rect', L.special.long.rowRect, top.long?.rect ?? null));
  // A message longer than the list: the mock's table never scrolls sideways (it clips the line); the kit's list does, for as wide as the longest line it mounts.
  checks.push(equal('geometry.long.scrollsSideways', L.special.long.rowRect[2] > L.scroll.clientWidth, top.long === null ? null : top.long.scrollWidth > top.long.clientWidth));
  return checks;
}

/** The filter row across the five states: the words, the colour, `aria-invalid`, and that nothing moved. */
function findChecks(m, states) {
  const checks = [];
  const F = m.find;
  const names = ['rest', 'match', 'none', 'invalid', 'empty'];
  for (const name of names) {
    const ref = F.states[name];
    const got = states[name];
    checks.push(equal(`find.${name}.laneText`, ref.laneText, got.laneText));
    checks.push(equal(`find.${name}.laneColor`, ref.laneStyle.color, got.laneColor));
    checks.push(equal(`find.${name}.ariaInvalid`, ref.ariaInvalid, got.ariaInvalid));
    checks.push(equal(`find.${name}.describedIsLane`, ref.describedIsLane, got.describedIsLane));
    checks.push(rect(`find.${name}.field`, ref.field, got.field));
    checks.push(rect(`find.${name}.lane`, ref.lane, got.lane));
  }

  // 0 px: no control of the filter row moves in any state. The mock's own largest movement is `F.maxMovement` (0); the kit's is read edge by edge across the five states.
  const moved = {};
  const controlRects = (state) => ({
    filters: state.filters, field: state.field, input: state.input, glyph: state.glyph, lane: state.lane,
    toggle0: state.toggles[0]?.rect, toggle1: state.toggles[1]?.rect, step0: state.steps[0]?.rect, step1: state.steps[1]?.rect, seg: state.seg,
    seg0: state.segButtons[0]?.rect, seg1: state.segButtons[1]?.rect, seg2: state.segButtons[2]?.rect, seg3: state.segButtons[3]?.rect,
  });
  const base = controlRects(states.rest);
  for (const name of names) {
    const now = controlRects(states[name]);
    for (const [control, box] of Object.entries(base)) {
      const other = now[control];
      const delta = box == null || other == null ? (box == null && other == null ? 0 : Infinity) : Math.max(...box.map((value, edge) => Math.abs(value - other[edge])));
      moved[control] = Math.max(moved[control] ?? 0, delta);
    }
  }

  const largest = Math.max(...Object.values(moved));
  checks.push(equal('find.movement.mock', 0, F.maxMovement));
  checks.push(equal('find.movement', 0, largest));
  return { checks, moved };
}

// ---------------------------------------------------------------------------------------------------------------------------
const freshReport = () => ({ engines: {}, failures: [], unusedDeviations: [], deviations: [], evaluated: {} });
let report = freshReport();
let used = new Set();
/** Whether the perturbation of the negative control is made in the page (the run that must see it) or not (the run that shows the assertion passes without it). */
let perturb = false;

function judge(where, checks) {
  const out = [];
  for (const check of checks) {
    if (agree(check)) {
      report.evaluated[`${where} ${check.id}`] = 'agree';
      continue;
    }

    const deviation = KNOWN_DEVIATIONS.find((d) => d.match.test(check.id) && (d.engines === undefined || d.engines.includes(where.split('/')[0])) && (d.when === undefined || d.when(check)));
    if (deviation !== undefined) {
      used.add(deviation.id);
      report.evaluated[`${where} ${check.id}`] = 'deviation';
      report.deviations.push({ where, id: check.id, mock: check.mock, kit: check.kit, because: deviation.id });
      continue;
    }

    out.push(check);
    report.evaluated[`${where} ${check.id}`] = 'differ';
    report.failures.push({ where, id: check.id, mock: check.mock, kit: check.kit });
  }

  return out;
}

const fail = (where, message) => {
  report.failures.push({ where, id: message });
  console.log(`FAIL ${where}: ${message}`);
};

async function load(context, url, errors) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  // A file that is not there is named by its address (the console's "Failed to load resource" does not say which); the favicon and the Wails runtime are not the page's.
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico') && !response.url().includes('/wails/')) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text().slice(0, 200));
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-example="LogViewParity/List"]');
  await awaitFonts(page);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  await page.addStyleTag({ content: STAGE_CSS });
  await page.evaluate(installLib);
  const control = CONTROLS[CONTROL];
  if (perturb && control?.css) await page.addStyleTag({ content: control.css });
  return page;
}

async function stage(page, name, size) {
  await page.evaluate(([n, w, h]) => window.__lp.stage(n, w, h), [name, size[0], size[1]]);
  await page.waitForSelector('[data-probe-stage] [role="grid"] [data-n]');
  await sleep(700);
  await settle(page);
  const control = CONTROLS[CONTROL];
  if (perturb && control?.script) await page.evaluate(control.script);
}

/** The strip's rate is a window over the last three seconds (the mock's own), so a log that was just filled says how fast it filled; the mock was read once its rate had decayed to 0.0, and so is the kit. */
async function untilAtRest(page) {
  await page.waitForFunction(() => /\b0\.0 lines\/s\b/.test(document.querySelector('[data-probe-stage] [role="group"][aria-label="Session status"]')?.textContent ?? ''), null, { timeout: 8000 });
}

const INPUT = '[data-probe-stage] input[type="search"]';
const GRID = '[data-probe-stage] [role="grid"]';

async function sectionGeometry(page, where, m, size) {
  await stage(page, 'List', size);
  await untilAtRest(page);
  const kit = await page.evaluate(() => window.__lp.readList());
  const top = await page.evaluate(() => window.__lp.readTop());
  const checks = geometryChecks(m, kit, top);
  const bad = judge(where, checks);
  console.log(`${where} geometry: ${checks.length} checks, ${bad.length} differ`);
  report.engines[where].geometry = { kit, top: { head: top.head, rows: top.rows, levels: top.levels, ansi: top.ansi, long: top.long } };
}

async function sectionFind(page, where, m, size) {
  await stage(page, 'Find', size);
  const read = () => page.evaluate(() => window.__lp.findState());
  const states = { rest: await read() };
  await page.fill(INPUT, 'request');
  await sleep(500);
  states.match = await read();
  await page.fill(INPUT, 'zzzzqq');
  await sleep(500);
  states.none = await read();
  await page.click('[data-probe-stage] button[aria-label="Use regular expression"]');
  await page.fill(INPUT, '(');
  await sleep(500);
  states.invalid = await read();
  await page.fill(INPUT, '');
  await sleep(500);
  states.empty = await read();
  const { checks, moved } = findChecks(m, states);
  const bad = judge(where, checks);
  console.log(`${where} find: ${checks.length} checks, ${bad.length} differ; the most any control moved: ${Math.max(...Object.values(moved))} px`);
  report.engines[where].find = { states, moved };

  // Enter, Shift+Enter and Escape in the field, against the mock's own.
  await page.click('[data-probe-stage] button[aria-label="Use regular expression"]');
  await page.fill(INPUT, 'request');
  await sleep(500);
  await page.focus(INPUT);
  const where2 = () => page.evaluate(() => window.__lp.where());
  const keys = [{ key: '(typed request)', ...(await where2()) }];
  for (const key of ['Enter', 'Enter', 'Enter', 'Shift+Enter', 'Shift+Enter']) {
    await page.keyboard.press(key);
    await sleep(350);
    keys.push({ key, ...(await where2()) });
  }
  for (const key of ['Escape', 'Escape']) {
    await page.keyboard.press(key);
    await sleep(350);
    keys.push({ key, value: await page.inputValue(INPUT), ...(await where2()) });
  }

  const refKeys = [...m.find.keys.enter, ...m.find.keys.escape].slice(0, keys.length);
  const keyChecks = [];
  refKeys.forEach((ref, index) => {
    const got = keys[index];
    keyChecks.push(equal(`find.keys.${ref.key}.${index}.lane`, ref.lane, got.lane));
    keyChecks.push(equal(`find.keys.${ref.key}.${index}.current`, ref.current, got.current));
    keyChecks.push(equal(`find.keys.${ref.key}.${index}.focus`, ref.activeElement.startsWith('input') ? 'input' : ref.activeElement.startsWith('table') ? 'grid' : ref.activeElement, got.activeElement));
  });

  // The find chord from the list: ⌘F on macOS, Ctrl+Shift+F elsewhere (the part decides by the platform) takes the focus to the field and selects what it holds. Each chord is pressed from the
  // list: the one of the platform must take the field, and it must select the text, so that the next key replaces it.
  await page.fill(INPUT, 'request');
  await sleep(300);
  const taken = [];
  for (const chord of ['Meta+f', 'Control+Shift+f']) {
    await page.focus(GRID);
    await page.keyboard.press(chord);
    await sleep(150);
    taken.push(await page.evaluate(() => {
      const input = document.querySelector('[data-probe-stage] input[type="search"]');
      return { focused: document.activeElement === input, selected: input.value !== '' && input.selectionStart === 0 && input.selectionEnd === input.value.length };
    }));
  }
  await page.fill(INPUT, '');
  await sleep(300);
  keyChecks.push(equal('find.chord.delivered', true, taken.some((entry) => entry.focused)));
  keyChecks.push(equal('find.chord.selected', true, taken.filter((entry) => entry.focused).every((entry) => entry.selected)));
  const badKeys = judge(where, keyChecks);
  console.log(`${where} find keys: ${keyChecks.length} checks, ${badKeys.length} differ`);
  report.engines[where].findKeys = keys;
}

async function sectionKeys(page, where, m, size) {
  await stage(page, 'Keys', size);
  const sel = m.selected;
  const where2 = () => page.evaluate(() => window.__lp.where());
  const checks = [];

  // The Tab stops, in order, from the field to the first stop outside the log: the field, the toggles and steps (one stop: the group is a roving row), the level choice (one stop), the list (one
  // stop), and then the page. The whole sequence is compared, the stop that leaves the log included, so a stop added after the list is a stop too many; and the same going back.
  const stopsFrom = async (key) => {
    const stops = [await page.evaluate(() => window.__lp.describeFocus())];
    for (let step = 0; step < 8 && stops.at(-1)?.inLog; step += 1) {
      await page.keyboard.press(key);
      await sleep(60);
      stops.push(await page.evaluate(() => window.__lp.describeFocus()));
    }

    return stops;
  };
  const named = (stops) => stops.filter((stop) => stop?.inLog).map((stop) => [stop.role, stop.name]);
  await page.focus(INPUT);
  const forward = await stopsFrom('Tab');
  checks.push(equal('keys.tabStops', TAB_STOPS, named(forward)));
  checks.push(equal('keys.tabStops.leaves', false, forward.at(-1)?.inLog ?? null));
  await page.focus(GRID);
  const backward = await stopsFrom('Shift+Tab');
  checks.push(equal('keys.shiftTab', [...TAB_STOPS].reverse(), named(backward)));
  checks.push(equal('keys.shiftTab.leaves', false, backward.at(-1)?.inLog ?? null));

  // The roving row: Right moves between the four buttons without leaving the group, and the level choice: an arrow chooses.
  await page.focus('[data-probe-stage] button[aria-label="Match case"]');
  await page.keyboard.press('ArrowRight');
  await sleep(60);
  checks.push(equal('keys.rove.ArrowRight', 'Use regular expression', await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))));
  await page.focus('[data-probe-stage] [role="radiogroup"] [role="radio"][aria-checked="true"]');
  await page.keyboard.press('ArrowRight');
  await sleep(150);
  checks.push(equal('keys.seg.ArrowRight', 'Info+', await page.evaluate(() => document.querySelector('[data-probe-stage] [role="radio"][aria-checked="true"]')?.textContent)));
  await page.click('[data-probe-stage] [role="radio"]:first-child');
  await sleep(150);

  // In the list, with real keys, from a click on the middle row.
  const start = async (at) => {
    await page.evaluate(() => { window.__lp.parts().grid.scrollTop = window.__lp.parts().grid.scrollHeight; });
    await sleep(250);
    const point = await page.evaluate((n) => window.__lp.rowPoint(n), at);
    if (point === null) throw new Error(`row ${at} has no part inside the list to press`);
    await page.mouse.click(point.x, point.y);
    await sleep(200);
  };

  for (const [name, entry] of Object.entries(sel.keys)) {
    const at = entry.startAt === 'last' ? sel.sessionStartRows : entry.startAt === 'middle' ? sel.click.middle : null;
    if (at !== null) await start(at);
    const key = name.split(' ')[0];
    await page.keyboard.press(key);
    await sleep(350);
    const got = await where2();
    checks.push(equal(`keys.${name}.activeN`, entry.after.activeN, got.activeN));
    checks.push(equal(`keys.${name}.view`, [entry.after.view.firstN, entry.after.view.lastN], [got.firstN, got.lastN]));
    checks.push(equal(`keys.${name}.follow`, entry.after.follow, got.follow));
  }

  // The list has focus after a click, and is the log's one tab stop.
  checks.push(equal('keys.focusAfterClick', 'grid', (await where2()).activeElement));
  const bad = judge(where, checks);
  console.log(`${where} keys: ${checks.length} checks, ${bad.length} differ`);
}

async function sectionCopy(page, where, m, size) {
  await stage(page, 'Keys', size);
  await page.evaluate(() => window.__lp.watchCopy());
  const start = async (n) => {
    await page.evaluate(() => { window.__lp.parts().grid.scrollTop = window.__lp.parts().grid.scrollHeight; });
    await sleep(250);
    const point = await page.evaluate((row) => window.__lp.rowPoint(row), n);
    if (point === null) throw new Error(`row ${n} has no part inside the list to press`);
    await page.mouse.click(point.x, point.y);
    await sleep(150);
    return point;
  };
  const checks = [];
  const copies = async (modifier) => {
    await page.evaluate(() => { window.__copies = []; });
    await page.keyboard.press(`${modifier}+c`);
    await sleep(250);
    return page.evaluate(() => window.__copies);
  };
  const bothChords = async () => [...(await copies('Control')), ...(await copies('Meta'))];

  // One selected line, copied with the chord of each platform (the copy event is the engine's: it fires from the focused list with no text selected).
  await start(98);
  for (const modifier of ['Control', 'Meta']) {
    const events = await copies(modifier);
    // The engine takes one chord as its own `copy` and ignores the other: at least one of the two must deliver, and every one that does must be right.
    for (const event of events) {
      checks.push(equal(`copy.${modifier}.types`, ['text/plain'], event.types));
      checks.push(equal(`copy.${modifier}.plain`, copyLine(98), event.plain));
      checks.push(equal(`copy.${modifier}.prevented`, true, event.prevented));
    }
    if (events.length > 0) checks.push(equal(`copy.${modifier}.once`, 1, events.length));
  }

  const events = await bothChords();
  checks.push(equal('copy.delivered', true, events.length > 0));

  // A range: click row 96, Shift+click row 98, copy: rows 96, 97 and 98, in that order, a line each, exactly (the escape sequence of line 4 is not in them, and there is no markup).
  await start(96);
  const last = await page.evaluate(() => window.__lp.rowPoint(98));
  if (last === null) throw new Error('row 98 has no part inside the list to press');
  await page.keyboard.down('Shift');
  await page.mouse.click(last.x, last.y);
  await page.keyboard.up('Shift');
  await sleep(150);
  const range = (await bothChords()).filter((event) => event.plain !== null);
  checks.push(equal('copy.range.delivered', true, range.length > 0));
  for (const event of range) {
    checks.push(equal('copy.range.payload', [96, 97, 98].map(copyLine).join('\n'), event.plain));
    checks.push(equal('copy.range.noEscape', false, event.plain.includes('\u001b')));
    checks.push(equal('copy.range.noMarkup', null, event.html === '' ? null : event.html));
  }

  // The line with an ANSI span (line 4): the text without the escape sequence.
  await page.evaluate(() => { window.__lp.parts().grid.scrollTop = 0; });
  await sleep(300);
  const ansiPoint = await page.evaluate(() => window.__lp.rowPoint(4));
  if (ansiPoint === null) throw new Error('row 4 has no part inside the list to press');
  await page.mouse.click(ansiPoint.x, ansiPoint.y);
  await sleep(150);
  const ansi = (await bothChords()).filter((event) => event.plain !== null);
  checks.push(equal('copy.ansi.delivered', true, ansi.length > 0));
  for (const event of ansi) checks.push(equal('copy.ansi.plain', copyLine(4), event.plain));

  // Text the reader selected inside a row is the browser's to copy, even while a row is selected: the log neither prevents the event nor puts its own text on it. The selection is made as the
  // reader makes it, by dragging over the words of row 98 (the press selects the row: the click that follows a drag in one row), and the copy chord is pressed as before.
  await start(98);
  const begin = await page.evaluate(() => window.__lp.textStart(98));
  if (begin === null) throw new Error('row 98 has no part inside the list to press');
  await page.mouse.move(begin.x, begin.y);
  await page.mouse.down();
  await page.mouse.move(begin.x + 48, begin.y, { steps: 6 });
  await page.mouse.up();
  await sleep(150);
  const dragged = await page.evaluate(() => ({ text: window.getSelection()?.toString() ?? '', selected: window.__lp.where().selected }));
  checks.push(equal('copy.native.selection', true, dragged.text.length >= 3 && MESSAGE_98.includes(dragged.text)));
  checks.push(equal('copy.native.rowSelected', [98], dragged.selected));
  const native = await bothChords();
  checks.push(equal('copy.native.delivered', true, native.length > 0));
  for (const event of native) {
    checks.push(equal('copy.native.prevented', false, event.prevented));
    checks.push(equal('copy.native.plain', '', event.plain));
    checks.push(equal('copy.native.types', [], event.types));
  }

  const bad = judge(where, checks);
  console.log(`${where} copy: ${checks.length} checks, ${bad.length} differ`);
  report.engines[where].copy = { events: events.length, range: range.length, ansi: ansi.length, native: native.length, dragged: dragged.text };
}

async function sectionAxe(page, where, size) {
  await page.addScriptTag({ path: AXE });
  const run = (include) => page.evaluate(async (scope) => {
    const result = await axe.run({ include: scope }, { resultTypes: ['violations'] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, where: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  }, include);
  const found = {};
  // The staged log at rest, with matches (the lane, the marks and the current row), with a selection, and with the invalid pattern.
  await stage(page, 'Find', size);
  found.rest = await run([['[data-probe-stage]']]);
  await page.fill(INPUT, 'request');
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(350);
  found.matches = await run([['[data-probe-stage]']]);
  await page.fill(INPUT, 'zzzzqq');
  await sleep(500);
  found.none = await run([['[data-probe-stage]']]);
  await page.click('[data-probe-stage] button[aria-label="Use regular expression"]');
  await page.fill(INPUT, '(');
  await sleep(500);
  found.invalid = await run([['[data-probe-stage]']]);
  await page.fill(INPUT, '');
  await page.click('[data-probe-stage] button[aria-label="Use regular expression"]');
  await stage(page, 'Keys', size);
  const point = await page.evaluate(() => window.__lp.rowPoint(98));
  if (point === null) throw new Error('row 98 has no part inside the list to press');
  await page.mouse.click(point.x, point.y);
  await sleep(200);
  found.selected = await run([['[data-probe-stage]']]);
  // Every log example of the parts page (the states: connecting, waiting, paused, ended, failed with and without lines, dropped lines, long lines), not staged. An example mounts its
  // log when it comes near the screen: each is brought into view and audited only once its log is there, and an example whose log never mounts is a failure that names it (an audit of the
  // figure around it would find nothing to fault).
  await page.evaluate(() => document.querySelectorAll('[data-probe-stage]').forEach((el) => el.removeAttribute('data-probe-stage')));
  const names = await page.evaluate(() => [...document.querySelectorAll('[data-example^="LogView"]')].map((el) => el.getAttribute('data-example')));
  const checks = [];
  for (const name of names) {
    await page.evaluate((n) => document.querySelector(`[data-example="${n}"]`)?.scrollIntoView({ block: 'center' }), name);
    try {
      await page.waitForSelector(`[data-example="${name}"] [role="group"][aria-label^="Log, "]`, { timeout: 5000 });
    } catch {
      fail(where, `axe: the example ${name} never mounted its log`);
      continue;
    }

    await sleep(300);
    found[`example ${name}`] = await run([[`[data-example="${name}"]`]]);
  }

  // One check a state: the serious and critical violations it has, as words (none is the pass).
  const wording = (violations) => violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => `${violation.impact} ${violation.id} on ${violation.nodes} node(s): ${violation.help} ${JSON.stringify(violation.where)}`);
  for (const [state, violations] of Object.entries(found)) checks.push(equal(`axe.${state.replace(/\s+/g, '.')}`, [], wording(violations)));
  const bad = judge(where, checks);
  console.log(`${where} axe: ${Object.entries(found).map(([state, v]) => `${state} ${v.length}`).join(', ')}; states with a serious or critical violation: ${bad.length}`);
  report.engines[where].axe = found;
}

// The mock's Source column, measured in WebKit and Chromium at 1440 x 900 (they agree) by docs/ui-next/status/L2/mock-sources-measure.mjs.txt (mock tree c8e44a44; its output is docs/ui-next/status/L2/mock-sources.json): the cell
// is 168 px (the head with it); the chip stands 10 px into it (the cell's inset) and 3 px under the row's top, and is 18 px high; its name starts 19 px into it (the 1 px edge, the 6 px inset, the 8 px swatch and the 4 px gap); the
// swatch is 8 x 8 with a 2 px radius; a name that does not fit fills the cell (a chip 148 px wide).
const MOCK_SOURCE = { heads: [112, 96, 168], chipX: 10, chipY: 3, chipH: 18, nameX: 19, swatch: '8px', radius: '2px', cutChip: 148 };
const STAGED = '[data-probe-stage]';
const CUT_NAME = 'orders-7d8c6f49b-f8q4m/init-migrations';

/** The one tooltip of the window, as text while it is open and null while it is not (the tooltip probe reads it the same way). */
const openTip = (page) => page.evaluate(() => { const host = document.querySelector('[role="tooltip"]'); return host !== null && host.matches(':popover-open') ? host.textContent : null; });

/** The `Sources` fixture of the parity examples (LogView.parity.examples.tsx: the list scenario's 90 lines written by three sources in turn), staged at the size of the mock's Logs tool, where the column is on screen. */
async function sectionSources(page, where, size) {
  await stage(page, 'Sources', size);
  const read = await page.evaluate((selector) => {
    const r2 = (v) => Math.round(v * 100) / 100;
    const grid = document.querySelector(`${selector} [role="grid"]`);
    const heads = [...grid.querySelectorAll('[role="columnheader"]')];
    const sources = new Map();
    for (const row of grid.querySelectorAll('[role="row"][data-n]')) {
      const cells = row.querySelectorAll('[role="gridcell"]');
      const chip = cells[2]?.firstElementChild;
      const name = chip?.firstElementChild;
      if (cells.length !== 4 || !chip || !name) continue;
      const full = name.getAttribute('data-ov-full') ?? name.textContent;
      if (sources.has(full)) continue;
      const box = row.getBoundingClientRect();
      const cell = cells[2].getBoundingClientRect();
      const c = chip.getBoundingClientRect();
      const swatch = getComputedStyle(chip, '::before');
      sources.set(full, { full, cut: name.scrollWidth > name.clientWidth, chipX: r2(c.left - cell.left), chipY: r2(c.top - box.top), chipH: r2(c.height), chipW: r2(c.width), nameX: r2(name.getBoundingClientRect().left - c.left), swatch: [swatch.width, swatch.height, swatch.borderTopLeftRadius], hue: chip.getAttribute('data-ov-hue') });
    }

    return { heads: heads.map((h) => h.textContent), widths: heads.map((h) => r2(h.getBoundingClientRect().width)), colcount: grid.getAttribute('aria-colcount'), sources: [...sources.values()] };
  }, STAGED);
  const wantNames = ['app', 'sidecar', CUT_NAME];
  const number = (id, mock, kit, tol) => ({ id, kind: 'number', mock, kit, tol });
  const checks = [
    equal('sources.heads', ['Time', 'Level', 'Source', 'Message'], read.heads),
    equal('sources.colcount', '4', read.colcount),
    equal('sources.head.widths', MOCK_SOURCE.heads, read.widths.slice(0, 3)),
    equal('sources.names', wantNames, read.sources.map((s) => s.full)),
    equal('sources.hues', ['blue', 'green', 'amber'], read.sources.map((s) => s.hue)),
    equal('sources.cut', [false, false, true], read.sources.map((s) => s.cut)),
  ];
  for (const s of read.sources) {
    const id = s.full === CUT_NAME ? 'cut' : s.full;
    checks.push(number(`sources.chip.${id}.x`, MOCK_SOURCE.chipX, s.chipX, 1), number(`sources.chip.${id}.y`, MOCK_SOURCE.chipY, s.chipY, 0.5), number(`sources.chip.${id}.height`, MOCK_SOURCE.chipH, s.chipH, 0.5), number(`sources.chip.${id}.nameX`, MOCK_SOURCE.nameX, s.nameX, 1));
    checks.push(equal(`sources.swatch.${id}`, [MOCK_SOURCE.swatch, MOCK_SOURCE.swatch, MOCK_SOURCE.radius], s.swatch));
  }

  const cut = read.sources.find((s) => s.full === CUT_NAME);
  checks.push(number('sources.cut.chipWidth', MOCK_SOURCE.cutChip, cut?.chipW ?? 0, 1));
  // A real hover: the pointer is moved to the middle of the name of the row nearest the middle of the list (a row at the top of the list may be under its sticky head), by its box and not by `page.hover`, which would scroll
  // the list to reveal a name that is half covered, and the scroll of the list that holds a name cancels its tip (the host's rule). The tip opens 500 ms after the pointer arrives.
  const hover = async (inRow) => {
    await page.mouse.move(0, 0);
    await sleep(300);
    const target = await page.evaluate(([selector, within]) => {
      const grid = document.querySelector(`${selector} [role="grid"]`);
      const list = grid.getBoundingClientRect();
      let best = null;
      for (const row of grid.querySelectorAll('[role="row"][data-n]')) {
        const element = row.querySelector(within);
        if (element === null) continue;
        const box = element.getBoundingClientRect();
        const distance = Math.abs(box.top + box.height / 2 - (list.top + list.height / 2));
        if (best === null || distance < best.distance) best = { x: box.left + box.width / 2, y: box.top + box.height / 2, distance };
      }

      return best;
    }, [STAGED, inRow]);
    if (target === null) return `no row with ${inRow}`;
    await page.mouse.move(target.x, target.y, { steps: 3 });
    await page.waitForFunction(() => { const host = document.querySelector('[role="tooltip"]'); return host !== null && host.matches(':popover-open'); }, null, { timeout: 2500 }).catch(() => undefined);
    return openTip(page);
  };
  const cutTip = await hover(`[data-ov-full="${CUT_NAME}"]`);
  const fitTip = await hover('[data-ov-clip]:not([data-ov-full])');
  await page.mouse.move(0, 0);
  await sleep(300);
  checks.push(equal('sources.tip.cut', CUT_NAME, cutTip), equal('sources.tip.fits', null, fitTip));
  const bad = judge(where, checks);
  console.log(`${where} sources: ${checks.length} checks, ${bad.length} differ`);
  report.engines[where].sources = read;
}

// ---------------------------------------------------------------------------------------------------------------------------
const dist = buildUiNext();
const { server, partsUrl } = await serve(dist);

/** One pass over every engine and viewport asked for, into a fresh report (a negative control makes two: without its perturbation and with it). */
async function runAll() {
  report = freshReport();
  used = new Set();
  for (const engineName of engineNames) {
    const browser = await launch(engineName);
    try {
      for (const viewportName of viewportNames) {
        const where = `${engineName}/${viewportName}`;
        report.engines[where] = {};
        const m = mock.data[engineName]?.[viewportName];
        if (m === undefined) {
          fail(where, `mock-log.json has no measurement for ${where}`);
          continue;
        }

        const size = [m.list.tool.abs[2], m.list.tool.abs[3]];
        const context = await browser.newContext({ viewport: VIEWPORTS[viewportName], deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' });
        const errors = [];
        try {
          const page = await load(context, partsUrl, errors);
          for (const [name, run] of [
            ['geometry', () => sectionGeometry(page, where, m, size)],
            ['find', () => sectionFind(page, where, m, size)],
            ['keys', () => sectionKeys(page, where, m, size)],
            ['copy', () => sectionCopy(page, where, m, size)],
            ['sources', () => sectionSources(page, where, size)],
            ['axe', () => sectionAxe(page, where, size)],
          ]) {
            if (!wanted(name)) continue;
            try {
              await run();
            } catch (error) {
              fail(where, `${name} threw: ${String(error.message).split('\n')[0]}`);
            }
          }

          if (SHOTS) {
            await stage(page, 'List', size);
            await page.screenshot({ path: path.join(SHOTS, `log-${engineName}-${viewportName}.png`), clip: { x: 0, y: 0, width: size[0], height: size[1] } });
          }
        } finally {
          await context.close();
        }

        for (const error of errors) fail(where, `page error: ${error}`);
      }
    } finally {
      await browser.close();
    }
  }
}

/** A failure that is the run's own, not a reading's: a section that threw, a page that failed or logged an error. A negative control never counts one as seeing its perturbation. */
const isSetupError = (failure) => / threw: /.test(failure.id) || /^page error: /.test(failure.id);

/** What a negative control shows, from the pass without its perturbation and the pass with it: the problems that keep it from being a detection (none: detected). */
function controlProblems(control, baseline, injected) {
  const problems = [];
  const own = (key) => control.expect.test(key.slice(key.indexOf(' ') + 1));
  const made = Object.entries(baseline.evaluated).filter(([key]) => own(key));
  for (const failure of baseline.failures.filter(isSetupError)) problems.push(`setup error without the perturbation: ${failure.where} ${failure.id}`);
  if (made.length === 0) problems.push(`the assertion ${control.expect} was not made without the perturbation`);
  for (const [key, outcome] of made) if (outcome !== 'agree') problems.push(`the assertion does not pass without the perturbation: ${key} (${outcome})`);
  for (const failure of injected.failures.filter(isSetupError)) problems.push(`setup error with the perturbation: ${failure.where} ${failure.id}`);
  const hits = injected.failures.filter((failure) => control.expect.test(failure.id) && (control.says === undefined || JSON.stringify(failure.kit ?? '').includes(control.says)));
  if (hits.length === 0) problems.push(`the perturbed run did not fail ${control.expect}${control.says === undefined ? '' : ` with "${control.says}"`}`);
  return { problems, hits };
}

try {
  if (CONTROL === '') {
    await runAll();
  } else {
    const control = CONTROLS[CONTROL];
    perturb = false;
    await runAll();
    const baseline = report;
    perturb = true;
    await runAll();
    const { problems, hits } = controlProblems(control, baseline, report);
    for (const failure of report.failures.slice(0, 20)) console.log(`DIFF ${failure.where} ${failure.id}${failure.mock === undefined ? '' : `: mock ${JSON.stringify(failure.mock)} kit ${JSON.stringify(failure.kit)}`}`);
    console.log(problems.length === 0 ? `detected: ${CONTROL} fails ${hits[0].id} (${hits[0].where}) and the same assertion passes without it` : `NOT DETECTED: ${CONTROL}\n  ${problems.join('\n  ')}`);
    process.exitCode = problems.length === 0 ? 0 : 1;
  }
} finally {
  server.close();
}

if (CONTROL === '') {
  const fullRun = only === null && !process.env.ENGINES && !process.env.VIEWPORTS;
  if (fullRun) {
    for (const deviation of KNOWN_DEVIATIONS) {
      if (!used.has(deviation.id)) {
        report.unusedDeviations.push(deviation.id);
        console.log(`UNUSED deviation ${deviation.id}: nothing differs any more; delete it`);
      }
    }
  }

  if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(report)}\n`);
  for (const failure of report.failures.slice(0, 80)) {
    console.log(`DIFF ${failure.where} ${failure.id}${failure.mock === undefined ? '' : `: mock ${JSON.stringify(failure.mock)} kit ${JSON.stringify(failure.kit)}`}`);
  }

  if (report.failures.length > 0 || report.unusedDeviations.length > 0) {
    console.log(`${report.failures.length} failure(s), ${report.deviations.length} known deviation(s) seen`);
    process.exitCode = 1;
  } else {
    console.log(`no difference from the mock, no failure (${report.deviations.length} known deviation(s) seen)`);
  }
}

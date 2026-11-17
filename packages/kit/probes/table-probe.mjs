// Probes the kit's DataTable against the design mock's table, in WebKit and Chromium at 1440 x 900 and 1030 x 720: the parity probe of the
// table. Its reference is mock-table.json (made by mock-table-measure.mjs, which says how a record reads, and certified by
// generate-reference.mjs, which writes where it came from into the file); kit-probe.mjs does the same for the parts.
//
//   node packages/kit/probes/table-probe.mjs      # builds the kit and ui-next (OMNIVIEW_UI=next) into a temp dir, serves it, probes it
//
//   DIST=<dir>                 probe an existing ui-next build instead of building the kit and ui-next (the page imports the BUILT kit)
//   ENGINES=webkit,chromium    VIEWPORTS=1440x900,1030x720      (defaults: both of each)
//   ONLY=<regex>               only the mock cases whose id matches: line-plain-comfortable, pods-narrow-compact, cell-identity, ...
//   REPORT=<file>              write the full report as JSON
//   SHOTS=<dir>                a screenshot of every staged fixture
//   NEGATIVE_CONTROL=<name>    perturb ONE measured value in the page (header-colour, row-height, cell-padding or header-ink): the probe must fail
//                              and name the value. It prints "detected" and exits 1 when it did; "NOT DETECTED" and exit 2 when it did not.
//                              Run it after changing this file: a probe that cannot fail proves nothing.
//   FONT_DELAY_MS=40           serve every font file that late (serve.mjs): what a runner does, which a local server hides
//
// What it compares. Every fixture is a kit example of DataTable.parity.examples.tsx (the parts page shows them): the data, the columns and
// the widths of one case of the mock's own measurement. The probe stages the example the way the mock stages a table (a full-screen stage
// with 40 px of padding and the width the mock's table had), waits for the real fonts (the kit's Inter and JetBrains Mono against the mock's
// own, with the same advances: nothing is normalized; the table measures its text again when the fonts are loaded), sets the density of the case (`data-ov-density` on <html>), and records the table
// with the SAME page-side functions the mock was recorded with (probe-lib.installRecordLib). Both records are then compared as what the
// DOM looks like:
//
//   header      the cells of the header row: rectangle, colours, border, padding, font, alignment, clip, sticky offsets, the sort button
//               and its arrow, `aria-sort`; the height of the header row (25 px, 23 compact)
//   rows        the rectangles of the rows and their cells (24 px, 40 px with two lines, 2 px less compact; a row far down is scrolled to
//               first: the kit mounts a window of rows), their styles, the text of a cell and where it sits
//   selection   the column (cell geometry, the 24 px target), the control in rest, hover and focus, and the 16 px mark (`marks`)
//   sort        the header button of an inactive, an ascending and a descending column in rest, hover and focus
//   states      hover over a row, a selected row while the table has focus and while it has not, and a selected row under the pointer
//   sticky      the header after the region scrolled by 300 px: where it sits, what is under it, which row is below it
//   cells       the cut name and the identifier held at 268 px: the clip, the width the fit gives the identity column, the kept end
//   themes      in each of the nine themes the colours the table paints are the roles of the token table (read from the theme itself)
//
// Heights and y offsets are the mock's, to half a pixel (its own runs assert they are the same in both engines and at both viewports);
// widths and x offsets, which follow the text measure, to one pixel. Every string (colours, border, padding, font, alignment, overflow,
// cursor, outline, position) must be equal. A colour is the computed colour, named in the report by the token roles that resolve to it
// (mock-table.json `colorTokens`; the kit's roles read from its own theme). A hover paint is compared as what it paints (a tint over the
// plane), not as the property that carries it.
//
// The probe reads no spacer row, no class name and no element type except through roles and `aria-rowindex`: rows are found by
// `aria-rowindex`, cells by `td`, `th` or their roles, controls by their roles, so a change of the row layout needs a new
// KNOWN_DEVIATIONS where it changes a value on purpose, not a new probe. Exit code 1 when anything outside KNOWN_DEVIATIONS differs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandCase } from './mock-table-measure.mjs';
import { ENGINES, VIEWPORTS, awaitFonts, buttonStates, installRecordLib, launch, measure, setContext, settle, sleep } from './probe-lib.mjs';
import { buildUiNext, serve } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const data = JSON.parse(readFileSync(path.join(here, 'mock-table.json'), 'utf8'));
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(VIEWPORTS).join(',')).split(',');
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const fullRun = !only && !process.env.ENGINES && !process.env.VIEWPORTS;
const SHOTS = process.env.SHOTS;
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** px. Heights and y offsets are the mock's own (its run asserts they do not depend on the engine); widths and x follow the text measure. */
const TOL = { x: 1, y: 0.5, w: 1, h: 0.5 };

// ---------------------------------------------------------------------------------------------------------------------------
// What differs on purpose, each with its reason. A deviation not listed here fails the probe. An entry matches a deviation by the case
// (`cases`), the engine and viewport (`runs`), the path of the value (`path`: `<section>.<index>.<value>`, as the report prints it) and,
// when the same path also carries a defect, the two values (`when(mock, kit)`). An entry that matches nothing in a full run is reported
// as unused, so a deviation that was fixed does not stay listed.
const KNOWN_DEVIATIONS = [
  {
    id: 'rows-are-not-tab-stops',
    path: /^rows\.\d+\.tabindex$/,
    when: (mock, kit) => mock === '0' && kit === undefined,
    reason: 'The mock\'s actionable rows are Tab stops (tr tabindex=0, 89 stops in the Pods list). The kit\'s rows are not: a row\'s action is exposed in a control and the scroll region is the one stop (plan E5; 1a.3 status, finding 1). The ring of keyboard focus is compared on the region (states.focus.ring).',
  },
  {
    id: 'selection-needs-its-column',
    cases: /^line-(plain|bounded|inspect)/,
    path: /^rows\.[12]\.td\.\d+\.fill$/,
    reason: 'The mock\'s line fixture paints rows 1 and 2 selected without a selection column (`sel`). In the kit a row is selected only through its selection column, so these rows are not selected there; the selected paint is compared on the lists that have the column (line-selection, pods-narrow).',
  },
  {
    id: 'one-sort-at-a-time',
    cases: /^line-/,
    path: /^th\.\d+\.aria-sort$/,
    when: (mock, kit) => mock === 'descending' && kit === 'none',
    reason: 'The mock\'s line fixture sorts two columns at once (Name ascending, Status descending); the kit has one sort, so its Status column is `none`. The descending state is compared on the lists that sort by a click (pods-narrow).',
  },
  {
    id: 'one-sort-at-a-time',
    cases: /^line-/,
    path: /^th\.\d+\.arrow$/,
    when: (mock, kit) => mock === 'present' && kit === 'absent',
    reason: 'See one-sort-at-a-time: the Status column carries no arrow in the kit.',
  },
  {
    id: 'one-sort-at-a-time',
    cases: /^line-/,
    path: /^th\.\d+\.sortButton\.r\.w$/,
    when: (mock, kit) => mock - kit === 16,
    reason: 'See one-sort-at-a-time: without its arrow (a 12 px glyph and a 4 px gap) the Status button is 16 px narrower.',
  },
  {
    id: 'one-sort-at-a-time',
    cases: /^line-/,
    path: /^sticky\.hit$/,
    when: (mock, kit) => mock === 'button' && kit === 'th',
    reason: 'See one-sort-at-a-time: the point the mock tests, the middle of the Status header, is on its button there (button plus arrow) and beside the narrower button in the kit.',
  },
  {
    id: 'glyph-without-wrapper',
    path: /^sort\.\w+\.button\.(rest|hover|focus)\.elements$/,
    when: (mock, kit) => mock - kit === 1,
    reason: 'The mock draws a glyph in a span.ic that holds the svg; the kit\'s glyph is the svg itself (kit-probe.mjs lists the same difference): one element fewer.',
  },
  {
    id: 'native-checkbox',
    path: /^selectionCommand\.(rest|hover|focus)\.(border|color|elements|font|gap|layout)$/,
    reason: 'The kit\'s selection control is a native checkbox, the mock\'s a button that holds a span.cb. Its own colour, font, gap and layout are the browser\'s and draw nothing; the mark is drawn from tokens (marks.*, compared) and the box, background, radius, cursor, padding and ring are compared.',
  },
  {
    id: 'managed-column-header',
    cases: /^pods-/,
    path: /^th\.\d+\.pad$/,
    when: (mock) => mock === '0px 24px 0px 10px',
    reason: 'The header cells of the mock\'s Pods list reserve 24 px at their end for the column menu of a managed column (`column-header`). The kit table has no managed columns, no column menu and no resize handle yet.',
  },
  {
    id: 'managed-column-header',
    cases: /^pods-/,
    path: /^th\.\d+\.arrow$/,
    when: (mock, kit) => mock === 'present' && kit === 'absent',
    reason: 'See managed-column-header: a text column of the mock\'s Pods list holds, beside its sort button, a resize handle and a sort arrow that is there at rest with opacity 0 and appears under the pointer; the kit\'s header cell holds an arrow only on the column that is sorted.',
  },
  {
    id: 'identifier-ends-with-an-ellipsis',
    cases: /^cell-identifier$/,
    path: /^rows\.\d+\.td\.\d+\.identifierText\.clip$/,
    when: (mock, kit) => mock === 0 && kit === 1,
    reason: 'The mock cuts an identifier in the middle with its own two halves (prefix and suffix, sized by its own measure), so its text box holds exactly what shows. The kit has no part for an identifier yet (MiddleEllipsis is the rule for names: a third of the name stays, 6 to 12 characters), so the fixture\'s text clips at its end with an ellipsis and its box holds more than shows.',
  },
];

/** What the probe does not compare, and why. Printed with every report. */
const NOT_COMPARED = [
  'z-index: the mock stacks a header cell at 1 or 3, the kit at 2 or 3; what stacking must do is compared by what is under the header after the region scrolled (sticky.hit).',
  'display, vertical-align, min and max width, box-sizing: how a cell is laid out is not how it looks; where its content ends up is compared (rectangles, text positions).',
  'class names, the hashed CSS Module classes, `data-ov-*` attributes and the mock\'s `data-action`, `data-tooltip` and `data-column-*`: implementation.',
  'tooltips (`data-tooltip`, `data-tooltip-clip`): the table gives no cell a tip; the consumer marks its own cell content (`tip()`, `data-ov-clip`), as the mock marks its spans.',
  'the text inside a cell\'s own spans (a monospaced ready count): the cell\'s box is compared and the span is not a named part; the fonts are the real ones on both sides, so a width that differs shows in the rectangle.',
  'the middle cut of an identifier (the prefix and suffix halves, `--identifier-prefix-size`, the mock\'s measure): the kit has no part for an identifier; the cut of a NAME is compared (the halves, their clip, colour and font, and where the kept end sits).',
  'the shape of the check and dash glyphs inside the 16 px mark: the mock draws an 11 px svg, the kit draws with borders; their colour and the box and paint of the mark itself are compared.',
  'the text of the cells of the two-line list (its data are the fixture\'s, not the mock\'s), its wide column set (CPU and Memory metric cells), the mock\'s column menu and resize handles, row expansion and grouping. The mock\'s `cell-text` case (its Image cell is a clip slot, `.cell-clip`, which caps what its column asks for at 240 px in the mock\'s measure: base.css 1271) stays in mock-table.json and is not probed, because the kit has no clip slot; `cell-text-plain` (the same table with plain text cells) is.',
  'the 16 px mark\'s values come from the live mock (base.css `.cb::before`: 16 px, radius 4, island fill and --int-border-raised edge off, --int-accent on), because mock-table.json holds no pseudo-element.',
  'scroll region sizes and the page around the table (`wrap`, `scroll`): the page or the viewport sets them.',
];

// ---------------------------------------------------------------------------------------------------------------------------
// The cases: a mock case, the kit example that has its data, and what the mock recorded for it that the kit can be asked.
const LINE_STATES = { hoverRow: 4, plainRow: 5, selectedRows: [1, 2], checkRow: 7, tick: false };
const LIST_STATES = { hoverRow: 1, plainRow: 2, selectedRows: [0, 1], checkRow: 6, tick: true };
const CASES = [
  { id: 'line-plain-comfortable', example: 'LinePlain', density: 'comfortable', states: LINE_STATES },
  { id: 'line-plain-compact', example: 'LinePlain', density: 'compact', states: LINE_STATES },
  { id: 'line-selection-comfortable', example: 'LineSelection', density: 'comfortable', states: LINE_STATES },
  { id: 'line-inspect-comfortable', example: 'LineInspect', density: 'comfortable', states: LINE_STATES },
  { id: 'line-bounded-comfortable', example: 'LineBounded', density: 'comfortable' },
  { id: 'pods-narrow-comfortable', example: 'TwoLineList', density: 'comfortable', states: LIST_STATES, descend: true, sameText: false },
  { id: 'pods-narrow-compact', example: 'TwoLineListCompact', density: 'compact', states: LIST_STATES, descend: true, sameText: false },
  { id: 'cell-identity', example: 'IdentityCell', density: 'comfortable' },
  { id: 'cell-identifier', example: 'IdentifierCell', density: 'comfortable' },
  { id: 'cell-text-plain', example: 'TextCells', density: 'comfortable' },
];

// ---------------------------------------------------------------------------------------------------------------------------
// The page side. Runs in the browser and closes over nothing; `window.__rec` is probe-lib.installRecordLib (the mock's own node record).
function installKitLib() {
  const { r2, styleOf, nodeOf, elements, scrollerOf } = window.__rec;
  const frames = (n) => new Promise((resolve) => { let left = n; const tick = () => { left -= 1; if (left <= 0) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const CELL = 'td, th, [role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]';
  const ROW = 'tr, [role="row"]';
  const CONTROL = 'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]';
  const figure = (name) => document.querySelector(`[data-example="DataTableParity/${name}"]`);
  const tableOf = (name) => figure(name).querySelector('table, [role="table"], [role="grid"]');
  const indexOf = (row) => Number(row.getAttribute('aria-rowindex')) - 2;
  const isBody = (el) => el.matches(ROW) && indexOf(el) >= 0 && el.getAttribute('aria-hidden') !== 'true';
  const bodyRows = (table) => [...table.querySelectorAll('[aria-rowindex]')].filter(isBody);
  const headRowOf = (table) => [...table.querySelectorAll('[aria-rowindex="1"]')].find((el) => el.matches(ROW)) ?? table.querySelector('thead tr, [role="row"]');
  const cellsOf = (row) => [...row.children].filter((c) => c.matches(CELL));
  const labelOf = (th) => th.textContent.trim().replace(/\s+/g, ' ') || th.getAttribute('aria-label') || '';
  const sortButtonOf = (th) => [...th.querySelectorAll('button, [role="button"]')].find((b) => b.getAttribute('role') !== 'checkbox') ?? null;

  /** Every element below `root` with its depth, as the mock's walk does, and the part of a cell it is when the fixture names it. */
  const walkKit = (root, origin) => {
    const out = [];
    const visit = (el, depth) => {
      for (const c of el.children) {
        const n = nodeOf(c, origin);
        n.d = depth;
        const part = c.getAttribute('data-part');
        if (part) n.part = part;
        out.push(n);
        if (c instanceof SVGElement) { n.inner = c.querySelectorAll('*').length; continue; }
        visit(c, depth + 1);
      }
    };
    visit(root, 0);
    return out;
  };

  const stage = (name, width) => {
    for (const el of document.querySelectorAll('[data-probe-stage]')) { el.removeAttribute('data-probe-stage'); el.style.removeProperty('--probe-w'); }
    const fig = figure(name);
    if (!fig) throw new Error(`no example DataTableParity/${name}`);
    fig.setAttribute('data-probe-stage', '');
    fig.style.setProperty('--probe-w', `${width}px`);
  };

  /** The layout is settled when the table, the header and its columns are where they were three frames ago. */
  const stable = async (name) => {
    const table = tableOf(name);
    let last = '';
    let same = 0;
    for (let k = 0; k < 150 && same < 3; k += 1) {
      await frames(1);
      const head = headRowOf(table);
      const signature = [table.getBoundingClientRect().width, table.getBoundingClientRect().height, head?.getBoundingClientRect().height, cellsOf(head).map((c) => c.getBoundingClientRect().width).join(',')].join('|');
      same = signature === last ? same + 1 : 0;
      last = signature;
    }
    return same >= 3;
  };

  /** The row at logical index `i`: a row the window has not mounted is scrolled to, and waited for. */
  const mountRow = async (table, i) => {
    const find = () => bodyRows(table).find((r) => indexOf(r) === i);
    let row = find();
    if (row) return row;
    const scroller = scrollerOf(table);
    if (!scroller) return null;
    const count = Number(table.getAttribute('aria-rowcount')) - 1;
    const head = headRowOf(table).getBoundingClientRect().height;
    const rowHeight = (table.getBoundingClientRect().height - head) / count;
    scroller.scrollTop = Math.max(0, head + i * rowHeight - scroller.clientHeight / 2);
    for (let k = 0; k < 90 && !row; k += 1) { await frames(1); row = find(); }
    return row ?? null;
  };

  const cellRecord = (td, origin, head, kids) => {
    const n = nodeOf(td, origin);
    n.col = head ? labelOf(head) : '';
    n.n = elements(td);
    if (kids) { const k = walkKit(td, td.getBoundingClientRect()); if (k.length) n.k = k; }
    return n;
  };

  const capture = async (name, { rows, kids }) => {
    const table = tableOf(name);
    const scroller = scrollerOf(table);
    const origin = table.getBoundingClientRect();
    const headRow = headRowOf(table);
    const heads = cellsOf(headRow);
    const rec = {};
    rec.table = nodeOf(table, origin, { text: false });
    rec.headRow = nodeOf(headRow, origin, { text: false });
    rec.th = heads.map((th) => { const n = nodeOf(th, origin); n.col = labelOf(th); n.n = elements(th); const k = walkKit(th, th.getBoundingClientRect()); if (k.length) n.k = k; return n; });
    rec.colWidths = heads.map((th) => r2(th.getBoundingClientRect().width));
    rec.counts = { mounted: bodyRows(table).length, rowcount: table.getAttribute('aria-rowcount') };
    rec.rows = {};
    for (const i of rows) {
      const row = await mountRow(table, i);
      if (!row) { rec.rows[i] = null; continue; }
      const o = table.getBoundingClientRect();
      const n = nodeOf(row, o, { text: false });
      n.n = elements(row);
      n.td = cellsOf(row).map((td, j) => cellRecord(td, o, heads[j], kids.includes(i)));
      rec.rows[i] = n;
    }
    if (scroller) { scroller.scrollTop = 0; await frames(3); }
    return rec;
  };

  /** Scroll the region, read the header, put the scroll back (the mock's `sticky`, with the window of rows given time to mount). */
  const sticky = async (name, by) => {
    const table = tableOf(name);
    const scroller = scrollerOf(table);
    if (!scroller) return null;
    const before = scroller.scrollTop;
    scroller.scrollTop = by;
    await frames(4);
    const sb = scroller.getBoundingClientRect();
    const heads = cellsOf(headRowOf(table));
    const th = heads[Math.min(1, heads.length - 1)];
    const tb = th.getBoundingClientRect();
    const hit = document.elementFromPoint(tb.left + tb.width / 2, tb.top + tb.height / 2);
    const below = document.elementFromPoint(tb.left + tb.width / 2, tb.bottom + 2);
    const belowRow = below?.closest('[aria-rowindex]');
    const out = {
      asked: by, scrollTop: scroller.scrollTop,
      th: { s: styleOf(th) },
      headerTop: r2(tb.top - sb.top),
      hit: hit ? hit.tagName.toLowerCase() : null,
      rowBelowHeader: belowRow && isBody(belowRow) ? indexOf(belowRow) : null,
    };
    scroller.scrollTop = before;
    await frames(3);
    return out;
  };

  /** One header cell for the sort states: the aria the table writes on the cell and on its button. */
  const sortInfo = (name, label) => {
    const th = cellsOf(headRowOf(tableOf(name))).find((c) => labelOf(c) === label);
    const b = th ? sortButtonOf(th) : null;
    return th ? { thSort: th.getAttribute('aria-sort'), thLabel: th.getAttribute('aria-label'), buttonLabel: b?.getAttribute('aria-label') ?? null } : null;
  };

  /** One row's paint: the computed style of the row and each cell, with the pseudo-classes in effect. */
  const paint = (row) => {
    const wrap = scrollerOf(row);
    const control = row.querySelector(CONTROL);
    return {
      st: { row: styleOf(row), td: cellsOf(row).map(styleOf) },
      m: { hover: row.matches(':hover'), wrapFocusWithin: !!wrap?.matches(':focus-within'), sel: !!control && (control.checked === true || control.getAttribute('aria-checked') === 'true') },
    };
  };

  const pseudo = (el, which) => {
    const css = getComputedStyle(el, which);
    const side = (s) => `${css[`border${s}Width`]} ${css[`border${s}Style`]} ${css[`border${s}Color`]}`;
    return { w: css.width, h: css.height, bg: css.backgroundColor, border: side('Top'), start: side('Left'), end: side('Bottom'), radius: css.borderTopLeftRadius, opacity: css.opacity };
  };

  /** The mark of a selection control: the control's own box and the paint of its ::before (the 16 px box) and ::after (what is drawn over it). */
  const marks = (control) => { const b = control.getBoundingClientRect(); return { rect: [r2(b.width), r2(b.height)], before: pseudo(control, '::before'), after: pseudo(control, '::after') }; };

  /** The colour each token resolves to, in the document's theme. Only the names whose value is a colour. */
  const roles = (names) => {
    const probe = document.createElement('i');
    probe.style.cssText = 'position:fixed;left:-99px;top:0;visibility:hidden';
    document.body.append(probe);
    const root = getComputedStyle(document.documentElement);
    const out = {};
    for (const name of names) {
      if (!/^\s*(#[0-9a-f]{3,8}|rgba?\()/i.test(root.getPropertyValue(name))) continue;
      probe.style.color = `var(${name})`;
      out[name] = getComputedStyle(probe).color;
    }
    probe.remove();
    return out;
  };

  /** Mark one element of the staged table for a locator (the probe's own attribute, removed by the next call). */
  const target = (name, what) => {
    for (const el of document.querySelectorAll('[data-probe-target]')) el.removeAttribute('data-probe-target');
    const table = tableOf(name);
    let el = null;
    if (what.kind === 'sort') el = sortButtonOf(cellsOf(headRowOf(table)).find((c) => labelOf(c) === what.label) ?? document.createElement('i'));
    else if (what.kind === 'control') el = bodyRows(table).find((r) => indexOf(r) === what.row)?.querySelector(CONTROL) ?? null;
    if (el) el.setAttribute('data-probe-target', '');
    return !!el;
  };

  /** What the table paints in rest, for the theme check: the header, a cell, the sort arrow and the mark of an unchecked and a checked control. */
  const themePaint = (name, plain, selected) => {
    const table = tableOf(name);
    const th = cellsOf(headRowOf(table)).find((c) => c.querySelector('svg:not([data-ov-glyph="check"])') && sortButtonOf(c));
    const rows = bodyRows(table);
    const off = rows.find((r) => indexOf(r) === plain);
    const on = rows.find((r) => indexOf(r) === selected);
    const css = (el, which) => getComputedStyle(el, which);
    return {
      thColor: css(th).color, thPlane: css(th).backgroundColor, thRule: css(th).borderBottomColor,
      tdColor: css(cellsOf(off)[2]).color,
      arrow: css(th.querySelector('svg')).color,
      offEdge: css(off.querySelector(CONTROL), '::before').borderTopColor, offFill: css(off.querySelector(CONTROL), '::before').backgroundColor,
      onFill: css(on.querySelector(CONTROL), '::before').backgroundColor, onEdge: css(on.querySelector(CONTROL), '::before').borderTopColor,
      ink: css(on.querySelector(CONTROL), '::after').borderBottomColor,
    };
  };

  window.__kt = { frames, figure, tableOf, stage, stable, capture, sticky, sortInfo, paint, marks, roles, target, themePaint, scrollerOf };
}

/** The stage: what the mock's `#probe-stage` is, drawn over the example's figure (the example itself is the page's, untouched). */
const STAGE_CSS = `
[data-probe-stage] { position: fixed; inset: 0; z-index: 99999; box-sizing: border-box; margin: 0; padding: 40px; border: 0; border-radius: 0; background: var(--ov-bg-island); display: block; overflow: auto; }
[data-probe-stage] > figcaption { display: none; }
[data-probe-stage] > div { display: block; min-height: 0; width: var(--probe-w, auto); }
`;

/** Negative controls: one perturbation of one measured value, injected into the page after the load. */
const PERTURBATIONS = {
  'header-colour': '[data-probe-stage] th { color: rgb(1, 2, 3) !important; }',
  'row-height': '[data-probe-stage] tbody td { height: 41px !important; }',
  'cell-padding': '[data-probe-stage] tbody td { padding-left: 11px !important; }',
  // A hidden header word drawn: the header of a command column then has ink the mock's does not.
  'header-ink': '[data-probe-stage] th [data-ov-hidden] { position: static !important; width: auto !important; height: auto !important; margin: 0 !important; clip-path: none !important; overflow: visible !important; }',
};
const EXPECTED_BY_CONTROL = { 'header-colour': /^th\.\d+\.color$/, 'row-height': /^rows\.\d+\.(r\.h|td\.\d+\.r\.h)$/, 'cell-padding': /^rows\.\d+\.td\.\d+\.pad$/, 'header-ink': /^th\.\d+\.ink$/ };
if (CONTROL && !PERTURBATIONS[CONTROL]) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);

// ---------------------------------------------------------------------------------------------------------------------------
// Build and serve (serve.mjs, as every probe does), and open a page with the libraries installed.
function build() {
  if (process.env.DIST) return process.env.DIST;
  // ui-next imports the BUILT kit: a probe that read a stale build would compare yesterday's table.
  execFileSync('pnpm', ['--filter', '@omniviewdev/kit', 'run', 'build'], { cwd: repo, stdio: 'pipe' });
  return buildUiNext();
}

/** The names of the tokens (a role is a token whose value is a colour) and the ids of the nine themes, from the kit's generated files. */
const tokenNames = [...new Set([...readFileSync(path.join(repo, 'packages/kit/src/generated/tokenNames.ts'), 'utf8').matchAll(/'(--ov-[a-z0-9-]+)'/g)].map((m) => m[1]))];
const themeIds = [...new Set([...readFileSync(path.join(repo, 'packages/kit/src/generated/tokens.css'), 'utf8').matchAll(/\[data-ov-theme='([a-z-]+)'\]/g)].map((m) => m[1]))];

async function load(context, url, errors) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
  page.on('response', (response) => {
    // The Go host serves /wails/*; the static server of this probe does not, and the page does not need it.
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico') && !response.url().includes('/wails/')) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text().slice(0, 200));
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-example="DataTableParity/LinePlain"]');
  await page.evaluate(installRecordLib);
  await page.evaluate(installKitLib);
  await page.addStyleTag({ content: STAGE_CSS });
  if (CONTROL) await page.addStyleTag({ content: PERTURBATIONS[CONTROL] });
  // The real fonts: the table measures its text once they are loaded (it listens for the end of the load), and the probe waits for them here.
  await awaitFonts(page);
  return page;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The mock's side: a record rebuilt from mock-table.json with its styles resolved.
function resolveStyles(v) {
  if (Array.isArray(v)) return v.map(resolveStyles);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 's' && typeof x === 'string') out[k] = data.styles[x];
    else if (k === 'st') out[k] = Object.fromEntries(Object.entries(x).map(([name, s]) => [name, Array.isArray(s) ? s.map((id) => data.styles[id]) : data.styles[s]]));
    else out[k] = resolveStyles(x);
  }
  return out;
}
const mockRecord = (id, viewport, engine) => resolveStyles(expandCase(data, id, viewport, engine));

// Colours: the computed colour of both sides, named by the roles that resolve to it.
const colorOf = (css) => {
  const m = /rgba?\(([^)]+)\)/.exec(css ?? '');
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(',').map(Number);
  return { r, g, b, a };
};
const over = (top, bottom) => {
  const a = top.a + bottom.a * (1 - top.a);
  return a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a };
};
const mockRolesOf = new Map(Object.entries(data.colorTokens));
const islandColour = [...mockRolesOf].find(([, names]) => names.includes('--int-bg-island'))?.[0];
if (!islandColour) throw new Error('mock-table.json has no --int-bg-island colour');
const BACKDROP = colorOf(islandColour);

/** What a cell paints over the plane: its background colour and, over it, the tint of a gradient of one colour (how the kit paints a hover). */
function fillOf(s) {
  let c = BACKDROP;
  const bg = colorOf(s?.bg);
  if (bg) c = over(bg, c);
  const tint = /^linear-gradient\((rgba?\([^)]*\)), (rgba?\([^)]*\))\)/.exec(s?.bgImage ?? '');
  if (tint) c = over(colorOf(tint[1]), c);
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The ledger: every comparison is a measurement; one that differs is a deviation, explained by KNOWN_DEVIATIONS or not.
const known = KNOWN_DEVIATIONS.map((entry) => ({ ...entry, hits: 0, example: null }));
const ledger = { measurements: 0, byRun: {}, deviations: [], failures: [] };
let at = { run: '', id: '' };
let kitRoles = { byName: new Map(), byColour: new Map() };
const role = (name) => kitRoles.byName.get(name);

function note(p, mock, kit) {
  const entry = { run: at.run, id: at.id, path: p, mock, kit };
  const explained = known.find((k) => (!k.cases || k.cases.test(at.id)) && (!k.runs || k.runs.test(at.run)) && k.path.test(p) && (!k.when || k.when(mock, kit)));
  if (explained) {
    explained.hits += 1;
    explained.example ??= entry;
    entry.known = explained.id;
  }
  ledger.deviations.push(entry);
}
const count = () => { ledger.measurements += 1; ledger.byRun[at.run] = (ledger.byRun[at.run] ?? 0) + 1; };
const L = {
  eq(p, mock, kit) { count(); if (JSON.stringify(mock) !== JSON.stringify(kit)) note(p, mock, kit); },
  num(p, mock, kit, tol) { count(); if (!(typeof mock === 'number' && typeof kit === 'number' && Math.abs(mock - kit) <= tol)) note(p, mock, kit); },
  fail(p, message) { ledger.failures.push({ run: at.run, id: at.id, path: p, message }); },
};

function rect(p, mock, kit, tol = TOL) {
  if (!mock || !kit) { L.eq(p, mock ? 'present' : 'absent', kit ? 'present' : 'absent'); return; }
  L.num(`${p}.x`, mock[0], kit[0], tol.x);
  L.num(`${p}.y`, mock[1], kit[1], tol.y);
  L.num(`${p}.w`, mock[2], kit[2], tol.w);
  L.num(`${p}.h`, mock[3], kit[3], tol.h);
}
const pick = (s, key) => (key === 'fill' ? fillOf(s) : s?.[key]);
function styles(p, mock, kit, keys) {
  for (const key of keys) L.eq(`${p}.${key}`, pick(mock, key), pick(kit, key));
}

const CELL_KEYS = ['color', 'fill', 'bT', 'bR', 'bB', 'bL', 'pad', 'margin', 'radius', 'font', 'ls', 'nums', 'align', 'ws', 'overflow', 'textOverflow', 'cursor', 'opacity', 'shadow', 'position', 'top', 'left'];
const ROW_KEYS = ['color', 'cursor', 'outline', 'opacity', 'shadow', 'bT', 'bB'];
const BUTTON_KEYS = ['bg', 'border', 'color', 'radius', 'pad', 'font', 'gap', 'cursor', 'layout', 'shadow', 'opacity', 'pointer', 'outline'];
const PART_KEYS = {
  identity: ['display', 'alignItems', 'gap'],
  tile: ['display', 'alignItems', 'justify', 'radius'],
  lines: ['display', 'dir', 'gap'],
  group: ['color', 'font', 'overflow', 'textOverflow', 'ws'],
  cut: ['display', 'overflow', 'position', 'color', 'font'],
  head: ['overflow', 'textOverflow', 'ws', 'color'],
  tail: ['ws', 'color'],
  identifier: ['display', 'alignItems', 'gap', 'mono'],
  identifierText: ['display', 'overflow', 'ws', 'position', 'mono'],
  command: ['radius', 'cursor'],
};
/** The mock's markup for each named piece of a cell (the kit's fixture names its pieces with `data-part`). */
const MOCK_PART = {
  identity: (n) => n.c === 'namecell',
  tile: (n) => /(^| )tile( |$)/.test(n.c ?? ''),
  lines: (n) => n.c === 'cell2',
  group: (n) => n.t === 'small',
  cut: (n) => n.c === 'pmid',
  head: (n) => n.c === 'pmid__head',
  tail: (n) => n.c === 'pmid__tail',
  identifier: (n) => n.c === 'resource-identifier',
  identifierText: (n) => n.c === 'resource-identifier-text',
  command: (n) => n.t === 'button' && /(^| )cell-action|ghost small/.test(n.c ?? ''),
};
const isCheckbox = (n) => n.t === 'input' || n.a?.role === 'checkbox';
const isSortButton = (n) => n.t === 'button' && n.a?.role !== 'checkbox';

// ---------------------------------------------------------------------------------------------------------------------------
// Comparing one record of the kit with the mock's.
/** The kit's piece of a cell by the name its fixture gave it; the two halves of a middle-cut name are the first and the second child of the cut box. */
function kitPart(kitCell, part) {
  if (part !== 'head' && part !== 'tail') return kitCell.k?.find((n) => n.part === part);
  const at = kitCell.k?.findIndex((n) => n.part === 'cut') ?? -1;
  if (at < 0) return undefined;
  const depth = kitCell.k[at].d + 1;
  const halves = [];
  for (let i = at + 1; i < kitCell.k.length && kitCell.k[i].d >= depth; i += 1) if (kitCell.k[i].d === depth) halves.push(kitCell.k[i]);
  return halves[part === 'head' ? 0 : 1];
}

function compareParts(p, mockCell, kitCell) {
  for (const [part, isPart] of Object.entries(MOCK_PART)) {
    const m = mockCell.k?.find(isPart);
    if (!m) continue;
    const k = kitPart(kitCell, part);
    if (!k) { L.eq(`${p}.${part}`, 'present', 'missing'); continue; }
    rect(`${p}.${part}.r`, m.r, k.r);
    styles(`${p}.${part}`, m.s, k.s, PART_KEYS[part]);
    L.eq(`${p}.${part}.clip`, m.cut ? 1 : 0, k.cut ? 1 : 0);
    if (m.xr && k.xr && m.x === k.x) L.num(`${p}.${part}.text.w`, m.xr[1], k.xr[1], TOL.w);
  }
}

/** What a header cell draws as text: its own text and that of what it holds, except a box of 1 px or less (a visually hidden word has no ink). */
const inkOf = (record) => [record, ...(record.k ?? [])].filter((n) => n.x && !(n.r[2] <= 1.5 && n.r[3] <= 1.5)).map((n) => n.x).join(' ');

function compareCell(p, m, k, { kids, sameText }) {
  if (!k) { L.eq(p, 'present', 'missing'); return; }
  rect(`${p}.r`, m.r, k.r);
  styles(p, m.s, k.s, CELL_KEYS);
  L.eq(`${p}.col`, m.col, k.col);
  L.eq(`${p}.clip`, m.cut ? 1 : 0, k.cut ? 1 : 0);
  if (sameText && m.x !== undefined) {
    L.eq(`${p}.text`, m.x, k.x);
    if (m.xr && k.xr) { L.num(`${p}.text.x`, m.xr[0], k.xr[0], TOL.x); L.num(`${p}.text.w`, m.xr[1], k.xr[1], TOL.w); }
  }
  if (m.n === 1) L.eq(`${p}.elements`, m.n, k.n);
  if (kids && m.k) compareParts(p, m, k);
}

function compareHeader(mock, kit) {
  rect('headRow.r', mock.headRow.r, kit.headRow.r);
  rect('table.r', mock.table.r, kit.table.r);
  L.eq('th.count', mock.th.length, kit.th.length);
  mock.th.forEach((m, j) => {
    const k = kit.th[j];
    const p = `th.${j}`;
    if (!k) { L.eq(p, 'present', 'missing'); return; }
    rect(`${p}.r`, m.r, k.r);
    styles(p, m.s, k.s, CELL_KEYS);
    L.eq(`${p}.col`, m.col, k.col);
    L.eq(`${p}.aria-sort`, m.a?.['aria-sort'], k.a?.['aria-sort']);
    L.eq(`${p}.ink`, inkOf(m), inkOf(k));
    L.eq(`${p}.scope`, m.a?.scope, k.a?.scope);
    if (m.x !== undefined) {
      L.eq(`${p}.text`, m.x, k.x);
      if (m.xr && k.xr) { L.num(`${p}.text.x`, m.xr[0], k.xr[0], TOL.x); L.num(`${p}.text.w`, m.xr[1], k.xr[1], TOL.w); }
    }
    if (m.n === 1) L.eq(`${p}.elements`, m.n, k.n);
    const mb = m.k?.find(isSortButton);
    const kb = k.k?.find(isSortButton);
    L.eq(`${p}.sortButton`, mb ? 'present' : 'absent', kb ? 'present' : 'absent');
    if (mb && kb) { rect(`${p}.sortButton.r`, mb.r, kb.r); L.eq(`${p}.sortButton.text`, mb.x, kb.x); }
    const mg = m.k?.find((n) => n.t === 'svg' && !isCheckbox(n));
    const kg = k.k?.find((n) => n.t === 'svg');
    if (mb || kb) L.eq(`${p}.arrow`, mg ? 'present' : 'absent', kg ? 'present' : 'absent');
    if (mg && kg) { rect(`${p}.arrow.r`, mg.r, kg.r); L.eq(`${p}.arrow.color`, mg.s.color, kg.s.color); }
    const mc = m.k?.find(isCheckbox);
    const kc = k.k?.find(isCheckbox);
    if (mc || kc) {
      L.eq(`${p}.control`, mc ? 'present' : 'absent', kc ? 'present' : 'absent');
      if (mc && kc) rect(`${p}.control.r`, mc.r, kc.r);
    }
  });
}

function compareRows(spec, mock, kit) {
  const kids = Object.keys(mock.rows).map(Number).filter((i) => mock.rows[i].td.some((td) => td.k));
  for (const [i, m] of Object.entries(mock.rows)) {
    const k = kit.rows[i];
    const p = `rows.${i}`;
    if (!k) { L.eq(p, 'present', 'missing'); continue; }
    rect(`${p}.r`, m.r, k.r);
    styles(p, m.s, k.s, ROW_KEYS);
    L.eq(`${p}.tabindex`, m.a?.tabindex, k.a?.tabindex);
    L.eq(`${p}.cells`, m.td.length, k.td.length);
    m.td.forEach((mt, j) => compareCell(`${p}.td.${j}`, mt, k.td[j], { kids: kids.includes(Number(i)), sameText: spec.sameText !== false }));
  }
}

function compareButtonStates(p, mock, kit) {
  for (const state of ['rest', 'hover', 'focus']) {
    const m = mock?.[state];
    const k = kit?.[state];
    if (!m) continue;
    if (!k) { L.eq(`${p}.${state}`, 'present', 'missing'); continue; }
    L.num(`${p}.${state}.size.w`, m.size[0], k.size[0], TOL.w);
    L.num(`${p}.${state}.size.h`, m.size[1], k.size[1], TOL.h);
    L.eq(`${p}.${state}.elements`, m.n, k.n);
    for (const key of BUTTON_KEYS) if (key !== 'outline' || state === 'focus') L.eq(`${p}.${state}.${key}`, m.s[key], k.s[key]);
    L.eq(`${p}.${state}.icon`, m.icon ? 'present' : 'absent', k.icon ? 'present' : 'absent');
    if (m.icon && k.icon) {
      L.num(`${p}.${state}.icon.x`, m.icon[0], k.icon[0], TOL.x);
      L.num(`${p}.${state}.icon.y`, m.icon[1], k.icon[1], TOL.y);
      L.num(`${p}.${state}.icon.w`, m.icon[2], k.icon[2], TOL.w);
      L.num(`${p}.${state}.icon.h`, m.icon[3], k.icon[3], TOL.h);
      L.eq(`${p}.${state}.icon.color`, m.icon[4], k.icon[4]);
    }
    L.eq(`${p}.${state}.label`, m.label ? m.label[2] : null, k.label ? k.label[2] : null);
    if (m.label && k.label) { L.num(`${p}.${state}.label.x`, m.label[0], k.label[0], TOL.x); L.num(`${p}.${state}.label.w`, m.label[1], k.label[1], TOL.w); }
  }
}

function compareSticky(mock, kit) {
  if (!mock.sticky) return;
  const m = mock.sticky;
  const k = kit.sticky;
  if (!k) { L.eq('sticky', 'present', 'missing'); return; }
  L.num('sticky.scrollTop', m.scrollTop, k.scrollTop, 0.5);
  L.num('sticky.headerTop', m.headerTop, k.headerTop, TOL.y);
  L.eq('sticky.hit', (m.hit ?? '').split('.')[0], k.hit);
  L.eq('sticky.rowBelowHeader', m.rowBelowHeader, k.rowBelowHeader);
  styles('sticky.th', m.th.s, k.th.s, ['position', 'top', 'left', 'fill', 'color', 'bB']);
}

function compareStates(mock, kit) {
  if (!mock.states || !kit.states) return;
  for (const name of Object.keys(kit.states)) {
    const m = mock.states[name];
    const k = kit.states[name];
    if (!m || name === 'focusRegion') continue;
    const p = `states.${name}`;
    styles(`${p}.row`, m.st.row, k.st.row, ROW_KEYS.filter((key) => key !== 'outline'));
    m.st.td.forEach((mt, j) => styles(`${p}.td.${j}`, mt, k.st.td[j], ['color', 'fill', 'pad', 'position', 'left', 'cursor']));
    L.eq(`${p}.pointerOver`, m.m.hover, k.m.hover);
    L.eq(`${p}.tableFocused`, m.m.wrapFocusWithin, k.m.wrapFocusWithin);
    L.eq(`${p}.selected`, m.m.sel, k.m.sel);
  }
  // The mock's rows are Tab stops and draw the ring; the kit's rows are not (plan E5), its scroll region is and draws the same ring.
  if (kit.states.focusRegion && mock.states.focus) L.eq('states.focus.ring', mock.states.focus.st.row.outline, kit.states.focusRegion.outline);
}

/** The 16 px mark of a selection control: its box in the 24 px target, its fill and edge by state, its ink (the mock's values: see NOT_COMPARED). */
function compareMarks(kit) {
  if (!kit.marks) return;
  const colour = (border) => /rgba?\([^)]*\)/.exec(border ?? '')?.[0];
  for (const state of ['off', 'on', 'mixed']) {
    const m = kit.marks[state];
    if (!m) continue;
    const p = `marks.${state}`;
    L.eq(`${p}.box`, '16px 16px', `${m.before.w} ${m.before.h}`);
    L.eq(`${p}.radius`, '4px', m.before.radius);
    L.eq(`${p}.fill`, state === 'off' ? role('--ov-bg-island') : role('--ov-accent'), m.before.bg);
    L.eq(`${p}.edge`, `1px solid ${state === 'off' ? role('--ov-border-raised') : role('--ov-accent')}`, m.before.border);
    if (state !== 'off') L.eq(`${p}.ink`, role('--ov-fg-over-accent'), colour(state === 'on' ? m.after.start : m.after.end));
  }
}

function compareCase(spec, mock, kit) {
  compareHeader(mock, kit);
  // The columns, each within the tolerance of a width (the planner gives whole pixels, the mock's table fractions of them).
  L.eq('colWidths.count', mock.colWidths.length, kit.colWidths.length);
  mock.colWidths.forEach((width, j) => L.num(`colWidths.${j}`, width, kit.colWidths[j], TOL.w));
  compareRows(spec, mock, kit);
  L.eq('counts.rowcount', mock.counts.rows + 1, Number(kit.counts.rowcount));
  if (mock.counts.rows <= 24) L.eq('counts.mounted', mock.counts.rows, kit.counts.mounted);
  if (mock.held) {
    L.num('held.identityWidth', mock.held.identityWidth, kit.colWidths[0], TOL.w);
    L.num('held.tableWidth', mock.held.wrapWidth, kit.table.r[2], TOL.w);
  }
  compareSticky(mock, kit);
  if (mock.selectionCommand && kit.selectionCommand) compareButtonStates('selectionCommand', mock.selectionCommand, kit.selectionCommand);
  if (mock.sort && kit.sort) {
    for (const [name, m] of Object.entries(mock.sort)) {
      const k = kit.sort[name];
      if (!k) { L.eq(`sort.${name}`, 'present', 'missing'); continue; }
      L.eq(`sort.${name}.aria.thSort`, m.aria.thSort, k.aria?.thSort);
      L.eq(`sort.${name}.aria.thLabel`, m.aria.thLabel, k.aria?.thLabel);
      L.eq(`sort.${name}.aria.buttonLabel`, m.aria.buttonLabel, k.aria?.buttonLabel);
      compareButtonStates(`sort.${name}.button`, m.button, k.button);
    }
  }
  compareStates(mock, kit);
  compareMarks(kit);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Measuring the kit: the same questions the mock was asked, in the same order (the order matters: a sort changes the rows).
async function pointerAway(page) {
  await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
  await page.mouse.move(1, 1);
  await settle(page);
}

const rowSelector = (scope, i) => `${scope} tr[aria-rowindex="${i + 2}"], ${scope} [role="row"][aria-rowindex="${i + 2}"]`;
const CHECK = 'input[type="checkbox"], [role="checkbox"]';

async function targetOf(page, example, what) {
  if (!(await page.evaluate(([name, w]) => window.__kt.target(name, w), [example, what]))) throw new Error(`no ${what.kind} ${what.label ?? what.row ?? ''} in ${example}`);
  return page.locator('[data-probe-target]');
}

async function kitSort(page, spec, mock) {
  const out = {};
  const labelOf = (entry) => mock.th.find((t) => JSON.stringify(t.r) === JSON.stringify(entry.th.r))?.col;
  const one = async (name, entry) => {
    const label = labelOf(entry);
    const button = await targetOf(page, spec.example, { kind: 'sort', label });
    const aria = await page.evaluate(([n, l]) => window.__kt.sortInfo(n, l), [spec.example, label]);
    out[name] = { aria, button: buttonStates(await measure(page, button, { states: ['rest', 'hover', 'focus'] })) };
  };
  for (const name of ['inactive', 'ascending']) if (mock.sort[name]) await one(name, mock.sort[name]);
  if (mock.sort.descending && spec.descend) {
    await (await targetOf(page, spec.example, { kind: 'sort', label: labelOf(mock.sort.ascending) })).click();
    await sleep(600);
    await pointerAway(page);
    await one('descending', mock.sort.descending);
  }
  return out;
}

async function kitStates(page, spec, hasControl) {
  const scope = `[data-example="DataTableParity/${spec.example}"]`;
  const cfg = spec.states;
  const row = (i) => page.locator(rowSelector(scope, i)).first();
  const paintOf = (handle) => handle.evaluate((el) => window.__kt.paint(el));
  const out = {};
  await pointerAway(page);
  out.rest = await paintOf(await row(cfg.plainRow).elementHandle());
  const hovered = await row(cfg.hoverRow).elementHandle();
  await hovered.scrollIntoViewIfNeeded();
  const box = await hovered.boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 2 });
  await settle(page);
  out.hover = await paintOf(hovered);
  if (!out.hover.m.hover) throw new Error('row hover state not in effect');
  await pointerAway(page);
  // The kit's rows are not Tab stops: the ring of keyboard focus is the scroll region's.
  const region = await page.evaluateHandle((name) => window.__kt.scrollerOf(window.__kt.tableOf(name)), spec.example);
  await page.keyboard.press('Shift');
  await region.evaluate((el) => el.focus());
  await settle(page);
  out.focusRegion = await region.evaluate((el) => ({ outline: window.__rec.styleOf(el).outline, focusVisible: el.matches(':focus-visible') }));
  if (!out.focusRegion.focusVisible) throw new Error('region :focus-visible not in effect');
  await pointerAway(page);
  if (!hasControl) return out;
  const control = (i) => row(i).locator(CHECK).first();
  if (cfg.tick) {
    for (const i of cfg.selectedRows) {
      await control(i).scrollIntoViewIfNeeded();
      await control(i).click();
      await sleep(250);
    }
    await pointerAway(page);
  }
  const selected = await row(cfg.selectedRows[0]).elementHandle();
  if (!(await paintOf(selected)).m.sel) throw new Error('the selected row is not selected');
  await page.keyboard.press('Shift');
  await control(cfg.checkRow).evaluate((el) => el.focus());
  await settle(page);
  out.selectedFocused = await paintOf(selected);
  if (!out.selectedFocused.m.wrapFocusWithin) throw new Error('table focus-within not in effect');
  await pointerAway(page);
  out.selectedBlurred = await paintOf(selected);
  if (out.selectedBlurred.m.wrapFocusWithin) throw new Error('table still has focus-within');
  const second = await row(cfg.selectedRows[1]).elementHandle();
  const sbox = await second.boundingBox();
  await page.mouse.move(sbox.x + sbox.width * 0.6, sbox.y + sbox.height / 2, { steps: 2 });
  await settle(page);
  out.selectedHover = await paintOf(second);
  if (!out.selectedHover.m.hover) throw new Error('selected-row hover not in effect');
  await pointerAway(page);
  return out;
}

/** The three states of the mark of a selection control: the control's own box and the paint of its ::before and ::after. */
async function kitMarks(page, spec) {
  const read = async (what) => (await targetOf(page, spec.example, what)).evaluate((el) => window.__kt.marks(el));
  const out = {};
  out.off = await read({ kind: 'control', row: spec.states.plainRow });
  out.on = await read({ kind: 'control', row: spec.states.selectedRows[0] });
  out.mixed = await page.evaluate((name) => {
    const head = window.__kt.tableOf(name).querySelector('[aria-rowindex="1"] input[type="checkbox"], [aria-rowindex="1"] [role="checkbox"]');
    return head && (head.indeterminate === true || head.getAttribute('aria-checked') === 'mixed') ? window.__kt.marks(head) : null;
  }, spec.example);
  return out;
}

async function measureKit(page, spec, mock, run) {
  await setContext(page, { density: spec.density === 'compact' ? 'compact' : null, flavour: 'kit' });
  await page.evaluate(([name, width]) => window.__kt.stage(name, width), [spec.example, mock.table.r[2]]);
  if (!(await page.evaluate((name) => window.__kt.stable(name), spec.example))) throw new Error(`${spec.example} did not settle`);
  await pointerAway(page);
  const rows = Object.keys(mock.rows).map(Number);
  const kids = rows.filter((i) => mock.rows[i].td.some((td) => td.k));
  const kit = await page.evaluate(([name, o]) => window.__kt.capture(name, o), [spec.example, { rows, kids }]);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${run.replace(' ', '-')}-${spec.id}.png`) });
  if (mock.sticky) kit.sticky = await page.evaluate(([name, by]) => window.__kt.sticky(name, by), [spec.example, mock.sticky.asked]);
  const hasControl = kit.th.some((th) => th.k?.some(isCheckbox)) || Object.values(kit.rows).some((r) => r?.td.some((td) => td.k?.some(isCheckbox)));
  if (mock.selectionCommand && hasControl) {
    const control = await targetOf(page, spec.example, { kind: 'control', row: 5 });
    kit.selectionCommand = buttonStates(await measure(page, control, { states: ['rest', 'hover', 'focus'] }));
  }
  if (mock.sort) kit.sort = await kitSort(page, spec, mock);
  if (mock.states && spec.states) kit.states = await kitStates(page, spec, hasControl);
  if (hasControl && spec.states) kit.marks = await kitMarks(page, spec);
  return kit;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The themes: in each theme, what the table paints is the role of the token table the mock's CSS names for it.
async function themesPass(page, viewportName) {
  const example = 'LineSelection';
  const mock = mockRecord('line-selection-comfortable', viewportName, engineNames[0]);
  await setContext(page, { density: null, flavour: 'kit' });
  await page.evaluate(([name, width]) => window.__kt.stage(name, width), [example, mock.table.r[2]]);
  await page.evaluate((name) => window.__kt.stable(name), example);
  const scope = `[data-example="DataTableParity/${example}"]`;
  const row = (i) => page.locator(rowSelector(scope, i)).first();
  const tintOf = (td) => /^linear-gradient\((rgba?\([^)]*\))/.exec(td.bgImage ?? '')?.[1] ?? td.bg;
  for (const theme of themeIds) {
    await page.evaluate((id) => document.documentElement.setAttribute('data-ov-theme', id), theme);
    await settle(page);
    const roles = await page.evaluate((names) => window.__kt.roles(names), tokenNames);
    await pointerAway(page);
    const rest = await page.evaluate(([name]) => window.__kt.themePaint(name, 5, 1), [example]);
    const hovered = await row(4).elementHandle();
    const box = await hovered.boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 2 });
    await settle(page);
    const hover = await hovered.evaluate((el) => window.__kt.paint(el));
    await pointerAway(page);
    const selected = await row(1).elementHandle();
    await page.keyboard.press('Shift');
    await row(7).locator(CHECK).first().evaluate((el) => el.focus());
    await settle(page);
    const active = await selected.evaluate((el) => window.__kt.paint(el));
    await pointerAway(page);
    const inactive = await selected.evaluate((el) => window.__kt.paint(el));
    const region = await page.evaluateHandle((name) => window.__kt.scrollerOf(window.__kt.tableOf(name)), example);
    await page.keyboard.press('Shift');
    await region.evaluate((el) => el.focus());
    await settle(page);
    const ring = await region.evaluate((el) => getComputedStyle(el).outlineColor);
    await pointerAway(page);
    const expected = {
      'header text': [roles['--ov-fg-muted'], rest.thColor],
      'header plane': [roles['--ov-bg-island'], rest.thPlane],
      'header rule': [roles['--ov-border-subtle'], rest.thRule],
      'cell text': [roles['--ov-fg'], rest.tdColor],
      'sort arrow': [roles['--ov-icon'], rest.arrow],
      'hover tint': [roles['--ov-hover-row'], tintOf(hover.st.td[2])],
      'selected, table focused': [roles['--ov-selection-active'], active.st.td[2].bg],
      'selected, table not focused': [roles['--ov-selection-inactive'], inactive.st.td[2].bg],
      'focus ring': [roles['--ov-accent'], ring],
      'mark off edge': [roles['--ov-border-raised'], rest.offEdge],
      'mark off fill': [roles['--ov-bg-island'], rest.offFill],
      'mark on fill': [roles['--ov-accent'], rest.onFill],
      'mark on edge': [roles['--ov-accent'], rest.onEdge],
      'mark ink': [roles['--ov-fg-over-accent'], rest.ink],
    };
    for (const [what, [want, got]] of Object.entries(expected)) L.eq(`themes.${theme}.${what}`, want, got);
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-ov-theme'));
  await settle(page);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The report.
const withRoles = (value, side) => {
  const text = JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.replace(/rgba?\([^)]*\)/g, (colour) => {
    const names = side === 'mock' ? mockRolesOf.get(colour) : kitRoles.byColour.get(colour);
    return names?.length ? `${colour} [${names.join(', ')}]` : colour;
  });
};
const shape = (p) => p.replace(/^themes\.[a-z-]+\./, 'themes.*.').replace(/\.\d+(?=\.|$)/g, '.#');
const sides = (d) => (d.path.startsWith('themes.') ? ['role', 'kit'] : ['mock', 'kit']);

function summarize() {
  const out = [];
  const unexplained = ledger.deviations.filter((d) => !d.known);
  const explained = ledger.deviations.filter((d) => d.known);
  for (const run of Object.keys(ledger.byRun)) {
    const mine = ledger.deviations.filter((d) => d.run === run);
    out.push(`${run}: ${ledger.byRun[run]} measurements, ${mine.length} deviations (${mine.filter((d) => d.known).length} explained, ${mine.filter((d) => !d.known).length} not)`);
  }
  out.push(`total: ${ledger.measurements} measurements, ${ledger.deviations.length} deviations (${explained.length} explained, ${unexplained.length} not), ${ledger.failures.length} failures`);

  // The same difference in several cases is one line: the cases it was found in are listed.
  const groups = new Map();
  for (const d of unexplained) {
    // A value that is wrong in every theme is one difference, found in as many themes as there are paths.
    const key = d.path.startsWith('themes.') ? shape(d.path) : [shape(d.path), JSON.stringify(d.mock), JSON.stringify(d.kit)].join('\u0000');
    const g = groups.get(key) ?? { ...d, paths: new Set(), runs: new Set(), ids: new Set() };
    g.paths.add(`${d.id} ${d.path}`);
    g.runs.add(d.run);
    g.ids.add(d.id);
    groups.set(key, g);
  }
  if (groups.size) {
    out.push(`\nNOT EXPLAINED (${groups.size} distinct differences, ${unexplained.length} in all):`);
    for (const g of [...groups.values()].sort((a, b) => shape(a.path).localeCompare(shape(b.path)) || a.id.localeCompare(b.id))) {
      const [a, b] = sides(g);
      out.push(`  ${shape(g.path)}: ${a} ${withRoles(g.mock, 'mock')}, ${b} ${withRoles(g.kit, 'kit')}\n    ${g.paths.size} places in ${[...g.ids].join(', ')}; e.g. ${[...g.paths][0]}; ${[...g.runs].join(', ')}`);
    }
  }
  const used = known.filter((k) => k.hits > 0);
  if (used.length) {
    out.push(`\nEXPLAINED by KNOWN_DEVIATIONS (${explained.length}):`);
    const byId = new Map();
    for (const k of used) {
      const g = byId.get(k.id) ?? { hits: 0, reason: k.reason, example: k.example };
      g.hits += k.hits;
      byId.set(k.id, g);
    }
    for (const [id, g] of byId) out.push(`  ${id} x${g.hits}: ${g.reason}\n    e.g. ${g.example.id} ${g.example.path}: mock ${withRoles(g.example.mock, 'mock')}, kit ${withRoles(g.example.kit, 'kit')}`);
  }
  const unused = known.filter((k) => k.hits === 0);
  if (unused.length && fullRun) out.push(`\nUNUSED KNOWN_DEVIATIONS (nothing matched them in a full run: delete them or fix their pattern): ${unused.map((k) => `${k.id} ${k.path}`).join('; ')}`);
  if (ledger.failures.length) {
    out.push(`\nFAILURES (${ledger.failures.length}):`);
    for (const f of ledger.failures) out.push(`  ${f.run} ${f.id} ${f.path}: ${f.message}`);
  }
  out.push(`\nNOT COMPARED:\n  ${NOT_COMPARED.join('\n  ')}`);
  return { text: out.join('\n'), unexplained, explained, groups: groups.size };
}

// ---------------------------------------------------------------------------------------------------------------------------
async function main() {
  const dist = build();
  const { server, url } = await serve(dist);
  const started = Date.now();
  try {
    for (const engineName of engineNames) {
      const browser = await launch(engineName);
      for (const viewportName of viewportNames) {
        const run = `${engineName} ${viewportName}`;
        const context = await browser.newContext({ viewport: VIEWPORTS[viewportName] });
        const errors = [];
        let page = await load(context, url, errors);
        const resolved = await page.evaluate((names) => window.__kt.roles(names), tokenNames);
        kitRoles = { byName: new Map(Object.entries(resolved)), byColour: new Map() };
        for (const [name, colour] of kitRoles.byName) kitRoles.byColour.set(colour, [...(kitRoles.byColour.get(colour) ?? []), name]);
        for (const spec of CASES) {
          if (only && !only.test(spec.id)) continue;
          if (!data.cases[spec.id]?.[viewportName]) continue;
          at = { run, id: spec.id };
          const t = Date.now();
          try {
            const mock = mockRecord(spec.id, viewportName, engineName);
            compareCase(spec, mock, await measureKit(page, spec, mock, run));
          } catch (error) {
            L.fail('measure', String(error.message ?? error).split('\n')[0]);
          }
          console.log(`${run} ${spec.id} ${((Date.now() - t) / 1000).toFixed(1)}s`);
          if (spec.states?.tick || spec.descend) {
            // A sort and a click on a checkbox change the example's state: the next case starts from a page that has not been touched.
            await page.close();
            page = await load(context, url, errors);
          }
        }
        if (viewportName === viewportNames[0] && (!only || only.test('themes'))) {
          at = { run, id: 'themes' };
          try {
            await themesPass(page, viewportName);
          } catch (error) {
            L.fail('themes', String(error.message ?? error).split('\n')[0]);
          }
        }
        at = { run, id: '(page)' };
        for (const message of errors) L.fail('page', message);
        await context.close();
      }
      await browser.close();
    }
  } finally {
    server.close();
  }

  const report = summarize();
  console.log(`\n${report.text}`);
  console.log(`\n(${((Date.now() - started) / 1000).toFixed(0)} s)`);
  if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify({ ledger, known: known.map(({ id, reason, hits }) => ({ id, reason, hits })) }, null, 1));
  if (CONTROL) {
    const detected = ledger.deviations.filter((d) => !d.known && EXPECTED_BY_CONTROL[CONTROL].test(d.path));
    console.log(detected.length ? `\nNEGATIVE CONTROL "${CONTROL}": detected (${detected.length} deviations, e.g. ${detected[0].id} ${detected[0].path}: mock ${JSON.stringify(detected[0].mock)}, kit ${JSON.stringify(detected[0].kit)})` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED`);
    process.exitCode = detected.length ? 1 : 2;
    return;
  }
  if (report.unexplained.length || ledger.failures.length) process.exitCode = 1;
}

await main();

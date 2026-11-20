// What the palette probe compares, in one place: each part of the command palette and the top row's Search control by the selector that finds it in the design mock (the reference, measured by
// mock-palette-measure.mjs into mock-palette.json) and by the selector that finds it in the shell (data-palette-part, written by ui-next/shell/palette). Page-agnostic: the same reading runs
// on both sides. A part with `all` is every element that matches, in document order; the others are the first.
//
// The scenes are what both sides are asked to show. The contents differ (the mock's plugins and pages are not the fixture's), so only what does not depend on the words is compared: the frame, its
// rows of fixed height, the columns every row shares (the glyph, the name, the context, the trailing slot), the section label, the band and the footer, and the x of the text.

/** The parts of the surface. `mock` is relative to the whole document; the mock draws its palette as `.dlg.palette`. */
export const PARTS = [
  { name: 'frame', mock: '.dlg.palette', shell: '[data-palette-part="frame"]' },
  { name: 'glyph', mock: '.dlg.palette > .pq-ic', shell: '[data-palette-part="glyph"]' },
  { name: 'glyphSvg', mock: '.dlg.palette > .pq-ic svg', shell: '[data-palette-part="glyph"] svg' },
  { name: 'chips', mock: '.dlg.palette > .pq-chips', shell: '[data-palette-part="chips"]' },
  { name: 'chip', all: true, mock: '.dlg.palette .pq-chip', shell: '[data-palette-part="chip"]' },
  { name: 'input', mock: '.dlg.palette > #pq', shell: '[data-palette-part="input"]' },
  { name: 'kinds', mock: '.dlg.palette > .pq-kinds', shell: '[data-palette-part="kinds"]' },
  { name: 'kind', all: true, mock: '.dlg.palette > .pq-kinds [role="tab"]', shell: '[data-palette-part="kinds"] [role="tab"]' },
  { name: 'results', mock: '.dlg.palette > .res', shell: '[data-palette-part="results"]' },
  { name: 'note', mock: '.dlg.palette .pq-note', shell: '[data-palette-part="note"]' },
  { name: 'group', all: true, mock: '.dlg.palette .pq-grp', shell: '[data-palette-part="group"]' },
  { name: 'label', all: true, mock: '.dlg.palette .pq-grp .sectionlabel', shell: '[data-palette-part="label"]' },
  { name: 'row', all: true, mock: '.dlg.palette .it.dest', shell: '[data-palette-part="row"]' },
  { name: 'rowIcon', all: true, mock: '.dlg.palette .it.dest > .listrow__icon svg', shell: '[data-palette-part="row"] > [data-palette-part="icon"] svg' },
  { name: 'rowText', all: true, mock: '.dlg.palette .it.dest > .listrow__text', shell: '[data-palette-part="row"] > [data-palette-part="text"]' },
  { name: 'rowBody', all: true, mock: '.dlg.palette .it.dest > .listrow__body', shell: '[data-palette-part="row"] > [data-palette-part="body"]' },
  { name: 'rowMeta', all: true, mock: '.dlg.palette .it.dest > .listrow__meta', shell: '[data-palette-part="row"] > [data-palette-part="meta"]' },
  { name: 'band', mock: '.dlg.palette > .pq-band', shell: '[data-palette-part="band"]' },
  { name: 'foot', mock: '.dlg.palette > .pq-foot', shell: '[data-palette-part="foot"]' },
  { name: 'hint', all: true, mock: '.dlg.palette .keyhints__pair', shell: '[data-palette-part="hint"]' },
];

/** The top row's Search control: the button, its glyph and its key hint. The mock's is `#topbar-search`. */
export const SEARCH = [
  { name: 'search', mock: '#topbar-search', shell: '[data-shell-part="search"]' },
  { name: 'searchGlyph', mock: '#topbar-search svg', shell: '[data-shell-part="search"] svg' },
  { name: 'searchHint', mock: '#topbar-search kbd', shell: '[data-shell-part="search"] kbd' },
];

/**
 * The paint of the parts, exactly: which computed properties are read of which part (the first element, or the `index`-th of an `all` part). `row` 0 is the active row in every scene that has rows.
 * A colour is read as the engine computes it (`rgb(...)`), so the two sides compare as strings.
 */
export const STYLES = [
  { name: 'frame', props: ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'boxShadow'] },
  { name: 'input', props: ['color', 'caretColor', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] },
  { name: 'kind', index: 0, props: ['color', 'backgroundColor', 'borderTopColor', 'borderTopLeftRadius', 'fontSize', 'fontWeight'] },
  { name: 'kind', index: 1, props: ['color', 'backgroundColor', 'borderTopColor', 'fontSize', 'fontWeight'] },
  { name: 'results', props: ['borderTopColor', 'borderTopWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] },
  { name: 'label', index: 0, props: ['color', 'fontSize', 'fontWeight', 'lineHeight', 'paddingLeft'] },
  { name: 'row', index: 0, props: ['backgroundColor', 'color', 'fontSize', 'fontWeight', 'borderTopLeftRadius'] },
  { name: 'row', index: 1, props: ['backgroundColor', 'color', 'fontSize', 'fontWeight'] },
  { name: 'rowBody', index: 0, props: ['color', 'fontSize'] },
  { name: 'rowIcon', index: 0, props: ['color'] },
  { name: 'band', props: ['color', 'fontSize', 'lineHeight', 'paddingLeft'] },
  { name: 'foot', props: ['color', 'fontSize', 'lineHeight', 'borderTopColor', 'borderTopWidth', 'paddingLeft'] },
  { name: 'hint', index: 0, props: ['color', 'fontSize', 'columnGap'] },
  { name: 'search', props: ['color', 'backgroundColor', 'fontSize', 'borderTopLeftRadius', 'paddingLeft', 'columnGap'] },
  { name: 'searchHint', props: ['color', 'fontSize'] },
];

/** The scenes, in the order they are shown. The words are the scene's own business on each side; what a scene shows is described here. */
export const SCENES = [
  { name: 'closed', what: 'The window with the palette closed: only the top row\'s Search control.' },
  { name: 'empty', what: 'Opened with no scope and no query: the Go to section of plugin homes, the first row active, the footer with the keys of a place.' },
  { name: 'scoped', what: 'Opened from a tab that has a scope: the plugin chip and the scope chip, the plugin\'s suggestions, the first row active.' },
  { name: 'query', what: 'No scope, a query that matches in more than one section (a Tabs section and a Go to section), the matched run in weight 600, the first row active.' },
  { name: 'none', what: 'No scope, a query that matches nothing: the note, then the suggestions. The footer is the first suggestion\'s keys.' },
  { name: 'noneScoped', what: 'A scope, a query that matches nothing: the note, the Search everywhere row, then the suggestions.' },
  { name: 'commands', what: 'The Commands kind selected (a `>` typed first): the selected face of the kinds strip moves; the rows are commands with their key hints.' },
];

/** Reads every part of `parts` from the page on one `side` ('mock' or 'shell'): `{ [name]: [[x, y, w, h], ...] }` in viewport px, to 0.01, `[]` for a part that is not there. */
export function readParts(page, parts, side) {
  return page.evaluate(
    ([specs, which]) => {
      const r2 = (v) => Math.round(v * 100) / 100;
      const rect = (el) => {
        const b = el.getBoundingClientRect();
        return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
      };
      const out = {};
      for (const spec of specs) {
        const selector = which === 'mock' ? spec.mock : spec.shell;
        out[spec.name] = spec.all ? [...document.querySelectorAll(selector)].map(rect) : [document.querySelector(selector)].filter(Boolean).map(rect);
      }
      return out;
    },
    [parts, side],
  );
}

/** Reads the paint (STYLES) of the parts in `parts`: `{ '<name>' or '<name>#<index>': { prop: value } }`. A part that is not there is left out. */
export function readStyles(page, parts, side) {
  return page.evaluate(
    ([specs, styles, which]) => {
      const out = {};
      for (const style of styles) {
        const spec = specs.find((candidate) => candidate.name === style.name);
        if (spec === undefined) continue;
        const selector = which === 'mock' ? spec.mock : spec.shell;
        const element = [...document.querySelectorAll(selector)][style.index ?? 0];
        if (element === undefined) continue;
        const computed = getComputedStyle(element);
        out[style.index === undefined ? style.name : `${style.name}#${style.index}`] = Object.fromEntries(style.props.map((prop) => [prop, computed[prop]]));
      }
      return out;
    },
    [parts, STYLES, side],
  );
}

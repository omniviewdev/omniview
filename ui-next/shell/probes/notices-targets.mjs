// What the notices probe compares, in one place: each part of the toast layer by the selector that finds it in the design mock (the reference, measured by mock-notices-measure.mjs into
// mock-notices.json) and by the selector that finds it in the shell (data-notices-part, written by ui-next/shell/notices). Page-agnostic: the same reading runs on both sides. A part with `all` is
// every element that matches, in document order; the others are the first.
//
// Compared by what:
//   - PARTS are compared as rectangles [x, y, w, h] in viewport px (to 0.01): the layer, the host, every toast and, inside each toast, the glyph (box and svg), the main column, the title, the message,
//     the actions row, each action button (and its svg), the dismiss button (and its svg). Words are fixed by SCENES, so widths and heights of text compare too.
//   - STYLES are compared as computed-value strings (the paint): colours as the engine computes them (`rgb(...)`), lengths in px, so the two sides compare as strings. A style that is not there on a
//     side (the part is missing) is a deviation of that side.
//   - The mock's `:not(.notify__reason)` on `message` leaves out the second message line the mock draws for a disabled action; no scene has one.
//
// The scenes are what both sides are asked to show. The words are FIXED (the same strings on both sides).

/** The parts of the surface. `mock` is relative to the whole document; the mock draws its toasts as `.notify[data-surface="toast"]` in `.notify-host` in `#feedback`. */
export const PARTS = [
  { name: 'layer', mock: '#feedback', shell: '[data-notices-part="layer"]' },
  { name: 'host', mock: '.notify-host', shell: '[data-notices-part="host"]' },
  { name: 'toast', all: true, mock: '.notify-host > .notify[data-surface="toast"]', shell: '[data-notices-part="toast"]' },
  { name: 'glyph', all: true, mock: '.notify[data-surface="toast"] .notify__glyph', shell: '[data-notices-part="toast"] [data-notices-part="glyph"]' },
  { name: 'glyphSvg', all: true, mock: '.notify[data-surface="toast"] .notify__glyph svg', shell: '[data-notices-part="glyph"] svg' },
  { name: 'main', all: true, mock: '.notify[data-surface="toast"] .notify__main', shell: '[data-notices-part="main"]' },
  { name: 'title', all: true, mock: '.notify[data-surface="toast"] .notify__title', shell: '[data-notices-part="title"]' },
  { name: 'message', all: true, mock: '.notify[data-surface="toast"] .notify__message:not(.notify__reason)', shell: '[data-notices-part="message"]' },
  { name: 'actions', all: true, mock: '.notify[data-surface="toast"] .notify__actions', shell: '[data-notices-part="actions"]' },
  { name: 'action', all: true, mock: '.notify[data-surface="toast"] .notify__actions button', shell: '[data-notices-part="actions"] button' },
  { name: 'actionSvg', all: true, mock: '.notify[data-surface="toast"] .notify__actions button svg', shell: '[data-notices-part="actions"] button svg' },
  { name: 'dismiss', all: true, mock: '.notify[data-surface="toast"] .notify__dismiss', shell: '[data-notices-part="dismiss"]' },
  { name: 'dismissSvg', all: true, mock: '.notify[data-surface="toast"] .notify__dismiss svg', shell: '[data-notices-part="dismiss"] svg' },
];

/**
 * The paint of the parts, exactly: which computed properties are read of which part (the first element, or the `index`-th of an `all` part). `action` 0 is the primary button of the failure scene;
 * `glyph` and `glyphSvg` 0 to 2 are the colours of the severity glyphs (the svg carries the severity colour) (the summary's, then the two newest toasts' of the cap scene). A colour is read as the engine computes it (`rgb(...)`).
 */
export const STYLES = [
  { name: 'layer', props: ['position', 'zIndex', 'pointerEvents', 'width', 'display'] },
  { name: 'host', props: ['rowGap', 'display', 'flexDirection', 'pointerEvents'] },
  {
    name: 'toast',
    props: ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'color', 'fontSize', 'fontWeight', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'columnGap', 'minHeight', 'boxSizing', 'boxShadow', 'opacity', 'pointerEvents', 'textAlign'],
  },
  { name: 'toast', index: 1, props: ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'color'] },
  { name: 'toast', index: 2, props: ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'color'] },
  { name: 'title', props: ['color', 'fontSize', 'fontWeight', 'lineHeight'] },
  { name: 'message', props: ['color', 'fontSize', 'fontWeight', 'lineHeight'] },
  { name: 'actions', props: ['columnGap', 'rowGap', 'marginTop', 'display'] },
  { name: 'action', index: 0, props: ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'color', 'fontSize', 'fontWeight', 'lineHeight', 'borderTopLeftRadius', 'height', 'paddingLeft', 'paddingRight', 'columnGap'] },
  { name: 'actionSvg', index: 0, props: ['color', 'width', 'height'] },
  { name: 'glyph', index: 0, props: ['color'] },
  { name: 'glyph', index: 1, props: ['color'] },
  { name: 'glyph', index: 2, props: ['color'] },
  { name: 'glyphSvg', index: 0, props: ['color', 'width', 'height'] },
  { name: 'glyphSvg', index: 1, props: ['color'] },
  { name: 'glyphSvg', index: 2, props: ['color'] },
  { name: 'dismiss', props: ['color', 'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'width', 'height', 'marginTop', 'marginRight'] },
  { name: 'dismissSvg', props: ['color', 'width', 'height'] },
];

/** The scenes, in the order they are shown. Each is raised on the mock's default list page of a connection, with the placement at HOME. The words are the same on both sides. */
export const SCENES = [
  { name: 'info', what: 'One toast: severity info, title "Connection added", message "prod-east is ready to use.", no actions.' },
  { name: 'failure', what: 'One toast: severity error, title "Timed out", message "The cluster did not complete the request in time.", one action "Retry" painted as the primary button.' },
  { name: 'cap', what: 'Five message notices from five sources, titles "Notice 1" to "Notice 5", severities info, success, warning, error, info, no messages: the summary toast ("3 more notifications") above the two newest.' },
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

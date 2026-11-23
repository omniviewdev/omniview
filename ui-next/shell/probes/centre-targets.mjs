// What the notification-centre probe compares, in one place: each part of the centre (the bell in the status bar and the popover of notification history) by the selector that finds it in the design mock
// (the reference, measured by mock-notice-centre-measure.mjs into mock-notice-centre.json). `shell` is the selector that finds the same part in the shell; it is null until the shell's centre is built and
// the lead fills it in. Page-agnostic: the same reading runs on both sides. A part with `all` is every element that matches, in document order; the others are the first.
//
// Compared by what:
//   - PARTS are compared as rectangles [x, y, w, h] in viewport px (to 0.01). A per-row part (`rowText`, `rowDot`, ...) lists only the rows that HAVE it, in document order: a row with no message has no
//     `rowText` entry, so align by the row's facts (`facts.rows[i].hasMessage`), not by index.
//   - STYLES are compared as computed-value strings (the paint), as in notices-targets.mjs.
//   - The mock's `centreSeg` (the view control) and `centreFooter` are recorded only: the shell's centre has neither.
//   - The mock's rows are `.notify[data-surface="center"]`; the Dismiss button of a row is always in the DOM and has a box: it is hidden by `opacity: 0` (and `pointer-events: none`) until the row is hovered or focused.
//
// The scenes are what both sides are asked to show; the words are FIXED (the same strings on both sides).
import { readParts } from './notices-targets.mjs';

export { readParts };

const POPOVER = '#statusitem-bell-popover';
const BELL = '.statusitem[data-key="bell"]';
const ROW = `${POPOVER} .notify[data-surface="center"]`;

export const FILTER_MENU = '[role="menu"][aria-label="Filter notifications"]';

/** The parts of the surface. `mock` is relative to the whole document. */
export const PARTS = [
  { name: 'statusBar', mock: 'footer.statusbar', shell: 'footer[data-shell-region="statusBar"]' },
  { name: 'bell', mock: BELL, shell: '[data-notices-part="bell"]' },
  { name: 'bellGlyph', mock: `${BELL} .statusitem__slot`, shell: '[data-notices-part="bellGlyph"]' },
  { name: 'bellDot', mock: `${BELL} .statusitem__dot`, shell: '[data-notices-part="bellDot"]' },
  { name: 'centre', mock: POPOVER, shell: '[data-notices-part="centre"]' },
  { name: 'centreHeader', mock: `${POPOVER} .panel-header`, shell: '[data-notices-part="centreHeader"]' },
  { name: 'centreTitle', mock: `${POPOVER} .panel-header h3`, shell: '[data-notices-part="centreTitle"]' },
  { name: 'centreBar', mock: `${POPOVER} .fbc__bar`, shell: '[data-notices-part="centreBar"]' },
  { name: 'centreSeg', mock: `${POPOVER} .fbc__bar .seg`, shell: null },
  { name: 'centreTools', mock: `${POPOVER} .fbc__tools`, shell: '[data-notices-part="centreTools"]' },
  { name: 'centreTool', all: true, mock: `${POPOVER} .fbc__tools > button`, shell: '[data-notices-part="centreTools"] button' },
  { name: 'centreNote', all: true, mock: `${POPOVER} .fbc__note`, shell: '[data-notices-part="centreNote"]' },
  { name: 'centreNoteText', all: true, mock: `${POPOVER} .fbc__notetext`, shell: '[data-notices-part="centreNoteText"]' },
  { name: 'centreNoteButton', all: true, mock: `${POPOVER} .fbc__note button`, shell: '[data-notices-part="centreNoteButton"]' },
  { name: 'centreFooter', mock: `${POPOVER} .panel-footer`, shell: null },
  { name: 'centreBody', mock: `${POPOVER} .statuspopover__body`, shell: '[data-notices-part="centreBody"]' },
  { name: 'centreScroll', mock: `${POPOVER} .fbc__scroll`, shell: '[data-notices-part="centreScroll"]' },
  { name: 'centreList', mock: `${POPOVER} .fbc__scroll .notify-list`, shell: '[data-notices-part="centreList"]' },
  { name: 'centreLabel', all: true, mock: `${POPOVER} .fbc__list > .sectionlabel`, shell: '[data-notices-part="centreList"] > li:has(> [data-notices-part="centreLabel"])' },
  { name: 'row', all: true, mock: ROW, shell: '[data-notices-part="row"]' },
  { name: 'rowToggle', all: true, mock: `${ROW} > .notify__toggle`, shell: '[data-notices-part="rowToggle"]' },
  { name: 'rowGlyph', all: true, mock: `${ROW} > .notify__toggle > .notify__glyph`, shell: '[data-notices-part="rowGlyph"]' },
  { name: 'rowTitle', all: true, mock: `${ROW} > .notify__toggle .notify__title`, shell: '[data-notices-part="rowTitle"]' },
  { name: 'rowText', all: true, mock: `${ROW} > .notify__toggle .notify__message`, shell: '[data-notices-part="rowText"]' },
  { name: 'rowTime', all: true, mock: `${ROW} > .notify__toggle .notify__time`, shell: '[data-notices-part="rowTime"]' },
  { name: 'rowDot', all: true, mock: `${ROW} > .notify__toggle .notify__unread`, shell: '[data-notices-part="rowDot"]' },
  { name: 'rowDismiss', all: true, mock: `${ROW} .notify__dismiss`, shell: '[data-notices-part="rowDismiss"]' },
  { name: 'rowDetail', all: true, mock: `${ROW} > .notify__detail`, shell: '[data-notices-part="rowDetail"]' },
  { name: 'rowActions', all: true, mock: `${ROW} > .notify__actions`, shell: '[data-notices-part="rowActions"]' },
  { name: 'rowAction', all: true, mock: `${ROW} > .notify__actions button`, shell: '[data-notices-part="rowActions"] button' },
  { name: 'centreEmpty', mock: `${POPOVER} .fbc__scroll .empty2`, shell: '[data-notices-part="centreEmpty"]' },
  { name: 'centreEmptyIcon', mock: `${POPOVER} .empty2 .bigicon`, shell: '[data-notices-part="centreEmptyIcon"]' },
  { name: 'centreEmptyTitle', mock: `${POPOVER} .empty2 b`, shell: '[data-notices-part="centreEmptyTitle"]' },
  { name: 'centreEmptyHint', mock: `${POPOVER} .empty2 .tiny`, shell: '[data-notices-part="centreEmptyHint"]' },
  { name: 'centreMenu', mock: `${POPOVER} .menu[role="menu"]`, shell: FILTER_MENU },
  { name: 'centreMenuItem', all: true, mock: `${POPOVER} .menu[role="menu"] .menu__item`, shell: `${FILTER_MENU} [role^="menuitem"]` },
];

const BOX = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
const EDGE = ['borderTopColor', 'borderTopWidth', 'borderBottomColor', 'borderBottomWidth'];
const TEXT = ['color', 'fontSize', 'fontWeight', 'lineHeight'];
const SIZE = ['width', 'height'];
const BUTTON = ['backgroundColor', 'color', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'height', 'paddingLeft', 'paddingRight', 'columnGap', 'fontSize', 'fontWeight', 'lineHeight', 'opacity', 'cursor'];

/**
 * The paint of the parts, exactly: which computed properties are read of which part (the first element, or the `index`-th of an `all` part). `bellDot` is the dot of the scene's own tone (the three bell scenes read
 * one each); `rowDot` and `rowGlyph` 0 to 4 are the unread mark and the severity glyph of the rows of scene `list` (error unread, warning unread, info read, info read, success read) and of the four rows of scene `dots`
 * (an unread one of each severity). A colour is read as the engine computes it (`rgb(...)`).
 */
export const STYLES = [
  { name: 'bell', props: ['color', 'backgroundColor', 'borderTopLeftRadius', ...BOX, ...SIZE, 'display'] },
  { name: 'bellGlyph', props: [...SIZE, 'display'] },
  { name: 'bellDot', props: ['backgroundColor', ...SIZE, 'borderTopLeftRadius', 'boxShadow', 'top', 'right', 'position'] },
  { name: 'centre', props: ['backgroundColor', 'color', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'boxShadow', ...SIZE, 'overflow', 'display', 'flexDirection'] },
  { name: 'centreHeader', props: [...BOX, ...EDGE, 'fontSize', 'fontWeight', 'lineHeight', 'display', 'alignItems', 'minHeight'] },
  { name: 'centreTitle', props: [...TEXT, 'fontFamily', 'marginTop', 'marginBottom'] },
  { name: 'centreBar', props: [...BOX, ...EDGE, 'rowGap', 'display', 'flexDirection'] },
  { name: 'centreSeg', props: ['display', ...SIZE, 'backgroundColor', 'borderTopLeftRadius', 'fontSize'] },
  { name: 'centreTools', props: ['columnGap', 'display', 'justifyContent', 'alignItems', ...SIZE] },
  { name: 'centreTool', index: 0, props: BUTTON },
  { name: 'centreTool', index: 1, props: BUTTON },
  { name: 'centreTool', index: 2, props: BUTTON },
  { name: 'centreNote', index: 0, props: [...TEXT, 'columnGap', 'display', 'alignItems', ...SIZE] },
  { name: 'centreNoteText', index: 0, props: [...TEXT, 'overflowX', 'textOverflow', 'whiteSpace'] },
  { name: 'centreNoteButton', index: 0, props: BUTTON },
  { name: 'centreScroll', props: [...BOX, 'overflowX', 'overflowY'] },
  { name: 'centreList', props: ['display', 'rowGap', 'flexDirection', 'listStyleType', 'marginTop', 'paddingTop'] },
  { name: 'centreLabel', index: 0, props: [...TEXT, ...BOX, 'textTransform', 'letterSpacing', 'height', 'display'] },
  { name: 'row', index: 0, props: ['display', 'position', 'borderTopLeftRadius', 'backgroundColor', 'color', 'height'] },
  { name: 'rowToggle', index: 0, props: [...BOX, 'minHeight', 'height', 'display', 'gridTemplateColumns', 'columnGap', 'alignItems', 'borderTopLeftRadius', 'backgroundColor', 'color', 'textAlign', 'cursor', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'boxShadow'] },
  { name: 'rowGlyph', index: 0, props: ['color', ...SIZE] },
  { name: 'rowGlyph', index: 1, props: ['color'] },
  { name: 'rowGlyph', index: 2, props: ['color'] },
  { name: 'rowGlyph', index: 3, props: ['color'] },
  { name: 'rowGlyph', index: 4, props: ['color'] },
  { name: 'rowTitle', index: 0, props: [...TEXT, 'overflowX', 'textOverflow', 'whiteSpace', 'display'] },
  { name: 'rowTitle', index: 2, props: [...TEXT] },
  { name: 'rowText', index: 0, props: [...TEXT, 'overflowX', 'textOverflow', 'whiteSpace', 'display'] },
  { name: 'rowTime', index: 0, props: [...TEXT, 'minWidth', 'textAlign', 'fontVariantNumeric', 'whiteSpace'] },
  { name: 'rowTime', index: 2, props: [...TEXT] },
  { name: 'rowDot', index: 0, props: ['backgroundColor', ...SIZE, 'borderTopLeftRadius', 'display'] },
  { name: 'rowDot', index: 1, props: ['backgroundColor', ...SIZE] },
  { name: 'rowDot', index: 2, props: ['backgroundColor', ...SIZE] },
  { name: 'rowDot', index: 3, props: ['backgroundColor'] },
  { name: 'rowDot', index: 4, props: ['backgroundColor'] },
  { name: 'rowToggle', index: 1, props: ['backgroundColor', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'boxShadow'] },
  { name: 'rowDismiss', index: 1, props: ['color', 'backgroundColor', 'opacity', 'pointerEvents', ...SIZE] },
  { name: 'rowActions', index: 1, props: ['display', 'position', 'opacity', 'pointerEvents', 'right', ...SIZE] },
  { name: 'rowDismiss', index: 0, props: ['color', 'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', ...SIZE, 'opacity', 'pointerEvents', 'marginTop', 'marginRight', 'cursor'] },
  { name: 'rowDetail', index: 0, props: [...BOX, 'display', 'rowGap', 'marginTop', 'marginLeft'] },
  { name: 'rowActions', index: 0, props: ['display', 'position', 'opacity', 'pointerEvents', 'columnGap', 'rowGap', 'flexWrap', 'justifyContent', 'minHeight', 'marginLeft', 'marginTop', 'right', ...BOX, ...SIZE] },
  { name: 'rowAction', index: 0, props: BUTTON },
  { name: 'rowAction', index: 1, props: BUTTON },
  { name: 'centreEmpty', props: ['display', 'flexDirection', 'alignItems', 'justifyContent', 'textAlign', 'rowGap', 'columnGap', ...BOX, ...SIZE] },
  { name: 'centreEmptyIcon', props: ['color', ...SIZE, 'fontSize', 'display', 'marginBottom'] },
  { name: 'centreEmptyTitle', props: [...TEXT, 'display'] },
  { name: 'centreEmptyHint', props: [...TEXT, 'maxWidth'] },
  { name: 'centreMenu', props: ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'boxShadow', ...SIZE, ...BOX, 'color'] },
  { name: 'centreMenuItem', index: 0, props: [...TEXT, ...BOX, 'height', 'columnGap', 'borderTopLeftRadius', 'backgroundColor', 'display'] },
  { name: 'centreMenuItem', index: 1, props: [...TEXT, ...BOX, 'height', 'columnGap', 'borderTopLeftRadius', 'backgroundColor', 'display'] },
];

/** The scenes, in the order they are shown. Each starts from a FRESH page (no records), seeded with the mock's own API; the words are the same on both sides. */
export const SCENES = [
  { name: 'closed', what: 'No records; the status bar and its bell without a dot; the popover is not opened.' },
  { name: 'bell-info', what: 'One unread info record; only the bell and its dot (info tone) are read; the popover is closed.' },
  { name: 'bell-warning', what: 'One unread warning record; only the bell and its dot (warning tone) are read; the popover is closed.' },
  { name: 'bell-error', what: 'One unread error record; only the bell and its dot (error tone) are read; the popover is closed.' },
  { name: 'empty', what: 'The centre open with no records: the "No notifications" empty state.' },
  { name: 'list', what: 'Open, five records, newest first. TODAY: error unread p1 "Timed out" / "The cluster did not complete the request in time."; warning unread p2 "Signed out" / "Sign in again to continue."; info read p1 "Connection added" / "prod-east is ready to use."; info read p3 "Update available" (no message). YESTERDAY: success read p3 "Snapshot created" / "It is ready to restore."' },
  { name: 'expanded', what: 'Scene list, with the first record a failed operation with a Retry, and its row expanded: Retry and Dismiss shown.' },
  { name: 'filtered', what: 'Scene list with the source filter p1: the filter note row with "Clear filters".' },
  { name: 'muted', what: 'Scene list with p1 muted: the muted note row with "Unmute".' },
  { name: 'menu', what: 'Scene filtered with the Filter menu open (the shared menu mounted inside the popover).' },
  { name: 'dots', what: 'Extra (not in the brief): the centre open with four unread records, severities info, success, warning, error, to read the unread dot in each tone.' },
];

/** Reads the paint (STYLES) of the parts in `parts`: `{ '<name>' or '<name>#<index>': { prop: value } }`. A part that is not there is left out. Same reading as readStyles of notices-targets.mjs, over THIS file's STYLES. */
export function readStyles(page, parts, side) {
  return page.evaluate(
    ([specs, styles, which]) => {
      const out = {};
      for (const style of styles) {
        const spec = specs.find((candidate) => candidate.name === style.name);
        if (spec === undefined) continue;
        const selector = which === 'mock' ? spec.mock : spec.shell;
        if (selector === null) continue;
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

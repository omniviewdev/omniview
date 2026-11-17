// What the page probe compares, in the design mock's reference (packages/kit/probes/mock-page.json) and in the fixture, with the same names.
//
// A target says where the mock's number is (`ref`: a key of the record, a path, or a function of the record) and where the page's is (`sel`: a selector in
// the page region; `nth` picks one of several). The numbers compared are `keys` of the rectangle: x, y, w, h, and the right edge r and the bottom edge b.
// `flex` lists the keys that depend on the room or the text (2 px instead of 1). `adjust` is a known, exact difference by construction, in px, applied
// to the mock's number: the page draws less than the mock's list (no Create, no overflow, no pickers) and the reasons are written beside each.
// A target with `words: false` is a text box whose words differ from the mock's: its x, y and height are compared, its width is not.

/** Where a part of the mock's record is: a key (or a dotted path) of the record, or another record of the reference. */
export const at = (section, id, path) => ({ section, id, path });

const lane = '[role="group"][aria-label$=" commands"]';

/**
 * The page chrome of the list, against the mock's `list` and `listNarrow` records. Both records have
 * the same chrome: listNarrow differs in the table's columns only.
 */
export const CHROME = [
  { name: 'dataView', ref: 'dataView', sel: '[data-ov-state]' },
  { name: 'dvHeader', ref: 'dvHeader', sel: '[data-ov-part="header"]' },
  { name: 'dvBody', ref: 'dvBody', sel: '[data-ov-part="body"]' },
  { name: 'dvFooter', ref: 'dvFooter', sel: '[data-ov-part="footer"]' },
  { name: 'pageHeader', ref: 'header', sel: 'header' },
  { name: 'headerRow', ref: 'row', sel: '[data-ov-row]' },
  // The mock's title shares its row with Create, Refresh and an overflow (921.23 wide at 1440); the page draws Refresh alone, so its width is the
  // mock's header with Refresh alone (`h-list`, below). Here the title's x, y and height.
  { name: 'title', ref: 'title', sel: 'h1', keys: 'xyh' },
  // The lane: the page has only Refresh, so the lane is 28 wide; what the two have in common is the right edge, the top and the height.
  { name: 'commands', ref: 'commands', sel: lane, keys: 'ryh' },
  // Refresh: the mock's list draws it before an overflow (28 wide and an 8 px gap), so its left edge is 36 px further left than the page's.
  { name: 'refresh', ref: 'cmd1', sel: `${lane} button`, adjust: { x: 36 } },
  { name: 'quick', ref: 'quick', sel: '[data-ov-block="filters"] > [role="group"]' },
  { name: 'chipAll', ref: 'chipAll', sel: '[data-ov-block="filters"] button', nth: 0 },
  { name: 'chipRunning', ref: 'chipRunning', sel: '[data-ov-block="filters"] button', nth: 1 },
  { name: 'chipPending', ref: 'chipPending', sel: '[data-ov-block="filters"] button', nth: 2 },
  { name: 'chipFailed', ref: 'chipFailed', sel: '[data-ov-block="filters"] button', nth: 3 },
  { name: 'chipCompleted', ref: 'chipCompleted', sel: '[data-ov-block="filters"] button', nth: 4 },
  { name: 'toolbar', ref: 'toolbar', sel: '[data-ov-block="toolbar"] > [role="group"]' },
  // The mock's field shares its lane with two pickers and the Columns chooser (3 siblings and 3 gaps of 8: 344.81 px); the page's takes the whole lane.
  { name: 'search', ref: (rec) => [rec.searchInput.r[0], rec.searchInput.r[1], rec.toolbar.r[2], rec.searchInput.r[3]], sel: 'input[type="search"]', flex: 'w' },
  { name: 'searchIcon', ref: 'searchIcon', sel: '[data-ov-block="toolbar"] svg[data-ov-glyph="search"]' },
  { name: 'thead', ref: 'thead', sel: 'thead' },
  { name: 'firstRow', ref: 'tr0', sel: 'tbody tr[data-ov-index]' },
  { name: 'count', ref: 'cluster0', sel: '[data-ov-part="footer"] [data-ov-cluster="lead"]', keys: 'xyh', flex: 'w' },
  { name: 'countText', ref: 'footerRuns.0', sel: '[data-ov-part="footer"] [data-ov-cluster="lead"]', kind: 'text', keys: 'xyh' },
];

/** The same chips as words: the counts are the mock's, All 89, Running 78, Pending 0, Failed 2, Completed 9. */
export const CHIP_NAMES = ['chipAll', 'chipRunning', 'chipPending', 'chipFailed', 'chipCompleted'];

/** The gaps the design fixes, from the rectangles read: 12 under the page header, 8 under the strip, 8 under the toolbar. */
export const GAPS = [
  { name: 'gap header to quick', from: 'pageHeader', to: 'quick', want: 12 },
  { name: 'gap quick to toolbar', from: 'quick', to: 'toolbar', want: 8 },
  { name: 'gap toolbar to thead', from: 'toolbar', to: 'thead', want: 8 },
];

/**
 * What the mock's list draws and the page does not, by the lead's rulings and the slice plan: the probe checks that it is absent (a selector with no
 * match), so a part that appears is a decision, not an accident.
 */
export const ABSENT = [
  { name: 'Create command', ref: 'cmd0', sel: `${lane} button`, count: 1, why: 'no Create on the page: the lane is Refresh alone (PX1, plan 1.2 tier C)' },
  { name: 'overflow trigger', ref: 'cmd2', sel: `${lane} button[aria-haspopup]`, count: 0, why: 'no overflow on the page (PX1, plan 1.2 tier C)' },
  { name: 'pickers', ref: 'facet0', sel: '[data-ov-block="toolbar"] > [role="group"] > *', count: 1, why: 'the toolbar is the search field alone: the pickers and the Columns chooser are later steps (plan 1.2)' },
  { name: 'hidden-columns note', ref: 'cluster1', sel: '[data-ov-part="footer"] [data-ov-cluster="end"]', count: 0, why: 'the page omits the note (lead ruling 3, errata E6 pending)', only: '1030x720' },
];

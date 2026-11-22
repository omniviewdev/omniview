// The list page's chrome (1a.3c): the real Shell, ListPage and PageHeader around invented data (ui-next/page/probes/fixture.tsx) against the pinned mock reference (packages/kit/probes/mock-page.json, measured from the mock by
// mock-page-measure.mjs), in WebKit and Chromium at 1440 x 900 and 1030 x 720 (the viewports of probe-lib.mjs; tracker row N23 moves them): the rectangles of the data view, header, title, command lane, quick filters and chips,
// toolbar and search field, table header, first row and footer, the 12/8/8 gaps, and a frame sampler around Refresh and every operation state, where no part moves by 0.001 px; and the list's sort (K3a,
// ui-next/page/probes/sort.mjs) at 1440 x 900 and 1280 x 800: the header's button and `aria-sort`, the order after each press of every header, the keyboard, a live update and the detectors made to see one fault each, and, with
// 5,000 rows in a production build, one React commit for a press, the same few rows mounted and no key read again when a column is turned round. It builds its own fixture, so it does not read PROBE_DIST. It has no negative
// controls.
export const units = [
  {
    id: 'page',
    name: 'Probe the list page chrome and its layout shift against the pinned mock reference',
    script: 'ui-next/page/probes/page-probe.mjs',
    seconds: 70,
  },
];

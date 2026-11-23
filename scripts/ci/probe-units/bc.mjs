// The kit's other parts (1a.4b/c): Chip, Status, MissingValue, KindTile, QuickFilters (with RovingGroup) and MiddleEllipsis against the pinned mock reference (packages/kit/probes/mock-atoms-bc.json, measured by
// mock-measure-bc.mjs) in WebKit and Chromium at 1440 x 900 and 1030 x 720: 118 parity cases, the strip at three widths, the ellipsis at ten, element counts, no write to <html> or <body>, the accessibility tree, axe-core, and at
// 1440 x 900 the roving keyboard traces and the paint and axe of the nine themes. A deviation its KNOWN_DEVIATIONS does not name exits 1. It reads the ui-next build the shard makes. It has no negative controls.
export const units = [
  {
    id: 'bc',
    name: 'Probe the chip, status, missing value, kind tile, quick filters and middle ellipsis against the pinned mock reference',
    script: 'packages/kit/probes/kit-probe-bc.mjs',
    env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/bc-probe.json' },
    seconds: 250,
  },
];

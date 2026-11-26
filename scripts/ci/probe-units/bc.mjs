// The kit's other parts (1a.4b/c): Chip, Status, MissingValue, KindTile, QuickFilters (with RovingGroup) and MiddleEllipsis against the pinned mock reference (packages/kit/probes/mock-atoms-bc.json, measured by
// mock-measure-bc.mjs) in WebKit and Chromium at 1440 x 900 and 1030 x 720: 118 parity cases, the strip at three widths, the ellipsis at ten, element counts, no write to <html> or <body>, the accessibility tree, axe-core, and at
// 1440 x 900 the roving keyboard traces and the paint and axe of the nine themes. A deviation its KNOWN_DEVIATIONS does not name exits 1. It reads the ui-next build the shard makes. It has no negative controls.
// It took 510 s on the runner in the nightly of 2026-11-25 (run 45701206187, shard 2: WebKit 187 and 92 s, Chromium 155 and 75 s), 219 s before: the frame page it reads grew from 4,192 to 20,497 elements with the
// parts of #765. That is over the 432 s a unit may be listed at, and a probe is one unit, so it is listed at the limit: the plan gives it a shard of its own (510 s and the slowest setup, 137 s, are under the
// 15-minute wall), where with `log` (190 s listed, more than 265 s on that run) it passed the wall and the shard was cancelled.
export const units = [
  {
    id: 'bc',
    name: 'Probe the chip, status, missing value, kind tile, quick filters and middle ellipsis against the pinned mock reference',
    script: 'packages/kit/probes/kit-probe-bc.mjs',
    env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/bc-probe.json' },
    seconds: 432,
  },
];

// The detail page (D1a) in the real shell fixture: the header, the strip and the first sections against the pinned mock reference (packages/kit/probes/mock-detail.json), loading to ready with no part moving, and the
// keyboard path through the strip, at 1440 x 900 and 1280 x 800. It builds its own fixture, so it does not read PROBE_DIST. It has no negative controls.
export const units = [
  {
    id: 'detail',
    name: 'Probe the detail page against the pinned mock reference',
    script: 'ui-next/page/probes/detail-probe.mjs',
    seconds: 19,
  },
];

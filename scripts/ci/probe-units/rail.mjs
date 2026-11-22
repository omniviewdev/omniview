// The rail (S2a): its entries' targets, faces and glyphs, and the paint of the current entry and of another in six states, against the pinned mock reference (ui-next/shell/probes/mock-rail.json, measured from the mock's two
// rails by mock-rail-measure.mjs), at 1440 x 900 and 1280 x 800. It builds its own fixture, so it does not read PROBE_DIST. It has no negative controls.
export const units = [
  {
    id: 'rail',
    name: 'Probe the rail against the pinned mock reference',
    script: 'ui-next/shell/probes/rail-probe.mjs',
    env: { REPORT: '$RUNNER_TEMP/rail-probe.json' },
    seconds: 17,
  },
];

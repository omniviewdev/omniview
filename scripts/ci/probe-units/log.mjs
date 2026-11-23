// The log view (P1b-2): the kit's LogView staged at the size of the mock's Logs tool against the pinned mock reference (packages/kit/probes/mock-log.json, measured from the mock by mock-log-measure.mjs): the regions, the
// header, the rows, the filter row in five states (nothing in it moves), the Tab stops and the list's keys with real key presses, the `copy` event as plain text, the Source column of a log that follows several sources (the
// mock's own measurement of it, and the tooltip a cut name shows on a real hover), and axe, in WebKit and Chromium at 1440 x 900 and 1280 x 800. What differs from the mock on purpose is listed in the probe (KNOWN_DEVIATIONS),
// each with its approval. It reads the ui-next build the shard makes.

export const units = [
  {
    id: 'log',
    name: 'Probe the log view against the pinned mock reference',
    script: 'packages/kit/probes/log-probe.mjs',
    env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/log-probe.json' },
    seconds: 190,
  },

  // The negative controls of the log view probe: each perturbs one measured value in the page (a row's height, the clock column's width, the filter row's place when a count appears, the strip's height, the copy event,
  // the ArrowDown key, an unnamed button, a name that takes no pointer) and passes only when the probe's assertion for it is made and agrees without the perturbation and fails with it.
  {
    id: 'log-controls',
    name: 'Probe that the log probe sees a log view that is wrong',
    script: 'packages/kit/probes/log-probe.mjs',
    env: { DIST: '$PROBE_DIST' },
    controls: ['row-height', 'time-column', 'filter-shift', 'strip-height', 'copy', 'keys', 'axe', 'source-tip'],
    plants: 'page',
    seconds: 145,
  },
];

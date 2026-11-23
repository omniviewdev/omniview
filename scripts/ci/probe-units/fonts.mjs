// The fonts are delivered, used, and the page does not shift. It reads the ui-next build the shard makes.
export const units = [
  {
    id: 'fonts',
    name: 'Probe the fonts and the layout shift',
    script: 'packages/kit/probes/fonts-probe.mjs',
    env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/fonts-probe.json' },
    seconds: 45,
  },
];

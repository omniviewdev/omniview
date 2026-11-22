// The one tooltip host: listeners, cost, delay, Escape layering, placement, motion. It reads the ui-next build the shard makes.
export const units = [
  {
    id: 'tooltip',
    name: 'Probe the tooltip host',
    script: 'packages/kit/probes/tooltip-probe.mjs',
    env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/tooltip-probe.json' },
    seconds: 144,
    paths: ['packages/kit/probes/tooltip-probe.mjs', 'packages/kit/src/components/{TooltipHost,HoverCard}/**', 'ui-next/parts/**'],
  },
];

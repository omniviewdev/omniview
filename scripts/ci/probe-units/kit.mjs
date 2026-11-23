// The kit's parts on the real `ui-next` page against the pinned mock reference (packages/kit/probes/mock-reference.json): parity with the mock, tokens, counts, keyboard, accessibility with axe-core. It reads the ui-next
// build the shard makes. It has no negative controls.
export const units = [
  {
    id: 'kit',
    name: 'Probe the parts against the pinned mock reference',
    script: 'packages/kit/probes/kit-probe.mjs',
    env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/kit-probe.json' },
    seconds: 185,
  },
];

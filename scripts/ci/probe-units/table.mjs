// The table: header, rows, selection column, sort, hover, selected and focus states, the fit, the nine themes, against the pinned mock reference (packages/kit/probes/mock-table.json). It reads the ui-next build the
// shard makes. It has no negative controls.
export const units = [
  {
    id: 'table',
    name: 'Probe the table against the pinned mock reference',
    script: 'packages/kit/probes/table-probe.mjs',
    env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/table-probe.json' },
    seconds: 74,
  },
];

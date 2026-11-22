// The rate on the Logs strip at open (L4, demo defect D2): the host's own Logs session body over a feed that replays the last 5,000 lines of a source that has been writing for a while, each stamped with the time it was
// written and with nothing to mark it a replay (what the runtime's stream does), and then writes 5 lines a second; the strip's text is read every 250 ms for 8 s and never reads above 10 lines/s, tells a rate near 5 within
// 5 s and settles on it (ui-next/shell/probes/logs-open-fixture.tsx), in both engines at 1440 x 900. It builds its own fixture, so it does not read PROBE_DIST.

export const units = [
  {
    id: 'logs-open',
    name: 'Probe the rate on the Logs strip at open',
    script: 'ui-next/shell/probes/logs-open-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/logs-open-probe.json' },
    seconds: 20,
  },

  // The negative control of the probe of the rate at open: the replay is stamped with the instant it is delivered, so the view has no way to tell it from lines the source wrote just now and the strip reads the burst
  // (about 10,000 lines/s in the control's first sample); the probe must fail `rate.max` with it and pass it without (Chromium, 1440 x 900), and the step passes only when it did.
  {
    id: 'logs-open-controls',
    name: 'Probe that the rate at open probe sees a replay counted as live',
    script: 'ui-next/shell/probes/logs-open-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['fresh'],
    seconds: 12,
  },
];

// The strip's rate when a Logs stream opens (S1-host, which replaced L4's inference from the lines' times with the source's own word): the host's own Logs session body over a feed that is told by its producer, as the
// runtime's stream is told by a backend that marks replays. The producer replays the last 5,000 lines of a source, every one flagged as replay, says the replay is over BEFORE the last 1,500 of them were delivered (a marker
// overtakes the lines before it), and then writes 5 lines a second; the strip's text is read every 250 ms for 8 s: it says no rate before the marker, never reads above 10 lines/s, tells a rate near 5 within 6 s and settles on it
// (ui-next/shell/probes/logs-open-fixture.tsx). A second page per engine is a source that is NEVER marked: the strip must say no rate for as long as it lives. Both engines at 1440 x 900. It builds its own fixture, so it does
// not read PROBE_DIST.

export const units = [
  {
    id: 'logs-open',
    name: 'Probe the rate on the Logs strip at open',
    script: 'ui-next/shell/probes/logs-open-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/logs-open-probe.json' },
    seconds: 24,
  },

  // The negative controls of the probe of the rate at open, each the fault one assertion is there to see, run in Chromium with the clean page and the perturbed one side by side, and passing only when the assertion it is named for
  // holds without the perturbation and fails with it: `counted-replay` (the feed counts the lines flagged replay as live: the strip reads the burst; `rate.max`), `no-wait` (the feed has a count before the producer's word: the
  // strip reads 0.0 where it should say no rate; `rate.unknown`) and `timeout-live` (a source that is never marked turns live after 3 s: a figure where it should say no rate, for good; `never.unknown`).
  {
    id: 'logs-open-controls',
    name: 'Probe that the rate at open probe sees a replay counted as live, a source taken for live before its word and one turned live by waiting',
    script: 'ui-next/shell/probes/logs-open-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['counted-replay', 'no-wait', 'timeout-live'],
    seconds: 36,
  },
];

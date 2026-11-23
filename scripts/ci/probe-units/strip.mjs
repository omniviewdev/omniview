// The tab strip, the page host and the load, at 1440 x 900 and 1280 x 800 (decision A15). It builds its own fixtures, so it does not read PROBE_DIST.

export const units = [
  {
    id: 'strip',
    name: 'Probe the tab strip, the page host and the load against the pinned mock reference',
    script: 'ui-next/shell/probes/strip-probe.mjs',
    env: { REPORT: '$RUNNER_TEMP/strip-probe.json' },
    seconds: 215,
  },

  // The negative controls of the strip probe's `arrival` section (Q2a): a tree that does not hold the count slot (`slot-width`) and a skeleton that declares none (`slot-undeclared`) each make a label give way when its
  // count arrives. The probe must see it, and passes only when it does: the label's rectangle is the assertion (the layout-shift observer reads 0 for both, so a probe that only watched it would pass). What they perturb is
  // the sidebar's tree and its count slot.
  {
    id: 'strip-controls',
    name: 'Probe that the strip probe sees a label that gives way to a count',
    script: 'ui-next/shell/probes/strip-probe.mjs',
    controls: ['slot-width', 'slot-undeclared'],
    plants: 'page',
    seconds: 5,
  },
];

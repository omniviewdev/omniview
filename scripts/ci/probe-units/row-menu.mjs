// The delegated menu on the 20,000-row example, opened from top, middle and bottom triggers by mouse and keyboard: popup roots, live
// listeners and observers, virtual row counts, focus, keyboard actions, viewport placement, top-layer clipping and no root style writes.

export const units = [
  {
    id: 'row-menu',
    name: 'Probe the delegated menu on the 20,000-row example',
    script: 'packages/kit/probes/row-menu-probe.mjs',
    env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/row-menu-probe.json' },
    seconds: 25,
  },

  // The negative controls of the row menu probe, each in the page after it loaded, on the one opening that must see it (Chromium, 1440 x 900): the open trigger carries no `aria-expanded` (`trigger-not-expanded`), and the next
  // row's trigger carries it too (`expanded-twice`). Each passes only when the opening is clean without the perturbation and the one failure with it is the named one; with that failure dropped (ASSERTION_OFF) it is not
  // detected.
  {
    id: 'row-menu-controls',
    name: 'Probe that the row menu probe sees a trigger that does not say it is open',
    script: 'packages/kit/probes/row-menu-probe.mjs',
    env: { DIST: '$PROBE_DIST' },
    controls: ['trigger-not-expanded', 'expanded-twice'],
    plants: 'page',
    seconds: 5,
  },
];

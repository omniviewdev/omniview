// The row menu (1a.3b) on the 5,000-row example, opened from a trigger at the top, middle and bottom of the table region with the mouse and four keys, mid-window and at the window's bottom edge: popup roots 0/1/0, the
// listeners an open menu adds (a press, a scroll and a resize on the window, none left), observers, focus after open and after Escape, placement and flip, no clipping in the top layer, an element count that does not depend
// on the rows, row heights, arrows, Home, End, Escape and Tab, and no write to <html> or <body>. `aria-expanded` is read on the menu's TRIGGERS (`button[aria-haspopup="menu"]`), as the kit's contract says: the handle writes it
// on the one trigger that is open. It reads the ui-next build the shard makes.

export const units = [
  {
    id: 'row-menu',
    name: 'Probe the row menu on the 5,000-row example',
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
    seconds: 2,
  },
];

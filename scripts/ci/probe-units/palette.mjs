// The command palette (C1b) in the real shell fixture (ui-next/shell/probes/palette-fixture.tsx: the real view, model and tab model over invented sources), against the pinned mock reference
// (ui-next/shell/probes/mock-palette.json, measured from the mock's own palette in seven scenes by mock-palette-measure.mjs): the Search control, the frame, the input, the kinds, the list, the status band and the footer
// within 1 px, the paint of each, the keyboard with real key presses (the chord, the arrows, Enter and Command Enter, Escape and where the focus goes, Tab, the inert page, hover), the states and axe on each, and what it costs
// with 1,000 host rows (open and keystroke to rows painted, recorded; one commit a keystroke, no layout shift, and a closed palette that holds one listener and no timer, judged), at 1440 x 900 and 1280 x 800.
// FONT_DELAY_MS=40 serves the fonts as a runner does. It builds its own fixtures, so it does not read PROBE_DIST.

export const units = [
  {
    id: 'palette',
    name: 'Probe the command palette against the pinned mock reference',
    script: 'ui-next/shell/probes/palette-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/palette-probe.json' },
    seconds: 285,
  },

  // The negative controls of the palette probe: each perturbs one measured value in the page (the frame's width, a row's height, the footer's height, the Search control's place, the gap between two keys of the footer,
  // the paint of the active row, hover that takes the keyboard's row, a palette that does not give the focus back) and passes only when the probe sees it. The widths of the Search control, of its hint and of the footer's
  // keys are not compared, because a key is written for the platform (the mock was measured on a Mac: the Command sign and K; a Linux runner writes Ctrl+K).
  {
    id: 'palette-controls',
    name: 'Probe that the palette probe sees a palette that is wrong',
    script: 'ui-next/shell/probes/palette-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['frame-width', 'row-height', 'foot-height', 'search-place', 'foot-gap', 'paint', 'hover-steals', 'no-restore'],
    plants: 'page',
    seconds: 105,
  },
];

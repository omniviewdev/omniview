// The toast layer (O1b-1) and the notification centre (O1b-2): the real shell with its panel and its command palette and the real `Toasts`, bell and centre over the notices model (ui-next/shell/probes/notices-fixture.tsx),
// against the mock's own toast layer (ui-next/shell/probes/mock-notices.json, measured by mock-notices-measure.mjs in three scenes: an info toast, a failure with its Retry, the stack at the cap) within 1 px and its paint
// exactly, axe on the layer and the two live regions, the keyboard path (F6 reaches the toasts last, Tab, Escape and the focus given back), what a toast lives for and what holds it (a clock the probe drives), what a screen
// reader is told (the roles, once, never twice), what 50 notices in one tick cost (one commit for each flush, nothing shifts, nothing held once the stack is empty) and where the stack stands (P7: home, moved, hidden;
// never over a control's centre; the palette takes it away and it comes back); and the section `centre`: the mock's own centre (ui-next/shell/probes/mock-notice-centre.json, measured by mock-notice-centre-measure.mjs in
// eleven scenes) within 1 px and its paint exactly, axe on the bell and the open centre in the nine themes, the keyboard with real key presses, what 500 records cost (the open in under two frames, 50 rows drawn), a closed
// centre that holds no listener, observer or timer, and one commit for a new notice; at 1440 x 900 and 1280 x 800 in both engines. It builds its own fixtures (production, and development for the commit counts), so it does
// not read PROBE_DIST.

export const units = [
  {
    id: 'notices',
    name: 'Probe the toast layer against the pinned mock reference',
    script: 'ui-next/shell/probes/notices-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/notices-probe.json' },
    seconds: 405,
  },

  // The negative controls of the toast probe, each perturbs one measured value in the page after it loaded and passes only when the probe sees it, on the section that must (Chromium, 1440 x 900); with that assertion
  // dropped (ASSERTION_OFF) it is not detected. The toast layer's twenty: a toast 20 px too wide, a gap of 14, the Retry's colour, a failure that is not an alert, a layer that is not live, an announcement made twice, a toast
  // that takes the focus, F6 that reaches the toasts first, a focus not given back, a failure that closes by itself, a pointer that does not hold the clock, a hold that outlives its toast, a stack drawn over the palette, a
  // timer left after the stack is empty, a control that moves, a stack that does not avoid a control, a toast over a control's centre, a hidden stack that is still an F6 stop.
  {
    id: 'notices-controls-toast',
    name: 'Probe that the toast probe sees a toast layer that is wrong',
    script: 'ui-next/shell/probes/notices-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: [
      'toast-width', 'gap', 'retry-paint', 'no-alert', 'no-live', 'told-twice', 'steals-focus', 'f6-first', 'no-restore', 'sticky-closes', 'no-hold', 'hover-stuck', 'modal-leaks', 'timer-left', 'layout-shift', 'no-avoid', 'covers', 'yield-stop', 'yield-expires', 'yield-drops-focus',
    ],
    plants: 'page',
    seconds: 245,
  },

  // The notification centre's fourteen: a popover 20 px too wide, a row 2 px too tall, the bell's dot in the wrong colour, a bell dot that is a number, a Filter menu 20 px off, an unnamed dialog, a centre that Escape does
  // not close, a focus not given back to the bell, a press outside that does not close it, two tab stops in the list, a listener and a timer left after it closes, a second commit for a new notice, an open that takes over
  // two frames. Each control builds the fixtures and runs one part of the section.
  {
    id: 'notices-controls-centre',
    name: 'Probe that the toast probe sees a notification centre that is wrong',
    script: 'ui-next/shell/probes/notices-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: [
      'centre-width', 'centre-row', 'centre-dot', 'centre-bell-number', 'centre-menu-offset', 'centre-no-name', 'centre-escape', 'centre-focus', 'centre-outside', 'centre-two-stops', 'centre-listener-left', 'centre-timer-left', 'centre-second-commit', 'centre-slow-open',
    ],
    plants: 'page',
    seconds: 210,
  },
];

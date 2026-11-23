// The kit's Sheet part (ST1): the modal surface the new UI's Settings takes in a window that has no native windows, on the real ui-next parts page (the example `OpenedFromTheButton`), in WebKit and Chromium at 1440 x 900 and
// 1280 x 800: nothing open at load, one modal dialog with the focus inside it, the page behind inert, the frame 1060 x 640 and centred with a 41 px header and a 24 px Close, the paint the tokens name and no veil over the page,
// axe (colour contrast included) in Void and Light, Tab and Shift+Tab that wrap inside it, a press on the scrim that closes nothing, Escape in a field with a draft that puts the value back and closes nothing, and the
// focus given back to the button that opened it. It reads the ui-next build the shard makes (DIST).

export const units = [
  {
    id: 'sheet',
    name: 'Probe the sheet part on the parts page',
    script: 'packages/kit/probes/sheet-probe.mjs',
    env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/sheet-probe.json' },
    seconds: 30,
  },

  // The negative controls of the sheet probe: each plants one fault in the page after it loaded and the fault trips the one assertion it is named for and no other (a Tab that never reaches the part, a press on the scrim
  // that sends the dialog the close request Escape sends, a field that ignores Escape's draft rule, a focus not given back after Escape and after Close, a veil drawn over the page, a frame of the wrong size). A control
  // passes (exit 0) when its assertion sees the fault; with that assertion removed (ASSERTION_OFF=says) nothing is left (exit 1, NOT DETECTED), and a fault that trips another assertion is INVALID (exit 2). Chromium at
  // 1440 x 900.
  {
    id: 'sheet-controls',
    name: 'Probe that the sheet probe sees a sheet that is wrong',
    script: 'packages/kit/probes/sheet-probe.mjs',
    env: { DIST: '$PROBE_DIST' },
    controls: ['no-wrap', 'scrim-closes', 'escape-ignores-draft', 'no-restore-escape', 'no-restore-close', 'veil-present', 'frame-size'],
    seconds: 165,
  },
];

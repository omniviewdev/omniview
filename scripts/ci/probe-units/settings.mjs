// Settings (ST1), the new UI's host settings in both containers: the page's content and the window's, over the real session, the real form model and the real kit parts with a host in memory (ui-next/shell/probes/settings-fixture.tsx),
// compared in WebKit and Chromium with the design mock's settings page (ui-next/shell/probes/mock-settings.json, measured by mock-settings-measure.mjs) and the original application's window (old-settings.json, measured from its
// pictures): the Settings window at 1060 x 640 and 960 x 600 (the host's own size and its minimum), the page (navigation, group, heading, rows, scroll, the loading, failed and empty states) at 1440 x 900 and 1280 x 800, the
// sheet (frame, modal, Tab wrap, scrim, Escape and the focus given back), the keyboard (the pages follow the focus, every control reachable and operable, what a page change does to a draft), axe in both containers and the nine
// themes, and what it costs in a production build (one commit and under two frames to open, a keystroke is one commit and one row, idle is no commit and no timer, closed is no node, no listener and no timer). It builds its own
// fixture, so it does not read PROBE_DIST.

export const units = [
  {
    id: 'settings',
    name: 'Probe Settings against the pinned mock reference and the original window',
    script: 'ui-next/shell/probes/settings-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/settings-probe.json' },
    seconds: 230,
  },

  // The negative controls of the settings probe: each plants one fault in the page after it loaded (a style override, an attribute removed, a handler dropped, a timer left) and the fault trips the one assertion it is named for
  // and no other; with ASSERTION_OFF=says the assertion is left out and the fault must pass undetected. Chromium, the section of the fault only. The first control builds the fixture into BUILD_CACHE and the others read it.
  // The window's seven and the sheet's thirteen: a sidebar of 200 px, a caption of 56, a dialog in the window, a Close that drags, an Escape that never arrives, a hidden window that still paints, a change the host reported that
  // never arrives; a gear with no name, a chord that opens nothing, a dialog that is not modal, a frame of 1000 px or one that is not clamped, a veil, a Tab that never wraps, a scrim that closes, an Escape that ignores a draft,
  // a focus not given back after Escape and after Close, a page forgotten, a tooltip not drawn.
  {
    id: 'settings-controls-window-sheet',
    name: 'Probe that the settings probe sees a Settings window and a sheet that are wrong',
    script: 'ui-next/shell/probes/settings-probe.mjs',
    env: { FONT_DELAY_MS: '40', BUILD_CACHE: '$RUNNER_TEMP/settings-fixtures' },
    controls: [
      'win-sidebar', 'win-caption', 'win-shell', 'win-drag', 'win-escape', 'win-hidden-paints', 'win-sync-dropped', 'sheet-gear-name', 'sheet-open-chord', 'sheet-not-modal', 'sheet-frame-size', 'sheet-no-clamp', 'sheet-veil', 'sheet-no-wrap', 'sheet-scrim-closes', 'sheet-escape-draft', 'sheet-no-restore-escape', 'sheet-no-restore-close', 'sheet-keep-lost', 'sheet-tip-hidden',
    ],
    seconds: 80,
  },

  // The page's twenty-four: a page's row 34 px high, a selected page in a colour that is no role, the group's label in the wrong size or a Tab stop, a heading lane of 24, a title of 22 px, a description that wraps, rows 20 px
  // under the heading, a row with no lane or in the wrong order, 8 px between two rows, no separator, no slot for Reset, a pane that scrolls the page behind it, a navigation that moves with the page, no inset under the last row,
  // a page that opens scrolled, a page that scrolls though it fits, a loading line that is not a status, a failed state that does not take the keyboard, an empty state that is an alert, 20 px between the lines of the alert, the
  // alert's sentence in the wrong size, and a page painted in a colour that is no role of Obsidian.
  {
    id: 'settings-controls-page',
    name: 'Probe that the settings probe sees a Settings page that is wrong',
    script: 'ui-next/shell/probes/settings-probe.mjs',
    env: { FONT_DELAY_MS: '40', BUILD_CACHE: '$RUNNER_TEMP/settings-fixtures' },
    controls: [
      'nav-height', 'nav-selected-paint', 'group-size', 'group-tabbable', 'heading-lane', 'heading-type', 'heading-oneline', 'list-start', 'rows-height', 'rows-order', 'rows-pitch', 'rows-separator', 'rows-column', 'scroll-pane', 'scroll-wheel', 'scroll-end', 'scroll-reset', 'scroll-fits', 'states-loading', 'states-failed', 'states-empty', 'states-anatomy', 'states-type', 'paint-token',
    ],
    seconds: 80,
  },

  // The keyboard's six and axe's two: a page that goes round at the end, a second page that is a Tab stop, a row's control out of the Tab order, Space on a switch taken, a key typed in a select taken, a draft not applied when
  // the focus leaves; Close with no name and a description drawn in the colour of its background.
  {
    id: 'settings-controls-keys',
    name: 'Probe that the settings probe sees a keyboard and a tree of names that are wrong',
    script: 'ui-next/shell/probes/settings-probe.mjs',
    env: { FONT_DELAY_MS: '40', BUILD_CACHE: '$RUNNER_TEMP/settings-fixtures' },
    controls: [
      'keys-nav-wrap', 'keys-nav-stops', 'keys-unreachable', 'keys-switch-space', 'keys-select-typeahead', 'keys-draft', 'axe-name', 'axe-contrast',
    ],
    seconds: 100,
  },

  // What Settings costs, eleven: the page drawn twice after the host's answer, an answer worked on for 60 ms, a show followed by a second commit or worked on for 70 ms, a key that costs two commits or draws every row, a timer or
  // a worker that wakes the page while it is idle, and a node, a listener or a timer left after the sheet closes.
  {
    id: 'settings-controls-perf',
    name: 'Probe that the settings probe sees a Settings that costs too much',
    script: 'ui-next/shell/probes/settings-probe.mjs',
    env: { FONT_DELAY_MS: '40', BUILD_CACHE: '$RUNNER_TEMP/settings-fixtures' },
    controls: [
      'perf-open-commits', 'perf-open-slow', 'perf-show-commits', 'perf-key-twice', 'perf-key-rows', 'perf-idle-timer', 'perf-idle-commit', 'perf-closed-node', 'perf-closed-listener', 'perf-closed-timer', 'perf-show-slow',
    ],
    seconds: 180,
  },
];

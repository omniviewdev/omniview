// The host's Problems and Operations tools (PT1) in WebKit and Chromium: the real bodies over the real models in the real panel (ui-next/shell/probes/problems-operations-fixture.tsx), fed by hand-built conditions and activity
// records. EVERY ASSERTION IS A COUNT OR A RECTANGLE, none a time: the commits of 200 conditions (200 tasks) that arrive at a table that is on screen (one) and of one row that changes (one commit, the cells of one row, no node
// outside it), what a tool that nobody looks at costs while its feed goes on (nothing: no commit, no DOM change, no body), what a body holds while it is shown and what is held when the window goes (nothing), the rows a table
// of 200 mounts (a few) and the last one reached by End, the mock's rectangles it can be trusted for (the 24 px row, the header, the footer, the tab's count and dot), what a long word does to a cell (an ellipsis, never a cell
// under another) at 1440 x 900, 1280 x 800 and 800 x 600, axe on the panel (with rows, with none, with the dot of a failure nobody read) and the keyboard (every control a Tab stop, one open for each press). The commits are read from
// React's development build and everything else from the production build; both are built into the shard's shared BUILD_CACHE (the engine sets it), so the probe does not read PROBE_DIST.
//
// THE SECONDS ARE ABOUT TWICE THE LAPTOP'S, ROUNDED UP, and nothing has run on the runner yet: the probe took 64 s in Chromium and 71 s in WebKit (136 s for both, 1440 x 900, 1280 x 800 and 800 x 600, a load of 6 to 10), the seven controls
// of the counts 4 to 32 s each (about 66 s with the build shared: the render loop takes the overall wait of 30 s), the fifteen of the page 2 to 19 s each (about 66 s, a load of 12): listed at 240, 120 and 120. The summary of the first shard that runs a unit prints the real seconds and says what to put in `seconds`
// (`node scripts/ci/probe-seconds.mjs --write`, the runner's 95th percentile, after the first CI runs). A unit that is faster than its seconds by more than the margin only warns; one that is slower fails its shard.

export const units = [
  {
    id: 'problems-operations',
    name: 'Probe the Problems and Operations tools',
    script: 'ui-next/shell/probes/problems-operations-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/problems-operations-probe.json' },
    seconds: 240,
  },

  // The negative controls of the counts (rule 28): a producer that hands its tasks over one at a time (the commits of an arrival), a body that gives every row a new object on a change and a table that calls every cell of a row twice (the
  // cells a tick renders, and how many calls a cell gets), a tool that stays mounted while it is hidden (what a hidden tool costs), a model that keeps a listener after it was stopped and a window that does not let go of the feed (what
  // is held and what is heard when the window goes), and a body that renders again for ever (the wait for the page to come to rest ends at the overall wait of 30 s, and the control takes it: the longest of them). Each passes only when
  // the assertion it is named for sees it and no other does; with that assertion dropped (ASSERTION_OFF) it is not detected.
  {
    id: 'problems-operations-controls-counts',
    name: 'Probe that the Problems and Operations probe sees a tool that costs more than it should',
    script: 'ui-next/shell/probes/problems-operations-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['per-record', 'all-rows', 'cells-twice', 'hidden-mounted', 'leaky-model', 'no-detach', 'render-loop'],
    plants: 'page',
    seconds: 120,
  },

  // The negative controls of the page: rows a third of a row high and a region that cannot scroll (the rows mounted and the last row reached), a row 4 px too tall, a footer 4 px above the bottom, a footer's words 4 px in, a dot 4 px
  // down, a count in another colour, an ellipsis taken from every cell, the cut taken from the fixed columns, long words in one column only (the premise of the layout), a button with no name, buttons that are no Tab stop, a row that
  // opens twice, a shift-click that opens another subject, and a scene that throws (an error of the scene is no detection by the assertion the scene is for).
  {
    id: 'problems-operations-controls-page',
    name: 'Probe that the Problems and Operations probe sees a page that is wrong',
    script: 'ui-next/shell/probes/problems-operations-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['tiny-rows', 'no-scroll', 'tall-rows', 'footer-up', 'footer-words', 'dot-down', 'count-colour', 'clip-off', 'spill', 'long-one', 'no-name', 'no-stop', 'open-twice', 'shift-other', 'scene-throws'],
    plants: 'page',
    seconds: 120,
  },
];

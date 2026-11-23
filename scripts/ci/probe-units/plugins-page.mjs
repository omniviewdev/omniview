// The Plugins page (PL1) in the real window: the product's own shell and plugin host with the page registered over a fake host (ui-next/shell/plugins-page/probes/fixture.tsx), opened with the palette's command "Plugins", in WebKit and
// Chromium at 1440 x 900 and 1280 x 800, against the pinned mock reference (ui-next/shell/plugins-page/probes/mock-plugins.json, measured by mock-plugins-measure.mjs from the mock's own Plugins page in eight scenes): the list, its rows,
// the header and its three action slots, the status lane, the details card, the empty states and the Uninstall confirm inside each pane within 1 px (the repository's for a reference measured on another platform) and their paint exactly; the colours the page paints are the tokens' in a light theme;
// axe on each scene, the More menu and the confirm; the keyboard path with real key presses (the list is one Tab stop, the arrows, Enter, the menu, the progress and where the focus goes, the confirm and Escape).
//
// The cost of the page is the second probe, `plugins-page-perf`: the same script with one section, so that it is a probe of its own (a probe is one unit, and the two together would be more than a shard holds). EVERY ASSERTION IN IT IS A
// COUNT (commits, animation frames, batches of DOM changes, nodes changed, timers) and none depends on how fast the machine is; the milliseconds of the open are printed and held only against a catastrophe (400 ms, 13 times a laptop's),
// because a time asserted on the runner failed three pull requests (docs/ui-next/status/N25.md, section 4). It builds its own fixtures (production, and development for the counts of commits) into BUILD_CACHE, one build for each shard,
// so it does not read PROBE_DIST.
//
// WHY THE UNITS RUN WRAPPERS. The probe is ui-next/shell/plugins-page/probes/plugins-probe.mjs, with its fixture and its mock reference beside the page. The table's scan (`findProbeScripts`, PROBE_DIRS in scripts/ci/probe-shards.mjs:
// packages/kit/probes, ui-next/shell/probes and ui-next/page/probes) does not read that directory, and the engine's tests build their scratch tree from what the scan finds: a unit that names a script outside it, or a manifest entry for one,
// turns two of them red (probe-shards.test.mjs, "the check passes on a tree that holds the scripts, the units and the manifest" and its negative control) in the first step of every shard. So the units run two wrappers of three lines in
// ui-next/shell/probes (plugins-page-probe.mjs and plugins-page-perf-probe.mjs, which only name the probe and the section), as palette-plugins-probe.mjs names a section of the palette probe; the scan, the check and the manifest see
// the wrappers. When PROBE_DIRS holds ui-next/shell/plugins-page/probes the wrappers can go and the units name the probe.
//
// THE SECONDS ARE ESTIMATES, FOUR TIMES THE LAPTOP'S on a quiet machine (59, 55, 14, 6 and 27 s for the five units at a load of 8; at a load of 17 the same run took 79, 120, 15, 6 and 27 s). The runner is taken to be about four times slower
// than the laptop (this probe's runs are mostly pages that load and keys that are pressed, which the runner's virtual machines do slowly; the records of the shards in scripts/ci/probe-shards.runs.json put the ratio of the older probes at
// 1.1 to 3). Nothing here has run on the runner yet: the summary of the first shard that runs a unit prints the real seconds and says what to put in `seconds`. A unit that is faster than its seconds by more than the margin only warns; one
// that is slower fails its shard, so they are rounded up.

const FIXTURES = '$RUNNER_TEMP/plugins-page-fixtures';

export const units = [
  {
    id: 'plugins-page',
    name: 'Probe the Plugins page against the pinned mock reference',
    script: 'ui-next/shell/probes/plugins-page-probe.mjs',
    env: { FONT_DELAY_MS: '40', SECTIONS: 'geometry,tokens,a11y,keyboard', BUILD_CACHE: FIXTURES, REPORT: '$RUNNER_TEMP/plugins-page-probe.json' },
    seconds: 95,
  },

  // What the page costs, in counts: a list of 200 plugins mounts in one commit and one batch of DOM changes; one event for one plugin renders one row in one commit and changes no node outside it; the command that opens the page has the list
  // in the document in its first commit and by the first animation frame, in one batch; and an idle page makes no commit, timer, frame or DOM change in 3 s. WebKit and Chromium at 1440 x 900.
  {
    id: 'plugins-page-perf',
    name: 'Probe what the Plugins page costs',
    script: 'ui-next/shell/probes/plugins-page-perf-probe.mjs',
    env: { FONT_DELAY_MS: '40', BUILD_CACHE: FIXTURES, REPORT: '$RUNNER_TEMP/plugins-page-perf-probe.json' },
    seconds: 80,
  },

  // The negative controls of the page's boxes and paint: each adds a rule to the page right before it is read (a transform that moves one part by 2 to 6 px, or a colour or a radius of its own) and passes only when the assertion of that part
  // sees it and no other does: the count footer, a row's tile, the facts line, the More slot, the lane, the card's title, the confirm's button, the empty detail's body, and the list's fill, the selected row's, the title's colour, a button's
  // radius, the lane's fill, the card's and the dialog's radius. With ASSERTION_OFF=<its assertion> the fault must pass undetected. The first control builds the fixtures into BUILD_CACHE and the others read that build.
  {
    id: 'plugins-page-controls-boxes',
    name: 'Probe that the Plugins page probe sees a page whose boxes and paint are wrong',
    script: 'ui-next/shell/probes/plugins-page-probe.mjs',
    env: { FONT_DELAY_MS: '40', BUILD_CACHE: FIXTURES },
    controls: [
      'list-foot', 'row-tile', 'facts-down', 'more-slot', 'lane-down', 'card-title', 'confirm-button', 'empty-body', 'list-fill', 'selected-fill', 'title-colour', 'button-radius', 'lane-fill', 'card-fill', 'dialog-radius',
    ],
    seconds: 30,
  },

  // The negative controls of the tokens, axe and the keyboard: a colour of its own that does not follow a light theme, a button with no name, a second Tab stop in the list, and a focus that is not given back when the confirm closes.
  {
    id: 'plugins-page-controls-page',
    name: 'Probe that the Plugins page probe sees a page whose colours, names and keys are wrong',
    script: 'ui-next/shell/probes/plugins-page-probe.mjs',
    env: { FONT_DELAY_MS: '40', BUILD_CACHE: FIXTURES },
    controls: ['pinned-lane', 'no-name', 'extra-stop', 'focus-lost'],
    seconds: 20,
  },

  // The negative controls of the page's cost (all counts): a second commit after the list came in, one commit that renders two rows, a page with no seed whose list comes when the host answers (the commits and the animation frame the list is
  // in the document at), a second burned in the keydown of the command (the catastrophe's bound on milliseconds, the only one), and a timer kept while the page is on screen. Each runs the part it perturbs.
  {
    id: 'plugins-page-controls-perf',
    name: 'Probe that the Plugins page cost probe sees a page that costs too much',
    script: 'ui-next/shell/probes/plugins-page-perf-probe.mjs',
    env: { FONT_DELAY_MS: '40', BUILD_CACHE: FIXTURES },
    controls: ['late-change', 'second-row', 'late-list', 'slow-open', 'idle-timer'],
    seconds: 45,
  },
];

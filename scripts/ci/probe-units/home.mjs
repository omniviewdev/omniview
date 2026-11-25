// The Home page (HM2): what it costs with 200 connections, in counts. The real Home content (ui-next/plugins/host/homePage.tsx, `HomeContent`) over a fake host (ui-next/plugins/host/probes/home-fixture.tsx) in WebKit and Chromium at 1440 x 900. EVERY
// ASSERTION IN IT IS A COUNT (commits, batches of DOM changes, nodes changed, timers, animation frames, boxes) and none depends on how fast the machine is; no time is asserted at all (a time asserted on the runner failed three pull requests:
// docs/ui-next/status/N25.md, section 4). It builds its own fixture (React's development build: a Profiler calls `onRender` only there) into the shard's shared BUILD_CACHE (the engine sets it), so it does not read PROBE_DIST.
//
// WHY THE UNITS RUN A WRAPPER. The probe is ui-next/plugins/host/probes/home-perf.mjs, with its fixture and its world beside the page. The table's scan (`findProbeScripts`, PROBE_DIRS in scripts/ci/probe-shards.mjs: packages/kit/probes,
// ui-next/shell/probes and ui-next/page/probes) does not read that directory, and the engine's tests build their scratch tree from what the scan finds: a unit that names a script outside it turns two of them red. So the units run
// ui-next/shell/probes/home-perf-probe.mjs, which only names the probe, as plugins-page-perf-probe.mjs does (scripts/ci/probe-units/plugins-page.mjs). When PROBE_DIRS holds ui-next/plugins/host/probes the wrapper can go.
//
// THE SECONDS ARE THE RUNNER'S (HM3c). They began as estimates, four times the laptop's (85 and 75); `node scripts/ci/probe-seconds.mjs --few-samples max --write` set them from the runner's logs: 17 samples of `home-perf` (min 18 s, median 29 s, p95 34.2 s, max 35 s) and 12 of `home-controls-perf`
// (min 10 s, median 11.5 s, p95 21 s, max 21 s), each rounded up to 5 s (35 and 25). A unit that is faster than its seconds by more than the margin only warns; one that is slower fails its shard, so they are rounded up. Set them again with the
// same command when the probe changes.

export const units = [
  // What the page costs, in counts: 200 connections mount in one commit and one batch of DOM changes; one character typed in the field is at most two commits and changes only the rows that left or entered; one event for one connection is one
  // commit and changes no node outside its row; the row's menu opened with Shift+F10 makes no commit of the page; an idle page makes no commit, timer or animation frame in 3 s; and with 200 names of more than eighty characters no row's
  // state word is pushed out of its row.
  {
    id: 'home-perf',
    name: 'Probe what the Home page costs',
    script: 'ui-next/shell/probes/home-perf-probe.mjs',
    env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/home-perf-probe.json' },
    seconds: 35,
  },

  // The negative controls of the page's cost (all counts), each a fault planted in the loaded page or in what the probe does to it, seen by the assertion it is named for and by no other, and passing undetected with ASSERTION_OFF set to that
  // assertion: a second commit after the list came in (`late-change`: home.mount), one event that draws two rows (`second-row`: home.event), three more commits in the event of a keystroke (`key-commits`: home.keystroke), a timer kept while
  // the page is on screen (`idle-timer`: home.idle) and a rule that gives a long name its whole width, so that it pushes the state word out of the row (`push-out`: home.geometry). Each runs only the part it perturbs, in Chromium.
  {
    id: 'home-controls-perf',
    name: 'Probe that the Home cost probe sees a page that costs too much',
    script: 'ui-next/shell/probes/home-perf-probe.mjs',
    env: { FONT_DELAY_MS: '40' },
    controls: ['late-change', 'second-row', 'key-commits', 'idle-timer', 'push-out'],
    plants: 'page',
    seconds: 25,
  },
];

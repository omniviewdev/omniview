// The kit probes, split into shards: which probe runs in which job, the check that no probe is left out, and the commands the workflow runs on the table.
//
//   node scripts/ci/probe-shards.mjs check            exit 1, one line per problem, when a probe script is in no shard, a probe or its controls run twice, a shard is not in the workflow's matrix, or a unit does not hold together
//   node scripts/ci/probe-shards.mjs plan <shard>     what the shard runs; writes `dist=true|false` to $GITHUB_OUTPUT (does a probe of the shard read the ui-next build?)
//   node scripts/ci/probe-shards.mjs run <shard>      runs every probe of the shard, one after the other, and exits 1 when any failed (all of them run: a push shows every failure, not the first)
//   --root <dir>                                      another tree than this repository (the tests)
//
// .github/workflows/ui-next-kit-probes.yml fans out one job per shard (`strategy.matrix.shard`) and one job named `Kit probes` that is green only when every shard is. Each shard job installs and builds
// what it needs, runs `check`, and runs its shard. The probes are the same Node processes the single job ran, one after the other, with the same env; only the VM they run on changed.
//
// ADDING A PROBE. Write `<thing>-probe.mjs` in one of PROBE_DIRS, add a unit for it (and a unit for its negative controls, if it has them) to a shard below, the one with the most room, and run `node scripts/ci/probe-shards.mjs check`.
// A probe script that no shard runs fails that check, in every shard job, with its path on the error line; a probe CI is not to run goes in BY_HAND with the reason. A probe's negative controls may run in another shard than the probe (K2): the
// check requires that the probe is one unit and its controls are one unit, so that each runs exactly once. A new shard is a new entry in SHARDS and a new number in the workflow's `shard: [...]` line, both in one change: `check` fails when they differ.
//
// BALANCE. The shard jobs wait for the slowest shard, so a shard that grows is the job's wall time. Every run of a shard writes the seconds of each of its probes to the job summary (with the probe script and the control of each row) and, since K3, a
// `::warning::` for a unit that took more than 25 % (and more than 10 s) over its MEASURED_SECONDS value (driftWarnings): the table drifted once (K3: shard 5 was 562 s on the runner against 489 s in the table) because nothing said so. When a warning
// names a unit, put the runner's new seconds in MEASURED_SECONDS and move a unit if a shard is over LIMIT_SECONDS (a test fails when a unit has no measurement, a shard is over the limit, or the work would fit one shard fewer).
//
// MEASURED_SECONDS are the RUNNER's: the median, rounded up, of the last 8 green runs of 2026-11-21 on main and on merged pull requests (the runs and every row are in docs/ui-next/status/N24-K3-seconds.json, the derivation in N24-K3.md), each unit being a
// probe or a probe's controls, both engines and both viewports counted as the probe runs them. The job of a shard is its probes plus its setup, which is the job minus the probes' step: median 88 s, 90th percentile 108 s on the 56 shard jobs of those runs
// (the CI image, docs/ui-next/status/N24-B1.md). The wall time the table is held to is 9 minutes (WALL_BUDGET_SECONDS), so a shard may hold LIMIT_SECONDS = 540 - 108 = 432 s of units: the slowest job is then 9 minutes when its setup is as slow as the
// 90th percentile and its probes take their medians. That is the number of the data, not an estimate with slack: the best split of the 3,387 s of work into 8 shards has a longest shard of 425 s (searched exhaustively; 7 shards cannot do better than 484 s,
// 484 + 88 = 9 m 32 s, over; 9 shards cannot do better than 411 s, the panel probe's controls alone, 14 s less for one more job), so eight shards is the fewest that fit. The shards below, in seconds of units:
//   shard 1  panel controls 411, detail 16                                                          = 427
//   shard 2  logs 321, plugin providers controls 105                                                = 426
//   shard 3  panel 292, log view controls 109, row menu 22 + its controls 2                         = 425
//   shard 4  palette 260, parts 164                                                                 = 424
//   shard 5  strip 192, list page 61, strip controls 28, plugin providers 151                       = 432
//   shard 6  log view 181, shell 46, kit-probe-bc 197                                               = 424
//   shard 7  tooltip 145, palette controls 63, toast layer controls 156, table 62                   = 426
//   shard 8  toast layer 220, logs controls 161, rail 16, fonts 35                                  = 432
// (K2c-2: the detail probe's `gone` stage took it from 10 s to 14 s (the pull request's run) and 18 s (main's run after it merged) on the runner: 16 s, the median of those two, is the value; shard 1 is 427 s, 5 s under the limit.)
// (C1f: the plugin providers probe and its controls are ESTIMATES of 148 and 98 s, from the runner's 142 and 91: the connection part and its control, until a run's summary has the runner's. Shard 5 would have been 438 s, so four units
// moved, the fewest that fit under the limit: the palette's controls and the strip's controls to shard 5, the fonts probe to shard 8 and the plugin providers' controls to shard 2. The limit is not raised, and shard 8 is at it.)
// (C1g: the plugin providers probe and its controls are ESTIMATES of 151 and 105 s now, over the 148 and 98 of C1f: the `names` part (about 0.7 s a pair of an engine and a viewport) and its control, until a run's summary has the runner's. Shard 5
// would have been 434 s, so two units swapped, the fewest that fit under the limit and the pair that leaves shard 5 not reading the ui-next build (a unit that reads it adds a build to the job, which is not in these seconds): the palette's
// controls to shard 7 and the list page's probe to shard 5. The limit is not raised, and shards 5 and 8 are at it.)
// What the margin does not cover is a run slower than the medians: a unit's maximum over the 8 runs is up to 12 % over its median for the longest (the panel probe's controls: 411 median, 462 maximum) and up to 36 % for the smallest (the strip's controls: 28, 38), and 5 of the 64 simulated shard jobs of those runs would have been
// over 9 minutes. Three units have fewer than 8 runs behind them, because their set of controls or the probe itself is new (the toast layer 4 runs, its controls 3, the plugin providers' controls 3): they are the first to move.
// Before K2 a probe and its controls had to share a shard, so the panel probe with its controls (687 s) was the floor of the job at 13 minutes; the longest unit is now 411 s.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The directories whose probe scripts must each be in a shard. */
export const PROBE_DIRS = ['packages/kit/probes', 'ui-next/shell/probes', 'ui-next/page/probes'];

/** The workflow that runs the shards: its matrix line is read by `check`. */
export const WORKFLOW = '.github/workflows/ui-next-kit-probes.yml';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The table
//
// A unit is one step of the workflow, as it was when one job ran every probe: its `name` is the step's name, `script` the probe it runs (from the repository root), `env` what the step set
// (`$RUNNER_TEMP` and `$PROBE_DIST` are expanded from the runner's environment; a variable that is not set is an error), and `controls` the negative controls of a step that ran the probe once for each:
// every control is one run with NEGATIVE_CONTROL set to it, and passes only when the probe sees what that control perturbs.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export const TABLE = {
  shards: [
    {
      id: '1',
      units: [
        // The negative controls of that probe: each perturbs one measured value in the page (the region's height, the gap between a session's glyph and its name, the toggle's place, a tool tab's padding, the
        // sidebar's place when the panel opens, a write at the document root during a drag, and, for the sessions their plugin's unload kept (A21): the tab of the held session is not drawn, nor is the tab of the one that
        // had ended on its own, a tab moves, the Open button can be pressed while the plugin is off; and, for the scope of a tab (A22): the twins' scope part is 3 px off the mock's, a tab with no twin draws a scope, the
        // tab left when its twin closes still draws one, the name of a scoped tab leaves its scope out) and passes only when the probe sees it. A probe that cannot fail proves nothing.
        {
          name: 'Probe that the panel probe sees a panel that is wrong',
          script: 'ui-next/shell/probes/panel-probe.mjs',
          controls: ['panel-height', 'session-gap', 'toggle', 'tab-padding', 'shift', 'root-write', 'held-hidden', 'held-done-hidden', 'held-moved', 'held-enabled', 'twin-moved', 'twin-lone-scope', 'twin-scope-kept', 'scope-name'],
        },

        // The detail page (D1a) in the real shell fixture: the header, the strip and the first sections against the pinned mock reference (packages/kit/probes/mock-detail.json), loading to ready
        // with no part moving, and the keyboard path through the strip, at 1440 x 900 and 1280 x 800. It builds its own fixture, so it does not read PROBE_DIST.
        { name: 'Probe the detail page against the pinned mock reference', script: 'ui-next/page/probes/detail-probe.mjs' },
      ],
    },
    {
      id: '2',
      units: [
        // The host's Logs tool (P1b-3a) on the host fixture (`?logs=1`): the log view fills the panel's body, opening a session moves nothing outside the log view, switching tool and back keeps the lines and the scroll place, what the
        // plugin counts of its feed (the registry and the view listen while the session is on screen, only the registry while another tool is shown, none once the tab is closed), and what the 10,000 lines a second session costs: at most one
        // commit a frame (and at least one) with the panel open (React's development build), and with the panel closed or another tool shown no commit, no frame requested, no timer started, no DOM mutation and (Chromium) no layout or
        // style recalculation, WHILE THE FEED WENT ON (the fixture counts the lines it made: none was read, each is held by the stream or dropped past its bound of 100,000), and back on the Logs tool the view shows newer lines than it
        // had when it was hidden, with every line the feed made since accounted for, at 1440 x 900 and 1280 x 800. The source of a line (L2): a session that follows two sources has a Source column whose cell on every row names the source
        // the feed gave the line (its label, its hue, the mock's 168 px and chip), one that follows one has none, and a column that appears while a session is open moves no row, scrolls nothing, measures nothing and (Chromium) lays the
        // page out once, following the end and scrolled back. A plugin's unload (A21, on the host fixture's `window.__plugin`): the sessions of an item (one streams, one ended, one failed) stay in the same views with the
        // oldest line each showed (read by its number and text), each stream is closed once (the fixture counts every call to `close`) and the registry lets go of it, and closing the tabs leaves no listener; and, in Chromium,
        // the heap after forced collections (CDP) falls back once the tab of a session that held 100,000 lines is closed. A Logs session is its plugin and its target (A22, section `identity`): pressing a target whose session
        // is running shows it and starts no second stream (the fixture counts the feeds opened), moves no focus, opens the panel and chooses Logs from a hidden panel or another tool; a twin of another scope makes both tabs
        // draw their scope and closing one takes it off the other; a target whose session ended or failed opens a new session beside it, its stream still open and its view holding its lines, the tabs named
        // `x, ended` and `x (2)`; and (section `a11y`) axe on the real log view with the scoped twin tabs and with an ended session beside its replacement. It builds its own fixtures, so it does not read PROBE_DIST.
        { name: 'Probe the Logs tool in a real engine', script: 'ui-next/shell/probes/logs-probe.mjs', env: { REPORT: '$RUNNER_TEMP/logs-probe.json' } },

        // The negative controls of the plugin providers probe (its probe is in shard 5): each makes the page do what one assertion is there to see (a provider that holds the thread, a fast provider that answers late, a late section that takes the cursor
        // with it, a second commit for a key, a move outside the palette, work done while the palette is closed, an answer shown after the stop, a sidebar keyword that is not read or ranks as a plain keyword, a connection said by its key in a row of the
        // palette, and by the tab model's faces in the tab strip, its tooltip and the status bar) and passes only when that assertion sees it. Each runs the part it perturbs.
        {
          name: 'Probe that the plugin providers probe sees a palette that is wrong',
          script: 'ui-next/shell/probes/palette-plugins-probe.mjs',
          env: { FONT_DELAY_MS: '40' },
          controls: ['slow-blocks', 'quick-late', 'focus-moves', 'extra-commit', 'plugin-shift', 'closed-work', 'stale-shown', 'alias-ignored', 'alias-loose', 'connection-key', 'connection-key-face'],
        },
      ],
    },
    {
      id: '3',
      units: [
        // The bottom panel (P1a): the region, the splitter, the tool strip, the session tabs, the session card and the status bar's toggle against the pinned mock reference
        // (ui-next/shell/probes/mock-panel.json, measured from the mock's own panel by mock-panel-measure.mjs), what opening and resizing the panel move (the frame's height, nothing else), the paint of its parts,
        // the keyboard path and the splitter's keys with real key presses, axe, what a drag costs (no write at the document root, no commit while the pointer moves), a plugin's tool that registers late, and a
        // session body that keeps running while it is hidden, and (A21) the sessions of the host's Logs tool that their plugin's unload kept (the tab stays in its place, ended or as it was, its body mounted and counting
        // no more, the card's link and Open button unavailable while the plugin is off and working when it returns, a new press a twin beside it, Delete closing it), and (A22) the scope of a session tab: drawn only
        // when two open sessions of one title differ in scope, against the mock's own twin tabs within 1 px (ui-next/shell/probes/mock-panel.json, scenario `twins`) and on the shell's markup (alone no scope, twins draw
        // theirs, an ordinal for twins of one scope, no two names alike, the tab left loses its scope), and axe on the open Logs tool with two scoped twin tabs, at 1440 x 900 and 1280 x 800. It builds its own
        // fixtures, so it does not read PROBE_DIST.
        { name: 'Probe the bottom panel against the pinned mock reference', script: 'ui-next/shell/probes/panel-probe.mjs', env: { REPORT: '$RUNNER_TEMP/panel-probe.json' } },

        // The negative controls of the log view probe (its probe is in shard 6): each perturbs one measured value in the page (a row's height, the clock column's width, the filter row's place when a count appears, the strip's
        // height, the copy event, the ArrowDown key, an unnamed button, a name that takes no pointer) and passes only when the probe's assertion for it is made and agrees without the perturbation and fails with it.
        {
          name: 'Probe that the log probe sees a log view that is wrong',
          script: 'packages/kit/probes/log-probe.mjs',
          env: { DIST: '$PROBE_DIST' },
          controls: ['row-height', 'time-column', 'filter-shift', 'strip-height', 'copy', 'keys', 'axe', 'source-tip'],
        },

        // The row menu (1a.3b; first in a shard by N24-K2) on the 5,000-row example, opened from a trigger at the top, middle and bottom of the table region with the mouse and four keys, mid-window and at the window's bottom edge: popup roots 0/1/0, the
        // listeners an open menu adds (a press, a scroll and a resize on the window, none left), observers, focus after open and after Escape, placement and flip, no clipping in the top layer, an element count that does not depend on the rows, row
        // heights, arrows, Home, End, Escape and Tab, and no write to <html> or <body>. `aria-expanded` is read on the menu's TRIGGERS (`button[aria-haspopup="menu"]`), as the kit's contract says: the handle writes it on the one trigger that is open. It read the
        // whole page before, and the parts page has other elements that carry it (the TagList's toggle: `aria-expanded="true"` at rest), which was the 196 findings it failed with. It reads the ui-next build.
        { name: 'Probe the row menu on the 5,000-row example', script: 'packages/kit/probes/row-menu-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/row-menu-probe.json' } },

        // The negative controls of the row menu probe (its probe is in this shard), each in the page after it loaded, on the one opening that must see it (Chromium, 1440 x 900): the open trigger carries no `aria-expanded` (`trigger-not-expanded`), and the next row's trigger carries it too
        // (`expanded-twice`). Each passes only when the opening is clean without the perturbation and the one failure with it is the named one; with that failure dropped (ASSERTION_OFF) it is not detected.
        {
          name: 'Probe that the row menu probe sees a trigger that does not say it is open',
          script: 'packages/kit/probes/row-menu-probe.mjs',
          env: { DIST: '$PROBE_DIST' },
          controls: ['trigger-not-expanded', 'expanded-twice'],
        },
      ],
    },
    {
      id: '4',
      units: [
        // The kit's parts on the real `ui-next` page against the pinned mock reference (packages/kit/probes/mock-reference.json): parity with the mock, tokens, counts, keyboard, accessibility with axe-core.
        { name: 'Probe the parts against the pinned mock reference', script: 'packages/kit/probes/kit-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/kit-probe.json' } },

        // The command palette (C1b) in the real shell fixture (ui-next/shell/probes/palette-fixture.tsx: the real view, model and tab model over invented sources), against the pinned mock reference
        // (ui-next/shell/probes/mock-palette.json, measured from the mock's own palette in seven scenes by mock-palette-measure.mjs): the Search control, the frame, the input, the kinds, the list, the status band and
        // the footer within 1 px, the paint of each, the keyboard with real key presses (the chord, the arrows, Enter and Command Enter, Escape and where the focus goes, Tab, the inert page, hover), the states and
        // axe on each, and what it costs with 1,000 host rows (open and keystroke to rows painted, recorded; one commit a keystroke, no layout shift, and a closed palette that holds one listener and no timer, judged), at
        // 1440 x 900 and 1280 x 800. FONT_DELAY_MS=40 serves the fonts as a runner does. It builds its own fixtures, so it does not read PROBE_DIST.
        { name: 'Probe the command palette against the pinned mock reference', script: 'ui-next/shell/probes/palette-probe.mjs', env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/palette-probe.json' } },
      ],
    },
    {
      id: '5',
      units: [
        // The tab strip, the page host and the load, at 1440 x 900 and 1280 x 800 (decision A15). It builds its own fixtures, so it does not read PROBE_DIST.
        { name: 'Probe the tab strip, the page host and the load against the pinned mock reference', script: 'ui-next/shell/probes/strip-probe.mjs', env: { REPORT: '$RUNNER_TEMP/strip-probe.json' } },

        // The list page's chrome (1a.3c; first in a shard by N24-K2): the real Shell, ListPage and PageHeader around invented data (ui-next/page/probes/fixture.tsx) against the pinned mock reference (packages/kit/probes/mock-page.json, measured
        // from the mock by mock-page-measure.mjs), in WebKit and Chromium at 1440 x 900 and 1030 x 720 (the viewports of probe-lib.mjs; tracker row N23 moves them): the rectangles of the data view, header, title, command lane, quick filters and chips,
        // toolbar and search field, table header, first row and footer, the 12/8/8 gaps, and a frame sampler around Refresh and every operation state, where no part moves by 0.001 px. It builds its own fixture, so it does not read PROBE_DIST.
        { name: 'Probe the list page chrome and its layout shift against the pinned mock reference', script: 'ui-next/page/probes/page-probe.mjs' },

        // The negative controls of the strip probe's `arrival` section (Q2a): a tree that does not hold the count slot (`slot-width`) and a skeleton that declares none (`slot-undeclared`) each make a label give way when its
        // count arrives. The probe must see it, and passes only when it does: the label's rectangle is the assertion (the layout-shift observer reads 0 for both, so a probe that only watched it would pass).
        {
          name: 'Probe that the strip probe sees a label that gives way to a count',
          script: 'ui-next/shell/probes/strip-probe.mjs',
          controls: ['slot-width', 'slot-undeclared'],
        },

        // What the providers a plugin brings do to the command palette (C1c): the host's own wiring of the fixture plugin's providers (ui-next/shell/probes/palette-plugins-fixture.tsx: the real shell, palette and tab model)
        // in WebKit and Chromium at 1440 x 900 and 1280 x 800. What is judged does not depend on how fast the machine is: the order things happen in (the input shows its text before a slow provider answers, the fast
        // provider's rows before the slow one's, the active row where the user left it when a late section arrives), what a key costs a page that a provider holds, the commits of a key and of an answer, nothing outside the
        // palette moving, a closed palette doing no provider work, and the states (a provider that throws, never answers or answers after it was told to stop; a plugin that leaves while the palette is open), with axe.
        // It builds its own fixtures, so it does not read PROBE_DIST.
        { name: 'Probe what the providers of a plugin do to the command palette', script: 'ui-next/shell/probes/palette-plugins-probe.mjs', env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/palette-plugins-probe.json' } },
      ],
    },
    {
      id: '6',
      units: [
        // The log view (P1b-2): the kit's LogView staged at the size of the mock's Logs tool against the pinned mock reference (packages/kit/probes/mock-log.json, measured from the mock by
        // mock-log-measure.mjs): the regions, the header, the rows, the filter row in five states (nothing in it moves), the Tab stops and the list's keys with real key presses, the `copy` event
        // as plain text, the Source column of a log that follows several sources (the mock's own measurement of it, and the tooltip a cut name shows on a real hover), and axe, in WebKit and Chromium at 1440 x 900 and 1280 x 800.
        // What differs from the mock on purpose is listed in the probe (KNOWN_DEVIATIONS), each with its approval.
        { name: 'Probe the log view against the pinned mock reference', script: 'packages/kit/probes/log-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/log-probe.json' } },

        // The shell's probes build their own fixtures (the repository's `vite build` of ui-next/shell/probes/*.html, once for production and once for React's development build, which the
        // commit counts read), so they do not read PROBE_DIST. The strip probe runs at 1440 x 900 and 1280 x 800 (decision A15); the frame probe at its reference's two viewports until the
        // probe viewports switch (tracker row N23). Linux Chromium needs the hinting flag the kit probes use, which the probes pass themselves.
        { name: 'Probe the shell frame against the pinned mock reference', script: 'ui-next/shell/probes/shell-probe.mjs', env: { REPORT: '$RUNNER_TEMP/shell-probe.json' } },

        // The kit's other parts (1a.4b/c; first in a shard by N24-K2): Chip, Status, MissingValue, KindTile, QuickFilters (with RovingGroup) and MiddleEllipsis against the pinned mock reference (packages/kit/probes/mock-atoms-bc.json, measured by
        // mock-measure-bc.mjs) in WebKit and Chromium at 1440 x 900 and 1030 x 720: 118 parity cases, the strip at three widths, the ellipsis at ten, element counts, no write to <html> or <body>, the accessibility tree, axe-core, and at 1440 x 900 the
        // roving keyboard traces and the paint and axe of the nine themes. A deviation its KNOWN_DEVIATIONS does not name exits 1. It resolves axe-core as kit-probe.mjs does and reads the ui-next build.
        { name: 'Probe the chip, status, missing value, kind tile, quick filters and middle ellipsis against the pinned mock reference', script: 'packages/kit/probes/kit-probe-bc.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/bc-probe.json' } },
      ],
    },
    {
      id: '7',
      units: [
        // The one tooltip host: listeners, cost, delay, Escape layering, placement, motion.
        { name: 'Probe the tooltip host', script: 'packages/kit/probes/tooltip-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/tooltip-probe.json' } },

        // The negative controls of the palette probe (its probe is in shard 4): each perturbs one measured value in the page (the frame's width, a row's height, the footer's height, the Search control's place, the gap between two keys of the
        // footer, the paint of the active row, hover that takes the keyboard's row, a palette that does not give the focus back) and passes only when the probe sees it. The widths of the Search control, of its hint and
        // of the footer's keys are not compared, because a key is written for the platform (the mock was measured on a Mac: the Command sign and K; a Linux runner writes Ctrl+K); their heights, edges and gaps are, and every
        // other box is compared in full. The report in the log counts the boxes of each kind and prints both widths and the fonts that draw the keys.
        {
          name: 'Probe that the palette probe sees a palette that is wrong',
          script: 'ui-next/shell/probes/palette-probe.mjs',
          env: { FONT_DELAY_MS: '40' },
          controls: ['frame-width', 'row-height', 'foot-height', 'search-place', 'foot-gap', 'paint', 'hover-steals', 'no-restore'],
        },

        // The negative controls of the toast probe (O1b-1): each perturbs one measured value in the page after it loaded (a toast 20 px too wide, a gap of 14, the Retry's colour, a failure that is not an alert, a layer that is
        // not live, an announcement made twice, a toast that takes the focus, F6 that reaches the toasts first, a focus not given back, a failure that closes by itself, a pointer that does not hold the clock, a hold that outlives its
        // toast, a stack drawn over the palette, a timer left after the stack is empty, a control that moves, a stack that does not avoid a control, a toast over a control's centre, a hidden stack that is still an F6 stop) and passes
        // only when the probe sees it, on the section that must (Chromium, 1440 x 900); with that assertion dropped (ASSERTION_OFF) it is not detected.
        {
          name: 'Probe that the toast probe sees a toast layer that is wrong',
          script: 'ui-next/shell/probes/notices-probe.mjs',
          env: { FONT_DELAY_MS: '40' },
          controls: ['toast-width', 'gap', 'retry-paint', 'no-alert', 'no-live', 'told-twice', 'steals-focus', 'f6-first', 'no-restore', 'sticky-closes', 'no-hold', 'hover-stuck', 'modal-leaks', 'timer-left', 'layout-shift', 'no-avoid', 'covers', 'yield-stop', 'yield-expires', 'yield-drops-focus'],
        },

        // The table: header, rows, selection column, sort, hover, selected and focus states, the fit, the nine themes, against the pinned mock reference (packages/kit/probes/mock-table.json).
        { name: 'Probe the table against the pinned mock reference', script: 'packages/kit/probes/table-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/table-probe.json' } },
      ],
    },
    {
      id: '8',
      units: [
        // The toast layer (O1b-1): the real shell with its panel and its command palette and the real `Toasts` over the notices model (ui-next/shell/probes/notices-fixture.tsx), against the mock's own toast layer
        // (ui-next/shell/probes/mock-notices.json, measured by mock-notices-measure.mjs in three scenes: an info toast, a failure with its Retry, the stack at the cap) within 1 px and its paint exactly, axe on the layer and the
        // two live regions, the keyboard path (F6 reaches the toasts last, Tab, Escape and the focus given back), what a toast lives for and what holds it (a clock the probe drives), what a screen reader is told (the roles,
        // once, never twice), what 50 notices in one tick cost (one commit for each flush, nothing shifts, nothing held once the stack is empty) and where the stack stands (P7: home, moved, hidden; never over a control's
        // centre; the palette takes it away and it comes back), at 1440 x 900 and 1280 x 800 in both engines. It builds its own fixtures, so it does not read PROBE_DIST.
        { name: 'Probe the toast layer against the pinned mock reference', script: 'ui-next/shell/probes/notices-probe.mjs', env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/notices-probe.json' } },

        // The negative controls of that probe: the feed goes quiet once the view is hidden, which a view that costs nothing because its feed is quiet would pass every zero of; every Source cell says the other source's name; the list is
        // scrolled 48 px when the column appears; every listener ever added to a Set is kept, so the model of a view outlives its closed tab and the heap does not fall back (A21); a stream is closed twice, which the count of closed
        // feeds does not see; a held view shows another line from the one it had (A21); a second press that starts a second stream, a tab with no twin that draws a scope, two tabs that carry one name, a scoped
        // tab whose name leaves its scope out, and the view of a session that ended and was pressed again showing another line from the one it had (A22; each is detected by its own check and by no other: a page that
        // draws no tab is never taken for one). The probe must fail the check each one is for (Chromium at 1440 x 900, its section only), and the step passes only when it did.
        {
          name: 'Probe that the logs probe sees a feed that stopped, a wrong source and a list that moved',
          script: 'ui-next/shell/probes/logs-probe.mjs',
          controls: ['feed-stopped', 'source-label', 'column-moves', 'kept-leak', 'close-twice', 'kept-lines', 'second-stream', 'lone-scope', 'same-name', 'axe-name', 'over-lines'],
        },

        // The rail (S2a): its entries' targets, faces and glyphs, and the paint of the current entry and of another in six states, against the pinned mock reference (ui-next/shell/probes/mock-rail.json,
        // measured from the mock's two rails by mock-rail-measure.mjs), at 1440 x 900 and 1280 x 800. It builds its own fixture, so it does not read PROBE_DIST.
        { name: 'Probe the rail against the pinned mock reference', script: 'ui-next/shell/probes/rail-probe.mjs', env: { REPORT: '$RUNNER_TEMP/rail-probe.json' } },

        // The fonts are delivered, used, and the page does not shift.
        { name: 'Probe the fonts and the layout shift', script: 'packages/kit/probes/fonts-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/fonts-probe.json' } },
      ],
    },
  ],

  // Probe scripts CI does not run: each is run by hand, and a probe is listed here, with the reason, so that "no shard runs it" is a decision someone wrote down and not something nobody noticed. Empty since N24 K2 (the last three, `kit-probe-bc`,
  // `page-probe` and `row-menu-probe`, are in shards). Moving one into a shard is a change to this table, and adds its seconds to a shard.
  byHand: [],
};

export const BY_HAND = TABLE.byHand;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The seconds
//
// What each unit costs on the RUNNER, by the unit's name. Measured 2026-11-21 (N24 K3): the median, rounded up, of the units' seconds in the job summaries of the last 8 green runs of `UI next kit probes` on main and on merged pull requests,
// 44877464537, 44875776982, 44875745153, 44874827802, 44873765638, 44872480508, 44871022880 and 44869267030 (heads bbdc8307, 7eba430f, 2bebc481, 1b205bee, 6b3d9b58, 0ffcf2a6, a9eb87e3 and a43f897a), with the runs and rows in
// docs/ui-next/status/N24-K3-seconds.json. A run counts for a unit only when the unit had the controls it has today. Three units have fewer runs: the toast layer 4, its controls 3 (the first runs had 18 controls, then 20), the plugin providers'
// controls 3 (7 controls before C1e, 9 now). A unit with no value here fails the test of the table, and a unit that runs more than DRIFT_RATIO over its value is a `::warning::` in the run that did it: put the new median here.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export const MEASURED_SECONDS = {
  'Probe the bottom panel against the pinned mock reference': 292,
  'Probe that the panel probe sees a panel that is wrong': 411,
  'Probe the Logs tool in a real engine': 321,
  'Probe that the logs probe sees a feed that stopped, a wrong source and a list that moved': 161,
  'Probe the command palette against the pinned mock reference': 260,
  'Probe that the palette probe sees a palette that is wrong': 63,
  'Probe the tab strip, the page host and the load against the pinned mock reference': 192,
  'Probe that the strip probe sees a label that gives way to a count': 28,
  'Probe the log view against the pinned mock reference': 181,
  'Probe that the log probe sees a log view that is wrong': 109,
  'Probe the tooltip host': 145,
  'Probe the parts against the pinned mock reference': 164,
  // C1f, C1g: ESTIMATES over the runner's medians of K3 (142 and 91): 9 s and 14 s for the plugin providers probe and its controls. C1f added the connection part (about 1.5 s a pair of an engine and a viewport) and its control (a run like the keyword
  // controls'), C1g the names part (about 0.7 s a pair) and its control, until a run's summary has the runner's.
  'Probe what the providers of a plugin do to the command palette': 151,
  'Probe that the plugin providers probe sees a palette that is wrong': 105,
  'Probe the table against the pinned mock reference': 62,
  'Probe the shell frame against the pinned mock reference': 46,
  'Probe the fonts and the layout shift': 35,
  'Probe the rail against the pinned mock reference': 16,
  'Probe the detail page against the pinned mock reference': 16,
  'Probe the list page chrome and its layout shift against the pinned mock reference': 61,
  'Probe the chip, status, missing value, kind tile, quick filters and middle ellipsis against the pinned mock reference': 197,
  'Probe the row menu on the 5,000-row example': 22,
  'Probe that the row menu probe sees a trigger that does not say it is open': 2,
  'Probe the toast layer against the pinned mock reference': 220,
  'Probe that the toast probe sees a toast layer that is wrong': 156,
};

/** The wall time a shard job is held to: 9 minutes, the job (its setup and its probes) from start to end. */
export const WALL_BUDGET_SECONDS = 540;
/** The 90th percentile of a shard job's setup (the job minus its probes' step) on the 56 shard jobs of the 8 runs above (median 88 s, maximum 118 s; docs/ui-next/status/N24-K3.md). */
export const SETUP_P90_SECONDS = 108;
/** The most unit seconds a shard may hold: the budget less the setup, so that a shard with its median probe seconds and a slow (90th percentile) setup is a job of 9 minutes. The table is checked against it by the test, not by the check. */
export const LIMIT_SECONDS = WALL_BUDGET_SECONDS - SETUP_P90_SECONDS;

/** A unit is reported when it took more than this over its value in MEASURED_SECONDS (a quarter)... */
export const DRIFT_RATIO = 0.25;
/** ...and more than this many seconds more: of the 186 unit runs of the 8 runs above, 3 passed the ratio alone (the strip's controls at 38 s and at 36 s for 28, the palette's controls at 81 s for 63) and 1 passes the floor too, and a warning that fires on noise is one nobody reads. */
export const DRIFT_FLOOR_SECONDS = 10;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Which files are probe scripts, and the check
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** A probe script is named `<thing>-probe.mjs`, or `<thing>-probe-<suffix>.mjs`: not `probe-lib.mjs`, the fixtures, the helpers, the mock measurers or the dev tools that share its directory. */
export const isProbeScript = (file) => /(?:^|\/)[^/]*-probe(?:-[^/]*)?\.[cm]?[jt]s$/.test(file);

/** Every probe script of `dirs` under `root`, repository-relative with `/`, sorted. A directory that is not there is an error: a renamed directory must not turn the scan into an empty one that finds nothing to complain about. */
export function findProbeScripts(root, dirs = PROBE_DIRS) {
  const found = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && isProbeScript(child)) found.push(child);
    }
  };
  for (const dir of dirs) {
    try {
      walk(dir);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`the probe directory ${dir} does not exist: update PROBE_DIRS in scripts/ci/probe-shards.mjs`);
      throw error;
    }
  }
  return found.sort();
}

/** The shard ids of the workflow, from the one line `shard: [1, 2, ...]` of its matrix; null when that line is not there exactly once. */
export function readWorkflowShards(text) {
  const lines = [...text.matchAll(/^[ \t]+shard:[ \t]*\[([^\]\n]*)\][ \t]*(?:#.*)?$/gm)];
  if (lines.length !== 1) return null;
  return lines[0][1]
    .split(',')
    .map((entry) => entry.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter((entry) => entry !== '');
}

const say = (ids) => (ids.length <= 1 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`);

/**
 * The problems of a table, as `{ message, file?, title }`, one sentence each, each naming the file or the unit it is about.
 *   table           `{ shards: [{ id, units }], byHand: [{ script, reason }] }`
 *   found           the probe scripts that are on disk under the probe directories (findProbeScripts)
 *   exists          whether a repository-relative file is on disk
 *   workflowShards  the shard ids of the workflow's matrix (readWorkflowShards), null when they could not be read
 */
export function checkTable({ table, found, exists, workflowShards }) {
  const problems = [];
  const add = (message, file, title = 'Kit probe shard table') => problems.push(file === undefined ? { message, title } : { message, file, title });

  const ids = new Set();
  const unitShards = new Map();
  const scriptShards = new Map();
  // The units of each probe script: the probe itself (no controls) and its negative controls. They may run in different shards (N24 K2), but each runs exactly once: one unit of the probe, one unit of its controls.
  const probeUnits = new Map();
  const controlUnits = new Map();
  for (const shard of table.shards) {
    if (ids.has(shard.id)) add(`shard ${shard.id} is in the table twice`);
    ids.add(shard.id);
    if (shard.units.length === 0) add(`shard ${shard.id} has no unit: it would run nothing; delete it here and from the matrix of ${WORKFLOW}`);
    shard.units.forEach((unit, index) => {
      if (typeof unit.name !== 'string' || unit.name === '') {
        add(`unit ${index + 1} of shard ${shard.id} has no name: a unit is named as the workflow step it replaced`);
        return;
      }
      const where = `the unit "${unit.name}" of shard ${shard.id}`;
      unitShards.set(unit.name, [...(unitShards.get(unit.name) ?? []), shard.id]);
      if (typeof unit.script !== 'string' || unit.script === '') {
        add(`${where} has no script`);
      } else {
        scriptShards.set(unit.script, [...new Set([...(scriptShards.get(unit.script) ?? []), shard.id])]);
        const kind = unit.controls === undefined ? probeUnits : controlUnits;
        kind.set(unit.script, [...(kind.get(unit.script) ?? []), { name: unit.name, shard: shard.id }]);
        if (!exists(unit.script)) add(`${unit.script} is named by ${where} but does not exist: the probe was renamed or deleted; update scripts/ci/probe-shards.mjs`, unit.script);
      }
      for (const [key, value] of Object.entries(unit.env ?? {})) {
        if (typeof value !== 'string') add(`${where} sets ${key} to a ${typeof value}: an env value is a string`);
      }
      if (unit.controls !== undefined) {
        if (!Array.isArray(unit.controls) || unit.controls.length === 0) add(`${where} has an empty controls list: it would run the probe zero times`);
        else {
          const seen = new Set();
          for (const control of unit.controls) {
            if (seen.has(control)) add(`${where} lists the control "${control}" twice`);
            seen.add(control);
          }
        }
      }
      if (unit.env !== undefined && 'NEGATIVE_CONTROL' in unit.env) add(`${where} sets NEGATIVE_CONTROL in env: a negative control is listed in controls, which sets it`);
    });
  }

  for (const [name, shards] of unitShards) {
    if (shards.length > 1 && new Set(shards).size > 1) add(`the unit "${name}" is in shards ${say([...new Set(shards)])}: a step runs once`);
    else if (shards.length > 1) add(`the unit "${name}" is twice in shard ${shards[0]}: a step runs once`);
  }

  const byHand = new Set();
  for (const entry of table.byHand) {
    byHand.add(entry.script);
    if (!exists(entry.script)) add(`${entry.script} is named by BY_HAND but does not exist: the probe was renamed or deleted; update scripts/ci/probe-shards.mjs`, entry.script);
  }
  const named = (units) => say(units.map((entry) => `"${entry.name}" (shard ${entry.shard})`));
  for (const [script, units] of probeUnits) {
    if (units.length > 1) add(`${script} runs twice as a probe: the units ${named(units)}: a probe runs once`, script);
  }
  for (const [script, units] of controlUnits) {
    if (units.length > 1) add(`${script} has two units of negative controls: ${named(units)}: list its controls in one unit, so that each runs exactly once`, script);
  }
  for (const [script, shards] of scriptShards) {
    if (byHand.has(script)) add(`${script} is run by shard${shards.length > 1 ? 's' : ''} ${say(shards)} and listed in BY_HAND: a probe is run by a shard or by hand, not both`, script);
  }

  for (const file of found) {
    if (!scriptShards.has(file) && !byHand.has(file)) {
      add(
        `${file} is a probe script and no shard runs it: add a unit for it to a shard in scripts/ci/probe-shards.mjs (its negative controls in the same shard), or list it in BY_HAND with the reason CI does not run it`,
        file,
        'Kit probe is in no shard',
      );
    }
  }

  if (workflowShards === null) {
    add(`cannot find the matrix line \`shard: [1, 2, ...]\` in ${WORKFLOW} (once, on one line): the check reads the shards the workflow runs from it`);
  } else {
    const listed = new Set();
    for (const id of workflowShards) {
      if (listed.has(id)) add(`the matrix of ${WORKFLOW} lists shard ${id} twice`);
      listed.add(id);
    }
    for (const id of ids) if (!workflowShards.includes(id)) add(`shard ${id} is in the table but not in the matrix of ${WORKFLOW}: its probes would never run`);
    for (const id of new Set(workflowShards)) if (!ids.has(id)) add(`the matrix of ${WORKFLOW} has shard ${id}, which the table does not have: that job would run nothing`);
  }

  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// One unit is runs; one shard is a plan
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** `$NAME` and `${NAME}` in `value`, from `vars`; a name that is not set (or empty) is an error, never an empty string inside a path. */
export function expandEnv(value, vars, where) {
  return value.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (match, braced, bare) => {
    const got = vars[braced ?? bare];
    if (got === undefined || got === '') throw new Error(`${where} sets an env value to ${JSON.stringify(value)}, and ${match} is not set`);
    return got;
  });
}

/** The runs of a unit: one, or one for each of its controls (with NEGATIVE_CONTROL), each with the unit's env expanded from `vars`. */
export function expandUnit(unit, vars) {
  const where = `the unit "${unit.name}"`;
  const env = Object.fromEntries(Object.entries(unit.env ?? {}).map(([key, value]) => [key, expandEnv(value, vars, where)]));
  if (unit.controls === undefined) return [{ label: unit.name, script: unit.script, control: null, env }];
  return unit.controls.map((control) => ({ label: `${unit.name} (${control})`, script: unit.script, control, env: { ...env, NEGATIVE_CONTROL: control } }));
}

const readsDist = (unit) => Object.values(unit.env ?? {}).some((value) => /\$(?:\{PROBE_DIST\}|PROBE_DIST\b)/.test(value));

/** What a shard runs: its units in order, the number of runs, and whether one of them reads the ui-next build in $PROBE_DIST (the workflow builds it only then). */
export function planShard(table, id) {
  const shard = table.shards.find((candidate) => candidate.id === id);
  if (shard === undefined) throw new Error(`no shard ${id} (the shards are ${table.shards.map((candidate) => candidate.id).join(', ')})`);
  return { id, units: shard.units, runs: shard.units.reduce((sum, unit) => sum + (unit.controls?.length ?? 1), 0), dist: shard.units.some(readsDist) };
}

export function renderPlan(plan) {
  const lines = [`Kit probes shard ${plan.id}: ${plan.units.length} steps, ${plan.runs} runs, ${plan.dist ? 'reads' : 'does not read'} the ui-next build`];
  for (const unit of plan.units) lines.push(`  - ${unit.name} (${unit.script}${unit.controls ? `, ${unit.controls.length} controls` : ''})`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Running a shard
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const TAIL_BYTES = 16 * 1024;
const TAIL_LINES = 40;

/** A workflow command's message: `%`, CR and LF are the three characters it cannot carry. */
const escapeData = (text) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

function runOne(run, { id, root, env, out, node }) {
  return new Promise((resolve) => {
    out(`::group::${run.label}\n`);
    const started = performance.now();
    let tail = '';
    let last = '\n';
    const forward = (chunk) => {
      const text = chunk.toString('utf8');
      if (text === '') return;
      out(text);
      last = text.at(-1);
      tail = (tail + text).slice(-TAIL_BYTES);
    };
    let settled = false;
    const finish = (code, signal, problem) => {
      if (settled) return;
      settled = true;
      const seconds = (performance.now() - started) / 1000;
      if (last !== '\n') out('\n');
      out('::endgroup::\n');
      const ok = code === 0 && problem === undefined;
      if (!ok) {
        const how = problem ?? (signal ? `was killed by ${signal}` : `exited with code ${code}`);
        // A control may run in another shard than its probe: the line names the probe's script and the control as well as the step.
        out(`::error title=Kit probe failed (shard ${id})::${escapeData(`${run.label} [${run.script}${run.control === null ? '' : `, negative control ${run.control}`}] ${how}`)}\n`);
        const lines = tail.split('\n');
        if (lines.at(-1) === '') lines.pop();
        out(`Last lines of its output:\n${lines.slice(-TAIL_LINES).map((line) => `  ${line}`).join('\n')}\n`);
      }
      resolve({ label: run.label, script: run.script, control: run.control, ok, code, signal: signal ?? null, seconds });
    };
    const child = spawn(node, [path.join(root, run.script)], { cwd: root, env: { ...env, ...run.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', (error) => finish(null, null, `could not start: ${error.message}`));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/** Runs every run of every unit of the shard, one at a time, to the end: the results are `{ label, unit, script, control, ok, code, signal, seconds }` in order (`unit` is the name of the unit the run belongs to). A failure does not stop the shard. */
export async function runShard(table, id, { root = REPO_ROOT, env = process.env, out = (text) => process.stdout.write(text), node = process.execPath } = {}) {
  const { units } = planShard(table, id);
  const results = [];
  for (const unit of units) {
    for (const run of expandUnit(unit, env)) results.push({ ...(await runOne(run, { id, root, env, out, node })), unit: unit.name });
  }
  return results;
}

const whole = (value) => Math.round(value);
const outcome = (result) => (result.ok ? 'pass' : `**fail** (${result.signal ? result.signal : `exit ${result.code}`})`);

/** The job summary of a shard (Markdown): the counts, and a row for each run with its seconds, the probe script it ran, the negative control (empty for the probe itself) and the step that holds it. */
export function renderSummary(id, results) {
  const failed = results.filter((result) => !result.ok).length;
  const total = whole(results.reduce((sum, result) => sum + result.seconds, 0));
  const runs = `${results.length} run${results.length === 1 ? '' : 's'}`;
  const head = `### Kit probes shard ${id}: ${runs}, ${failed === 0 ? 'all passed' : `${failed} failed`}, ${total} s`;
  const cell = (text) => String(text ?? '').replaceAll('|', '\\|');
  const step = (result) => (result.control && result.label.endsWith(` (${result.control})`) ? result.label.slice(0, -` (${result.control})`.length) : result.label);
  const rows = results.map((result) => `| ${outcome(result)} | ${whole(result.seconds)} | ${cell(result.script)} | ${cell(result.control)} | ${cell(step(result))} |`);
  return [head, '', '| Result | Seconds | Probe | Negative control | Step |', '|---|--:|---|---|---|', ...rows, ''].join('\n');
}

/**
 * One `::warning::` line for each unit of the shard that took more than DRIFT_RATIO and DRIFT_FLOOR_SECONDS over its value in `measured`, naming the unit, and one for each unit that has no value: the table drifts when nobody is told (K3: shard 5 was
 * 562 s on the runner against 489 s in the table, because older units carried laptop seconds). A unit's seconds are those of its runs added up; a unit with a run that failed is left out, because the seconds of a probe that stopped early or hung
 * say nothing about what it costs. It is a warning, never a failure: the limit is a plan, and no probe is wrong for being slow.
 */
export function driftWarnings(id, results, measured = MEASURED_SECONDS) {
  const units = new Map();
  for (const result of results) {
    if (result.unit === undefined) continue;
    const entry = units.get(result.unit) ?? { seconds: 0, ok: true };
    entry.seconds += result.seconds;
    entry.ok &&= result.ok;
    units.set(result.unit, entry);
  }
  const title = `Kit probe unit seconds (shard ${id})`;
  const lines = [];
  for (const [unit, entry] of units) {
    if (!entry.ok) continue;
    const took = whole(entry.seconds);
    const table = measured[unit];
    if (table === undefined) {
      lines.push(`::warning title=${title}::${escapeData(`${unit} took ${took} s on this runner and has no value in MEASURED_SECONDS (scripts/ci/probe-shards.mjs): add it`)}`);
    } else if (entry.seconds > table * (1 + DRIFT_RATIO) && entry.seconds - table > DRIFT_FLOOR_SECONDS) {
      const over = whole(((entry.seconds - table) / table) * 100);
      lines.push(
        `::warning title=${title}::${escapeData(`${unit} took ${took} s on this runner, ${table} s in MEASURED_SECONDS (${over} percent over; the warning is at ${DRIFT_RATIO * 100} percent and ${DRIFT_FLOOR_SECONDS} s): put its new median there and check that no shard is over ${LIMIT_SECONDS} s (scripts/ci/probe-shards.mjs)`)}`,
      );
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const USAGE = 'usage: node scripts/ci/probe-shards.mjs [--root <repository>] check | plan <shard> | run <shard>';

export async function main(argv = process.argv.slice(2), { table = TABLE, measured = MEASURED_SECONDS, env = process.env, out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text) } = {}) {
  let root = REPO_ROOT;
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1] !== undefined) root = path.resolve(argv[(i += 1)]);
    else words.push(argv[i]);
  }
  const [verb, id] = words;
  if (!['check', 'plan', 'run'].includes(verb) || (verb !== 'check' && id === undefined) || words.length > (verb === 'check' ? 1 : 2)) {
    err(`${USAGE}\n`);
    return 2;
  }

  if (verb === 'check') {
    let found;
    try {
      found = findProbeScripts(root);
    } catch (error) {
      err(`probe-shards: ${error.message}\n`);
      return 1;
    }
    let workflowShards = null;
    try {
      workflowShards = readWorkflowShards(readFileSync(path.join(root, WORKFLOW), 'utf8'));
    } catch {
      // the matrix cannot be read: checkTable says so
    }
    const problems = checkTable({ table, found, exists: (file) => existsSync(path.join(root, file)), workflowShards });
    for (const problem of problems) {
      if (env.GITHUB_ACTIONS === 'true') out(`::error ${problem.file === undefined ? '' : `file=${problem.file},`}title=${problem.title}::${escapeData(problem.message)}\n`);
      else err(`probe-shards: ${problem.message}\n`);
    }
    if (problems.length > 0) return 1;
    const scripts = new Set(table.shards.flatMap((shard) => shard.units.map((unit) => unit.script)));
    out(`probe-shards: ok (${table.shards.length} shards, ${table.shards.reduce((sum, shard) => sum + shard.units.length, 0)} steps, ${scripts.size} probe scripts in shards, ${table.byHand.length} by hand)\n`);
    return 0;
  }

  let plan;
  try {
    plan = planShard(table, id);
  } catch (error) {
    err(`probe-shards: ${error.message}\n`);
    return 2;
  }
  if (verb === 'plan') {
    out(renderPlan(plan));
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `dist=${plan.dist}\n`);
    return 0;
  }

  let results;
  try {
    results = await runShard(table, id, { root, env, out });
  } catch (error) {
    err(`probe-shards: ${error.message}\n`);
    return 1;
  }
  const summary = renderSummary(id, results);
  out(`\n${summary}\n`);
  for (const line of driftWarnings(id, results, measured)) out(`${line}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  return results.every((result) => result.ok) ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

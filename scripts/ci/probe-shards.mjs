// The kit probes, split into shards: which probe runs in which job, the check that no probe is left out, and the commands the workflow runs on the table.
//
//   node scripts/ci/probe-shards.mjs check            exit 1, one line per problem, when a probe script is in no shard (or two), a shard is not in the workflow's matrix, or a unit does not hold together
//   node scripts/ci/probe-shards.mjs plan <shard>     what the shard runs; writes `dist=true|false` to $GITHUB_OUTPUT (does a probe of the shard read the ui-next build?)
//   node scripts/ci/probe-shards.mjs run <shard>      runs every probe of the shard, one after the other, and exits 1 when any failed (all of them run: a push shows every failure, not the first)
//   --root <dir>                                      another tree than this repository (the tests)
//
// .github/workflows/ui-next-kit-probes.yml fans out one job per shard (`strategy.matrix.shard`) and one job named `Kit probes` that is green only when every shard is. Each shard job installs and builds
// what it needs, runs `check`, and runs its shard. The probes are the same Node processes the single job ran, one after the other, with the same env; only the VM they run on changed.
//
// ADDING A PROBE. Write `<thing>-probe.mjs` in one of PROBE_DIRS, add a unit for it (and a unit for its negative controls, if it has them: they run in the same shard) to a shard below, the one with the most
// room, and run `node scripts/ci/probe-shards.mjs check`. A probe script that no shard runs fails that check, in every shard job, with its path on the error line; a probe CI is not to run goes in BY_HAND
// with the reason. A new shard is a new entry in SHARDS and a new number in the workflow's `shard: [...]` line, both in one change: `check` fails when they differ.
//
// BALANCE. The shard jobs wait for the slowest shard, so a shard that grows is the job's wall time. Every run of a shard writes the seconds of each of its probes to the job summary: move a unit between shards
// when one is more than a minute over the others. The assignment below was made from the green runs of 2026-11-20 on main at e32cd86e (runs 44773679493, 44779358333 and 44783882679), in seconds, each probe and its controls:
//   shard 1  panel 231 + 188                                                                       = 419
//   shard 2  table 64, rail 16, detail 11, palette 265 + 65                                        = 421
//   shard 3  fonts 36, shell 50, log view 205 + 118                                                = 409
//   shard 4  tooltip 145, logs 215 + 62                                                            = 422
//   shard 5  parts 177, strip 187, strip controls 14 (Q2a: measured 2026-11-20 at a load of 4)      = 378
// The panel probe with its six controls is the longest unit and cannot be split without parting a probe from its controls, so a sixth shard would not make the job shorter.
// P1b-3c (A21) added the panel probe's `held` section and four controls, and the logs probe's `kept` and `memory` sections and three controls: by estimate about 180 s more in shard 1 (to about 600) and 155 s more
// in shard 4 (to about 580), not yet measured on a runner. The panel probe with its controls stays the longest unit, so the job's wall time is the panel's; the next run's job summary has the seconds, and the tooltip
// probe (145) is the unit to move out of shard 4 if that shard turns out to be more than a minute over the next.
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
        // The bottom panel (P1a): the region, the splitter, the tool strip, the session tabs, the session card and the status bar's toggle against the pinned mock reference
        // (ui-next/shell/probes/mock-panel.json, measured from the mock's own panel by mock-panel-measure.mjs), what opening and resizing the panel move (the frame's height, nothing else), the paint of its parts,
        // the keyboard path and the splitter's keys with real key presses, axe, what a drag costs (no write at the document root, no commit while the pointer moves), a plugin's tool that registers late, and a
        // session body that keeps running while it is hidden, and (A21) the sessions of the host's Logs tool that their plugin's unload kept (the tab stays in its place, ended or as it was, its body mounted and counting
        // no more, the card's link and Open button unavailable while the plugin is off and working when it returns, a new press a twin beside it, Delete closing it), at 1440 x 900 and 1280 x 800. It builds its own
        // fixtures, so it does not read PROBE_DIST.
        { name: 'Probe the bottom panel against the pinned mock reference', script: 'ui-next/shell/probes/panel-probe.mjs', env: { REPORT: '$RUNNER_TEMP/panel-probe.json' } },

        // The negative controls of that probe: each perturbs one measured value in the page (the region's height, the gap between a session's glyph and its name, the toggle's place, a tool tab's padding, the
        // sidebar's place when the panel opens, a write at the document root during a drag, and, for the sessions their plugin's unload kept (A21): the tab of the held session is not drawn, nor is the tab of the one that
        // had ended on its own, a tab moves, the Open button can be pressed while the plugin is off) and passes only when the probe sees it. A probe that cannot fail proves nothing.
        {
          name: 'Probe that the panel probe sees a panel that is wrong',
          script: 'ui-next/shell/probes/panel-probe.mjs',
          controls: ['panel-height', 'session-gap', 'toggle', 'tab-padding', 'shift', 'root-write', 'held-hidden', 'held-done-hidden', 'held-moved', 'held-enabled'],
        },
      ],
    },
    {
      id: '2',
      units: [
        // The table: header, rows, selection column, sort, hover, selected and focus states, the fit, the nine themes, against the pinned mock reference (packages/kit/probes/mock-table.json).
        { name: 'Probe the table against the pinned mock reference', script: 'packages/kit/probes/table-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/table-probe.json' } },

        // The rail (S2a): its entries' targets, faces and glyphs, and the paint of the current entry and of another in six states, against the pinned mock reference (ui-next/shell/probes/mock-rail.json,
        // measured from the mock's two rails by mock-rail-measure.mjs), at 1440 x 900 and 1280 x 800. It builds its own fixture, so it does not read PROBE_DIST.
        { name: 'Probe the rail against the pinned mock reference', script: 'ui-next/shell/probes/rail-probe.mjs', env: { REPORT: '$RUNNER_TEMP/rail-probe.json' } },

        // The detail page (D1a) in the real shell fixture: the header, the strip and the first sections against the pinned mock reference (packages/kit/probes/mock-detail.json), loading to ready
        // with no part moving, and the keyboard path through the strip, at 1440 x 900 and 1280 x 800. It builds its own fixture, so it does not read PROBE_DIST.
        { name: 'Probe the detail page against the pinned mock reference', script: 'ui-next/page/probes/detail-probe.mjs' },

        // The command palette (C1b) in the real shell fixture (ui-next/shell/probes/palette-fixture.tsx: the real view, model and tab model over invented sources), against the pinned mock reference
        // (ui-next/shell/probes/mock-palette.json, measured from the mock's own palette in seven scenes by mock-palette-measure.mjs): the Search control, the frame, the input, the kinds, the list, the status band and
        // the footer within 1 px, the paint of each, the keyboard with real key presses (the chord, the arrows, Enter and Command Enter, Escape and where the focus goes, Tab, the inert page, hover), the states and
        // axe on each, and what it costs with 1,000 host rows (open and keystroke to rows painted, recorded; one commit a keystroke, no layout shift, and a closed palette that holds one listener and no timer, judged), at
        // 1440 x 900 and 1280 x 800. FONT_DELAY_MS=40 serves the fonts as a runner does. It builds its own fixtures, so it does not read PROBE_DIST.
        { name: 'Probe the command palette against the pinned mock reference', script: 'ui-next/shell/probes/palette-probe.mjs', env: { FONT_DELAY_MS: '40', REPORT: '$RUNNER_TEMP/palette-probe.json' } },

        // The negative controls of that probe: each perturbs one measured value in the page (the frame's width, a row's height, the footer's height, the Search control's place, the gap between two keys of the
        // footer, the paint of the active row, hover that takes the keyboard's row, a palette that does not give the focus back) and passes only when the probe sees it. The widths of the Search control, of its hint and
        // of the footer's keys are not compared, because a key is written for the platform (the mock was measured on a Mac: the Command sign and K; a Linux runner writes Ctrl+K); their heights, edges and gaps are, and every
        // other box is compared in full. The report in the log counts the boxes of each kind and prints both widths and the fonts that draw the keys.
        {
          name: 'Probe that the palette probe sees a palette that is wrong',
          script: 'ui-next/shell/probes/palette-probe.mjs',
          env: { FONT_DELAY_MS: '40' },
          controls: ['frame-width', 'row-height', 'foot-height', 'search-place', 'foot-gap', 'paint', 'hover-steals', 'no-restore'],
        },
      ],
    },
    {
      id: '3',
      units: [
        // The fonts are delivered, used, and the page does not shift.
        { name: 'Probe the fonts and the layout shift', script: 'packages/kit/probes/fonts-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/fonts-probe.json' } },

        // The shell's probes build their own fixtures (the repository's `vite build` of ui-next/shell/probes/*.html, once for production and once for React's development build, which the
        // commit counts read), so they do not read PROBE_DIST. The strip probe runs at 1440 x 900 and 1280 x 800 (decision A15); the frame probe at its reference's two viewports until the
        // probe viewports switch (tracker row N23). Linux Chromium needs the hinting flag the kit probes use, which the probes pass themselves.
        { name: 'Probe the shell frame against the pinned mock reference', script: 'ui-next/shell/probes/shell-probe.mjs', env: { REPORT: '$RUNNER_TEMP/shell-probe.json' } },

        // The log view (P1b-2): the kit's LogView staged at the size of the mock's Logs tool against the pinned mock reference (packages/kit/probes/mock-log.json, measured from the mock by
        // mock-log-measure.mjs): the regions, the header, the rows, the filter row in five states (nothing in it moves), the Tab stops and the list's keys with real key presses, the `copy` event
        // as plain text, the Source column of a log that follows several sources (the mock's own measurement of it, and the tooltip a cut name shows on a real hover), and axe, in WebKit and Chromium at 1440 x 900 and 1280 x 800.
        // What differs from the mock on purpose is listed in the probe (KNOWN_DEVIATIONS), each with its approval.
        { name: 'Probe the log view against the pinned mock reference', script: 'packages/kit/probes/log-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/log-probe.json' } },

        // The negative controls of that probe: each perturbs one measured value in the page (a row's height, the clock column's width, the filter row's place when a count appears, the strip's
        // height, the copy event, the ArrowDown key, an unnamed button, a name that takes no pointer) and passes only when the probe's assertion for it is made and agrees without the perturbation and fails with it.
        {
          name: 'Probe that the log probe sees a log view that is wrong',
          script: 'packages/kit/probes/log-probe.mjs',
          env: { DIST: '$PROBE_DIST' },
          controls: ['row-height', 'time-column', 'filter-shift', 'strip-height', 'copy', 'keys', 'axe', 'source-tip'],
        },
      ],
    },
    {
      id: '4',
      units: [
        // The one tooltip host: listeners, cost, delay, Escape layering, placement, motion.
        { name: 'Probe the tooltip host', script: 'packages/kit/probes/tooltip-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/tooltip-probe.json' } },

        // The host's Logs tool (P1b-3a) on the host fixture (`?logs=1`): the log view fills the panel's body, opening a session moves nothing outside the log view, switching tool and back keeps the lines and the scroll place, what the
        // plugin counts of its feed (the registry and the view listen while the session is on screen, only the registry while another tool is shown, none once the tab is closed), and what the 10,000 lines a second session costs: at most one
        // commit a frame (and at least one) with the panel open (React's development build), and with the panel closed or another tool shown no commit, no frame requested, no timer started, no DOM mutation and (Chromium) no layout or
        // style recalculation, WHILE THE FEED WENT ON (the fixture counts the lines it made: none was read, each is held by the stream or dropped past its bound of 100,000), and back on the Logs tool the view shows newer lines than it
        // had when it was hidden, with every line the feed made since accounted for, at 1440 x 900 and 1280 x 800. The source of a line (L2): a session that follows two sources has a Source column whose cell on every row names the source
        // the feed gave the line (its label, its hue, the mock's 168 px and chip), one that follows one has none, and a column that appears while a session is open moves no row, scrolls nothing, measures nothing and (Chromium) lays the
        // page out once, following the end and scrolled back. A plugin's unload (A21, on the host fixture's `window.__plugin`): the sessions of an item (one streams, one ended, one failed) stay in the same views with the
        // oldest line each showed (read by its number and text), each stream is closed once (the fixture counts every call to `close`) and the registry lets go of it, and closing the tabs leaves no listener; and, in Chromium,
        // the heap after forced collections (CDP) falls back once the tab of a session that held 100,000 lines is closed. It builds its own fixtures, so it does not read PROBE_DIST.
        { name: 'Probe the Logs tool in a real engine', script: 'ui-next/shell/probes/logs-probe.mjs', env: { REPORT: '$RUNNER_TEMP/logs-probe.json' } },

        // The negative controls of that probe: the feed goes quiet once the view is hidden, which a view that costs nothing because its feed is quiet would pass every zero of; every Source cell says the other source's name; the list is
        // scrolled 48 px when the column appears; every listener ever added to a Set is kept, so the model of a view outlives its closed tab and the heap does not fall back (A21); a stream is closed twice, which the count of closed
        // feeds does not see; a held view shows another line from the one it had (A21). The probe must fail the check each one is for (Chromium at 1440 x 900, its section only), and the step passes only when it did.
        {
          name: 'Probe that the logs probe sees a feed that stopped, a wrong source and a list that moved',
          script: 'ui-next/shell/probes/logs-probe.mjs',
          controls: ['feed-stopped', 'source-label', 'column-moves', 'kept-leak', 'close-twice', 'kept-lines'],
        },
      ],
    },
    {
      id: '5',
      units: [
        // The kit's parts on the real `ui-next` page against the pinned mock reference (packages/kit/probes/mock-reference.json): parity with the mock, tokens, counts, keyboard, accessibility with axe-core.
        { name: 'Probe the parts against the pinned mock reference', script: 'packages/kit/probes/kit-probe.mjs', env: { DIST: '$PROBE_DIST', REPORT: '$RUNNER_TEMP/kit-probe.json' } },

        // The tab strip, the page host and the load, at 1440 x 900 and 1280 x 800 (decision A15). It builds its own fixtures, so it does not read PROBE_DIST.
        { name: 'Probe the tab strip, the page host and the load against the pinned mock reference', script: 'ui-next/shell/probes/strip-probe.mjs', env: { REPORT: '$RUNNER_TEMP/strip-probe.json' } },

        // The negative controls of the strip probe's `arrival` section (Q2a): a tree that does not hold the count slot (`slot-width`) and a skeleton that declares none (`slot-undeclared`) each make a label give way when its
        // count arrives. The probe must see it, and passes only when it does: the label's rectangle is the assertion (the layout-shift observer reads 0 for both, so a probe that only watched it would pass).
        {
          name: 'Probe that the strip probe sees a label that gives way to a count',
          script: 'ui-next/shell/probes/strip-probe.mjs',
          controls: ['slot-width', 'slot-undeclared'],
        },
      ],
    },
  ],

  // Probe scripts that CI never ran, before the split and after it: each is run by hand (docs/ui-next/status/K1.md, 1a.3c.md), and a probe is listed here, with the reason, so that "no shard runs it" is a decision someone
  // wrote down and not something nobody noticed. Moving one into a shard is a change to this table, and adds its seconds to a shard.
  byHand: [
    {
      script: 'packages/kit/probes/kit-probe-bc.mjs',
      reason: 'The sibling of kit-probe.mjs for the Chip, Status, MissingValue, KindTile, QuickFilters, RovingGroup and MiddleEllipsis parts; run by hand, never a workflow step (docs/ui-next/status/K1.md: "Not in CI today").',
    },
    {
      script: 'packages/kit/probes/row-menu-probe.mjs',
      reason: 'The row menu on the 5,000-row example, opened with the mouse and the keyboard; run by hand, never a workflow step: it builds and serves its own page and passes (docs/ui-next/status/1a.3c.md, item 10: "a candidate").',
    },
    {
      script: 'ui-next/page/probes/page-probe.mjs',
      reason: 'The list page chrome against mock-page.json; run by hand, never a workflow step: it still normalizes the font and keeps its own reference, which a CI probe must not (docs/ui-next/status/1a.3c.md, item 9).',
    },
  ],
};

export const BY_HAND = TABLE.byHand;

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
  for (const [script, shards] of scriptShards) {
    if (shards.length > 1) add(`${script} is run by shards ${say(shards)}: a probe and its negative controls run together in one shard`, script);
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
  if (unit.controls === undefined) return [{ label: unit.name, script: unit.script, env }];
  return unit.controls.map((control) => ({ label: `${unit.name} (${control})`, script: unit.script, env: { ...env, NEGATIVE_CONTROL: control } }));
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
        out(`::error title=Kit probe failed (shard ${id})::${escapeData(`${run.label} ${how}`)}\n`);
        const lines = tail.split('\n');
        if (lines.at(-1) === '') lines.pop();
        out(`Last lines of its output:\n${lines.slice(-TAIL_LINES).map((line) => `  ${line}`).join('\n')}\n`);
      }
      resolve({ label: run.label, ok, code, signal: signal ?? null, seconds });
    };
    const child = spawn(node, [path.join(root, run.script)], { cwd: root, env: { ...env, ...run.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', (error) => finish(null, null, `could not start: ${error.message}`));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/** Runs every run of every unit of the shard, one at a time, to the end: the results are `{ label, ok, code, signal, seconds }` in order. A failure does not stop the shard. */
export async function runShard(table, id, { root = REPO_ROOT, env = process.env, out = (text) => process.stdout.write(text), node = process.execPath } = {}) {
  const { units } = planShard(table, id);
  const results = [];
  for (const unit of units) {
    for (const run of expandUnit(unit, env)) results.push(await runOne(run, { id, root, env, out, node }));
  }
  return results;
}

const whole = (value) => Math.round(value);
const outcome = (result) => (result.ok ? 'pass' : `**fail** (${result.signal ? result.signal : `exit ${result.code}`})`);

/** The job summary of a shard (Markdown): the counts, and a row for each run with its seconds. */
export function renderSummary(id, results) {
  const failed = results.filter((result) => !result.ok).length;
  const total = whole(results.reduce((sum, result) => sum + result.seconds, 0));
  const runs = `${results.length} run${results.length === 1 ? '' : 's'}`;
  const head = `### Kit probes shard ${id}: ${runs}, ${failed === 0 ? 'all passed' : `${failed} failed`}, ${total} s`;
  const rows = results.map((result) => `| ${outcome(result)} | ${whole(result.seconds)} | ${result.label.replaceAll('|', '\\|')} |`);
  return [head, '', '| Result | Seconds | Probe |', '|---|--:|---|', ...rows, ''].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const USAGE = 'usage: node scripts/ci/probe-shards.mjs [--root <repository>] check | plan <shard> | run <shard>';

export async function main(argv = process.argv.slice(2), { table = TABLE, env = process.env, out = (text) => process.stdout.write(text), err = (text) => process.stderr.write(text) } = {}) {
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
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  return results.every((result) => result.ok) ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

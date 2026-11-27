// Probes the new UI's Settings, in WebKit and Chromium: the content of the Settings WINDOW (the native window of kind `settings`, 1280 x 800, which is what the app has where there are native windows) against the original application's
// window and the host's window service, and the SAME content as the SHEET in the window (where there are none: a browser, server mode) at 1440 x 900 and 1280 x 800 (decision A15), the page against the design mock's own Settings page.
// The real components run: the product's control, lazy chunk, session, form model and kit parts over the host's six categories and, in the inventory scenarios, an installed plugin with a scoped setting
// (settings-fixture.tsx), in a production build of the repository's own Vite configuration.
//
//   node ui-next/shell/probes/settings-probe.mjs        builds the fixture (OMNIVIEW_UI=next) into a temp dir, serves it, probes it
//
//   FIXTURE_DIST=<dir>   probe an existing build   BUILD_CACHE=<dir>   build once into <dir> and let the next run read it (the shard table's controls do)   FONT_DELAY_MS=40   as a runner serves fonts
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800   (defaults: both of each; the native window uses its preferred and minimum sizes)      AXE=<axe.min.js>
//   SECTIONS=window,page,sheet,keys,a11y,perf   (default: all)      REPORT=<file>   the full report as JSON      SHOTS=<dir>   the screenshots: probe-*.png
//   NEGATIVE_CONTROL=<name>   perturb ONE behaviour of the page (settings-controls.mjs lists them, each with the assertion it is named for), run the part that must see it clean and then perturbed (Chromium at 1440 x 900 unless ENGINES and
//                             VIEWPORTS say otherwise), and exit 0 when the clean run is silent for that assertion, the perturbed run trips it, and no other assertion fails that did not fail clean; 1 NOT DETECTED, 2 it trips another
//                             assertion, 3 the clean run already trips it (the control proves nothing)
//   ASSERTION_OFF=<regex or `says`>   drops the failures whose line matches, as if the assertion that says them were not there; `says` is the control's own: with it the control must print NOT DETECTED (exit 1), the proof that it
//                             trips its own assertion and no other (docs/ui-next/AGENTS.md rule 28)
//
// What it checks (the name starts each line of a failure):
//   window.*   old.match, old.decided, bare, drag, keys, request, sync        the Settings window against the original application's, and what the host's requests make of it
//   page.*     nav, navstates, group, heading, list, rows, scroll, states       the page against the mock's Settings page
//   sheet.*    closed, open, modal, inert, frame, clamp, paint, trap, scrim, draft, escape, close, opener, tip     the sheet over the shell, the kit part's own checks on the real Settings
//   keys.*     nav, reach, operate, select, draft                               the keyboard, searchable tree and field controls in both containers
//   a11y.*     axe                                                             axe-core, contrast included, in both containers, every page, Void and Light, and the nine themes on one page
//   perf.*     open, key, idle, closed                                         the production build's costs: commits, frames, timers, listeners and nodes
// Exit code 1 when anything differs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { AXE, NATIVE_VIEWPORTS, serveFixtures } from './harness.mjs';
import { PERTURBATIONS } from './settings-controls.mjs';
import { buildFixture, state, tabKeys, WINDOW_SIZES } from './settings-lib.mjs';
import { a11ySection } from './settings-a11y.mjs';
import { keysSection } from './settings-keys.mjs';
import { pageSection } from './settings-page.mjs';
import { perfSection } from './settings-perf.mjs';
import { sheetSection } from './settings-sheet.mjs';
import { shotsSection } from './settings-shots.mjs';
import { windowSection } from './settings-window.mjs';

const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);
const SECTION_NAMES = ['window', 'page', 'sheet', 'keys', 'a11y', 'perf', 'shots'];
// The screenshots are taken when a directory is given for them, and are not a section of the run otherwise.
const SECTIONS = CONTROL === '' ? (process.env.SECTIONS ?? SECTION_NAMES.filter((name) => name !== 'shots' || process.env.SHOTS).join(',')).split(',') : [PERTURBATIONS[CONTROL].section];
for (const name of SECTIONS) if (!SECTION_NAMES.includes(name)) throw new Error(`SECTIONS must be some of ${SECTION_NAMES.join(', ')}`);
const engineNames = (process.env.ENGINES ?? (CONTROL === '' ? Object.keys(ENGINES).join(',') : 'chromium')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? (CONTROL === '' ? Object.keys(NATIVE_VIEWPORTS).join(',') : '1440x900')).split(',');
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (process.env.ASSERTION_OFF !== undefined && process.env.ASSERTION_OFF !== 'says') state.off = new RegExp(process.env.ASSERTION_OFF);
if (process.env.ASSERTION_OFF === 'says' && CONTROL === '') throw new Error('ASSERTION_OFF=says needs NEGATIVE_CONTROL');

const SECTION_MODULES = { window: windowSection, page: pageSection, sheet: sheetSection, keys: keysSection, a11y: a11ySection, perf: perfSection, shots: shotsSection };
/** The seconds each section took, summed over the engines and viewports of the run: what the shard table needs. */
const seconds = {};
const timed = async (name, run) => {
  const from = Date.now();
  await run();
  seconds[name] = (seconds[name] ?? 0) + (Date.now() - from) / 1000;
};

/** One run of the sections that are asked for, in every engine and viewport that is asked for, with the perturbation `plant` (or none) laid over the page and the parts `only` (or all). */
async function run({ origin, axe, plant, only }) {
  for (const engineName of engineNames) {
    const browser = await launch(engineName);
    try {
      const keys = await tabKeys(browser);
      // The window is the host's own size, so it is read once for an engine, whatever the viewports are.
      const base = { browser, engine: engineName, origin, axe, keys, plant, only, shots: SHOTS };
      if (SECTIONS.includes('window')) {
        const viewport = WINDOW_SIZES.preferred;
        await timed('window', async () => SECTION_MODULES.window({ ...base, viewportName: `${viewport.width}x${viewport.height}`, viewport }));
      }
      for (const [index, viewportName] of viewportNames.entries()) {
        const env = { ...base, viewportName, viewport: NATIVE_VIEWPORTS[viewportName], first: index === 0 };
        for (const name of SECTIONS) {
          if (name !== 'window' && SECTION_MODULES[name] !== undefined) await timed(name, async () => SECTION_MODULES[name](env));
        }
        console.log(engineName, viewportName, 'done');
      }
    } finally {
      await browser.close();
    }
  }
}

const load = execFileSync('uptime', { encoding: 'utf8' }).trim();
console.log(`uptime: ${load}`);
const started = Date.now();
const fixture = await serveFixtures(buildFixture('production'));
const axe = readFileSync(AXE, 'utf8');
let code = 0;
try {
  if (CONTROL === '') {
    await run({ origin: fixture.origin, axe, plant: undefined, only: undefined });
    const failures = [...new Set(state.sink)];
    const total = Math.round((Date.now() - started) / 1000);
    const bySection = Object.fromEntries(Object.entries(seconds).map(([name, value]) => [name, Math.round(value)]));
    // The numbers of the window against the original application's, which the section `window` judged: each is the same or differs by a decision.
    const old = state.notes.window?.[`old ${engineNames[0]}`];
    if (old !== undefined) console.log(`\nthe Settings window against the original application's (${engineNames[0]}, preferred size):\n${old.map((row) => `  ${row.quantity.padEnd(30)} original ${String(row.old).padStart(7)}   now ${String(row.now).padStart(7)}   ${row.verdict}`).join('\n')}`);
    console.log(`\nseconds by section: ${JSON.stringify(bySection)}`);
    console.log(`\nsettings probe: ${state.checks} checks, ${failures.length} failures (${total} s in all; ${os.loadavg()[0].toFixed(1)} load average at the end)`);
    if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify({ uptime: load, checks: state.checks, failures, secondsBySection: bySection, totalSeconds: total, notes: state.notes }, null, 2)}\n`);
    if (failures.length > 0) {
      console.error(`\n${failures.length} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
      code = 1;
    } else {
      console.log('\nsettings probe: no failures');
    }
  } else {
    const spec = PERTURBATIONS[CONTROL];
    if (process.env.ASSERTION_OFF === 'says') state.off = spec.says;
    const results = {};
    for (const [label, plant] of [['clean', spec.base], ['planted', spec.plant]]) {
      state.sink = [];
      await run({ origin: fixture.origin, axe, plant, only: spec.parts });
      results[label] = [...new Set(state.sink)];
    }

    const trips = (lines) => lines.filter((line) => spec.says.test(line));
    // A failure that the clean run has already (the probe's own findings on the real page, whose numbers move a little with the fault) is not new: it is told by the assertion and the engine and size that say it.
    const kindOf = (line) => line.slice(0, line.indexOf(':'));
    const known = new Set(results.clean.map(kindOf));
    const strays = results.planted.filter((line) => !spec.says.test(line) && !known.has(kindOf(line)));
    console.log(`\ncontrol ${CONTROL} (${spec.fault}):\n  clean${spec.base === undefined ? '' : ' (the page repaired by the control\'s base)'}:   ${results.clean.length} failures, ${trips(results.clean).length} of the control's assertion\n  planted: ${results.planted.length} failures, ${trips(results.planted).length} of the control's assertion, ${strays.length} others that are new`);
    if (trips(results.clean).length > 0) {
      console.log(`INVALID: ${CONTROL}: the clean run already trips ${spec.says.source}, so the control proves nothing: ${trips(results.clean)[0]}`);
      code = 3;
    } else if (strays.length > 0) {
      console.log(`INVALID: ${CONTROL} trips assertions it is not named for: ${strays.slice(0, 3).join(' | ')}`);
      code = 2;
    } else if (trips(results.planted).length === 0) {
      console.log(`NOT DETECTED: ${CONTROL} (${spec.fault})`);
      code = 1;
    } else {
      console.log(`detected: ${CONTROL}: ${trips(results.planted)[0]}`);
    }

    console.log(`its assertion, to remove with ASSERTION_OFF: ${spec.says.source}  (ASSERTION_OFF=says does it)  [${Math.round((Date.now() - started) / 1000)} s]`);
  }
} finally {
  fixture.server.close();
}

process.exit(code);

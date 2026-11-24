// Probes the Plugins page (PL1) in WebKit and Chromium at 1440 x 900 and 1280 x 800 (decision A15), on the fixture (fixture.tsx: the product's own `Shell` and `PluginHost` with the real tab model, palette and plugin store, and
// `createPluginsPage` registered over a fake host; the page is opened the way a person opens it, with the palette's command "Plugins", or by the address `#/host/plugins`). The reference is mock-plugins.json, which
// mock-plugins-measure.mjs recorded from the design mock's own Plugins page with the six neutral plugins of world.mjs written into the mock's world, in the scenes this probe drives: running, failed, disabled, starting, empty,
// uninstall, busy and rowStates.
//
//   env -i PATH="$PATH" HOME="$HOME" FONT_DELAY_MS=40 node ui-next/shell/plugins-page/probes/plugins-probe.mjs      builds the fixture twice (production, and React's development build for the counts of commits), serves it, probes it:
//                                                                                                                  about 3 minutes for both engines at both viewports at a load of 10 to 20 (the last lines say the seconds of each section)
//   node ui-next/shell/probes/plugins-page-perf-probe.mjs                                                          the `perf` section on its own, as a probe of its own: CI runs the two as separate units through the wrappers in ui-next/shell/probes (scripts/ci/probe-units/plugins-page.mjs)
//
//   FIXTURE_DIST=<dir> FIXTURE_DIST_DEV=<dir>   probe existing builds of the fixture      BUILD_CACHE=<dir>   build once into <dir>/plugins-page-fixture/<mode> and read it afterwards (the shard runner gives every process of a shard the same one: one build for a shard, a run for each unit and control)
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800   (defaults: both of each; `perf` runs at the first viewport only)      SECTIONS=geometry,tokens,a11y,keyboard,perf   (default: all; PARTS=mount,event,open,idle narrows `perf`)
//   REPORT=<file>   the full report as JSON      SHOTS=<dir>   a picture of the running, failed, disabled and uninstall scenes (WebKit, void, 1440 x 900: plugins-<scene>-webkit-void-1440x900.png)      READINGS=1   keeps our reading of each scene in the report
//   NEGATIVE_CONTROL=<name>   perturb ONE thing in the page or in the measurement (PERTURBATIONS, below; `CONTROLS=1` lists them) and exit 0 when the assertion the control is named for, and no other, failed (Chromium at 1440 x 900)
//   ASSERTION_OFF=<regex>     drops the failures whose line matches, as if the assertion that says them were not there: it must be the pattern of the active control's own assertion (printed with the control's result), and the control
//                             must then print NOT DETECTED with no other failure: the same fault passes undetected when its assertion is removed (rule 28)
//
// The machine: the one-minute load average is read first (`uptime`) and the run WAITS, re-reading every minute, while it is above 30 (a timing taken under load proves a budget neither held nor missed, rule 27); the uptime
// at the start and at the end of the run is printed and goes to the report.
//
// What each assertion says (the name starts each line of a failure: `<assertion> <engine> <viewport> <scene>: <what>`). Compared with the mock INSIDE each pane: the mock draws no rail on this page and the list in the shell's sidebar
// slot; here the 40 px rail is the window's and both panes are in the island (docs/ui-next/status/PL1.md, "Visual gap"), so a rectangle is taken relative to its pane, never by its x. Where the slice draws less than the mock (no
// search, filter, sort, segmented control, row switch, tabs bar, readme, facts of a marketplace plugin, secondary action of a failed plugin: PL1.md, "What this slice draws") only what is drawn is compared.
//
//   geometry.list     the list pane: 340 wide, as high as the island, 5 px from the detail; the count footer (33 px, at the pane's foot, its text 12 and 9 px in); the 41 px head (the shell sidebar's header, mock-shell.json) and the rows from the scroller's top
//   geometry.row      each of the six rows: 330 wide, 5 px in, 40 high, 40 apart; the tile (24 px, 12 in, 8 down), the glyph in it; the text column 44 in, its two 16 px lines; the name's and the version's width and place; the width of the second line's
//                     text and the 6 px before it after a chip; the state chip (16 px high, its glyph 16 px, its label 20 px in)
//   geometry.header   the detail's identity header, 12 px inside its pane: the 28 px tile and its 16 px glyph, the name (18/24, 2 px down, its width), the chips row (20 px, the version chip 50 x 18, the state chip 8 px after it), the facts and the summary line 56 and 76 px down
//   geometry.slots    the action cluster: 176 + 176 + 28 px, 8 px apart, flush with the header's right edge, leaving the name 440 px less than the header; each button fills its slot (and its glyph and label stand where the mock's do); the More button; the progress
//   geometry.lane     the status lane: 80 px, 12 px under the header and 12 px of margin, quiet or a notice as the mock's state is, the notice's glyph and words 13 and 37 px in
//   geometry.card     the details card: its title and its first row 12 and 56 px in, rows 24 px apart, a 130 px label track and the value 16 px after it
//   geometry.dialog   the Uninstall confirm: 440 wide, centred, the close button, the footer's buttons (their widths, the 12 px between, 13 px from the edge and the foot). The height is the page's own (shorter than the mock's: no tile, no checkbox row, no hint): 382 px there
//   geometry.empty    the empty detail's body in the middle of the pane, filling the content box; the empty list's body at the scroller's top
//   paint.*           the computed type (family, size, weight, line height, colour), fill, edge, radius and outline of each part the mock has too, exactly, in void: paint.list, paint.row (and its states: rest, hover, focus ring, selected, selected under
//                     the pointer), paint.header, paint.lane, paint.buttons, paint.card, paint.dialog
//   tokens            the page writes no colour of its own: every colour a part paints in void (text, glyph, fill, edge, ring; ~100 a scene, six scenes) is the value of a token of the kit's colour table, and in a light theme it is that token's light value
//   a11y              axe-core on the page in the scenes running, failed, disabled, starting, empty and busy, on the open More menu, and on the page and the confirm with the Uninstall confirm open: no violation
//   keyboard.*        real key presses, from the palette's command: .stop Tab reaches the list as ONE stop, the selected row; .order the detail's Reload and More buttons follow it; .free the next Tab leaves the page and Shift+Tab comes back through the same stops;
//                     .arrows ArrowDown, ArrowUp, Home and End move the focus and select nothing; .choose Enter and Space choose a row; .menu Enter on More opens its menu on Disable, Escape closes it and gives the focus back; .progress Enter on
//                     Reload shows the progress with the focus, and when the work ends the focus is on a button of the cluster; .confirm the confirm opens on Cancel, Tab never reaches the page behind it, Escape closes it and the focus is back on
//                     the More button that opened it
//   perf.*            plugins-perf.mjs, with TWO HUNDRED plugins, at the first viewport of the run, EVERY ASSERTION A COUNT (none depends on how fast the machine is: the runner is slower than a laptop, and a time asserted on it failed three pull requests;
//                     production build for the animation frames, development build for the commits): .mount the list mounts in ONE commit (the page's profiler), its rows in ONE batch of DOM changes; .event a state event for one plugin renders ONE row in
//                     ONE commit and changes no node outside that row (and for the plugin on screen its row and the detail only); .open the command to the list: the first commit after it has every row, the list is in the document by the first animation-frame
//                     callback at the median and by the second at the latest, and its rows reach the document in ONE batch (the milliseconds, p50 and p95, are printed and held only against 400 ms, a catastrophe: 13 times a laptop's); .idle no commit, timer,
//                     frame or DOM change in 3 s after the page settled (and in Chromium no layout and no style recalculation)
//
// THE DOCUMENTED DIFFERENCES, each with the number it comes from (everything else is compared at 1 px, or exactly; the 1 px is the repository's for a box compared with a reference that was measured on another platform, as the palette, the shell and the strip
// probes compare theirs: the mock was measured on macOS and the runner draws its text on Linux, and on the machine that measured it every box here reads 0 px off in both engines):
//   the More button: the kit's row-size IconButton is 24 px, the mock's 28: its box is compared with 4 px, the slot (28) with none      the tile's hue: the mock's tone is a name hash over a chart palette (teal rgb(106, 174, 166)); the page's is the
//   accent's brand token (teal rgb(1, 168, 141), as the kit's tile, the shell's tree and the rail), so an accented tile is compared with the token and a neutral one with the mock      the state chip's width: its word is not the mock's ("Starting · Service"),
//   so it is compared where the word is the same (Disabled: 70.59 px)      the second line of a failed plugin's row says the host's sentence, the mock's the summary: its width is not compared there      the quiet lane's line height: the mock's two lines
//   of facts are on 24 px, the page's headline and sentence on 16: size, weight and colour are compared      the count footer: the kit holds the mock's 33 px with 4 px of padding where the mock has 8: its rectangle and its text are compared      the action cluster
//   and the name's room: the mock's WebKit does not lay the cluster out (its note 3), so both engines are held to Chromium's boxes      the dialog's height and scrim: ours is shorter and its scrim clear (no translucent token): recorded, not judged
//
// Exit code 1 when anything differs. The negative controls (rule 28) are in PERTURBATIONS below, with how to run one and the proof that each depends on its assertion. The waits end when their condition holds and are bounded (WAIT, 30 s) only against a page that
// never gets there: no assertion of this probe is the time a wait took.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedBuild } from '../../../../packages/kit/probes/build-cache.mjs';
import { ENGINES, launch, normalizeFont, settle } from '../../../../packages/kit/probes/probe-lib.mjs';
import { AXE, NATIVE_VIEWPORTS, open, serveFixtures, sleep } from '../../probes/harness.mjs';
import { SELECTED, WORLD } from './world.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const reference = JSON.parse(readFileSync(path.join(here, 'mock-plugins.json'), 'utf8'));
const SECTION_NAMES = ['geometry', 'tokens', 'a11y', 'keyboard', 'perf'];
const MAX_LOAD = 30;
/** The longest a wait for a condition may take: a bound against a page that never gets there. Nothing is judged by how long a wait took (a time asserted on the runner is a flake: docs/ui-next/status/N25.md), and a wait ends the moment its condition holds. */
const WAIT = 30_000;

// ---------------------------------------------------------------------------------------------------------------------------
// The machine, then what is asked for.
const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const load1 = (text) => Number(/load averages?:\s*([\d.]+)/.exec(text)?.[1] ?? 0);
const uptimeAtStart = uptime();
// On a machine other agents share, the run waits for it to be quiet (rule 27: a timing taken under load proves a budget neither held nor missed). On the runner (GITHUB_ACTIONS) the load is the machine's own and nothing here is a time (every assertion
// is a count), so nothing waits there: a wait would only hold a shard, up to an hour.
for (let waited = 0; process.env.GITHUB_ACTIONS !== 'true' && load1(uptime()) > MAX_LOAD; waited += 1) {
  if (waited >= 60) throw new Error(`the one-minute load average stayed above ${MAX_LOAD} for an hour: no measurement was taken (${uptime()})`);
  console.log(`load average ${load1(uptime())} is above ${MAX_LOAD}: waiting a minute`);
  await sleep(60_000);
}
console.log(`uptime: ${uptime()}`);

const names = (key, all) => (process.env[key] === undefined || process.env[key] === '' ? all : process.env[key].split(','));
for (const [key, list, known] of [['ENGINES', names('ENGINES', []), Object.keys(ENGINES)], ['VIEWPORTS', names('VIEWPORTS', []), Object.keys(NATIVE_VIEWPORTS)], ['SECTIONS', names('SECTIONS', []), SECTION_NAMES]]) {
  const unknown = list.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`${key} names ${unknown.join(', ')}, which is not one of ${known.join(', ')}`);
}
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
const engineNames = names('ENGINES', CONTROL === '' ? Object.keys(ENGINES) : ['chromium']);
const viewportNames = names('VIEWPORTS', CONTROL === '' ? Object.keys(NATIVE_VIEWPORTS) : ['1440x900']);
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------------------
// The failures, by assertion: `fail` records what must hold (never thrown), `check` counts what was looked at, so that a summary can say how many things each assertion saw.
const failures = [];
const seen = new Map();
const worst = new Map();
const OFF = process.env.ASSERTION_OFF === undefined || process.env.ASSERTION_OFF === '' ? undefined : new RegExp(process.env.ASSERTION_OFF);
const fail = (assertion, where, what) => {
  const line = `${assertion} ${where}: ${what}`;
  if (OFF === undefined || !OFF.test(line)) failures.push(line);
};
const count = (assertion) => seen.set(assertion, (seen.get(assertion) ?? 0) + 1);
const round = (value) => Math.round(value * 100) / 100;

/** Compares two numbers within `tolerance` px (what the tolerance comes from is said where it is wider than 1): a missing one is a failure of its own. */
function near(assertion, where, label, want, got, tolerance = 1) {
  count(assertion);
  if (want === undefined || want === null || Number.isNaN(want)) return;
  if (got === undefined || got === null || Number.isNaN(got)) {
    fail(assertion, where, `${label}: the page does not draw it (the mock's is ${want})`);
    return;
  }

  const delta = round(Math.abs(want - got));
  worst.set(assertion, Math.max(worst.get(assertion) ?? 0, delta));
  if (delta > tolerance) fail(assertion, where, `${label}: mock ${want} ours ${got} (off by ${delta})`);
}

/** Compares the painted properties both sides have (`props`) exactly: the mock's paint object leaves a default out, and so does ours. */
function samePaint(assertion, where, label, mock, ours, props) {
  count(assertion);
  if (mock === null || mock === undefined) return;
  if (ours === null || ours === undefined) {
    fail(assertion, where, `${label}: the page does not draw it`);
    return;
  }

  for (const prop of props) {
    // The mock's explicit read of a state writes `outline: none` where a part draws no ring; a default is a default.
    const [a, b] = [mock[prop] === 'none' ? 'null' : JSON.stringify(mock[prop] ?? null), JSON.stringify(ours[prop] ?? null)];
    if (a !== b) fail(assertion, where, `${label} ${prop}: mock ${a} ours ${b}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Building and serving the fixture: the repository's own Vite configuration, so it is compiled and styled as the channel's build is (the React Compiler, CSS Modules, the cascade layers). `production` is what every time is read from;
// `development` is React's development build, in which a Profiler calls `onRender` (it does not in a production build) and the counts of commits are read.
const BUILD = `
import path from 'node:path';
import { build, loadConfigFromFile, mergeConfig } from 'vite';
const [repo, input, outDir, mode] = process.argv.slice(1);
const loaded = await loadConfigFromFile({ command: 'build', mode }, path.join(repo, 'vite.config.ts'));
if (loaded === null) throw new Error('vite.config.ts not found');
await build(mergeConfig(loaded.config, { configFile: false, logLevel: 'warn', mode, build: { outDir, emptyOutDir: true, ...(mode === 'development' ? { minify: false } : {}), rollupOptions: { input: [input] } } }));
`;

function buildFixture(mode) {
  const existing = mode === 'development' ? process.env.FIXTURE_DIST_DEV : process.env.FIXTURE_DIST;
  if (existing !== undefined && existing !== '') return existing;
  // React's development build is chosen by NODE_ENV, which `vite build` sets to production unless it is set; the `next` flavour is chosen by OMNIVIEW_UI. The build never sees the control the process runs.
  return sharedBuild({ kind: 'plugins-page-fixture', mode, build: (out, env) => execFileSync(process.execPath, ['--input-type=module', '-e', BUILD, repo, path.join(here, 'fixture.html'), out, mode], { cwd: repo, env: { ...env, OMNIVIEW_UI: 'next', NODE_ENV: mode }, stdio: 'pipe' }) });
}

const fixtureUrl = (origin, query = '', hash = '#/host/plugins') => `${origin}/shell/plugins-page/probes/fixture.html${query === '' ? '' : `?${query}`}${hash}`;

// ---------------------------------------------------------------------------------------------------------------------------
// Page side. Every function below is serialized into the page: it is self-contained and reads only its argument.

const BOX = ['background-color', 'border', 'border-radius', 'box-shadow', 'outline'];
const TYPE = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-overflow', 'white-space'];
// The count footer's own box: the kit's `CollectionFooter` holds the mock's 33 px (geometry.list compares its rectangle and where its text stands) with a minimum height and 4 px of padding where the mock has 8, and says `white-space: nowrap` on its box
// where the mock's box does not; its type and its top edge are the mock's and are compared.
const FOOT = [...TYPE.filter((prop) => prop !== 'white-space'), 'border'];

/**
 * Reads every role of `spec`: the rectangle [x, y, w, h] in viewport px (0.01), the extent of the laid-out words (`ink`), the words (`text`) and the paint (the computed style of the properties asked for, a default left out, as the
 * mock's recording leaves it out). A role is `{ key, selector, which?: 'first' | 'all', within?: <the key of another role>, limit?, ink?: true | 'last-text', text?, clip?, paint?: [css properties] }`: `within` reads the selector inside
 * each element of the other role (one entry for each, null where the element has none), `all` reads every match (at most `limit`). A part that is not laid out is null.
 */
function measure(spec) {
  const r2 = (value) => Math.round(value * 100) / 100;
  const box = (b) => [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  const four = (a) => (a[0] === a[1] && a[1] === a[2] && a[2] === a[3] ? a[0] : a[0] === a[2] && a[1] === a[3] ? `${a[0]} ${a[1]}` : a.join(' '));
  const OMIT = { 'background-color': 'rgba(0, 0, 0, 0)', opacity: '1', 'box-shadow': 'none', 'text-overflow': 'clip', 'white-space': 'normal' };
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const inkOf = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const b = range.getBoundingClientRect();
    return b.width === 0 && b.height === 0 ? null : box(b);
  };
  const paintOf = (el, props) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const prop of props) {
      let value;
      if (prop === 'border') {
        const sides = SIDES.map((s) => (['none', 'hidden'].includes(cs.getPropertyValue(`border-${s}-style`)) || cs.getPropertyValue(`border-${s}-width`) === '0px' ? null : `${cs.getPropertyValue(`border-${s}-width`)} ${cs.getPropertyValue(`border-${s}-style`)} ${cs.getPropertyValue(`border-${s}-color`)}`));
        if (sides.every((s) => s === null)) continue;
        value = sides.every((s) => s === sides[0]) ? sides[0] : Object.fromEntries(SIDES.map((s, i) => [s, sides[i]]).filter(([, side]) => side !== null));
      } else if (prop === 'border-radius') {
        value = four(['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => cs.getPropertyValue(`border-${c}-radius`)));
        if (value === '0px') continue;
      } else if (prop === 'padding' || prop === 'margin') {
        value = four(SIDES.map((s) => cs.getPropertyValue(`${prop}-${s}`)));
        if (value === '0px') continue;
      } else if (prop === 'outline') {
        if (cs.getPropertyValue('outline-style') === 'none') continue;
        value = `${cs.getPropertyValue('outline-width')} ${cs.getPropertyValue('outline-style')} ${cs.getPropertyValue('outline-color')}${cs.getPropertyValue('outline-offset') === '0px' ? '' : ` offset ${cs.getPropertyValue('outline-offset')}`}`;
      } else {
        value = cs.getPropertyValue(prop);
        if (OMIT[prop] === value) continue;
        if (prop === 'font-family') value = value.replace(/"/g, '');
      }
      out[prop] = value;
    }
    return out;
  };

  const elements = {};
  const singles = new Set();
  const out = {};
  for (const role of spec) {
    let list;
    let single;
    if (role.within !== undefined) {
      list = elements[role.within].map((el) => (el === null ? null : el.querySelector(role.selector)));
      single = singles.has(role.within);
    } else if (role.which === 'all') {
      list = [...document.querySelectorAll(role.selector)].slice(0, role.limit ?? 12);
      single = false;
    } else {
      list = [document.querySelector(role.selector)];
      single = true;
    }
    elements[role.key] = list;
    if (single) singles.add(role.key);
    const entries = list.map((el) => {
      if (el === null || el.getClientRects().length === 0) return null;
      const entry = { rect: box(el.getBoundingClientRect()) };
      if (role.ink === true) entry.ink = inkOf(el);
      if (role.ink === 'last-text') entry.ink = el.lastChild !== null && el.lastChild.nodeType === 3 ? inkOf(el.lastChild) : null;
      if (role.text === true) entry.text = el.textContent.replace(/\s+/g, ' ').trim();
      if (role.attrs !== undefined) entry.attrs = Object.fromEntries(role.attrs.map((name) => [name, el.getAttribute(name)]));
      if (role.clip === true) {
        entry.scrollWidth = el.scrollWidth;
        entry.clientWidth = el.clientWidth;
      }
      if (role.paint !== undefined) entry.paint = paintOf(el, role.paint);
      return entry;
    });
    out[role.key] = single ? entries[0] : entries;
  }
  return out;
}

/**
 * What the page's tile paints for each accent a plugin's contribution names, from the kit's own tokens (page side): the glyph is the hue (`--ov-brand-<accent>`; a tile with no accent is `--ov-fg-muted`, the mock's neutral tile) and the fill is 24% of
 * the glyph's colour over the island (`--ov-bg-island`), the mock's rule for its avatar. The colour is read as the engine writes a computed colour, from a scratch element.
 */
function tileColours(accents) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;visibility:hidden;color:rgb(1, 2, 3)';
  const probe = document.createElement('span');
  wrap.append(probe);
  document.body.append(wrap);
  const out = {};
  for (const accent of ['', ...accents]) {
    const hue = accent === '' ? 'var(--ov-fg-muted)' : `var(--ov-brand-${accent})`;
    probe.style.color = hue;
    probe.style.backgroundColor = `color-mix(in srgb, ${hue} 24%, var(--ov-bg-island))`;
    const cs = getComputedStyle(probe);
    out[accent] = { glyph: cs.color, fill: cs.backgroundColor };
  }

  wrap.remove();
  return out;
}

/** The roles of our page (the `data-pl-part` values are its DOM contract). The names are the mock's where the part is the mock's. */
const ROLES = [
  { key: 'list', selector: '[data-pl-part="list"]', paint: BOX },
  { key: 'listHead', selector: '[data-pl-part="list-head"]' },
  { key: 'listScroll', selector: '[data-pl-part="list-scroll"]', paint: ['padding'] },
  { key: 'listFoot', selector: '[data-pl-part="list-foot"]', paint: [...TYPE, 'border', 'padding'] },
  { key: 'footCount', selector: '[data-pl-part="list-foot"] [role="status"] > span', ink: true, text: true, paint: TYPE },
  { key: 'rows', selector: '[data-pl-part="row"]', which: 'all', limit: 6, text: true, paint: ['background-color', 'border-radius', 'outline', 'cursor'] },
  { key: 'rowTile', selector: '[data-pl-part="row-tile"]', within: 'rows', attrs: ['data-accent'], paint: BOX },
  { key: 'rowGlyph', selector: 'svg', within: 'rowTile', paint: ['color'] },
  { key: 'rowLine1', selector: '[data-ov-clip]:has(> [data-pl-part="row-name"])', within: 'rows', paint: TYPE },
  { key: 'rowName', selector: '[data-pl-part="row-name"]', within: 'rows', text: true, paint: TYPE },
  { key: 'rowVersion', selector: '[data-pl-part="row-version"]', within: 'rows', text: true, paint: TYPE },
  { key: 'rowLine2', selector: '[data-pl-part="row-line2"]', within: 'rows' },
  { key: 'rowClip', selector: '[data-pl-part="row-line2"] > [data-ov-clip]', within: 'rows', ink: true, text: true, clip: true, paint: TYPE },
  { key: 'rowChip', selector: '[data-pl-part="state-chip"]', within: 'rows', ink: 'last-text', text: true, paint: TYPE },
  { key: 'rowChipIcon', selector: 'svg', within: 'rowChip', paint: ['color'] },
  { key: 'detail', selector: '[data-pl-part="detail"]', paint: [...BOX, 'padding'] },
  { key: 'head', selector: '[data-pl-part="head"]' },
  { key: 'headTile', selector: '[data-pl-part="head-tile"]' },
  { key: 'headKind', selector: '[data-pl-part="head-tile"] > *', attrs: ['data-accent'], paint: BOX },
  { key: 'headGlyph', selector: '[data-pl-part="head-tile"] svg', paint: ['color'] },
  { key: 'title', selector: '[data-pl-part="head-title"]', ink: true, text: true, paint: TYPE },
  { key: 'actions', selector: '[data-pl-part="head-actions"]' },
  { key: 'slotPrimary', selector: '[data-pl-part="slot-primary"]' },
  { key: 'slotSecondary', selector: '[data-pl-part="slot-secondary"]' },
  { key: 'slotMore', selector: '[data-pl-part="slot-more"]' },
  { key: 'primaryButton', selector: '[data-pl-part="slot-primary"] > button', ink: true, text: true, paint: [...TYPE, ...BOX, 'padding'] },
  { key: 'primaryIcon', selector: '[data-pl-part="slot-primary"] > button svg', paint: ['color'] },
  { key: 'secondaryButton', selector: '[data-pl-part="slot-secondary"] > button', ink: true, text: true, paint: [...TYPE, ...BOX, 'padding'] },
  { key: 'secondaryIcon', selector: '[data-pl-part="slot-secondary"] > button svg', paint: ['color'] },
  { key: 'more', selector: '[data-pl-part="head-more"]', paint: BOX },
  { key: 'moreIcon', selector: '[data-pl-part="head-more"] svg', paint: ['color'] },
  { key: 'prog', selector: '[data-pl-part="head-progress"]', paint: ['border-radius'] },
  { key: 'progLabel', selector: '[data-pl-part="head-progress"] > span', ink: true, text: true, paint: TYPE },
  { key: 'progBar', selector: '[data-pl-part="head-progress"] > [role="progressbar"]', paint: BOX },
  { key: 'progFill', selector: '[data-pl-part="head-progress"] > [role="progressbar"] > [data-ov-part="fill"]', paint: BOX },
  { key: 'meta', selector: '[data-pl-part="head-meta"]' },
  { key: 'chipVersion', selector: '[data-pl-part="head-version"]', ink: true, text: true, paint: [...TYPE, ...BOX, 'padding'] },
  { key: 'chipOrigin', selector: '[data-pl-part="head-origin"]' },
  { key: 'chipState', selector: '[data-pl-part="head-chip"]', ink: 'last-text', text: true, paint: TYPE },
  { key: 'chipStateIcon', selector: '[data-pl-part="head-chip"] svg', paint: ['color'] },
  { key: 'facts', selector: '[data-pl-part="facts"]', ink: true, text: true, paint: TYPE },
  { key: 'summary', selector: '[data-pl-part="summary"]', ink: true, text: true, paint: TYPE },
  { key: 'lane', selector: '[data-pl-part="lane"]', text: true, paint: [...BOX, 'padding', 'margin'] },
  { key: 'laneIcon', selector: '[data-pl-part="lane"] > svg', paint: ['color'] },
  { key: 'laneText', selector: '[data-pl-part="lane"] > p', ink: true, text: true, paint: TYPE },
  { key: 'laneTitle', selector: '[data-pl-part="lane"] strong', ink: true, text: true, paint: TYPE },
  { key: 'card', selector: '[data-pl-part="card"]', paint: [...BOX, 'padding'] },
  { key: 'cardTitle', selector: '[data-pl-part="card"] h3', ink: true, text: true, paint: TYPE },
  { key: 'cardTerms', selector: '[data-pl-part="card-row"] > dt', which: 'all', text: true, paint: TYPE },
  { key: 'cardValues', selector: '[data-pl-part="card-row"] > dd', which: 'all', text: true, paint: TYPE },
  { key: 'listEmpty', selector: '[data-pl-part="list-empty"]' },
  { key: 'listEmptyBody', selector: '[data-pl-part="list-empty"] > *' },
  { key: 'detailEmpty', selector: '[data-pl-part="detail-empty"]' },
  { key: 'detailEmptyBody', selector: '[data-pl-part="detail-empty"] > *' },
  { key: 'confirm', selector: '[data-pl-part="confirm"]', paint: ['background-color'] },
  { key: 'dialog', selector: '[data-pl-part="confirm"] > div', paint: [...BOX] },
  { key: 'dlgTitle', selector: '[data-pl-part="confirm-title"]', ink: true, text: true, paint: TYPE },
  { key: 'dlgVersion', selector: '[data-pl-part="confirm-version"]', ink: true, text: true, paint: TYPE },
  { key: 'dlgClose', selector: '[data-pl-part="confirm-close"]', paint: BOX },
  { key: 'dlgBody', selector: '[data-pl-part="confirm-body"]', paint: TYPE },
  { key: 'dlgSections', selector: '[data-pl-part="confirm-section"]', which: 'all', text: true },
  { key: 'dlgSectionTitles', selector: '[data-pl-part="confirm-section"] > h3', which: 'all', text: true, paint: TYPE },
  { key: 'dlgCancel', selector: '[data-pl-part="confirm-cancel"]', ink: true, text: true, paint: [...TYPE, ...BOX, 'padding'] },
  { key: 'dlgConfirm', selector: '[data-pl-part="confirm-confirm"]', ink: true, text: true, paint: [...TYPE, ...BOX, 'padding'] },
];

// ---------------------------------------------------------------------------------------------------------------------------
// The scenes, driven the way a person drives them (a click on a row, the More menu, the Reload button). The mock's reference was recorded in a fresh page for each, and so is each scene here.
const ROW = (id) => `[data-pl-part="row"][data-pl-id="${id}"]`;
const settleFrames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
/** Waits for a condition in the page and says whether it came in time: false when it did not, and the check that follows says what is wrong, where a timeout's stack would not. A wait ends the moment its condition holds; its bound is only against a page that never gets there. */
const until = (page, condition, arg, timeout = 5000) => page.waitForFunction(condition, arg, { timeout }).then(() => true, () => false);

/** The window has drawn the six plugins in the states of world.mjs (the crash of `gamma` reaches the window after its interface loaded), or the empty list. */
const drawn = (page, empty) =>
  empty
    ? page.waitForSelector('[data-pl-part="list-empty"]', { timeout: WAIT })
    : page.waitForFunction(() => {
      const state = (id) => document.querySelector(`[data-pl-part="row"][data-pl-id="${id}"]`)?.getAttribute('data-pl-state');
      return state('alpha') === 'running' && state('gamma') === 'failed' && state('delta') === 'disabled' && state('epsilon') === 'starting' && document.querySelector('[data-pl-part="list-foot"]') !== null;
    }, null, { timeout: WAIT });

async function openUninstall(page) {
  await page.locator('[data-pl-part="head-more"]').click();
  await page.getByRole('menuitem', { name: /^Uninstall/ }).click();
  await page.waitForSelector('[data-pl-part="confirm"][open]');
}

const SCENES = {
  running: async () => undefined,
  failed: async (page) => page.locator(ROW('gamma')).click(),
  disabled: async (page) => page.locator(ROW('delta')).click(),
  starting: async (page) => page.locator(ROW('epsilon')).click(),
  empty: async () => undefined,
  uninstall: async (page) => openUninstall(page),
  busy: async (page) => {
    // The host keeps the reload until the probe lets it go, so the page is in its work in progress for as long as it is looked at.
    await page.evaluate(() => window.__world.hold('reload'));
    await page.locator('[data-pl-part="slot-secondary"] > button').click();
    await page.waitForSelector('[data-pl-part="head-progress"]');
  },
  rowStates: async () => undefined,
};

/** A fresh page on the fixture in a scene: the font normalised as the mock's reference was, the scene driven, the pointer put away, the animations at their first frame (the mock's were paused there before it read). */
async function scenePage(browser, origin, viewport, scene) {
  const opened = await open(browser, fixtureUrl(origin, scene === 'empty' ? 'count=0' : ''), viewport, { waitFor: '[data-pl-page]' });
  await drawn(opened.page, scene === 'empty');
  await normalizeFont(opened.page, { rootVar: '--ov-font-ui' });
  await SCENES[scene](opened.page);
  await opened.page.mouse.move(1, 1);
  await opened.page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
  });
  await settleFrames(opened.page);
  await sleep(150);
  return opened;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The comparison with the mock. A rectangle is [x, y, w, h]; a part is compared INSIDE its pane (`rel`).
const rel = (rect, origin) => (rect === null || rect === undefined || origin === null || origin === undefined ? null : [round(rect[0] - origin[0]), round(rect[1] - origin[1]), rect[2], rect[3]]);
const at = (list, index) => (Array.isArray(list) ? (list[index] ?? null) : null);
const rectOf = (entry) => (entry === null || entry === undefined ? null : entry.rect);
const paintAt = (mock, role, index) => {
  const id = mock.paint[role];
  const one = Array.isArray(id) ? (id[index] ?? null) : id;
  return one === null || one === undefined ? null : reference.paints[one];
};

/** Compares the first `keys` (0 x, 1 y, 2 w, 3 h) of two rectangles each taken inside its own origin; a part the mock does not draw is not compared, one the page does not draw is a failure. */
function insides(assertion, where, label, mockRect, mockOrigin, ours, oursOrigin, keys = [0, 1, 2, 3], tolerance = 1) {
  const want = rel(mockRect, mockOrigin);
  if (want === null) return;
  const got = rel(ours, oursOrigin);
  for (const key of keys) near(assertion, where, `${label} ${'xywh'[key]}`, want[key], got === null ? null : got[key], tolerance);
}

/** What the page says: the scene's premise, so that a scene that does not draw what it is named for is no pass. */
function premise(where, scene, O) {
  const expect = (ok, what) => {
    count('premise');
    if (!ok) fail('premise', where, what);
  };
  const title = O.title?.text ?? '';
  switch (scene) {
    case 'running':
      expect(O.rows.length === WORLD.length && title === 'Alpha Metrics' && O.lane?.text.includes('is running') && O.secondaryButton !== null, `the running plugin's page is not drawn: ${JSON.stringify({ rows: O.rows.length, title, lane: O.lane?.text })}`);
      break;
    case 'failed':
      expect(title === 'Gamma Deploy' && O.primaryButton?.text === 'Retry' && O.lane !== null && O.laneIcon !== null, `the failed plugin's page is not drawn: ${JSON.stringify({ title, primary: O.primaryButton?.text, lane: O.lane?.text })}`);
      break;
    case 'disabled':
      expect(title === 'Delta Vault' && O.primaryButton?.text === 'Enable', `the disabled plugin's page is not drawn: ${JSON.stringify({ title, primary: O.primaryButton?.text })}`);
      break;
    case 'starting':
      expect(title === 'Epsilon Mesh' && O.prog !== null, `the starting plugin's page is not drawn: ${JSON.stringify({ title, progress: O.prog !== null })}`);
      break;
    case 'empty':
      expect(O.rows.length === 0 && O.listEmpty !== null && O.detailEmpty !== null, 'the empty list and the empty detail are not drawn');
      break;
    case 'uninstall':
      expect(O.dialog !== null && O.dlgTitle?.text === 'Uninstall Alpha Metrics?', `the Uninstall confirm is not open: ${JSON.stringify(O.dlgTitle?.text)}`);
      break;
    case 'busy':
      expect(O.prog !== null && O.progLabel?.text === 'Reloading…', `the reload is not in progress: ${JSON.stringify(O.progLabel?.text)}`);
      break;
    default:
      break;
  }
}

/** geometry.list: the list pane as a whole. */
function geometryList(where, M, O) {
  const A = 'geometry.list';
  const m = M.rects;
  const list = rectOf(O.list);
  const detail = rectOf(O.detail);
  const both = list !== null && detail !== null;
  near(A, where, 'pane width', m.sidebar[2], list?.[2]);
  near(A, where, 'pane top', m.sidebar[1], list?.[1]);
  near(A, where, 'pane height', m.sidebar[3], list?.[3]);
  near(A, where, 'pane and detail stand level (top)', m.sidebar[1] - m.island[1], both ? list[1] - detail[1] : null);
  near(A, where, 'pane and detail are as high as each other', m.sidebar[3] - m.island[3], both ? list[3] - detail[3] : null);
  near(A, where, 'gutter between the list and the detail', m.island[0] - (m.sidebar[0] + m.sidebar[2]), both ? detail[0] - (list[0] + list[2]) : null);
  insides(A, where, 'count footer', m.foot, m.sidebar, rectOf(O.listFoot), list);
  if (M.text.footCount !== null && M.text.footCount !== undefined) {
    insides(A, where, 'count text', m.footCount, m.foot, rectOf(O.footCount), rectOf(O.listFoot), [0, 1]);
    near(A, where, 'count text width', M.text.footCount.ink?.[2] ?? m.footCount[2], O.footCount?.ink?.[2]);
  }

  // The list's head is the shell sidebar's header (41 px, mock-shell.json `sidebarHeader`): the mock's Plugins page has a search column there instead, which this slice does not draw (PL1.md). What both sides share is where the rows begin:
  // at the top of the scroller, and the scroller ends where the foot begins.
  if (O.listHead !== null) near(A, where, 'head height (the shell sidebar header, mock-shell.json)', 41, O.listHead.rect[3]);
  if (O.rows.length > 0 && O.rows[0] !== null && O.listScroll !== null) {
    near(A, where, 'first row at the top of the scroller', m.rows[0][1] - m.scroll[1], O.rows[0].rect[1] - O.listScroll.rect[1]);
    near(A, where, 'scroller ends where the foot begins', m.foot[1] - (m.scroll[1] + m.scroll[3]), O.listFoot.rect[1] - (O.listScroll.rect[1] + O.listScroll.rect[3]));
  }
}

/** geometry.row: each of the six rows, its tile, its two lines and the chip. */
function geometryRows(where, M, O) {
  const A = 'geometry.row';
  const m = M.rects;
  const scroll = rectOf(O.listScroll);
  for (let i = 0; i < Math.min(WORLD.length, O.rows.length); i += 1) {
    const row = O.rows[i];
    if (row === null) continue;
    const name = row.text.split(' ')[0];
    const label = (what) => `row ${i + 1} (${name}) ${what}`;
    const mockRow = at(m.rows, i);
    insides(A, where, label('inside the scroller'), mockRow, m.scroll, row.rect, scroll, [0, 2, 3]);
    near(A, where, label('y from the scroller top'), mockRow[1] - m.scroll[1], row.rect[1] - scroll[1]);
    insides(A, where, label('tile'), at(m.rowTile, i), mockRow, rectOf(O.rowTile?.[i]), row.rect);
    insides(A, where, label('glyph in the tile'), at(m.rowGlyph, i), at(m.rowTile, i), rectOf(O.rowGlyph?.[i]), rectOf(O.rowTile?.[i]));
    insides(A, where, label('first line'), at(m.rowLine1, i), mockRow, rectOf(O.rowLine1?.[i]), row.rect, [0, 1, 3]);
    insides(A, where, label('second line'), at(m.rowLine2, i), mockRow, rectOf(O.rowLine2?.[i]), row.rect, [0, 1, 3]);
    insides(A, where, label('name'), at(m.rowName, i), mockRow, rectOf(O.rowName?.[i]), row.rect, [0, 2, 3]);
    // The name's vertical place inside its line is the engine's (WebKit 0.5 px lower than Chromium in the mock), so only its x, width and height are compared.
    insides(A, where, label('version, from the name'), at(m.rowVersion, i), at(m.rowName, i), rectOf(O.rowVersion?.[i]), rectOf(O.rowName?.[i]), [0, 2]);
    const chip = at(m.rowChip, i);
    const ourChip = O.rowChip?.[i] ?? null;
    if (chip !== null) {
      insides(A, where, label('state chip'), chip, mockRow, rectOf(ourChip), row.rect, [0, 1, 3]);
      insides(A, where, label('state chip glyph'), at(m.rowChipIcon, i), chip, rectOf(O.rowChipIcon?.[i]), rectOf(ourChip));
      near(A, where, label('state chip: the label starts after the glyph'), at(m.rowChipLabel, i)[0] - chip[0], ourChip?.ink === null || ourChip?.ink === undefined ? null : ourChip.ink[0] - ourChip.rect[0]);
      // The chip's width follows its word: the mock's words are not ours (its chips say "Starting · Service"), so the width is compared only where the word is the same (Disabled).
      if (ourChip?.text === 'Disabled') near(A, where, label('state chip width (the same word)'), chip[2], ourChip.rect[2]);
    } else if (ourChip !== null) {
      fail(A, where, label('draws a state chip where the mock draws none'));
    }

    // The second line's text. The mock clips one run (the chip, 6 px, the summary); this page's chip stands before the clipped summary, which starts 6 px after it (the mock's chip margin). The chip's width follows its word, which is not the
    // mock's, so the summary is compared by its own width (the mock's run less its chip and the 6 px). A failed plugin's row says the host's sentence in place of the summary (docs/ui-next/status/PL1.md: the reason is read without opening the
    // detail), so it is not compared there.
    const mockText = at(M.text.rowClip2, i);
    const clip = O.rowClip?.[i] ?? null;
    if (mockText?.ink !== undefined && clip?.ink !== undefined && clip.ink !== null && !row.text.includes('stopped unexpectedly')) {
      const gap = chip === null ? 0 : Number.parseFloat(mockOf(M, 'rowChip', i).margin.split(' ')[1]);
      near(A, where, label('second line: the summary\'s width'), round(mockText.ink[2] - (chip === null ? 0 : chip[2] + gap)), clip.ink[2]);
      if (ourChip !== null && chip !== null) near(A, where, label('second line: the summary starts after the chip by the mock\'s chip margin'), gap, clip.ink[0] - (ourChip.rect[0] + ourChip.rect[2]));
    }
  }
}

/** geometry.header and geometry.slots: the identity header and the three action slots. */
function geometryHeader(where, M, C, O) {
  if (M.rects.head === null || M.rects.head === undefined) return;
  const H = 'geometry.header';
  const S = 'geometry.slots';
  const m = M.rects;
  const c = C.rects;
  const detail = rectOf(O.detail);
  const head = rectOf(O.head);
  insides(H, where, 'header in the pane', m.head, m.pane, head, detail, [0, 1, 3]);
  near(H, where, 'header right inset in the pane', m.pane[0] + m.pane[2] - (m.head[0] + m.head[2]), detail === null || head === null ? null : detail[0] + detail[2] - (head[0] + head[2]));
  insides(H, where, 'tile box', m.art, m.head, rectOf(O.headTile), head);
  insides(H, where, 'tile painted', m.artTile, m.head, rectOf(O.headKind), head);
  insides(H, where, 'tile glyph', m.artGlyph, m.artTile, rectOf(O.headGlyph), rectOf(O.headKind));
  insides(H, where, 'name', m.title, m.head, rectOf(O.title), head, [0, 1, 3]);
  near(H, where, 'name width (the words are the same)', M.text.title?.ink?.[2], O.title?.ink?.[2]);
  // The room the cluster leaves the name is the design's, and the mock's WebKit does not lay the cluster out (its note 3: the slots run out of it): both engines are held to Chromium's boxes.
  near(H, where, 'name leaves the cluster its room (header width less the name)', c.head[2] - c.title[2], head === null || O.title === null ? null : head[2] - O.title.rect[2]);
  insides(H, where, 'chips row', m.meta, m.head, rectOf(O.meta), head, [0, 1, 3]);
  near(H, where, 'chips row width (header less the tile column)', m.head[2] - m.meta[2], head === null || O.meta === null ? null : head[2] - O.meta.rect[2]);
  insides(H, where, 'version chip', m.chipVersion, m.meta, rectOf(O.chipVersion), rectOf(O.meta));
  // The state chip follows the chip before it by 8 px (the mock's trust chip; here the version chip, or the origin chip a built-in or a linked plugin has): its own place along the row is not the mock's.
  const before = O.chipOrigin ?? O.chipVersion;
  if (m.chipState !== null && m.chipState !== undefined) {
    near(H, where, 'state chip: gap after the chip before it', m.chipState[0] - (m.chipTrust[0] + m.chipTrust[2]), O.chipState === null || before === null ? null : O.chipState.rect[0] - (before.rect[0] + before.rect[2]));
    insides(H, where, 'state chip y and height', m.chipState, m.meta, rectOf(O.chipState), rectOf(O.meta), [1, 3]);
    insides(H, where, 'state chip glyph', m.chipStateIcon, m.chipState, rectOf(O.chipStateIcon), rectOf(O.chipState));
    near(H, where, 'state chip: the label starts after the glyph', m.chipStateLabel[0] - m.chipState[0], O.chipState?.ink === null || O.chipState?.ink === undefined ? null : O.chipState.ink[0] - O.chipState.rect[0]);
    if (O.chipState !== null && O.chipState.text.length === M.text.chipStateLabel?.len) near(H, where, 'state chip width (the word has the same length)', m.chipState[2], O.chipState.rect[2]);
  }

  insides(H, where, 'facts line', m.facts, m.head, rectOf(O.facts), head, [0, 1, 3]);
  insides(H, where, 'summary', m.summary, m.head, rectOf(O.summary), head, [0, 1, 3]);

  // The action cluster: three slots that never change size, whatever the state shows inside them.
  const actions = rectOf(O.actions);
  near(S, where, 'cluster flush with the header\'s right edge', c.head[0] + c.head[2] - (c.actions[0] + c.actions[2]), head === null || actions === null ? null : head[0] + head[2] - (actions[0] + actions[2]));
  near(S, where, 'cluster width (176 + 8 + 176 + 8 + 28)', c.actions[2], actions?.[2]);
  insides(S, where, 'cluster top and height', c.actions, c.head, actions, head, [1, 3]);
  insides(S, where, 'primary slot', c.slotPrimary, c.actions, rectOf(O.slotPrimary), actions);
  insides(S, where, 'secondary slot', c.slotSecondary, c.actions, rectOf(O.slotSecondary), actions);
  insides(S, where, 'more slot', c.more, c.actions, rectOf(O.slotMore), actions);
  // A button fills its slot (the mock's buttons are the slot's width); the ink of its words (glyph and label) stands where the mock's does where the label has the same length.
  for (const [slot, button, key] of [['slotPrimary', 'primaryButton', 'primary'], ['slotSecondary', 'secondaryButton', 'secondary']]) {
    if (c[button] === null || c[button] === undefined || O[button] === null) continue;
    insides(S, where, `${key} button fills its slot`, c[button], c[slot], rectOf(O[button]), rectOf(O[slot]));
    // The ink of the words is taken from Chromium's boxes too: the mock's WebKit buttons are the slots' 176 px but sit past the cluster's own box (its note 3), so their ink is far from where the design puts it.
    const wanted = C.text[button];
    if (wanted?.ink !== undefined && O[button]?.ink !== undefined && O[button].ink !== null && O[button].text.length === wanted.len) {
      near(S, where, `${key} button: the glyph and the label start`, wanted.ink[0] - c[button][0], O[button].ink[0] - O[button].rect[0]);
      near(S, where, `${key} button: the glyph and the label end`, wanted.ink[0] + wanted.ink[2] - c[button][0], O[button].ink[0] + O[button].ink[2] - O[button].rect[0]);
    }
  }

  // The More button. The mock's is 28 px; the kit uses its 24 px row target, centred in the 28 px slot. Its box is compared with a 4 px tolerance (the difference of the two sizes) and the
  // slot, which holds the place, with none.
  insides(S, where, 'more button, centred in its slot (24 px of the 28; tolerance 4 px: the difference of the sizes)', c.more, c.more, rectOf(O.more), rectOf(O.slotMore), [0, 1, 2, 3], 4);

  // The progress that takes the primary slot while work is under way.
  if (c.prog !== null && c.prog !== undefined) {
    insides(S, where, 'progress in the primary slot', c.prog, c.slotPrimary, rectOf(O.prog), rectOf(O.slotPrimary));
    insides(S, where, 'progress label', c.progLabel, c.prog, rectOf(O.progLabel), rectOf(O.prog));
    insides(S, where, 'progress track', c.progBar, c.prog, rectOf(O.progBar), rectOf(O.prog));
    insides(S, where, 'progress fill (paused at its first frame: one fill left of the track)', c.progFill, c.progBar, rectOf(O.progFill), rectOf(O.progBar));
    if (c.secondaryButton === null || c.secondaryButton === undefined) near(S, where, 'no button in the secondary slot while work is under way', 0, O.secondaryButton === null ? 0 : 1);
  }
}

/** geometry.lane: the status lane. */
function geometryLane(where, M, O) {
  const A = 'geometry.lane';
  const m = M.rects;
  if (m.lane === null || m.lane === undefined) return;
  const lane = rectOf(O.lane);
  const detail = rectOf(O.detail);
  insides(A, where, 'lane in the pane', m.lane, m.pane, lane, detail, [0, 1, 3]);
  near(A, where, 'lane right inset in the pane', m.pane[0] + m.pane[2] - (m.lane[0] + m.lane[2]), lane === null || detail === null ? null : detail[0] + detail[2] - (lane[0] + lane[2]));
  near(A, where, 'lane under the header (the 12 px of margin)', m.lane[1] - (m.head[1] + m.head[3]), lane === null || O.head === null ? null : lane[1] - (O.head.rect[1] + O.head.rect[3]));
  // A notice has a glyph and its words 13 and 37 px in; the quiet lane has its words 12 in (no edge, no glyph). Which of the two the state gets is the mock's rule too.
  const mockNotice = m.notice !== null && m.notice !== undefined;
  const ourNotice = O.laneIcon !== null;
  count(A);
  if (mockNotice !== ourNotice) fail(A, where, `the mock draws ${mockNotice ? 'a notice (glyph, edge, tone fill)' : 'the quiet lane (no glyph, no edge)'}, ours draws ${ourNotice ? 'a notice' : 'the quiet lane'}`);
  else if (mockNotice) {
    insides(A, where, 'notice glyph', m.noticeIcon, m.lane, rectOf(O.laneIcon), lane);
    insides(A, where, 'notice words', m.noticeBody, m.lane, rectOf(O.laneText), lane, [0, 1]);
  } else {
    insides(A, where, 'quiet lane words', at(m.laneLines, 0), m.lane, rectOf(O.laneText), lane, [0, 1]);
  }
}

/** geometry.card: the details card, inside itself (it stands at the pane's start under the lane here; the mock's is the overview's second column, under a tabs bar this slice does not draw). */
function geometryCard(where, M, O) {
  const A = 'geometry.card';
  const m = M.rects;
  if (m.card === null || m.card === undefined) return;
  const card = rectOf(O.card);
  insides(A, where, 'card title', m.cardTitle, m.card, rectOf(O.cardTitle), card, [0, 1, 3]);
  insides(A, where, 'first label', at(m.cardTerms, 0), m.card, rectOf(O.cardTerms?.[0]), card);
  insides(A, where, 'first value, from its label', at(m.cardValues, 0), at(m.cardTerms, 0), rectOf(O.cardValues?.[0]), rectOf(O.cardTerms?.[0]), [0, 1, 3]);
  insides(A, where, 'second label, from the first (the 8 px between rows)', at(m.cardTerms, 1), at(m.cardTerms, 0), rectOf(O.cardTerms?.[1]), rectOf(O.cardTerms?.[0]), [0, 1, 3]);
  // The value's column fills what the label leaves in the card's 12 px inside: the card's width less 24 and less the 146 px of the label track and the gap (mock 300 px: 130; here the card is wider).
  near(A, where, 'value column fills the card (card width less 24 less 146)', m.card[2] - 24 - 146 - at(m.cardValues, 0)[2], card === null || O.cardValues?.[0] === null ? null : card[2] - 24 - 146 - O.cardValues[0].rect[2]);
}

/** geometry.dialog: the Uninstall confirm. */
function geometryDialog(where, M, O, viewport) {
  const A = 'geometry.dialog';
  const m = M.rects;
  if (m.dialog === null || m.dialog === undefined) return;
  const dialog = rectOf(O.dialog);
  near(A, where, 'width', m.dialog[2], dialog?.[2]);
  // Centred in the window, as the mock's: the middle of the box is the middle of the viewport.
  near(A, where, 'centred across', m.dialog[0] + m.dialog[2] / 2 - viewport.width / 2, dialog === null ? null : dialog[0] + dialog[2] / 2 - viewport.width / 2);
  near(A, where, 'centred down', m.dialog[1] + m.dialog[3] / 2 - viewport.height / 2, dialog === null ? null : dialog[1] + dialog[3] / 2 - viewport.height / 2);
  // The close button is 13 px from the box's right edge (1 px edge, 12 px inside).
  near(A, where, 'close button from the right edge', m.dialog[0] + m.dialog[2] - (m.dlgClose[0] + m.dlgClose[2]), dialog === null || O.dlgClose === null ? null : dialog[0] + dialog[2] - (O.dlgClose.rect[0] + O.dlgClose.rect[2]));
  near(A, where, 'close button size', m.dlgClose[2], O.dlgClose?.rect[2]);
  // The footer: the buttons are right-aligned, 12 px apart, 13 px from the right edge (1 px edge, 12 px inside) and 13 px from the foot of the box; the mock's are the same words (Cancel, Uninstall), so their widths are compared.
  const [cancel, confirm] = [O.dlgCancel, O.dlgConfirm];
  if (cancel !== null && confirm !== null && dialog !== null) {
    near(A, where, 'confirm button from the right edge', m.dialog[0] + m.dialog[2] - (m.dlgButtons[1][0] + m.dlgButtons[1][2]), dialog[0] + dialog[2] - (confirm.rect[0] + confirm.rect[2]));
    near(A, where, 'confirm button from the foot', m.dialog[1] + m.dialog[3] - (m.dlgButtons[1][1] + m.dlgButtons[1][3]), dialog[1] + dialog[3] - (confirm.rect[1] + confirm.rect[3]));
    near(A, where, 'buttons 12 px apart', m.dlgButtons[1][0] - (m.dlgButtons[0][0] + m.dlgButtons[0][2]), confirm.rect[0] - (cancel.rect[0] + cancel.rect[2]));
    near(A, where, 'cancel width', m.dlgButtons[0][2], cancel.rect[2]);
    near(A, where, 'confirm width', m.dlgButtons[1][2], confirm.rect[2]);
    near(A, where, 'button height', m.dlgButtons[0][3], cancel.rect[3]);
  }
}

/** geometry.empty: the empty list and the empty detail, which the kit's empty body draws. */
function geometryEmpty(where, M, O) {
  const A = 'geometry.empty';
  const m = M.rects;
  if (m.emptyDetailBox === null || m.emptyDetailBox === undefined) return;
  const detail = rectOf(O.detail);
  const body = rectOf(O.detailEmptyBody);
  const area = rectOf(O.detailEmpty);
  // Centred in the pane: the middle of the box is the middle of the pane's content (the mock's: 0 and 0).
  near(A, where, 'empty detail centred across', m.emptyDetailBox[0] + m.emptyDetailBox[2] / 2 - (m.emptyDetail[0] + m.emptyDetail[2] / 2), body === null || area === null ? null : body[0] + body[2] / 2 - (area[0] + area[2] / 2));
  near(A, where, 'empty detail centred down', m.emptyDetailBox[1] + m.emptyDetailBox[3] / 2 - (m.emptyDetail[1] + m.emptyDetail[3] / 2), body === null || area === null ? null : body[1] + body[3] / 2 - (area[1] + area[3] / 2));
  near(A, where, 'empty detail fills the pane\'s content box (the pane less its 12 px)', m.pane[2] - 24 - m.emptyDetail[2], detail === null || area === null ? null : detail[2] - 24 - area[2]);
  // The empty list: the body starts at the scroller's top, 5 px in (the mock's `empty2` is the list's own first child).
  insides(A, where, 'empty list body from the scroller', m.listEmpty, m.scroll, rectOf(O.listEmptyBody), rectOf(O.listScroll), [0, 1]);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The paint: the computed style of each part the mock has too, exactly, in void. A property the mock's recording leaves out is a default, and ours must leave it out too. What is structure (the mock's list item and its button are this
// page's one button; padding, margin and gap sit in different boxes) is compared as geometry above and not here.
const mockOf = (M, role, index) => paintAt(M, role, index);

// THE TILE'S HUE, a documented difference. The mock's avatar takes its tone from a hash of the plugin's name over a chart palette, which a host cannot reproduce: its teal is rgb(106, 174, 166) (`--ov-chart-teal`), the fill 24% of it over
// the island. The page's tile takes the accent a plugin's contribution names and maps it to the kit's brand hue (`--ov-brand-<accent>`, rgb(1, 168, 141) for teal), as the kit's `KindTile`, the shell's tree and the rail do, so the rail and the list
// show one plugin in one colour. A tile with no accent is the mock's neutral tile (`--ov-fg-muted`) and is compared with the mock's own numbers; a tile with an accent is compared with the token's, through the same 24% rule.
const toned = (mock, tones, accent, key) => (mock === null || accent === null || accent === undefined || accent === '' ? mock : { ...mock, [key]: tones[accent][key === 'color' ? 'glyph' : 'fill'] });
const tonesOf = (page, O) => page.evaluate(tileColours, [...new Set([...O.rowTile.map((tile) => tile?.attrs?.['data-accent']), O.headKind?.attrs?.['data-accent']].filter((accent) => accent !== null && accent !== undefined && accent !== ''))]);

function paintList(where, M, O) {
  const A = 'paint.list';
  samePaint(A, where, 'list pane', mockOf(M, 'sidebar'), O.list?.paint, BOX);
  samePaint(A, where, 'detail pane', mockOf(M, 'island'), O.detail?.paint, BOX);
  samePaint(A, where, 'detail pane inside', mockOf(M, 'pane'), O.detail?.paint, ['padding']);
  samePaint(A, where, 'count footer', mockOf(M, 'foot'), O.listFoot?.paint, FOOT);
  samePaint(A, where, 'count text', mockOf(M, 'footCount'), O.footCount?.paint, TYPE);
}

function paintRows(where, M, O, tones) {
  const A = 'paint.row';
  for (let i = 0; i < Math.min(WORLD.length, O.rows.length); i += 1) {
    const row = O.rows[i];
    if (row === null) continue;
    const label = (what) => `row ${i + 1} (${row.text.split(' ')[0]}) ${what}`;
    samePaint(A, where, label('row'), mockOf(M, 'rows', i), row.paint, ['background-color', 'border-radius']);
    samePaint(A, where, label('tile'), toned(mockOf(M, 'rowTile', i), tones, O.rowTile?.[i]?.attrs?.['data-accent'], 'background-color'), O.rowTile?.[i]?.paint, BOX);
    samePaint(A, where, label('glyph'), toned(mockOf(M, 'rowGlyph', i), tones, O.rowTile?.[i]?.attrs?.['data-accent'], 'color'), O.rowGlyph?.[i]?.paint, ['color']);
    samePaint(A, where, label('first line'), mockOf(M, 'rowLine1', i), O.rowLine1?.[i]?.paint, TYPE);
    samePaint(A, where, label('name'), mockOf(M, 'rowName', i), O.rowName?.[i]?.paint, TYPE);
    samePaint(A, where, label('version'), mockOf(M, 'rowVersion', i), O.rowVersion?.[i]?.paint, TYPE);
    samePaint(A, where, label('second line text'), mockOf(M, 'rowLine2', i), O.rowClip?.[i]?.paint, TYPE);
    samePaint(A, where, label('state chip label'), mockOf(M, 'rowChipLabel', i), O.rowChip?.[i]?.paint, TYPE);
    samePaint(A, where, label('state chip glyph'), mockOf(M, 'rowChipIcon', i), O.rowChipIcon?.[i]?.paint, ['color']);
  }
}

function paintHeader(where, M, O, tones) {
  if (M.rects.head === null || M.rects.head === undefined) return;
  const A = 'paint.header';
  samePaint(A, where, 'tile', toned(mockOf(M, 'artTile'), tones, O.headKind?.attrs?.['data-accent'], 'background-color'), O.headKind?.paint, BOX);
  samePaint(A, where, 'tile glyph', toned(mockOf(M, 'artGlyph'), tones, O.headKind?.attrs?.['data-accent'], 'color'), O.headGlyph?.paint, ['color']);
  samePaint(A, where, 'name', mockOf(M, 'title'), O.title?.paint, TYPE);
  samePaint(A, where, 'version chip', mockOf(M, 'chipVersion'), O.chipVersion?.paint, [...TYPE, ...BOX, 'padding']);
  if (M.rects.chipState !== null) {
    samePaint(A, where, 'state chip label', mockOf(M, 'chipStateLabel'), O.chipState?.paint, TYPE);
    samePaint(A, where, 'state chip glyph', mockOf(M, 'chipStateIcon'), O.chipStateIcon?.paint, ['color']);
  }

  samePaint(A, where, 'facts line', mockOf(M, 'facts'), O.facts?.paint, TYPE);
  samePaint(A, where, 'summary', mockOf(M, 'summary'), O.summary?.paint, TYPE);
}

function paintButtons(where, M, C, O) {
  if (M.rects.head === null || M.rects.head === undefined) return;
  const A = 'paint.buttons';
  if (M.rects.primaryButton !== null && M.rects.primaryButton !== undefined && O.primaryButton !== null) {
    samePaint(A, where, 'primary button', mockOf(M, 'primaryButton'), O.primaryButton?.paint, [...TYPE, ...BOX, 'padding']);
    samePaint(A, where, 'primary button glyph', mockOf(M, 'primaryIcon'), O.primaryIcon?.paint, ['color']);
  }

  if (M.rects.secondaryButton !== null && M.rects.secondaryButton !== undefined && M.rects.prog === null && O.secondaryButton !== null) {
    samePaint(A, where, 'secondary button', mockOf(M, 'secondaryButton'), O.secondaryButton?.paint, [...TYPE, ...BOX, 'padding']);
    samePaint(A, where, 'secondary button glyph', mockOf(M, 'secondaryIcon'), O.secondaryIcon?.paint, ['color']);
  }

  samePaint(A, where, 'more button', mockOf(M, 'more'), O.more?.paint, ['border', 'border-radius', 'background-color']);
  samePaint(A, where, 'more button glyph', mockOf(M, 'moreIcon'), O.moreIcon?.paint, ['color']);
  if (M.rects.prog !== null && M.rects.prog !== undefined) {
    samePaint(A, where, 'progress label', mockOf(M, 'progLabel'), O.progLabel?.paint, TYPE);
    samePaint(A, where, 'progress track', mockOf(M, 'progBar'), O.progBar?.paint, BOX);
    samePaint(A, where, 'progress fill', mockOf(M, 'progFill'), O.progFill?.paint, BOX);
  }
}

function paintLane(where, M, O) {
  if (M.rects.lane === null || M.rects.lane === undefined) return;
  const A = 'paint.lane';
  const notice = M.rects.notice !== null && M.rects.notice !== undefined;
  // The mock's lane is the box (margin, and the fill and radius of the quiet lane); a notice inside it paints the tone's fill and edge and holds the 12 px inside.
  const box = { ...mockOf(M, 'lane'), ...(notice ? mockOf(M, 'notice') : {}) };
  samePaint(A, where, 'lane box', box, O.lane?.paint, ['background-color', 'border', 'border-radius', 'padding', 'margin']);
  if (notice) {
    samePaint(A, where, 'notice glyph', mockOf(M, 'noticeIcon'), O.laneIcon?.paint, ['color']);
    samePaint(A, where, 'notice headline', mockOf(M, 'noticeTitle'), O.laneTitle?.paint, TYPE);
    samePaint(A, where, 'notice words', mockOf(M, 'noticeMessage'), O.laneText?.paint, TYPE);
  } else {
    // The mock's quiet lane is two lines of facts at 12 px on a 24 px line, a different text from this page's (a headline and a sentence on 16 px lines): the size, weight and colour of the words are compared, the line height is not.
    samePaint(A, where, 'quiet lane words', mockOf(M, 'laneLines', 0), O.laneText?.paint, TYPE.filter((prop) => prop !== 'line-height'));
  }
}

function paintCard(where, M, O) {
  if (M.rects.card === null || M.rects.card === undefined) return;
  const A = 'paint.card';
  samePaint(A, where, 'card', mockOf(M, 'card'), O.card?.paint, [...BOX, 'padding']);
  samePaint(A, where, 'card title', mockOf(M, 'cardTitle'), O.cardTitle?.paint, TYPE);
  samePaint(A, where, 'first label', mockOf(M, 'cardTerms', 0), O.cardTerms?.[0]?.paint, TYPE);
  samePaint(A, where, 'first value', mockOf(M, 'cardValues', 0), O.cardValues?.[0]?.paint, TYPE);
}

function paintDialog(where, M, O) {
  if (M.rects.dialog === null || M.rects.dialog === undefined) return;
  const A = 'paint.dialog';
  samePaint(A, where, 'box', mockOf(M, 'dialog'), O.dialog?.paint, BOX);
  samePaint(A, where, 'title', mockOf(M, 'dlgTitle'), O.dlgTitle?.paint, TYPE);
  samePaint(A, where, 'version', mockOf(M, 'dlgMeta'), O.dlgVersion?.paint, TYPE);
  samePaint(A, where, 'close button', mockOf(M, 'dlgClose'), O.dlgClose?.paint, ['border', 'border-radius', 'background-color']);
  samePaint(A, where, 'body words', mockOf(M, 'dlgParagraphs', 0), O.dlgBody?.paint, TYPE);
  samePaint(A, where, 'section heading', mockOf(M, 'dlgSectionTitles', 0), O.dlgSectionTitles?.[0]?.paint, TYPE);
  // The mock focuses its first button when it opens, which draws the ring: the outline is the state's, not the button's.
  samePaint(A, where, 'cancel button', mockOf(M, 'dlgButtons', 0), O.dlgCancel?.paint, [...TYPE, 'border', 'border-radius', 'background-color', 'padding']);
  samePaint(A, where, 'confirm button', mockOf(M, 'dlgButtons', 1), O.dlgConfirm?.paint, [...TYPE, 'border', 'border-radius', 'background-color', 'padding']);
}

function paintEmpty(where, M, O) {
  if (M.rects.emptyDetailBox === null || M.rects.emptyDetailBox === undefined) return;
  const A = 'paint.list';
  samePaint(A, where, 'list pane', mockOf(M, 'sidebar'), O.list?.paint, BOX);
  samePaint(A, where, 'detail pane', mockOf(M, 'island'), O.detail?.paint, BOX);
  samePaint(A, where, 'count footer', mockOf(M, 'foot'), O.listFoot?.paint, FOOT);
}

// The states of a row, driven as the mock's were: a row at rest, under the pointer, with the keyboard's focus (Tab into the list, one arrow to the row), the selected row at rest and under the pointer.
const TAB = (engine) => (engine === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');

/** Puts the keyboard's focus on the row of the list that holds the stop, by Tab from the top of the page (WebKit on macOS skips buttons with Tab, and reaches them with Alt+Tab: the window's own setting, which the native app turns on, N22). */
async function tabToList(page, engine) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press(TAB(engine));
    if (await page.evaluate(() => document.activeElement?.matches('[data-pl-part="row"]') === true)) return true;
  }
  return false;
}

async function rowStates(browser, engine, viewportName, viewport, origin) {
  const A = 'paint.row';
  const M = reference.data[engine][viewportName].rowStates;
  const opened = await scenePage(browser, origin, viewport, 'rowStates');
  const { page } = opened;
  const where = `${engine} ${viewportName} rowStates`;
  const READ = [...ROLES.filter((role) => ['rows', 'rowTile', 'rowName', 'rowVersion', 'rowClip'].includes(role.key))];
  const read = () => page.evaluate(measure, READ);
  const matches = (index) => page.evaluate((i) => {
    const row = document.querySelectorAll('[data-pl-part="row"]')[i];
    return { hover: row.matches(':hover'), focus: document.activeElement === row, focusVisible: row.matches(':focus-visible'), current: row.getAttribute('aria-current') };
  }, index);
  const centre = async (index) => {
    const box = await page.locator('[data-pl-part="row"]').nth(index).boundingBox();
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
  const states = [
    ['rest', 1, async () => undefined, { hover: false, focus: false, current: null }],
    ['hover', 1, async () => page.mouse.move(...(await centre(1)), { steps: 2 }), { hover: true, focus: false, current: null }],
    [
      'focus',
      1,
      async () => {
        await page.mouse.move(1, 1);
        count(A);
        if (!(await tabToList(page, engine))) fail(A, where, 'Tab never reached a row of the list');
        await page.keyboard.press('ArrowDown');
      },
      { hover: false, focus: true, focusVisible: true, current: null },
    ],
    ['current', 0, async () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()).then(async () => page.mouse.move(1, 1)), { hover: false, focus: false, current: 'true' }],
    ['currentHover', 0, async () => page.mouse.move(...(await centre(0)), { steps: 2 }), { hover: true, focus: false, current: 'true' }],
  ];
  for (const [state, index, drive, want] of states) {
    await drive();
    await sleep(150);
    const got = await matches(index);
    count(A);
    for (const [key, value] of Object.entries(want)) if (got[key] !== value) fail(A, where, `${state}: the row is not really in this state (${key} is ${JSON.stringify(got[key])}, wanted ${JSON.stringify(value)})`);
    const O = await read();
    const tones = await tonesOf(page, O);
    const row = O.rows[index];
    const target = reference.data[engine][viewportName].rowStates.states[state].paint;
    const paint = (part) => reference.paints[target[part]];
    // The mock's list item paints the fill and its button the focus ring; this page's row is one button that paints both.
    samePaint(A, where, `${state}: fill`, paint('row'), row?.paint, ['background-color', 'border-radius']);
    samePaint(A, where, `${state}: focus ring`, paint('main'), row?.paint, ['outline']);
    samePaint(A, where, `${state}: pointer`, { cursor: paint('main').cursor }, row?.paint, ['cursor']);
    samePaint(A, where, `${state}: tile`, toned(paint('avatar'), tones, O.rowTile?.[index]?.attrs?.['data-accent'], 'background-color'), O.rowTile?.[index]?.paint, ['background-color', 'border-radius']);
    samePaint(A, where, `${state}: name`, paint('name'), O.rowName?.[index]?.paint, TYPE);
    samePaint(A, where, `${state}: version`, paint('version'), O.rowVersion?.[index]?.paint, TYPE);
    samePaint(A, where, `${state}: second line`, paint('line2'), O.rowClip?.[index]?.paint, TYPE);
  }

  for (const error of opened.errors) fail('page.error', where, error);
  await opened.context.close();
  void M;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The negative controls are made right before a scene is read, in the page. See PERTURBATIONS (further down).
const report = { geometry: {}, tokens: {}, a11y: {}, keyboard: {}, perf: {}, notes: [], seconds: {} };

async function geometrySection(browser, engine, viewportName, viewport, origin, perturb) {
  const scenes = ['running', 'failed', 'disabled', 'starting', 'empty', 'uninstall', 'busy', 'rowStates'].filter((scene) => perturb?.scenes === undefined || perturb.scenes.includes(scene));
  for (const scene of scenes) {
    if (scene === 'rowStates') {
      await rowStates(browser, engine, viewportName, viewport, origin);
      continue;
    }

    const where = `${engine} ${viewportName} ${scene}`;
    const opened = await scenePage(browser, origin, viewport, scene);
    if (perturb?.css !== undefined) {
      await opened.page.addStyleTag({ content: perturb.css });
      await settleFrames(opened.page);
    }

    const O = await opened.page.evaluate(measure, ROLES);
    const tones = await tonesOf(opened.page, O);
    if (process.env.READINGS === '1') report.geometry[where] = O;
    const M = reference.data[engine][viewportName][scene];
    const C = reference.data.chromium[viewportName][scene];
    premise(where, scene, O);
    if (scene === 'empty') {
      geometryList(where, M, O);
      geometryEmpty(where, M, O);
      paintEmpty(where, M, O);
    } else {
      geometryList(where, M, O);
      geometryRows(where, M, O);
      geometryHeader(where, M, C, O);
      geometryLane(where, M, O);
      geometryCard(where, M, O);
      geometryDialog(where, M, O, viewport);
      paintList(where, M, O);
      paintRows(where, M, O, tones);
      paintHeader(where, M, O, tones);
      paintButtons(where, M, C, O);
      paintLane(where, M, O);
      paintCard(where, M, O);
      paintDialog(where, M, O);
    }

    for (const error of opened.errors) fail('page.error', where, error);
    // The pictures the status file shows beside the mock's (mock-<scene>-webkit-1440x900.png): WebKit, void, 1440 x 900, as the scene is measured.
    if (SHOTS && engine === 'webkit' && viewportName === '1440x900' && ['running', 'failed', 'disabled', 'uninstall'].includes(scene)) await opened.page.screenshot({ path: path.join(SHOTS, `plugins-${scene}-${engine}-void-${viewportName}.png`) });
    await opened.context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// tokens: the page writes no colour of its own. In void every colour a part of the page paints (its text and glyphs, its fills, its edges, its rings, every element under the page and under the confirm) is the value of some token of the kit's
// colour table; in a light theme it must paint what that token is THERE. The kit's colour roles (78) come from its generated table. A part whose void colour is the value of two tokens (the island and the dialog are one grey in void) may paint
// either of them in the light theme. The one composite is the tile's fill (24% of its hue over the island), compared with the same rule read from the tokens in each theme (`tileColours`). The theme is flipped with the root attribute, as the kit's
// own probes do: nothing re-renders, so a colour that follows the theme follows it by the cascade alone.
const COLOUR_TOKENS = [...readFileSync(path.join(repo, 'packages/kit/src/generated/tokenNames.ts'), 'utf8').match(/export const COLOR_ROLES = \[([^\]]*)\]/)[1].matchAll(/'([a-z0-9-]+)'/g)].map((role) => `--ov-${role[1]}`);
if (COLOUR_TOKENS.length < 70) throw new Error(`the kit's colour roles could not be read from packages/kit/src/generated/tokenNames.ts (${String(COLOUR_TOKENS.length)} found)`);

/** Page side: the value of each token as a computed colour in the theme the page is in now; a name that is not a colour reads back as the scratch element's own `rgb(1, 2, 3)` and is left out. */
function resolveTokens(tokenNames) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;visibility:hidden;color:rgb(1, 2, 3)';
  const probe = document.createElement('span');
  wrap.append(probe);
  document.body.append(wrap);
  const out = {};
  for (const name of tokenNames) {
    probe.style.color = `var(${name})`;
    const value = getComputedStyle(probe).color;
    if (value !== 'rgb(1, 2, 3)') out[name] = value;
  }

  wrap.remove();
  return out;
}

/** Page side: every colour a laid-out element of the page (and of the confirm) paints: its text colour where it has text or is a glyph, its fill, each edge that is drawn, its ring. */
function colours() {
  const out = [];
  const name = (el) => {
    const part = el.getAttribute('data-pl-part');
    if (part !== null) return part;
    const own = typeof el.className === 'string' ? el.className.split(' ')[0].replace(/^_?([A-Za-z]+)_[A-Za-z0-9]+_\d+$/, '$1') : '';
    return `${el.tagName.toLowerCase()}${own === '' ? '' : `.${own}`}`;
  };
  for (const el of document.querySelectorAll('[data-pl-page], [data-pl-page] *, [data-pl-part="confirm"] *')) {
    if (el.getClientRects().length === 0) continue;
    const cs = getComputedStyle(el);
    const tile = el.matches('[data-pl-part="row-tile"], [data-pl-part="head-tile"] > *');
    // A transparent edge (the ghost buttons' 1 px) paints nothing and is no colour.
    const add = (prop, value) => {
      if (value !== 'rgba(0, 0, 0, 0)') out.push({ part: name(el), prop, value, tile, accent: el.getAttribute('data-accent') ?? '' });
    };
    const text = el instanceof SVGElement || [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== '');
    if (text) add('color', cs.color);
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') add('background-color', cs.backgroundColor);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      if (cs.getPropertyValue(`border-${side}-style`) !== 'none' && cs.getPropertyValue(`border-${side}-width`) !== '0px') add(`border-${side}-color`, cs.getPropertyValue(`border-${side}-color`));
    }

    if (cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px') add('outline-color', cs.outlineColor);
  }

  return out;
}

async function tokensSection(browser, engine, viewportName, viewport, origin, perturb) {
  const A = 'tokens';
  const scenes = ['running', 'failed', 'disabled', 'starting', 'busy', 'uninstall'].filter((scene) => perturb?.scenes === undefined || perturb.scenes.includes(scene));
  for (const scene of scenes) {
    const where = `${engine} ${viewportName} ${scene}`;
    const opened = await scenePage(browser, origin, viewport, scene);
    const { page } = opened;
    const inVoid = await page.evaluate(colours);
    const tokensVoid = await page.evaluate(resolveTokens, COLOUR_TOKENS);
    const accents = [...new Set(inVoid.filter((paint) => paint.tile && paint.accent !== '').map((paint) => paint.accent))];
    const tonesVoid = await page.evaluate(tileColours, accents);
    await page.evaluate(() => document.documentElement.setAttribute('data-ov-theme', 'light'));
    await settleFrames(page);
    // A control pins a colour of the page after the theme was flipped, as a part that paints a colour of its own does.
    if (perturb?.cssLight !== undefined) await page.addStyleTag({ content: perturb.cssLight });
    await settleFrames(page);
    const inLight = await page.evaluate(colours);
    const tokensLight = await page.evaluate(resolveTokens, COLOUR_TOKENS);
    const tonesLight = await page.evaluate(tileColours, accents);
    count(A);
    if (Object.keys(tokensVoid).length < 70) fail(A, where, `only ${String(Object.keys(tokensVoid).length)} of the kit's ${String(COLOUR_TOKENS.length)} colour tokens resolve to a colour: the page's theme is not what it should be`);
    if (inVoid.length !== inLight.length || inVoid.some((paint, index) => paint.part !== inLight[index].part || paint.prop !== inLight[index].prop)) {
      fail(A, where, 'the page changed shape when the theme changed: the colours of the two themes are not of the same parts');
      await opened.context.close();
      continue;
    }

    let changed = 0;
    inVoid.forEach((paint, index) => {
      const now = inLight[index].value;
      count(A);
      if (paint.tile && paint.prop === 'background-color') {
        // The tile's fill: the mock's rule over the tokens, in each theme.
        const [wantVoid, wantLight] = [tonesVoid[paint.accent].fill, tonesLight[paint.accent].fill];
        if (paint.value !== wantVoid || now !== wantLight) fail(A, where, `${paint.part} ${paint.prop}: the tile's fill is ${paint.value} in void (the rule over the tokens gives ${wantVoid}) and ${now} in the light theme (wanted ${wantLight})`);
        if (wantVoid !== wantLight) changed += 1;
        return;
      }

      const same = COLOUR_TOKENS.filter((token) => tokensVoid[token] === paint.value);
      if (same.length === 0) {
        fail(A, where, `${paint.part} ${paint.prop}: paints ${paint.value} in void, which is the value of no token of the kit: a colour of its own`);
      } else if (!same.some((token) => tokensLight[token] === now)) {
        fail(A, where, `${paint.part} ${paint.prop}: ${paint.value} in void is ${same.join(' or ')}; in the light theme it paints ${now}, not ${[...new Set(same.map((token) => tokensLight[token]))].join(' or ')}`);
      } else if (same.every((token) => tokensLight[token] !== paint.value)) {
        changed += 1;
      }
    });
    count(A);
    if (changed < 10) fail(A, where, `only ${String(changed)} of the ${String(inVoid.length)} colours the page paints changed with the theme: the flip did not reach the page`);
    report.tokens[where] = { colours: inVoid.length, changed };
    for (const error of opened.errors) fail('page.error', where, error);
    await opened.context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// a11y: axe-core on the page in each scene, and on the Uninstall confirm and on the More menu (the closed window has findings of the shell's own, which are its probes': the page is what is read here).
async function axeOf(page, axe, within) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: axe });
  return page.evaluate(async (selector) => {
    const root = document.querySelector(selector);
    if (root === null) return null;
    const result = await window.axe.run(root, { resultTypes: ['violations'] });
    return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length, first: violation.nodes[0]?.html.slice(0, 140) }));
  }, within);
}

async function a11ySection(browser, engine, viewportName, viewport, origin, axe, perturb) {
  const A = 'a11y';
  const found = {};
  const scenes = ['running', 'failed', 'disabled', 'starting', 'empty', 'busy', 'uninstall', 'menu'].filter((scene) => perturb?.scenes === undefined || perturb.scenes.includes(scene));
  for (const scene of scenes) {
    const where = `${engine} ${viewportName} ${scene}`;
    const opened = scene === 'menu' ? await scenePage(browser, origin, viewport, 'running') : await scenePage(browser, origin, viewport, scene);
    const { page } = opened;
    if (scene === 'menu') {
      await page.locator('[data-pl-part="head-more"]').click();
      await page.waitForSelector('[role="menu"]');
      await settle(page);
    }

    if (perturb?.page !== undefined) await page.evaluate(perturb.page);
    for (const within of scene === 'uninstall' ? ['[data-pl-page]', '[data-pl-part="confirm"]'] : scene === 'menu' ? ['[role="menu"]'] : ['[data-pl-page]']) {
      const violations = await axeOf(page, axe, within);
      count(A);
      if (violations === null) {
        fail(A, where, `${within} is not on the page: nothing was read`);
        continue;
      }

      found[`${where} ${within}`] = violations;
      for (const violation of violations) fail(A, where, `${violation.id} (${violation.impact}, ${String(violation.nodes)}) in ${within}: ${violation.first}`);
    }

    for (const error of opened.errors) fail('page.error', where, error);
    await opened.context.close();
  }

  report.a11y[`${engine} ${viewportName}`] = found;
}

// ---------------------------------------------------------------------------------------------------------------------------
// keyboard, with real key presses, from the palette's command to the confirm. The page is opened the way a person opens it; Tab starts at the tab on screen and goes on through the window.
async function keyboardSection(browser, engine, viewportName, viewport, origin, perturb) {
  const where = `${engine} ${viewportName}`;
  const next = TAB(engine);
  const back = next === 'Alt+Tab' ? 'Alt+Shift+Tab' : 'Shift+Tab';
  const opened = await open(browser, fixtureUrl(origin, '', ''), viewport, { waitFor: '[data-shell-part="window"]' });
  const { page } = opened;
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return el === null ? null : { tag: el.tagName, part: el.getAttribute('data-pl-part'), id: el.getAttribute('data-pl-id'), role: el.getAttribute('role'), text: (el.textContent ?? '').trim().slice(0, 30), inPage: el.closest('[data-pl-page]') !== null, inList: el.closest('[data-pl-part="list"]') !== null, inDialog: el.closest('dialog') !== null, current: el.getAttribute('aria-current') };
    });
  const selected = () => page.evaluate(() => document.querySelector('[data-pl-part="row"][aria-current="true"]')?.getAttribute('data-pl-id') ?? null);
  const title = () => page.evaluate(() => document.querySelector('[data-pl-part="head-title"]')?.textContent ?? null);
  const check = (assertion, ok, what) => {
    count(assertion);
    if (!ok) fail(assertion, where, what);
  };

  // The command: the chord, the word, Enter.
  const chord = (await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+k' : 'Control+k';
  await page.keyboard.press(chord);
  await page.waitForSelector('dialog[open]');
  await page.keyboard.type('Plugins', { delay: 15 });
  await page.waitForFunction(() => [...document.querySelectorAll('dialog [role=option]')].some((row) => (row.getAttribute('aria-label') ?? '').startsWith('Command: Plugins')));
  await page.keyboard.press('Enter');
  await drawn(page, false);
  await sleep(300);
  if (perturb?.page !== undefined) await page.evaluate(perturb.page);

  // Tab from the tab on screen, through the window: the list is ONE stop (the selected row), the detail's buttons and the More button follow it in order, and the next stop is outside the page.
  await page.evaluate(() => document.querySelector('[data-shell-part="tab"] [role="tab"]').focus());
  const stops = [];
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press(next);
    stops.push(await focused());
  }

  const inPage = stops.filter((stop) => stop?.inPage);
  // The list is ONE stop: of everything Tab reached in the list pane, one element, and it is the selected row.
  const stopsInList = inPage.filter((stop) => stop.inList);
  check('keyboard.stop', stopsInList.length === 1 && stopsInList[0].part === 'row' && stopsInList[0].current === 'true', `Tab reached ${String(stopsInList.length)} stops in the list (${stopsInList.map((stop) => stop.id ?? stop.text).join(', ')}), wanted ONE: the selected row`);
  const rowAt = stops.findIndex((stop) => stop?.part === 'row');
  const controls = inPage.filter((stop) => !stop.inList).map((stop) => stop.part ?? stop.text);
  check('keyboard.order', JSON.stringify(controls) === JSON.stringify(['Reload', 'head-more']) && rowAt >= 0 && rowAt < stops.findIndex((stop) => stop?.inPage && stop.part !== 'row'), `the page's stops after the list are ${JSON.stringify(controls)}, wanted Reload then the More button, after the list`);
  const last = stops.reduce((at, stop, index) => (stop?.inPage ? index : at), -1);
  check('keyboard.free', last >= 0 && last < stops.length - 1 && stops[last + 1]?.inPage === false, 'the next Tab after the last stop of the page did not leave the page: the page holds the focus');
  // And back: Shift+Tab from the More button goes to Reload and then to the selected row, and leaves.
  await page.locator('[data-pl-part="head-more"]').focus();
  const reverse = [];
  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press(back);
    reverse.push(await focused());
  }

  // Shift+Tab from the More button: Reload first, then the list (whatever stops it has: how many is keyboard.stop's), and out of the page right after it.
  const lastInList = reverse.reduce((at, stop, index) => (stop?.inList ? index : at), -1);
  check('keyboard.free', reverse[0]?.text === 'Reload' && reverse.some((stop) => stop?.part === 'row' && stop.current === 'true') && lastInList >= 0 && reverse[lastInList + 1]?.inPage === false, `Shift+Tab from the More button went ${JSON.stringify(reverse.map((stop) => stop?.part ?? stop?.text))}, wanted Reload, the list, and out of the page`);

  // The arrows move the focus and select nothing; Home and End go to the ends.
  await page.locator('[data-pl-part="row"][aria-current="true"]').focus();
  for (const [key, want] of [['ArrowDown', 'beta'], ['ArrowDown', 'delta'], ['ArrowUp', 'beta'], ['End', 'zeta'], ['Home', 'alpha']]) {
    await page.keyboard.press(key);
    await until(page, (id) => document.activeElement?.getAttribute('data-pl-id') === id, want);
    await settleFrames(page);
    const [at, chosen] = [await focused(), await selected()];
    check('keyboard.arrows', at?.id === want && chosen === 'alpha', `${key}: the focus is on ${String(at?.id)} and ${String(chosen)} is selected, wanted the focus on ${want} and alpha still selected`);
  }

  // Enter and Space choose. Each wait is for the condition (the row is the selected one) and ends the moment it holds; the frames after it give a page that selects more than it should the time to do it.
  const chosenIs = (page_, id) => until(page_, (want) => document.querySelector('[data-pl-part="row"][aria-current="true"]')?.getAttribute('data-pl-id') === want, id);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await chosenIs(page, 'beta');
  await settleFrames(page);
  check('keyboard.choose', (await selected()) === 'beta' && (await title()) === 'Beta Registry' && (await focused())?.id === 'beta', `Enter on the second row: ${String(await selected())} is selected, the detail says ${String(await title())}`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await chosenIs(page, 'delta');
  await settleFrames(page);
  check('keyboard.choose', (await selected()) === 'delta' && (await title()) === 'Delta Vault', `Space on the third row: ${String(await selected())} is selected, the detail says ${String(await title())}`);
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await chosenIs(page, 'alpha');
  await settleFrames(page);

  // The More menu: Enter opens it with the focus on its first item, the arrows move, Escape closes it and gives the focus back to the button.
  await page.locator('[data-pl-part="head-more"]').focus();
  await page.keyboard.press('Enter');
  await until(page, () => document.activeElement?.getAttribute('role') === 'menuitem');
  const first = await focused();
  check('keyboard.menu', first?.role === 'menuitem' && first.text === 'Disable', `Enter on the More button put the focus on ${JSON.stringify(first?.role ?? first?.part)} ${JSON.stringify(first?.text)}, wanted its first item, Disable`);
  await page.keyboard.press('ArrowDown');
  await until(page, () => (document.activeElement?.textContent ?? '').trim() === 'Uninstall…');
  check('keyboard.menu', (await focused())?.text === 'Uninstall…', 'ArrowDown in the menu did not go to Uninstall');
  await page.keyboard.press('Escape');
  await until(page, () => document.activeElement?.getAttribute('data-pl-part') === 'head-more' && document.querySelector('[role="menu"]')?.matches(':popover-open') !== true);
  check('keyboard.menu', (await focused())?.part === 'head-more' && (await page.evaluate(() => document.querySelector('[role="menu"]')?.matches(':popover-open') !== true)), 'Escape did not close the menu and give the focus back to the More button');

  // Enter on Reload: the progress takes the slot and the focus; when the work ends the focus goes back to a control of the cluster.
  await page.evaluate(() => window.__world.hold('reload'));
  await page.locator('[data-pl-part="slot-secondary"] > button').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-pl-part="head-progress"]');
  await settleFrames(page);
  const working = await focused();
  check('keyboard.progress', working?.part === 'head-progress', `after Enter on Reload the focus is on ${JSON.stringify(working?.part ?? working?.text)}, wanted the progress`);
  await page.evaluate(() => window.__world.release('reload'));
  await page.waitForFunction(() => document.querySelector('[data-pl-part="head-progress"]') === null, null, { timeout: WAIT });
  await until(page, () => document.activeElement?.tagName === 'BUTTON' && document.activeElement.closest('[data-pl-part="head-actions"]') !== null);
  const after = await page.evaluate(() => ({ tag: document.activeElement?.tagName, inCluster: document.activeElement?.closest('[data-pl-part="head-actions"]') !== null, text: (document.activeElement?.textContent ?? '').trim() }));
  check('keyboard.progress', after.tag === 'BUTTON' && after.inCluster, `when the work ended the focus was on ${JSON.stringify(after)}, wanted a button of the action cluster`);

  // The confirm: the menu's Uninstall opens it with the focus on Cancel; Tab stays in it; Escape closes it and the focus goes back to the button that opened the menu.
  await page.locator('[data-pl-part="head-more"]').focus();
  await page.keyboard.press('Enter');
  await until(page, () => document.activeElement?.getAttribute('role') === 'menuitem');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-pl-part="confirm"][open]');
  await settleFrames(page);
  check('keyboard.confirm', (await focused())?.part === 'confirm-cancel', `the confirm opened with the focus on ${JSON.stringify((await focused())?.part ?? (await focused())?.text)}, wanted Cancel`);
  check('keyboard.confirm', await page.evaluate(() => document.querySelector('[data-pl-part="confirm"]').matches(':modal')), 'the confirm is not the browser\'s modal dialog');
  const inside = [];
  for (let press = 0; press < 4; press += 1) {
    await page.keyboard.press(next);
    // A modal dialog's Tab goes round its own controls and, at the end of them, through the browser's own interface (the document has no focus then: `body`): never to the page behind it.
    const stop = await focused();
    inside.push(stop?.inDialog === true || (stop?.tag === 'BODY' && stop.inPage === false));
  }

  check('keyboard.confirm', inside.every(Boolean), `Tab reached the page behind the confirm (${JSON.stringify(inside)}): the page is not inert`);
  await page.keyboard.press('Escape');
  await until(page, () => document.querySelector('[data-pl-part="confirm"]') === null && document.activeElement?.getAttribute('data-pl-part') === 'head-more');
  await settleFrames(page);
  if (perturb?.afterEscape === true) await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  check('keyboard.confirm', (await page.evaluate(() => document.querySelector('[data-pl-part="confirm"]') === null)) && (await focused())?.part === 'head-more', `Escape: the confirm is ${(await page.evaluate(() => document.querySelector('[data-pl-part="confirm"]') === null)) ? 'closed' : 'still open'} and the focus is on ${JSON.stringify((await focused())?.part ?? (await focused())?.text)}, wanted it closed and the focus back on the More button that opened it`);

  for (const error of opened.errors) fail('page.error', where, error);
  await opened.context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The negative controls (rule 28): each perturbs ONE thing in the page or in the measurement, and the probe must see it in the assertion the control is named for and in no other; with that assertion removed (ASSERTION_OFF=<its pattern>, which a
// run prints) the same fault must pass undetected. Run one with
//   env -i PATH="$PATH" HOME="$HOME" FONT_DELAY_MS=40 NEGATIVE_CONTROL=<name> node ui-next/shell/plugins-page/probes/plugins-probe.mjs                                   exit 0: "detected", and nothing else failed
//   env -i PATH="$PATH" HOME="$HOME" FONT_DELAY_MS=40 NEGATIVE_CONTROL=<name> ASSERTION_OFF='<the pattern printed>' node ui-next/shell/plugins-page/probes/plugins-probe.mjs   exit 1: "NOT DETECTED"
// A control of the page's boxes and paint is a stylesheet added to the page right before it is read (`css`): a transform moves one box and reflows nothing, so only the assertion that part belongs to sees it. `cssLight` is added after the
// theme was flipped (a colour of its own); `page` is a function run in the page (the keyboard's and the axe's); `afterEscape` takes the focus away when Escape has closed the confirm; the performance controls are in plugins-perf.mjs (`parts`).
// PROVEN on 2026-11-22 (Chromium, 1440 x 900, one build shared through BUILD_CACHE, load 13 to 18; each control through the shard's own run, scripts/ci/probe-shards.mjs run): each of the 24 controls below printed `detected` with a failure in its own assertion and in no other, and printed `NOT DETECTED` with 0 other failures when
// run with ASSERTION_OFF set to its pattern. They name each assertion that is not a sub-check: geometry.list, .row, .header, .slots, .lane, .card, .dialog, .empty; paint.list, .row, .header, .buttons, .lane, .card, .dialog; tokens; a11y;
// keyboard.stop, keyboard.confirm; perf.mount, .event, .open, .idle. The keyboard sub-assertions .order, .free, .arrows, .choose, .menu and .progress, and `premise`, have no control yet (`keyboard.stop` was first perturbed by giving every row
// `tabindex=0`, which the kit's roving group undoes by itself: NOT DETECTED, so the control is an extra focusable in the list).
// `perf.open` has two controls, one for each way it fails: `late-list` (the list comes in a later commit and at a later animation frame) and `slow-open` (a second burned in the keydown, held by the 400 ms catastrophe bound, the only bound in milliseconds in the file).
const PERTURBATIONS = {
  'list-foot': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="list-foot"] { transform: translateY(-3px); }', expected: /^geometry\.list\b/ },
  'row-tile': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="row-tile"] { transform: translateY(2px); }', expected: /^geometry\.row\b/ },
  'facts-down': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="facts"] { transform: translateY(4px); }', expected: /^geometry\.header\b/ },
  'more-slot': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="slot-more"] { transform: translateX(-6px); }', expected: /^geometry\.slots\b/ },
  'lane-down': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="lane"] { transform: translateY(3px); }', expected: /^geometry\.lane\b/ },
  'card-title': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="card"] h3 { transform: translateY(3px); }', expected: /^geometry\.card\b/ },
  'confirm-button': { sections: ['geometry'], scenes: ['uninstall'], css: '[data-pl-part="confirm-confirm"] { transform: translateX(5px); }', expected: /^geometry\.dialog\b/ },
  'empty-body': { sections: ['geometry'], scenes: ['empty'], css: '[data-pl-part="detail-empty"] > * { transform: translateX(6px); }', expected: /^geometry\.empty\b/ },
  'list-fill': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="list"] { background-color: rgb(1, 2, 3) !important; }', expected: /^paint\.list\b/ },
  'selected-fill': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="row"][aria-current="true"] { background-color: rgb(1, 2, 3) !important; }', expected: /^paint\.row\b/ },
  'title-colour': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="head-title"] { color: rgb(1, 2, 3) !important; }', expected: /^paint\.header\b/ },
  'button-radius': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="slot-secondary"] > button { border-radius: 9px !important; }', expected: /^paint\.buttons\b/ },
  'lane-fill': { sections: ['geometry'], scenes: ['failed'], css: '[data-pl-part="lane"] { background-color: rgb(1, 2, 3) !important; }', expected: /^paint\.lane\b/ },
  'card-fill': { sections: ['geometry'], scenes: ['running'], css: '[data-pl-part="card"] { background-color: rgb(1, 2, 3) !important; }', expected: /^paint\.card\b/ },
  'dialog-radius': { sections: ['geometry'], scenes: ['uninstall'], css: '[data-pl-part="confirm"] > div { border-radius: 3px !important; }', expected: /^paint\.dialog\b/ },
  'pinned-lane': { sections: ['tokens'], scenes: ['disabled'], cssLight: '[data-pl-part="lane"] { background-color: rgb(35, 53, 88) !important; }', expected: /^tokens\b/ },
  'no-name': { sections: ['a11y'], scenes: ['running'], page: () => document.querySelector('[data-pl-part="head-more"]')?.removeAttribute('aria-label'), expected: /^a11y\b/ },
  'extra-stop': { sections: ['keyboard'], page: () => document.querySelector('[data-pl-part="list-scroll"]').append(Object.assign(document.createElement('button'), { textContent: 'extra' })), expected: /^keyboard\.stop\b/ },
  'focus-lost': { sections: ['keyboard'], afterEscape: true, expected: /^keyboard\.confirm\b/ },
  // The performance controls (plugins-perf.mjs, the part each perturbs): `late-change` is a second commit after the list came in (the page's commits after the command); `second-row` is one commit that renders two rows (the rows one event changes);
  // `late-list` is a page with no seed, whose list comes when the host answers 100 ms later (the commits from the command to the list and the animation frame the list is in the document at: both of `perf.open`); `slow-open` burns a second
  // in the keydown of the command, which only the catastrophe's bound on milliseconds sees (the frames and the commits stay what they are); `idle-timer` is a timer kept while the page is on screen.
  'late-change': { sections: ['perf'], parts: ['mount'], expected: /^perf\.mount\b/ },
  'second-row': { sections: ['perf'], parts: ['event'], expected: /^perf\.event\b/ },
  'late-list': { sections: ['perf'], parts: ['open'], expected: /^perf\.open\b/ },
  'slow-open': { sections: ['perf'], parts: ['open'], expected: /^perf\.open\b/ },
  'idle-timer': { sections: ['perf'], parts: ['idle'], expected: /^perf\.idle\b/ },
};
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);
// ASSERTION_OFF is for a negative control and for the one assertion that control is named for: with no control, or with a pattern that is not the control's own, it would silence a run that really fails.
if (OFF !== undefined && (CONTROL === '' || OFF.source !== PERTURBATIONS[CONTROL].expected.source)) throw new Error(`ASSERTION_OFF must be the pattern of the active negative control's own assertion (NEGATIVE_CONTROL=${CONTROL === '' ? '<none>' : CONTROL}${CONTROL === '' ? '' : `, its pattern is ${PERTURBATIONS[CONTROL].expected.source}`})`);
if (process.env.CONTROLS === '1') {
  for (const [name, control] of Object.entries(PERTURBATIONS)) console.log(`${name.padEnd(16)} ${control.sections.join(',').padEnd(9)} ${control.expected.source}`);
  process.exit(0);
}

const wants = (section) => (CONTROL === '' ? names('SECTIONS', SECTION_NAMES).includes(section) : PERTURBATIONS[CONTROL].sections.includes(section));

const production = wants('geometry') || wants('tokens') || wants('a11y') || wants('keyboard') || wants('perf') ? await serveFixtures(buildFixture('production')) : null;
// React's development build is for the counts of commits (the perf section's: its Profiler calls nothing in a production build); every time is read from the production build.
const development = wants('perf') ? await serveFixtures(buildFixture('development')) : null;
const axe = wants('a11y') ? readFileSync(AXE, 'utf8') : '';
const perturb = CONTROL === '' ? undefined : PERTURBATIONS[CONTROL];
report.sectionSeconds = {};
/** Runs one section and adds its seconds to the engine's: the shard table's units are sections. */
async function timed(engine, section, run) {
  const from = Date.now();
  await run();
  report.sectionSeconds[`${engine} ${section}`] = round((report.sectionSeconds[`${engine} ${section}`] ?? 0) + (Date.now() - from) / 1000);
}

const startedAt = Date.now();
for (const engine of engineNames) {
  const browser = await launch(engine);
  const engineStart = Date.now();
  for (const viewportName of viewportNames) {
    const viewport = NATIVE_VIEWPORTS[viewportName];
    if (wants('geometry')) await timed(engine, 'geometry', () => geometrySection(browser, engine, viewportName, viewport, production.origin, perturb));
    if (wants('tokens')) await timed(engine, 'tokens', () => tokensSection(browser, engine, viewportName, viewport, production.origin, perturb));
    if (wants('a11y')) await timed(engine, 'a11y', () => a11ySection(browser, engine, viewportName, viewport, production.origin, axe, perturb));
    if (wants('keyboard')) await timed(engine, 'keyboard', () => keyboardSection(browser, engine, viewportName, viewport, production.origin, perturb));
    // Every count of the perf section (commits, frames, batches, nodes, timers) is the same at every viewport, and its runs are the longest of the probe: it runs at the first viewport of the run (1440 x 900), once for each engine.
    if (wants('perf') && viewportName === viewportNames[0]) {
      const { perf } = await import('./plugins-perf.mjs');
      await timed(engine, 'perf', () => perf({ browser, engine, viewportName, viewport, production, development, report, fail, count, url: (origin, query, hash) => fixtureUrl(origin, query, hash), only: CONTROL === '' ? process.env.PARTS?.split(',') : perturb.parts, control: CONTROL }));
    }

    console.log(engine, viewportName, 'done');
  }

  await browser.close();
  report.seconds[engine] = Math.round((Date.now() - engineStart) / 1000);
}

production?.server.close();
development?.server.close();
const uptimeAtEnd = uptime();
console.log(`uptime at the start: ${uptimeAtStart}\nuptime at the end:   ${uptimeAtEnd}\nseconds: ${JSON.stringify(report.seconds)} (${Math.round((Date.now() - startedAt) / 1000)} in all); by section: ${JSON.stringify(report.sectionSeconds)}`);
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify({ ...report, uptimeAtStart, uptimeAtEnd }, null, 2)}\n`);

console.log('\nassertion          result  checks');
for (const name of [...seen.keys()].sort()) {
  const failed = failures.filter((line) => line.startsWith(`${name} `)).length;
  console.log(`${name.padEnd(18)} ${failed === 0 ? 'ok    ' : 'FAIL  '} ${String(seen.get(name)).padStart(5)}${worst.has(name) ? `  (worst ${worst.get(name)} px)` : ''}${failed === 0 ? '' : `  ${failed} failure(s)`}`);
}

if (CONTROL !== '') {
  const detected = failures.filter((line) => perturb.expected.test(line));
  const others = failures.filter((line) => !perturb.expected.test(line));
  console.log(`\nwhat the probe saw with the perturbation "${CONTROL}": ${String(failures.length)} differences\n${failures.slice(0, 12).map((line) => `  ${line.slice(0, 260)}`).join('\n')}`);
  console.log(`its assertion, to remove with ASSERTION_OFF: ${perturb.expected.source}`);
  // A control trips its own assertion and no other (rule 28): a failure of another check in the run (a precondition that did not hold) fails the control, and a control that nothing sees is no detection.
  if (detected.length > 0 && others.length === 0) {
    console.log(`\nNEGATIVE CONTROL "${CONTROL}": detected (${String(detected.length)} differences, only in ${perturb.expected.source}, e.g. ${detected[0].slice(0, 200)})`);
    process.exit(0);
  }

  console.log(detected.length > 0 ? `\nNEGATIVE CONTROL "${CONTROL}": FAILED, ${String(others.length)} other failures (a control trips only its own assertion): ${others[0].slice(0, 200)}` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${String(failures.length)} other failures)`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

console.log('\nplugins probe: no failures');

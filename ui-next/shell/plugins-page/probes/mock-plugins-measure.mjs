// Measures the design mock's Plugins page: the REFERENCE the host's Plugins page (slice PL1, ui-next/shell/plugins-page) is probed against.
//
// What it measures, per engine (webkit, chromium), viewport (1440x900, 1280x800) and scene, in a FRESH page per scene, with the mock's default context (no text scale, default density, the dark theme the mock starts
// in; the UI font normalized as mock-rail-measure.mjs does; the page runs in en-US and UTC, so a date reads the same everywhere):
//   the mock's Plugins page (`host/plugins`, shell-page-plugins.js), opened with the mock's own tab model, after the mock's plugin world was replaced by the six neutral plugins of world.mjs. The mock's own plugins
//   carry the words of a plugin domain, which the vocabulary guard keeps out of this tree, so the mock is made to draw the words of world.mjs and never its own: no mock name, summary or readme is read or recorded.
//   Scenes (the plugin selected, then what is done to the page):
//     running    the first healthy plugin of the world (SELECTED), the Installed list and its detail.
//     failed     the plugin whose service stopped (a service-layer failure with the cause sentence of CAUSE, its first automatic retry an hour away).
//     disabled   the plugin that is switched off.
//     starting   the plugin whose service is starting.
//     empty      nothing installed: the empty list and the empty detail.
//     uninstall  the first healthy plugin with its Uninstall confirm dialog open (the scrim and the dialog).
//     busy       the first healthy plugin with a Disable in progress: the mock's timers of 500 ms and more are held, so the operation stays in its first step and the progress takes the primary action's slot.
//     rowStates  paint only: a list row of a healthy plugin at rest, under the pointer, with the keyboard focus, and the current (selected) row, at rest and under the pointer.
//   For each scene, every role of ROLES (below): its rectangle(s) [x, y, w, h] in viewport px, 0.01; its paint (computed style, a default value left out); its text (the visible length, the extent of the laid-out words, the
//   scrollWidth and clientWidth of a box that clips them, and the words themselves only when they are the neutral words of world.mjs); and the facts the scene was checked against. A role the scene does not draw is null.
//
// Serve the mock first or let the script do it: without MOCK_URL it serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) from a CommonJS copy of its server.js with `root` set, on the first free
// port from 49475. The 1-minute load average is read first (`uptime`) and the run waits while it is above 30: a loaded machine moves the timings the scenes depend on.
// Run:  env -i PATH="$PATH" HOME="$HOME" node ui-next/shell/plugins-page/probes/mock-plugins-measure.mjs     (about 3 minutes)
//       MOCK_URL=http://127.0.0.1:49471/ ...  measures a mock that is already served; ENGINES=chromium, VIEWPORTS=1440x900 and SCENES=running,failed narrow a run (a narrowed run, and a run that failed, write
//       mock-plugins.partial.json to the temp directory and leave mock-plugins.json alone); SHOTS=<dir> also writes a screenshot of each scene there (mock-<scene>-<engine>-<viewport>.png).
// Writes mock-plugins.json. Exits non-zero when a scene does not draw what it says (no rows, no header, no lane, no dialog, a state that is not in effect).
//
// mock-plugins.json: { mockTree, identity, viewports, uptime, note, notes, words, setup, theme, roles, paints,
//   data: { <engine>: { <viewport>: { <scene>: { rects, paint, text, facts }, rowStates: { target, states } } } } }
//   rects: { <role>: [x, y, w, h] | [[x, y, w, h]...] | null }   one rectangle for a role of `which` first, one per match for `all` (the first six rows, the first twelve of any other role), null for a role that is not drawn.
//          A role that is read `within` another (the parts of a row) is an array with one entry per row, null where the row has no such part.
//   paint: { <role>: <paint id> | [..] | null }   an id of `paints`: { <css property>: value }. A property left out has its default: no background, no border (a `border` that has sides is one value when the four
//          sides are alike, else { top, right, bottom, left } of the sides that are drawn), no shadow, no outline, 0 padding and margin, no gap, opacity 1, text-overflow clip, white-space normal.
//   text:  { <role>: { len, ink, scrollWidth, clientWidth, lines, text } | null }   `len` is the length of the visible text; `ink` the extent [x, y, w, h] of the laid-out words, left out when it is the element's own box;
//          `scrollWidth` and `clientWidth` are there only on a box that clips its words (scrollWidth over clientWidth); `lines` only when more than one; `text` only for the neutral words (a text that is nothing but
//          WORLD's names, versions, publishers, categories, licenses, summaries and CAUSE, and separators). A `parts` role (the words between the separators of the facts line) has one entry per part.
//   facts: { list, rows: { count, current, names, chips, switches }, health, detail: { plugin, title, chips, slots, primary, secondary, lane, tabs, card, overflow }, emptyDetail, dialog, container, held }   what the scene
//          drew, in the mock's data attributes and classes: no word of the mock's own.
//   rowStates.states: { <state>: { matches, paint: { <part>: <paint id> } } }   state: rest | hover | focus | current | currentHover; the target is the row of a healthy plugin (rest, hover, focus) or the current row.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont, sleep } from '../../../../packages/kit/probes/probe-lib.mjs';
import { SELECTED, WORLD } from './world.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const SCENE_NAMES = ['running', 'failed', 'disabled', 'starting', 'empty', 'uninstall', 'busy', 'rowStates'];
const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
const SHOTS = process.env.SHOTS;
const MAX_LOAD = 30;
const started = Date.now();

const names = (key, all) => (process.env[key] ?? all.join(',')).split(',');
const engineNames = names('ENGINES', Object.keys(ENGINES));
const viewportNames = names('VIEWPORTS', Object.keys(VIEWPORTS));
const sceneNames = names('SCENES', SCENE_NAMES);
for (const [what, list, known] of [['ENGINES', engineNames, Object.keys(ENGINES)], ['VIEWPORTS', viewportNames, Object.keys(VIEWPORTS)], ['SCENES', sceneNames, SCENE_NAMES]]) {
  const unknown = list.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`${what} names ${unknown.join(', ')}, which is not one of ${known.join(', ')}`);
}
/** Every known name exactly once: only a run that is complete may replace the reference. */
const eachOnce = (list, known) => list.length === known.length && known.every((name) => list.filter((entry) => entry === name).length === 1);
const partial = !eachOnce(engineNames, Object.keys(ENGINES)) || !eachOnce(viewportNames, Object.keys(VIEWPORTS)) || !eachOnce(sceneNames, SCENE_NAMES);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The machine: the load average is read before anything is measured (the retry clock of the mock's failed plugin and the settle window of its feedback layer are wall-clock timers).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const load1 = (text) => Number(/load averages?:\s*([\d.]+)/.exec(text)?.[1] ?? 0);
const uptimeAtStart = uptime();
for (let wait = 0; load1(uptime()) > MAX_LOAD && wait < 40; wait++) {
  console.log(`load average ${load1(uptime())} is above ${MAX_LOAD}: waiting 15 s`);
  await sleep(15000);
}
const uptimeAtRun = uptime();
console.log('uptime:', uptimeAtRun);

/**
 * Whether the mock this run measures is the tree the reference is labelled with: the directory is in a git work tree whose HEAD holds MOCK_TREE at that directory, with no file of it changed or untracked,
 * and this script serves it itself. Said in the JSON; a run that cannot show it still runs.
 */
function mockIdentity() {
  if (process.env.MOCK_URL !== undefined) return `not shown: MOCK_URL names a server of your own, whose files cannot be read`;
  try {
    const git = (...args) => execFileSync('git', ['-C', MOCK_DIR, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const tree = git('rev-parse', 'HEAD:./');
    if (tree !== MOCK_TREE) return `not shown: ${MOCK_DIR} holds tree ${tree} at HEAD`;
    const changed = git('status', '--porcelain', '--untracked-files=all', '--', '.');
    return changed === '' ? `tree ${tree}, no change` : `not shown: ${MOCK_DIR} has changes against tree ${tree}: ${changed.split('\n')[0]}`;
  } catch (error) {
    return `not shown: the tree of ${MOCK_DIR} could not be read with git: ${String(error.message).split('\n')[0]}`;
  }
}
const identity = mockIdentity();
console.log('mock identity:', identity);

let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory, on the first port that is free (a server that stays up for 1.5 s).
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-plugins-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  for (let port = 49475; port < 49495 && server === null; port++) {
    const child = spawn(process.execPath, [copy], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    await sleep(1500);
    if (child.exitCode === null) { server = child; url = `http://127.0.0.1:${port}/`; } else console.log(`port ${port} is taken`);
  }
  if (server === null) throw new Error('no free port from 49475 to 49494 for the mock server');
  console.log('serving the mock at', url);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The world: what is written into the mock before its page opens. The mock keeps ONE plugin fixture (Shell.pluginData); its default world is uninstalled and the neutral plugins of world.mjs are installed as
// records of it. The page adopts a record's identity (name, publisher, category, summary, icon, mark, market) into its own catalog and registers a stub plugin for it, so the list and the detail draw them.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** The sentence the failed plugin's service gives as its cause. */
const CAUSE = "The plugin process stopped unexpectedly, so its pages can't load data.";
/** The records are installed at this instant (noon UTC): the quiet lane says "Installed <date>". */
const INSTALLED_AT = Date.UTC(2026, 9, 3, 12);
/** A glyph that names no plugin: the mock's own default for a record without one. */
const ICON = 'LuPuzzle';
/** What each record asked permission for (the mock's own capability ids): the quiet lane counts them. */
const CAPS = ['net.endpoint', 'secrets.store', 'clipboard'];
/** The first automatic retry of the failed plugin, in seconds: far beyond the run, so its state never leaves Failed (the mock's default clock retries after 2 s). */
const RETRY_AFTER = 3600;
const idOf = (state) => WORLD.find((plugin) => plugin.state === state).id;
const nameOf = (id) => WORLD.find((plugin) => plugin.id === id)?.name;
/** The order the page lists the plugins in: by name. */
const LISTED = [...WORLD].sort((a, b) => a.name.localeCompare(b.name));

/** The page script that puts the world in place and opens the page. `world` is the list of plugins to install (empty: nothing is installed), `selected` the plugin the page selects ('' selects none). */
const worldScript = (world, selected) => `(() => {
  const world = ${JSON.stringify(world.map(({ id, name, version, publisher, category, summary, state }) => ({ id, name, version, publisher, category, summary, state })))};
  // 1. Every plugin of the mock's default world is uninstalled.
  for (const record of Shell.pluginData.list({ installed: true })) Shell.pluginData.set(record.id, { installed: false });
  // 2. The neutral plugins are installed, as records of the world and as marketplace plugins (\`market: true\`: the detail then has the Versions and Changelog tabs and the downloads of the facts line).
  //    The flush runs the page's own sync at once: it registers a stub plugin for each record, so the health below has a plugin to be written for, and adopts the record's identity (the sync that the writes below
  //    cause adopts \`market\`).
  for (const plugin of world) {
    Shell.pluginData.set(plugin.id, { name: plugin.name, publisher: plugin.publisher, category: plugin.category, summary: plugin.summary, icon: ${JSON.stringify(ICON)}, mark: plugin.name.slice(0, 2).toUpperCase(),
      installed: true, version: plugin.version, source: 'marketplace', enabled: plugin.state !== 'disabled', market: true, official: false, verified: false, installedAt: ${INSTALLED_AT}, caps: ${JSON.stringify(CAPS)} });
  }
  Shell.flush();
  // 3. Health: the failed plugin's service has failed, the starting plugin's service is starting (the disabled one is enabled: false above).
  for (const plugin of world) {
    if (plugin.state === 'failed') Shell.plugins.report(plugin.id, { service: 'failed', reason: ${JSON.stringify(CAUSE)}, retries: { attempt: 0, max: 5, delays: [${RETRY_AFTER}, ${RETRY_AFTER}, ${RETRY_AFTER}, ${RETRY_AFTER}, ${RETRY_AFTER}], persist: true } });
    if (plugin.state === 'starting') Shell.plugins.report(plugin.id, { service: 'starting' });
  }
  // 4. The page's own state selects the plugin it shows the detail of ('' selects none); the page is then opened in the current tab, so its first render already shows that plugin.
  Shell.update(['pluginsPage', 'ui'], { selected: ${JSON.stringify(selected)} });
  Shell.flush();
  Shell.tabs.open({ plugin: 'host', route: { page: 'host/plugins' } }, { how: 'here' });
})()`;

/** What a scene does after the page is open, with the mock's own commands (the ones the page's controls dispatch). */
const DIALOG = `Shell.run('host.plugins.act', { arg: 'dialog|uninstall' });`;
const HOLD = `(() => { const real = window.setTimeout.bind(window); window.__held = 0; window.setTimeout = (fn, ms, ...rest) => { if (Number(ms) >= 500) { window.__held++; return 0; } return real(fn, ms, ...rest); }; })();`;
const DISABLE = (id) => `Shell.run('host.plugin.disable', { arg: ${JSON.stringify(id)} });`;

const SCENES = {
  running: { select: SELECTED },
  failed: { select: idOf('failed') },
  disabled: { select: idOf('disabled') },
  starting: { select: idOf('starting') },
  empty: { select: '', world: [] },
  uninstall: { select: SELECTED, then: DIALOG },
  busy: { select: SELECTED, then: `${HOLD}${DISABLE(SELECTED)}` },
  rowStates: { select: SELECTED },
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The roles: { key, selector, which?: 'first' (default) | 'all' | an index | 'parts', within?, limit?, pseudo?, text?, paint?: [css properties] }.
//   `within` reads the selector inside each element of an `all` role (the six rows), so an array holds one entry per row; `parts` reads the content nodes of the first match (the words between the separators);
//   `pseudo` reads the paint of a pseudo-element (no rectangle); `text: true` records the text of the element; `limit` is the most elements an `all` role reads (12; the rows 6).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const TYPE = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-overflow', 'white-space'];
const BOX = ['background-color', 'border', 'border-radius', 'padding', 'margin', 'gap', 'opacity', 'box-shadow', 'outline'];
const BOTH = [...TYPE, ...BOX];
const GROUPS = new Map([[TYPE, 'type'], [BOX, 'box'], [BOTH, 'type+box']]);

const ROLES = [
  // The frame and its regions. The Plugins page has no rail (null). The page island holds the page's scroll owner (`scrollport`) and its content (`pane`: the page container the mock's container queries ask,
  // `@container page`), which holds the detail.
  { key: 'frame', selector: '.frame' },
  { key: 'rail', selector: '.frame__rail' },
  { key: 'sidebar', selector: '.frame__sidebar', paint: BOX },
  { key: 'splitter', selector: '.frame__grid > .splitter[data-region="sidebar"]' },
  { key: 'island', selector: '.frame__island', paint: BOX },
  { key: 'page', selector: '.frame__page' },
  { key: 'scrollport', selector: '#mainscroll' },
  { key: 'pane', selector: '#mainscroll > .content', paint: BOX },
  // The sidebar: the heading (Installed / Marketplace), the search, the tools lane, the scroll area, the rows, the footer.
  { key: 'side', selector: '.plug-side' },
  { key: 'sideHead', selector: '.plug-side__head', paint: BOX },
  { key: 'seg', selector: '.plug-side__head > .seg', paint: BOX },
  { key: 'segButtons', selector: '.plug-side__head > .seg > button', which: 'all', text: true, paint: BOTH },
  { key: 'segCounts', selector: '.plug-side__head > .seg .plug-count', which: 'all', paint: TYPE },
  { key: 'search', selector: '.plug-side__head > .search', paint: BOX },
  { key: 'searchIcon', selector: '.plug-side__head > .search > .ic', paint: ['color'] },
  { key: 'searchInput', selector: '.plug-side__head > .search > input', paint: BOTH },
  { key: 'tools', selector: '.plug-tools', paint: BOX },
  { key: 'toolsButtons', selector: '.plug-tools > button', which: 'all', text: true, paint: BOTH },
  { key: 'toolsMore', selector: '.plug-tools__end > button', paint: BOTH },
  { key: 'scroll', selector: '.plug-side__scroll', paint: BOX },
  { key: 'listrows', selector: '.plug-side__scroll .listrows' },
  { key: 'rows', selector: '.plug-side__scroll .listrow', which: 'all', limit: 6, paint: BOX },
  { key: 'rowMain', selector: '.listrow__main', within: 'rows', paint: BOX },
  { key: 'rowTile', selector: '.avatar', within: 'rows', paint: BOX },
  { key: 'rowGlyph', selector: '.avatar__icon', within: 'rows', paint: ['color'] },
  { key: 'rowText', selector: '.listrow__text', within: 'rows' },
  { key: 'rowLine1', selector: '.listrow__text > span', within: 'rows', paint: TYPE },
  { key: 'rowName', selector: '.listrow__text strong', within: 'rows', text: true, paint: TYPE },
  { key: 'rowVersion', selector: '.plug-ver', within: 'rows', text: true, paint: TYPE },
  { key: 'rowLine2', selector: '.listrow__text > small', within: 'rows', paint: TYPE },
  { key: 'rowClip2', selector: '.listrow__text > small > .plug-clip', within: 'rows', text: true, paint: TYPE },
  { key: 'rowChip', selector: '.listrow__text small .resource-state', within: 'rows', paint: BOTH },
  { key: 'rowChipIcon', selector: '.listrow__text small .resource-state__icon', within: 'rows', paint: ['color'] },
  { key: 'rowChipLabel', selector: '.listrow__text small .resource-state__label', within: 'rows', text: true, paint: TYPE },
  { key: 'rowAside', selector: '.listrow__aside', within: 'rows' },
  { key: 'rowSwitch', selector: '.switch-button', within: 'rows', paint: BOX },
  { key: 'rowSwitchMark', selector: '.sw', within: 'rows', paint: BOX },
  { key: 'rowSwitchKnob', selector: '.sw', within: 'rows', pseudo: '::after', paint: BOX },
  { key: 'foot', selector: '.plug-side__foot', paint: BOTH },
  { key: 'footCount', selector: '.plug-side__foot .collection-count', text: true, paint: TYPE },
  // The sidebar when nothing is installed.
  { key: 'listEmpty', selector: '.plug-side__scroll .empty2', paint: BOX },
  { key: 'listEmptyIcon', selector: '.plug-side__scroll .empty2 > .bigicon', paint: BOX },
  { key: 'listEmptyTitle', selector: '.plug-side__scroll .empty2 > b', text: true, paint: TYPE },
  { key: 'listEmptySub', selector: '.plug-side__scroll .empty2 > .tiny', text: true, paint: TYPE },
  { key: 'listEmptyAction', selector: '.plug-side__scroll .empty2 > button', text: true, paint: BOTH },
  // The detail: the identity header (art, title, meta chips, the action cluster with its three slots), the facts line, the summary.
  { key: 'detail', selector: '.plug-detail' },
  { key: 'head', selector: '.plug-head' },
  { key: 'identity', selector: '.plug-head .identity-header' },
  { key: 'identityPrimary', selector: '.plug-head .identity-header__primary' },
  { key: 'art', selector: '.plug-head .identity-header__art' },
  { key: 'artTile', selector: '.plug-head .identity-header__art > .avatar', paint: BOX },
  { key: 'artGlyph', selector: '.plug-head .identity-header__art .avatar__icon', paint: ['color'] },
  { key: 'title', selector: '.plug-head .identity-header__primary > h2', text: true, paint: TYPE },
  { key: 'actions', selector: '.plug-head .identity-header__actions' },
  { key: 'cluster', selector: '.plug-head .plug-actions' },
  { key: 'slotPrimary', selector: '.plug-head .plug-slot--primary' },
  { key: 'slotSecondary', selector: '.plug-head .plug-slot--secondary' },
  { key: 'primaryButton', selector: '.plug-head .plug-slot--primary > button', text: true, paint: BOTH },
  { key: 'primaryIcon', selector: '.plug-head .plug-slot--primary > button > .ic', paint: ['color'] },
  { key: 'secondaryButton', selector: '.plug-head .plug-slot--secondary > button', text: true, paint: BOTH },
  { key: 'secondaryIcon', selector: '.plug-head .plug-slot--secondary > button > .ic', paint: ['color'] },
  { key: 'more', selector: '.plug-head .plug-more', paint: BOTH },
  { key: 'moreIcon', selector: '.plug-head .plug-more > .ic', paint: ['color'] },
  { key: 'prog', selector: '.plug-head .plug-prog', paint: BOX },
  { key: 'progLabel', selector: '.plug-head .plug-prog__label', text: true, paint: TYPE },
  { key: 'progBar', selector: '.plug-head .plug-prog__bar', paint: BOX },
  { key: 'progFill', selector: '.plug-head .plug-prog__bar > i', paint: BOX },
  { key: 'meta', selector: '.plug-head .identity-header__meta' },
  { key: 'chipVersion', selector: '.plug-head .identity-header__meta > .chip.mono', text: true, paint: BOTH },
  { key: 'chipTrust', selector: '.plug-head .identity-header__meta > .chip:not(.mono)', text: true, paint: BOTH },
  { key: 'chipTrustIcon', selector: '.plug-head .identity-header__meta > .chip:not(.mono) > .ic', paint: ['color'] },
  { key: 'chipState', selector: '.plug-head .identity-header__meta > .resource-state', paint: BOTH },
  { key: 'chipStateIcon', selector: '.plug-head .identity-header__meta .resource-state__icon', paint: ['color'] },
  { key: 'chipStateLabel', selector: '.plug-head .identity-header__meta .resource-state__label', text: true, paint: TYPE },
  { key: 'facts', selector: '.plug-head .plug-facts-line', text: true, paint: TYPE },
  { key: 'factsParts', selector: '.plug-head .plug-facts-line', which: 'parts' },
  { key: 'factsSeps', selector: '.plug-head .plug-facts-line > .plug-sep', which: 'all' },
  { key: 'summary', selector: '.plug-head .plug-summary', text: true, paint: TYPE },
  // The status lane: the quiet lane (two lines and a link) or the notice (icon, message, actions).
  { key: 'lane', selector: '.plug-lane', paint: BOX },
  { key: 'laneLines', selector: '.plug-lane--quiet > p', which: 'all', text: true, paint: TYPE },
  { key: 'laneLink', selector: '.plug-lane .linkbtn', text: true, paint: BOTH },
  { key: 'notice', selector: '.plug-lane .notice', paint: BOTH },
  { key: 'noticeIcon', selector: '.plug-lane .notice__icon', paint: ['color'] },
  { key: 'noticeBody', selector: '.plug-lane .notice__body' },
  { key: 'noticeMessage', selector: '.plug-lane .notice__message', text: true, paint: TYPE },
  { key: 'noticeParts', selector: '.plug-lane .notice__message', which: 'parts' },
  { key: 'noticeTitle', selector: '.plug-lane .notice__message > strong', text: true, paint: TYPE },
  { key: 'noticeActions', selector: '.plug-lane .notice__actions' },
  { key: 'noticeButtons', selector: '.plug-lane .notice__actions > button', which: 'all', text: true, paint: BOTH },
  // The tabs bar and the scroll region under it; the overview: the readme column and the details card (a key-value list and two buttons).
  { key: 'tabs', selector: '.plug-tabs' },
  { key: 'tabsStrip', selector: '.plug-tabs .tabs', paint: BOX },
  { key: 'tabButtons', selector: '.plug-tabs [role="tab"]', which: 'all', text: true, paint: BOTH },
  { key: 'tabCounts', selector: '.plug-tabs [role="tab"] .count', which: 'all', paint: TYPE },
  { key: 'scrollRegion', selector: '.plug-scroll', paint: BOX },
  { key: 'overview', selector: '.plug-overview' },
  { key: 'markdown', selector: '.plug-overview > .md' },
  { key: 'mdHeading', selector: '.plug-overview > .md > h3', text: true, paint: TYPE },
  { key: 'mdBody', selector: '.plug-overview > .md > p', text: true, paint: TYPE },
  { key: 'card', selector: '.plug-card', paint: BOX },
  { key: 'cardHead', selector: '.plug-card .form-section__head' },
  { key: 'cardTitle', selector: '.plug-card .form-section__head > h3', text: true, paint: TYPE },
  { key: 'cardKv', selector: '.plug-card dl.kv', paint: BOX },
  { key: 'cardTerms', selector: '.plug-card dl.kv > dt', which: 'all', text: true, paint: TYPE },
  { key: 'cardValues', selector: '.plug-card dl.kv > dd', which: 'all', text: true, paint: TYPE },
  { key: 'cardLinks', selector: '.plug-card .plug-links' },
  { key: 'cardButtons', selector: '.plug-card .plug-links > button', which: 'all', text: true, paint: BOTH },
  // The empty detail (nothing selected).
  { key: 'emptyDetail', selector: '.plug-detail--empty' },
  { key: 'emptyDetailBox', selector: '.plug-detail--empty > .empty2' },
  { key: 'emptyDetailIcon', selector: '.plug-detail--empty .bigicon', paint: BOX },
  { key: 'emptyDetailTitle', selector: '.plug-detail--empty .empty2 > b', text: true, paint: TYPE },
  { key: 'emptyDetailSub', selector: '.plug-detail--empty .empty2 > .tiny', text: true, paint: TYPE },
  // The Uninstall confirm dialog: the scrim, the dialog, its header, its body (sections, the check box row), its footer.
  { key: 'scrim', selector: '#layer .scrim', paint: BOX },
  { key: 'dialog', selector: '#layer .scrim > .dlg', paint: BOX },
  { key: 'dlgHead', selector: '#layer .dlg > .hd', paint: BOX },
  { key: 'dlgIdentity', selector: '#layer .dlg .identity-header' },
  { key: 'dlgArt', selector: '#layer .dlg .identity-header__art' },
  { key: 'dlgTile', selector: '#layer .dlg .identity-header__art > .avatar', paint: BOX },
  { key: 'dlgTitle', selector: '#layer .dlg .identity-header__primary > h2', text: true, paint: TYPE },
  { key: 'dlgMeta', selector: '#layer .dlg .identity-header__meta', text: true, paint: TYPE },
  { key: 'dlgClose', selector: '#layer .dlg .inspector-header__close', paint: BOTH },
  { key: 'dlgBody', selector: '#layer .dlg > .bd', paint: BOX },
  { key: 'dlgParagraphs', selector: '#layer .dlg > .bd > p', which: 'all', text: true, paint: TYPE },
  { key: 'dlgSections', selector: '#layer .dlg > .bd .form-section__head', which: 'all' },
  { key: 'dlgSectionTitles', selector: '#layer .dlg > .bd .form-section__head > h3', which: 'all', text: true, paint: TYPE },
  { key: 'dlgCheck', selector: '#layer .dlg label.check' },
  { key: 'dlgCheckBox', selector: '#layer .dlg label.check .selection-command', paint: BOX },
  { key: 'dlgCheckMark', selector: '#layer .dlg label.check .cb', paint: BOX },
  { key: 'dlgCheckText', selector: '#layer .dlg label.check .check__text', text: true, paint: TYPE },
  { key: 'dlgHint', selector: '#layer .dlg > .bd > p.dim', text: true, paint: TYPE },
  { key: 'dlgFoot', selector: '#layer .dlg > .ft', paint: BOX },
  { key: 'dlgButtons', selector: '#layer .dlg > .ft > button', which: 'all', text: true, paint: BOTH },
];

/** The roles a scene must draw (a null is a scene that does not draw what it says). */
const COMMON = ['frame', 'sidebar', 'island', 'pane', 'side', 'seg', 'search', 'tools', 'scroll', 'foot'];
const DETAIL = ['detail', 'head', 'identity', 'art', 'artTile', 'title', 'actions', 'cluster', 'slotPrimary', 'slotSecondary', 'more', 'meta', 'chipVersion', 'chipTrust', 'chipState', 'chipStateLabel', 'facts', 'factsParts', 'summary',
  'lane', 'tabs', 'tabButtons', 'scrollRegion', 'overview', 'markdown', 'card', 'cardKv', 'cardTerms', 'cardValues', 'cardButtons'];
const LISTED_ROLES = ['listrows', 'rows', 'rowMain', 'rowTile', 'rowLine1', 'rowName', 'rowVersion', 'rowLine2', 'rowAside', 'rowSwitch'];
const REQUIRED = {
  running: [...COMMON, ...LISTED_ROLES, ...DETAIL, 'secondaryButton', 'laneLines', 'laneLink'],
  failed: [...COMMON, ...LISTED_ROLES, ...DETAIL, 'rowChip', 'primaryButton', 'secondaryButton', 'notice', 'noticeIcon', 'noticeMessage', 'noticeTitle', 'noticeActions', 'noticeButtons'],
  disabled: [...COMMON, ...LISTED_ROLES, ...DETAIL, 'rowChip', 'primaryButton', 'notice', 'noticeIcon', 'noticeMessage', 'noticeTitle'],
  starting: [...COMMON, ...LISTED_ROLES, ...DETAIL, 'rowChip', 'primaryButton', 'secondaryButton', 'laneLines'],
  empty: [...COMMON, 'listEmpty', 'listEmptyTitle', 'listEmptyAction', 'emptyDetail', 'emptyDetailBox', 'emptyDetailTitle'],
  uninstall: [...COMMON, ...LISTED_ROLES, ...DETAIL, 'scrim', 'dialog', 'dlgHead', 'dlgTitle', 'dlgClose', 'dlgBody', 'dlgParagraphs', 'dlgSections', 'dlgCheck', 'dlgCheckBox', 'dlgCheckText', 'dlgFoot', 'dlgButtons'],
  busy: [...COMMON, ...LISTED_ROLES, ...DETAIL, 'prog', 'progLabel', 'progBar', 'progFill'],
};

/** The tokens the page's paint rests on (colours are resolved, the rest read as written): a theme that differs shows here. */
const COLOR_TOKENS = ['--int-bg-island', '--int-bg-inline', '--int-bg-popup', '--int-bg-dialog', '--int-fg', '--int-fg-muted', '--int-fg-disabled', '--int-icon', '--int-accent', '--int-link', '--int-border-subtle',
  '--int-border-control', '--int-border-popup', '--int-hover-row', '--int-selection-inactive', '--int-progress-track', '--int-info-bg', '--int-info-border', '--int-error-bg', '--int-error-border', '--int-error-fg',
  '--int-warning-fg', '--int-success-fg'];
const SIZE_TOKENS = ['--int-font-ui', '--int-font-mono', '--fs-12', '--fs-13', '--fs-16', '--fs-18', '--lh-16', '--lh-20', '--lh-24', '--int-row-height', '--int-row-pad', '--int-island-radius', '--frame-gutter', '--int-rail-width'];

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Page side. Every function below is serialized into the page: it is self-contained and reads only its argument.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * The helpers the readers share, installed once in each page as window.__plugins: whether an element is laid out, its rectangle, the rectangle of its words, and its paint (the properties asked for, a default value
 * left out; `explicit` reads an outline even when there is none, so that a row's states can say that the engine draws no ring).
 */
function install() {
  const T = (window.__plugins = {});
  const r2 = (v) => Math.round(v * 100) / 100;
  const box = (b) => [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  const four = (a) => (a[0] === a[1] && a[1] === a[2] && a[2] === a[3] ? a[0] : a[0] === a[2] && a[1] === a[3] ? `${a[0]} ${a[1]}` : a.join(' '));
  const OMIT = { 'background-color': 'rgba(0, 0, 0, 0)', opacity: '1', 'box-shadow': 'none', 'text-overflow': 'clip', 'white-space': 'normal' };
  const SIDES = ['top', 'right', 'bottom', 'left'];
  T.shown = (el) => el.getClientRects().length > 0;
  T.rectOf = (el) => box(el.getBoundingClientRect());
  T.inkOf = (node) => { const range = document.createRange(); range.selectNodeContents(node); const b = range.getBoundingClientRect(); return b.width === 0 && b.height === 0 ? null : box(b); };
  T.paintOf = (el, props, pseudo, explicit) => {
    const cs = getComputedStyle(el, pseudo || null);
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
      } else if (prop === 'gap') {
        const row = cs.getPropertyValue('row-gap'), column = cs.getPropertyValue('column-gap');
        if (row === 'normal' && column === 'normal') continue;
        value = row === column ? row : `${row} ${column}`;
      } else if (prop === 'outline') {
        if (cs.getPropertyValue('outline-style') === 'none') { if (explicit) out.outline = 'none'; continue; }
        value = `${cs.getPropertyValue('outline-width')} ${cs.getPropertyValue('outline-style')} ${cs.getPropertyValue('outline-color')}${cs.getPropertyValue('outline-offset') === '0px' ? '' : ` offset ${cs.getPropertyValue('outline-offset')}`}`;
      } else {
        value = cs.getPropertyValue(prop);
        if (OMIT[prop] === value) continue;
        // The engines write a family name with or without quotes.
        if (prop === 'font-family') value = value.replace(/"/g, '');
      }
      out[prop] = value;
    }
    return out;
  };
}

/** Reads every role: rectangles, paint and text. */
function readPage(spec) {
  const { roles, phrases } = spec;
  const { shown, rectOf, inkOf, paintOf } = window.__plugins;

  const neutral = (text) => { let rest = text; for (const phrase of phrases) rest = rest.split(phrase).join(' '); return text !== '' && !/[\p{L}\p{N}]/u.test(rest); };
  const same = (a, b) => a !== null && b !== null && a.every((v, i) => Math.abs(v - b[i]) < 0.6);
  function textInfo(node, el) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (text === '') return null;
    const info = { len: [...text].length };
    // A box that clips its words (they are longer than its room) gives both widths; a box that does not, and an inline box (the engines report 0), give none.
    if (el && getComputedStyle(el).display !== 'inline' && el.scrollWidth !== el.clientWidth) { info.scrollWidth = el.scrollWidth; info.clientWidth = el.clientWidth; }
    const range = document.createRange();
    range.selectNodeContents(node);
    const lines = new Set([...range.getClientRects()].map((b) => Math.round(b.top / 8))).size;
    if (lines > 1) info.lines = lines;
    // The extent of the words, when it is not the box's own (a block wider than its text, a chip around a shorter one).
    if (el && !same(inkOf(node), rectOf(el))) info.ink = inkOf(node);
    if (neutral(text)) info.text = text;
    return info;
  }

  // The elements of every role, as a tree: an element, null, or an array of those (one entry per parent for a role read `within`).
  const found = new Map();
  const pick = (list, which, limit) => {
    const live = [...list].filter(shown);
    if (which === 'all') return live.length ? live.slice(0, limit) : null;
    return live[typeof which === 'number' ? which : 0] ?? null;
  };
  const map = (tree, fn) => (Array.isArray(tree) ? tree.map((entry) => map(entry, fn)) : tree === null ? null : fn(tree));
  const out = { rects: {}, paint: {}, text: {} };
  for (const role of roles) {
    const { key, selector, within, pseudo, text, paint } = role, which = role.which ?? 'first', limit = role.limit ?? 12;
    if (which === 'parts') {
      const el = pick(document.querySelectorAll(selector), 'first', 1);
      const parts = [];
      for (const node of el ? el.childNodes : []) {
        if (node.nodeType === 3 && node.textContent.trim() !== '') parts.push({ rect: inkOf(node), text: textInfo(node, null) });
        else if (node.nodeType === 1 && shown(node) && !node.classList.contains('plug-sep') && !node.classList.contains('visually-hidden')) parts.push({ rect: rectOf(node), text: textInfo(node, node) });
      }
      out.rects[key] = el ? parts.map((part) => part.rect) : null;
      out.text[key] = el ? parts.map((part) => part.text) : null;
      continue;
    }
    const tree = within === undefined
      ? pick(document.querySelectorAll(selector), which, limit)
      : (found.get(within) ?? []).map((parent) => (parent === null ? null : pick(parent.querySelectorAll(selector), which, limit)));
    found.set(key, tree);
    const empty = Array.isArray(tree) && tree.length === 0;
    out.rects[key] = pseudo || empty ? null : map(tree, rectOf);
    if (paint) out.paint[key] = empty ? null : map(tree, (el) => paintOf(el, paint, pseudo));
    if (text) out.text[key] = empty ? null : map(tree, (el) => textInfo(el, el));
  }
  return out;
}

/** What the scene drew, as facts that hold no words but the neutral ones (`facts`), and the mock's own words the checks read (`words`, never written). */
function readFacts(spec) {
  const { world } = spec;
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const known = new Set(world.map((plugin) => plugin.name));
  const neutralName = (text) => (known.has(text) ? text : null);
  const chip = (el) => (el ? { stateKind: el.getAttribute('data-state-kind'), tone: el.getAttribute('data-state-tone'), role: el.getAttribute('data-state-role'), busy: el.classList.contains('resource-state--busy') } : null);
  const button = (el) => (el ? { variant: ['primary', 'danger', 'ghost'].filter((c) => el.classList.contains(c)).join(' ') || 'default', disabled: el.getAttribute('aria-disabled') === 'true', icon: !!el.querySelector('.ic') } : null);
  const rows = qa('.plug-side__scroll .listrow').slice(0, 6);
  const island = q('.frame__island');
  const right = (el) => (el ? el.getBoundingClientRect().right : 0);
  const detail = q('.plug-detail:not(.plug-detail--empty)');
  const lane = q('.plug-lane');
  const notice = q('.plug-lane .notice');
  const content = q('#mainscroll > .content');
  const csContent = content ? getComputedStyle(content) : null;
  const paneWidth = content ? content.clientWidth - parseFloat(csContent.paddingLeft) - parseFloat(csContent.paddingRight) : 0;
  const slot = (name) => (q(`.plug-slot--${name} > .plug-prog`) ? 'progress' : q(`.plug-slot--${name} > button`) ? 'button' : 'empty');
  const tabs = qa('.plug-tabs [role="tab"]');
  const dialog = q('#layer .scrim > .dlg');
  const facts = {
    list: rows.length ? 'rows' : q('.plug-side__scroll .empty2') ? 'empty' : 'none',
    rows: {
      count: rows.length,
      current: rows.findIndex((row) => row.querySelector('.listrow__main[aria-current]:not([aria-current="false"])') !== null),
      names: rows.map((row) => neutralName(norm(row.querySelector('strong')?.textContent))),
      chips: rows.map((row) => chip(row.querySelector('small .resource-state'))),
      switches: rows.map((row) => { const s = row.querySelector('.switch-button'); return s && { on: s.getAttribute('aria-checked') === 'true', disabled: s.getAttribute('aria-disabled') === 'true' || s.disabled === true }; }),
    },
    health: Object.fromEntries(world.map((plugin) => { const h = Shell.plugins.health(plugin.id); return [plugin.id, h.disabled ? `${h.state}+disabled` : h.state]; })),
    detail: detail && {
      plugin: detail.getAttribute('data-plugin'),
      title: neutralName(norm(q('.plug-head h2')?.textContent)),
      chips: qa('.plug-head .identity-header__meta > *').map((el) => (el.classList.contains('resource-state') ? { kind: 'state', ...chip(el) } : { kind: el.classList.contains('mono') ? 'version' : 'trust' })),
      slots: { primary: slot('primary'), secondary: slot('secondary') },
      primary: button(q('.plug-slot--primary > button')),
      secondary: button(q('.plug-slot--secondary > button')),
      lane: lane && {
        kind: lane.classList.contains('plug-lane--quiet') ? 'quiet' : lane.classList.contains('plug-lane--notice') ? 'notice' : 'other',
        tone: notice ? (/notice--(info|success|warning|error)/.exec(notice.className)?.[1] ?? null) : null,
        lines: qa('.plug-lane--quiet > p').length, link: !!q('.plug-lane .linkbtn'), spinner: !!q('.plug-lane .plug-spin'), buttons: qa('.plug-lane .notice__actions > button').length,
      },
      tabs: { count: tabs.length, active: tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true') },
      card: { terms: qa('.plug-card dl.kv > dt').length, buttons: qa('.plug-card .plug-links > button').length },
      overflow: { cluster: right(q('.plug-actions')) > right(island) + 1, slots: right(q('.plug-slot--secondary')) > right(island) + 1, more: right(q('.plug-more')) > right(island) + 1 },
    },
    emptyDetail: !!q('.plug-detail--empty'),
    dialog: dialog && { buttons: qa('.dlg > .ft > button', dialog.parentElement).length, check: !!q('label.check', dialog), checked: q('label.check .selection-command', dialog)?.getAttribute('aria-checked') === 'true', sections: qa('.form-section__head', dialog).length, focusInside: dialog.contains(document.activeElement) },
    container: content && { width: r2(paneWidth), laneMinHeight: lane ? getComputedStyle(lane).minHeight : null, overviewColumns: q('.plug-overview') ? getComputedStyle(q('.plug-overview')).gridTemplateColumns.split(' ').length : null, narrow760: paneWidth <= 760, narrow720: paneWidth <= 720 },
    held: window.__held ?? 0,
  };
  function r2(v) { return Math.round(v * 100) / 100; }
  const words = {
    chips: qa('.plug-head .identity-header__meta .resource-state__label').map((el) => norm(el.textContent)),
    rowChips: rows.map((row) => norm(row.querySelector('small .resource-state__label')?.textContent) || null),
    primary: norm(q('.plug-slot--primary')?.textContent), secondary: norm(q('.plug-slot--secondary')?.textContent), lane: norm(lane?.textContent),
    noticeButtons: qa('.plug-lane .notice__actions > button').map((el) => norm(el.textContent)),
    dialogTitle: norm(q('#layer .dlg h2')?.textContent), dialogButtons: qa('#layer .dlg > .ft > button').map((el) => norm(el.textContent)), listEmpty: norm(q('.plug-side__scroll .empty2')?.textContent), detailEmpty: norm(q('.plug-detail--empty')?.textContent),
    systemRecords: (() => { try { return Shell.ops.list({ view: 'all' }).filter((r) => r.initiator === 'system').length; } catch { return -1; } })(),
  };
  return { facts, words };
}

/** The theme the page is in and the tokens its paint rests on. */
function readTheme(spec) {
  const html = document.documentElement;
  const probe = document.createElement('span');
  document.body.append(probe);
  const resolve = (name) => { probe.style.color = ''; probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
  const tokens = {};
  for (const name of spec.colors) tokens[name] = resolve(name);
  for (const name of spec.sizes) tokens[name] = getComputedStyle(html).getPropertyValue(name).trim();
  probe.remove();
  return { attribute: html.getAttribute('data-theme'), colorScheme: getComputedStyle(html).colorScheme, prefersDark: matchMedia('(prefers-color-scheme: dark)').matches, textScale: html.getAttribute('data-text-scale'), density: html.getAttribute('data-density'), tokens };
}

/** Pauses every animation that never ends (the spinners, the indeterminate bar) at its first frame, so a rectangle does not depend on when it is read. */
function freeze() {
  for (const animation of document.getAnimations()) {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && timing.iterations === Infinity) { animation.pause(); animation.currentTime = 0; }
  }
}

/** The paint of the parts of one list row (by index), with the state the engine says it is in. */
function readRow(spec) {
  const { index, parts, props } = spec;
  const { paintOf } = window.__plugins;
  const row = document.querySelectorAll('.plug-side__scroll .listrow')[index];
  const main = row?.querySelector('.listrow__main');
  if (!row || !main) return null;
  const paint = {};
  for (const [name, selector, pseudo] of parts) {
    const el = selector === '' ? row : row.querySelector(selector);
    paint[name] = el ? paintOf(el, props, pseudo, true) : null;
  }
  return {
    matches: { rowHover: row.matches(':hover'), mainHover: main.matches(':hover'), focus: document.activeElement === main, focusVisible: main.matches(':focus-visible'), current: main.getAttribute('aria-current') ?? null },
    paint,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Node side.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** The paint of every part is stored once: `paints` holds each distinct paint, and a role or a state names it by id. */
const paints = {};
const paintIds = new Map();
function intern(paint) {
  if (paint === null || paint === undefined) return null;
  if (Array.isArray(paint)) return paint.map(intern);
  const text = JSON.stringify(paint);
  if (!paintIds.has(text)) { const id = `p${paintIds.size}`; paintIds.set(text, id); paints[id] = paint; }
  return paintIds.get(text);
}

const PHRASES = [...new Set([...WORLD.flatMap(({ name, version, publisher, category, license, summary }) => [name, version, publisher, category, license, summary]), CAUSE])].sort((a, b) => b.length - a.length);
const READY = () => !!(window.Shell && Shell.pluginManager && Shell.pluginData && Shell.health && Shell.feedback && Shell.ops && document.querySelector('.topbar'));

/** A fresh page, the world in place, the page open and still. */
async function open(browser, viewport, sceneName) {
  const scene = SCENES[sceneName];
  const world = scene.world ?? WORLD;
  const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(READY, null, { timeout: 30000 });
  await page.evaluate(install);
  // At once: a failure the mock's feedback layer meets within 3 s of its start is a state the page was opened on (a notice that names the cause), later it is an event (a recovery operation that retries).
  await page.evaluate(worldScript(world, scene.select));
  await page.waitForSelector(sceneName === 'empty' ? '.plug-detail--empty' : '.plug-detail:not(.plug-detail--empty)', { timeout: 15000 });
  await sleep(2500);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  if (scene.then) { await page.evaluate(scene.then); await sleep(1200); }
  await page.mouse.move(1, 1);
  await page.evaluate(freeze);
  await sleep(150);
  return page;
}

/** What each scene must have drawn: the problems found in what the page drew (an empty list: it drew what it says). */
function check(sceneName, { facts, words }) {
  const problems = [];
  const need = (condition, what) => { if (!condition) problems.push(what); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const scene = SCENES[sceneName];
  if (sceneName === 'empty') {
    need(facts.list === 'empty' && facts.rows.count === 0, `the list is ${facts.list} with ${facts.rows.count} rows`);
    need(facts.emptyDetail && facts.detail === null, 'the detail is not the empty one');
    need(/No plugins installed/.test(words.listEmpty), 'the empty list does not say that no plugin is installed');
    need(/Select a plugin/.test(words.detailEmpty), 'the empty detail does not say to select a plugin');
    return problems;
  }
  need(facts.list === 'rows' && facts.rows.count === LISTED.length, `${facts.rows.count} rows, not ${LISTED.length}`);
  need(same(facts.rows.names, LISTED.map((plugin) => plugin.name)), `the rows are ${JSON.stringify(facts.rows.names)}`);
  need(facts.rows.current === LISTED.findIndex((plugin) => plugin.id === scene.select), `the current row is ${facts.rows.current}`);
  need(facts.detail !== null && facts.detail.plugin === scene.select, `the detail is of ${facts.detail?.plugin}`);
  need(facts.detail?.title === nameOf(scene.select), `the detail's title is ${facts.detail?.title}`);
  need(facts.detail?.tabs.count === 5 && facts.detail?.tabs.active === 0, `the tabs are ${JSON.stringify(facts.detail?.tabs)} (the world's records are adopted as marketplace plugins: 5 tabs, the first selected)`);
  need(facts.detail?.card.terms === 8, `the details card has ${facts.detail?.card.terms} rows`);
  // What the notes of the file say of the page container: neither viewport is a narrow pane (the container queries of 760 and 720 px do not apply).
  need(facts.container !== null && !facts.container.narrow760 && !facts.container.narrow720 && facts.container.laneMinHeight === '80px' && facts.container.overviewColumns === 2, `the page container is ${JSON.stringify(facts.container)}`);
  const health = Object.fromEntries(WORLD.map((plugin) => [plugin.id, { running: 'running', failed: 'failed', starting: 'starting', disabled: 'stopped+disabled' }[plugin.state]]));
  if (sceneName === 'busy') health[SELECTED] = 'stopped';
  need(same(facts.health, health), `the plugins' health is ${JSON.stringify(facts.health)}`);
  need(facts.rows.switches.every((entry) => entry !== null), 'a row has no switch');
  const lane = facts.detail?.lane, chips = words.chips;
  switch (sceneName) {
    case 'running':
      need(chips.length === 1 && chips[0] === 'Running', `the state chip says ${JSON.stringify(chips)}`);
      need(facts.detail?.slots.primary === 'empty' && facts.detail?.slots.secondary === 'button', `the slots are ${JSON.stringify(facts.detail?.slots)}`);
      need(lane?.kind === 'quiet' && lane.lines === 2 && lane.link, `the lane is ${JSON.stringify(lane)}`);
      break;
    case 'failed':
      need(/^Failed/.test(chips[0] ?? ''), `the state chip says ${JSON.stringify(chips)}`);
      need(facts.detail?.chips.find((c) => c.kind === 'state')?.tone === 'error', 'the state chip is not an error');
      need(words.primary === 'Retry' && facts.detail?.primary?.variant === 'primary', `the primary action says ${JSON.stringify(words.primary)}`);
      need(facts.detail?.slots.secondary === 'button', 'the secondary slot is empty');
      need(lane?.kind === 'notice' && lane.tone === 'error' && !lane.spinner && lane.buttons >= 1, `the lane is ${JSON.stringify(lane)} (an error notice that names the cause: the failure is a state, not a retry in progress)`);
      need(words.lane.includes(CAUSE.replace(/\.$/, '')), 'the lane does not give the cause');
      need(words.systemRecords === 0, `${words.systemRecords} recovery records: the failure began after the mock's settle window`);
      break;
    case 'disabled':
      need(chips.length === 1 && chips[0] === 'Disabled', `the state chip says ${JSON.stringify(chips)}`);
      need(words.primary === 'Enable', `the primary action says ${JSON.stringify(words.primary)}`);
      need(lane?.kind === 'notice' && lane.tone === 'info', `the lane is ${JSON.stringify(lane)}`);
      need(words.lane.includes('is disabled'), 'the lane does not say that the plugin is disabled');
      need(facts.rows.switches[LISTED.findIndex((plugin) => plugin.id === scene.select)]?.on === false, 'the switch of the disabled plugin is on');
      break;
    case 'starting':
      need(/^Starting/.test(chips[0] ?? '') && facts.detail?.chips.find((c) => c.kind === 'state')?.busy === true, `the state chip says ${JSON.stringify(chips)}`);
      need(facts.detail?.primary?.disabled === true && /^Starting/.test(words.primary), `the primary action says ${JSON.stringify(words.primary)}`);
      need(lane?.kind === 'quiet' && lane.lines === 2 && /^Starting/.test(words.lane), `the lane is ${JSON.stringify(lane)}`);
      break;
    case 'uninstall':
      need(facts.dialog !== null && facts.dialog.buttons === 2 && facts.dialog.check && facts.dialog.sections === 3, `the dialog is ${JSON.stringify(facts.dialog)}`);
      need(words.dialogTitle.includes('Uninstall') && words.dialogTitle.includes(nameOf(scene.select)), 'the dialog does not ask to uninstall the plugin');
      need(words.dialogButtons.join('|') === 'Cancel|Uninstall', `the dialog's buttons are ${JSON.stringify(words.dialogButtons)}`);
      break;
    case 'busy':
      need(facts.detail?.slots.primary === 'progress', `the primary slot is ${facts.detail?.slots.primary}, not the progress`);
      need(facts.detail?.chips.find((c) => c.kind === 'state')?.busy === true && /^Stopping/.test(chips[0] ?? ''), `the state chip says ${JSON.stringify(chips)}`);
      need(facts.held > 0, 'no timer of the operation was held');
      break;
    default:
      break;
  }
  return problems;
}

/** The roles a scene must draw that are null. */
const missing = (sceneName, rects) => (REQUIRED[sceneName] ?? []).filter((key) => rects[key] === null || rects[key] === undefined || (Array.isArray(rects[key]) && rects[key].length === 0));

/**
 * A scene read once: rectangles, paint and text of the roles, the facts, and what was wrong. The notes of the file state two things about the geometry that hold for every scene, so they are checked here: the sidebar is
 * 340 px wide, and the page container's content box is the window less 379 px (two 5 px window gutters, the 340 px sidebar, its 5 px gutter and the page's 12 px padding on both sides).
 */
async function readScene(page, sceneName, viewport) {
  const { rects, paint, text } = await page.evaluate(readPage, { roles: ROLES.map(({ key, selector, which, within, limit, pseudo, text: wantsText, paint: props }) => ({ key, selector, which, within, limit, pseudo, text: wantsText, paint: props })), phrases: PHRASES });
  const read = await page.evaluate(readFacts, { world: WORLD.map(({ id, name }) => ({ id, name })) });
  const problems = [...check(sceneName, read), ...missing(sceneName, rects).map((key) => `the role ${key} is not drawn`)];
  if (rects.sidebar?.[2] !== 340) problems.push(`the sidebar is ${rects.sidebar?.[2]} px wide, not 340`);
  if (read.facts.container?.width !== viewport.width - 379) problems.push(`the page container is ${read.facts.container?.width} px wide, not ${viewport.width - 379}`);
  const painted = Object.fromEntries(Object.entries(paint).map(([key, value]) => [key, intern(value)]));
  return { scene: { rects, paint: painted, text, facts: read.facts }, problems, theme: await page.evaluate(readTheme, { colors: COLOR_TOKENS, sizes: SIZE_TOKENS }) };
}

// The five states of a list row, read with the real pointer and the real keyboard.
const ROW_PARTS = [['row', ''], ['main', '.listrow__main'], ['tile', '.listrow__lead'], ['avatar', '.avatar'], ['glyph', '.avatar__icon'], ['name', 'strong'], ['version', '.plug-ver'], ['line2', 'small'], ['aside', '.listrow__aside'], ['switch', '.switch-button'],
  ['switchMark', '.sw'], ['switchKnob', '.sw', '::after']];
const ROW_PROPS = [...BOTH, 'cursor'];
const HEALTHY = LISTED.findIndex((plugin) => plugin.state === 'running' && plugin.id !== SELECTED);
const CURRENT = LISTED.findIndex((plugin) => plugin.id === SELECTED);

async function readRowStates(page) {
  const row = (index) => page.locator('.plug-side__scroll .listrow').nth(index);
  const away = async () => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.mouse.move(1, 1);
    await sleep(250);
  };
  const hover = async (index) => {
    const box = await row(index).locator('.listrow__main').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    await sleep(300);
  };
  // The keyboard's way in: Tab until the list's tab stop has the focus, then the arrow key to the row (the list is a roving group); a programmatic focus after a key press only when Tab never arrives.
  const focus = async (index) => {
    let via = 'tab';
    const inList = () => page.evaluate(() => document.activeElement?.closest('.plug-side__scroll') !== null && document.activeElement?.closest('.plug-side__scroll') !== undefined);
    for (let presses = 0; presses < 40 && !(await inList()); presses++) await page.keyboard.press('Tab');
    if (await inList()) {
      for (let moves = 0; moves < 8; moves++) {
        const at = await page.evaluate(() => [...document.querySelectorAll('.plug-side__scroll .listrow')].findIndex((r) => r.contains(document.activeElement)));
        if (at === index) break;
        await page.keyboard.press(at < index ? 'ArrowDown' : 'ArrowUp');
      }
    }
    const at = await page.evaluate(() => [...document.querySelectorAll('.plug-side__scroll .listrow')].findIndex((r) => r.contains(document.activeElement)));
    if (at !== index) {
      via = 'programmatic';
      await page.keyboard.press('Shift');
      await row(index).locator('.listrow__main').evaluate((el) => el.focus());
    }
    await sleep(300);
    return via;
  };
  const states = {};
  const problems = [];
  const target = { healthy: LISTED[HEALTHY]?.id, current: LISTED[CURRENT]?.id };
  const take = async (name, index, expect, extra = {}) => {
    const reading = await page.evaluate(readRow, { index, parts: ROW_PARTS, props: ROW_PROPS });
    if (reading === null) { problems.push(`${name}: the row is not drawn`); return; }
    for (const [what, want] of Object.entries(expect)) if (reading.matches[what] !== want) problems.push(`${name}: ${what} is ${reading.matches[what]}, not ${want}`);
    states[name] = { matches: reading.matches, ...extra, paint: Object.fromEntries(Object.entries(reading.paint).map(([part, value]) => [part, intern(value)])) };
  };
  await away();
  await take('rest', HEALTHY, { rowHover: false, mainHover: false, focus: false, focusVisible: false, current: null });
  await hover(HEALTHY);
  await take('hover', HEALTHY, { rowHover: true, mainHover: true, focus: false, current: null });
  await away();
  const via = await focus(HEALTHY);
  await page.mouse.move(1, 1);
  await sleep(250);
  await take('focus', HEALTHY, { mainHover: false, focus: true, focusVisible: true, current: null }, { via });
  await away();
  await take('current', CURRENT, { rowHover: false, mainHover: false, focus: false, current: 'page' });
  await hover(CURRENT);
  await take('currentHover', CURRENT, { rowHover: true, mainHover: true, focus: false, current: 'page' });
  await away();
  return { states: { target, states }, problems };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const data = {};
const theme = {};
let failed = false;
try {
  for (const engineName of engineNames) {
    const browser = await launch(engineName);
    try {
      data[engineName] = {};
      for (const viewportName of viewportNames) {
        data[engineName][viewportName] = {};
        for (const sceneName of sceneNames) {
          let result = null, problems = [];
          for (let attempt = 0; attempt < 2; attempt++) {
            let page = null;
            try {
              page = await open(browser, VIEWPORTS[viewportName], sceneName);
              if (sceneName === 'rowStates') {
                const read = await readRowStates(page);
                result = { target: read.states.target, states: read.states.states };
                problems = read.problems;
                for (const state of ['rest', 'hover', 'focus', 'current', 'currentHover']) if (result.states[state] === undefined) problems.push(`the state ${state} is not read`);
              } else {
                const read = await readScene(page, sceneName, VIEWPORTS[viewportName]);
                result = read.scene;
                problems = read.problems;
                theme[engineName] ??= read.theme;
              }
              if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `mock-${sceneName}-${engineName}-${viewportName}.png`) });
            } catch (error) {
              problems = [`threw: ${String(error.message).split('\n')[0]}`];
            }
            await page?.context().close();
            if (problems.length === 0) break;
            console.log('retry', engineName, viewportName, sceneName, problems.join('; '));
          }
          if (problems.length > 0) { console.log('MISSING', engineName, viewportName, sceneName, problems.join('; ')); failed = true; }
          data[engineName][viewportName][sceneName] = result;
          console.log(engineName, viewportName, sceneName, problems.length === 0 ? 'ok' : 'FAILED', `${Math.round((Date.now() - started) / 1000)}s`);
        }
      }
    } finally {
      await browser.close();
    }
  }

  const notes = [
    'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. The mock default context; the UI font normalized (--int-font-ui: Helvetica, Arial, sans-serif; the mono face keeps the mock\'s own JetBrains Mono); en-US and UTC.',
    'The mock draws no rail on this page (`rail` is null): the sidebar starts at the frame\'s left edge. The sidebar is a shell region of the mock\'s default 340 px at both viewports (the user may drag it between 244 and 480 px), so every sidebar rectangle is the same at both except its height; the page island is 1085 px (1440x900) and 925 px (1280x800) wide.',
    '`pane` is the page container (`#mainscroll > .content`, `container: page / inline-size`); the detail is its content box, 1061 px (1440x900) and 901 px (1280x800) wide (`facts.container`). The narrow-pane rules do not apply at either viewport: `@container page (max-width: 760px)` (the action cluster on its own line under the name, the lane 120 px tall) and `@container page (max-width: 720px)` (the overview in one column) ask the content box, which is the window less 379 px; with the sidebar at its default they apply below a window of 1139 px and 1099 px. The lane is 80 px and the overview has two columns at both.',
    'The action cluster is three slots, 176 px, 176 px and a 28 px button, 8 px apart (396 px), at the detail\'s right edge. Chromium lays it out so. WebKit does not: it sizes `.identity-header__actions` and `.plug-actions` from the buttons inside the slots (130 to 307 px, by the labels the state shows) and does not count the slots\' `flex: 0 0 176px` basis (with `width: 176px` or `min-width: 176px` on a slot the cluster is 396 px in WebKit too), so the slots keep their 176 px and run out of the cluster to the right, past the island\'s edge: the secondary button is cut off and the options button cannot be seen (`facts.detail.overflow`), and the title gets the room the cluster did not take. These are the boxes the engine laid out; every other rectangle of every scene is the same in the two engines to 0.7 px.',
    'The records of the world are drawn as marketplace plugins (`market: true`) of a package the mock\'s catalog does not know: the facts line reads `by <publisher> · Unknown · <category> · 0 downloads` (the licence is not a member of a world record, so it reads Unknown and not the licence of world.mjs; no rating, no repository link), the lane says `Installed <date> from marketplace · unsigned.` and `<n> permissions granted.` with a link, the tabs bar has Overview, Versions, Changelog, Permissions and Status, and the details card has eight rows and two buttons. The header\'s chips are the version (mono), the trust chip (Community: neither official nor verified; the origin of a marketplace plugin is not a chip, only Built-in, Local file and Dev-linked are) and the state chip, which is drawn for a plugin that runs too (the list row draws a chip only for a state other than running).',
    'Every list row\'s second line is clipped by its column (`text.rowClip2`: scrollWidth over clientWidth, 232 px): the state chip leads it and `publisher · summary` follows with an ellipsis; the first line (name, version) is never clipped. No other text of the page is clipped by its own box (the WebKit cluster above is cut by the island).',
    'A spinner (the starting and stopping chips, the Starting button) and the indeterminate bar of the progress are paused at their first frame before the read (`document.getAnimations()`), so a rotated glyph reads as its 16 px box and the sweeping fill (`progFill`) sits one fill width left of its track.',
    'The failed plugin: its service signal is written with `Shell.plugins.report`, with its first automatic retry an hour away (the mock\'s own clock would retry after 2 s, and the plugin would not stay Failed). The signal is written within the 3 s settle window of the mock\'s feedback layer, so the failure is a state the page was opened on: an error notice that names the cause, with Open logs (no Details: the signal has no raw error), the header\'s primary action Retry. Written later it is an event: the lane then shows the recovery operation (an info notice with a spinner and Details).',
    'busy: `window.setTimeout` of the page is replaced so that a timer of 500 ms or more never fires; the Disable of the first healthy plugin (`Shell.run(\'host.plugin.disable\')`) stays in its first step (Stopping), indeterminate: the progress (a label and a 4 px bar) takes the primary slot, the secondary slot is empty (a Disable cannot be cancelled), the row\'s switch is aria-disabled and its chip says Stopping. The box is stable: two runs give the same rectangles.',
    'The text of an element is recorded only when it is the neutral words of world.mjs; the mock\'s own words (state words, button labels, the lane\'s sentences) are checked in the page and never written. `ink` is the extent of the laid-out words and is left out when it is the element\'s own box.',
  ];
  const note = `Measured from the design lab mock, tree ${MOCK_TREE}, on ${new Date().toISOString().slice(0, 10)}: the Plugins page with the six neutral plugins of world.mjs installed in the mock's world; the mock default context (no text scale, default density, the dark theme), the UI font normalized, UTC, en-US, a fresh page per scene. The two viewports differ only in size: the sidebar is 340 px at both (its scroll area is 674 / 574 px tall and its footer stands at y 830 / 730), the island is 1085 / 925 px wide and 823 / 723 px tall, the detail 1061 / 901 px wide (the readme column 737 / 577 px beside the 300 px details card), the dialog is centred in the window. The narrow-pane container queries (760 and 720 px) apply to neither viewport (see notes).`;
  const setup = {
    world: worldScript(WORLD, '<selected>'),
    uninstall: DIALOG,
    busy: `${HOLD}${DISABLE('<selected>')}`,
    empty: 'the same script with an empty world and selected: \'\'',
    selected: Object.fromEntries(Object.entries(SCENES).map(([name, scene]) => [name, scene.select])),
    rowStates: 'a list row read at rest, under the pointer (page.mouse.move), with the keyboard focus (Tab into the list, ArrowDown to the row) and the current row at rest and under the pointer',
  };
  const words = { world: WORLD, cause: CAUSE, selected: SELECTED, installedAt: INSTALLED_AT, icon: ICON, caps: CAPS, retryAfterSeconds: RETRY_AFTER };
  const roles = ROLES.map(({ key, selector, which, within, limit, pseudo, text, paint }) => ({ key, selector, ...(which ? { which } : {}), ...(within ? { within } : {}), ...(limit ? { limit } : {}), ...(pseudo ? { pseudo } : {}), ...(text ? { text } : {}), ...(paint ? { paint: GROUPS.get(paint) } : {}) }));
  const out = { mockTree: MOCK_TREE, identity, viewports: VIEWPORTS, uptime: { start: uptimeAtStart, run: uptimeAtRun, end: uptime() }, note, notes, words, setup, theme, roles, paints, data };
  // One line for each scene, and one for each other section, so that a change to one scene is a change to one line.
  const serialize = (value, depth) => (depth === 0 || value === null || typeof value !== 'object' || Array.isArray(value)
    ? JSON.stringify(value)
    : `{\n${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}:${serialize(entry, depth - 1)}`).join(',\n')}\n}`);
  const DEPTH = { data: 3, paints: 1 };
  const body = Object.entries(out).map(([key, value]) => `${JSON.stringify(key)}:${serialize(value, DEPTH[key] ?? 0)}`).join(',\n');
  // The reference is written into the repo only by a complete measurement in which every scene drew what it says; anything else goes to the temp directory, for diagnosis.
  const file = failed || partial ? path.join(tmpdir(), 'mock-plugins.partial.json') : path.join(here, 'mock-plugins.json');
  writeFileSync(file, `{\n${body}\n}\n`);
  console.log('wrote', file, statSync(file).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
  if (failed) { console.log('FAILED: a scene does not draw what it says: mock-plugins.json is unchanged'); process.exitCode = 1; }
  else if (partial) console.log('narrowed run (ENGINES/VIEWPORTS/SCENES): mock-plugins.json is unchanged');
} finally {
  server?.kill();
}

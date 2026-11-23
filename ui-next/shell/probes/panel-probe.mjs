// Probes the shell's bottom panel against the design mock's, in WebKit and Chromium at 1440 x 900 and 1280 x 800 (decision A15).
// The panel is read on the fixture (fixture.tsx `?case=panel`: the real `Shell` and the real panel model over invented tools; `window.__panel` is the model a probe drives) and, for a tool that
// a plugin registers after the window is up, on the host fixture (host-fixture.tsx `?panel=1`: the product's own `PluginHost`). The mock's reference is mock-panel.json, made by
// mock-panel-measure.mjs from the mock's own panel (the host's five tools, no plugin screen open).
//
//   node ui-next/shell/probes/panel-probe.mjs        builds the fixtures (OMNIVIEW_UI=next) into temp dirs, serves them, probes them
//
//   FIXTURE_DIST=<dir> FIXTURE_DIST_DEV=<dir>   probe existing builds (production, and development for the commit counts)     FONT_DELAY_MS=40   as a runner serves fonts
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800   (defaults: both of each)      AXE=<axe.min.js>      REPORT=<file>   the full report as JSON      SHOTS=<dir>   a few screenshots
//   NEGATIVE_CONTROL=<name>   perturb ONE measured value in the page (panel-height, session-gap, toggle, tab-padding, shift, root-write, held-hidden, held-done-hidden, held-moved, held-enabled; see PERTURBATIONS), run the section
//                             that must see it, and exit 0 when it did and 1 when it did not (Chromium at 1440 x 900 unless ENGINES and VIEWPORTS say otherwise)
//
// What it checks, per engine and viewport:
//   geometry   the hidden panel, the open one with no session, with three sessions, with one session in each state, and with fourteen (the strip scrolls): the rectangle of the window, the top row,
//              the frame, the splitter, the region, its header and body, the status bar and its toggle, every tool tab and the separator, the session strip, every session tab and each part of it
//              (glyph, name, head, tail, scope, close control), the trailing action, the tab stops and the scroll state, against the mock within 1 px
//   shift      what opening the panel moves: the top row, the tab strip, the scope lane, the status bar and the toggle not at all, the frame (rail, sidebar, island) only in its height, by the region's
//              height, as the mock's regions move; what a drag by the pointer moves: the same, by the drag's distance; and that closing puts everything back
//   paint      the fill, edge, outline, colour, radius and cursor of the tool tabs, the session tabs, the close control, the `+`, Hide, the splitter (and its line) and the status bar's toggle, at rest,
//              hovered and focused, exactly
//   card       the session card on hover and on the keyboard's focus against the mock's (place, size, rows, words), the card of 40 facts clamped to the room, inside the window and scrolling, Escape
//   facts      the roles, names, states and tab stops the mock's markup asserts, as the shell's markup asserts them; where they differ by design, the report says so
//   keyboard   with real key presses: Tab reaches the status bar's toggle, Enter opens the panel and the focus goes to its tool on screen, the arrows move the focus and select nothing, Home, End,
//              Enter and Space, Tab through the session strip, `+`, Hide and the body's own control and out, Hide, the toggle chord, the splitter's keys (16 and 64 px, the limits, the default),
//              Delete and the close chord
//   a11y       axe-core on the closed panel, the open one with sessions, with none, at its minimum height, with a card open and with the card of a held session open (its plugin is off)
//   drag       what a drag costs: writes to the region's style (one a frame at most), writes at the document root (none), React commits (none while the pointer moves, one on release), and in
//              Chromium the layouts and style recalculations
//   late       a plugin that registers its tool after the window is up: with the panel closed nothing moves and layout shift is 0; with it open nothing outside the strip's own content moves, the tool
//              on screen stays on screen, and the report gives what the strip's content does
//   keep       a session body keeps running while another is on screen and while the panel is hidden, and is not drawn
//   held       (A21) a session of the host's Logs tool that its plugin's unload ended stays: in the strip where it was (no part of its tab moves), ended in its name, on screen, with its body mounted and the lines it
//              counted kept, and counting no more; the session that had ended on its own stays too, as it was (its own state, its tab drawn in the strip and its body mounted); its card prints "The plugin was unloaded.", its resource is
//              no link and its Open button is unavailable for that sentence and opens nothing when it is pressed; when the plugin returns the session is still ended, its card has the link and the button
//              works (it opens the resource); a new press is a twin ("(2)") beside the held session; Delete closes the held tab and unmounts its body. Screenshots: before, after, the card with the plugin off
// Exit code 1 when anything differs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';
import { AXE, NATIVE_VIEWPORTS, SAMPLER, buildFixtures, open, serveFixtures, sleep } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(path.join(here, 'mock-panel.json'), 'utf8'));
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(NATIVE_VIEWPORTS).join(',')).split(',');
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const report = { geometry: {}, shift: {}, paint: {}, card: {}, facts: {}, keyboard: {}, a11y: {}, drag: {}, late: {}, keep: {}, held: {}, twins: {}, notes: [] };
const fail = (where, what) => failures.push(`${where}: ${what}`);

const fixtureUrl = (origin, query = '') => `${origin}/shell/probes/fixture.html?case=panel${query === '' ? '' : `&${query}`}`;
const hostUrl = (origin, query = '') => `${origin}/shell/probes/host-fixture.html?panel=1${query === '' ? '' : `&${query}`}`;

// ---------------------------------------------------------------------------------------------------------------------------
// The shell's side of the mock's reading (mock-panel-measure.mjs, READ): the same names, from the shell's own markup.
const READ = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => {
    if (!el || el.getClientRects().length === 0) return null;
    const b = el.getBoundingClientRect();
    return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  };
  const part = (name, root = document) => root.querySelector(`[data-shell-part="${name}"], [data-shell-region="${name}"]`);
  const all = (name, root = document) => [...root.querySelectorAll(`[data-shell-part="${name}"]`)];
  const scroll = (el) => (el ? { left: r2(el.scrollLeft), width: el.scrollWidth, client: el.clientWidth } : null);
  const window_ = part('window');
  const panel = part('panel');
  const header = part('panelHeader');
  const toggle = part('panelToggle');
  const toolList = part('panelTools');
  const toolTabs = toolList ? [...toolList.querySelectorAll('[role=tab]')] : [];
  const items = all('sessionTab', panel ?? document);
  const sessionList = part('sessionTabs');
  const add = part('sessionAdd');
  const actions = part('panelActions');
  const state = (item) => {
    const value = part('sessionLead', item)?.getAttribute('data-state') ?? null;
    return value === 'ended' ? 'exited' : value === 'starting' ? 'connecting' : value;
  };
  return {
    viewport: [innerWidth, innerHeight],
    gridRows: window_ ? getComputedStyle(window_).gridTemplateRows : null,
    panelState: panel === null || panel.hidden ? 'hidden' : 'normal',
    window: rect(window_),
    topRow: rect(part('topRow')),
    frame: rect(part('frame')),
    handle: rect(part('panelHandle')),
    panel: rect(panel),
    header: rect(header),
    body: rect(part('panelDeck')),
    statusBar: rect(part('statusBar')),
    toggle: rect(toggle),
    toggleSvg: rect(toggle?.querySelector('svg') ?? null),
    toolTabs: {
      list: rect(toolList),
      tabs: toolTabs.map(rect),
      separator: rect(part('panelSeparator')),
      first: toolTabs[0] ? { tab: rect(toolTabs[0]), lead: rect(toolTabs[0].querySelector('svg')), label: rect(toolTabs[0].querySelector('span')) } : null,
    },
    sessions: {
      box: rect(part('panelSessions')),
      list: rect(sessionList),
      add: rect(add),
      addButtons: add ? [...add.querySelectorAll('button')].map(rect) : [],
      selected: items.findIndex((item) => item.querySelector('[role=tab]')?.getAttribute('aria-selected') === 'true'),
      items: items.map((item) => ({
        item: rect(item),
        tab: rect(item.querySelector('[role=tab]')),
        lead: rect(part('sessionLead', item)),
        leadSvg: rect(part('sessionLead', item)?.querySelector('svg') ?? null),
        label: rect(part('sessionLabel', item)),
        head: rect(part('sessionHead', item)),
        tail: rect(part('sessionTail', item)),
        scope: rect(part('sessionScope', item)),
        close: rect(part('sessionClose', item)),
        closeSvg: rect(part('sessionClose', item)?.querySelector('svg') ?? null),
        state: state(item),
        selected: item.querySelector('[role=tab]')?.getAttribute('aria-selected') === 'true',
      })),
    },
    actions: { group: rect(actions), buttons: actions ? [...actions.querySelectorAll('button')].map(rect) : [] },
    stops: { toolTabs: toolTabs.map((tab) => tab.tabIndex), sessionTabs: items.map((item) => item.querySelector('[role=tab]')?.tabIndex ?? null) },
    scroll: { list: scroll(sessionList), tools: scroll(toolList) },
  };
};

/** The difference between two readings of one rectangle, per component. */
const delta = (a, b) => a.map((value, index) => Math.round(Math.abs(value - b[index]) * 100) / 100);

/**
 * The differences between the mock's reading and the shell's, as strings, and the largest in px. What the shell has not built (the mock's maximize and options buttons, its `▾` beside `+`, `expired`) is
 * named where it is left out. `tolerance` is 1 px, as every probe of the shell has it.
 */
function compareReading(mock, shell, where, { tolerance = 1, scenario }) {
  const problems = [];
  let worst = 0;
  const near = (name, a, b, keys = [0, 1, 2, 3]) => {
    if (a === null || a === undefined) return;
    if (b === null || b === undefined) {
      problems.push(`${name}: the shell does not draw it`);
      return;
    }
    for (const k of keys) {
      const d = Math.round(Math.abs(a[k] - b[k]) * 100) / 100;
      worst = Math.max(worst, d);
      if (d > tolerance) problems.push(`${name}[${'xywh'[k]}]: mock ${a[k]} shell ${b[k]} (off by ${d})`);
    }
  };
  for (const name of ['window', 'topRow', 'frame', 'statusBar', 'toggle', 'toggleSvg']) near(name, mock[name], shell[name]);
  if (mock.gridRows !== shell.gridRows) problems.push(`the window's rows: mock ${mock.gridRows} shell ${shell.gridRows}`);
  if (mock.panelState !== shell.panelState) problems.push(`the panel is ${shell.panelState}, the mock's is ${mock.panelState}`);
  if (scenario === 'hidden') {
    // The mock keeps the splitter in the grid of a hidden panel; the shell draws none and the gutter is the grid's own 5 px row, so what is compared is where the frame ends.
    if (shell.handle !== null) problems.push('a hidden panel draws a splitter');
    if (shell.panel !== null) problems.push('a hidden panel has a rectangle');
    if (mock.handle !== null && shell.frame !== null && Math.abs(mock.handle[1] - (shell.frame[1] + shell.frame[3])) > tolerance) problems.push(`the gutter under the frame: mock y ${mock.handle[1]}, the frame ends at ${shell.frame[1] + shell.frame[3]}`);
    for (const problem of problems) fail(`geometry ${where}`, problem);
    return { worst, problems: problems.length };
  }
  for (const name of ['handle', 'panel', 'header', 'body']) near(name, mock[name], shell[name]);
  // The tool tabs: the same five, each at the mock's place and width.
  const mockTools = mock.toolTabs;
  const shellTools = shell.toolTabs;
  near('tool strip', mockTools.list, shellTools.list);
  if (mockTools.tabs.length !== shellTools.tabs.length) problems.push(`tool tabs: mock ${mockTools.tabs.length} shell ${shellTools.tabs.length}`);
  mockTools.tabs.forEach((rectangle, index) => near(`tool tab ${index + 1}`, rectangle, shellTools.tabs[index]));
  near('separator', mockTools.separator, shellTools.separator);
  if (mockTools.first !== null && shellTools.first !== null) {
    near('first tool tab glyph', mockTools.first.lead, shellTools.first.lead);
    near('first tool tab label', mockTools.first.label, shellTools.first.label);
  }
  // The session strip.
  const mockSessions = mock.sessions;
  const shellSessions = shell.sessions;
  near('session box', mockSessions.box, shellSessions.box, [0, 1, 3]);
  if (mockSessions.list !== null) near('session list', mockSessions.list, shellSessions.list, [0, 1, 3]);
  // In the `states` scenario the mock has a fourth session, `expired` (a session of the last run: a restored session is `ended` here), and the strip after it differs; what is compared there is
  // each of the first three tabs.
  const complete = scenario !== 'states';
  // The session strip is as wide as what the header leaves it: the shell has one trailing action where the mock has three and no `▾` after the `+`, so where the strip fills its room it has that much
  // more (the mock's width of those two groups less the shell's), and the `+` after it is that much further.
  const room = mock.actions.group[2] - (shell.actions.group?.[2] ?? 0) + (mockSessions.add === null ? 0 : mockSessions.add[2] - (shellSessions.add?.[2] ?? 0));
  // The `+` is the first button of the mock's add group (the `▾` after it opens a menu of targets, which is not built).
  const plus = mockSessions.addButtons[0];
  if (complete && plus !== undefined) near('+', [plus[0] + (scenario === 'many' ? room : 0), plus[1], plus[2], plus[3]], shellSessions.addButtons[0]);
  if (complete && mock.sessions.selected !== shell.sessions.selected) problems.push(`selected session: mock ${mock.sessions.selected} shell ${shell.sessions.selected}`);
  // The tabs: at the mock's place, in the mock's order. The mock's `expired` tab (a session of the last run) is not built: a restored one is `ended`, and the tabs after it are compared in size only.
  const wanted = mockSessions.items.filter((item) => item.state !== 'expired');
  if (wanted.length > shellSessions.items.length) problems.push(`session tabs: mock ${wanted.length} shell ${shellSessions.items.length}`);
  wanted.slice(0, shellSessions.items.length).forEach((item, index) => {
    const got = shellSessions.items[index];
    const name = `session ${index + 1}`;
    for (const key of ['item', 'tab', 'lead', 'leadSvg', 'label', 'head', 'tail', 'scope', 'close', 'closeSvg']) {
      if (item[key] === null && got[key] !== null) problems.push(`${name} ${key}: the shell draws one, the mock's has none`);
      else near(`${name} ${key}`, item[key], got[key]);
    }
    if (item.state !== got.state && !(item.state === 'exited' && got.state === 'exited')) problems.push(`${name} state: mock ${item.state} shell ${got.state}`);
  });
  // The trailing action: the mock's last button is Hide (the maximize and options buttons before it are not built).
  near('Hide', mock.actions.buttons.at(-1), shell.actions.buttons.at(-1));
  // The tab stops: one per strip, on the same index.
  if (JSON.stringify(mock.stops.toolTabs) !== JSON.stringify(shell.stops.toolTabs)) problems.push(`tool tab stops: mock ${JSON.stringify(mock.stops.toolTabs)} shell ${JSON.stringify(shell.stops.toolTabs)}`);
  if (complete && mock.stops.sessionTabs.length > 0 && JSON.stringify(wanted.map((item) => (item.selected ? 0 : -1))) !== JSON.stringify(shell.stops.sessionTabs.slice(0, wanted.length))) problems.push(`session tab stops: mock ${JSON.stringify(mock.stops.sessionTabs)} shell ${JSON.stringify(shell.stops.sessionTabs)}`);
  // The scroll state of the strips.
  for (const [key, label] of complete ? [['list', 'sessions'], ['tools', 'tools']] : [['tools', 'tools']]) {
    for (const part of ['left', 'width', 'client']) {
      const a = mock.scroll[key]?.[part] === undefined ? undefined : mock.scroll[key][part] + (key === 'list' && part === 'client' && scenario === 'many' ? room : 0);
      const b = shell.scroll[key]?.[part];
      if (a === undefined || b === undefined || b === null) continue;
      const d = Math.abs(a - b);
      worst = Math.max(worst, d);
      if (d > tolerance) problems.push(`scroll ${label}.${part}: mock ${a} shell ${b}`);
    }
  }
  for (const problem of problems) fail(`geometry ${where}`, problem);
  return { worst, problems: problems.length };
}

// ---------------------------------------------------------------------------------------------------------------------------
/** What the probe does to the model, as the mock's measurement does to the mock (mock-panel-measure.mjs, OPEN): sessions named, then settled. */
const OPEN = ({ names, states = [], settle = 600 }) => {
  const store = window.__panel;
  const ids = names.map((title, index) => {
    const result = store.openSession({ tool: 'terminal', plugin: 'host', title, state: states[index] ?? 'running', cause: states[index] === 'failed' ? 'The connection was refused' : undefined });
    return result.id;
  });
  return new Promise((resolve) => {
    setTimeout(() => resolve(ids), settle);
  });
};

const names = (count) => Array.from({ length: count }, (_, i) => `session-${String(i + 1).padStart(2, '0')}`);

/**
 * The sessions of the twins scenarios, in the host's Logs tool of the fixture: one title (`cart-api`) in each scope given, opened by acme in the state given (the mock's measurement opens the same three, ended by Stop:
 * mock-panel-measure.mjs, scenario `twins`).
 */
const TWINS_SETUP = ({ scopes, state = 'running' }) => {
  const store = window.__panel;
  store.syncPlugins([{ id: 'acme', tools: [] }]);
  scopes.forEach((scope, index) => {
    store.openSession({ id: `t${String(index + 1)}`, tool: 'logs', plugin: 'acme', title: 'cart-api', scope, state, ...(state === 'ended' ? { cause: 'The stream closed.' } : {}) });
  });
};

/** Each scenario in a fresh page, with the mock's font; returns the reading. */
async function scenario(browser, viewport, origin, name) {
  const { page, context, errors } = await open(browser, fixtureUrl(origin), viewport);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  await sleep(250);
  if (name !== 'hidden') {
    await page.evaluate((tool) => {
      window.__panel.show({ tool });
    }, name === 'twins' ? 'logs' : 'terminal');
    await sleep(350);
  }
  if (name === 'sessions') await page.evaluate(OPEN, { names: ['zsh', 'bash', 'build-runner-7d8c6f49b-f8q4m'] });
  if (name === 'states') await page.evaluate(OPEN, { names: ['alpha', 'beta', 'gamma'], states: ['running', 'ended', 'failed'] });
  if (name === 'twins') await page.evaluate(TWINS_SETUP, { scopes: ['north-yard', 'south-yard', 'north-yard'], state: 'ended' });
  if (name === 'many') {
    await page.evaluate(OPEN, { names: names(14), settle: 900 });
    // The shell shows the tab that was selected (it scrolls it into view); the mock leaves the strip at its start. The probe puts the strip at its start to read both alike.
    await page.evaluate(() => {
      document.querySelector('[data-shell-part="sessionTabs"]').scrollLeft = 0;
    });
  }
  if (CONTROL !== '' && PERTURBATIONS[CONTROL].css !== undefined) await page.addStyleTag({ content: PERTURBATIONS[CONTROL].css });
  await sleep(300);
  const reading = await page.evaluate(READ);
  return { page, context, errors, reading };
}

async function geometry(browser, engine, viewportName, viewport, origin) {
  for (const name of ['hidden', 'empty', 'sessions', 'states', 'many']) {
    const where = `${engine} ${viewportName} ${name}`;
    const { page, context, errors, reading } = await scenario(browser, viewport, origin, name);
    const mock = reference.data[engine][viewportName][name];
    const result = compareReading(mock, reading, where, { scenario: name });
    report.geometry[where] = { worst: result.worst, problems: result.problems, scroll: reading.scroll };
    for (const error of errors) fail(`errors ${where}`, error);
    if (SHOTS && name === 'sessions') await page.screenshot({ path: path.join(SHOTS, `panel-${engine}-${viewportName}.png`) });
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The scope of a session tab (P1b-3d, TI1; the mock's `labelParts`, shell-panel.js:207-221): drawn ONLY when two open sessions of the tool share a title and have another scope. Two readings.
//   twins        against the mock: three sessions of one title (`cart-api`, scopes north-yard, south-yard, north-yard), all ended, the Logs tool on screen: every tab and every part of it (the scope among them, and the
//                third's ordinal, which the mock draws in the tail) within 1 px of the mock's, and the words each part says (mock-panel-measure.mjs, scenario `twins`: ui-next/shell/probes/mock-panel.json)
//   twin-rules   the rule on the shell's own markup, in one window: a session alone draws no scope, and its name is its title; a second of another scope makes both draw theirs, with the name and the scope kept
//                apart in the DOM by a space the layout does not draw; a third of the first scope is told by its ordinal; the names of the tabs are never alike; and when the twins close the tab that is left draws none

/** What a tab draws, as a tool reads it: the name it carries, the text the DOM holds (parts joined as the DOM joins them) and the words of its scope part, `null` when it has none. */
const TABS = () =>
  [...document.querySelectorAll('[data-shell-part="sessionTab"]')].map((item) => {
    const tab = item.querySelector('[role=tab]');
    const scope = item.querySelector('[data-shell-part="sessionScope"]');
    return { id: item.getAttribute('data-tab-id'), name: tab?.getAttribute('aria-label') ?? null, text: tab?.textContent ?? null, scope: scope === null ? null : scope.textContent };
  });

/** The words each part of a tab says, for the tabs' text to be compared with the mock's (the mock's `texts`). */
const TAB_WORDS = () =>
  [...document.querySelectorAll('[data-shell-part="sessionTab"]')].map((item) => {
    const words = (name) => item.querySelector(`[data-shell-part="${name}"]`)?.textContent ?? null;
    return { head: words('sessionHead'), tail: words('sessionTail'), scope: words('sessionScope') };
  });

/** Each tab of the shell against the mock's, part by part, within 1 px. Returns the largest difference. */
function compareTabs(mockItems, shellItems, where, tolerance = 1) {
  let worst = 0;
  if (shellItems.length !== mockItems.length) fail(`twins ${where}`, `${shellItems.length} tabs, the mock draws ${mockItems.length}`);
  mockItems.forEach((item, index) => {
    const got = shellItems[index];
    if (got === undefined) return;
    const name = `session ${String(index + 1)}`;
    for (const key of ['item', 'tab', 'lead', 'leadSvg', 'label', 'head', 'tail', 'scope', 'close', 'closeSvg']) {
      const a = item[key];
      const b = got[key];
      if (a === null && b !== null) fail(`twins ${where}`, `${name} ${key}: the shell draws one, the mock's has none`);
      else if (a !== null && b === null) fail(`twins ${where}`, `${name} ${key}: the shell does not draw it`);
      else if (a !== null) {
        for (const k of [0, 1, 2, 3]) {
          const d = Math.round(Math.abs(a[k] - b[k]) * 100) / 100;
          worst = Math.max(worst, d);
          if (d > tolerance) fail(`twins ${where}`, `${name} ${key}[${'xywh'[k]}]: mock ${a[k]} shell ${b[k]} (off by ${d})`);
        }
      }
    }

    if (item.state !== got.state) fail(`twins ${where}`, `${name} state: mock ${item.state} shell ${got.state}`);
    if (item.selected !== got.selected) fail(`twins ${where}`, `${name} selected: mock ${String(item.selected)} shell ${String(got.selected)}`);
  });
  return worst;
}

async function twins(browser, engine, viewportName, viewport, origin) {
  const where = `${engine} ${viewportName}`;
  const { page, context, errors, reading } = await scenario(browser, viewport, origin, 'twins');
  const mock = reference.data[engine][viewportName].twins;
  if (mock === undefined) fail(`twins ${where}`, 'the pinned reference has no `twins` scenario (mock-panel-measure.mjs, SCENARIO=twins)');
  else {
    const worst = compareTabs(mock.sessions.items, reading.sessions.items, where);
    const words = await page.evaluate(TAB_WORDS);
    mock.sessions.items.forEach((item, index) => {
      for (const part of ['head', 'tail', 'scope']) {
        const said = item.texts?.[part] ?? null;
        if (said !== ((words[index]?.[part] ?? null)?.trim() ?? null)) fail(`twins ${where}`, `session ${String(index + 1)} ${part} says ${JSON.stringify(words[index]?.[part] ?? null)}, the mock's says ${JSON.stringify(said)}`);
      }
    });
    report.twins[where] = { worst, tabs: reading.sessions.items.map((item) => item.item), words };
  }
  if (SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, `twins-${engine}-${viewportName}.png`) });
  for (const error of errors) fail(`errors twins ${where}`, error);
  await context.close();
}

async function twinRules(browser, engine, viewportName, viewport, origin) {
  const where = `twin-rules ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, fixtureUrl(origin), viewport);
  await sleep(250);
  await page.evaluate(() => {
    window.__panel.syncPlugins([{ id: 'acme', tools: [] }]);
    window.__panel.show({ tool: 'logs' });
  });
  const add = (id, scope) =>
    page.evaluate(({ id, scope }) => {
      window.__panel.openSession({ id, tool: 'logs', plugin: 'acme', title: 'cart-api', scope, state: 'running' });
    }, { id, scope });
  const read = async () => {
    await sleep(300);
    return page.evaluate(TABS);
  };
  const same = (label, got, wanted) => {
    if (JSON.stringify(got) !== JSON.stringify(wanted)) fail(where, `${label}: ${JSON.stringify(got)}, wanted ${JSON.stringify(wanted)}`);
  };
  const unique = (label, tabs) => {
    const names = tabs.map((tab) => tab.name);
    if (new Set(names).size !== names.length) fail(where, `${label}: two tabs are named alike: ${JSON.stringify(names)}`);
  };
  const names = (tabs) => tabs.map((tab) => tab.name);
  // The tab a scope check is about must be there, and be the one: a page that drew no tab, or another, fails in words of its own and never with the scope failure a control waits for (CodeRabbit, #609: a control that
  // fakes a scope part has nothing to put it into when no tab was drawn, and was taken for detected).
  const only = (label, tabs, id) => {
    if (tabs.length === 1 && tabs[0]?.id === id) return true;
    fail(where, `${label}: the strip holds ${JSON.stringify(tabs.map((tab) => tab.id))}, wanted the one tab ${id}`);
    return false;
  };
  // The control's perturbation: a scope part the shell did not draw, put into the tab the page has.
  const fakeScope = () => page.evaluate(() => document.querySelector('[data-shell-part="sessionLabel"]')?.insertAdjacentHTML('beforeend', '<span data-shell-part="sessionScope">north-yard</span>'));

  await add('t1', 'north-yard');
  if (CONTROL === 'twin-lone-scope') await fakeScope();
  let tabs = await read();
  if (only('a session with no twin', tabs, 't1') && tabs[0].scope !== null) fail(where, `a session with no twin draws a scope: ${JSON.stringify(tabs)}`);
  same('the name of a session with no twin: its title, not its scope', names(tabs), ['cart-api']);
  if (SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, `twins-one-${engine}-${viewportName}.png`) });

  await add('t2', 'south-yard');
  tabs = await read();
  same('the scope each tab of two twins draws', tabs.map((tab) => tab.scope), ['north-yard', 'south-yard']);
  same('the names of two twins', names(tabs), ['cart-api · north-yard', 'cart-api · south-yard']);
  same('the text each of two twins draws: the name and the scope kept apart by a space the layout does not draw', tabs.map((tab) => tab.text), ['cart-api north-yard', 'cart-api south-yard']);
  unique('two twins', tabs);

  await add('t3', 'north-yard');
  tabs = await read();
  same('the names of three: the third is a twin of the first and is told by its ordinal', names(tabs), ['cart-api · north-yard', 'cart-api · south-yard', 'cart-api (2) · north-yard']);
  unique('three', tabs);

  await page.evaluate(() => {
    window.__panel.closeSession('t3');
  });
  tabs = await read();
  same('the names once the third has closed', names(tabs), ['cart-api · north-yard', 'cart-api · south-yard']);
  await page.evaluate(() => {
    window.__panel.closeSession('t2');
  });
  if (CONTROL === 'twin-scope-kept') await fakeScope();
  tabs = await read();
  if (only('the tab that is left once its twin has closed', tabs, 't1') && tabs[0].scope !== null) fail(where, `the tab that is left draws a scope once its twin has closed: ${JSON.stringify(tabs)}`);
  same('the name of the tab that is left', names(tabs), ['cart-api']);
  report.twins[where] = { names: names(tabs) };
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// What the window's regions do when the panel opens or is resized (mock-panel-measure.mjs, REGIONS): the same names, from the shell's markup.
const REGIONS = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => {
    if (!el || el.getClientRects().length === 0) return null;
    const b = el.getBoundingClientRect();
    return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  };
  const part = (name) => document.querySelector(`[data-shell-part="${name}"], [data-shell-region="${name}"]`);
  const strip = part('tabStrip');
  return {
    topbar: rect(part('topRow')),
    tabstrip: rect(strip),
    scroller: rect(strip?.firstElementChild ?? null),
    rail: rect(part('rail')),
    sidebar: rect(part('sidebar')),
    lane: rect(part('lane')),
    island: rect(part('island')),
    mainscroll: rect(part('page')),
    statusbar: rect(part('statusBar')),
    toggle: rect(part('panelToggle')),
    panel: rect(part('panel')),
    handle: rect(part('panelHandle')),
    header: rect(part('panelHeader')),
  };
};

/** The regions that do not move at all when the panel opens or is resized, and the ones that lose the panel's height and nothing else (the frame: rail, sidebar, island and its page). */
const STILL = ['topbar', 'tabstrip', 'scroller', 'lane', 'statusbar', 'toggle'];
const SHRINKS = ['rail', 'sidebar', 'island', 'mainscroll'];

/** What a change did to the regions: the ones that must not move, and the ones that lose `by` px of height (a negative `by`: gain it). Returns the largest stray distance. */
function movedBy(before, after, by, where, label) {
  let worst = 0;
  for (const region of STILL) {
    if (before[region] === null || after[region] === null) continue;
    const d = Math.max(...delta(before[region], after[region]));
    worst = Math.max(worst, d);
    if (d > 0) fail(`shift ${where}`, `${label}: ${region} moved by ${d} px (${JSON.stringify(before[region])} to ${JSON.stringify(after[region])}), it must not move`);
  }

  for (const region of SHRINKS) {
    const a = before[region];
    const b = after[region];
    const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3] - by));
    worst = Math.max(worst, d);
    if (d > 0.01) fail(`shift ${where}`, `${label}: ${region} went from ${JSON.stringify(a)} to ${JSON.stringify(b)}, it may only lose ${by} px of height`);
  }

  return worst;
}

/** Drags the splitter by `dy` px with the real pointer: down on the handle, `steps` moves, up. Positive `dy` moves the pointer down, which shrinks the panel. */
async function drag(page, dy, steps = 12) {
  const box = await page.locator('[data-shell-part="panelHandle"]').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps });
  await page.mouse.up();
  await sleep(250);
}

async function shift(browser, engine, viewportName, viewport, origin) {
  const where = `${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, fixtureUrl(origin), viewport);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  await sleep(250);
  const before = await page.evaluate(REGIONS);
  await page.evaluate(() => {
    window.__panel.show({ tool: 'terminal' });
  });
  await sleep(350);
  if (CONTROL === 'shift') await page.addStyleTag({ content: '[data-shell-region="sidebar"] { position: relative; top: 3px; }' });
  const after = await page.evaluate(REGIONS);
  // Against the mock: where each region is before and after (the mock's own measurement of the same).
  const mock = reference.shift[engine][viewportName];
  let worst = 0;
  for (const [region, entry] of Object.entries(mock)) {
    for (const [label, a, b] of [['before', entry.before, before[region]], ['after', entry.after, after[region]]]) {
      // The mock's tab strip holds the new-tab control (240 wide); the shell's strip is the scroller (208): its place and height are what is compared.
      const d = a === null || b === null ? 999 : Math.max(...(region === 'tabstrip' ? [0, 1, 3] : [0, 1, 2, 3]).map((k) => delta(a, b)[k]));
      worst = Math.max(worst, d);
      if (d > 1) fail(`shift ${where}`, `${region} ${label}: mock ${JSON.stringify(a)} shell ${JSON.stringify(b)}`);
    }
  }

  // Opening: the panel's height comes out of the frame's, and nothing above it, beside it or below it moves.
  const height = after.panel[3];
  const opened = movedBy(before, after, height, where, 'opening');
  // The splitter sits on the frame's bottom edge and the panel starts 5 px under it: the region is where the mock puts it.
  const gutter = Math.abs(after.island[1] + after.island[3] + 5 - after.panel[1]);
  if (gutter > 0.01) fail(`shift ${where}`, `the panel is not 5 px under the island: ${JSON.stringify(after.island)} then ${JSON.stringify(after.panel)}`);
  // Resizing with the pointer: up 80 px grows the panel by 80 and takes 80 px from the frame, nothing else moves; then down 50.
  await drag(page, -80);
  const grown = await page.evaluate(REGIONS);
  const up = movedBy(after, grown, 80, where, 'a drag of 80 px up');
  if (Math.abs(grown.panel[3] - height - 80) > 0.5) fail(`shift ${where}`, `a drag of 80 px up made the panel ${grown.panel[3]} px high, from ${height} (wanted +80)`);
  await drag(page, 50);
  const shrunk = await page.evaluate(REGIONS);
  const down = movedBy(grown, shrunk, -50, where, 'a drag of 50 px down');
  if (Math.abs(shrunk.panel[3] - grown.panel[3] + 50) > 0.5) fail(`shift ${where}`, `a drag of 50 px down made the panel ${shrunk.panel[3]} px high, from ${grown.panel[3]} (wanted -50)`);
  // Closing puts everything back.
  await page.evaluate(() => {
    window.__panel.hide();
  });
  await sleep(300);
  const closed = await page.evaluate(REGIONS);
  const back = movedBy(shrunk, closed, -shrunk.panel[3], where, 'closing');
  for (const region of [...STILL, ...SHRINKS]) {
    const d = Math.max(...delta(before[region], closed[region]));
    if (d > 0.01) fail(`shift ${where}`, `after closing, ${region} is ${JSON.stringify(closed[region])}, it was ${JSON.stringify(before[region])}`);
  }
  void back;
  report.shift[where] = { opened, panelHeight: height, drag: { up, down }, worstAgainstMock: worst };
  for (const error of errors) fail(`errors shift ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The paint of a part in its states, read as the mock's reading is (mock-panel-measure.mjs, PAINT).
const PAINT = (el) => {
  const cs = getComputedStyle(el);
  const edge = parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : (cs.boxShadow.match(/rgba?\([^)]*\)/)?.[0] ?? '');
  const line = el.matches('[data-shell-part="panelHandle"]') ? getComputedStyle(el, '::after') : null;
  return {
    backgroundColor: cs.backgroundColor,
    boxShadow: cs.boxShadow,
    border: { width: cs.borderTopWidth, style: cs.borderTopStyle, color: cs.borderTopColor },
    edge,
    outline: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset },
    color: cs.color,
    borderRadius: cs.borderTopLeftRadius,
    opacity: cs.opacity,
    cursor: cs.cursor,
    ...(line === null ? {} : { after: { backgroundColor: line.backgroundColor, blockSize: line.height } }),
  };
};

const PARTS = {
  toolTabSelected: { sel: '[data-shell-part="panelTools"] [role=tab][aria-selected="true"]', focus: null },
  toolTabOther: { sel: '[data-shell-part="panelTools"] [role=tab][aria-selected="false"]', focus: null },
  sessionSelected: { sel: '[data-shell-part="sessionTab"][data-selected]', focus: '[role=tab]', session: true },
  sessionOther: { sel: '[data-shell-part="sessionTab"]:not([data-selected])', focus: '[role=tab]', session: true },
  sessionClose: { sel: '[data-shell-part="sessionTab"][data-selected] [data-shell-part="sessionClose"]', focus: null },
  addButton: { sel: '[data-shell-part="sessionAdd"] button', focus: null },
  hideButton: { sel: '[data-shell-part="panelHide"]', focus: null },
  handle: { sel: '[data-shell-part="panelHandle"]', focus: null },
  toggleOn: { sel: '[data-shell-part="panelToggle"]', focus: null },
};

async function readParts(page, names_) {
  const out = {};
  for (const name of names_) {
    const part = PARTS[name] ?? { sel: '[data-shell-part="panelToggle"]', focus: null };
    const handle = await page.$(part.sel);
    if (handle === null) {
      out[name] = null;
      continue;
    }

    out[name] = {};
    for (const state of ['rest', 'hover', 'focus']) {
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.mouse.move(1, 1);
      if (state === 'hover') {
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
      } else if (state === 'focus') {
        // A key press first, so the engines treat the focus as the keyboard's (focus-visible).
        await page.keyboard.press('Shift');
        await handle.evaluate((el, sel) => (sel === null ? el : el.querySelector(sel)).focus(), part.focus);
      }

      await sleep(250);
      out[name][state] = await handle.evaluate(
        (el, [paint, focusSel, session]) => {
          const read = new Function(`return (${paint})`)();
          const target = focusSel === null ? el : el.querySelector(focusSel);
          const entry = { matches: { hover: el.matches(':hover'), focus: target.matches(':focus'), focusVisible: target.matches(':focus-visible') }, ...read(el) };
          if (session) {
            entry.button = read(target);
            const cs = getComputedStyle(el.querySelector('[data-shell-part="sessionHead"]'));
            entry.title = { color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight };
          }

          return entry;
        },
        [PAINT.toString(), part.focus, part.session === true],
      );
    }
  }

  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(1, 1);
  return out;
}

/** What a recorded difference is in the paint of a part: the shell's markup is not the mock's in these members, and each says why. Nothing else is excused. */
const PAINT_KNOWN = [
  // The mock's close control has a transparent 1 px border (the same box) and is a button the keyboard can focus; the shell's has no border and is the pointer's (the keyboard closes with Delete), so the ring a script focus draws is the browser's.
  { name: 'sessionClose', test: /^paint\.(border|edge|outline)/ },
];

async function paint(browser, engine, viewportName, viewport, origin) {
  const where = `${engine} ${viewportName}`;
  const mine = {};
  // The sessions page: every part but the toggle of a hidden panel.
  {
    const { page, context } = await scenario(browser, viewport, origin, 'sessions');
    Object.assign(mine, await readParts(page, Object.keys(PARTS)));
    await context.close();
  }
  // The toggle of a hidden panel.
  {
    const { page, context } = await scenario(browser, viewport, origin, 'hidden');
    Object.assign(mine, await readParts(page, ['toggleOff']));
    await context.close();
  }

  report.paint[where] = mine;
  const mock = reference.states[engine][viewportName];
  for (const [name, byState] of Object.entries(mine)) {
    if (byState === null) {
      fail(`paint ${where}`, `${name}: the shell does not draw it`);
      continue;
    }

    for (const [state, entry] of Object.entries(byState)) {
      const wanted = mock[name]?.[state];
      if (wanted === undefined || wanted === null) continue;
      const label = `paint ${where} ${name} ${state}`;
      if (state === 'hover' && !entry.matches.hover) fail(label, 'not really hovered');
      if (state === 'focus' && !(entry.matches.focus && entry.matches.focusVisible)) fail(label, 'not really focus-visible');
      const same = (a, b, at) => {
        for (const [key, value] of Object.entries(a)) {
          if (key === 'matches') continue;
          if (typeof value === 'object' && value !== null) same(value, b?.[key] ?? {}, `${at}.${key}`);
          // An outline or a border that is not drawn has no width or colour that matters: it is the style that says it is not there.
          else if ((key === 'width' || key === 'color') && (at.endsWith('outline') || at.endsWith('border')) && a.style === 'none') continue;
          // The shell keeps the arrow cursor on its buttons, as its tab strip and rail do (the mock's are `pointer`); the splitter's `row-resize` is what is compared.
          else if (key === 'cursor' && name !== 'handle') continue;
          else if (b?.[key] !== value && !PAINT_KNOWN.some((known) => known.name === name && known.test.test(`${at}.${key}`))) fail(label, `${at}.${key}: mock ${value} shell ${b?.[key]}`);
        }
      };
      same(wanted, entry, 'paint');
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The session card (SCD1): the surface the kit's hover card draws, around the content the shell gives it, at the places the mock has it.
const CARD = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => {
    if (!el || el.getClientRects().length === 0) return null;
    const b = el.getBoundingClientRect();
    return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  };
  const card = document.querySelector('[popover]:popover-open');
  const content = card?.querySelector('[data-shell-part="sessionCard"]') ?? null;
  if (card === null || content === null) return null;
  const actions = [...content.children].find((child) => child.querySelector(':scope > button')) ?? null;
  return {
    placement: card.getAttribute('data-placement'),
    clamped: card.getAttribute('data-ov-clamped'),
    card: rect(card),
    head: rect(content.firstElementChild),
    headSvg: rect(content.firstElementChild?.querySelector('svg') ?? null),
    facts: rect(content.querySelector('[data-ov-part="key-value"]')),
    rows: [...content.querySelectorAll('[data-ov-part="row"]')].map(rect),
    labels: [...content.querySelectorAll('[data-ov-part="label"]')].map(rect),
    values: [...content.querySelectorAll('[data-ov-part="value"]')].map(rect),
    actions: rect(actions),
    buttons: actions === null ? [] : [...actions.querySelectorAll('button')].map(rect),
    texts: [...content.querySelectorAll('[data-ov-part="label"], [data-ov-part="value"]')].map((el) => el.textContent.trim().replace(/\s+since \d\d:\d\d/, ' since HH:MM')),
    // Where the card is against the window: it is never partly outside it.
    inside: card.getBoundingClientRect().left >= 0 && card.getBoundingClientRect().top >= 0 && card.getBoundingClientRect().right <= innerWidth && card.getBoundingClientRect().bottom <= innerHeight,
  };
};

/**
 * The card on hover of the first session and on the keyboard's focus of the third, against the mock's, and a card with more to say than the window has room for: it is clamped to the room, stays inside
 * the window and scrolls. The shell has no key hint on a card the keyboard opened (the mock's third line: "Down Arrow: reach its actions, Esc: close"), so the keyboard card's height is the mock's less that line.
 */
async function card(browser, engine, viewportName, viewport, origin) {
  const where = `${engine} ${viewportName}`;
  const { page, context, errors } = await scenario(browser, viewport, origin, 'sessions');
  const tabs = '[data-shell-part="sessionTab"] [role=tab]';
  const mock = reference.data[engine][viewportName].card;
  const compare = (kind, got, wanted, { height }) => {
    if (got === null) {
      fail(`card ${where} ${kind}`, 'no card opened');
      return;
    }

    const near = (name, a, b, keys = [0, 1, 2, 3]) => {
      if (a === null || b === null) return fail(`card ${where} ${kind}`, `${name}: mock ${JSON.stringify(a)} shell ${JSON.stringify(b)}`);
      for (const k of keys) {
        const d = Math.round(Math.abs(a[k] - b[k]) * 100) / 100;
        if (d > 1) fail(`card ${where} ${kind}`, `${name}[${'xywh'[k]}]: mock ${a[k]} shell ${b[k]} (off by ${d})`);
      }
    };

    if (got.placement !== wanted.placement) fail(`card ${where} ${kind}`, `placement: mock ${wanted.placement} shell ${got.placement}`);
    near('card', wanted.card, got.card, height ? [0, 1, 2, 3] : [0, 1, 2]);
    near('head', wanted.head, got.head);
    near('head glyph', wanted.headSvg, got.headSvg);
    near('facts', wanted.facts, got.facts);
    wanted.rows.forEach((row, index) => near(`row ${index + 1}`, row, got.rows[index] ?? null));
    wanted.labels.forEach((rectangle, index) => near(`label ${index + 1}`, rectangle, got.labels[index] ?? null));
    wanted.values.forEach((rectangle, index) => near(`value ${index + 1}`, rectangle, got.values[index] ?? null, [0, 1, 3]));
    near('actions', wanted.actions, got.actions, [0, 1, 3]);
    // The mock's Stop has a glyph of its own (the kit has none for it yet): the button's place and height are compared, not its width.
    near('Stop', wanted.buttons[0], got.buttons[0] ?? null, [0, 1, 3]);
    if (JSON.stringify(wanted.texts) !== JSON.stringify(got.texts)) fail(`card ${where} ${kind}`, `words: mock ${JSON.stringify(wanted.texts)} shell ${JSON.stringify(got.texts)}`);
    if (!got.inside) fail(`card ${where} ${kind}`, 'the card is partly outside the window');
  };

  await page.mouse.move(1, 1);
  const first = await page.locator(tabs).first().boundingBox();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2, { steps: 2 });
  await sleep(1000);
  const hover = await page.evaluate(CARD);
  if (SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, `card-${engine}-${viewportName}.png`) });
  compare('hover', hover, mock.hover, { height: true });
  await page.mouse.move(1, 1);
  await sleep(600);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  // The keyboard reaches the tab the way a person does: Shift, then the tab. (A real Tab key is the keyboard section's.)
  await page.keyboard.press('Shift');
  await page.evaluate((selector) => document.querySelectorAll(selector)[2].focus(), tabs);
  await sleep(1000);
  const focus = await page.evaluate(CARD);
  compare('focus', focus, mock.focus, { height: false });
  if (focus !== null && mock.focus.card[3] - focus.card[3] < 10) fail(`card ${where} focus`, `the mock's keyboard card has a key hint line the shell's has not, and the shell's is ${focus.card[3]} px against the mock's ${mock.focus.card[3]}: the difference is gone, so is this note`);
  report.card[where] = { hover, focus };
  // Escape closes it.
  await page.keyboard.press('Escape');
  await sleep(300);
  if ((await page.evaluate(CARD)) !== null) fail(`card ${where}`, 'Escape did not close the card');

  // A card with more to say than the window has room for: 40 facts, on a panel at its largest.
  await page.evaluate(() => {
    const store = window.__panel;
    store.resize({ size: 600 });
    store.openSession({ tool: 'terminal', plugin: 'host', title: 'tall', state: 'running' });
  });
  await sleep(500);
  await page.mouse.move(1, 1);
  const tall = await page.locator(tabs).last().boundingBox();
  await page.mouse.move(tall.x + tall.width / 2, tall.y + tall.height / 2, { steps: 2 });
  await sleep(1000);
  const clamped = await page.evaluate(CARD);
  if (clamped === null) fail(`card ${where} clamped`, 'no card opened');
  else {
    report.card[`${where} clamped`] = { clamped: clamped.clamped, rect: clamped.card, inside: clamped.inside };
    if (clamped.clamped !== 'true') fail(`card ${where} clamped`, `a card of 40 facts is not clamped (${JSON.stringify(clamped.card)})`);
    if (!clamped.inside) fail(`card ${where} clamped`, `the clamped card is partly outside the window: ${JSON.stringify(clamped.card)} in ${viewport.width} x ${viewport.height}`);
    // It scrolls: the wheel over it moves the facts, and the card itself does not move.
    const before = await page.evaluate(() => {
      const body = document.querySelector('[popover]:popover-open [data-shell-part="sessionCard"]')?.parentElement;
      return { top: body?.scrollTop ?? -1, room: body ? body.scrollHeight - body.clientHeight : -1 };
    });
    await page.mouse.move(clamped.card[0] + 40, clamped.card[1] + 100);
    await page.mouse.wheel(0, 200);
    await sleep(300);
    const after = await page.evaluate(() => {
      const open = document.querySelector('[popover]:popover-open');
      const body = open?.querySelector('[data-shell-part="sessionCard"]')?.parentElement;
      return { top: body?.scrollTop ?? -1, box: open === null || open === undefined ? null : [open.getBoundingClientRect().x, open.getBoundingClientRect().y] };
    });
    if (!(before.room > 0 && after.top > before.top)) fail(`card ${where} clamped`, `the clamped card does not scroll: ${JSON.stringify({ before, after })}`);
    if (after.box === null || after.box[0] !== clamped.card[0] || after.box[1] !== clamped.card[1]) fail(`card ${where} clamped`, `the card moved while it scrolled: ${JSON.stringify(after.box)}`);
    if (SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, `card-clamped-${engine}-${viewportName}.png`) });
  }

  for (const error of errors) fail(`errors card ${where}`, error);
  await context.close();
}
// ---------------------------------------------------------------------------------------------------------------------------
// What the mock's markup asserts (mock-panel-measure.mjs, FACTS), as the shell's markup asserts it.
const FACTS = () => {
  const attrs = (el, names) => (el ? Object.fromEntries(names.map((n) => [n, el.getAttribute(n)])) : null);
  const part = (name, root = document) => root.querySelector(`[data-shell-part="${name}"], [data-shell-region="${name}"]`);
  const panel = part('panel');
  const deck = part('panelDeck');
  const toggle = part('panelToggle');
  const handle = part('panelHandle');
  const tools = part('panelTools');
  const sessions = part('sessionTabs');
  const add = part('sessionAdd');
  const actions = part('panelActions');
  const toolTabs = tools ? [...tools.querySelectorAll('[role=tab]')] : [];
  const items = sessions ? [...sessions.querySelectorAll('[data-shell-part="sessionTab"]')] : [];
  const labelledBy = deck?.getAttribute('aria-labelledby');
  return {
    toggle: toggle ? { ...attrs(toggle, ['aria-pressed', 'aria-label', 'role']), tabindex: String(toggle.tabIndex), tag: toggle.tagName.toLowerCase(), text: toggle.textContent.trim() } : null,
    handle: handle ? { ...attrs(handle, ['role', 'aria-orientation', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'tabindex', 'aria-label']), tag: handle.tagName.toLowerCase(), controlsPanel: handle.getAttribute('aria-controls') === panel?.id } : null,
    panel: panel ? { role: panel.getAttribute('role') ?? (panel.tagName === 'SECTION' && panel.hasAttribute('aria-label') ? 'region' : null), 'aria-label': panel.getAttribute('aria-label') } : null,
    toolTablist: attrs(tools, ['role', 'aria-label']),
    sessionTablist: attrs(sessions, ['role', 'aria-label']),
    add: add ? [...add.querySelectorAll('button')].map((button) => ({ ...attrs(button, ['aria-label']), tabindex: String(button.tabIndex) })) : null,
    actions: actions ? [...actions.querySelectorAll('button')].map((button) => attrs(button, ['aria-label', 'tabindex'])) : null,
    toolTabs: toolTabs.map((tab) => ({ ...attrs(tab, ['role', 'aria-selected', 'tabindex']), controlsDeck: tab.getAttribute('aria-controls') === deck?.id, text: tab.textContent.trim() })),
    sessionTabs: items.map((item) => {
      const tab = item.querySelector('[role=tab]');
      const close = item.querySelector('[data-shell-part="sessionClose"]');
      return { ...attrs(tab, ['role', 'aria-selected', 'tabindex', 'aria-label']), controlsDeck: tab.getAttribute('aria-controls') === deck?.id, close: attrs(close, ['aria-hidden', 'tabindex']) };
    }),
    body: deck ? { role: deck.getAttribute('role'), labelledBy: labelledBy === null || labelledBy === undefined ? null : (document.getElementById(labelledBy)?.getAttribute('role') ?? null) } : null,
  };
};

/** Where the shell's markup is not the mock's, and why: each is listed in the report, none is excused silently. */
const FACTS_KNOWN = [
  'a closed panel draws no splitter (the mock keeps one, with aria-valuenow 0)',
  'the panel header is not a group of its own: it would repeat the name of the region it sits in',
  'the `+` is not in a group and there is no `▾` beside it (the targets menu is not built)',
  'the trailing actions are a group "Panel actions" (the kit\'s roving group), not a toolbar, and have only Hide (maximize and options are not built), so Hide is the stop',
  'a session tab is named by the words it draws (its title, an ordinal, and its scope only when it tells twins apart) and by its state when it is not running ("stream-beta, ended"); the mock adds the target\'s detail and says "running" too',
  'the panel is labelled by the session on screen, by the tool when it has none; the mock labels it by the tool',
  'the close control of a session is hidden from the accessibility tree, as the document tab\'s is: the keyboard closes a session with Delete (the mock names it "Terminate session: ...")',
];

async function facts(browser, engine, viewport, origin) {
  const where = `${engine} 1440x900`;
  const mock = reference.facts[engine] ?? reference.facts;
  const closed = await scenario(browser, viewport, origin, 'hidden');
  const hidden = await closed.page.evaluate(FACTS);
  await closed.context.close();
  const open_ = await scenario(browser, viewport, origin, 'sessions');
  const got = await open_.page.evaluate(FACTS);
  await open_.context.close();
  report.facts[where] = { hidden, open: got };
  const same = (label, a, b) => {
    for (const [key, value] of Object.entries(a ?? {})) if (b?.[key] !== value) fail(`facts ${where}`, `${label}.${key}: mock ${JSON.stringify(value)} shell ${JSON.stringify(b?.[key])}`);
  };
  same('toggle (closed)', mock.toggle.closed, hidden.toggle);
  same('toggle (open)', mock.toggle.open, got.toggle);
  const { 'aria-controls': _controls, ...handle } = mock.handle.open;
  same('splitter', handle, got.handle);
  if (got.handle?.controlsPanel !== true) fail(`facts ${where}`, 'the splitter does not control the panel region');
  same('panel', { role: mock.panel.role, 'aria-label': mock.panel['aria-label'] }, got.panel);
  same('tool tablist', mock.toolTablist, got.toolTablist);
  same('session tablist', mock.sessionTablist.sessions, got.sessionTablist);
  same('`+`', { 'aria-label': mock.addGroup.buttons[0]['aria-label'], tabindex: mock.addGroup.buttons[0].tabindex }, got.add?.[0]);
  same('Hide', { 'aria-label': mock.actions.buttons[1]['aria-label'] }, got.actions?.[0]);
  if (got.actions?.length !== 1) fail(`facts ${where}`, `${String(got.actions?.length)} trailing actions, wanted Hide alone`);
  if (got.toolTabs.length !== mock.toolTabs.length) fail(`facts ${where}`, `${got.toolTabs.length} tool tabs, the mock has ${mock.toolTabs.length}`);
  mock.toolTabs.forEach((tab, index) => {
    same(`tool tab ${index + 1}`, { role: tab.role, 'aria-selected': tab['aria-selected'], tabindex: tab.tabindex, text: tab.text }, got.toolTabs[index]);
    if (got.toolTabs[index]?.controlsDeck !== true) fail(`facts ${where}`, `tool tab ${index + 1} does not control the panel's body`);
  });
  if (got.sessionTabs.length !== mock.sessionTabs.length) fail(`facts ${where}`, `${got.sessionTabs.length} session tabs, the mock has ${mock.sessionTabs.length}`);
  mock.sessionTabs.forEach((tab, index) => {
    same(`session tab ${index + 1}`, { role: tab.role, 'aria-selected': tab['aria-selected'], tabindex: tab.tabindex }, got.sessionTabs[index]);
    if (got.sessionTabs[index]?.controlsDeck !== true) fail(`facts ${where}`, `session tab ${index + 1} does not control the panel's body`);
    if (got.sessionTabs[index]?.close?.['aria-hidden'] !== 'true' || got.sessionTabs[index]?.close?.tabindex !== '-1') fail(`facts ${where}`, `the close control of session tab ${index + 1} is a stop or is announced`);
  });
  same('body', { role: mock.body.role }, got.body);
  if (got.body?.labelledBy !== 'tab') fail(`facts ${where}`, `the body is labelled by ${String(got.body?.labelledBy)}, wanted a tab`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The keyboard, with real key presses.
const TAB_KEY = process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
const SHIFT_TAB_KEY = process.platform === 'darwin' ? 'Alt+Shift+Tab' : 'Shift+Tab';
const CLOSE_SESSION = process.platform === 'darwin' ? 'Meta+KeyW' : 'Control+Shift+KeyW';
const TOGGLE = process.platform === 'darwin' ? 'Meta+KeyJ' : 'Control+KeyJ';

/** Which control has the focus, by the names the markup gives. */
const FOCUS = () => {
  const el = document.activeElement;
  const part = el?.closest('[data-shell-part], [data-shell-region]');
  return {
    part: part?.getAttribute('data-shell-part') ?? part?.getAttribute('data-shell-region') ?? (el === document.body ? 'body' : null),
    role: el?.getAttribute('role') ?? null,
    label: el?.getAttribute('aria-label') ?? el?.textContent?.trim().slice(0, 24) ?? null,
    selected: el?.getAttribute('aria-selected') ?? null,
    visible: el?.matches?.(':focus-visible') ?? null,
    fixture: el?.getAttribute('data-fixture') ?? null,
  };
};

async function keyboard(browser, engine, viewportName, viewport, origin) {
  const where = `keyboard ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, fixtureUrl(origin), viewport);
  await page.evaluate(() => {
    for (const title of ['zsh', 'bash', 'fish']) window.__panel.openSession({ tool: 'terminal', plugin: 'host', title, state: 'running' }, { reveal: false });
  });
  await sleep(300);
  const log = {};
  const check = (name, ok, got) => {
    log[name] = got;
    if (!ok) fail(where, `${name}: ${JSON.stringify(got)}`);
  };
  const focus = () => page.evaluate(FOCUS);
  const state = () =>
    page.evaluate(() => ({
      open: !document.querySelector('[data-shell-region="panel"]').hidden,
      pressed: document.querySelector('[data-shell-part="panelToggle"]').getAttribute('aria-pressed'),
      tool: document.querySelector('[data-shell-part="panelTools"] [role=tab][aria-selected="true"]')?.textContent.trim() ?? null,
      sessions: [...document.querySelectorAll('[data-shell-part="sessionTab"] [role=tab]')].map((tab) => `${tab.getAttribute('aria-label')}${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}`),
    }));

  // 1. Tab reaches the toggle: a control of the status bar is a stop like any other (decision A14).
  await page.evaluate(() => document.body.focus());
  let presses = 0;
  let at = await focus();
  while (at.part !== 'panelToggle' && presses < 80) {
    await page.keyboard.press(TAB_KEY);
    presses += 1;
    at = await focus();
  }

  check('Tab reaches the status bar\'s toggle', at.part === 'panelToggle' && at.visible === true, { presses, at });
  let s = await state();
  check('the panel is hidden and the toggle is not pressed', !s.open && s.pressed === 'false', s);
  // 2. Enter opens it and the focus goes to the tool on screen: the strip's one stop.
  await page.keyboard.press('Enter');
  await sleep(300);
  at = await focus();
  s = await state();
  check('Enter on the toggle opens the panel and the focus is on its tool on screen', s.open && s.pressed === 'true' && at.part === 'panelTools' && at.role === 'tab' && at.selected === 'true' && at.label === 'Terminal', { s, at });
  // 3. The tool strip: arrows move the focus and select nothing; Enter selects.
  await page.keyboard.press('ArrowRight');
  at = await focus();
  s = await state();
  check('ArrowRight moves the focus to Logs and selects nothing', at.label === 'Logs' && s.tool === 'Terminal', { at, s });
  await page.keyboard.press('End');
  at = await focus();
  check('End focuses the last tool', at.label === 'Operations', at);
  await page.keyboard.press('ArrowRight');
  at = await focus();
  check('ArrowRight from the last wraps to the first', at.label === 'Terminal', at);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await sleep(200);
  s = await state();
  at = await focus();
  check('Enter on Logs selects it: its tool has no session, so no session tab is drawn', s.tool === 'Logs' && s.sessions.length === 0 && at.label === 'Logs', { s, at });
  check('and the body says there are no sessions', await page.getByText('No sessions').isVisible(), null);
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await sleep(200);
  s = await state();
  check('Home and Space select Terminal again', s.tool === 'Terminal' && s.sessions.length === 3, s);
  // 4. Tab goes on: the session strip's stop is the session on screen; the roving keys move the focus and open its card.
  await page.keyboard.press(TAB_KEY);
  at = await focus();
  check('Tab from the tool strip lands on the session on screen', at.part === 'sessionTab' && at.role === 'tab' && at.selected === 'true' && at.label === 'zsh', at);
  await page.keyboard.press('ArrowLeft');
  await sleep(900);
  at = await focus();
  s = await state();
  check('ArrowLeft from the first wraps to the last session and selects nothing', at.label === 'fish' && s.sessions.join() === 'zsh*,bash,fish', { at, s });
  check('the keyboard focus opens the session\'s card', await page.evaluate(() => document.querySelector('[popover]:popover-open [data-shell-part="sessionCard"]') !== null), null);
  await page.keyboard.press('Escape');
  await sleep(300);
  at = await focus();
  check('Escape closes the card and leaves the focus on the tab', at.label === 'fish' && (await page.evaluate(() => document.querySelector('[popover]:popover-open') === null)), at);
  await page.keyboard.press('Enter');
  s = await state();
  check('Enter selects the session', s.sessions.join() === 'zsh,bash,fish*', s);
  // 5. The rest of the panel's stops, in order: `+`, Hide, the body's own control, then out to the status bar.
  const order = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press(TAB_KEY);
    at = await focus();
    order.push(at.fixture ?? at.label);
  }

  check('Tab goes on to `+`, Hide, the body\'s control, and out of the panel to the status bar\'s toggle', order.join() === 'New terminal,Hide panel,body-stop,Panel', order);
  await page.keyboard.press(SHIFT_TAB_KEY);
  await page.keyboard.press(SHIFT_TAB_KEY);
  at = await focus();
  check('Shift+Tab goes back to Hide', at.label === 'Hide panel', at);
  // 6. Hide: Enter on it hides the panel and puts the focus on the page, never on the document.
  await page.keyboard.press('Enter');
  await sleep(300);
  at = await focus();
  s = await state();
  check('Hide hides the panel, unpresses the toggle and the focus goes to the page', !s.open && s.pressed === 'false' && at.part === 'island', { s, at });
  // 7. The chord, from the page and from the panel.
  await page.keyboard.press(TOGGLE);
  await sleep(300);
  s = await state();
  at = await focus();
  check('the toggle chord opens the panel from the page and the focus goes to its tool', s.open && at.part === 'panelTools', { s, at });
  await page.keyboard.press(TOGGLE);
  await sleep(300);
  s = await state();
  at = await focus();
  check('and closes it from inside, with the focus on the page', !s.open && at.part === 'island', { s, at });
  // 8. The splitter's keys, on the handle: arrows 16 px, Shift 64, Page keys 64, Home the minimum, End the maximum, Enter the default.
  await page.keyboard.press(TOGGLE);
  await sleep(300);
  const handle = page.locator('[data-shell-part="panelHandle"]');
  await handle.focus();
  const size = () =>
    page.evaluate(() => ({ now: Number(document.querySelector('[data-shell-part="panelHandle"]').getAttribute('aria-valuenow')), drawn: document.querySelector('[data-shell-region="panel"]').getBoundingClientRect().height, text: document.querySelector('[data-shell-part="panelHandle"]').getAttribute('aria-valuetext') }));
  const first = await size();
  const maximum = viewport.height - 312;
  const steps = [
    ['ArrowUp', first.now + 16],
    ['ArrowDown', first.now],
    ['Shift+ArrowUp', first.now + 64],
    ['PageDown', first.now],
    ['PageUp', first.now + 64],
    ['Shift+ArrowDown', first.now],
    ['Home', 120],
    ['ArrowDown', 120],
    ['End', maximum],
    ['ArrowUp', maximum],
    ['Enter', first.now],
  ];
  for (const [key, wanted] of steps) {
    await page.keyboard.press(key);
    await sleep(120);
    const got = await size();
    check(`splitter ${key}: ${wanted} px`, got.now === wanted && Math.abs(got.drawn - wanted) < 0.5 && got.text === `Panel ${String(wanted)} pixels`, { wanted, got });
  }

  // 9. Delete closes the session in focus and the neighbour takes the focus; the close chord closes the one on screen from inside the panel.
  await page.locator('[data-shell-part="sessionTab"] [role=tab]').nth(1).focus();
  await page.keyboard.press('Delete');
  await sleep(200);
  at = await focus();
  s = await state();
  check('Delete closes the session in focus and the focus goes to its neighbour', s.sessions.length === 2 && at.part === 'sessionTab', { s, at });
  await page.keyboard.press(CLOSE_SESSION);
  await sleep(200);
  s = await state();
  check('the close chord closes the session on screen', s.sessions.length === 1, s);
  report.keyboard[`${engine} ${viewportName}`] = log;
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
async function a11y(browser, engine, viewportName, viewport, origin, axe) {
  const cases = [
    ['closed', async () => undefined],
    [
      'the Logs tool, open, with two sessions of one title in two scopes (each tab draws its scope: P1b-3d, the finding of P1b-3c)',
      async (page) => {
        await page.evaluate(TWINS_SETUP, { scopes: ['north-yard', 'south-yard'] });
        await page.evaluate(() => window.__panel.show({ tool: 'logs' }));
        // The control `scope-name`: the name of each tab leaves out the scope the tab draws, which axe's `label-content-name-mismatch` must see.
        if (CONTROL === 'scope-name') {
          await page.evaluate(() => {
            for (const tab of document.querySelectorAll('[data-shell-part="sessionTab"] [role=tab]')) tab.setAttribute('aria-label', 'cart-api');
          });
        }
      },
    ],
    [
      'open, with three sessions',
      async (page) => {
        await page.evaluate(OPEN, { names: ['zsh', 'bash', 'fish'] });
        await page.evaluate(() => window.__panel.show({ tool: 'terminal' }));
      },
    ],
    [
      'open, with no session',
      async (page) => {
        await page.evaluate(() => window.__panel.show({ tool: 'logs' }));
      },
    ],
    [
      'open at its minimum, no session',
      async (page) => {
        await page.evaluate(() => {
          window.__panel.show({ tool: 'terminal' });
          window.__panel.resize({ size: 120 });
        });
      },
    ],
    [
      'with a card open',
      async (page) => {
        await page.evaluate(OPEN, { names: ['zsh', 'bash', 'fish'] });
        await page.evaluate(() => window.__panel.show({ tool: 'terminal' }));
        await sleep(300);
        const box = await page.locator('[data-shell-part="sessionTab"] [role=tab]').first().boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
        await sleep(1000);
      },
    ],
    [
      'with the card of a held session open, its plugin off (A21)',
      async (page) => {
        // The held session's tab draws no scope (it has no twin), so this case is about the card; the tab that draws a scope has its own case above (P1b-3d fixed the finding of P1b-3c there).
        await page.evaluate(HELD_SETUP);
        await page.evaluate(() => window.__panel.syncPlugins([]));
        await sleep(600);
        const box = await page.locator('[data-shell-part="sessionTab"][data-tab-id="kept"] [role=tab]').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
        // The card of the held session, open: the case is about it, so axe does not run before it is there (an auto-waiting assertion on its sentence, not a delay).
        await page.locator('[popover]:popover-open [data-shell-part="sessionCard"]', { hasText: 'The plugin was unloaded.' }).waitFor({ timeout: 5000 });
      },
    ],
  ];
  for (const [label, prepare] of cases) {
    const { page, context } = await open(browser, fixtureUrl(origin), viewport);
    await prepare(page);
    await sleep(500);
    await page.addScriptTag({ content: axe });
    const result = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, first: v.nodes[0]?.html.slice(0, 140) }))));
    report.a11y[`${engine} ${viewportName} ${label}`] = result;
    for (const violation of result) {
      const text = `${violation.id} (${violation.impact}, ${violation.nodes}): ${violation.first}`;
      if (violation.impact === 'serious' || violation.impact === 'critical') fail(`a11y ${engine} ${viewportName} ${label}`, text);
      else report.notes.push(`a11y ${engine} ${viewportName} ${label}: ${text}`);
    }

    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/** What a drag costs. Installed after the panel is up: the writes to the region's style, to the document root and to the window's attributes, and the frames that ran. */
const WATCH = () => {
  const state = (window.__drag = { regionWrites: 0, rootWrites: 0, windowAttribute: [], frames: 0, running: true });
  const region = document.querySelector('[data-shell-region="panel"]');
  const window_ = document.querySelector('[data-shell-part="window"]');
  new MutationObserver((records) => {
    state.regionWrites += records.filter((record) => record.attributeName === 'style').length;
  }).observe(region, { attributes: true, attributeFilter: ['style'] });
  new MutationObserver((records) => {
    state.rootWrites += records.length;
  }).observe(document.documentElement, { attributes: true, subtree: false });
  new MutationObserver((records) => {
    for (const record of records) if (record.attributeName === 'data-resizing') state.windowAttribute.push(window_.hasAttribute('data-resizing'));
  }).observe(window_, { attributes: true, attributeFilter: ['data-resizing'] });
  const tick = () => {
    state.frames += 1;
    if (state.running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function dragCost(browser, engine, viewportName, viewport, originDev) {
  const where = `drag ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, fixtureUrl(originDev), viewport);
  // Ended sessions: a running stream's body ticks every 100 ms and that is a commit of its own, not the drag's.
  await page.evaluate(OPEN, { names: ['zsh', 'bash', 'fish'], states: ['ended', 'ended', 'ended'], settle: 400 });
  await page.evaluate(() => window.__panel.show({ tool: 'terminal' }));
  await sleep(500);
  if (CONTROL === 'root-write') {
    // A drag that writes a custom property at the root, as the old splitters did: the probe must see it.
    await page.evaluate(() => {
      document.querySelector('[data-shell-part="panelHandle"]').addEventListener('pointermove', () => document.documentElement.style.setProperty('--panel-size', String(Math.random())));
    });
  }

  await page.evaluate(WATCH);
  const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
  const metrics = async () => {
    if (cdp === null) return null;
    const { metrics: list } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(list.map(({ name, value }) => [name, value]));
  };
  if (cdp !== null) await cdp.send('Performance.enable');
  const commits = () => page.evaluate(() => window.__commits.length);
  const box = await page.locator('[data-shell-part="panelHandle"]').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await sleep(300);
  const c0 = await commits();
  const m0 = await metrics();
  await page.mouse.down();
  await sleep(100);
  const steps = 60;
  await page.mouse.move(x, y - 120, { steps });
  await sleep(150);
  const during = await page.evaluate(() => ({ ...window.__drag, windowAttribute: [...window.__drag.windowAttribute] }));
  const c1 = await commits();
  const m1 = await metrics();
  await page.mouse.up();
  await sleep(400);
  const after = await page.evaluate(() => ({ ...window.__drag, windowAttribute: [...window.__drag.windowAttribute] }));
  const c2 = await commits();
  const result = {
    moves: steps,
    frames: during.frames,
    regionWritesWhileDragging: during.regionWrites,
    regionWritesInTotal: after.regionWrites,
    rootWrites: after.rootWrites,
    windowAttribute: after.windowAttribute,
    commitsWhileDragging: c1 - c0,
    commitsOnRelease: c2 - c1,
    layouts: m1 === null || m0 === null ? null : m1.LayoutCount - m0.LayoutCount,
    styleRecalcs: m1 === null || m0 === null ? null : m1.RecalcStyleCount - m0.RecalcStyleCount,
  };
  report.drag[`${engine} ${viewportName}`] = result;
  if (result.regionWritesWhileDragging < 1) fail(where, 'the drag wrote nothing to the region: it did not resize it');
  if (result.regionWritesWhileDragging > during.frames) fail(where, `${result.regionWritesWhileDragging} writes to the region's style in ${during.frames} frames: more than one a frame`);
  if (result.regionWritesInTotal - result.regionWritesWhileDragging > 3) fail(where, `${result.regionWritesInTotal - result.regionWritesWhileDragging} writes to the region's style on release, wanted its size and the inline size given back`);
  if (result.rootWrites !== 0) fail(where, `${result.rootWrites} writes to the document root while the panel was dragged: the root is never written`);
  if (result.windowAttribute.join() !== 'true,false') fail(where, `the window's data-resizing went ${JSON.stringify(result.windowAttribute)}, wanted set once and removed once`);
  if (result.commitsWhileDragging !== 0) fail(where, `${result.commitsWhileDragging} React commits while the pointer moved, wanted 0`);
  if (result.commitsOnRelease > 2) fail(where, `${result.commitsOnRelease} React commits on release, wanted at most 2`);
  if (result.layouts !== null && result.layouts > during.frames + 4) fail(where, `${result.layouts} layouts for ${during.frames} frames while dragging`);
  if (result.styleRecalcs !== null && result.styleRecalcs > during.frames + 4) fail(where, `${result.styleRecalcs} style recalculations for ${during.frames} frames while dragging`);
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// A plugin that registers its tool after the window is up (the host fixture: the second plugin loads `lateMs` after the first).
const PANEL_PARTS = ['panel', 'panelHandle', 'panelHeader', 'panelToggle', 'panelTools', 'panelSeparator', 'panelSessions', 'sessionAdd', 'panelActions'];
const MUST_NOT_MOVE = ['window', 'topRow', 'safeArea', 'frame', 'rail', 'sidebar', 'sidebarHeader', 'island', 'lane', 'page', 'statusBar'];
const SAMPLE = `window.__probeParts = ${JSON.stringify(PANEL_PARTS)}; ${SAMPLER}; window.__probeFrames = 260;`;
const TOOLS = () => [...document.querySelectorAll('[data-shell-part="panelTools"] [role=tab]')].map((tab) => `${tab.textContent.trim()}${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}`);

async function late(browser, engine, viewportName, viewport, origin) {
  const where = `late ${engine} ${viewportName}`;
  // a. The panel stays closed: the second plugin's tool arrives and nothing moves (the regions, the toggle, the panel's own 0 px), layout shift 0.
  {
    const { page, context, errors } = await open(browser, hostUrl(origin, 'plugins=2&lateMs=700'), viewport, { init: SAMPLE });
    await sleep(3300);
    const result = await page.evaluate(() => ({ ...window.__probe, tools: Object.keys(window.__panel.getSnapshot().tools) }));
    report.late[`${where} closed`] = { frames: result.frames, moves: result.moves, layoutShift: result.layoutShift, tools: result.tools };
    if (result.tools.length !== 4) fail(`${where} closed`, `the model has ${JSON.stringify(result.tools)}, wanted the host's Terminal and Logs tools and both plugins' tools`);
    const moved = result.moves.filter((move) => [...MUST_NOT_MOVE, ...PANEL_PARTS].includes(move.part));
    if (moved.length > 0) fail(`${where} closed`, `${moved.length} parts moved while a plugin's tool arrived: ${JSON.stringify(moved.slice(0, 4))}`);
    if (result.layoutShift !== null && result.layoutShift > 0) fail(`${where} closed`, `layout shift ${result.layoutShift} from ${result.shiftSources.join(', ')}`);
    await page.getByRole('button', { name: 'Panel', exact: true }).click();
    await sleep(300);
    const tools = await page.evaluate(TOOLS);
    if (tools.join() !== 'Terminal*,Logs,Alpha streams,Beta streams') fail(`${where} closed`, `the strip draws ${JSON.stringify(tools)} once it is opened, wanted the host's Terminal tool (first, on screen), its Logs tool, Alpha streams and Beta streams`);
    for (const error of errors) fail(`errors ${where} closed`, error);
    await context.close();
  }
  // b. The user opens the panel before the second plugin is there, on the first plugin's tool (the host's Logs tool is first in the strip and would be on screen otherwise): the second plugin's tool joins the
  // strip. Nothing but the strip's own content moves, and the tool that was on screen stays on screen.
  for (const [label, query, wantedTools, wantedFirst] of [
    ['after', 'plugins=2&lateMs=900', 'Terminal,Logs,Alpha streams*,Beta streams', 'Alpha streams'],
    ['before', 'plugins=2&lateMs=900&first=beta', 'Terminal,Logs,Beta streams,Alpha streams*', 'Alpha streams'],
  ]) {
    const { page, context, errors } = await open(browser, hostUrl(origin, query), viewport, { init: SAMPLE });
    // The first plugin's tool is there at about 400 ms; the user opens the panel then, and the second plugin arrives 900 ms later.
    await page.waitForFunction(() => Object.keys(window.__panel.getSnapshot().tools).length === 3, null, { timeout: 5000 });
    await page.evaluate(() => window.__panel.show({ tool: 'alpha:streams' }));
    await sleep(300);
    // The control of the baseline guard below: the probe is made slow, so the late tool is in the strip before the baseline is taken.
    if (CONTROL === 'late-early') await sleep(1500);
    // What the sampler saw up to here is the panel opening and the window loading: only what comes after is the late tool's.
    const openedAt = await page.evaluate(() => window.__probe.frames);
    const firstTool = await page.evaluate(() => {
      const tab = document.querySelector('[data-shell-part="panelTools"] [role=tab][aria-selected="true"]');
      const box = tab.getBoundingClientRect();
      return { label: tab.textContent.trim(), rect: [box.x, box.y, box.width, box.height] };
    });
    const regions0 = await page.evaluate(REGIONS);
    // The baseline is taken while the strip still lacks the late tool, and the probe says so: if the late tool had registered before this point, the wait below would return at once and nothing after the baseline would see its arrival.
    const toolsAtBaseline = await page.evaluate(() => Object.keys(window.__panel.getSnapshot().tools).length);
    if (toolsAtBaseline !== 3) fail(`${where} open, tool arrives ${label}`, `the baseline was taken with ${String(toolsAtBaseline)} tools in the model, wanted 3 (Terminal, Logs and the first plugin's): the late tool had arrived already, so its arrival would not be observed`);
    await page.waitForFunction(() => Object.keys(window.__panel.getSnapshot().tools).length === 4, null, { timeout: 8000 });
    await sleep(600);
    const result = await page.evaluate(() => ({ ...window.__probe }));
    const regions1 = await page.evaluate(REGIONS);
    const tools = await page.evaluate(TOOLS);
    const tab = await page.evaluate((name) => {
      const el = [...document.querySelectorAll('[data-shell-part="panelTools"] [role=tab]')].find((candidate) => candidate.textContent.trim() === name);
      const box = el?.getBoundingClientRect();
      return box === undefined ? null : [box.x, box.y, box.width, box.height];
    }, firstTool.label);
    const stray = result.moves.filter((move) => move.frame > openedAt && [...MUST_NOT_MOVE, 'panel', 'panelHandle', 'panelHeader', 'panelToggle', 'panelActions'].includes(move.part));
    report.late[`${where} open, tool arrives ${label}`] = {
      moves: result.moves.filter((move) => move.frame > openedAt && !stray.includes(move)).map((move) => ({ part: move.part, from: move.from, to: move.to })),
      stray,
      layoutShift: result.layoutShift,
      tools,
      firstToolBefore: firstTool.rect,
      firstToolAfter: tab,
    };
    if (stray.length > 0) fail(`${where} open, tool arrives ${label}`, `${stray.length} parts outside the strip moved: ${JSON.stringify(stray.slice(0, 4))}`);
    for (const region of ['statusbar', 'toggle', 'panel', 'handle', 'header']) {
      if (regions0[region] === null || regions1[region] === null) continue;
      const d = Math.max(...delta(regions0[region], regions1[region]));
      if (d > 0) fail(`${where} open, tool arrives ${label}`, `${region} moved by ${d} px`);
    }

    if (tools.join() !== wantedTools) fail(`${where} open, tool arrives ${label}`, `the strip draws ${JSON.stringify(tools)}, wanted ${wantedTools}: the tool on screen changed, or a tool is missing`);
    if (label === 'after' && (tab === null || Math.max(...delta(firstTool.rect, tab)) > 0)) fail(`${where} open, tool arrives ${label}`, `the tool on screen moved: ${JSON.stringify(firstTool.rect)} then ${JSON.stringify(tab)}`);
    void wantedFirst;
    for (const error of errors) fail(`errors ${where} open, tool arrives ${label}`, error);
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function keep(browser, engine, viewportName, viewport, origin) {
  const where = `keep ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, fixtureUrl(origin), viewport);
  await page.evaluate(OPEN, { names: ['alpha', 'beta'], settle: 200 });
  await page.evaluate(() => window.__panel.show({ tool: 'terminal' }));
  await sleep(300);
  const lines = () => page.evaluate(() => window.__lines());
  // `beta` is on screen (the last opened); `alpha` is mounted, hidden, and runs.
  const a = await lines();
  await sleep(700);
  const b = await lines();
  if (!(b.alpha > a.alpha && b.beta > a.beta)) fail(where, `a hidden session did not keep running: ${JSON.stringify(a)} then ${JSON.stringify(b)}`);
  const slots = await page.evaluate(() => [...document.querySelectorAll('[data-shell-part="panelBody"]')].map((slot) => ({ session: slot.getAttribute('data-session-id') !== null, display: getComputedStyle(slot).display, height: slot.getBoundingClientRect().height })));
  if (slots.length !== 2 || slots.filter((slot) => slot.display === 'none').length !== 1 || slots.some((slot) => slot.display === 'none' && slot.height !== 0)) fail(where, `the bodies: ${JSON.stringify(slots)}, wanted two mounted and one not drawn`);
  // Hiding the panel unmounts nothing: both keep counting, and the region is not drawn.
  await page.evaluate(() => window.__panel.hide());
  await sleep(300);
  const c = await lines();
  await sleep(700);
  const d = await lines();
  const hidden = await page.evaluate(() => ({ display: getComputedStyle(document.querySelector('[data-shell-region="panel"]')).display, height: document.querySelector('[data-shell-region="panel"]').getBoundingClientRect().height }));
  if (!(d.alpha > c.alpha && d.beta > c.beta)) fail(where, `a session stopped while the panel was hidden: ${JSON.stringify(c)} then ${JSON.stringify(d)}`);
  if (hidden.display !== 'none' || hidden.height !== 0) fail(where, `the hidden panel is drawn: ${JSON.stringify(hidden)}`);
  // Showing it again gives the counts back, not a fresh start.
  await page.evaluate(() => window.__panel.show());
  await sleep(300);
  const e = await lines();
  if (!(e.alpha >= d.alpha && e.beta >= d.beta)) fail(where, `a session started again when the panel was shown: ${JSON.stringify(d)} then ${JSON.stringify(e)}`);
  report.keep[`${engine} ${viewportName}`] = { visibleSwitch: { a, b }, hidden: { c, d }, shownAgain: e, slots };
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// A session of a tool of the HOST that its plugin's unload ended is held (A21): it stays in the strip where it was, ended, with its body mounted and what it counted kept, until its tab closes; its card says
// why and the way back to its resource cannot be used while the plugin is off; it can be used again when the plugin returns, and the session is still ended. What the unload did not end follows PO1: here a
// session that had ended on its own, which leaves the strip with its plugin and comes back with it. The shell's own fixture and the real model (`syncPlugins` is what the host calls when a plugin goes).

/** The strip and the bodies as they are drawn: every session tab with its state, its name and the rectangle of each of its parts, and every mounted body with what it counted. */
const HELD = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => {
    if (!el || el.getClientRects().length === 0) return null;
    const b = el.getBoundingClientRect();
    return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  };
  const items = [...document.querySelectorAll('[data-shell-part="sessionTab"]')].map((item) => {
    const tab = item.querySelector('[role=tab]');
    const part = (name) => rect(item.querySelector(`[data-shell-part="${name}"]`));
    return {
      id: item.getAttribute('data-tab-id'),
      name: tab?.getAttribute('aria-label') ?? null,
      state: item.querySelector('[data-shell-part="sessionLead"]')?.getAttribute('data-state') ?? 'running',
      selected: tab?.getAttribute('aria-selected') === 'true',
      rect: rect(item),
      parts: { lead: part('sessionLead'), label: part('sessionLabel'), head: part('sessionHead'), tail: part('sessionTail'), scope: part('sessionScope'), close: part('sessionClose') },
    };
  });
  const bodies = [...document.querySelectorAll('[data-shell-part="panelBody"]')].map((slot) => {
    const stream = slot.querySelector('[data-fixture="stream"]');
    return { session: slot.getAttribute('data-session-id'), hidden: slot.hidden, state: stream?.getAttribute('data-state') ?? null, lines: stream === null ? null : Number(stream.getAttribute('data-lines')) };
  });
  return { items, bodies, opened: [...window.__opened] };
};

/** What the open card says and offers: its links, its buttons (name, whether it is unavailable, the sentence that says why) and the sentences it prints. */
const CARD_HELD = () => {
  const card = document.querySelector('[popover]:popover-open');
  const content = card?.querySelector('[data-shell-part="sessionCard"]') ?? null;
  if (card === null || content === null) return null;
  const text = (el) => el.textContent.trim();
  return {
    links: [...content.querySelectorAll('a')].map((link) => ({ text: text(link), href: link.getAttribute('href') })),
    printed: [...content.querySelectorAll('p')].map(text),
    values: [...content.querySelectorAll('[data-ov-part="value"]')].map((el) => text(el).replace(/\s+since \d\d:\d\d/, ' since HH:MM')),
    buttons: [...content.querySelectorAll('button')].map((button) => {
      const box = button.getBoundingClientRect();
      return {
        label: [...button.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').trim(),
        unavailable: button.getAttribute('aria-disabled'),
        why: (button.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent.trim() ?? '').join(' '),
        at: [box.x + box.width / 2, box.y + box.height / 2],
      };
    }),
  };
};

/**
 * The window the section works in: acme is live; `kept` runs and is on screen, `done` had ended on its own, `mine` is the host's. All three are in the host's Logs tool, with a route to their resource.
 * `scope` is the muted qualifier of the two sessions of acme (the connection, in the host's Logs tool).
 */
const HELD_SETUP = ({ scope = 'north' } = {}) => {
  const store = window.__panel;
  const route = { plugin: 'acme', contribution: 'item', params: { name: 'orders-api' } };
  store.syncPlugins([{ id: 'acme', tools: [] }]);
  store.openSession({ id: 'kept', tool: 'logs', plugin: 'acme', title: 'orders-api/app', scope, state: 'running', route });
  store.openSession({ id: 'done', tool: 'logs', plugin: 'acme', title: 'orders-api/migrate', scope, state: 'ended', cause: 'The source finished.', route });
  store.openSession({ id: 'mine', tool: 'logs', plugin: 'host', title: 'host-follow', state: 'running' });
  store.activateSession('kept');
};

const UNLOADED = 'The plugin was unloaded.';

async function held(browser, engine, viewportName, viewport, origin) {
  const where = `held ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, fixtureUrl(origin), viewport);
  await sleep(250);
  await page.evaluate(HELD_SETUP);
  await sleep(900);
  const before = await page.evaluate(HELD);
  const kept0 = before.items.find((item) => item.id === 'kept');
  const ids = (reading) => reading.items.map((item) => item.id).join();
  if (ids(before) !== 'kept,done,mine') fail(where, `before the unload the strip draws ${ids(before)}, wanted kept,done,mine`);
  if (kept0?.state !== 'running') fail(where, `before the unload the session is ${String(kept0?.state)}, wanted running`);
  const countedBefore = before.bodies.find((body) => body.session === 'kept')?.lines ?? -1;
  if (!(countedBefore > 0)) fail(where, `the running session counted ${String(countedBefore)} lines before the unload: the section proves nothing about lines that stay`);
  if (SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, `held-before-${engine}-${viewportName}.png`) });

  // The unload: the plugin leaves in one transaction.
  await page.evaluate(() => window.__panel.syncPlugins([]));
  if (CONTROL === 'held-moved' || CONTROL === 'held-hidden' || CONTROL === 'held-done-hidden') await page.addStyleTag({ content: PERTURBATIONS[CONTROL].css });
  await sleep(900);
  const after = await page.evaluate(HELD);
  const kept1 = after.items.find((item) => item.id === 'kept');
  // (1) It stays in the strip, in its place, and so does what had ended on its own: every session of the host's tool stays (A21), the unload ended only the one that ran.
  if (kept1 === undefined || kept1.rect === null) fail(where, `the held session's tab is not in the strip (strip: ${ids(after)})`);
  if (ids(after) !== 'kept,done,mine') fail(where, `after the unload the strip draws ${ids(after)}, wanted kept,done,mine (every session of the host's tool stays)`);
  const done1 = after.items.find((item) => item.id === 'done');
  if (done1 === undefined || done1.rect === null) fail(where, `the tab of the session that had ended on its own is not in the strip (strip: ${ids(after)}): it stays where a person can see and choose it`);
  if (done1?.state !== 'ended' || done1.name !== 'orders-api/migrate, ended') fail(where, `the session that had ended on its own is ${JSON.stringify(done1?.name)} (${String(done1?.state)}) after the unload, wanted it as it was: "orders-api/migrate, ended"`);
  // The negative control that hides the held tab has nothing to hover, focus or close: it ends here, with its own check made.
  if (CONTROL === 'held-hidden') {
    await context.close();
    return;
  }
  // (2) It says it ended, in the strip and to a screen reader, and is still the one on screen.
  if (kept1 !== undefined) {
    if (kept1.state !== 'ended') fail(where, `the held session's lead says ${kept1.state}, wanted ended`);
    if (kept1.name !== 'orders-api/app, ended') fail(where, `the held session's tab is named ${JSON.stringify(kept1.name)}, wanted "orders-api/app, ended"`);
    if (!kept1.selected) fail(where, 'the held session is no longer the one on screen: a session that stays does not give its place to another');
    // (3) Nothing about its tab moved: the ended glyph is the same size as the tool's, and the label stays where it was.
    for (const key of ['rect', ...Object.keys(kept0.parts)]) {
      const a = key === 'rect' ? kept0.rect : kept0.parts[key];
      const b = key === 'rect' ? kept1.rect : kept1.parts[key];
      if (a === null || b === null) {
        if (a !== b) fail(where, `the held tab's ${key} was ${JSON.stringify(a)} and is ${JSON.stringify(b)}`);
        continue;
      }
      const moved = Math.max(...a.map((value, index) => Math.abs(value - b[index])));
      if (moved > 0.5) fail(where, `the held tab's ${key} moved by ${moved} px: ${JSON.stringify(a)} then ${JSON.stringify(b)}`);
    }
  }

  // (4) Its body is still mounted and on screen, saying ended, with the lines it counted, and it counts no more.
  const body = after.bodies.find((candidate) => candidate.session === 'kept');
  if (body === undefined) fail(where, 'the held session\'s body is not mounted');
  else {
    if (body.hidden) fail(where, 'the held session\'s body is hidden though it is on screen');
    if (body.state !== 'ended') fail(where, `the held session's body says ${String(body.state)}, wanted ended`);
    if (!(body.lines >= countedBefore)) fail(where, `the held session's body had ${countedBefore} lines and has ${String(body.lines)}: what it counted did not stay`);
    await sleep(500);
    const later = (await page.evaluate(HELD)).bodies.find((candidate) => candidate.session === 'kept');
    if (later?.lines !== body.lines) fail(where, `the held session went on counting: ${String(body.lines)} then ${String(later?.lines)}`);
  }
  const doneBody = after.bodies.find((candidate) => candidate.session === 'done');
  if (doneBody === undefined || doneBody.state !== 'ended') fail(where, `the body of the session that had ended on its own is ${JSON.stringify(doneBody)} while its plugin is off, wanted it mounted and ended`);
  if (SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, `held-after-${engine}-${viewportName}.png`) });

  // (5) Its card says the plugin was unloaded and the way back to its resource cannot be used: the name is not a link, the button is unavailable for that sentence, and pressing it opens nothing.
  const openCard = async (selector) => {
    await page.mouse.move(1, 1);
    await sleep(500);
    const box = await page.locator(selector).boundingBox();
    if (box === null) return null;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    await sleep(1000);
    return page.evaluate(CARD_HELD);
  };
  const tab = '[data-shell-part="sessionTab"][data-tab-id="kept"] [role=tab]';
  const off = await openCard(tab);
  if (CONTROL === 'held-enabled') await page.evaluate(() => document.querySelector('[popover]:popover-open [data-shell-part="sessionCard"] button')?.removeAttribute('aria-disabled'));
  const offAgain = CONTROL === 'held-enabled' ? await page.evaluate(CARD_HELD) : off;
  report.held[`${engine} ${viewportName} plugin off`] = offAgain;
  if (offAgain === null) fail(where, 'no card opened on the held session\'s tab');
  else {
    if (!offAgain.printed.includes(UNLOADED)) fail(where, `the card of the held session prints ${JSON.stringify(offAgain.printed)}, wanted "${UNLOADED}"`);
    if (offAgain.links.length !== 0) fail(where, `the card has ${offAgain.links.length} link(s) while the plugin is off: ${JSON.stringify(offAgain.links)}`);
    const [button] = offAgain.buttons;
    if (button === undefined) fail(where, 'the card has no button that opens the resource');
    else {
      if (button.unavailable !== 'true') fail(where, `the button "${button.label}" is not unavailable while the plugin is off (aria-disabled ${String(button.unavailable)})`);
      if (button.why !== UNLOADED) fail(where, `the button says ${JSON.stringify(button.why)} as its reason, wanted "${UNLOADED}"`);
      await page.mouse.click(button.at[0], button.at[1]);
      await sleep(300);
      const pressed = (await page.evaluate(HELD)).opened;
      if (pressed.length !== 0) fail(where, `pressing the button while the plugin is off opened ${JSON.stringify(pressed)}`);
    }
  }

  if (SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, `held-card-off-${engine}-${viewportName}.png`) });
  await page.keyboard.press('Escape');
  await sleep(300);

  // (6) The plugin returns: the session is as it was (held, ended), what had ended on its own comes back with it, and the way back to the resource works.
  await page.evaluate(() => window.__panel.syncPlugins([{ id: 'acme', tools: [] }]));
  await sleep(900);
  const back = await page.evaluate(HELD);
  const kept2 = back.items.find((item) => item.id === 'kept');
  if (SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, `held-back-${engine}-${viewportName}.png`) });
  if (ids(back) !== 'kept,done,mine') fail(where, `after the plugin returned the strip draws ${ids(back)}, wanted kept,done,mine`);
  if (kept2?.state !== 'ended') fail(where, `after the plugin returned the held session is ${String(kept2?.state)}: a session that stays ended does not start again`);
  if (back.bodies.find((candidate) => candidate.session === 'kept')?.state !== 'ended') fail(where, 'after the plugin returned the held session\'s body is not ended');
  const on = await openCard(tab);
  report.held[`${engine} ${viewportName} plugin back`] = on;
  if (on === null) fail(where, 'no card opened on the held session\'s tab once the plugin was back');
  else {
    if (on.links.length !== 1 || on.links[0].href !== '#/acme/item') fail(where, `the card's links once the plugin is back: ${JSON.stringify(on.links)}, wanted one to #/acme/item`);
    const [button] = on.buttons;
    if (button === undefined || button.unavailable !== null) fail(where, `the button once the plugin is back: ${JSON.stringify(button)}, wanted one that is available`);
    else {
      await page.mouse.click(button.at[0], button.at[1]);
      await sleep(300);
      const pressed = (await page.evaluate(HELD)).opened;
      if (pressed.join() !== 'acme/item') fail(where, `pressing the button once the plugin is back opened ${JSON.stringify(pressed)}, wanted acme/item`);
    }
  }

  await page.keyboard.press('Escape');
  await sleep(300);

  // (7) A new press opens a new session beside the held one, a twin told apart by its ordinal; the held one is not touched. Closing the held tab (Delete) frees its body and moves nothing else.
  await page.evaluate(() => window.__panel.openSession({ id: 'again', tool: 'logs', plugin: 'acme', title: 'orders-api/app', scope: 'north', state: 'running' }));
  await sleep(600);
  const twins = await page.evaluate(HELD);
  if (ids(twins) !== 'kept,done,mine,again') fail(where, `with a second press the strip draws ${ids(twins)}, wanted kept,done,mine,again`);
  if (twins.items.find((item) => item.id === 'kept')?.state !== 'ended') fail(where, 'a new press changed the held session');
  if (twins.items.find((item) => item.id === 'again')?.name !== 'orders-api/app (2)') fail(where, `the new session is named ${JSON.stringify(twins.items.find((item) => item.id === 'again')?.name)}, wanted "orders-api/app (2)"`);
  await page.locator(tab).focus();
  await page.keyboard.press('Delete');
  await sleep(600);
  const closed = await page.evaluate(HELD);
  if (ids(closed) !== 'done,mine,again') fail(where, `after closing the held session the strip draws ${ids(closed)}, wanted done,mine,again`);
  if (closed.bodies.some((candidate) => candidate.session === 'kept')) fail(where, 'the body of the held session is still mounted after its tab closed');
  report.held[`${engine} ${viewportName}`] = { before: before.items.map((item) => [item.id, item.state]), after: after.items.map((item) => [item.id, item.state]), counted: [countedBefore, body?.lines ?? null], twins: twins.items.map((item) => item.name), closed: closed.items.map((item) => item.id) };
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The negative controls: one perturbation of one measured value, made in the page after it loaded. The probe must see it. With NEGATIVE_CONTROL the exit code is 0 when it did.
const PERTURBATIONS = {
  'panel-height': { css: '[data-shell-region="panel"] { block-size: 272px !important; }', sections: ['geometry'], expected: /^geometry .* (empty|sessions): (panel|body)\[h\]/ },
  'session-gap': { css: '[data-shell-part="sessionLabel"] { margin-inline-start: 2px !important; }', sections: ['geometry'], expected: /^geometry .* sessions: session 1 label\[x\]/ },
  toggle: { css: '[data-shell-part="panelToggle"] { margin-inline-start: 2px !important; }', sections: ['geometry'], expected: /^geometry .* (hidden|empty|sessions): toggle\[x\]/ },
  'tab-padding': { css: '[data-shell-part="panelTools"] [role=tab] { padding-inline: 13px !important; }', sections: ['geometry'], expected: /^geometry .* (empty|sessions): tool tab 2\[x\]/ },
  shift: { sections: ['shift'], expected: /^shift .*: (opening: sidebar|.*sidebar before|.*sidebar after)/ },
  'root-write': { sections: ['drag'], expected: /^drag .*: \d+ writes to the document root/ },
  // A21: the held session's tab is not drawn after the unload, and nor is the tab of the session that had ended on its own (two controls: each hides ONE tab, so each trips only its own check); the held tab moves; the way
  // back to its resource is pressable while its plugin is off. Each is made in the page after the unload and must trip its own check.
  'held-hidden': { css: '[data-shell-part="sessionTab"][data-tab-id="kept"] { display: none !important; }', sections: ['held'], expected: /^held .*: the held session's tab is not in the strip/ },
  'held-done-hidden': { css: '[data-shell-part="sessionTab"][data-tab-id="done"] { display: none !important; }', sections: ['held'], expected: /^held .*: the tab of the session that had ended on its own is not in the strip/ },
  'held-moved': { css: '[data-shell-part="sessionLead"][data-state="ended"] { margin-inline-end: 3px !important; }', sections: ['held'], expected: /^held .*: the held tab's (rect|lead|label|head|tail|scope|close) moved by/ },
  'held-enabled': { sections: ['held'], expected: /^held .*: the button ".*" is not unavailable while the plugin is off/ },
  // P1b-3d, the scope of a session tab (TI1): the twins' scope part is 3 px off the mock's; a tab with no twin draws a scope; the tab that is left when its twin closes still draws one; the name of a scoped tab
  // leaves its scope out, which axe's `label-content-name-mismatch` must see (the finding of P1b-3c). Each trips only its own check.
  'twin-moved': { css: '[data-shell-part="sessionScope"] { margin-inline-start: 3px !important; }', sections: ['twins'], expected: /^twins .*: session \d (item|tab|label|scope)\[/ },
  'twin-lone-scope': { sections: ['twin-rules'], expected: /^twin-rules .*: a session with no twin draws a scope/ },
  'twin-scope-kept': { sections: ['twin-rules'], expected: /^twin-rules .*: the tab that is left draws a scope/ },
  'scope-name': { sections: ['a11y'], expected: /^a11y .*: label-content-name-mismatch/ },
  // The late section's baseline is taken while the second plugin's tool is not yet in the strip, and the section says so (its guard): the control makes the probe slow, so the tool is in the strip first and the guard must say it.
  'late-early': { sections: ['late'], expected: /^late .*: the baseline was taken with 4 tools in the model, wanted 3/ },
};
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);

// ---------------------------------------------------------------------------------------------------------------------------
const wants = (section) => CONTROL === '' || PERTURBATIONS[CONTROL].sections.includes(section);
const production = await serveFixtures(buildFixtures('production'));
const development = wants('drag') ? await serveFixtures(buildFixtures('development')) : null;
const axe = readFileSync(AXE, 'utf8');

for (const engineName of engineNames) {
  const browser = await launch(engineName);
  for (const viewportName of viewportNames) {
    const viewport = NATIVE_VIEWPORTS[viewportName];
    if (wants('geometry')) await geometry(browser, engineName, viewportName, viewport, production.origin);
    if (wants('shift')) await shift(browser, engineName, viewportName, viewport, production.origin);
    if (wants('held')) await held(browser, engineName, viewportName, viewport, production.origin);
    if (wants('twins')) await twins(browser, engineName, viewportName, viewport, production.origin);
    if (wants('twin-rules')) await twinRules(browser, engineName, viewportName, viewport, production.origin);
    if (CONTROL !== '' && wants('a11y')) await a11y(browser, engineName, viewportName, viewport, production.origin, axe);
    if (CONTROL !== '' && wants('late')) await late(browser, engineName, viewportName, viewport, production.origin);
    if (CONTROL === '') {
      await card(browser, engineName, viewportName, viewport, production.origin);
      await paint(browser, engineName, viewportName, viewport, production.origin);
      if (viewportName === '1440x900') await facts(browser, engineName, viewport, production.origin);
      await keyboard(browser, engineName, viewportName, viewport, production.origin);
      await a11y(browser, engineName, viewportName, viewport, production.origin, axe);
      await keep(browser, engineName, viewportName, viewport, production.origin);
      await late(browser, engineName, viewportName, viewport, production.origin);
    }

    if (development !== null) await dragCost(browser, engineName, viewportName, viewport, development.origin);
    console.log(engineName, viewportName, 'done');
  }

  await browser.close();
}

production.server.close();
development?.server.close();
report.notes.push(...FACTS_KNOWN.map((line) => `the markup differs from the mock's, by design: ${line}`));
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ geometryWorst: Object.fromEntries(Object.entries(report.geometry).map(([key, value]) => [key, value.worst])), shift: report.shift, drag: report.drag, late: report.late, notes: report.notes.slice(0, 14) }, null, 1));
if (CONTROL !== '') {
  const detected = failures.filter((line) => PERTURBATIONS[CONTROL].expected.test(line));
  console.log(detected.length > 0 ? `\nNEGATIVE CONTROL "${CONTROL}": detected (${detected.length} differences, e.g. ${detected[0]})` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${failures.length} other failures)`);
  process.exit(detected.length > 0 ? 0 : 1);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

console.log('\npanel probe: no failures');

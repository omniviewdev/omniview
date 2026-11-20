// Measures the design mock's bottom panel: the REFERENCE the shell's panel frame is built to (slice P1a).
//
// What it measures, per engine (webkit, chromium) and viewport (1440x900, 1280x800), every scenario in a FRESH page, with the mock's default context (no text scale, default density; font
// normalized as mock-measure.mjs does). The page is the mock's own start screen, with no plugin screen opened (MOCK_OPEN is not run): the panel then offers only the host's five tools
// (Terminal, Logs, Ports, Problems, Operations), none a plugin contributes. Sessions are the host's local shells, opened through Shell.panel.terminal.open and named with Shell.panel.sessions.rename.
//   - hidden:   the panel hidden (the mock's default); the handle row stays, the panel track is 0.
//   - empty:    Shell.panel.show('terminal'), no session.
//   - sessions: the terminal tool with three sessions, named `zsh`, `bash` and `build-runner-7d8c6f49b-f8q4m` (opened in that order; the last opened is the selected one).
//   - states:   four settled sessions, `alpha` running, `beta` ended (Shell.panel.sessions.stop), `gamma` failed (Shell.panel.sim.fail), `delta` expired (Shell.panel.sim.expire); the lead slot of
//               each and its data-state. `connecting`: a fifth session, `epsilon`, read about 100 ms after it opened (its spinner's animation is cancelled first, so the rectangles are not mid-turn).
//   - many:     14 sessions (`session-01` to `session-14`): the session list scrolls; scrollWidth, clientWidth, its rectangle, the first and the last item.
//   - opened:   in ONE page, the regions above the panel and the status bar in the hidden state, then after Shell.panel.show('terminal') (and 600 ms).
//   - paint:    on `sessions` (1440x900 and 1280x800), the computed style of ten parts (the splitter, with its ::after line, and the Hide button among them) in rest, hover and focus (focus reached by a
//               Shift key press then .focus()); the status bar's toggle in the hidden state is read on `hidden` (toggleOff) and in the open state on `sessions` (toggleOn).
//   - card:     on `sessions`, the session card of the first session (hovered) and of the third, the selected one (focused with a Shift key press, as the keyboard reaches it): the card and its head, its
//               list of facts and each row, its actions and each button.
//   - facts:    the resting aria-*/role facts the shell side asserts on (read at 1440x900; the two engines must agree, else they are kept per engine under webkit and chromium).
//   - twins:    the LOGS tool with three sessions of one title, `cart-api`, opened in this order through Shell.panel.logs.open (a producer of the probe's own, `probe.twins`, that runs at once): context
//               `north-yard`, `south-yard`, `north-yard` (no other qualifier), each stopped (Shell.panel.sessions.stop) and read once every lead reports exited. The mock's labelParts draws the scope (the context) on a tab only because another open session shares its title and
//               differs in scope, so all three tabs draw `.toolheader__sessionscope`, and the third, a twin of the first, gets the ordinal ` (2)` in `.toolheader__sessiontail`. Per item the reading also holds
//               `texts: { aria, head, tail, scope }`: the tab's aria-label and the text of the three parts (null when a part is absent). The last opened session is the selected one.
//
// Serve the mock first: a CommonJS copy of its server.js with `root` set to the mock directory (see mock-strip-measure.mjs), e.g.
//   sed 's#const root=__dirname#const root="<mock dir>"#' <mock dir>/server.js > /tmp/server.cjs && PORT=49471 node /tmp/server.cjs
// Without MOCK_URL the script serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) on port 49474.
// Run:  MOCK_URL=http://127.0.0.1:49471/ node ui-next/shell/probes/mock-panel-measure.mjs
// Writes mock-panel.json. Exits non-zero when a scenario misses its panel, tabs or sessions.
// SCENARIO=twins measures ONLY that scenario (in each engine and viewport) and MERGES it into the existing mock-panel.json as data.<engine>.<viewport>.twins: every other value is read and written back
// as it was (the file is one line of compact JSON, so it stays one line). A full run (no SCENARIO) measures every scenario, twins included.
//
// mock-panel.json: { mockTree, viewports, note,
//   data:   { <engine>: { <viewport>: { hidden, empty, sessions, states, many, card, twins } } },       card: { hover, focus }: the session card (see `CARD` below), read in `sessions`'s page
//   shift:  { <engine>: { <viewport>: { <region>: { before, after } } } },                  region: topbar | tabstrip | scroller | rail | sidebar | lane | island | mainscroll | statusbar
//   states: { <engine>: { <viewport>: { <part>: { rest, hover, focus } } } },               part: toolTabSelected | toolTabOther | sessionSelected | sessionOther | sessionClose | addButton | hideButton | handle | toggleOff | toggleOn
//   facts:  { toggle, handle, panel, header, toolTablist, sessionTablist, addGroup, actions, toolTabs, sessionTabs, body } }
// reading (every rectangle [x, y, w, h], viewport px, 0.01; null when absent or not laid out):
//   { viewport: [w, h], gridRows, panelState, window, topRow, frame, handle, panel, header, body, tools, content, statusBar, toggle, toggleSvg,
//     toolTabs: { list, tabs: [rect...], separator, first: { tab, lead, label } },
//     sessions: { box, list, add, addButtons: [rect...], selected: index | -1, items: [{ item, tab, lead, leadSvg, label, head, tail, scope, close, closeSvg, state, selected }] },
//     actions: { group, buttons: [rect...] },
//     stops: { toolTabs: [tabIndex...], sessionTabs: [tabIndex...] },
//     scroll: { list: { left, width, client }, tools: { left, width, client } } }
//   states: also `connecting: { item, tab, lead, leadSvg, state }`.   many: also `edges: { first, last }` (the first and the last item rectangle).
// paint (one entry per state): { matches: { hover, focus, focusVisible }, backgroundColor, boxShadow, border: { width, style, color }, edge, outline: { style, width, color, offset }, color,
//   borderRadius, opacity, button?: same, title?: { color, fontSize, fontWeight, lineHeight } }   (button and title only for the two session parts)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const SCENARIOS = ['hidden', 'empty', 'sessions', 'states', 'many', 'twins'];
// The scenarios SCENARIO=<name> can measure alone: those that are one reading and nothing else (no facts, parts or card to merge).
const MERGEABLE = ['twins'];
const ONLY = process.env.SCENARIO;
if (ONLY !== undefined && !MERGEABLE.includes(ONLY)) throw new Error(`SCENARIO=${ONLY}: only ${MERGEABLE.join(', ')} can be measured alone`);
const MANY = 14;
const started = Date.now();

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory.
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-panel-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49474' }, stdio: 'ignore' });
  url = 'http://127.0.0.1:49474/';
  await sleep(1500);
}

const READ = `(() => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => { if (!el || el.getClientRects().length === 0) return null; const b = el.getBoundingClientRect(); return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)]; };
  const P = document.getElementById('shell-panel');
  const q = (s, root = P) => (root ? root.querySelector(s) : null);
  const scroll = (el) => el ? { left: r2(el.scrollLeft), width: el.scrollWidth, client: el.clientWidth } : null;
  const toolTabs = P ? [...P.querySelectorAll('.toolheader__tablist > [role=tab]')] : [];
  const items = P ? [...P.querySelectorAll('.toolheader__sessionlist > .tab-item')] : [];
  const lead = (item) => q('.toolheader__lead', item);
  const buttons = P ? [...P.querySelectorAll('.toolheader__add button')] : [];
  const actions = P ? [...P.querySelectorAll('.toolheader__actions button')] : [];
  const bar = document.querySelector('.statusbar');
  const toggle = document.querySelector('.statusbar button.statusitem[data-key="panel"]');
  return {
    viewport: [innerWidth, innerHeight],
    gridRows: getComputedStyle(document.querySelector('.app')).gridTemplateRows,
    panelState: Shell.panel.state(),
    window: rect(document.querySelector('.app')),
    topRow: rect(document.querySelector('.topbar')),
    frame: rect(document.querySelector('.pane')),
    handle: rect(document.querySelector('.app > .splitter[data-handle="panel"]')),
    panel: rect(P),
    header: rect(q('.panel__header')),
    body: rect(q('.panel__body')),
    tools: rect(q('.panel__tools')),
    content: rect(q('.panel__content')),
    statusBar: rect(bar),
    toggle: rect(toggle),
    toggleSvg: rect(q('svg', toggle)),
    toolTabs: {
      list: rect(q('.toolheader__tablist')),
      tabs: toolTabs.map(rect),
      separator: rect(q('.toolheader__sep')),
      first: toolTabs[0] ? { tab: rect(toolTabs[0]), lead: rect(q('.ic svg', toolTabs[0])), label: rect(q('.toolheader__tablabel', toolTabs[0])) } : null,
    },
    sessions: {
      box: rect(q('.toolheader__sessions')),
      list: rect(q('.toolheader__sessionlist')),
      add: rect(q('.toolheader__add')),
      addButtons: buttons.map(rect),
      selected: items.findIndex((i) => q('[role=tab]', i)?.getAttribute('aria-selected') === 'true'),
      items: items.map((item) => ({
        item: rect(item), tab: rect(q('[role=tab]', item)), lead: rect(lead(item)), leadSvg: rect(q('svg', lead(item))), label: rect(q('.toolheader__sessionlabel', item)),
        head: rect(q('.toolheader__sessionhead', item)), tail: rect(q('.toolheader__sessiontail', item)), scope: rect(q('.toolheader__sessionscope', item)),
        close: rect(q('.tab__close', item)), closeSvg: rect(q('.tab__close svg', item)),
        state: lead(item)?.getAttribute('data-state') ?? null, selected: q('[role=tab]', item)?.getAttribute('aria-selected') === 'true',
      })),
    },
    actions: { group: rect(q('.toolheader__actions')), buttons: actions.map(rect) },
    stops: { toolTabs: toolTabs.map((t) => t.tabIndex), sessionTabs: items.map((i) => q('[role=tab]', i)?.tabIndex ?? null) },
    scroll: { list: scroll(q('.toolheader__sessionlist')), tools: scroll(q('.toolheader__tablist')) },
  };
})()`;

const REGIONS = `(() => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => { if (!el || el.getClientRects().length === 0) return null; const b = el.getBoundingClientRect(); return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)]; };
  const q = (s) => document.querySelector(s);
  return {
    topbar: rect(q('.topbar')), tabstrip: rect(q('.tabstrip')), scroller: rect(q('.tabstrip__scroller')), rail: rect(q('.frame__rail')), sidebar: rect(q('.frame__sidebar')),
    lane: rect(q('.frame__lane')), island: rect(q('.frame__island')), mainscroll: rect(q('#mainscroll')), statusbar: rect(q('.statusbar')),
  };
})()`;

const FACTS = `(() => {
  const attrs = (el, names) => (el ? Object.fromEntries(names.map((n) => [n, el.getAttribute(n)])) : null);
  const P = document.getElementById('shell-panel');
  const q = (s, root = P) => (root ? root.querySelector(s) : null);
  const all = (s, root = P) => (root ? [...root.querySelectorAll(s)] : []);
  const toggle = document.querySelector('.statusbar button.statusitem[data-key="panel"]');
  const handle = document.querySelector('.app > .splitter[data-handle="panel"]');
  const names = ['role', 'aria-label'];
  return {
    toggle: { ...attrs(toggle, ['aria-pressed', 'aria-label', 'role', 'tabindex']), tag: toggle?.tagName.toLowerCase() ?? null, text: toggle?.textContent.trim() ?? null },
    handle: { ...attrs(handle, ['role', 'aria-orientation', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'tabindex', 'aria-label', 'aria-controls']), tag: handle?.tagName.toLowerCase() ?? null },
    panel: attrs(P, [...names, 'id']),
    header: attrs(q('.toolheader'), names),
    toolTablist: attrs(q('.toolheader__tablist'), names),
    sessionTablist: attrs(q('.toolheader__sessionlist'), names),
    addGroup: { ...attrs(q('.toolheader__add'), names), buttons: all('.toolheader__add button').map((b) => attrs(b, ['aria-label', 'aria-haspopup', 'aria-expanded', 'tabindex'])) },
    actions: { ...attrs(q('.toolheader__actions'), names), buttons: all('.toolheader__actions button').map((b) => attrs(b, ['aria-label', 'aria-pressed', 'aria-haspopup', 'aria-expanded', 'tabindex'])) },
    toolTabs: all('.toolheader__tablist > [role=tab]').map((t) => ({ ...attrs(t, ['role', 'aria-selected', 'tabindex', 'aria-controls']), text: t.textContent.trim() })),
    sessionTabs: all('.toolheader__sessionlist > .tab-item').map((i) => ({
      ...attrs(q('[role=tab]', i), ['role', 'aria-selected', 'tabindex', 'aria-label', 'aria-controls']),
      close: attrs(q('.tab__close', i), ['aria-label', 'tabindex']),
    })),
    body: attrs(q('.panel__body'), ['role', 'aria-labelledby']),
  };
})()`;

const PAINT = `(el) => {
  const cs = getComputedStyle(el);
  const edge = parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : (cs.boxShadow.match(/rgba?\\([^)]*\\)/)?.[0] ?? '');
  return {
    backgroundColor: cs.backgroundColor, boxShadow: cs.boxShadow, border: { width: cs.borderTopWidth, style: cs.borderTopStyle, color: cs.borderTopColor }, edge,
    outline: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset },
    color: cs.color, borderRadius: cs.borderTopLeftRadius, opacity: cs.opacity, cursor: cs.cursor,
    // The splitter draws its line in ::after: 2 px, the accent while it has the keyboard's focus.
    ...(el.classList.contains('splitter') ? { after: { backgroundColor: getComputedStyle(el, '::after').backgroundColor, blockSize: getComputedStyle(el, '::after').height } } : {}),
  };
}`;

/** The session card, as the mock draws it: the surface (core's hover card), the head (glyph and kind), the list of facts and each row, and the actions and each button. null when no card is open. */
const CARD = `(() => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => { if (!el || el.getClientRects().length === 0) return null; const b = el.getBoundingClientRect(); return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)]; };
  const card = document.querySelector('.psession-card:popover-open');
  if (!card) return null;
  const q = (s) => card.querySelector(s);
  return {
    placement: card.getAttribute('data-placement'),
    card: rect(card),
    head: rect(q('.psession-card__head')), headSvg: rect(q('.psession-card__head svg')), kind: rect(q('.psession-card__kind')),
    facts: rect(q('.kv')), rows: [...card.querySelectorAll('.kv .kv__row')].map(rect), labels: [...card.querySelectorAll('.kv dt')].map(rect), values: [...card.querySelectorAll('.kv dd')].map(rect),
    actions: rect(q('.psession-card__actions')), buttons: [...card.querySelectorAll('.psession-card__actions button')].map(rect),
    texts: [...card.querySelectorAll('.kv dt, .kv dd')].map((el) => el.textContent.trim().replace(/\\s+since \\d\\d:\\d\\d/, ' since HH:MM')),
  };
})()`;

const SESSION = '#shell-panel .toolheader__sessionlist > .tab-item';
const PARTS = {
  toolTabSelected: { sel: '#shell-panel .toolheader__tablist > [role=tab][aria-selected="true"]', focus: null },
  toolTabOther: { sel: '#shell-panel .toolheader__tablist > [role=tab][aria-selected="false"]', focus: null },
  sessionSelected: { sel: `${SESSION}:has(> [role=tab][aria-selected="true"])`, focus: '[role=tab]', session: true },
  sessionOther: { sel: `${SESSION}:has(> [role=tab][aria-selected="false"])`, focus: '[role=tab]', session: true },
  sessionClose: { sel: `${SESSION}:has(> [role=tab][aria-selected="true"]) > .tab__close`, focus: null },
  addButton: { sel: '#shell-panel .toolheader__add button[data-key="add"]', focus: null },
  hideButton: { sel: '#shell-panel .toolheader__actions button[data-key="hide"]', focus: null },
  handle: { sel: '.app > .splitter[data-handle="panel"]', focus: null },
  toggleOff: { sel: '.statusbar button.statusitem[data-key="panel"]', focus: null },
  toggleOn: { sel: '.statusbar button.statusitem[data-key="panel"]', focus: null },
};

async function open(browser, viewport) {
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await sleep(3000);
    await page.waitForFunction(() => typeof Shell !== 'undefined' && Shell.panel?.show !== undefined && Shell.panel.terminal !== undefined);
    await sleep(1500);
    await normalizeFont(page, { rootVar: '--int-font-ui' });
    return page;
  } catch (error) {
    // A page that did not come up leaves its context to nobody else: close it here.
    await context.close();
    throw error;
  }
}

/** Opens one local shell per name (the shell alternates between the host's two), renames it, lets the sessions settle. Returns the ids. */
const OPEN = async ({ names, shells, settle }) => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const targets = Shell.panel.targets.list('terminal').find((group) => group.plugin === 'host').targets;
  const ids = [];
  names.forEach((name, i) => {
    const id = Shell.panel.terminal.open(targets.find((t) => t.id === `local/${shells[i % shells.length]}`));
    Shell.panel.sessions.rename(id, name);
    ids.push(id);
  });
  await wait(settle);
  return ids;
};

async function readParts(page, names) {
  const out = {};
  for (const name of names) {
    const part = PARTS[name];
    const handle = await page.$(part.sel);
    if (handle === null) { console.log('MISSING part', name); out[name] = null; continue; }
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
      out[name][state] = await handle.evaluate((el, [paint, focusSel, session]) => {
        const read = new Function(`return (${paint})`)();
        const target = focusSel === null ? el : el.querySelector(focusSel);
        const entry = { matches: { hover: el.matches(':hover'), focus: target.matches(':focus'), focusVisible: target.matches(':focus-visible') }, ...read(el) };
        if (session) {
          entry.button = read(target);
          const head = el.querySelector('.toolheader__sessionhead');
          const cs = getComputedStyle(head);
          entry.title = { color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight };
        }
        return entry;
      }, [PAINT, part.focus, part.session === true]);
    }
  }
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(1, 1);
  return out;
}

/** The card of the first session on hover, then of the third (the selected one) on the keyboard's focus. Each is read once it is open and still. */
async function readCards(page) {
  const tabs = '#shell-panel .toolheader__sessionlist > .tab-item [role=tab]';
  await page.mouse.move(1, 1);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await sleep(400);
  const box = await (await page.$(tabs)).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
  await sleep(1000);
  const hover = await page.evaluate(CARD);
  await page.mouse.move(1, 1);
  await sleep(600);
  await page.keyboard.press('Shift');
  await page.evaluate((selector) => document.querySelectorAll(selector)[2].focus(), tabs);
  await sleep(1000);
  const focus = await page.evaluate(CARD);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(1, 1);
  return { hover, focus };
}

const names = (count) => Array.from({ length: count }, (_, i) => `session-${String(i + 1).padStart(2, '0')}`);

/** Each scenario in a fresh page, closed whatever it reads. Returns { reading, parts?, facts? }. */
async function scenario(browser, viewport, name, withExtras) {
  const page = await open(browser, viewport);
  try {
    return await readScenario(page, name, withExtras);
  } finally {
    await page.context().close();
  }
}

async function readScenario(page, name, withExtras) {
  const result = {};
  if (name === 'hidden') {
    result.facts = await page.evaluate(FACTS);
    result.reading = await page.evaluate(READ);
    if (withExtras) result.parts = await readParts(page, ['toggleOff']);
  } else if (name === 'twins') {
    // Logs sessions of a producer of the probe's own (the runner only starts the targets the mock registered itself, and a session it cannot start ends `failed`): it runs at once, and each session is
    // then stopped (Shell.panel.sessions.stop), so every tab ends `exited` and the run is deterministic.
    const ids = await page.evaluate(async (contexts) => {
      const ids = [];
      Shell.panel.producers.register({
        id: 'probe.twins', kinds: ['logs'],
        start: async ({ sink }) => { sink.state({ state: 'running', certainty: 'known' }); return { twins: true }; },
        stop: async () => ({ acknowledged: true }), reconnect: async () => ({ twins: true }), dispose: async () => undefined,
      });
      contexts.forEach((context, i) => {
        const id = Shell.panel.logs.open({
          id: `item/cart-api/${i + 1}`, label: 'cart-api', title: 'cart-api', plugin: 'host', kind: 'logs', producer: 'probe.twins', detail: 'Item',
          presentation: { operation: 'Logs', context, resource: 'Item cart-api', container: '' },
        });
        if (typeof id !== 'string') throw new Error('Shell.panel.logs.open did not return a session id');
        ids.push(id);
      });
      for (const id of ids) await Shell.panel.sessions.stop(id, { reason: 'user' });
      return ids;
    }, ['north-yard', 'south-yard', 'north-yard']);
    result.ids = ids;
    await page.waitForFunction((count) => {
      const leads = [...document.querySelectorAll('#shell-panel .toolheader__sessionlist > .tab-item .toolheader__lead')];
      return leads.length === count && leads.every((lead) => lead.getAttribute('data-state') === 'exited');
    }, ids.length, { timeout: 15000 });
    await sleep(600);
    result.reading = await page.evaluate(READ);
    // The words of each tab, as drawn: its accessible name and the text of the head, the tail and the scope (null when a part is absent).
    const texts = await page.evaluate(() => [...document.querySelectorAll('#shell-panel .toolheader__sessionlist > .tab-item')].map((item) => {
      const text = (selector) => item.querySelector(selector)?.textContent.trim() ?? null;
      return { aria: item.querySelector('[role=tab]')?.getAttribute('aria-label') ?? null, head: text('.toolheader__sessionhead'), tail: text('.toolheader__sessiontail'), scope: text('.toolheader__sessionscope') };
    }));
    result.reading.sessions.items.forEach((item, i) => { item.texts = texts[i]; });
    result.selectedTool = await page.evaluate(() => document.querySelector('#shell-panel .toolheader__tablist > [role=tab][aria-selected="true"]')?.textContent.trim() ?? null);
  } else {
    await page.evaluate(() => { Shell.panel.show('terminal'); });
    await sleep(700);
    if (name === 'sessions') {
      await page.evaluate(OPEN, { names: ['zsh', 'bash', 'build-runner-7d8c6f49b-f8q4m'], shells: ['zsh', 'bash', 'zsh'], settle: 1000 });
      await sleep(400);
    } else if (name === 'states') {
      const [, beta, gamma, delta] = await page.evaluate(OPEN, { names: ['alpha', 'beta', 'gamma', 'delta'], shells: ['zsh', 'bash'], settle: 1000 });
      await page.evaluate(async ([beta, gamma, delta]) => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        await Shell.panel.sessions.stop(beta, { reason: 'user' });
        Shell.panel.sim.fail(gamma, 'The connection was refused');
        await Shell.panel.sim.expire([delta]);
        await wait(800);
      }, [beta, gamma, delta]);
    } else if (name === 'many') {
      await page.evaluate(OPEN, { names: names(MANY), shells: ['zsh', 'bash'], settle: 1500 });
      await sleep(600);
    }
    result.reading = await page.evaluate(READ);
    if (name === 'many') {
      const items = result.reading.sessions.items;
      result.reading.edges = { first: items[0]?.item ?? null, last: items.at(-1)?.item ?? null };
    }
    if (name === 'states') {
      // The fifth session is read while it still connects. The local shell is ready in ~260 ms, and the tab draws no glyph for the first second of connecting, so a producer of the
      // probe's own (registered through the mock's Shell.panel.producers.register) holds the start for 6 s. The spinner's turn is cancelled so the rectangles are not mid-rotation.
      await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        Shell.panel.producers.register({
          id: 'probe.slow', kinds: ['terminal'],
          start: async ({ sink }) => { setTimeout(() => sink.state({ state: 'running' }), 6000); return { slow: true }; },
          stop: async () => ({ acknowledged: true }), reconnect: async () => ({ slow: true }), dispose: async () => undefined,
        });
        const id = Shell.panel.terminal.open({ id: 'slow', label: 'Slow shell', producer: 'probe.slow', kind: 'local' });
        Shell.panel.sessions.rename(id, 'epsilon');
        await wait(1500);
      });
      result.reading.connecting = await page.evaluate(() => {
        document.getAnimations().forEach((animation) => { if (animation.effect?.target?.closest?.('.toolheader__busy')) animation.cancel(); });
        const r2 = (v) => Math.round(v * 100) / 100;
        const rect = (el) => { if (!el || el.getClientRects().length === 0) return null; const b = el.getBoundingClientRect(); return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)]; };
        const item = [...document.querySelectorAll('#shell-panel .toolheader__sessionlist > .tab-item')].at(-1);
        const lead = item?.querySelector('.toolheader__lead');
        return { item: rect(item), tab: rect(item?.querySelector('[role=tab]')), lead: rect(lead), leadSvg: rect(lead?.querySelector('svg')), state: lead?.getAttribute('data-state') ?? null };
      });
    }
    if (name === 'sessions') {
      result.facts = await page.evaluate(FACTS);
      if (withExtras) result.parts = await readParts(page, Object.keys(PARTS).filter((part) => part !== 'toggleOff'));
      result.card = await readCards(page);
    }
    if (name === 'empty') result.facts = await page.evaluate(FACTS);
  }
  return result;
}

/** The regions above the panel and the status bar, hidden then opened, in the same page. */
async function opened(browser, viewport) {
  const page = await open(browser, viewport);
  try {
    const before = await page.evaluate(REGIONS);
    await page.evaluate(() => { Shell.panel.show('terminal'); });
    await sleep(600);
    const after = await page.evaluate(REGIONS);
    return Object.fromEntries(Object.keys(before).map((region) => [region, { before: before[region], after: after[region] }]));
  } finally {
    await page.context().close();
  }
}

const checks = {
  hidden: (r) => r.reading.handle === null || r.reading.statusBar === null || r.reading.toggle === null || r.reading.window === null || r.reading.panelState !== 'hidden' ? 'misses handle, status bar or toggle' : null,
  empty: (r) => r.reading.panel === null || r.reading.header === null || r.reading.toolTabs.tabs.length < 5 || r.reading.sessions.addButtons.length < 2 || r.reading.sessions.items.length !== 0 ? 'misses panel, header, tool tabs or add buttons' : null,
  sessions: (r) => r.reading.panel === null || r.reading.sessions.items.length !== 3 || r.reading.sessions.items.some((i) => i.tab === null || i.lead === null || i.close === null) ? 'misses its three sessions' : r.card === undefined || r.card.hover === null || r.card.focus === null || r.card.hover.rows.length !== 3 ? 'misses its session cards' : null,
  states: (r) => r.reading.sessions.items.map((i) => i.state).join() !== ',exited,failed,expired' || r.reading.connecting.state !== 'connecting' ? `states are ${r.reading.sessions.items.map((i) => i.state)} and ${r.reading.connecting.state}` : null,
  many: (r) => r.reading.sessions.items.length !== MANY || !(r.reading.scroll.list.width > r.reading.scroll.list.client) ? 'misses its 14 sessions or the list does not scroll' : null,
  twins: (r) => {
    const items = r.reading.sessions.items;
    if (r.reading.panel === null || r.reading.panelState === 'hidden') return 'the panel is hidden';
    if (items.length !== 3 || items.some((i) => i.tab === null || i.lead === null || i.scope === null || i.state !== 'exited')) return 'misses its three exited sessions with a scope';
    if (items.map((i) => i.selected).join() !== 'false,false,true') return `selected is ${items.map((i) => i.selected)}`;
    if (r.selectedTool !== 'Logs') return `the selected tool tab is ${r.selectedTool}`;
    return null;
  },
};

/** SCENARIO=<name>: measure that one scenario in each engine and viewport and set it under data.<engine>.<viewport>.<name> of the existing mock-panel.json; nothing else of the file is touched. */
async function mergeOnly(name) {
  const file = path.join(here, 'mock-panel.json');
  const reference = JSON.parse(readFileSync(file, 'utf8'));
  if (reference.mockTree !== MOCK_TREE) throw new Error(`mock-panel.json was measured on ${reference.mockTree}, this script on ${MOCK_TREE}`);
  let missed = false;
  for (const engineName of Object.keys(ENGINES)) {
    const browser = await launch(engineName);
    try {
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        const result = await scenario(browser, viewport, name, false);
        const problem = checks[name](result);
        if (problem !== null) { console.log('MISSING', engineName, viewportName, name, problem); missed = true; }
        reference.data[engineName][viewportName][name] = result.reading;
        console.log(engineName, viewportName, name, problem === null ? 'ok' : 'FAILED');
      }
    } finally {
      await browser.close();
    }
  }
  const text = `${JSON.stringify(reference)}\n`;
  if (text.length > 150_000) { console.log('FAILED: the file is over 150 kB'); missed = true; }
  const out = missed ? path.join(tmpdir(), 'mock-panel.failed.json') : file;
  writeFileSync(out, text);
  console.log('wrote', out, statSync(out).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
  if (missed) { console.log('FAILED: mock-panel.json is unchanged'); process.exitCode = 1; }
}

if (ONLY !== undefined) {
  try {
    await mergeOnly(ONLY);
  } finally {
    server?.kill();
  }
  process.exit(process.exitCode ?? 0);
}

const data = {};
const shift = {};
const states = {};
const facts = {};
let failed = false;
// The server this script started (no MOCK_URL) and every browser it launched are closed whatever happens, so a failed run leaves nothing on port 49474 for the next run to read instead of its mock.
try {
  for (const engineName of Object.keys(ENGINES)) {
    const browser = await launch(engineName);
    try {
      data[engineName] = {};
      shift[engineName] = {};
      states[engineName] = {};
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        data[engineName][viewportName] = {};
        const parts = {};
        for (const name of SCENARIOS) {
          const result = await scenario(browser, viewport, name, true);
          const problem = checks[name](result);
          if (problem !== null) { console.log('MISSING', engineName, viewportName, name, problem); failed = true; }
          data[engineName][viewportName][name] = result.reading;
          if (result.card !== undefined) data[engineName][viewportName].card = result.card;
          Object.assign(parts, result.parts ?? {});
          if (viewportName === '1440x900' && result.facts) (facts[engineName] ??= {})[name] = result.facts;
          console.log(engineName, viewportName, name, problem === null ? 'ok' : 'FAILED');
        }
        states[engineName][viewportName] = Object.fromEntries(Object.keys(PARTS).map((part) => [part, parts[part] ?? null]));
        for (const [part, value] of Object.entries(states[engineName][viewportName])) if (value === null) { console.log('MISSING part', engineName, viewportName, part); failed = true; }
        shift[engineName][viewportName] = await opened(browser, viewport);
        for (const [region, value] of Object.entries(shift[engineName][viewportName])) if (value.before === null || value.after === null) { console.log('MISSING region', engineName, viewportName, region); failed = true; }
        console.log(engineName, viewportName, 'opened', 'ok');
      }
    } finally {
      await browser.close();
    }
  }

  // The facts: hidden (closed toggle and handle), empty and sessions (open). Identical in both engines, so they are stored once.
  const compact = ({ hidden, empty, sessions }) => ({
    toggle: { closed: hidden.toggle, open: sessions.toggle },
    handle: { closed: hidden.handle, open: sessions.handle },
    panel: sessions.panel,
    header: sessions.header,
    toolTablist: sessions.toolTablist,
    sessionTablist: { empty: empty.sessionTablist, sessions: sessions.sessionTablist },
    addGroup: sessions.addGroup,
    actions: sessions.actions,
    toolTabs: sessions.toolTabs,
    sessionTabs: sessions.sessionTabs,
    body: sessions.body,
  });
  const perEngine = Object.fromEntries(Object.entries(facts).map(([engine, byScenario]) => [engine, compact(byScenario)]));
  const [first, second] = Object.values(perEngine);
  let factsOut = first;
  if (JSON.stringify(first) !== JSON.stringify(second)) { console.log('FACTS differ between the engines: kept per engine'); factsOut = perEngine; }

  const note = 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. Mock default context; the start screen, no plugin screen (the panel offers only the host tools). The last opened session is the selected one. `connecting` is read ~100 ms after its session opened.';
  const text = `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, note, data, shift, states, facts: factsOut })}\n`;
  if (text.length > 150_000) { console.log('FAILED: the file is over 150 kB'); failed = true; }
  // The reference is replaced only by a complete measurement: a run that missed a scenario, a part or a region, or is over its size, leaves it as it was and writes what it read to the temp
  // directory, for diagnosis.
  const file = failed ? path.join(tmpdir(), 'mock-panel.failed.json') : path.join(here, 'mock-panel.json');
  writeFileSync(file, text);
  console.log('wrote', file, statSync(file).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
  if (failed) { console.log('FAILED: a scenario misses its panel, tabs or sessions, or the file is over its size: mock-panel.json is unchanged'); process.exitCode = 1; }
} finally {
  server?.kill();
}

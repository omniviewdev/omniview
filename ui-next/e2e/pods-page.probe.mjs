// Probes the REAL Pods page (real Go host, real kind cluster) in WebKit and Chromium at 1440 x 900 and 1030 x 720. Read only: kubectl is only
// ever asked `get pods -A --no-headers`; the page is only read and driven with real key presses and real pointer events.
//
//   node ui-next/e2e/pods-page.probe.mjs                      (run from the worktree root)
//
//   PAGE_URL=<url>            default http://127.0.0.1:34302/?screen=pods&connection=kind-ov-1a6
//   KUBECONFIG_PATH=<file>    default /tmp/ov-1a6-env/kubeconfig
//   AXE=<path to axe.min.js>  default: the first of /tmp/ov-axe, /tmp/axe-core, /tmp/atoms/axe (node_modules/axe-core/axe.min.js) that exists
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1030x720   (defaults: both of each)
//   SECTIONS=keyboard,names,axe,counts,shift   (default: all)
//   REPORT=<file>             write every assertion, focus order, axe result and sample table as JSON
//
// One line per assertion: PASS|FAIL [engine viewport] name -- measured value. INFO lines are measurements with no bar. Exit code 1 on any FAIL.
//
//   keyboard  Tab order of the page (Refresh, ONE chip stop, search, the table's scroll region), Shift+Tab back, the chips' roving keys,
//             the search (Escape, Enter, the 500 ms debounce, the clear control), Clear filters and its focus, Refresh (Enter and Space, focus
//             kept, aria-disabled, description) -- WebKit on macOS skips buttons with Tab: Alt+Tab there, as the kit's probes do
//   names     aria snapshot, the names the plan fixes, a name on every control, no `title` attribute
//   axe       axe-core in six states: ready, filter, search with a result, search without, during Refresh, after it
//   counts    footer text and chip counts against kubectl, DOM element counts per region, all rows reached by scrolling
//   shift     requestAnimationFrame samples of six rectangles around the user's own Refresh: movement must be 0
import { writeFileSync } from 'node:fs';
import { ENGINES, VIEWPORTS, check, classify, findAxe, info, installHelpers, readKube, results, sleep, tally } from './pods-page.probe-lib.mjs';

const PAGE_URL = process.env.PAGE_URL ?? 'http://127.0.0.1:34302/?screen=pods&connection=kind-ov-1a6';
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(VIEWPORTS).join(',')).split(',');
const sections = new Set((process.env.SECTIONS ?? 'keyboard,names,axe,counts,shift').split(','));
const axe = findAxe();
const report = { focusOrder: {}, axe: {}, counts: {}, shift: {}, snapshot: {}, dom: {} };

// ---------------------------------------------------------------------------------------------------------------------------
const active = (page) => page.evaluate(() => window.__p.describe(document.activeElement));
const footerText = (page) => page.evaluate(() => document.querySelector('[data-ov-part=footer] [role=status]')?.textContent?.trim() ?? null);
const slotText = (page) => page.evaluate(() => document.querySelector('[data-ov-slot]')?.textContent?.trim() ?? '');
const chips = (page) => page.evaluate(() => [...document.querySelectorAll('[role=group][aria-label="Pod state"] button')].map((b) => ({
  label: b.firstElementChild?.firstChild?.textContent?.trim() ?? b.textContent, count: b.querySelector('b')?.textContent ?? null, pressed: b.getAttribute('aria-pressed'), tabindex: b.getAttribute('tabindex'),
})));
const rowCount = (page) => page.evaluate(() => document.querySelectorAll('tbody tr').length);
const stopKey = (d) => `${d.role}:${d.name}`;
const search = (page) => page.evaluate(() => {
  const i = document.querySelector('input[type=search]');
  return i ? { value: i.value, focused: document.activeElement === i } : null;
});

async function fresh(page) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(PAGE_URL);
      await page.waitForSelector('[data-testid=pod-name]', { timeout: 20000 });
      await page.waitForFunction(() => /^\d+ Pods$/.test(document.querySelector('[data-ov-part=footer] [role=status]')?.textContent?.trim() ?? ''), null, { timeout: 20000 });
      break;
    } catch (error) {
      const state = await page.evaluate(() => ({ view: document.querySelector('[data-ov-state]')?.getAttribute('data-ov-state') ?? null, text: document.body.innerText.slice(0, 160) })).catch(() => null);
      console.log(`INFO [load] attempt ${attempt} did not render rows: ${JSON.stringify(state)}`);
      if (attempt >= 2) throw error;
    }
  }
  await sleep(900);
}

const keyFor = (engine, back) => `${engine === 'webkit' ? 'Alt+' : ''}${back ? 'Shift+' : ''}Tab`;
async function press(page, engine, back = false) {
  await page.keyboard.press(keyFor(engine, back));
  await sleep(40);
  return active(page);
}
/** Walk with Tab until focus leaves the page (or `max`): every stop, the last one outside the page when there is one. */
async function walk(page, engine, back, max = 8) {
  const stops = [];
  for (let i = 0; i < max; i += 1) {
    const d = await press(page, engine, back);
    stops.push(d);
    if (!d.inPage) break;
  }
  return stops;
}
async function tabTo(page, engine, pred, max = 8) {
  for (let i = 0; i < max; i += 1) {
    const d = await press(page, engine, false);
    if (pred(d)) return d;
    if (!d.inPage) return null;
  }
  return null;
}
const isRefresh = (d) => d.role === 'button' && d.name === 'Refresh Pods';
const isSearch = (d) => d.role === 'searchbox';
const isChip = (d) => d.role === 'button' && /^(All|Running|Pending|Failed|Completed) \d+$/.test(d.name);
const expectedFooter = (total, k) => (k === total ? `${total} Pods` : `${k} of ${total} Pods`);
const nameMatches = (kube, q) => kube.filter((p) => `${p.name} ${p.namespace}`.toLowerCase().includes(q)).length;
const orderOf = (stops) => stops.map((d) => `${stopKey(d)}${d.pressed === null || d.pressed === undefined ? '' : `[pressed=${d.pressed}]`}`);

async function waitFooter(page, text, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await footerText(page)) === text) return Date.now() - t0;
    await sleep(15);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
async function keyboard(page, engine, s) {
  await fresh(page);
  const kube = readKube();
  const total = kube.length;
  const t = tally(kube);

  // ---- 1. Tab order from a click on the title, and back.
  await page.locator('[role=tabpanel] h1').click();
  info(s, 'focus after clicking the title', stopKey(await active(page)));
  const forward = await walk(page, engine, false);
  const inside = forward.filter((d) => d.inPage);
  const outside = forward.find((d) => !d.inPage);
  report.focusOrder[s] = { forward: orderOf(forward), outside: outside ? stopKey(outside) : null };
  const expected = ['button:Refresh Pods', `button:All ${total}[pressed=true]`, 'searchbox:Search Pods', 'region:Pods'];
  check(s, 'Tab order inside the page', JSON.stringify(orderOf(inside)) === JSON.stringify(expected), { got: orderOf(inside), expected });
  info(s, 'focus after the last page stop', outside ? `${stopKey(outside)} (${outside.tag})` : 'never left the page in 8 presses');
  check(s, 'table rows and cells are not tab stops', !forward.some((d) => ['row', 'cell', 'gridcell'].includes(d.role) || ['tr', 'td'].includes(d.tag)), orderOf(forward));
  const stopsDom = await page.evaluate(() => window.__p.tabStops().map((d) => `${d.role}:${d.name}`));
  check(s, 'tabbable elements of the page (DOM)', stopsDom.length === 4, stopsDom);

  // back: tab forward to the table region, then Shift+Tab up to Refresh and out (a click inside the region would start the walk from the clicked node)
  await fresh(page);
  await page.locator('[role=tabpanel] h1').click();
  const atRegion = await tabTo(page, engine, (d) => d.role === 'region');
  info(s, 'focus after Tab to the table region', atRegion && stopKey(atRegion));
  const back = await walk(page, engine, true);
  report.focusOrder[s].back = orderOf(back);
  const expectedBack = ['searchbox:Search Pods', `button:All ${total}[pressed=true]`, 'button:Refresh Pods'];
  check(s, 'Shift+Tab walks the page back', JSON.stringify(orderOf(back.filter((d) => d.inPage))) === JSON.stringify(expectedBack), { got: orderOf(back), expected: expectedBack });
  const left = back.find((d) => !d.inPage);
  info(s, 'focus after Refresh, Shift+Tab', left ? `${stopKey(left)} (${left.tag})` : 'did not leave');

  // ---- 2. The chips: one stop, arrows move and activate nothing, Space and Enter toggle.
  await fresh(page);
  await page.locator('[role=tabpanel] h1').click();
  const chip0 = await tabTo(page, engine, isChip);
  check(s, 'Tab reaches the pressed chip', chip0 && chip0.name === `All ${total}` && chip0.pressed === 'true', chip0 && stopKey(chip0));
  const before = await chips(page);
  check(s, 'the chips are ONE tab stop (roving tabindex)', before.filter((c) => c.tabindex === '0').length === 1, before.map((c) => `${c.label}:${c.tabindex}`));
  check(s, 'quick filter counts shown', JSON.stringify(before.map((c) => [c.label, Number(c.count)])) === JSON.stringify([['All', t.all], ['Running', t.running], ['Pending', t.pending], ['Failed', t.failed], ['Completed', t.completed]]), before.map((c) => `${c.label} ${c.count}`));
  const moves = [];
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'End', 'Home', 'ArrowLeft']) {
    await page.keyboard.press(key);
    await sleep(30);
    moves.push(`${key}->${(await active(page)).name}`);
  }
  report.focusOrder[s].chipMoves = moves;
  info(s, 'chip focus moves (start All)', moves);
  const afterMoves = await chips(page);
  check(s, 'arrow, Home and End keys activate nothing', JSON.stringify(afterMoves.map((c) => c.pressed)) === JSON.stringify(before.map((c) => c.pressed)) && (await footerText(page)) === `${total} Pods`, { pressed: afterMoves.map((c) => c.pressed), footer: await footerText(page) });
  const rightOnce = await (async () => { await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await sleep(30); return active(page); })();
  check(s, 'ArrowRight from All focuses Running', rightOnce.name === `Running ${t.running}`, stopKey(rightOnce));
  await page.keyboard.press('End');
  await sleep(30);
  const end = await active(page);
  check(s, 'End focuses Completed', end.name === `Completed ${t.completed}`, stopKey(end));
  await page.keyboard.press('Space');
  await sleep(120);
  const afterSpace = await chips(page);
  const focusSpace = await active(page);
  check(s, 'Space toggles aria-pressed on the focused chip', afterSpace.at(-1).pressed === 'true' && afterSpace[0].pressed === 'false' && focusSpace.name === `Completed ${t.completed}`, afterSpace.map((c) => `${c.label}:${c.pressed}`));
  check(s, 'filter chosen: footer reads K of N Pods', (await footerText(page)) === expectedFooter(total, t.completed), await footerText(page));
  check(s, 'still ONE tab stop after choosing', (await chips(page)).filter((c) => c.tabindex === '0').length === 1, (await chips(page)).map((c) => `${c.label}:${c.tabindex}`));
  await page.keyboard.press('Enter');
  await sleep(120);
  const afterEnter = await chips(page);
  check(s, 'Enter on the pressed chip toggles it back (All pressed)', afterEnter.at(-1).pressed === 'false' && afterEnter[0].pressed === 'true' && (await footerText(page)) === `${total} Pods`, afterEnter.map((c) => `${c.label}:${c.pressed}`));
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await sleep(120);
  const afterEnter2 = await chips(page);
  check(s, 'Enter on Running presses it', afterEnter2[1].pressed === 'true' && (await footerText(page)) === expectedFooter(total, t.running), afterEnter2.map((c) => `${c.label}:${c.pressed}`));

  // ---- 3. The search.
  await fresh(page);
  await page.locator('[role=tabpanel] h1').click();
  const field = await tabTo(page, engine, isSearch);
  check(s, 'Tab reaches the search field', Boolean(field) && field.name === 'Search Pods', field && stopKey(field));
  const debounceQ = 'cart';
  const kDebounce = nameMatches(kube, debounceQ);
  await page.keyboard.type(debounceQ, { delay: 25 });
  const tEnd = Date.now();
  await sleep(120);
  check(s, 'typed text is NOT applied at once', (await footerText(page)) === `${total} Pods`, await footerText(page));
  const ms = await waitFooter(page, expectedFooter(total, kDebounce), 1500);
  const applied = ms === null ? null : Date.now() - tEnd;
  check(s, 'typed text is applied ~500 ms after the last key', applied !== null && applied >= 380 && applied <= 900, { appliedAfterMs: applied, footer: await footerText(page), expected: expectedFooter(total, kDebounce) });
  check(s, 'the clear control exists while there is text and is out of the tab order', await page.evaluate(() => { const b = document.querySelector('input[type=search]')?.parentElement?.querySelector('button'); return Boolean(b) && b.tabIndex === -1; }), await page.evaluate(() => { const b = document.querySelector('input[type=search]')?.parentElement?.querySelector('button'); return b ? { name: b.getAttribute('aria-label'), tabindex: b.getAttribute('tabindex') } : null; }));
  check(s, 'Clear filters appears while a search is applied', await page.getByRole('button', { name: 'Clear filters', exact: true }).count() === 1);
  const withText = await walk(page, engine, false);
  report.focusOrder[s].withTextFromSearch = orderOf(withText);
  check(s, 'with text applied: Tab from the search goes to Clear filters then the region, never the clear control', JSON.stringify(orderOf(withText.filter((d) => d.inPage))) === JSON.stringify(['button:Clear filters', 'region:Pods']), orderOf(withText));
  // Escape
  await page.locator('input[type=search]').click();
  await page.evaluate(() => { window.__esc = null; document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc = { prevented: e.defaultPrevented }; }); });
  await page.keyboard.press('Escape');
  const t0 = Date.now();
  const cleared = await waitFooter(page, `${total} Pods`, 600);
  const afterEsc = await search(page);
  check(s, 'Escape clears the text and keeps focus in the field', afterEsc?.value === '' && afterEsc.focused, afterEsc);
  check(s, 'Escape applies the cleared search at once', cleared !== null && cleared < 300, { ms: cleared, footer: await footerText(page) });
  const esc = await page.evaluate(() => window.__esc);
  check(s, 'Escape does not bubble to the shell (document listener not reached)', esc === null, esc === null ? 'not reached' : `reached, defaultPrevented=${esc.prevented}`);
  check(s, 'Clear filters is gone with nothing applied', await page.getByRole('button', { name: 'Clear filters', exact: true }).count() === 0);
  void t0;
  // Enter
  await page.keyboard.type('nightly', { delay: 20 });
  await page.keyboard.press('Enter');
  const kNightly = nameMatches(kube, 'nightly');
  const enterMs = await waitFooter(page, expectedFooter(total, kNightly), 300);
  check(s, 'Enter applies the search at once (< 300 ms, debounce is 500)', enterMs !== null && enterMs < 300, { ms: enterMs, footer: await footerText(page), expected: expectedFooter(total, kNightly) });
  // Clear filters by pointer: focus returns to the field
  await page.getByRole('button', { name: 'Completed', exact: false }).click();
  await sleep(100);
  const toolbarBefore = await chips(page);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await sleep(150);
  const afterClear = await search(page);
  const chipsAfter = await chips(page);
  check(s, 'Clear filters (pointer) returns focus to the search field and clears search and filter', Boolean(afterClear?.focused) && afterClear.value === '' && chipsAfter[0].pressed === 'true' && (await footerText(page)) === `${total} Pods`, { search: afterClear, allPressed: chipsAfter[0].pressed, footer: await footerText(page), chosenBefore: toolbarBefore.filter((c) => c.pressed === 'true').map((c) => c.label) });
  // by keyboard
  await page.keyboard.type('nightly');
  await page.keyboard.press('Enter');
  await sleep(120);
  const nextStop = await press(page, engine, false);
  check(s, 'Tab from the applied search reaches Clear filters', nextStop.name === 'Clear filters', stopKey(nextStop));
  await page.keyboard.press('Enter');
  await sleep(150);
  const afterClearKey = await search(page);
  check(s, 'Clear filters (Enter) returns focus to the search field', Boolean(afterClearKey?.focused) && afterClearKey.value === '' && (await footerText(page)) === `${total} Pods`, { search: afterClearKey, footer: await footerText(page) });
  await page.keyboard.type('nightly');
  await page.keyboard.press('Enter');
  await sleep(120);
  await press(page, engine, false);
  await page.keyboard.press('Space');
  await sleep(150);
  const afterClearSpace = await search(page);
  check(s, 'Clear filters (Space) returns focus to the search field', Boolean(afterClearSpace?.focused) && afterClearSpace.value === '', afterClearSpace);

  // ---- 4. Refresh: reachable, operable, keeps focus, says why it is unavailable.
  await fresh(page);
  await page.locator('[role=tabpanel] h1').click();
  const refresh = await tabTo(page, engine, isRefresh);
  check(s, 'Tab reaches Refresh', Boolean(refresh), refresh && stopKey(refresh));
  const idle = await active(page);
  check(s, 'Refresh is available at rest (no aria-disabled)', idle.ariaDisabled !== 'true' && !idle.disabled, { ariaDisabled: idle.ariaDisabled, disabled: idle.disabled });
  for (const key of ['Enter', 'Space']) {
    await page.keyboard.press(key);
    const samples = [];
    const t1 = Date.now();
    let updatedAt = null;
    let phases = [];
    while (Date.now() - t1 < 4000) {
      const d = await active(page);
      const slot = await slotText(page);
      const phase = slot.includes('Refreshing') ? 'refreshing' : slot.includes('Updated') ? 'updated' : 'idle';
      if (phases.at(-1) !== phase) phases.push(phase);
      samples.push({ phase, d });
      if (phase === 'refreshing' && samples.length === 2) await page.keyboard.press('Enter'); // a second ask while felt is ignored
      if (phase === 'updated') { updatedAt = Date.now() - t1; break; }
      await sleep(25);
    }
    const felt = samples.filter((x) => x.phase === 'refreshing');
    check(s, `${key} operates Refresh: Refreshing… then Updated`, felt.length > 0 && updatedAt !== null && JSON.stringify(phases.filter((p) => p !== 'idle')) === JSON.stringify(['refreshing', 'updated']), { phases, updatedAfterMs: updatedAt });
    check(s, `${key}: Refresh keeps focus while felt`, felt.length > 0 && felt.every((x) => isRefresh(x.d)), felt.length ? [...new Set(felt.map((x) => stopKey(x.d)))] : 'never refreshing');
    check(s, `${key}: Refresh exposes its reason while felt (aria-disabled=true, description "Refreshing")`, felt.length > 0 && felt.every((x) => x.d.ariaDisabled === 'true' && x.d.description === 'Refreshing' && !x.d.disabled), felt.length ? { ariaDisabled: [...new Set(felt.map((x) => x.d.ariaDisabled))], description: [...new Set(felt.map((x) => x.d.description))], disabled: felt.some((x) => x.d.disabled) } : 'never refreshing');
    const settled = await active(page);
    check(s, `${key}: after Updated the focus is still on Refresh and it is available again`, isRefresh(settled) && settled.ariaDisabled !== 'true', { focus: stopKey(settled), ariaDisabled: settled.ariaDisabled, description: settled.description });
    const stopsUpdated = await page.evaluate(() => window.__p.tabStops().map((d) => `${d.role}:${d.name}`));
    info(s, `tab stops of the page while "Updated" shows (after ${key})`, stopsUpdated);
    // wait until Refresh is operable and the toast has not shifted focus: next round
    await sleep(100);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function names(page, engine, s) {
  await fresh(page);
  const kube = readKube();
  const t = tally(kube);
  const snapshot = await page.locator('[role=tabpanel]').ariaSnapshot();
  report.snapshot[s] = snapshot;
  const h1s = await page.evaluate(() => [...document.querySelectorAll('h1')].map((h) => h.textContent));
  check(s, 'one h1 "Pods"', JSON.stringify(h1s) === '["Pods"]', h1s);
  check(s, 'button "Refresh Pods"', (await page.getByRole('button', { name: 'Refresh Pods', exact: true }).count()) === 1);
  const stateGroup = page.getByRole('group', { name: 'Pod state', exact: true });
  check(s, 'group "Pod state"', (await stateGroup.count()) === 1);
  const want = [`All ${t.all}`, `Running ${t.running}`, `Pending ${t.pending}`, `Failed ${t.failed}`, `Completed ${t.completed}`];
  const got = [];
  for (const name of want) got.push([name, await stateGroup.getByRole('button', { name, exact: true }).count()]);
  check(s, 'chips named All N, Running N, Pending N, Failed N, Completed N', got.every(([, n]) => n === 1) && (await stateGroup.getByRole('button').count()) === 5, got);
  const toolbar = page.getByRole('group', { name: 'Search and filter Pods', exact: true });
  check(s, 'group "Search and filter Pods" with searchbox "Search Pods"', (await toolbar.count()) === 1 && (await toolbar.getByRole('searchbox', { name: 'Search Pods', exact: true }).count()) === 1);
  const region = page.getByRole('region', { name: 'Pods', exact: true });
  check(s, 'region "Pods" holding the table', (await region.count()) === 1 && (await region.locator('table').count()) === 1);
  const unnamed = await page.evaluate(() => {
    const root = document.querySelector('[role=tabpanel]');
    const sel = 'button,input,select,textarea,a[href],[role=button],[role=tab],[role=checkbox],[role=switch],[role=progressbar],[role=group],[role=region],[role=searchbox],[role=status]:not(:empty),svg:not([aria-hidden=true])';
    return [...root.querySelectorAll(sel)].filter((el) => !window.__p.nameOf(el) && el.getAttribute('role') !== 'status').map((el) => `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}`);
  });
  check(s, 'every control has a name (buttons, inputs, groups, region, non-hidden svg)', unnamed.length === 0, unnamed);
  info(s, 'the table itself has no accessible name (the region "Pods" names it)', await page.evaluate(() => { const t = document.querySelector('table'); return { name: window.__p.nameOf(t), ariaLabel: t.getAttribute('aria-label'), caption: Boolean(t.querySelector('caption')) }; }));
  const titles = await page.evaluate(() => ({
    page: [...document.querySelector('[role=tabpanel]').querySelectorAll('[title]')].map((e) => e.tagName),
    shell: [...document.querySelectorAll('[title]')].filter((e) => !document.querySelector('[role=tabpanel]').contains(e)).map((e) => e.tagName),
    svgTitle: document.querySelectorAll('svg title').length,
  }));
  check(s, 'no title attribute in the page', titles.page.length === 0 && titles.svgTitle === 0, titles);
  check(s, 'no title attribute in the shell either', titles.shell.length === 0, titles.shell);
  const cellNames = [...snapshot.matchAll(/- row "[^"]*":\n\s+- cell "([^"]*)"/g)].map((m) => m[1]);
  const fulls = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('[data-testid=pod-name]')).map((tr) => { const n = tr.querySelector('[data-testid=pod-name]'); return { full: n.getAttribute('data-ov-full') ?? n.textContent, ns: tr.querySelector('[data-testid=pod-namespace]')?.textContent }; }));
  const split = cellNames.map((c, i) => ({ c, full: fulls[i]?.full })).filter((x) => x.full && !x.c.includes(x.full));
  check(s, 'a Pod name cell is read whole in the accessibility tree (split name halves are joined without a space)', cellNames.length > 0 && split.length === 0, split.length ? { splitRows: split.length, of: cellNames.length, first: split[0] } : { rows: cellNames.length });
  if (engine === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const cells = nodes.filter((n) => n.role?.value === 'cell' && !n.ignored).map((n) => n.name?.value).filter((v) => /-/.test(v ?? ''));
    info(s, "Chromium's own accessibility tree: first Pod name cells (CDP Accessibility.getFullAXTree)", cells.slice(0, 3));
    await cdp.detach();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function runAxe(page) {
  const slotBefore = await slotText(page);
  const found = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({
    id: v.id, impact: v.impact, help: v.help,
    nodes: v.nodes.map((n) => ({ target: n.target.join(' '), inPage: (() => { try { const el = document.querySelector(n.target[0]); return Boolean(el && document.querySelector('[role=tabpanel]').contains(el)); } catch { return null; } })(), html: n.html.slice(0, 110) })),
  }))));
  return { found, slotBefore, slotAfter: await slotText(page) };
}

async function axeSection(page, engine, s) {
  if (!axe) { check(s, 'axe-core found (set AXE=<axe.min.js>)', false, 'not found'); return; }
  await fresh(page);
  await page.addScriptTag({ content: axe.source });
  const kube = readKube();
  const t = tally(kube);
  const total = kube.length;
  const states = [];
  const record = async (name, holds) => {
    const res = await runAxe(page);
    const [ok, measured] = await holds(res);
    check(s, `axe state "${name}" really held`, ok, measured);
    const bad = res.found.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const rest = res.found.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
    check(s, `axe "${name}": zero serious or critical violations`, bad.length === 0, bad.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => `${n.inPage ? 'page' : 'shell'} ${n.target}`) })));
    for (const v of rest) info(s, `axe "${name}": ${v.impact} ${v.id}`, { help: v.help, nodes: v.nodes.length, first: v.nodes.slice(0, 3).map((n) => `${n.inPage ? 'page' : 'shell'} ${n.target} ${n.html}`) });
    states.push({ name, violations: res.found.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) });
  };
  await record('ready', async () => [(await footerText(page)) === `${total} Pods`, await footerText(page)]);
  await page.getByRole('button', { name: `Running ${t.running}`, exact: true }).click();
  await sleep(150);
  await record('filter chosen', async () => [(await footerText(page)) === expectedFooter(total, t.running), await footerText(page)]);
  await page.getByRole('button', { name: `Running ${t.running}`, exact: true }).click();
  await sleep(100);
  await page.locator('input[type=search]').click();
  await page.keyboard.type('cart');
  await sleep(700);
  await record('search with a result', async () => [(await footerText(page)) === expectedFooter(total, nameMatches(kube, 'cart')), await footerText(page)]);
  await page.locator('input[type=search]').fill('');
  await page.locator('input[type=search]').click();
  await page.keyboard.type('zzqxnonsense');
  await sleep(700);
  await record('search with NO result', async () => [(await rowCount(page)) === 0, { rows: await rowCount(page), footer: await footerText(page), view: await page.evaluate(() => document.querySelector('[data-ov-state]')?.getAttribute('data-ov-state')) }]);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await sleep(200);
  await page.getByRole('button', { name: 'Refresh Pods', exact: true }).click();
  await record('during Refresh ("Refreshing…")', async (res) => [res.slotBefore.includes('Refreshing') && res.slotAfter.includes('Refreshing'), { slotBefore: res.slotBefore, slotAfter: res.slotAfter }]);
  await page.waitForFunction(() => document.querySelector('[data-ov-slot]')?.textContent?.includes('Updated'), null, { timeout: 5000 });
  await record('after Refresh ("Updated")', async (res) => [res.slotBefore.includes('Updated') && res.slotAfter.includes('Updated'), { slotBefore: res.slotBefore, slotAfter: res.slotAfter }]);
  report.axe[s] = states;
}

// ---------------------------------------------------------------------------------------------------------------------------
async function counts(page, engine, s) {
  await fresh(page);
  let kube = readKube();
  let got = { footer: await footerText(page), chips: await chips(page) };
  let t = tally(kube);
  const mismatch = () => got.footer !== `${kube.length} Pods` || JSON.stringify(got.chips.map((c) => Number(c.count))) !== JSON.stringify([t.all, t.running, t.pending, t.failed, t.completed]);
  if (mismatch()) { // a Pod may have been created or deleted between the two reads: once more, page first then kubectl
    await sleep(1500);
    await fresh(page);
    got = { footer: await footerText(page), chips: await chips(page) };
    kube = readKube();
    t = tally(kube);
  }
  const statuses = {};
  for (const p of kube) statuses[p.status] = (statuses[p.status] ?? 0) + 1;
  info(s, 'kubectl STATUS words', statuses);
  check(s, '(a) footer reads "N Pods" with N = lines of kubectl get pods -A', got.footer === `${kube.length} Pods`, { footer: got.footer, kubectl: kube.length });
  check(s, '(b) chip counts equal the plan rule applied to kubectl', JSON.stringify(got.chips.map((c) => Number(c.count))) === JSON.stringify([t.all, t.running, t.pending, t.failed, t.completed]), { page: got.chips.map((c) => `${c.label} ${c.count}`), kubectl: t });
  report.counts[s] = { footer: got.footer, chips: got.chips, kubectl: t };
  // a filter chosen: footer "K of N Pods", rows and chips (real pointer)
  for (const [id, label] of [['running', 'Running'], ['pending', 'Pending'], ['failed', 'Failed'], ['completed', 'Completed']]) {
    await page.getByRole('button', { name: new RegExp(`^${label} \\d+$`) }).click();
    await sleep(150);
    const f = await footerText(page);
    const rows = await rowCount(page);
    check(s, `(a) filter ${label}: footer "K of N Pods"`, f === expectedFooter(kube.length, t[id]), { footer: f, expected: expectedFooter(kube.length, t[id]), rowsMounted: rows });
    await page.getByRole('button', { name: new RegExp(`^${label} \\d+$`) }).click();
    await sleep(100);
  }
  // (c) DOM element counts
  const dom = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const d = (el) => (el ? el.querySelectorAll('*').length : null);
    const group = q('[role=group][aria-label^="Search and filter"]');
    const block = q('[data-ov-block=toolbar]');
    const page_ = q('[role=tabpanel]');
    const row = q('tbody tr');
    const tags = (el) => { const m = {}; el.querySelectorAll('*').forEach((e) => { m[e.tagName.toLowerCase()] = (m[e.tagName.toLowerCase()] ?? 0) + 1; }); return m; };
    return {
      pageHeaderDescendants: d(q('[role=tabpanel] header')),
      toolbarChromeElements: block && group ? 1 + d(block) - d(group) : null,
      toolbarBlockDescendants: d(block),
      searchFieldDescendants: d(group),
      footerDescendants: d(q('[data-ov-part=footer]')),
      filtersStripDescendants: d(q('[data-ov-block=filters]')),
      tableRowDescendants: d(row), tableRowElementsWithSelf: row ? d(row) + 1 : null, tableRowTags: row ? tags(row) : null,
      rowsMounted: document.querySelectorAll('tbody tr').length,
      pageElementsWithin: d(page_) + 1, documentElements: document.querySelectorAll('*').length,
      dataViewDescendants: d(q('[data-ov-state]')),
    };
  });
  await page.locator('input[type=search]').click();
  await page.keyboard.type('x');
  const withText = await page.evaluate(() => document.querySelector('[role=group][aria-label^="Search and filter"]').querySelectorAll('*').length);
  report.dom[s] = { ...dom, searchFieldWithText: withText };
  info(s, '(c) DOM element counts as rendered', report.dom[s]);
  check(s, '(c) page header descendants = 7 (unit test)', dom.pageHeaderDescendants === 7, dom.pageHeaderDescendants);
  check(s, '(c) footer descendants = 2 (unit test)', dom.footerDescendants === 2, dom.footerDescendants);
  check(s, '(c) search field = 4, 7 with text (unit test)', dom.searchFieldDescendants === 4 && withText === 7, { rest: dom.searchFieldDescendants, withText });
  check(s, '(c) toolbar chrome = 2 (unit test)', dom.toolbarChromeElements === 2, dom.toolbarChromeElements);
  // (d) every row is reachable through the virtualised region
  await fresh(page);
  const region = page.locator('[role=region][aria-label=Pods]');
  const box = await region.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const seen = new Map();
  const collect = async () => {
    const rows = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].filter((tr) => tr.querySelector('[data-testid=pod-name]')).map((tr) => { const n = tr.querySelector('[data-testid=pod-name]'); return `${tr.querySelector('[data-testid=pod-namespace]')?.textContent}/${n.getAttribute('data-ov-full') ?? n.textContent}`; }));
    for (const r of rows) seen.set(r, true);
    return rows.length;
  };
  let mounted = await collect();
  const mountedMax = { v: mounted };
  let atEnd = false;
  for (let i = 0; i < 80 && !atEnd; i += 1) {
    await page.mouse.wheel(0, 120);
    await sleep(60);
    mounted = await collect();
    mountedMax.v = Math.max(mountedMax.v, mounted);
    atEnd = await region.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  }
  await sleep(150);
  await collect();
  const want = new Set(kube.map((p) => p.key));
  const gotKeys = new Set(seen.keys());
  const missing = [...want].filter((k) => !gotKeys.has(k));
  const extra = [...gotKeys].filter((k) => !want.has(k));
  check(s, '(d) all rows reached by scrolling; set equals kubectl', missing.length === 0 && extra.length === 0 && gotKeys.size === kube.length, { collected: gotKeys.size, kubectl: kube.length, missing, extra, maxMountedAtOnce: mountedMax.v, reachedEnd: atEnd });
  const rowcount = await page.evaluate(() => document.querySelector('table')?.getAttribute('aria-rowcount'));
  check(s, '(d) table aria-rowcount = N + 1 (header)', Number(rowcount) === kube.length + 1, rowcount);
  // keyboard scroll on the focused region
  await region.evaluate((el) => { el.scrollTop = 0; });
  await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
  await page.keyboard.press('End');
  await sleep(1200);
  const end = await region.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
  check(s, '(d) End on the focused region scrolls to the bottom (1.2 s allowed for smooth scroll)', end.top >= end.max - 1 && end.max > 0, end);
}

// ---------------------------------------------------------------------------------------------------------------------------
async function shift(page, engine, s) {
  await fresh(page);
  await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const targets = {
      pageHeader: () => q('[role=tabpanel] header'), quickFilters: () => q('[data-ov-block=filters]'), toolbar: () => q('[data-ov-block=toolbar]'),
      tableHeader: () => q('thead'), firstRow: () => q('tbody tr'), footer: () => q('[data-ov-part=footer]'),
      slot: () => q('[data-ov-slot]'), title: () => { const h = q('[role=tabpanel] h1'); const r = document.createRange(); r.selectNodeContents(h); return r; }, titleBox: () => q('[role=tabpanel] h1'), refresh: () => q('button[aria-label="Refresh Pods"]'),
    };
    const state = { stop: false, frames: [] };
    window.__shift = state;
    const tick = (t) => {
      const rects = {};
      for (const [k, f] of Object.entries(targets)) {
        const el = f();
        if (!el) { rects[k] = null; continue; }
        const r = el.getBoundingClientRect();
        rects[k] = [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 1000) / 1000);
      }
      const slot = q('[data-ov-slot]')?.textContent ?? '';
      state.frames.push({ t, phase: slot.includes('Refreshing') ? 'refreshing' : slot.includes('Updated') ? 'updated' : 'idle', rects });
      if (!state.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await sleep(500);
  await page.getByRole('button', { name: 'Refresh Pods', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-ov-slot]')?.textContent?.includes('Updated'), null, { timeout: 8000 });
  await sleep(1000);
  const frames = await page.evaluate(() => { window.__shift.stop = true; return window.__shift.frames; });
  const required = ['pageHeader', 'quickFilters', 'toolbar', 'tableHeader', 'firstRow', 'footer'];
  const extras = ['title', 'refresh', 'slot', 'titleBox'];
  const first = frames[0].rects;
  const move = (key) => frames.reduce((m, f) => (f.rects[key] && first[key] ? Math.max(m, ...f.rects[key].map((v, i) => Math.abs(v - first[key][i]))) : m), 0);
  const phases = {};
  for (const f of frames) {
    const p = (phases[f.phase] ??= { frames: 0, slot: f.rects.slot, slotConstant: true });
    p.frames += 1;
    if (JSON.stringify(f.rects.slot) !== JSON.stringify(p.slot)) p.slotConstant = false;
  }
  const table = Object.fromEntries([...required, ...extras].map((k) => [k, { rect0: first[k], maxMove: move(k) }]));
  report.shift[s] = { frames: frames.length, phases, movement: table };
  info(s, 'shift: frames per phase and the header slot rectangle [x,y,w,h]', phases);
  for (const k of required) check(s, `shift: ${k} does not move around Refresh`, move(k) === 0, { maxMove: move(k), rect: first[k] });
  for (const k of extras) {
    // the slot box opens from 0 width by design and the title's box gives it room: both are reported, the title's TEXT and Refresh are asserted
    if (k === 'slot' || k === 'titleBox') info(s, `shift: ${k} box (reported, not asserted)`, { maxMove: move(k), rect: first[k] });
    else check(s, `shift: ${k} (extra) does not move around Refresh`, move(k) === 0, { maxMove: move(k), rect: first[k] });
  }
  check(s, 'shift: every phase was sampled (idle, Refreshing…, Updated)', ['idle', 'refreshing', 'updated'].every((p) => phases[p]?.frames > 0), Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, v.frames])));
  check(s, 'shift: the slot rectangle is the same in every frame of idle (stays, empty)', phases.idle?.slotConstant === true, phases.idle?.slot);
}

// ---------------------------------------------------------------------------------------------------------------------------
const runners = { keyboard, names, axe: axeSection, counts, shift };
const errors = [];
for (const engineName of engineNames) {
  const browser = await ENGINES[engineName].launch();
  for (const viewportName of viewportNames) {
    const context = await browser.newContext({ viewport: VIEWPORTS[viewportName] });
    await context.addInitScript(installHelpers);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`[${engineName} ${viewportName}] pageerror: ${String(e).slice(0, 200)}`));
    const scope = `${engineName} ${viewportName}`;
    for (const [name, run] of Object.entries(runners)) {
      if (!sections.has(name)) continue;
      try {
        await run(page, engineName, scope);
      } catch (error) {
        check(scope, `section ${name} ran to the end`, false, String(error?.stack ?? error).split('\n').slice(0, 4).join(' | '));
      }
    }
    await context.close();
  }
  await browser.close();
}
for (const e of errors) info('page', 'uncaught page error', e);
const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.filter((r) => r.ok === true).length} PASS, ${failed.length} FAIL`);
if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify({ report, results }, null, 2));
process.exit(failed.length ? 1 : 0);

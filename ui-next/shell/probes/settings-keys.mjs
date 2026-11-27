// Section `keys` of the Settings probe: the keyboard, with real key presses, in both containers (the sheet, and the Settings window's content, which is the same body under another frame), on the real Settings over a host in memory.
//
//   nav       the expanded tree has one Tab stop. Up/Down, Home and End traverse visible rows without wrapping; Left/Right collapse, expand and move between parent and child. Pages follow focus, branches do not.    keys.nav
//   reach     Tab goes from Close to search to the current tree item and through every control of the page in row order, with no orphan stops.                                                         keys.reach
//   operate   each kind of row works from the keyboard alone: a switch (Space), a whole number (typed, Enter; the arrow steps), a text (typed, Enter, asked of the host first), a secret (typed, Enter, said Saved and shown
//             nowhere), Reset (Enter, and the focus goes to the row's control), Retry (Enter, after a refused save)                                                                    keys.operate
//   select    the kit's Select is the engine's own: type-ahead picks a value inside the dialog and applies it                                                                           keys.select
//   draft     what a page change does to what a person typed (S125: apply on change, and no draft outlives its field): a draft that is valid is applied when the focus
//             leaves the field (the press on another page), and one the host refused is gone when the page is come back to: the field shows what the host applied                           keys.draft
import {
  check,
  fail,
  goToPage,
  note,
  openSettings,
  round,
  sleep,
  WHO,
  wants,
  PAGES,
  plant,
} from './settings-lib.mjs';

const NAV = '[data-settings-part="tree"] [role="treeitem"]';
const SEARCH = 'input[data-settings-part="search"]';
const PLUGIN = { id: 'plugin/acme', title: 'Acme Resources' };
const SENTINEL = 'sk-probe-7f3a9c1e5b2d4086';
const CONTAINERS = ['sheet', 'window'];

const whereOf = (env, container) => `${env.engine}@${container === 'window' ? 'preferred' : env.viewportName} ${container}`;
const selectAll = async (page) => page.keyboard.press((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+a' : 'Control+a');
const commits = (page) => page.evaluate(() => window.__host.calls.commit);
const waitCommits = (page, count) => page.waitForFunction((n) => window.__host.calls.commit.length >= n, count, { timeout: 4000 }).catch(() => undefined);

// ---------------------------------------------------------------------------------------------------------------------------
async function navPart(env, container) {
  const where = whereOf(env, container);
  const { page, context } = await openSettings(env, container, { plugins: 'installed' });
  try {
    await page.locator(`${NAV}[data-settings-page="${PLUGIN.id}"]`).waitFor();
    await plant(env, page);
    const readTree = () => page.$$eval(NAV, (items) => {
      const visible = items.filter((item) => item.getClientRects().length > 0);
      const id = (item) => item?.dataset.settingsPage ?? item?.dataset.settingsBranch;
      return {
        ids: visible.map(id), stops: visible.filter((item) => item.tabIndex === 0).map(id),
        focus: id(document.activeElement) ?? document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName,
        current: visible.filter((item) => item.matches('[aria-current="page"]')).map(id),
        expanded: Object.fromEntries(visible.filter((item) => item.hasAttribute('data-settings-branch')).map((item) => [id(item), item.getAttribute('aria-expanded')])),
        page: document.querySelector('[data-settings-part="page"]')?.dataset.settingsPageId,
      };
    });
    const all = ['core', ...PAGES.map(({ id }) => id), 'plugins', PLUGIN.id];
    const initial = await readTree();
    check(initial.ids.join() === all.join(), where, 'keys.nav', `the expanded tree contains ${initial.ids.join(', ')}, wanted ${all.join(', ')}`);
    const position = (tree, key, focus, content) => {
      check(tree.focus === focus && tree.stops.length === 1 && tree.stops[0] === focus, where, 'keys.nav', `${key}: focus ${tree.focus}, tree Tab stops ${tree.stops.join(', ')}, wanted ${focus} alone`);
      check(tree.page === content, where, 'keys.nav', `${key}: the page is ${tree.page}, wanted ${content}`);
      const current = tree.ids.includes(content) ? [content] : [];
      check(tree.current.join() === current.join(), where, 'keys.nav', `${key}: current visible page ${tree.current.join(', ') || 'none'}, wanted ${current.join(', ') || 'none'}`);
    };
    position(initial, 'on open', 'appearance', 'appearance');
    // Report opening focus independently from the keyboard walk: Enter on Close would discard the entire sheet.
    if (initial.focus !== 'appearance') await page.locator(`${NAV}[data-settings-page="appearance"]`).focus();
    const press = async (key, focus, content = focus) => {
      await page.keyboard.press(key);
      const tree = await readTree();
      position(tree, key, focus, content);
      return tree;
    };
    await press('ArrowDown', 'general');
    await press('Home', 'core', 'general');
    await press('ArrowUp', 'core', 'general');
    const closedCore = await press('ArrowLeft', 'core', 'general');
    check(closedCore.expanded.core === 'false' && closedCore.ids.join() === ['core', 'plugins', PLUGIN.id].join(), where, 'keys.nav', 'collapsing Core did not hide just its pages');
    const openCore = await press('ArrowRight', 'core', 'general');
    check(openCore.expanded.core === 'true' && openCore.ids.join() === all.join(), where, 'keys.nav', 'expanding Core did not restore its pages');
    await press('ArrowRight', 'appearance');
    await press('End', PLUGIN.id);
    await press('ArrowDown', PLUGIN.id);
    await press('ArrowLeft', 'plugins', PLUGIN.id);
    const closedPlugins = await press('ArrowLeft', 'plugins', PLUGIN.id);
    check(closedPlugins.expanded.plugins === 'false' && closedPlugins.ids.join() === all.slice(0, -1).join(), where, 'keys.nav', 'collapsing Plugins did not hide just its installed page');
    const openPlugins = await press('Space', 'plugins', PLUGIN.id);
    check(openPlugins.expanded.plugins === 'true' && openPlugins.ids.join() === all.join(), where, 'keys.nav', 'Space did not reopen Plugins');
    await press('Home', 'core', PLUGIN.id);
    for (const id of ['appearance', 'general', 'editor', 'terminal']) await press('ArrowDown', id);
    await press('Enter', 'terminal');
    await press('ArrowUp', 'editor');
    await press('Space', 'editor');
    await page.keyboard.press(env.keys.forward);
    const inRow = await page.evaluate(() => document.activeElement?.closest('[data-settings-row]')?.dataset.settingsRow);
    check(inRow === 'editor.folding', where, 'keys.nav', `Tab from the tree went to ${inRow ?? await page.evaluate(WHO)}, wanted the first row's control (editor.folding)`);
    const search = page.locator(SEARCH);
    if (!await search.isVisible()) return fail(where, 'keys.nav', 'Settings search is not visible after the tree keyboard walk');
    await search.fill('Refresh resource watches');
    const hit = page.locator(`[data-settings-result-page="${PLUGIN.id}"][data-settings-result-field="watch.autoRefresh"]`);
    check(await hit.isVisible() && (await readTree()).page === 'editor', where, 'keys.nav', 'search must offer the installed plugin setting without navigating away while typing');
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/** The Tab stops of the container, in document order, kept on the window; and which row each belongs to. Runs in the page. */
const MARK = (rootSelector) => {
  const root = document.querySelector(rootSelector);
  // A radio group contributes its chosen radio, not every radio, to the tab sequence.
  const chosenRadio = (element) => !element.matches('input[type="radio"], [role="radio"]') || element.matches(':checked, [aria-checked="true"]');
  const stops = [...root.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]')].filter((element) => element.getAttribute('tabindex') !== '-1' && !element.matches(':disabled') && (!element.matches('input[type="radio"]') || chosenRadio(element)) && element.getClientRects().length > 0);
  window.__tabStops = stops;
  return {
    names: stops.map((element) => (element.getAttribute('aria-label') ?? element.labels?.[0]?.textContent ?? element.textContent ?? element.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)),
    rows: stops.map((element) => element.closest('[data-settings-row]')?.getAttribute('data-settings-row') ?? null),
    search: stops.findIndex((element) => element.matches('input[data-settings-part="search"]')),
    tree: stops.flatMap((element, index) => element.matches('[role="treeitem"]') ? [[index, element.getAttribute('data-settings-page')]] : []),
    reset: stops.findIndex((element) => element.matches('[data-settings-part="reset-material"]')),
    // The controls each row has, which must all be among the stops: the steppers of a number field are not, by design (the field is one stop and the arrows step it, as the mock's `oneStop`); they are read apart and must stay out.
    rowControls: [...root.querySelectorAll('[data-settings-row]')].map((row) => ({
      id: row.getAttribute('data-settings-row'),
      controls: [...row.querySelectorAll('input:not([type="hidden"]), select, button:not([data-ov-slot="decrease"]):not([data-ov-slot="increase"]), textarea, [role="switch"]')].filter((element) => chosenRadio(element) && element.getClientRects().length > 0).map((element) => stops.indexOf(element)),
    })),
    steppers: [...root.querySelectorAll('[data-ov-slot="decrease"], [data-ov-slot="increase"]')].map((element) => stops.includes(element)),
  };
};

async function reachPart(env, container) {
  const where = whereOf(env, container);
  const root = container === 'sheet' ? 'dialog[open]' : '[data-settings-part="window"]';
  const { page, context } = await openSettings(env, container, { plugins: 'installed', values: JSON.stringify({ 'terminal.cursorBlink': false }) });
  try {
    await plant(env, page);
    let controls = 0;
    for (const entry of [...PAGES, PLUGIN]) {
      await goToPage(page, entry.id);
      await sleep(60);
      const here_ = `${where} ${entry.id}`;
      const mark = await page.evaluate(MARK, root);
      check(mark.names[0] === 'Close' && mark.search === 1 && JSON.stringify(mark.tree) === JSON.stringify([[2, entry.id]]), here_, 'keys.reach', `the first Tab stops are ${JSON.stringify(mark.names.slice(0, 3))}, wanted Close, search and the current ${entry.title} tree item`);
      // Each field has a tab stop. The material reset is the sole page action outside a setting row.
      const missing = mark.rowControls.filter((row) => row.controls.length === 0 || row.controls.includes(-1));
      check(missing.length === 0, here_, 'keys.reach', `the rows ${missing.map((row) => row.id).join(', ')} have a control that is not a Tab stop`);
      if (entry.id === 'appearance') {
        check(mark.reset === mark.names.length - 1 && mark.rows[mark.reset - 1] === 'appearance.sheetOpacity', here_, 'keys.reach', 'Reset material settings is not the final Tab stop after Surface opacity');
      }
      const orphans = mark.rows.slice(3).filter((id, index) => id === null && (entry.id !== 'appearance' || mark.reset !== index + 3));
      check(orphans.length === 0, here_, 'keys.reach', `${orphans.length} Tab stops belong to no row`);
      check(mark.steppers.every((isStop) => !isStop), here_, 'keys.reach', 'a stepper of a number field is a Tab stop of its own: the field is one stop and the arrows step it');
      const order = mark.rowControls.flatMap((row) => row.controls);
      check(JSON.stringify(order) === JSON.stringify([...order].sort((a, b) => a - b)), here_, 'keys.reach', 'the rows\' controls are not in the order of the rows');
      // And Tab really goes through them, one after the other, from Close.
      await page.evaluate((selector) => (selector === 'dialog[open]' ? document.querySelector('dialog [data-ov-part="close"]') : document.querySelector('[data-settings-part="caption"] button')).focus(), root);
      const seen = [];
      for (let index = 1; index < mark.names.length; index += 1) {
        await page.keyboard.press(env.keys.forward);
        seen.push(await page.evaluate(() => window.__tabStops.indexOf(document.activeElement)));
      }
      check(JSON.stringify(seen) === JSON.stringify(Array.from({ length: mark.names.length - 1 }, (_, index) => index + 1)), here_, 'keys.reach', `Tab went ${seen.join(', ')} from Close, wanted every stop in order (1 to ${mark.names.length - 1})`);
      controls += mark.names.length;
    }
    note('keys', `stops ${where}`, controls);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function operatePart(env, container) {
  const where = whereOf(env, container);
  const { page, context } = await openSettings(env, container);
  try {
    await plant(env, page);
    await goToPage(page, 'terminal');
    // A switch: Space applies, Space again puts it back; the row then says it differs from its default, and Reset (Enter) puts it back and gives the keyboard to the row's control.
    const blink = page.getByRole('switch', { name: 'Cursor Blink' });
    await blink.focus();
    await page.keyboard.press('Space');
    await waitCommits(page, 1);
    check(JSON.stringify(await commits(page)) === JSON.stringify([{ 'terminal.cursorBlink': false }]) && (await blink.getAttribute('aria-checked')) === 'false', where, 'keys.operate', `Space on the switch sent ${JSON.stringify(await commits(page))}, wanted {terminal.cursorBlink: false}`);
    const reset = page.getByRole('button', { name: 'Reset Cursor Blink to default' });
    const resets = await reset.count();
    check(resets === 1, where, 'keys.operate', 'a switch that differs from its default has no Reset');
    if (resets === 1) {
      await reset.focus();
      await page.keyboard.press('Enter');
      await waitCommits(page, 2);
      check((await blink.getAttribute('aria-checked')) === 'true' && (await reset.count()) === 0, where, 'keys.operate', 'Reset (Enter) did not put the switch back and take itself away');
      check((await page.evaluate(WHO)) === 'Cursor Blink', where, 'keys.operate', `after Reset the keyboard is on ${await page.evaluate(WHO)}, wanted the row's control: a button that goes takes the focus with it`);
    }
    // A whole number: typed and committed with Enter, and the arrow steps it.
    const size = page.getByRole('spinbutton', { name: 'Font Size' });
    await size.focus();
    await selectAll(page);
    await page.keyboard.type('14');
    await page.keyboard.press('Enter');
    await waitCommits(page, 3);
    const last = (await commits(page)).at(-1);
    check(JSON.stringify(last) === JSON.stringify({ 'terminal.fontSize': 14 }), where, 'keys.operate', `Enter in the number field sent ${JSON.stringify(last)}, wanted {terminal.fontSize: 14}`);
    await page.keyboard.press('ArrowUp');
    await waitCommits(page, 4);
    check((await size.inputValue()) === '15', where, 'keys.operate', `ArrowUp on 14 gives ${await size.inputValue()}, wanted 15`);
    // A text: typed, asked of the host, applied, said Saved.
    const shell = page.getByRole('textbox', { name: 'Default Shell' });
    await shell.focus();
    await selectAll(page);
    await page.keyboard.type('/bin/fish');
    await page.keyboard.press('Enter');
    await waitCommits(page, 5);
    const asked = await page.evaluate(() => window.__host.calls.validate.at(-1));
    check(JSON.stringify(asked) === JSON.stringify(['terminal.defaultShell', '/bin/fish']) && JSON.stringify((await commits(page)).at(-1)) === JSON.stringify({ 'terminal.defaultShell': '/bin/fish' }), where, 'keys.operate', `Enter in the text field asked ${JSON.stringify(asked)} and sent ${JSON.stringify((await commits(page)).at(-1))}`);
    // Retry: a save the host refuses is said on the row with Retry, which the keyboard can press.
    await page.evaluate(() => {
      window.__host.next.commit = async () => {
        throw new Error('refused');
      };
    });
    await blink.focus();
    await page.keyboard.press('Space');
    const retry = page.locator('[data-settings-row="terminal.cursorBlink"] [data-ov-part="lane"] button');
    await retry.waitFor({ timeout: 4000 }).catch(() => undefined);
    check((await retry.count()) === 1, where, 'keys.operate', 'a refused save has no Retry on its row');
    if ((await retry.count()) === 1) {
      await retry.focus();
      const before = (await commits(page)).length;
      await page.keyboard.press('Enter');
      await waitCommits(page, before + 1);
      check((await commits(page)).length === before + 1 && (await retry.count()) === 0, where, 'keys.operate', 'Retry (Enter) did not send the save again and clear the message');
    }
  } finally {
    await context.close();
  }
}

async function secretPart(env) {
  const where = `${env.engine}@${env.viewportName} sheet`;
  const { page, context } = await openSettings(env, 'sheet');
  try {
    await plant(env, page);
    await goToPage(page, 'telemetry');
    const secret = page.locator('[data-settings-row="telemetry.loki_auth_value"] input');
    check((await secret.getAttribute('placeholder')) === 'Not set', where, 'keys.operate', `a secret the host does not hold says ${JSON.stringify(await secret.getAttribute('placeholder'))}, wanted Not set`);
    await secret.focus();
    await page.keyboard.type(SENTINEL);
    await page.keyboard.press('Enter');
    await waitCommits(page, 1);
    check(JSON.stringify((await commits(page)).at(-1)) === JSON.stringify({ 'telemetry.loki_auth_value': SENTINEL }), where, 'keys.operate', `Enter in the secret field sent ${JSON.stringify((await commits(page)).at(-1))?.replace(SENTINEL, '<the value>')}`);
    check((await secret.getAttribute('placeholder')) === 'Saved · hidden' && (await secret.inputValue()) === '', where, 'keys.operate', `after Enter the secret says ${JSON.stringify(await secret.getAttribute('placeholder'))} and holds ${(await secret.inputValue()) === '' ? 'nothing' : 'a value'}, wanted Saved · hidden and nothing`);
    const page_ = await page.evaluate((value) => ({ html: document.documentElement.outerHTML.includes(value), text: document.body.innerText.includes(value) }), SENTINEL);
    check(!page_.html && !page_.text, where, 'keys.operate', 'the typed secret is in the page after it was saved');
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function selectPart(env, container) {
  const where = whereOf(env, container);
  const { page, context } = await openSettings(env, container);
  try {
    await plant(env, page);
    await goToPage(page, 'terminal');
    const style = page.getByRole('combobox', { name: 'Cursor Style' });
    await style.focus();
    check((await style.inputValue()) === 'block', where, 'keys.select', `Cursor Style starts at ${await style.inputValue()}, wanted block`);
    // Type-ahead picks a value, in the dialog as anywhere (the engine's popup is the OS's; the value is read).
    await page.keyboard.type('u');
    await waitCommits(page, 1);
    check((await style.inputValue()) === 'underline' && JSON.stringify(await commits(page)) === JSON.stringify([{ 'terminal.cursorStyle': 'underline' }]), where, 'keys.select', `typing u in Cursor Style gives ${await style.inputValue()} and sent ${JSON.stringify(await commits(page))}, wanted underline, applied at once`);
    check((await page.evaluate(() => window.__host.calls.validate.length)) === 0, where, 'keys.select', 'a chosen value was asked of the host before it was applied: the host\'s own options need no check');
    if (container === 'sheet') check((await page.evaluate(() => document.querySelectorAll('dialog[open]').length)) === 1, where, 'keys.select', 'the key closed the sheet');
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function draftPart(env) {
  const where = `${env.engine}@${env.viewportName} sheet`;
  const { page, context } = await openSettings(env, 'sheet');
  try {
    await plant(env, page);
    // A valid draft: the press on another page takes the focus out of the field, which applies it (apply on change: a value applies when it is committed, on Enter or when the focus leaves).
    await goToPage(page, 'terminal');
    const shell = page.getByRole('textbox', { name: 'Default Shell' });
    await shell.click();
    await page.keyboard.type('x');
    await page.locator(`${NAV}[data-settings-page="editor"]`).click();
    await waitCommits(page, 1);
    check(JSON.stringify(await commits(page)) === JSON.stringify([{ 'terminal.defaultShell': '/bin/zshx' }]), where, 'keys.draft', `leaving a page with a valid draft sent ${JSON.stringify(await commits(page))}, wanted {terminal.defaultShell: /bin/zshx}: the draft is applied when the focus leaves`);
    await goToPage(page, 'terminal');
    check((await page.getByRole('textbox', { name: 'Default Shell' }).inputValue()) === '/bin/zshx', where, 'keys.draft', 'the applied value is not what the page shows when it is come back to');
    // A draft the host refuses stays in its field with its error while the page is on screen, and does not outlive its field (S125): the page is entered from what the host applied.
    await goToPage(page, 'developer');
    await page.evaluate(() => {
      window.__host.next.validate = () => ({ valid: false, code: 'port_range', message: 'Enter a whole-number port from 0 to 65535.' });
    });
    const port = page.getByRole('spinbutton', { name: 'Host profiling port' });
    await port.click();
    await selectAll(page);
    await page.keyboard.type('70000');
    await page.keyboard.press('Enter');
    await sleep(200);
    check((await port.inputValue()) === '70000' && (await port.getAttribute('aria-invalid')) === 'true', where, 'keys.draft', `the host's refusal left the field ${JSON.stringify(await port.inputValue())} (invalid ${await port.getAttribute('aria-invalid')}), wanted 70000 with its error`);
    const sent = (await commits(page)).length;
    await goToPage(page, 'terminal');
    await goToPage(page, 'developer');
    await sleep(120);
    const again = page.getByRole('spinbutton', { name: 'Host profiling port' });
    const lane = await again.evaluate((element) => (element.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
    check((await again.inputValue()) === '6060' && (await again.getAttribute('aria-invalid')) !== 'true' && !/whole-number port/.test(lane), where, 'keys.draft', `a draft the host refused is ${JSON.stringify(await again.inputValue())} (invalid ${await again.getAttribute('aria-invalid')}, lane ${JSON.stringify(lane)}) after the page was left and come back to, wanted the applied 6060 with no error: no draft outlives its field (S125)`);
    check((await commits(page)).length === sent, where, 'keys.draft', 'leaving the page with a refused draft sent it again');
    // Escape takes the applied value back from a draft that is on screen.
    await again.click();
    await selectAll(page);
    await page.keyboard.type('70000');
    await sleep(100);
    await page.keyboard.press('Escape');
    check((await again.inputValue()) === '6060', where, 'keys.draft', `Escape in the field gives ${await again.inputValue()}, wanted the applied 6060`);
  } finally {
    await context.close();
  }
}

/** Runs the parts of the section `keys` for one engine and viewport; the window container's own are run once for an engine, with the first viewport. */
export async function keysSection(env) {
  const timed = async (part, run) => {
    const from = Date.now();
    await run();
    note('keys', `seconds ${env.engine}@${env.viewportName} ${part}`, round((Date.now() - from) / 1000));
  };
  for (const container of CONTAINERS) {
    if (container === 'window' && !env.first) continue;
    if (wants(env, 'nav')) await timed(`nav ${container}`, async () => navPart(env, container));
    if (wants(env, 'reach')) await timed(`reach ${container}`, async () => reachPart(env, container));
    if (wants(env, 'operate')) await timed(`operate ${container}`, async () => operatePart(env, container));
    if (wants(env, 'select')) await timed(`select ${container}`, async () => selectPart(env, container));
  }

  if (wants(env, 'operate')) await timed('secret', async () => secretPart(env));
  if (wants(env, 'draft')) await timed('draft', async () => draftPart(env));
}

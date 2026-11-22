// Section `keys` of the Settings probe: the keyboard, with real key presses, in both containers (the sheet, and the Settings window's content, which is the same body under another frame), on the real Settings over a host in memory.
//
//   nav       the pages are a list of buttons that is ONE Tab stop (the page on screen); the arrows, Home and End move the focus between them and stop at the ends (the kit's roving group: `Nav.tsx`); the arrows choose nothing,
//             Enter and Space choose the page that has the focus, and the focus stays on it                                                                                           keys.nav
//   reach     on every page, Tab goes from Close to the page on screen and then through the controls of every row in the order of the page, and every control a row has is a Tab stop and none else is: no control that cannot be
//             reached, no stop that belongs to no row                                                                                                                                 keys.reach
//   operate   each kind of row works from the keyboard alone: a switch (Space), a whole number (typed, Enter; the arrow steps), a text (typed, Enter, asked of the host first), a secret (typed, Enter, said Saved and shown
//             nowhere), Reset (Enter, and the focus goes to the row's control), Retry (Enter, after a refused save)                                                                    keys.operate
//   select    the kit's Select is the engine's own: type-ahead picks a value inside the dialog and applies it                                                                           keys.select
//   draft     what a page change does to what a person typed (docs/ui-next/status/ST1.md and the form model: apply on change, a value the host refuses stays with its error): a draft that is valid is applied when the focus
//             leaves the field (the press on another page), and one the host refused stays in its field with its error when the page is left and come back to                           keys.draft
import {
  check,
  fail,
  goToPage,
  note,
  openFixture,
  openSheet,
  round,
  sleep,
  WHO,
  WINDOW_SIZES,
  wants,
  PAGES,
  plant,
} from './settings-lib.mjs';

const enc = (value) => encodeURIComponent(JSON.stringify(value));
const NAV = '[data-settings-part="nav"] button';
const SENTINEL = 'sk-probe-7f3a9c1e5b2d4086';
const CONTAINERS = ['sheet', 'window'];

/** The Settings of a container, open on its first page: the sheet over the shell, or the window's own content. */
async function open(env, container, query = 'case=sheet') {
  if (container === 'sheet') {
    const opened = await openFixture(env, query);
    await openSheet(opened.page);
    return opened;
  }

  const opened = await openFixture(env, `case=window&request=${enc({ requestId: 1, target: '/settings?category=appearance', visible: true })}`, { viewport: WINDOW_SIZES['1060x640'] });
  await opened.page.waitForSelector('[data-settings-part="window"][data-visible="true"] [data-settings-row]', { timeout: 10_000 });
  return opened;
}

const whereOf = (env, container) => `${env.engine}@${container === 'window' ? '1060x640' : env.viewportName} ${container}`;
const current = (page) => page.evaluate(() => document.querySelector('[data-settings-part="nav"] [aria-current="page"]')?.textContent ?? null);
const region = (page) => page.evaluate(() => document.querySelector('[data-settings-part="page"]')?.getAttribute('aria-label') ?? null);
const selectAll = async (page) => page.keyboard.press((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+a' : 'Control+a');
const commits = (page) => page.evaluate(() => window.__host.calls.commit);
const waitCommits = (page, count) => page.waitForFunction((n) => window.__host.calls.commit.length >= n, count, { timeout: 4000 }).catch(() => undefined);

// ---------------------------------------------------------------------------------------------------------------------------
async function navPart(env, container) {
  const where = whereOf(env, container);
  const { page, context } = await open(env, container);
  try {
    await plant(env, page);
    const stops = await page.$$eval(NAV, (buttons) => buttons.map((button) => [button.textContent, button.tabIndex]));
    check(stops.length === 6 && stops[0][1] === 0 && stops.slice(1).every(([, tabIndex]) => tabIndex === -1), where, 'keys.nav', `the pages' tab indexes are ${JSON.stringify(stops.map(([, index]) => index))}, wanted the page on screen alone in the Tab order`);
    check((await page.evaluate(WHO)) === 'Appearance', where, 'keys.nav', `the keyboard starts on ${await page.evaluate(WHO)}, wanted the page on screen`);
    const press = async (key, expectedFocus, why) => {
      await page.keyboard.press(key);
      check((await page.evaluate(WHO)) === expectedFocus, where, 'keys.nav', `${why}: the focus is on ${await page.evaluate(WHO)}, wanted ${expectedFocus}`);
    };
    await press('ArrowDown', 'General', 'ArrowDown from the first page');
    check((await current(page)) === 'Appearance' && (await region(page)) === 'Appearance', where, 'keys.nav', `an arrow chose a page: ${await current(page)} is on screen, the arrows only move the focus`);
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('ArrowDown');
    await press('ArrowDown', 'Developer Settings', 'ArrowDown to the last page');
    await press('ArrowDown', 'Developer Settings', 'ArrowDown past the last page (it does not wrap)');
    await press('Home', 'Appearance', 'Home');
    await press('ArrowUp', 'Appearance', 'ArrowUp past the first page (it does not wrap)');
    await press('End', 'Developer Settings', 'End');
    // Enter chooses the page that has the focus, and the focus stays on its button, which is now the Tab stop.
    await press('Home', 'Appearance', 'Home');
    for (let index = 0; index < 3; index += 1) await page.keyboard.press('ArrowDown');
    await press('Enter', 'Terminal', 'Enter on Terminal');
    check((await current(page)) === 'Terminal' && (await region(page)) === 'Terminal', where, 'keys.nav', `Enter on Terminal shows ${await current(page)} (region ${await region(page)})`);
    const after = await page.$$eval(NAV, (buttons) => buttons.map((button) => button.tabIndex));
    check(after.filter((index) => index === 0).length === 1 && after[3] === 0, where, 'keys.nav', `after Enter the Tab stop is ${JSON.stringify(after)}, wanted the chosen page alone`);
    await press('ArrowUp', 'Editor', 'ArrowUp from Terminal');
    await press('Space', 'Editor', 'Space on Editor');
    check((await current(page)) === 'Editor' && (await region(page)) === 'Editor', where, 'keys.nav', `Space on Editor shows ${await current(page)}`);
    // Tab leaves the list for the first control of the page.
    await page.keyboard.press(env.keys.forward);
    const inRow = await page.evaluate(() => document.activeElement?.closest('[data-settings-row]')?.getAttribute('data-settings-row') ?? null);
    check(inRow === 'editor.folding', where, 'keys.nav', `Tab from the list went to ${inRow ?? await page.evaluate(WHO)}, wanted the first row's control (editor.folding)`);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/** The Tab stops of the container, in document order, kept on the window; and which row each belongs to. Runs in the page. */
const MARK = (rootSelector) => {
  const root = document.querySelector(rootSelector);
  const stops = [...root.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]')].filter((element) => element.getAttribute('tabindex') !== '-1' && !element.matches(':disabled') && element.getClientRects().length > 0);
  window.__tabStops = stops;
  return {
    names: stops.map((element) => (element.getAttribute('aria-label') ?? element.labels?.[0]?.textContent ?? element.textContent ?? element.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)),
    rows: stops.map((element) => element.closest('[data-settings-row]')?.getAttribute('data-settings-row') ?? null),
    // The controls each row has, which must all be among the stops: the steppers of a number field are not, by design (the field is one stop and the arrows step it, as the mock's `oneStop`); they are read apart and must stay out.
    rowControls: [...root.querySelectorAll('[data-settings-row]')].map((row) => ({
      id: row.getAttribute('data-settings-row'),
      controls: [...row.querySelectorAll('input:not([type="hidden"]), select, button:not([data-ov-slot="decrease"]):not([data-ov-slot="increase"]), textarea, [role="switch"]')].filter((element) => element.getClientRects().length > 0).map((element) => stops.indexOf(element)),
    })),
    steppers: [...root.querySelectorAll('[data-ov-slot="decrease"], [data-ov-slot="increase"]')].map((element) => stops.includes(element)),
  };
};

async function reachPart(env, container) {
  const where = whereOf(env, container);
  const root = container === 'sheet' ? 'dialog[open]' : '[data-settings-part="window"]';
  const { page, context } = await open(env, container, `case=sheet&values=${enc({ 'terminal.cursorBlink': false })}`);
  try {
    await plant(env, page);
    let controls = 0;
    for (const entry of PAGES) {
      await goToPage(page, entry.id);
      await sleep(60);
      const here_ = `${where} ${entry.id}`;
      const mark = await page.evaluate(MARK, root);
      check(mark.names[0] === 'Close' && mark.names[1] === entry.title, here_, 'keys.reach', `the first Tab stops are ${JSON.stringify(mark.names.slice(0, 2))}, wanted Close and ${entry.title}`);
      // Every row's controls are stops, in the order of the rows, and every stop after the page on screen is some row's.
      const missing = mark.rowControls.filter((row) => row.controls.length === 0 || row.controls.includes(-1));
      check(missing.length === 0, here_, 'keys.reach', `the rows ${missing.map((row) => row.id).join(', ')} have a control that is not a Tab stop`);
      const orphans = mark.rows.slice(2).filter((id) => id === null);
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
  const { page, context } = await open(env, container);
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
  const { page, context } = await open(env, 'sheet');
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
  const { page, context } = await open(env, container);
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
  const { page, context } = await open(env, 'sheet');
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
    // A draft the host refuses stays in its field with its error: the form lives as long as the sheet, and the page only draws it.
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
    check((await again.inputValue()) === '70000' && (await again.getAttribute('aria-invalid')) === 'true' && /whole-number port/.test(lane), where, 'keys.draft', `a draft the host refused is ${JSON.stringify(await again.inputValue())} (invalid ${await again.getAttribute('aria-invalid')}) after the page was left and come back to, wanted 70000 with the host's words`);
    check((await commits(page)).length === sent, where, 'keys.draft', 'leaving the page with a refused draft sent it again');
    // Escape takes the applied value back.
    await again.focus();
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

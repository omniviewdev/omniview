// Section `sheet` of the Settings probe: the SHEET, the container Settings has where there are no native windows (a browser: server mode), over the window's shell in the page of the fixture, with the product's own control, gear, chord and
// lazy chunk. The kit's `Sheet` part has a probe of its own (the part on the kit's parts page, which an earlier agent wrote outside the repository: ST1-assets/sheet-part-probe.mjs); its checks that still apply to the real Settings are
// folded in here, with the Settings' own: what the sheet is when it is Settings.
//
//   closed   at load nothing of Settings is in the document but the gear and the chord's listener: no dialog, no node of the sheet                                                                 sheet.closed
//   open     the platform's chord, the web chord and the gear each open ONE modal dialog named Settings; the chord with Shift does not; asking again while it is open does nothing                  sheet.open
//   modal    the dialog is modal (`:modal`), the keyboard is inside it on the page on screen, and the page behind refuses the focus                                                                sheet.modal
//   frame    the dialog covers the window; the centred frame prefers 1280 x 800, with a 41 px header, 24 px Close, and the mock's two islands, gutter and form width                               sheet.frame
//   clamp    the browser always leaves at least 24 px on each side; narrower pages fit their pane and the narrowest layout stacks navigation above content                                          sheet.clamp
//   paint    the frame's fill, edge, text, shadow and radius are the tokens they name, nothing is drawn over the page (no veil), nothing moves                                                   sheet.paint
//   trap     Tab and Shift+Tab cycle through the controls of the page in the order of the document and never leave the dialog                                                                    sheet.trap
//   scrim    a press outside the frame leaves the sheet open, and Tab then goes on inside it                                                                                                   sheet.scrim
//   draft    Escape in a field with a draft puts the applied value back and closes nothing; the next Escape closes                                                                                sheet.draft
//   escape   Escape closes it, and the focus is back on the control that opened it (the gear), not on the body                                                                                    sheet.escape
//   close    Close closes it and gives the focus back; a sheet opened with the chord from a field gives it back to the field                                                                      sheet.close
//   keep     reopened, it is on the page it was left on, the host's values are kept, and what was typed and not applied is gone                                                                     sheet.keep
//   tip      a tooltip opened inside the sheet is shown above the dialog and is not inert (the Reset of a modified row)                                                                      sheet.tip
import { check, chordOf, fail, goToPage, near, note, openFixture, openSheet, plant, round, sleep, wants } from './settings-lib.mjs';

const GEAR = '[data-shell-part="settings"]';
const enc = (value) => encodeURIComponent(JSON.stringify(value));
const MODIFIED = `case=sheet&values=${enc({ 'terminal.cursorBlink': false })}`;

/** What the page says now: the dialogs, the one that is open and modal, where the focus is. Runs in the page. */
const READ = () => {
  const dialogs = [...document.querySelectorAll('dialog')];
  const open = dialogs.filter((dialog) => dialog.open);
  const dialog = open[0] ?? null;
  const title = dialog === null ? null : document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent ?? null;
  const active = document.activeElement;
  const opener = document.querySelector('[data-shell-part="settings"]');
  return {
    dialogs: dialogs.length,
    open: open.length,
    modal: dialog === null ? false : dialog.matches(':modal'),
    named: title,
    marked: dialog?.getAttribute('data-settings-part') ?? null,
    inside: dialog === null ? false : dialog.contains(active),
    onOpener: active === opener,
    onBody: active === document.body || active === null,
    active: (active?.getAttribute?.('aria-label') ?? (active?.labels?.[0]?.textContent ?? active?.textContent ?? '')).replace(/\s+/g, ' ').trim().slice(0, 48) || active?.tagName.toLowerCase(),
    focusedPage: active?.getAttribute('data-settings-page') ?? null,
    page: dialog?.querySelector('[data-settings-part="tree"] [aria-current="page"]')?.getAttribute('data-settings-page') ?? null,
    parts: document.querySelectorAll('[data-settings-part]').length,
  };
};

const closed = (page) => page.waitForSelector('dialog[open]', { state: 'detached', timeout: 1500 }).then(() => true, () => false);

/** A sheet left open by a step that did not close it, or a fault that closed it: the next step starts from a closed page. */
async function reset(page) {
  if ((await page.evaluate(READ)).open > 0) {
    await page.keyboard.press('Escape');
    if (!(await closed(page))) await page.evaluate(() => document.querySelector('dialog[open]')?.close());
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function closedPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context, errors } = await openFixture(env, 'case=sheet');
  try {
    await plant(env, page);
    const got = await page.evaluate(() => {
      const gear = document.querySelector('[data-shell-part="settings"]');
      return {
        dialogs: document.querySelectorAll('dialog').length,
        parts: document.querySelectorAll('[data-settings-part], [data-settings-row], [data-settings-state]').length,
        gear: gear === null ? null : { name: gear.getAttribute('aria-label'), popup: gear.getAttribute('aria-haspopup'), keys: gear.getAttribute('aria-keyshortcuts'), tag: gear.tagName.toLowerCase() },
      };
    });
    check(got.dialogs === 0 && got.parts === 0, where, 'sheet.closed', `${got.dialogs} dialogs and ${got.parts} nodes of Settings at load, wanted none: a closed sheet is not drawn`);
    check(got.gear !== null && got.gear.tag === 'button' && got.gear.name === 'Settings' && got.gear.popup === 'dialog' && /,/.test(got.gear.keys ?? ''), where, 'sheet.closed', `the gear is ${JSON.stringify(got.gear)}, wanted a button named Settings that has a dialog and its chord`);
    for (const message of errors) fail(where, 'sheet.closed', `error: ${message}`);
  } finally {
    await context.close();
  }
}

async function openPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openFixture(env, 'case=sheet');
  try {
    await plant(env, page);
    const chord = await chordOf(page);
    const one = async (how, open) => {
      await open();
      await page.waitForSelector('dialog[open] [data-settings-row]', { timeout: 4000 }).catch(() => undefined);
      const r = await page.evaluate(READ);
      check(r.open === 1 && r.modal, where, 'sheet.open', `${how}: ${r.open} dialogs open, modal ${r.modal}, wanted one modal dialog`);
      check(r.named === 'Settings' && r.marked === 'sheet', where, 'sheet.open', `${how}: the dialog is named ${JSON.stringify(r.named)} and marked ${JSON.stringify(r.marked)}, wanted Settings and sheet`);
      return r;
    };
    await one('the chord', () => page.keyboard.press(chord));
    // Asked again while it is open: nothing happens.
    await page.keyboard.press(chord);
    await sleep(150);
    check((await page.evaluate(READ)).open === 1 && (await page.evaluate(() => document.querySelectorAll('dialog').length)) === 1, where, 'sheet.open', 'the chord pressed while the sheet is open made a second dialog');
    await reset(page);
    await one('the gear', () => page.locator(GEAR).click());
    await reset(page);
    // The web chord, which a browser leaves to the page (it keeps Command or Control comma for its own preferences).
    await one('the web chord', () => page.keyboard.press('Control+Alt+Comma'));
    await reset(page);
    // Shift makes it another chord.
    await page.keyboard.press(chord.replace('+', '+Shift+'));
    await sleep(300);
    check((await page.evaluate(READ)).open === 0, where, 'sheet.open', `${chord} with Shift opened the sheet: it is another chord`);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function modalPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openFixture(env, 'case=sheet');
  try {
    await openSheet(page);
    await plant(env, page);
    const r = await page.evaluate(READ);
    check(r.open === 1 && r.modal, where, 'sheet.modal', `${r.open} dialogs open, modal ${r.modal}`);
    check(r.inside && r.focusedPage === 'appearance' && r.page === r.focusedPage, where, 'sheet.modal', `the keyboard is on ${JSON.stringify(r.active)} (inside the dialog: ${r.inside}), wanted the current Appearance tree item`);
    // Every control of the page behind refuses the focus.
    const took = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]');
      const out = [];
      for (const control of [...document.querySelectorAll('button, input, select, a[href], [tabindex]')].filter((element) => !dialog.contains(element) && !element.contains(dialog)).slice(0, 60)) {
        control.focus();
        if (document.activeElement === control) out.push((control.getAttribute('aria-label') ?? control.textContent ?? control.tagName).slice(0, 30));
      }
      return out;
    });
    check(took.length === 0, where, 'sheet.modal', `the page behind took the focus: ${took.slice(0, 3).join(', ')}`);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/** The frame, the header and Close, in the page. */
const READ_FRAME = () => {
  const r2 = (value) => Math.round(value * 100) / 100;
  const rect = (element) => {
    const b = element.getBoundingClientRect();
    return { x: r2(b.x), y: r2(b.y), w: r2(b.width), h: r2(b.height) };
  };
  const dialog = document.querySelector('dialog[open]');
  const part = (name) => dialog.querySelector(`[data-ov-part="${name}"]`);
  const style = (element, property) => getComputedStyle(element)[property];
  const nav = dialog.querySelector('[data-settings-part="nav"]');
  const content = dialog.querySelector('[data-settings-part="content"]');
  return {
    view: { w: innerWidth, h: innerHeight },
    dialog: rect(dialog),
    frame: rect(part('frame')),
    header: rect(part('header')),
    close: rect(part('close')),
    title: rect(part('title')),
    body: rect(part('body')),
    nav: rect(nav),
    content: rect(content),
    form: rect(content.querySelector('[data-settings-part="page"] > header')),
    radius: [style(nav, 'borderTopLeftRadius'), style(content, 'borderTopLeftRadius')],
    contentWidth: content.clientWidth,
    contentOverflowX: content.scrollWidth - content.clientWidth,
    type: { size: style(part('title'), 'fontSize'), line: style(part('title'), 'lineHeight'), weight: style(part('title'), 'fontWeight') },
    controls: [...dialog.querySelectorAll('[data-settings-row] [data-ov-part="control"]')].map((element) => ({ ...rect(element), right: r2(element.getBoundingClientRect().right) })),
    rowEnds: [...dialog.querySelectorAll('[data-settings-row]')].map((element) => r2(element.getBoundingClientRect().right)),
  };
};

async function framePart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openFixture(env, 'case=sheet');
  try {
    await openSheet(page);
    await plant(env, page);
    const size = env.viewport;
    const f = await page.evaluate(READ_FRAME);
    const w = Math.min(1280, size.width - 48);
    const h = Math.min(800, size.height - 48);
    const want = { w, h, x: (size.width - w) / 2, y: (size.height - h) / 2 };
    check(near(f.dialog.x, 0) && near(f.dialog.y, 0) && near(f.dialog.w, size.width) && near(f.dialog.h, size.height), where, 'sheet.frame', `the dialog is ${JSON.stringify(f.dialog)}, not the window`);
    check(near(f.frame.w, want.w) && near(f.frame.h, want.h), where, 'sheet.frame', `the frame is ${f.frame.w} x ${f.frame.h}, wanted ${w} x ${h}`);
    check(near(f.frame.x, want.x) && near(f.frame.y, want.y), where, 'sheet.frame', `the frame is at ${f.frame.x},${f.frame.y}, not centred at ${want.x},${want.y}`);
    check(near(f.header.h, 41), where, 'sheet.frame', `the header is ${f.header.h} px high, not 41`);
    check(near(f.close.w, 24) && near(f.close.h, 24), where, 'sheet.frame', `Close is ${f.close.w} x ${f.close.h}, not 24 x 24`);
    check(near(f.close.x + f.close.w, f.header.x + f.header.w - 12), where, 'sheet.frame', `Close ends at ${f.close.x + f.close.w}, not 12 px inside the header's end`);
    check(near(f.title.x, f.header.x + 12), where, 'sheet.frame', `the title starts at ${f.title.x}, not 12 px inside the header`);
    check(f.type.size === '13px' && f.type.line === '16px' && f.type.weight === '600', where, 'sheet.frame', `the title is ${JSON.stringify(f.type)}, not 13px/16px at 600`);
    check(near(f.nav.x, f.body.x + 5) && near(f.nav.y, f.body.y) && near(f.nav.w, 244) && near(f.nav.h, f.body.h - 5), where, 'sheet.frame', `sidebar ${JSON.stringify(f.nav)} does not fit the body's 5 px tracks at 244 px wide`);
    check(near(f.content.x, f.nav.x + f.nav.w + 5) && near(f.content.x + f.content.w, f.body.x + f.body.w - 5) && near(f.content.h, f.nav.h) && near(f.content.y, f.nav.y), where, 'sheet.frame', `content pane ${JSON.stringify(f.content)} does not fill the remaining space between 5 px tracks`);
    check(f.radius.every((radius) => radius === '10px'), where, 'sheet.frame', `the pane radii are ${f.radius.join(', ')}, not the mock's 10 px`);
    check(near(f.form.x, f.content.x + 12) && near(f.form.y, f.content.y + 12) && near(f.form.w, f.contentWidth - 24), where, 'sheet.frame', `the form must fill its pane with 12 px padding; found ${JSON.stringify(f.form)}`);
  } finally {
    await context.close();
  }
}

async function clampPart(env) {
  // A window smaller than the frame: a browser tab in server mode can be any size.
  const size = { width: 900, height: 600 };
  const where = `${env.engine}@${size.width}x${size.height}`;
  const { page, context } = await openFixture(env, 'case=sheet', { viewport: size });
  try {
    await openSheet(page);
    await plant(env, page);
    const f = await page.evaluate(READ_FRAME);
    const want = { w: size.width - 48, h: size.height - 48, x: 24, y: 24 };
    check(near(f.frame.w, want.w) && near(f.frame.h, want.h), where, 'sheet.clamp', `the frame is ${f.frame.w} x ${f.frame.h}, wanted the window less 24 px on each side, ${want.w} x ${want.h}`);
    check(near(f.frame.x, want.x) && near(f.frame.y, want.y), where, 'sheet.clamp', `the frame is at ${f.frame.x},${f.frame.y}, wanted ${want.x},${want.y}`);
    check(f.close.x >= 0 && f.close.x + f.close.w <= size.width && f.close.y >= 0, where, 'sheet.clamp', `Close is ${JSON.stringify(f.close)}, outside the window`);
    check(near(f.nav.w, 244), where, 'sheet.clamp', `the navigation is ${f.nav.w} px wide at ${size.width}, wanted 244`);
    check(near(f.form.w, f.contentWidth - 24), where, 'sheet.clamp', `the constrained form is ${f.form.w} px wide, wanted 12 px of padding at both ends of ${f.contentWidth}`);
    check(f.contentOverflowX <= 0, where, 'sheet.clamp', `the page's pane overflows sideways by ${f.contentOverflowX} px in a window of ${size.width} px`);
    check(f.controls.every((control, index) => control.right <= f.rowEnds[index] + 0.5), where, 'sheet.clamp', 'a row\'s control column goes past the end of its row');
    // Resize the same open sheet. Navigation moves above the page without pushing controls past the frame.
    await page.setViewportSize({ width: 390, height: 640 });
    const narrow = await page.evaluate(READ_FRAME);
    check(near(narrow.frame.w, 342) && near(narrow.frame.h, 592) && near(narrow.frame.x, 24) && near(narrow.frame.y, 24), where, 'sheet.clamp', `390 x 640: frame ${JSON.stringify(narrow.frame)} does not leave 24 px clear`);
    check(near(narrow.content.x, narrow.nav.x) && near(narrow.content.w, narrow.nav.w) && near(narrow.content.y, narrow.nav.y + narrow.nav.h + 5), where, 'sheet.clamp', `390 x 640: navigation is not above the page with a 5 px gap`);
    check(narrow.contentOverflowX <= 0 && narrow.controls.every((control, index) => control.right <= narrow.rowEnds[index] + 0.5), where, 'sheet.clamp', '390 x 640: fields overflow their pane or their reset slot');
    const reach = await page.evaluate(() => {
      const content = document.querySelector('dialog [data-settings-part="content"]');
      content.scrollTop = content.scrollHeight;
      const last = content.querySelector('[data-settings-part="reset-material"]').getBoundingClientRect();
      const pane = content.getBoundingClientRect();
      const tree = document.querySelector('[data-settings-part="tree-scroll"]');
      const search = document.querySelector('input[data-settings-part="search"]');
      tree.scrollTop = 0;
      const searchY = search.getBoundingClientRect().top;
      const contentTop = content.scrollTop;
      tree.scrollTop = tree.scrollHeight;
      return {
        page: contentTop > 0 && last.top >= pane.top && last.bottom <= pane.bottom,
        tree: ['auto', 'scroll'].includes(getComputedStyle(tree).overflowY) && tree.scrollTop > 0,
        independent: search.getBoundingClientRect().top === searchY && content.scrollTop === contentTop,
      };
    });
    check(reach.page, where, 'sheet.clamp', '390 x 640: scrolling the Appearance pane did not bring its last action into view');
    check(reach.tree && reach.independent, where, 'sheet.clamp', '390 x 640: the expanded tree must scroll without moving search or the page');
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function paintPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openFixture(env, 'case=sheet');
  try {
    await openSheet(page);
    await plant(env, page);
    const paint = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]');
      const frame = dialog.querySelector('[data-ov-part="frame"]');
      const title = dialog.querySelector('[data-ov-part="title"]');
      const probe = document.createElement('div');
      dialog.append(probe);
      const resolve = (property, value) => {
        probe.style.cssText = `${property}: ${value}`;
        return getComputedStyle(probe)[property];
      };
      const fs = getComputedStyle(frame);
      const result = {
        fill: [fs.backgroundColor, resolve('background-color', 'var(--ov-bg-dialog)')],
        edge: [fs.borderTopColor, resolve('border-top-color', 'var(--ov-border-popup)')],
        text: [getComputedStyle(title).color, resolve('color', 'var(--ov-fg)')],
        shadow: [fs.boxShadow, resolve('box-shadow', 'var(--ov-shadow-popup)')],
        radius: [fs.borderTopLeftRadius, resolve('border-radius', 'var(--ov-radius-popup)')],
        edgeWidth: fs.borderTopWidth,
        veil: {
          dialog: getComputedStyle(dialog).backgroundColor,
          backdrop: getComputedStyle(dialog, '::backdrop').backgroundColor,
          before: getComputedStyle(dialog, '::before').content,
          after: getComputedStyle(dialog, '::after').content,
          z: getComputedStyle(dialog).zIndex,
          transition: fs.transitionDuration,
          animation: fs.animationName,
        },
      };
      probe.remove();
      return result;
    });
    for (const part of ['fill', 'edge', 'text', 'shadow', 'radius']) check(paint[part][0] === paint[part][1], where, 'sheet.paint', `the ${part} is ${paint[part][0]}, the token is ${paint[part][1]}`);
    check(paint.edgeWidth === '1px', where, 'sheet.paint', `the edge is ${paint.edgeWidth}, not 1px`);
    check(paint.veil.dialog === 'rgba(0, 0, 0, 0)' && paint.veil.backdrop === 'rgba(0, 0, 0, 0)', where, 'sheet.paint', `a veil: dialog ${paint.veil.dialog}, backdrop ${paint.veil.backdrop}`);
    check(['none', 'normal'].includes(paint.veil.before) && ['none', 'normal'].includes(paint.veil.after), where, 'sheet.paint', `a pseudo-element is drawn: ${paint.veil.before} ${paint.veil.after}`);
    check(paint.veil.z === 'auto', where, 'sheet.paint', `z-index ${paint.veil.z}`);
    check(paint.veil.transition === '0s' && paint.veil.animation === 'none', where, 'sheet.paint', `the frame moves: transition ${paint.veil.transition}, animation ${paint.veil.animation}`);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/** The controls Tab stops on in the open sheet, in the order of the document, kept on the window (`window.__stops`) so a step can say which one has the focus. Runs in the page. */
const MARK_STOPS = () => {
  const dialog = document.querySelector('dialog[open]');
  const stops = [...dialog.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]')].filter((element) => element.getAttribute('tabindex') !== '-1' && !element.matches(':disabled') && element.getClientRects().length > 0);
  window.__tabStops = stops;
  return stops.map((element) => {
    if (element.matches('input[data-settings-part="search"]')) return 'search';
    if (element.matches('[role="treeitem"]')) return `tree:${element.dataset.settingsPage ?? element.dataset.settingsBranch}`;
    return (element.getAttribute('aria-label') ?? element.labels?.[0]?.textContent ?? element.textContent ?? element.tagName).replace(/\s+/g, ' ').trim().slice(0, 40);
  });
};
const WHERE_FOCUS = () => window.__tabStops.indexOf(document.activeElement);

async function trapPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openFixture(env, MODIFIED);
  try {
    await openSheet(page);
    await goToPage(page, 'terminal');
    await plant(env, page);
    const names = await page.evaluate(MARK_STOPS);
    check(names[0] === 'Close' && names[1] === 'search' && names[2] === 'tree:terminal' && names.length >= 9, where, 'sheet.trap', `the Tab stops are ${JSON.stringify(names)}, wanted Close, search, the current tree item, then the row controls`);
    check(names.filter((name) => name.startsWith('tree:')).length === 1, where, 'sheet.trap', 'the tree has more than one Tab stop');
    const { forward, backward } = env.keys;
    const walk = async (press, count) => {
      const seen = [];
      for (let index = 0; index < count; index += 1) {
        await page.keyboard.press(press);
        seen.push(await page.evaluate(WHERE_FOCUS));
      }
      return seen;
    };
    await page.evaluate(() => document.querySelector('dialog [data-ov-part="close"]').focus());
    const total = names.length;
    const ahead = await walk(forward, total * 2 + 2);
    const cycle = Array.from({ length: total * 2 + 2 }, (_, index) => (index + 1) % total);
    check(ahead.every((index) => index >= 0), where, 'sheet.trap', `Tab left the dialog: ${ahead.join(', ')}`);
    check(JSON.stringify(ahead) === JSON.stringify(cycle), where, 'sheet.trap', `Tab went ${ahead.join(', ')}, wanted ${cycle.join(', ')}: every stop in the document's order, then Close again`);
    await page.evaluate(() => document.querySelector('dialog [data-ov-part="close"]').focus());
    const back = await walk(backward, total + 2);
    const reverse = Array.from({ length: total + 2 }, (_, index) => (((-1 - index) % total) + total) % total);
    check(back.every((index) => index >= 0), where, 'sheet.trap', `Shift+Tab left the dialog: ${back.join(', ')}`);
    check(JSON.stringify(back) === JSON.stringify(reverse), where, 'sheet.trap', `Shift+Tab went ${back.join(', ')}, wanted ${reverse.join(', ')}: Close, then the last control, back up to Close`);
    note('sheet', `stops ${env.engine}@${env.viewportName}`, names);
  } finally {
    await context.close();
  }
}

async function scrimPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openFixture(env, 'case=sheet');
  try {
    await openSheet(page);
    await plant(env, page);
    await page.evaluate(() => document.querySelector('dialog [data-ov-part="close"]').focus());
    const frame = await page.evaluate(() => {
      const b = document.querySelector('dialog [data-ov-part="frame"]').getBoundingClientRect();
      return { left: b.left };
    });
    await page.mouse.click(Math.round(frame.left / 2), Math.round(env.viewport.height / 2));
    await sleep(150);
    const after = await page.evaluate(READ);
    check(after.open === 1, where, 'sheet.scrim', `a press on the scrim left ${after.open} dialogs open: a sheet with a draft in it is not closed by a stray press`);
    if (after.open === 1) {
      await page.keyboard.press(env.keys.forward);
      const entered = await page.evaluate(READ);
      check(entered.inside, where, 'sheet.scrim', `after a press on the scrim, Tab put the focus on ${entered.active}, outside the dialog`);
    }
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function closePart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openFixture(env, 'case=sheet');
  try {
    await plant(env, page);
    const field = (name) => page.getByRole('textbox', { name });
    // draft: Escape in a field with a draft is the field's; the next Escape closes.
    await page.locator(GEAR).click();
    await page.waitForSelector('dialog[open] [data-settings-row]');
    await goToPage(page, 'terminal');
    await field('Default Shell').click();
    const applied = await field('Default Shell').inputValue();
    await page.keyboard.type('x');
    const typed = await field('Default Shell').inputValue();
    check(typed === `${applied}x`, where, 'sheet.draft', `the draft is ${typed}, not ${applied}x`);
    await page.keyboard.press('Escape');
    await sleep(150);
    const reverted = await page.evaluate(READ);
    const holds = await field('Default Shell').inputValue({ timeout: 1000 }).catch(() => null);
    check(reverted.open === 1 && holds === applied, where, 'sheet.draft', `after the first Escape: ${reverted.open} dialogs open, the field holds ${holds}, not ${applied}`);
    if (reverted.open === 1) {
      await page.keyboard.press('Escape');
      check(await closed(page), where, 'sheet.draft', 'the Escape after it did not close the sheet');
    }
    await reset(page);
    // escape: the focus is back on the gear, which opened it.
    await page.locator(GEAR).click();
    await page.waitForSelector('dialog[open] [data-settings-row]');
    await page.evaluate(() => (window.__step = 'escape'));
    await page.keyboard.press('Escape');
    const escaped = await closed(page);
    await page.evaluate(() => (window.__step = ''));
    const afterEscape = await page.evaluate(READ);
    check(escaped, where, 'sheet.escape', 'Escape did not close the sheet');
    check(afterEscape.onOpener, where, 'sheet.escape', `after Escape the focus is on ${afterEscape.active}, not on the gear that opened it`);
    check(!afterEscape.onBody, where, 'sheet.escape', 'after Escape the focus is on the body');
    await reset(page);
    // close: opened by the gear with the keyboard, closed by a press on Close.
    await page.locator(GEAR).focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('dialog[open] [data-settings-row]');
    await page.evaluate(() => (window.__step = 'close'));
    await page.locator('dialog [data-ov-part="close"]').click();
    const byClose = await closed(page);
    await page.evaluate(() => (window.__step = ''));
    const afterClose = await page.evaluate(READ);
    check(byClose, where, 'sheet.close', 'a press on Close did not close the sheet');
    check(afterClose.onOpener, where, 'sheet.close', `after Close the focus is on ${afterClose.active}, not on the gear that opened it`);
    await reset(page);
    // opened with the chord from a field of the page behind it: the focus goes back to that field.
    await page.locator('input[aria-label="Behind field"]').focus();
    await page.keyboard.press(await chordOf(page));
    await page.waitForSelector('dialog[open] [data-settings-row]');
    await page.keyboard.press('Escape');
    await closed(page);
    const back = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);
    check(back === 'Behind field', where, 'sheet.close', `a sheet opened from a field gave the focus back to ${back}, wanted the field`);
  } finally {
    await context.close();
  }
}

async function keepPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openFixture(env, 'case=sheet');
  try {
    await plant(env, page);
    await openSheet(page);
    await goToPage(page, 'terminal');
    await page.getByRole('switch', { name: 'Cursor Blink' }).click();
    await sleep(200);
    await page.getByRole('textbox', { name: 'Default Shell' }).click();
    await page.keyboard.type('x');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await closed(page);
    await openSheet(page);
    const r = await page.evaluate(READ);
    check(r.page === 'terminal', where, 'sheet.keep', `the sheet reopened on ${r.page}, wanted Terminal, where it was left`);
    if (r.page !== 'terminal') return;
    check((await page.getByRole('switch', { name: 'Cursor Blink' }).getAttribute('aria-checked', { timeout: 1500 }).catch(() => null)) === 'false', where, 'sheet.keep', 'a value that was applied is not what the reopened sheet shows');
    check((await page.getByRole('textbox', { name: 'Default Shell' }).inputValue({ timeout: 1500 }).catch(() => null)) === '/bin/zsh', where, 'sheet.keep', 'a draft that was reverted came back');
    // What was typed and not applied is gone with the sheet, which keeps no draft: a second opening starts from what the host holds.
    await page.getByRole('textbox', { name: 'Default Shell' }).click();
    await page.keyboard.press((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+a' : 'Control+a');
    await page.keyboard.type('/bin/fish');
    await page.locator('dialog [data-ov-part="close"]').click();
    await closed(page);
    await openSheet(page);
    const typed = await page.getByRole('textbox', { name: 'Default Shell' }).inputValue({ timeout: 1500 }).catch(() => null);
    const held = await page.evaluate(() => window.__host.values.get('terminal.defaultShell') ?? '/bin/zsh');
    check(typed === held, where, 'sheet.keep', `the reopened sheet shows ${JSON.stringify(typed)} for the shell, the host holds ${JSON.stringify(held)}`);
  } finally {
    await context.close();
  }
}

async function tipPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openFixture(env, MODIFIED);
  try {
    await openSheet(page);
    await goToPage(page, 'terminal');
    await plant(env, page);
    const reset_ = page.getByRole('button', { name: 'Reset Cursor Blink to default' });
    await reset_.hover();
    await page.waitForFunction(() => document.querySelector('[role="tooltip"]')?.matches(':popover-open'), null, { timeout: 5000 }).catch(() => undefined);
    const tip = await page.evaluate(() => {
      const element = document.querySelector('[role="tooltip"]');
      const dialog = document.querySelector('dialog[open]');
      if (element === null || dialog === null) return null;
      const b = element.getBoundingClientRect();
      const frame = dialog.querySelector('[data-ov-part="frame"]').getBoundingClientRect();
      const display = getComputedStyle(element);
      // Both are in the top layer, and what is shown last is on top: the tooltip is outside the dialog's own tree (a popover is a child of the document), shown after the dialog, over its frame, drawn, and in nothing inert.
      return {
        open: element.matches(':popover-open'),
        text: element.textContent,
        outside: !dialog.contains(element),
        overFrame: b.x < frame.right && b.right > frame.x && b.y < frame.bottom && b.bottom > frame.y && b.x >= 0 && b.right <= innerWidth && b.y >= 0 && b.bottom <= innerHeight,
        size: [Math.round(b.width), Math.round(b.height)],
        drawn: display.visibility === 'visible' && Number(display.opacity) > 0.99 && display.display !== 'none',
        inert: element.closest('[inert]') !== null,
        dialogModal: dialog.matches(':modal'),
      };
    });
    check(tip !== null && tip.open && tip.text === 'Reset Cursor Blink to default', where, 'sheet.tip', `the tooltip over Reset is ${JSON.stringify(tip)}, wanted it open and saying Reset Cursor Blink to default`);
    check(tip !== null && tip.outside && tip.overFrame && tip.drawn && !tip.inert && tip.size[0] > 40, where, 'sheet.tip', `the tooltip is ${JSON.stringify(tip)}: wanted it in the top layer after the modal dialog, over the frame (it may reach past its edge, by the Reset at the end of a row) and inside the window, drawn and not inert`);
  } finally {
    await context.close();
  }
}

/** Runs the parts of the section `sheet` for one engine and viewport. */
export async function sheetSection(env) {
  const timed = async (part, run) => {
    const from = Date.now();
    await run(env);
    note('sheet', `seconds ${env.engine}@${env.viewportName} ${part}`, round((Date.now() - from) / 1000));
  };
  if (wants(env, 'closed')) await timed('closed', closedPart);
  if (wants(env, 'open')) await timed('open', openPart);
  if (wants(env, 'modal')) await timed('modal', modalPart);
  if (wants(env, 'frame')) await timed('frame', framePart);
  // The clamp is the window's own size, not the viewport's: once for an engine.
  if (wants(env, 'clamp') && env.first) await timed('clamp', clampPart);
  if (wants(env, 'paint')) await timed('paint', paintPart);
  if (wants(env, 'trap')) await timed('trap', trapPart);
  if (wants(env, 'scrim')) await timed('scrim', scrimPart);
  if (wants(env, 'close')) await timed('close', closePart);
  if (wants(env, 'keep')) await timed('keep', keepPart);
  if (wants(env, 'tip')) await timed('tip', tipPart);
}

// Section `window` of the Settings probe: the content of the Settings WINDOW (the product's `window.tsx` over a host in memory, the page `?case=window` of the fixture, which is what a native window of kind `settings` and a browser's
// `/?screen=settings-window` draw) against the original application's window, and what the host's window service makes of it.
//
//   old       the window at 1060 x 640 (the size the host makes it) against the numbers of the original application's window (old-settings.json, pinned from the study of docs/ui-next/status/ST1.md): each number the new window MATCHES
//             (`window.old.match`) and each that DELIBERATELY DIFFERS (`window.old.decided`: the new value is pinned, with the decision that made it, so a change of it that nobody decided is a failure). The table is printed.
//   bare      the window is Settings and nothing else: no shell, no dialog, one h1, a caption that is the window's one header, no scroll of the document, at 1060 x 640 and at the least the host lets it be, 960 x 600
//   drag      the caption moves the window and Close does not (`--wails-draggable`, what the Wails runtime reads), and nothing else in the window does
//   keys      Escape and the platform's close chord hide the window (`HideSettings`), the other platform's chord and a key that something already used do not, Close hides it, and Escape in a field with a draft is the field's
//   request   the host's requests: a window never asked to show draws nothing; a new request id with a category goes to that page, the same id does not move it, a target that names nothing leaves it; a hide lays out and paints
//             nothing and a show asks the host what it holds now; a draft survives a hide, as the original's did
//   sync      a change the host reports (`settings/changed`) moves a field that has no draft and is said on a field that has one; a change made here reaches the host
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, closeChordOf, fail, goToPage, near, note, openFixture, plant, round, showWindow, sleep, WHO, WINDOW_SIZES, wants } from './settings-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OLD = JSON.parse(readFileSync(path.join(here, 'old-settings.json'), 'utf8')).data;
const enc = (value) => encodeURIComponent(JSON.stringify(value));
const GENERAL = `case=window&request=${enc({ requestId: 1, target: '/settings?category=general', visible: true })}`;
const TERMINAL = `case=window&request=${enc({ requestId: 1, target: '/settings?category=terminal', visible: true })}`;

/** The window's rectangles and type, in the page. */
const READ_CONTAINER = () => {
  const r2 = (value) => Math.round(value * 100) / 100;
  const rect = (element) => {
    if (element === null || element === undefined) return null;
    const box = element.getBoundingClientRect();
    return [r2(box.x), r2(box.y), r2(box.width), r2(box.height)];
  };
  const type = (element) => {
    if (element === null || element === undefined) return null;
    const style = getComputedStyle(element);
    return { size: style.fontSize, weight: style.fontWeight, line: style.lineHeight, radius: style.borderTopLeftRadius, text: (element.textContent ?? '').trim() };
  };
  const q = (selector, root = document) => root.querySelector(selector);
  const window_ = q('[data-settings-part="window"]');
  const caption = q('[data-settings-part="caption"]');
  const nav = q('[data-settings-part="nav"]');
  const items = nav === null ? [] : [...nav.querySelectorAll('button')];
  const page = q('[data-settings-part="page"]');
  const row = q('[data-settings-row]');
  const control = row === null ? null : q('[data-ov-part="control"]', row);
  return {
    viewport: [innerWidth, innerHeight],
    scroll: [document.scrollingElement?.scrollWidth ?? 0, document.scrollingElement?.scrollHeight ?? 0],
    window: rect(window_),
    caption: rect(caption),
    title: rect(q('h1', caption ?? document)),
    titleType: type(q('h1', caption ?? document)),
    close: rect(q('button', caption ?? document)),
    nav: rect(nav),
    items: items.map(rect),
    itemType: type(items[0]),
    group: rect(q(':scope > [aria-hidden="true"]', nav ?? document)),
    content: rect(q('[data-settings-part="content"]')),
    page: rect(page),
    heading: rect(q('header > :first-child', page ?? document)),
    headingType: type(q('header > :first-child', page ?? document)),
    row: rect(row),
    text: rect(row === null ? null : q('[data-ov-part="text"]', row)),
    control: rect(control),
    widget: rect(row === null ? null : q('select, input, [role="switch"]', row)),
    searches: document.querySelectorAll('input[type="search"], [role="searchbox"], [role="search"]').length,
    footers: document.querySelectorAll('footer, [role="contentinfo"]').length,
    names: items.map((item) => item.textContent),
  };
};

/** The numbers of the original application's window that the new one matches, and the ones it differs from on purpose, each with its reason (docs/ui-next/status/ST1.md section 1 and 4, ch16 S124 to S126, the mock's `.sheet > .hd`). */
function judgeOld(env, got) {
  const where = `${env.engine}@1060x640`;
  const old = OLD[env.engine];
  const table = [];
  const match = (quantity, was, now, tolerance = 0.51) => {
    table.push({ quantity, old: was, now, verdict: 'same' });
    check(near(was, now, tolerance), where, 'window.old.match', `${quantity}: the original window has ${was}, this one ${now}`);
  };
  const decided = (quantity, was, expected, now, why, tolerance = 0.51) => {
    table.push({ quantity, old: was, now, verdict: `differs: ${why}` });
    check(typeof expected === 'string' ? expected === now : near(expected, now, tolerance), where, 'window.old.decided', `${quantity}: decided ${expected} (${why}), found ${now}; the original window has ${was}`);
  };
  const type = (value) => (value === null ? 'none' : `${value.size}/${value.line} ${value.weight}`);
  // What the two have in common.
  match('window width', old.viewport[0], got.window?.[2] ?? 0);
  match('sidebar width', old.sidebar[2], got.nav?.[2] ?? 0);
  match('content column x', old.content[0], got.content?.[0] ?? 0);
  match('content column width', old.content[2], got.content?.[2] ?? 0);
  match('Close width', old.close[2], got.close?.[2] ?? 0);
  match('Close height', old.close[3], got.close?.[3] ?? 0);
  match('Close x', old.close[0], got.close?.[0] ?? 0);
  match('page text size of a nav item', Number.parseFloat(old.type.navItem.fontSize), Number.parseFloat(got.itemType?.size ?? '0'));
  // What differs on purpose.
  decided('caption height', old.brand[3], 41, got.caption?.[3] ?? 0, 'the sheet\'s header, 41 px, as the mock\'s .sheet > .hd; the original had a 56 px brand row in the sidebar only');
  decided('Close y', old.close[1], 8.5, got.close?.[1] ?? 0, 'centred in the 41 px caption, (41 - 24) / 2; the original put it 8 px from the top');
  decided('title size', Number.parseFloat(old.type.brand.fontSize), 13, Number.parseFloat(got.titleType?.size ?? '0'), 'the sheet\'s title is 13/16 at 600, the original\'s brand 16/20');
  decided('sidebar top', old.sidebar[1], 41, got.nav?.[1] ?? 0, 'the caption spans both columns, so the sidebar starts under it');
  decided('page item height', old.navFirst[3], 24, got.items[0]?.[3] ?? 0, 'the mock\'s tree row is 24 px (S124); the original\'s rows were 34 px');
  decided('page item x', old.navFirst[0], 6, got.items[0]?.[0] ?? 0, 'a 6 px inset on the spacing scale (the original 10 px, the mock 5 px, which is not on the scale)');
  decided('page item radius', Number.parseFloat(old.type.navItem.borderRadius), 4, Number.parseFloat(got.itemType?.radius ?? '0'), 'the mock\'s tree row radius');
  decided('number of pages', old.navItemCount, 6, got.items.length, 'the host declares six pages that have something to draw; the original also listed AI Tools, Updates and a plugin');
  decided('search field', 1, 0, got.searches, 'search is not built in slice 1 (docs/ui-next/status/ST1.md section 4)');
  decided('heading size', Number.parseFloat(old.type.heading.fontSize), 18, Number.parseFloat(got.headingType?.size ?? '0'), 'the page heading is 18/24 (S124), without the original\'s breadcrumb');
  decided('heading x', old.heading[0], 236, got.heading?.[0] ?? 0, 'the content column (212) and a 24 px page inset; the original\'s was 22');
  decided('row height', old.row[3], 60, got.row?.[3] ?? 0, 'S126: 6 + 16 title + 16 description + 16 lane + 6; the original\'s row held a key line and was 74 px');
  decided('control height', old.rowControl[3], 28, got.widget?.[3] ?? 0, 'the mock\'s control is 28 px high; the original\'s was 36 px');
  decided('control width', old.rowControl[2], 200, got.widget?.[2] ?? 0, 'a select is 200 px, a text field 280 px, as the mock\'s .settings-select and .settings-input; the original\'s controls were all 235 px');
  decided('footer', 1, 0, got.footers, 'apply on change: there is no Save, Apply or Done (S125); the original had a 45 px footer');
  return table;
}

async function oldPart(env) {
  const where = `${env.engine}@1060x640`;
  const { page, context, errors } = await openFixture(env, GENERAL, { viewport: WINDOW_SIZES['1060x640'] });
  try {
    await page.waitForSelector('[data-settings-part="window"][data-visible="true"] [data-settings-row]', { timeout: 10_000 });
    await plant(env, page);
    await sleep(200);
    const got = await page.evaluate(READ_CONTAINER);
    const table = judgeOld(env, got);
    note('window', `old ${env.engine}`, table);
    for (const message of errors) fail(where, 'window.page', `error: ${message}`);
  } finally {
    await context.close();
  }
}

/** The window is Settings alone, whole in the window, at the size the host makes it and at the least. */
async function barePart(env) {
  for (const [name, size] of Object.entries(WINDOW_SIZES)) {
    const where = `${env.engine}@${name}`;
    const { page, context } = await openFixture(env, GENERAL, { viewport: size });
    try {
      await page.waitForSelector('[data-settings-part="window"][data-visible="true"] [data-settings-row]', { timeout: 10_000 });
      await plant(env, page);
      await sleep(150);
      const got = await page.evaluate(() => {
        const q = (selector, root = document) => root.querySelector(selector);
        const caption = q('[data-settings-part="caption"]');
        const content = q('[data-settings-part="content"]');
        const box = (element) => {
          const rect = element?.getBoundingClientRect();
          return rect === undefined ? null : [Math.round(rect.x * 100) / 100, Math.round(rect.y * 100) / 100, Math.round(rect.width * 100) / 100, Math.round(rect.height * 100) / 100];
        };
        return {
          foreign: [...document.querySelectorAll('[data-shell-part], [data-shell-region], [data-palette-part], [data-notices-part], dialog')].map((element) => element.tagName.toLowerCase() + (element.getAttribute('data-shell-part') ?? '')),
          headings: [...document.querySelectorAll('h1')].map((element) => element.textContent),
          captionTag: caption?.tagName.toLowerCase(),
          captionStops: caption === null ? [] : [...caption.querySelectorAll('button, a[href], input, select, [tabindex]')].map((element) => element.getAttribute('aria-label') ?? element.textContent),
          navs: document.querySelectorAll('nav').length,
          scroll: [document.scrollingElement.scrollWidth, document.scrollingElement.scrollHeight],
          view: [innerWidth, innerHeight],
          window: box(q('[data-settings-part="window"]')),
          caption: box(caption),
          content: box(content),
          contentOverflowX: content === null ? 0 : content.scrollWidth - content.clientWidth,
          scrollerY: content === null ? '' : getComputedStyle(content).overflowY,
        };
      });
      check(got.foreign.length === 0, where, 'window.bare', `the window draws more than Settings: ${got.foreign.join(', ')}`);
      check(JSON.stringify(got.headings) === JSON.stringify(['Settings']), where, 'window.bare', `the window\'s h1 is ${JSON.stringify(got.headings)}, wanted Settings alone`);
      check(got.captionTag === 'header', where, 'window.bare', `the caption is a ${got.captionTag}, not a header`);
      check(JSON.stringify(got.captionStops) === JSON.stringify(['Close']), where, 'window.bare', `the caption holds the controls ${JSON.stringify(got.captionStops)}, wanted Close alone`);
      check(got.navs === 1, where, 'window.bare', `${got.navs} navigations in the window, wanted the one of the pages`);
      check(got.scroll[0] <= got.view[0] && got.scroll[1] <= got.view[1], where, 'window.bare', `the document scrolls: ${got.scroll.join(' x ')} in a ${got.view.join(' x ')} window`);
      check(got.window !== null && near(got.window[0], 0) && near(got.window[1], 0) && near(got.window[2], size.width) && near(got.window[3], size.height), where, 'window.bare', `the window\'s content is ${JSON.stringify(got.window)}, not the whole ${size.width} x ${size.height}`);
      check(got.caption !== null && near(got.caption[3], 41) && near(got.caption[2], size.width), where, 'window.bare', `the caption is ${JSON.stringify(got.caption)}, wanted ${size.width} x 41 at the top`);
      check(got.contentOverflowX <= 0, where, 'window.bare', `the page overflows its pane by ${got.contentOverflowX} px sideways`);
      check(got.scrollerY === 'auto', where, 'window.bare', `the page's pane has overflow-y ${got.scrollerY}, wanted auto`);
    } finally {
      await context.close();
    }
  }
}

/** What the Wails runtime reads: `--wails-draggable` in the computed style, drag on the caption and no-drag on Close, and on nothing else. */
async function dragPart(env) {
  const where = `${env.engine}@1060x640`;
  const { page, context } = await openFixture(env, GENERAL, { viewport: WINDOW_SIZES['1060x640'] });
  try {
    await page.waitForSelector('[data-settings-part="window"][data-visible="true"] [data-settings-row]');
    await plant(env, page);
    const got = await page.evaluate(() => {
      const value = (element) => getComputedStyle(element).getPropertyValue('--wails-draggable').trim();
      const caption = document.querySelector('[data-settings-part="caption"]');
      const dragging = [...document.querySelectorAll('*')].filter((element) => value(element) === 'drag').map((element) => `${element.tagName.toLowerCase()}${element.getAttribute('data-settings-part') === null ? '' : `[${element.getAttribute('data-settings-part')}]`}`);
      return { caption: value(caption), close: value(caption.querySelector('button')), title: value(caption.querySelector('h1')), dragging };
    });
    check(got.caption === 'drag', where, 'window.drag', `the caption's --wails-draggable is ${JSON.stringify(got.caption)}, wanted drag`);
    check(got.close === 'no-drag', where, 'window.drag', `Close's --wails-draggable is ${JSON.stringify(got.close)}, wanted no-drag: a press on it would move the window`);
    check(got.dragging.every((name) => name.startsWith('header') || name.startsWith('h1')), where, 'window.drag', `elements other than the caption move the window: ${got.dragging.join(', ')}`);
  } finally {
    await context.close();
  }
}

/** The hides of the fixture's window service, and the visible state of the page. */
const hides = (page) => page.evaluate(() => window.__windows.calls.hide);
const draw = (page) => page.evaluate(() => ({ visible: document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible'), hiddenPaint: getComputedStyle(document.querySelector('[data-settings-part="window"]')).contentVisibility }));
const current = (page) => page.evaluate(() => document.querySelector('[data-settings-part="nav"] [aria-current="page"]')?.textContent ?? null);

async function keysPart(env) {
  const where = `${env.engine}@1060x640`;
  const { page, context } = await openFixture(env, TERMINAL, { viewport: WINDOW_SIZES['1060x640'] });
  try {
    await page.waitForSelector('[data-settings-part="window"][data-visible="true"] [data-settings-row]');
    await plant(env, page);
    // The page puts the keyboard on its navigation: the keys are read from there, as a person meets them.
    const start = await page.evaluate(WHO);
    check(start === 'Terminal', where, 'window.keys', `the keyboard starts on ${start}, wanted the page on screen (Terminal)`);
    const close = await closeChordOf(page);
    const other = close.startsWith('Meta') ? 'Control+w' : 'Meta+w';
    await page.keyboard.press('Escape');
    check((await hides(page)) === 1, where, 'window.keys', `Escape did not hide the window (${await hides(page)} hides)`);
    await page.keyboard.press(close);
    check((await hides(page)) === 2, where, 'window.keys', `${close} did not hide the window (${await hides(page)} hides)`);
    await page.keyboard.press(other);
    check((await hides(page)) === 2, where, 'window.keys', `${other} hid the window: the chord of the other platform is not this one's`);
    await page.locator('[data-settings-part="caption"] button').click();
    check((await hides(page)) === 3, where, 'window.keys', `Close did not hide the window (${await hides(page)} hides)`);
    // A key that something in the page used is not taken from it: Escape in a field with a draft puts the applied value back and hides nothing; the next Escape hides.
    const field = page.getByRole('textbox', { name: 'Default Shell' });
    await field.click();
    await page.keyboard.type('x');
    const typed = await field.inputValue();
    await page.keyboard.press('Escape');
    const reverted = await field.inputValue();
    check(typed === '/bin/zshx' && reverted === '/bin/zsh', where, 'window.keys', `Escape in a field with a draft: ${JSON.stringify(typed)} became ${JSON.stringify(reverted)}, wanted the applied /bin/zsh back`);
    check((await hides(page)) === 3, where, 'window.keys', 'Escape in a field with a draft hid the window: the field\'s key was taken from it');
    await page.keyboard.press('Escape');
    check((await hides(page)) === 4, where, 'window.keys', `the Escape after it did not hide the window (${await hides(page)} hides)`);
  } finally {
    await context.close();
  }
}

/** The host's requests, in the order the host makes them. */
async function requestPart(env) {
  const where = `${env.engine}@1060x640`;
  // A window that was never asked to show: the page is there, loaded, and draws nothing.
  const { page, context } = await openFixture(env, 'case=window', { viewport: WINDOW_SIZES['1060x640'] });
  try {
    await page.waitForFunction(() => document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible') === 'false', null, { timeout: 5000 });
    await plant(env, page);
    const asleep = await draw(page);
    check(asleep.hiddenPaint === 'hidden', where, 'window.request', `a window that was never asked to show has content-visibility ${asleep.hiddenPaint}, wanted hidden: nothing is laid out or painted`);
    const snapshots = () => page.evaluate(() => window.__host.calls.snapshot);
    const first = await snapshots();
    check(first === 1, where, 'window.request', `a window that was never shown asked the host ${first} times what it holds, wanted once (it loads in the background)`);

    // Asked to show on Terminal.
    await showWindow(page, '/settings?category=terminal', 1);
    check((await current(page)) === 'Terminal', where, 'window.request', `a request for category=terminal shows ${await current(page)}`);
    const shown = await draw(page);
    check(shown.visible === 'true' && shown.hiddenPaint === 'visible', where, 'window.request', `a shown window has data-visible ${shown.visible} and content-visibility ${shown.hiddenPaint}`);
    // The person goes to another page; the host shows the window again with the same request: it stays where the person is.
    await goToPage(page, 'editor');
    await page.evaluate(() => window.__windows.emit({ requestId: 1, target: '/settings?category=terminal', visible: true }));
    await sleep(100);
    check((await current(page)) === 'Editor', where, 'window.request', `the same request id moved the page to ${await current(page)}: a show of the same request keeps the page the person is on`);
    // A new request names a page.
    await page.evaluate(() => window.__windows.emit({ requestId: 2, target: '/settings?category=developer', visible: true }));
    await page.waitForSelector('[data-settings-part="page"][data-settings-page-id="developer"]', { state: 'attached', timeout: 5000 }).catch(() => undefined);
    check((await current(page)) === 'Developer Settings', where, 'window.request', `a new request for category=developer shows ${await current(page)}`);
    // A target that names nothing the window knows leaves the page.
    await page.evaluate(() => window.__windows.emit({ requestId: 3, target: '/settings', visible: true }));
    await sleep(100);
    check((await current(page)) === 'Developer Settings', where, 'window.request', `a request that names no page moved the window to ${await current(page)}`);
    await page.evaluate(() => window.__windows.emit({ requestId: 4, target: '/settings?category=nowhere', visible: true }));
    await sleep(100);
    const nowhere = await page.evaluate(() => document.querySelectorAll('[data-settings-part="page"]').length);
    check(nowhere === 1, where, 'window.request', `a request for a page that does not exist left ${nowhere} pages on screen, wanted the one it was on`);

    // A hide with nothing being typed: nothing runs in the window while it is hidden, and a show asks the host what it holds now, because the page was not looking while it was hidden.
    await page.evaluate(() => window.__windows.emit({ requestId: 4, target: '/settings?category=terminal', visible: true }));
    await goToPage(page, 'terminal');
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    const before = await snapshots();
    await page.evaluate(() => window.__windows.emit({ requestId: 4, target: '/settings?category=terminal', visible: false }));
    await page.waitForFunction(() => document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible') === 'false');
    const hidden = await draw(page);
    check(hidden.hiddenPaint === 'hidden', where, 'window.request', `a hidden window has content-visibility ${hidden.hiddenPaint}, wanted hidden: nothing is laid out or painted`);
    await sleep(300);
    check((await snapshots()) === before, where, 'window.request', `a hide asked the host ${(await snapshots()) - before} times what it holds: nothing runs while the window is hidden`);
    await page.evaluate(() => window.__host.change('terminal.fontSize', 20));
    await sleep(150);
    await page.evaluate(() => window.__windows.emit({ requestId: 4, target: '/settings?category=terminal', visible: true }));
    await page.waitForFunction(() => document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible') === 'true');
    await sleep(250);
    check((await snapshots()) > before, where, 'window.request', 'a show did not ask the host what it holds now: the page was not looking while it was hidden');
    const size = await page.getByRole('spinbutton', { name: 'Font Size' }).inputValue();
    check(size === '20', where, 'window.request', `a value the host changed while the window was hidden is ${size} after the show, wanted 20`);
    // What a person typed is not lost by a hide, as the original window's was not (a field that loses the focus applies its value, so the text may be applied by then, and it is the same text).
    const field = page.getByRole('textbox', { name: 'Default Shell' });
    await field.click();
    await page.keyboard.type('x');
    await page.evaluate(() => window.__windows.emit({ requestId: 4, target: '/settings?category=terminal', visible: false }));
    await page.waitForFunction(() => document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible') === 'false');
    await sleep(200);
    await page.evaluate(() => window.__windows.emit({ requestId: 4, target: '/settings?category=terminal', visible: true }));
    await page.waitForFunction(() => document.querySelector('[data-settings-part="window"]')?.getAttribute('data-visible') === 'true');
    await sleep(250);
    const kept = await page.getByRole('textbox', { name: 'Default Shell' }).inputValue();
    check(kept === '/bin/zshx', where, 'window.request', `what a person typed is ${JSON.stringify(kept)} after a hide and a show, wanted /bin/zshx`);
  } finally {
    await context.close();
  }
}

/** A change the host reports reaches the page, and a change made in the page reaches the host. */
async function syncPart(env) {
  const where = `${env.engine}@1060x640`;
  const { page, context } = await openFixture(env, TERMINAL, { viewport: WINDOW_SIZES['1060x640'] });
  try {
    await page.waitForSelector('[data-settings-part="window"][data-visible="true"] [data-settings-row]');
    await plant(env, page);
    const size = page.getByRole('spinbutton', { name: 'Font Size' });
    // From the host's report to the field showing it, in the page: the host's `change` tells every listener at once, and the field has the value when the session has asked the host again and given the form its answer.
    const moved = await size.evaluate(
      (element) =>
        new Promise((resolve) => {
          const started = performance.now();
          const look = () => (element.value === '18' ? resolve(Math.round(performance.now() - started)) : performance.now() - started > 1500 ? resolve(-1) : requestAnimationFrame(look));
          window.__host.change('terminal.fontSize', 18);
          requestAnimationFrame(look);
        }),
    );
    check(moved >= 0, where, 'window.sync', `a change the host reported never reached a field that has no draft (it holds ${await size.inputValue()}, wanted 18)`);
    note('window', `sync ${env.engine}`, { millisecondsToTheField: moved });
    // A field with a draft keeps it, and says the host changed under it; Escape takes the host's value.
    const shell = page.getByRole('textbox', { name: 'Default Shell' });
    await shell.click();
    await page.keyboard.type('x');
    await page.evaluate(() => window.__host.change('terminal.defaultShell', '/bin/fish'));
    await sleep(250);
    check((await shell.inputValue()) === '/bin/zshx', where, 'window.sync', `a change under a draft took the draft away: ${JSON.stringify(await shell.inputValue())}`);
    const described = await shell.evaluate((element) => (element.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
    check(/Changed elsewhere to “\/bin\/fish”\. Escape takes it\./.test(described), where, 'window.sync', `the field does not say the host changed it: ${JSON.stringify(described.slice(-120))}`);
    await page.keyboard.press('Escape');
    check((await shell.inputValue()) === '/bin/fish', where, 'window.sync', `Escape took ${JSON.stringify(await shell.inputValue())}, wanted the host's /bin/fish`);
    // A change made here is sent, one setting, and the host holds it.
    await page.getByRole('switch', { name: 'Cursor Blink' }).click();
    await sleep(200);
    const sent = await page.evaluate(() => ({ commits: window.__host.calls.commit, held: window.__host.values.get('terminal.cursorBlink') }));
    check(JSON.stringify(sent.commits) === JSON.stringify([{ 'terminal.cursorBlink': false }]) && sent.held === false, where, 'window.sync', `a change made in the page reached the host as ${JSON.stringify(sent)}, wanted the one setting, false`);
  } finally {
    await context.close();
  }
}

/** Runs the parts of the section `window` for one engine (the window's size is its own: the host makes it 1060 x 640). */
export async function windowSection(env) {
  const timed = async (part, run) => {
    const from = Date.now();
    await run(env);
    note('window', `seconds ${env.engine} ${part}`, round((Date.now() - from) / 1000));
  };
  if (wants(env, 'old')) await timed('old', oldPart);
  if (wants(env, 'bare')) await timed('bare', barePart);
  if (wants(env, 'drag')) await timed('drag', dragPart);
  if (wants(env, 'keys')) await timed('keys', keysPart);
  if (wants(env, 'request')) await timed('request', requestPart);
  if (wants(env, 'sync')) await timed('sync', syncPart);
}

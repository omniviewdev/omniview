// The kit's Sheet part on the REAL ui-next parts page, in WebKit and Chromium, at 1440 x 900 and 1280 x 800 (ST1).
//
//   node packages/kit/probes/sheet-probe.mjs       builds ui-next (OMNIVIEW_UI=next) into a temp dir, serves it, runs every step in both engines at both viewports
//
// Environment: DIST=<dir> reuses a build of ui-next; ENGINES=webkit,chromium; VIEWPORTS=1440x900,1280x800; SHOTS=<dir> writes the screenshots
// (WebKit, three themes, both viewports: sheet-part-<theme>-webkit-<viewport>.png, and Void in Chromium at 1440 x 900 for comparison); REPORT=<file> writes the JSON;
// FONT_DELAY_MS (the kit's serve.mjs holds every font file back); NEGATIVE_CONTROL=<name> runs the whole probe twice per engine at 1440 x 900, clean and with the fault planted, and prints
// `detected: ...` and exits 0 when the fault is seen by the assertion it is named for and by no other and the clean run is silent (1: NOT DETECTED; 2: it trips another assertion;
// 3: the clean run is not silent); ASSERTION_OFF=<regexp> drops every failure whose text matches, and ASSERTION_OFF=says drops the control's own assertion: with it the same fault must pass
// undetected (exit 1), which shows the control trips only the assertion it is named for (docs/ui-next/AGENTS.md, rule 28).
//
// The steps, each one named assertion (the id in a failure's text):
//   closed   nothing is open at load, and the page has no dialog
//   modal    pressing the opener opens ONE modal dialog (`:modal`) and the focus is inside it
//   inert    the page behind cannot take the focus while it is open
//   frame    the frame is 1060 x 640 and centred, the header 41 px, Close 24 x 24 at the end of it, the title 13/16 at 600
//   paint    the frame's fill, edge, text colour and shadow are the tokens they name, and nothing is drawn over the page (no veil: the dialog and its backdrop are transparent)
//   axe      axe-core (colour contrast included) finds no serious or critical violation in the open sheet in Void and Light
//   trap     12 presses of Tab and 12 of Shift+Tab never leave the dialog and cycle through its five controls in order (WebKit on macOS reaches buttons with Option+Tab: that is what is pressed there)
//   scrim    a press on the scrim leaves the sheet open, and Tab then goes on inside it
//   draft    Escape in a field with a draft puts the applied value back and closes nothing; the next Escape closes
//   escape   Escape closes, and the focus is back on the button that opened it (not on the body)
//   close    a press on Close closes, and the focus is back on the button, which was opened from the keyboard
//   page     no error on the page
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { awaitFonts, launch } from './probe-lib.mjs';
import { buildUiNext, serve } from './serve.mjs';

const AXE = process.env.AXE ?? createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const SIZES = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const THEMES = ['void', 'light', 'solarized-light'];
const engines = (process.env.ENGINES ?? 'webkit,chromium').split(',');
const viewports = (process.env.VIEWPORTS ?? '1440x900,1280x800').split(',');
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
let OFF = process.env.ASSERTION_OFF && process.env.ASSERTION_OFF !== 'says' ? new RegExp(process.env.ASSERTION_OFF) : null;
const SHOTS = process.env.SHOTS;
const REPORT = process.env.REPORT;
const EXAMPLE = '[data-example="Sheet/OpenedFromTheButton"]';
const CYCLE = ['Close', 'General', 'Appearance', 'Keyboard', 'Display name'];

const failures = [];
const report = { runs: {}, notes: [] };
let checks = 0;
const fail = (where, id, message) => {
  const text = `${where} ${id}: ${message}`;
  if (OFF === null || !OFF.test(text)) failures.push(text);
};
const check = (ok, where, id, message) => {
  checks += 1;
  if (!ok) fail(where, id, message);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tolerance = 0.51) => Math.abs(a - b) <= tolerance;

// ---- the page ------------------------------------------------------------------------------------------------------------------
async function openPage(browser, size, partsUrl, errors) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico') && !response.url().includes('/wails/')) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text().slice(0, 200));
  });
  await page.goto(partsUrl, { waitUntil: 'load' });
  await page.waitForSelector(EXAMPLE);
  await awaitFonts(page);
  return { page, context };
}

const setTheme = (page, id) => page.evaluate((theme) => document.documentElement.setAttribute('data-ov-theme', theme), id);

/** What the page says now: the dialogs, the one that is open and modal, where the focus is. Runs in the page. */
const read = (page) =>
  page.evaluate((example) => {
    const name = (element) => {
      if (element === null) return 'nothing';
      if (element === document.body) return 'body';
      return (element.getAttribute('aria-label') ?? (element.labels && element.labels[0] ? element.labels[0].textContent : null) ?? (element.textContent ?? '').trim()).slice(0, 40);
    };
    const dialogs = [...document.querySelectorAll('dialog')];
    const dialog = dialogs.find((candidate) => candidate.open) ?? null;
    const figure = document.querySelector(example);
    const opener = [...figure.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === 'Open sheet');
    const active = document.activeElement;
    return {
      dialogs: dialogs.length,
      open: dialogs.filter((candidate) => candidate.open).length,
      modal: dialog === null ? false : dialog.matches(':modal'),
      inside: dialog === null ? false : dialog.contains(active),
      active: name(active),
      onOpener: active === opener,
      onBody: active === document.body || active === null,
      value: document.querySelector('dialog[open] input')?.value ?? null,
    };
  }, EXAMPLE);

const opener = (page) => page.locator(`${EXAMPLE} button`, { hasText: 'Open sheet' });

async function openWithMouse(page) {
  const button = opener(page);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForSelector('dialog[open]');
}

async function openWithKeyboard(page) {
  await opener(page).focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open]');
}

/** Waits until no dialog is open (an assertion that it closes), without throwing when it never does. */
const closed = (page) => page.waitForSelector('dialog[open]', { state: 'detached', timeout: 1500 }).then(() => true, () => false);

/** A sheet left open by a step that did not close it, or a fault that closed it: the next step starts from a closed page. */
async function reset(page) {
  if ((await read(page)).open > 0) {
    await page.keyboard.press('Escape');
    if (!(await closed(page))) await page.evaluate(() => document.querySelector('dialog[open]')?.close());
  }
}

// ---- the steps -----------------------------------------------------------------------------------------------------------------
async function steps(page, engine, where, size) {
  const key = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
  const back = engine === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab';

  // closed
  const before = await read(page);
  check(before.dialogs === 0, where, 'closed', `${before.dialogs} dialogs at load`);

  for (const theme of THEMES) {
    const here = `${where}/${theme}`;
    await setTheme(page, theme);
    await openWithMouse(page);
    const opened = await read(page);
    // modal
    check(opened.open === 1 && opened.modal, here, 'modal', `open ${opened.open}, modal ${opened.modal}`);
    check(opened.inside, here, 'modal', `the focus is on ${opened.active}, outside the dialog`);

    // inert: every control of the page behind refuses the focus
    const refused = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]');
      const took = [];
      for (const control of [...document.querySelectorAll('button, input, select, a[href]')].filter((element) => !dialog.contains(element)).slice(0, 40)) {
        control.focus();
        if (document.activeElement === control) took.push(control.outerHTML.slice(0, 60));
      }

      return took;
    });
    check(refused.length === 0, here, 'inert', `the page behind took the focus: ${refused.slice(0, 2).join(' | ')}`);
    // frame
    const frame = await page.evaluate(() => {
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, w: box.width, h: box.height };
      };
      const dialog = document.querySelector('dialog[open]');
      const part = (name) => dialog.querySelector(`[data-ov-part="${name}"]`);
      const style = (element, property) => getComputedStyle(element)[property];
      return {
        view: { w: innerWidth, h: innerHeight },
        dialog: rect(dialog),
        frame: rect(part('frame')),
        header: rect(part('header')),
        close: rect(part('close')),
        title: rect(part('title')),
        type: { size: style(part('title'), 'fontSize'), line: style(part('title'), 'lineHeight'), weight: style(part('title'), 'fontWeight') },
        font: style(part('frame'), 'fontFamily'),
      };
    });
    const want = { w: 1060, h: 640, x: (size.width - 1060) / 2, y: (size.height - 640) / 2 };
    check(near(frame.dialog.x, 0) && near(frame.dialog.y, 0) && near(frame.dialog.w, size.width) && near(frame.dialog.h, size.height), here, 'frame', `the dialog is ${JSON.stringify(frame.dialog)}, not the window`);
    check(near(frame.frame.w, want.w) && near(frame.frame.h, want.h), here, 'frame', `the frame is ${frame.frame.w} x ${frame.frame.h}, not 1060 x 640`);
    check(near(frame.frame.x, want.x) && near(frame.frame.y, want.y), here, 'frame', `the frame is at ${frame.frame.x},${frame.frame.y}, not centred at ${want.x},${want.y}`);
    check(near(frame.header.h, 41), here, 'frame', `the header is ${frame.header.h} px high, not 41`);
    check(near(frame.close.w, 24) && near(frame.close.h, 24), here, 'frame', `Close is ${frame.close.w} x ${frame.close.h}, not 24 x 24`);
    check(near(frame.close.x + frame.close.w, frame.header.x + frame.header.w - 12), here, 'frame', `Close ends at ${frame.close.x + frame.close.w}, not 12 px inside the header's end`);
    check(near(frame.title.x, frame.header.x + 12), here, 'frame', `the title starts at ${frame.title.x}, not 12 px inside the header`);
    check(frame.type.size === '13px' && frame.type.line === '16px' && frame.type.weight === '600', here, 'frame', `the title is ${JSON.stringify(frame.type)}, not 13px/16px at 600`);
    check(frame.font.includes('Int UI Inter'), here, 'frame', `the frame's font is ${frame.font}`);
    report.runs[here] = { frame: frame.frame, header: frame.header, close: frame.close };

    // paint: what the frame paints is the token it names, in this theme; the page is not veiled
    const paint = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]');
      const frameElement = dialog.querySelector('[data-ov-part="frame"]');
      const title = dialog.querySelector('[data-ov-part="title"]');
      const probe = document.createElement('div');
      dialog.append(probe);
      const resolve = (property, value) => {
        probe.style.cssText = `${property}: ${value}`;
        return getComputedStyle(probe)[property];
      };
      const frameStyle = getComputedStyle(frameElement);
      const result = {
        fill: [frameStyle.backgroundColor, resolve('background-color', 'var(--ov-bg-dialog)')],
        edge: [frameStyle.borderTopColor, resolve('border-top-color', 'var(--ov-border-popup)')],
        text: [getComputedStyle(title).color, resolve('color', 'var(--ov-fg)')],
        shadow: [frameStyle.boxShadow, resolve('box-shadow', 'var(--ov-shadow-popup)')],
        radius: [frameStyle.borderTopLeftRadius, resolve('border-radius', 'var(--ov-radius-popup)')],
        edgeWidth: frameStyle.borderTopWidth,
        veil: {
          dialog: getComputedStyle(dialog).backgroundColor,
          backdrop: getComputedStyle(dialog, '::backdrop').backgroundColor,
          before: getComputedStyle(dialog, '::before').content,
          after: getComputedStyle(dialog, '::after').content,
          z: getComputedStyle(dialog).zIndex,
          transition: getComputedStyle(frameElement).transitionDuration,
          animation: getComputedStyle(frameElement).animationName,
        },
      };
      probe.remove();
      return result;
    });
    for (const part of ['fill', 'edge', 'text', 'shadow', 'radius']) check(paint[part][0] === paint[part][1], here, 'paint', `the ${part} is ${paint[part][0]}, the token is ${paint[part][1]}`);
    check(paint.edgeWidth === '1px', here, 'paint', `the edge is ${paint.edgeWidth}, not 1px`);
    check(paint.veil.dialog === 'rgba(0, 0, 0, 0)' && paint.veil.backdrop === 'rgba(0, 0, 0, 0)', here, 'paint', `a veil: dialog ${paint.veil.dialog}, backdrop ${paint.veil.backdrop}`);
    check(['none', 'normal'].includes(paint.veil.before) && ['none', 'normal'].includes(paint.veil.after), here, 'paint', `a pseudo-element is drawn: ${paint.veil.before} ${paint.veil.after}`);
    check(paint.veil.z === 'auto', here, 'paint', `z-index ${paint.veil.z}`);
    check(paint.veil.transition === '0s' && paint.veil.animation === 'none', here, 'paint', `the frame moves: transition ${paint.veil.transition}, animation ${paint.veil.animation}`);

    // axe (colour contrast included, which jsdom cannot judge) in Void and Light
    if (theme !== 'solarized-light') {
      if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ path: AXE });
      const found = await page.evaluate(async () => {
        const result = await window.axe.run(document.querySelector('dialog[open]'), { resultTypes: ['violations'] });
        return result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')).map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
      });
      check(found.length === 0, here, 'axe', found.join(' | '));
    }

    // screenshots: the open sheet, WebKit at both viewports in the three themes, and Void in Chromium at 1440 x 900 to compare the engines
    if (SHOTS !== undefined && (engine === 'webkit' || (engine === 'chromium' && theme === 'void' && size.width === 1440))) {
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(size.width - 2, size.height - 2);
      await page.screenshot({ path: path.join(SHOTS, `sheet-part-${theme}-${engine}-${size.width}x${size.height}.png`) });
    }

    await reset(page);
  }

  // trap: the dialog is open in Void with the focus on Close
  await setTheme(page, 'void');
  await reset(page);
  await openWithMouse(page);
  const trap = { forward: [], backward: [] };
  const start = await read(page);
  check(start.active === 'Close', where, 'trap', `the sheet opened with the focus on ${start.active}, not Close`);
  for (const [direction, press, expected] of [
    ['forward', key, Array.from({ length: 12 }, (_, index) => CYCLE[(index + 1) % CYCLE.length])],
    ['backward', back, Array.from({ length: 12 }, (_, index) => CYCLE[(CYCLE.length - 1 - (index % CYCLE.length) + CYCLE.length) % CYCLE.length])],
  ]) {
    await page.evaluate(() => document.querySelector('dialog[open] [data-ov-part="close"]')?.focus());
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press(press);
      const now = await read(page);
      trap[direction].push(now.inside ? now.active : `OUTSIDE:${now.active}`);
    }

    check(trap[direction].every((name) => !name.startsWith('OUTSIDE:')), where, 'trap', `${direction}: the focus left the dialog: ${trap[direction].join(', ')}`);
    check(same(trap[direction], expected), where, 'trap', `${direction}: the focus went ${trap[direction].join(', ')}, not ${expected.join(', ')}`);
  }

  report.runs[`${where}/trap`] = trap;

  // scrim: a press outside the frame
  await page.evaluate(() => document.querySelector('dialog[open] [data-ov-part="close"]')?.focus());
  const rect = await page.evaluate(() => {
    const box = document.querySelector('dialog[open] [data-ov-part="frame"]').getBoundingClientRect();
    return { left: box.left, top: box.top, bottom: box.bottom };
  });
  await page.mouse.click(Math.round(rect.left / 2), Math.round(size.height / 2));
  const afterScrim = await read(page);
  check(afterScrim.open === 1, where, 'scrim', `a press on the scrim left ${afterScrim.open} dialogs open`);
  if (afterScrim.open === 1) {
    await page.keyboard.press(key);
    const entered = await read(page);
    check(entered.inside, where, 'scrim', `after a press on the scrim, Tab put the focus on ${entered.active}, outside the dialog`);
    report.runs[`${where}/scrim`] = { afterPress: afterScrim.active, afterTab: entered.active };
  }

  await reset(page);

  // draft: Escape in a field with a draft is the field's; the next Escape closes
  await openWithMouse(page);
  const field = page.locator('dialog[open]').getByRole('textbox', { name: 'Display name' });
  await field.click();
  const applied = (await read(page)).value;
  await page.keyboard.type(' 2');
  const typed = (await read(page)).value;
  check(typed === `${applied} 2`, where, 'draft', `the draft is ${typed}, not ${applied} 2`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const reverted = await read(page);
  check(reverted.open === 1 && reverted.value === applied, where, 'draft', `after the first Escape: ${reverted.open} dialogs open, the field holds ${reverted.value}, not ${applied}`);
  if (reverted.open === 1) {
    await page.keyboard.press('Escape');
    check(await closed(page), where, 'draft', 'the second Escape did not close the sheet');
  }

  await reset(page);

  // escape: the focus is back on the opener
  await openWithMouse(page);
  await page.evaluate(() => (window.__step = 'escape'));
  await page.keyboard.press('Escape');
  const escaped = await closed(page);
  await page.evaluate(() => (window.__step = ''));
  const afterEscape = await read(page);
  check(escaped, where, 'escape', 'Escape did not close the sheet');
  check(afterEscape.onOpener, where, 'escape', `after Escape the focus is on ${afterEscape.active}, not on the button that opened it`);
  check(!afterEscape.onBody, where, 'escape', 'after Escape the focus is on the body');
  await reset(page);

  // close: opened from the keyboard, closed by a press on Close
  await openWithKeyboard(page);
  await page.evaluate(() => (window.__step = 'close'));
  await page.locator('dialog[open] [data-ov-part="close"]').click();
  const closedByClose = await closed(page);
  await page.evaluate(() => (window.__step = ''));
  const afterClose = await read(page);
  check(closedByClose, where, 'close', 'a press on Close did not close the sheet');
  check(afterClose.onOpener, where, 'close', `after Close the focus is on ${afterClose.active}, not on the button that opened it`);
  await reset(page);
}

// ---- the faults a control plants ----------------------------------------------------------------------------------------------------
const CONTROLS = {
  'no-wrap': {
    says: / trap: /,
    fault: 'Tab never reaches the part: the engine alone moves the focus',
    plant: (page) => page.evaluate(() => window.addEventListener('keydown', (event) => event.key === 'Tab' && event.stopImmediatePropagation(), true)),
  },
  'scrim-closes': {
    says: / scrim: /,
    fault: 'a press on the scrim sends the dialog the close request that Escape sends',
    plant: (page) =>
      page.evaluate(() =>
        document.addEventListener('pointerdown', (event) => event.target instanceof HTMLDialogElement && event.target.dispatchEvent(new Event('cancel', { cancelable: true })), true),
      ),
  },
  'escape-ignores-draft': {
    says: / draft: /,
    fault: 'the field never sees Escape, so the browser sends the close request even though the field has a draft',
    plant: (page) => page.evaluate(() => window.addEventListener('keydown', (event) => event.key === 'Escape' && event.target instanceof HTMLInputElement && event.stopImmediatePropagation(), true)),
  },
  'no-restore-escape': {
    says: / escape: /,
    fault: 'the focus is not given back to the opener after Escape',
    plant: (page) => plantNoRestore(page, 'escape'),
  },
  'no-restore-close': {
    says: / close: /,
    fault: 'the focus is not given back to the opener after Close',
    plant: (page) => plantNoRestore(page, 'close'),
  },
  'veil-present': {
    says: / paint: /,
    fault: 'a veil is drawn over the page behind the sheet (the frame is positioned above it, as a part that drew one would have to)',
    plant: (page) =>
      page.addStyleTag({ content: '[data-ov-part="sheet"]::before { content: ""; position: absolute; inset: 0; background-color: var(--ov-bg-dialog); opacity: 0.5; } [data-ov-part="frame"] { position: relative; }' }),
  },
  'frame-size': {
    says: / frame: /,
    fault: 'the frame is 1000 px wide',
    plant: (page) => page.addStyleTag({ content: '[data-ov-part="frame"] { inline-size: 1000px !important; }' }),
  },
};

/** The restore is `element.focus()` on the opener while the step is `which`: it does nothing, as if the part had never given the focus back. */
const plantNoRestore = (page, which) =>
  page.evaluate((step) => {
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function patched(...args) {
      if (window.__step === step && this instanceof HTMLButtonElement && (this.textContent ?? '').trim() === 'Open sheet') return undefined;
      return focus.apply(this, args);
    };
  }, which);

// ---- the run -------------------------------------------------------------------------------------------------------------------
async function runOne(browser, engine, viewport, partsUrl, plant) {
  const errors = [];
  const { page, context } = await openPage(browser, SIZES[viewport], partsUrl, errors);
  if (plant) await plant(page);
  const where = `${engine}@${viewport}`;
  const started = Date.now();
  try {
    await steps(page, engine, where, SIZES[viewport]);
  } catch (error) {
    fail(where, 'page', `the step threw: ${String(error.message).split('\n')[0]}`);
  }

  for (const message of errors) fail(where, 'page', `error: ${message}`);
  report.runs[`${where}/seconds`] = (Date.now() - started) / 1000;
  await context.close();
}

async function runControl(partsUrl) {
  const control = CONTROLS[CONTROL];
  if (control === undefined) throw new Error(`no control named ${CONTROL}; the controls are ${Object.keys(CONTROLS).join(', ')}`);
  if (process.env.ASSERTION_OFF === 'says') OFF = control.says;
  let code = 0;
  for (const engine of engines) {
    const browser = await launch(engine);
    const clean = [];
    const planted = [];
    for (const [into, plant] of [[clean, null], [planted, control.plant]]) {
      failures.length = 0;
      await runOne(browser, engine, '1440x900', partsUrl, plant);
      into.push(...failures);
    }

    await browser.close();
    if (clean.length > 0) {
      console.log(`INVALID: ${CONTROL} (${engine}): the clean run is not silent, so the control proves nothing:\n  ${clean.join('\n  ')}`);
      code = Math.max(code, 3);
      continue;
    }

    const strays = planted.filter((text) => !control.says.test(text));
    if (strays.length > 0) {
      console.log(`INVALID: ${CONTROL} (${engine}; ${control.fault}) trips assertions it is not named for: ${strays.join(' | ')}`);
      code = Math.max(code, 2);
    } else if (planted.length === 0) {
      console.log(`NOT DETECTED: ${CONTROL} (${engine}; ${control.fault})`);
      code = Math.max(code, 1);
    } else {
      console.log(`detected: ${CONTROL} (${engine}; ${control.fault}): ${planted[0]}`);
    }
  }

  return code;
}

console.log(`uptime: ${execSync('uptime').toString().trim()}`);
const started = Date.now();
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });
const dist = buildUiNext();
const { server, partsUrl } = await serve(dist);
let code = 0;
try {
  if (CONTROL !== '') {
    code = await runControl(partsUrl);
  } else {
    for (const engine of engines) {
      const browser = await launch(engine);
      for (const viewport of viewports) await runOne(browser, engine, viewport, partsUrl, null);
      await browser.close();
    }

    const unique = [...new Set(failures)];
    for (const text of unique) console.log(`FAIL ${text}`);
    console.log(`sheet-part-probe: ${checks} checks, ${unique.length} failures (${((Date.now() - started) / 1000).toFixed(1)}s in all)`);
    if (REPORT !== undefined) writeFileSync(REPORT, `${JSON.stringify({ checks, failures: unique, ...report }, null, 1)}\n`);
    code = unique.length === 0 ? 0 : 1;
  }
} finally {
  server.close();
}

process.exit(code);

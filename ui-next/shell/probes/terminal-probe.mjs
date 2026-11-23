// Probes the Terminal tool in WebKit and Chromium (docs/ui-next/status/T1.md): the real host's window with NO plugin and a SYNTHETIC shell behind the real exec feed (terminal-fixture.tsx), in a production build of the
// fixture (the measurements) and a development build (React's Profiler counts commits there). The emulator is the product's own, in its lazy chunk.
//
//   node ui-next/shell/probes/terminal-probe.mjs      builds the fixture twice (OMNIVIEW_UI=next), serves it, probes it in WebKit and Chromium at 1440 x 900 and 1280 x 800
//
//   FIXTURE_DIST=<dir> FIXTURE_DIST_DEV=<dir>   probe existing builds      ENGINES=webkit,chromium      VIEWPORTS=1440x900,1280x800      SECTIONS=geometry,keys      REPORT=<file>   the report as JSON
//   NEGATIVE_CONTROL=<name>   perturb the page so ONE assertion must fail, in the section it belongs to; "detected" and exit 0 when only that assertion failed, "NOT DETECTED" or "failed another assertion" and exit 1 when not
//   ASSERTION_OFF=<regex>     drops the failures whose name matches, as if the assertion were not there: the control of it must then print NOT DETECTED (the proof that it trips that assertion and no other)
//   SCREEN_READER=on          turn the Terminal's screen reader mode on right after each terminal starts, through its palette command and by the keyboard as a person does, so that a section measures a terminal with the mode on:
//                             `SECTIONS=flood,hidden,idle,commits SCREEN_READER=on` is what the mode costs (docs/ui-next/status/T1.md section 16). Every other section is written for the mode off.
//
// Sections and their assertions (the name starts each line of a failure):
//   geometry   (both viewports, both engines)  geometry.body / tools / button / screen / lane / rows / colors: the rectangles, sizes and colours of the mock's terminal body (mock-terminal.json: the mock measured in each engine at each
//              viewport)
//   words      the empty state, the toolbar and its names, the input's name and hint, the lane for a running, ended and failed session, the exit line written into the transcript
//   keys       A14, never trap: Escape and Tab stay in the shell (keys.escape, keys.tab), F6 leaves (keys.f6), Ctrl+C is the interrupt (keys.interrupt), copy and paste chords (keys.copy, keys.paste)
//   close      the question a close of a running terminal asks: a modal (close.modal), Cancel has the focus, Escape says no (close.no), Terminate session ends the process and the focus goes to the tool's tab (close.yes)
//   resize     the first size at once (resize.first), a drag of the splitter is one message after it settles (resize.messages) and it is the size the screen has (resize.last)
//   bundle     the emulator costs nothing until the first terminal: not in the entry chunk or the entry stylesheet (bundle.entry), not requested before (bundle.lazy), requested after (bundle.fetched)
//   hidden     a hidden panel is no work: no frame (hidden.frames), no write (hidden.writes), no timer (hidden.timers), and what it held is drawn when shown (hidden.drain)
//   idle       an idle terminal runs no timer and asks for no frame (idle.timers), and renders nothing (idle.commits, development build)
//   commits    no React commit for an output chunk (commits.chunk, development build)
//   flood      16 MB in 16,000 events: every byte parsed (flood.complete), frames at 60 Hz or near (flood.frames), no long task (flood.longtask, Chromium)
//   latency    a key reaches the process in a frame, idle (latency.idle) and under a flood (latency.flood; latency.premise: the flood was still running)
//   memory     1,000,000 lines of 80 columns: the oldest line the emulator keeps is the one the 5,000-line cap leaves (memory.cap), and the Chromium JS heap grows no more than 60 MB (memory.heap)
//   paint      what is PAINTED, read from the pixels of a screenshot: no frame around the screen while the emulator has the keyboard, its caret is the focus indicator (paint.ring, paint.caret); no scrollbar at rest or over a screen that
//              does not scroll (scrollbar.rest), a thin one while scrolling (scrollbar.thin) that goes away again once the wheel stops and the pointer leaves (scrollbar.hides)
//   axe        axe-core: no violation for the running terminal, the empty tool and the question
//   screenreader       the Terminal's screen reader mode (docs/ui-next/status/T1.md section 16), in the DOM renderer, where the printed lines are in the page and are hidden from the accessibility tree until the mode is on: turned on and off
//              through the palette command by the keyboard alone, the screen's accessibility snapshot holds a known line, and a later one, while it is on (screenreader.tree) and holds neither before it was turned on and after it was
//              turned off (screenreader.tree-off); the input's name starts with Terminal and the words it is described by say what the mode is and how to change it, in both states (screenreader.words); the result is announced once
//              for each change through the window's polite live region, when no modal dialog owns the window (screenreader.announce); axe finds nothing in the running terminal with the mode on and with it off (screenreader.axe)
//   screenreader-cost  the mode on costs nothing at rest: an idle terminal runs no timer and asks for no frame (screenreader.idle), and a hidden panel is no work (screenreader.hidden)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { serve } from '../../../packages/kit/probes/serve.mjs';
import { AXE } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const REF = JSON.parse(readFileSync(path.join(here, 'mock-terminal.json'), 'utf8'));
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const VIEWPORTS = Object.fromEntries((process.env.VIEWPORTS ?? '1440x900,1280x800').split(',').map((vp) => [vp, { width: Number(vp.split('x')[0]), height: Number(vp.split('x')[1]) }]));
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
const OFF = process.env.ASSERTION_OFF === undefined ? undefined : new RegExp(process.env.ASSERTION_OFF);
/** The screen reader mode on after each terminal starts, for the sections that measure what it costs (`SCREEN_READER=on`), and the words the notes say it with. */
const READER = process.env.SCREEN_READER ?? '';
if (READER !== '' && READER !== 'on') throw new Error(`SCREEN_READER must be on or not set, it is ${JSON.stringify(READER)}`);
const MODE = READER === 'on' ? ' [screen reader mode on]' : '';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The negative controls: the assertion each must trip (and no other), the section it belongs to, and how the page is perturbed. `query` perturbs the fixture; `init` runs before the page's own scripts; `after` after the terminal is up.
 * A control of the screen reader sections says where its `after` runs in the section (`stage`): `start` (the terminal is up and the mode is still off), `idle` (an idle terminal with the mode on, after its first second) or
 * `hidden` (the panel is hidden with the mode on). What those perturb is the page's, not the engine's, so they run in Chromium alone.
 */
const CONTROLS = {
  'lane-border': { assertion: 'geometry.lane', section: 'geometry', after: (page) => page.addStyleTag({ content: '[data-shell-part="terminalLane"]{border-block-start-color:rgb(255, 0, 0) !important}' }) },
  'button-size': { assertion: 'geometry.button', section: 'geometry', after: (page) => page.addStyleTag({ content: '[data-terminal-tool]{inline-size:32px !important;block-size:32px !important}' }) },
  'ring-back': { assertion: 'paint.ring', section: 'paint', after: (page) => page.addStyleTag({ content: '[data-shell-part="terminalScreen"]:focus-within{outline:2px solid rgb(56, 113, 225) !important;outline-offset:-2px !important}' }) },
  'scrollbar-block': { assertion: 'scrollbar.rest', section: 'paint', after: (page) => page.addStyleTag({ content: '[data-shell-part="terminalScreen"]:not([data-scrollable]) .xterm-scrollable-element > .scrollbar.vertical{display:block !important;opacity:1 !important}' }) },
  // A scrollbar that stays once there is scrollback: it is forced only after the screen has something to scroll to, so the screen that does not scroll still passes `scrollbar.rest` and the thumb still passes `scrollbar.thin`.
  'scrollbar-stuck': { assertion: 'scrollbar.hides', section: 'paint', after: (page) => page.addStyleTag({ content: '[data-shell-part="terminalScreen"][data-scrollable] .xterm-scrollable-element > .scrollbar.vertical{opacity:1 !important;transition:none !important}' }) },
  'f6-trap': { assertion: 'keys.f6', section: 'keys', init: () => document.addEventListener('keydown', (event) => { if (event.key === 'F6') { event.stopImmediatePropagation(); } }, true) },
  'escape-leaves': { assertion: 'keys.escape', section: 'keys', init: () => document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { document.activeElement?.blur(); } }, true) },
  // A dialog that is open and not modal (what `show()` makes): Escape still says no (the browser's own cancel is told by hand), so only the modal assertion can see it.
  'modal-off': { assertion: 'close.modal', section: 'close', init: () => { HTMLDialogElement.prototype.showModal = function showModal() { this.show(); this.addEventListener('keydown', (event) => { if (event.key === 'Escape') this.dispatchEvent(new Event('cancel', { cancelable: true })); }); }; } },
  'resize-chatty': { assertion: 'resize.messages', section: 'resize', init: () => { const original = window.setTimeout.bind(window); window.setTimeout = (fn, ms, ...rest) => original(fn, ms === 100 ? 0 : ms, ...rest); } },
  'hidden-frames': { assertion: 'hidden.frames', section: 'hidden', after: (page) => page.evaluate(() => { const tick = () => requestAnimationFrame(tick); tick(); }) },
  'idle-timer': { assertion: 'idle.timers', section: 'idle', after: (page) => page.evaluate(() => { setInterval(() => undefined, 500); }) },
  'chunk-commit': { assertion: 'commits.chunk', section: 'commits', query: 'control=chunk-commit' },
  // Every frame is asked for 45 ms late (a page whose frames come at about a quarter of the rate, with nothing blocked): p95 of the frame times is about 55 ms, over the 34 ms bound with room; no task is a long one and the drain (a share of 512 KiB a frame) keeps up with the shell, so only the frame assertion can see it.
  // `engines`: where the control runs. Frames that come late make the next frame's batch bigger, so in Chromium, which reports long tasks, it also trips the long task assertion: it runs in WebKit, which does not.
  'flood-janky': { assertion: 'flood.frames', section: 'flood', engines: ['webkit'], init: () => { const original = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (callback) => { window.setTimeout(() => { original(callback); }, 45); return 0; }; } },
  'echo-slow': { assertion: 'latency.idle', section: 'latency', query: 'control=echo-slow' },
  'lazy-load': { assertion: 'bundle.lazy', section: 'bundle', after: (page, origin) => page.evaluate(async (url) => { const chunk = [...document.querySelectorAll('script')].length; await import(url).catch(() => undefined); return chunk; }, origin) },
  'big-scrollback': { assertion: 'memory.cap', section: 'memory', query: 'control=big-scrollback' },
  'leaky-heap': { assertion: 'memory.heap', section: 'memory', engines: ['chromium'], query: 'control=leaky-heap' },
  // The screen reader switch (docs/ui-next/status/T1.md section 16). An emulator that is never put in the mode the window says it is in (the lines are not in the accessibility tree while the store, the description and the announcement all
  // say they are), and one that is put in it and never taken out.
  'reader-claims': { assertion: 'screenreader.tree', section: 'screenreader', engines: ['chromium'], query: 'control=reader-claims' },
  'reader-stuck': { assertion: 'screenreader.tree-off', section: 'screenreader', engines: ['chromium'], query: 'control=reader-stuck' },
  // The words that were true while the mode was off, kept: the input is described by a copy of them taken before the mode was turned on, so it never says that the mode is on.
  'reader-words-stale': { assertion: 'screenreader.words', section: 'screenreader', engines: ['chromium'], stage: 'start', after: (page) => page.evaluate(() => { const input = document.querySelector('.xterm-helper-textarea'); const real = document.getElementById(input.getAttribute('aria-describedby')); const frozen = real.cloneNode(true); frozen.id = 'frozen-description'; real.after(frozen); input.setAttribute('aria-describedby', 'frozen-description'); }) },
  // Every announcement made twice: a node with the same words is added to the live region right after each one.
  'reader-announce-twice': { assertion: 'screenreader.announce', section: 'screenreader', engines: ['chromium'], stage: 'start', after: (page) => page.evaluate(() => { const live = document.querySelector('[data-notices-part="live"]'); new MutationObserver((list) => { for (const record of list) for (const node of record.addedNodes) if (node.dataset?.again === undefined && (node.textContent ?? '') !== '') { const again = document.createElement('span'); again.dataset.again = ''; again.textContent = node.textContent; live.append(again); } }).observe(live, { childList: true }); }) },
  // A violation that exists only while the mode is on: an image with no text alternative, added to the emulator's accessibility layer the moment the layer is made (it is removed with the mode).
  'reader-axe': { assertion: 'screenreader.axe', section: 'screenreader', engines: ['chromium'], stage: 'start', after: (page) => page.evaluate(() => { new MutationObserver((list) => { for (const record of list) for (const node of record.addedNodes) if (node.classList?.contains('xterm-accessibility')) { const image = document.createElement('img'); image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; node.append(image); } }).observe(document.querySelector('.xterm'), { childList: true }); }) },
  // The work a hidden panel and an idle terminal must not do, with the mode on: a frame loop that runs while the panel is hidden, and an interval started once the terminal is idle.
  'reader-hidden-frames': { assertion: 'screenreader.hidden', section: 'screenreader-cost', engines: ['chromium'], stage: 'hidden', after: (page) => page.evaluate(() => { const tick = () => requestAnimationFrame(tick); tick(); }) },
  'reader-idle-timer': { assertion: 'screenreader.idle', section: 'screenreader-cost', engines: ['chromium'], stage: 'idle', after: (page) => page.evaluate(() => { setInterval(() => undefined, 500); }) },
};
if (CONTROL !== '' && CONTROL !== 'all' && CONTROLS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be all or one of ${Object.keys(CONTROLS).join(', ')}`);

// NEGATIVE_CONTROL=all runs every control twice, in a run of its own: with its assertion (it must be detected by that assertion and no other) and with the assertion removed (ASSERTION_OFF: it must pass undetected, the proof that
// the control trips that assertion and nothing else). The fixtures are built once.
if (CONTROL === 'all') {
  const production = build('production');
  const development = build('development');
  const me = fileURLToPath(import.meta.url);
  let wrong = 0;
  for (const [name, control] of Object.entries(CONTROLS)) {
    const run = (extra) => spawnSync(process.execPath, [me], { env: { ...process.env, FIXTURE_DIST: production, FIXTURE_DIST_DEV: development, NEGATIVE_CONTROL: name, ...extra }, encoding: 'utf8' });
    const withIt = run({});
    const without = run({ ASSERTION_OFF: `^${control.assertion.replaceAll('.', '\\.')}$` });
    const detected = withIt.status === 0 && /detected by/.test(withIt.stdout);
    const undetected = without.status === 1 && /NOT DETECTED/.test(without.stderr);
    if (!detected || !undetected) wrong += 1;
    console.log(`${name}: ${detected ? `detected by ${control.assertion}` : `NOT AS EXPECTED: ${(withIt.stdout + withIt.stderr).split('\n').filter((line) => /NEGATIVE/.test(line))[0] ?? 'no verdict'}`}; assertion removed: ${undetected ? 'passes undetected, as it must' : `NOT AS EXPECTED: ${(without.stdout + without.stderr).split('\n').filter((line) => /NEGATIVE/.test(line))[0] ?? 'no verdict'}`}`);
  }

  process.exit(wrong === 0 ? 0 : 1);
}

const failures = [];
const report = { notes: [], numbers: {} };
let checked = 0;
function check(name, ok, detail) {
  checked += 1;
  if (OFF !== undefined && OFF.test(name)) return;
  if (!ok) failures.push(`${name}: ${detail}`);
}
const note = (text) => {
  report.notes.push(text);
  console.log(text);
};
const near = (a, b, tolerance = 1) => typeof a === 'number' && Math.abs(a - b) <= tolerance;
const rectNear = (a, b, tolerance = 1) => Array.isArray(a) && a.every((value, index) => near(value, b[index], tolerance));
const percentile = (values, p) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
const round = (n) => Math.round(n * 100) / 100;

/**
 * Counts what a page asks of the main thread: timers and frames created and fired, only while `window.__count.on`, and the repeating intervals alive at any moment (`active`: an interval started before the count
 * began is still a timer that fires). Installed before the page's own scripts.
 */
const COUNTERS = () => {
  const counts = (window.__count = { on: false, timeout: 0, interval: 0, raf: 0, fired: 0, active: 0 });
  const alive = new Set();
  const wrap = (name, key, repeats) => {
    const original = window[name].bind(window);
    window[name] = (callback, ...args) => {
      if (counts.on) counts[key] += 1;
      const run = typeof callback === 'function' ? (...inner) => { if (counts.on) counts.fired += 1; return callback(...inner); } : callback;
      const id = original(run, ...args);
      if (repeats) {
        alive.add(id);
        counts.active = alive.size;
      }

      return id;
    };
  };
  wrap('setTimeout', 'timeout', false);
  wrap('setInterval', 'interval', true);
  wrap('requestAnimationFrame', 'raf', false);
  const clear = window.clearInterval.bind(window);
  window.clearInterval = (id) => {
    alive.delete(id);
    counts.active = alive.size;
    return clear(id);
  };
  // Every key the page is given, with the instant the browser made it: the start of an input's latency.
  window.__keydowns = [];
  window.addEventListener('keydown', (event) => window.__keydowns.push(event.timeStamp), true);
  window.__longtasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longtasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    window.__longtasks = null;
  }
};

function build(mode) {
  const existing = mode === 'development' ? process.env.FIXTURE_DIST_DEV : process.env.FIXTURE_DIST;
  if (existing !== undefined && existing !== '') return existing;
  const out = mkdtempSync(path.join(os.tmpdir(), `terminal-fixture-${mode}-`));
  execFileSync('node', [path.join(here, 'terminal-build.mjs'), out, mode], { cwd: repo, env: { ...process.env, OMNIVIEW_UI: 'next', NODE_ENV: mode }, stdio: 'pipe' });
  return out;
}

async function open(browser, origin, viewport, { query = '', control } = {}) {
  const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
  const page = await context.newPage();
  page.errors = [];
  page.requests = [];
  page.on('pageerror', (error) => page.errors.push(error.message.slice(0, 300)));
  page.on('request', (request) => page.requests.push({ url: request.url(), at: Date.now() }));
  await page.addInitScript(COUNTERS);
  if (control?.init !== undefined) await page.addInitScript(control.init);
  const params = [query, control?.query].filter((part) => part !== undefined && part !== '').join('&');
  await page.goto(`${origin}/shell/probes/terminal-fixture.html${params === '' ? '' : `?${params}`}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-shell-part="window"]');
  return page;
}

/**
 * The panel opens on the Terminal tool, New terminal starts the synthetic shell, and the emulator has the keyboard. With `SCREEN_READER=on` the screen reader mode is turned on once the terminal is up, as a person does it (`plain`
 * leaves it off: the screen reader sections turn it on and off themselves).
 */
async function start(page, { plain = false } = {}) {
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine.writes > 0 && window.__pty.log.resizes.length >= 1, null, { timeout: 15_000 });
  await sleep(500);
  if (READER === 'on' && !plain) await switchReader(page);
}

const typeLine = async (page, text) => {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await sleep(150);
};

const rectOf = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el === null) return null; const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 100) / 100); })()`;
const readRects = (page, selectors) => page.evaluate(`({ ${Object.entries(selectors).map(([key, selector]) => `${JSON.stringify(key)}: ${rectOf(selector)}`).join(', ')} })`);
const activeIsTerminal = (page) => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false);

/** The line the synthetic shell prints for `hello`, and the palette command that turns the screen reader mode on and off (the product's own words: `shell/panel/terminal/screenReader.ts`). */
const LINE = 'hello from the synthetic shell';
const COMMAND = 'Terminal: Toggle Screen Reader Mode';

/**
 * Records what the window's polite live region is told (`window.__told`), once for each page: one entry for each node that arrives in it with words (the region replaces its node for each announcement, so a sentence told twice
 * is two), and whether a modal dialog owned the window at that instant (a live region that is outside the accessibility tree while a modal is open is not heard).
 */
const watchLive = (page) =>
  page.evaluate(() => {
    if (window.__told !== undefined) return;
    window.__told = [];
    new MutationObserver((list) => {
      for (const record of list) for (const node of record.addedNodes) if ((node.textContent ?? '') !== '') window.__told.push({ text: node.textContent, modal: document.querySelector('dialog:modal') !== null });
    }).observe(document.querySelector('[data-notices-part="live"]'), { subtree: true, childList: true, characterData: true });
  });

/**
 * Turns the Terminal's screen reader mode on or off as a person with a keyboard does, through its palette command: F6 leaves the terminal, the palette's chord (the page's own platform's) opens the palette, the words find the
 * command and Enter runs it. Waits for the announcement of the result and a moment more for a second one, puts the keyboard back in the terminal, and answers what the live region was told meanwhile.
 */
async function switchReader(page) {
  await watchLive(page);
  const heard = await page.evaluate(() => window.__told.length);
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await page.keyboard.press('F6');
  await page.keyboard.press(mac ? 'Meta+k' : 'Control+k');
  await page.waitForSelector('dialog[open]', { timeout: 5000 });
  await page.keyboard.type('screen reader');
  await page.getByRole('option', { name: new RegExp(`^Command: ${COMMAND}`) }).waitFor({ timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction((count) => window.__told.length > count, heard, { timeout: 5000 });
  await sleep(300);
  await page.locator('.xterm-helper-textarea').focus();
  return page.evaluate((count) => window.__told.slice(count), heard);
}

/**
 * What a screen reader finds of the terminal now: the accessibility snapshot of the screen's region and the listitems in it that hold the known line (Playwright's own computation of roles and names, which leaves out what is
 * `aria-hidden`), whether the page holds the line at all (the DOM renderer's row: in the page, and hidden from the tree), the input's name and the words it is described by, and how many nodes the screen has.
 */
async function reading(page) {
  const region = page.locator('[data-shell-part="terminalScreen"]');
  const dom = await page.evaluate((line) => {
    const input = document.querySelector('.xterm-helper-textarea');
    return {
      inDom: (document.querySelector('.xterm-rows')?.textContent ?? '').includes(line),
      label: input.getAttribute('aria-label') ?? '',
      description: document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
      nodes: document.querySelector('[data-shell-part="terminalScreen"]').querySelectorAll('*').length,
    };
  }, LINE);
  return { snapshot: await region.ariaSnapshot(), lines: await region.getByRole('listitem').filter({ hasText: LINE }).count(), named: await region.getByRole('textbox', { name: /^Terminal/ }).count(), ...dom };
}

/** Runs the perturbation of the negative control that belongs at `stage` of a screen reader section, if the control has one there. */
const perturb = (ctx, page, stage) => (ctx.control?.stage === stage ? ctx.control.after?.(page, ctx.origin) : undefined);

/** What axe-core finds in the part of the page `selector` names, one line for each rule. The page around the tool is the shell's, whose own findings its probes keep (the panel's handle outside a landmark). */
const runAxe = (page, selector) =>
  page.evaluate(async (context) => {
    const result = await window.axe.run(document.querySelector(context), { resultTypes: ['violations'] });
    return result.violations.map((violation) => `${violation.id} (${String(violation.nodes.length)}): ${violation.nodes[0].target.join(' ')}`);
  }, selector);

// ---------------------------------------------------------------------------------------------------- geometry
async function geometry(ctx) {
  const { browser, origin, viewport, vp, engine } = ctx;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await start(page);
  await typeLine(page, 'hello');
  await ctx.control?.after?.(page, origin);
  const r = await readRects(page, {
    panel: '[data-shell-part="panel"]',
    body: '[data-shell-part="terminalBody"]',
    tools: '[data-shell-part="terminalTools"]',
    button: '[data-terminal-tool="clear"]',
    button2: '[data-terminal-tool="copy"]',
    screen: '[data-shell-part="terminalScreen"]',
    lane: '[data-shell-part="terminalLane"]',
    row: '.xterm-rows > div:nth-child(1)',
    row2: '.xterm-rows > div:nth-child(2)',
  });
  const style = await page.evaluate(() => {
    const css = (selector, props) => {
      const el = document.querySelector(selector);
      if (el === null) return null;
      const computed = getComputedStyle(el);
      return Object.fromEntries(props.map((prop) => [prop, computed.getPropertyValue(prop)]));
    };
    return {
      screen: css('[data-shell-part="terminalScreen"]', ['background-color', 'outline-width', 'outline-style', 'outline-color', 'outline-offset']),
      lane: css('[data-shell-part="terminalLane"]', ['border-top-color', 'border-top-width', 'background-color', 'height']),
      row: css('.xterm-rows > div:nth-child(1)', ['font-size', 'height', 'line-height']),
      foreground: css('[data-swatch="foreground"]', ['color']),
      font: css('[data-swatch="font"]', ['font-size', 'line-height', 'font-family']),
    };
  });
  const tag = `${engine} ${vp}`;
  // The mock's rectangles, measured in this engine at this viewport (mock-terminal.json): the body, the toolbar column, its first button, the screen, the lane and the first row of the transcript.
  const ref = REF.viewports[engine]?.[vp] ?? REF.viewports.webkit[vp];
  check('geometry.body', rectNear(r.panel, ref.panel) && rectNear(r.body, ref.body), `${tag}: panel ${JSON.stringify(r.panel)} body ${JSON.stringify(r.body)}, the mock's ${JSON.stringify(ref.panel)} ${JSON.stringify(ref.body)}`);
  check('geometry.tools', rectNear(r.tools, ref.tools), `${tag}: the toolbar column is ${JSON.stringify(r.tools)}, the mock's ${JSON.stringify(ref.tools)}`);
  check('geometry.button', rectNear(r.button, ref.firstButton), `${tag}: the first button is ${JSON.stringify(r.button)}, the mock's ${JSON.stringify(ref.firstButton)}`);
  check('geometry.screen', rectNear(r.screen, ref.screen), `${tag}: the screen is ${JSON.stringify(r.screen)}, the mock's ${JSON.stringify(ref.screen)}`);
  check('geometry.lane', rectNear(r.lane, ref.lane), `${tag}: the lane is ${JSON.stringify(r.lane)}, the mock's ${JSON.stringify(ref.lane)}`);
  check('geometry.rows', rectNear(r.row, ref.firstRow, 1) || (near(r.row?.[1], ref.firstRow[1]) && near(r.row?.[3], ref.firstRow[3]) && near(r.row?.[0], ref.firstRow[0] + REF.rules.inset)), `${tag}: the first row is ${JSON.stringify(r.row)}, the mock's ${JSON.stringify(ref.firstRow)} (its text starts ${String(REF.rules.inset)} px in)`);

  check('geometry.button', near(r.button2?.[1] - r.button?.[1], REF.rules.buttonPitch), `${tag}: the buttons are ${String(r.button2?.[1] - r.button?.[1])} px apart, the mock's ${String(REF.rules.buttonPitch)}`);
  check('geometry.lane', near(r.lane?.[3], REF.rules.laneHeight) && style.lane?.['border-top-color'] === REF.rules.laneBorderTop && style.lane?.['background-color'] === REF.rules.laneBackground, `${tag}: the lane is ${style.lane?.height} with a ${style.lane?.['border-top-color']} border on ${style.lane?.['background-color']}, the mock's ${REF.rules.laneHeight} px, ${REF.rules.laneBorderTop} on ${REF.rules.laneBackground}`);
  check('geometry.rows', near(r.row2?.[1] - r.row?.[1], REF.rules.rowPitch) && style.row?.['font-size'] === `${REF.rules.fontSize}px`, `${tag}: the rows are ${String(r.row2?.[1] - r.row?.[1])} px apart at ${style.row?.['font-size']}, the mock's ${REF.rules.rowPitch} px at ${REF.rules.fontSize}px (swatch ${JSON.stringify(style.font)})`);
  check('geometry.colors', style.screen?.['background-color'] === REF.rules.screenBackground && style.foreground?.color === REF.rules.rowText, `${tag}: the screen is ${style.screen?.['background-color']} with text ${style.foreground?.color}, the mock's ${REF.rules.screenBackground} and ${REF.rules.rowText}`);
  // The mock draws its 2 px ring on the output REGION when that region is the focused element; a terminal whose keyboard is in its input draws none around the screen (`paint.ring`).
  check('geometry.errors', page.errors.length === 0, `${tag}: the page raised ${JSON.stringify(page.errors)}`);
  report.numbers[`geometry ${tag}`] = { rects: r, style };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- words
async function words(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom' });
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  const empty = await page.evaluate(() => ({ text: document.querySelector('[data-shell-part="panelEmpty"]')?.innerText, buttons: [...document.querySelectorAll('[data-shell-part="panelEmpty"] button')].map((b) => b.textContent) }));
  check('words.empty', /No terminals/.test(empty.text ?? '') && /Start a shell in this window\. A session stays available when you switch tabs\./.test(empty.text ?? '') && empty.buttons.length === 1 && empty.buttons[0] === 'New terminal', `${engine}: the empty tool says ${JSON.stringify(empty)}`);
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine.writes > 0);
  await sleep(500);
  const toolbar = await page.evaluate(() => {
    const bar = document.querySelector('[role="toolbar"]');
    const copy = document.querySelector('[data-terminal-tool="copy"]');
    return {
      label: bar?.getAttribute('aria-label'),
      orientation: bar?.getAttribute('aria-orientation'),
      names: [...(bar?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label')),
      copyDisabled: copy?.getAttribute('aria-disabled'),
      copyReason: document.getElementById(copy?.getAttribute('aria-describedby') ?? '')?.textContent,
      input: document.querySelector('.xterm-helper-textarea')?.getAttribute('aria-label'),
      hint: document.getElementById(document.querySelector('.xterm-helper-textarea')?.getAttribute('aria-describedby') ?? '')?.textContent,
      lane: document.querySelector('[data-shell-part="terminalLane"]')?.textContent,
      laneRole: document.querySelector('[data-shell-part="terminalLane"]')?.getAttribute('role'),
    };
  });
  check('words.toolbar', toolbar.label === 'Terminal tools' && toolbar.orientation === 'vertical' && JSON.stringify(toolbar.names) === JSON.stringify(['Clear', 'Copy selection']) && toolbar.copyDisabled === 'true' && toolbar.copyReason === 'Select text in the terminal first', `${engine}: the toolbar is ${JSON.stringify(toolbar)}`);
  check('words.input', toolbar.input === 'Terminal input, Terminal' && /^Escape and Tab go to the shell\. Press F6 to move to the next part of the window/.test(toolbar.hint ?? ''), `${engine}: the input is ${JSON.stringify([toolbar.input, toolbar.hint])}`);
  check('words.running', toolbar.lane === '' && toolbar.laneRole === 'status', `${engine}: the lane of a running session says ${JSON.stringify(toolbar.lane)} (role ${toolbar.laneRole})`);
  // Ended: the process exits; the lane says so, input is off, the transcript keeps its lines and ends with the exit line.
  await typeLine(page, 'hello');
  await typeLine(page, 'exit');
  await page.waitForFunction(() => /Input is off/.test(document.querySelector('[data-shell-part="terminalLane"]')?.textContent ?? ''), null, { timeout: 10_000 });
  const ended = await page.evaluate(() => ({ lane: document.querySelector('[data-shell-part="terminalLane"]')?.textContent, text: document.querySelector('.xterm-rows')?.textContent, input: document.querySelector('.xterm-helper-textarea')?.hasAttribute('disabled') }));
  check('words.ended', /Ended/.test(ended.lane ?? '') && /Input is off\. Its output stays readable here\./.test(ended.lane ?? ''), `${engine}: the lane of an ended session says ${JSON.stringify(ended.lane)}`);
  check('words.transcript', /hello from the synthetic shell/.test(ended.text ?? '') && /\[Process ended\]/.test(ended.text ?? ''), `${engine}: the transcript of an ended session is ${JSON.stringify((ended.text ?? '').slice(-200))}`);
  const writes = await page.evaluate(() => window.__pty.log.writes.length);
  await page.keyboard.type('more');
  await sleep(200);
  check('words.input-off', (await page.evaluate(() => window.__pty.log.writes.length)) === writes, `${engine}: what is typed after the end reached the process`);
  // Failed: the producer's own words.
  await page.click('[data-shell-part="sessionClose"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea');
  await sleep(600);
  await typeLine(page, 'fail');
  await page.waitForFunction(() => /Failed/.test(document.querySelector('[data-shell-part="terminalLane"]')?.textContent ?? ''), null, { timeout: 10_000 });
  const failed = await page.evaluate(() => document.querySelector('[data-shell-part="terminalLane"]')?.textContent);
  check('words.failed', /Failed/.test(failed ?? '') && /The shell stopped answering/.test(failed ?? ''), `${engine}: the lane of a failed session says ${JSON.stringify(failed)}`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- keys
async function keys(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await start(page);
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  check('keys.focus', await activeIsTerminal(page), `${engine}: the new terminal has the keyboard`);
  const before = await page.evaluate(() => window.__pty.log.writes.join(''));
  await page.keyboard.press('Escape');
  check('keys.escape', (await activeIsTerminal(page)) && (await page.evaluate(() => window.__pty.log.writes.join(''))).endsWith('\u001b'), `${engine}: Escape stays in the shell and is sent to it (active: ${await page.evaluate(() => document.activeElement?.tagName)})`);
  // Whatever Escape did, the next key is pressed in the terminal: an assertion that fails says its own failure and no other.
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Tab');
  check('keys.tab', (await activeIsTerminal(page)) && (await page.evaluate(() => window.__pty.log.writes.join(''))).endsWith('\u001b\t'), `${engine}: Tab stays in the shell and is sent to it`);
  await page.keyboard.press('Control+c');
  check('keys.interrupt', (await page.evaluate(() => window.__pty.log.writes.join(''))).endsWith('\u0003') && (await activeIsTerminal(page)), `${engine}: Ctrl+C with no selection is the interrupt`);
  await page.keyboard.press('F6');
  check('keys.f6', !(await page.evaluate(() => document.activeElement?.closest('.xterm') !== null && document.activeElement?.closest('.xterm') !== undefined)), `${engine}: F6 moves the focus out of the terminal (active: ${await page.evaluate(() => document.activeElement?.tagName + '.' + String(document.activeElement?.className).slice(0, 40))})`);
  check('keys.f6-not-sent', !(await page.evaluate(() => window.__pty.log.writes.join(''))).includes('\u001b[17~'), `${engine}: F6 is not sent to the shell`);
  void before;
  // Copy and paste: the platform's chords.
  await page.evaluate(() => {
    window.__clip = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__clip.push(text); } } });
  });
  await page.click('.xterm-screen');
  await typeLine(page, 'hello');
  await page.evaluate(() => {
    const screen = document.querySelector('.xterm-screen').getBoundingClientRect();
    return screen.width;
  });
  // Select the word `hello` in the output by a double click on it (the output line is the second row from the bottom of what is printed).
  const spot = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.xterm-rows > div')];
    const index = rows.findIndex((row) => /^hello from the synthetic shell/.test(row.textContent ?? ''));
    const box = rows[index]?.getBoundingClientRect();
    return box === undefined ? null : { x: box.x + 7.2 * 3, y: box.y + box.height / 2 };
  });
  check('keys.copy', spot !== null, `${engine}: the output line of hello was not found`);
  if (spot !== null) {
    await page.mouse.dblclick(spot.x, spot.y);
    await sleep(150);
    await page.keyboard.press(mac ? 'Meta+c' : 'Control+Shift+c');
    await sleep(200);
    const clip = await page.evaluate(() => window.__clip);
    check('keys.copy', clip.length === 1 && clip[0] === 'hello', `${engine}: the copy chord put ${JSON.stringify(clip)} on the clipboard, expected ["hello"]`);
    check('keys.copy-no-interrupt', !(await page.evaluate(() => window.__pty.log.writes.join(''))).endsWith('hello\r\u0003'), `${engine}: the copy chord was sent to the shell`);
  }

  const written = await page.evaluate(() => window.__pty.log.writes.length);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'pasted text');
    document.querySelector('.xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await sleep(250);
  const pasted = await page.evaluate((from) => window.__pty.log.writes.slice(from).join(''), written);
  check('keys.paste', pasted.includes('pasted text'), `${engine}: a paste reached the shell as ${JSON.stringify(pasted)}`);
  if (mac) {
    // Command J hides the panel from inside the terminal, and the focus goes back to the page: never trapped.
    await page.click('.xterm-screen');
    await page.keyboard.press('Meta+j');
    await sleep(400);
    check('keys.toggle', await page.evaluate(() => (document.querySelector('[data-shell-part="panel"]')?.getBoundingClientRect().height ?? 0) === 0 && !document.activeElement?.closest('.xterm')), `${engine}: Command J hides the panel and the focus leaves the terminal`);
  }

  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- close
async function close(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await start(page);
  await page.click('[data-shell-part="sessionClose"]');
  const dialog = page.getByRole('alertdialog', { name: 'Terminate session?' });
  await dialog.waitFor({ timeout: 5000 });
  const shown = await page.evaluate(() => ({ modal: document.querySelector('dialog[role="alertdialog"]')?.matches(':modal') ?? false, active: document.activeElement?.textContent, body: document.querySelector('dialog[role="alertdialog"]')?.innerText }));
  check('close.modal', shown.modal === true, `${engine}: the question is a modal dialog (:modal ${String(shown.modal)})`);
  check('close.cancel', shown.active === 'Cancel', `${engine}: Cancel has the keyboard in the question (active: ${String(shown.active)})`);
  check('close.words', /Terminate session\?/.test(shown.body ?? '') && /This ends the terminal session\./.test(shown.body ?? '') && /Terminate session/.test(shown.body ?? ''), `${engine}: the question says ${JSON.stringify(shown.body)}`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 3000 }).catch(() => undefined);
  check('close.no', (await page.evaluate(() => window.__pty.ids().length)) === 1 && (await page.getByRole('alertdialog').count()) === 0, `${engine}: Escape says no: the shell is still there and the question is gone`);
  await page.click('[data-shell-part="sessionClose"]');
  await dialog.waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Terminate session', exact: true }).click();
  await sleep(500);
  const done = await page.evaluate(() => ({ closed: window.__pty.log.closed.length, empty: document.querySelector('[data-shell-part="panelEmpty"]') !== null, role: document.activeElement?.getAttribute('role'), text: document.activeElement?.textContent }));
  check('close.yes', done.closed === 1 && done.empty && done.role === 'tab' && /Terminal/.test(done.text ?? ''), `${engine}: Terminate session closed the process (${String(done.closed)}), the tool says it is empty (${String(done.empty)}) and the focus is on the tool's tab (${String(done.role)} ${String(done.text)})`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- resize
async function resize(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  const first = await page.evaluate(() => window.__pty.log.resizes.map((resizeEntry) => [resizeEntry.rows, resizeEntry.cols]));
  check('resize.first', first.length >= 1 && first[0][0] > 0 && first[0][1] > 0, `${engine}: the first size reached the process: ${JSON.stringify(first)}`);
  const base = first.length;
  // A drag of the splitter: ten changes of height, a frame apart (the handle's own keys: Home is the least, End the most), inside 200 ms. One message once the size stood still, not one for each.
  await page.locator('[data-shell-part="panelHandle"]').focus();
  await page.evaluate(async () => {
    const handle = document.querySelector('[data-shell-part="panelHandle"]');
    for (let step = 0; step < 10; step += 1) {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: step % 2 === 0 ? 'Home' : 'End', bubbles: true, cancelable: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
  await sleep(900);
  const sent = await page.evaluate(() => window.__pty.log.resizes.map((resizeEntry) => [resizeEntry.rows, resizeEntry.cols]));
  const after = sent.length - base;
  check('resize.messages', after >= 1 && after <= 2, `${engine}: ${String(after)} resize messages for a drag that ended at one size (expected 1 or 2): ${JSON.stringify(sent.slice(base))}`);
  const screen = await page.evaluate(() => {
    const box = document.querySelector('.xterm-screen')?.getBoundingClientRect();
    return box === undefined ? null : { rows: Math.round(box.height / 18), width: box.width };
  });
  const grid = await page.evaluate(() => window.__engine.grid());
  const last = sent.at(-1);
  check('resize.last', screen !== null && last[0] === screen.rows && last[0] === grid.rows && last[1] === grid.cols, `${engine}: the last size sent is ${JSON.stringify(last)} (rows, columns), the screen has ${String(screen?.rows)} rows and the emulator's grid is ${String(grid.rows)} rows by ${String(grid.cols)} columns`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- bundle
async function bundle(ctx) {
  const { browser, origin, viewport, engine, dist } = ctx;
  if (ctx.vp !== '1440x900') return;
  const assets = path.join(dist, 'assets');
  const files = readdirSync(assets);
  const entry = files.find((name) => /^terminal-fixture-.*\.js$/.test(name));
  const lazy = files.find((name) => /^xtermEngine-.*\.js$/.test(name));
  const css = files.filter((name) => name.endsWith('.css'));
  const entrySource = readFileSync(path.join(assets, entry), 'utf8');
  const lazySource = readFileSync(path.join(assets, lazy), 'utf8');
  const MARK = 'xterm-helper-textarea';
  // The host's own rules for the screen name `.xterm` and `.xterm-viewport` (its overrides); the emulator's own rules (the helper textarea, the measure element) arrive with its chunk.
  const styled = css.some((name) => /\.xterm-(?:helper-textarea|char-measure-element|decoration|accessibility)/.test(readFileSync(path.join(assets, name), 'utf8')));
  check('bundle.entry', !entrySource.includes(MARK) && lazySource.includes(MARK) && !styled, `${engine}: the emulator is in the entry chunk or the entry stylesheet (entry ${String(entrySource.includes(MARK))}, lazy ${String(lazySource.includes(MARK))}, stylesheet ${String(styled)})`);
  if (engine === engineNames[0]) note(`bundle: entry ${String(entrySource.length)} B, xtermEngine ${String(lazySource.length)} B, addon-webgl ${String(files.filter((name) => /^addon-webgl/.test(name)).map((name) => readFileSync(path.join(assets, name)).length).join(','))} B`);
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await ctx.control?.after?.(page, `${origin}/assets/${lazy}`);
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await sleep(500);
  const early = page.requests.filter((request) => /xtermEngine|addon-webgl/.test(request.url));
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => /xtermEngine|addon-webgl/.test(entry.name)).length);
  check('bundle.lazy', early.length === 0 && resources === 0, `${engine}: the emulator was requested before the first terminal (${String(early.length)} requests, ${String(resources)} resource entries)`);
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await sleep(500);
  check('bundle.fetched', page.requests.some((request) => /xtermEngine/.test(request.url)), `${engine}: the emulator was not requested when the first terminal opened`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- hidden
/**
 * The panel is hidden and the shell writes 2 MB while it is, in 2,000 events in one task: what a flood costs the page when nothing draws. Answers what the page did meanwhile (frames, timers, the emulator's writes, the
 * document's mutations) and the page's task for the events, and after the panel is shown again, what the emulator drew of what was held (waited for, bounded). `perturb` runs once the panel is hidden, before anything is counted.
 */
async function holdHidden(page, perturb) {
  await page.click('[data-shell-part="panelToggle"]');
  await sleep(400);
  await perturb?.();
  const before = await page.evaluate(() => ({ writes: window.__engine.writes, accepted: window.__engine.accepted, mutations: 0 }));
  await page.evaluate(() => {
    window.__mutations = 0;
    window.__observer = new MutationObserver((list) => { window.__mutations += list.length; });
    window.__observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__count.timeout = 0;
    window.__count.interval = 0;
    window.__count.raf = 0;
    window.__count.on = true;
  });
  const cost = await page.evaluate(() => {
    const id = window.__pty.ids()[0];
    const line = `${'x'.repeat(78)}\r\n`.repeat(12);
    const start = performance.now();
    for (let n = 0; n < 2000; n += 1) window.__pty.out(id, line);
    return performance.now() - start;
  });
  await sleep(1200);
  const during = await page.evaluate(() => {
    window.__count.on = false;
    window.__observer.disconnect();
    return { ...window.__count, mutations: window.__mutations, writes: window.__engine.writes, accepted: window.__engine.accepted };
  });
  await page.click('[data-shell-part="panelToggle"]');
  // The held bytes are drawn a frame's share at a time: the drain is waited for, bounded, and not slept for, so a slow machine (or a frame loop that was added) does not read as bytes that were never drawn. The check is still exact, and a drain that lost bytes fails it with its numbers.
  await page.waitForFunction((at) => window.__engine.accepted - at >= 1_900_000 && window.__engine.parsed === window.__engine.accepted, before.accepted, { timeout: 20_000, polling: 100 }).catch(() => undefined);
  const drained = await page.evaluate(() => ({ accepted: window.__engine.accepted, parsed: window.__engine.parsed }));
  return { before, during, cost, drained };
}

async function hidden(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  await typeLine(page, 'hello');
  const { before, during, cost, drained } = await holdHidden(page, () => ctx.control?.after?.(page));
  check('hidden.frames', during.raf === 0, `${engine}: the page asked for ${String(during.raf)} frames while the panel was hidden and the shell wrote 2 MB`);
  check('hidden.timers', during.timeout === 0 && during.interval === 0, `${engine}: the page started ${String(during.timeout)} timeouts and ${String(during.interval)} intervals while hidden`);
  check('hidden.writes', during.writes === before.writes && during.mutations === 0, `${engine}: the emulator was written ${String(during.writes - before.writes)} times and the document mutated ${String(during.mutations)} times while hidden`);
  note(`hidden ${engine}${MODE}: 2,000 events (2 MB) held in ${String(round(cost))} ms of the page's task, ${String(during.raf)} frames, ${String(during.writes - before.writes)} writes, ${String(during.mutations)} mutations`);
  report.numbers[`hidden ${engine}`] = { eventsMs: round(cost), ...during };
  check('hidden.drain', drained.accepted - before.accepted >= 1_900_000 && drained.parsed === drained.accepted, `${engine}: what was held is drawn when the panel is shown: accepted ${String(drained.accepted - before.accepted)} of 2,000,000 B, parsed ${String(drained.parsed)} of ${String(drained.accepted)}`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- idle
/**
 * An idle terminal on screen: a second of rest, then three seconds in which the page's timers, frames and callbacks are counted (and the commits of React's Profiler, which only a development build has). `perturb` runs after
 * the second of rest, before the count starts.
 */
async function sitIdle(page, perturb) {
  await sleep(1200);
  await perturb?.();
  await page.evaluate(() => {
    window.__count.timeout = 0;
    window.__count.interval = 0;
    window.__count.raf = 0;
    window.__count.fired = 0;
    window.__count.on = true;
  });
  await sleep(3000);
  return page.evaluate(() => {
    window.__count.on = false;
    return { ...window.__count, commits: window.__commits.length };
  });
}

async function idle(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  // The intervals the page runs with the panel open and no terminal: the shell's own. A terminal adds none.
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await sleep(500);
  const baseline = await page.evaluate(() => window.__count.active);
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine.writes > 0);
  if (READER === 'on') await switchReader(page);
  await typeLine(page, 'hello');
  const counts = await sitIdle(page, () => ctx.control?.after?.(page));
  const nodes = await page.evaluate(() => document.querySelector('[data-shell-part="terminalScreen"]').querySelectorAll('*').length);
  check('idle.timers', counts.timeout === 0 && counts.interval === 0 && counts.raf === 0 && counts.fired === 0 && counts.active === baseline, `${engine}: an idle terminal started ${String(counts.timeout)} timeouts, ${String(counts.interval)} intervals and asked for ${String(counts.raf)} frames in 3 s, ${String(counts.fired)} callbacks fired, and ${String(counts.active - baseline)} intervals are alive that the panel without a terminal does not have`);
  note(`idle ${engine}${MODE}: 3 s on screen: ${String(counts.timeout)} timeouts, ${String(counts.interval)} intervals, ${String(counts.raf)} frames, ${String(counts.fired)} callbacks fired; ${String(counts.active - baseline)} intervals more than the panel without a terminal; the screen holds ${String(nodes)} nodes`);
  report.numbers[`idle ${engine}`] = { ...counts, baseline, nodes };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- commits (development build)
async function commits(ctx) {
  const { browser, devOrigin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, devOrigin, viewport, { control: ctx.control });
  await start(page);
  await typeLine(page, 'hello');
  await sleep(1200);
  const idleBefore = await page.evaluate(() => window.__commits.length);
  await sleep(3000);
  const idleAfter = await page.evaluate(() => window.__commits.length);
  check('idle.commits', idleAfter === idleBefore, `${engine}: an idle terminal rendered ${String(idleAfter - idleBefore)} commits in 3 s`);
  const before = await page.evaluate(() => window.__commits.length);
  // 500 chunks of the shell's output, a chunk every 4 ms, to a terminal that is on screen.
  await page.evaluate(async () => {
    const id = window.__pty.ids()[0];
    for (let n = 0; n < 500; n += 1) {
      window.__pty.out(id, `line ${n} ${'x'.repeat(70)}\r\n`);
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
  });
  await sleep(600);
  const after = await page.evaluate(() => window.__commits.length);
  check('commits.chunk', after - before <= 0, `${engine}: 500 chunks of output rendered ${String(after - before)} React commits`);
  note(`commits ${engine}${MODE}: 500 chunks on screen: ${String(after - before)} commits; idle 3 s: ${String(idleAfter - idleBefore)} commits`);
  report.numbers[`commits ${engine}`] = { chunk: after - before, idle: idleAfter - idleBefore };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- flood
async function flood(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  await page.evaluate(() => {
    window.__frames = [];
    window.__framesOn = true;
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__framesOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__longtasks = window.__longtasks === null ? null : [];
  });
  const base = await page.evaluate(() => ({ accepted: window.__engine.accepted, parsed: window.__engine.parsed }));
  const t0 = Date.now();
  await typeLine(page, 'flood 200000 80');
  await page.waitForFunction(() => window.__pty.log.floods.length === 1 && window.__engine.parsed === window.__engine.accepted, null, { timeout: 120_000, polling: 250 });
  // The process has sent it all and the emulator has parsed what it was given so far; what the screen has not yet taken from the feed (a frame takes 512 KiB at most, a slow one less) is waited for, bounded: a slow drain is not read as lost bytes. The check below is exact, and a flood that lost bytes fails it with its numbers.
  await page.waitForFunction((at) => window.__engine.accepted - at >= window.__pty.log.floods[0].bytes && window.__engine.parsed === window.__engine.accepted, base.accepted, { timeout: 60_000, polling: 250 }).catch(() => undefined);
  const seconds = (Date.now() - t0) / 1000;
  const result = await page.evaluate(() => {
    window.__framesOn = false;
    return { frames: window.__frames.slice(3), accepted: window.__engine.accepted, parsed: window.__engine.parsed, writes: window.__engine.writes, flood: window.__pty.log.floods[0], longtasks: window.__longtasks };
  });
  const p50 = percentile(result.frames, 50);
  const p95 = percentile(result.frames, 95);
  const max = Math.max(...result.frames);
  // A COUNT, not a percentile of milliseconds, so that a slower machine does not move the line: a frame that took more than two frames at 60 Hz (34 ms) is a late one, and a tenth of them at most may be (the laptop has none to one in 300).
  const late = result.frames.filter((frame) => frame > 34).length;
  // The emulator's counters are lifetime totals (the banner, the echo of the command, the prompts): the flood's own are what they gained from the command on, and they are the flood's bytes and at most 256 B of echo and prompt.
  const gained = result.accepted - base.accepted;
  const parsedGained = result.parsed - base.parsed;
  check('flood.complete', result.flood.bytes >= 16_000_000 && gained >= result.flood.bytes && gained - result.flood.bytes <= 256 && parsedGained === gained, `${engine}: the flood was ${String(result.flood.bytes)} B; from the command on the emulator accepted ${String(gained)} B (the flood and at most 256 B of echo and prompt) and parsed ${String(parsedGained)}`);
  check('flood.frames', late <= Math.floor(result.frames.length / 10), `${engine}: ${String(late)} of ${String(result.frames.length)} frames took longer than 34 ms (two frames at 60 Hz) during a 16 MB flood (a tenth at most); p50 ${String(round(p50))} ms, p95 ${String(round(p95))} ms, max ${String(round(max))} ms`);
  if (result.longtasks !== null) check('flood.longtask', Math.max(0, ...result.longtasks) <= 120, `${engine}: the longest task was ${String(round(Math.max(0, ...result.longtasks)))} ms (120 ms at most): ${JSON.stringify(result.longtasks.slice(0, 8))}`);
  note(`flood ${engine}${MODE}: ${String(result.flood.bytes)} B in ${String(round(seconds))} s, ${String(result.frames.length)} frames, ${String(late)} later than 34 ms: p50 ${String(round(p50))} ms, p95 ${String(round(p95))} ms, max ${String(round(max))} ms; ${String(result.writes)} writes${result.longtasks === null ? '' : `, ${String(result.longtasks.length)} long tasks, longest ${String(round(Math.max(0, ...result.longtasks)))} ms`}`);
  report.numbers[`flood ${engine}`] = { seconds, p50, p95, max, late, frames: result.frames.length, writes: result.writes, longtasks: result.longtasks };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- latency
async function latency(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  /** Types `count` keys 80 ms apart and answers the delay of each, from the instant the browser made the key event to the instant the shell was given what it meant. */
  const typeAndMeasure = async (count) => {
    await page.evaluate(() => {
      window.__keydowns.length = 0;
      window.__pty.log.writeAt.length = 0;
    });
    for (let n = 0; n < count; n += 1) {
      await page.keyboard.press(String.fromCharCode(97 + (n % 26)));
      await sleep(80);
    }

    await sleep(300);
    return page.evaluate(() => window.__keydowns.map((down, index) => (window.__pty.log.writeAt[index] ?? NaN) - down));
  };
  const idleDelays = await typeAndMeasure(30);
  const p95 = percentile(idleDelays, 95);
  check('latency.idle', idleDelays.length === 30 && idleDelays.every(Number.isFinite) && p95 <= 50, `${engine}: idle, a key took p50 ${String(round(percentile(idleDelays, 50)))} ms and p95 ${String(round(p95))} ms to reach the process (p95 must be 50 ms or less)`);
  // Under a flood: the shell is writing 82 MB (1,000,000 lines) while the person types, so it is still writing when the last key is pressed (asserted). The idle sample left its letters in the shell's line, so Control C clears it,
  // or the command would be "abcd...flood" and no flood would start. The flood's start is recorded by the shell, and so is its end: both are asserted.
  await page.keyboard.press('Control+c');
  await sleep(200);
  await page.keyboard.type('flood 1000000 80');
  await page.keyboard.press('Enter');
  await sleep(1500);
  const startedBefore = await page.evaluate(() => window.__pty.log.floodStarts.length);
  const floodDelays = await typeAndMeasure(20);
  const stillFlooding = await page.evaluate(() => window.__pty.log.floodStarts.length === 1 && window.__pty.log.floods.length === 0);
  check('latency.premise', startedBefore === 1 && stillFlooding, `${engine}: ${String(startedBefore)} flood(s) had started before the keys were pressed and the flood was ${stillFlooding ? '' : 'not '}still running after the last one: otherwise the numbers say nothing about a flood`);
  const floodP95 = percentile(floodDelays, 95);
  check('latency.flood', floodDelays.length === 20 && floodDelays.every(Number.isFinite) && floodP95 <= 100, `${engine}: under a flood, a key took p50 ${String(round(percentile(floodDelays, 50)))} ms and p95 ${String(round(floodP95))} ms to reach the process (p95 must be 100 ms or less)`);
  note(`latency ${engine}: idle p50 ${String(round(percentile(idleDelays, 50)))} ms p95 ${String(round(p95))} ms; under flood p50 ${String(round(percentile(floodDelays, 50)))} ms p95 ${String(round(floodP95))} ms`);
  report.numbers[`latency ${engine}`] = { idle: idleDelays, flood: floodDelays };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- axe
async function axe(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom' });
  await page.addScriptTag({ path: AXE });
  // axe is run on the tool's part of the DOM, as the palette probe runs it on its dialog.
  const run = (selector) => runAxe(page, selector);
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  const empty = await run('[data-shell-part="panelEmpty"]');
  check('axe.empty', empty.length === 0, `${engine}: the empty tool: ${JSON.stringify(empty)}`);
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea');
  await sleep(700);
  await typeLine(page, 'hello');
  await sleep(300);
  const running = await run('[data-shell-part="terminalBody"]');
  check('axe.running', running.length === 0, `${engine}: the running terminal, with its input and its output: ${JSON.stringify(running)}`);
  await typeLine(page, 'exit');
  await sleep(500);
  const ended = await run('[data-shell-part="terminalBody"]');
  check('axe.ended', ended.length === 0, `${engine}: the terminal, with its ended lane and the exit line in the transcript: ${JSON.stringify(ended)}`);
  // A second terminal, from the strip's plus, is running: closing it asks.
  await page.locator('[data-shell-part="sessionAdd"]').click();
  await page.waitForFunction(() => window.__pty.log.created.length === 2);
  await sleep(700);
  await page.locator('[data-shell-part="sessionClose"]').last().click();
  await page.getByRole('alertdialog').waitFor();
  const question = await run('dialog[role="alertdialog"]');
  check('axe.question', question.length === 0, `${engine}: the question: ${JSON.stringify(question)}`);
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- memory
/** The lines kept above the screen (`SCROLLBACK` of screen.ts): the cap the memory section proves. The mock keeps 2,000 rows of transcript (`TERM_CAP`, shell-panel.js 1071). */
const SCROLLBACK = 5000;

/**
 * A million lines of 80 columns (82 MB) through the shell, in the DOM renderer so the lines are text: every byte is parsed, and then the screen is scrolled to the top of what the emulator kept. The first line it still has is
 * the line the cap leaves (`memory.cap`: the last SCROLLBACK lines and the screen, no more and no fewer), which is what holds the memory of a terminal to a number (the Chromium heap is read where the engine says it, `memory.heap`).
 */
async function memory(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await start(page);
  // The JS heap, after a collection, from the devtools protocol (Chromium only: `performance.memory` is rounded and WebKit has no such number).
  const cdp = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
  const heap = async () => {
    if (cdp === null) return null;
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  const heapBefore = await heap();
  const t0 = Date.now();
  await typeLine(page, 'flood 1000000 80');
  await page.waitForFunction(() => window.__pty.log.floods.length === 1 && window.__engine.parsed === window.__engine.accepted, null, { timeout: 240_000, polling: 500 });
  const seconds = (Date.now() - t0) / 1000;
  await sleep(500);
  const rows = await page.evaluate(() => document.querySelectorAll('.xterm-rows > div').length);
  const heapAfter = await heap();
  const firstLine = () => page.evaluate(() => /^(\d{7})/.exec(document.querySelector('.xterm-rows > div')?.textContent ?? '')?.[1] ?? null);
  // Shift+PageUp is the emulator's own key for a page up in its scrollback: a page a press until the top, which stops moving (a wheel moves three lines a notch in Chromium and all of it in WebKit).
  let oldest = await firstLine();
  for (let step = 0; step < 1400; step += 1) {
    await page.keyboard.press('Shift+PageUp');
    if (step % 50 === 49) {
      const now = await firstLine();
      if (now === oldest) break;
      oldest = now;
    }
  }

  oldest = await firstLine();
  // The buffer holds the banner, the command line, the million lines and the last prompt: it keeps the last SCROLLBACK + rows of them, so the oldest line of the flood it has is 1,000,000 + 1 - SCROLLBACK - rows.
  const expected = 1_000_000 + 1 - SCROLLBACK - rows;
  check('memory.cap', oldest !== null && Math.abs(Number(oldest) - expected) <= 3, `${engine}: after 1,000,000 lines the oldest line the emulator kept is ${String(oldest)}, the cap of ${String(SCROLLBACK)} lines and ${String(rows)} rows leaves ${String(expected)}`);
  if (heapBefore !== null && heapAfter !== null) check('memory.heap', heapAfter - heapBefore <= 60 * 1024 * 1024, `${engine}: the JS heap grew ${String(Math.round((heapAfter - heapBefore) / 1048576))} MB over a 1,000,000 line flood (60 MB at most)`);
  note(`memory ${engine}: 1,000,000 lines (82 MB) in ${String(round(seconds))} s; oldest line kept ${String(oldest)} (expected ${String(expected)}, cap ${String(SCROLLBACK)} lines + ${String(rows)} rows); JS heap ${heapBefore === null ? 'not readable in this engine' : `${String(Math.round(heapBefore / 1048576))} -> ${String(Math.round(heapAfter / 1048576))} MB`}`);
  report.numbers[`memory ${engine}`] = { seconds, oldest, expected, heapBefore, heapAfter };
  await page.context().close();
}
// ---------------------------------------------------------------------------------------------------- paint
/** How many pixels of each band of `rect` are not the plane's colour in a screenshot of it, and the first that is (the page decodes the PNG on a canvas: the probe has no image library). */
async function painted(page, rect, bands, plane) {
  const png = await page.screenshot({ clip: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] } });
  return page.evaluate(
    async ({ base64, wanted, colour }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const [red, green, blue] = colour.match(/\d+/g).map(Number);
      const result = {};
      for (const [name, [x, y, width, height]] of Object.entries(wanted)) {
        let count = 0;
        let first = null;
        for (let row = y; row < y + height; row += 1) {
          for (let col = x; col < x + width; col += 1) {
            const at = (row * image.width + col) * 4;
            if (data[at] !== red || data[at + 1] !== green || data[at + 2] !== blue) {
              count += 1;
              first ??= [col, row, data[at], data[at + 1], data[at + 2]];
            }
          }
        }

        result[name] = { count, first };
      }

      return result;
    },
    { base64: png.toString('base64'), wanted: bands, colour: plane },
  );
}

/**
 * The terminal's focus is its caret and nothing is drawn around its screen (the screen is a text-entry surface the size of the panel; the mock draws the 2 px ring on its output REGION when that region is the focused
 * element, and where its keyboard is, in the input row, the focus paint is the row's highlight and the caret); the shell's scrollbar is the platform's overlay one: nothing at rest, none over a screen that does not scroll,
 * thin while it is shown (written rule: scrollbar mode, appearance and size are the platform's, ch03; no lane is reserved, `scrollbar-gutter: auto`).
 */
async function paint(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const plane = REF.rules.screenBackground;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await start(page);
  await typeLine(page, 'hello');
  await ctx.control?.after?.(page);
  const [x, y, width, height] = await page.evaluate(() => {
    const box = document.querySelector('[data-shell-part="terminalScreen"]').getBoundingClientRect();
    return [box.x, box.y, box.width, box.height].map(Math.round);
  });
  const rect = [x, y, width, height];
  check('paint.focus', await activeIsTerminal(page), `${engine}: the emulator has the keyboard`);
  // The outermost 2 px on every side: where the 2 px ring (offset -2) of a framed screen is painted. The scrollbar's thumb ends 2 px short of the right edge.
  const ring = await painted(page, rect, { top: [0, 0, width, 2], bottom: [0, height - 2, width, 2], left: [0, 0, 2, height], right: [width - 2, 0, 2, height] }, plane);
  const framed = Object.entries(ring).filter(([, band]) => band.count > 0);
  check('paint.ring', framed.length === 0, `${engine}: the screen has a frame while the emulator has the keyboard: ${JSON.stringify(Object.fromEntries(framed))}`);
  // No scrollbar after output (nothing to scroll to yet), and none after a quiet second. The emulator's scrollbar is 14 px wide at the inner edge of the screen's 12 px inset: [width - 26, width - 12). The bands leave out the
  // outermost 2 px above and below, the ring's rows, so that a frame is the ring assertion's to see and a scrollbar the scrollbar's.
  const edge = { edge: [width - 26, 2, 14, height - 4] };
  const justNow = await painted(page, rect, edge, plane);
  await sleep(1500);
  const atRest = await painted(page, rect, edge, plane);
  check('scrollbar.rest', justNow.edge.count === 0 && atRest.edge.count === 0, `${engine}: the right edge of a screen that does not scroll has ${String(justNow.edge.count)} painted pixels after output and ${String(atRest.edge.count)} at rest (first ${JSON.stringify(atRest.edge.first ?? justNow.edge.first)})`);
  // With scrollback, scrolled: the thumb is shown, thin, in the 10 px of the track (width - 22 to width - 12), and nothing is painted in the 4 px to the left of it.
  await page.keyboard.type('flood 300 80');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__pty.log.floods.length >= 1 && window.__engine.parsed === window.__engine.accepted, null, { timeout: 20_000 });
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.wheel(0, -400);
  await sleep(250);
  const thumb = await page.evaluate(() => {
    const slider = document.querySelector('[data-shell-part="terminalScreen"] .xterm-scrollable-element > .scrollbar.vertical > .slider');
    const track = slider?.parentElement;
    return slider === null || slider === undefined ? null : { width: slider.getBoundingClientRect().width, opacity: getComputedStyle(track).opacity, scrollable: document.querySelector('[data-shell-part="terminalScreen"]').hasAttribute('data-scrollable') };
  });
  const bands = await painted(page, rect, { track: [width - 22, 2, 10, height - 4], gap: [width - 26, 2, 4, height - 4] }, plane);
  check('scrollbar.thin', thumb !== null && thumb.scrollable && thumb.width <= 8 && Number(thumb.opacity) > 0 && bands.track.count > 0 && bands.gap.count === 0, `${engine}: while scrolling the thumb is ${JSON.stringify(thumb)} and paints ${String(bands.track.count)} pixels in the rightmost 10 px and ${String(bands.gap.count)} to the left of them`);
  // And it goes away again: the pointer leaves the screen, the wheel has stopped, and after a quiet moment nothing of the thumb is painted (a thumb that stays whenever there is scrollback would pass every check above).
  await page.mouse.move(x + width / 2, 8);
  await sleep(3000);
  const gone = await painted(page, rect, { track: [width - 22, 2, 10, height - 4] }, plane);
  check('scrollbar.hides', gone.track.count === 0, `${engine}: after the wheel stopped and the pointer left, the thumb still paints ${String(gone.track.count)} pixels in the rightmost 10 px (first ${JSON.stringify(gone.track.first)})`);
  await page.context().close();
  // The caret, as a node (the DOM renderer): the theme's text colour as a solid block while the emulator has the keyboard, a hollow one while it has not.
  const dom = await open(browser, origin, viewport, { query: 'renderer=dom' });
  await start(dom);
  const caret = () => dom.evaluate(() => {
    const node = document.querySelector('.xterm-rows .xterm-cursor');
    return node === null ? null : { shape: [...node.classList].find((name) => /^xterm-cursor-(block|outline|bar|underline)$/.test(name)), colour: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).outlineColor };
  });
  const focused = await caret();
  await dom.evaluate(() => document.activeElement?.blur());
  await sleep(200);
  const blurred = await caret();
  check('paint.caret', focused?.shape === 'xterm-cursor-block' && focused.colour === REF.rules.caret && blurred?.shape === 'xterm-cursor-outline', `${engine}: the caret is ${JSON.stringify(focused)} while focused (a solid block in ${REF.rules.caret}) and ${JSON.stringify(blurred)} when not (a hollow one)`);
  await dom.context().close();
}

// ---------------------------------------------------------------------------------------------------- screenreader
/**
 * The Terminal's screen reader mode (docs/ui-next/status/T1.md, section 16). The emulator's rows are hidden from the accessibility tree (the DOM renderer marks them `aria-hidden`; the GPU's canvas is not text), and only its
 * screen reader mode puts the printed lines in it. The DOM renderer is used here so that the line IS in the page while the mode is off: what is read is the accessibility snapshot of the screen's region (Playwright's own
 * computation of roles and names, which leaves out what is `aria-hidden`), so a line that is in the page and not in the snapshot is one a screen reader cannot read. The mode is turned on and off through the palette command, by
 * the keyboard alone, as a person does it: nothing else sets it.
 */
async function screenreader(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { query: 'renderer=dom', control: ctx.control });
  await page.addScriptTag({ path: AXE });
  await start(page, { plain: true });
  await watchLive(page);
  await perturb(ctx, page, 'start');
  await typeLine(page, 'hello');
  const region = page.locator('[data-shell-part="terminalScreen"]');
  const shown = (text) => JSON.stringify(text.slice(0, 500));
  const OFF_WORDS = 'The output is not read aloud until screen reader mode is on.';
  // Off, as a window that never chose has it: the line is in the page, and not in the tree.
  const off = await reading(page);
  check('screenreader.tree-off', off.inDom && off.lines === 0 && !off.snapshot.includes(LINE), `${engine}: with the mode off the line is ${off.inDom ? '' : 'not '}in the page and the screen's accessibility tree holds it ${String(off.lines)} times: ${shown(off.snapshot)}`);
  check('screenreader.words', off.named === 1 && off.label.startsWith('Terminal') && off.description.includes(OFF_WORDS) && off.description.includes(COMMAND), `${engine}: with the mode off the input is ${JSON.stringify(off.label)} (${String(off.named)} named Terminal) and described by ${shown(off.description)}`);
  // On, through the palette by the keyboard.
  const turnedOn = await switchReader(page);
  const on = await reading(page);
  check('screenreader.tree', on.lines === 1 && on.snapshot.includes(LINE), `${engine}: with the mode on the screen's accessibility tree holds the line ${String(on.lines)} times (once is right): ${shown(on.snapshot)}`);
  check('screenreader.words', on.named === 1 && on.label.startsWith('Terminal') && on.description.includes('Screen reader mode is on: the output is read aloud.') && on.description.includes('To turn it off') && on.description.includes(COMMAND) && !on.description.includes('not read aloud'), `${engine}: with the mode on the input is ${JSON.stringify(on.label)} and described by ${shown(on.description)}`);
  check('screenreader.announce', turnedOn.length === 1 && turnedOn[0].text === 'Terminal screen reader mode on.' && turnedOn[0].modal === false, `${engine}: turning the mode on was announced ${JSON.stringify(turnedOn)}: once, through the window's polite live region, with no modal dialog open`);
  // A line printed while the mode is on is read too: the emulator brings its tree up to date at most once a second.
  await typeLine(page, 'hello');
  let later = 0;
  for (let wait = 0; wait < 40 && later < 2; wait += 1) {
    later = await region.getByRole('listitem').filter({ hasText: LINE }).count();
    if (later < 2) await sleep(100);
  }

  check('screenreader.tree', later === 2, `${engine}: a line printed after the mode was turned on is ${later === 2 ? '' : 'not '}in the tree (${String(later)} of 2 lines)`);
  const axeOn = await runAxe(page, '[data-shell-part="terminalBody"]');
  // Off again.
  const turnedOff = await switchReader(page);
  const back = await reading(page);
  check('screenreader.tree-off', back.inDom && back.lines === 0 && !back.snapshot.includes(LINE), `${engine}: after the mode was turned off the line is ${back.inDom ? '' : 'not '}in the page and the screen's accessibility tree holds it ${String(back.lines)} times: ${shown(back.snapshot)}`);
  check('screenreader.words', back.named === 1 && back.description.includes(OFF_WORDS) && back.description.includes(COMMAND) && !back.description.includes('Screen reader mode is on'), `${engine}: after the mode was turned off the input is described by ${shown(back.description)}`);
  check('screenreader.announce', turnedOff.length === 1 && turnedOff[0].text === 'Terminal screen reader mode off.' && turnedOff[0].modal === false, `${engine}: turning the mode off was announced ${JSON.stringify(turnedOff)}: once, through the window's polite live region, with no modal dialog open`);
  const axeOff = await runAxe(page, '[data-shell-part="terminalBody"]');
  check('screenreader.axe', axeOn.length === 0 && axeOff.length === 0, `${engine}: axe finds ${JSON.stringify(axeOn)} in the running terminal with the mode on and ${JSON.stringify(axeOff)} with it off`);
  // Two changes, two announcements, and nothing said after them.
  await sleep(300);
  const told = await page.evaluate(() => window.__told.length);
  check('screenreader.announce', told === 2, `${engine}: the window's live region was told ${String(told)} times for two changes`);
  note(`screenreader ${engine}: on and off through the palette by the keyboard; the screen's accessibility tree held the line ${String(off.lines)} times off and ${String(on.lines)} on; ${String(off.nodes)} nodes in the screen off, ${String(on.nodes)} on (DOM renderer); said ${JSON.stringify([turnedOn[0]?.text, turnedOff[0]?.text])}`);
  report.numbers[`screenreader ${engine}`] = { nodesOff: off.nodes, nodesOn: on.nodes, snapshotOn: on.snapshot, announced: [...turnedOn, ...turnedOff] };
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------------- screenreader-cost
/**
 * The mode on costs nothing at rest. The terminal is made as the product makes it (the GPU's renderer while it is on screen), the mode is turned on through the palette by the keyboard, and the two measures of work that the mode
 * off passes, an idle terminal (`idle`) and a hidden panel (`hidden`), are taken again with it on: the same zero counts. The accessibility layer must be there, or the measure says nothing about the mode.
 */
async function screenreaderCost(ctx) {
  const { browser, origin, viewport, engine } = ctx;
  if (ctx.vp !== '1440x900') return;
  const page = await open(browser, origin, viewport, { control: ctx.control });
  await page.click('[data-shell-part="panelToggle"]');
  await page.waitForSelector('[data-shell-part="panelEmpty"]');
  await sleep(500);
  const baseline = await page.evaluate(() => window.__count.active);
  await page.click('[data-shell-part="panelEmpty"] button');
  await page.waitForSelector('.xterm-helper-textarea', { timeout: 20_000 });
  await page.waitForFunction(() => window.__engine.writes > 0 && window.__pty.log.resizes.length >= 1, null, { timeout: 15_000 });
  await sleep(500);
  await switchReader(page);
  await typeLine(page, 'hello');
  const counts = await sitIdle(page, () => perturb(ctx, page, 'idle'));
  const layer = () => page.evaluate(() => document.querySelector('[data-shell-part="terminalScreen"] .xterm-accessibility-tree') !== null);
  const idleLayer = await layer();
  check('screenreader.idle', idleLayer && counts.timeout === 0 && counts.interval === 0 && counts.raf === 0 && counts.fired === 0 && counts.active === baseline, `${engine}: with the mode on (accessibility layer ${idleLayer ? 'there' : 'MISSING'}) an idle terminal started ${String(counts.timeout)} timeouts, ${String(counts.interval)} intervals and asked for ${String(counts.raf)} frames in 3 s, ${String(counts.fired)} callbacks fired, and ${String(counts.active - baseline)} intervals are alive that the panel without a terminal does not have`);
  const { before, during, cost, drained } = await holdHidden(page, () => perturb(ctx, page, 'hidden'));
  const hiddenLayer = await layer();
  check('screenreader.hidden', hiddenLayer && during.raf === 0 && during.timeout === 0 && during.interval === 0 && during.writes === before.writes && during.mutations === 0 && drained.accepted - before.accepted >= 1_900_000 && drained.parsed === drained.accepted, `${engine}: with the mode on (accessibility layer ${hiddenLayer ? 'there' : 'MISSING'}) a hidden panel and 2 MB held: ${String(during.raf)} frames, ${String(during.timeout)} timeouts, ${String(during.interval)} intervals, ${String(during.writes - before.writes)} writes, ${String(during.mutations)} mutations, and ${String(drained.accepted - before.accepted)} of 2,000,000 B drawn when it was shown again (parsed ${String(drained.parsed)} of ${String(drained.accepted)})`);
  note(`screenreader-cost ${engine}: with the mode on, idle 3 s: ${String(counts.timeout)} timeouts, ${String(counts.interval)} intervals, ${String(counts.raf)} frames, ${String(counts.fired)} callbacks fired; hidden with 2 MB held in ${String(round(cost))} ms of the page's task: ${String(during.raf)} frames, ${String(during.timeout)} timeouts, ${String(during.writes - before.writes)} writes, ${String(during.mutations)} mutations`);
  report.numbers[`screenreader-cost ${engine}`] = { idle: counts, hidden: { eventsMs: round(cost), ...during } };
  await page.context().close();
}

const SECTIONS = { geometry, words, keys, close, resize, bundle, hidden, idle, commits, flood, latency, memory, paint, axe, screenreader, 'screenreader-cost': screenreaderCost };
const wanted = CONTROL === '' ? (process.env.SECTIONS ?? Object.keys(SECTIONS).join(',')).split(',') : [CONTROLS[CONTROL].section];
const t0 = Date.now();
const dist = build('production');
const needsDev = wanted.includes('commits');
const devDist = needsDev ? build('development') : undefined;
const prod = await serve(dist);
const dev = devDist === undefined ? undefined : await serve(devDist);
const origin = prod.url.replace(/\/$/, '');
const devOrigin = dev?.url.replace(/\/$/, '');
const seconds = {};
try {
  for (const engine of engineNames) {
    if (CONTROL !== '' && CONTROLS[CONTROL].engines !== undefined && !CONTROLS[CONTROL].engines.includes(engine)) continue;
    const browser = await launch(engine);
    try {
      for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
        for (const name of wanted) {
          const started = Date.now();
          const before = failures.length;
          try {
            await SECTIONS[name]({ browser, origin, devOrigin, dist, viewport, vp, engine, control: CONTROL === '' ? undefined : CONTROLS[CONTROL] });
          } catch (error) {
            failures.push(`${name}.error: ${engine} ${vp}: ${String(error?.message ?? error).split('\n')[0]}`);
          }

          seconds[`${name} ${engine} ${vp}`] = (Date.now() - started) / 1000;
          void before;
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  prod.server.close();
  dev?.server.close();
}

report.seconds = seconds;
report.totalSeconds = (Date.now() - t0) / 1000;
if (process.env.REPORT !== undefined) writeFileSync(process.env.REPORT, JSON.stringify({ ...report, failures }, null, 1));
console.log(`probe took ${String(round(report.totalSeconds))} s (load ${os.loadavg()[0].toFixed(1)})`);
if (CONTROL === '') {
  if (checked === 0) {
    console.error(`FAIL: no assertion ran: SECTIONS=${wanted.join(',')} at ${Object.keys(VIEWPORTS).join(',')} selects nothing (a section keeps to the viewport it is made for)`);
    process.exitCode = 1;
  } else if (failures.length > 0) {
    console.error(`FAIL:\n${failures.map((line) => `  ${line}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS (${String(checked)} assertions)`);
  }
} else {
  const named = CONTROLS[CONTROL].assertion;
  const own = failures.filter((line) => line.startsWith(`${named}:`));
  const others = failures.filter((line) => !line.startsWith(`${named}:`));
  if (own.length > 0 && others.length === 0) {
    console.log(`NEGATIVE CONTROL "${CONTROL}": detected by ${named}: ${own[0].slice(0, 200)}`);
  } else if (own.length === 0 && others.length === 0) {
    console.error(`NEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${named} did not fail)`);
    process.exitCode = 1;
  } else {
    console.error(`NEGATIVE CONTROL "${CONTROL}": failed ${others.length > 0 ? `another assertion: ${others[0].slice(0, 300)}` : 'nothing it is named for'}`);
    process.exitCode = 1;
  }
}

void mkdirSync;

// Probes the kit's TooltipHost on the real `ui-next` build, in WebKit and Chromium (docs/ui-next/status/1a.4d.md, plan K9 exit test).
//
//   pnpm --filter @omniviewdev/kit run build && node packages/kit/probes/tooltip-probe.mjs      (DIST=<dir> to reuse a build)
//
// Per engine and viewport it loads the stress page (`?screen=tooltip-stress`) and checks, with real pointer and keyboard input:
//   listeners  the addEventListener calls the page makes with 0, 100 and 1,000 triggers are the same number (O(1) in triggers)
//   mount      what 1,000 triggers with a tip cost over 1,000 without one (median of 9 loads), the elements each adds (0)
//   latency    keyboard focus to a tip on screen, and the end of the delay to a tip on screen (median and worst of 9)
//   delay      no tip before 500 ms, a tip by 650 ms
//   escape     Tab to Close, the tip opens; ONE Escape hides it and the dialog behind it still gets that press (design PB-13)
//   hover      the pointer crosses from a trigger onto its tip and the tip stays; leaving the tip closes it
//   place      a tip never leaves the window (8 px margin) and never covers its trigger, from the four corners
//   motion     no transition and no animation on the host, with and without reduced motion
//   axe        no serious or critical violation with a tip open
//   scroll     a list that follows a live stream (L2-03): a tip on its sticky head opens and stays while the list scrolls on every line; with rows moving under a resting pointer faster than the delay no tip opens and
//              none ever stands for a row that is gone; when the stream stops the row under the pointer gets its tip; at a line every 1.4 s each row that comes under the pointer gets its own
// NEGATIVE_CONTROL=scroll-closes  every scroll presses Escape, as the old rule closed a tip on any scroll: the head's tip must not open (`head.opened`); no-pin: the stream does not scroll the list (`premise`);
//                                 blind-host: after its first tip the host hears of no scroll and no pointer event (`slow.gone`). Chromium at 1440 x 900, the `scroll` section only; exit 0 when it was seen.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { ENGINES, VIEWPORTS, launch, sleep } from './probe-lib.mjs';
import { buildUiNext, serve } from './serve.mjs';

const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(VIEWPORTS).join(',')).split(',');
const failures = [];
const report = {};
const fail = (where, what) => failures.push(`${where}: ${what}`);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/** Before the page runs: counts every addEventListener call, and times the tip on screen after a focus or a pointer arrival. */
function instrument() {
  window.__listeners = 0;
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (...args) {
    window.__listeners += 1;
    return original.apply(this, args);
  };

  window.__latency = { focus: [], hover: [] };
  // A sample is the time to the frame that shows THE TIP OF THE TRIGGER that was focused or hovered: the host is open, shows that trigger's own
  // text, and (for focus) the trigger still has focus and no later focus event has come. A tip left open by the previous trigger is not a
  // sample, and neither is the tip that a trigger shows when focus returns to it long after a focus that showed none (a script's `focus()`).
  let focusSeq = 0;
  const watch = (kind, t0, trigger, seq) => {
    if (kind === 'focus' && seq !== focusSeq) return;
    const host = document.querySelector('[role="tooltip"]');
    const text = trigger?.closest('[data-ov-tip]')?.getAttribute('data-ov-tip');
    const showing = () => host?.matches(':popover-open') && text !== undefined && host.textContent === text && (kind !== 'focus' || document.activeElement === trigger);
    if (showing()) {
      requestAnimationFrame(() => {
        if (showing()) window.__latency[kind].push(performance.now() - t0);
      });
    } else if (performance.now() - t0 < 1500) {
      requestAnimationFrame(() => watch(kind, t0, trigger, seq));
    }
  };

  document.addEventListener('focusin', (event) => {
    focusSeq += 1;
    watch('focus', performance.now(), event.target, focusSeq);
  }, true);
  document.addEventListener('pointerover', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-testid^="row-"]')) {
      const t0 = performance.now();
      const trigger = event.target;
      setTimeout(() => watch('hover', t0, trigger), 0);
    }
  }, true);
}

async function open(browser, url, viewport, query, options = {}) {
  const context = await browser.newContext({ viewport, ...options });
  const page = await context.newPage();
  await page.addInitScript(instrument);
  await page.goto(`${url}?screen=tooltip-stress&${query}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="first"]');
  return { context, page };
}

const hostShown = (page) => page.evaluate(() => { const host = document.querySelector('[role="tooltip"]'); return host.matches(':popover-open') ? host.textContent : null; });
const tabKey = (engineName, backwards = false) => `${engineName === 'webkit' ? 'Alt+' : ''}${backwards ? 'Shift+' : ''}Tab`;

const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
const CONTROLS = { 'scroll-closes': /^head\.opened$/, 'no-pin': /^premise$/, 'blind-host': /^slow\.gone$/ };
if (CONTROL !== '' && CONTROLS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(CONTROLS).join(', ')}`);

/** Page side: a list that follows a live stream as the log view does (a 24 px row appended and the scroll pinned to the end on every line), a sticky head that carries a tip, a tip on every row, and a sampler that notes at every frame whether the host is open, with what, and what is under the pointer. */
function buildLive({ pin }) {
  const live = document.createElement('div');
  live.id = 'live';
  live.style.cssText = 'position:fixed;left:40px;top:60px;width:420px;height:240px;overflow:auto;background:#101216;color:#e6e6e6;font:13px/24px monospace;z-index:1';
  const head = document.createElement('div');
  head.id = 'live-head';
  head.setAttribute('data-ov-tip', 'A tip on the head of a live list');
  head.textContent = 'Time  Level  Message';
  head.style.cssText = 'position:sticky;top:0;height:28px;line-height:28px;background:#1c1f26;padding:0 8px;z-index:1';
  const rows = document.createElement('div');
  live.append(head, rows);
  let n = 0;
  const state = (window.__live = { pin, timer: 0, scrolls: 0 });
  const add = () => {
    const row = document.createElement('div');
    row.setAttribute('data-ov-tip', `Row ${n}`);
    row.textContent = `row ${n}`;
    row.style.cssText = 'height:24px;padding:0 8px';
    n += 1;
    rows.append(row);
    if (state.pin) live.scrollTop = live.scrollHeight;
  };
  state.start = (rate) => { clearInterval(state.timer); state.timer = setInterval(add, 1000 / rate); };
  state.stop = () => { clearInterval(state.timer); state.timer = 0; };
  live.addEventListener('scroll', () => { state.scrolls += 1; });
  for (let i = 0; i < 40; i += 1) add();
  document.body.append(live);
  if (pin) live.scrollTop = live.scrollHeight;
  window.__samples = [];
  window.__sampling = false;
  window.__pointer = { x: 0, y: 0 };
  window.__blind = false;
  for (const type of ['scroll', 'pointerover', 'pointerout']) window.addEventListener(type, (event) => { if (window.__blind) event.stopPropagation(); }, true);
  const sample = () => {
    if (window.__sampling) {
      const host = document.querySelector('[role="tooltip"]');
      const open = host.matches(':popover-open');
      const under = document.elementFromPoint(window.__pointer.x, window.__pointer.y)?.closest('[data-ov-tip]')?.getAttribute('data-ov-tip') ?? null;
      window.__samples.push({ open, text: open ? host.textContent : null, under });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

/**
 * The scroll section (L2-03). `check(name, detail)` is told of every check that failed; `perturb` is a negative control's perturbation ('' for none). A real pointer and the real tooltip host, 20 lines a second (the log view's
 * own rate in its examples), then none, then a line every 1.4 s.
 */
async function sectionScroll(browser, url, viewport, perturb, check, out = {}) {
  const { context, page } = await open(browser, url, viewport, 'n=3');
  try {
    await page.evaluate(buildLive, { pin: perturb !== 'no-pin' });
    if (perturb === 'scroll-closes') await page.evaluate(() => document.addEventListener('scroll', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })), true));
    const head = await page.locator('#live-head').boundingBox();
    const live = await page.locator('#live').boundingBox();
    const waitTip = async (ms) => { let tip = null; for (let waited = 0; waited < ms && tip === null; waited += 100) { await sleep(100); tip = await hostShown(page); } return tip; };
    const frames = (stop) => page.evaluate((s) => { window.__sampling = s; const taken = window.__samples; if (s === false) window.__samples = []; return taken; }, stop);

    // The pointer on the sticky head while the list follows 20 lines a second: the head does not move, and the list scrolls on every line.
    await page.evaluate(() => { window.__live.scrolls = 0; window.__live.start(20); });
    await sleep(400);
    await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2, { steps: 3 });
    const opened = await waitTip(2000);
    await sleep(1200);
    const stayed = await hostShown(page);
    out.head = { opened, stayed, scrolls: await page.evaluate(() => window.__live.scrolls) };
    if (out.head.scrolls < 20) check('premise', `the stream scrolled the list ${out.head.scrolls} times while the pointer was on the head (at least 20 are needed for the check to mean anything)`);
    if (opened !== 'A tip on the head of a live list') check('head.opened', `the tip of the sticky head did not open in a list that follows a stream: ${JSON.stringify(opened)}`);
    if (stayed !== opened) check('head.stayed', `the tip of the head did not stay while the list went on scrolling: ${JSON.stringify(stayed)}`);

    // Rows move under a resting pointer faster than the delay: no tip opens, and none ever stands for a row that is gone.
    await page.mouse.move(0, 0);
    await sleep(300);
    const px = live.x + 200;
    const py = live.y + 150;
    await page.evaluate(([x, y]) => { window.__pointer = { x, y }; window.__samples = []; window.__sampling = true; }, [px, py]);
    await page.mouse.move(px, py, { steps: 3 });
    await sleep(2500);
    const moving = await frames(false);
    out.rows = { frames: moving.length, open: moving.filter((s) => s.open).length, gone: moving.filter((s) => s.open && s.text !== s.under).length };
    if (out.rows.open > 0) check('rows.opened', `${out.rows.open} frames had a tip open while the row under the pointer changed 20 times a second`);
    if (out.rows.gone > 0) check('rows.gone', `${out.rows.gone} frames had a tip that was not the row under the pointer`);

    // The stream stops: the row under the pointer gets its own tip after the delay, once the engine has said the pointer is over it.
    await page.evaluate(() => window.__live.stop());
    const settled = await waitTip(2400);
    const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-ov-tip]')?.getAttribute('data-ov-tip') ?? null, [px, py]);
    out.settled = { tip: settled, under };
    if (settled === null || settled !== under) check('settled', `after the stream stopped the tip was ${JSON.stringify(settled)} for a row under the pointer that says ${JSON.stringify(under)}`);

    // A line every 1.4 s: each row that comes under the pointer gets its own tip, none for a row that is gone.
    await page.mouse.move(0, 0);
    await sleep(300);
    await page.evaluate(([x, y]) => { window.__pointer = { x, y }; window.__samples = []; window.__sampling = true; window.__live.start(1 / 1.4); }, [px, py]);
    await page.mouse.move(px, py, { steps: 3 });
    if (perturb === 'blind-host') {
      await waitTip(2000);
      await page.evaluate(() => { window.__blind = true; });
    }

    await sleep(8500);
    await page.evaluate(() => window.__live.stop());
    const slow = await frames(false);
    out.slow = { frames: slow.length, open: slow.filter((s) => s.open).length, gone: slow.filter((s) => s.open && s.text !== s.under).length, distinct: [...new Set(slow.filter((s) => s.open).map((s) => s.text))].length };
    if (out.slow.gone > 0) check('slow.gone', `${out.slow.gone} frames had a tip that was not the row under the pointer`);
    if (out.slow.distinct < 3) check('slow.followed', `only ${out.slow.distinct} different rows got a tip in 8.5 s at a line every 1.4 s`);
  } finally {
    await context.close();
  }

  return out;
}

const dist = buildUiNext();
const { server, url } = await serve(dist);

if (CONTROL !== '') {
  // A negative control: the `scroll` section once as it is (it must not fail the check the control is named for) and once with the perturbation (it must). Exit 0 when the perturbation was seen.
  const browser = await launch('chromium');
  const run = async (perturb) => { const names = []; await sectionScroll(browser, url, VIEWPORTS['1440x900'], perturb, (name) => names.push(name)); return names; };
  const without = await run('');
  const withIt = await run(CONTROL);
  await browser.close();
  server.close();
  const seen = !without.some((name) => CONTROLS[CONTROL].test(name)) && withIt.some((name) => CONTROLS[CONTROL].test(name));
  console.log(`NEGATIVE CONTROL "${CONTROL}": ${seen ? 'detected' : 'NOT DETECTED'} (without it: ${without.join(', ') || 'no failure'}; with it: ${withIt.join(', ') || 'no failure'})`);
  process.exit(seen ? 0 : 1);
}
try {
  for (const engineName of engineNames) {
    const browser = await launch(engineName);
    for (const viewportName of viewportNames) {
      const where = `${engineName} ${viewportName}`;
      const viewport = VIEWPORTS[viewportName];
      const out = (report[where] = {});

      // ---- listeners and mount cost
      const listeners = {};
      for (const n of [0, 100, 1000]) {
        const { context, page } = await open(browser, url, viewport, `n=${n}`);
        listeners[n] = await page.evaluate(() => window.__listeners);
        await context.close();
      }

      out.listeners = listeners;
      if (listeners[0] !== listeners[100] || listeners[100] !== listeners[1000]) fail(where, `listeners grow with triggers: ${JSON.stringify(listeners)}`);
      const mount = { tip: [], plain: [] };
      for (let run = 0; run < 9; run += 1) {
        for (const mode of ['tip', 'plain']) {
          const { context, page } = await open(browser, url, viewport, `n=1000&mode=${mode}`);
          mount[mode].push(await page.evaluate(() => window.__stress.renderMs));
          if (run === 0 && mode === 'tip') out.elementsPerTrigger = await page.evaluate(() => document.querySelector('[data-testid="list"] li').querySelectorAll('*').length);
          await context.close();
        }
      }

      out.mount = { tipMs: Number(median(mount.tip).toFixed(1)), plainMs: Number(median(mount.plain).toFixed(1)), addedMs: Number((median(mount.tip) - median(mount.plain)).toFixed(1)) };
      if (out.mount.addedMs > 8) fail(where, `1,000 triggers with a tip cost ${out.mount.addedMs} ms more than without (budget 8)`);
      if (out.elementsPerTrigger !== 1) fail(where, `a trigger is ${out.elementsPerTrigger} elements inside its li; the tip adds none, so it must be the one span`);

      // ---- behaviour, on one page
      const { context, page } = await open(browser, url, viewport, 'n=1000');
      const row = page.getByTestId('row-3');
      await row.hover();
      await sleep(400);
      if ((await hostShown(page)) !== null) fail(where, 'a tip is open 400 ms after the pointer arrived');
      await sleep(250);
      if ((await hostShown(page)) !== 'Row 3 was created 4 days ago') fail(where, `no tip 650 ms after the pointer arrived: ${await hostShown(page)}`);

      // the pointer crosses the gap onto the tip and the tip stays; off it, the tip closes
      const rowBox = await row.boundingBox();
      const tipBox = await page.locator('[role="tooltip"]').boundingBox();
      await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height + 2, { steps: 4 });
      await page.mouse.move(tipBox.x + tipBox.width / 2, tipBox.y + tipBox.height / 2, { steps: 6 });
      await sleep(150);
      if ((await hostShown(page)) === null) fail(where, 'the tip closed while the pointer crossed onto it');
      await page.mouse.move(5, viewport.height - 5, { steps: 4 });
      await sleep(100);
      if ((await hostShown(page)) !== null) fail(where, 'the tip stayed open after the pointer left it');

      // open latency: Tab and Shift+Tab between the two controls that have a tip, and the pointer onto nine rows
      await page.getByTestId('first').focus();
      for (let i = 0; i < 10; i += 1) {
        await page.keyboard.press(tabKey(engineName, i % 2 === 0));
        await sleep(120);
      }
      // The hover samples so far are the behaviour checks above: the first tip this page ever showed (cold: its style, layout and glyphs are
      // computed once; 170 ms in Linux WebKit) and a re-entry that opens at once. Neither is the latency of a tip: they are kept out of the
      // gate, and the cold one is reported.
      out.coldFirstHoverMs = await page.evaluate(() => {
        const first = window.__latency.hover[0];
        window.__latency.hover = [];
        return first === undefined ? null : Math.round(first - 500);
      });

      for (let i = 0; i < 9; i += 1) {
        await page.mouse.move(5, viewport.height - 5);
        await sleep(80);
        const box = await page.getByTestId(`row-${10 + i}`).boundingBox();
        await page.mouse.move(box.x + 4, box.y + box.height / 2);
        await sleep(700);
      }

      const latency = await page.evaluate(() => window.__latency);
      out.latency = {
        focusSamples: latency.focus.length,
        focusMedianMs: Number(median(latency.focus).toFixed(1)),
        focusWorstMs: Number(Math.max(...latency.focus).toFixed(1)),
        hoverSamples: latency.hover.length,
        afterDelayMedianMs: Number((median(latency.hover) - 500).toFixed(1)),
        afterDelayWorstMs: Number((Math.max(...latency.hover) - 500).toFixed(1)),
        samples: { focus: latency.focus.map((value) => Math.round(value)), afterDelay: latency.hover.map((value) => Math.round(value - 500)) },
      };
      if (latency.focus.length < 5 || latency.hover.length < 5) fail(where, `too few latency samples: ${JSON.stringify(out.latency)}`);
      // The plan's budget is 2 frames (33.4 ms) at p95 and stands: it is verified on the reference machine in step 1a.11 (lead's ruling). This gate
      // is for a CI runner only: nine to eleven samples cannot show a p95, and a software-rendered Linux runner has a frame that takes 40 ms, so it
      // is the median inside 2 frames and no sample over 100 ms; the worst is in the report (macOS: 24 to 30 ms).
      if (out.latency.focusMedianMs > 33.4 || out.latency.focusWorstMs > 100) fail(where, `a tip took ${out.latency.focusMedianMs} ms (worst ${out.latency.focusWorstMs}) to appear on keyboard focus (budget: median 33.4, worst 100)`);
      if (out.latency.afterDelayMedianMs > 33.4 || out.latency.afterDelayWorstMs > 100) fail(where, `a tip appeared ${out.latency.afterDelayMedianMs} ms (worst ${out.latency.afterDelayWorstMs}) after the end of its 500 ms delay (budget: median 33.4, worst 100)`);

      // escape layering: the tip of Close is open by keyboard, one Escape closes it and the dialog behind it gets the same press
      await page.mouse.move(5, viewport.height - 5);
      await page.getByTestId('first').focus();
      await page.keyboard.press(tabKey(engineName, true));
      await sleep(120);
      if ((await hostShown(page)) !== 'Close') fail(where, `the tip of Close is not open after Shift+Tab to it: ${await hostShown(page)}`);
      await page.keyboard.press('Escape');
      await sleep(80);
      const dialogClosed = await page.evaluate(() => document.querySelector('[role="dialog"]').getAttribute('data-closed'));
      out.escape = { tipAfterEscape: await hostShown(page), dialogClosed };
      if ((await hostShown(page)) !== null) fail(where, 'Escape did not hide the tip');
      if (dialogClosed !== 'true') fail(where, 'the dialog behind the tip did not get the Escape: one press closes both (PB-13)');

      // placement from the four corners
      await page.evaluate(() => {
        for (const [id, css] of [['tl', 'left:2px;top:2px'], ['tr', 'right:2px;top:2px'], ['bl', 'left:2px;bottom:2px'], ['br', 'right:2px;bottom:2px']]) {
          const element = document.createElement('button');
          element.id = `corner-${id}`;
          element.textContent = id;
          element.setAttribute('data-ov-tip', `Corner ${id}: a longer text that wraps because it is well over the width of three hundred pixels, which is the most a tooltip is wide`);
          // Own colours: an unstyled button takes the engine's face colour (grey on Linux WebKit) under the theme's white text, which axe rightly refuses.
          element.style.cssText = `position:fixed;${css};width:24px;height:24px;background:#000;color:#fff`;
          document.body.append(element);
        }
      });
      out.corners = {};
      for (const id of ['tl', 'tr', 'bl', 'br']) {
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await sleep(80);
        await page.locator(`#corner-${id}`).hover();
        await sleep(650);
        const box = await page.locator('[role="tooltip"]').boundingBox();
        const trigger = await page.locator(`#corner-${id}`).boundingBox();
        const inside = box.x >= 7.5 && box.y >= 7.5 && box.x + box.width <= viewport.width - 7.5 && box.y + box.height <= viewport.height - 7.5;
        const covers = box.x < trigger.x + trigger.width && box.x + box.width > trigger.x && box.y < trigger.y + trigger.height && box.y + box.height > trigger.y;
        out.corners[id] = { x: box.x, y: box.y, w: box.width, h: box.height, placement: await page.locator('[role="tooltip"]').getAttribute('data-placement') };
        if (!inside) fail(where, `the tip of corner ${id} leaves the window: ${JSON.stringify(out.corners[id])}`);
        if (covers) fail(where, `the tip of corner ${id} covers its trigger`);
      }

      // a tip with no room on any side is limited in height and scrolls inside; the pointer must still cross the gap onto it (the bridge is not clipped)
      await page.evaluate(() => {
        const element = document.createElement('button');
        element.id = 'clamped';
        element.textContent = 'c';
        element.setAttribute('data-ov-tip', 'word '.repeat(600));
        element.style.cssText = 'position:fixed;left:50%;top:45%;width:60px;height:28px;background:#000;color:#fff';
        document.body.append(element);
      });
      await page.mouse.move(5, viewport.height - 5);
      await sleep(80);
      await page.locator('#clamped').hover();
      await sleep(650);
      const limited = await page.evaluate(() => {
        const host = document.querySelector('[role="tooltip"]');
        const body = host.querySelector('[data-ov-tip-body]');
        const box = host.getBoundingClientRect();
        const trigger = document.getElementById('clamped').getBoundingClientRect();
        const inner = body.getBoundingClientRect();
        return { side: host.getAttribute('data-placement'), clamped: host.getAttribute('data-ov-clamped'), scrolls: body.scrollHeight > body.clientHeight, overlaps: box.left < trigger.right && box.right > trigger.left && box.top < trigger.bottom && box.bottom > trigger.top, inside: box.top >= 7.5 && box.bottom <= window.innerHeight - 7.5 && box.left >= 7.5 && box.right <= window.innerWidth - 7.5, bodyInside: inner.top >= box.top + 1 && inner.bottom <= box.bottom - 1, hostOverflow: getComputedStyle(host).overflowY, box: { x: box.x, y: box.y, w: box.width, h: box.height }, body: { top: inner.top, bottom: inner.bottom } };
      });
      out.limited = limited;
      if (limited.clamped !== 'true' || !limited.scrolls || !limited.bodyInside) fail(where, `a tip with no room was not limited, scrolling and inside its own border: ${JSON.stringify(limited)}`);
      if (limited.overlaps || !limited.inside) fail(where, `a limited tip covers its trigger or leaves the window: ${JSON.stringify(limited)}`);
      if (limited.hostOverflow !== 'visible') fail(where, `a limited tip clips its own bridge: overflow-y ${limited.hostOverflow}`);
      const clampedBox = await page.locator('#clamped').boundingBox();
      const limitedTip = await page.locator('[role="tooltip"]').boundingBox();
      const crossing = { bottom: [0, clampedBox.height + 3], top: [0, -3], right: [clampedBox.width + 3, clampedBox.height / 2], left: [-3, clampedBox.height / 2] }[limited.side];
      await page.mouse.move(clampedBox.x + (crossing[0] === 0 ? clampedBox.width / 2 : crossing[0]), clampedBox.y + crossing[1], { steps: 4 });
      await page.mouse.move(limitedTip.x + limitedTip.width / 2, limitedTip.y + limitedTip.height / 2, { steps: 8 });
      await sleep(200);
      if ((await hostShown(page)) === null) fail(where, 'a limited tip closed while the pointer crossed onto it');
      await page.mouse.move(5, viewport.height - 5, { steps: 4 });
      await sleep(100);
      await page.evaluate(() => document.getElementById('clamped').remove());

      // accessibility and motion with a tip open
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.locator('#corner-tl').hover();
      await sleep(650);
      await page.addScriptTag({ path: axePath });
      out.axe = await page.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map((node) => `${node.target.join(' ')}: ${node.any[0]?.message ?? ''}`) })));
      for (const violation of out.axe.filter((v) => v.impact === 'serious' || v.impact === 'critical')) fail(where, `axe ${violation.impact}: ${violation.id} on ${violation.nodes} node(s): ${violation.targets.join(' | ')}`);
      const motion = () => page.evaluate(() => { const style = getComputedStyle(document.querySelector('[role="tooltip"]')); return { transition: style.transitionDuration, animation: style.animationName }; });
      out.motion = await motion();
      if (!/^0s(, 0s)*$/.test(out.motion.transition) || out.motion.animation !== 'none') fail(where, `the host moves: ${JSON.stringify(out.motion)}`);
      await context.close();

      const quiet = await open(browser, url, viewport, 'n=3', { reducedMotion: 'reduce' });
      await quiet.page.getByTestId('first').focus();
      await quiet.page.keyboard.press(tabKey(engineName, true));
      await sleep(150);
      out.reducedMotion = { shown: await hostShown(quiet.page), ...(await quiet.page.evaluate(() => { const style = getComputedStyle(document.querySelector('[role="tooltip"]')); return { transition: style.transitionDuration, animation: style.animationName }; })) };
      if (out.reducedMotion.shown === null || out.reducedMotion.animation !== 'none' || !/^0s/.test(out.reducedMotion.transition)) fail(where, `reduced motion: ${JSON.stringify(out.reducedMotion)}`);
      await quiet.context.close();
      out.scroll = await sectionScroll(browser, url, viewport, '', (name, detail) => fail(where, `scroll.${name}: ${detail}`));
    }

    await browser.close();
  }
} finally {
  server.close();
}

console.log(JSON.stringify(report, null, 1));
console.log(failures.length ? `\nFAILURES (${failures.length}):\n  ${failures.join('\n  ')}` : '\nthe tooltip meets the budget and the behaviour in both engines');
if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1));
if (failures.length) process.exitCode = 1;

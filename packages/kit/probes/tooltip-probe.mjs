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

const dist = buildUiNext();
const { server, url } = await serve(dist);
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

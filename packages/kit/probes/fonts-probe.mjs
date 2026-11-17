// Probes the kit's fonts on the real `ui-next` frame page, in WebKit and Chromium at 1440 x 900 and 1030 x 720.
//
//   pnpm --filter @omniviewdev/kit run build            # the page imports the BUILT kit
//   node packages/kit/probes/fonts-probe.mjs            # builds ui-next (OMNIVIEW_UI=next) into a temp dir, serves it, probes it
//
//   DIST=<dir>   probe an existing build         ENGINES=webkit,chromium   VIEWPORTS=1440x900,1030x720
//   REPORT=<file>  write the full report as JSON
//
// What it checks, per engine and viewport (exit code 1 when one fails):
//   delivery   each font file the page uses is requested exactly once (the preload and the @font-face rule share one URL; a preload
//              without `crossorigin` would fetch it twice), is served as a font, and its face reaches the state `loaded`
//   metrics    a reference string measures what the original Inter and JetBrains Mono give at 13 px (HarfBuzz, kerning on, contextual
//              alternates off): the page shows the delivered subset, not a system fallback, and the subset kept its metrics
//   features   every element that holds text has contextual alternates off (`"calt" 0`), so `7x5nx` is drawn as it is stored
//   shift      layout shift on the frame page while it loads with the preload: Chromium's own CLS (layout-shift entries) and, in both
//              engines, the geometry of every element at the first frame that has content against the geometry once the fonts have
//              settled; both must be zero
//   slow fetch  in Chromium, with every font file served 40 ms late (as a runner does): the same shift, zero, so no face is left to be asked for after layout
// It also MEASURES, without failing, what the preload buys: the same shift with the preload removed, with the fonts 400 ms late, and both.
import { writeFileSync } from 'node:fs';
import { ENGINES, VIEWPORTS, launch, sleep } from './probe-lib.mjs';
import { buildUiNext, serve } from './serve.mjs';

const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(VIEWPORTS).join(',')).split(',');

// 13 px, kerning on, calt off, tnum off: advance widths of the ORIGINAL font files summed by HarfBuzz (uharfbuzz 0.57.0).
const SAMPLE = 'Hamburgefonstiv 0123456789';
const EXPECTED_WIDTH = [
  { family: 'Int UI Inter', weight: 400, width: 187.2628 },
  { family: 'Int UI Inter', weight: 600, width: 193.2965 },
  { family: 'Int UI Mono', weight: 400, width: 202.8 },
];
const WIDTH_TOLERANCE = 0.25;

// The faces the frame page draws with: Inter 400 for text, 600 for titles. The mono face is declared and not used by the frame.
const USED = ['Int UI Inter 400', 'Int UI Inter 600'];

const failures = [];
const report = { delivery: {}, metrics: {}, features: {}, shift: {}, slowFetch: {}, variants: {} };
const fail = (where, what) => failures.push(`${where}: ${what}`);

/** Installed before the page runs: records layout shifts, and the geometry of every element at the first frame with content. */
function instrument() {
  window.__fonts = { shifts: [], firstFrame: null, firstFrameAt: null, loaded: [], at: {} };
  const state = window.__fonts;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) state.shifts.push({ value: entry.value, at: Math.round(entry.startTime), sources: entry.sources.map((s) => `${s.node?.nodeName ?? '?'} ${Math.round(s.previousRect.x)},${Math.round(s.previousRect.y)} -> ${Math.round(s.currentRect.x)},${Math.round(s.currentRect.y)}`).slice(0, 4) });
    }
  }).observe({ type: 'layout-shift', buffered: true });

  // HTML elements only: the inside of an SVG is content (the busy button swaps its glyph after a second), not layout. The examples of the
  // tables (any example that holds a <table>) are left out too: their virtualizer corrects the height of its spacer rows (an estimate against measured rows) after
  // the first frame, whatever the fonts do, and their mono cells swap JetBrains Mono, which the page does not preload (1 to 2 px, CLS 0 in
  // Chromium): both belong to the table steps (see docs/ui-next/status/1a.4d.md), not to the fonts of the frame.
  const rects = () => {
    const out = new Map();
    for (const element of document.querySelectorAll('#root *')) {
      if (!(element instanceof HTMLElement) && !(element instanceof SVGSVGElement)) continue;
      if (element.closest('[data-example]')?.querySelector('table') != null) continue;
      const r = element.getBoundingClientRect();
      out.set(element, [r.left, r.top, r.width, r.height]);
    }

    return out;
  };

  state.rects = rects;
  const watch = new MutationObserver(() => {
    if (!document.querySelector('#root > *') || state.firstFrame !== null) return;
    state.firstFrameAt = Math.round(performance.now());
    state.firstFrame = 'pending';
    // The frame that paints the content first: what a user sees before anything has had time to change.
    requestAnimationFrame(() => {
      state.firstFrame = rects();
      state.facesAtFirstFrame = [...document.fonts].map((face) => `${face.family} ${face.weight} ${face.status}`);
    });
  });
  watch.observe(document, { childList: true, subtree: true });
  document.fonts.addEventListener('loadingdone', (event) => {
    for (const face of event.fontfaces) state.loaded.push({ face: `${face.family} ${face.weight}`, at: Math.round(performance.now()) });
  });
}

/** How far each element that existed at the first frame has moved or resized since: the geometry shift of the page, in pixels. */
async function geometry(page) {
  return page.evaluate(() => {
    const state = window.__fonts;
    const now = state.rects();
    let moved = 0;
    let largest = 0;
    const examples = [];
    if (state.firstFrame === null || state.firstFrame === 'pending') return { moved: -1, largest: -1, elements: 0, examples: ['no first frame was seen'] };
    for (const [element, before] of state.firstFrame) {
      const after = now.get(element);
      if (!after) continue;
      const delta = Math.max(...before.map((value, index) => Math.abs(value - after[index])));
      if (delta > 0.01) {
        moved += 1;
        largest = Math.max(largest, delta);
        if (examples.length < 3) examples.push(`${element.closest('[data-example]')?.getAttribute('data-example') ?? 'frame'} ${element.tagName.toLowerCase()} ${before.map((v) => Math.round(v * 10) / 10).join(',')} -> ${after.map((v) => Math.round(v * 10) / 10).join(',')}`);
      }
    }

    return { moved, largest: Math.round(largest * 100) / 100, elements: state.firstFrame.size, examples };
  });
}

/** One page load with the given conditions; returns what the page did. `delay` holds the font files back by that many ms. */
async function load(browser, url, viewport, { preload = true, delay = 0 } = {}) {
  // Reduced motion: the busy loader of the Button examples turns, and a turning box has no stable bounding rectangle. Fonts are the question here.
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.woff2')) requests.push(request.url());
  });
  const responses = [];
  page.on('response', (response) => {
    if (response.url().endsWith('.woff2')) responses.push({ url: response.url(), status: response.status(), type: response.headers()['content-type'] });
  });
  if (delay > 0) {
    await page.route('**/*.woff2', async (route) => {
      await sleep(delay);
      await route.continue();
    });
  }

  if (!preload) {
    await page.route(url, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(/<link rel="preload"[^>]*>/g, '') });
    });
  }

  await page.addInitScript(instrument);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-example="Button/Secondary"]');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await sleep(1200);
  return { context, page, requests, responses };
}

async function shiftOf(page) {
  const native = await page.evaluate(() => ({ cls: window.__fonts.shifts.reduce((sum, s) => sum + s.value, 0), shifts: window.__fonts.shifts }));
  const state = await page.evaluate(() => ({ firstFrameAt: window.__fonts.firstFrameAt, loaded: window.__fonts.loaded, facesAtFirstFrame: window.__fonts.facesAtFirstFrame }));
  return { ...native, geometry: await geometry(page), ...state };
}

async function main() {
  const dist = await buildUiNext();
  const { server, url } = await serve(dist);
  try {
    for (const engineName of engineNames) {
      const browser = await launch(engineName);
      for (const viewportName of viewportNames) {
        const viewport = VIEWPORTS[viewportName];
        const where = `${engineName} ${viewportName}`;

        const { context, page, requests, responses } = await load(browser, url, viewport);

        // ---- delivery
        const faces = await page.evaluate(() => [...document.fonts].map((face) => `${face.family} ${face.weight} ${face.status}`));
        const counts = Object.groupBy(requests, (request) => request);
        const delivery = { requests: Object.fromEntries(Object.entries(counts).map(([name, list]) => [name.replace(url, ''), list.length])), faces, responses };
        report.delivery[where] = delivery;
        for (const used of USED) {
          if (!faces.includes(`${used} loaded`)) fail(where, `${used} did not reach the state loaded: ${faces.join(', ')}`);
        }

        for (const [name, count] of Object.entries(delivery.requests)) {
          if (count !== 1) fail(where, `${name} was requested ${count} times, not once (a preload without crossorigin, or a second URL for the same file)`);
        }

        const inter = Object.keys(delivery.requests).filter((name) => /Inter-(Regular|SemiBold)/.test(name));
        if (inter.length !== 2) fail(where, `the two Inter files were not both requested: ${inter.join(', ')}`);
        for (const response of responses) {
          if (response.status !== 200 || !/^font\/woff2/.test(response.type ?? '')) fail(where, `${response.url} answered ${response.status} ${response.type}, not a font`);
        }

        // ---- metrics
        const widths = await page.evaluate(async ({ sample, expected }) => {
          const out = [];
          for (const { family, weight } of expected) {
            await document.fonts.load(`${weight} 13px "${family}"`);
            const span = document.createElement('span');
            span.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${weight} 13px "${family}", serif;font-feature-settings:"calt" 0;letter-spacing:normal`;
            span.textContent = sample;
            document.body.append(span);
            out.push({ family, weight, width: span.getBoundingClientRect().width });
            span.remove();
          }

          return out;
        }, { sample: SAMPLE, expected: EXPECTED_WIDTH });
        report.metrics[where] = widths;
        for (const [index, got] of widths.entries()) {
          const want = EXPECTED_WIDTH[index];
          if (Math.abs(got.width - want.width) > WIDTH_TOLERANCE) fail(where, `${got.family} ${got.weight} measures ${got.width.toFixed(3)} px for the sample, the original font gives ${want.width}`);
        }

        // ---- features
        const offenders = await page.evaluate(() => {
          const bad = [];
          for (const element of document.querySelectorAll('#root *')) {
            const hasText = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== '');
            if (hasText && getComputedStyle(element).fontFeatureSettings.replace(/['"]/g, '') !== 'calt 0') bad.push(`${element.tagName.toLowerCase()} ${getComputedStyle(element).fontFeatureSettings}`);
          }

          return { bad: bad.slice(0, 5), count: bad.length, elements: document.querySelectorAll('#root *').length };
        });
        report.features[where] = offenders;
        if (offenders.count > 0) fail(where, `${offenders.count} elements with text do not have contextual alternates off: ${offenders.bad.join('; ')}`);

        // ---- shift
        const shift = await shiftOf(page);
        report.shift[where] = shift;
        if (engineName === 'chromium' && shift.cls !== 0) fail(where, `CLS ${shift.cls} with the preload: ${JSON.stringify(shift.shifts)}`);
        if (shift.geometry.moved !== 0) fail(where, `${shift.geometry.moved} of ${shift.geometry.elements} elements moved after the first frame, up to ${shift.geometry.largest} px: ${shift.geometry.examples.join('; ')}`);
        await context.close();

        // ---- a slow font fetch (gated, Chromium: its request routing keeps the fonts working, WebKit's does not). A runner serves a font tens of
        // milliseconds after the request, which a local server hides. A face that is not preloaded is asked for only once layout uses it, so it
        // arrives after the first frame; with every face preloaded they arrive together, in time.
        if (engineName === 'chromium') {
          const slow = await load(browser, url, viewport, { delay: 40 });
          const late = await shiftOf(slow.page);
          report.slowFetch[where] = { cls: late.cls, moved: late.geometry.moved, facesAtFirstFrame: late.facesAtFirstFrame };
          if (late.cls !== 0 || late.geometry.moved !== 0) fail(where, `with every font file 40 ms late: CLS ${late.cls}, ${late.geometry.moved} elements moved after the first frame (${late.geometry.examples.join('; ')}), faces at the first frame ${JSON.stringify(late.facesAtFirstFrame)}`);
          await slow.context.close();
        }

        // ---- what the preload buys (measured, not gated)
        const variants = {};
        for (const [name, options] of [['no preload', { preload: false }], ['fonts 400 ms late', { delay: 400 }], ['no preload, fonts 400 ms late', { preload: false, delay: 400 }]]) {
          const run = await load(browser, url, viewport, options);
          const result = await shiftOf(run.page);
          variants[name] = { cls: Number(result.cls.toFixed(8)), moved: result.geometry.moved, largestPx: result.geometry.largest, firstFrameAt: result.firstFrameAt, loaded: result.loaded.map((entry) => `${entry.face}@${entry.at}`), facesAtFirstFrame: result.facesAtFirstFrame };
          await run.context.close();
        }

        report.variants[where] = variants;
      }

      await browser.close();
    }
  } finally {
    server.close();
  }
}

await main();
const lines = [];
for (const [where, shift] of Object.entries(report.shift)) {
  lines.push(`${where}: CLS ${shift.cls} (Chromium only), ${shift.geometry.moved} of ${shift.geometry.elements} elements moved after the first frame; first frame at ${shift.firstFrameAt} ms with faces ${JSON.stringify(shift.facesAtFirstFrame)}`);
  lines.push(`  fonts: ${report.delivery[where].faces.join(', ')}; requests ${JSON.stringify(report.delivery[where].requests)}`);
  lines.push(`  widths: ${report.metrics[where].map((w) => `${w.family} ${w.weight} ${w.width.toFixed(3)}`).join(', ')}`);
  for (const [name, variant] of Object.entries(report.variants[where])) lines.push(`  ${name}: CLS ${variant.cls}, ${variant.moved} elements moved, up to ${variant.largestPx} px`);
}

lines.push(failures.length ? `\nFAILURES (${failures.length}):\n  ${failures.join('\n  ')}` : '\nthe fonts are delivered, used, and the page does not shift');
console.log(lines.join('\n'));
if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1));
if (failures.length) process.exitCode = 1;

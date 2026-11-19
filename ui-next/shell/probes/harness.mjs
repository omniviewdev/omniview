// What the shell's probes share: the fixtures' build, a static server for it (the kit's, so FONT_DELAY_MS applies), a page that is opened the way every check opens it, and the sampler
// that watches the regions at every frame.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../../../packages/kit/probes/serve.mjs';
import { MOCK_REGISTRATION } from '../../../packages/kit/probes/mock-screen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../..');

/** axe-core, from the kit package that depends on it (the root has none): AXE names another build. */
export const AXE = process.env.AXE ?? createRequire(path.join(repo, 'packages/kit/package.json')).resolve('axe-core/axe.min.js');

/**
 * The viewports of the shell's native checks (decision A15): 1440 x 900, and 1280 x 800, the native window's minimum. 1030 x 720 is retired. The frame probe's reference
 * (mock-shell.json) was measured at 1440 x 900 and 1030 x 720 and moves to these with the probe viewports' switch (tracker row N23); the strip's reference (mock-strip.json) is measured here.
 */
export const NATIVE_VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };

/** A build of the fixtures: production (the one every measurement reads) or development (React's Profiler calls `onRender` there; the commit counts read it). FIXTURE_DIST / FIXTURE_DIST_DEV name existing builds. */
export function buildFixtures(mode = 'production') {
  const existing = mode === 'development' ? process.env.FIXTURE_DIST_DEV : process.env.FIXTURE_DIST;
  if (existing !== undefined && existing !== '') return existing;
  const out = mkdtempSync(path.join(os.tmpdir(), `shell-probe-fixture-${mode}-`));
  // React's development build is chosen by NODE_ENV, which `vite build` sets to production unless it is set.
  execFileSync('node', [path.join(here, 'build-fixture.mjs'), out, mode], { cwd: repo, env: { ...process.env, OMNIVIEW_UI: 'next', NODE_ENV: mode }, stdio: 'pipe' });
  return out;
}

/** Serves a build of the fixtures: the origin to open `/shell/probes/fixture.html` and `host-fixture.html` under. FONT_DELAY_MS holds every font file back, as the kit's probes do. */
export async function serveFixtures(dist) {
  const { server, url } = await serve(dist);
  return { server, origin: url.replace(/\/$/, '') };
}

/**
 * The sampler, installed before the page's own scripts: from the first animation frame, the rectangle of every named part of the frame at every frame, by NAME (the region whose
 * `data-shell-part` or `data-shell-region` it is, the first in the document) and not by element, so a region that is replaced by another of the same name is read as one place. A region that
 * is there and has another rectangle than at the frame before has moved. The layout-shift observer adds what the engine measures (Chromium: the sum of every shift and the nodes that shifted).
 */
export const SAMPLER = `
(() => {
  const state = (window.__probe = { frames: 0, first: {}, moves: [], gone: [], layoutShift: null, shiftSources: [], seen: {} });
  try {
    state.layoutShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        state.layoutShift += entry.value;
        for (const source of entry.sources ?? []) state.shiftSources.push(source.node?.nodeName ?? '?');
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    state.layoutShift = null;
  }
  const NAMES = ['window', 'topRow', 'safeArea', 'frame', 'rail', 'sidebar', 'sidebarHeader', 'island', 'lane', 'page', 'statusBar', 'actions', 'tabStrip', 'dragLane'];
  const find = (name) => document.querySelector('[data-shell-part="' + name + '"], [data-shell-region="' + name + '"]');
  const last = {};
  const tick = () => {
    state.frames += 1;
    for (const name of NAMES) {
      const el = find(name);
      if (el === null) {
        if (last[name] !== undefined && last[name] !== null) state.gone.push({ part: name, frame: state.frames });
        last[name] = null;
        continue;
      }
      const box = el.getBoundingClientRect();
      const now = [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 100) / 100).join(',');
      if (state.first[name] === undefined) state.first[name] = state.frames;
      if (last[name] !== undefined && last[name] !== null && last[name] !== now) state.moves.push({ part: name, frame: state.frames, from: last[name], to: now });
      last[name] = now;
      state.seen[name] = now;
    }
    // The rail's entries, by their name, as the regions are: an entry that is there and has another rectangle than at the frame before has moved, so a plugin that registers late must not push
    // the entries already drawn (the entries are in the rail's track, which holds still; the layout-shift observer says so in Chromium only).
    for (const button of document.querySelectorAll('[data-shell-part="rail"] button')) {
      const name = 'rail:' + button.getAttribute('aria-label');
      const box = button.getBoundingClientRect();
      const now = [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 100) / 100).join(',');
      if (state.first[name] === undefined) state.first[name] = state.frames;
      if (last[name] !== undefined && last[name] !== now) state.moves.push({ part: name, frame: state.frames, from: last[name], to: now });
      last[name] = now;
      state.seen[name] = now;
    }
    if (state.frames < (window.__probeFrames ?? 240)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

/** Opens a page in a fresh context at `viewport`: errors collected, the mock's words injected where the case asks (`?case=injected`), the first frame waited for. */
export async function open(browser, url, viewport, { init, waitFor = '[data-shell-part="window"]' } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
  page.on('response', (response) => {
    // The Go host serves /wails/*; the static server of this probe does not, and the screen does not need it for its frame.
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico') && !response.url().includes('/wails/')) errors.push(`${response.status()} ${response.url()}`);
  });
  if (init) await page.addInitScript(init);
  if (url.includes('case=injected')) await page.addInitScript((value) => { window.__registration = value; }, MOCK_REGISTRATION);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector(waitFor);
  return { page, context, errors };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

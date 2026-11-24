// Run against the built kit. DIST optionally points to an existing ui-next build.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { awaitFonts, launch } from './probe-lib.mjs';
import { buildUiNext, serve } from './serve.mjs';
import { buildFixture, serve as serveFixture } from '../../../ui-next/page/probes/lib.mjs';

const output = process.env.SHOTS_DIR;
if (!output) throw new Error('Set SHOTS_DIR to the evidence directory');
mkdirSync(output, { recursive: true });
const { server, partsUrl } = await serve(buildUiNext());
const fixture = await serveFixture(buildFixture());
try {
  for (const engine of ['webkit', 'chromium']) {
    const browser = await launch(engine);
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`${partsUrl}&part=ProgressBar`);
      const bars = page.getByRole('progressbar');
      await bars.first().waitFor();
      await awaitFonts(page);
      const frames = await bars.evaluateAll(nodes => nodes.map(node => ({
        height: node.getBoundingClientRect().height,
        value: node.getAttribute('aria-valuenow'),
        name: node.getAttribute('aria-label'),
      })));
      assert(frames.every(bar => bar.height === 4 && bar.name));
      assert(frames.some(bar => bar.value === null) && frames.some(bar => bar.value !== null));
      for (const reducedMotion of ['no-preference', 'reduce']) {
        await page.emulateMedia({ reducedMotion });
        const metrics = await bars.evaluateAll(async nodes => {
          const samples = [];
          let mutations = 0;
          const observer = new MutationObserver(entries => { mutations += entries.length; });
          for (const node of nodes) observer.observe(node, { attributes: true, subtree: true, childList: true, characterData: true });
          let previous = await new Promise(requestAnimationFrame);
          for (let i = 0; i < 60; ++i) {
            const now = await new Promise(requestAnimationFrame);
            samples.push(now - previous);
            previous = now;
          }
          observer.disconnect();
          const active = nodes.filter(node => node.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'));
          return { mutations, motion: active.map(node => node.dataset.ovMotion), frameP95Ms: samples.sort((a, b) => a - b)[56] };
        });
        assert.equal(metrics.mutations, 0);
        if (reducedMotion === 'reduce') assert.deepEqual(metrics.motion, []);
        else assert.deepEqual(metrics.motion.sort(), ['stripe', 'sweep']);
        console.log(JSON.stringify({ engine, reducedMotion, bars: frames.length, ...metrics }));
        if (engine === 'webkit') {
          const gallery = page.locator('figure[data-example^="ProgressBar/"]').first().locator('..');
          // Sample the real CSS animations at a repeatable position without changing application state.
          if (reducedMotion === 'no-preference') await bars.evaluateAll(nodes => {
            for (const node of nodes) for (const animation of node.getAnimations({ subtree: true })) {
              animation.pause();
              animation.currentTime = 650;
            }
          });
          const name = reducedMotion === 'reduce' ? 'progress-bar-webkit.png' : 'progress-bar-motion-webkit.png';
          await gallery.screenshot({ path: path.join(output, name) });
          if (reducedMotion === 'no-preference') await bars.evaluateAll(nodes => {
            for (const node of nodes) for (const animation of node.getAnimations({ subtree: true })) animation.play();
          });
        }
      }
      await page.goto(`${fixture.origin}/page/probes/fixture.html?case=header`);
      await page.waitForFunction(() => typeof window.__fixture?.header === 'function');
      await page.evaluate(() => window.__fixture.header('list', { title: 'Refresh', text: 'Refreshing', state: 'running', progress: 0.4 }));
      const headerBar = page.getByRole('progressbar', { name: 'Refresh' });
      await headerBar.waitFor();
      const geometry = await headerBar.evaluate(node => {
        const bar = node.getBoundingClientRect();
        const slot = node.parentElement.getBoundingClientRect();
        return { height: bar.height, width: bar.width, slotWidth: slot.width };
      });
      assert.equal(geometry.height, 4);
      assert(geometry.width > 0 && geometry.width === geometry.slotWidth);
    } finally { await browser.close(); }
  }
} finally { server.close(); fixture.server.close(); }

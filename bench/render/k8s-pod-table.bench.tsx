/**
 * Kubernetes plugin Pod list (the heaviest resource table), rendered from the
 * pinned plugin submodule source against the app's shared packages, with
 * V2 native pages and metrics answered by fixtures.
 */
import { describe } from 'vitest';
import PodTable from '../../plugins/kubernetes/ui/src/components/kubernetes/table/corev1/Pod/Table';

import { screenBench } from './harness/bench';
import { PluginScreen } from './harness/providers';
import { findScrollable, mount, scrollStep, waitFor, click, findByText, nextFrame, type Mounted } from './harness/dom';
import { makePods, servePods } from './fixtures/kubernetes';
import { BENCH_CONNECTION_ID } from './fixtures/defaults';

const POD_NAME = /^[a-z-]+-[0-9a-f]{10}-[0-9a-f]{5}$/;

function screen() {
  return (
    <PluginScreen pluginId="kubernetes" path="/connection/:id/pods" url={`/connection/${BENCH_CONNECTION_ID}/pods`}>
      <PodTable />
    </PluginScreen>
  );
}

/** Name of the top-most rendered pod row (what a user sees first). */
function topRowName(root: HTMLElement): string | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let best: string | null = null;
  let bestTop = Infinity;
  const scroller = findScrollableCached(root);
  const minTop = scroller ? scroller.getBoundingClientRect().top : -Infinity;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue?.trim() ?? '';
    if (!POD_NAME.test(text)) continue;
    const top = n.parentElement!.getBoundingClientRect().top;
    if (top >= minTop - 1 && top < bestTop) {
      bestTop = top;
      best = text;
    }
  }
  return best;
}

let cachedScroller: HTMLElement | null = null;
function findScrollableCached(root: HTMLElement) {
  if (!cachedScroller || !root.contains(cachedScroller)) cachedScroller = findScrollable(root);
  return cachedScroller;
}

/** Guard against benching a no-op: a scroll step must bring different rows on screen. */
function assertScrollRendersNewRows(m: Mounted) {
  const scroller = findScrollableCached(m.container);
  if (!scroller) throw new Error('no scrollable table body found');
  const before = topRowName(m.container);
  scrollStep(scroller, scroller.clientHeight * 5);
  const after = topRowName(m.container);
  scrollStep(scroller, 0);
  if (!after || after === before) throw new Error(`scrolling did not change the visible rows (${before} -> ${after})`);
}

async function mountLoaded(): Promise<Mounted> {
  localStorage.clear();
  const m = mount(screen());
  await waitFor(() => topRowName(m.container), { label: 'first pod row' });
  return m;
}

for (const count of [1_000, 5_000]) {
  describe(`k8s pod table, native page from ${count}-pod corpus`, () => {
    const pods = makePods(count);
    let m: Mounted | null = null;
    const serve = () => servePods(pods);
    const unmount = () => { m?.unmount(); m = null; cachedScroller = null; };

    screenBench('mount until first row', async () => {
      const mounted = await mountLoaded();
      mounted.unmount();
      cachedScroller = null;
    }, { setup: serve });

    // Stop at the native page boundary; never count clamped assignments as scroll steps.
    screenBench('scroll up to 30 viewport steps within native page', async () => {
      const scroller = findScrollableCached(m!.container)!;
      scrollStep(scroller, 0);
      await nextFrame();
      const viewport = scroller.clientHeight;
      const range = scroller.scrollHeight - viewport;
      if (viewport <= 0 || range <= 0) throw new Error('no positive native-page scroll range');
      const steps = Math.min(30, Math.ceil(range / viewport));
      const expectedEnd = Math.min(steps * viewport, range);
      let previous = scroller.scrollTop;
      for (let i = 1; i <= steps; i++) {
        const expected = Math.min(i * viewport, range);
        scrollStep(scroller, expected);
        const actual = scroller.scrollTop;
        if (actual <= previous || Math.abs(actual - expected) > 1) {
          throw new Error(`scroll step ${i} did not reach ${expected}px (was ${actual}px)`);
        }
        previous = actual;
      }
      const end = scroller.scrollTop;
      scrollStep(scroller, 0);
      if (end <= 0 || Math.abs(end - expectedEnd) > 1 || scroller.scrollTop > 1) {
        throw new Error(`native-page scroll or reset failed (${end}px, reset ${scroller.scrollTop}px)`);
      }
    }, {
      iterations: 6,
      setup: async () => {
        serve(); unmount(); m = await mountLoaded();
        assertScrollRendersNewRows(m);
      },
      teardown: unmount,
    });

    // One click on the Name header (asc -> desc -> unsorted -> asc ...), until the top row changes.
    screenBench('sort by name (click header)', async () => {
      const before = topRowName(m!.container);
      click(findByText(m!.container, 'Name')!);
      await waitFor(() => { const now = topRowName(m!.container); return now && now !== before; }, { label: 'sorted top row' });
    }, {
      setup: async () => { serve(); unmount(); m = await mountLoaded(); },
      teardown: unmount,
    });
  });
}

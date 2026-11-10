/**
 * The viewport-jump driver of the whole-app profile (workload ids `whole-app/v1` and
 * `pods-jump/v1`): up to `pages` viewport-sized scroll steps through the scroller, then a
 * reset to the top, each step waiting for a painted frame.
 *
 * It runs in the page. run.mjs serializes it with `page.evaluate`, and the page bundle
 * exposes the same function as `window.__ovBench.scroll.pages`, so Playwright runs and
 * native-WebView runs execute the same code. It must stay self-contained: no references to
 * module scope, because `Function.prototype.toString` is how it reaches the page.
 *
 * This driver is a settling driver: it assigns `scrollTop`, reads it back and waits. It
 * says nothing about continuous input; the paced wheel driver (wheel-driver.mjs) does.
 *
 * Throws synchronously when no scroller is found. The returned promise rejects for a
 * nonpositive viewport or scroll range, a page count that is not a positive safe integer,
 * or a scroll step or reset that fails verification. A failure may leave the scroll position changed.
 *
 * @returns {Promise<object>} Timing in milliseconds, forward and total step counts (including
 * the reset), and forward displacement in pixels. Timing excludes the initial reset and settling.
 * @param {{ pages: number, kind: 'pods' | 'logs' }} options
 */
export function scrollPages({ pages, kind }) {
  const b = window.__ovBench;
  let target = null;
  if (kind === 'logs') {
    // The log list: the nearest scroll area around the viewer's search box.
    for (let n = document.querySelector('input[placeholder="Search in logs"]'); n && !target; n = n.parentElement) target = b.dom.findScrollable(n);
  } else {
    target = b.dom.findScrollable(document.body);
  }
  if (!target) throw new Error(`no scrollable ${kind} area`);
  const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(r), 0)));
  return (async () => {
    target.scrollTop = 0;
    await settle();
    const viewport = target.clientHeight;
    const range = target.scrollHeight - viewport;
    if (viewport <= 0 || range <= 0 || !Number.isSafeInteger(pages) || pages <= 0) {
      throw new Error(`${kind}: no positive bounded scroll workload`);
    }
    const forwardSteps = Math.min(pages, Math.ceil(range / viewport));
    const expectedEnd = Math.min(forwardSteps * viewport, range);
    const t0 = performance.now();
    let previous = target.scrollTop;
    for (let i = 1; i <= forwardSteps; i++) {
      const expected = Math.min(i * viewport, range);
      target.scrollTop = expected;
      await settle();
      const actual = target.scrollTop;
      if (actual <= previous || Math.abs(actual - expected) > 1) {
        throw new Error(`${kind}: scroll step ${i} did not reach ${expected}px (was ${actual}px)`);
      }
      previous = actual;
    }
    const end = target.scrollTop;
    target.scrollTop = 0;
    await settle();
    const wallMs = performance.now() - t0;
    if (end <= 0 || Math.abs(end - expectedEnd) > 1 || target.scrollTop > 1) {
      throw new Error(`${kind}: bounded scroll or reset failed (${end}px, reset ${target.scrollTop}px)`);
    }
    const steps = forwardSteps + 1;
    return { wallMs, steps, forwardSteps, perStepMs: wallMs / steps, scrolledPx: end };
  })();
}

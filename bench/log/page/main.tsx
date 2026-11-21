// The bench page. One variant per page load, chosen by the runner:
//   variant   kit      the kit's LogView (the built package)
//             control  a scroller of plain divs over the same window maths, in plain DOM (no React on the page)
//   rate      lines a second the source emits while `__bench.startStream()` runs (the runner starts it)
//   height    the stage's height in px (default 596: a list of 504 px of rows, 21 of them, and the 22nd when the offset is not a whole row)
//   overscan  the control's rows beyond the viewport on each side (the kit's is what the built package has, or what OV_BENCH_OVERSCAN patched in)
//   profile   1 wraps the kit in a Profiler that counts its commits (the profiling build only: the cross-check of the DevTools hook's count)
//   sources   how many sources the feed follows (default 0: one, not listed). The feed lists them and its lines take them in turn, so with 2 or more the kit's view draws its Source column (L2) and the control a plain
//             source cell. The ids are what a real stream's are, the thing's name and the part that wrote the line (`orders-7d8c6f49b-f8q4m/app`): 13 characters or more, which the kit draws in two halves, its dearest name.
//   toolbar   1 mounts the host's LogSession (the Logs tool's toolbar beside the kit's view) in the kit variant instead of the bare LogView; the control ignores it
// The page exposes `window.__bench` (harness.ts); nothing runs until the runner calls it.
import { SyntheticFeed } from '../../../packages/kit/src/components/LogView/syntheticFeed';
import { Harness } from './harness';

declare global {
  interface Window {
    /** Commits the Profiler saw (the profiling build, `?profile=1`). */
    __benchProfileCommits?: number;
  }
}

const params = new URLSearchParams(window.location.search);
const variant = params.get('variant') ?? 'kit';
const height = Number(params.get('height') ?? 596);
const sourceCount = Number(params.get('sources') ?? 0);
const SOURCE_IDS = ['orders-7d8c6f49b-f8q4m/app', 'orders-7d8c6f49b-f8q4m/sidecar'];
const sources = Array.from({ length: sourceCount }, (_, index) => SOURCE_IDS[index] ?? `orders-7d8c6f49b-f8q4m/worker-${String(index)}`);

const harness = new Harness();
window.__bench = harness;

async function start() {
  const stage = document.getElementById('stage');
  if (stage === null) {
    throw new Error('no stage');
  }
  stage.style.height = `${height}px`;
  const feed = new SyntheticFeed({ rate: Number(params.get('rate') ?? 0), seed: 1, maxHeld: 1_000_000, ...(sourceCount > 0 ? { sources } : {}) });

  // The variant is chosen at run time (`?variant=`), and a variant's page must not carry the other's code: the control is a floor with no React and no
  // kit stylesheet on it, so a static import of both is not possible (the table bench loads its variants the same way).
  if (variant === 'control') {
    const { mountControl, probe } = await import('./variants/Control');
    // The kit's list gets the stage less its 39 px filter row and its 28 px strip.
    const stop = mountControl(stage, feed, { overscan: Number(params.get('overscan') ?? 10), step: 4, listHeight: height - 67, sourceColumn: sourceCount > 1 });
    harness.attach(probe, feed, stop);
    return;
  }

  const { mountKit } = await import('./variants/mountKit');
  const mounted = mountKit(stage, feed, params.get('profile') === '1' && import.meta.env.BENCH_REACT_BUILD === 'profiling', params.get('toolbar') === '1');
  harness.attach(mounted.probe, feed, mounted.unmount);
}

start().catch((error: unknown) => {
  document.title = 'bench failed';
  harness.fail(String(error instanceof Error ? (error.stack ?? error.message) : error));
});

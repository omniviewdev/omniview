/**
 * Bottom drawer LogViewer fed through the real session path: Wails events on
 * core/logs/lines/<session> -> useLogStream -> useLogBuffer -> virtual list.
 */
import { describe } from 'vitest';
import LogViewerContainer from '@/providers/BottomDrawer/containers/LogViewer';

import { screenBench } from './harness/bench';
import { AppProviders } from './harness/providers';
import { findScrollable, mount, scrollStep, waitFor, type Mounted } from './harness/dom';
import { handle } from './harness/backend';
import { lineMarker, makeLogLines, streamLines } from './fixtures/logs';

let sessionSeq = 0;

function mountViewer(sessionId: string): Mounted {
  return mount(
    <AppProviders>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <LogViewerContainer sessionId={sessionId} />
      </div>
    </AppProviders>,
  );
}

const shows = (m: Mounted, n: number) => m.container.textContent!.includes(lineMarker(n));

describe('log viewer', () => {
  handle('logs/servicewrapper.GetSession', (id: string) => ({ id, labels: {}, sources: [] }));

  const lines10k = makeLogLines('_', 10_000);

  screenBench('mount empty viewer', async () => {
    const m = mountViewer(`bench-empty-${sessionSeq++}`);
    await waitFor(() => m.container.querySelector('input'), { label: 'toolbar' });
    m.unmount();
  });

  // Mount, stream 10k lines as 100 backend batches, until the newest line is on screen (follow mode).
  screenBench('mount + stream 10k lines', async () => {
    const id = `bench-stream-${sessionSeq++}`;
    const m = mountViewer(id);
    streamLines(id, lines10k);
    await waitFor(() => shows(m, 9_999), { label: 'last streamed line' });
    m.unmount();
  });

  // 100k-line buffer (the default cap), follow off: 30 one-page scroll steps down, then back to the top.
  let full: Mounted | null = null;
  screenBench('scroll 100k-line buffer, 30 pages', () => {
    const scroller = findScrollable(full!.container)!;
    const page = scroller.clientHeight;
    for (let i = 1; i <= 30; i++) scrollStep(scroller, i * page);
    scrollStep(scroller, 0);
  }, {
    iterations: 6,
    setup: async () => {
      full?.unmount();
      const id = `bench-100k-${sessionSeq++}`;
      full = mountViewer(id);
      streamLines(id, makeLogLines(id, 100_000), 1_000);
      await waitFor(() => shows(full!, 99_999), { label: '100k lines loaded' });
      const scroller = findScrollable(full.container)!;
      scrollStep(scroller, 0); // leaving the bottom turns follow off
      await waitFor(() => shows(full!, 0), { label: 'scrolled to top' });
      scrollStep(scroller, scroller.clientHeight * 5);
      if (shows(full, 0)) throw new Error('scrolling did not change the visible lines');
      scrollStep(scroller, 0);
    },
    teardown: () => { full?.unmount(); full = null; },
  });
});

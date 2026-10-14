/**
 * Bottom drawer: opening a log session tab (the path a "Logs" action takes)
 * and drag-resizing the drawer while a LogViewer is showing.
 */
import { describe } from 'vitest';
import BottomDrawerContainer from '@/layouts/core/main/BottomDrawer';
import { bottomDrawerChannel } from '@/providers/BottomDrawer/events';

import { screenBench } from './harness/bench';
import { AppProviders } from './harness/providers';
import { forceLayout, mount, nextFrame, waitFor, type Mounted } from './harness/dom';
import { handle } from './harness/backend';
import { lineMarker, makeLogLines, streamLines } from './fixtures/logs';
import { BENCH_CONNECTION_ID } from './fixtures/defaults';

let sessionSeq = 0;
let lastSessionId = '';

handle('logs/servicewrapper.CreateSession', () => {
  lastSessionId = `bench-drawer-${sessionSeq++}`;
  return { id: lastSessionId, labels: {}, sources: [] };
});
handle('logs/servicewrapper.GetSession', (id: string) => ({ id, labels: {}, sources: [] }));
// No terminal sessions survive from a previous run.
handle('exec/servicewrapper.ListSessions', () => []);

const lines1k = makeLogLines('_', 1_000);

async function mountDrawer(): Promise<Mounted> {
  localStorage.clear();
  // Until the terminal session restore settles and the drawer has rendered it,
  // the drawer treats arriving tabs as restored and keeps them at the saved
  // (minimized) height, so a logs tab opened earlier would never show its
  // lines. Wait for it like a user would.
  let restored = false;
  const unsubscribe = bottomDrawerChannel.on('onSessionsRestored', () => { restored = true; });
  const m = mount(
    <AppProviders>
      <div style={{ flex: 1 }} />
      <BottomDrawerContainer />
    </AppProviders>,
  );
  try {
    await waitFor(() => restored, { label: 'terminal sessions restored' });
  } finally {
    unsubscribe();
  }
  // Let the drawer commit the restored state before anything adds a tab.
  await nextFrame();
  return m;
}

/** Ask for a logs tab the way resource actions do, stream 1k lines, wait until the newest is visible. */
async function openLogsTab(m: Mounted): Promise<void> {
  const before = lastSessionId;
  bottomDrawerChannel.emit('onCreateLogSession', {
    plugin: 'kubernetes',
    connection: BENCH_CONNECTION_ID,
    resourceKey: 'core::v1::Pod',
    resourceID: 'api-7d9c8b0f5-x0',
    resourceData: {},
    label: 'Logs api',
  });
  const id = await waitFor(() => lastSessionId !== before && lastSessionId, { label: 'log session created' });
  // The viewer subscribes when it mounts; stream once it is listening.
  await waitFor(() => m.container.querySelector('input'), { label: 'log viewer mounted' });
  streamLines(id, lines1k);
  await waitFor(() => m.container.textContent!.includes(lineMarker(999)), { label: 'last log line' });
}

function dragHandle(root: HTMLElement): HTMLElement {
  const byId = root.querySelector<HTMLElement>('[data-testid="bottom-drawer-drag-handle"]');
  if (byId) return byId;
  for (const node of root.querySelectorAll<HTMLElement>('*')) {
    const cursor = getComputedStyle(node).cursor;
    if (cursor === 'row-resize' || cursor === 'ns-resize' || cursor === 'n-resize') return node;
  }
  throw new Error('drawer drag handle not found');
}

describe('bottom drawer', () => {
  screenBench('mount drawer + open logs tab (1k lines)', async () => {
    const m = await mountDrawer();
    await openLogsTab(m);
    m.unmount();
  });

  // Drag the handle from 300px to 700px tall and back, one mousemove per frame
  // like a real drag (41 frames, so ~683ms at 60Hz is the floor; anything above
  // it is frames the drawer + LogViewer overran).
  let m: Mounted | null = null;
  screenBench('drag-resize with logs open (41 frames)', async () => {
    const handleEl = dragHandle(m!.container);
    const opts = { bubbles: true, cancelable: true, button: 0 };
    const at = (h: number) => ({ ...opts, clientX: 400, clientY: window.innerHeight - h });
    handleEl.dispatchEvent(new MouseEvent('mousedown', at(300)));
    await Promise.resolve(); // let React attach the document listeners
    for (let i = 0; i <= 40; i++) {
      const h = i <= 20 ? 300 + i * 20 : 700 - (i - 20) * 20;
      document.dispatchEvent(new MouseEvent('mousemove', at(h)));
      await nextFrame();
    }
    document.dispatchEvent(new MouseEvent('mouseup', at(300)));
    forceLayout();
  }, {
    setup: async () => {
      m?.unmount();
      m = await mountDrawer();
      await openLogsTab(m);
      // Guard against benching a no-op: a drag must change the drawer height.
      const handleEl = dragHandle(m.container);
      const drawer = () => {
        let n: HTMLElement | null = handleEl.parentElement;
        while (n && !n.style.height) n = n.parentElement;
        return (n ?? handleEl.parentElement!).getBoundingClientRect().height;
      };
      const before = drawer();
      handleEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: window.innerHeight - 300 }));
      await Promise.resolve();
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: window.innerHeight - 500 }));
      const during = drawer();
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY: window.innerHeight - 500 }));
      await nextFrame();
      if (Math.abs(during - before) < 50) throw new Error(`drag did not resize the drawer (${before} -> ${during})`);
    },
    teardown: () => { m?.unmount(); m = null; },
  });
});

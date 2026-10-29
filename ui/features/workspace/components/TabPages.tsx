import { Activity, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { RouterProvider } from 'react-router/dom';
import { reportStartupReady } from '@/features/perf/startup';
import { usePagesState, useWorkspaceController } from '../WorkspaceProvider';

function TabPage({ tabId, initialPath, active }: { tabId: string; initialPath: string; active: boolean }) {
  const controller = useWorkspaceController();
  const { routers } = controller;
  const router = useSyncExternalStore(routers.subscribe, () => routers.get(tabId), () => routers.get(tabId));

  useLayoutEffect(() => {
    routers.ensure(tabId, initialPath);
  }, [routers, tabId, initialPath]);

  // The shell counts as interactive once the first tab router has rendered.
  useEffect(() => {
    if (router) {
      reportStartupReady();
    }
  }, [router]);

  return (
    <Activity mode={active ? 'visible' : 'hidden'}>
      {router && <RouterProvider router={router} />}
    </Activity>
  );
}

/**
 * Renders the page of every tab that has been shown at least once, each into
 * its own host element. Panes place those elements, so moving a tab between
 * panes or splitting the view keeps the page mounted; inactive tabs stay in a
 * hidden `<Activity>` with their state intact.
 */
export function TabPages() {
  const controller = useWorkspaceController();
  const state = usePagesState();
  const activeTabIds = state.panes.flatMap((pane) => pane.activeTabId ? [pane.activeTabId] : []);
  const [shownTabIds, setShownTabIds] = useState<ReadonlySet<string>>(() => new Set(activeTabIds));
  if (activeTabIds.some((id) => !shownTabIds.has(id))) {
    setShownTabIds(new Set([...shownTabIds, ...activeTabIds]));
  }

  return Object.values(state.tabs)
    .filter((tab) => shownTabIds.has(tab.id))
    .map((tab) => createPortal(
      <TabPage tabId={tab.id} initialPath={tab.path} active={activeTabIds.includes(tab.id)} />,
      controller.tabHost(tab.id),
      tab.id,
    ));
}

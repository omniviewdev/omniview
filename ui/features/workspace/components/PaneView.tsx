import { useLayoutEffect, useRef } from 'react';
import type { PagePane } from '../pagesState';
import { usePagesState, useWorkspaceController } from '../WorkspaceProvider';
import { PageTabStrip } from './PageTabStrip';
import { SplitDropZone } from './SplitDropZone';
import styles from './Workspace.module.css';

/** One pane: its tab strip above the pages of its tabs. */
export function PaneView({ pane }: { pane: PagePane }) {
  const controller = useWorkspaceController();
  const state = usePagesState();
  const contentRef = useRef<HTMLDivElement>(null);
  const hostsRef = useRef<HTMLDivElement>(null);
  const isSplit = state.panes.length > 1;

  // Pull this pane's tab hosts in (they may come from the other pane) and show the active one.
  useLayoutEffect(() => {
    const container = hostsRef.current;
    if (!container) {
      return;
    }

    for (const tabId of pane.tabIds) {
      const host = controller.tabHost(tabId);
      host.className = styles.TabHost;
      host.toggleAttribute('data-active', tabId === pane.activeTabId);
      if (host.parentElement !== container) {
        container.appendChild(host);
      }
    }
  }, [controller, pane]);

  return (
    <div
      className={styles.Pane}
      data-ov-pane-id={pane.id}
      data-inactive={isSplit && state.activePaneId !== pane.id ? '' : undefined}
      onPointerDownCapture={() => {
        controller.dispatch({ type: 'activatePane', paneId: pane.id });
      }}
    >
      <PageTabStrip pane={pane} />
      <div ref={contentRef} className={styles.PaneContent}>
        <div ref={hostsRef} className={styles.TabHosts} />
        {!isSplit && <SplitDropZone paneId={pane.id} contentRef={contentRef} />}
      </div>
    </div>
  );
}

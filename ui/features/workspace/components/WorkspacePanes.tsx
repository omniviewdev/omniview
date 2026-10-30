import { useEffect, useRef, useState } from 'react';
import { ResizableSplitPane } from '@omniviewdev/base-ui';
import type { PagePane } from '../pagesState';
import { usePagesState, useWorkspaceController } from '../WorkspaceProvider';
import { PaneView } from './PaneView';
import { TabPages } from './TabPages';
import styles from './Workspace.module.css';

const MIN_PANE_WIDTH = 240;
/** Persist the ratio once the handle rests, not on every pointer move. */
const RATIO_COMMIT_DELAY_MS = 200;

function SplitPanes({ panes, splitRatio }: { panes: PagePane[]; splitRatio: number }) {
  const controller = useWorkspaceController();
  const containerRef = useRef<HTMLDivElement>(null);
  const commitTimer = useRef<number | undefined>(undefined);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      clearTimeout(commitTimer.current);
    };
  }, []);

  return (
    <div ref={containerRef} className={styles.Split}>
      {width !== null && (
        <ResizableSplitPane
          direction='horizontal'
          defaultSize={Math.round(splitRatio * width)}
          minSize={MIN_PANE_WIDTH}
          maxSize={Math.max(MIN_PANE_WIDTH, width - MIN_PANE_WIDTH)}
          handleLabel='Resize split view'
          onResize={(size) => {
            clearTimeout(commitTimer.current);
            commitTimer.current = window.setTimeout(() => {
              controller.dispatch({ type: 'setSplitRatio', ratio: size / width });
            }, RATIO_COMMIT_DELAY_MS);
          }}
        >
          {[<PaneView key={panes[0].id} pane={panes[0]} />, <PaneView key={panes[1].id} pane={panes[1]} />]}
        </ResizableSplitPane>
      )}
    </div>
  );
}

/** The page area of a workspace window: one pane, or two side by side. */
export function WorkspacePanes() {
  const state = usePagesState();

  return (
    <div className={styles.Panes}>
      {state.panes.length > 1
        ? <SplitPanes panes={state.panes} splitRatio={state.splitRatio} />
        : <PaneView key={state.panes[0].id} pane={state.panes[0]} />}
      <TabPages />
    </div>
  );
}

import { useEffect, type RefObject } from 'react';
import { useTabDragBroker } from '@omniviewdev/base-ui';
import { PAGE_TAB_DRAG_TYPE } from '@/features/windows';
import { useWorkspaceController } from '../WorkspaceProvider';
import { splitZoneInstanceId } from '../workspaceController';
import styles from './Workspace.module.css';

/**
 * Right half of the only pane's content: dropping a page tab there (from this
 * or another window) opens it in a second pane.
 */
export function SplitDropZone({ paneId, contentRef }: { paneId: string; contentRef: RefObject<HTMLDivElement | null> }) {
  const controller = useWorkspaceController();
  const broker = useTabDragBroker();
  const registerDropZone = broker?.registerDropZone;
  const unregisterDropZone = broker?.unregisterDropZone;
  const zoneId = splitZoneInstanceId(paneId);

  useEffect(() => {
    if (!registerDropZone || !unregisterDropZone) {
      return undefined;
    }

    registerDropZone({
      instanceId: zoneId,
      dragType: PAGE_TAB_DRAG_TYPE,
      expandY: 0,
      getRect: () => {
        const rect = contentRef.current?.getBoundingClientRect();
        return rect ? new DOMRect(rect.left + rect.width / 2, rect.top, rect.width / 2, rect.height) : null;
      },
      getElement: () => contentRef.current,
      onAttach: (commit) => {
        controller.attachToSplit(commit);
      },
    });
    return () => {
      unregisterDropZone(zoneId);
    };
  }, [registerDropZone, unregisterDropZone, zoneId, contentRef, controller]);

  return broker?.hoverInstanceId === zoneId ? <div className={styles.SplitOverlay} data-ov-split-zone='' /> : null;
}

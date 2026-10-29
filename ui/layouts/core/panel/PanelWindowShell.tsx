import React from 'react';
import { useBottomDrawer } from '@omniviewdev/runtime';
import { WindowClient } from '@omniviewdev/runtime/api';
import { currentWindow } from '@/features/windows';
import { useWindow } from '@/hooks/useWindow';
import BottomDrawerTabs from '@/providers/BottomDrawer/tabs';
import DrawerTabPanels from '@/providers/BottomDrawer/DrawerTabPanels';
import type { DrawerSlot } from '@/providers/BottomDrawer/drawerSlot';
import { useBottomDrawerWindow } from '@/providers/BottomDrawer/windowContext';
import { toggleMaximiseOnDoubleClick } from '@/layouts/core/main/Header/toggleMaximise';
import styles from './PanelWindowShell.module.css';

/**
 * Saves the empty drawer before closing, so the main window does not adopt
 * tabs that already moved to another window from a stale saved state.
 */
async function closeEmptyPanelWindow(): Promise<void> {
  const emptyDrawer: DrawerSlot = { version: 1, tabs: [], focusedId: null };
  await WindowClient.SaveState(currentWindow.name, 'drawer', JSON.stringify(emptyDrawer));
  await WindowClient.Close(currentWindow.name);
}

const maximiseOnTitleBarDoubleClick: React.MouseEventHandler = (event) => {
  if (event.target instanceof Element && event.target.closest('[role="tab"], button')) {
    return;
  }

  toggleMaximiseOnDoubleClick(event);
};

/**
 * A window that only holds drawer tabs (terminals, logs, ...): the drawer strip
 * and the focused tab's content, no header, rail or page tabs. It closes once
 * its last tab is gone.
 */
export const PanelWindowShell: React.FC = () => {
  const { tabs } = useBottomDrawer();
  const { restoreComplete } = useBottomDrawerWindow();
  const { platform, isFullscreen } = useWindow();
  const closingRef = React.useRef(false);

  React.useEffect(() => {
    if (!restoreComplete || tabs.length > 0 || closingRef.current) {
      return;
    }

    closingRef.current = true;
    closeEmptyPanelWindow().catch((err: unknown) => {
      closingRef.current = false;
      console.error(`[panel] failed to close empty window "${currentWindow.name}"`, err);
    });
  }, [restoreComplete, tabs.length]);

  const titleBarStyle: React.CSSProperties & Record<`--${string}`, string> = {
    '--PanelWindow-controls-inset': platform === 'macos' && !isFullscreen ? '68px' : '0px',
  };

  return (
    <div
      className={styles.Shell}
      data-ov-window-name={currentWindow.name}
      data-ov-window-kind={currentWindow.kind}
    >
      <div className={styles.TitleBar} style={titleBarStyle} onClick={maximiseOnTitleBarDoubleClick}>
        <BottomDrawerTabs />
      </div>
      <DrawerTabPanels />
    </div>
  );
};

export default PanelWindowShell;

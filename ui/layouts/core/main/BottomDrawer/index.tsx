import React from 'react';

import { Separator } from '@omniviewdev/base-ui';

// project imports
import BottomDrawerTabs from '@/providers/BottomDrawer/tabs';
import DrawerTabPanels from '@/providers/BottomDrawer/DrawerTabPanels';
import { useBottomDrawer } from '@omniviewdev/runtime';
import { bottomDrawerChannel, setBottomDrawerHeight } from '@/providers/BottomDrawer/events';
import { DEFAULT_DRAWER_EXPANDED_HEIGHT, useBottomDrawerWindow } from '@/providers/BottomDrawer/windowContext';
import type { DrawerMode } from '@/providers/BottomDrawer/drawerSlot';
import { Events } from '@omniviewdev/runtime/runtime';
import handleStyles from '@/components/base/ResizeHandle.module.css';
import styles from './BottomDrawer.module.css';

/**
 * Sticky resizable drawer at the bottom of the screen used to display
 * interactive context items, such as terminals and reports.
 */
const BottomDrawerContainer: React.FC = () => {
  const minHeight = 32;
  const defaultHeight = DEFAULT_DRAWER_EXPANDED_HEIGHT;

  const { tabs } = useBottomDrawer();
  const { restoreComplete, quietTabIds, layout, saveLayout } = useBottomDrawerWindow();
  const hasTabs = tabs.length > 0;

  const [height, setDrawerHeight] = React.useState<number>(minHeight);
  const lastExpandedHeightRef = React.useRef<number>(Math.max(layout.expandedHeight, minHeight));

  // State for drag operation
  const [isDragging, setIsDragging] = React.useState(false);

  // Ref for the sidebar to calculate changes in width
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const dragHandleRef = React.useRef<HTMLDivElement>(null);
  const startupModeRef = React.useRef<DrawerMode>(layout.mode);
  const startupResolvedRef = React.useRef(false);
  const previousTabIdsRef = React.useRef<ReadonlySet<string>>(new Set());
  const mountedRef = React.useRef(false);

  // Other panels (the right drawer) size themselves against the drawer height.
  // They set it as a CSS variable on themselves: on <html> every change would
  // restyle the whole document, which made each toggle ~20 ms slower.
  React.useEffect(() => {
    setBottomDrawerHeight(height);
  }, [height]);

  // The mode and expanded height are part of this window's saved drawer state.
  const persistDrawerState = React.useCallback((mode: DrawerMode, expandedHeight?: number) => {
    startupModeRef.current = mode;
    saveLayout(mode, mode === 'expanded' ? expandedHeight ?? lastExpandedHeightRef.current : undefined);
  }, [saveLayout]);

  // common methods
  const expandDrawerToHeight = React.useCallback((height: number) => {
    if (!drawerRef.current) {
      return;
    }

    height = Math.min(Math.max(height, minHeight), window.innerHeight);

    // Track the last non-minimized, non-fullscreen height for restore
    if (height > minHeight && height < window.innerHeight) {
      lastExpandedHeightRef.current = height;
    }

    drawerRef.current.style.height = `${height}px`;
    drawerRef.current.style.minHeight = `${minHeight}px`;
    drawerRef.current.style.maxHeight = `${height}px`;
    setDrawerHeight(height);
  }, []);

  // minimize (collapse to toolbar-only)
  const minimize = React.useCallback(() => {
    // Save the current height before collapsing so we can restore it
    if (height > minHeight && height < window.innerHeight) {
      lastExpandedHeightRef.current = height;
    }

    expandDrawerToHeight(minHeight);
    persistDrawerState('minimized');
    bottomDrawerChannel.emit('onResizeReset');
  }, [height, expandDrawerToHeight, persistDrawerState]);

  // expand to last known expanded height (or default)
  const expand = React.useCallback(() => {
    if (!hasTabs) {
      return;
    }

    expandDrawerToHeight(lastExpandedHeightRef.current);
    persistDrawerState('expanded', lastExpandedHeightRef.current);
    bottomDrawerChannel.emit('onResizeReset');
  }, [hasTabs, expandDrawerToHeight, persistDrawerState]);

  // fullscreen toggle
  const fullscreen = React.useCallback(() => {
    if (!hasTabs) {
      return;
    }

    if (height >= window.innerHeight) {
      // Already fullscreen — restore to last expanded height
      expandDrawerToHeight(lastExpandedHeightRef.current);
    } else {
      // Save current height before going fullscreen
      if (height > minHeight) {
        lastExpandedHeightRef.current = height;
      }

      expandDrawerToHeight(window.innerHeight);
    }

    persistDrawerState('expanded', lastExpandedHeightRef.current);
    bottomDrawerChannel.emit('onResizeReset');
  }, [hasTabs, height, expandDrawerToHeight, persistDrawerState]);


  // ========================== EVENT BUS HANDLING ========================== //

  React.useEffect(() => {
    const unsubscribeOnResizeDrawer = bottomDrawerChannel.on('onResize', (height) => {
      if (!hasTabs) {
        return;
      }

      expandDrawerToHeight(height);
    });

    // Menu events reach every window; only the focused one acts on them.
    const closerFullScreen = Events.On('menu/view/bottomdrawer/fullscreen', () => {
      if (document.hasFocus()) {
        fullscreen();
      }
    });
    const unsubscribeOnFullScreen = bottomDrawerChannel.on('onFullscreen', () => {
      fullscreen();
    });

    const closerMinimize = Events.On('menu/view/bottomdrawer/minimize', () => {
      if (document.hasFocus()) {
        minimize();
      }
    });
    const unsubscribeOnMinimize = bottomDrawerChannel.on('onMinimize', () => {
      minimize();
    });

    return () => {
      unsubscribeOnResizeDrawer();
      unsubscribeOnFullScreen();
      unsubscribeOnMinimize();

      closerFullScreen();
      closerMinimize();
    };
  }, [hasTabs, expandDrawerToHeight, fullscreen, minimize]);

  React.useEffect(() => {
    if (!drawerRef.current) {
      return;
    }

    // Tabs already present on the first run were not opened just now.
    const atMount = !mountedRef.current;
    mountedRef.current = true;
    const previousTabIds = previousTabIdsRef.current;
    previousTabIdsRef.current = new Set(tabs.map((tab) => tab.id));
    const currentHeight = parseInt(drawerRef.current.style.height, 10);

    if (!startupResolvedRef.current) {
      // No tabs yet and the restore may still bring some back: stay minimized
      // and resolve the startup state once tabs arrive or the restore is done.
      if (tabs.length === 0 && !restoreComplete) {
        expandDrawerToHeight(minHeight);
        return;
      }

      startupResolvedRef.current = true;
      const userOpenedTab = tabs.some((tab) => !quietTabIds.has(tab.id));

      if (tabs.length === 0) {
        expandDrawerToHeight(minHeight);
      } else if (startupModeRef.current === 'expanded') {
        expandDrawerToHeight(lastExpandedHeightRef.current);
      } else if (userOpenedTab && !atMount) {
        // A tab the user opened before the restore finished: expand as for any new tab.
        expandDrawerToHeight(defaultHeight);
      } else {
        expandDrawerToHeight(minHeight);
      }

      return;
    }

    if (tabs.length === 0) {
      expandDrawerToHeight(minHeight);
      return;
    }

    // Auto-expand only for a tab that was opened (or moved here) after startup;
    // a retry swapping a tab's id or a quiet adoption does not count.
    const openedTab = tabs.length > previousTabIds.size
      && tabs.some((tab) => !previousTabIds.has(tab.id) && !quietTabIds.has(tab.id));
    if (openedTab && (isNaN(currentHeight) || currentHeight < defaultHeight)) {
      expandDrawerToHeight(defaultHeight);
    }
  }, [tabs, quietTabIds, restoreComplete, expandDrawerToHeight, defaultHeight]);

  const handleClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawerRef.current || !hasTabs) {
      return;
    }

    // if double click, reset height
    if (e.detail === 2) {
      if (drawerRef.current.style.height === `${minHeight}px`) {
        drawerRef.current.style.height = `${defaultHeight}px`;
        drawerRef.current.style.minHeight = `${minHeight}px`;
        drawerRef.current.style.maxHeight = `${defaultHeight}px`;
        setDrawerHeight(defaultHeight);
        persistDrawerState('expanded', defaultHeight);
        bottomDrawerChannel.emit('onResizeReset');
        return;
      }

      drawerRef.current.style.height = `${minHeight}px`;
      drawerRef.current.style.minHeight = `${minHeight}px`;
      drawerRef.current.style.maxHeight = `${minHeight}px`;

      setDrawerHeight(minHeight);
      persistDrawerState('minimized');
      bottomDrawerChannel.emit('onResizeReset');
    }
  }, [hasTabs, persistDrawerState, defaultHeight]);

  const handleMouseDown = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!hasTabs) {
      return;
    }

    setIsDragging(true);
    e.preventDefault(); // Prevent text selection during drag
  }, [hasTabs]);

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (!isDragging || !drawerRef.current || !hasTabs) {
      return;
    }

    // Calculate the remaining viewport width to the right of the mouse cursor in pixels
    const remainingHeightPx = window.innerHeight - e.clientY;
    const newHeight = Math.max(remainingHeightPx, minHeight);

    // Directly update the drawer's height bypassing React's state
    drawerRef.current.style.height = `${newHeight}px`;
    drawerRef.current.style.minHeight = `${minHeight}px`;
    drawerRef.current.style.maxHeight = `${newHeight}px`;
    bottomDrawerChannel.emit('onResizeHandler', newHeight);
  }, [hasTabs, isDragging, minHeight]);

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false);
    if (!hasTabs) {
      return;
    }

    // Optionally sync your React state here if needed for other purposes
    if (drawerRef.current) {
      const currentHeight = drawerRef.current.style.height;
      const newHeight = Math.max(parseInt(currentHeight, 10), minHeight);

      // if we're pretty close to the bottom where it doesn't make sense
      // to keep the drawer open, close it
      if (newHeight < 100) {
        setDrawerHeight(minHeight);
        persistDrawerState('minimized');
        bottomDrawerChannel.emit('onResizeReset');
        drawerRef.current.style.height = `${minHeight}px`;
        drawerRef.current.style.minHeight = `${minHeight}px`;
        drawerRef.current.style.maxHeight = `${minHeight}px`;
        return;
      }

      setDrawerHeight(newHeight);
      persistDrawerState('expanded', newHeight);

    }
  }, [hasTabs, persistDrawerState]);

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      className={`BottomDrawer ${styles.Drawer}`}
      ref={drawerRef}
      style={{ height: minHeight, minHeight, maxHeight: minHeight }}
      // Restored tabs are reconciled with live sessions; tests and benchmarks wait for it.
      data-ov-drawer-restored={restoreComplete || undefined}
    >
      <div
        ref={dragHandleRef}
        data-testid="bottom-drawer-drag-handle"
        className={handleStyles.Top}
        data-dragging={(hasTabs && isDragging) || undefined}
        data-disabled={!hasTabs || undefined}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      />
      <div className={`BottomDrawerContainer ${styles.Container}`}>
        <Separator />
        <BottomDrawerTabs
          resizeControls={{
            isMinimized: height === minHeight,
            isFullscreen: height >= window.innerHeight,
            onMinimize: minimize,
            onExpand: expand,
            onFullscreen: fullscreen,
          }}
        />
        <DrawerTabPanels />
      </div>
    </div>
  );
};

BottomDrawerContainer.displayName = 'BottomDrawerContainer';
export default BottomDrawerContainer;

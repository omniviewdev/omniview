import React from 'react';

import { Separator } from '@omniviewdev/base-ui';

// project imports
import BottomDrawerTabs from '@/providers/BottomDrawer/tabs';
import TerminalContainer from '@/providers/BottomDrawer/containers/Terminal';
import LogViewerContainer from '@/providers/BottomDrawer/containers/LogViewer';
import DevBuildViewer from '@/providers/BottomDrawer/containers/DevBuildViewer';
import PluginLogViewer from '@/providers/BottomDrawer/containers/PluginLogViewer';
import EditorDebugPanel from '@/providers/BottomDrawer/containers/EditorDebugPanel';
import { useBottomDrawer } from '@omniviewdev/runtime';
import { bottomDrawerChannel, restoredSessionIds } from '@/providers/BottomDrawer/events';
import { Events } from '@omniviewdev/runtime/runtime';
import handleStyles from '@/components/base/ResizeHandle.module.css';
import styles from './BottomDrawer.module.css';

const TerminalContainerMemo = React.memo(TerminalContainer, (prev, next) => {
  return prev.sessionId === next.sessionId
    && prev.tab?.properties?.status === next.tab?.properties?.status;
});

const LogViewerContainerMemo = React.memo(LogViewerContainer, (prev, next) => {
  return prev.sessionId === next.sessionId;
});

type DrawerStartupMode = 'minimized' | 'expanded';

const drawerModeStorageKey = 'omniview.bottomDrawer.mode';
// Upper bound on waiting for the terminal session restore (see onSessionsRestored).
const sessionRestoreTimeoutMs = 3000;
const drawerExpandedHeightStorageKey = 'omniview.bottomDrawer.expandedHeight';

/**
 * Sticky resizable drawer at the bottom of the screen used to display
 * interactive context items, such as terminals and reports.
 */
const BottomDrawerContainer: React.FC = () => {
  const minHeight = 32;
  const defaultHeight = 550;

  const { tabs, focused } = useBottomDrawer();
  const hasTabs = tabs.length > 0;

  const [height, setDrawerHeight] = React.useState<number>(minHeight);
  const lastExpandedHeightRef = React.useRef<number>(defaultHeight);

  // State for drag operation
  const [isDragging, setIsDragging] = React.useState(false);

  // Ref for the sidebar to calculate changes in width
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const dragHandleRef = React.useRef<HTMLDivElement>(null);
  const startupModeRef = React.useRef<DrawerStartupMode>('minimized');
  const startupResolvedRef = React.useRef(false);
  const prevTabCountRef = React.useRef(0);
  const mountedRef = React.useRef(false);
  // Terminal sessions that survived a reload are restored as tabs after mount
  // (BottomDrawerTabs lists them asynchronously). Until that has finished, a tab
  // appearing is a restored one, not a new one, and must not auto-expand.
  const [sessionsRestored, setSessionsRestored] = React.useState(false);

  React.useEffect(() => {
    const unsubscribe = bottomDrawerChannel.on('onSessionsRestored', () => {
      setSessionsRestored(true);
    });
    const timer = window.setTimeout(() => {
      setSessionsRestored(true);
    }, sessionRestoreTimeoutMs);

    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  // Other panels (the right drawer) size themselves against the drawer height.
  React.useEffect(() => {
    document.documentElement.style.setProperty('--BottomDrawer-height', `${height}px`);
  }, [height]);

  const persistDrawerState = React.useCallback((mode: DrawerStartupMode, expandedHeight?: number) => {
    startupModeRef.current = mode;
    try {
      localStorage.setItem(drawerModeStorageKey, mode);

      if (mode === 'expanded') {
        const height = expandedHeight ?? lastExpandedHeightRef.current;
        localStorage.setItem(drawerExpandedHeightStorageKey, String(height));
      }
    } catch {
      // storage is best-effort only
    }
  }, []);

  React.useEffect(() => {
    try {
      const savedMode = localStorage.getItem(drawerModeStorageKey);
      if (savedMode === 'expanded' || savedMode === 'minimized') {
        startupModeRef.current = savedMode;
      }

      const savedHeightRaw = localStorage.getItem(drawerExpandedHeightStorageKey);
      if (savedHeightRaw !== null) {
        const savedHeight = Number.parseInt(savedHeightRaw, 10);
        if (!Number.isNaN(savedHeight)) {
          lastExpandedHeightRef.current = Math.max(savedHeight, minHeight);
        }
      }
    } catch {
      // storage read failures should not block UI rendering
    }
  }, []);

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
    expandDrawerToHeight(minHeight)
    persistDrawerState('minimized');
    bottomDrawerChannel.emit('onResizeReset')
  }, [height, expandDrawerToHeight, persistDrawerState]);

  // expand to last known expanded height (or default)
  const expand = React.useCallback(() => {
    if (!hasTabs) {
      return;
    }
    expandDrawerToHeight(lastExpandedHeightRef.current)
    persistDrawerState('expanded', lastExpandedHeightRef.current);
    bottomDrawerChannel.emit('onResizeReset')
  }, [hasTabs, expandDrawerToHeight, persistDrawerState])

  // fullscreen toggle
  const fullscreen = React.useCallback(() => {
    if (!hasTabs) {
      return;
    }
    if (height >= window.innerHeight) {
      // Already fullscreen — restore to last expanded height
      expandDrawerToHeight(lastExpandedHeightRef.current)
    } else {
      // Save current height before going fullscreen
      if (height > minHeight) {
        lastExpandedHeightRef.current = height;
      }
      expandDrawerToHeight(window.innerHeight)
    }
    persistDrawerState('expanded', lastExpandedHeightRef.current);
    bottomDrawerChannel.emit('onResizeReset')
  }, [hasTabs, height, expandDrawerToHeight, persistDrawerState])


  // ========================== EVENT BUS HANDLING ========================== //

  React.useEffect(() => {
    const unsubscribeOnResizeDrawer = bottomDrawerChannel.on('onResize', (height) => {
      if (!hasTabs) {
        return;
      }
      expandDrawerToHeight(height);
    });

    const closerFullScreen = Events.On("menu/view/bottomdrawer/fullscreen", () => {
      fullscreen();
    })
    const unsubscribeOnFullScreen = bottomDrawerChannel.on('onFullscreen', () => {
      fullscreen();
    });

    const closerMinimize = Events.On("menu/view/bottomdrawer/minimize", () => {
      minimize();
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
    const nextTabCount = tabs.length;
    const prevTabCount = prevTabCountRef.current;
    const currentHeight = parseInt(drawerRef.current.style.height, 10);

    if (!startupResolvedRef.current) {
      // No tabs yet and the restore may still bring some back: stay minimized
      // and resolve the startup state once tabs arrive or the restore is done.
      if (nextTabCount === 0 && !sessionsRestored) {
        expandDrawerToHeight(minHeight);
        return;
      }

      startupResolvedRef.current = true;
      const userOpenedTab = tabs.some((tab) => !restoredSessionIds.has(tab.id));

      if (nextTabCount === 0) {
        expandDrawerToHeight(minHeight);
      } else if (startupModeRef.current === 'expanded') {
        expandDrawerToHeight(lastExpandedHeightRef.current);
      } else if (userOpenedTab && !atMount) {
        // A tab the user opened before the restore finished: expand as for any new tab.
        expandDrawerToHeight(defaultHeight);
      } else {
        expandDrawerToHeight(minHeight);
      }

      prevTabCountRef.current = nextTabCount;
      return;
    }

    if (nextTabCount === 0) {
      expandDrawerToHeight(minHeight);
      prevTabCountRef.current = 0;
      return;
    }

    // Auto-expand only when a new tab is added after startup resolution.
    if (nextTabCount > prevTabCount && (isNaN(currentHeight) || currentHeight < defaultHeight)) {
      expandDrawerToHeight(defaultHeight);
    }

    prevTabCountRef.current = nextTabCount;
  }, [tabs, sessionsRestored, expandDrawerToHeight]);

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
        bottomDrawerChannel.emit('onResizeReset')
        return;
      }

      drawerRef.current.style.height = `${minHeight}px`;
      drawerRef.current.style.minHeight = `${minHeight}px`;
      drawerRef.current.style.maxHeight = `${minHeight}px`;

      setDrawerHeight(minHeight);
      persistDrawerState('minimized');
      bottomDrawerChannel.emit('onResizeReset')
    }
  }, [hasTabs, persistDrawerState]);

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
        bottomDrawerChannel.emit('onResizeReset')
        drawerRef.current.style.height = `${minHeight}px`;
        drawerRef.current.style.minHeight = `${minHeight}px`;
        drawerRef.current.style.maxHeight = `${minHeight}px`;
        return;
      }
      setDrawerHeight(newHeight)
      persistDrawerState('expanded', newHeight);

    }
  }, [hasTabs, persistDrawerState]);

  React.useEffect(() => {
    // const handleMouseUpGlobal = () => {
    //   setIsDragging(false);
    // };

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
          hasTabs={hasTabs}
          isMinimized={height === minHeight}
          isFullscreen={height >= window.innerHeight}
          onMinimize={minimize}
          onExpand={expand}
          onFullscreen={fullscreen}
        />
        <div className={styles.Panels}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={styles.Panel}
              // visibility (not display:none) keeps xterm measured and fitted,
              // which avoids a flash of doubled lines when switching tabs.
              data-active={tabs[focused]?.id === tab.id || undefined}
            >
              {tab.variant === 'editor-debug' ? (
                <EditorDebugPanel />
              ) : tab.variant === 'devbuild' ? (
                <DevBuildViewer pluginId={tab.id.replace(/^devbuild-/, '')} />
              ) : tab.variant === 'plugin-logs' ? (
                <PluginLogViewer pluginId={tab.id.replace(/^pluginlogs-/, '')} />
              ) : tab.variant === 'logs' ? (
                <LogViewerContainerMemo sessionId={tab.id} />
              ) : (
                <TerminalContainerMemo sessionId={tab.id} tab={tab} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

BottomDrawerContainer.displayName = 'BottomDrawerContainer';
export default BottomDrawerContainer;

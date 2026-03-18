import React from 'react';

// material-ui
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import GlobalStyles from '@mui/material/GlobalStyles';
import { useTheme } from '@mui/material/styles';

// project imports
import BottomDrawerTabs from '@/providers/BottomDrawer/tabs';
import TerminalContainer from '@/providers/BottomDrawer/containers/Terminal';
import LogViewerContainer from '@/providers/BottomDrawer/containers/LogViewer';
import DevBuildViewer from '@/providers/BottomDrawer/containers/DevBuildViewer';
import PluginLogViewer from '@/providers/BottomDrawer/containers/PluginLogViewer';
import EditorDebugPanel from '@/providers/BottomDrawer/containers/EditorDebugPanel';
import { useBottomDrawer } from '@omniviewdev/runtime';
import { bottomDrawerChannel } from '@/providers/BottomDrawer/events';
import { EventsOn } from '@omniviewdev/runtime/runtime';

const TerminalContainerMemo = React.memo(TerminalContainer, (prev, next) => {
  return prev.sessionId === next.sessionId
    && prev.tab?.properties?.status === next.tab?.properties?.status;
});

const LogViewerContainerMemo = React.memo(LogViewerContainer, (prev, next) => {
  return prev.sessionId === next.sessionId;
});

type DrawerStartupMode = 'minimized' | 'expanded';

const drawerModeStorageKey = 'omniview.bottomDrawer.mode';
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
  const theme = useTheme();

  // State for drag operation
  const [isDragging, setIsDragging] = React.useState(false);
  const [isHovering, setIsHovering] = React.useState(false);

  // Ref for the sidebar to calculate changes in width
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const dragHandleRef = React.useRef<HTMLDivElement>(null);
  const startupModeRef = React.useRef<DrawerStartupMode>('minimized');
  const startupResolvedRef = React.useRef(false);
  const prevTabCountRef = React.useRef(0);

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

    if (height < minHeight) {
      height = minHeight;
    }

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

    const closerFullScreen = EventsOn("menu/view/bottomdrawer/fullscreen", () => {
      fullscreen();
    })
    const unsubscribeOnFullScreen = bottomDrawerChannel.on('onFullscreen', () => {
      fullscreen();
    });

    const closerMinimize = EventsOn("menu/view/bottomdrawer/minimize", () => {
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

    const nextTabCount = tabs.length;
    const prevTabCount = prevTabCountRef.current;
    const currentHeight = parseInt(drawerRef.current.style.height, 10);

    if (!startupResolvedRef.current) {
      startupResolvedRef.current = true;

      if (nextTabCount === 0) {
        expandDrawerToHeight(minHeight);
      } else if (startupModeRef.current === 'expanded') {
        expandDrawerToHeight(lastExpandedHeightRef.current);
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
  }, [tabs.length, expandDrawerToHeight]);

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
    <>
      <GlobalStyles
        styles={{
          ':root': {
            '--BottomDrawer-height': `${height}px`,
          },
        }}
      />
      <Box
        className='BottomDrawer'
        ref={drawerRef}
        sx={{
          zIndex: 1290,
          flexGrow: 0,
          flexShrink: 1,
          display: 'flex',
          flexDirection: 'column',
          height: minHeight,
          minHeight: minHeight,
          maxHeight: minHeight,
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: 'background.default',
          maxWidth: 'calc(100vw - var(--CoreLayoutSidebar-width))',
          minWidth: 'calc(100vw - var(--CoreLayoutSidebar-width))',
          right: 0,
        }}
      >
        <div
          ref={dragHandleRef}
          data-testid="bottom-drawer-drag-handle"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            height: '10px',
            width: '100%',
            cursor: hasTabs ? 'row-resize' : 'default',
            zIndex: 1291,
            borderTop: `${isDragging ? 4 : 2}px solid ${theme.palette.primary.main}`,
            borderRadius: '0px 0px 0px 0px',
            opacity: hasTabs ? (isDragging ? 0.5 : isHovering ? 0.2 : 0) : 0,
            pointerEvents: hasTabs ? 'auto' : 'none',
            transition: 'opacity 0.2s, border 0.2s',
          }}
          onClick={handleClick}
          onMouseEnter={() => {
            setIsHovering(true);
          }}
          onMouseLeave={() => {
            setIsHovering(false);
          }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        />
        <Box
          className='BottomDrawerContainer'
          sx={{
            display: { xs: 'none', sm: 'flex' },
            flexDirection: 'column',
            bgcolor: 'background.paper',
            flex: 1,
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <Divider />
          <BottomDrawerTabs
            hasTabs={hasTabs}
            isMinimized={height === minHeight}
            isFullscreen={height >= window.innerHeight}
            onMinimize={minimize}
            onExpand={expand}
            onFullscreen={fullscreen}
          />
          <Box
            sx={{
              flex: 1,
              overflow: 'hidden',
              minHeight: 0,
              maxWidth: 'calc(100vw - var(--CoreLayoutSidebar-width))',
              minWidth: 'calc(100vw - var(--CoreLayoutSidebar-width))',
              position: 'relative',
            }}
          >
            {tabs.map((tab) => (
              <Box
                key={tab.id}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'absolute',
                  inset: 0,
                  overflow: 'hidden',
                  // Use visibility instead of display:none so xterm always has
                  // real dimensions and stays fitted. This prevents the brief
                  // flash of doubled lines when switching tabs.
                  visibility: tabs[focused]?.id === tab.id ? 'visible' : 'hidden',
                  pointerEvents: tabs[focused]?.id === tab.id ? 'auto' : 'none',
                }}
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
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </>
  );
};

BottomDrawerContainer.displayName = 'BottomDrawerContainer';
export default BottomDrawerContainer;

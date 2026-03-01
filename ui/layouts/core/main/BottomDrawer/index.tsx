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
import DevBuildOutput from '@/providers/BottomDrawer/containers/DevBuildOutput';
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

/**
 * Sticky resizable drawer at the bottom of the screen used to display
 * interactive context items, such as terminals and reports.
 */
const BottomDrawerContainer: React.FC = () => {
  const minHeight = 32;
  const defaultHeight = 400;

  const { tabs, focused } = useBottomDrawer();

  const [height, setDrawerHeight] = React.useState<number>(minHeight);
  const lastExpandedHeightRef = React.useRef<number>(defaultHeight);
  const theme = useTheme();

  // State for drag operation
  const [isDragging, setIsDragging] = React.useState(false);
  const [isHovering, setIsHovering] = React.useState(false);

  // Ref for the sidebar to calculate changes in width
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const dragHandleRef = React.useRef<HTMLDivElement>(null);

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
    bottomDrawerChannel.emit('onResizeReset')
  }, [height]);

  // expand to last known expanded height (or default)
  const expand = React.useCallback(() => {
    expandDrawerToHeight(lastExpandedHeightRef.current)
    bottomDrawerChannel.emit('onResizeReset')
  }, [])

  // fullscreen toggle
  const fullscreen = React.useCallback(() => {
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
    bottomDrawerChannel.emit('onResizeReset')
  }, [height])


  // ========================== EVENT BUS HANDLING ========================== //

  React.useEffect(() => {
    const unsubscribeOnResizeDrawer = bottomDrawerChannel.on('onResize', (height) => {
      expandDrawerToHeight(height);
    });

    const closerFullScreen = EventsOn("menu/view/bottomdrawer/fullscreen", () => {
      expandDrawerToHeight(window.innerHeight);
    })
    const unsubscribeOnFullScreen = bottomDrawerChannel.on('onFullscreen', () => {
      expandDrawerToHeight(window.innerHeight);
    });

    const closerMinimize = EventsOn("menu/view/bottomdrawer/minimize", () => {
      expandDrawerToHeight(minHeight);
    });
    const unsubscribeOnMinimize = bottomDrawerChannel.on('onMinimize', () => {
      expandDrawerToHeight(minHeight);
    });

    const unsubscribeOnTabCreated = bottomDrawerChannel.on('onTabCreated', () => {
      if (!drawerRef.current) return;
      const cur = parseInt(drawerRef.current.style.height, 10);
      if (isNaN(cur) || cur < defaultHeight) {
        expandDrawerToHeight(defaultHeight);
      }
    });

    return () => {
      unsubscribeOnResizeDrawer();
      unsubscribeOnFullScreen();
      unsubscribeOnMinimize();
      unsubscribeOnTabCreated();

      closerFullScreen();
      closerMinimize();
    };
  }, []);

  React.useEffect(() => {
    if (!drawerRef.current) {
      return;
    }

    const currentHeight = parseInt(drawerRef.current.style.height, 10);

    // if the tabs change, expand the window, or if there is a new tab
    if (tabs.length > 0 && (isNaN(currentHeight) || currentHeight < defaultHeight)) {
      expandDrawerToHeight(defaultHeight);
    } else if (tabs.length === 0) {
      expandDrawerToHeight(minHeight);
    }
  }, [tabs]);

  const handleClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawerRef.current) {
      return;
    }

    // if double click, reset height
    if (e.detail === 2) {
      if (drawerRef.current.style.height === `${minHeight}px`) {
        drawerRef.current.style.height = `${defaultHeight}px`;
        drawerRef.current.style.maxHeight = `${defaultHeight}px`;
        setDrawerHeight(defaultHeight);
        bottomDrawerChannel.emit('onResizeReset')
        return;
      }

      drawerRef.current.style.height = `${minHeight}px`;
      drawerRef.current.style.maxHeight = `${minHeight}px`;

      setDrawerHeight(minHeight);
      bottomDrawerChannel.emit('onResizeReset')
    }
  }, []);

  const handleMouseDown = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    e.preventDefault(); // Prevent text selection during drag
  }, []);

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (!isDragging || !drawerRef.current) {
      return;
    }

    // Calculate the remaining viewport width to the right of the mouse cursor in pixels
    const remainingHeightPx = window.innerHeight - e.clientY;
    const newHeight = Math.max(remainingHeightPx, minHeight);

    // Directly update the drawer's height bypassing React's state
    drawerRef.current.style.height = `${newHeight}px`;
    drawerRef.current.style.maxHeight = `${newHeight}px`;
    bottomDrawerChannel.emit('onResizeHandler', newHeight);
  }, [isDragging, minHeight]);

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false);
    // Optionally sync your React state here if needed for other purposes
    if (drawerRef.current) {
      const currentHeight = drawerRef.current.style.height;
      const newHeight = Math.max(parseInt(currentHeight, 10), minHeight);

      // if we're pretty close to the bottom where it doesn't make sense
      // to keep the drawer open, close it
      if (newHeight < 100) {
        setDrawerHeight(minHeight);
        bottomDrawerChannel.emit('onResizeReset')
        drawerRef.current.style.height = `${minHeight}px`;
        drawerRef.current.style.maxHeight = `${minHeight}px`;
        return;
      }
      setDrawerHeight(newHeight)

    }
  }, []);

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
  }, [isDragging, handleMouseMove]);

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
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            height: '10px',
            width: '100%',
            cursor: 'row-resize',
            zIndex: 1291,
            borderTop: `${isDragging ? 4 : 2}px solid ${theme.palette.primary.main}`,
            borderRadius: '0px 0px 0px 0px',
            opacity: isDragging ? 0.5 : isHovering ? 0.2 : 0,
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
                  <DevBuildOutput pluginId={tab.id.replace(/^devbuild-/, '')} />
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


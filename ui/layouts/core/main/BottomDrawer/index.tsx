import React from 'react';

// material-ui
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import Sheet from '@mui/joy/Sheet';
import GlobalStyles from '@mui/joy/GlobalStyles';
import { useTheme } from '@mui/joy';

// project imports
import BottomDrawerTabs from '@/providers/BottomDrawer/tabs';
import TerminalContainer from '@/providers/BottomDrawer/containers/Terminal';
import useBottomDrawer from '@/hooks/useBottomDrawer';
import { bottomDrawerChannel } from '@/providers/BottomDrawer/events';


/**
 * Resize handler is causing a rerender which we don't want
 */
const TerminalContainerMemo = React.memo(TerminalContainer, (prev, next) => {
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

    drawerRef.current.style.minHeight = `${height}px`;
    drawerRef.current.style.maxHeight = `${height}px`;
    setDrawerHeight(height);
  }, []);


  // ========================== EVENT BUS HANDLING ========================== //

  React.useEffect(() => {
    const unsubscribeOnResizeDrawer = bottomDrawerChannel.on('onResize', (height) => {
      expandDrawerToHeight(height);
    });
    
    const unsubscribeOnFullScreen = bottomDrawerChannel.on('onFullscreen', () => {
      expandDrawerToHeight(window.innerHeight);
    });

    const unsubscribeOnMinimize = bottomDrawerChannel.on('onMinimize', () => { 
      expandDrawerToHeight(minHeight);
    });

    return () => {
      unsubscribeOnResizeDrawer();
      unsubscribeOnFullScreen();
      unsubscribeOnMinimize();
    };
  }, []);

  React.useEffect(() => {
    if (!drawerRef.current) {
      return;
    }

    const currentHeight = parseInt(drawerRef.current.style.minHeight.replace('px', ''));

    // if the tabs change, expand the window, or if there is a new tab
    if (tabs.length > 0 && currentHeight < defaultHeight) {
      expandDrawerToHeight(defaultHeight);
    } else if (tabs.length == 0) {
      expandDrawerToHeight(minHeight);
    }
  }, [tabs]);

  const handleClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawerRef.current) {
      return;
    }

    // if double click, reset height
    if (e.detail === 2) {
      if (drawerRef.current.style.minHeight === `${minHeight}px`) {
        drawerRef.current.style.minHeight = `${defaultHeight}px`;
        drawerRef.current.style.maxHeight = `${defaultHeight}px`;
        setDrawerHeight(defaultHeight);
        return;
      }

      drawerRef.current.style.minHeight = `${minHeight}px`;
      drawerRef.current.style.maxHeight = `${minHeight}px`;

      setDrawerHeight(minHeight);
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
    drawerRef.current.style.minHeight = `${newHeight}px`;
    drawerRef.current.style.maxHeight = `${newHeight}px`;
  }, [isDragging, minHeight]);

  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false);
    // Optionally sync your React state here if needed for other purposes
    if (drawerRef.current) {
      const currentHeight = drawerRef.current.style.minHeight;
      const newHeight = Math.max(parseInt(currentHeight, 10), minHeight);

      // if we're pretty close to the bottom where it doesn't make sense
      // to keep the drawer open, close it
      if (newHeight < 100) {
        setDrawerHeight(minHeight);
        drawerRef.current.style.minHeight = `${minHeight}px`;
        drawerRef.current.style.maxHeight = `${minHeight}px`;
        return;
      }

      setDrawerHeight(newHeight);
    }
  }, []);

  React.useEffect(() => {
    const handleMouseUpGlobal = () => {
      setIsDragging(false); 
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUpGlobal);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUpGlobal);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUpGlobal);
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
          flex: 1,
          flexGrow: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: minHeight,
          maxHeight: minHeight,
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: 'background.body',
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
            borderTop: `${isDragging ? 4 : 2 }px solid ${theme.palette.primary[400]}`,
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
        <Sheet
          className='BottomDrawerContainer'
          variant='plain'
          sx={{
            display: { xs: 'none', sm: 'initial' },
            backgroundColor: 'background.surface',
            flex: 1,
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <Divider />
          <BottomDrawerTabs />
          <Box
            sx={{
              flex: 1,
              overflow: 'auto',
              minHeight: 0,
              height: '100%',
              maxWidth: 'calc(100vw - var(--CoreLayoutSidebar-width))',
              minWidth: 'calc(100vw - var(--CoreLayoutSidebar-width))',
            }}>
            <TerminalContainerMemo sessionId={tabs[focused]?.id ?? ''} />
          </Box>
        </Sheet>
      </Box>
    </>
  );
};

BottomDrawerContainer.displayName = 'BottomDrawerContainer';
BottomDrawerContainer.whyDidYouRender = true;
export default BottomDrawerContainer;


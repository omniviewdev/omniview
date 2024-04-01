import React from 'react';

// material-ui
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import Sheet from '@mui/joy/Sheet';
import GlobalStyles from '@mui/joy/GlobalStyles';
import { useTheme } from '@mui/joy';
import BottomDrawerTabs from '@/providers/BottomDrawer/tabs';
import TerminalContainer from '@/providers/BottomDrawer/containers/Terminal';
import useBottomDrawer from '@/hooks/useBottomDrawer';

/**
 * Sticky resizable drawer at the bottom of the screen used to display
 * interactive context items, such as terminals and reports.
 */
const BottomDrawer: React.FC = () => {
  const minHeight = 32;

  const { tabs, focused } = useBottomDrawer();

  const [height, setDrawerHeight] = React.useState<number>(minHeight);
  const theme = useTheme();

  // State for drag operation
  const [isDragging, setIsDragging] = React.useState(false);

  // Ref for the sidebar to calculate changes in width
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const dragHandleRef = React.useRef<HTMLDivElement>(null);

  const handleClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawerRef.current) {
      return;
    }

    // if double click, reset height
    if (e.detail === 2) {
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
            cursor: 'ns-resize',
            zIndex: 1291,
            borderTop: `4px solid ${theme.palette.primary[400]}`,
            borderRadius: '0px 0px 0px 0px',
            opacity: isDragging ? 0.5 : 0,
          }}
          onClick={handleClick}
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
          {/* <TerminalContainer sessionId={tabs[focused]?.id ?? ''} /> */}
        </Sheet>
      </Box>
    </>
  );
};

BottomDrawer.whyDidYouRender = true;
export default BottomDrawer;

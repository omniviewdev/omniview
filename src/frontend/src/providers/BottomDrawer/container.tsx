import React from 'react';

// material-ui
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import Sheet from '@mui/joy/Sheet';
import GlobalStyles from '@mui/joy/GlobalStyles';
import { useTheme } from '@mui/joy';

/**
 * Sticky resizable drawer at the bottom of the screen used to display
 * interactive context items, such as terminals and reports.
 */
const BottomDrawerContainer: React.FC = () => {
  const minHeight = 32;
  const defaultHeight = 500;
  const theme = useTheme();

  const [height, setDrawerHeight] = React.useState<number>(minHeight);
  const [isDragging, setIsDragging] = React.useState(false);

  // Ref for the sidebar to calculate changes in width
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const dragHandleRef = React.useRef<HTMLDivElement>(null);

  /**
   * Handle the double click separately from the drag to prevent shakiness
   */
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
      }

      drawerRef.current.style.minHeight = `${minHeight}px`;
      drawerRef.current.style.maxHeight = `${minHeight}px`;

      setDrawerHeight(minHeight);
    }
  }, []);

  /**
   * Don't do any state updates here to avoid lag. We just want to kill the event propogation.
   */
  const handleMouseDown = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    e.preventDefault(); // Prevent text selection during drag
  }, []);

  /**
   * When the mouse moves, we want to update the drawer property directly, but avoid React state updates.
   * Things get very lagy if use the state update directly for sizing - we only really want it to update
   * the CSS var in case some other component in the app relies on it, in which case it should be known
   * that the other components won't get the update until the mouse up.
   */
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

  /**
   * Sync the state on mouse up so we don't dispatch a ton of updates to var provider and make other components
   * start freaking out with potential rerenders.
   */
  const handleMouseUp = React.useCallback(() => {
    setIsDragging(false);
    
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
          minWidth: 0,
          flexDirection: 'column',
          minHeight: minHeight,
          maxHeight: minHeight,
          overflow: 'hidden',
          position: 'relative',
          // I spent far too many hours trying to make this work without the calc, but unfortunately this is how we have to do it.
          // Below is a running counter of the amount of hours I have spent. increment it as you like to pu those Jira numbers
          // to shame.
          //
          // Hours wasted on this: 7
          width: 'calc(100vw - var())',
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
        </Sheet>
      </Box>
    </>
  );
};

BottomDrawerContainer.displayName = 'BottomDrawerContainer';
BottomDrawerContainer.whyDidYouRender = true;
export default BottomDrawerContainer;

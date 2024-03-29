import React, {
  useState, useCallback, type ReactNode, useMemo,
  useRef,
} from 'react';

// Material-ui
import Sheet from '@mui/joy/Sheet';

// Context
import RightDrawerContext, { type RightDrawerContextType } from '@/contexts/RightDrawerContext';
import ResourceDrawerContainer from '@/federation/ResourceSidebarComponent';
import { useTheme } from '@mui/joy';

type RightDrawerProviderProps = {
  children: ReactNode;
};

const RightDrawerProvider: React.FC<RightDrawerProviderProps> = ({ children }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [content, setContent] = useState<ReactNode>(<React.Fragment />);
  const theme = useTheme();

  const minVw = 30;
  const maxVw = 80;

  // State for drag operation
  const [isDragging, setIsDragging] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState('40vw');

  // Ref for the sidebar to calculate changes in width
  const sidebarRef = useRef(null);
  const dragHandleRef = useRef(null);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    e.preventDefault(); // Prevent text selection during drag
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !sidebarRef.current) return;
    // Calculate the remaining viewport width to the right of the mouse cursor in pixels
    const remainingWidthPx = window.innerWidth - e.clientX;
    // Convert this width to vw units
    const widthVw = (remainingWidthPx / window.innerWidth) * 100;
    // Clamp the width between min and max values
    if (widthVw < minVw) {
      setDrawerWidth(minVw + 'vw');
      return;
    } else if (widthVw > maxVw) {
      setDrawerWidth(maxVw + 'vw');
      return;
    }

    setDrawerWidth(widthVw + 'vw');
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
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


  /**
   * Close the resource drawer
   */
  const closeDrawer = useCallback(() => {
    setIsOpen(false);
    // clear the content after the drawer is closed
    setTimeout(() => {
      setContent(<React.Fragment />);
    }, 150);
  }, []);

  /**
   * Show the resource sidebar
   */
  const showResourceSidebar: RightDrawerContextType['showResourceSidebar'] = useCallback((params) => {
    setContent(<ResourceDrawerContainer {...params} onClose={closeDrawer} />);
    setIsOpen(true);
  }, []);

  const contextValue = useMemo(() => ({
    closeDrawer,
    showResourceSidebar,
  }), [showResourceSidebar, closeDrawer]);

  return (
    <RightDrawerContext.Provider value={contextValue}>
      {children}
      <Sheet
        ref={sidebarRef}
        variant='outlined'
        sx={{
          borderRadius: 'md',
          width: drawerWidth,
          bgcolor: 'background.surface',
          p: 0,
          position: 'absolute',
          top: 4,
          right: 4,
          bottom: 4,
          zIndex: 1300,
          minHeight: 'calc(100vh - 8px)',
          transition: 'transform 0.3s ease',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        {content}
        <div
          ref={dragHandleRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '10px', // This is the width of the draggable area
            cursor: 'ew-resize',
            borderLeft: `4px solid ${theme.palette.primary[400]}`,
            borderRadius: '6px 0px 0px 6px',
            opacity: isDragging ? 0.5 : 0,
          }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        />
      </Sheet>
    </RightDrawerContext.Provider>
  );
};

export default RightDrawerProvider;

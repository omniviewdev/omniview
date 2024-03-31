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
  // TODO - calculate these based on window width
  const minWidth = 600;
  const maxWidth = window.innerWidth - 359;
  const initialWidth = 800;

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [content, setContent] = useState<ReactNode>(<React.Fragment />);

  const theme = useTheme();
  const [isDragging, setIsDragging] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  /**
   * Handle the double click separately from the drag to prevent shakiness
   */
  const handleClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!sidebarRef.current) return;

    // if double click, reset height
    if (e.detail === 2) {
      // if already at initial width, set to max width
      if (sidebarRef.current.style.width === initialWidth + 'px') {
        sidebarRef.current.style.width = maxWidth + 'px';
      } else if (sidebarRef.current.style.width === maxWidth + 'px') {
        sidebarRef.current.style.width = initialWidth + 'px';
      } else {
        sidebarRef.current.style.width = initialWidth + 'px';
      }
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    e.preventDefault(); // Prevent text selection during drag
  }, []);

  // don't commit the width directly until mouse up, otherwise we'll suffer state sync
  // lag becoming visible
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !sidebarRef.current) return;

    // Calculate the remaining viewport width to the right of the mouse cursor in pixels
    const newWidth = window.innerWidth - e.clientX;
    
    // Clamp the width between min and max values
    if (newWidth < minWidth) {
      sidebarRef.current.style.width = minWidth + 'px';
      return;
    } else if (newWidth > maxWidth) {
      sidebarRef.current.style.width = maxWidth + 'px';
      return;
    }

    sidebarRef.current.style.width = newWidth + 'px';
  }, [isDragging]);

  // const handleMouseUp = useCallback(() => {
  //   setIsDragging(false);
  // }, []);

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
          borderColor: 'divider',
          borderRadius: sidebarRef.current?.style.width === `${maxWidth}px` ? '2px 12px 12px 2px' : 'md',
          width: initialWidth,
          bgcolor: 'background.surface',
          p: 0,
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 1300,
          minHeight: 'calc(100vh)',
          transition: 'transform 0.3s ease',
          transform: isOpen ? 'translateX(0)' : 'translateX(110%)',
          overflow: 'hidden',
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
            borderRadius: sidebarRef.current?.style.width === `${maxWidth}px` ? '2px 0px 0px 2px' : '6px 0px 0px 6px',
            opacity: isDragging ? 0.5 : 0,
          }}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
        />
      </Sheet>
    </RightDrawerContext.Provider>
  );
};

export default RightDrawerProvider;

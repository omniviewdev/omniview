import React, {
  useState, useCallback, type ReactNode, useMemo,
  useRef,
} from 'react';

// material-ui
import {
  useTheme,
  Sheet,
} from '@mui/joy';

// context
import {
  DrawerComponent,
  DrawerContext,
  RightDrawerContext,
  type RightDrawerContextType,
} from '@omniviewdev/runtime';
import RightDrawer from '@/components/displays/RightDrawer';
import { bottomDrawerChannel } from './BottomDrawer/events';

type Props = {
  children: ReactNode;
};


/** Length of the core layout sidebar */
const innerWidthBuffer = 47

const RightDrawerProvider: React.FC<Props> = ({ children }) => {
  // TODO - calculate these based on window width
  const minWidth = 600;
  const maxWidth = window.innerWidth - innerWidthBuffer;
  const initialWidth = 800;

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [content, setContent] = useState<DrawerComponent | null>(null);
  const [context, setContext] = useState<DrawerContext | undefined>(undefined);

  const theme = useTheme();
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);


  React.useEffect(() => {
    const sizeReset = () => {
      if (!sidebarRef.current) {
        return;
      }

      // reset back to state level since the other container has set it
      sidebarRef.current.style.height = 'calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - var(--BottomDrawer-height))'
      sidebarRef.current.style.minHeight = 'calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - var(--BottomDrawer-height))'
      sidebarRef.current.style.maxHeight = 'calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - var(--BottomDrawer-height))'
    }

    const unsubscribeOnResizeDrawer = bottomDrawerChannel.on('onResizeHandler', (height) => {
      if (!sidebarRef.current) {
        return;
      }

      // more performant resizing while the resize handler is actually doing it's thing, otherwise we get cascading rerenders
      sidebarRef.current.style.height = `calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - ${height}px)`
      sidebarRef.current.style.minHeight = `calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - ${height}px)`
      sidebarRef.current.style.maxHeight = `calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - ${height}px)`
    });

    const unsubsribeOnResizeReset = bottomDrawerChannel.on('onResizeReset', () => sizeReset())
    const unsubsribeOnFullscreen = bottomDrawerChannel.on('onFullscreen', () => sizeReset())
    const unsubsribeOnMinimize = bottomDrawerChannel.on('onMinimize', () => sizeReset())


    return () => {
      unsubscribeOnResizeDrawer();
      unsubsribeOnResizeReset();
      unsubsribeOnFullscreen();
      unsubsribeOnMinimize();
    };
  }, []);

  /**
   * Handle the double click separately from the drag to prevent shakiness
   */
  const handleClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!sidebarRef.current) {
      return;
    }

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
    if (!isDragging || !sidebarRef.current) {
      return;
    }

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
      setContent(null);
    }, 150);
  }, []);

  /**
   * Close the resource drawer on escape key press
   */
  const escFunction = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (!isOpen) {
        return;
      }

      event.preventDefault();
      closeDrawer();
    }
  }, [isOpen]);

  React.useEffect(() => {
    document.addEventListener('keydown', escFunction, false);

    return () => {
      document.removeEventListener('keydown', escFunction, false);
    };
  }, [escFunction]);

  /**
   * Show the resource sidebar with a specific component
   */
  const openDrawer: RightDrawerContextType['openDrawer'] = useCallback((DrawerComponent, ctx) => {
    setContent(DrawerComponent);
    setContext(ctx);
    setIsOpen(true);
  }, []);

  const contextValue = useMemo(() => ({
    closeDrawer,
    openDrawer,
    isOpen,
    content,
  }), [openDrawer, closeDrawer]);

  return (
    <RightDrawerContext.Provider value={contextValue}>
      {children}
      <Sheet
        ref={sidebarRef}
        sx={{
          width: initialWidth,
          borderLeft: (theme) => `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.surface',
          p: 0,
          position: 'absolute',
          top: 'calc(var(--CoreLayoutHeader-height) - 1px)',
          right: 0,
          zIndex: 999,
          height: 'calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - var(--BottomDrawer-height))',
          minHeight: 'calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - var(--BottomDrawer-height))',
          maxHeight: 'calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - var(--BottomDrawer-height))',
          transition: 'transform 0.2s ease',
          transform: isOpen ? 'translateX(0)' : 'translateX(110%)',
          overflow: 'hidden',
        }}
      >
        {content &&
          <RightDrawer
            {...content}
            ctx={context}
            open={isOpen}
            onClose={closeDrawer}
          />
        }
        <div
          ref={dragHandleRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '10px', // This is the width of the draggable area
            cursor: 'col-resize',
            zIndex: 1201,
            borderLeft: `${isDragging ? 4 : 2}px solid ${theme.palette.primary[400]}`,
            // borderRadius: sidebarRef.current?.style.width === `${maxWidth}px` ? '2px 0px 0px 2px' : '6px 0px 0px 6px',
            opacity: isDragging ? 0.5 : isHovering ? 0.2 : 0,
            transition: 'opacity 0.2s, border 0.2s',
          }}
          onMouseEnter={() => {
            setIsHovering(true);
          }}
          onMouseLeave={() => {
            setIsHovering(false);
          }}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
        />
      </Sheet>
    </RightDrawerContext.Provider>
  );
};

export default RightDrawerProvider;

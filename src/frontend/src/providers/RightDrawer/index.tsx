import React, {
  useState, useCallback, type ReactNode, useMemo,
} from 'react';

// Material-ui
import Drawer from '@mui/joy/Drawer';

// Context
import RightDrawerContext, { type RightDrawerContextType } from '@/contexts/RightDrawerContext';
import ResourceDrawerContainer from '@/federation/ResourceSidebarComponent';

type RightDrawerProviderProps = {
  children: ReactNode;
};

const RightDrawerProvider: React.FC<RightDrawerProviderProps> = ({ children }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [content, setContent] = useState<ReactNode>(<React.Fragment />);

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
      <Drawer
        disableEnforceFocus
        disableScrollLock
        size='lg'
        anchor='right'
        variant='outlined'
        open={isOpen}
        onClose={closeDrawer}
        // HideBackdrop
        slotProps={{
          backdrop: {
            sx: {
              backgroundColor: 'transparent',
              WebkitBackdropFilter: 'blur(0px)',
            },
          },
          content: {
            sx: {
              borderRadius: 'md',
              width: { lg: '40vw', md: 500, sm: '100%' },
              bgcolor: 'background.surface',
              p: 0,
              // boxShadow: 'none',
            },
          },
        }}
        sx={{
          borderRadius: 'md',
          // This ensures the drawer is an overlay that does not push content
          position: 'fixed',
          zIndex: theme => theme.zIndex.modal,
          // This makes the background content interactive
          '& .MuiBackdrop-root': {
            // Make it transparent
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          },
        }}
      >
        {content}
      </Drawer>
    </RightDrawerContext.Provider>
  );
};

export default RightDrawerProvider;

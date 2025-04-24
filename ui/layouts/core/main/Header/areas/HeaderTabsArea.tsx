import React from 'react';

// material-ui
import Box from '@mui/joy/Box';
import { WindowIsMaximised, WindowMaximise, WindowUnmaximise } from '@omniviewdev/runtime/runtime';

// import TabBarProvider from '@/providers/header/TabBarProvider';

/**
 * The tabs area in the header
 */
const HeaderTabsArea: React.FC = () => {

  /**
   * Provide the functionality of the double click behavior like on MacOS
   */
  const handleAreaClick: React.MouseEventHandler = (e) => {
    switch (e.detail) {
      case 0:
      case 1:
        // don't do anything
        break;
      default:
        WindowIsMaximised().then((isMaximized) => {
          if (isMaximized) {
            WindowUnmaximise();
          } else {
            WindowMaximise();
          }
        }).catch((err) => {
          console.error(err);
        });
        break;
    }
  };

  return (
    <Box
      onClick={handleAreaClick}
      sx={{
        display: 'flex',
        flexDirection: 'row',
        gap: 1,
        width: 'calc(100% - var(--CoreLayoutHeader-inset))',
        height: '100%',
        justifyContent: 'flex-start',
        alignItems: 'center',
        px: 0.5,
        WebkitUserSelect: 'none',
      }}
    >
      {/* <TabBarProvider /> */}
    </Box>
  );
};

export default HeaderTabsArea;

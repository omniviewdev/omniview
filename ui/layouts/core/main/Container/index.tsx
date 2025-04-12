// import React from 'react';
import { Outlet, useInRouterContext } from 'react-router-dom';
import Layout from '@/layouts/core/main';

// Material-ui
import Box from '@mui/joy/Box';
// import IconButton from '@mui/joy/IconButton';
// import usePanes, { usePane } from '@/hooks/usePanes';

// Icon
// import CloseIcon from '@mui/icons-material/Close';

/**
 * The main rendering container for a pane layout.
 */
export default function Container() {
  // const { numPanes, removePane } = usePanes();
  // const { id } = usePane();
  // const [showCloseButton, setShowCloseButton] = React.useState(false);
  console.log("In Router Context", useInRouterContext())

  return (
    <Box
      component='main'
      className='Container'
      sx={{
        flex: 1,
        minWidth: 0,
        position: 'relative',
        height: 'calc(100dvh - var(--CoreLayoutHeader-height))',
        maxHeight: 'calc(100dvh - var(--CoreLayoutHeader-height))',
        overflow: 'auto',
        gap: 1,
      }}
    // onMouseEnter={() => {
    //   if (numPanes > 1) {
    //     setShowCloseButton(true);
    //   }
    // }}
    // onMouseLeave={() => {
    //   setShowCloseButton(false);
    // }}
    >
      <Box sx={{
        display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
      }}>
        <Layout.Sidebar />
        <Box
          sx={{
            bgcolor: 'background.appBody',
            height: 'calc(100vh - var(--CoreLayoutHeader-height))',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            width: {
              xs: '100%',
              md: 'calc(100% - var(--CoreLayoutSidebar-width))',
            },
            ml: {
              xs: 0,
              md: 'var(--CoreLayoutSidebar-width)',
            },
          }}
        >
          <Outlet />
          <Layout.BottomDrawer />
        </Box>
      </Box>
      {/* {showCloseButton && numPanes > 1 && ( */}
      {/*   <IconButton */}
      {/*     sx={{ */}
      {/*       position: 'absolute', */}
      {/*       top: 0, */}
      {/*       right: 0, */}
      {/*     }} */}
      {/**/}
      {/*     color='neutral' */}
      {/*     size='sm' */}
      {/*     onClick={() => { */}
      {/*       removePane(id); */}
      {/*     }} */}
      {/*   > */}
      {/*     <CloseIcon /> */}
      {/*   </IconButton> */}
      {/* )} */}
    </Box>
  );
}


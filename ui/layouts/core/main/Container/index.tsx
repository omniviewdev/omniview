import { Outlet } from 'react-router-dom';
import Layout from '@/layouts/core/main';

// Material-ui
import Box from '@mui/material/Box';

/**
 * The main rendering container for a pane layout.
 */
export default function Container() {
  return (
    <Box
      component='main'
      className='Container'
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Fixed-position sidebar — does not affect flex layout */}
      <Layout.Sidebar />

      {/* Content area: fills remaining space next to the sidebar */}
      <Box
        sx={{
          bgcolor: 'background.default',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
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
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flex: 1,
            minHeight: 0,
          }}
        >
          <Outlet />
        </Box>
        <Layout.BottomDrawer />
      </Box>
    </Box>
  );
}

import React from 'react';
import { Outlet } from 'react-router-dom';

// Mui
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';

// Layout components
import ResourceSidebar from './Sidebar';
import RightDrawer from './RightDrawer';
// import BottomDrawer from './BottomDrawer';

/**
 * Layout for displaying a resource with a sidebar of items.
 */
const ResourceLayout: React.FC = () => (
  <>
    {/* Displays the available resources within a sidebar list */}
    <ResourceSidebar />
    <Box
      component='div'
      className='ResourceLayout'
      sx={{
        p: {
          xs: 1,
          md: 2,
        },
        ml: {
          xs: 0,
          lg: 'var(--ResourceSidebar-width)',
        },
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        height: 'calc(100% - var(--LowerContextMenu-height))',
        minHeight: 400,
        maxHeight: 'calc(100% - var(--LowerContextMenu-height))',
        gap: 1,
      }}
    >
      <Outlet />
    </Box>
    <Box
      className='LowerContextContainer'
      sx={{
        position: 'fixed',
        bottom: 0,
        width: {
          xs: '100%',
          lg: 'calc(100% - var(--ClusterResourceSidebar-width))',
        },
        p: 0,
        ml: {
          xs: 0,
          lg: 'var(--ClusterResourceSidebar-width)',
        },
      }}
    >
      <Divider />

      <RightDrawer />
    </Box>
  </>
);

export default ResourceLayout;

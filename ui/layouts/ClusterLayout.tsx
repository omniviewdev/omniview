import React from 'react';
import { Outlet } from 'react-router-dom';

// Material-ui
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';

// Project imports
import ClusterResourceSidebar from './components/ClusterResourceSidebar';

const ClusterLayout: React.FC = () => {
  return (
    <>
      <ClusterResourceSidebar />
      <Box
        component='main'
        className='ClusterContent'
        sx={{
          p: {
            xs: 1,
            md: 2,
          },
          ml: {
            xs: 0,
            lg: 'var(--ClusterResourceSidebar-width)',
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
          // Position: 'fixed',
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
      </Box>
    </>
  );
};

export default ClusterLayout;

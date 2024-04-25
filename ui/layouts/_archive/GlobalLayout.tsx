
import { CssVarsProvider } from '@mui/joy/styles';
import CssBaseline from '@mui/joy/CssBaseline';
import Box from '@mui/joy/Box';
import Layout from '@/layouts/core/main';
import { Outlet } from 'react-router-dom';

export default function GlobalLayout() {
  return (
    <CssVarsProvider disableTransitionOnChange>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100dvh', flexDirection: 'column' }}>
        <Layout.Header />
        <Layout.Sidebar />
        <Box
          component='main'
          className='MainContent'
          sx={{
            ml: {
              md: 'var(--CoreLayoutSidebar-width)',
            },
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            height: 'calc(100dvh - var(--CoreLayoutHeader-height))',
            maxHeight: 'calc(100dvh - var(--CoreLayoutHeader-height))',
            overflow: 'auto',
            gap: 1,
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </CssVarsProvider>
  );
}

import { CssVarsProvider } from '@mui/joy/styles';
import CssBaseline from '@mui/joy/CssBaseline';
import Box from '@mui/joy/Box';
import Layout from '@/layouts/core/main'
import { Outlet } from 'react-router-dom';

/**
 * The core layout for the application. This layout wraps the entire application
 * and hacks the react router to provide a nested memory router within the scope
 */
export default function CoreLayout() {
  return (
    <CssVarsProvider disableTransitionOnChange>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100dvh', flexDirection: 'column' }}>
        <Layout.Header />
        <Box
          component="main"
          className="MainContent"
          sx={{
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

import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import Layout from '@/layouts/core/main';
import Container from './Container';
import AppStatusFooter from '@/components/displays/Footer/AppStatusFooter';

/**
 * The core layout for the application. This layout wraps the entire application
 * and hacks the react router to provide a nested memory router within the scope
 */
export default function CoreLayout() {
  return (
    <>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100dvh', flexDirection: 'column' }}>
        <Layout.Header />
        <Box
          component='main'
          className='MainContent'
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            height: 'calc(100dvh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height))',
            maxHeight: 'calc(100dvh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height))',
            overflow: 'hidden',
          }}
        >
          <Layout.Sidebar />
          <Container />
        </Box>
        <AppStatusFooter />
      </Box>
    </>
  );
}

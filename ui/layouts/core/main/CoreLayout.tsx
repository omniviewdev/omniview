import { CssVarsProvider } from '@mui/joy/styles';
import CssBaseline from '@mui/joy/CssBaseline';
import Box from '@mui/joy/Box';
import Layout from '@/layouts/core/main';
import Container from './Container';
import Footer from '@/components/displays/Footer';

/**
 * The core layout for the application. This layout wraps the entire application
 * and hacks the react router to provide a nested memory router within the scope
 */
export default function CoreLayout() {
  return (
    <CssVarsProvider
      defaultMode='dark'
      disableTransitionOnChange
    >
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
            overflow: 'auto',
            gap: 1,
          }}
        >
          <Layout.Sidebar />
          <Container />
        </Box>
        <Layout.Footer>
          <Footer />
        </Layout.Footer>
      </Box>
    </CssVarsProvider>
  );
}

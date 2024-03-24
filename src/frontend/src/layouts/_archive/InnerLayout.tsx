import { CssVarsProvider } from '@mui/joy/styles';
import CssBaseline from '@mui/joy/CssBaseline';
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';

import OuterSidebar from '../components/OuterSidebar';
import InnerSidebar from '../components/InnerSidebar';
import Header from '../components/Header';
import ColorSchemeToggle from '../components/ColorSchemeToggle';
import { type Children } from '../../types';

export default function InnerLayout({ children }: Children) {
  const pathname = window.location.pathname.split('/')[1];

  return (
    <CssVarsProvider disableTransitionOnChange>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
        <Header />
        <OuterSidebar />
        <InnerSidebar />
        <Box
          component='main'
          className='MainContent'
          sx={{
            px: {
              xs: 2,
              md: 6,
            },
            ml: {
              md: 24,
            },
            pt: {
              xs: 'calc(12px + var(--Header-height))',
              sm: 'calc(12px + var(--Header-height))',
              md: 3,
            },
            pb: {
              xs: 2,
              sm: 2,
              md: 3,
            },
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            height: '100dvh',
            gap: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', pb: 2 }}>
            <Typography level='h2' sx={{ textTransform: 'capitalize' }}>
              {pathname ? pathname : 'Clusters'}
            </Typography>
            <ColorSchemeToggle
              sx={{ ml: 'auto', display: { xs: 'none', lg: 'inline-flex' } }}
            />
          </Box>

          {children}
        </Box>
      </Box>
    </CssVarsProvider>
  );
}

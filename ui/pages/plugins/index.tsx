
// Material-ui
import {
  CssBaseline,
  CssVarsProvider,
  Input,
  IconButton,
  Stack,
  Sheet,
  Typography,
} from '@mui/joy';

// Icons
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';

// Layout
import Layout from '@/layouts/core/sidenav';

// Components
import PluginsNav from './PluginsNav';
import { LuSlidersHorizontal } from 'react-icons/lu';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { Outlet } from 'react-router-dom';

/**
 * The main settings page for the application.
 */
const SettingsPage = () => {
  const { plugins } = usePluginManager();

  if (plugins.isLoading) {
    return <div>Loading...</div>;
  }

  if (plugins.isError) {
    return <div>Error: {plugins.error.message}</div>;
  }

  return (
    <CssVarsProvider disableTransitionOnChange>
      <CssBaseline />
      <Layout.Root
        sx={{
          p: 1,
          gap: 0,
        }}
      >
        <Layout.SideNav type='bordered-inset' width={300}>
          <Stack component={Sheet} variant={'outlined'} direction='row' alignItems={'center'} spacing={8} sx={{
            px: 2, py: 1.5, m: 1, borderRadius: 'md',
          }}>
            <Typography level='title-lg'>Plugins</Typography>
            <Input
              size='sm'
              variant='outlined'
              placeholder='Search the plugin repository…'
              startDecorator={<SearchRoundedIcon color='primary' />}
              endDecorator={
                <IconButton variant='outlined' color='primary'>
                  <LuSlidersHorizontal />
                </IconButton>
              }
              sx={{
                flexBasis: '500px',
                display: 'flex',
                '--wails-draggable': 'no-drag',
              }}
            />
          </Stack>
          <PluginsNav installed={plugins.data?.map((p => p.id))} />
        </Layout.SideNav>
        <Layout.Main>
          <Outlet />
        </Layout.Main>
      </Layout.Root>
    </CssVarsProvider>
  );
};

export default SettingsPage;

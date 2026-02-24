
// Material-ui
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { IconButton } from '@omniviewdev/ui/buttons';
import { TextField } from '@omniviewdev/ui/inputs';

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
    <Layout.Root
      sx={{
        p: 1,
        gap: 0,
      }}
    >
      <Layout.SideNav type='bordered-inset' width={300}>
        <Box component={Stack} direction='row' alignItems={'center'} spacing={8} sx={{
          px: 2, py: 1.5, m: 1, borderRadius: 2, border: '1px solid', borderColor: 'divider',
        }}>
          <Text weight='semibold' size='lg'>Plugins</Text>
          <TextField
            size='sm'
            placeholder='Search the plugin repository...'
            startAdornment={<SearchRoundedIcon color='primary' />}
            endAdornment={
              <IconButton emphasis='outline' color='primary'>
                <LuSlidersHorizontal />
              </IconButton>
            }
            sx={{
              flexBasis: '500px',
              display: 'flex',
              '--wails-draggable': 'no-drag',
            }}
          />
        </Box>
        <PluginsNav installed={plugins.data?.map((p => p.id))} />
      </Layout.SideNav>
      <Layout.Main>
        <Outlet />
      </Layout.Main>
    </Layout.Root>
  );
};

export default SettingsPage;

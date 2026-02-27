
// Material-ui
import Box from '@mui/material/Box';

// Layout
import Layout from '@/layouts/core/sidenav';

// Components
import PluginsNav from './PluginsNav';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { parseAppError } from '@omniviewdev/runtime';
import { Outlet } from 'react-router-dom';

/**
 * The plugin management page.
 */
const PluginsPage = () => {
  const { plugins } = usePluginManager();

  if (plugins.isLoading) {
    return <div>Loading...</div>;
  }

  if (plugins.isError) {
    return <div>Error: {parseAppError(plugins.error).detail}</div>;
  }

  return (
    <Layout.Root
      sx={{
        p: 0,
        gap: 0,
      }}
    >
      <Layout.SideNav type='transparent' width={340}>
        <Box sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: 'rgba(255,255,255,0.015)',
        }}>
          <PluginsNav />
        </Box>
      </Layout.SideNav>
      <Layout.Main>
        <Outlet />
      </Layout.Main>
    </Layout.Root>
  );
};

export default PluginsPage;

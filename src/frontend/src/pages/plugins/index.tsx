import React from 'react';

// material-ui
import { CssVarsProvider } from '@mui/joy/styles';
import Typography from '@mui/joy/Typography';
import Input from '@mui/joy/Input';
import IconButton from '@mui/joy/IconButton';
import Stack from '@mui/joy/Stack';
import CssBaseline from '@mui/joy/CssBaseline';


// icons
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';

// layout
import Layout from '@/layouts/core/sidenav';

// components
import PluginsNav from './PluginsNav';
import PluginPreview from './PluginPreview';
import { LuSlidersHorizontal } from 'react-icons/lu';
import { Sheet } from '@mui/joy';
import InstalledPlugins from './InstalledPlugins';

import {
  useQuery,
} from '@tanstack/react-query'
import { ListPlugins } from '@api/plugin/pluginManager';

/**
 * The main settings page for the application.
 */
const SettingsPage = () => {
  const [selected, setSelected] = React.useState()
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['INSTALLED_PLUGINS'], queryFn: ListPlugins })

  if (isLoading) {
    return <div>Loading...</div>
  }
  if (isError) {
    return <div>Error: {error.message}</div>
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
        <Layout.SideNav type='bordered-inset'>
          <Stack component={Sheet} variant={'outlined'} direction="row" alignItems={'center'} spacing={8} sx={{ px: 2, py: 1.5, m: 1, borderRadius: 'md' }}>
            <Typography level="title-lg">Plugins</Typography>
            <Input
              size="sm"
              variant="outlined"
              placeholder="Search the plugin repository…"
              startDecorator={<SearchRoundedIcon color="primary" />}
              endDecorator={
                <IconButton variant="outlined" color="primary">
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
          <PluginsNav selected={selected} onChange={setSelected} installed={data?.map((p => p.id))} />
        </Layout.SideNav>
        <Layout.Main>
          {selected !== undefined
            ? <PluginPreview plugin={selected} />
            : (
              data?.length && <InstalledPlugins plugins={data} />
            )
          }
        </Layout.Main>
      </Layout.Root>
    </CssVarsProvider>
  );
}

export default SettingsPage;

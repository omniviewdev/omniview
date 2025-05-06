import React from 'react';

// Material-ui
import Button from '@mui/joy/Button';
import Grid from '@mui/joy/Grid';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

// Components
import InstalledPluginCard from './InstalledPluginCard';

// Icons
import { LuAtom, LuBox, LuGlobe } from 'react-icons/lu';

// Hooks
import { usePluginManager } from '@/hooks/plugin/usePluginManager';

type Props = Record<string, unknown>;

/**
 * Show the currently installed plugins.
 */
const InstalledPlugins: React.FC<Props> = () => {
  const { plugins, promptInstallFromPath, promptInstallDev } = usePluginManager();

  if (plugins.isLoading) {
    return <div>Loading...</div>;
  }

  if (plugins.isError) {
    return <div>Error: {plugins.error.message}</div>;
  }

  return (
    <Grid container spacing={3} p={3}>
      <Grid xs={12} pb={2}>
        <Stack direction='row' spacing={2} alignItems='center' justifyContent={'space-between'}>
          <Typography level='h2'>Installed Plugins</Typography>
          <Stack direction='row' spacing={2}>
            <Button
              variant='soft'
              color='primary'
              startDecorator={<LuGlobe />}
            >
              Go to Plugin Marketplace
            </Button>
            <Button
              variant='soft'
              color='neutral'
              startDecorator={<LuBox />}
              onClick={async () => promptInstallFromPath()}
            >
              Install From Location
            </Button>
            <Button
              variant='soft'
              color='neutral'
              startDecorator={<LuAtom />}
              onClick={async () => promptInstallDev()}
            >
              Install From Location (Development Mode)
            </Button>
          </Stack>
        </Stack>
      </Grid>
      {plugins.data?.map(plugin => (
        <Grid key={plugin.id} xs={12} md={6} xl={4} >
          <InstalledPluginCard key={plugin.id} {...plugin} />
        </Grid>
      ))}
    </Grid>
  );
};

export default InstalledPlugins;

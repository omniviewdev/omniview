import React from 'react';

// Material-ui
import Grid from '@mui/material/Grid';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Heading } from '@omniviewdev/ui/typography';

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
  const { plugins, installFromPath, installDev } = usePluginManager();

  if (plugins.isLoading) {
    return <div>Loading...</div>;
  }

  if (plugins.isError) {
    return <div>Error: {plugins.error.message}</div>;
  }

  return (
    <Grid container spacing={3} sx={{ p: 3 }}>
      <Grid size={12} sx={{ pb: 2 }}>
        <Stack direction='row' spacing={2} alignItems='center' justifyContent={'space-between'}>
          <Heading level={2}>Installed Plugins</Heading>
          <Stack direction='row' spacing={2}>
            <Button
              emphasis='soft'
              color='primary'
              startAdornment={<LuGlobe />}
            >
              Go to Plugin Marketplace
            </Button>
            <Button
              emphasis='soft'
              color='neutral'
              startAdornment={<LuBox />}
              loading={installFromPath.isPending}
              onClick={async () => installFromPath.mutateAsync()}
            >
              Install From Location
            </Button>
            <Button
              emphasis='soft'
              color='neutral'
              startAdornment={<LuAtom />}
              loading={installDev.isPending}
              onClick={async () => installDev.mutateAsync()}
            >
              Install From Location (Development Mode)
            </Button>
          </Stack>
        </Stack>
      </Grid>
      {plugins.data?.map(plugin => (
        <Grid key={plugin.id} size={{ xs: 12, md: 6, xl: 4 }} >
          <InstalledPluginCard key={plugin.id} {...plugin} />
        </Grid>
      ))}
    </Grid>
  );
};

export default InstalledPlugins;

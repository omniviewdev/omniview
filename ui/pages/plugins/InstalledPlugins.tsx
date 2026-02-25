import React from 'react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Tooltip } from '@omniviewdev/ui/overlays';

// Components
import InstalledPluginCard from './InstalledPluginCard';

// Icons
import { LuAtom, LuFolderOpen } from 'react-icons/lu';

// Hooks
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { parseAppError } from '@omniviewdev/runtime';

type Props = Record<string, unknown>;

const InstalledPlugins: React.FC<Props> = () => {
  const { plugins, installFromPath, installDev } = usePluginManager();

  if (plugins.isLoading) {
    return <div>Loading...</div>;
  }

  if (plugins.isError) {
    return <div>Error: {parseAppError(plugins.error).detail}</div>;
  }

  return (
    <Box sx={{ p: 2.5, height: '100%', overflow: 'auto' }}>
      {/* Header toolbar */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        mb: 2,
      }}>
        <Box sx={{
          fontSize: '0.8125rem',
          fontWeight: 600,
          color: 'var(--ov-fg-default, #c9d1d9)',
        }}>
          Installed Plugins
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip content="Install from location">
            <IconButton
              emphasis="ghost"
              color="neutral"
              size="sm"
              loading={installFromPath.isPending}
              onClick={async () => installFromPath.mutateAsync()}
            >
              <LuFolderOpen size={15} />
            </IconButton>
          </Tooltip>
          <Tooltip content="Install in development mode">
            <IconButton
              emphasis="ghost"
              color="neutral"
              size="sm"
              loading={installDev.isPending}
              onClick={async () => installDev.mutateAsync()}
            >
              <LuAtom size={15} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Plugin cards */}
      {plugins.data?.length === 0 ? (
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          fontSize: '0.8125rem',
          color: 'var(--ov-fg-faint, #8b949e)',
        }}>
          No plugins installed. Browse the marketplace to get started.
        </Box>
      ) : (
        <Grid container spacing={2}>
          {plugins.data?.map(plugin => (
            <Grid key={plugin.id} size={{ xs: 12, lg: 6, xl: 4 }}>
              <InstalledPluginCard key={plugin.id} {...plugin} />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
};

export default InstalledPlugins;

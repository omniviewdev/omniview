import React from 'react';

// material-ui
import Avatar from '@mui/joy/Avatar';
import Sheet from '@mui/joy/Sheet';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

// project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnections } from '@/hooks/connection/useConnections';
import ConnectionTable from './ConnectionTable';
import ConnectionListHeader from './ConnectionListHeader';
import PluginBackdrop from './PluginBackdrop';

// Third-party
import tinycolor from 'tinycolor2';

/**
 * Default home landing for the plugin.
 */
export default function PluginHome(): React.ReactElement {
  const [search, setSearch] = React.useState('');

  const plugin = usePluginContext();
  const { connections } = useConnections({ plugin: plugin.id });

  return (
    <Stack
      p={2}
      spacing={2}
      overflow={'auto'}
      direction={'column'}
      alignItems={'flex-start'}
      minHeight={0}
      flex={1}
      sx={{
        background: `linear-gradient(109.6deg, rgb(36, 45, 57) 2.2%, ${tinycolor(plugin.metadata.theme.colors.primary).setAlpha(0.2).toString()} 50.2%, rgb(0, 0, 0) 98.6%);`,
      }}
    >
      <PluginBackdrop
        open={plugin.loading}
        message={`${plugin.metadata.name} plugin is reloading`}
      />
      <Sheet
        sx={{
          width: '100%',
          backgroundColor: 'transparent',
          display: 'flex',
          gap: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        variant='soft'
      >
        <Stack direction='row' alignItems='center' gap={1.5}>
          <Avatar size='sm' src={plugin.metadata.icon} variant='plain' sx={{ borderRadius: 4 }} />
          <Typography level='h3' >{plugin.metadata.name}</Typography>
        </Stack>
        <Typography level='title-sm' >{plugin.metadata.description}</Typography>
      </Sheet>
      <Stack direction='column' gap={0.5}>
        <ConnectionListHeader plugin={plugin.id} search={search} onSearchChange={setSearch} />

        {/* List of connections */}
        {Boolean(connections.data?.length) && (
          <ConnectionTable connections={connections.data ?? []} />
        )}
      </Stack>
    </Stack>
  );
}

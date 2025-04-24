import React from 'react';

// material-ui
import { Stack } from '@mui/joy';

// project imports
import { usePluginContext } from '@omniviewdev/runtime';
import { useResourceConnections } from '@omniviewdev/useResourceConnections';
import ConnectionTable from '../components/connections/ConnectionTable';
import ConnectionListHeader from '../components/connections/ConnectionListHeader';


/**
 * Default home landing for the plugin.
 */
export default function PluginHome(): React.ReactElement {
  const [search, setSearch] = React.useState('');

  const plugin = usePluginContext();
  const { connections } = useConnections({ plugin: plugin.id });

  return (
    <Stack
      overflow={'auto'}
      direction={'column'}
      alignItems={'flex-start'}
      minHeight={0}
      flex={1}
    >
      <Stack direction='column' gap={1} p={1}>
        <ConnectionListHeader
          plugin={plugin.id}
          search={search}
          onSearchChange={setSearch}
        />

        {Boolean(connections.data?.length) && (
          <ConnectionTable connections={connections.data ?? []} />
        )}
      </Stack>
    </Stack>
  );
}

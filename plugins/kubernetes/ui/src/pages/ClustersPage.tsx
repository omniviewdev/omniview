import React from 'react';

// material-ui
import { Stack } from '@mui/joy';

// project imports
import { usePluginContext, useConnections } from '@omniviewdev/runtime';

import ConnectionTable from '../components/connections/ConnectionTable';
import ConnectionListHeader from '../components/connections/ConnectionListHeader';

/**
 * Lists the available clusters in the main window.
 */
export default function ClustersPage(): React.ReactElement {
  const [search, setSearch] = React.useState('');

  const { meta } = usePluginContext();
  const { connections } = useConnections({ plugin: meta.id });

  return (
    <Stack
      direction='column'
      gap={1}
      p={1}
      sx={{
        width: '100%',
        height: '100%',
      }}
    >
      <ConnectionListHeader
        plugin={meta.id}
        search={search}
        onSearchChange={setSearch}
      />

      {Boolean(connections.data?.length) && (
        <ConnectionTable connections={connections.data ?? []} search={search} />
      )}
    </Stack>
  );
}

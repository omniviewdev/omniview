import React from 'react';

// material-ui
import { Stack } from '@omniviewdev/ui/layout';

// project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnections } from '@omniviewdev/runtime';
import ConnectionTable from './ConnectionTable';
import ConnectionListHeader from './ConnectionListHeader';
import PluginBackdrop from './PluginBackdrop';

// Third-party
// import tinycolor from 'tinycolor2';

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
      <PluginBackdrop
        open={plugin.loading}
        message={`${plugin.metadata.name} plugin is reloading`}
      />

      <Stack direction='column' gap={1} p={1}>
        <ConnectionListHeader plugin={plugin.id} search={search} onSearchChange={setSearch} />

        {/* List of connections */}
        {Boolean(connections.data?.length) && (
          <ConnectionTable connections={connections.data ?? []} />
        )}
      </Stack>
    </Stack>
  );
}

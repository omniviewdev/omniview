import React from 'react';

// project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnections } from '@omniviewdev/runtime';
import ConnectionTable from './ConnectionTable';
import ConnectionListHeader from './ConnectionListHeader';
import PluginBackdrop from './PluginBackdrop';
import styles from './Home.module.css';

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
    <div className={styles.Root}>
      <PluginBackdrop
        open={plugin.phase === 'Starting' || plugin.phase === 'Validating'}
        message={`${plugin.metadata.name} plugin is reloading`}
      />

      <div className={styles.Content}>
        <ConnectionListHeader plugin={plugin.id} search={search} onSearchChange={setSearch} />

        {/* List of connections */}
        {Boolean(connections.data?.length) && (
          <ConnectionTable connections={connections.data ?? []} />
        )}
      </div>
    </div>
  );
}

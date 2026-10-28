import React from 'react';

// project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { parseAppError, useConnections, useConnectionProfiles } from '@omniviewdev/runtime';
import { Stack, Text } from '@omniviewdev/base-ui';
import { Link } from 'react-router-dom';
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
  const { profiles } = useConnectionProfiles({ pluginID: plugin.id });

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
        {profiles.isError && <Text tone="danger">{parseAppError(profiles.error).detail}</Text>}
        {profiles.data?.some((profile) => !profile.active) && (
          <Stack direction="column" spacing={2}>
            <Text weight="semibold">Inactive connection profiles</Text>
            <Text>Disabled connections and saved discovery entries are not active source connections.</Text>
            {profiles.data.filter((profile) => !profile.active).map((profile) => (
              <Link key={profile.id} to={`/plugin/${encodeURIComponent(plugin.id)}/connection/${encodeURIComponent(profile.id)}/edit`}>
                {profile.connection?.name ?? profile.id} — {profile.source === 'review' ? 'Review before import' : profile.source}
              </Link>
            ))}
          </Stack>
        )}
      </div>
    </div>
  );
}

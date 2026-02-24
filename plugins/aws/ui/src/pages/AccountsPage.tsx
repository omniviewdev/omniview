import React from 'react';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { usePluginContext, useConnections } from '@omniviewdev/runtime';
import type { EnrichedConnection, FilterState } from '../types/accounts';
import { useAccountPreferences } from '../hooks/useAccountPreferences';
import { DebouncedInput } from '../components/shared/DebouncedInput';
import ConnectionTable from '../components/connections/ConnectionTable';
import EmptyState from '../components/connections/EmptyState';

/** Determine if a connection is active based on refresh/expiry timestamps */
function isConnectionActive(conn: { last_refresh: any; expiry_time: number }): boolean {
  const refreshTime = new Date(conn.last_refresh);
  if (isNaN(refreshTime.getTime())) return false;
  return (refreshTime.getTime() + conn.expiry_time) > Date.now();
}

export default function AccountsPage(): React.ReactElement {
  const { meta } = usePluginContext();
  const { connections } = useConnections({ plugin: meta.id });
  const preferences = useAccountPreferences(meta.id);

  const [search, setSearch] = React.useState('');
  const [filters] = React.useState<FilterState>({});

  const enrichedConnections = React.useMemo<EnrichedConnection[]>(() => {
    const conns = connections.data ?? [];
    return conns
      .map((conn) => {
        const override = preferences.connectionOverrides[conn.id];
        const recent = preferences.recentConnections[conn.id];
        return {
          connection: conn,
          isFavorite: preferences.favorites.includes(conn.id),
          isConnected: isConnectionActive(conn),
          displayName: override?.displayName || conn.name || conn.id,
          displayDescription: override?.description || '',
          tags: override?.tags ?? [],
          lastAccessed: recent?.lastAccessed,
          accessCount: recent?.accessCount,
        };
      })
      .filter((e: EnrichedConnection) => {
        // Search filter
        if (search) {
          const s = search.toLowerCase();
          if (!e.displayName.toLowerCase().includes(s) && !e.connection.id.toLowerCase().includes(s)) {
            return false;
          }
        }
        // Status filter
        if (filters.status?.length) {
          const connected = e.isConnected ? 'connected' : 'disconnected';
          if (!filters.status.includes(connected)) return false;
        }
        return true;
      })
      .sort((a: EnrichedConnection, b: EnrichedConnection) => a.displayName.localeCompare(b.displayName));
  }, [connections.data, preferences, search, filters]);

  const noConnections = (connections.data?.length ?? 0) === 0;
  const noResults = !noConnections && enrichedConnections.length === 0;

  return (
    <Stack direction='column' sx={{ width: '100%', height: '100%', p: 1, gap: 1, overflow: 'auto' }}>
      <Stack direction='row' alignItems='center' justifyContent='space-between'>
        <Text weight="semibold" size="lg">AWS Accounts</Text>
      </Stack>

      {!noConnections && (
        <DebouncedInput
          value={search}
          onChange={(value: string) => setSearch(value)}
          placeholder='Search accounts...'
        />
      )}

      {noConnections && <EmptyState variant='no-connections' />}
      {noResults && <EmptyState variant='no-results' onClearFilters={() => setSearch('')} />}

      {!noConnections && !noResults && (
        <ConnectionTable
          connections={enrichedConnections}
          onToggleFavorite={preferences.toggleFavorite}
          onRecordAccess={preferences.recordAccess}
        />
      )}
    </Stack>
  );
}

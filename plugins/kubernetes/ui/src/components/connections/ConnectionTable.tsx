import React from 'react';
import Box from '@mui/material/Box';
import { Text } from '@omniviewdev/ui/typography';

import { usePluginContext, useConnection, useSnackbar } from '@omniviewdev/runtime';
import { usePluginRouter } from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';

import type {
  GroupedConnectionsResult,
  GroupByMode,
  ViewMode,
  ConnectionGroup,
  EnrichedConnection,
} from '../../types/clusters';
import ConnectionTableItem from './ConnectionTableItem';
import ConnectionCard from './ConnectionCard';
import ConnectionGroupComp from './ConnectionGroup';
import ColumnPicker from './ColumnPicker';

type Props = {
  grouped: GroupedConnectionsResult;
  groupBy: GroupByMode;
  viewMode: ViewMode;
  customGroups: ConnectionGroup[];
  collapsedGroups: Set<string>;
  visibleColumns: string[];
  allLabelKeys: string[];
  onToggleColumn: (column: string) => void;
  onToggleCollapse: (groupKey: string) => void;
  onToggleFavorite: (connectionId: string) => void;
  onAssignToGroup: (groupId: string, connectionId: string) => void;
  onRemoveFromGroup?: (groupId: string, connectionId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onDeleteRequest: (connectionId: string, connectionName: string) => void;
  onRecordAccess: (connectionId: string) => void;
};

const getColumnWidth = (connections: EnrichedConnection[], col: string) => {
  const px = 7;
  const maxLabelWidth = 400;
  let width = 0;

  for (const { connection } of connections) {
    if (!connection.labels) continue;
    const val = connection.labels[col];
    if (val) {
      const calcedWidth = String(val).length * px;
      if (calcedWidth > width) {
        width = calcedWidth > maxLabelWidth ? maxLabelWidth : calcedWidth;
      }
    }
  }

  return width;
};

/**
 * Helper sub-component for grid view of a single connection.
 * Handles connect/disconnect via hooks.
 */
const GridCardWrapper: React.FC<{
  enriched: EnrichedConnection;
  customGroups: ConnectionGroup[];
  onToggleFavorite: () => void;
  onAssignToGroup: (groupId: string) => void;
  onRemoveFromGroup?: (groupId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onDelete: () => void;
  onRecordAccess: () => void;
}> = ({ enriched, customGroups, onToggleFavorite, onAssignToGroup, onRemoveFromGroup, onCreateFolder, onDelete, onRecordAccess }) => {
  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  const { showSnackbar } = useSnackbar();
  const { startConnection, stopConnection } = useConnection({
    pluginID: meta.id,
    connectionID: enriched.connection.id,
  });

  const handleClick = () => {
    onRecordAccess();
    if (enriched.isConnected) {
      navigate(`/cluster/${encodeURIComponent(enriched.connection.id)}/resources`);
      return;
    }
    startConnection()
      .then(status => {
        if (status.status === types.ConnectionStatusCode.CONNECTED) {
          navigate(`/cluster/${encodeURIComponent(enriched.connection.id)}/resources`);
        }
      })
      .catch(err => {
        if (err instanceof Error) {
          showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
        }
      });
  };

  const handleConnect = () => {
    onRecordAccess();
    startConnection().catch(err => {
      if (err instanceof Error) {
        showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
      }
    });
  };

  const handleDisconnect = () => {
    stopConnection().catch(err => {
      if (err instanceof Error) {
        showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
      }
    });
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(enriched.connection.id);
    showSnackbar({ status: 'success', message: 'Connection ID copied' });
  };

  return (
    <ConnectionCard
      enriched={enriched}
      customGroups={customGroups}
      onClick={handleClick}
      onToggleFavorite={onToggleFavorite}
      onConnect={handleConnect}
      onDisconnect={handleDisconnect}
      onAssignToGroup={onAssignToGroup}
      onRemoveFromGroup={onRemoveFromGroup}
      onCreateFolder={onCreateFolder}
      onCopyId={handleCopyId}
      onDelete={onDelete}
    />
  );
};

/* ---- shared table styles ---- */
const thSx: React.CSSProperties = {
  padding: '4px 8px',
  textAlign: 'left',
  verticalAlign: 'middle',
  borderBottom: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
  whiteSpace: 'nowrap',
};

const ConnectionTable: React.FC<Props> = ({
  grouped,
  groupBy,
  viewMode,
  customGroups,
  collapsedGroups,
  visibleColumns,
  allLabelKeys,
  onToggleColumn,
  onToggleCollapse,
  onToggleFavorite,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onDeleteRequest,
  onRecordAccess,
}) => {
  const allConnections = grouped.groups.flatMap(g => g.connections);
  const isFlat = groupBy === 'none';

  if (viewMode === 'grid') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {grouped.groups.map(group => (
          <ConnectionGroupComp
            key={group.key}
            groupKey={group.key}
            label={group.label}
            count={group.connections.length}
            provider={group.provider}
            isCollapsed={collapsedGroups.has(group.key)}
            onToggleCollapse={() => onToggleCollapse(group.key)}
            hideHeader={isFlat}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 1.5,
                p: isFlat ? 0 : 1,
              }}
            >
              {group.connections.map(enriched => (
                <GridCardWrapper
                  key={enriched.connection.id}
                  enriched={enriched}
                  customGroups={customGroups}
                  onToggleFavorite={() => onToggleFavorite(enriched.connection.id)}
                  onAssignToGroup={(gId) => onAssignToGroup(gId, enriched.connection.id)}
                  onRemoveFromGroup={onRemoveFromGroup ? (gId) => onRemoveFromGroup(gId, enriched.connection.id) : undefined}
                  onCreateFolder={onCreateFolder}
                  onDelete={() => onDeleteRequest(enriched.connection.id, enriched.displayName)}
                  onRecordAccess={() => onRecordAccess(enriched.connection.id)}
                />
              ))}
            </Box>
          </ConnectionGroupComp>
        ))}
      </Box>
    );
  }

  // List view - only render visible label columns
  const sortedVisibleCols = visibleColumns.filter(c =>
    allConnections.some(e => e.connection.labels?.[c] !== undefined),
  ).sort();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {grouped.groups.map(group => (
        <ConnectionGroupComp
          key={group.key}
          groupKey={group.key}
          label={group.label}
          count={group.connections.length}
          provider={group.provider}
          isCollapsed={collapsedGroups.has(group.key)}
          onToggleCollapse={() => onToggleCollapse(group.key)}
          hideHeader={isFlat}
        >
          <Box
            sx={{
              width: '100%',
              borderRadius: 'var(--ov-radius-md, 6px)',
              overflow: 'auto',
              border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
              bgcolor: 'var(--ov-bg-surface, rgba(255,255,255,0.03))',
            }}
          >
            <table
              aria-label='connections table'
              style={{ width: '100%', borderCollapse: 'collapse' }}
            >
              <thead>
                <tr style={{ backgroundColor: 'var(--ov-bg-surface-inset, rgba(255,255,255,0.02))' }}>
                  <th style={{ ...thSx, width: 32, padding: '4px' }} />
                  <th style={{ ...thSx, width: '40%' }}>
                    <Text size='xs' weight='semibold' sx={{ color: 'var(--ov-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Name
                    </Text>
                  </th>
                  {sortedVisibleCols.map(col => (
                    <th
                      key={col}
                      style={{
                        ...thSx,
                        width: getColumnWidth(allConnections, col) + 8,
                      }}
                    >
                      <Text size='xs' weight='semibold' sx={{ color: 'var(--ov-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </Text>
                    </th>
                  ))}
                  <th style={{ ...thSx, width: 36, position: 'relative', textAlign: 'right' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
                      <ColumnPicker
                        allColumns={allLabelKeys}
                        visibleColumns={visibleColumns}
                        onToggleColumn={onToggleColumn}
                      />
                    </Box>
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.connections.map(enriched => (
                  <ConnectionTableItem
                    key={enriched.connection.id}
                    enriched={enriched}
                    visibleColumns={sortedVisibleCols}
                    customGroups={customGroups}
                    onToggleFavorite={() => onToggleFavorite(enriched.connection.id)}
                    onAssignToGroup={(gId) => onAssignToGroup(gId, enriched.connection.id)}
                    onRemoveFromGroup={onRemoveFromGroup ? (gId) => onRemoveFromGroup(gId, enriched.connection.id) : undefined}
                    onCreateFolder={onCreateFolder}
                    onDelete={() => onDeleteRequest(enriched.connection.id, enriched.displayName)}
                    onRecordAccess={() => onRecordAccess(enriched.connection.id)}
                  />
                ))}
              </tbody>
            </table>
          </Box>
        </ConnectionGroupComp>
      ))}
    </Box>
  );
};

export default ConnectionTable;

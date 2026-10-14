import React from 'react';
import { Avatar, Card, Stack, Text } from '@omniviewdev/base-ui';
import styles from './ConnectionCard.module.css';
import type { EnrichedConnection } from '../../types/accounts';
import FavoriteButton from './FavoriteButton';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import ConnectionContextMenu from './ConnectionContextMenu';
import NamedAvatar from '../shared/NamedAvatar';

const truncate: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

type Props = {
  enriched: EnrichedConnection;
  onClick: () => void;
  onToggleFavorite: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onCopyId: () => void;
};

const ConnectionCard: React.FC<Props> = ({
  enriched,
  onClick,
  onToggleFavorite,
  onConnect,
  onDisconnect,
  onCopyId,
}) => {
  const { connection, isFavorite, isConnected, displayName, displayDescription } = enriched;

  return (
    <Card
      variant='outline'
      className={styles.card}
      onClick={onClick}
    >
      <div style={{ padding: 12 }}>
        <Stack spacing={3}>
          <Stack direction='row' align='center' spacing={2}>
            <ConnectionStatusBadge isConnected={isConnected}>
              {connection.avatar ? (
                <Avatar
                  size='sm'
                  shape='rounded'
                  src={connection.avatar}
                  name={displayName}
                  style={{ borderRadius: 6, backgroundColor: 'transparent', maxHeight: 28, maxWidth: 28 }}
                />
              ) : (
                <NamedAvatar value={connection.name} />
              )}
            </ConnectionStatusBadge>
            <Stack spacing={0} style={{ flex: 1, minWidth: 0 }}>
              <Text weight="semibold" size="sm" style={truncate}>{displayName}</Text>
              {displayDescription && (
                <Text size="xs" style={{ opacity: 0.7, ...truncate }}>
                  {displayDescription}
                </Text>
              )}
            </Stack>
            <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
          </Stack>

          <Stack spacing={1}>
            {connection.labels?.region && (
              <Text size="xs" style={{ opacity: 0.6 }}>
                Region: {String(connection.labels.region)}
              </Text>
            )}
            {connection.labels?.profile && (
              <Text size="xs" style={{ opacity: 0.6, ...truncate }}>
                Profile: {String(connection.labels.profile)}
              </Text>
            )}
          </Stack>

          <Stack direction='row' justify='end' onClick={e => e.stopPropagation()}>
            <ConnectionContextMenu
              connectionId={connection.id}
              connectionName={displayName}
              isConnected={isConnected}
              isFavorite={isFavorite}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onToggleFavorite={onToggleFavorite}
              onCopyId={onCopyId}
            />
          </Stack>
        </Stack>
      </div>
    </Card>
  );
};

export default ConnectionCard;

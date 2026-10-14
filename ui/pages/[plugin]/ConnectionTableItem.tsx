import React from 'react';

// ui
import { Avatar, Badge, Chip, IconButton, Spinner, Text } from '@omniviewdev/base-ui';

// Project imports
import { usePluginContext } from '@/contexts/PluginContext';
import {
  useConnection,
  useSnackbar,
} from '@omniviewdev/runtime';

// Types
import { stringToColor } from '@/utils/color';
import { Connection, ConnectionStatus, ConnectionStatusCode } from '@omniviewdev/runtime/models';

// Icons
import { LuEllipsisVertical } from 'react-icons/lu';

// Third-party
import { usePluginRouter } from '@infraview/router';
import styles from './ConnectionTableItem.module.css';

type Props = Omit<Connection, 'createFrom' | 'convertValues'>;

const truncate = (input: string) => input.length > 60 ? `${input.substring(0, 60)}...` : input;

function stringAvatar(name: string): { color: string; initials: string } {
  if (!name) {
    return { color: 'var(--ov-color-fg-subtle)', initials: 'NA' };
  }

  if (name.length === 1) {
    return { color: stringToColor(name), initials: name.toUpperCase() };
  }

  // Try splitting on space
  let nameArr = name.split(' ');
  if (nameArr.length === 1) {
    // Try splitting on dash
    nameArr = name.split('-');
  }

  if (nameArr.length === 1) {
    return { color: stringToColor(name), initials: `${name[0].toUpperCase()}${name[1].toUpperCase()}` };
  }

  return {
    color: stringToColor(name),
    initials: `${nameArr[0][0].toUpperCase()}${nameArr[1][0].toUpperCase()}`,
  };
}

function TextAvatar({ name }: { name: string }) {
  const { color, initials } = stringAvatar(name);
  return (
    <Avatar
      size='sm'
      shape='rounded'
      deterministic={false}
      className={styles.Avatar}
      fallback={initials}
      fallbackProps={{ style: { backgroundColor: color, color: '#fff' } }}
    />
  );
}

const ConnectionTableItem: React.FC<Props> = ({ id, name, description, avatar, labels, last_refresh, expiry_time }) => {
  const plugin = usePluginContext();
  const { navigate } = usePluginRouter();
  const { showSnackbar } = useSnackbar();

  const { startConnection } = useConnection({ pluginID: plugin.id, connectionID: id });
  const [connecting, setConnecting] = React.useState(false);

  const handleConnectionStatus = (status: ConnectionStatus) => {
    switch (status.status) {
      case ConnectionStatusCode.ConnectionStatusUnauthorized:
        showSnackbar({
          status: 'warning',
          message: `Failed to authorize to '${name}'`,
          details: status.details,
          icon: 'LuShieldClose',
        });
        break;
      case ConnectionStatusCode.ConnectionStatusConnected:
        showSnackbar({
          status: 'success',
          message: `Connected to '${name}'`,
          icon: 'LuCheckCircle',
        });
        navigate(`/connection/${encodeURIComponent(id)}/resources`);
        break;
      default:
        showSnackbar({
          status: 'error',
          message: `Failed to connect to '${name}'`,
          details: status.details,
          icon: 'LuCircleAlert',
        });
    }
  };

  const handleClick = () => {
    setConnecting(true);
    startConnection()
      .then(status => {
        handleConnectionStatus(status);
      })
      .catch(err => {
        if (err instanceof Error) {
          showSnackbar({
            status: 'error',
            message: err.message,
            icon: 'LuCircleAlert',
          });
        }
      })
      .finally(() => {
        setConnecting(false);
      });
  };

  /**
   * Determines if we're connected
   */
  const isConnected = () => {
    // compute from last refresh (timestamp) and expiry time (duration)
    const refreshTime = new Date(last_refresh);
    // if we have no valid refresh time, we've never successfully connected
    if (isNaN(refreshTime.getTime())) {
      return false;
    }

    const now = new Date();
    return (refreshTime.getTime() + expiry_time) > now.getTime();
  };

  return (
    <tr
      id={`connection-${id}`}
      onClick={handleClick}
      className={styles.Row}
    >
      {/* Name */}
      <td className={styles.NameCell}>
        <Badge
          color='success'
          invisible={!isConnected()}
          variant='dot'
          position='top-right'
        >
          {avatar
            ? <Avatar
              size='sm'
              shape='rounded'
              src={avatar}
              alt={name}
              className={styles.ImageAvatar}
            />
            : <TextAvatar name={id} />
          }
        </Badge>
        <Text weight='semibold' size='sm' truncate>{name}</Text>
        {Boolean(description) && <Text size='sm' truncate>{description}</Text>}
        {connecting && <Spinner size='sm' />}
      </td>

      {/* Labels */}
      {labels && Object.entries(labels).sort().map(([key, value]) => (
        <td key={`${id}-${key}`}>
          <Chip
            variant='outline'
            color='neutral'
            size='sm'
            className={styles.LabelChip}
          >
            {truncate(value)}
          </Chip>
        </td>
      ))}


      {/* Actions */}
      <td>
        <div className={styles.Actions}>
          <IconButton
            aria-label='More'
            size='sm'
            variant='ghost'
            color='neutral'
          >
            <LuEllipsisVertical />
          </IconButton>
        </div>
      </td>
    </tr>
  );
};

export default ConnectionTableItem;

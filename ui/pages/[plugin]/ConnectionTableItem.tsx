import React from 'react';

// Material-ui
import Avatar from '@mui/joy/Avatar';
import Badge from '@mui/joy/Badge';
import Chip from '@mui/joy/Chip';
import CircularProgress from '@mui/joy/CircularProgress';
import Dropdown from '@mui/joy/Dropdown';
import IconButton from '@mui/joy/IconButton';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import Menu from '@mui/joy/Menu';
import MenuButton from '@mui/joy/MenuButton';
import MenuItem from '@mui/joy/MenuItem';
import Typography from '@mui/joy/Typography';

// Project imports
import { usePluginContext } from '@/contexts/PluginContext';
import {
  useConnection,
  useSnackbar,
} from '@omniviewdev/runtime';

// Types
import { stringToColor } from '@/utils/color';
import { types } from '@omniviewdev/runtime/models';

// Icons
import { MoreVert } from '@mui/icons-material';
import { LuPencil, LuTrash } from 'react-icons/lu';

// Third-party
import { Link, usePluginRouter } from '@infraview/router';

type Props = Omit<types.Connection, 'createFrom' | 'convertValues'>;

const truncate = (input: string) => input.length > 60 ? `${input.substring(0, 60)}...` : input;

function stringAvatar(name: string) {
  if (!name) {
    return {
      sx: {
        bgcolor: 'grey.500',
        borderRadius: 6,
      },
      children: 'NA',
    };
  }

  if (name.length === 1) {
    return {
      sx: {
        bgcolor: stringToColor(name),
        borderRadius: 6,
      },
      children: name.toUpperCase(),
    };
  }

  // Try splitting on space
  let nameArr = name.split(' ');
  if (nameArr.length === 1) {
    // Try splitting on dash
    nameArr = name.split('-');
  }

  if (nameArr.length === 1) {
    return {
      sx: {
        maxHeight: 28,
        maxWidth: 28,
        bgcolor: stringToColor(name),
        borderRadius: 6,
      },
      children: `${name[0].toUpperCase()}${name[1].toUpperCase()}`,
    };
  }

  return {
    sx: {
      maxHeight: 28,
      maxWidth: 28,
      bgcolor: stringToColor(name),
      borderRadius: 6,
    },
    children: `${nameArr[0][0].toUpperCase()}${nameArr[1][0].toUpperCase()}`,
  };
}

const ConnectionTableItem: React.FC<Props> = ({ id, name, description, avatar, labels, last_refresh, expiry_time }) => {
  const plugin = usePluginContext();
  const { navigate } = usePluginRouter();
  const { showSnackbar } = useSnackbar();

  const { startConnection } = useConnection({ pluginID: plugin.id, connectionID: id });
  const [connecting, setConnecting] = React.useState(false);

  const handleConnectionStatus = (status: types.ConnectionStatus) => {
    switch (status.status) {
      case types.ConnectionStatusCode.UNAUTHORIZED:
        showSnackbar({
          status: 'warning',
          message: `Failed to authorize to '${name}'`,
          details: status.details,
          icon: 'LuShieldClose',
        });
        break;
      case types.ConnectionStatusCode.CONNECTED:
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
    if (isConnected()) {
      navigate(`/connection/${encodeURIComponent(id)}/resources`);
      return;
    }

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
    // if we have no valid refresh time, we can't determine if the connection is connected, so assume we are
    if (refreshTime.toString() === 'Invalid Date') {
      console.log('Invalid Date for refresh time', last_refresh);
      return true;
    }

    const now = new Date();
    return (refreshTime.getTime() + expiry_time) > now.getTime();
  };

  return (
    <tr
      id={`connection-${id}`}
      onClick={handleClick}
      style={{
        cursor: 'pointer',
      }}
    >
      {/* Name */}
      <td style={{ display: 'flex', flex: 1, gap: 14, justifyContent: 'flex-start', alignItems: 'center' }} >
        <Badge
          color="success"
          invisible={!isConnected()}
          size='sm'
          anchorOrigin={{
            vertical: 'top',
            horizontal: 'right',
          }}
        >
          {avatar
            ? <Avatar
              size='sm'
              src={avatar}
              sx={{
                borderRadius: 6,
                backgroundColor: 'transparent',
                objectFit: 'contain',
                border: 0,
                maxHeight: 28,
                maxWidth: 28,
              }}
            />
            : <Avatar
              size='sm'
              {...stringAvatar(id || '')}
            />
          }
        </Badge>
        <Typography level='title-sm' noWrap>{name}</Typography>
        {Boolean(description) && <Typography level='body-sm' noWrap>{description}</Typography>}
        {connecting && <CircularProgress size='sm' />}
      </td>

      {/* Labels */}
      {labels && Object.entries(labels).sort().map(([key, value]) => (
        <td key={`${id}-${key}`}>
          <Chip
            id={`${id}-${key}`}
            variant='outlined'
            color='neutral'
            size='sm'
            sx={{ pointerEvents: 'none', borderRadius: 'sm' }}
          >
            {truncate(value)}
          </Chip>
        </td>
      ))}


      {/* Actions */}
      <td>
        <Dropdown>
          <MenuButton
            aria-label='More'
            size='sm'
            color='primary'
            slots={{ root: IconButton }}
            slotProps={{ root: { variant: 'plain', color: 'neutral' } }}
          >
            <MoreVert />
          </MenuButton>
          <Menu size='sm' placement='bottom-end'>
            <Link to={`/connection/${id}/edit`}>
              <MenuItem>
                <ListItemDecorator>
                  <LuPencil />
                </ListItemDecorator>{' '}
                Edit '{name}'
              </MenuItem>
            </Link>
            <MenuItem>
              <ListItemDecorator>
                <LuTrash />
              </ListItemDecorator>{' '}
              Delete '{name}'
            </MenuItem>
          </Menu>
        </Dropdown>
      </td>
    </tr>
  );
};

export default ConnectionTableItem;

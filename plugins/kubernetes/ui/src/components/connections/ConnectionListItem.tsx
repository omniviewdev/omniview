import React from 'react';
import { Link, usePluginRouter } from '@omniviewdev/runtime';

// Material-ui
import {
  Avatar,
  Badge,
  Chip,
  CircularProgress,
  Dropdown,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Menu,
  MenuButton,
  MenuItem,
  Stack,
  Typography,
} from '@mui/joy';

import {
  usePluginContext,
  useConnection,
  useSnackbar,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import NamedAvatar from '../shared/NamedAvatar';

// Icons
import { MoreVert } from '@mui/icons-material';
import { LuPencil, LuTrash } from 'react-icons/lu';

type Props = Omit<types.Connection, 'createFrom' | 'convertValues'>;

const ConnectionListItem: React.FC<Props> = ({ id, name, description, avatar, labels, last_refresh, expiry_time }) => {
  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  const { showSnackbar } = useSnackbar();

  const { startConnection } = useConnection({ pluginID: meta.id, connectionID: id });
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
        navigate(`/connection/${id}/resources`);
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
      navigate(`/connection/${id}/resources`);
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
    <ListItem
      id={`connection-${id}`}
      endAction={
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
      }
    >
      <ListItemButton
        sx={{ borderRadius: 'sm' }}
        onClick={handleClick}
      >
        <ListItemDecorator >
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
              : <NamedAvatar value={name} />
            }
          </Badge>
        </ListItemDecorator>
        <Stack direction='row' width={'100%'} alignItems={'center'}>
          <Stack direction='row' width={'100%'} height={'100%'} alignItems={'center'} gap={2} >
            <Typography level='title-sm' noWrap>{name}</Typography>
            {Boolean(description) && <Typography level='body-sm' noWrap>{description}</Typography>}
            {connecting && <CircularProgress size='sm' />}
          </Stack>
          <Stack direction='row' spacing={1} alignItems={'center'}>
            {labels && Object.entries(labels).sort().map(([key, _]) => (
              <Chip
                key={key}
                variant='outlined'
                color='primary'
                size='sm'
                sx={{ pointerEvents: 'none', borderRadius: 'sm' }}
              >

                {key}
              </Chip>
            ))}
          </Stack>

        </Stack>
      </ListItemButton>
    </ListItem>
  );
};

export default ConnectionListItem;

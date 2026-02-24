import React from 'react';
import { Link, usePluginRouter } from '@omniviewdev/runtime';

// @omniviewdev/ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Avatar, Badge, Chip } from '@omniviewdev/ui';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

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
  const [menuOpen, setMenuOpen] = React.useState(false);

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
    <Box
      id={`connection-${id}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        py: 0.5,
        px: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          borderRadius: 'sm',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'background.level1' },
          py: 0.5,
          px: 1,
        }}
        onClick={handleClick}
      >
        <Box sx={{ mr: 1.5, display: 'flex' }}>
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
        </Box>
        <Stack direction='row' sx={{ width: '100%' }} alignItems='center'>
          <Stack direction='row' sx={{ width: '100%', height: '100%' }} alignItems='center' gap={2}>
            <Text weight='semibold' size='sm' noWrap>{name}</Text>
            {Boolean(description) && <Text size='sm' noWrap>{description}</Text>}
            {connecting && <CircularProgress size={16} />}
          </Stack>
          <Stack direction='row' gap={1} alignItems='center'>
            {labels && Object.entries(labels).sort().map(([key, _]) => (
              <Chip
                key={key}
                emphasis='outline'
                color='primary'
                size='sm'
                sx={{ pointerEvents: 'none', borderRadius: 'sm' }}
                label={key}
              />
            ))}
          </Stack>
        </Stack>
      </Box>
      <Box sx={{ position: 'relative' }}>
        <IconButton
          size='sm'
          emphasis='ghost'
          color='neutral'
          onClick={() => setMenuOpen(prev => !prev)}
        >
          <MoreVert />
        </IconButton>
        {menuOpen && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 999 }}
              onClick={() => setMenuOpen(false)}
            />
            <Box
              sx={{
                position: 'absolute',
                right: 0,
                top: '100%',
                zIndex: 1000,
                bgcolor: 'background.surface',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 'sm',
                boxShadow: 'md',
                py: 0.5,
                minWidth: 140,
              }}
            >
              <Link to={`/connection/${id}/edit`}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 0.75,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'background.level1' },
                  }}
                  onClick={() => setMenuOpen(false)}
                >
                  <LuPencil size={14} />
                  <Text size='sm'>Edit '{name}'</Text>
                </Box>
              </Link>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'background.level1' },
                }}
                onClick={() => setMenuOpen(false)}
              >
                <LuTrash size={14} />
                <Text size='sm'>Delete '{name}'</Text>
              </Box>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};

export default ConnectionListItem;

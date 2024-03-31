import React from 'react';

// Material-ui
import Avatar from '@mui/joy/Avatar';
import Badge from '@mui/joy/Badge';
import Chip from '@mui/joy/Chip';
import CircularProgress from '@mui/joy/CircularProgress';
import Dropdown from '@mui/joy/Dropdown';
import IconButton from '@mui/joy/IconButton';
import ListItem from '@mui/joy/ListItem';
import ListItemButton from '@mui/joy/ListItemButton';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import Menu from '@mui/joy/Menu';
import MenuButton from '@mui/joy/MenuButton';
import MenuItem from '@mui/joy/MenuItem';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

// Project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnection } from '@/hooks/connection/useConnection';

// Types
import { stringToColor } from '@/utils/color';
import { type types } from '@api/models';

// Icons
import { MoreVert } from '@mui/icons-material';
import { LuPencil, LuTrash } from 'react-icons/lu';

// Third-party
import { Link, usePluginRouter } from '@infraview/router';

type Props = Omit<types.Connection, 'createFrom' | 'convertValues'>;

function stringAvatar(name: string) {
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

const ConnectionListItem: React.FC<Props> = ({ id, name, description, avatar, labels, last_refresh, expiry_time }) => {
  const plugin = usePluginContext();
  const { navigate } = usePluginRouter();

  const { startConnection } = useConnection({ pluginID: plugin.id, connectionID: id });
  const [connecting, setConnecting] = React.useState(false);

  const handleClick = () => {
    if (isConnected()) {
      navigate(`/connection/${id}/resources`);
      return;
    }

    setConnecting(true);
    startConnection()
      .then(_ => {
        navigate(`/connection/${id}/resources`);
      })
      .catch(_ => {
        console.log('not connected');
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
              : <Avatar
                size='sm'
                {...stringAvatar(id || '')}
              />
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

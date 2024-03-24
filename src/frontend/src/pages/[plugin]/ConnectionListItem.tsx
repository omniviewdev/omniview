import React from 'react';

// Material-ui
import Avatar from '@mui/joy/Avatar';
import Chip from '@mui/joy/Chip';
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

// Types
import { stringToColor } from '@/utils/color';
import { type types } from '@api/models';

// Icons
import { MoreVert } from '@mui/icons-material';
import { LuPencil, LuTrash } from 'react-icons/lu';

// Third-party
import { Link } from '@infraview/router';

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

const ConnectionListItem: React.FC<Props> = ({ id, name, description, avatar, labels }) => (
  <Link to={`/connection/${id}/resources`}>
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
      <ListItemButton sx={{ borderRadius: 'sm' }}>
        <ListItemDecorator >
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
        </ListItemDecorator>
        <Stack direction='row' width={'100%'} alignItems={'center'}>
          <Stack direction='column' width={'100%'}>
            <Typography level='title-sm' noWrap>{name}</Typography>
            {Boolean(description) && <Typography level='body-sm' noWrap>{description}</Typography>}
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
  </Link>
);

export default ConnectionListItem;

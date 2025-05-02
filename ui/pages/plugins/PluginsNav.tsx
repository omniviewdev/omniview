import React from 'react';

// Material-ui
import {
  Avatar,
  Chip,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Stack,
  Typography,
} from '@mui/joy';

// Mock data
import mock from './mock/plugins.json';
import { LuCheck } from 'react-icons/lu';

type Props = {
  selected: any;
  onChange: (selection: any) => void;
  installed: string[] | undefined;
};

/**
 * The navigation content for the settings page.
 */
const PluginsNav: React.FC<Props> = ({ selected, onChange, installed }) => (
  <List
    size='sm'
    sx={{
      '--ListItem-radius': 'var(--joy-radius-sm)',
      '--ListItemDecorator-size': '56px',
      '--ListItemDecorator-radius': '1px',
      maxWidth: 700,
    }}
    aria-label='plugins list'
  >
    {mock.map(plugin => (
      <ListItem key={plugin.id}>
        <ListItemButton selected={selected?.id === plugin?.id} sx={{ py: 1, px: 2 }} onClick={() => {
          onChange(plugin);
        }}>
          <ListItemDecorator>
            <Avatar size='md' src={plugin.icon} variant='plain' sx={{ borderRadius: 4 }} />
          </ListItemDecorator>
          <div>
            <Stack direction='row' spacing={2} justifyContent={'space-between'}>
              <Typography fontSize='md' fontWeight={700}>{plugin.name}</Typography>
              {installed && installed.includes(plugin.id) && (
                <Chip size='sm' color='primary' sx={{ borderRadius: 'sm', maxHeight: 20 }} startDecorator={<LuCheck />}>Installed</Chip>
              )}
            </Stack>
            <Typography
              fontSize='xs'
              textOverflow={'clip'}
              sx={{
                display: 'WebkitBox',
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
              }}
            >
              {plugin.description}
            </Typography>
          </div>
        </ListItemButton>
      </ListItem>
    ))}
  </List >
);

export default PluginsNav;

import React from 'react';

// material-ui
import Avatar from '@mui/joy/Avatar';
import Stack from '@mui/joy/Stack';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemButton from '@mui/joy/ListItemButton';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import Typography from '@mui/joy/Typography';

// mock data
import mock from './mock/plugins.json'

type Props = {
  selected: any;
  onChange: (selection: any) => void;
}

/**
 * The navigation content for the settings page.
 */
const PluginsNav: React.FC<Props> = ({ selected, onChange }) => {
  return (
    <List
      size="sm"
      sx={{
        '--ListItem-radius': 'var(--joy-radius-sm)',
        '--ListItemDecorator-size': '56px',
        '--ListItemDecorator-radius': '1px',
        maxWidth: 700,
      }}
      aria-label="plugins list"
    >
      {mock.map((plugin) => (
        <ListItem key={plugin.id}>
          <ListItemButton selected={selected?.id === plugin?.id} sx={{ py: 1, px: 2 }} onClick={() => onChange(plugin)}>
            <ListItemDecorator>
              <Avatar size="md" src={plugin.icon} variant='plain' sx={{ borderRadius: 4 }} />
            </ListItemDecorator>
            <div>
              <Stack direction="row" spacing={2}>
                <Typography fontSize="md" fontWeight={700}>{plugin.name}</Typography>
              </Stack>
              <Typography
                fontSize="xs"
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
}

export default PluginsNav;

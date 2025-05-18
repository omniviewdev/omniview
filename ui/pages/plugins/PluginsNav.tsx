import React from 'react';

// Material-ui
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Stack,
  Typography,
} from '@mui/joy';

// Mock data
import { LuCheck } from 'react-icons/lu';
import { Link, useParams } from 'react-router-dom';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { IsImage } from '@/utils/url';
import Icon from '@/components/icons/Icon';

type Props = {
  installed: string[] | undefined;
};

/**
 * The navigation content for the settings page.
 */
const PluginsNav: React.FC<Props> = ({ installed }) => {
  const { id = '' } = useParams<{ id: string }>()
  const { available } = usePluginManager()

  if (available.isLoading) {
    return <Box sx={{ height: '100%', width: '100%', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress />
    </Box>
  }

  return (
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
      {available.data?.map(plugin => (
        <ListItem
          key={plugin.id}
          component={Link}
          to={`/plugins/${plugin.id}`}
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <ListItemButton
            selected={id === plugin?.id}
            sx={{ py: 1, px: 2 }}
          >
            <ListItemDecorator>
              {IsImage(plugin?.icon) ? (
                <Avatar
                  size='sm'
                  src={plugin.icon}
                  variant='plain'
                  sx={{
                    borderRadius: 4,
                    backgroundColor: 'transparent',
                    objectFit: 'contain',
                    border: 0,
                    width: '42px',
                    height: '42px',
                  }}
                />
              ) : <Icon name={plugin?.icon || ''} size={42} />}
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
  )
};

export default PluginsNav;

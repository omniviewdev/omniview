import React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Avatar, Chip, List, ListItem } from '@omniviewdev/ui';

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
          <Box
            sx={{ py: 1, px: 2, display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', borderRadius: 1, bgcolor: id === plugin?.id ? 'action.selected' : 'transparent' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42 }}>
              {IsImage(plugin?.icon) ? (
                <Avatar
                  size='sm'
                  src={plugin.icon}
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
            </Box>
            <div>
              <Stack direction='row' spacing={2} justifyContent={'space-between'}>
                <Text sx={{ fontSize: 'md', fontWeight: 700 }}>{plugin.name}</Text>
                {installed && installed.includes(plugin.id) && (
                  <Chip size='sm' color='primary' label='Installed' icon={<LuCheck />} sx={{ borderRadius: 'sm', maxHeight: 20 }} />
                )}
              </Stack>
              <Text
                size='xs'
                sx={{
                  display: 'WebkitBox',
                  overflow: 'hidden',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 2,
                }}
              >
                {plugin.description}
              </Text>
            </div>
          </Box>
        </ListItem>
      ))}
    </List >
  )
};

export default PluginsNav;

import React from 'react';

// Material-ui
import Avatar from '@mui/joy/Avatar';
import Divider from '@mui/joy/Divider';
import Sheet from '@mui/joy/Sheet';
import List from '@mui/joy/List';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

// Project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnections } from '@/hooks/connection/useConnections';
import ConnectionListItem from './ConnectionListItem';
import ConnectionListHeader from './ConnectionListHeader';
import PluginBackdrop from './PluginBackdrop';

// Third-party
import tinycolor from 'tinycolor2';

/**
 * Default home landing for the plugin.
 */
export default function PluginHome(): React.ReactElement {
  const [search, setSearch] = React.useState('');

  const plugin = usePluginContext();
  const { connections } = useConnections({ plugin: plugin.id });

  if (connections.isLoading) {
    return (<></>);
  }

  return (
    <Stack
      p={2}
      spacing={2}
      overflow={'auto'}
      direction={'column'}
      alignItems={'flex-start'}
      maxHeight={'100%'}
      minHeight={'100%'}
      sx={{
        background: `linear-gradient(109.6deg, rgb(36, 45, 57) 2.2%, ${tinycolor(plugin.metadata.theme.colors.primary).setAlpha(0.2).toString()} 50.2%, rgb(0, 0, 0) 98.6%);`,
      }}
    >
      <PluginBackdrop
        open={plugin.loading}
        message={`${plugin.metadata.name} plugin is reloading`}
      />
      <Sheet
        sx={{
          width: '100%',
          backgroundColor: 'transparent',
          display: 'flex',
          gap: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
        variant='soft'
      >
        <Stack direction='row' alignItems='center' gap={1.5}>
          <Avatar size='sm' src={plugin.metadata.icon} variant='plain' sx={{ borderRadius: 4 }} />
          <Typography level='h3' >{plugin.metadata.name}</Typography>
        </Stack>
        <Typography level='title-sm' >{plugin.metadata.description}</Typography>
      </Sheet>
      <Sheet sx={{ backgroundColor: 'transparent', borderRadius: 8, width: '100%' }} variant='outlined'>
        <ConnectionListHeader plugin={plugin.id} search={search} onSearchChange={setSearch} />
        <Divider />

        {/* List of connections */}
        {Boolean(connections.data?.length) && (
          <List
            variant='plain'
            component='nav'
            size='md'
            sx={{
              p: 0.5,
              width: '100%',
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
              borderBottomRightRadius: 'sm',
              borderBottomLeftRadius: 'sm',
              backgroundColor: theme => theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)',
              opacity: 0.9,
              '--ListItem-paddingY': '0px',
            }}
          >
            {connections.data
              ?.filter(connection => connection.name.toLowerCase().includes(search.toLowerCase()))
              .map(connection => (
                <ConnectionListItem key={connection.id} {...connection} />
              ))}
          </List>
        )}
      </Sheet>
    </Stack>
  );
}

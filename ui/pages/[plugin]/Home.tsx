import React from 'react';

// material-ui
// import Avatar from '@mui/joy/Avatar';
// import Divider from '@mui/joy/Divider';
// import Sheet from '@mui/joy/Sheet';
import Stack from '@mui/joy/Stack';
// import Typography from '@mui/joy/Typography';

// project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnections } from '@omniviewdev/runtime';
import ConnectionTable from './ConnectionTable';
import ConnectionListHeader from './ConnectionListHeader';
import PluginBackdrop from './PluginBackdrop';

// Third-party
// import tinycolor from 'tinycolor2';

/**
 * Default home landing for the plugin.
 */
export default function PluginHome(): React.ReactElement {
  const [search, setSearch] = React.useState('');

  const plugin = usePluginContext();
  const { connections } = useConnections({ plugin: plugin.id });

  return (
    <Stack
      overflow={'auto'}
      direction={'column'}
      alignItems={'flex-start'}
      minHeight={0}
      flex={1}
    >
      <PluginBackdrop
        open={plugin.loading}
        message={`${plugin.metadata.name} plugin is reloading`}
      />

      {/* <Sheet */}
      {/*   sx={{ */}
      {/*     width: '100%', */}
      {/*     display: 'flex', */}
      {/*     gap: 1, */}
      {/*     p: 1, */}
      {/*     alignItems: 'center', */}
      {/*     justifyContent: 'space-between', */}
      {/*   }} */}
      {/* > */}
      {/*   <Stack direction='row' alignItems='center' gap={1.5}> */}
      {/*     <Avatar */}
      {/*       src={plugin.metadata.icon} */}
      {/*       variant='plain' */}
      {/*       sx={{ */}
      {/*         borderRadius: 'sm', */}
      {/*         width: 22, */}
      {/*         height: 22, */}
      {/*       }} */}
      {/*     /> */}
      {/*     <Typography level='h4' >{plugin.metadata.name}</Typography> */}
      {/*   </Stack> */}
      {/*   <Typography level='body-sm' >{plugin.metadata.description}</Typography> */}
      {/* </Sheet> */}
      {/* <Divider /> */}

      <Stack direction='column' gap={1} p={1}>
        <ConnectionListHeader plugin={plugin.id} search={search} onSearchChange={setSearch} />

        {/* List of connections */}
        {Boolean(connections.data?.length) && (
          <ConnectionTable connections={connections.data ?? []} />
        )}
      </Stack>
    </Stack>
  );
}

import React from 'react';

// Material-ui
import Breadcrumbs from '@mui/material/Breadcrumbs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Avatar } from '@omniviewdev/ui';

// Project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnection } from '@omniviewdev/runtime';

// Third-party
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Close } from '@mui/icons-material';
import PluginBackdrop from '../PluginBackdrop';

/**
 * Langing page for editing a connection for a plugin
 */
export default function EditConnection(): React.ReactElement {
  const plugin = usePluginContext();
  const navigate = useNavigate();

  const { connectionID = '' } = useParams<{ pluginID: string; connectionID: string }>();
  const { connection } = useConnection({ pluginID: plugin.id, connectionID });

  if (connection.isLoading) {
    return (<></>);
  }

  if (connection.isError) {
    return (<>{connection.error}</>);
  }

  return (
    <Stack
      py={1}
      px={2}
      spacing={2}
      overflow={'auto'}
      direction={'column'}
      alignItems={'flex-start'}
      maxHeight={'100%'}
      minHeight={'100%'}
    >

      <PluginBackdrop
        open={plugin.phase === 'Starting' || plugin.phase === 'Validating'}
        message={`${plugin.metadata.name} plugin is reloading`}
      />
      <Stack direction='row' alignItems='center' justifyContent={'space-between'} width={'100%'} gap={1.5}>
        <Breadcrumbs separator='>' aria-label='breadcrumbs'>
          <Link to={`/plugin/${plugin.id}`} style={{
            textDecoration: 'none', color: 'inherit', display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <Avatar size='sm' src={plugin.metadata.icon} sx={{ borderRadius: 4, height: 18, width: 18 }} />
            <Text weight='semibold'>{plugin.metadata.name}</Text>
          </Link>
          <Link to={`/plugin/${plugin.id}`} style={{
            textDecoration: 'none', color: 'inherit', display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <Text weight='semibold'>Connections</Text>
          </Link>
          <Text>{connection.data?.name}</Text>
        </Breadcrumbs>
        <IconButton
          emphasis='soft'
          color='neutral'
          size='sm'
          onClick={() => {
            navigate(-1);
          }}
        >
          <Close />
        </IconButton>
      </Stack>
      <div>
        <pre>{JSON.stringify(connection.data, null, 2)}</pre>
      </div>
    </Stack>
  );
}

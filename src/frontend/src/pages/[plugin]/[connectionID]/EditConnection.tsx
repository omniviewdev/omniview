import React from 'react';

// Material-ui
import Avatar from '@mui/joy/Avatar';
import Breadcrumbs from '@mui/joy/Breadcrumbs';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

// Project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnection } from '@/hooks/connection/useConnection';

// Third-party
import { useParams, Link, useNavigate } from 'react-router-dom';
import { IconButton } from '@mui/joy';
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
      // Sx={{
      //   background: `linear-gradient(109.6deg, rgb(36, 45, 57) 2.2%, ${tinycolor(plugin.metadata.theme.colors.primary).setAlpha(0.2).toString()} 50.2%, rgb(0, 0, 0) 98.6%);`,
      // }}
    >

      <PluginBackdrop
        open={plugin.loading}
        message={`${plugin.metadata.name} plugin is reloading`}
      />
      <Stack direction='row' alignItems='center' justifyContent={'space-between'} width={'100%'} gap={1.5}>
        <Breadcrumbs separator='›' aria-label='breadcrumbs'>
          <Link to={`/plugin/${plugin.id}`} style={{
            textDecoration: 'none', color: 'inherit', display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <Avatar size='sm' src={plugin.metadata.icon} variant='plain' sx={{ borderRadius: 4, height: 18, width: 18 }} />
            <Typography level='title-md'>{plugin.metadata.name}</Typography>
          </Link>
          <Link to={`/plugin/${plugin.id}`} style={{
            textDecoration: 'none', color: 'inherit', display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <Typography level='title-md'>Connections</Typography>
          </Link>
          <Typography level='body-md'>{connection.data?.name}</Typography>
        </Breadcrumbs>
        <IconButton
          variant='soft'
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

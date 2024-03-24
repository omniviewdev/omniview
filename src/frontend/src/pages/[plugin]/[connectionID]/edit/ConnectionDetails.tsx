import React from 'react';

// Material-ui
import Avatar from '@mui/joy/Avatar';
import Input from '@mui/joy/Input';
import Grid from '@mui/joy/Grid';
import Stack from '@mui/joy/Stack';

// Project imports
import { useConnection } from '@/hooks/connection/useConnection';
import { Textarea } from '@mui/joy';
import { useParams } from 'react-router-dom';

export default function ConnectionDetails(): React.ReactElement {
  const { pluginID = '', connectionID = '' } = useParams<{ pluginID: string; connectionID: string }>();
  const { connection } = useConnection({ pluginID, connectionID });

  if (connection.isLoading) {
    return (<></>);
  }

  if (connection.isError) {
    return (<>{connection.error}</>);
  }

  if (connection.data === undefined) {
    return (<></>);
  }

  return (
    <Grid container spacing={4}>
      <Grid xs={12}>
        <Stack direction='row' spacing={2} alignItems='center' justifyContent={'stretch'}>
          <Avatar size='lg' src={connection.data.avatar} variant='plain' />
          <Input variant='outlined' defaultValue={connection.data.name} />
        </Stack>
      </Grid>
      <Grid xs={12}>
        <Textarea variant='outlined' minRows={3} defaultValue={connection.data.description} />
      </Grid>
      <Grid xs={12}>

      </Grid>
    </Grid>
  );
}

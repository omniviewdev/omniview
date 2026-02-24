import React from 'react';

// Material-ui
import Grid from '@mui/material/Grid';
import { Stack } from '@omniviewdev/ui/layout';
import { Avatar } from '@omniviewdev/ui';
import { TextField, TextArea } from '@omniviewdev/ui/inputs';

// Project imports
import { useConnection } from '@omniviewdev/runtime';
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
      <Grid size={12}>
        <Stack direction='row' spacing={2} alignItems='center' justifyContent={'stretch'}>
          <Avatar size='lg' src={connection.data.avatar} />
          <TextField defaultValue={connection.data.name} />
        </Stack>
      </Grid>
      <Grid size={12}>
        <TextArea minRows={3} defaultValue={connection.data.description} />
      </Grid>
      <Grid size={12}>

      </Grid>
    </Grid>
  );
}

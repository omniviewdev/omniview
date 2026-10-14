import React from 'react';

// ui
import { Avatar, Grid, Stack, TextArea, TextField } from '@omniviewdev/base-ui';

// Project imports
import { useConnection } from '@omniviewdev/runtime';
import { useParams } from 'react-router-dom';
import styles from './ConnectionDetails.module.css';

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
    <Grid columns={12} spacing={4}>
      <Grid.Item span={12}>
        <Stack direction='row' spacing={2} align='center'>
          <Avatar size='lg' src={connection.data.avatar} name={connection.data.name} />
          <TextField.Root className={styles.Field}>
            <TextField.Control defaultValue={connection.data.name} />
          </TextField.Root>
        </Stack>
      </Grid.Item>
      <Grid.Item span={12}>
        <TextArea.Root>
          <TextArea.Control rows={3} defaultValue={connection.data.description} />
        </TextArea.Root>
      </Grid.Item>
      <Grid.Item span={12}>

      </Grid.Item>
    </Grid>
  );
}

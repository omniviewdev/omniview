import React from 'react';

// ui
import { Avatar, Breadcrumbs, IconButton, Stack, Text } from '@omniviewdev/base-ui';

// Project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnection } from '@omniviewdev/runtime';

// Third-party
import { useParams, Link, useNavigate } from 'react-router-dom';
import { LuX } from 'react-icons/lu';
import PluginBackdrop from '../PluginBackdrop';
import styles from './EditConnection.module.css';

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
    <div className={styles.Root}>

      <PluginBackdrop
        open={plugin.phase === 'Starting' || plugin.phase === 'Validating'}
        message={`${plugin.metadata.name} plugin is reloading`}
      />
      <Stack direction='row' align='center' justify='between' spacing={3} className={styles.Header}>
        <Breadcrumbs separator='>' aria-label='breadcrumbs'>
          <Breadcrumbs.Item>
            <Link to={`/plugin/${plugin.id}`} className={styles.CrumbLink}>
              <Avatar size='sm' shape='rounded' src={plugin.metadata.icon} alt={plugin.metadata.name} className={styles.PluginIcon} />
              <Text weight='semibold'>{plugin.metadata.name}</Text>
            </Link>
          </Breadcrumbs.Item>
          <Breadcrumbs.Item>
            <Link to={`/plugin/${plugin.id}`} className={styles.CrumbLink}>
              <Text weight='semibold'>Connections</Text>
            </Link>
          </Breadcrumbs.Item>
          <Breadcrumbs.Item active>
            <Text>{connection.data?.name}</Text>
          </Breadcrumbs.Item>
        </Breadcrumbs>
        <IconButton
          variant='soft'
          color='neutral'
          size='sm'
          aria-label='Close'
          onClick={() => {
            navigate(-1);
          }}
        >
          <LuX />
        </IconButton>
      </Stack>
      <div>
        <pre>{JSON.stringify(connection.data, null, 2)}</pre>
      </div>
    </div>
  );
}

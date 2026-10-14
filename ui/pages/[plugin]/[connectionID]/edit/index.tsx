import React from 'react';

// ui
import { Avatar, Breadcrumbs, IconButton, Stack, Text } from '@omniviewdev/base-ui';

// Project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnection } from '@omniviewdev/runtime';

// Layout
import Layout from '@/layouts/core/sidenav';

// Third-party
import {
  useParams, Link, useNavigate, Outlet,
} from 'react-router-dom';
import NavMenu from '@infraview/navigation/NavMenu';
import { type SidebarItem } from '@infraview/navigation/types';
import { LuClipboardList, LuX } from 'react-icons/lu';
import styles from './index.module.css';

const items: SidebarItem[] = [
  {
    id: 'details',
    label: 'Details',
    icon: <LuClipboardList />,
  },
];

/**
 * Langing page for editing a connection for a plugin
 */
export default function EditConnectionPage(): React.ReactElement {
  const plugin = usePluginContext();
  const navigate = useNavigate();
  const { connectionID = '' } = useParams<{ pluginID: string; connectionID: string }>();

  const [selected, useSelected] = React.useState<string | undefined>(undefined);

  const { connection } = useConnection({ pluginID: plugin.id, connectionID });

  if (connection.isLoading) {
    return (<></>);
  }

  if (connection.isError) {
    return (<>{connection.error}</>);
  }

  return (
    <div className={styles.Root}>
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

      <Layout.Root style={{ padding: 64, gap: 64 }}>
        <Layout.SideNav>
          <NavMenu items={items} selected={selected} onSelect={useSelected} />
        </Layout.SideNav>
        <Layout.Main>
          <Outlet />
        </Layout.Main>
      </Layout.Root>
    </div>
  );
}

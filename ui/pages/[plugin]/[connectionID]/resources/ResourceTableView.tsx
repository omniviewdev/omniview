import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// ui
import { Avatar, Banner, Button, IconButton, Stack, Text } from '@omniviewdev/base-ui';

// Hooks
import {
  useConnection,
  useResourceTypes,
  useResourceGroups,
  useSnackbar,
  parseAppError,
} from '@omniviewdev/runtime';

// Types
import type { ResourceMeta } from '@omniviewdev/runtime/models';

// Layout
import Layout from '@/layouts/core/sidenav';

// Project import
import NavMenu from '@infraview/navigation/NavMenu';
import ResourceTable from '@/components/tables/Resources';
import PluginBackdrop from '../../PluginBackdrop';
import { usePluginContext } from '@/contexts/PluginContext';
import { type SidebarSection, type SidebarItem } from '@infraview/navigation/types';
import { stringAvatar } from '@/utils/color';
import { Link } from '@infraview/router';

// Icons
import { LuCircleAlert, LuCog } from 'react-icons/lu';
import styles from './ResourceTableView.module.css';

/**
 * Get the ID from the meta object
 */
const toID = (meta: ResourceMeta) => `${meta.group}::${meta.version}::${meta.kind}`;

/**
 * Initials avatar for a connection without an image avatar.
 */
function TextAvatar({ name }: { name: string }) {
  const { sx, children } = stringAvatar(name);
  return (
    <Avatar
      size='sm'
      shape='rounded'
      deterministic={false}
      className={styles.Avatar}
      fallback={children}
      fallbackProps={{ style: { backgroundColor: sx.bgcolor, color: '#fff' } }}
    />
  );
}

export default function ResourceTableView(): React.ReactElement {
  const { pluginID = '', connectionID = '' } = useParams<{ pluginID: string; connectionID: string }>();
  const [selected, setSelected] = React.useState<string | undefined>(undefined);

  useResourceTypes({ pluginID, connectionID });
  const { groups } = useResourceGroups({ pluginID, connectionID });
  const { connection } = useConnection({ pluginID, connectionID });

  const navigate = useNavigate();
  const plugin = usePluginContext();
  const { showSnackbar } = useSnackbar();

  React.useEffect(() => {
    if (import.meta.env.DEV) {
      showSnackbar({
        message: 'You are currently running in development mode',
        details: 'Rendering performance will be slightly degraded until this application is built for production.',
        status: 'info',
        showOnce: true,
        autoHideDuration: 15000,
      });
    }
  }, []);

  if (groups.isError) {
    const appErr = parseAppError(groups.error);
    return (
      <div className={styles.ErrorRoot}>
        <Banner color='danger' className={styles.ErrorBanner}>
          <Banner.Icon><LuCircleAlert /></Banner.Icon>
          <Banner.Content>
            <Banner.Title>{appErr.title}</Banner.Title>
            {appErr.detail}
            {appErr.suggestions && appErr.suggestions.length > 0 && (
              <ul className={styles.Suggestions}>
                {appErr.suggestions.map((s, i) => (
                  <li key={`${i}-${s}`}>{s}</li>
                ))}
              </ul>
            )}
          </Banner.Content>
        </Banner>
        <Button variant='outline' color='neutral' size='sm' onClick={() => {
          navigate(-1); 
        }}>Go Back</Button>
      </div>
    );
  }

  if (groups.isLoading || connection.isLoading || !groups.data || !connection.data) {
    return (<></>);
  }

  const getSections = () => {
    const coreSection: SidebarItem[] = [];

    const crdSection: SidebarItem[] = [];

    const grouped: SidebarItem[] = Object.values(groups.data).flatMap((group) => {
      if (!group) {
        return [];
      }

      const item: SidebarItem = {
        id: group.id,
        label: group.name,
        icon: group.icon,
        children: [],
      };

      Object.entries(group.resources).forEach(([version, metas]) => {
        metas?.forEach((meta) => {
          item.children?.push({
            id: toID(meta),
            label: meta.kind,
            icon: meta.icon,
            decorator: version,
          });
        });
      });

      // Sort the children
      item.children = item.children?.sort((a, b) => a.label.localeCompare(b.label));
      return item;
    }).sort((a, b) => a.label.localeCompare(b.label));

    grouped.forEach((group) => {
      // This is kubernetes specific, let's eventually allow plugins to define this somehow
      if (group.label.includes('.') && !group.label.includes('k8s.io')) {
        // custom resource definition
        crdSection.push(group);
      } else {
        coreSection.push(group);
      }
    });

    const sections: SidebarSection[] = [
      { id: 'core', title: '', items: coreSection },
      { id: 'crd', title: 'Custom Resource Definitions', items: crdSection },
    ];
    return sections;
  };

  return (
    <Layout.Root style={{ padding: 0, gap: 0 }}>

      <PluginBackdrop
        open={plugin.phase === 'Starting' || plugin.phase === 'Validating'}
        message={`${plugin.metadata.name} plugin is reloading`}
      />
      <Layout.SideNav type='bordered' padding={0.5} width={300} >
        <Stack direction='column' spacing={1} className={styles.SideNavContent}>
          <div className={styles.ConnectionHeader}>
            <Stack direction='row' align='center' spacing={2}>
              {connection.data?.avatar
                ? <Avatar
                  size='sm'
                  shape='rounded'
                  src={connection.data?.avatar}
                  alt={connection.data?.name}
                  className={styles.ImageAvatar}
                />
                : <TextAvatar name={connection.data?.name ?? ''} />
              }
              <Text weight='semibold' size='sm' className={styles.ConnectionName}>{connection.data?.name}</Text>
            </Stack>
            <Stack direction='row' align='center' spacing={2}>
              <Link to={`/connection/${connectionID}/edit`}>
                <IconButton variant='soft' size='sm' color='neutral' aria-label='Edit connection'>
                  <LuCog size={20} className={styles.SettingsIcon} />
                </IconButton>
              </Link>
            </Stack>
          </div>
          <NavMenu selected={selected} onSelect={setSelected} size='sm' sections={getSections()} scrollable />
        </Stack>
      </Layout.SideNav>
      <Layout.Main style={{ display: 'flex', flexDirection: 'column' }}>
        {/** Purposely double nesting this inside a non-padded container as not doing so doesn't allow the bottom drawer to
         fully epand up to the top of the container (since the padding get's accounted for in the sizing, which essentially
         just end up creating a gutter at the top equal to the top and bottom padding combined) */}
        <div className={styles.MainInner}>
          {selected &&
            <ResourceTable resourceKey={selected} pluginID={pluginID} connectionID={connectionID} />
          }
        </div>
      </Layout.Main>
    </Layout.Root>
  );
}

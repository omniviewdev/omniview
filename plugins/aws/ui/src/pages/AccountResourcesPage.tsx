import React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Link } from '@omniviewdev/runtime';
import { Avatar, IconButton, Stack, Text } from '@omniviewdev/base-ui';
import {
  useConnection,
  useResourceGroups,
  usePluginRouter,
} from '@omniviewdev/runtime';
import Layout from '../layouts/resource';
import { InitialsAvatar } from '../components/shared/NamedAvatar';
import ResourceNavTree from '../components/shared/ResourceNavTree';
import { LuCog } from 'react-icons/lu';
import { useSidebarLayout } from '../hooks/useSidebarLayout';
import { useStoredState } from '../components/shared/hooks/useStoredState';

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 8,
  borderRadius: 4,
  border: '1px solid var(--ov-color-border-default)',
};

export default function AccountResourcesPage(): React.ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const { groups } = useResourceGroups({ pluginID: 'aws', connectionID: id });
  const { connection } = useConnection({ pluginID: 'aws', connectionID: id });
  const { layout } = useSidebarLayout({ connectionID: id })
  const { location, navigate } = usePluginRouter();
  const [savedExpandedState, setSavedExpandedState] = useStoredState<Record<string, boolean>>(
    `aws-${id}-sidebar-expanded`,
    {},
  );

  const handleExpandedChange = React.useCallback((state: Record<string, boolean>) => {
    setSavedExpandedState(state);
  }, [setSavedExpandedState]);

  const selected = location.pathname.split('/').pop();

  const handleSelect = React.useCallback((resourceID: string) => {
    navigate(`/account/${id}/resources/${resourceID}`);
  }, [navigate, id]);

  if (groups.isLoading || connection.isLoading || !groups.data || !connection.data) {
    return (<></>);
  }

  if (groups.isError) {
    return (<>Error loading resource groups</>);
  }

  return (
    <Layout.Root style={{ padding: 0, gap: 0 }}>
      <Layout.SideNav type='bordered' padding={0.5}>
        <Stack direction='column' spacing={1} style={{ maxHeight: '100%', height: '100%', overflow: 'hidden' }}>
          <div style={headerStyle}>
            <Stack direction='row' align='center' spacing={2} style={{ minWidth: 0 }}>
              {connection.data?.avatar
                ? <Avatar
                    size='sm'
                    shape='rounded'
                    src={connection.data?.avatar}
                    name={connection.data?.name}
                    style={{ borderRadius: 6, backgroundColor: 'transparent', border: 0, maxHeight: 28, maxWidth: 28 }}
                    imageProps={{ style: { objectFit: 'contain' } }}
                  />
                : <InitialsAvatar name={connection.data?.name || ''} />
              }
              <Text weight="semibold" size="sm" style={{ textOverflow: 'ellipsis' }}>{connection.data?.name}</Text>
            </Stack>
            <Stack direction='row' align='center' spacing={2}>
              <Link to={`/account/${id}/edit`}>
                <IconButton variant='soft' size='sm' color='neutral' aria-label='Edit account'>
                  <LuCog size={20} />
                </IconButton>
              </Link>
            </Stack>
          </div>
          <ResourceNavTree
            sections={layout}
            selected={selected}
            onSelect={handleSelect}
            initialExpandedState={savedExpandedState}
            onExpandedChange={handleExpandedChange}
          />
        </Stack>
      </Layout.SideNav>
      <Layout.Main style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <Outlet />
        </div>
      </Layout.Main>
    </Layout.Root>
  );
}

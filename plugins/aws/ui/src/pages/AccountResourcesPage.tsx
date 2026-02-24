import React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Link } from '@omniviewdev/runtime';
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Avatar } from '@omniviewdev/ui';
import { NavMenu } from '@omniviewdev/ui/sidebars';
import {
  useConnection,
  useResourceGroups,
  usePluginRouter,
} from '@omniviewdev/runtime';
import Layout from '../layouts/resource';
import { stringAvatar } from '../utils/color';
import { LuCog } from 'react-icons/lu';
import { useSidebarLayout } from '../hooks/useSidebarLayout';

export default function AccountResourcesPage(): React.ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const { groups } = useResourceGroups({ pluginID: 'aws', connectionID: id });
  const { connection } = useConnection({ pluginID: 'aws', connectionID: id });
  const { layout } = useSidebarLayout({ connectionID: id })
  const { location, navigate } = usePluginRouter();

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
    <Layout.Root sx={{ p: 0, gap: 0 }}>
      <Layout.SideNav type='bordered' padding={0.5}>
        <Stack direction='column' maxHeight='100%' height={'100%'} overflow={'hidden'} gap={0.5}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 1,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack direction='row' alignItems='center' gap={1}>
              {connection.data?.avatar
                ? <Avatar
                    size='sm'
                    src={connection.data?.avatar}
                    sx={{ borderRadius: 6, backgroundColor: 'transparent', objectFit: 'contain', border: 0, maxHeight: 28, maxWidth: 28 }}
                  />
                : <Avatar size='sm' {...stringAvatar(connection.data?.name || '')} />
              }
              <Text weight="semibold" size="sm" sx={{ textOverflow: 'ellipsis' }}>{connection.data?.name}</Text>
            </Stack>
            <Stack direction='row' alignItems='center' gap={1}>
              <Link to={`/account/${id}/edit`}>
                <IconButton emphasis='soft' size='sm' color='neutral'>
                  <LuCog size={20} />
                </IconButton>
              </Link>
            </Stack>
          </Box>
          <NavMenu
            size='sm'
            sections={layout}
            selected={selected}
            onSelect={handleSelect}
            scrollable
          />
        </Stack>
      </Layout.SideNav>
      <Layout.Main sx={{ display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <Outlet />
        </Box>
      </Layout.Main>
    </Layout.Root>
  );
}

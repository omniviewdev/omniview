import React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Link } from '@omniviewdev/runtime';
import {
  Avatar,
  IconButton,
  Sheet,
  Stack,
  Typography,
  Box,
  useTheme,
} from '@mui/joy';
import {
  useConnection,
  useResourceGroups,
} from '@omniviewdev/runtime';
import Layout from '../layouts/resource';
import NavMenu from '../components/shared/navmenu/NavMenu';
import { stringAvatar } from '../utils/color';
import { LuCog } from 'react-icons/lu';
import { useSidebarLayout } from '../hooks/useSidebarLayout';

export default function AccountResourcesPage(): React.ReactElement {
  const theme = useTheme();
  const { id = '' } = useParams<{ id: string }>();
  const { groups } = useResourceGroups({ pluginID: 'aws', connectionID: id });
  const { connection } = useConnection({ pluginID: 'aws', connectionID: id });
  const { layout } = useSidebarLayout({ connectionID: id })

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
          <Sheet
            variant='outlined'
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 1,
              borderRadius: 'sm',
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
              <Typography level='title-sm' textOverflow={'ellipsis'}>{connection.data?.name}</Typography>
            </Stack>
            <Stack direction='row' alignItems='center' gap={1}>
              <Link to={`/account/${id}/edit`}>
                <IconButton variant='soft' size='sm' color='neutral'>
                  <LuCog size={20} color={theme.palette.neutral[400]} />
                </IconButton>
              </Link>
            </Stack>
          </Sheet>
          <NavMenu size='sm' sections={layout} scrollable />
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

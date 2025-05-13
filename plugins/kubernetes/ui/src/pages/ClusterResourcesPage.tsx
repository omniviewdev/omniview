import React from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { Link } from '@omniviewdev/runtime';

// Material-ui
import {
  Avatar,
  IconButton,
  Sheet,
  Stack,
  Typography,
  Box,
  useTheme,
} from '@mui/joy';

// Hooks
import {
  useConnection,
  useResourceTypes,
  useResourceGroups,
  useSnackbar,
} from '@omniviewdev/runtime';

// Types
// import { type types } from '@omniviewdev/runtime/models';

// Layout
import Layout from '../layouts/resource';

// Project import
// import ResourceTable from '../components/tables/Resources';

import NavMenu from '../components/shared/navmenu/NavMenu';
// import { type SidebarSection, type SidebarItem } from '../components/shared/navmenu/types';

import { stringAvatar } from '../utils/color';

// Icons
import { LuCog } from 'react-icons/lu';
import { useSidebarLayout } from '../hooks/useSidebarLayout';


export default function ClusterResourcesPage(): React.ReactElement {
  const theme = useTheme();

  const { id = '' } = useParams<{ id: string }>();

  const { types } = useResourceTypes({ pluginID: 'kubernetes', connectionID: id });
  const { groups } = useResourceGroups({ pluginID: 'kubernetes', connectionID: id });
  const { connection } = useConnection({ pluginID: 'kubernetes', connectionID: id });
  const { layout } = useSidebarLayout({ connectionID: id })

  const { showSnackbar } = useSnackbar();

  React.useEffect(() => {
    showSnackbar({
      message: 'You are currently running in development mode',
      details: 'Rendering performance will be slightly degraded until this application is built for production.',
      status: 'info',
      showOnce: true,
      autoHideDuration: 15000,
    });
  }, [showSnackbar]);

  if (groups.isLoading || connection.isLoading || !groups.data || !connection.data) {
    return (<></>);
  }

  if (groups.isError) {
    return (<>{types.error}</>);
  }

  // const getSections = () => {
  //   const coreSection: SidebarItem[] = [];
  //
  //   const crdSection: SidebarItem[] = [];
  //
  //   const grouped: SidebarItem[] = Object.values(groups.data).map((group) => {
  //     const item: SidebarItem = {
  //       id: group.id,
  //       label: group.name,
  //       icon: group.icon,
  //       children: [],
  //     };
  //
  //     Object.entries(group.resources).forEach(([_, metas]) => {
  //       metas.forEach((meta) => {
  //         item.children?.push({
  //           id: toID(meta),
  //           label: meta.kind,
  //           icon: meta.icon,
  //         });
  //       });
  //     });
  //
  //     // Sort the children
  //     item.children = item.children?.sort((a, b) => a.label.localeCompare(b.label));
  //     return item;
  //   }).sort((a, b) => a.label.localeCompare(b.label));
  //
  //   grouped.forEach((group) => {
  //     // This is kubernetes specific, let's eventually allow plugins to define this somehow
  //     if (group.label.includes('.') && !group.label.includes('.k8s.io')) {
  //       // custom resource definition
  //       crdSection.push(group);
  //     } else {
  //       coreSection.push(group);
  //     }
  //   });
  //
  //   const sections: SidebarSection[] = [
  //     { id: 'core', title: '', items: coreSection },
  //     { id: 'crd', title: 'Custom Resource Definitions', items: crdSection },
  //   ];
  //   return sections;
  // };

  return (
    <Layout.Root
      sx={{
        p: 0,
        gap: 0,
      }}
    >
      <Layout.SideNav type='bordered' padding={0.5} >
        <Stack direction='column' maxHeight='100%' gap={0.5}>
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
                  sx={{
                    borderRadius: 6,
                    backgroundColor: 'transparent',
                    objectFit: 'contain',
                    border: 0,
                    maxHeight: 28,
                    maxWidth: 28,
                  }}
                />
                : <Avatar
                  size='sm'
                  {...stringAvatar(connection.data?.name || '')}
                />
              }
              <Typography level='title-sm' textOverflow={'ellipsis'}>{connection.data?.name}</Typography>
            </Stack>
            <Stack direction='row' alignItems='center' gap={1}>
              <Link to={`/cluster/${id}/edit`}>
                <IconButton variant='soft' size='sm' color='neutral'>
                  <LuCog size={20} color={theme.palette.neutral[400]} />
                </IconButton>
              </Link>
            </Stack>
          </Sheet>
          <NavMenu
            size='sm'
            sections={layout}
            scrollable
          />
        </Stack>
      </Layout.SideNav>
      <Layout.Main
        sx={{
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/** Purposely double nesting this inside a non-padded container as not doing so doesn't allow the bottom drawer to
         fully epand up to the top of the container (since the padding get's accounted for in the sizing, which essentially
         just end up creating a gutter at the top equal to the top and bottom padding combined) */}
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {/* {selected && */}
          {/*   <ResourceTable resourceKey={selected} pluginID={'kubernetes'} connectionID={id} /> */}
          {/* } */}
          <Outlet />
        </Box>
      </Layout.Main>
    </Layout.Root>
  );
}

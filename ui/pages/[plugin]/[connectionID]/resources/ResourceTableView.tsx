import React from 'react';
import { useParams } from 'react-router-dom';

// Material-ui
import Avatar from '@mui/joy/Avatar';
import IconButton from '@mui/joy/IconButton';
import Sheet from '@mui/joy/Sheet';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';
import { Box, useTheme } from '@mui/joy';

// Hooks
import {
  useConnection,
  useResourceTypes,
  useResourceGroups,
  useSnackbar,
} from '@omniviewdev/runtime';

// Types
import { type types } from '@omniviewdev/runtime/models';

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
import { LuCog } from 'react-icons/lu';

/**
 * Get the ID from the meta object
 */
const toID = (meta: types.ResourceMeta) => `${meta.group}::${meta.version}::${meta.kind}`;

export default function ResourceTableView(): React.ReactElement {
  const theme = useTheme();

  const { pluginID = '', connectionID = '' } = useParams<{ pluginID: string; connectionID: string }>();
  const [selected, setSelected] = React.useState<string | undefined>(undefined);

  const { types } = useResourceTypes({ pluginID, connectionID });
  const { groups } = useResourceGroups({ pluginID, connectionID });
  const { connection } = useConnection({ pluginID, connectionID });

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

  if (groups.isLoading || connection.isLoading || !groups.data || !connection.data) {
    return (<></>);
  }

  if (groups.isError) {
    return (<>{types.error}</>);
  }

  const getSections = () => {
    const coreSection: SidebarItem[] = [];

    const crdSection: SidebarItem[] = [];

    const grouped: SidebarItem[] = Object.values(groups.data).map((group) => {
      const item: SidebarItem = {
        id: group.id,
        label: group.name,
        icon: group.icon,
        children: [],
      };

      Object.entries(group.resources).forEach(([version, metas]) => {
        metas.forEach((meta) => {
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
    <Layout.Root
      sx={{
        p: 0,
        gap: 0,
      }}
    >

      <PluginBackdrop
        open={plugin.loading}
        message={`${plugin.metadata.name} plugin is reloading`}
      />
      <Layout.SideNav type='bordered' padding={0.5} width={300} >
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
              <Link to={`/connection/${connectionID}/edit`}>
                <IconButton variant='soft' size='sm' color='neutral'>
                  <LuCog size={20} color={theme.palette.neutral[400]} />
                </IconButton>
              </Link>
            </Stack>
          </Sheet>
          <NavMenu selected={selected} onSelect={setSelected} size='sm' sections={getSections()} scrollable />
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
          {selected &&
            <ResourceTable resourceKey={selected} pluginID={pluginID} connectionID={connectionID} />
          }
        </Box>
      </Layout.Main>
    </Layout.Root>
  );
}


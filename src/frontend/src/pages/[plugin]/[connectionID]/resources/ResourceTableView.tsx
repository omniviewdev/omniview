import React from 'react';
import { useParams } from 'react-router-dom';

// Material-ui
import Avatar from '@mui/joy/Avatar';
import IconButton from '@mui/joy/IconButton';
import Sheet from '@mui/joy/Sheet';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';
import { useTheme } from '@mui/joy';

// Hooks
import { useResourceTypes } from '@/hooks/resource/useResourceTypes';

// Types
import { type types } from '@api/models';

// Layout
import Layout from '@/layouts/core/sidenav';

// Project import
import NavMenu from '@infraview/navigation/NavMenu';
import { type SidebarItem } from '@infraview/navigation/types';
import { useConnection } from '@/hooks/connection/useConnection';
import { stringAvatar } from '@/utils/color';
import { Link } from '@infraview/router';

// Icons
import { LuCog } from 'react-icons/lu';
import ResourceTable from './ResourceTable';
import PluginBackdrop from '../../PluginBackdrop';
import { usePluginContext } from '@/contexts/PluginContext';

/**
 * Get the ID from the meta object
 */
const toID = (meta: types.ResourceMeta) => `${meta.group}::${meta.version}::${meta.kind}`;

export default function ResourceTableView(): React.ReactElement {
  const theme = useTheme();

  const { pluginID = '', connectionID = '' } = useParams<{ pluginID: string; connectionID: string }>();
  const [selected, setSelected] = React.useState<string | undefined>(undefined);

  const { types } = useResourceTypes({ pluginID });
  const { connection } = useConnection({ pluginID, connectionID });
  const plugin = usePluginContext();

  if (types.isLoading || connection.isLoading || !types.data || !connection.data) {
    return (<></>);
  }

  if (types.isError) {
    return (<>{types.error}</>);
  }

  const grouped: SidebarItem[] = Object.values(types.data).reduce<SidebarItem[]>((prev, curr) => {
    // Find the group
    // if it doesn't exist, create it
    const idx = prev.findIndex(group => group.id === curr.group);
    if (idx === -1) {
      prev.push({
        id: curr.group,
        label: curr.group,
        icon: null,
        children: [{
          id: toID(curr),
          label: curr.kind,
          icon: null,
        }],
      });
      return prev;
    }

    if (prev[idx].children === undefined) {
      prev[idx].children = [];
    }

    // Add the item to the group
    prev[idx].children?.push({
      id: toID(curr),
      label: curr.kind,
      icon: null,
    });
    return prev;
  }, []);

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
      <Layout.SideNav type='bordered' padding={1} width={300} >
        <Sheet
          variant='outlined'
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            p: 1,
            borderRadius: 'sm',
            boxShadow: theme => theme.shadow.sm,
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
        <NavMenu selected={selected} onSelect={setSelected} size='sm' items={grouped} scrollable />
      </Layout.SideNav>
      <Layout.Main p={1} gap={2}>
        {selected && (
          <ResourceTable resourceKey={selected} pluginID={pluginID} connectionID={connectionID} />
        )}
      </Layout.Main>
    </Layout.Root>
  );
}


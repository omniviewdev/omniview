import React from 'react';

// Material-ui
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Avatar } from '@omniviewdev/ui';
import Breadcrumbs from '@mui/material/Breadcrumbs';

// Project imports
import { usePluginContext } from '@/contexts/PluginContext';
import { useConnection } from '@omniviewdev/runtime';

// Layout
import Layout from '@/layouts/core/sidenav';

// Third-party
import {
  useParams, Link, useNavigate, Outlet,
} from 'react-router-dom';
import { Close } from '@mui/icons-material';
import NavMenu from '@infraview/navigation/NavMenu';
import { type SidebarItem } from '@infraview/navigation/types';
import { LuClipboardList } from 'react-icons/lu';

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
    <Stack
      py={1}
      px={2}
      spacing={2}
      overflow={'auto'}
      direction={'column'}
      alignItems={'flex-start'}
      maxHeight={'100%'}
      minHeight={'100%'}
    // Sx={{
    //   background: `linear-gradient(109.6deg, rgb(36, 45, 57) 2.2%, ${tinycolor(plugin.metadata.theme.colors.primary).setAlpha(0.2).toString()} 50.2%, rgb(0, 0, 0) 98.6%);`,
    // }}
    >
      <Stack direction='row' alignItems='center' justifyContent={'space-between'} width={'100%'} gap={1.5}>
        <Breadcrumbs separator='>' aria-label='breadcrumbs'>
          <Link to={`/plugin/${plugin.id}`} style={{
            textDecoration: 'none', color: 'inherit', display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <Avatar size='sm' src={plugin.metadata.icon} sx={{ borderRadius: 4, height: 18, width: 18 }} />
            <Text weight='semibold'>{plugin.metadata.name}</Text>
          </Link>
          <Link to={`/plugin/${plugin.id}`} style={{
            textDecoration: 'none', color: 'inherit', display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <Text weight='semibold'>Connections</Text>
          </Link>
          <Text>{connection.data?.name}</Text>
        </Breadcrumbs>
        <IconButton
          emphasis='soft'
          color='neutral'
          size='sm'
          onClick={() => {
            navigate(-1);
          }}
        >
          <Close />
        </IconButton>
      </Stack>

      <Layout.Root
        sx={{
          p: 8,
          gap: 8,
        }}
      >
        <Layout.SideNav>
          <NavMenu items={items} selected={selected} onSelect={useSelected} />
        </Layout.SideNav>
        <Layout.Main>
          <Outlet />
        </Layout.Main>
      </Layout.Root>
    </Stack>
  );
}

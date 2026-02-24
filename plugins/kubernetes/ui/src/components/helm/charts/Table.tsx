import React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import { Text } from '@omniviewdev/ui/typography';
import ResourceTable from '../../shared/table/ResourceTable';
import { DrawerComponent } from '@omniviewdev/runtime';
import { SiHelm } from 'react-icons/si';
import ChartSidebar from './ChartSidebar';
import { createStandardViews } from '../../shared/sidebar/createDrawerViews';
import { stringToColor } from '../../../utils/color';

const resourceKey = 'helm::v1::Chart';
const ICON_SIZE = 20;

type HelmChart = Record<string, any>;

function chartInitials(name: string): string {
  if (!name) return '?';
  const parts = name.includes('-') ? name.split('-') : [name];
  if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const InitialsAvatar: React.FC<{ name: string }> = ({ name }) => (
  <Box
    sx={{
      width: ICON_SIZE,
      height: ICON_SIZE,
      borderRadius: '4px',
      flexShrink: 0,
      bgcolor: stringToColor(name, 1),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 9,
      fontWeight: 700,
      color: '#fff',
      lineHeight: 1,
    }}
  >
    {chartInitials(name)}
  </Box>
);

const ChartIcon: React.FC<{ icon?: string; name?: string }> = ({ icon, name = '' }) => {
  const [imgFailed, setImgFailed] = React.useState(false);

  if (icon && !imgFailed) {
    return (
      <Box
        sx={{
          width: ICON_SIZE,
          height: ICON_SIZE,
          borderRadius: '4px',
          flexShrink: 0,
          bgcolor: 'rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box
          component="img"
          src={icon}
          alt={name}
          onError={() => setImgFailed(true)}
          sx={{
            width: ICON_SIZE - 2,
            height: ICON_SIZE - 2,
            objectFit: 'contain',
            borderRadius: '3px',
          }}
        />
      </Box>
    );
  }

  return <InitialsAvatar name={name} />;
};

const HelmChartTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<HelmChart>>>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'name',
        size: 220,
        cell: ({ row, getValue }) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
            <ChartIcon icon={row.original.icon} name={getValue() as string} />
            <Text size="sm" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {getValue() as string}
            </Text>
          </Box>
        ),
      },
      {
        id: 'description',
        header: 'Description',
        accessorKey: 'description',
        size: 300,
        meta: { flex: 1 },
        cell: ({ getValue }) => (
          <Text size="sm" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {getValue() as string}
          </Text>
        ),
      },
      {
        id: 'version',
        header: 'Version',
        accessorKey: 'version',
        size: 100,
      },
      {
        id: 'appVersion',
        header: 'App Version',
        accessorKey: 'appVersion',
        size: 100,
      },
      {
        id: 'repository',
        header: 'Repository',
        accessorKey: 'repository',
        size: 130,
      },
    ],
    [],
  );

  const drawer: DrawerComponent<HelmChart> = React.useMemo(() => ({
    title: 'Chart',
    icon: <SiHelm />,
    views: createStandardViews({ SidebarComponent: ChartSidebar }),
    actions: [],
  }), []);

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="id"
      memoizer="id"
      drawer={drawer}
      hideNamespaceSelector
    />
  );
};

export default HelmChartTable;

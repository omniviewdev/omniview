import React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useParams } from 'react-router-dom';
import Chip from '@mui/joy/Chip';
import ResourceTable from '../../shared/table/ResourceTable';
import { DrawerComponent } from '@omniviewdev/runtime';
import { LuBox, LuCode } from 'react-icons/lu';
import { SiHelm } from 'react-icons/si';
import ReleaseSidebar from './ReleaseSidebar';
import BaseEditorPage from '../../shared/sidebar/pages/editor/BaseEditorPage';

const resourceKey = 'helm::v1::Release';

type HelmRelease = Record<string, any>;

const statusColorMap: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  deployed: 'success',
  failed: 'danger',
  'pending-install': 'warning',
  'pending-upgrade': 'warning',
  'pending-rollback': 'warning',
  superseded: 'neutral',
  uninstalling: 'warning',
  uninstalled: 'neutral',
};

const HelmReleaseTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<HelmRelease>>>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'name',
        size: 200,
      },
      {
        id: 'namespace',
        header: 'Namespace',
        accessorKey: 'namespace',
        size: 120,
      },
      {
        id: 'chart',
        header: 'Chart',
        accessorFn: (row) => row.chart?.metadata?.name ?? '',
        size: 150,
      },
      {
        id: 'app_version',
        header: 'App Version',
        accessorFn: (row) => row.chart?.metadata?.appVersion ?? '',
        size: 100,
      },
      {
        id: 'revision',
        header: 'Revision',
        accessorKey: 'version',
        size: 80,
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (row) => row.info?.status ?? '',
        cell: ({ getValue }) => {
          const status = getValue() as string;
          return (
            <Chip
              size="sm"
              variant="soft"
              color={statusColorMap[status] ?? 'neutral'}
              sx={{ borderRadius: 'sm' }}
            >
              {status}
            </Chip>
          );
        },
        size: 120,
      },
    ],
    [],
  );

  const drawer: DrawerComponent<HelmRelease> = React.useMemo(() => ({
    title: 'Release',
    icon: <SiHelm />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (ctx) => <ReleaseSidebar ctx={ctx} />,
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />,
      },
    ],
    actions: [],
  }), []);

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="name"
      memoizer="name,version"
      drawer={drawer}
    />
  );
};

export default HelmReleaseTable;

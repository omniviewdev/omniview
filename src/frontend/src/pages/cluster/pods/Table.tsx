import { type FC, useMemo } from 'react';

// Helpers
import { type ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import {
  TextRow, RowMenu, StatusText, SelectBoxHeader, SelectBoxRow, Age,
} from '@/components/tables/ResourceTable/components';

// Types
import { type Pod } from 'kubernetes-types/core/v1';

// Utils
import { usePods } from '@/hooks/useKubernetes';
// Import ContainerChip from '@/components/chips/ContainerChip';

type Props = Record<string, unknown>;

const PodsTable: FC<Props> = () => {
  const loader = usePods;
  const columns = useMemo<Array<ColumnDef<Pod>>>(
    () => [
      {
        id: 'select',
        header: SelectBoxHeader,
        cell: SelectBoxRow,
        size: 40,
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'metadata.name',
        cell: ({ row }) => (<TextRow row={row} column='name' />),
      },
      {
        id: 'namespace',
        header: 'Namespace',
        size: 140,
        accessorKey: 'metadata.namespace',
        cell: ({ row }) => (<TextRow row={row} column='namespace' />),
      },
      {
        id: 'age',
        header: 'Age',
        size: 80,
        accessorKey: 'metadata.creationTimestamp',
        cell: ({ row }) => (<Age startTime={row.getValue('age')} />),
      },
      {
        id: 'restarts',
        header: 'Restarts',
        size: 90,
        accessorFn: node => node.status?.containerStatuses?.reduce((acc, curr) => acc + curr.restartCount, 0),
        cell: ({ row }) => (<TextRow row={row} column='restarts' />),
      },
      {
        id: 'status',
        header: 'Status',
        size: 80,
        accessorKey: 'status.phase',
        cell: ({ row }) => (<StatusText status={row.getValue('status')} />),
      },
      {
        id: 'menu',
        header: '',
        cell: RowMenu,
        size: 50,
        enableSorting: false,
        enableHiding: false,
      },
    ], []);

  return (
    <>
      <ResourceTable loader={loader} columns={columns} kind='pod' />
    </>
  );
};

PodsTable.whyDidYouRender = true;

export default PodsTable;

import { type FC } from 'react';

// Types
import { type ReplicaSet } from 'kubernetes-types/apps/v1';

// Helpers
import { type ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import {
  SelectBoxHeader, SelectBoxRow, TextRow, RowMenu, Age, NumberRow,
} from '@/components/tables/ResourceTable/components';
import { useReplicaSets } from '@/hooks/useKubernetes';

type Props = Record<string, unknown>;

/**
 * Display a table of the deployments
 */
const ReplicaSetTable: FC<Props> = () => {
  const loader = useReplicaSets;
  const columns: Array<ColumnDef<ReplicaSet>> = [
    {
      id: 'select',
      header: SelectBoxHeader,
      cell: SelectBoxRow,
      size: 30,
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
      size: 50,
      accessorKey: 'metadata.namespace',
      cell: ({ row }) => (<TextRow row={row} column='namespace' />),
    },
    {
      id: 'desired',
      header: 'Desired',
      size: 20,
      accessorKey: 'spec.replicas',
      cell: ({ row }) => (<NumberRow row={row} column='desired' />),
    },
    {
      id: 'current',
      header: 'Current',
      size: 20,
      accessorKey: 'status.replicas',
      cell: ({ row }) => (<NumberRow row={row} column='current' />),
    },
    {
      id: 'ready',
      header: 'Ready',
      size: 20,
      accessorKey: 'status.readyReplicas',
      cell: ({ row }) => (<NumberRow row={row} column='ready' />),
    },
    {
      id: 'age',
      header: 'Age',
      size: 40,
      accessorKey: 'metadata.creationTimestamp',
      cell: ({ row }) => (<Age startTime={row.getValue('age')} />),
    },
    {
      id: 'menu',
      header: '',
      cell: RowMenu,
      size: 5,
      enableSorting: false,
      enableHiding: false,
    },
  ];

  return (
    <ResourceTable columns={columns} loader={loader} kind='replicaset' />
  );
};

export default ReplicaSetTable;

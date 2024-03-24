import { type FC } from 'react';

// Types
import { type Deployment } from 'kubernetes-types/apps/v1';

// Helpers
import { type ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import {
  SelectBoxHeader, SelectBoxRow, TextRow, RowMenu, Age,
} from '@/components/tables/ResourceTable/components';
import { useDeployments } from '@/hooks/useKubernetes';

type Props = Record<string, unknown>;

/**
 * Display a table of the deployments
 */
const DeploymentsTable: FC<Props> = () => {
  const loader = useDeployments;
  const columns: Array<ColumnDef<Deployment>> = [
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
      id: 'menu',
      header: '',
      cell: RowMenu,
      size: 50,
      enableSorting: false,
      enableHiding: false,
    },
  ];

  return (
    <ResourceTable columns={columns} loader={loader} kind='deployment' />
  );
};

export default DeploymentsTable;

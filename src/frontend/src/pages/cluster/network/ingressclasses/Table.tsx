import { type FC } from 'react';

// Types
import { type IngressClass } from 'kubernetes-types/networking/v1';

// Helpers
import { type ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import {
  SelectBoxHeader, SelectBoxRow, TextRow, RowMenu, Age,
} from '@/components/tables/ResourceTable/components';
import { useIngressClasses } from '@/hooks/useKubernetes';

type Props = Record<string, unknown>;

/**
 * Display a table of the deployments
 */
const IngressClassTable: FC<Props> = () => {
  const loader = useIngressClasses;
  const columns: Array<ColumnDef<IngressClass>> = [
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
    <ResourceTable columns={columns} loader={loader} kind='ingressclass' />
  );
};

export default IngressClassTable;

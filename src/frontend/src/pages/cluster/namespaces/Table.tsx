import { type FC } from 'react';

// Types
import { type Namespace } from 'kubernetes-types/core/v1';

// Helpers
import { type ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import { SelectBoxHeader, SelectBoxRow, TextRow } from '@/components/tables/ResourceTable/components';
import { useNamespaces } from '@/hooks/useKubernetes';

type Props = Record<string, unknown>;

/**
 * Display a table of the nodes
 */
const NamespacesTable: FC<Props> = () => {
  const loader = useNamespaces;
  const columns: Array<ColumnDef<Namespace>> = [
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
  ];

  return (
    <ResourceTable loader={loader} columns={columns} kind='namespace' />
  );
};

export default NamespacesTable;

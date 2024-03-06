import { FC } from 'react';

// types
import { Namespace } from 'kubernetes-types/core/v1';

// helpers
import { ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import { SelectBoxHeader, SelectBoxRow, TextRow } from '@/components/tables/ResourceTable/components';
import { useNamespaces } from '@/hooks/useKubernetes';

type Props = {}

/**
 * Display a table of the nodes
 */
const NamespacesTable: FC<Props> = () => {
  const loader = useNamespaces;
  const columns: ColumnDef<Namespace>[] = [
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
      cell: ({ row }) => (<TextRow row={row} column="name" />),
    },
  ]

  return (
    <ResourceTable loader={loader} columns={columns} kind="namespace" />
  )
}

export default NamespacesTable;

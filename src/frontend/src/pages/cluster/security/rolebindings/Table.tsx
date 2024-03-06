import { FC } from 'react';

// types
import { RoleBinding } from 'kubernetes-types/rbac/v1';

// helpers
import { ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import { SelectBoxHeader, SelectBoxRow, TextRow, RowMenu, Age } from '@/components/tables/ResourceTable/components';
import { useRoleBindings } from '@/hooks/useKubernetes';

type Props = {}

/**
 * Display a table of the deployments
 */
const RoleBindingsTable: FC<Props> = () => {
  const loader = useRoleBindings;
  const columns: ColumnDef<RoleBinding>[] = [
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
      cell: ({ row }) => (<TextRow row={row} column="name" />),
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
    }
  ]

  return (
    <ResourceTable columns={columns} loader={loader} kind='rolebinding' />
  )
}

export default RoleBindingsTable;

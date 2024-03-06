import { FC } from 'react';

// types
import { StatefulSet } from 'kubernetes-types/apps/v1';

// helpers
import { ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import { SelectBoxHeader, SelectBoxRow, TextRow, RowMenu, Age } from '@/components/tables/ResourceTable/components';
import { useStatefulSets } from '@/hooks/useKubernetes';

type Props = {}

/**
 * Display a table of the deployments
 */
const StatefulSetTable: FC<Props> = () => {
  const loader = useStatefulSets;
  const columns: ColumnDef<StatefulSet>[] = [
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
      id: 'namespace',
      header: 'Namespace',
      size: 50,
      accessorKey: 'metadata.namespace',
      cell: ({ row }) => (<TextRow row={row} column="namespace" />),
    },
    {
      id: 'age',
      header: 'Age',
      size: 40,
      accessorKey: 'status.startTime',
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
    <ResourceTable columns={columns} loader={loader} kind='statefulset' />
  )
}

export default StatefulSetTable;

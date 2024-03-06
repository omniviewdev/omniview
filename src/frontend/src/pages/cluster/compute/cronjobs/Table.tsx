import { FC } from 'react';

// types
import { CronJob } from 'kubernetes-types/batch/v1';

// helpers
import { ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import { SelectBoxHeader, SelectBoxRow, TextRow, RowMenu, Age } from '@/components/tables/ResourceTable/components';
import { useCronJobs } from '@/hooks/useKubernetes';

type Props = {}

/**
 * Display a table of the deployments
 */
const CronJobTable: FC<Props> = () => {
  const loader = useCronJobs;
  const columns: ColumnDef<CronJob>[] = [
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
      accessorKey: 'metadata.creationTimestamp',
      cell: ({ row }) => (<Age startTime={row.getValue('age')} />),
    },
    {
      id: 'menu',
      header: '',
      cell: RowMenu,
      size: 40,
      enableSorting: false,
      enableHiding: false,
    }
  ]

  return (
    <ResourceTable columns={columns} loader={loader} kind='cronjob' />
  )
}

export default CronJobTable;

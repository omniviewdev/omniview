import { FC } from 'react';

// types
import { PersistentVolumeClaim } from 'kubernetes-types/core/v1';

// helpers
import { ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import { SelectBoxHeader, SelectBoxRow, TextRow, RowMenu, Age } from '@/components/tables/ResourceTable/components';
import { usePersistentVolumeClaims } from '@/hooks/useKubernetes';

type Props = {}

/**
 * Display a table of the deployments
 */
const PersistentVolumeClaimsTable: FC<Props> = () => {
  const loader = usePersistentVolumeClaims;
  const columns: ColumnDef<PersistentVolumeClaim>[] = [
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
      id: 'volumeMode',
      header: 'Volume Mode',
      size: 40,
      accessorKey: 'spec.volumeMode',
      cell: ({ row }) => (<TextRow row={row} column="volumeMode" />),
    },
    {
      id: 'storageClass',
      header: 'Storage Class',
      size: 40,
      accessorKey: 'spec.storageClassName',
      cell: ({ row }) => (<TextRow row={row} column="storageClass" />),
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
    <ResourceTable columns={columns} loader={loader} kind='persistentvolumeclaim' />
  )
}

export default PersistentVolumeClaimsTable;

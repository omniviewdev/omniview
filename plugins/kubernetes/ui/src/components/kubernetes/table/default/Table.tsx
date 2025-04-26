import React from 'react'

import { ColumnDef } from '@tanstack/react-table'

import SelectBoxHeader from '../../../tables/cells/SelectBoxHeader';
import SelectBoxRow from '../../../tables/cells/SelectBoxRow';
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import AgeCell from '../corev1/Pod/cells/AgeCell';

const DefaultTable: React.FC = () => {
  const { id = '', resourceKey = '' } = useParams<{ id: string, resourceKey: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
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
        enableSorting: true,
        enableHiding: false,
      },
      {
        id: 'namespace',
        header: 'Namespace',
        accessorKey: 'metadata.namespace',
        size: 150,
        enableSorting: true,
        enableHiding: false,
      },
      {
        id: 'age',
        header: 'Age',
        accessorKey: 'metadata.creationTimestamp',
        size: 100,
        cell: ({ getValue }) => <AgeCell value={getValue() as string} />
      },
    ],
    [id],
  )

  const [columnVisibility, _] = React.useState({})

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey.replace(/_/g, '::')}
      idAccessor='metadata.name'
      columnVisibility={columnVisibility}
      memoizer={'metadata.uid,metadata.resourceVersion'}
    />
  )
}

export default DefaultTable;

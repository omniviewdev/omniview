import React from 'react'

import { ColumnDef } from '@tanstack/react-table'
import { Node } from 'kubernetes-types/core/v1'

import SelectBoxHeader from '../../../../tables/cells/SelectBoxHeader';
import SelectBoxRow from '../../../../tables/cells/SelectBoxRow';
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../../shared/table/ResourceTable';
import AgeCell from '../Pod/cells/AgeCell';
import { convertByteUnits } from '../../../../../utils/units';

const NodeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<Node>>>(
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
        id: 'architecture',
        header: 'Architecture',
        accessorKey: 'status.nodeInfo.architecture',
        size: 120,
        enableSorting: true,
        enableHiding: false,
      },
      {
        id: 'os',
        header: 'OS',
        accessorKey: 'status.nodeInfo.osImage',
        size: 120,
        enableSorting: true,
        enableHiding: false,
      },
      {
        id: 'osImage',
        header: 'OS Image',
        accessorKey: 'status.nodeInfo.osImage',
        size: 200,
      },
      {
        id: 'kernelVersion',
        header: 'Kernel Version',
        accessorKey: 'status.nodeInfo.kernelVersion',
        size: 150,
      },
      {
        id: 'containerRuntimeVersion',
        header: 'Container Runtime',
        accessorKey: 'status.nodeInfo.containerRuntimeVersion',
        size: 200,
      },
      {
        id: 'kubeletVersion',
        header: 'Kubelet Version',
        accessorKey: 'status.nodeInfo.kubeletVersion',
        size: 150,
      },
      {
        id: 'cpuCapacity',
        header: 'CPU',
        accessorKey: 'status.capacity.cpu',
        size: 100,
      },
      {
        id: 'memoryCapacity',
        header: 'memory',
        accessorFn: (row) => convertByteUnits({ from: row?.status?.capacity?.memory || '' }),
        size: 120,
      },
      {
        id: 'podsCapacity',
        header: 'Pods',
        accessorKey: 'status.capacity.pods',
        size: 80,
      },
      {
        id: 'ephemeralStorageCapacity',
        header: 'Ephemeral Storage',
        accessorFn: (row) => convertByteUnits({ from: row?.status?.capacity?.['ephemeral-storage'] || '' }),
        size: 120,
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

  const [columnVisibility, _] = React.useState({
    'os': false,
    'kernelVersion': false,
    'containerRuntime': false,
    'cpuCapacity': false,
    'memoryCapacity': false,
    'podsCapacity': false,
    'ephemeralStorageCapacity': false,
  })

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey='core::v1::Node'
      idAccessor='metadata.uid'
      columnVisibility={columnVisibility}
      memoizer={'metadata.uid,metadata.resourceVersion'}
    />
  )
}

export default NodeTable;

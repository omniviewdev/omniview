import React from 'react'

import { ColumnDef } from '@tanstack/react-table'
import { Node } from 'kubernetes-types/core/v1'

import { useParams } from 'react-router-dom';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { convertByteUnits } from '../../../../../utils/units';
import { withClusterResourceColumns } from '../../shared/columns';
import { LuBox, LuCode } from 'react-icons/lu';
import NodeSidebar from '../../../sidebar/NodeSidebar';
import { DrawerComponent } from '@omniviewdev/runtime';
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage';

const resourceKey = 'core::v1::Node'

const NodeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<Node>>>(
    () => withClusterResourceColumns([
      {
        id: 'os',
        header: 'OS',
        accessorKey: 'status.nodeInfo.osImage',
        size: 120,
        enableSorting: true,
        enableHiding: false,
        meta: {
          defaultHidden: true,
        }
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
        meta: {
          defaultHidden: true,
        }
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
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'memoryCapacity',
        header: 'memory',
        accessorFn: (row) => convertByteUnits({ from: row?.status?.capacity?.memory || '' }),
        size: 120,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'podsCapacity',
        header: 'Pods',
        accessorKey: 'status.capacity.pods',
        size: 80,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'ephemeralStorageCapacity',
        header: 'Ephemeral Storage',
        accessorFn: (row) => convertByteUnits({ from: row?.status?.capacity?.['ephemeral-storage'] || '' }),
        size: 120,
        meta: {
          defaultHidden: true,
        }
      },
    ], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<Node> = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (ctx) => <NodeSidebar data={ctx.data || {}} />
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />
      }
    ],
    actions: []
  }), [])

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor='metadata.uid'
      memoizer={'metadata.uid,metadata.resourceVersion'}
      drawer={drawer}
    />
  )
}

export default NodeTable;

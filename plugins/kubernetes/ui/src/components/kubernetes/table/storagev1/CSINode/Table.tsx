import React from 'react'
import { useParams } from 'react-router-dom'
import { CSINode } from 'kubernetes-types/storage/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuHardDrive, LuCode, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { ChipListCell } from '../../shared/cells/ChipList'
import CSINodeSidebar from './Sidebar'

const resourceKey = 'storage::v1::CSINode'

const CSINodeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<CSINode>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'drivers',
          header: 'Drivers',
          accessorFn: (row) => row.spec?.drivers?.map(d => d.name),
          cell: ChipListCell,
          size: 300,
        },
        {
          id: 'allocatableCount',
          header: 'Allocatable Drivers',
          accessorFn: (row) =>
            row.spec?.drivers?.filter(d => d.allocatable)?.length ?? 0,
          size: 160,
        },
        {
          id: 'topologyKeys',
          header: 'Topology Keys',
          accessorFn: (row) =>
            row.spec?.drivers
              ?.flatMap(d => d.topologyKeys ?? [])
              .filter((v, i, a) => a.indexOf(v) === i),
          size: 220,
          cell: ChipListCell,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<CSINode> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuHardDrive />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <CSINodeSidebar ctx={ctx} />,
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data} />,
      },
    ],
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the CSINode{' '}
                <code>{ctx.data?.metadata?.name}</code>?
              </span>
            ),
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            onConfirm: async () => {
              await remove({
                opts: {
                  connectionID: id,
                  resourceKey,
                  resourceID: ctx.data?.metadata?.name as string,
                },
                input: {},
              })
              closeDrawer()
            },
          }),
      },
    ],
  }), [])

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="metadata.name"
      memoizer="metadata.name,metadata.resourceVersion"
      drawer={drawer}
    />
  )
}

export default CSINodeTable

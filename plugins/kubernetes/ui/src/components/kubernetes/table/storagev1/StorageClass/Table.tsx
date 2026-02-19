import React from 'react'
import { useParams } from 'react-router-dom'
import { StorageClass } from 'kubernetes-types/storage/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCode, LuLayers, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { ChipListCell } from '../../shared/cells/ChipList'
import StorageClassSidebar from './Sidebar'

const resourceKey = 'storage::v1::StorageClass'

const StorageClassTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<StorageClass>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'provisioner',
          header: 'Provisioner',
          accessorFn: (row) => row.provisioner,
          size: 250,
        },
        {
          id: 'reclaimPolicy',
          header: 'Reclaim Policy',
          accessorFn: (row) => row.reclaimPolicy ?? 'Delete',
          size: 120,
        },
        {
          id: 'volumeBindingMode',
          header: 'Binding Mode',
          accessorFn: (row) => row.volumeBindingMode ?? 'Immediate',
          size: 140,
        },
        {
          id: 'allowVolumeExpansion',
          header: 'Expandable',
          accessorFn: (row) => String(row.allowVolumeExpansion ?? false),
          size: 100,
        },
        {
          id: 'mountOptions',
          header: 'Mount Options',
          accessorFn: (row) => row.mountOptions || [],
          cell: ChipListCell,
          size: 150,
          meta: { defaultHidden: true },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<StorageClass> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuLayers />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <StorageClassSidebar ctx={ctx} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data} /> },
    ],
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <>Delete <strong>{ctx.data?.metadata?.name}</strong>?</>,
            body: <>Are you sure you want to delete the StorageClass <code>{ctx.data?.metadata?.name}</code>?</>,
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            onConfirm: async () => {
              await remove({
                opts: { connectionID: id, resourceKey, resourceID: ctx.data?.metadata?.name as string },
                input: {},
              })
              closeDrawer()
            },
          }),
      },
    ],
  }), [])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor="metadata.name" memoizer="metadata.name,metadata.resourceVersion" drawer={drawer} />
}

export default StorageClassTable

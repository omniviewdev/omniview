import React from 'react'
import { useParams } from 'react-router-dom'
import { VolumeAttachment } from 'kubernetes-types/storage/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCode, LuPlugZap, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import VolumeAttachmentSidebar from './Sidebar'

const resourceKey = 'storage::v1::VolumeAttachment'

const VolumeAttachmentTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<VolumeAttachment>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'nodeName',
          header: 'Node',
          accessorFn: (row) => row.spec?.nodeName ?? '—',
          size: 160,
        },
        {
          id: 'attacher',
          header: 'Attacher',
          accessorFn: (row) => row.spec?.attacher ?? '—',
          size: 220,
        },
        {
          id: 'volumeName',
          header: 'Volume Name',
          accessorFn: (row) => row.spec?.source?.persistentVolumeName ?? '—',
          size: 220,
        },
        {
          id: 'attached',
          header: 'Attached',
          accessorFn: (row) => String(row.status?.attached ?? false),
          size: 100,
        },
        {
          id: 'attachmentError',
          header: 'Attach Error',
          accessorFn: (row) => row.status?.attachError?.message ?? '',
          size: 300,
          meta: { defaultHidden: true },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<VolumeAttachment> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuPlugZap />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <VolumeAttachmentSidebar ctx={ctx} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data} /> },
    ],
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <>Delete <strong>{ctx.data?.metadata?.name}</strong>?</>,
            body: <>Are you sure you want to delete the VolumeAttachment <code>{ctx.data?.metadata?.name}</code>?</>,
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

export default VolumeAttachmentTable

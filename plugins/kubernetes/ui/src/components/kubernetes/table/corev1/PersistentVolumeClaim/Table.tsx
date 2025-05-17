import React from 'react'
import { useParams } from 'react-router-dom'
import { PersistentVolumeClaim } from 'kubernetes-types/core/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCode, LuHardDrive, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { ChipListCell } from '../../shared/cells/ChipList'

const resourceKey = 'core::v1::PersistentVolumeClaim'

const PersistentVolumeClaimTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<PersistentVolumeClaim>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'name',
          header: 'Name',
          accessorFn: (row) => row.metadata?.name ?? '—',
          size: 150,
        },
        {
          id: 'status',
          header: 'Status',
          accessorFn: (row) => row.status?.phase ?? 'Pending',
          size: 100,
        },
        {
          id: 'storage',
          header: 'Storage',
          accessorFn: (row) => row.spec?.resources?.requests?.storage ?? '—',
          size: 120,
        },
        {
          id: 'accessModes',
          header: 'Access Modes',
          accessorFn: (row) =>
            row.spec?.accessModes?.join(', ') ?? '—',
          size: 160,
        },
        {
          id: 'volumeMode',
          header: 'Volume Mode',
          accessorFn: (row) => row.spec?.volumeMode ?? '—',
          size: 120,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'volumeName',
          header: 'Volume Name',
          accessorFn: (row) => row.spec?.volumeName ?? '—',
          size: 150,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'storageClass',
          header: 'Storage Class',
          accessorFn: (row) => row.spec?.storageClassName ?? '—',
          size: 160,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'selector',
          header: 'Selector',
          accessorFn: (row) => Object.entries(row.spec?.selector?.matchLabels || {})
            .map(([k, v]) => `${k}=${v}`),
          cell: ChipListCell,
          size: 240,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<PersistentVolumeClaim> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuHardDrive />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />,
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />,
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
                Are you sure you want to delete the PersistentVolumeClaim{' '}
                <code>{ctx.data?.metadata?.name}</code> from{' '}
                <strong>{ctx.data?.metadata?.namespace}</strong>?
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
                  namespace: ctx.data?.metadata?.namespace as string,
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
      idAccessor="metadata.uid"
      memoizer="metadata.uid,metadata.resourceVersion"
      drawer={drawer}
    />
  )
}

export default PersistentVolumeClaimTable

import React from 'react'
import { useParams } from 'react-router-dom'
import { PersistentVolume } from 'kubernetes-types/core/v1'
import { ColumnDef } from '@tanstack/react-table'

import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell'
import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuBox, LuTrash } from 'react-icons/lu'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'
import PersistentVolumeSidebar from './Sidebar'

const resourceKey = 'core::v1::PersistentVolume'

const PersistentVolumeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<PersistentVolume>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'capacity',
          header: 'Capacity',
          accessorFn: (row) => row.spec?.capacity?.storage ?? '—',
          size: 100,
        },
        {
          id: 'accessModes',
          header: 'Access Modes',
          accessorFn: (row) => (row.spec?.accessModes ?? []).join(', '),
          size: 150,
        },
        {
          id: 'reclaimPolicy',
          header: 'Reclaim Policy',
          accessorFn: (row) => row.spec?.persistentVolumeReclaimPolicy ?? '—',
          size: 150,
        },
        {
          id: 'storageClass',
          header: 'Storage Class',
          accessorFn: (row) => row.spec?.storageClassName ?? '—',
          size: 150,
        },
        {
          id: 'claim',
          header: 'Claim',
          accessorFn: (row) => row.spec?.claimRef?.name,
          size: 200,
          cell: ({ row }) => {
            const claimRef = row.original.spec?.claimRef
            return claimRef?.name ? (
              <ResourceLinkCell
                connectionId={id}
                resourceId={claimRef.name}
                resourceKey="core::v1::PersistentVolumeClaim"
                resourceName={claimRef.name}
                namespace={claimRef.namespace}
              />
            ) : null
          },
        },
        {
          id: 'volumeMode',
          header: 'Volume Mode',
          accessorFn: (row) => row.spec?.volumeMode ?? 'Filesystem',
          size: 120,
        },
        {
          id: 'phase',
          header: 'Status',
          accessorFn: (row) => row.status?.phase ?? 'Unknown',
          size: 100,
        },
        {
          id: 'storageProvisioner',
          header: 'Provisioned By',
          accessorFn: (row) => row.metadata?.annotations?.['pv.kubernetes.io/provisioned-by'] ?? '',
          size: 200,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<PersistentVolume> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuBox />,
    views: createStandardViews({ SidebarComponent: PersistentVolumeSidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the PersistentVolume{' '}
                <code>{ctx.data?.metadata?.name}</code>? This action cannot be undone.
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
      idAccessor="metadata.uid"
      memoizer="metadata.uid,metadata.resourceVersion,status.phase"
      drawer={drawer}
    />
  )
}

export default PersistentVolumeTable

import React from 'react'
import { useParams } from 'react-router-dom'
import { ResourceQuota } from 'kubernetes-types/core/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuChartBar, LuTrash } from 'react-icons/lu'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'
import ResourceQuotaSidebar from './Sidebar'

const resourceKey = 'core::v1::ResourceQuota'

const ResourceQuotaTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<ResourceQuota>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'scopes',
          header: 'Scopes',
          accessorFn: (row) => row.spec?.scopes?.join(', ') ?? '—',
          size: 160,
        },
        {
          id: 'hardCpu',
          header: 'CPU (Used / Hard)',
          accessorFn: (row) => {
            const used = row.status?.used?.cpu
            const hard = row.spec?.hard?.cpu
            return `${used ?? '—'} / ${hard ?? '—'}`
          },
          size: 140,
        },
        {
          id: 'hardMemory',
          header: 'Memory (Used / Hard)',
          accessorFn: (row) => {
            const used = row.status?.used?.memory
            const hard = row.spec?.hard?.memory
            return `${used ?? '—'} / ${hard ?? '—'}`
          },
          size: 160,
        },
        {
          id: 'podsQuota',
          header: 'Pods (Used / Hard)',
          accessorFn: (row) => {
            const used = row.status?.used?.pods
            const hard = row.spec?.hard?.pods
            return `${used ?? '—'} / ${hard ?? '—'}`
          },
          size: 140,
        },
        {
          id: 'servicesQuota',
          header: 'Services (Used / Hard)',
          accessorFn: (row) => {
            const used = row.status?.used?.services
            const hard = row.spec?.hard?.services
            return `${used ?? '—'} / ${hard ?? '—'}`
          },
          size: 140,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'persistentVolumeClaims',
          header: 'PVCs (Used / Hard)',
          accessorFn: (row) => {
            const used = row.status?.used?.persistentvolumeclaims
            const hard = row.spec?.hard?.persistentvolumeclaims
            return `${used ?? '—'} / ${hard ?? '—'}`
          },
          size: 160,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'requestsStorage',
          header: 'Storage (Used / Hard)',
          accessorFn: (row) => {
            const used = row.status?.used?.['requests.storage']
            const hard = row.spec?.hard?.['requests.storage']
            return `${used ?? '—'} / ${hard ?? '—'}`
          },
          size: 160,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<ResourceQuota> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuChartBar />,
    views: createStandardViews({ SidebarComponent: ResourceQuotaSidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the ResourceQuota{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,status.used"
      drawer={drawer}
    />
  )
}

export default ResourceQuotaTable

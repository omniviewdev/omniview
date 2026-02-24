import React from 'react'
import { useParams } from 'react-router-dom'
import { IngressClass } from 'kubernetes-types/networking/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCircleCheck, LuCloudCog, LuTrash } from 'react-icons/lu'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'
import IngressClassSidebar from './Sidebar'

const resourceKey = 'networking.k8s.io/v1::IngressClass'

const IngressClassTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<IngressClass>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'controller',
          header: 'Controller',
          // TODO: Resource link to the resource that is acting as the controller  (deployment, statefulset, etc)
          accessorFn: (row) => row.spec?.controller ?? '—',
          size: 220,
        },
        {
          id: 'isDefault',
          header: 'Default',
          accessorFn: (row) =>
            row.metadata?.annotations?.['ingressclass.kubernetes.io/is-default-class'] === 'true'
              ? <LuCircleCheck />
              : <></>,
          size: 80,
        },
        {
          id: 'parameters',
          header: 'Parameters',
          accessorFn: (row) => {
            const p = row.spec?.parameters
            if (!p) return '—'
            const ref = `${p.scope}/${p.kind}${p.name ? `/${p.name}` : ''}`
            return p.namespace ? `${p.namespace}/${ref}` : ref
          },
          size: 250,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<IngressClass> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuCloudCog />,
    views: createStandardViews({ SidebarComponent: IngressClassSidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the IngressClass{' '}
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
      idAccessor="metadata.uid"
      memoizer="metadata.uid,metadata.resourceVersion,spec.controller"
      drawer={drawer}
    />
  )
}

export default IngressClassTable

import React from 'react'
import { useParams } from 'react-router-dom'
import { PodDisruptionBudget } from 'kubernetes-types/policy/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuShieldCheck, LuTrash } from 'react-icons/lu'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'
import PodDisruptionBudgetSidebar from './Sidebar'

const resourceKey = 'policy::v1::PodDisruptionBudget'

const PodDisruptionBudgetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<PodDisruptionBudget>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'minAvailable',
          header: 'Min Available',
          accessorFn: (row) => row.spec?.minAvailable ?? '—',
          size: 120,
        },
        {
          id: 'maxUnavailable',
          header: 'Max Unavailable',
          accessorFn: (row) => row.spec?.maxUnavailable ?? '—',
          size: 140,
        },
        {
          id: 'allowedDisruptions',
          header: 'Allowed Disruptions',
          accessorFn: (row) => row.status?.disruptionsAllowed ?? 0,
          size: 150,
        },
        {
          id: 'currentHealthy',
          header: 'Healthy',
          accessorFn: (row) => row.status?.currentHealthy ?? 0,
          size: 100,
        },
        {
          id: 'desiredHealthy',
          header: 'Desired Healthy',
          accessorFn: (row) => row.status?.desiredHealthy ?? 0,
          size: 130,
        },
        {
          id: 'expectedPods',
          header: 'Expected Pods',
          accessorFn: (row) => row.status?.expectedPods ?? 0,
          size: 120,
        },
        {
          id: 'selector',
          header: 'Selector',
          accessorFn: (row) =>
            row.spec?.selector?.matchLabels
              ? Object.entries(row.spec.selector.matchLabels)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')
              : '—',
          size: 250,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<PodDisruptionBudget> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuShieldCheck />,
    views: createStandardViews({ SidebarComponent: PodDisruptionBudgetSidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the PodDisruptionBudget{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,status.disruptionsAllowed"
      drawer={drawer}
    />
  )
}

export default PodDisruptionBudgetTable

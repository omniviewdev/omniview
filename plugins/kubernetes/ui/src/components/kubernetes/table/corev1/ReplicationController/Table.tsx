import React from 'react'
import { useParams } from 'react-router-dom'
import { ReplicationController } from 'kubernetes-types/core/v1'
import { ColumnDef } from '@tanstack/react-table'
import { Condition } from 'kubernetes-types/meta/v1'

import ConditionsCell from '../../shared/cells/ConditionsCell'
import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuLayers3, LuTrash } from 'react-icons/lu'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'
import ReplicationControllerSidebar from './Sidebar'

const resourceKey = 'core::v1::ReplicationController'

const ReplicationControllerTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<ReplicationController>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'desired',
          header: 'Desired',
          accessorFn: (row) => row.spec?.replicas ?? 0,
          size: 80,
        },
        {
          id: 'current',
          header: 'Current',
          accessorFn: (row) => row.status?.replicas ?? 0,
          size: 80,
        },
        {
          id: 'ready',
          header: 'Ready',
          accessorFn: (row) => row.status?.readyReplicas ?? 0,
          size: 80,
        },
        {
          id: 'available',
          header: 'Available',
          accessorFn: (row) => row.status?.availableReplicas ?? 0,
          size: 80,
        },
        {
          id: 'conditions',
          header: 'Conditions',
          accessorFn: (row) => row.status?.conditions,
          cell: ({ getValue }) => (
            <ConditionsCell
              conditions={getValue() as Condition[] | undefined}
              defaultHealthyColor="neutral"
              defaultUnhealthyColor="faded"
            />
          ),
          size: 250,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<ReplicationController> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuLayers3 />,
    views: createStandardViews({ SidebarComponent: ReplicationControllerSidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the ReplicationController{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,status.replicas"
      drawer={drawer}
    />
  )
}

export default ReplicationControllerTable

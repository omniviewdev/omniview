import React from 'react'
import { useParams } from 'react-router-dom'
import { StatefulSet } from 'kubernetes-types/apps/v1'
import { ColumnDef } from '@tanstack/react-table'
import { Condition } from 'kubernetes-types/meta/v1'

import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell'
import ConditionsCell from '../../shared/cells/ConditionsCell'
import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCode, LuClipboardList, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import StatefulSetSidebar from './Sidebar'

const resourceKey = 'apps::v1::StatefulSet'

const StatefulSetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<StatefulSet>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'desired',
          header: 'Desired',
          accessorFn: (row) => row.spec?.replicas ?? 1,
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
          id: 'updated',
          header: 'Updated',
          accessorFn: (row) => row.status?.updatedReplicas ?? 0,
          size: 80,
        },
        {
          id: 'available',
          header: 'Available',
          accessorFn: (row) => row.status?.currentReplicas ?? 0,
          size: 100,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'serviceName',
          header: 'Service',
          accessorKey: 'spec.serviceName',
          size: 150,
          cell: ({ getValue }) => (
            <ResourceLinkCell
              connectionId={id}
              resourceId={getValue() as string}
              resourceKey="core::v1::Service"
              resourceName={getValue() as string}
            />
          ),
        },
        {
          id: 'volumeClaimTemplates',
          header: 'Volume Claims',
          accessorFn: (row) => row.spec?.volumeClaimTemplates?.length ?? 0,
          size: 120,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'podManagementPolicy',
          header: 'Pod Management',
          accessorFn: (row) => row.spec?.podManagementPolicy ?? 'OrderedReady',
          size: 140,
        },
        {
          id: 'updateStrategy',
          header: 'Update Strategy',
          accessorFn: (row) => row.spec?.updateStrategy?.type ?? 'RollingUpdate',
          size: 140,
        },
        {
          id: 'revision',
          header: 'Revision',
          accessorKey: 'status.updateRevision',
          size: 120,
          meta: {
            defaultHidden: true,
          },
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

  const drawer: DrawerComponent<StatefulSet> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuClipboardList />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <StatefulSetSidebar data={ctx.data || {}} />,
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
                Are you sure you want to delete the StatefulSet{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,status.updatedReplicas"
      drawer={drawer}
    />
  )
}

export default StatefulSetTable

import React from 'react'
import { useParams } from 'react-router-dom'
import { Deployment } from 'kubernetes-types/apps/v1'
import { ColumnDef } from '@tanstack/react-table'
import { Condition } from 'kubernetes-types/meta/v1'

// import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell'
import ConditionsCell from '../../shared/cells/ConditionsCell'
import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, DrawerContext, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCode, LuScaling, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import DeploymentSidebar from './Sidebar'

const resourceKey = 'apps::v1::Deployment'

const DeploymentTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove, update } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  /**
   * Handler to go ahead and submit a resource change
   */
  const onEditorSubmit = (ctx: DrawerContext<Deployment>, value: Record<string, any>) => {
    update({
      opts: {
        connectionID: id,
        resourceKey,
        resourceID: ctx.data?.metadata?.name as string,
        namespace: ctx.data?.metadata?.namespace as string,
      },
      input: {
        input: value,
      },
    }).then(() => {
      closeDrawer()
    })
  }

  const columns = React.useMemo<Array<ColumnDef<Deployment>>>(
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
          id: 'updated',
          header: 'Updated',
          accessorFn: (row) => row.status?.updatedReplicas ?? 0,
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
          id: 'unavailable',
          header: 'Unavailable',
          accessorFn: (row) => row.status?.unavailableReplicas ?? 0,
          size: 100,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'strategy',
          header: 'Strategy',
          accessorFn: (row) => row.spec?.strategy?.type ?? 'RollingUpdate',
          size: 120,
        },
        {
          id: 'minReadySeconds',
          header: 'Min Ready Sec',
          accessorFn: (row) => `${row.spec?.minReadySeconds || 0}`,
          size: 100,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'progressDeadlineSeconds',
          header: 'Progress Deadline',
          accessorFn: (row) => row.spec?.progressDeadlineSeconds,
          size: 120,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'revision',
          header: 'Revision',
          accessorFn: (row) => row.status?.observedGeneration,
          size: 100,
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

  const drawer: DrawerComponent<Deployment> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuScaling />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <DeploymentSidebar ctx={ctx} />,
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data} onSubmit={(val) => onEditorSubmit(ctx, val)} />,
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
                Are you sure you want to delete the Deployment <code>{ctx.data?.metadata?.name}</code> from{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,status.observedGeneration"
      drawer={drawer}
    />
  )
}

export default DeploymentTable

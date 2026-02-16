import React from 'react'
import { useParams } from 'react-router-dom'
import { ReplicaSet } from 'kubernetes-types/apps/v1'
import { ColumnDef } from '@tanstack/react-table'
import { Condition, OwnerReference } from 'kubernetes-types/meta/v1'

import ConditionsCell from '../../shared/cells/ConditionsCell'
import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCode, LuScaling, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell'
import ReplicaSetSidebar from './Sidebar'

const ownerRefKeyMap: Record<string, string> = {
  "ReplicaSet": "apps::v1::ReplicaSet",
  "ReplicationController": "core::v1::ReplicationController",
  "StatefulSet": "apps::v1::StatefulSet",
  "DaemonSet": "apps::v1::DaemonSet",
  "Job": "batch::v1::Job",
  "CronJob": "batch::v1::CronJob",
  "Node": "core::v1::Node",
}

const resourceKey = 'apps::v1::ReplicaSet'

const ReplicaSetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<ReplicaSet>>>(
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
          id: 'controlledBy',
          header: 'Controlled By',
          accessorKey: 'metadata.ownerReferences',
          cell: ({ getValue }) => {
            const refs = getValue() as Array<OwnerReference> | undefined
            if (refs == undefined || refs.length === 0) {
              return <></>;
            }
            return (<ResourceLinkCell
              connectionId={id}
              resourceId={refs[0].name}
              resourceKey={ownerRefKeyMap[refs[0].kind]}
              resourceName={refs[0].kind}
            />
            )
          },
          size: 120,
        },
        {
          id: 'generation',
          header: 'Generation',
          accessorKey: 'metadata.generation',
          size: 80,
        },
        {
          id: 'conditions',
          header: 'Conditions',
          accessorFn: (row) => row.status?.conditions,
          cell: ({ getValue }) => (
            <ConditionsCell
              conditions={getValue() as Condition[] | undefined}
              defaultHealthyColor='neutral'
              defaultUnhealthyColor='faded'
            />
          ),
          meta: {
            defaultHidden: true,
          },
          size: 250,
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<ReplicaSet> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuScaling />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <ReplicaSetSidebar ctx={ctx} />
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />
      }
    ],
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: <span>Are you sure you want to delete the ReplicaSet <code>{ctx.data?.metadata?.name}</code> from <strong>{ctx.data?.metadata?.namespace}</strong>?</span>,
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
      idAccessor='metadata.uid'
      memoizer='metadata.uid,metadata.resourceVersion,status.observedGeneration'
      drawer={drawer}
    />
  )
}

export default ReplicaSetTable


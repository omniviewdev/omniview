import React from 'react'
import { useParams } from 'react-router-dom'
import { RuntimeClass } from 'kubernetes-types/node/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuRocket, LuTrash } from 'react-icons/lu'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'
import RuntimeClassSidebar from './Sidebar'

const resourceKey = 'node.k8s.io/v1::RuntimeClass'

const RuntimeClassTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<RuntimeClass>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'handler',
          header: 'Handler',
          accessorFn: (row) => row.handler ?? '—',
          size: 120,
          meta: {
            description: `Specifies the underlying runtime and configuration that the CRI implementation will use to handle pods of this class. The possible values are specific to the node & CRI configuration.  It is assumed that all handlers are available on every node, and handlers of the same name are equivalent on every node. For example, a handler called "runc" might specify that the runc OCI runtime (using native Linux containers) will be used to run the containers in a pod. The Handler must be lowercase, conform to the DNS Label (RFC 1123) requirements, and is immutable.`,
          },
        },
        {
          id: 'overheadCPU',
          header: 'Overhead (CPU)',
          accessorFn: (row) =>
            row.overhead?.podFixed?.cpu ?? '—',
          size: 120,
          meta: {
            description: `Represents the fixed CPU resource overhead associated with running a pod`,
          },
        },
        {
          id: 'overheadMemory',
          header: 'Overhead (Memory)',
          accessorFn: (row) =>
            row.overhead?.podFixed?.memory ?? '—',
          size: 140,
          meta: {
            description: `Represents the fixed Memory resource overhead associated with running a pod`,
          },
        },
        {
          id: 'schedulingNodeSelector',
          header: 'Node Selector',
          accessorFn: (row) =>
            row.scheduling?.nodeSelector
              ? Object.entries(row.scheduling.nodeSelector)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')
              : '—',
          size: 200,
          meta: {
            defaultHidden: true,
            description: `Lists labels that must be present on nodes that support this RuntimeClass. Pods using this RuntimeClass can only be scheduled to a node matched by this selector. The RuntimeClass nodeSelector is merged with a pod's existing nodeSelector. Any conflicts will cause the pod to be rejected in admission.`
          },
        },
        {
          id: 'schedulingTolerations',
          header: 'Tolerations',
          accessorFn: (row) =>
            row.scheduling?.tolerations?.length
              ? `${row.scheduling.tolerations.length} toleration(s)`
              : '—',
          size: 140,
          meta: {
            defaultHidden: true,
            description: `tolerations are appended (excluding duplicates) to pods running with this RuntimeClass during admission, effectively unioning the set of nodes tolerated by the pod and the RuntimeClass.`
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<RuntimeClass> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuRocket />,
    views: createStandardViews({ SidebarComponent: RuntimeClassSidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the RuntimeClass{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,handler"
      drawer={drawer}
    />
  )
}

export default RuntimeClassTable

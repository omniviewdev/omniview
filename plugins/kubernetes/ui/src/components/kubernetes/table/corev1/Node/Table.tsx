import React from 'react'

import { ColumnDef } from '@tanstack/react-table'
import { Node } from 'kubernetes-types/core/v1'

import { useParams } from 'react-router-dom';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { convertByteUnits } from '../../../../../utils/units';
import { withClusterResourceColumns } from '../../shared/columns';
import { LuBox, LuShieldBan, LuShieldCheck, LuArrowDownToLine, LuTerminal, LuTrash } from 'react-icons/lu';
import NodeSidebar from '../../../sidebar/NodeSidebar';
import { DrawerComponent, DrawerContext, useConfirmationModal, useExec, useExecuteAction, useResourceMutations, useRightDrawer, usePluginContext } from '@omniviewdev/runtime';
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { Condition } from 'kubernetes-types/meta/v1';
import { useClusterPreferences } from '../../../../../hooks/useClusterPreferences';

const resourceKey = 'core::v1::Node'

const NodeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()
  const { meta } = usePluginContext()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { createSession } = useExec({ pluginID: 'kubernetes' })
  const { executeAction } = useExecuteAction({ pluginID: 'kubernetes', connectionID: id, resourceKey })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()
  const { connectionOverrides } = useClusterPreferences(meta.id)
  const nodeShellConfig = connectionOverrides[id]?.nodeShellConfig

  const columns = React.useMemo<Array<ColumnDef<Node>>>(
    () => withClusterResourceColumns([
      {
        id: 'os',
        header: 'OS',
        accessorKey: 'status.nodeInfo.osImage',
        size: 120,
        enableSorting: true,
        enableHiding: false,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'osImage',
        header: 'OS Image',
        accessorKey: 'status.nodeInfo.osImage',
        size: 200,
      },
      {
        id: 'kernelVersion',
        header: 'Kernel Version',
        accessorKey: 'status.nodeInfo.kernelVersion',
        size: 150,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'containerRuntimeVersion',
        header: 'Container Runtime',
        accessorKey: 'status.nodeInfo.containerRuntimeVersion',
        size: 200,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'kubeletVersion',
        header: 'Kubelet Version',
        accessorKey: 'status.nodeInfo.kubeletVersion',
        size: 150,
      },
      {
        id: 'cpuCapacity',
        header: 'CPU',
        accessorKey: 'status.capacity.cpu',
        size: 100,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'memoryCapacity',
        header: 'Memory',
        accessorFn: (row) => convertByteUnits({ from: row?.status?.capacity?.memory || '' }),
        size: 120,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'podsCapacity',
        header: 'Pods',
        accessorKey: 'status.capacity.pods',
        size: 80,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'ephemeralStorageCapacity',
        header: 'Ephemeral Storage',
        accessorFn: (row) => convertByteUnits({ from: row?.status?.capacity?.['ephemeral-storage'] || '' }),
        size: 120,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'conditions',
        header: 'Conditions',
        accessorFn: (row) => row?.status?.conditions,
        cell: ({ getValue }) => <ConditionsCell conditions={getValue() as Condition[] | undefined} />
      }
    ], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<Node> = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: createStandardViews({ SidebarComponent: NodeSidebar }),
    actions: [
      {
        title: 'Cordon',
        icon: <LuShieldBan />,
        enabled: (ctx: DrawerContext<Node>) => !ctx.data?.spec?.unschedulable,
        action: (ctx: DrawerContext<Node>) => show({
          title: <span>Cordon <strong>{ctx.data?.metadata?.name}</strong>?</span>,
          body: <span>This will mark the node as unschedulable. No new pods will be placed on it.</span>,
          confirmLabel: 'Cordon',
          cancelLabel: 'Cancel',
          onConfirm: async () => {
            await executeAction({
              actionID: 'cordon',
              id: ctx.data?.metadata?.name,
            })
          },
        }),
      },
      {
        title: 'Uncordon',
        icon: <LuShieldCheck />,
        enabled: (ctx: DrawerContext<Node>) => !!ctx.data?.spec?.unschedulable,
        action: (ctx: DrawerContext<Node>) => show({
          title: <span>Uncordon <strong>{ctx.data?.metadata?.name}</strong>?</span>,
          body: <span>This will mark the node as schedulable again.</span>,
          confirmLabel: 'Uncordon',
          cancelLabel: 'Cancel',
          onConfirm: async () => {
            await executeAction({
              actionID: 'uncordon',
              id: ctx.data?.metadata?.name,
            })
          },
        }),
      },
      {
        title: 'Drain',
        icon: <LuArrowDownToLine />,
        action: (ctx: DrawerContext<Node>) => show({
          title: <span>Drain <strong>{ctx.data?.metadata?.name}</strong>?</span>,
          body: <span>This will evict all pods from the node and cordon it. DaemonSet-managed pods will be ignored.</span>,
          confirmLabel: 'Drain',
          cancelLabel: 'Cancel',
          onConfirm: async () => {
            await executeAction({
              actionID: 'drain',
              id: ctx.data?.metadata?.name,
              params: {
                gracePeriodSeconds: -1,
                ignoreDaemonSets: true,
                deleteEmptyDirData: true,
                force: false,
              },
            })
          },
        }),
      },
      {
        title: 'Shell',
        icon: <LuTerminal />,
        action: (ctx: DrawerContext<Node>) => createSession({
          connectionID: id,
          label: `node/${ctx.data?.metadata?.name}`,
          icon: 'LuTerminal',
          opts: {
            resource_plugin: 'kubernetes',
            resource_data: ctx.data,
            resource_key: resourceKey,
            params: {
              ...(nodeShellConfig?.image ? { node_shell_image: nodeShellConfig.image } : {}),
              ...(nodeShellConfig?.command ? { node_shell_command: nodeShellConfig.command } : {}),
            },
          },
        }).then(() => closeDrawer()),
      },
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx: DrawerContext<Node>) => show({
          title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
          body: <span>Are you sure you want to delete the Node <code>{ctx.data?.metadata?.name}</code>? This cannot be undone.</span>,
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
          onConfirm: async () => {
            await remove({
              opts: {
                connectionID: id,
                resourceKey,
                resourceID: ctx.data?.metadata?.name as string,
                namespace: '',
              },
              input: {},
            })
            closeDrawer()
          },
        }),
      },
    ]
  }), [id, nodeShellConfig])

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor='metadata.uid'
      memoizer={'metadata.uid,metadata.resourceVersion'}
      drawer={drawer}
    />
  )
}

export default NodeTable;

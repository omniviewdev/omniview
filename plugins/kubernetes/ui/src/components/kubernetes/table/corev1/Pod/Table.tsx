import React from 'react'
import { useParams } from 'react-router-dom';
import { ContainerStatus, Pod } from 'kubernetes-types/core/v1'
import { OwnerReference } from 'kubernetes-types/meta/v1';
import { ColumnDef } from '@tanstack/react-table'

import ResourceLinkCell from './cells/ResourceLinkCell';
import ContainerPhaseCell from './cells/ContainerPhaseCell';
import ContainerStatusCell from './cells/ContainerStatusCell';
import { withNamespacedResourceColumns } from '../../shared/columns';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { DrawerComponent, DrawerComponentActionListItem, useConfirmationModal, useExec, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime';
import { LuBugPlay, LuCode, LuContainer, LuLogs, LuScaling, LuSquareChartGantt, LuTerminal, LuTrash } from 'react-icons/lu';
import PodSidebar from '../../../sidebar/Pod';
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage';

const resourceKey = 'core::v1::Pod'

const ownerRefKeyMap: Record<string, string> = {
  "ReplicaSet": "apps::v1::ReplicaSet",
  "ReplicationController": "core::v1::ReplicationController",
  "StatefulSet": "apps::v1::StatefulSet",
  "DaemonSet": "apps::v1::DaemonSet",
  "Job": "batch::v1::Job",
  "CronJob": "batch::v1::CronJob",
  "Node": "core::v1::Node",
}

const PodTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { createSession } = useExec({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<Pod>>>(
    () => withNamespacedResourceColumns([
      {
        id: 'containers',
        header: 'Containers',
        accessorKey: 'status.containerStatuses',
        size: 150,
        cell: ({ getValue }) => <ContainerStatusCell data={getValue() as Array<ContainerStatus>} />,
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
        id: 'node',
        header: 'Node',
        accessorKey: 'spec.nodeName',
        size: 150,
        cell: ({ getValue }) => <ResourceLinkCell
          connectionId={id}
          resourceId={getValue() as string}
          resourceKey='core::v1::Node'
          resourceName={getValue() as string}
        />
      },
      {
        id: 'hostIP',
        header: 'Host IP',
        accessorKey: 'status.hostIP',
        size: 120,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'podIP',
        header: 'Pod IP',
        accessorKey: 'status.podIP',
        size: 120,
      },
      {
        id: 'qos',
        header: 'QoS',
        accessorKey: 'status.qosClass',
        size: 100,
      },
      {
        id: 'dnsPolicy',
        header: 'DNS Policy',
        accessorKey: 'spec.dnsPolicy',
        size: 100,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'serviceAccount',
        header: 'Service Account',
        accessorKey: 'spec.serviceAccountName',
        size: 120,
        cell: ({ getValue }) => <ResourceLinkCell
          connectionId={id}
          resourceId={getValue() as string}
          resourceKey={'core::v1::ServiceAccount'}
          resourceName={getValue() as string}
        />,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'preemptionPolicy',
        header: 'Preemption Policy',
        accessorKey: 'spec.preemptionPolicy',
        size: 200,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'priority',
        header: 'Priority',
        accessorKey: 'spec.priority',
        size: 100,
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'schedulerName',
        header: 'Scheduler Name',
        accessorKey: 'spec.schedulerName',
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'hostname',
        header: 'Hostname',
        accessorKey: 'spec.hostname',
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'restarts',
        header: 'Restarts',
        accessorFn: (row) => {
          let count = 0;
          for (const container of row.status?.containerStatuses ?? []) {
            count += container.restartCount ?? 0;
          }
          return count
        },
        size: 80,
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (row) => {
          return row.metadata?.deletionTimestamp
            ? 'Terminated'
            : row.status?.phase
        },
        cell: ({ getValue }) => <ContainerPhaseCell value={getValue() as string} />,
        size: 100,
        meta: {
          defaultHidden: false,
        }
      }
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<Pod> = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuContainer />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <PodSidebar data={ctx.data} />
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
        action: (ctx) => show({
          title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
          body: <span>Are you sure you want to delete the Pod <code>{ctx.data?.metadata?.name}</code> from <strong>{ctx.data?.metadata?.namespace}</strong>?</span>,
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
        })
      },
      {
        title: 'Exec',
        icon: <LuTerminal />,
        enabled: true,
        list: (ctx) => {
          const list: Array<DrawerComponentActionListItem> = []

          ctx.data?.spec?.containers?.forEach((container) => {
            list.push({
              title: container.name,
              action: () => createSession({
                connectionID: id,
                label: `${ctx.data?.metadata?.name}/${container.name}`,
                icon: 'LuContainer',
                opts: {
                  resource_plugin: 'kubernetes',
                  resource_data: ctx.data,
                  resource_key: ctx.resource?.key,
                }
              }).then(() => closeDrawer())
            })
          })
          ctx.data?.spec?.ephemeralContainers?.forEach((container) => {
            list.push({
              title: container.name,
              action: () => createSession({
                connectionID: id,
                label: `${ctx.data?.metadata?.name}/${container.name}`,
                icon: 'LuContainer',
                opts: {
                  resource_plugin: 'kubernetes',
                  resource_data: ctx.data,
                  resource_key: ctx.resource?.key,
                }
              }).then(() => closeDrawer())
            })
          })

          return list
        }
      },
      {
        title: 'Logs',
        icon: <LuLogs />,
        enabled: true,
        list: (ctx) => {
          const list: Array<DrawerComponentActionListItem> = []

          ctx.data?.spec?.containers?.forEach((container) => {
            list.push({
              title: container.name,
              action: () => console.log(`Getting logs for ${container.name}`)
            })
          })
          ctx.data?.spec?.initContainers?.forEach((container) => {
            list.push({
              title: container.name,
              action: () => console.log(`Getting logs for ${container.name}`)
            })
          })
          ctx.data?.spec?.ephemeralContainers?.forEach((container) => {
            list.push({
              title: container.name,
              action: () => console.log(`Getting logs for ${container.name}`)
            })
          })

          return list
        }
      },
      {
        title: 'Add Debug Container',
        icon: <LuBugPlay />,
        enabled: false,
        action: (_) => console.log('adding debug container'),
      },
      {
        title: 'Resize',
        icon: <LuScaling />,
        enabled: false,
        action: (_) => console.log('resize'),
      },
    ]
  }), [])

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

export default PodTable;

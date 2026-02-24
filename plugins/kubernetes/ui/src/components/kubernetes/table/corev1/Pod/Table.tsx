import React from 'react'
import { useParams } from 'react-router-dom';
import { ContainerStatus, Pod } from 'kubernetes-types/core/v1'
import { Condition, OwnerReference } from 'kubernetes-types/meta/v1';
import { ColumnDef } from '@tanstack/react-table'

import ResourceLinkCell from './cells/ResourceLinkCell';
import ContainerPhaseCell from './cells/ContainerPhaseCell';
import ContainerStatusCell from './cells/ContainerStatusCell';
import MetricUsageCell, { PodMetricsContext } from './cells/MetricUsageCell';
import { withNamespacedResourceColumns } from '../../shared/columns';
import ResourceTable from '../../../../shared/table/ResourceTable';
import { DrawerComponent, DrawerComponentActionListItem, DrawerContext, useConfirmationModal, useExec, useLogs, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime';
import { LuBugPlay, LuContainer, LuLogs, LuScaling, LuTerminal, LuTrash } from 'react-icons/lu';
import PodSidebar from '../../../sidebar/Pod';
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews';
import ConditionsCell from '../../shared/cells/ConditionsCell';
import { usePodMetricsBatch } from '../../../../../hooks/usePodMetricsBatch';

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

  const { remove, update } = useResourceMutations({ pluginID: 'kubernetes' })
  const { createSession } = useExec({ pluginID: 'kubernetes' })
  const { createLogSession } = useLogs({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()
  const { metricsMap } = usePodMetricsBatch({ connectionID: id })

  /**
   * Handler to go ahead and submit a resource change
   */
  const onEditorSubmit = (ctx: DrawerContext<Pod>, value: Record<string, any>) => {
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
        id: 'cpuUsage',
        header: 'CPU',
        accessorFn: (row) => `${row.metadata?.namespace}/${row.metadata?.name}`,
        cell: ({ getValue }) => <MetricUsageCell podKey={getValue() as string} format="cpu" />,
        size: 80,
      },
      {
        id: 'memUsage',
        header: 'Memory',
        accessorFn: (row) => `${row.metadata?.namespace}/${row.metadata?.name}`,
        cell: ({ getValue }) => <MetricUsageCell podKey={getValue() as string} format="memory" />,
        size: 80,
      },
      {
        id: 'controlledBy',
        header: 'Controlled By',
        accessorKey: 'metadata.ownerReferences',
        cell: ({ getValue, row }) => {
          const refs = getValue() as Array<OwnerReference> | undefined
          if (refs == undefined || refs.length === 0) {
            return <></>;
          }
          const ownerKind = refs[0].kind;
          const ownerKey = ownerRefKeyMap[ownerKind];
          if (!ownerKey) {
            return <ResourceLinkCell
              pluginID='kubernetes'
              connectionId={id}
              resourceId={refs[0].name}
              resourceKey={`${refs[0].apiVersion?.replace('/', '::')}::${ownerKind}`}
              resourceName={ownerKind}
              namespace={row.original.metadata?.namespace}
            />;
          }
          return (<ResourceLinkCell
            pluginID='kubernetes'
            connectionId={id}
            resourceId={refs[0].name}
            resourceKey={ownerKey}
            resourceName={ownerKind}
            namespace={row.original.metadata?.namespace}
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
          pluginID='kubernetes'
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
        cell: ({ getValue, row }) => <ResourceLinkCell
          pluginID='kubernetes'
          connectionId={id}
          resourceId={getValue() as string}
          resourceKey={'core::v1::ServiceAccount'}
          resourceName={getValue() as string}
          namespace={row.original.metadata?.namespace}
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
        id: 'conditions',
        header: 'Conditions',
        accessorFn: (row) => row?.status?.conditions,
        cell: ({ getValue }) => <ConditionsCell conditions={getValue() as Condition[] | undefined} defaultHealthyColor={'neutral'} defaultUnhealthyColor={'faded'} />,
        size: 250,
        meta: {
          defaultHidden: true,
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
    views: createStandardViews({ SidebarComponent: PodSidebar, onEditorSubmit }),
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
                  params: { container: container.name },
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
                  params: { container: container.name },
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
          const containers = ctx.data?.spec?.containers ?? []
          const initContainers = ctx.data?.spec?.initContainers ?? []
          const ephemeralContainers = ctx.data?.spec?.ephemeralContainers ?? []
          const allContainers = [...containers, ...initContainers, ...ephemeralContainers]
          const filterParams = { filter_labels: 'container' }

          if (allContainers.length > 1) {
            list.push({
              title: 'All Containers',
              action: () => createLogSession({
                connectionID: id,
                resourceKey,
                resourceID: ctx.data?.metadata?.name as string,
                resourceData: ctx.data as Record<string, any>,
                target: '',
                label: `Pod ${ctx.data?.metadata?.name}`,
                icon: 'LuLogs',
                params: filterParams,
              }).then(() => closeDrawer())
            })
          }

          containers.forEach((container) => {
            list.push({
              title: container.name,
              action: () => createLogSession({
                connectionID: id,
                resourceKey,
                resourceID: ctx.data?.metadata?.name as string,
                resourceData: ctx.data as Record<string, any>,
                target: container.name,
                label: `Pod ${ctx.data?.metadata?.name}`,
                icon: 'LuLogs',
                params: filterParams,
              }).then(() => closeDrawer())
            })
          })
          initContainers.forEach((container) => {
            list.push({
              title: `${container.name} (init)`,
              action: () => createLogSession({
                connectionID: id,
                resourceKey,
                resourceID: ctx.data?.metadata?.name as string,
                resourceData: ctx.data as Record<string, any>,
                target: container.name,
                label: `Pod ${ctx.data?.metadata?.name}`,
                icon: 'LuLogs',
                params: filterParams,
              }).then(() => closeDrawer())
            })
          })
          ephemeralContainers.forEach((container) => {
            list.push({
              title: `${container.name} (ephemeral)`,
              action: () => createLogSession({
                connectionID: id,
                resourceKey,
                resourceID: ctx.data?.metadata?.name as string,
                resourceData: ctx.data as Record<string, any>,
                target: container.name,
                label: `Pod ${ctx.data?.metadata?.name}`,
                icon: 'LuLogs',
                params: filterParams,
              }).then(() => closeDrawer())
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
    <PodMetricsContext.Provider value={metricsMap}>
      <ResourceTable
        columns={columns}
        connectionID={id}
        resourceKey={resourceKey}
        idAccessor='metadata.uid'
        memoizer={'metadata.uid,metadata.resourceVersion,status.phase'}
        drawer={drawer}
      />
    </PodMetricsContext.Provider>
  )
}

export default PodTable;

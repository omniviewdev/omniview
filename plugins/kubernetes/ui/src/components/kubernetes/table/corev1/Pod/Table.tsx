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
import { DrawerComponent } from '@omniviewdev/runtime';
import { LuBox } from 'react-icons/lu';
import PodSidebar from '../../../sidebar/Pod';

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

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (data: any) => <PodSidebar data={data} />
      },
    ],
    actions: []
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

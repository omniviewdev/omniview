import React from 'react'

import { ColumnDef } from '@tanstack/react-table'
import { Pod } from 'kubernetes-types/core/v1'

import SelectBoxHeader from '../../../../tables/cells/SelectBoxHeader';
import SelectBoxRow from '../../../../tables/cells/SelectBoxRow';
import ResourceLinkCell from './cells/ResourceLinkCell';
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../../shared/table/ResourceTable';
import ContainerStatusCell from './ContainerStatusCell';
import { OwnerReference } from 'kubernetes-types/meta/v1';
import AgeCell from './cells/AgeCell';

const ownerRefKeyMap: Record<string, string> = {
  "ReplicaSet": "apps::v1::ReplicaSet",
  "ReplicationController": "core::v1::ReplicationController",
  "StatefulSet": "apps::v1::StatefulSet",
  "DaemonSet": "apps::v1::DaemonSet",
  "Job": "batch::v1::Job",
  "CronJob": "batch::v1::CronJob",
}

const PodTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<Pod>>>(
    () => [
      {
        id: 'select',
        header: SelectBoxHeader,
        cell: SelectBoxRow,
        size: 40,
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'metadata.name',
        enableSorting: true,
        enableHiding: false,
      },
      {
        id: 'namespace',
        header: 'Namespace',
        accessorKey: 'metadata.namespace',
        size: 150,
        enableSorting: true,
        enableHiding: false,
      },
      {
        id: 'containers',
        header: 'Containers',
        accessorKey: 'status.containerStatuses',
        size: 150,
        cell: ({ getValue }) => <ContainerStatusCell data={getValue() as any} />,
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
        size: 150,
      },
      {
        id: 'node',
        header: 'Node',
        accessorKey: 'spec.nodeName',
        size: 200,
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
      },
      {
        id: 'serviceAccount',
        header: 'Service Account',
        accessorKey: 'spec.serviceAccountName',
        size: 120,
        cell: ({ getValue }) => {
          <ResourceLinkCell
            connectionId={id}
            resourceId={getValue() as string}
            resourceKey={'core::v1::ServiceAccount'}
            resourceName={getValue() as string}
          />
        },
      },
      {
        id: 'preemptionPolicy',
        header: 'Preemption Policy',
        accessorKey: 'spec.preemptionPolicy',
        size: 200,
      },
      {
        id: 'priority',
        header: 'Priority',
        accessorKey: 'spec.priority',
        size: 100,
      },
      {
        id: 'schedulerName',
        header: 'Scheduler Name',
        accessorKey: 'spec.schedulerName',
      },
      {
        id: 'hostname',
        header: 'Hostname',
        accessorKey: 'spec.hostname',
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
      },
      {
        id: 'age',
        header: 'Age',
        accessorKey: 'metadata.creationTimestamp',
        size: 100,
        cell: ({ getValue }) => <AgeCell value={getValue() as string} />
      },
    ],
    [id],
  )

  const [columnVisibility, _] = React.useState({
    'hostname': false,
    'schedulerName': false,
    'preemptionPolicy': false,
    'priority': false,
    'serviceAccount': false,
    'dnsPolicy': false,
    'hostIP': false,
  })

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey='core::v1::Pod'
      idAccessor='metadata.uid'
      columnVisibility={columnVisibility}
      memoizer={'metadata.uid,metadata.resourceVersion'}
    />
  )
}

export default PodTable;

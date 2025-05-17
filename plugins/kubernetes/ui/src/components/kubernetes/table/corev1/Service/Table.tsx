import React from 'react'
import { useParams } from 'react-router-dom'
import { Service } from 'kubernetes-types/core/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCode, LuNetwork, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { ChipListCell } from '../../shared/cells/ChipList'
import ServiceSidebar from './Sidebar'

const resourceKey = 'core::v1::Service'

const ServiceTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<Service>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'type',
          header: 'Type',
          accessorFn: (row) => row.spec?.type ?? 'ClusterIP',
          size: 120,
        },
        {
          id: 'clusterIP',
          header: 'Cluster IP',
          accessorFn: (row) => row.spec?.clusterIP ?? '—',
          size: 140,
        },
        {
          id: 'externalIPs',
          header: 'External IPs',
          accessorFn: (row) => row.spec?.externalIPs,
          size: 180,
          cell: ChipListCell
        },
        {
          id: 'ports',
          header: 'Ports',
          accessorFn: (row) =>
            row.spec?.ports?.map(p => `${p.port}/${p.protocol ?? 'TCP'}${p.nodePort ? ` → ${p.nodePort}` : ''}`),
          cell: ChipListCell,
          size: 240,
        },
        {
          id: 'selector',
          header: 'Selector',
          accessorFn: (row) => Object.entries(row.spec?.selector || {}).map(([k, v]) => `${k}=${v}`),
          cell: ChipListCell,
          size: 240,
        },
        {
          id: 'externalName',
          header: 'External Name',
          accessorFn: (row) => row.spec?.externalName ?? '—',
          size: 180,
          meta: {
            defaultHidden: true,
            description: `The external reference that discovery mechanisms will return as an alias for this service (e.g. a DNS CNAME record). No proxying will be involved.  Must be a lowercase RFC-1123 hostname (https://tools.ietf.org/html/rfc1123) and requires \`type\` to be "ExternalName".`
          },
        },
        {
          id: 'sessionAffinity',
          header: 'Session Affinity',
          accessorFn: (row) => row.spec?.sessionAffinity ?? 'None',
          size: 140,
          meta: {
            defaultHidden: true,
            description: `Supports "ClientIP" and "None". Used to maintain session affinity. Enable client IP based session affinity. Must be ClientIP or None. Defaults to None. More info: https://kubernetes.io/docs/concepts/services-networking/service/#virtual-ips-and-service-proxies`
          },
        },
        {
          id: 'ipFamilyPolicy',
          header: 'IP Family Policy',
          accessorFn: (row) => row.spec?.ipFamilyPolicy,
          size: 140,
          meta: {
            defaultHidden: true,
            description: `IPFamilyPolicy represents the dual-stack-ness requested or required by this Service. If there is no value provided, then this field will be set to SingleStack. Services can be "SingleStack" (a single IP family), "PreferDualStack" (two IP families on dual-stack configured clusters or a single IP family on single-stack clusters), or "RequireDualStack" (two IP families on dual-stack configured clusters, otherwise fail). The ipFamilies and clusterIPs fields depend on the value of this field. This field will be wiped when updating a service to type ExternalName.`
          },
        },
        {
          id: 'trafficDistribution',
          header: 'Traffic Distribution',
          accessorFn: (row) => row.spec?.trafficDistribution,
          size: 120,
          meta: {
            defaultHidden: true,
            description: `TrafficDistribution offers a way to express preferences for how traffic is distributed to Service endpoints. Implementations can use this field as a hint, but are not required to guarantee strict adherence. If the field is not set, the implementation will apply its default routing strategy. If set to "PreferClose", implementations should prioritize endpoints that are topologically close (e.g., same zone).`
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<Service> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuNetwork />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <ServiceSidebar data={ctx.data} />,
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data} />,
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
                Are you sure you want to delete the Service{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,spec.ports"
      drawer={drawer}
    />
  )
}

export default ServiceTable

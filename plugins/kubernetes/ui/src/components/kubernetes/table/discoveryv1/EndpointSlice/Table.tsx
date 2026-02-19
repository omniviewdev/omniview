import React from 'react'
import { useParams } from 'react-router-dom'
import { EndpointSlice } from 'kubernetes-types/discovery/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCode, LuListTree, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell'
import EndpointSliceSidebar from './Sidebar'
import ChipList from '../../shared/cells/ChipList'

const resourceKey = 'discovery::v1::EndpointSlice'

const EndpointSliceTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<EndpointSlice>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'addressType',
          header: 'Address Type',
          accessorFn: (row) => row.addressType,
          size: 100,
        },
        {
          id: 'endpointsReady',
          header: 'Ready / Total',
          accessorFn: (row) => {
            const ready = row.endpoints?.filter(e => e.conditions?.ready)?.length ?? 0
            const total = row.endpoints?.length ?? 0
            return `${ready} / ${total}`
          },
          size: 100,
        },
        {
          id: 'ports',
          header: 'Ports',
          accessorFn: (row) =>
            row.ports
              ?.map(p => `${p.name ?? 'unnamed'}:${p.port}/${p.protocol}`),
          cell: ({ getValue }) => <ChipList values={getValue() as string[]} />,
          size: 220,
          meta: {
            flex: 1
          }
        },
        {
          id: 'topologyHints',
          header: 'Topology Hints',
          accessorFn: (row) => {
            const hints = row.endpoints
              ?.flatMap(e => e.hints?.forZones?.map(z => z.name) ?? [])
              .filter(Boolean)
            return hints?.length ? [...new Set(hints)].join(', ') : '—'
          },
          size: 120,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'ownerService',
          header: 'Service',
          accessorFn: (row) => row.metadata?.labels?.['kubernetes.io/service-name'],
          cell: ({ row }) => {
            const name = row.original.metadata?.labels?.['kubernetes.io/service-name']
            return name ? (
              <ResourceLinkCell
                connectionId={id}
                resourceId={name}
                resourceKey="core::v1::Service"
                resourceName={name}
                namespace={row.original.metadata?.namespace}
              />
            ) : null
          },
          size: 180,
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<EndpointSlice> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuListTree />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <EndpointSliceSidebar ctx={ctx} />,
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
                Are you sure you want to delete the EndpointSlice{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,endpoints"
      drawer={drawer}
    />
  )
}

export default EndpointSliceTable

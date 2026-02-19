import React from 'react'
import { useParams } from 'react-router-dom'
import { Endpoints } from 'kubernetes-types/core/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCode, LuListEnd, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import EndpointsSidebar from './Sidebar'
import ChipList from '../../shared/cells/ChipList'

const resourceKey = 'core::v1::Endpoints'

const EndpointsTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<Endpoints>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'subsetsCount',
          header: 'Subsets',
          accessorFn: (row) => row.subsets?.length ?? 0,
          size: 80,
        },
        {
          id: 'addresses',
          header: 'Addresses',
          accessorFn: (row) =>
            row.subsets
              ?.flatMap((s) => s.addresses ?? [])
              .map((a) => a.ip) || [],
          cell: ({ getValue }) => <ChipList values={getValue() as string[]} />,
          size: 200,
        },
        {
          id: 'notReadyAddresses',
          header: 'Not Ready',
          accessorFn: (row) =>
            row.subsets
              ?.flatMap((s) => s.notReadyAddresses ?? [])
              .map((a) => a.ip) || [],
          cell: ({ getValue }) => <ChipList values={getValue() as string[]} />,
          size: 200,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'ports',
          header: 'Ports',
          accessorFn: (row) =>
            row.subsets
              ?.flatMap((s) => s.ports ?? [])
              .map((p) => `${p.name ?? ''}:${p.port}/${p.protocol}`) || [],
          size: 240,
          cell: ({ getValue }) => <ChipList values={getValue() as string[]} />,
          meta: {
            flex: 1,
          }
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<Endpoints> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuListEnd />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <EndpointsSidebar ctx={ctx} />,
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
                Are you sure you want to delete the Endpoints object{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,subsets"
      drawer={drawer}
    />
  )
}

export default EndpointsTable

import React from 'react'
import { useParams } from 'react-router-dom'
import { Namespace } from 'kubernetes-types/core/v1'
import { ColumnDef } from '@tanstack/react-table'

// import ConditionsCell from '../../shared/cells/ConditionsCell'
import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuLayoutTemplate, LuTrash } from 'react-icons/lu'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'
import AgeCell from '../../shared/cells/AgeCell'
import { Chip } from '@omniviewdev/ui'
import ContainerPhaseCell from '../Pod/cells/ContainerPhaseCell'
import NamespaceSidebar from './Sidebar'

const resourceKey = 'core::v1::Namespace'

const NamespaceTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<Namespace>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'finalizers',
          header: 'Finalizers',
          accessorKey: 'spec.finalizers',
          cell: ({ getValue }) => (getValue() as string[] | undefined)?.map(f => <Chip size='sm' sx={{ borderRadius: '2px' }} color={'primary'} label={f} />) ?? '',
          size: 250,
          meta: {
            defaultHidden: true,
          },
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
        },
        {
          id: 'deletionTimestamp',
          header: 'Marked for Deletion',
          accessorFn: (row) => row.metadata?.deletionTimestamp ?? '',
          cell: ({ getValue }) => <AgeCell value={getValue() as string} />,
          size: 180,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<Namespace> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuLayoutTemplate />,
    views: createStandardViews({ SidebarComponent: NamespaceSidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the Namespace{' '}
                <code>{ctx.data?.metadata?.name}</code>? This action is irreversible.
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
      memoizer="metadata.uid,metadata.resourceVersion,status.phase"
      drawer={drawer}
    />
  )
}

export default NamespaceTable

import React from 'react'
import { useParams } from 'react-router-dom'
import { LocalObjectReference, ObjectReference, ServiceAccount } from 'kubernetes-types/core/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuUserCheck, LuCode, LuSquareChartGantt, LuTrash, LuCircleCheck } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { Stack } from '@mui/joy'
import ResourceLinkCell from '../Pod/cells/ResourceLinkCell'
import ServiceAccountSidebar from './Sidebar'

const resourceKey = 'core::v1::ServiceAccount'

const ServiceAccountTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<ServiceAccount>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'secrets',
          header: 'Secrets',
          accessorFn: (row) => row.secrets,
          size: 100,
          cell: ({ getValue }) => {
            const refs = getValue() as ObjectReference[] | undefined
            if (!refs || !refs?.length) {
              return <></>
            }

            return (
              <Stack
                direction={'row'}
                overflow={'scroll'}
                gap={0.25}
                sx={{
                  scrollbarWidth: "none",
                  // hide scrollbar
                  "&::-webkit-scrollbar": {
                    display: "none",
                  },
                }}
              >
                {refs.map(v => (
                  <ResourceLinkCell
                    connectionId={id}
                    resourceId={v.name || ''}
                    resourceKey={'core::v1::Secret'}
                    resourceName={v.namespace ? `${v.name}/${v.namespace}` : v.name}
                    namespace={v.namespace}
                  />
                ))}
              </Stack>
            )
          },
        },
        {
          id: 'automountToken',
          header: 'Automount Token',
          accessorFn: (row) => !!row.automountServiceAccountToken,
          cell: ({ getValue }) => (getValue() as boolean) ? <LuCircleCheck /> : <></>,
          size: 150,
        },
        {
          id: 'imagePullSecrets',
          header: 'Image Pull Secrets',
          accessorFn: (row) => row.imagePullSecrets,
          size: 200,
          cell: ({ getValue, row }) => {
            const refs = getValue() as LocalObjectReference[] | undefined
            if (!refs || !refs?.length) {
              return <></>
            }

            return (
              <Stack
                direction={'row'}
                overflow={'scroll'}
                gap={0.25}
                sx={{
                  scrollbarWidth: "none",
                  // hide scrollbar
                  "&::-webkit-scrollbar": {
                    display: "none",
                  },
                }}
              >
                {refs.map(v => (
                  <ResourceLinkCell
                    connectionId={id}
                    resourceId={v.name || ''}
                    resourceKey={'core::v1::Secret'}
                    resourceName={v.name || ''}
                    namespace={row.original.metadata?.namespace}
                  />
                ))}
              </Stack>
            )
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<ServiceAccount> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuUserCheck />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <ServiceAccountSidebar data={ctx.data} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data} /> },
    ],
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <>Delete <strong>{ctx.data?.metadata?.name}</strong>?</>,
            body: <>Are you sure you want to delete ServiceAccount <code>{ctx.data?.metadata?.name}</code>?</>,
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            onConfirm: async () => {
              await remove({
                opts: { connectionID: id, resourceKey, resourceID: ctx.data?.metadata?.name as string, namespace: ctx.data?.metadata?.namespace },
                input: {},
              })
              closeDrawer()
            },
          }),
      },
    ],
  }), [])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor="metadata.uid" memoizer="metadata.uid,metadata.resourceVersion" drawer={drawer} />
}

export default ServiceAccountTable

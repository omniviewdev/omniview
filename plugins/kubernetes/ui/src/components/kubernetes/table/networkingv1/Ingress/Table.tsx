import React from 'react'
import { useParams } from 'react-router-dom'
import { Ingress } from 'kubernetes-types/networking/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuRoute, LuTrash } from 'react-icons/lu'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'
import IngressSidebar from '../../../sidebar/Ingress'
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell'
import { ChipListCell } from '../../shared/cells/ChipList'
import { Stack } from '@omniviewdev/ui/layout'

const resourceKey = 'networking::v1::Ingress'

const IngressTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<Ingress>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'ingressClass',
          header: 'Ingress Class',
          accessorFn: (row) => row.spec?.ingressClassName ?? '—',
          size: 150,
        },
        {
          id: 'rules',
          header: 'Rules',
          accessorFn: (row) =>
            row.spec?.rules
              ?.map(rule => {
                const host = rule.host ?? '*'
                const paths = rule.http?.paths?.map(p => p.path ?? '/').join(', ')
                return `${host} → ${paths}`
              }) || [],
          cell: ChipListCell,
          size: 320,
        },
        {
          id: 'backends',
          header: 'Backends',
          accessorFn: (row) => {
            const services = row.spec?.rules
              ?.flatMap(rule => rule.http?.paths ?? [])
              .map(p => `${p.backend.service?.name}:${p.backend.service?.port?.number ?? p.backend.service?.port?.name}`)
              .filter(Boolean)
            return services?.length ? [...new Set(services)] : []
          },
          cell: ChipListCell,
          size: 250,
        },
        {
          id: 'tlsHosts',
          header: 'TLS Hosts',
          accessorFn: (row) =>
            row.spec?.tls
              ?.flatMap(tls => tls.hosts ?? []),
          cell: ChipListCell,
          size: 200,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'tlsSecret',
          header: 'TLS Secret',
          accessorFn: (row) =>
            row.spec?.tls
              ?.map(tls => tls.secretName)
              .filter(Boolean) || [],
          size: 120,
          meta: {
            defaultHidden: true,
          },
          cell: ({ getValue }) => {
            const val = getValue() as string[] | undefined
            if (!val) {
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
                {val.map(v => (
                  <ResourceLinkCell
                    connectionId={id}
                    resourceId={v}
                    resourceKey={'core::v1::Secret'}
                    resourceName={v}
                  />
                ))}
              </Stack>
            )
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<Ingress> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuRoute />,
    views: createStandardViews({ SidebarComponent: IngressSidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the Ingress{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,spec.rules"
      drawer={drawer}
    />
  )
}

export default IngressTable

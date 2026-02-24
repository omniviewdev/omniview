import React from 'react'
import { useParams } from 'react-router-dom'
import { NetworkPolicy } from 'kubernetes-types/networking/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuShield, LuTrash } from 'react-icons/lu'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'
import ChipList from '../../shared/cells/ChipList'
import NetworkPolicySidebar from './Sidebar'

const resourceKey = 'networking.k8s.io/v1::NetworkPolicy'

const NetworkPolicyTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<NetworkPolicy>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'types',
          header: 'Policy Types',
          accessorFn: (row) => row.spec?.policyTypes,
          cell: ({ getValue }) => {
            const val = getValue() as string[] | undefined

            if (!val) {
              return '--'
            }

            return <ChipList values={val} />
          },
          size: 120,
        },
        {
          id: 'podSelector',
          header: 'Pod Selector',
          accessorFn: (row) =>
            row.spec?.podSelector?.matchLabels
              ? Object.entries(row.spec.podSelector.matchLabels)
                .map(([k, v]) => `${k}=${v}`)
              : 'All Pods',
          cell: ({ getValue }) => {
            const val = getValue() as string[] | string

            if (typeof val === 'string') {
              return val
            }

            return <ChipList values={val} />
          },
          size: 250,
        },
        {
          id: 'ingressRules',
          header: 'Ingress Rules',
          accessorFn: (row) => row.spec?.ingress?.length ?? 0,
          size: 120,
        },
        {
          id: 'egressRules',
          header: 'Egress Rules',
          accessorFn: (row) => row.spec?.egress?.length ?? 0,
          size: 120,
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<NetworkPolicy> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuShield />,
    views: createStandardViews({ SidebarComponent: NetworkPolicySidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the NetworkPolicy{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,spec.policyTypes"
      drawer={drawer}
    />
  )
}

export default NetworkPolicyTable

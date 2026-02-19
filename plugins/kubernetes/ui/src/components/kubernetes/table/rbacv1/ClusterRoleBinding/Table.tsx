import React from 'react'
import { useParams } from 'react-router-dom'
import { ClusterRoleBinding, RoleRef, Subject } from 'kubernetes-types/rbac/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuLink, LuCode, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import ClusterRoleBindingSidebar from './Sidebar'
import ResourceLinkCell from '../../corev1/Pod/cells/ResourceLinkCell'
import { Stack } from '@mui/joy'

const resourceKey = 'rbac::v1::ClusterRoleBinding'

const ownerRefKeyMap: Record<string, string> = {
  "ServiceAccount": "core::v1::ServiceAccount",
  "ClusterRole": "rbac::v1::ClusterRole",
  "Role": "rbac::v1::Role",
}

const ClusterRoleBindingTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<ClusterRoleBinding>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'roleRef',
          header: 'Role',
          accessorKey: 'roleRef',
          cell: ({ getValue }) => {
            const ref = getValue() as RoleRef | undefined
            if (ref == undefined) {
              return <></>;
            }
            return (
              <ResourceLinkCell
                connectionId={id}
                resourceId={ref.name}
                resourceKey={ownerRefKeyMap[ref.kind]}
                resourceName={ref.name}
              />
            )
          },
          size: 200,
          meta: {
            flex: 1,
          }
        },
        {
          id: 'subjects',
          header: 'Subjects',
          accessorKey: 'subjects',
          cell: ({ getValue }) => {
            const refs = getValue() as Subject[] | undefined
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
                    resourceId={v.namespace ? `${v.name}/${v.namespace}` : v.name}
                    resourceKey={ownerRefKeyMap[v.kind]}
                    resourceName={v.namespace ? `${v.name}/${v.namespace}` : v.name}
                  />
                ))}
              </Stack>
            )
          },
          size: 300,
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<ClusterRoleBinding> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuLink />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <ClusterRoleBindingSidebar ctx={ctx} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data} /> },
    ],
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <>Delete <strong>{ctx.data?.metadata?.name}</strong>?</>,
            body: <>Are you sure you want to delete ClusterRoleBinding <code>{ctx.data?.metadata?.name}</code>?</>,
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            onConfirm: async () => {
              await remove({
                opts: { connectionID: id, resourceKey, resourceID: ctx.data?.metadata?.name as string },
                input: {},
              })
              closeDrawer()
            },
          }),
      },
    ],
  }), [])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor="metadata.name" memoizer="metadata.name,metadata.resourceVersion" drawer={drawer} />
}

export default ClusterRoleBindingTable

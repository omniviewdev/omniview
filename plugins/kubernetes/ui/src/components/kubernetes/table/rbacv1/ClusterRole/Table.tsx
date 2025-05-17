import React from 'react'
import { useParams } from 'react-router-dom'
import { ClusterRole } from 'kubernetes-types/rbac/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuShieldQuestion, LuCode, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import ClusterRoleSidebar from './Sidebar'

const resourceKey = 'rbac::v1::ClusterRole'

const ClusterRoleTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<ClusterRole>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'rules',
          header: 'Rules',
          accessorFn: (row) =>
            row.rules?.map(r => `${r.verbs.join(', ')} on ${r.resources?.join(', ')}`).join(' | ') ?? '—',
          size: 300,
        },
        {
          id: 'aggregation',
          header: 'Aggregated From',
          accessorFn: (row) =>
            row.aggregationRule?.clusterRoleSelectors?.map(s => JSON.stringify(s.matchLabels)).join(', ') ?? '—',
          size: 250,
          meta: { defaultHidden: true },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<ClusterRole> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuShieldQuestion />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <ClusterRoleSidebar data={ctx.data} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data} /> },
    ],
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <>Delete <strong>{ctx.data?.metadata?.name}</strong>?</>,
            body: <>Are you sure you want to delete ClusterRole <code>{ctx.data?.metadata?.name}</code>?</>,
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

export default ClusterRoleTable

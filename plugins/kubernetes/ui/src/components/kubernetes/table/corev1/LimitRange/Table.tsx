import React from 'react'
import { useParams } from 'react-router-dom'
import { LimitRange } from 'kubernetes-types/core/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuTextSelect, LuCode, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import LimitRangeSidebar from './Sidebar'

const resourceKey = 'core::v1::LimitRange'

const LimitRangeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<LimitRange>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'limitsCount',
          header: 'Limit Items',
          accessorFn: (row) => row.spec?.limits?.length ?? 0,
          size: 100,
        },
        {
          id: 'scopes',
          header: 'Scopes',
          accessorFn: (row) =>
            (row.spec?.limits ?? [])
              .map((limit) => limit.type)
              .filter(Boolean)
              .join(', '),
          size: 150,
        },
        {
          id: 'cpuDefaults',
          header: 'CPU (Default/Max)',
          accessorFn: (row) => {
            const containerLimits = row.spec?.limits?.find(l => l.type === 'Container')
            const def = containerLimits?.default?.cpu
            const max = containerLimits?.max?.cpu
            return `${def ?? '—'} / ${max ?? '—'}`
          },
          size: 160,
        },
        {
          id: 'memoryDefaults',
          header: 'Memory (Default/Max)',
          accessorFn: (row) => {
            const containerLimits = row.spec?.limits?.find(l => l.type === 'Container')
            const def = containerLimits?.default?.memory
            const max = containerLimits?.max?.memory
            return `${def ?? '—'} / ${max ?? '—'}`
          },
          size: 160,
        },
        {
          id: 'defaultRequestCPU',
          header: 'CPU Default Request',
          accessorFn: (row) => {
            const containerLimits = row.spec?.limits?.find(l => l.type === 'Container')
            return containerLimits?.defaultRequest?.cpu ?? '—'
          },
          size: 140,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'defaultRequestMemory',
          header: 'Memory Default Request',
          accessorFn: (row) => {
            const containerLimits = row.spec?.limits?.find(l => l.type === 'Container')
            return containerLimits?.defaultRequest?.memory ?? '—'
          },
          size: 160,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<LimitRange> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuTextSelect />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <LimitRangeSidebar data={ctx.data || {}} />,
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
                Are you sure you want to delete the LimitRange{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,spec.limits"
      drawer={drawer}
    />
  )
}

export default LimitRangeTable

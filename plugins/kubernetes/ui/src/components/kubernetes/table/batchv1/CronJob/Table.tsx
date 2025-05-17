import React from 'react'
import { useParams } from 'react-router-dom'
import { CronJob } from 'kubernetes-types/batch/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuCalendarClock, LuCode, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import CronJobSidebar from './Sidebar'

const resourceKey = 'batch::v1::CronJob'

const CronJobTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<CronJob>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'schedule',
          header: 'Schedule',
          accessorFn: (row) => row.spec?.schedule,
          size: 140,
        },
        {
          id: 'concurrencyPolicy',
          header: 'Concurrency Policy',
          accessorFn: (row) => row.spec?.concurrencyPolicy ?? 'Allow',
          size: 160,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'suspend',
          header: 'Suspended',
          accessorFn: (row) => (row.spec?.suspend ? 'Yes' : 'No'),
          size: 100,
        },
        {
          id: 'lastScheduleTime',
          header: 'Last Schedule Time',
          accessorFn: (row) => row.status?.lastScheduleTime,
          size: 180,
          cell: ({ getValue }) => {
            const val = getValue() as string
            return val ? new Date(val).toLocaleString() : ''
          },
        },
        {
          id: 'activeJobs',
          header: 'Active Jobs',
          accessorFn: (row) => row.status?.active?.length ?? 0,
          size: 100,
        },
        {
          id: 'startingDeadline',
          header: 'Starting Deadline (s)',
          accessorFn: (row) => row.spec?.startingDeadlineSeconds,
          size: 160,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'successfulJobsHistoryLimit',
          header: 'Success History',
          accessorFn: (row) => row.spec?.successfulJobsHistoryLimit,
          size: 140,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'failedJobsHistoryLimit',
          header: 'Failure History',
          accessorFn: (row) => row.spec?.failedJobsHistoryLimit,
          size: 140,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<CronJob> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuCalendarClock />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <CronJobSidebar data={ctx.data || {}} />,
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
                Are you sure you want to delete the CronJob <code>{ctx.data?.metadata?.name}</code> from{' '}
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
      memoizer="metadata.uid,metadata.resourceVersion,status.lastScheduleTime"
      drawer={drawer}
    />
  )
}

export default CronJobTable

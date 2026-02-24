import React from 'react'
import { useParams } from 'react-router-dom'
import { DaemonSet } from 'kubernetes-types/apps/v1'
import { ColumnDef } from '@tanstack/react-table'
import { Condition } from 'kubernetes-types/meta/v1'

// import ResourceLinkCell from './cells/ResourceLinkCell'
import ConditionsCell from '../../shared/cells/ConditionsCell'
import { withNamespacedResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, DrawerComponentActionListItem, useConfirmationModal, useLogs, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuLogs, LuServerCog, LuTrash } from 'react-icons/lu'
import DaemonSetSidebar from './Sidebar'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'

const resourceKey = 'apps::v1::DaemonSet'

const DaemonSetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { createLogSession } = useLogs({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<DaemonSet>>>(
    () =>
      withNamespacedResourceColumns([
        {
          id: 'desired',
          header: 'Desired',
          accessorFn: (row) => row.status?.desiredNumberScheduled ?? 0,
          size: 80,
        },
        {
          id: 'current',
          header: 'Current',
          accessorFn: (row) => row.status?.currentNumberScheduled ?? 0,
          size: 80,
        },
        {
          id: 'ready',
          header: 'Ready',
          accessorFn: (row) => row.status?.numberReady ?? 0,
          size: 80,
        },
        {
          id: 'updated',
          header: 'Updated',
          accessorFn: (row) => row.status?.updatedNumberScheduled ?? 0,
          size: 80,
        },
        {
          id: 'misscheduled',
          header: 'Misscheduled',
          accessorFn: (row) => row.status?.numberMisscheduled ?? 0,
          size: 100,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'available',
          header: 'Available',
          accessorFn: (row) => row.status?.numberAvailable ?? 0,
          size: 100,
        },
        {
          id: 'strategy',
          header: 'Update Strategy',
          accessorFn: (row) => row.spec?.updateStrategy?.type ?? 'RollingUpdate',
          size: 120,
        },
        {
          id: 'maxUnavailable',
          header: 'Max Unavailable',
          accessorFn: (row) =>
            row.spec?.updateStrategy?.rollingUpdate?.maxUnavailable ?? '1',
          size: 120,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'controllerRevision',
          header: 'Controller Revision',
          accessorKey: 'status.observedGeneration',
          size: 120,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'conditions',
          header: 'Conditions',
          accessorFn: (row) => row.status?.conditions,
          cell: ({ getValue }) => (
            <ConditionsCell
              conditions={getValue() as Condition[] | undefined}
              defaultHealthyColor="neutral"
              defaultUnhealthyColor="faded"
            />
          ),
          size: 250,
          meta: {
            defaultHidden: true,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<DaemonSet> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuServerCog />,
    views: createStandardViews({ SidebarComponent: DaemonSetSidebar }),
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <span>Delete <strong>{ctx.data?.metadata?.name}</strong>?</span>,
            body: (
              <span>
                Are you sure you want to delete the DaemonSet <code>{ctx.data?.metadata?.name}</code> from{' '}
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
      {
        title: 'Logs',
        icon: <LuLogs />,
        enabled: true,
        list: (ctx) => {
          const list: Array<DrawerComponentActionListItem> = []
          const containers = ctx.data?.spec?.template?.spec?.containers ?? []
          const filterParams = { filter_labels: 'pod,container' }

          list.push({
            title: 'All Containers',
            action: () => createLogSession({
              connectionID: id,
              resourceKey,
              resourceID: ctx.data?.metadata?.name as string,
              resourceData: ctx.data as Record<string, any>,
              target: '',
              label: `DaemonSet ${ctx.data?.metadata?.name}`,
              icon: 'LuLogs',
              params: filterParams,
            }).then(() => closeDrawer())
          })

          containers.forEach((container) => {
            list.push({
              title: container.name,
              action: () => createLogSession({
                connectionID: id,
                resourceKey,
                resourceID: ctx.data?.metadata?.name as string,
                resourceData: ctx.data as Record<string, any>,
                target: container.name,
                label: `DaemonSet ${ctx.data?.metadata?.name}`,
                icon: 'LuLogs',
                params: filterParams,
              }).then(() => closeDrawer())
            })
          })

          return list
        }
      },
    ],
  }), [])

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="metadata.uid"
      memoizer="metadata.uid,metadata.resourceVersion,status.numberReady"
      drawer={drawer}
    />
  )
}

export default DaemonSetTable

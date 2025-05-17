import React from 'react'
import { useParams } from 'react-router-dom'
import { ColumnDef } from '@tanstack/react-table'

import ConditionsCell from '../../shared/cells/ConditionsCell'
import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuAlignVerticalJustifyStart, LuCode, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { FlowSchema } from 'kubernetes-types/flowcontrol/v1'
import { Condition } from 'kubernetes-types/meta/v1'
import FlowSchemaSidebar from './Sidebar'

const resourceKey = 'flowcontrol.apiserver.k8s.io/v1beta3::FlowSchema'

const FlowSchemaTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<FlowSchema>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'priorityLevel',
          header: 'Priority Level',
          accessorFn: (row) => row.spec?.priorityLevelConfiguration?.name ?? '—',
          size: 200,
        },
        {
          id: 'matchingPrecedence',
          header: 'Precedence',
          accessorFn: (row) => row.spec?.matchingPrecedence,
          size: 120,
        },
        {
          id: 'distinguisherMethod',
          header: 'Flow Distinguisher',
          accessorFn: (row) => row.spec?.distinguisherMethod?.type ?? 'None',
          size: 150,
        },
        {
          id: 'rules',
          header: 'Rules',
          accessorFn: (row) =>
            (row.spec?.rules ?? []).length > 0
              ? `${row.spec?.rules?.length} rule(s)`
              : '—',
          size: 100,
          meta: {
            defaultHidden: true,
          },
        },
        {
          id: 'conditions',
          header: 'Conditions',
          accessorFn: (row) => row.status?.conditions || [],
          cell: ({ getValue }) => (
            <ConditionsCell
              conditions={getValue() as Condition[]}
              defaultHealthyColor="neutral"
              defaultUnhealthyColor="faded"
            />
          ),
          size: 250,
          meta: {
            defaultHidden: false,
          },
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<FlowSchema> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuAlignVerticalJustifyStart />,
    views: [
      {
        title: 'Overview',
        icon: <LuSquareChartGantt />,
        component: (ctx) => <FlowSchemaSidebar data={ctx.data || {}} />,
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
                Are you sure you want to delete the FlowSchema <code>{ctx.data?.metadata?.name}</code>?
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
      memoizer="metadata.uid,metadata.resourceVersion,status.conditions"
      drawer={drawer}
    />
  )
}

export default FlowSchemaTable

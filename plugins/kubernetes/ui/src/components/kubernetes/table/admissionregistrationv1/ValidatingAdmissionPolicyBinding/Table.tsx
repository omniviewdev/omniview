import React from 'react'
import { useParams } from 'react-router-dom'
import { ValidatingAdmissionPolicyBinding } from 'kubernetes-types/admissionregistration/v1'
import { ColumnDef } from '@tanstack/react-table'

import { withClusterResourceColumns } from '../../shared/columns'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { DrawerComponent, useConfirmationModal, useResourceMutations, useRightDrawer } from '@omniviewdev/runtime'
import { LuLink2, LuCode, LuSquareChartGantt, LuTrash } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import ValidatingAdmissionPolicyBindingSidebar from './Sidebar'

const resourceKey = 'admissionregistration::v1::ValidatingAdmissionPolicyBinding'

const ValidatingAdmissionPolicyBindingTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const { remove } = useResourceMutations({ pluginID: 'kubernetes' })
  const { show } = useConfirmationModal()
  const { closeDrawer } = useRightDrawer()

  const columns = React.useMemo<Array<ColumnDef<ValidatingAdmissionPolicyBinding>>>(
    () =>
      withClusterResourceColumns([
        {
          id: 'policyName',
          header: 'Policy',
          accessorFn: (row) => row.spec?.policyName ?? '—',
          size: 200,
        },
        {
          id: 'paramRef',
          header: 'Parameters',
          accessorFn: (row) =>
            row.spec?.paramRef
              ? `${row.spec.paramRef?.name} (${row.spec.paramRef?.parameterNotFoundAction ?? 'Deny'})`
              : '—',
          size: 250,
        },
        {
          id: 'matchResources',
          header: 'Match Resources',
          accessorFn: (row) =>
            row.spec?.matchResources?.resourceRules
              ?.map(r => `${r.apiGroups?.join(',')}/${r.resourceNames?.join(',')}`)
              .join(' | ') || '—',
          size: 300,
        },
        {
          id: 'validationActions',
          header: 'Actions',
          accessorFn: (row) =>
            row.spec?.validationActions?.join(', ') ?? 'Deny',
          size: 120,
        },
      ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent<ValidatingAdmissionPolicyBinding> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuLink2 />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <ValidatingAdmissionPolicyBindingSidebar ctx={ctx} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: [
      {
        title: 'Delete',
        icon: <LuTrash />,
        action: (ctx) =>
          show({
            title: <>Delete <strong>{ctx.data?.metadata?.name}</strong>?</>,
            body: <>Are you sure you want to delete the binding <code>{ctx.data?.metadata?.name}</code>?</>,
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

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="metadata.name"
      memoizer="metadata.name,metadata.resourceVersion"
      drawer={drawer}
    />
  )
}

export default ValidatingAdmissionPolicyBindingTable

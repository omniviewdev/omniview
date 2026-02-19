import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withClusterResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox, LuCode, LuShieldCheck } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { ValidatingWebhookConfiguration } from 'kubernetes-types/admissionregistration/v1'
import ValidatingWebhookConfigurationSidebar from './Sidebar'

const resourceKey = 'admissionregistration::v1::ValidatingWebhookConfiguration'

const LeaseTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<ValidatingWebhookConfiguration>>>(
    () => withClusterResourceColumns([
      {
        id: 'webhooks',
        header: 'Webhooks',
        accessorFn: (row) => row.webhooks?.length ?? 0,
        size: 100,
      },
      {
        id: 'serviceTargets',
        header: 'Services',
        accessorFn: (row) =>
          row.webhooks
            ?.map(w => w.clientConfig.service?.name)
            .filter(Boolean)
            .join(', ') || '—',
        size: 240,
      },
      {
        id: 'failurePolicy',
        header: 'Failure Policy',
        accessorFn: (row) => row.webhooks?.map(w => w.failurePolicy ?? '—').join(', ') ?? '—',
        size: 200,
      },
      {
        id: 'sideEffects',
        header: 'Side Effects',
        accessorFn: (row) => row.webhooks?.map(w => w.sideEffects ?? '—').join(', ') ?? '—',
        size: 200,
      }
    ], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<ValidatingWebhookConfiguration> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuShieldCheck />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (ctx) => <ValidatingWebhookConfigurationSidebar ctx={ctx} />
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />
      },
    ],
    actions: []
  }), [])

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor='metadata.uid'
      memoizer='metadata.uid,metadata.resourceVersion'
      drawer={drawer}
    />
  )
}

export default LeaseTable

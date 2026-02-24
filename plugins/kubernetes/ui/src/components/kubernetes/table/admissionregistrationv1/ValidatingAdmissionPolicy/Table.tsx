import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withClusterResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuShieldBan } from 'react-icons/lu'
import { ValidatingAdmissionPolicy } from 'kubernetes-types/admissionregistration/v1'
import ValidatingAdmissionPolicySidebar from './Sidebar'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'

const resourceKey = 'admissionregistration::v1::ValidatingAdmissionPolicy'

const ValidatingAdmissionPolicyTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<ValidatingAdmissionPolicy>>>(
    () => withClusterResourceColumns([
      {
        id: 'matchConstraints',
        header: 'Match Constraints',
        accessorFn: (row) =>
          row.spec?.matchConstraints?.resourceRules?.map(r =>
            `${r.apiGroups?.join(', ')}/${r.resourceNames?.join(', ')}`
          ).join(' | ') || '—',
        size: 300,
      },
      {
        id: 'validations',
        header: 'Validations',
        accessorFn: (row) => row.spec?.validations?.length ?? 0,
        size: 100,
      },
      {
        id: 'failurePolicy',
        header: 'Failure Policy',
        accessorFn: (row) => row.spec?.failurePolicy ?? '—',
        size: 120,
      }
    ], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<ValidatingAdmissionPolicy> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuShieldBan />,
    views: createStandardViews({ SidebarComponent: ValidatingAdmissionPolicySidebar }),
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

export default ValidatingAdmissionPolicyTable

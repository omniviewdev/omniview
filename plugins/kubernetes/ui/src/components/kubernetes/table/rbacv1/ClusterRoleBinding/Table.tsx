import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { ClusterRoleBinding } from 'kubernetes-types/rbac/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withClusterResourceColumns } from '../../shared/columns'

const resourceKey = 'rbac::v1::ClusterRoleBinding'

const ClusterRoleBindingTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<ClusterRoleBinding>>>(
    () => withClusterResourceColumns<ClusterRoleBinding>([], { connectionID: id, resourceKey }),
    [],
  )

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor='metadata.uid'
      memoizer='metadata.uid,metadata.resourceVersion'
    />
  )
}

export default ClusterRoleBindingTable

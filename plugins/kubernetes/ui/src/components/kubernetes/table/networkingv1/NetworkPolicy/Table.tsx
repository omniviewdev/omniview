import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { NetworkPolicy } from 'kubernetes-types/networking/v1'  // adjust if needed
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'

const resourceKey = 'networking::v1::NetworkPolicy'

const NetworkPolicyTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<NetworkPolicy>>>(
    () => withNamespacedResourceColumns([], { connectionID: id, resourceKey }),
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

export default NetworkPolicyTable

import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { PodDisruptionBudget } from 'kubernetes-types/policy/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'

const resourceKey = 'policy::v1::PodDisruptionBudget'

const PodDisruptionBudgetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<PodDisruptionBudget>>>(
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

export default PodDisruptionBudgetTable

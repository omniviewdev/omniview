import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { PriorityClass } from 'kubernetes-types/scheduling/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withClusterResourceColumns } from '../../shared/columns'

const resourceKey = 'scheduling::v1::PriorityClass'

const PriorityClassTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<PriorityClass>>>(
    () => withClusterResourceColumns([], { connectionID: id, resourceKey }),
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

export default PriorityClassTable

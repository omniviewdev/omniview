import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { HorizontalPodAutoscaler } from 'kubernetes-types/autoscaling/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'

const resourceKey = 'autoscaling::v1::HorizontalPodAutoscaler'

const HorizontalPodAutoscalerTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<HorizontalPodAutoscaler>>>(
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

export default HorizontalPodAutoscalerTable

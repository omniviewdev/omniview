import React from 'react'

import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withNamespacedResourceColumns } from '../shared/columns'

const DefaultTable: React.FC = () => {
  const { id = '', resourceKey = '' } = useParams<{ id: string, resourceKey: string }>()
  const key = resourceKey.replace(/_/g, '::')
  console.log(key)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withNamespacedResourceColumns([], { connectionID: id, resourceKey }),
    [],
  )

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={key}
      idAccessor='metadata.name'
      memoizer={'metadata.uid,metadata.resourceVersion'}
    />
  )
}

export default DefaultTable;

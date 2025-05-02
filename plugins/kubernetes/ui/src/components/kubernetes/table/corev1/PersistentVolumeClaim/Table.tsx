import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { type PersistentVolumeClaim } from 'kubernetes-types/core/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox } from 'react-icons/lu'
import PersistentVolumeClaimSidebar from '../../../sidebar/PersistentVolumeClaimSidebar'

const resourceKey = 'core::v1::PersistentVolumeClaim'

const PersistentVolumeClaimTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<PersistentVolumeClaim>>>(
    () => withNamespacedResourceColumns([], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (data: any) => <PersistentVolumeClaimSidebar data={data} />
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

export default PersistentVolumeClaimTable

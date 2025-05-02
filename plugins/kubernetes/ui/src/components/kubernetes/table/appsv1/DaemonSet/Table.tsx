import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { DaemonSet } from 'kubernetes-types/apps/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox } from 'react-icons/lu'
import DaemonSetSidebar from '../../../sidebar/appsv1/DaemonSet'

const resourceKey = 'apps::v1::DaemonSet'

const DaemonSetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<DaemonSet>>>(
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
        component: (data: any) => <DaemonSetSidebar data={data} />
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

export default DaemonSetTable

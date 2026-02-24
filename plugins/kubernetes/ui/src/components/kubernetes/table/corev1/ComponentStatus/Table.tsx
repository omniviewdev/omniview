import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { ComponentStatus } from 'kubernetes-types/core/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withClusterResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox } from 'react-icons/lu'
import ComponentStatusSidebar from './Sidebar'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'

const resourceKey = 'core::v1::ComponentStatus'

const ComponentStatusTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<ComponentStatus>>>(
    () => withClusterResourceColumns([], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<ComponentStatus> = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: createStandardViews({ SidebarComponent: ComponentStatusSidebar }),
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

export default ComponentStatusTable

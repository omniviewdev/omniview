import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { Endpoints } from 'kubernetes-types/core/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox, LuCode } from 'react-icons/lu'
import EndpointSidebar from '../../../sidebar/Endpoint'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'

const resourceKey = 'core::v1::Endpoints'

const EndpointsTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<Endpoints>>>(
    () => withNamespacedResourceColumns([], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<Endpoints> = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (ctx) => <EndpointSidebar data={ctx.data || {}} />
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />
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

export default EndpointsTable

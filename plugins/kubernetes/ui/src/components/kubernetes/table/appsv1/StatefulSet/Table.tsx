import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { StatefulSet } from 'kubernetes-types/apps/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'
import { LuBox, LuCode } from 'react-icons/lu'
import StatefulSetSidebar from '../../../sidebar/appsv1/StatefulSet'
import { DrawerComponent } from '@omniviewdev/runtime'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'

const resourceKey = 'apps::v1::StatefulSet'

const StatefulSetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<StatefulSet>>>(
    () => withNamespacedResourceColumns([], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<StatefulSet> = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (ctx) => <StatefulSetSidebar data={ctx.data || {}} />
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />
      }
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

export default StatefulSetTable

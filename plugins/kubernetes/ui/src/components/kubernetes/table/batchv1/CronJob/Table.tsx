import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { CronJob } from 'kubernetes-types/batch/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox } from 'react-icons/lu'
import CronJobSidebar from '../../../sidebar/CronJob'

const resourceKey = 'batch::v1::CronJob'

const CronJobTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<CronJob>>>(
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
        component: (data: any) => <CronJobSidebar data={data} />
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

export default CronJobTable

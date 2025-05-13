import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { Job } from 'kubernetes-types/batch/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox, LuCode } from 'react-icons/lu'
import JobSidebar from '../../../sidebar/Job'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import ConditionsCell from '../../shared/cells/ConditionsCell'
import { Condition } from 'kubernetes-types/meta/v1'

const resourceKey = 'batch::v1::Job'

const JobTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<Job>>>(
    () => withNamespacedResourceColumns([
      {
        id: 'conditions',
        header: 'Conditions',
        accessorFn: (row) => row?.status?.conditions,
        cell: ({ getValue }) => <ConditionsCell conditions={getValue() as Condition[] | undefined} defaultHealthyColor={'success'} defaultUnhealthyColor={'faded'} />,
        size: 250,
      },
    ], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<Job> = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (ctx) => <JobSidebar data={ctx.data || {}} />
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

export default JobTable

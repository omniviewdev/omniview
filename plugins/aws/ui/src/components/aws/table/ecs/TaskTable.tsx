import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import { LuCode, LuContainer, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'ecs::v1::Task'

const ECSTaskTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      {
        id: 'taskArn',
        header: 'Task ARN',
        accessorKey: 'TaskArn',
        size: 350,
      },
      {
        id: 'lastStatus',
        header: 'Last Status',
        accessorKey: 'LastStatus',
        cell: ({ getValue }) => <StatusCell value={getValue() as string} />,
        size: 120,
      },
      {
        id: 'launchType',
        header: 'Launch Type',
        accessorKey: 'LaunchType',
        size: 120,
      },
      {
        id: 'cpu',
        header: 'CPU',
        accessorKey: 'Cpu',
        size: 80,
      },
      {
        id: 'memory',
        header: 'Memory',
        accessorKey: 'Memory',
        size: 80,
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuContainer />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='TaskArn' memoizer='TaskArn' drawer={drawer} />
  )
}

export default ECSTaskTable;

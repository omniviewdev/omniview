import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import TaskDefinitionForm from '../../forms/ecs/TaskDefinitionForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuFileCode, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'ecs::v1::TaskDefinition'

const TaskDefinitionTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      {
        id: 'taskDefinitionArn',
        header: 'Task Definition',
        accessorKey: 'TaskDefinitionArn',
        size: 200,
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'Status',
        cell: ({ getValue }) => <StatusCell value={getValue() as string} />,
        size: 100,
      },
      {
        id: 'family',
        header: 'Family',
        accessorKey: 'Family',
        size: 150,
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
      {
        id: 'networkMode',
        header: 'Network Mode',
        accessorKey: 'NetworkMode',
        size: 120,
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const TaskDefinitionEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <TaskDefinitionForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuFileCode />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: TaskDefinitionEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [TaskDefinitionEditView])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='TaskDefinitionArn' memoizer='TaskDefinitionArn' drawer={drawer} />
  )
}

export default TaskDefinitionTable;

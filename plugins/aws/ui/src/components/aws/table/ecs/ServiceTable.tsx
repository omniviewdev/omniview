import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import ServiceScalingForm from '../../forms/ecs/ServiceScalingForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuContainer, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'ecs::v1::Service'

const ECSServiceTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      {
        id: 'serviceName',
        header: 'Service Name',
        accessorKey: 'ServiceName',
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'Status',
        cell: ({ getValue }) => <StatusCell value={getValue() as string} />,
        size: 100,
      },
      {
        id: 'desiredCount',
        header: 'Desired',
        accessorKey: 'DesiredCount',
        size: 100,
      },
      {
        id: 'runningCount',
        header: 'Running',
        accessorKey: 'RunningCount',
        size: 100,
      },
      {
        id: 'launchType',
        header: 'Launch Type',
        accessorKey: 'LaunchType',
        size: 120,
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const ServiceEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <ServiceScalingForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuContainer />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: ServiceEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [ServiceEditView])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='ServiceName' memoizer='ServiceName' drawer={drawer} />
  )
}

export default ECSServiceTable;

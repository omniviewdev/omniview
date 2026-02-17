import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import ClusterSettingsForm from '../../forms/ecs/ClusterSettingsForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuContainer, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent, usePluginRouter } from '@omniviewdev/runtime';

const resourceKey = 'ecs::v1::Cluster'

const ECSClusterTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()
  const { navigate } = usePluginRouter()

  const handleRowClick = React.useCallback((resourceId: string) => {
    navigate(`/account/${id}/resources/ecs_v1_Cluster/${encodeURIComponent(resourceId)}`)
  }, [navigate, id])

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      {
        id: 'clusterName',
        header: 'Cluster Name',
        accessorKey: 'ClusterName',
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'Status',
        cell: ({ getValue }) => <StatusCell value={getValue() as string} />,
        size: 100,
      },
      {
        id: 'activeServicesCount',
        header: 'Active Services',
        accessorKey: 'ActiveServicesCount',
        size: 120,
      },
      {
        id: 'runningTasksCount',
        header: 'Running Tasks',
        accessorKey: 'RunningTasksCount',
        size: 120,
      },
      {
        id: 'registeredContainerInstancesCount',
        header: 'Container Instances',
        accessorKey: 'RegisteredContainerInstancesCount',
        size: 150,
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const ClusterEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <ClusterSettingsForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuContainer />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: ClusterEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [ClusterEditView])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='ClusterName' memoizer='ClusterName' drawer={drawer} onRowClick={handleRowClick} />
  )
}

export default ECSClusterTable;

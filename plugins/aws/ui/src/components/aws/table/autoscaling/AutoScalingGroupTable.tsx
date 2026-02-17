import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import ASGCapacityForm from '../../forms/autoscaling/ASGCapacityForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuGauge, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'autoscaling::v1::AutoScalingGroup'

const AutoScalingGroupTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      {
        id: 'desiredCapacity',
        header: 'Desired',
        accessorKey: 'DesiredCapacity',
        size: 80,
      },
      {
        id: 'minSize',
        header: 'Min',
        accessorKey: 'MinSize',
        size: 80,
      },
      {
        id: 'maxSize',
        header: 'Max',
        accessorKey: 'MaxSize',
        size: 80,
      },
      {
        id: 'healthCheckType',
        header: 'Health Check',
        accessorKey: 'HealthCheckType',
        size: 120,
      },
      {
        id: 'instanceCount',
        header: 'Instances',
        accessorFn: (row: any) => row.Instances?.length ?? 0,
        size: 100,
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const ASGEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <ASGCapacityForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuGauge />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: ASGEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [ASGEditView])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='AutoScalingGroupName' memoizer='AutoScalingGroupName' drawer={drawer} />
  )
}

export default AutoScalingGroupTable;

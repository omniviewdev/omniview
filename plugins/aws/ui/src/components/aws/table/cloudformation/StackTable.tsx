import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import StackParametersForm from '../../forms/cloudformation/StackParametersForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuLayers, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'cloudformation::v1::Stack'

const CloudFormationStackTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      {
        id: 'stackName',
        header: 'Stack Name',
        accessorKey: 'StackName',
        size: 300,
      },
      {
        id: 'stackStatus',
        header: 'Status',
        accessorKey: 'StackStatus',
        cell: ({ getValue }) => <StatusCell value={getValue() as string} />,
        size: 100,
      },
      {
        id: 'description',
        header: 'Description',
        accessorKey: 'Description',
        size: 300,
      },
      {
        id: 'creationTime',
        header: 'Created',
        accessorKey: 'CreationTime',
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const StackEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <StackParametersForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuLayers />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: StackEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [StackEditView])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='StackName' memoizer='StackName' drawer={drawer} />
  )
}

export default CloudFormationStackTable;

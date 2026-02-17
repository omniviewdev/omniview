import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withGlobalResourceColumns } from '../shared/columns'
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import RecordSetForm from '../../forms/route53/RecordSetForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuList, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'route53::v1::RecordSet'

const RecordSetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withGlobalResourceColumns([
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'Name',
        size: 250,
      },
      {
        id: 'type',
        header: 'Type',
        accessorKey: 'Type',
        size: 80,
      },
      {
        id: 'ttl',
        header: 'TTL',
        accessorKey: 'TTL',
        size: 80,
      },
      {
        id: 'records',
        header: 'Records',
        accessorFn: (row: any) => row.ResourceRecords?.length ?? 0,
        size: 100,
      },
      {
        id: 'alias',
        header: 'Alias',
        accessorFn: (row: any) => row.AliasTarget ? 'Yes' : 'No',
        size: 80,
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const RecordSetEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <RecordSetForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuList />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: RecordSetEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [RecordSetEditView])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='Name' memoizer='Name' drawer={drawer} />
  )
}

export default RecordSetTable;

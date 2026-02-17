import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import FunctionSidebar from '../../sidebar/lambda/FunctionSidebar';
import FunctionConfigForm from '../../forms/lambda/FunctionConfigForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuPencil, LuZap, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'lambda::v1::Function'

const LambdaFunctionTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      { id: 'runtime', header: 'Runtime', accessorKey: 'Runtime', size: 120 },
      { id: 'memory', header: 'Memory (MB)', accessorKey: 'MemorySize', size: 100 },
      { id: 'timeout', header: 'Timeout (s)', accessorKey: 'Timeout', size: 100 },
      { id: 'handler', header: 'Handler', accessorKey: 'Handler', size: 200, meta: { defaultHidden: true } },
      { id: 'codeSize', header: 'Code Size', accessorFn: (row: any) => {
        const bytes = row.CodeSize || 0;
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
      }, size: 100 },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const FunctionEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <FunctionConfigForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuZap />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <FunctionSidebar ctx={ctx} /> },
      { title: 'Edit', icon: <LuPencil />, component: FunctionEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [FunctionEditView])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='FunctionName' memoizer='FunctionName' drawer={drawer} />
}

export default LambdaFunctionTable;

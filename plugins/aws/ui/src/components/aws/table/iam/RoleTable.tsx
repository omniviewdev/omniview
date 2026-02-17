import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withGlobalResourceColumns } from '../shared/columns'
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import RolePolicyForm from '../../forms/iam/RolePolicyForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuPencil, LuShield, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'iam::v1::Role'

const IAMRoleTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withGlobalResourceColumns([
      { id: 'path', header: 'Path', accessorKey: 'Path', size: 150 },
      { id: 'createDate', header: 'Created', accessorKey: 'CreateDate', size: 200 },
      { id: 'maxSession', header: 'Max Session (s)', accessorKey: 'MaxSessionDuration', size: 130 },
      { id: 'description', header: 'Description', accessorKey: 'Description', size: 250, meta: { defaultHidden: true } },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const RoleEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <RolePolicyForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuShield />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: RoleEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [RoleEditView])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='RoleName' memoizer='RoleName' drawer={drawer} />
}

export default IAMRoleTable;

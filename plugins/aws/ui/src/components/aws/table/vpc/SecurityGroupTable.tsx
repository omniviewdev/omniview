import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import SecurityGroupSidebar from '../../sidebar/vpc/SecurityGroupSidebar';
import SecurityGroupEditForm from '../../forms/vpc/SecurityGroupEditForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuPencil, LuShield, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'vpc::v1::SecurityGroup'

const SecurityGroupTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      { id: 'groupId', header: 'Group ID', accessorKey: 'GroupId', size: 180 },
      { id: 'groupName', header: 'Group Name', accessorKey: 'GroupName', size: 180 },
      { id: 'vpcId', header: 'VPC', accessorKey: 'VpcId', size: 180 },
      { id: 'inbound', header: 'Inbound Rules', accessorFn: (row: any) => row.IpPermissions?.length ?? 0, size: 120 },
      { id: 'outbound', header: 'Outbound Rules', accessorFn: (row: any) => row.IpPermissionsEgress?.length ?? 0, size: 120 },
      { id: 'description', header: 'Description', accessorKey: 'Description', size: 200, meta: { defaultHidden: true } },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const SGEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <SecurityGroupEditForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuShield />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <SecurityGroupSidebar ctx={ctx} /> },
      { title: 'Edit', icon: <LuPencil />, component: SGEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [SGEditView])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='GroupId' memoizer='GroupId' drawer={drawer} />
}

export default SecurityGroupTable;

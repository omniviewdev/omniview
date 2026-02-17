import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import InstanceSidebar from '../../sidebar/ec2/InstanceSidebar';
import InstanceConfigForm from '../../forms/ec2/InstanceConfigForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuPencil, LuServer, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'ec2::v1::Instance'

const EC2InstanceTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      {
        id: 'instanceId',
        header: 'Instance ID',
        accessorKey: 'InstanceId',
        size: 180,
      },
      {
        id: 'state',
        header: 'State',
        accessorFn: (row: any) => row.State?.Name,
        cell: ({ getValue }) => <StatusCell value={getValue() as string} />,
        size: 100,
      },
      {
        id: 'instanceType',
        header: 'Type',
        accessorKey: 'InstanceType',
        size: 110,
      },
      {
        id: 'publicIp',
        header: 'Public IP',
        accessorKey: 'PublicIpAddress',
        size: 130,
      },
      {
        id: 'privateIp',
        header: 'Private IP',
        accessorKey: 'PrivateIpAddress',
        size: 130,
      },
      {
        id: 'vpcId',
        header: 'VPC',
        accessorKey: 'VpcId',
        size: 180,
        meta: { defaultHidden: true },
      },
      {
        id: 'az',
        header: 'AZ',
        accessorFn: (row: any) => row.Placement?.AvailabilityZone,
        size: 130,
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const InstanceEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <InstanceConfigForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuServer />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <InstanceSidebar ctx={ctx} /> },
      { title: 'Edit', icon: <LuPencil />, component: InstanceEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [InstanceEditView])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='InstanceId' memoizer='InstanceId' drawer={drawer} />
  )
}

export default EC2InstanceTable;

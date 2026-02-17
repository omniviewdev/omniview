import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import { LuCode, LuNetwork, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'vpc::v1::Subnet'

const SubnetTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      { id: 'subnetId', header: 'Subnet ID', accessorKey: 'SubnetId', size: 200 },
      { id: 'cidr', header: 'CIDR Block', accessorKey: 'CidrBlock', size: 140 },
      { id: 'az', header: 'AZ', accessorKey: 'AvailabilityZone', size: 130 },
      { id: 'availableIps', header: 'Available IPs', accessorKey: 'AvailableIpAddressCount', size: 110 },
      { id: 'vpcId', header: 'VPC', accessorKey: 'VpcId', size: 180 },
      { id: 'mapPublicIp', header: 'Auto-assign Public IP', accessorFn: (row: any) => row.MapPublicIpOnLaunch ? 'Yes' : 'No', size: 160, meta: { defaultHidden: true } },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuNetwork />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='SubnetId' memoizer='SubnetId' drawer={drawer} />
}

export default SubnetTable;

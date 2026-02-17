import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import LoadBalancerSidebar from '../../sidebar/elbv2/LoadBalancerSidebar';
import { LuCode, LuScale, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent, usePluginRouter } from '@omniviewdev/runtime';

const resourceKey = 'elbv2::v1::LoadBalancer'

const LoadBalancerTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()
  const { navigate } = usePluginRouter()

  const handleRowClick = React.useCallback((resourceId: string) => {
    navigate(`/account/${id}/resources/elbv2_v1_LoadBalancer/${encodeURIComponent(resourceId)}`)
  }, [navigate, id])

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      { id: 'type', header: 'Type', accessorKey: 'Type', size: 100 },
      { id: 'scheme', header: 'Scheme', accessorKey: 'Scheme', size: 120 },
      { id: 'state', header: 'State', accessorFn: (row: any) => row.State?.Code, cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
      { id: 'dnsName', header: 'DNS Name', accessorKey: 'DNSName', size: 300 },
      { id: 'vpcId', header: 'VPC', accessorKey: 'VpcId', size: 180, meta: { defaultHidden: true } },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuScale />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <LoadBalancerSidebar ctx={ctx} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='LoadBalancerArn' memoizer='LoadBalancerArn' drawer={drawer} onRowClick={handleRowClick} />
}

export default LoadBalancerTable;

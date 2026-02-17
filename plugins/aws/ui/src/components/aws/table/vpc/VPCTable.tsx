import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import VPCSidebar from '../../sidebar/vpc/VPCSidebar';
import { LuCode, LuNetwork, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent, usePluginRouter } from '@omniviewdev/runtime';

const resourceKey = 'vpc::v1::VPC'

const VPCTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()
  const { navigate } = usePluginRouter()

  const handleRowClick = React.useCallback((resourceId: string) => {
    navigate(`/account/${id}/resources/vpc_v1_VPC/${encodeURIComponent(resourceId)}`)
  }, [navigate, id])

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      { id: 'vpcId', header: 'VPC ID', accessorKey: 'VpcId', size: 180 },
      { id: 'cidr', header: 'CIDR Block', accessorKey: 'CidrBlock', size: 140 },
      { id: 'state', header: 'State', accessorKey: 'State', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
      { id: 'isDefault', header: 'Default', accessorFn: (row: any) => row.IsDefault ? 'Yes' : 'No', size: 80 },
      { id: 'tenancy', header: 'Tenancy', accessorFn: (row: any) => row.InstanceTenancy, size: 100, meta: { defaultHidden: true } },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuNetwork />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <VPCSidebar ctx={ctx} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='VpcId' memoizer='VpcId' drawer={drawer} onRowClick={handleRowClick} />
}

export default VPCTable;

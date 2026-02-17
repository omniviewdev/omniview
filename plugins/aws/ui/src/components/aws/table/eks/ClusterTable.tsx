import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import ClusterSidebar from '../../sidebar/eks/ClusterSidebar';
import { LuCode, LuContainer, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent, usePluginRouter } from '@omniviewdev/runtime';

const resourceKey = 'eks::v1::Cluster'

const EKSClusterTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()
  const { navigate } = usePluginRouter()

  const handleRowClick = React.useCallback((resourceId: string) => {
    navigate(`/account/${id}/resources/eks_v1_Cluster/${encodeURIComponent(resourceId)}`)
  }, [navigate, id])

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      { id: 'status', header: 'Status', accessorKey: 'Status', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
      { id: 'version', header: 'Version', accessorKey: 'Version', size: 90 },
      { id: 'platformVersion', header: 'Platform', accessorKey: 'PlatformVersion', size: 120 },
      { id: 'endpoint', header: 'Endpoint', accessorKey: 'Endpoint', size: 300, meta: { defaultHidden: true } },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuContainer />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <ClusterSidebar ctx={ctx} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='Name' memoizer='Name' drawer={drawer} onRowClick={handleRowClick} />
}

export default EKSClusterTable;

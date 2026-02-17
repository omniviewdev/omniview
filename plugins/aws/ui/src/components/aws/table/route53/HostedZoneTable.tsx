import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withGlobalResourceColumns } from '../shared/columns'
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import { LuCode, LuGlobe, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent, usePluginRouter } from '@omniviewdev/runtime';

const resourceKey = 'route53::v1::HostedZone'

const HostedZoneTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()
  const { navigate } = usePluginRouter()

  const handleRowClick = React.useCallback((resourceId: string) => {
    navigate(`/account/${id}/resources/route53_v1_HostedZone/${encodeURIComponent(resourceId)}`)
  }, [navigate, id])

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withGlobalResourceColumns([
      { id: 'type', header: 'Type', accessorFn: (row: any) => row.Config?.PrivateZone ? 'Private' : 'Public', size: 80 },
      { id: 'recordCount', header: 'Records', accessorKey: 'ResourceRecordSetCount', size: 80 },
      { id: 'comment', header: 'Comment', accessorFn: (row: any) => row.Config?.Comment || '', size: 250 },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuGlobe />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='_CleanId' memoizer='_CleanId' drawer={drawer} onRowClick={handleRowClick} />
}

export default HostedZoneTable;

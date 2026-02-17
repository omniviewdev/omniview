import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withGlobalResourceColumns } from '../shared/columns'
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import { LuCode, LuUser, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'iam::v1::User'

const IAMUserTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withGlobalResourceColumns([
      { id: 'path', header: 'Path', accessorKey: 'Path', size: 150 },
      { id: 'createDate', header: 'Created', accessorKey: 'CreateDate', size: 200 },
      { id: 'passwordLastUsed', header: 'Password Last Used', accessorKey: 'PasswordLastUsed', size: 200, meta: { defaultHidden: true } },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuUser />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='UserName' memoizer='UserName' drawer={drawer} />
}

export default IAMUserTable;

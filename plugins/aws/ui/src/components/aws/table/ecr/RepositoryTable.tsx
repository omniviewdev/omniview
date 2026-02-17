import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import { LuCode, LuPackage, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'ecr::v1::Repository'

const ECRRepositoryTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      {
        id: 'repositoryName',
        header: 'Repository Name',
        accessorKey: 'RepositoryName',
        size: 300,
      },
      {
        id: 'repositoryUri',
        header: 'URI',
        accessorKey: 'RepositoryUri',
        size: 400,
      },
      {
        id: 'imageTagMutability',
        header: 'Tag Mutability',
        accessorKey: 'ImageTagMutability',
        size: 130,
      },
      {
        id: 'scanOnPush',
        header: 'Scan on Push',
        accessorFn: (row: any) => row.ImageScanningConfiguration?.ScanOnPush ? 'Yes' : 'No',
        size: 120,
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuPackage />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='RepositoryName' memoizer='RepositoryName' drawer={drawer} />
  )
}

export default ECRRepositoryTable;

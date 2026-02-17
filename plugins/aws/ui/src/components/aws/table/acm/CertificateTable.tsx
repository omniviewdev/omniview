import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import { LuCode, LuShieldCheck, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'acm::v1::Certificate'

const ACMCertificateTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      {
        id: 'domainName',
        header: 'Domain',
        accessorKey: 'DomainName',
        size: 300,
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'Status',
        cell: ({ getValue }) => <StatusCell value={getValue() as string} />,
        size: 100,
      },
      {
        id: 'type',
        header: 'Type',
        accessorKey: 'Type',
        size: 120,
      },
      {
        id: 'certificateArn',
        header: 'Certificate ARN',
        accessorKey: 'CertificateArn',
        size: 350,
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuShieldCheck />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='CertificateArn' memoizer='CertificateArn' drawer={drawer} />
  )
}

export default ACMCertificateTable;

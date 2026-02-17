import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import LaunchTemplateForm from '../../forms/ec2/LaunchTemplateForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuFileText, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'ec2::v1::LaunchTemplate'

const LaunchTemplateTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      {
        id: 'launchTemplateName',
        header: 'Name',
        accessorKey: 'LaunchTemplateName',
        size: 250,
      },
      {
        id: 'launchTemplateId',
        header: 'Launch Template ID',
        accessorKey: 'LaunchTemplateId',
        size: 200,
      },
      {
        id: 'latestVersion',
        header: 'Latest Version',
        accessorKey: 'LatestVersionNumber',
        size: 130,
      },
      {
        id: 'defaultVersion',
        header: 'Default Version',
        accessorKey: 'DefaultVersionNumber',
        size: 130,
      },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const LaunchTemplateEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <LaunchTemplateForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuFileText />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: LaunchTemplateEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [LaunchTemplateEditView])

  return (
    <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='LaunchTemplateId' memoizer='LaunchTemplateId' drawer={drawer} />
  )
}

export default LaunchTemplateTable;

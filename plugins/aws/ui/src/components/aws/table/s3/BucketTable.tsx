import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withGlobalResourceColumns } from '../shared/columns'
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import BucketSidebar from '../../sidebar/s3/BucketSidebar';
import BucketPropertiesForm from '../../forms/s3/BucketPropertiesForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuArchive, LuCode, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 's3::v1::Bucket'

const S3BucketTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withGlobalResourceColumns([
      { id: 'bucketName', header: 'Bucket Name', accessorKey: 'Name', size: 300 },
      { id: 'creationDate', header: 'Created', accessorKey: 'CreationDate', size: 200 },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const BucketEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <BucketPropertiesForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuArchive />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BucketSidebar ctx={ctx} /> },
      { title: 'Edit', icon: <LuPencil />, component: BucketEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [BucketEditView])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='Name' memoizer='Name' drawer={drawer} />
}

export default S3BucketTable;

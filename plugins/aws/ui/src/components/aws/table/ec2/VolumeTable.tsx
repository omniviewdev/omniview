import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseOverviewPage from '../../../shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import VolumeConfigForm from '../../forms/ec2/VolumeConfigForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuHardDrive, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'ec2::v1::Volume'

const EC2VolumeTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      { id: 'volumeId', header: 'Volume ID', accessorKey: 'VolumeId', size: 180 },
      { id: 'state', header: 'State', accessorKey: 'State', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
      { id: 'size', header: 'Size (GiB)', accessorKey: 'Size', size: 90 },
      { id: 'volumeType', header: 'Type', accessorKey: 'VolumeType', size: 90 },
      { id: 'iops', header: 'IOPS', accessorKey: 'Iops', size: 80 },
      { id: 'az', header: 'AZ', accessorKey: 'AvailabilityZone', size: 130 },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const VolumeEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <VolumeConfigForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuHardDrive />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: VolumeEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [VolumeEditView])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='VolumeId' memoizer='VolumeId' drawer={drawer} />
}

export default EC2VolumeTable;

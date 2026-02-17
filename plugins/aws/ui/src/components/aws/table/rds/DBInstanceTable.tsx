import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import StatusCell from '../shared/cells/StatusCell';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import DBInstanceSidebar from '../../sidebar/rds/DBInstanceSidebar';
import DBInstanceConfigForm from '../../forms/rds/DBInstanceConfigForm';
import useResourceForm from '../../../shared/forms/useResourceForm';
import { LuCode, LuDatabase, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const resourceKey = 'rds::v1::DBInstance'

const RDSDBInstanceTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([
      { id: 'status', header: 'Status', accessorKey: 'DBInstanceStatus', cell: ({ getValue }) => <StatusCell value={getValue() as string} />, size: 100 },
      { id: 'engine', header: 'Engine', accessorKey: 'Engine', size: 100 },
      { id: 'engineVersion', header: 'Version', accessorKey: 'EngineVersion', size: 90 },
      { id: 'class', header: 'Class', accessorKey: 'DBInstanceClass', size: 130 },
      { id: 'multiAZ', header: 'Multi-AZ', accessorFn: (row: any) => row.MultiAZ ? 'Yes' : 'No', size: 80 },
      { id: 'storage', header: 'Storage (GiB)', accessorKey: 'AllocatedStorage', size: 110 },
    ], { connectionID: id, resourceKey }),
    [id],
  )

  const DBEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <DBInstanceConfigForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, icon: <LuDatabase />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <DBInstanceSidebar ctx={ctx} /> },
      { title: 'Edit', icon: <LuPencil />, component: DBEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: []
  }), [DBEditView])

  return <ResourceTable columns={columns} connectionID={id} resourceKey={resourceKey} idAccessor='DBInstanceIdentifier' memoizer='DBInstanceIdentifier' drawer={drawer} />
}

export default RDSDBInstanceTable;

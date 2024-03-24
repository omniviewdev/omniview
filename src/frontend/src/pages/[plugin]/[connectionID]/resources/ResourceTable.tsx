import { type FC } from 'react';

// Helpers
import { type ColumnDef } from '@tanstack/react-table';
import {
  SelectBoxHeader, SelectBoxRow, TextRow, RowMenu, Age,
} from '@/components/tables/ResourceTable/components';
import PluginResourceTable from '@/components/tables/PluginResourceTable';

type Props = {
  /**
   * The plugin ID
   */
  pluginID: string;
  /**
   * The connection ID
   */
  connectionID: string;
  /**
   * The resource key that uniquely identifies the resource
   */
  resourceKey: string;
};

/**
 * Display a table of the deployments
 */
const ResourceTable: FC<Props> = ({ pluginID, connectionID, resourceKey }) => {
  if (!pluginID || !connectionID || !resourceKey) {
    return null;
  }

  console.log('ResourceTable', pluginID, connectionID, resourceKey);
  const columns: Array<ColumnDef<any>> = [
    {
      id: 'select',
      header: SelectBoxHeader,
      cell: SelectBoxRow,
      size: 40,
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: 'name',
      header: 'Name',
      accessorKey: 'metadata.name',
      cell: ({ row }) => (<TextRow row={row} column='name' />),
    },
    {
      id: 'namespace',
      header: 'Namespace',
      size: 150,
      accessorKey: 'metadata.namespace',
      cell: ({ row }) => (<TextRow row={row} column='namespace' />),
    },
    {
      id: 'age',
      header: 'Age',
      size: 80,
      accessorKey: 'metadata.creationTimestamp',
      cell: ({ row }) => (<Age startTime={row.getValue('age')} />),
    },
    {
      id: 'menu',
      header: '',
      cell: RowMenu,
      size: 50,
      enableSorting: false,
      enableHiding: false,
    },
  ];

  return (
    <PluginResourceTable
      columns={columns}
      pluginID={pluginID}
      connectionID={connectionID}
      resourceKey={resourceKey}
    />
  );
};

export default ResourceTable;

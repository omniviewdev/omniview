import { ColumnDef } from '@tanstack/react-table'
import ActionsCell from '../cells/ActionsCell'
import { ColumnArgs } from './types';

export const actionsColumn = <T,>({ connectionID, resourceKey }: ColumnArgs): ColumnDef<T> => ({
  id: 'menu',
  cell: ({ row }) => <ActionsCell
    connectionID={connectionID}
    resourceKey={resourceKey}
    resourceID={row.id}
    data={row.original}
  />,
  size: 50,
  enableSorting: false,
  enableHiding: false,
})

export default actionsColumn

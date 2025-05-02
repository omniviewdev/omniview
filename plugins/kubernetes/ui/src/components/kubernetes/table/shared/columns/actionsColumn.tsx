import { ColumnDef } from '@tanstack/react-table'
import ActionsCell from '../cells/ActionsCell'
import { type ObjectMeta } from 'kubernetes-types/meta/v1';
import { ColumnArgs } from './types';

export const actionsColumn = <T extends { metadata?: ObjectMeta }>({ connectionID, resourceKey }: ColumnArgs): ColumnDef<T> => ({
  id: 'menu',
  cell: ({ row }) => <ActionsCell
    connectionID={connectionID}
    resourceKey={resourceKey}
    resourceID={row.id}
    data={row.original}
    namespace={row.original.metadata?.namespace ?? ''}
  />,
  size: 50,
  enableSorting: false,
  enableHiding: false,
})

export default actionsColumn

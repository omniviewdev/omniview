import { ColumnDef } from '@tanstack/react-table'
import { namespaceFilter } from '../filters'

export const namespaceColumn = <T extends { metadata?: { namespace?: string } }>(): ColumnDef<T> => ({
  id: 'namespace',
  header: 'Namespace',
  accessorKey: 'metadata.namespace',
  enableSorting: true,
  enableHiding: true,
  filterFn: namespaceFilter,
  size: 150,
})

export default namespaceColumn

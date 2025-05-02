import { ColumnDef } from '@tanstack/react-table'

export const nameColumn = <T extends { metadata?: { name?: string } }>(): ColumnDef<T> => ({
  id: 'name',
  header: 'Name',
  accessorKey: 'metadata.name',
  enableSorting: true,
  enableHiding: false,
  size: 300,
  meta: {
    flex: 1
  }
})

export default nameColumn

import { ColumnDef } from '@tanstack/react-table'

export const regionColumn = <T,>(): ColumnDef<T> => ({
  id: 'region',
  header: 'Region',
  accessorFn: (row: any) => row.Region || row._Region || '',
  enableSorting: true,
  enableHiding: true,
  size: 130,
})

export default regionColumn

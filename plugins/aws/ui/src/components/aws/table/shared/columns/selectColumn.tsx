import { ColumnDef } from '@tanstack/react-table'
import SelectHeader from '../headers/SelectHeader'
import SelectCell from '../cells/SelectCell'

export const selectColumn = <T,>(): ColumnDef<T> => ({
  id: 'select',
  header: SelectHeader,
  cell: SelectCell,
  size: 34,
  enableSorting: false,
  enableHiding: false,
})

export default selectColumn

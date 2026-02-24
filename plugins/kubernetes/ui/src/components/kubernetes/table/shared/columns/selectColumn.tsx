import { ColumnDef } from '@tanstack/react-table'
import SelectHeader from '../headers/SelectHeader'
import SelectCell from '../cells/SelectCell'

export const selectColumn = <T extends { metadata?: { name?: string } }>(): ColumnDef<T> => ({
  id: 'select',
  header: SelectHeader,
  cell: SelectCell,
  size: 34,
  enableResizing: false,
  enableSorting: false,
  enableHiding: false,
})

export default selectColumn

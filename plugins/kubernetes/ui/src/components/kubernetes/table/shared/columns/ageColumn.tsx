import { ColumnDef } from '@tanstack/react-table'
import AgeCell from '../cells/AgeCell'

export const ageColumn = <T extends { metadata?: { creationTimestamp?: string } }>(): ColumnDef<T> => ({
  id: 'age',
  header: 'Age',
  accessorKey: 'metadata.creationTimestamp',
  cell: ({ getValue }) => <AgeCell value={getValue() as string} />,
  size: 100,
})

export default ageColumn

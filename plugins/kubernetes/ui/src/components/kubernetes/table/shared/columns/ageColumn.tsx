import { ColumnDef } from '@tanstack/react-table'
import AgeCell from '../cells/AgeCell'

export const ageColumn = <T extends { metadata?: { creationTimestamp?: string } }>(): ColumnDef<T> => ({
  id: 'age',
  header: 'Age',
  accessorKey: 'metadata.creationTimestamp',
  cell: ({ getValue }) => <AgeCell value={getValue() as string} />,
  size: 100,
  minSize: 60,
  maxSize: 200,
})

export default ageColumn

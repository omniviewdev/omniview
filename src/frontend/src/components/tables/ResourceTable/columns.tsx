import {
  SelectBoxHeader, SelectBoxRow, TextRow, Age,
} from './components';
import { type ColumnDef } from '@tanstack/react-table';
import { type KubernetesResource } from '@/types/kubernetes';

/**
* Renders a column with a selection checkbox for the row.
*/
export const SelectBoxColumn = <T extends KubernetesResource>(): ColumnDef<T> => ({
  id: 'select',
  header: SelectBoxHeader,
  cell: SelectBoxRow,
  size: 40,
  enableSorting: false,
  enableHiding: false,
});

export const NameColumn = <T extends KubernetesResource>(): ColumnDef<T> => ({
  id: 'name',
  header: 'Name',
  accessorKey: 'metadata.name',
  cell: ({ row }) => (<TextRow row={row} column='name' />),
});

export const NamespaceColumn = <T extends KubernetesResource>(): ColumnDef<T> => ({
  id: 'namespace',
  header: 'Namespace',
  size: 140,
  accessorKey: 'metadata.namespace',
  cell: ({ row }) => (<TextRow row={row} column='namespace' />),
});

export const AgeColumn = <T extends KubernetesResource>(): ColumnDef<T> => ({
  id: 'age',
  header: 'Age',
  size: 80,
  accessorKey: 'metadata.creationTimestamp',
  cell: ({ row }) => (<Age startTime={row.getValue('age')} />),
});

export const LabelTextColumn = <T extends KubernetesResource>(label: string, header: string, width = 150): ColumnDef<T> => ({
  id: label,
  header,
  size: width,
  accessorFn: resource => resource.metadata?.labels?.[label],
  cell: ({ row }) => (<TextRow row={row} column={label} />),
});


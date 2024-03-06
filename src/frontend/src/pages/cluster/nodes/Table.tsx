import { FC } from 'react';

// types
import { Node } from 'kubernetes-types/core/v1';

// helpers
import { ColumnDef } from '@tanstack/react-table';
import ResourceTable from '@/components/tables/ResourceTable/virtualized';
import { TextRow } from '@/components/tables/ResourceTable/components';
import { NameColumn, SelectBoxColumn } from '@/components/tables/ResourceTable/columns';
import { useNodes } from '@/hooks/useKubernetes';

type Props = {}

/**
 * Display a table of the nodes
 */
const NodesTable: FC<Props> = () => {
  const loader = useNodes;
  const columns: ColumnDef<Node>[] = [
    SelectBoxColumn(),
    NameColumn(),
    {
      id: 'hostname',
      header: 'Hostname',
      accessorFn: (node) => node.metadata?.labels?.['kubernetes.io/hostname'],
      cell: ({ row }) => (<TextRow row={row} column="hostname" />),
    },
    {
      id: 'architecture',
      header: 'Architecture',
      accessorFn: (node) => node.metadata?.labels?.['kubernetes.io/arch'],
      cell: ({ row }) => (<TextRow row={row} column="architecture" />),
    },
    {
      id: 'os',
      header: 'OS',
      accessorFn: (node) => node.metadata?.labels?.['kubernetes.io/os'],
      cell: ({ row }) => (<TextRow row={row} column="os" />),
    },
  ]

  return (
    <ResourceTable loader={loader} columns={columns} kind="node" />
  )
}

export default NodesTable;

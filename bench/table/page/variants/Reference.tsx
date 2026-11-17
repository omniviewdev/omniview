// R, the reference: the table the product ships today, mounted the way the host mounts it (ui/components/tables/Resources/
// ResourceTableContainer.tsx): the library's `DataTable` of @omniviewdev/base-ui 0.17.3 with its virtual body, fixed 30 px rows, the adaptive
// sorted row model through `meta.dataTableImmutableRows`, cells that opt in to data-only updates (`meta.dataTableCellDependencies`), the
// selection column pinned to the start, sorting by Name. Same rows and plain text cells as the candidates; rows are one line (30 px) because
// that is what ships, so the identity's namespace is a column of its own.
import '@omniviewdev/base-ui/styles.css';
import { Checkbox, DataTable, useDataTable, type DataTableColumnDef, type DataTableFeatureFlags } from '@omniviewdev/base-ui';
import { compactAge } from '@omniviewdev/kit';
import { useState } from 'react';
import type { Probe, Row } from '../harness';
import type { VariantProps } from '../variant';

const NOW = Date.now();
const FEATURES: DataTableFeatureFlags = { sorting: true, filtering: true, globalFilter: true, rowSelection: 'multi' };
const TABLE_META = { dataTableImmutableRows: true } as const;
const CELL_META = { dataTableCellDependencies: 'data' } as const;
const COLUMN_PINNING = { start: ['select'], end: [] as string[] };
const ROW_HEIGHT = 30;
const getRowId = (row: Row) => row.key;
const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

// The columns keep their identity: a table input must (register T-32).
const columns: Array<DataTableColumnDef<Row>> = [
  // The host's select cell is the library's Checkbox (the page the matrix measured had a native one here, which the UI policy audit refuses).
  { id: 'select', header: '', size: 44, enableSorting: false, meta: CELL_META, cell: () => <Checkbox aria-label="Select row" /> },
  { id: 'name', header: 'Name', size: 340, accessorFn: (row) => row.name, meta: CELL_META, cell: (info) => text(info.getValue()) },
  { id: 'namespace', header: 'Namespace', size: 180, accessorFn: (row) => row.namespace, meta: CELL_META, cell: (info) => text(info.getValue()) },
  { id: 'ready', header: 'Ready', size: 80, accessorFn: (row) => (row.ready === undefined ? '' : `${row.ready.ready}/${row.ready.total}`), meta: CELL_META, cell: (info) => text(info.getValue()) },
  { id: 'status', header: 'Status', size: 160, accessorFn: (row) => row.status?.word ?? '', meta: CELL_META, cell: (info) => text(info.getValue()) },
  { id: 'restarts', header: 'Restarts', size: 90, accessorFn: (row) => row.restarts, meta: CELL_META, cell: (info) => text(info.getValue()) },
  { id: 'age', header: 'Age', size: 80, accessorFn: (row) => (row.createdAt === undefined ? '' : compactAge(new Date(row.createdAt), NOW).text), meta: CELL_META, cell: (info) => text(info.getValue()) },
];

export const probe: Probe = {
  scroller: () => document.querySelector<HTMLElement>('[data-bench-scroller]'),
  body: () => document.querySelector<HTMLElement>('[data-bench-scroller] tbody'),
  indexAttribute: 'data-index',
  headerHeight: () => document.querySelector('[data-bench-scroller] thead')?.getBoundingClientRect().height ?? 0,
  sortControl: () => [...document.querySelectorAll<HTMLElement>('[data-bench-scroller] thead button')].find((button) => button.textContent?.startsWith('Name')) ?? null,
};

export default function ReferenceVariant({ rows }: VariantProps) {
  const [sorting, setSorting] = useState([{ id: 'name', desc: false }]);
  const table = useDataTable<Row>({
    data: rows as Row[],
    columns,
    meta: TABLE_META,
    features: FEATURES,
    enableMultiSort: true,
    getRowId,
    onSortingChange: setSorting,
    state: { sorting, columnPinning: COLUMN_PINNING },
  });
  return (
    <div className="stage">
      <DataTable.Root table={table} features={FEATURES} hoverable style={{ height: '100%' }}>
        <DataTable.Container data-bench-scroller="" aria-label="Pods" height="100%">
          <DataTable.Header />
          <DataTable.VirtualBody<Row> estimateRowSize={ROW_HEIGHT} fixedRowHeight />
        </DataTable.Container>
      </DataTable.Root>
    </div>
  );
}

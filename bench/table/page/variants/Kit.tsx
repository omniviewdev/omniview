// The kit's DataTable, as ui-next mounts it: the built package, its stylesheet and a ThemeProvider. S and A are this one component with the
// `layout` knob (row 1a.3b); everything else is shared.
import '@omniviewdev/kit/styles.css';
import { DataTable, ThemeProvider, type DataTableSelection, type DataTableSort } from '@omniviewdev/kit';
import { useMemo, useState } from 'react';
import { createColumns } from '../columns';
import type { Probe, Row } from '../harness';
import type { VariantProps } from '../variant';

const getRowKey = (row: Row) => row.key;
const NO_SELECTION = new Set<string>();
const noop = () => undefined;
const selection: DataTableSelection<Row> = { selected: NO_SELECTION, onToggle: noop, label: (row) => `Select ${row.name}` };

export const probe: Probe = {
  scroller: () => document.querySelector<HTMLElement>('[data-bench-scroller]'),
  body: () => document.querySelector<HTMLElement>('[data-bench-scroller] tbody'),
  indexAttribute: 'data-ov-index',
  headerHeight: () => document.querySelector('[data-bench-scroller] thead')?.getBoundingClientRect().height ?? 0,
  sortControl: () => [...document.querySelectorAll<HTMLElement>('[data-bench-scroller] thead th button')].find((button) => button.textContent?.startsWith('Name')) ?? null,
};

export default function KitVariant({ rows, cells, count, layout, overscan, rangeStep }: VariantProps) {
  const columns = useMemo(() => createColumns(cells, count), [cells, count]);
  const [sort, setSort] = useState<DataTableSort | undefined>({ column: 'name', direction: 'ascending' });
  return (
    <ThemeProvider>
      <div className="stage">
        <DataTable
          data-bench-scroller=""
          label="Pods"
          rows={rows}
          getRowKey={getRowKey}
          columns={columns}
          lines={2}
          sort={sort}
          onSortChange={setSort}
          selection={selection}
          rowsAreImmutable
          layout={layout}
          overscan={overscan}
          rangeStep={rangeStep}
        />
      </div>
    </ThemeProvider>
  );
}

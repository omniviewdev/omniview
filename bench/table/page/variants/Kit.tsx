// The kit's DataTable, as ui-next mounts it: the built package, its stylesheet and a ThemeProvider. (The measurement of row 1a.3b also mounted
// layout A through knobs that existed only on commit f4b92809; docs/ui-next/baseline/2026-11-16-table.md names it.)
import '@omniviewdev/kit/styles.css';
import { DataTable, ThemeProvider, type DataTableSelection, type DataTableSort } from '@omniviewdev/kit';
import { useMemo, useState } from 'react';
import { createColumns } from '../columns';
import type { Probe, Row } from '../harness';
import type { VariantProps } from '../variant';

const getRowKey = (row: Row) => row.key;
const NO_SELECTION: ReadonlySet<string> = new Set<string>();
const noop = () => undefined;
const label = (row: Row) => `Select ${row.name}`;
// The timing runs use a selection that never changes; the count runs (`count`) a real one, to count what a click renders.
const fixed: DataTableSelection<Row> = { selected: NO_SELECTION, onToggle: noop, label };

export const probe: Probe = {
  scroller: () => document.querySelector<HTMLElement>('[data-bench-scroller]'),
  body: () => document.querySelector<HTMLElement>('[data-bench-scroller] tbody'),
  indexAttribute: 'data-ov-index',
  headerHeight: () => document.querySelector('[data-bench-scroller] thead')?.getBoundingClientRect().height ?? 0,
  sortControl: () => [...document.querySelectorAll<HTMLElement>('[data-bench-scroller] thead th button')].find((button) => button.textContent?.startsWith('Name')) ?? null,
};

export default function KitVariant({ rows, cells, count, tick }: VariantProps) {
  const columns = useMemo(() => createColumns(cells, count), [cells, count]);
  const [sort, setSort] = useState<DataTableSort | undefined>({ column: 'name', direction: 'ascending' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION);
  const live = useMemo<DataTableSelection<Row>>(
    () => ({
      selected,
      label,
      onToggle: (row) => {
        setSelected((current) => {
          const next = new Set(current);
          if (!next.delete(row.key)) {
            next.add(row.key);
          }

          return next;
        });
      },
    }),
    [selected],
  );
  return (
    <ThemeProvider>
      <div className="stage">
        <DataTable
          data-bench-scroller=""
          data-bench-tick={tick}
          label="Pods"
          rows={rows}
          getRowKey={getRowKey}
          columns={columns}
          lines={2}
          sort={sort}
          onSortChange={setSort}
          selection={count ? live : fixed}
          rowsAreImmutable
        />
      </div>
    </ThemeProvider>
  );
}

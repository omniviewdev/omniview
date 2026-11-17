import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { dataAttributes } from '../../shared/dataAttributes';
import { useVirtualRows } from '../../table/useVirtualRows';
import { useTableFit, type FitColumn } from '../TableFit/useTableFit';
import styles from './DataTable.module.css';
import type { Pins } from './Row';
import { TableBody } from './TableBody';
import { TableHeader } from './TableHeader';
import type { DataTableColumn, DataTableDirection, DataTableProps, DataTableSort } from './types';
import { heightOf, useMeasure, widthOf } from './useMeasure';
import { useRowModel, type SortedRow } from './useRowModel';

/** Rows mounted beyond the viewport on each side. Measured, not assumed (plan 3.3 item 3). */
const OVERSCAN = 8;
/** The window moves in steps of this many rows (the old table's measured value). */
const RANGE_STEP = 4;
/** What a row is until the probe has been measured: the density tokens at 100% text size. */
const ONE_LINE = 24;
const TWO_LINES = 40;

/** Controls inside a row keep their own clicks: a click on one of these is never a row activation. */
const INTERACTIVE =
  'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="textbox"], [role="combobox"], [contenteditable]:not([contenteditable="false"]), [tabindex]';


function nextDirection(sort: DataTableSort | undefined, column: string): DataTableDirection {
  // The first press sorts ascending, a press on the active column turns it round and back: there is no third state (the mock's rule).
  return sort?.column === column && sort.direction === 'ascending' ? 'descending' : 'ascending';
}

/** The declared columns, in the form the fit takes; the selection column leads the table when there is one. */
function fitColumns<TRow>(columns: ReadonlyArray<DataTableColumn<TRow>>, hasSelection: boolean, sortable: boolean): Array<FitColumn<SortedRow<TRow>>> {
  // The fit samples the sorted rows (the rows in view are rows of the sorted order); a column reads its text from the caller's row.
  const declared: Array<FitColumn<SortedRow<TRow>>> = columns.map((column) => ({
    id: column.id,
    kind: column.fit,
    header: column.header,
    sortable: sortable && column.sortKey !== undefined,
    width: column.width,
    lead: column.lead,
    trail: column.trail,
    text: (item) => column.text?.(item.original) ?? '',
    tail: column.keepEnd === undefined ? undefined : (item) => column.keepEnd?.(item.original) ?? 0,
  }));
  return hasSelection ? [{ id: 'selection', kind: 'fixed', header: '', sortable: false, width: 46, utility: true, text: () => '' }, ...declared] : declared;
}

/**
 * A table of rows: a named scroll region holding a native table, with a sticky header, sortable columns, an optional selection column and
 * rows that are mounted only while they are in view. It is built on TanStack Table (the row model and the adaptive sort) and TanStack
 * Virtual (the window). Rows have one fixed height from the density tokens, and nothing in a row measures or subscribes: a patch to one
 * record renders one row, a click on a checkbox two at most, hover none, and the table has one click handler however many rows it holds.
 * Column widths come from `TableFit`: declared widths, plus a sampled measurement for text columns. Props are closed: no `className`, no
 * `style`; `data-*` passes through.
 */
export function DataTable<TRow>({
  label,
  rows,
  getRowKey,
  columns,
  lines = 1,
  sort,
  onSortChange,
  selection,
  onRowActivate,
  rowsAreImmutable = false,
  maxHeight,
  ...rest
}: DataTableProps<TRow>) {
  const regionRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [scrolled, setScrolled] = useState(false);

  const sorted = useRowModel({ rows, getRowKey, columns, sort, rowsAreImmutable });
  const rowHeight = useMeasure(probeRef, heightOf, lines === 2 ? TWO_LINES : ONE_LINE);
  const width = useMeasure(regionRef, widthOf, 0);
  const windowed = useVirtualRows({ count: sorted.length, getScrollElement: () => regionRef.current, rowHeight, overscan: OVERSCAN, rangeStep: RANGE_STEP });

  const hasSelection = selection !== undefined;
  const canSort = onSortChange !== undefined;
  const fitted = useMemo(() => fitColumns(columns, hasSelection, canSort), [columns, hasSelection, canSort]);
  const first = windowed.items[0];
  const last = windowed.items.at(-1);
  const plan = useTableFit({
    columns: fitted,
    rows: sorted,
    window: first === undefined || last === undefined ? undefined : { first: first.index, last: last.index },
    available: width,
    scope: regionRef,
    epoch: rowHeight,
  });

  // The pins are one object for the table, with the same identity until the pinned set changes.
  const pinKey = plan.pinned.map((pinned) => (pinned ? '1' : '0')).join('');
  const pins = useMemo<Pins>(() => ({ pinned: pinKey.split('').map((bit) => bit === '1'), edge: pinKey.lastIndexOf('1') }), [pinKey]);

  const offset = (slot: number) => `${plan.offsets[slot] ?? 0}px`;

  const onBodyClick = (event: MouseEvent<HTMLTableSectionElement>) => {
    const target = event.target;
    if (event.defaultPrevented || !(target instanceof Element)) {
      return;
    }

    const element = target.closest('tr[data-ov-index]');
    const original = element === null ? undefined : sorted[Number(element.getAttribute('data-ov-index'))]?.original;
    if (element === null || original === undefined || !event.currentTarget.contains(element)) {
      return;
    }

    const control = target.closest(INTERACTIVE);
    if (control !== null && element.contains(control)) {
      // The row's own checkbox is the one control the table handles: one handler for every row's.
      if (control.hasAttribute('data-ov-select')) {
        selection?.onToggle(original);
      }

      return;
    }

    onRowActivate?.(original, event);
  };

  return (
    <div
      {...dataAttributes(rest)}
      ref={regionRef}
      className={styles.region}
      role="region"
      aria-label={label}
      tabIndex={0}
      data-ov-lines={lines}
      style={{ '--_max-height': maxHeight === undefined ? undefined : `${maxHeight}px` }}
      data-ov-scrolled={scrolled ? '' : undefined}
      onScroll={(event) => {
        setScrolled(event.currentTarget.scrollLeft > 0);
      }}
    >
      <span ref={probeRef} className={styles.probe} aria-hidden="true" />
      <table
        className={styles.table}
        style={{
          '--_table-width': `${plan.total}px`,
          '--_pin-0': offset(0),
          '--_pin-1': offset(1),
          '--_pin-2': offset(2),
          '--_pin-3': offset(3),
          '--_pin-4': offset(4),
        }}
        aria-rowcount={sorted.length + 1}
        data-ov-activatable={onRowActivate === undefined ? undefined : ''}
      >
        <colgroup>
          {plan.widths.map((columnWidth, slot) => (
            <col key={fitted[slot]?.id ?? slot} className={styles.col} style={{ '--_width': `${columnWidth}px` }} />
          ))}
        </colgroup>
        <TableHeader
          columns={columns}
          selection={selection}
          sort={sort}
          onSort={onSortChange === undefined ? undefined : (column) => {
            onSortChange({ column, direction: nextDirection(sort, column) });
          }}
          pins={pins}
        />
        <TableBody
          rows={sorted}
          items={windowed.items}
          totalSize={windowed.totalSize}
          rowHeight={rowHeight}
          columns={columns}
          selection={selection}
          pins={pins}
          span={fitted.length}
          onClick={onBodyClick}
        />
      </table>
    </div>
  );
}

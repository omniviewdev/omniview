import type { MouseEventHandler } from 'react';
import type { VirtualRow } from '../../table/useVirtualRows';
import styles from './DataTable.module.css';
import { Row, type Pins } from './Row';
import type { DataTableColumn, DataTableSelection } from './types';
import type { SortedRow } from './useRowModel';

type BodyProps<TRow> = {
  readonly rows: ReadonlyArray<SortedRow<TRow>>;
  /** The mounted window: indexes into `rows` and their offsets. */
  readonly items: readonly VirtualRow[];
  readonly totalSize: number;
  readonly rowHeight: number;
  readonly columns: ReadonlyArray<DataTableColumn<TRow>>;
  readonly selection: DataTableSelection<TRow> | undefined;
  readonly pins: Pins;
  /** The id of the view's row menu, when rows open one. */
  readonly menu: string | undefined;
  /** The count of cell slots: the columns, and the selection column when there is one. */
  readonly span: number;
  /** The table's one click handler. */
  readonly onClick: MouseEventHandler<HTMLTableSectionElement>;
};

/**
 * The rows in the window, in normal flow between two spacer rows that stand for the rows above and below it (plan 3.3 item 2; the
 * layout the measurement chose, `docs/ui-next/baseline/`). The body has one click handler for all rows.
 */
export function TableBody<TRow>({ rows, items, totalSize, rowHeight, columns, selection, pins, menu, span, onClick }: BodyProps<TRow>) {
  const first = items[0];
  const last = items.at(-1);
  const above = first === undefined ? 0 : first.start;
  const below = last === undefined ? 0 : Math.max(0, totalSize - last.start - rowHeight);
  return (
    <tbody onClick={onClick}>
      {above > 0 ? <Spacer height={above} span={span} /> : null}
      {items.map((item) => {
        const row = rows[item.index];
        if (row === undefined) {
          return null;
        }

        return (
          <Row
            key={row.id}
            row={row.original}
            index={item.index}
            selected={selection === undefined ? undefined : selection.selected.has(row.id)}
            selectLabel={selection === undefined ? '' : selection.label(row.original)}
            columns={columns}
            pins={pins}
            menu={menu}
            rowKey={row.id}
          />
        );
      })}
      {below > 0 ? <Spacer height={below} span={span} /> : null}
    </tbody>
  );
}

function Spacer({ height, span }: { readonly height: number; readonly span: number }) {
  return (
    <tr className={styles.spacer} aria-hidden="true">
      <td colSpan={span} style={{ '--_height': `${height}px` }} />
    </tr>
  );
}

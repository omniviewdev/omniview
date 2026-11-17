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
  /** The count of cell slots: the columns, and the selection column when there is one. */
  readonly span: number;
  /** The table's one click handler. */
  readonly onClick: MouseEventHandler<HTMLTableSectionElement>;
  /** Layout under test (1a.3b): `absolute` positions each row itself and gives the body its total height; `spacer` stands the rows out of the window in for two rows. */
  readonly layout: 'spacer' | 'absolute';
};

/**
 * The rows in the window, in normal flow between two spacer rows that stand for the rows above and below it (plan 3.3 item 2; the
 * layout the measurement chose, `docs/ui-next/baseline/`). The body has one click handler for all rows.
 */
export function TableBody<TRow>({ rows, items, totalSize, rowHeight, columns, selection, pins, span, onClick, layout }: BodyProps<TRow>) {
  const absolute = layout === 'absolute';
  const first = items[0];
  const last = items.at(-1);
  const above = first === undefined ? 0 : first.start;
  const below = last === undefined ? 0 : Math.max(0, totalSize - last.start - rowHeight);
  return (
    <tbody onClick={onClick} role={absolute ? 'rowgroup' : undefined} style={absolute ? { '--_body-height': `${totalSize}px` } : undefined}>
      {!absolute && above > 0 ? <Spacer height={above} span={span} /> : null}
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
            start={absolute ? item.start : undefined}
          />
        );
      })}
      {!absolute && below > 0 ? <Spacer height={below} span={span} /> : null}
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

import { memo } from 'react';
import styles from './DataTable.module.css';
import type { DataTableColumn } from './types';

/** Which columns stick to the start edge. One object for the table: a row is asked to render again only when the pins change. */
export type Pins = {
  /** Per column slot, the selection column first when there is one. */
  readonly pinned: readonly boolean[];
  /** The slot of the last pinned column, which draws the edge line while the region is scrolled sideways; -1 when nothing is pinned. */
  readonly edge: number;
};

type RowProps<TRow> = {
  readonly row: TRow;
  /** The position among the sorted rows, from 0. */
  readonly index: number;
  /** Whether the row is selected; undefined when the table has no selection column. */
  readonly selected: boolean | undefined;
  /** The accessible name of the row's checkbox. */
  readonly selectLabel: string;
  readonly columns: ReadonlyArray<DataTableColumn<TRow>>;
  readonly pins: Pins;
};

// A controlled checkbox needs a change handler to be valid, and the table has one handler for every row: the body's. One shared function
// is a function that is not made again for each row.
const noop = () => undefined;

function RowImpl<TRow>({ row, index, selected, selectLabel, columns, pins }: RowProps<TRow>) {
  const shift = selected === undefined ? 0 : 1;
  return (
    <tr className={styles.row} aria-rowindex={index + 2} data-ov-index={index} data-ov-selected={selected === true ? 'true' : undefined}>
      {selected === undefined ? null : (
        <td className={styles.cell} data-ov-kind="select" data-ov-pin={pins.pinned[0] ? 0 : undefined} data-ov-edge={pins.edge === 0 ? '' : undefined}>
          <input type="checkbox" className={styles.check} checked={selected} onChange={noop} aria-label={selectLabel} data-ov-select="" />
        </td>
      )}
      {columns.map((column, position) => {
        const slot = position + shift;
        return (
          <td
            key={column.id}
            className={styles.cell}
            data-ov-align={column.align === 'end' ? 'end' : undefined}
            data-ov-pin={pins.pinned[slot] ? slot : undefined}
            data-ov-edge={pins.edge === slot ? '' : undefined}
          >
            {column.cell(row)}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * One mounted row. It renders again only when its own row object, its position, its selection, the columns or the pins change: a patch to
 * one record renders one row, a selection click two at most, a change of the parent none (register T-06). The props are primitives and
 * stable references, so React's own comparison is enough, and nothing here reads a context.
 */
export const Row = memo(RowImpl) as typeof RowImpl;

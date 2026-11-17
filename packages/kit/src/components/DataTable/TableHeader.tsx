import { Icon } from '../Icon';
import styles from './DataTable.module.css';
import type { Pins } from './Row';
import type { DataTableColumn, DataTableSelection, DataTableSort } from './types';

type HeaderProps<TRow> = {
  readonly columns: ReadonlyArray<DataTableColumn<TRow>>;
  readonly selection: DataTableSelection<TRow> | undefined;
  readonly sort: DataTableSort | undefined;
  /** Present only when the table can change its sort: a header then holds a button. */
  readonly onSort: ((column: string) => void) | undefined;
  readonly pins: Pins;
};

type AllProps = {
  readonly state: boolean | 'mixed';
  readonly label: string;
  readonly onToggle: () => void;
};

// The mixed state of a checkbox is a property of the element, not an attribute.
function setMixed(element: HTMLInputElement | null, state: boolean | 'mixed') {
  if (element !== null) {
    element.indeterminate = state === 'mixed';
  }
}

function SelectAll({ state, label, onToggle }: AllProps) {
  return (
    <input
      ref={(element) => {
        setMixed(element, state);
      }}
      type="checkbox"
      className={styles.check}
      checked={state === true}
      onChange={onToggle}
      aria-label={label}
    />
  );
}

/** The header row, sticky to the top of the region: one cell a column, a native button in each sortable one, the sort state in `aria-sort`. */
export function TableHeader<TRow>({ columns, selection, sort, onSort, pins }: HeaderProps<TRow>) {
  const shift = selection === undefined ? 0 : 1;
  return (
    <thead>
      <tr aria-rowindex={1}>
        {selection === undefined ? null : (
          <th
            scope="col"
            className={styles.head}
            data-ov-kind="select"
            data-ov-pin={pins.pinned[0] ? 0 : undefined}
            data-ov-edge={pins.edge === 0 ? '' : undefined}
            aria-label={selection.all === undefined ? 'Selection' : undefined}
          >
            {selection.all === undefined ? null : <SelectAll state={selection.all.state} label={selection.all.label} onToggle={selection.all.onToggle} />}
          </th>
        )}
        {columns.map((column, position) => {
          const slot = position + shift;
          const sortable = onSort !== undefined && column.sortKey !== undefined;
          const direction = sort?.column === column.id ? sort.direction : undefined;
          return (
            <th
              key={column.id}
              scope="col"
              className={styles.head}
              data-ov-align={column.align === 'end' ? 'end' : undefined}
              data-ov-sortable={sortable ? '' : undefined}
              data-ov-pin={pins.pinned[slot] ? slot : undefined}
              data-ov-edge={pins.edge === slot ? '' : undefined}
              aria-sort={sortable ? (direction ?? 'none') : undefined}
            >
              {sortable ? (
                <button
                  type="button"
                  className={styles.sort}
                  onClick={() => {
                    onSort(column.id);
                  }}
                >
                  {column.header}
                  {direction === undefined ? null : <Icon name={direction === 'ascending' ? 'arrow-up' : 'arrow-down'} size={12} />}
                </button>
              ) : (
                column.header
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

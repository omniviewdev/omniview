import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { MissingValue } from '../MissingValue';
import styles from './KeyValue.module.css';

export type KeyValueRow = {
  /**
   * Names the row among the others, stably: what its subtree, and the focus in it, are kept by when the rows before it come and go. Default: the label (a list's labels are product nouns and
   * unique; a second row with the same name is told apart by its place among the rows of that name). Give an id where a row keeps its place in the list while its label changes.
   */
  readonly id?: string | undefined;
  readonly label: string;
  /** Drawn as given (text, a Status, a Link, a MiddleEllipsis). Absent, null or an empty string: the missing value's dash (`MissingValue`, named "No <label lower case>"). */
  readonly value?: ReactNode;
  /** The value in the code face (an identifier, a selector). */
  readonly mono?: boolean | undefined;
  /** Spans every column of a many-column list. */
  readonly wide?: boolean | undefined;
};

export type KeyValueProps = {
  readonly rows: readonly KeyValueRow[];
  /** Pairs per row: 1 (default), 2 or 3. */
  readonly columns?: 1 | 2 | 3 | undefined;
  /** The label track: 96, 130 (default) or 160 px. */
  readonly labelWidth?: 96 | 130 | 160 | undefined;
} & DataAttributes;

type KeyedRow = { readonly key: string; readonly row: KeyValueRow };

/**
 * The key of each row: its id, else its label, and a second row with the same name is keyed by its place among the rows of that name. A key never depends on the row's place in the list, so
 * taking a row away before another never renames it: React keeps the other's subtree, and the focus in it.
 */
function keyed(rows: readonly KeyValueRow[]): readonly KeyedRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const name = row.id ?? row.label;
    const nth = seen.get(name) ?? 0;
    seen.set(name, nth + 1);
    return { key: nth === 0 ? name : `${name}\u0000${String(nth)}`, row };
  });
}

/**
 * A list of facts: a label and its value, in rows 24 px high (the mock's key-value list, design 12 KV1). The list is a native `dl` of
 * `div > dt + dd`; the label track is 96, 130 or 160 px and the value starts 16 px after it; with 2 or 3 columns the pairs flow
 * across, 24 px apart. The columns step down with the part's own width, not the window's: 3 become 2 below 900 px, 2 become 1 below
 * 640 px. A missing value is the dash of `MissingValue`, named for what is missing. A value is drawn as given, so a `Status`, a `Link`
 * or a `MiddleEllipsis` fits; the part has no tab stop of its own. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function KeyValue({ rows, columns = 1, labelWidth = 130, ...rest }: KeyValueProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div {...dataAttributes(rest)} className={styles.root} data-ov-part="key-value" data-ov-columns={columns} data-ov-label-width={labelWidth}>
      <dl className={styles.list}>
        {keyed(rows).map(({ key, row }) => (
          <div key={key} className={styles.row} data-ov-part="row" data-ov-wide={row.wide === true ? 'true' : undefined}>
            <dt className={styles.label} data-ov-part="label">
              {row.label}
            </dt>
            <dd className={styles.value} data-ov-part="value">
              {row.value === undefined || row.value === null || row.value === '' ? (
                <MissingValue name={`No ${row.label.toLowerCase()}`} />
              ) : row.mono === true ? (
                <span className={styles.code}>{row.value}</span>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

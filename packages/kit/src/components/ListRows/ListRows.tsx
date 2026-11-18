import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './ListRows.module.css';

export type ListRow = {
  readonly id: string;
  /** The first line. */
  readonly title: ReactNode;
  /** A second, muted line. */
  readonly detail?: ReactNode;
  /** The trailing muted value (an age, a count). */
  readonly meta?: ReactNode;
  /** A glyph before the text (a `Status` symbol, an `Icon`). */
  readonly icon?: ReactNode;
};

export type ListRowsProps = {
  /** Names the list ("Recent warnings"). */
  readonly label: string;
  readonly rows: readonly ListRow[];
} & DataAttributes;

/** A node that draws something: not absent, null, false or an empty string. */
const drawn = (node: ReactNode) => node !== undefined && node !== null && node !== false && node !== '';

/**
 * A list of rows that are text (the mock's `H.listrows` of `H.listrow`, as the Recent warnings card draws them): an optional glyph, a title
 * over an optional muted detail line, each clipped to one line with an ellipsis, and an optional trailing muted value. The rows share their
 * columns: a glyph, a meta or neither is the same width in every row, so each cell starts at the same x in each row, and a row is 24 px at the
 * least (22 px compact) and as tall as its lines. A row is not a control and has no tab stop; a link in a title is the caller's. The list is a
 * native `ul` named by `label`. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function ListRows({ label, rows, ...rest }: ListRowsProps) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <ul
      {...dataAttributes(rest)}
      className={styles.root}
      role="list"
      aria-label={label}
      data-ov-part="list-rows"
      data-ov-icon={rows.some((row) => drawn(row.icon)) ? 'true' : undefined}
      data-ov-meta={rows.some((row) => drawn(row.meta)) ? 'true' : undefined}
    >
      {rows.map((row) => (
        <li key={row.id} className={styles.row} data-ov-part="list-row">
          {drawn(row.icon) ? (
            <span className={styles.icon} data-ov-part="icon">
              {row.icon}
            </span>
          ) : null}
          <div className={styles.text} data-ov-part="text">
            <div className={styles.title} data-ov-part="title" data-ov-clip="">
              {row.title}
            </div>
            {drawn(row.detail) ? (
              <div className={styles.detail} data-ov-part="detail" data-ov-clip="">
                {row.detail}
              </div>
            ) : null}
          </div>
          {drawn(row.meta) ? (
            <span className={styles.meta} data-ov-part="meta">
              {row.meta}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

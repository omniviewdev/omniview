import { useId, type ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Link, type LinkTarget } from '../Link';
import { tip } from '../TooltipHost';
import styles from './ListRows.module.css';

type ListRowCells = {
  readonly id: string;
  /** The first line. */
  readonly title: ReactNode;
  /** A second, muted line. */
  readonly detail?: ReactNode;
  /** The trailing muted value (an age, a count). */
  readonly meta?: ReactNode;
  /** A glyph before the text (a `Status` symbol, an `Icon`). */
  readonly icon?: ReactNode;
  /**
   * Controls after the row: up to two `IconButton`s or `Button`s of size `row`. Each is its own Tab stop and a sibling of the row's own
   * control, never inside it: using one never activates the row. A row without `aside` leaves the column empty.
   */
  readonly aside?: ReactNode;
  /** The plain-text tooltip of the whole row. */
  readonly tip?: string | undefined;
};

/** A row is text, or one control: a button (`onActivate`) or a link (`to`). Not both. */
export type ListRow = ListRowCells &
  (
    | {
      readonly onActivate?: undefined;
      readonly to?: undefined;
    }
    | {
      /** The row is a button: the whole of its cells is one control, a Tab stop. */
      readonly onActivate: () => void;
      readonly to?: undefined;
      /** The row's state as a toggle (`aria-pressed`) and its selected fill. Absent, the row is a plain command. */
      readonly selected?: boolean | undefined;
      /** Why the row cannot be activated. It stays focusable with `aria-disabled`, does nothing, and has this as its description. */
      readonly disabledReason?: string | undefined;
    }
    | {
      /** The row is a link to a destination in the host: a native anchor (needs a `LinkProvider`). */
      readonly to: LinkTarget;
      readonly onActivate?: undefined;
    }
  );

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
 * columns: a glyph, a meta, an aside or none is the same width in every row, so each cell starts at the same x in each row, and a row is 24 px
 * at the least (22 px compact) and as tall as its lines. A row is text unless it is given `onActivate` (a button) or `to` (a link): then its
 * cells are one control and one Tab stop, and the `aside` controls that follow it are siblings, each its own Tab stop. A link in a title of a
 * text row is the caller's. The list is a native `ul` named by `label`. Props are closed: no `className`, no `style`; `data-*` passes through.
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
      data-ov-aside={rows.some((row) => drawn(row.aside)) ? 'true' : undefined}
    >
      {rows.map((row) => (
        <Item key={row.id} row={row} />
      ))}
    </ul>
  );
}

function Item({ row }: { readonly row: ListRow }) {
  const reasonId = useId();
  const cells = (
    <>
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
    </>
  );

  let body: ReactNode = cells;
  if (row.to !== undefined) {
    body = (
      <Link to={row.to} data-ov-action="link">
        {cells}
      </Link>
    );
  } else if (row.onActivate !== undefined) {
    const reason = row.disabledReason !== undefined && row.disabledReason.trim() !== '' ? row.disabledReason : undefined;
    const activate = row.onActivate;
    body = (
      <button
        type="button"
        data-ov-action="button"
        aria-pressed={row.selected}
        aria-disabled={reason === undefined ? undefined : 'true'}
        aria-describedby={reason === undefined ? undefined : reasonId}
        onClick={() => {
          if (reason === undefined) {
            activate();
          }
        }}
      >
        {cells}
        {reason === undefined ? null : (
          <span id={reasonId} hidden>
            {reason}
          </span>
        )}
      </button>
    );
  }

  return (
    <li {...dataAttributes(tip(row.tip))} className={styles.row} data-ov-part="list-row">
      {body}
      {drawn(row.aside) ? (
        <div className={styles.aside} data-ov-part="aside">
          {row.aside}
        </div>
      ) : null}
    </li>
  );
}

import { Button } from '../Button';
import { Icon } from '../Icon';
import styles from './DataView.module.css';

/** The rows of a first-load skeleton: the mock's eight static rows under a head row (core.js `H.skeleton`, 13 ES2). */
const SKELETON_ROWS = 8;

/**
 * The width of one bar, in percent: the mock's own formula, so a skeleton is the same placeholder every time (a static one, never a
 * shimmer): 40 plus a deterministic 0 to 50 from the row and the column.
 */
const barWidth = (row: number, column: number) => 40 + ((row * 37 + column * 53) % 51);

/**
 * The first load of a collection (plan 1.4): the final column count as a head row and eight rows of bars, in a busy status named for what
 * loads. It appears 250 ms after it mounts, so a read that is fast never flashes one (at once under reduced motion; the stylesheet does it).
 */
export function LoadingBody({ label, columns }: { readonly label: string; readonly columns: number }) {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label={`Loading ${label}`}>
      {Array.from({ length: SKELETON_ROWS + 1 }, (_, row) => (
        <div key={row} className={styles.skeletonRow} data-ov-skeleton-row="" data-ov-head={row === 0 ? '' : undefined} style={{ '--_cols': columns }}>
          {Array.from({ length: columns }, (__, column) => (
            <span key={column} style={{ '--_w': `${String(barWidth(row, row === 0 ? column + 7 : column))}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The one line under the table's header when there is nothing to list ("No Items", "No Items match"), with an optional hint. It is a polite
 * status: it appears in answer to a search. The command that clears a search is the toolbar's (plan E9), not this line's.
 */
export function EmptyBody({ title, hint }: { readonly title: string; readonly hint?: string | undefined }) {
  return (
    <div className={styles.empty} role="status">
      <Icon name="search-x" />
      <b>{title}</b>
      {hint === undefined ? null : <span>{hint}</span>}
    </div>
  );
}

/**
 * A failure that leaves no rows: one error notice in place of them, an alert that says what could not be loaded and, when the runtime sent one,
 * why, with one Retry when there is a way to try again (plan 1.4; 15 5.8, 17 K18, K24). It is said once: the footer repeats nothing.
 */
export function ErrorBody({ title, message, onRetry }: { readonly title: string; readonly message?: string | undefined; readonly onRetry?: (() => void) | undefined }) {
  return (
    <div className={styles.failure}>
      <div className={styles.notice} role="alert">
        <Icon name="status-error" />
        <div className={styles.noticeBody}>
          <b>{title}</b>
          {message === undefined ? null : (
            <>
              <br />
              {message}
            </>
          )}
        </div>
        {onRetry === undefined ? null : (
          <div className={styles.noticeAction}>
            <Button onClick={onRetry}>Retry</Button>
          </div>
        )}
      </div>
    </div>
  );
}

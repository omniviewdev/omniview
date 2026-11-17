import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon } from '../Icon';
import { CollectionCount, grouped, type CollectionCountProps } from './CollectionCount';
import styles from './CollectionFooter.module.css';

export type CollectionFooterProps = {
  /** How many items are on screen, after the search and the filters. */
  readonly shown: CollectionCountProps['shown'];
  readonly total: CollectionCountProps['total'];
  readonly noun: string;
  readonly plural: string;
  /** How many items are selected. "N selected" follows the count while it is above zero (design 13 N1). */
  readonly selected?: number | undefined;
  /** A refresh runs on rows that stay on screen: the quiet status "Refreshing…" in the trailing cluster. It is also where the Refresh command's reason is written (design 14 P2). */
  readonly refreshing?: boolean | undefined;
  /** Columns the width dropped, not the person's choice: one muted note, named in its tip. The Columns chooser lists them as available. */
  readonly hiddenColumns?: { readonly names: readonly string[] } | undefined;
} & DataAttributes;

/** The note's tip: which columns, and where to get them. */
function hiddenTip(names: readonly string[]): string {
  const many = names.length !== 1;
  return `${names.join(', ')} ${many ? 'fit' : 'fits'} a wider list. Choose ${many ? 'them' : 'it'} in Columns.`;
}

/**
 * The footer of a collection (design 13 G1 to G5, N1, FT1): one flex lane, 12/16 muted tabular text, the count and the selection in its
 * leading cluster, which is a live region, and ambient status in the trailing one. A healthy collection prints the count and nothing
 * else: no provenance, no legend, no sentence. It is the last lane of its pane, 33 px high with its separator, and its text starts on
 * the table's first-cell rail. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function CollectionFooter({ shown, total, noun, plural, selected, refreshing, hiddenColumns, ...rest }: CollectionFooterProps) {
  const hidden = hiddenColumns === undefined || hiddenColumns.names.length === 0 ? undefined : hiddenColumns.names;
  const ambient = refreshing === true || hidden !== undefined;

  return (
    <div {...dataAttributes(rest)} className={styles.root}>
      <span className={styles.cluster} data-ov-cluster="lead" role="status">
        <CollectionCount shown={shown} total={total} noun={noun} plural={plural} />
        {selected !== undefined && selected > 0 ? <span>{`${grouped(selected)} selected`}</span> : null}
      </span>
      {ambient ? (
        <span className={styles.cluster} data-ov-cluster="end">
          {hidden === undefined ? null : (
            <span className={styles.note} data-ov-tip={hiddenTip(hidden)}>
              {`${hidden.length} ${hidden.length === 1 ? 'column' : 'columns'} hidden at this width`}
            </span>
          )}
          {refreshing === true ? (
            <span className={styles.refreshing} role="status">
              <Icon name="loader" />
              <span>Refreshing…</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

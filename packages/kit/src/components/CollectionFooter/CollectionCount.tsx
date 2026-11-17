import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import styles from './CollectionFooter.module.css';

/** A count as the caller has it: a non-negative whole number, or its decimal digits (exact for a number of any size). */
export type CollectionNumber = number | string;

/**
 * What the collection's whole size is, and how well it is known (the mock's `H.count`).
 *
 * - `exact`: the size of the whole set. A smaller shown count reads "12 of 89 items".
 * - `estimate`: the source can only say about how big the set is ("About 120 items").
 * - `unknown`: the set is still loading, so nothing is known of its size; `loaded` is how many items are in hand (it defaults to the
 *   shown count). Decision A10: the footer says "N items loaded" until the whole set has arrived.
 */
export type CollectionTotal =
  | { readonly kind: 'exact'; readonly value: CollectionNumber }
  | { readonly kind: 'estimate'; readonly value: CollectionNumber }
  | { readonly kind: 'unknown'; readonly loaded?: CollectionNumber | undefined };

export type CollectionCountProps = {
  /** How many items are on screen, after the search and the filters. */
  readonly shown: CollectionNumber;
  readonly total: CollectionTotal;
  /** The name of one item ("Item"): used when the count it follows is exactly one. */
  readonly noun: string;
  /** The name of several ("Items"): used for every other count, zero included. */
  readonly plural: string;
} & DataAttributes;

/** The decimal digits of a count, or a TypeError: a count that is not a whole number is a defect of the caller, and a wrong count is worse than none. */
function digits(value: CollectionNumber): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`A collection count is a non-negative whole number; got ${String(value)}`);
    }

    return String(value);
  }

  if (!/^\d+$/.test(value)) {
    throw new TypeError(`A collection count is a non-negative whole number or its decimal digits; got "${value}"`);
  }

  return value.replace(/^0+(?=\d)/, '');
}

/** Thousands are grouped with a comma: the footer's figures are tabular and read the same in every locale of the window. */
export function grouped(value: CollectionNumber): string {
  return BigInt(digits(value)).toLocaleString('en-US');
}

/** The count's sentence, as a string. The component draws exactly this. */
export function countText(shown: CollectionNumber, total: CollectionTotal, noun: string, plural: string): string {
  const own = digits(shown);
  const named = (value: string) => `${grouped(value)} ${value === '1' ? noun : plural}`;

  if (total.kind === 'exact') {
    const whole = digits(total.value);
    return own === whole ? named(own) : `${grouped(own)} of ${named(whole)}`;
  }

  if (total.kind === 'estimate') {
    const whole = digits(total.value);
    return `${own === whole ? '' : `${grouped(own)} shown · `}About ${named(whole)}`;
  }

  const loaded = total.loaded === undefined ? own : digits(total.loaded);
  return own === loaded ? `${named(loaded)} loaded` : `${grouped(own)} shown · ${grouped(loaded)} loaded`;
}

/**
 * The one count of a collection (design 13 N1): `89 items`, `12 of 89 items` when a search or a filter hides some, `89 items loaded` while
 * the rest is still on its way (decision A10), `About 120 items` for an estimate. It lives in the leading cluster of the collection's
 * footer and nowhere else (13 N5). Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function CollectionCount({ shown, total, noun, plural, ...rest }: CollectionCountProps) {
  return (
    <span {...dataAttributes(rest)} className={styles.count}>
      {countText(shown, total, noun, plural)}
    </span>
  );
}

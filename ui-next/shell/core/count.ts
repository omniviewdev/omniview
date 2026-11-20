// What the sidebar's count slot draws for a count: plain functions over data, as the rest of the core is. No React and no DOM, so every rule is a unit test.
//
// The mock groups the thousands of every collection count (`H.count`: `groupedDecimal`, core.js:1874) and the kit's footer does the same with a comma, whatever the locale of the window
// (`grouped` in CollectionCount.tsx): the sidebar's figures read as the footer's do, so "1,234" in the one is "1,234" in the other. An estimate in a footer is the words "About 120"; in the
// sidebar's 12 px slot there is no room for words, and the owner approved a tilde (Q2a): "~1,234", which assistive technology hears as "about 1,234".
import type { ShellCount } from '../registration';

/** What a count is drawn as. */
export type CountText = {
  /** What the slot shows: the grouped digits, with a tilde before them when the count is approximate. */
  readonly text: string;
  /** The grouped digits alone: what follows "about" for assistive technology. */
  readonly digits: string;
  readonly approximate: boolean;
};

const GROUPED = new Intl.NumberFormat('en-US');

/** A count is a whole number of at least zero that a number can hold exactly: a wrong count is worse than none, and a sidebar must never throw because a plugin sent one. */
const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * The text of an entry's count, or `undefined` when there is none to draw: no count, a slot that has no number yet (`null`), and anything that is not a count (a negative number, a fraction, `NaN`,
 * an object that does not say it is approximate). The plugin's data hook is plugin code and its answer is read as `unknown` at the edge of the host's own code, so the answer is checked here and never trusted.
 */
export function countText(count: ShellCount | null | undefined): CountText | undefined {
  if (isWhole(count)) {
    const digits = GROUPED.format(count);
    return { text: digits, digits, approximate: false };
  }

  if (typeof count === 'object' && count !== null) {
    // Read as what it is at the edge of plugin code, a record of unknown values: the type says `approximate` is `true`, and a plugin's own answer need not.
    const { approximate, value }: Readonly<Record<string, unknown>> = count;
    if (approximate === true && isWhole(value)) {
      const digits = GROUPED.format(value);
      return { text: `~${digits}`, digits, approximate: true };
    }
  }

  return undefined;
}

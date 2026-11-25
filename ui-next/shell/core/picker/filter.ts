import { highlight, scoreCandidate, wordsOf } from '../palette/match';
import type { Range } from '../palette/types';

// Narrowing the options of a scope picker by what a person types (HM1). Framework-free: no React, no DOM, nothing a plugin owns. It is the palette's matcher and nothing else, so a picker finds and ranks a name as the palette does:
// every word of the query must match (AND), a whole word beats the start of the name, which beats a match inside it, and the first letters of words ("ei" for EC2 Instances) and the letters of one word in order ("dply") match too.

/** What the filter needs of an option: the name a person reads, and types against, and the secondary text under it, which counts when the name does not say it. */
type Named = { readonly label: string; readonly detail?: string | undefined };

/** An option the query kept, and the runs of its label that matched: what a view draws in weight 600, never in colour alone. */
export type Matched<T extends Named> = { readonly option: T; readonly ranges: readonly Range[] };

/**
 * The options a query keeps. A query with no word in it (empty, or white space) keeps all of them, in the order they were given, with nothing to highlight. Otherwise an option stays when every word of the query
 * matches its label; the best match leads, and options that match equally well keep the order they were given in. The options are returned as they were handed in (the same objects), never copied.
 */
export function filterOptions<T extends Named>(options: readonly T[], query: string): Array<Matched<T>> {
  const words = wordsOf(query);
  if (words.length === 0) {
    return options.map((option): Matched<T> => ({ option, ranges: [] }));
  }

  const kept: Array<{ readonly matched: Matched<T>; readonly score: number; readonly at: number }> = [];
  for (const [at, option] of options.entries()) {
    const score = scoreCandidate(words, { title: option.label, context: option.detail ?? '' });
    if (score !== undefined) {
      kept.push({ matched: { option, ranges: highlight(words, option.label, option.detail ?? '').title }, score, at });
    }
  }

  return kept.sort((a, b) => b.score - a.score || a.at - b.at).map(({ matched }) => matched);
}

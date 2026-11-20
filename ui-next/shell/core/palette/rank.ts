import { scoreCandidate } from './match';
import type { Candidate } from './types';

// The ranking of one section's candidates (ch16 SE1): score, then the tie-break below, so the same candidates in the same order give the same list on every machine. The candidates of
// several providers are one list. Only the best `limit` are kept, found with one pass and a sorted buffer of that size, so a provider that hands over ten thousand candidates costs a
// score each and an allocation only for those that could still make the list.

export type RankSource = { readonly owner: string; readonly candidates: readonly Candidate[] };
export type Hit = { readonly candidate: Candidate; readonly owner: string; readonly score: number };

export type Ranked = {
  readonly hits: readonly Hit[];
  /** Candidates that matched (or, with no words, all of the usable ones), past the limit too. */
  readonly total: number;
  /** Candidates of an owner that were not usable (not an object, no id or no title), so the provider can be told. */
  readonly invalid: ReadonlyMap<string, number>;
};

type Entry = Hit & { readonly order: number; readonly seq: number };

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Better first: a higher score, then the lower `order`, the shorter title, the title and the key by code unit (never by locale). */
function ranked(a: Entry, b: Entry): number {
  return b.score - a.score || a.order - b.order || a.candidate.title.length - b.candidate.title.length || byCodeUnit(a.candidate.title, b.candidate.title) || byCodeUnit(`${a.owner}|${a.candidate.id}`, `${b.owner}|${b.candidate.id}`);
}

/** With no query nothing is ranked: the candidates keep the order they were given, the lower `order` first. */
const unranked = (a: Entry, b: Entry): number => a.order - b.order || a.seq - b.seq;

function insert(kept: Entry[], entry: Entry, limit: number, compare: (a: Entry, b: Entry) => number): void {
  let low = 0;
  let high = kept.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const other = kept[middle];
    if (other !== undefined && compare(other, entry) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  kept.splice(low, 0, entry);
  if (kept.length > limit) {
    kept.pop();
  }
}

/** The best `limit` candidates of the sources for the words of a query, in order, and how many there were in all. */
export function rank(sources: readonly RankSource[], words: readonly string[], limit: number): Ranked {
  const size = Math.max(0, Math.floor(limit));
  const compare = words.length === 0 ? unranked : ranked;
  const kept: Entry[] = [];
  const invalid = new Map<string, number>();
  let total = 0;
  let seq = 0;
  for (const { owner, candidates } of sources) {
    for (const candidate of candidates) {
      const place = seq;
      seq += 1;
      // `typeof` first: a provider is plugin code, and a list may hold anything.
      if (typeof candidate !== 'object' || candidate === null || typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || candidate.id === '' || candidate.title === '') {
        invalid.set(owner, (invalid.get(owner) ?? 0) + 1);
        continue;
      }

      const score = scoreCandidate(words, candidate);
      if (score === undefined) {
        continue;
      }

      total += 1;
      const worst = kept.length === size ? kept[size - 1] : undefined;
      // Nothing that scores lower than the worst kept can enter, and with no words nothing that comes later with no lower order can.
      if (size === 0 || (worst !== undefined && (words.length === 0 ? (candidate.order ?? place) >= worst.order : score < worst.score))) {
        continue;
      }

      insert(kept, { candidate, owner, score, order: candidate.order ?? place, seq: place }, size, compare);
    }
  }

  return { hits: kept.map(({ candidate, owner, score }) => ({ candidate, owner, score })), total, invalid };
}

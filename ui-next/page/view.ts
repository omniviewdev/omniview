import type { ChipTone, CollectionFooterProps, DataViewState } from '@omniviewdev/kit';
import type { ListPageDefinition, ListSource } from './definition';

/** What the person asked of the list. Both are the applied values: the search after its delay, the filter as chosen. */
export type ListQuery = {
  /** Trimmed and lower case (`normalizeSearch`). Empty: no search. */
  readonly text: string;
  /** The id of the chosen quick filter, or null for All. */
  readonly filter: string | null;
};

export type ListFilterView = {
  readonly id: string;
  readonly label: string;
  readonly tone: ChipTone;
  /** Undefined while nothing is known: a chip with no number is a load in progress, and a zero is a count. */
  readonly count: number | undefined;
};

/** Everything the page draws that is a decision rather than a layout. */
export type ListView<TRow> = {
  /** The rows to show: the source's, narrowed by the search and the chosen filter. The source's own array while nothing narrows them. */
  readonly rows: readonly TRow[];
  /** What the body shows. */
  readonly state: DataViewState;
  /** The strip, with its counts (taken after the search and before the chosen filter); absent when the definition has none. */
  readonly quickFilters: { readonly label: string; readonly total: number | undefined; readonly filters: readonly ListFilterView[] } | undefined;
  /** The footer's count: how many are shown, of how many (exactly, or as far as they are loaded). */
  readonly footer: Pick<CollectionFooterProps, 'shown' | 'total'>;
  /** A search or a filter narrows the list: the page offers Clear filters. */
  readonly active: boolean;
};

/** The search the list applies: what was typed, trimmed and lower case, matched as one substring (the design's search). */
export const normalizeSearch = (typed: string): string => typed.trim().toLowerCase();

/**
 * The page as a function of its definition, its source and the person's query (design 13 QF1, N1, ES1, ES2; plan 1.3, 1.4):
 *
 * - the rows are the source's, in its order, narrowed by the search and then by the chosen quick filter;
 * - each quick filter counts over the rows the search keeps and the chosen filter has not narrowed, so choosing one leaves the others' counts as they were;
 * - the body is loading until the first rows or the whole (empty) set arrive, an error when a failure left no rows, empty when the whole set
 *   holds nothing, no-match when rows exist and the query hides them all, and ready otherwise; a failure that came after rows does not replace them;
 * - the count is exact once the set is complete, and "as far as loaded" while it is not.
 */
export function deriveListView<TRow>(definition: ListPageDefinition<TRow>, source: ListSource<TRow>, query: ListQuery): ListView<TRow> {
  const { rows, state } = source;
  const filters = definition.quickFilters?.filters ?? [];
  const scoped = query.text === '' ? rows : rows.filter((row) => definition.searchText(row).includes(query.text));
  const chosen = query.filter === null ? undefined : filters.find((filter) => filter.id === query.filter);
  const shown = chosen === undefined ? scoped : scoped.filter(chosen.test);
  // Nothing is counted until something is known: the first rows, or the whole set with nothing in it.
  const known = rows.length > 0 || (state.kind === 'ready' && source.complete);

  return {
    rows: shown,
    state: bodyState(source, shown.length),
    quickFilters:
      definition.quickFilters === undefined
        ? undefined
        : {
          label: definition.quickFilters.label,
          total: known ? scoped.length : undefined,
          filters: filters.map((filter) => ({ id: filter.id, label: filter.label, tone: filter.tone, count: known ? scoped.filter(filter.test).length : undefined })),
        },
    footer: { shown: shown.length, total: source.complete ? { kind: 'exact', value: rows.length } : { kind: 'unknown', loaded: rows.length } },
    active: query.text !== '' || chosen !== undefined,
  };
}

function bodyState<TRow>(source: ListSource<TRow>, shown: number): DataViewState {
  const { rows, state } = source;
  if (rows.length === 0) {
    if (state.kind === 'failed') {
      return { kind: 'error', message: state.message, onRetry: state.retry };
    }

    return state.kind === 'ready' && source.complete ? { kind: 'empty' } : { kind: 'loading' };
  }

  return shown === 0 ? { kind: 'no-match' } : { kind: 'ready' };
}

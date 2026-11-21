import type { ChipTone, DataTableColumn, DataTableSort, IconName, KindTileTone, PageHeaderCommands } from '@omniviewdev/kit';

// What a list page is, and what feeds it. Plain data and one function per question, so a plugin states its page as a value and the host draws
// it (slice 1a plan 2.4: the shape of the mock's definition record). The page is a pure function of `(definition, source)`: the source is a
// prop, never a hook the definition calls, so the page reads no data layer and knows no plugin.

/** One state filter of the strip: a chip with the count of the rows it matches. */
export type ListQuickFilter<TRow> = {
  readonly id: string;
  /** The filter in the user's words ("Running"), never a column name (design 13 QF1). */
  readonly label: string;
  /** The state the chip stands for; it paints the chip only while the filter has rows in it. */
  readonly tone: ChipTone;
  readonly test: (row: TRow) => boolean;
};

export type ListQuickFilters<TRow> = {
  /** The strip's accessible name: what the filters are about ("Item state"). */
  readonly label: string;
  /** The filters after All, in order. The strip always starts with All. */
  readonly filters: ReadonlyArray<ListQuickFilter<TRow>>;
};

export type ListPageDefinition<TRow> = {
  /** The plural name of what the page lists ("Items"): the page's one heading, the name of its table, and the word of its states and of its Refresh command. */
  readonly title: string;
  /** The footer's count: "1 Item", "89 Items". */
  readonly nouns: { readonly one: string; readonly other: string };
  /** A kind tile before the heading. A list's header has none in the design; a page may. */
  readonly tile?: { readonly icon: IconName; readonly tone?: KindTileTone | undefined } | undefined;
  /** The page's own commands. The Refresh command is the page's, not the definition's: it is not here. */
  readonly commands?: Omit<PageHeaderCommands, 'utility'> | undefined;
  readonly quickFilters?: ListQuickFilters<TRow> | undefined;
  readonly columns: ReadonlyArray<DataTableColumn<TRow>>;
  /**
   * The order the page opens in: a column of `columns` and a direction. A column sorts only where it declares a `sortKey` (and a `sortKind` where its keys are numbers): its header is then a button that says
   * its state in `aria-sort`, a press sorts the rows by it, ascending first, and the next press on it turns it round and back (the mock's rule: there is no third state). The header of the column named here
   * says so, and a press on it turns it round. A tie keeps the order the source gave its rows in, in either direction, and a row whose key is `undefined` is last in either. Absent, or naming a column that does
   * not sort: the rows are in the source's order, as they were before this member, and no header says it is the one in force. A plugin written before it is drawn that way, and a host that predates it
   * never reads it, which draws a list unsorted.
   */
  readonly defaultSort?: DataTableSort | undefined;
  /** Lines in a row: 1, or 2 for an identity over a second line. */
  readonly lines: 1 | 2;
  /** The identity of a row: the source's own key, never a field a person can edit. */
  readonly getRowKey: (row: TRow) => string;
  /** Everything a person can read in the row, in lower case. The search is a substring match on it, as the design's search is. */
  readonly searchText: (row: TRow) => string;
};

/** Where the source is, as the page words it. */
export type ListSourceState =
  /** The connection or the first rows are on their way. */
  | { readonly kind: 'loading' }
  /** Nothing is wrong: the rows are what there is, and `complete` says whether it is all of it. */
  | { readonly kind: 'ready' }
  /**
   * A read failed. With no rows the failure is the page's body; beside rows they stay and the page keeps listing them. `retry` is
   * given only when asking again can help; without it the page draws no Retry (a button that does nothing is a stub).
   */
  | { readonly kind: 'failed'; readonly message?: string | undefined; readonly retry?: (() => void) | undefined };

/** What the page lists, and what it can ask of it. The page reads it and never writes back. */
export type ListSource<TRow> = {
  readonly state: ListSourceState;
  /**
   * The rows to list, in the source's own order: the order a list with no sort in force is drawn in, and the order a tie keeps when the person sorts a column (the page does not sort: the kit's table does, by the
   * keys the columns declare). A source that has a natural order of its own puts the rows in it, and says it in the definition's `defaultSort` too, so that the header of that column says so.
   * A row is never changed in place: a changed row is a new object and an unchanged one keeps its identity (the table does a sparse update in near-linear work on that promise).
   */
  readonly rows: readonly TRow[];
  /** The whole set is here. Until it is, the count says how many are loaded and not how many there are (decision A10). */
  readonly complete: boolean;
  /** A refresh runs on rows that stay on screen, whoever asked for it. */
  readonly refreshing: boolean;
  /** The user's Refresh. Resolves when the read is over and never rejects: a failure is the source's `state`. */
  readonly refresh: () => Promise<void>;
};

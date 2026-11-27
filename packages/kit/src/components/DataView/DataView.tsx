import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { CardGrid, type CardGridContent } from '../CardGrid';
import { CollectionFooter, type CollectionFooterProps } from '../CollectionFooter';
import { DataTable, type DataTableProps } from '../DataTable';
import { QuickFilters, type QuickFiltersProps } from '../QuickFilters';
import styles from './DataView.module.css';
import { CardsLoadingBody, EmptyBody, ErrorBody, LoadingBody } from './states';

/**
 * What the body of the view shows (plan 1.4). The header, the strip, the toolbar and the footer stay in every state but one: a state changes the result
 * body, not the input frame around it (design 12 section 5). The exception is the failure that leaves no rows, which has no count to carry and draws no footer.
 *
 * - `ready`: the rows, or the cards.
 * - `loading`: the first load: a skeleton with the final column count (eight blocks for cards), after 250 ms.
 * - `empty`: nothing to list: the table's header (cards have none) and one line, "No <label>".
 * - `no-match`: a search or a filter hid every item: the header, one line, "No <label> match", and the count says how many there were.
 * - `error`: a failure that left nothing to show: one notice in place of the body, with one Retry when `onRetry` is given. No footer: the mock draws none, and the pane keeps the 12 px a footer-less pane keeps at its bottom.
 *
 * The full family of collection states (refreshing, stale, partial, failure beside rows) is step 1a.8.
 */
export type DataViewState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly hint?: string | undefined }
  | { readonly kind: 'no-match' }
  | { readonly kind: 'error'; readonly message?: string | undefined; readonly onRetry?: (() => void) | undefined };

export type DataViewProps<TRow> = {
  /** The plural name of the items ("Items"). It names the view's one scroll region, and words the states: "No Items", "No Items match", "Couldn't load Items". */
  readonly label: string;
  /** The page's header, fixed above the collection: a `PageHeader`. */
  readonly header?: ReactNode;
  /** The quick filters of the collection. They precede the toolbar on the same line when there is room. Their `data-*` reach the strip. */
  readonly quickFilters?: QuickFiltersProps | undefined;
  /** A `WorkspaceToolbar` for search and commands. It wraps below the quick filters in a narrow pane. */
  readonly toolbar?: ReactNode;
  /** The footer: the collection's one count, and nothing else unless it has something ambient to say (the width note, the state of the data). Not drawn while `state` is a failure with no rows. */
  readonly footer: CollectionFooterProps;
  /** What the body shows. Ready when absent. */
  readonly state?: DataViewState | undefined;
} & DataAttributes &
  (
    | {
      /** The table: everything `DataTable` takes but its name, which is `label`. */
      readonly table: Omit<DataTableProps<TRow>, 'label'>;
      readonly cards?: undefined;
    }
    | {
      /**
         * The cards, under the same header, strip, toolbar and footer: the items (or the groups) and the one function that draws a card from an item, as
         * `CardGrid` takes them. Switching a view from `table` to `cards` replaces the body and nothing else.
         */
      readonly cards: CardGridContent<TRow>;
      readonly table?: undefined;
    }
  );

const NO_ROWS: readonly never[] = [];

type TableOfProps<TRow> = {
  readonly label: string;
  readonly table: Omit<DataTableProps<TRow>, 'label'>;
  readonly rows: readonly TRow[];
};

/** The table with the view's name, taking each prop of the caller's explicitly: a part's props are closed, and nothing is spread onto it. */
function TableOf<TRow>({ label, table, rows }: TableOfProps<TRow>) {
  return (
    <DataTable<TRow>
      label={label}
      rows={rows}
      getRowKey={table.getRowKey}
      columns={table.columns}
      lines={table.lines}
      sort={table.sort}
      onSortChange={table.onSortChange}
      selection={table.selection}
      onRowActivate={table.onRowActivate}
      rowsAreImmutable={table.rowsAreImmutable}
      maxHeight={table.maxHeight}
      rowMenu={table.rowMenu}
    />
  );
}

/** The card grid with the view's name, taking each prop of the caller's explicitly (see `TableOf`). */
function CardsOf<TRow>({ label, cards }: { readonly label: string; readonly cards: CardGridContent<TRow> }) {
  return cards.groups === undefined ? (
    <CardGrid<TRow> label={label} getKey={cards.getKey} renderCard={cards.renderCard} level={cards.level} items={cards.items} />
  ) : (
    <CardGrid<TRow> label={label} getKey={cards.getKey} renderCard={cards.renderCard} level={cards.level} groups={cards.groups} />
  );
}

/**
 * One collection workspace (design 12 section 5; the mock's `H.dataView`): the page's header, the quick filters, the toolbar, the body (a table or cards) and the
 * footer in one pane. The header and the footer are as tall as they are, the body takes what is left and holds the one named scroll region (the table's, or
 * the body itself for cards), so the footer stays at the bottom edge of the pane whatever the rows and the state. The states are props: the frame around the
 * body never changes with them, save that a failure with no rows draws no footer and leaves the pane 12 px short of its parent's bottom. Showing cards instead
 * of the table is one prop (`cards` for `table`): the frame stays, and only the body is drawn again. Props are closed: no `className`, no `style`; `data-*`
 * passes through.
 */
export function DataView<TRow>({ label, header, quickFilters, toolbar, table, cards, footer, state = { kind: 'ready' }, ...rest }: DataViewProps<TRow>) {
  const hasHeader = header != null || quickFilters !== undefined || toolbar != null;
  // The skeleton and the notice have no table to be the region, and the cards are no table: the body is the region and scrolls. A table is the region in every other state.
  const region = table === undefined || state.kind === 'loading' || state.kind === 'error';
  const footless = state.kind === 'error';
  const emptyTitle = state.kind === 'empty' ? `No ${label}` : `No ${label} match`;
  const emptyHint = state.kind === 'empty' ? state.hint : undefined;

  return (
    <div {...dataAttributes(rest)} className={styles.root} data-ov-state={state.kind} data-ov-view={table === undefined ? 'cards' : 'table'} data-ov-footless={footless ? '' : undefined}>
      {hasHeader ? (
        <div className={styles.header} data-ov-part="header">
          {header == null ? null : (
            <div className={styles.top} data-ov-block="top">
              {header}
            </div>
          )}
          {quickFilters === undefined ? null : (
            <div className={styles.filters} data-ov-block="filters">
              <QuickFilters {...dataAttributes(quickFilters)} label={quickFilters.label} total={quickFilters.total} filters={quickFilters.filters} selected={quickFilters.selected} onSelect={quickFilters.onSelect} />
            </div>
          )}
          {toolbar === undefined || toolbar === null ? null : (
            <div className={styles.toolbar} data-ov-block="toolbar">
              {toolbar}
            </div>
          )}
        </div>
      ) : null}
      <div className={styles.body} data-ov-part="body" role={region ? 'region' : undefined} aria-label={region ? label : undefined} tabIndex={region ? 0 : undefined}>
        {state.kind === 'ready' ? (
          table === undefined ? <CardsOf label={label} cards={cards} /> : <TableOf label={label} table={table} rows={table.rows} />
        ) : null}
        {state.kind === 'loading' ? (
          table === undefined ? <CardsLoadingBody label={label} /> : <LoadingBody label={label} columns={table.columns.length + (table.selection === undefined ? 0 : 1)} />
        ) : null}
        {state.kind === 'error' ? <ErrorBody title={`Couldn't load ${label}`} message={state.message} onRetry={state.onRetry} /> : null}
        {state.kind === 'empty' || state.kind === 'no-match' ? (
          table === undefined ? (
            <EmptyBody title={emptyTitle} hint={emptyHint} />
          ) : (
            <div className={styles.tableState}>
              <TableOf label={label} table={table} rows={NO_ROWS} />
              <EmptyBody title={emptyTitle} hint={emptyHint} />
            </div>
          )
        ) : null}
      </div>
      {footless ? null : (
        <CollectionFooter
          data-ov-part="footer"
          shown={footer.shown}
          total={footer.total}
          noun={footer.noun}
          plural={footer.plural}
          selected={footer.selected}
          hiddenColumns={footer.hiddenColumns}
          status={footer.status}
        />
      )}
    </div>
  );
}

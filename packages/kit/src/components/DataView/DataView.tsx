import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { CollectionFooter, type CollectionFooterProps } from '../CollectionFooter';
import { DataTable, type DataTableProps } from '../DataTable';
import { QuickFilters, type QuickFiltersProps } from '../QuickFilters';
import styles from './DataView.module.css';
import { EmptyBody, ErrorBody, LoadingBody } from './states';

/**
 * What the body of the view shows (plan 1.4). The header, the strip, the toolbar and the footer stay in every state: a state changes the result
 * body, not the input frame around it (design 12 section 5).
 *
 * - `ready`: the rows.
 * - `loading`: the first load: a skeleton with the final column count, after 250 ms.
 * - `empty`: nothing to list: the table's header and one line, "No <label>".
 * - `no-match`: a search or a filter hid every item: the header, one line, "No <label> match", and the count says how many there were.
 * - `error`: a failure that left no rows: one notice in place of them, with one Retry when `onRetry` is given.
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
  /** The page's header, fixed above the collection: a `PageHeader`. The 12 px under it are the view's. */
  readonly header?: ReactNode;
  /** The quick filters of the collection (design 13 QF1), 8 px above the toolbar. */
  readonly quickFilters?: QuickFiltersProps | undefined;
  /** The one command lane (design 12 TB1): a `WorkspaceToolbar`. The 8 px under it are the view's. */
  readonly toolbar?: ReactNode;
  /** The table: everything `DataTable` takes but its name, which is `label`. */
  readonly table: Omit<DataTableProps<TRow>, 'label'>;
  /** The footer: the collection's one count, and nothing else unless it has something ambient to say. */
  readonly footer: CollectionFooterProps;
  /** What the body shows. Ready when absent. */
  readonly state?: DataViewState | undefined;
} & DataAttributes;

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
    />
  );
}

/**
 * One collection workspace (design 12 section 5; the mock's `H.dataView`): the page's header, the quick filters, the toolbar, the table and the footer
 * in one pane. The header and the footer are as tall as they are, the body takes what is left and holds the one named scroll region, the table's, so
 * the footer stays at the bottom edge of the pane whatever the rows and the state. The states are props: the frame around the body never changes with
 * them. Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function DataView<TRow>({ label, header, quickFilters, toolbar, table, footer, state = { kind: 'ready' }, ...rest }: DataViewProps<TRow>) {
  const hasHeader = header !== undefined || quickFilters !== undefined || toolbar !== undefined;
  // The skeleton and the notice have no table to be the region, so the body is it; in every other state the table is.
  const region = state.kind === 'loading' || state.kind === 'error';
  const columns = table.columns.length + (table.selection === undefined ? 0 : 1);

  return (
    <div {...dataAttributes(rest)} className={styles.root} data-ov-state={state.kind}>
      {hasHeader ? (
        <div className={styles.header} data-ov-part="header">
          {header === undefined ? null : (
            <div className={styles.top} data-ov-block="top">
              {header}
            </div>
          )}
          {quickFilters === undefined ? null : (
            <div className={styles.filters} data-ov-block="filters">
              <QuickFilters label={quickFilters.label} total={quickFilters.total} filters={quickFilters.filters} selected={quickFilters.selected} onSelect={quickFilters.onSelect} />
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
        {state.kind === 'ready' ? <TableOf label={label} table={table} rows={table.rows} /> : null}
        {state.kind === 'loading' ? <LoadingBody label={label} columns={columns} /> : null}
        {state.kind === 'error' ? <ErrorBody title={`Couldn't load ${label}`} message={state.message} onRetry={state.onRetry} /> : null}
        {state.kind === 'empty' || state.kind === 'no-match' ? (
          <div className={styles.tableState}>
            <TableOf label={label} table={table} rows={NO_ROWS} />
            <EmptyBody title={state.kind === 'empty' ? `No ${label}` : `No ${label} match`} hint={state.kind === 'empty' ? state.hint : undefined} />
          </div>
        ) : null}
      </div>
      <CollectionFooter
        data-ov-part="footer"
        shown={footer.shown}
        total={footer.total}
        noun={footer.noun}
        plural={footer.plural}
        selected={footer.selected}
        refreshing={footer.refreshing}
        hiddenColumns={footer.hiddenColumns}
      />
    </div>
  );
}

// The columns of the kit variants: the narrow set of the Pods list (an identity with its namespace under it, Ready, Status, Restarts, Age) in
// two forms.
//   plain  one text node per line and no inner markup beyond the identity's two lines: the layout is measured, not the cells (the rule of
//          docs/ui-next/status/1a.3.md). The age is a label computed once, so no clock is subscribed.
//   real   the cells the plan budgets (docs/ui-next/slices/1a-pods-list.md 3.4): a tile, the name and its tail, the namespace; a status glyph
//          and its word; the age from the kit's one age clock. It is what the exact counts and the sensitivity runs read.
// The row shape and its content are `podRows.mjs`'s: the bench does not import the data layer of the Pods slice and the kit does not know
// what a Pod is: a column is a function of a `Row`.
import { compactAge, Icon, useAge, type DataTableColumn, type IconName } from '@omniviewdev/kit';
import type { Row } from './harness';

/** The clock the plain age labels are read at, fixed for the page so that every variant shows the same text. */
const NOW = Date.now();

const plainAge = (row: Row) => (row.createdAt === undefined ? '' : compactAge(new Date(row.createdAt), NOW).text);
const readyText = (row: Row) => (row.ready === undefined ? '' : `${row.ready.ready}/${row.ready.total}`);
const restartsText = (row: Row) => (row.restarts === undefined ? '' : String(row.restarts));

const GLYPH: Record<string, IconName> = {
  healthy: 'status-success',
  running: 'status-success',
  progress: 'status-warning',
  attention: 'status-warning',
  error: 'status-error',
  stopped: 'status-info',
  info: 'status-info',
};
const glyphOf = (row: Row): IconName => GLYPH[row.status?.role ?? 'info'] ?? 'status-info';

function AgeCell({ createdAt }: { readonly createdAt: number | undefined }) {
  return <span>{useAge(createdAt, compactAge)}</span>;
}

type Cells = 'plain' | 'real';

/**
 * Columns are built once per page and keep their identity (a table input must). `count` counts the calls of the identity cell into
 * `window.__cellCalls`: one call is one row rendered (the cells of a row are all called together), as the kit's counts tests read it.
 */
export function createColumns(cells: Cells, count: boolean): ReadonlyArray<DataTableColumn<Row>> {
  const counted = (cell: DataTableColumn<Row>['cell']): DataTableColumn<Row>['cell'] =>
    count
      ? (row) => {
        window.__cellCalls = (window.__cellCalls ?? 0) + 1;
        return cell(row);
      }
      : cell;
  const real = cells === 'real';
  return [
    {
      id: 'name',
      header: 'Name',
      fit: 'id',
      lead: real ? 36 : 0,
      sortKey: (row) => row.name,
      text: (row) => [{ text: row.name }, { text: row.namespace, font: 'small' }],
      keepEnd: (row) => row.nameTail,
      cell: counted(
        real
          ? (row) => (
            <>
              <span data-tile="" />
              <span>{row.nameTail > 0 ? row.name.slice(0, -row.nameTail) : row.name}</span>
              <span>{row.nameTail > 0 ? row.name.slice(-row.nameTail) : ''}</span>
              <span>{row.namespace}</span>
            </>
          )
          : (row) => (
            <>
              <div>{row.name}</div>
              <div>{row.namespace}</div>
            </>
          ),
      ),
    },
    { id: 'ready', header: 'Ready', fit: 'fixed', width: 59, align: 'end', sortKey: (row) => (row.ready === undefined ? undefined : row.ready.ready / Math.max(1, row.ready.total)), sortKind: 'number', cell: real ? (row) => <span>{readyText(row)}</span> : readyText },
    {
      id: 'status',
      header: 'Status',
      fit: 'fixed',
      width: 157,
      sortKey: (row) => row.status?.word,
      cell: real
        ? (row) => (
          <>
            <Icon name={glyphOf(row)} />
            <span>{row.status?.word ?? ''}</span>
          </>
        )
        : (row) => row.status?.word ?? '',
    },
    { id: 'restarts', header: 'Restarts', fit: 'fixed', width: 72, align: 'end', sortKey: (row) => row.restarts, sortKind: 'number', cell: real ? (row) => <span>{restartsText(row)}</span> : restartsText },
    { id: 'age', header: 'Age', fit: 'fixed', width: 59, sortKey: (row) => row.createdAt, sortKind: 'number', cell: real ? (row) => <AgeCell createdAt={row.createdAt} /> : plainAge },
  ];
}

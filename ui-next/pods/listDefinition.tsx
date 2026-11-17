import type { DataTableColumn } from '@omniviewdev/kit';
import type { ReactNode } from 'react';
import { podDefinition, podSearchText, type PodColumn, type PodRow, type PodSortId } from '../k8s';
import { AgeCell, IdentityCell, ReadyCell, RestartsCell, StatusCell } from './cells';

// The Pods list page, stated as data: the Pod definition's words, columns and quick filters, with a cell drawn for each column. The host's list page
// draws it (`ui-next/page/`); this file imports nothing from the host, so the type of the value is checked where the two meet, in `ui-next/main.tsx`.

function specOf(id: PodSortId): PodColumn {
  const spec = podDefinition.columns.find((candidate) => candidate.id === id);
  if (spec === undefined) {
    throw new Error(`The Pod definition has no column ${id}`);
  }

  return spec;
}

/** A table column from the definition's column: its label, how it takes width, its width, its side. The cell is the page's. */
function column(id: PodSortId, cell: (row: PodRow) => ReactNode, rest: Partial<DataTableColumn<PodRow>> = {}): DataTableColumn<PodRow> {
  const spec = specOf(id);
  return {
    id: spec.id,
    header: spec.label,
    fit: spec.fit,
    // The identity column takes what is left and has no width of its own; `width` is the floor the definition gives a flex column and the width of a fixed one.
    width: spec.fit === 'fixed' ? spec.width : undefined,
    align: spec.align === 'right' ? 'end' : 'start',
    cell,
    ...rest,
  };
}

/** The tile and the name over its namespace: the first 28 px of the cell are the tile and its gap. */
const NAME_LEAD = 28;

// The columns the list shows by default (`defaultHidden` ones wait for the Columns chooser, plan 1a.9). No column sorts yet: the source's order is the list's
// (plan 1a.2), and the table's own sorting stays off until 1a.7 gives it a state to keep.
const COLUMNS: ReadonlyArray<DataTableColumn<PodRow>> = [
  column('name', (row) => <IdentityCell row={row} />, {
    lead: NAME_LEAD,
    // What the fit measures: the name over its namespace, and the end of the name that stays whole when it is cut.
    text: (row) => [{ text: row.name }, { text: podDefinition.list.identity.second(row) ?? '', font: 'small' }],
    keepEnd: (row) => podDefinition.list.identity.tail(row),
  }),
  column('ready', (row) => <ReadyCell row={row} />),
  column('status', (row) => <StatusCell row={row} />),
  column('restarts', (row) => <RestartsCell row={row} />),
  column('age', (row) => <AgeCell row={row} />),
];

export const podsListDefinition = {
  title: podDefinition.nouns.other,
  nouns: podDefinition.nouns,
  columns: COLUMNS,
  lines: 2 as const,
  getRowKey: (row: PodRow) => row.key,
  searchText: podSearchText,
  quickFilters: {
    // "Pod state": what the filters are about, named in the singular as the mock names it.
    label: `${podDefinition.kind} state`,
    filters: podDefinition.list.quickFilters,
  },
};

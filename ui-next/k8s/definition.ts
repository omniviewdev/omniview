import { formatAge } from './fields';
import type { PodRow } from './row';
import { SORT_KINDS, type PodSort, type PodSortId, type SortKind } from './sort';
import type { StateRole } from './status';

// The Pod definition: the shape of the mock's definition record (docs/ui-next/slices/1a-pods-list.md 2.4; MOCK
// k8s-resource-definitions.js:1053-1086) with the Pods columns of PRINTER.Pod (:737-742). The page and the table read it; they know
// no Pod rule of their own. CPU and Memory are not here (tier B, plan 1.2).

/** The closed vocabulary of cells a page draws. */
export type Cell =
  | { readonly kind: 'text'; readonly text: string; readonly mono?: true }
  | { readonly kind: 'status'; readonly raw: string; readonly label: string; readonly role: StateRole }
  | { readonly kind: 'age'; readonly createdAt: number; readonly text: string; readonly long: string }
  | { readonly kind: 'none'; readonly reason: string };

export type PodColumn = {
  readonly id: PodSortId;
  readonly label: string;
  /** `id` is the identity column; `fixed` has the width of its format; `flex` takes what is left, measured on a sample (R9). */
  readonly fit: 'id' | 'fixed' | 'flex';
  /** Pixels: the mock's fitted width for a fixed column, the floor for a flex one. */
  readonly width: number;
  readonly align: 'left' | 'right';
  readonly sort: SortKind;
  /** In the Columns chooser, not in the list until chosen. */
  readonly defaultHidden: boolean;
  readonly required?: true;
};

export type QuickFilter = {
  readonly id: 'running' | 'pending' | 'failed' | 'completed';
  readonly label: string;
  readonly tone: 'success' | 'warning' | 'error' | 'muted';
  readonly test: (row: PodRow) => boolean;
};

export type Facet = {
  readonly id: 'node';
  readonly label: string;
  /** The label of the "no choice" entry. */
  readonly all: string;
  readonly value: (row: PodRow) => string | undefined;
};

export type PodField = {
  readonly id: PodSortId;
  /** `now` is the clock the age is read against, in epoch milliseconds. */
  readonly display: (row: PodRow, now: number) => Cell;
};

export type PodDefinition = {
  readonly type: string;
  readonly kind: string;
  readonly nouns: { readonly one: string; readonly other: string };
  readonly columns: readonly PodColumn[];
  readonly list: {
    readonly defaultSort: PodSort;
    readonly identity: {
      /** The one line under the name: the namespace. */
      readonly second: (row: PodRow) => string | null;
      /** Trailing characters of the name a cell keeps whole when it cuts the name. */
      readonly tail: (row: PodRow) => number;
    };
    readonly quickFilters: readonly QuickFilter[];
    readonly facets: readonly Facet[];
  };
  readonly fields: readonly PodField[];
};

const column = (id: PodSortId, label: string, fit: PodColumn['fit'], width: number, align: PodColumn['align'], rest: Partial<Pick<PodColumn, 'defaultHidden' | 'required'>> = {}): PodColumn =>
  ({ id, label, fit, width, align, sort: SORT_KINDS[id], defaultHidden: false, ...rest });

const none = (reason: string): Cell => ({ kind: 'none', reason });

export const podDefinition: PodDefinition = {
  type: 'k8s:/pods',
  kind: 'Pod',
  nouns: { one: 'Pod', other: 'Pods' },
  columns: [
    column('name', 'Name', 'id', 160, 'left', { required: true }),
    column('ready', 'Ready', 'fixed', 59, 'right'),
    column('status', 'Status', 'fixed', 157, 'left'),
    column('restarts', 'Restarts', 'fixed', 72, 'right'),
    column('age', 'Age', 'fixed', 59, 'left'),
    column('node', 'Node', 'flex', 72, 'left', { defaultHidden: true }),
    column('ip', 'IP', 'fixed', 113, 'left', { defaultHidden: true }),
  ],
  list: {
    defaultSort: { id: 'name', direction: 'asc' },
    identity: { second: (row) => (row.namespace === '' ? null : row.namespace), tail: (row) => row.nameTail },
    // Counted over the rows after search and facets, before the chosen filter (plan 1.3). Running is the word, Pending and Failed are roles.
    quickFilters: [
      { id: 'running', label: 'Running', tone: 'success', test: (row) => row.status?.word === 'Running' },
      { id: 'pending', label: 'Pending', tone: 'warning', test: (row) => row.status?.role === 'progress' },
      { id: 'failed', label: 'Failed', tone: 'error', test: (row) => row.status?.role === 'error' },
      { id: 'completed', label: 'Completed', tone: 'muted', test: (row) => row.status?.word === 'Completed' || row.status?.word === 'Succeeded' },
    ],
    facets: [{ id: 'node', label: 'Node', all: 'All nodes', value: (row) => row.node }],
  },
  fields: [
    { id: 'name', display: (row) => ({ kind: 'text', text: row.name }) },
    {
      id: 'ready',
      display: ({ ready }) => (ready === undefined ? none('The Pod lists no containers.') : { kind: 'text', text: `${ready.ready}/${ready.total}`, mono: true }),
    },
    {
      id: 'status',
      display: ({ status }) => {
        if (status === undefined) {
          return none('The Pod reports no phase.');
        }

        return status.role === undefined ? { kind: 'text', text: status.word } : { kind: 'status', raw: status.word, label: status.word, role: status.role };
      },
    },
    {
      id: 'restarts',
      display: ({ restarts }) => (restarts === undefined ? none('No container has reported a restart count yet.') : { kind: 'text', text: restarts.toLocaleString('en-US'), mono: true }),
    },
    {
      id: 'age',
      display: ({ createdAt }, now) => (createdAt === undefined ? none('The Pod has no creation time.') : { kind: 'age', createdAt, ...formatAge(createdAt, now) }),
    },
    { id: 'node', display: ({ node }) => (node === undefined ? none('Not scheduled to a node yet.') : { kind: 'text', text: node }) },
    { id: 'ip', display: ({ ip }) => (ip === undefined ? none('No address assigned yet.') : { kind: 'text', text: ip, mono: true }) },
  ],
};

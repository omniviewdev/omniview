import type { PodRow } from './row';

export type PodSortId = 'name' | 'ready' | 'status' | 'restarts' | 'age' | 'node' | 'ip';

export type PodSort = {
  readonly id: PodSortId;
  readonly direction: 'asc' | 'desc';
};

/** How a column compares (MOCK k8s-resources.js `compareBy`): ascending is the natural order, oldest first for time, unhealthiest first for a ratio. */
export type SortKind = 'text' | 'number' | 'ratio' | 'time';

export const SORT_KINDS: Readonly<Record<PodSortId, SortKind>> = {
  name: 'text',
  ready: 'ratio',
  status: 'text',
  restarts: 'number',
  age: 'time',
  node: 'text',
  ip: 'text',
};

type SortValue = string | number | { readonly ready: number; readonly total: number } | undefined;

function valueOf(row: PodRow, id: PodSortId): SortValue {
  switch (id) {
    case 'name': return row.name;
    case 'ready': return row.ready;
    case 'status': return row.status?.word;
    case 'restarts': return row.restarts;
    case 'age': return row.createdAt;
    case 'node': return row.node;
    case 'ip': return row.ip;
  }
}

// Digits compare as numbers: pod-2 before pod-10, 10.0.0.9 before 10.0.0.10.
const collator = new Intl.Collator(undefined, { numeric: true });

const isMissing = (value: SortValue): boolean => value === undefined || value === '';
const fraction = (value: { readonly ready: number; readonly total: number }) => (value.total === 0 ? 1 : value.ready / value.total);

function compare(a: NonNullable<SortValue>, b: NonNullable<SortValue>): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return collator.compare(a, b);
  }

  if (typeof a === 'object' && typeof b === 'object') {
    return fraction(a) - fraction(b) || a.total - b.total;
  }

  return 0;
}

/**
 * The rows in the order of `sort`; the input is not touched. A missing value is last whatever the direction, and a tie is broken
 * by the host key, ascending (the mock's rule).
 */
export function sortPodRows(rows: readonly PodRow[], { id, direction }: PodSort): readonly PodRow[] {
  const sign = direction === 'desc' ? -1 : 1;
  const keyed = rows.map((row) => ({ row, value: valueOf(row, id) }));
  keyed.sort((a, b) => {
    const missingA = isMissing(a.value);
    const missingB = isMissing(b.value);
    if (missingA || missingB) {
      return missingA && missingB ? a.row.key.localeCompare(b.row.key) : missingA ? 1 : -1;
    }

    return compare(a.value!, b.value!) * sign || a.row.key.localeCompare(b.row.key);
  });
  return keyed.map(({ row }) => row);
}

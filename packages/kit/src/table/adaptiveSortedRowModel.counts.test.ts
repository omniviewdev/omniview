// The work counts of the adaptive sorted row model (optimisations register T-15, must-not-regress MNR-T7). Times drift on a shared
// machine; comparator calls do not, so these are exact assertions that fail a pull request when the engine stops reusing the order.
//
// The workload is the old sprint's probe (bench/app/README.md, "5,000-record probe"): 5,000 rows sorted by name, then 50 immutable
// patches of two rows each, a deletion and a recreation among them. The old table made 250,068 comparisons for it where upstream
// sorting made 2,747,070; MNR-T7 allows 300,000 (the recorded number plus 20%).
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdaptiveSortedRowModel } from './adaptiveSortedRowModel';

type Item = { id: string; name: string; restarts: number };

const adaptiveFeatures = tableFeatures({ rowSortingFeature, sortedRowModel: createAdaptiveSortedRowModel() });
const nativeFeatures = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const columns: Array<ColumnDef<typeof adaptiveFeatures, Item>> = [{ accessorKey: 'name', sortFn: sortFn_alphanumeric }, { accessorKey: 'restarts' }];
const nativeColumns = columns as unknown as Array<ColumnDef<typeof nativeFeatures, Item>>;

// A small deterministic generator (mulberry32), so the corpus and the patches are the same on every run.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const letters = 'abcdefghijklmnopqrstuvwxyz0123456789';
const word = (next: () => number, length: number) => Array.from({ length }, () => letters[Math.floor(next() * letters.length)]).join('');

const SIZE = 5000;
function corpus(): Item[] {
  const next = random(7);
  return Array.from({ length: SIZE }, (_, index) => ({ id: `uid-${index}`, name: `workload-${word(next, 9)}-${word(next, 5)}`, restarts: 0 }));
}

// The instrumented comparator: every call a sort makes while `measure` runs. Upstream and adaptive sorting both go through
// Array.prototype.sort with a comparator, so this counts what the old probe counted.
const originalSort = Array.prototype.sort;
afterEach(() => {
  Array.prototype.sort = originalSort;
});
function comparisons(measure: () => void): number {
  let calls = 0;
  Array.prototype.sort = function (this: unknown[], compare?: (a: unknown, b: unknown) => number) {
    if (compare === undefined) {
      return originalSort.call(this);
    }

    return originalSort.call(this, (a: unknown, b: unknown) => {
      calls += 1;
      return compare(a, b);
    });
  } as typeof Array.prototype.sort;
  try {
    measure();
  } finally {
    Array.prototype.sort = originalSort;
  }

  return calls;
}

type Patch = (rows: readonly Item[]) => Item[];
// Two rows per patch; every tenth touch is a deletion plus a recreation under the same name and a new id (appended last, as the
// source view does); the others change the restart count, which is not the sorted column.
function patches(count: number, kind: 'mixed' | 'status'): Patch[] {
  const next = random(11);
  let touches = 0;
  let serial = SIZE;
  return Array.from({ length: count }, () => (rows) => {
    const out = rows.slice();
    for (let touched = 0; touched < 2; touched += 1) {
      const index = Math.floor(next() * out.length);
      const row = out.at(index);
      if (row === undefined) {
        continue;
      }

      touches += 1;
      if (kind === 'mixed' && touches % 10 === 0) {
        out.splice(index, 1);
        out.push({ id: `uid-${serial++}`, name: row.name, restarts: 0 });
      } else {
        out[index] = { ...row, restarts: row.restarts + 1 };
      }
    }

    return out;
  });
}

function harness(kind: 'adaptive' | 'native', data: Item[]) {
  const sorting = [{ id: 'name', desc: false }];
  const view = renderHook(
    ({ rows }: { rows: Item[] }) => {
      const table =
        kind === 'adaptive'
          ? useTable({ features: adaptiveFeatures, columns, data: rows, getRowId: (row) => row.id, meta: { dataTableImmutableRows: true }, initialState: { sorting } })
          : useTable({ features: nativeFeatures, columns: nativeColumns, data: rows, getRowId: (row) => row.id, initialState: { sorting } });
      return table.getRowModel().rows;
    },
    { initialProps: { rows: data } },
  );
  return {
    rows: () => view.result.current,
    update: (rows: Item[]) => {
      view.rerender({ rows }); 
    },
    ids: () => view.result.current.map((row) => row.id),
  };
}

describe('comparator calls of sparse immutable patches (MNR-T7)', () => {
  it('50 two-row patches over 5,000 rows make at most 300,000 comparator calls, and the order is the upstream order after every patch', () => {
    let data = corpus();
    const adaptive = harness('adaptive', data);
    const native = harness('native', data);
    let adaptiveCalls = 0;
    let nativeCalls = 0;
    for (const patch of patches(50, 'mixed')) {
      const patched = patch(data);
      data = patched;
      adaptiveCalls += comparisons(() => {
        adaptive.update(patched); 
      });
      nativeCalls += comparisons(() => {
        native.update(patched); 
      });
      expect(adaptive.ids()).toEqual(native.ids());
    }

    // Every returned row is the current object, not a stale one from the previous order.
    const current = new Map(data.map((row) => [row.id, row]));
    for (const row of adaptive.rows()) {
      expect(row.original).toBe(current.get(row.id));
    }

    expect(adaptiveCalls).toBeLessThanOrEqual(300_000);
    // The reduction is the point: upstream sorting pays the full sort on every patch (the old probe: 2,747,070 against 250,068).
    expect(nativeCalls).toBeGreaterThan(adaptiveCalls * 5);
  });

  it('50 patches that leave the sorted column alone cost one linear pass in all, not one sort each (the old probe: 249,950 down to 4,999)', () => {
    let data = corpus();
    const adaptive = harness('adaptive', data);
    let calls = 0;
    for (const patch of patches(50, 'status')) {
      const patched = patch(data);
      data = patched;
      calls += comparisons(() => {
        adaptive.update(patched); 
      });
    }

    // The first patch compares the rows once in order to verify the kept order (n - 1 comparisons); the other 49 make none.
    expect(calls).toBeLessThanOrEqual(SIZE - 1);
  });

  it('50 renders with the same rows add no comparison', () => {
    const data = corpus();
    const adaptive = harness('adaptive', data);
    const calls = comparisons(() => {
      for (let render = 0; render < 50; render += 1) {
        adaptive.update(data);
      }
    });
    expect(calls).toBe(0);
  });
});

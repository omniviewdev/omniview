import { valueToJSON, type HostRecord } from '@omniviewdev/runtime';
import type { ResourceTableRow } from '@/hooks/resource/useResourceDefinition';

/**
 * Display projections keyed by the immutable host record they were derived from. A source patch
 * replaces only the records that changed, so every other record keeps its row object. Mounted cells
 * compare rows by identity, which lets them skip unchanged rows instead of re-rendering the page.
 * A changed record is a new object and is projected again, so no row can show an older body.
 */
const projections = new WeakMap<HostRecord, ResourceTableRow>();

/** Project host records into table rows, in order, reusing the row of every record seen before. */
export function projectResourceRows(records: readonly HostRecord[]): ResourceTableRow[] {
  return records.map((record) => {
    let row = projections.get(record);
    if (row === undefined) {
      row = { record, data: valueToJSON(record.record.body) };
      projections.set(record, row);
    }

    return row;
  });
}

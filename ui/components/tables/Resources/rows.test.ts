import { describe, expect, it } from 'vitest';

import { projectResourceRows } from './rows';
import { makeHostRecord } from './testing/fixture';

describe('resource table row projection', () => {
  it('keeps the row of every record a patch left alone and projects only the changed one', () => {
    const first = makeHostRecord(1);
    const second = makeHostRecord(2);
    const before = projectResourceRows([first, second]);

    // A patch replaces one record by key and adds another. The untouched record is the same object.
    const patched = makeHostRecord(2, { phase: 'Failed' });
    const after = projectResourceRows([first, patched, makeHostRecord(3)]);

    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after).toHaveLength(3);
  });

  it('never shows an earlier body for a replaced record', () => {
    const original = makeHostRecord(2, { phase: 'Pending' });
    const patched = makeHostRecord(2, { phase: 'Failed' });
    expect(patched.key).toBe(original.key);

    const [before] = projectResourceRows([original]);
    const [after] = projectResourceRows([patched]);

    expect(before.data).toMatchObject({ phase: 'Pending' });
    expect(after.data).toMatchObject({ phase: 'Failed' });
    expect(after.record).toBe(patched);
  });

  it('keeps host order and the host record on every row', () => {
    const records = [makeHostRecord(5), makeHostRecord(1), makeHostRecord(3)];
    const rows = projectResourceRows(records);

    expect(rows.map((row) => row.record)).toEqual(records);
    expect(rows.map((row) => row.record.key)).toEqual(records.map((record) => record.key));
  });
});

// From what a column declares and what a sample of its rows measured to the numbers the planner takes (design chapter 13, T3 and T6: the
// floors are measures of text, "after ALL the content around the text").
import { describe, expect, it } from 'vitest';
import { CELL_INSET, EDGE_INSET, FIT_CAP, FIT_FLOOR, HEAD_MIN, SORT_AFFORDANCE, fitInputs, type FitColumnDeclaration } from './fitColumns';
import type { ColumnSample, TextMeasurer } from './sample';

// 7 px a character, the ellipsis one character.
const measure: TextMeasurer = (text) => text.length * 7;
const samples = (entries: Record<string, ColumnSample>) => new Map(Object.entries(entries));

const select: FitColumnDeclaration = { id: 'select', kind: 'fixed', header: '', width: 46, utility: true, sortable: false };
const name = (more: Partial<FitColumnDeclaration> = {}): FitColumnDeclaration => ({ id: 'name', kind: 'id', header: 'Name', sortable: true, lead: 36, ...more });
const age: FitColumnDeclaration = { id: 'age', kind: 'fixed', header: 'Age', width: 59, sortable: true };

describe('fixed columns', () => {
  it('keep their declared width as every floor', () => {
    const [first, , last] = fitInputs([select, name(), age], samples({ name: { textWidth: 200, tailWidth: 0 } }), measure);
    expect(first).toEqual({ id: 'select', kind: 'fixed', natural: 46, min: 46, read: 46, full: 46, utility: true });
    expect(last).toMatchObject({ natural: 59, min: 59, read: 59, full: 59 });
  });
});

describe('the identity column', () => {
  it('measures its natural width as the leading offset, the widest sampled text and the trailing inset', () => {
    const [, identity] = fitInputs([select, name(), age], samples({ name: { textWidth: 300, tailWidth: 0 } }), measure);
    const lead = CELL_INSET + 36;
    const trail = CELL_INSET;
    expect(identity?.natural).toBe(lead + 300 + trail);
    // The compact floor is 160 px of text as a cell width; the readable and full floors add what surrounds the text.
    expect(identity?.min).toBe(FIT_FLOOR.id);
    expect(identity?.read).toBe(lead + FIT_FLOOR.id + trail);
    expect(identity?.full).toBe(lead + FIT_FLOOR.id + trail);
  });

  it('is never wider than the cap, however long its names', () => {
    const [, identity] = fitInputs([select, name(), age], samples({ name: { textWidth: 5000, tailWidth: 0 } }), measure);
    expect(identity?.natural).toBe(FIT_CAP);
  });

  it('does not pad a short name up to its floor: the floors never exceed the natural width', () => {
    const [, identity] = fitInputs([select, name({ lead: 0 }), age], samples({ name: { textWidth: 40, tailWidth: 0 } }), measure);
    expect(identity?.natural).toBeLessThan(FIT_FLOOR.id);
    expect(identity?.min).toBe(identity?.natural);
    expect(identity?.read).toBe(identity?.natural);
    // A table that scrolls still gives the identity the full floor.
    expect(identity?.full).toBe(CELL_INSET + FIT_FLOOR.id + CELL_INSET);
  });

  it('uses the edge inset of 12 px at the first and the last column', () => {
    const [only] = fitInputs([name({ lead: 0, sortable: false })], samples({ name: { textWidth: 200, tailWidth: 0 } }), measure);
    expect(only?.natural).toBe(EDGE_INSET + 200 + EDGE_INSET);
  });
});

describe('text columns', () => {
  const group: FitColumnDeclaration = { id: 'group', kind: 'flex', header: 'Team', sortable: true };

  it('clip down to 72 px of text', () => {
    const [, , text] = fitInputs([select, name(), group], samples({ name: { textWidth: 300, tailWidth: 0 }, group: { textWidth: 180, tailWidth: 0 } }), measure);
    expect(text?.min).toBe(FIT_FLOOR.flex);
    expect(text?.read).toBe(CELL_INSET + FIT_FLOOR.flex + EDGE_INSET);
  });

  it('never get narrower than their header, which holds the sort affordance', () => {
    const wide: FitColumnDeclaration = { id: 'restarts', kind: 'flex', header: 'Restarts', sortable: true };
    const [, , column] = fitInputs([select, name(), wide], samples({ name: { textWidth: 300, tailWidth: 0 }, restarts: { textWidth: 7, tailWidth: 0 } }), measure);
    const header = 'Restarts'.length * 7 + SORT_AFFORDANCE + CELL_INSET + EDGE_INSET;
    expect(column?.natural).toBe(header);
    expect(column?.min).toBeGreaterThanOrEqual(header);
  });

  it('keep the end that tells siblings apart: the floor holds the end, an ellipsis and a little of the start (13 COL4)', () => {
    const ids: FitColumnDeclaration = { id: 'ref', kind: 'flex', header: 'Ref', sortable: false };
    const tail = 12 * 7;
    const [, , column] = fitInputs([select, name(), ids], samples({ name: { textWidth: 300, tailWidth: 0 }, ref: { textWidth: 400, tailWidth: tail } }), measure);
    const kept = tail + 7 + HEAD_MIN;
    expect(kept).toBeGreaterThan(FIT_FLOOR.flex);
    expect(column?.min).toBeGreaterThanOrEqual(kept);
  });

  it('read zero text for a column with nothing in the sample and stay at their header width', () => {
    const empty: FitColumnDeclaration = { id: 'node', kind: 'flex', header: 'Node', sortable: false };
    const [, , column] = fitInputs([select, name(), empty], samples({ name: { textWidth: 300, tailWidth: 0 } }), measure);
    expect(column?.natural).toBe('Node'.length * 7 + CELL_INSET + EDGE_INSET);
  });
});

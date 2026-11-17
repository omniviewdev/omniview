// The fit planner is pure: columns with their widths in, one width per column out. Its rules are the mock's (design chapter 13, T3 to T7,
// `fitSolve` and `fitPin` in the mock's core.js); the numbers below are the mock's own for its Pods composition, measured in
// docs/ui-next/slices/1a-pods-list.md 1.1: the identity column takes the remainder (678 at 1440 wide, 268 at 1030 wide, 282 with the two
// metric columns), and clips down to its floor before the table scrolls.
import { describe, expect, it } from 'vitest';
import { planFit, type FitInput } from './planFit';

const fixed = (id: string, width: number, utility = false): FitInput => ({ id, kind: 'fixed', natural: width, min: width, read: width, full: width, utility });
// A name column of 400 px natural width: 48 px before the text (inset, tile, gap), 160 px of text at the least, 22 px after it.
const identity = (natural = 400): FitInput => ({ id: 'name', kind: 'id', natural, min: 160, read: Math.min(natural, 48 + 160 + 22), full: 48 + 160 + 22 });
const text = (id: string, natural: number, min = 72, read = 100): FitInput => ({ id, kind: 'flex', natural, min, read, full: read });

const narrow = [fixed('select', 46, true), identity(), fixed('ready', 59), fixed('status', 157), fixed('restarts', 72), fixed('age', 59), fixed('inspect', 46)];
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

describe('the identity column takes the remainder', () => {
  it('1440 wide: 678, as the mock fits it', () => {
    const plan = planFit(narrow, 1117);
    expect(plan.widths).toEqual([46, 678, 59, 157, 72, 59, 46]);
    expect(plan.scroll).toBe(false);
    expect(plan.total).toBe(1117);
  });

  it('1030 wide: 268, clipped from its natural 400 to fit (the readable floor holds)', () => {
    const plan = planFit(narrow, 707);
    expect(plan.widths).toEqual([46, 268, 59, 157, 72, 59, 46]);
    expect(plan.floor).toBe('read');
    expect(plan.scroll).toBe(false);
  });

  it('the wide set with CPU and Memory at 198 px each: 282', () => {
    const wide = [fixed('select', 46, true), identity(), fixed('ready', 59), fixed('status', 157), fixed('restarts', 72), fixed('cpu', 198), fixed('memory', 198), fixed('age', 59), fixed('inspect', 46)];
    expect(planFit(wide, 1117).widths).toEqual([46, 282, 59, 157, 72, 198, 198, 59, 46]);
  });

  it('fixed columns never move, whatever the width', () => {
    for (const available of [400, 620, 707, 900, 1117, 1600, 2400]) {
      const widths = planFit(narrow, available).widths;
      expect([widths[0], widths[2], widths[3], widths[4], widths[5], widths[6]]).toEqual([46, 59, 157, 72, 59, 46]);
    }
  });
});

describe('floors', () => {
  it('between the readable floor and the compact floor the table still fits, with the name clipped further', () => {
    const plan = planFit(narrow, 620);
    expect(plan.floor).toBe('min');
    expect(plan.scroll).toBe(false);
    expect(plan.widths[1]).toBe(181);
    expect(plan.total).toBe(620);
  });

  it('below the compact floors the table scrolls sideways and the identity keeps its full floor', () => {
    const plan = planFit(narrow, 500);
    expect(plan.scroll).toBe(true);
    expect(plan.widths[1]).toBe(48 + 160 + 22);
    expect(plan.total).toBeGreaterThan(500);
  });

  it('a floor never exceeds the natural width: a short name is not padded', () => {
    const plan = planFit([fixed('select', 46, true), { id: 'name', kind: 'id', natural: 120, min: 120, read: 120, full: 120 }, fixed('age', 59)], 1000, { stretch: false });
    expect(plan.widths).toEqual([46, 120, 59]);
  });

  it('without stretch the columns keep their natural widths when there is room', () => {
    expect(planFit(narrow, 1600, { stretch: false }).widths[1]).toBe(400);
  });
});

describe('deficit and extra width', () => {
  it('extra width goes to the flexible columns in proportion to their natural widths', () => {
    const columns = [fixed('select', 46, true), text('node', 100), identity(300), fixed('age', 59)];
    // natural 46 + 100 + 300 + 59 = 505; 1095 px extra: a quarter to the node column, three quarters to the identity.
    const plan = planFit(columns, 1600);
    expect(plan.widths).toEqual([46, 374, 1121, 59]);
    expect(plan.total).toBe(1600);
  });

  it('a deficit comes from the text columns first, then from the identity column', () => {
    const columns = [fixed('select', 46, true), identity(300), text('node', 200), fixed('age', 59)];
    // natural 605. At 455 the table is 150 short: the text column gives 100 (200 down to its readable floor 100), the identity 50.
    const plan = planFit(columns, 455);
    expect(plan.widths).toEqual([46, 250, 100, 59]);
    expect(plan.total).toBe(455);
  });

  it('widths are whole pixels that add up to the width given', () => {
    const columns = [fixed('select', 46, true), text('a', 97), text('b', 131), identity(263), fixed('age', 59)];
    for (const available of [701, 777, 1013, 1333, 1917]) {
      const plan = planFit(columns, available);
      expect(plan.widths.every((width) => Number.isInteger(width))).toBe(true);
      expect(sum(plan.widths)).toBe(plan.scroll ? plan.total : available);
    }
  });
});

describe('pinning (13 T4, T7)', () => {
  it('pins the utility columns and the identity, in order, with the offset each sticks at', () => {
    const plan = planFit(narrow, 1117);
    expect(plan.pinned).toEqual([true, true, false, false, false, false, false]);
    expect(plan.offsets[0]).toBe(0);
    expect(plan.offsets[1]).toBe(46);
  });

  it('pins when the table scrolls, so the identity stays in view', () => {
    const plan = planFit(narrow, 500);
    expect(plan.scroll).toBe(true);
    expect(plan.pinned.slice(0, 2)).toEqual([true, true]);
  });

  it('pins nothing when the pinned group would leave under 96 px for the rest', () => {
    const plan = planFit(narrow, 300);
    expect(plan.pinned.every((pinned) => !pinned)).toBe(true);
  });
});

describe('no room to measure yet', () => {
  it('an unknown or empty container gives the natural widths and does not scroll', () => {
    const plan = planFit(narrow, 0);
    expect(plan.widths).toEqual([46, 400, 59, 157, 72, 59, 46]);
    expect(plan.scroll).toBe(false);
  });

  it('plans nothing for no columns', () => {
    expect(planFit([], 900).widths).toEqual([]);
  });
});

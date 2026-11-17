import { describe, expect, it } from 'vitest';
import { press, revealed, stopOf, toggled, visibleRows, type TreeLike } from './tree';

// Two groups and a lone entry, one level of nesting deeper in the second group: enough shape for every rule, none of a real screen.
const nodes: readonly TreeLike[] = [
  { id: 'alpha', children: [{ id: 'alpha-1' }, { id: 'alpha-2' }] },
  { id: 'beta' },
  { id: 'gamma', children: [{ id: 'gamma-1', children: [{ id: 'gamma-1-x' }] }, { id: 'gamma-2' }] },
];

const ids = (open: ReadonlySet<string>) => visibleRows(nodes, open).map((row) => row.id);
const set = (...values: string[]): ReadonlySet<string> => new Set(values);

describe('visibleRows', () => {
  it('lists the roots, and a group\'s children only while the group is open', () => {
    expect(ids(set())).toEqual(['alpha', 'beta', 'gamma']);
    expect(ids(set('alpha'))).toEqual(['alpha', 'alpha-1', 'alpha-2', 'beta', 'gamma']);
    expect(ids(set('alpha', 'gamma', 'gamma-1'))).toEqual(['alpha', 'alpha-1', 'alpha-2', 'beta', 'gamma', 'gamma-1', 'gamma-1-x', 'gamma-2']);
  });

  it('hides a whole subtree behind a closed group, even when a group below it is in the open set', () => {
    expect(ids(set('gamma-1'))).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('gives each row what a tree item announces: level, position in its set, size of its set, parent, and whether it is open', () => {
    const rows = visibleRows(nodes, set('gamma', 'gamma-1'));
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    expect(byId['alpha']).toMatchObject({ level: 1, position: 1, setSize: 3, parent: undefined, expandable: true, expanded: false });
    expect(byId['beta']).toMatchObject({ level: 1, position: 2, setSize: 3, expandable: false, expanded: false });
    expect(byId['gamma-1']).toMatchObject({ level: 2, position: 1, setSize: 2, parent: 'gamma', expandable: true, expanded: true });
    expect(byId['gamma-1-x']).toMatchObject({ level: 3, position: 1, setSize: 1, parent: 'gamma-1', expandable: false });
  });

  it('keeps the node of each row, so a renderer reads its data from the row', () => {
    const [first] = visibleRows(nodes, set());
    expect(first?.node).toBe(nodes[0]);
  });

  it('treats a group with no children as an entry', () => {
    const rows = visibleRows([{ id: 'empty', children: [] }], set('empty'));
    expect(rows).toEqual([expect.objectContaining({ id: 'empty', expandable: false, expanded: false })]);
  });
});

describe('revealed', () => {
  it('keeps the groups the screen asked to be open', () => {
    expect([...revealed(nodes, ['alpha'], undefined)]).toEqual(['alpha']);
  });

  it('opens every ancestor of the current entry, so it is never hidden at load', () => {
    expect([...revealed(nodes, [], 'gamma-1-x')].sort()).toEqual(['gamma', 'gamma-1']);
    expect(ids(revealed(nodes, [], 'gamma-1-x'))).toContain('gamma-1-x');
  });

  it('adds nothing for a target the tree does not hold, or one at the top', () => {
    expect([...revealed(nodes, ['alpha'], 'nowhere')]).toEqual(['alpha']);
    expect([...revealed(nodes, [], 'beta')]).toEqual([]);
  });

  it('ignores an id that is not a group: only groups are ever open', () => {
    expect([...revealed(nodes, ['beta', 'unknown'], undefined)]).toEqual([]);
  });
});

describe('toggled', () => {
  it('opens a closed group and closes an open one', () => {
    expect([...toggled(set(), 'alpha')]).toEqual(['alpha']);
    expect([...toggled(set('alpha'), 'alpha')]).toEqual([]);
  });

  it('does not touch the set it was given', () => {
    const before = set('alpha');
    toggled(before, 'alpha');
    expect([...before]).toEqual(['alpha']);
  });

  it('answers the same set when a forced state is already the state, so a no-op is no change', () => {
    const open = set('alpha');
    expect(toggled(open, 'alpha', true)).toBe(open);
    const closed = set();
    expect(toggled(closed, 'alpha', false)).toBe(closed);
    expect([...toggled(closed, 'alpha', true)]).toEqual(['alpha']);
  });
});

describe('stopOf (the one tab stop of the tree)', () => {
  const rows = visibleRows(nodes, set('alpha'));

  it('keeps a stop that is still a row', () => {
    expect(stopOf(rows, 'alpha-2', 'beta')).toBe('alpha-2');
  });

  it('falls back to the current entry, then to the first row, when the stop left or was never set', () => {
    expect(stopOf(rows, 'gone', 'beta')).toBe('beta');
    expect(stopOf(rows, undefined, 'beta')).toBe('beta');
    expect(stopOf(rows, undefined, 'hidden')).toBe('alpha');
    expect(stopOf(rows, undefined, undefined)).toBe('alpha');
  });

  it('has no stop in an empty tree', () => {
    expect(stopOf([], undefined, undefined)).toBeUndefined();
  });
});

describe('press (the keys of a tree view)', () => {
  const run = (open: ReadonlySet<string>, stop: string | undefined, key: string) => press(visibleRows(nodes, open), open, stop, key);

  it('moves the stop one row down and up, and stays on the first and last row', () => {
    const open = set('alpha');
    expect(run(open, 'alpha', 'ArrowDown')).toMatchObject({ handled: true, stop: 'alpha-1' });
    expect(run(open, 'alpha-1', 'ArrowUp')).toMatchObject({ handled: true, stop: 'alpha' });
    expect(run(open, 'alpha', 'ArrowUp')).toMatchObject({ handled: true, stop: 'alpha' });
    expect(run(open, 'gamma', 'ArrowDown')).toMatchObject({ handled: true, stop: 'gamma' });
  });

  it('jumps to the first and the last visible row with Home and End', () => {
    const open = set('gamma');
    expect(run(open, 'beta', 'Home')).toMatchObject({ handled: true, stop: 'alpha' });
    expect(run(open, 'beta', 'End')).toMatchObject({ handled: true, stop: 'gamma-2' });
  });

  it('opens a closed group with ArrowRight and keeps the stop on it', () => {
    const result = run(set(), 'alpha', 'ArrowRight');
    expect(result).toMatchObject({ handled: true, stop: 'alpha' });
    expect([...result.open]).toEqual(['alpha']);
  });

  it('moves into an open group, to its first child, with ArrowRight', () => {
    const result = run(set('alpha'), 'alpha', 'ArrowRight');
    expect(result).toMatchObject({ handled: true, stop: 'alpha-1' });
    expect([...result.open]).toEqual(['alpha']);
  });

  it('does nothing on an entry with ArrowRight, and says it handled the key', () => {
    const open = set();
    const result = run(open, 'beta', 'ArrowRight');
    expect(result).toMatchObject({ handled: true, stop: 'beta' });
    expect(result.open).toBe(open);
  });

  it('closes an open group with ArrowLeft, and moves a child to its parent', () => {
    const closed = run(set('alpha'), 'alpha', 'ArrowLeft');
    expect(closed).toMatchObject({ handled: true, stop: 'alpha' });
    expect([...closed.open]).toEqual([]);
    expect(run(set('alpha'), 'alpha-2', 'ArrowLeft')).toMatchObject({ handled: true, stop: 'alpha' });
    expect(run(set('gamma', 'gamma-1'), 'gamma-1-x', 'ArrowLeft')).toMatchObject({ stop: 'gamma-1' });
  });

  it('does nothing with ArrowLeft on a closed group or entry at the top', () => {
    const open = set();
    const result = run(open, 'alpha', 'ArrowLeft');
    expect(result).toMatchObject({ handled: true, stop: 'alpha' });
    expect(result.open).toBe(open);
  });

  it('toggles a group with Enter and Space, and activates an entry', () => {
    for (const key of ['Enter', ' ']) {
      expect([...run(set(), 'alpha', key).open]).toEqual(['alpha']);
      expect([...run(set('alpha'), 'alpha', key).open]).toEqual([]);
      expect(run(set(), 'alpha', key).activate).toBeUndefined();
      expect(run(set(), 'beta', key)).toMatchObject({ handled: true, stop: 'beta', activate: 'beta' });
    }
  });

  it('leaves a key it does not own to the browser: letters and Tab are not handled, no type-ahead yet', () => {
    for (const key of ['a', 'Tab', 'PageDown', 'Escape', 'F6']) {
      expect(run(set(), 'alpha', key)).toMatchObject({ handled: false, stop: 'alpha', activate: undefined });
    }
  });

  it('handles nothing when the stop is not a row', () => {
    expect(run(set(), 'gone', 'ArrowDown').handled).toBe(false);
    expect(run(set(), undefined, 'Home').handled).toBe(false);
  });

  it('never changes the open set it was given', () => {
    const open = set('alpha');
    run(open, 'alpha', 'ArrowLeft');
    expect([...open]).toEqual(['alpha']);
  });
});

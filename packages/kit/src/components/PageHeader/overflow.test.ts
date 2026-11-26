import { describe, expect, it } from 'vitest';
import { overflowItems, type OverflowEntry } from './overflow';

const entry = (id: string, rest: Partial<OverflowEntry> = {}): OverflowEntry => ({ id, label: id.toUpperCase(), onSelect: () => undefined, ...rest });
const ids = (items: ReadonlyArray<{ readonly id: string }>) => items.map((item) => item.id);
const ignore = () => undefined;

describe('overflowItems', () => {
  it('keeps the items in the order they are given', () => {
    expect(ids(overflowItems([entry('a'), entry('b'), entry('c')], new Set(), ignore))).toEqual(['action:a', 'action:b', 'action:c']);
  });

  it('never repeats a command that is a button on the page (design 14 PX1)', () => {
    expect(ids(overflowItems([entry('a'), entry('scale'), entry('b')], new Set(['scale']), ignore))).toEqual(['action:a', 'action:b']);
  });

  it('moves the destructive items to the end, behind one separator', () => {
    const items = overflowItems([entry('delete', { destructive: true }), entry('a'), entry('b')], new Set(), ignore);
    expect(ids(items)).toEqual(['action:a', 'action:b', 'separator:delete', 'action:delete']);
    expect(items.map((item) => item.kind)).toEqual(['action', 'action', 'separator', 'action']);
  });

  it('puts one separator before the first destructive item only, however many there are', () => {
    const items = overflowItems([entry('a'), entry('x', { destructive: true }), entry('y', { destructive: true })], new Set(), ignore);
    expect(items.map((item) => item.kind)).toEqual(['action', 'separator', 'action', 'action']);
  });

  it('draws no separator at the start: a menu of destructive items only has none', () => {
    const items = overflowItems([entry('x', { destructive: true }), entry('y', { destructive: true })], new Set(), ignore);
    expect(items.map((item) => item.kind)).toEqual(['action', 'action']);
  });

  it('honours a separator the caller asked for between plain items, and drops one at the start', () => {
    const items = overflowItems([entry('a', { separatorBefore: true }), entry('b', { separatorBefore: true }), entry('c')], new Set(), ignore);
    expect(items.map((item) => item.kind)).toEqual(['action', 'separator', 'action', 'action']);
  });

  it('drops a separator that a removed item leaves at the start, or two in a row', () => {
    const items = overflowItems([entry('gone'), entry('a', { separatorBefore: true }), entry('b')], new Set(['gone']), ignore);
    expect(items.map((item) => item.kind)).toEqual(['action', 'action']);
  });

  it('passes the disabled and destructive marks and label through and dispatches by command ID', () => {
    let selected = '';
    const select = (id: string) => {
      selected = id;
    };

    const [item] = overflowItems([entry('a', { disabled: true, destructive: true })], new Set(), select);
    expect(item).toMatchObject({ kind: 'action', id: 'action:a', label: 'A', disabled: true, destructive: true });
    if (item?.kind === 'action') {
      item.onSelect();
    }

    expect(selected).toBe('a');
  });

  it('passes the icon and the reason a disabled entry gives through to the menu item', () => {
    const [item] = overflowItems([entry('a', { icon: 'plus', disabled: 'Create a folder first' })], new Set(), ignore);
    expect(item).toMatchObject({ kind: 'action', icon: 'plus', disabled: 'Create a folder first' });
  });

  it('is nothing for nothing: the menu then has no trigger', () => {
    expect(overflowItems([], new Set(), ignore)).toEqual([]);
    expect(overflowItems([entry('a')], new Set(['a']), ignore)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { overflowItems, type MenuEntry } from './overflow';

const entry = (id: string, rest: Partial<MenuEntry> = {}): MenuEntry => ({ id, label: id.toUpperCase(), onSelect: () => undefined, ...rest });
const ids = (items: ReadonlyArray<{ readonly id: string }>) => items.map((item) => item.id);

describe('overflowItems', () => {
  it('keeps the items in the order they are given', () => {
    expect(ids(overflowItems([entry('a'), entry('b'), entry('c')], new Set()))).toEqual(['a', 'b', 'c']);
  });

  it('never repeats a command that is a button on the page (design 14 PX1)', () => {
    expect(ids(overflowItems([entry('a'), entry('scale'), entry('b')], new Set(['scale'])))).toEqual(['a', 'b']);
  });

  it('moves the destructive items to the end, behind one separator', () => {
    const items = overflowItems([entry('delete', { destructive: true }), entry('a'), entry('b')], new Set());
    expect(ids(items)).toEqual(['a', 'b', 'delete']);
    expect(items.map((item) => item.separatorBefore === true)).toEqual([false, false, true]);
  });

  it('puts one separator before the first destructive item only, however many there are', () => {
    const items = overflowItems([entry('a'), entry('x', { destructive: true }), entry('y', { destructive: true })], new Set());
    expect(items.map((item) => item.separatorBefore === true)).toEqual([false, true, false]);
  });

  it('draws no separator at the start: a menu of destructive items only has none', () => {
    const items = overflowItems([entry('x', { destructive: true }), entry('y', { destructive: true })], new Set());
    expect(items.map((item) => item.separatorBefore === true)).toEqual([false, false]);
  });

  it('honours a separator the caller asked for between plain items, and drops one at the start', () => {
    const items = overflowItems([entry('a', { separatorBefore: true }), entry('b', { separatorBefore: true }), entry('c')], new Set());
    expect(items.map((item) => item.separatorBefore === true)).toEqual([false, true, false]);
  });

  it('drops a separator that a removed item leaves at the start, or two in a row', () => {
    const items = overflowItems([entry('gone'), entry('a', { separatorBefore: true }), entry('b')], new Set(['gone']));
    expect(items.map((item) => item.separatorBefore === true)).toEqual([false, false]);
  });

  it('passes the disabled and destructive marks and the label through, and calls onSelect', () => {
    let called = 0;
    const select = () => {
      called += 1;
    };

    const [item] = overflowItems([entry('a', { disabled: true, destructive: true, onSelect: select })], new Set());
    expect(item).toMatchObject({ id: 'a', label: 'A', disabled: true, destructive: true });
    item?.onSelect(undefined);
    expect(called).toBe(1);
  });

  it('is nothing for nothing: the menu then has no trigger', () => {
    expect(overflowItems([], new Set())).toEqual([]);
    expect(overflowItems([entry('a')], new Set(['a']))).toEqual([]);
  });
});

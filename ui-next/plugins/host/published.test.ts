import { describe, expect, it, vi } from 'vitest';
import { Published } from './published';

describe('Published', () => {
  it('holds nothing for a key until it is published, then the value', () => {
    const table = new Published<{ readonly n: number }>();
    expect(table.get('a')).toBeUndefined();

    expect(table.publish('a', { n: 1 })).toBe(true);
    expect(table.get('a')).toEqual({ n: 1 });
    expect(table.get('b')).toBeUndefined();
  });

  it('tells nobody, and keeps the object it holds, when the value is equal by content', () => {
    const table = new Published<{ readonly n: number }>();
    const listener = vi.fn();
    table.publish('a', { n: 1 });
    const held = table.get('a');
    table.subscribe(listener);

    expect(table.publish('a', { n: 1 })).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(table.get('a')).toBe(held);
  });

  it('replaces the value and tells every listener when the value is different', () => {
    const table = new Published<{ readonly n: number }>();
    const first = vi.fn();
    const second = vi.fn();
    table.subscribe(first);
    table.subscribe(second);
    table.publish('a', { n: 1 });

    expect(table.publish('a', { n: 2 })).toBe(true);
    expect(table.get('a')).toEqual({ n: 2 });
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('tells for a different key too, and keeps one value per key', () => {
    const table = new Published<string>();
    const listener = vi.fn();
    table.subscribe(listener);

    table.publish('a', 'x');
    table.publish('b', 'x');

    expect(listener).toHaveBeenCalledTimes(2);
    expect(table.get('a')).toBe('x');
    expect(table.get('b')).toBe('x');
  });

  it('stops telling a listener that unsubscribed, and unsubscribing twice is harmless', () => {
    const table = new Published<string>();
    const listener = vi.fn();
    const stop = table.subscribe(listener);
    table.publish('a', 'x');
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    stop();
    table.publish('a', 'y');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('lets a listener unsubscribe itself while it is told, without skipping the others', () => {
    const table = new Published<string>();
    const order: string[] = [];
    const stop = table.subscribe(() => {
      order.push('first');
      stop();
    });
    table.subscribe(() => {
      order.push('second');
    });

    table.publish('a', 'x');
    table.publish('a', 'y');

    expect(order).toEqual(['first', 'second', 'second']);
  });

  it('holds a null as a value, which is not the same as nothing', () => {
    const table = new Published<readonly string[] | null>();
    expect(table.publish('a', null)).toBe(true);
    expect(table.get('a')).toBeNull();
    expect(table.publish('a', null)).toBe(false);
  });
});

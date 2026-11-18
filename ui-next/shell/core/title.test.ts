import { describe, expect, it } from 'vitest';
import { splitTitle } from './title';

describe('splitTitle', () => {
  it('keeps a title of 12 graphemes or fewer whole', () => {
    expect(splitTitle('')).toEqual(['', '']);
    expect(splitTitle('Widgets')).toEqual(['Widgets', '']);
    expect(splitTitle('abcdefghijkl')).toEqual(['abcdefghijkl', '']);
  });

  it('cuts at the last slash when the tail from it is 18 characters or fewer, and the separator stays in the tail', () => {
    expect(splitTitle('widget-store/north/alpha-01')).toEqual(['widget-store/north', '/alpha-01']);
    expect(splitTitle('some-long-prefix/abcdefghijklmnopq')).toEqual(['some-long-prefix', '/abcdefghijklmnopq']);
  });

  it('cuts at a colon the same way', () => {
    expect(splitTitle('gadget-controller-one: Gizmo')).toEqual(['gadget-controller-one', ': Gizmo']);
  });

  it('prefers the slash to a colon', () => {
    expect(splitTitle('first:part/second-part-here')).toEqual(['first:part', '/second-part-here']);
  });

  it('falls back to the midpoint when the tail from the separator is longer than 18', () => {
    const text = 'abcdefghijklm/abcdefghijklmnopqrst';
    const parts = splitTitle(text);
    expect(parts).toEqual([text.slice(0, -10), text.slice(-10)]);
    expect(parts[1]).toHaveLength(10);
  });

  it('falls back to the midpoint when the separator is the first or last character', () => {
    expect(splitTitle('/abcdefghijklmnopqrstuvwxyz')).toEqual(['/abcdefghijklmnop', 'qrstuvwxyz']);
    expect(splitTitle('abcdefghijklmnopqrstuvwxyz:')).toEqual(['abcdefghijklmnopq', 'rstuvwxyz:']);
  });

  it('cuts a title with no separator at the midpoint with a tail of at most ten graphemes', () => {
    expect(splitTitle('abcdefghijklmnopqrstuvwxyz')).toEqual(['abcdefghijklmnop', 'qrstuvwxyz']);
    // 13 graphemes: ceil(13 / 2) = 7 is under the ten.
    expect(splitTitle('abcdefghijklm')).toEqual(['abcdef', 'ghijklm']);
  });

  it('never splits an emoji or a letter with its accent', () => {
    const family = '👨‍👩‍👧';
    const text = `abc${family.repeat(11)}`;
    const [head, tail] = splitTitle(text);
    expect(`${head}${tail}`).toBe(text);
    expect(head).toBe(`abc${family.repeat(4)}`);
    expect(tail).toBe(family.repeat(7));

    const accents = 'e\u0301'.repeat(14);
    const [first, second] = splitTitle(accents);
    expect(first + second).toBe(accents);
    expect(second).toBe('e\u0301'.repeat(7));
  });

  it('counts graphemes, not code units, for the whole-title rule', () => {
    expect(splitTitle('👍'.repeat(12))).toEqual(['👍'.repeat(12), '']);
    expect(splitTitle('👍'.repeat(13))[1]).toBe('👍'.repeat(7));
  });
});

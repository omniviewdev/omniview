import { describe, expect, it } from 'vitest';
import { SESSION_RULE, splitTitle } from './title';

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

describe('splitTitle for a session tab (the mock\'s `splitEnd`, shell-panel.js)', () => {
  const split = (text: string) => splitTitle(text, SESSION_RULE);

  it('keeps a generated suffix whole: the last hyphen when the tail from it is 12 characters or fewer', () => {
    expect(split('build-runner-7d8c6f49b-f8q4m')).toEqual(['build-runner-7d8c6f49b', '-f8q4m']);
    expect(split('abcdefghijklm-abcdefghijk')).toEqual(['abcdefghijklm', '-abcdefghijk']);
  });

  it('cuts at the midpoint when the tail from the last hyphen is longer than 12', () => {
    const text = 'abcdefghijklm-abcdefghijkl';
    expect(split(text)).toEqual([text.slice(0, -10), text.slice(-10)]);
  });

  it('takes a separator only past the fourth character', () => {
    expect(split('ab-cdefghijklmnopqrstuvwxyz')).toEqual(['ab-cdefghijklmnop', 'qrstuvwxyz']);
    expect(split('abcd-efghijklmnopqrstuvwxyz')).toEqual(['abcd-efghijklmnop', 'qrstuvwxyz']);
    expect(split('abcde-fghijkl')).toEqual(['abcde', '-fghijkl']);
  });

  it('prefers a slash, then a colon, to a hyphen, as the document tab does', () => {
    expect(split('widget-store/north/alpha-01')).toEqual(['widget-store/north', '/alpha-01']);
    expect(split('gadget-controller-one: Gizmo')).toEqual(['gadget-controller-one', ': Gizmo']);
  });

  it('keeps a short title whole', () => {
    expect(split('abcdefghijkl')).toEqual(['abcdefghijkl', '']);
  });

  it('leaves the document tab\'s rule as it was: no hyphen, a separator from the second character', () => {
    expect(splitTitle('build-runner-7d8c6f49b-f8q4m')).toEqual(['build-runner-7d8c6', 'f49b-f8q4m']);
    expect(splitTitle('ab/cdefghijklmnopqr')).toEqual(['ab', '/cdefghijklmnopqr']);
  });
});
